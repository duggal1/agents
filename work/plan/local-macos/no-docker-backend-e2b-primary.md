# Plan: Native macOS Backend with E2B-First Bot Computers

**Status:** Proposed; no implementation changes made. Execution requires a separate user instruction.

## 1. Objective

Remove Docker as a prerequisite for running Sapphire on macOS. When a user chooses **This computer**, the Electron app must run Sapphire's API, worker, and PostgreSQL directly as managed native processes. The app must not install, start, or depend on Docker to run those backend services.

Bot computers are a separate concern. E2B is the primary provider for bot computers. Docker is an optional, local fallback for bot computers only, and is used only when a user has enabled fallback and Docker is available. The app must never silently move a bot from E2B to the macOS host itself.

The existing **Existing instance** path remains the way to connect the desktop app to a separately hosted Sapphire server. This plan does not change server deployment or require a hosted service for local mode.

For a fresh install and steady-state use, Docker is never required by the backend. Existing local installations are a special migration case: their PostgreSQL data currently lives in Docker-managed volumes, so Docker may be needed once to export that data. If the existing Docker daemon is unavailable, the app must preserve the old data and provide a recoverable migration path; it must not claim the legacy profile migrated or delete its old volume.

## 2. Decisions and boundaries

These decisions are fixed for this plan so implementation does not need to guess:

1. **Local backend:** Run API and worker as supervised Node.js child processes managed by Electron. Do not use Docker Compose, a Docker daemon, or an external local server installer in the packaged macOS path.
2. **Database:** Keep PostgreSQL 16, matching the current published local stack. Run a pinned, app-managed native PostgreSQL 16 distribution under the app's data directory. Do not switch the local mode to SQLite or change Prisma's PostgreSQL schema.
3. **Jobs and realtime:** Keep Graphile Worker and PostgreSQL LISTEN/NOTIFY in local mode. Do not replace them with in-memory implementations.
4. **Computer provider:** E2B is primary. The first-run E2B key field is optional so the app can open without a key; with no key, computer tasks stay unavailable unless the user has explicitly enabled Docker fallback and a Docker daemon is available. Use the existing Docker sandbox adapter only as that fallback. Never use the `desktop` provider as an implicit fallback; that provider runs commands on the host.
5. **Credential boundary:** The E2B API key is entered and stored by the desktop main process, encrypted with the operating system's secure storage, and passed only to the local API and worker processes. It is never placed in renderer storage, URLs, logs, or public IPC responses.
6. **Existing user data:** Preserve local PostgreSQL data, auth sessions, bot state, artifacts, and app settings when upgrading from the existing Docker-managed local stack. Do not delete old Docker volumes as part of migration.
7. **Scope:** Change the packaged macOS desktop **This computer** path. Preserve the current universal macOS release target (Apple Silicon and Intel) and current Electron-supported minimum macOS version; T1 must read and pin the actual minimum in release configuration before selecting PostgreSQL binaries. Keep the web app, mobile app, remote-server connection path, self-hosted server Compose deployment, and Docker sandbox adapter available.
8. **No unrelated product redesign:** Keep current authentication, tenant/Space behavior, UI framework, agent runtime, package manager, and provider-neutral sandbox contracts unless a specific compatibility change is required by this plan.

The memory ceilings below are **proposed product targets**, not measured current baselines. Validate them on a representative macOS build during T1–T3 and lock them before T4. If the prototype misses either target, stop and report the measurements for user review; do not quietly raise the ceiling.

## 3. Explicit non-goals

- Removing Docker Compose from self-hosted Linux/server deployment instructions or infrastructure.
- Removing Docker as an optional bot-computer fallback or from CI, computer images, test harnesses, or developer workflows.
- Running bots directly on the user's Mac as a fallback.
- Replacing PostgreSQL with SQLite, changing the 92-migration history, or redesigning job delivery and realtime.
- Removing sign-in, Better Auth, multi-user support, Space tenancy, model connections, or existing integrations.
- Replacing Pi or adding a new agent runtime.
- Rewriting the React interface in SwiftUI or replacing Electron.
- Claiming a memory improvement without measuring the native process footprint against the current packaged stack.

## 4. Current behavior verified in the repository

