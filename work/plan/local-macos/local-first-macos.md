# Plan: local-first macOS app (E2B-first, bun, no login, SQLite)

Status: PROPOSED — no code changed. Discuss first, execute after agreement.

Language rule for this project: there is one thing — **the macOS app** — and its
screens (agents, dashboard, artifacts, settings). Nothing in this plan is "the
web." The React UI rendered inside the Mac window is referred to only as the
Mac screens. Ports and addresses, where unavoidable, are plumbing behind the
Mac window, never a place the user goes.

## 1. Goal

Double-click (or one `bun mac` command) → the macOS app opens straight into
the agents screen. No login screen, no accounts, no Docker required. All data
in one SQLite file on the Mac. E2B is the default virtual computer; local
Docker is the fallback when E2B is unavailable.

## 2. Non-goals (overrule explicitly)

- Full pnpm purge across CI/Dockerfiles/lockfile. Repo-wide, affects everyone,
  buys nothing on the Mac. Phase 2.
- Rewriting screens natively (SwiftUI). Nothing changes visually.
- Multi-user / sharing. Gone by definition in local mode.

## 3. Architecture today (verified in code)

```
Mac window (Electron, apps/desktop)
  └─ renders the Mac screens (apps/web bundle, served locally)
       └─ talks to local API + worker processes (apps/api, apps/worker)
            ├─ sessions via Better Auth (packages/auth + User/Session/Account/Verification tables)
            ├─ tenancy: every request scoped to a Space (requireMembership, IsolationError)
            ├─ data in Postgres (provider = "postgresql", 92 migrations)
            ├─ background jobs via Graphile (Postgres-backed queue)
            ├─ realtime via Postgres LISTEN/NOTIFY (PostgresRealtimeFanout)
            └─ virtual computers via sandbox providers (docker | e2b | daytona | createos | box | desktop)
```

Postgres-only touchpoints (break on SQLite, verified):

- `packages/db/prisma/schema.prisma` — `provider = "postgresql"`.
- `pg_advisory_xact_lock` in `packages/db/src/spaces.ts`, `computers.ts`,
  `artifact-versions.ts`, plus `packages/adapters/src/mcp-oauth.ts` and
  `job-reconciler.ts` (unlock).
- `LISTEN rakazo_events` realtime fanout (+ test asserting it).
- Graphile worker host (`apps/worker/src/index.ts`, `apps/api/src/env.ts`).
- Better Auth's 4 session tables + `UserModelCredential` / `UserVoiceCredential`
  rows keyed by user id.

What is already on our side (no work needed):

- E2B is a first-class provider (`sandbox-factory.ts:44`); Docker is only the
  default in `sandbox-provider-env.ts:7`, not a requirement.
- `InMemoryJobQueue` driver already exists (used by tests) — the Graphile
  replacement for local mode.
- `RealtimeFanout` is an interface — local mode swaps the implementation in the
  composition root, no caller changes.
- First account created is already the owner; the cookie persists. Login
  friction is one screen, once.
- `packageManager` is already `bun@1.4.2`; Node 22/24/26 and Bun 1.4.2 are on
  this machine. The debt is pnpm usage in CI/Dockerfiles/docs, not the runtime.
- "Bedrock" is only a model-provider *name* in one ranking test. There is no
  Bedrock infrastructure. Nothing to remove.

## 4. Target architecture

```
Mac window (Electron)
  └─ the Mac screens (unchanged UI)
       └─ local API + worker processes, invisible, started/stopped with the Mac app
            ├─ single fixed owner actor minted at boot; single auto-created Space
            ├─ no cookies, no sessions, no login screen anywhere
            ├─ data in ~/Library/Application Support/Rakazo/rakazo.db (SQLite)
            ├─ jobs via in-process queue + boot-time reconciler
            ├─ realtime via in-process fanout
            └─ virtual computers: E2B if E2B_API_KEY present → Docker if daemon
                reachable → none (Mac screens stay fully usable)
```

"Server" in this plan always means background processes on the Mac. Nothing
listens on the network. Nothing phones home.

