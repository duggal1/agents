# HELP REQUEST: "The server page did not become ready" — Sapphire macOS app

## 0. What we are building

An **Electron macOS app** (`Sapphire.app`, `dev.rakazo.desktop`). One product: the
macOS UI is the `apps/web` renderer hosted **inside** Electron — never a browser tab.
The app boots its **own loopback backend** (API + worker + SQLite file, no Docker, no
cloud, no external server) and opens the window against it. Bun only. SQLite stays.

## 1. Architecture (verified in code)

```
Sapphire.app (Electron 44)
  main.ts ──▶ LocalBackend.start() ──▶ window opens at backend URL
  macOS UI (apps/web bundle, served from app resources via protocol overlay)
      │  POST {origin}/rpc/*  +  GET /api/auth/*   (same origin)
      ▼
  api service (Hono + oRPC, runtime/services/api/index.js)
  worker service (job consumer, runtime/services/worker/index.js)
      │  both read the same SQLite file
      ▼
  packages/db (Prisma 8.1.0-dev.9, better-sqlite3 13.0.3, provider = sqlite)
```

Boot order is **serial** (`apps/desktop/src/local-runtime.ts:588-606`):
`starting-database` (prisma migrate deploy) → `starting-api` (waits for log
`api listening`) → `starting-worker` (waits for `worker ready`) → `ready`.
Each service gets a 120s startup timeout (`local-backend.ts:157`); 3 restarts max.

First launch writes `~/Library/Application Support/Sapphire/setup.json`
`{mode:"new", serverUrl:"http://127.0.0.1:<port>"}`. Default port 45173
(`setup-config.ts:6`); a fresh port is allocated when taken (`local-backend.ts:548-565`).

## 2. Relevant files (repo root `/Users/harshitduggal/agents/Sapphire`)

- `apps/desktop/src/main.ts` — startup, window open, readiness gate
  - `openLocalByDefault` (~line 909): boots backend, opens window **only when ready**
    (ordering fix already applied in working tree, uncommitted — see §7)
  - `waitForMountedAppDocument` (~line 457): 8s gate, throws the exact error dialog
  - `installBundledRenderer` (~line 507): serves `resources/web/*` over the origin
- `apps/desktop/src/local-backend.ts` — backend boot, migrate, manifests, ports
- `apps/desktop/src/local-runtime.ts` — serial boot controller, readiness patterns
- `apps/web/src/App.tsx` — `SessionUnavailable` retry screen; local-owner bootstrap flow
- `apps/web/src/lib/session-gate.ts` — `loading | unreachable | authenticated | anonymous`
- `apps/api/src/app.ts:525-536` — local-mode auth: `/api/auth/get-session` → **401**
  (any other non-401 error parks the UI on the retry screen forever)
- `apps/api/src/env.ts:123` — `DATABASE_URL` defaults to `file:<DATA_DIR>/sapphire.db`

## 3. Symptom history

1. Window opened **before** the backend existed → `Reconnecting / Can't reach the server`
   retry screen forever (stale-port race contributed: backend moved to a fresh port
   while the window pointed at the old one — orphans from dead apps hold ports).
2. After the open-after-ready ordering fix → native dialog:
   **"The server page did not become ready."** The document loads but the renderer
   never fires ready marks within 8s.

## 4. Evidence: PROVEN (do not re-investigate)

- `prisma migrate deploy`: 1.6s fresh DB, 0.6s warm. Migration is NOT the bottleneck.
- Packaged `services/api/index.js` boots under the Electron binary and prints
  `api listening`; `/rpc/health` answers `{"ok":true}`.
- `better-sqlite3` prebuild loads under Electron (modules=149). ABI hypothesis dead.
- Session contract holds: `/api/auth/get-session` → 401 → gate `anonymous` →
  `/rpc/bootstrap` → 200 full bootstrap (`local-owner`). (Note: `/api/auth/session`
  404s — the client never calls it; do not "fix" that.)
- Real packaged launch: backend health OK ~6s after launch start.
- Real-launch renderer console: only Lingui "Uncompiled message" INFO noise plus
  `app-update.yml` ENOENT (unsigned dir build, harmless).

## 5. Evidence: NOT proven (this is where help is needed)

- Whether the window ever renders app content — screenshots captured the user's
  terminal, never the Sapphire window. Unknown if the failure is:
  - **H1**: renderer stuck pre-ready (session fetch never settles through the
    protocol overlay, or Shell render crash — **other agents have uncommitted
    web edits in the tree right now**, e.g. `apps/web/src/App.tsx`);
  - **H2**: readiness gate too strict for the local path (8s + required marks);
  - **H3**: real user-data migrate slower than scratch-dir measurements.
- Rank by falsifiability: H1 first — one `ELECTRON_ENABLE_LOGGING=1` launch with a
  screenshot of the actual window separates "blank/crashed renderer" from
  "loading-but-slow".

## 6. The ask

Design the best legitimate, modern, simple fix so this class of failure **never
shows to the user**: the window must only ever appear usable; any backend failure
must surface the real cause (native dialog with the backend's actual error, not a
generic timeout). Keep: bun-only scripts, SQLite, provider-neutral adapters,
offline deterministic tests. Suggested directions (verify, don't assume): surface
backend `phase/message/output` tail in the failure dialog; fail services fast
instead of 120s hangs; kill/reap orphan backends holding the saved port;
regression test that fails before and passes after.

## 7. Constraints (hard)

- **Do not sweep other agents' uncommitted work.** The tree has in-flight edits
  (SQLite migration, web UI). My `main.ts` ordering hunks are staged mixed with
  theirs — left uncommitted on purpose. Touch only what the fix needs.
- Forbidden without explicit permission: `git restore`, `git reset`, `git push --force`
  (and equivalents that discard work). Never commit secrets.
- Say "macOS UI", never "web app". No folder renames.
- Prove with the real thing: clean `pack:dir` build → launch real `.app` →
  screenshot the actual window → health + logs clean → relaunch and repeat.
  Report only with the status vocabulary: Verified working / Fix applied, not
  verified / Partially verified / Not fixed / Blocked. Never "fixed" without
  watching it work.

## 8. Repro commands

```sh
cd /Users/harshitduggal/agents/Sapphire/apps/desktop
bun run pack:dir                                   # build, no launch
ELECTRON_ENABLE_LOGGING=1 ./out/mac-arm64/Sapphire.app/Contents/MacOS/Sapphire
# backend health (port from setup.json):
curl -s -m 5 -X POST "http://127.0.0.1:<port>/rpc/health" \
  -H 'content-type: application/json' -d '{"json":{}}'
# clean slate (backup setup.json first) + kill orphans:
pkill -f "Sapphire.app"; pkill -f "services/api/index.js"; pkill -f "services/worker/index.js"
```

PASS = window opens showing the app (no retry screen, no dialog), health OK,
renderer console has zero errors, repeat after relaunch.