- The desktop app's `LocalStackController` downloads and starts `docker-compose.images.yml`; it probes the managed web origin and stops the Compose stack when the user changes away from the local setup.
- That Compose file runs PostgreSQL, API, worker, web, and the Docker sandbox supervisor. Its default `SANDBOX_PROVIDER` is `docker`.
- The API and worker already have separate Node entry points and can run as processes. Their production configuration requires a PostgreSQL connection.
- The API and worker use Graphile Worker for durable jobs. The worker also uses PostgreSQL realtime fanout. Existing database code uses PostgreSQL advisory locks.
- An E2B sandbox adapter, SDK dependency, and provider factory already exist. `resolveSandboxProvider` chooses E2B when the E2B key is present and no provider is explicitly configured; an explicit E2B selection without a key currently falls back to Docker.
- The current E2B/Docker selection is one provider choice at service startup. It is not runtime credit-exhaustion failover and does not provide per-computer provider routing by itself.
- The Docker sandbox adapter talks to the sandbox supervisor. In the Compose topology, that supervisor has access to the Docker socket, which is effectively host-level control. Removing Compose therefore also requires an explicit secure lifecycle for the optional supervisor; it cannot be omitted from the fallback design.
- The current Electron renderer bundle is served through a protocol handler only for the managed local Compose stack. The UI sends RPC requests to its own origin, so the native local mode must preserve the same-origin `/rpc` and `/api` behavior.
- Existing local Compose data lives in Docker-managed volumes. A new native PostgreSQL data directory cannot simply be substituted for those volumes; an explicit export/import migration is required.

Primary code locations:

- Desktop lifecycle and setup: `apps/desktop/src/main.ts`, `apps/desktop/src/local-stack.ts`, `apps/desktop/src/setup-config.ts`, `apps/desktop/src/setup.js`, `apps/desktop/src/setup.html`, `apps/desktop/src/setup-preload.cjs`.
- Desktop packaging: `apps/desktop/package.json`, `apps/desktop/scripts/copy-static.mjs`.
- API/worker entry points and runtime configuration: `apps/api/src/index.ts`, `apps/api/src/app.ts`, `apps/api/src/env.ts`, `apps/worker/src/index.ts`.
- Database and provider composition: `packages/db/prisma/schema.prisma`, `packages/db/src/`, `packages/adapters/src/sandbox-provider-env.ts`, `packages/adapters/src/sandbox-factory.ts`, `packages/adapters/src/e2b-sandbox.ts`, `packages/adapters/src/docker-sandbox.ts`.
- Current local Compose topology: `infra/compose/docker-compose.images.yml`, `infra/compose/.env.images.example`.
- Desktop tests and release workflow: `apps/desktop/src/*.test.ts`, `apps/desktop/e2e/setup.spec.ts`, `.github/workflows/desktop-macos-screenshot.yml`, `.github/workflows/release-desktop.yml`.

## 5. Target architecture

```text
Sapphire desktop app (Electron)
  ├─ packaged web renderer
  ├─ local runtime supervisor (Electron main process)
  │    ├─ PostgreSQL 16 native process
  │    ├─ Sapphire API Node process ────────┐
  │    └─ Sapphire worker Node process ─────┤ loopback only
  │                                       │
  └─ renderer /rpc and /api ──────────────┘

Sapphire API + worker
  └─ sandbox provider routing
       ├─ E2B remote computer: primary
       └─ Docker computer: opt-in fallback only
            └─ existing sandbox supervisor, launched separately from Compose
```

The renderer keeps a same-origin contract: the desktop app serves packaged web assets and forwards `/rpc` and `/api` requests to the API on loopback. API, worker, and PostgreSQL bind to loopback or a private local socket only; none are exposed to the LAN. The API and worker receive the same generated database URL, data directory, encryption material, and sandbox configuration, with only the environment each process needs.

### Startup and shutdown order