## 5. Workstreams

### 5.1 E2B first, Docker fallback
- `packages/adapters/src/sandbox-provider-env.ts`: resolution order becomes
  E2B (key present) → Docker (daemon reachable) → `none`.
- Reorder `.env.example` + the desktop "This computer" copy so the Mac screens
  tell the truth.
- Verify: unit tests on the resolver; boot once with key (E2B picked), once
  without (fallback, Mac app still opens).

### 5.2 No app login (Better Auth dropped on the Mac path)
- `apps/api`: local mode mints one fixed owner actor at boot and
  auto-creates the single Space. `requireMembership` stays in the code and
  always passes for that actor. No cookies, no sessions, no sign-in reachable.
- Mac screens: delete login/signup/password UI and the session gate; boot goes
  straight to the agents screen.
- STAYS, explicitly: `apps/desktop/src/browser-auth.ts` + `oauth-callback.ts`.
  That is not app login — it connects Claude/ChatGPT/model subscriptions and
  MCP OAuth. Killing it breaks paid models.
- Deleted: `packages/auth` wiring in `apps/api/src/app.ts`, Mac screens'
  `lib/auth.ts`, Auth routes and gates.
- Contained behind one `RAKAZO_LOCAL_MODE` flag; upstream multi-user paths
  untouched, no fork of shared code.

### 5.3 Postgres → local SQLite (the deep cut)
- Schema: `provider = "sqlite"` for the local database. Fresh local DB starts
  from a clean `db push` baseline; the Mac DB is a new file, nothing migrates.
- `pg_advisory_xact_lock` (spaces, computers, artifact-versions, mcp-oauth,
  job-reconciler) → SQLite-safe transactions. Single local user means
  contention is nearly impossible; serialized writes suffice.
- Realtime: in-process fanout implementation behind the existing interface.
- Jobs: local mode forces `InMemoryJobQueue`. Honest tradeoff: a crash loses
  queued jobs; the reconciler re-repairs on next boot. Fine on a laptop.
- Auth tables (`User/Session/Account/Verification`) dropped from the local
  schema; per-user credential rows pinned to the single local owner id.
- Space columns stay in the schema (tenant code untouched, exactly one tenant).

### 5.4 Bun for everything you touch
`bun mac` and all local scripts run on bun only — pnpm appears nowhere in the
Mac path. Full pnpm purge (CI, Dockerfiles, lockfile) is phase 2, not this plan.

### 5.5 One command, Mac window
New additive `scripts/mac.ts` + `bun mac` entry: ensures the data dir and
`rakazo.db` exist → `db push` → boots API + worker + Mac screens locally →
opens the Electron window. First run asks one question: E2B key or local
Docker. Ctrl-C stops everything.

### 5.6 Verification before "done"
`tsc` clean on all surfaces → full unit suite green (787 tests at plan time) →
fresh-Mac simulation: delete the data dir, run `bun mac`, confirm the agents
screen with zero login → E2B computer provisions with Docker absent →
kill -9 mid-job, reboot, reconciler recovers.

## 6. Order, risks, fallback

Order: 5.1 → 5.5 skeleton (against current Postgres, so the Mac window shows
fast) → 5.2 → 5.3 → 5.4/5.6.

Biggest risk is 5.3 — SQLite datetime/enum/cascade differences hiding behind
92 migrations' worth of assumptions. Fallback if SQLite fights back:
Postgres-via-Homebrew (still 100% local, still no Docker, still one command).
Same experience on the Mac, less surgery underneath. The call gets made out
loud at the first sign instead of burning days silently.

## 7. Open discussion points (decide before executing)

1. SQLite-vs-Postgres fallback line: is Homebrew-Postgres acceptable as a
   fallback, or is SQLite a hard requirement?
2. Model-subscription OAuth (Claude/ChatGPT connect flows) stays — confirm.
3. `bun mac` name and the single first-run question (E2B key vs Docker) — confirm.
4. Anything in section 2 (non-goals) you want pulled into scope.
