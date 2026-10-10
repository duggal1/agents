# SQLite migration plan (full switch, approved)

## Why
No Docker, no daemon, backup = copy a file. Nothing in the data needs Postgres;
it was there for fleet machinery (Graphile, LISTEN/NOTIFY, advisory locks).

## Postgres-only inventory (verified in code)
- `datasource db { provider = "postgresql" }`, 92 migrations (`0001_init`…)
- Scalar lists: `Routine.crons String[]`, `participantNames String[]` (line 724, 1270) — SQLite has none
- `BigInt lastRequest` — fine on SQLite
- No enums, no extensions, no SKIP LOCKED anywhere
- Advisory locks: auth admission, job-reconciler try/unlock, mcp-oauth material,
  artifact-versions, computers quota, spaces create/delete, router connection scope (9 sites)
- `SELECT ... FOR UPDATE` row locks: auth deployment_settings, bot-secrets x2,
  messaging-delivery, computer-update, bot-messages, stuck-work x2, child-bots,
  teaching-session x5, agent-connections x2 (no-ops on SQLite; each needs a review note)
- `DISTINCT ON`: apps/api/src/routine-runs.ts:58, apps/api/src/artifacts.ts:289
- `ILIKE` + `::text` on Json: apps/api/src/search.ts (3 sites)
- Queue: GraphileJobPublisher/GraphileJobWorkerHost (adapters/wakeup.ts) +
  `graphile_worker.remove_job` cancel; InMemoryJobQueue exists (single-process only)
- Realtime: PostgresRealtimeFanout (LISTEN/NOTIFY) + InMemoryRealtimeFanout; pool
  threading through worker/app (`Pool` type leaks into createDb/createPool)
- Leadership locks via pool advisory funcs (worker comments at index.ts:244-293)
- Testcontainers postgres:16 in 5 testkit CLIs (harness, computer, desktop-performance,
  evals, canary); CI `DATABASE_URL: postgres://...:5433` (ci.yml x3 + others)
- Desktop native cluster: local-postgres.ts (~700 lines: initdb/ports/cluster) —
  deleted, replaced by a file
- Compose postgres service + pgdata volume; backup.sh/restore.sh; systemd units;
  docs/self-host.md env block; .env DATABASE_URL

## Design (all behind existing interfaces)
1. **Schema**: `provider = "sqlite"`, `String[]` → explicit child tables
   (`RoutineCron`, second one per model at 1270 — check which), fresh baseline
   migration `0001_init_sqlite` (squash; pg migrations archived, not replayed).
   WAL mode + `busy_timeout` on connect; `file:` URL from DATA_DIR.
2. **Queue**: new `SqliteJobQueue implements JobPublisher, JobWorkerHost`
   (jobs table + poll + claim with `BEGIN IMMEDIATE`), same row shapes as
   adapter-kit background-jobs. Graphile impl deleted; WAKEUP_DRIVER values:
   `sqlite` (default) / `memory` (tests).
3. **Realtime**: new `PollingRealtimeFanout` (events table + poll per process,
   same RealtimeFanout surface). Postgres one deleted.
4. **Locks**: `withAdvisoryLock`-style helper per site → SQLite `BEGIN IMMEDIATE`
   transactions; FOR UPDATE sites → plain reads inside the write tx, each noted.
   DISTINCT ON → GROUP BY/window rewrites. ILIKE → LIKE (ASCII-CI) + `json_extract`
   for blocks.
5. **Client**: `createDb/createPool` become sqlite (Prisma + file); `Pool` type
   usages replaced; leadership via lock table.
6. **Tests/CI**: testkit harness boots file DBs (drop Testcontainers where it only
   served postgres); CI DATABASE_URL=file:…; compose drops postgres service;
   backup/restore = file copy (+WAL checkpoint).
7. **Data migration**: `scripts/migrate-pg-to-sqlite` (dual Prisma clients,
   model-by-model copy, String[]→child rows); desktop auto-detects legacy
   cluster on boot and converts once.

## Order (each green before next)
1. Schema + baseline + client factory (no runtime flip)
2. Queue + fanout + locks (interfaces already exist)
3. SQL ports (DISTINCT ON, ILIKE, FOR UPDATE audit, String[] remodel)
4. Flip DATABASE_URL default + desktop/compose/testkit/CI/docs
5. Data-migration script + desktop auto-convert
6. Full verification tail (unit, integration, e2e, topology)

## Risks
- FOR UPDATE → serialized-write semantics differ under contention; edge-case
  review per site, adversarial concurrency tests where cheap.
- LIKE vs ILIKE non-ASCII case behavior in search.
- Other agents' in-flight DB work will conflict; coordinate at each commit.
- Existing users must run the converter; failed converts must leave pg intact.