1. Electron reads the saved local/existing-server setup and starts local mode only when the selected mode is **This computer**.
2. The main process validates or creates the private app data directory and loads encrypted credentials.
3. If the per-install fallback setting is enabled, the main process checks Docker availability and starts the existing sandbox supervisor as a separate, authenticated, loopback-only process. Failure to start it does not block E2B or backend startup.
4. The main process starts the bundled PostgreSQL 16 process with a private data directory, loopback-only networking, and desktop resource limits.
5. The runtime supervisor waits for PostgreSQL readiness, runs the existing Prisma deploy migrations once, and verifies the expected schema version.
6. The supervisor starts the API and worker with `DATABASE_URL` pointing at the managed PostgreSQL endpoint. It waits for the API health check and worker-ready signal before displaying the main window.
7. The main process serves packaged renderer assets and routes same-origin `/rpc` and `/api` traffic to the local API.
8. On normal quit, stop accepting new work, request graceful API/worker shutdown, and wait for a bounded grace period. Stop active Docker computer containers without deleting their data, then stop the sandbox supervisor; stop PostgreSQL last. Forced termination must leave PostgreSQL able to recover on the next start.

### Provider selection and fallback

- E2B is selected as the primary provider when its credential is configured.
- Docker fallback is one explicit, per-install setting named **Allow Docker computer fallback**, disabled by default. It is usable only when the Docker daemon and computer image requirements are present. Missing Docker never blocks app startup or E2B use. No other UI or service silently enables it.
- Fallback triggers only on a classified, permanent E2B account/quota/credit failure. Timeouts, DNS errors, rate limits, and transient provider outages do not trigger an automatic replay.
- A provider change is persisted per computer, not just as a mutable process-wide environment value. Existing computers continue to route to the provider that owns them until a deliberate migration occurs.
- When E2B fails before a computer has been created, provision it in Docker and continue. For an existing E2B computer, keep a bounded local snapshot of portable workspace files after each completed task/checkpoint. If E2B remains reachable, refresh the snapshot before switching. If it is not reachable, restore the latest completed snapshot into Docker, mark any in-flight task interrupted, and require a fresh agent turn; never replay an in-flight tool call. Browser login state and provider-specific desktop state are not included in snapshots and must be reported as unavailable after fallback.
- If Docker is not available or fallback is disabled, keep the app and backend running, mark computer work unavailable, and explain that E2B needs credits or a valid account. Do not silently run commands on the Mac host.

## 6. Work plan

Tasks are ordered by dependency. Each task is a separately reviewable implementation unit. Do not start code work until the user explicitly authorizes execution.

| ID | Task | Depends on | Main files | Exit condition |
|---|---|---|---|---|
| T1 | Define macOS native runtime and packaging contract | — | `apps/desktop/src/local-runtime.ts` (new), `apps/desktop/src/local-runtime.test.ts` (new), `apps/desktop/package.json`, desktop build scripts | Packaged API/worker entry points and PostgreSQL runtime launch on supported Mac architectures without requiring Docker. |
| T2 | Add app-managed native PostgreSQL 16 | T1 | `apps/desktop/src/local-postgres.ts` (new), `apps/desktop/src/local-postgres.test.ts` (new), `apps/desktop/package.json`, desktop resource build scripts | PostgreSQL initializes, becomes healthy, migrates, restarts, and shuts down under app supervision. |
| T3 | Package and supervise native API/worker processes | T1, T2 | `apps/desktop/src/local-runtime.ts`, new desktop runtime build script, `apps/api/src/index.ts`, `apps/worker/src/index.ts`, release workflow | Packaged API and worker pass health/readiness checks; the complete native stack meets the stated RSS budget before desktop UI cutover begins. |
| T4 | Wire native local mode into Electron and remove Compose from Mac setup | T2, T3 | `apps/desktop/src/main.ts`, `apps/desktop/src/setup-config.ts`, `apps/desktop/src/setup.html`, `apps/desktop/src/setup.js`, `apps/desktop/src/setup-preload.cjs`, renderer asset handling, `apps/desktop/e2e/setup.spec.ts` | **This computer** starts native services and no longer checks for or invokes Docker. Existing instance mode still works. |
| T5 | Make E2B primary and store its credential safely | T1, T3, T4 | `packages/adapters/src/sandbox-provider-env.ts`, `packages/adapters/src/sandbox-factory.ts`, `apps/api/src/env.ts`, `apps/worker/src/index.ts`, `apps/desktop/src/local-runtime-settings.ts` (new), `apps/desktop/src/main.ts`, `apps/desktop/src/preload.cjs`, `apps/desktop/src/setup-preload.cjs`, `apps/desktop/src/setup.html`, `apps/web/src/pages/LocalSettings.tsx`, related tests | Fresh local mode selects E2B when configured; key is encrypted at rest and absent from renderer storage/logs. |
| T6 | Package and supervise the optional Docker sandbox supervisor | T4, T5 | `apps/desktop/src/local-docker-supervisor.ts` (new), `infra/sandboxes/supervisor/src/index.ts`, `infra/sandboxes/supervisor/package.json`, supervisor tests, desktop package build | Supervisor starts only when fallback is enabled, binds loopback, authenticates every request, and is stopped by Electron; no Compose service is required. |
| T7 | Add E2B quota fallback and portable workspace snapshots | T5, T6 | `packages/adapter-kit/src/interfaces.ts`, `packages/adapters/src/computer-lifecycle.ts`, `packages/adapters/src/computer-control.ts`, `packages/adapters/src/sandbox-factory.ts`, relevant computer/provider tests | Quota fallback routes safely to Docker when enabled, restores only completed portable state, and never replays uncertain commands. |
| T8 | Migrate existing local Compose data to native PostgreSQL | T2, T3, T4 | `apps/desktop/src/local-data-migration.ts` (new), migration tests, desktop setup and release notes | Existing local installs retain DB data; migration is verified before old services are stopped or data is removed. Docker may be needed once to export the old Docker-managed volume. |
| T9 | Complete macOS packaging, resource verification, and rollout | T1–T8 | `apps/desktop/package.json`, desktop scripts, `.github/workflows/release-desktop.yml`, desktop unit/e2e tests, `docs/desktop-release.md`, `docs/self-host.md` | Signed release works on Apple Silicon and Intel Macs with Docker absent; no Compose assets are needed by the packaged local mode. Resource budgets pass. |

