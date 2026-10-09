# Plan: Validate the native `pack:run` chain end to end

## 1. Problem
`bun --filter @sapphire/desktop run pack:run` fails with `Script "run" not
found` — wrong runner syntax was documented (pnpm-style `run` keyword does
not exist in bun; the blessed runner here is `bun@1.4.2`). Separately,
`pack:run` was fixed to include `runtime:build`, but no one has ever executed
the full provision → runtime → package → launch chain on a real Mac, so the
"just works" claim is unverified.

## 2. Goal
Prove on this machine that a clean tree goes from provisioned Postgres to a
launchable `Sapphire.app` with zero manual staging, and leave the user with
one correct command.

## 3. Scope
- In: `provision-postgres.mjs --universal` output, `runtime:build` (services,
  supervisor, computer context, manifest, layout verify), `pack:dir`
  (electron-builder `--dir`, no installer, does not open anything),
  packaging unit tests, desktop typecheck.
- Out: opening the app (`pack:run`'s trailing `open` — the user's step, it
  steals focus), signed/notarized `.dmg` (release CI only), live E2B/Docker
  acceptance (opt-in workflow).

## 4. Steps
1. Confirm `runtime/postgres-deps/{arm64,x64}/bin/postgres` exist with
   matching `.provision.json` (idempotent re-run must print "already
   provisioned").
2. `bun --filter @sapphire/desktop runtime:build` — must exit 0 and write
   `runtime/runtime-manifest.json` with `postgresArches ["arm64","x64"]`.
3. `bun --filter @sapphire/desktop check` + packaging/budget test files —
   must stay green.
4. `bun --filter @sapphire/desktop pack:dir` — must produce
   `apps/desktop/out/mac-arm64/Sapphire.app` containing
   `Contents/Resources/runtime/` (services, both PG arch dirs, manifest).
5. Hand the user the single launch command (`pack:run`, correct bun syntax).

## 5. Failure policy
- Any step failing closed with an actionable message is the system working;
  fix the cause, never bypass the check.
- Do not weaken tests, skip `runtime:build`, or hand-stage binaries to force
  green. If the chain cannot pass on this machine, stop and report the exact
  blocker with the log tail.

## 6. Exit condition
`pack:dir` artifact verified on disk + user holds one copy-paste command that
reproduces it and opens the app. Each fix commits separately to `main`
(`add` → `commit` → `pull --rebase` → `push`); never touch another agent's
in-flight files.