### T1 — Native runtime and packaging contract

1. Confirm the shipped macOS targets (universal Apple Silicon and Intel) against the release workflow and determine the current minimum macOS version supported by the Electron artifact. Pin both facts in release configuration before choosing native binaries.
2. Produce a minimal packaged smoke artifact that starts one local Node service through Electron's supported child-process mechanism and reports startup, exit, stderr, and stop events to the main process.
3. Define the runtime manifest: binary/entrypoint paths, version, readiness endpoint or message, process environment allowlist, restart policy, and shutdown timeout.
4. Keep process ownership in Electron main. The renderer may request status/start/stop through typed preload IPC but must not choose executable paths, ports, or environment variables.
5. Ensure API/worker code and production dependencies are packaged deterministically. Include generated Prisma client and platform-specific Prisma query engine assets. Do not rely on source-tree paths, developer `node_modules`, `tsx`, or an installed pnpm/Bun runtime in a release build.
6. Verify all shipped executables are signed/notarized within the existing macOS release flow.

### T2 — Native PostgreSQL 16 lifecycle

1. Package a pinned PostgreSQL 16 distribution for each supported macOS architecture. Build or fetch it from a trusted, version-pinned source in CI; verify checksums and sign binaries. Build artifacts against the pinned minimum macOS version. Do not ask users to install Homebrew or Docker.
2. Store the database cluster under Electron's application support directory with owner-only filesystem permissions. Store logs separately with bounded rotation.
3. Bind PostgreSQL only to loopback or a private socket. Generate the database role/password locally and keep credentials out of renderer-visible settings.
4. Start PostgreSQL with a desktop profile: conservative memory, connection, worker, and WAL limits; allow advanced performance tuning only through reviewed configuration, not user-edited arbitrary flags.
5. Implement readiness via `pg_isready` or a bounded authenticated query. Do not launch API/worker until the database accepts connections.
6. Use the current Prisma `migrate deploy` flow on every app version upgrade. Refuse to start the new services if migrations fail; preserve the data directory and show a repairable error.
7. Handle port collision without exposing the database. Prefer a private socket; otherwise allocate a loopback port, persist it privately, and pass the exact URL to both services.
8. Test cold initialization, warm startup, crash recovery, disk-full behavior, migration failure, clean shutdown, and upgrade from one supported PostgreSQL 16 minor release to the next.

### T3 — Native API and worker supervision

1. Build production API and worker entry points plus their full runtime dependency graphs into app resources. Resolve workspace package imports at build time; include Prisma-generated files and native dependencies for each supported architecture.
2. Reuse `apps/api/src/index.ts` and `apps/worker/src/index.ts` shutdown behavior. Keep API and worker as separate processes so request serving and job execution can fail and restart independently.
3. Use a typed local process supervisor with explicit states: `stopped`, `starting-database`, `migrating`, `starting-api`, `starting-worker`, `ready`, `degraded`, `stopping`, and `failed`.
4. Start API on loopback only. Start worker after database/migrations are ready. Set conservative DB pool sizes suitable for one local user while preserving current Graphile and reconciliation behavior.
5. Capture bounded, redacted logs from child processes. Never log database passwords, E2B credentials, auth secrets, or encryption keys.
6. Restart only on unexpected process exit, with bounded backoff and a visible degraded state. Do not create infinite restart loops.
7. On app quit or update, stop API/worker first, then database. Preserve process handles and cleanup state after partial startup failures.
8. Before proceeding to T4, measure the packaged native PostgreSQL + API + worker + renderer footprint under the T9-defined idle and active workloads. The complete stack must meet both RSS budgets; otherwise tune it or stop and return the measured blocker.

### T4 — Electron local setup without Docker

1. Replace the current `LocalStackController` path for packaged macOS **This computer** with the native runtime supervisor. Keep remote **Existing instance** setup unchanged.
2. Remove Docker detection, Docker installation links, Compose image pulls, and Compose progress states from the macOS local setup UI.
3. Change setup status to describe app services in ordinary language (starting local database, preparing app, ready). Do not present Docker details or Compose logs to end users.
4. Preserve the renderer's same-origin `/rpc` and `/api` behavior. Serve packaged renderer files locally and route API paths to the loopback API with strict method/path allowlists.
5. Preserve origin/session behavior where possible so existing desktop authentication and localStorage selections survive an in-place update.
6. Keep API, worker, and PostgreSQL inaccessible to LAN clients. Add tests that reject non-loopback bind targets and arbitrary renderer-to-process commands.
7. Update setup E2E expectations and add the missing web screen test if the local setup state is rendered in web content. CI must provide any screenshot link for the UI change.

### T5 — E2B-first configuration and secret handling

1. Make local runtime provider policy explicit: E2B primary, Docker fallback disabled by default, and `none` when neither is configured. Remove the current implicit Docker default for packaged local mode.
2. Add a concise optional E2B key field to the **This computer** first-run setup, with a **Skip for now** action; let the user enter or replace the key later in local settings. With no key, complete startup and leave computers unavailable unless Docker fallback is later enabled. **Existing instance** setup must not ask for a local E2B key.
3. Add one **Allow Docker computer fallback** toggle in local settings. It is global to this local installation and disabled by default. Persist it in a versioned Electron-owned `LocalRuntimeSettings` file under the app data directory; expose only the boolean to the renderer through typed IPC. At process startup, the main process gives API/worker the path to a private runtime-policy file through one generic `RAKAZO_LOCAL_RUNTIME_SETTINGS_PATH`; both processes read the same schema. Do not duplicate this flag in `DeploymentSettings` or provider-specific environment variables. A key or policy change requests a controlled backend restart at the next safe task boundary. Do not show Docker installation instructions unless the user turns on fallback.
4. Encrypt the key with Electron OS secure storage before writing it. Fail closed if secure storage is unavailable; do not fall back to plaintext storage.
5. Pass the decrypted key only to API/worker process environments at launch. Avoid saving it in `setup.json`, renderer localStorage, URL query parameters, logs, crash reports, or generic telemetry.
6. Do not add a second independent sandbox provider implementation. Reuse `SandboxProvider`, the E2B adapter, and the existing provider-neutral computer contracts.
7. Add `apps/desktop/src/local-runtime-settings.ts` and its tests. Wire the key and fallback toggle through `apps/desktop/src/main.ts`, `apps/desktop/src/preload.cjs`, `apps/desktop/src/setup-preload.cjs`, and `apps/web/src/pages/LocalSettings.tsx`. Keep all secret reads/writes in the main process; typed IPC returns only `hasE2BKey` and `allowDockerComputerFallback` booleans.
8. Test first launch with no key, valid key, corrupt secure-store data, key rotation, process restart, fallback-setting persistence, and ensuring the renderer never receives the key.

### T6 — Optional native Docker sandbox supervisor

1. Reuse the existing `infra/sandboxes/supervisor` implementation and Docker sandbox contract; do not add a second container-control implementation.
2. Package its production entry point and runtime dependencies alongside the API/worker. Do not start it on normal E2B-only launches.
3. When the user enables fallback and the Docker daemon is available, Electron starts the supervisor as a separate child process with a generated private token, loopback-only bind, selected Docker socket, bounded logs, and computer image path. Set `SANDBOX_CONTROL_VIA_LOOPBACK=true` where required for Docker Desktop on macOS.
4. Include the exact `infra/sandboxes/computer` build-context files required by `ensureComputerImage` in signed app resources. Build the computer image lazily on the first Docker fallback, never during normal install or E2B startup. Do not bundle a Docker image tar into the installer.
5. Treat access to the Docker socket as host-level authority. Keep the supervisor process isolated from the renderer; expose only its existing authenticated API to the local API process. Do not add renderer IPC for arbitrary supervisor requests.
6. Health-check before enabling fallback. If startup fails, disable fallback and report the reason without affecting E2B or the main backend.
7. On app shutdown, stop API/worker before stopping the supervisor. Stop active Docker computer containers without deleting their data, then stop the supervisor; do not delete Docker volumes or user data.
8. Test loopback binding, token rejection, Docker Desktop socket resolution, missing daemon, supervisor crash, lazy image build, and clean process shutdown with a fake Docker client. Live Docker acceptance runs only in an isolated CI job, not on a maintainer's Mac.

### T7 — Safe Docker fallback for bot computers only

1. Read the single global fallback setting from local deployment settings. E2B remains primary; the Docker sandbox supervisor is started only when fallback is enabled and a usable daemon/supervisor is detected.
2. Classify provider failures into permanent account/quota/credit, authentication/configuration, transient network/rate limit, and unknown. Only permanent exhausted-credit/quota failures are eligible for automatic fallback.
3. Persist `providerKind` and provider reference for each computer. Route execute, screen, files, stop, restart, and recovery operations using that persisted provider identity instead of assuming the process-wide default.
4. Add an execution fence around provider transition. A failed E2B call must not be retried automatically in Docker unless the executor can prove the operation was not accepted by E2B.
5. Add a provider-neutral local workspace snapshot store under the app data directory. Snapshot only after completed tasks/checkpoints; bound file count, total bytes, per-file bytes, and elapsed time; reject symlinks/path traversal and preserve file modes only when safely supported.
6. On a classified quota failure for an existing E2B computer, fence its active execution. If provider access remains available, refresh the snapshot; otherwise restore the last completed snapshot. Mark the interrupted task interrupted and do not automatically retry its command.
7. Mark browser session/profile state as non-portable. Surface one concise notice when Docker fallback starts with a clean browser profile.
8. If Docker is missing or fallback is disabled, keep the backend healthy and expose a recoverable computer-unavailable status with the E2B account/credit reason. Never fall back to host execution.
9. Test new-computer fallback separately from existing-computer snapshot restore. Use deterministic provider fakes and offline conformance tests. Add one opt-in live E2B acceptance path; do not run billed-provider acceptance tests in routine CI.

### T8 — Existing local-data migration

1. Detect the current Compose-backed setup before starting native PostgreSQL. Keep the old stack, volumes, stack token, and setup metadata untouched until migration completes.
2. Tell existing users plainly that the first data migration may need the old Docker daemon once because the old database is inside a Docker-managed volume. This is a one-time migration requirement, not a steady-state backend dependency.
3. With the existing local stack healthy, export the PostgreSQL 16 database using a checked, bounded process. If Docker or the old database is unavailable, stop before modifying either database, leave the old volume untouched, and give the user a retry/recovery path: restore Docker availability and retry export, or continue with a clearly identified new empty local profile while preserving the old profile for later import. Never silently overwrite or discard the old profile.
4. Initialize native PostgreSQL in a new staging data directory, restore the export, and apply only required migrations. Do not point two PostgreSQL instances at the same data directory.
5. Verify database identity/schema version, table and row counts for critical entities (users, spaces, bots, messages, computers, jobs, and credentials), and representative read queries before cutover.
6. Start native API/worker against the staged database and run health checks. Only after success atomically switch the saved setup to native mode.
7. Retain the old Docker volumes and export backup through at least one successful launch and an explicit rollback window. Never run `docker compose down -v` as part of migration.
8. Document the recovery behavior when migration is interrupted, disk space is low, credentials are invalid, or the user has removed Docker before upgrading.
9. Test migration with a fixture copied from the current Compose schema and test interruption at every cutover boundary. Verify retries are idempotent.

### T9 — macOS release and performance acceptance

1. Update Electron packaging to include native PostgreSQL and API/worker runtime resources and to exclude the Compose stack assets from the macOS local-mode installer.
2. Extend CI to build and inspect both Apple Silicon and Intel artifacts. Verify signatures/notarization include every native binary.
3. Run unit tests for process lifecycle, database lifecycle, provider policy, and migration. Run desktop UI E2E only in the repository's CI virtual-display job; do not run the focus-stealing Electron suite routinely on a maintainer Mac.
4. Run a clean-install acceptance test on a Mac with Docker absent: install, configure E2B, launch, create an agent, provision an E2B computer, run a command, restart the app, and verify local data persists.
5. Run an upgrade acceptance test with a populated old Docker-backed profile and verify the data migration, rollback path, and retained Docker volume.
6. Measure idle and active RSS/CPU for Electron, API, worker, and PostgreSQL separately. Compare against the current packaged Compose flow using the same workload and report total plus per-process numbers. With E2B primary and local model inference disabled, the proposed total Sapphire process RSS targets are at or below **1.5 GiB after five minutes idle** and the **95th-percentile total RSS at or below 2.5 GiB** during one active chat turn plus one E2B computer session. Include every Sapphire child process; Docker Desktop VM memory is absent from the target path. Validate and lock both targets before T4; if either fails, stop and return the measured blocker rather than raising the budget.
7. Update setup docs and release notes to state that Docker is not needed for the local backend; it is required only if the user opts into Docker computer fallback or uses a Docker-based server deployment.

## 7. Contracts and safety invariants

- **Loopback only:** API, PostgreSQL, and any local renderer service bind to loopback/private socket. The app does not expose a local backend to the network.
- **Separate authority:** Renderer intent travels through existing typed RPC/IPC contracts. Renderer code never receives process handles, filesystem paths, PostgreSQL credentials, E2B keys, or arbitrary process-launch capability.
- **Least privilege:** PostgreSQL and API/worker processes run as the current desktop user, not as root/admin. Docker fallback remains behind the existing sandbox supervisor; it does not mount the user's home directory. The supervisor's Docker socket access is enabled only by the explicit fallback setting and is treated as host-level authority.
- **Secret handling:** Generated auth/encryption/database secrets are owner-only and protected at rest. E2B key is OS-encrypted and only decrypted in the main process for service startup.
- **Single database writer model:** Only the managed PostgreSQL process owns its cluster. No second app version or external PG process may open the same data directory.
- **Durable queue semantics:** Keep Graphile's durable PostgreSQL jobs for local mode. Do not switch to an in-memory queue for convenience.
- **Provider identity:** Each computer's provider identity is durable and used for all subsequent operations. Changing the primary provider affects newly created computers unless an explicit migration is committed.
- **Safe fallback:** One global per-install fallback toggle is disabled by default. Never replay an operation whose provider acceptance is unknown; do not switch to the Mac host; restore only completed portable workspace snapshots or explain why fallback is unavailable.
- **Migration safety:** Old Docker data is not deleted automatically. Any failure before verified cutover leaves the old stack usable and its data intact.

## 8. Verification strategy

### Automated, offline by default

- Desktop runtime supervisor unit tests: ordered startup, readiness timeout, early process exit, bounded restart, graceful stop, and partial-start cleanup.
- PostgreSQL controller tests with a fake executable: initdb, permissions, loopback configuration, readiness, migration failure, clean stop, crash restart, version mismatch, and disk failure.
- Packaging checks: API/worker entry points, Prisma engines, PostgreSQL binaries, and renderer files exist in the built app for each Mac architecture; no source-tree dependency is required.
- E2B key tests: encrypted persistence, secure-store failure, no renderer exposure, and process environment filtering.
- Provider tests: E2B primary; only classified quota exhaustion triggers Docker; transient failures do not; no Docker means a healthy app with computer-unavailable state; provider identity routes all later operations correctly.
- Workspace migration tests: path traversal, symlink rejection, byte/count limits, clean browser profile behavior, execution fence, and no duplicate command submission.
- Legacy data migration tests use generated fixture exports and injected failures. No live user database is used in CI.
- Existing API, adapter, database, and desktop suites remain green. Do not weaken existing tests to fit the new local runtime.

### Manual release gates

- Docker absent on a clean Mac: local app launches and E2B bot computer works.
- Docker installed but fallback disabled: E2B still primary; Docker is not touched.
- E2B quota exhausted with Docker fallback enabled: eligible computer transitions safely and restores the last completed portable workspace snapshot; any in-flight task is marked interrupted and is not replayed.
- E2B transient outage: no Docker transition and no command replay.
- No E2B credits/key and no Docker fallback: app opens; bot computer reports unavailable; backend data and UI remain usable.
- Existing server setup: continues to connect without starting local PostgreSQL or local API/worker.
- Existing Compose-backed local installation: data export/import succeeds or aborts without deleting old data.
- Sleep/wake, app auto-update, abrupt process termination, and reboot: PostgreSQL recovers and backend supervision returns to ready without Docker.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Packaging PostgreSQL and the API/worker dependency graphs increases installer size and signing complexity. | Prove a minimal signed arm64/x64 package in T1 before implementing the full lifecycle. Keep runtime assets version-pinned and report installer size. |
| Native PostgreSQL can still consume memory; Docker removal alone does not make the database free. | Use a desktop-specific PostgreSQL profile; validate the proposed 1.5 GiB idle and 2.5 GiB active targets in T1–T3 and lock them before T4. |
| Existing data is inside Docker-managed volumes. | Export/restore to a new cluster, verify before cutover, retain old volumes and provide a rollback path. |
| E2B quota errors may arrive while a tool command is in flight. | Classify failures, fence execution, and never blindly replay commands with unknown provider acceptance. |
| E2B and Docker computer environments are not byte-for-byte equivalent. | Transfer only supported workspace files; treat browser sessions/system state as non-portable unless explicitly tested. |
| E2B key exposure could grant sandbox-account access. | Store with OS secure storage; expose no key to renderer; restrict child process environment; redact diagnostics. |
| PostgreSQL upgrade or app update is interrupted. | Keep database startup idempotent, retain backup and old cluster until successful launch, and test forced termination at each migration boundary. |
| Code currently assumes one provider per API/worker process. | Add per-computer provider routing behind existing sandbox contracts and tests before enabling runtime fallback. |

## 10. Definition of done

The work is complete only when all conditions below hold:

1. A clean packaged macOS installation launches **This computer** with Docker absent.
2. The API, worker, and PostgreSQL run as app-managed native processes and bind only to loopback/private sockets.
3. Existing PostgreSQL, Graphile jobs, realtime, authentication, Spaces, and app data remain intact.
4. E2B is the configured primary bot-computer provider; its key is protected and never delivered to the renderer.
5. Docker is used only for an explicitly configured bot-computer fallback and never for the main backend or host-command fallback.
6. E2B quota failure does not cause duplicate commands or silent loss of the last completed portable workspace snapshot. Any in-flight task is marked interrupted and is not replayed.
7. Existing-instance mode works without starting any local backend service.
8. Existing local Compose data has a verified, recoverable migration path with no automatic volume deletion.
9. Universal macOS arm64/x64 release artifacts retain the current minimum macOS version and pass packaging, signature, migration, runtime, and performance acceptance gates, including the 1.5 GiB idle and 2.5 GiB active RSS budgets.
10. Docs accurately state when Docker is and is not required.

## 11. Execution order

Execute T1 through T9 in the listed dependency order. Stop before desktop setup cutover (T4) if the T1–T3 proof cannot launch PostgreSQL and service artifacts on both supported Mac architectures, preserve the current minimum macOS version, or meet the resource budgets under the defined workloads. At that gate, return with the exact blocker, installer size, process footprint, minimum-version constraint, and measured RSS; do not switch to SQLite, Homebrew prerequisites, or Docker for the main backend without explicit user approval.

This file is the human-readable implementation plan. It does not authorize implementation; wait for the user's separate instruction before editing code.
