<!-- INIT-RULES:START — do not remove this marker. Managed by `init rules`. -->
> [!IMPORTANT]
> **Strictly and forcefully read `./RULES.md` AND `./GIT-SKILLS.md` BEFORE doing anything else — and stay fully aligned with both for the entire task.**
>
> **Scope: RULES.md applies to real, complex work — especially complex back-end work (features, architecture, database/migrations, security, performance, infrastructure, difficult debugging, cross-system changes, and anything where testing/verification is part of the core workflow). This is mandatory there — no skipping.**
>
> **Out of scope: do NOT apply RULES.md ceremony to super-simple front-end minor edits, small code edits, typo/copy fixes, trivial styling tweaks, or other tiny low-risk changes. For those, just inspect → edit → verify.**
>
> **Git skills — file: `./GIT-SKILLS.md` (summary: commit directly to `main`, never branch unless asked; every task `git add .` → `commit -m "message"` → `push`; messages 6–12 words, human, direct, specific; forbidden without explicit permission: `git restore`, `git reset`, `git push --force`; never commit secrets; no repo/no remote → stop and ask; pull before starting and before pushing). Full rules in `./RULES.md §15` mirror this file.**
<!-- INIT-RULES:END -->

> [!CAUTION]
> **You are not alone. 2–20 AI agents work in this repository at the same time. Never revert their work.**
>
> - Read `./GIT-SKILLS.md` first and follow it on every single task — no exceptions.
> - Every change you make must be committed and pushed: `git add .` → `git commit -m "message"` → `git push`, directly to `main`. No branches, no batching for later, no "too minor to commit."
> - Pull before starting work and pull again before pushing; merge others' commits cleanly instead of stomping over them. A broken tree because you skipped a pull is on you.
> - Forbidden without explicit permission: `git restore`, `git reset`, `git push --force`. All three destroy history — yours or another agent's.

# AGENTS.md

- This is a public repository: assume all tracked content and diffs are public. Never commit secrets, `.env` files, private URLs, personal/customer data, or real production data; use fake placeholders. Review `git status` and the staged diff before committing, and never force-add ignored files. If private data appears, stop and alert the maintainer.
- Rakazo is one product across web, Electron desktop, and Expo mobile; Electron hosts the web UI. Put shared behavior, contracts, API logic, and reusable UI in packages. Keep only genuinely native navigation, storage, permissions, and interactions platform-specific. Core workflows must cover every applicable surface or degrade safely for an explicit reason.
- No hosted vendor is required to run the core product. Keep LLMs, sandboxes, memory, voice, integrations, and future external services optional and behind provider-neutral interfaces. Vendor SDKs, configuration, and translation belong only in adapters and composition roots. New providers must reuse shared contracts and deterministic offline conformance tests.
- Keep UI and copy minimal. Show advanced capability progressively and only when it becomes relevant; do not add explainer text that repeats the interface. Frontends express intent and render state; the backend owns orchestration, authorization, validation, retries, recovery, and provider translation. Give controls concise accessible names when needed.
- Treat every visible word as UI. Start UX work by asking what can be removed, and prefer progressive disclosure over persistent explanation or status chrome. If a PR adds user-facing copy, its description must quote the copy, explain why it is necessary, and say why removing it or revealing it only when relevant would not work.
- Configure compatible providers and models through shared connection settings and standard protocol capabilities; never add provider- or model-specific environment variables when the generic connection can express the behavior.
- Use top-level `import type`, never inline type imports. Reserve dynamic `import()` for necessary deferred loading.
- Keep code simple: reuse existing primitives and one source of truth, remove duplication and unused flexibility, and avoid speculative abstractions. Add an interface when it protects a real external or platform boundary, not for its own sake.
- Treat auth, secret handling, sandbox boundaries, host commands, and integrations as security-sensitive. Keep tests deterministic and offline by default.
- The desktop Playwright suite (`pnpm --filter @rakazo/desktop test:e2e`) opens real Electron windows and steals focus on macOS. Do not run it on a maintainer's machine as routine verification; run the unit tests locally and let CI's virtual-display job run the e2e on push.
- After creating a pull request, stay with it until CI and automated review bots have finished; passing checks alone do not mean the review is complete. Follow `.agents/skills/pr-watch/SKILL.md`: run its `pr-digest --watch` helper as a single backgrounded call that blocks until the checks on the current head commit are terminal, then act on the verdict it prints. Do not poll in the foreground on a timer, which mostly buys repeated snapshots of an unchanged PR and dies at the tool timeout. Address every actionable issue, push the fixes, and repeat until no actionable feedback remains. Do not merge while review bots are still pending or review issues remain unresolved.
- PR descriptions say why the change exists, what changed, and how it was tested. Write Why as the product reason (what was wrong and what this changes); never "Elie wants" or a third-person briefing of a named person; the maintainer is the author.
- Commit messages, PR descriptions, issues, and review replies are public too. Describe test results in words instead of pasting tool output, and never include anything that identifies a person, machine, or account: local paths, usernames, hostnames, signing identities, legal entity names, Apple Team IDs, API key IDs, issuer or tenant IDs, account emails, or the accounts, machines, and files that secret values came from. Naming the secrets a workflow reads is fine; use placeholders when a value must be shown.
- For UI changes, link the CI E2E screenshot that shows the change on the PR; add the web test that opens that screen if it is missing. For native-only mobile UI that CI cannot capture, say so in the PR instead of linking an unrelated web screenshot.
- UI system. Colors live in `@rakazo/ui-tokens` as semantic tokens (background, card, muted, border, primary, destructive, ...) with one TypeScript source that generates `tokens.css`; never hardcode a product hex or use `[var(--…)]` arbitrary values. Web and Electron use shadcn/ui on Base UI, vendored into `packages/ui-web` via `pnpm exec shadcn add` from the official registry only (third-party registries are a supply-chain risk); reuse those components before writing chrome by hand, and reuse `apps/web/src/components/ai/` for AI moments (loading, shimmer, success). The app is monochrome: primary is ink, status colors are destructive/success/warning, bots carry the only identity color. Mobile is native-first: Expo Router, Expo UI, native sheets, menus, alerts and pickers wherever one exists; custom surfaces (thread, composer, avatars, cards) use plain StyleSheet with the shared tokens through `apps/mobile/lib/appearance.ts`, and system chrome stays PlatformColor via `lib/native.ts`. Mobile may diverge from web when the native pattern is better.

---

# Codebase map (cold-start reference for agents)

> How to read: §1–§3 give the whole picture. §4–§18 are per-module deep dives — jump to the one you need. Every file summary is 5–10 words. Anything not directly verified in code is tagged UNVERIFIED. Generated output, vendored deps, and lockfiles are skipped. Path rule: a full `apps/...`, `packages/...`, `infra/...`, `scripts/...` path is repo-rooted; a bare filename in a table resolves under that section's root plus the directory in the table caption (e.g. `rpc.ts` under web `src/lib/` means `apps/web/src/lib/rpc.ts`).

## 1. Architecture overview

**Layers (top to bottom).**

```
Clients
  apps/web      Vite + React 19 SPA, main product surface
  apps/desktop  Electron shell, hosts web UI, manages local stack
  apps/mobile   Expo native app, iOS + Android, no embedded web
  apps/www      Astro static marketing site, isolated from product
Backend
  apps/api      Hono + oRPC server, composition root in src/app.ts
  apps/worker   Job consumer + reconciler, no HTTP auth surface
Shared
  packages/contracts  Zod schemas + oRPC contract, API shapes source
  packages/core       Pure domain rules, no DB or network
  packages/db       Prisma Postgres repos, tenancy enforcement lives here
  packages/auth     Better Auth setup, signup gates, session hooks
  packages/memory   Markdown memory store implementing adapter contract
  packages/logging  Structured logger, redaction, Hono/job middleware
Providers
  packages/adapter-kit  Provider-neutral interfaces, zero vendor SDKs
  packages/adapters     Vendor implementations + offline emulators/fakes
Runtime env
  infra/compose     Docker Compose surfaces (dev, prod, images, topology)
  infra/sandboxes   Bot computer image + Docker supervisor service
  infra/updater     Self-update sidecar, recreates app services only
Tooling
  packages/testkit  Harness, CLIs, evals, replay, screenshot pipelines
  scripts/          Backup, restore, watch, publishing helper scripts
```

**Subsystems and owners.**

| Subsystem | Code | Role |
|---|---|---|
| Chat + threads | `apps/api/src/thread-target.ts`, `packages/db/src/messages.ts` | Send, snapshot, stop, paginate thread runs |
| Agent execution | `packages/adapters/src/executor.ts`, `pi-runtime.ts` | Run orchestration and tool dispatch loop |
| Scheduling | `packages/adapters/src/wakeup.ts`, `job-reconciler.ts` | Durable jobs plus stuck-work re-enqueue |
| Computers | `packages/adapters/src/computer-*.ts`, `infra/sandboxes/` | Provision, control, sleep, update bot desktops |
| Messaging ingress | `apps/api/src/messaging-inbound.ts`, `team-chat-bridge.ts` | DMs, channels, invites, routine wakes |
| Voice/calls | `apps/api/src/voice.ts`, `packages/adapters/src/*-voice.ts` | Credentials, TTS, transcription, call loop |
| Memory | `packages/memory/src/index.ts`, `memory-provider-factory.ts` | Markdown store plus semantic providers |
| Connectors | `composio/pipedream/mcp/remote-mcp` in adapters | Managed and user-installed third-party integrations |
| Search | `apps/api/src/search.ts`, `packages/core/src/search.ts` | Scoped full-space search implementation |
| Updates | `infra/updater/src/`, `apps/api/src/server-update.ts` | Sidecar plans/applies image updates via proxy |

**Multi-tenant model: Space is the tenant.** Not Better Auth organization — web registers the organization plugin but calls no organization API. Every RPC carries `x-rakazo-space-id`; `requireMembership` (`packages/db/src/scope.ts`) gates at the HTTP edge; per-row checks throw `IsolationError`. There is no Postgres RLS; isolation is application-level. Bot secrets additionally scope `{userId, spaceId, botId}`; cloud-agent credentials bind one credential to exactly one Space.

**Request flow (web → response).**

```
browser/Mobile → Caddy/compose → apps/api Hono app
  cors() with trusted origins → body-size limits
  /rpc/*: Bearer→cookie mapping, getSession, requireMembership → actor
  oRPC router (authed gate throws UNAUTHORIZED)
  handler threads actor into Prisma where clauses
  transactional write + appendEventInTransaction + events.notify
  → job enqueue (runContinueJob, routineWakeupJob, messagingDeliverJob…)
  → apps/worker Graphile host consumes → executor runs tools
  → PostgresRealtimeFanout → SSE threads.subscribe → client reducers
```

**API → worker handoff.** Shared Postgres-backed queue. Default `WAKEUP_DRIVER=graphile` (both sides build `GraphileJobPublisher`); `memory` mode uses `InMemoryJobQueue` for tests. Worker owns polling (`pollInboundMessages: false` in worker so it never steals Telegram `getUpdates` from API). `createJobReconciler` runs in worker always, in API only for in-memory mode.

## 2. Platform matrix (web, macOS, iOS, Android)

| Surface | Stack | Entry point | Build/run |
|---|---|---|---|
| Web app | Vite + React 19 + react-router | `apps/web/index.html` → `src/main.tsx` → `src/App.tsx` | `dev` vite on `WEB_PORT` default 5173; `build` production bundle |
| Marketing | Astro static output | `apps/www/src/pages/index.astro` → `HomePage.astro` | `dev` astro dev; port default 4321 |
| Desktop | Electron main + sandboxed preload | `apps/desktop/src/main.ts` → `dist/main.js` | `dev` bun build plus electron; `pack` mac/win/linux |
| Mobile | Expo managed + Expo Router | `expo-router/entry` → `apps/mobile/app/_layout.tsx` | `start` expo start; `android` / `ios` run commands |

**macOS (desktop) specifics.** `window-options.ts`: `frame: true`, `titleBarStyle: hiddenInset`, traffic lights at 16,16 on darwin; framed windows elsewhere. Dev Dock icon `icon-macos.png`; `app.dock.setIcon` when unpackaged. Window close hides (warm window, 15-minute TTL) instead of quitting; `window-all-closed` quits only off-darwin; `activate` restores windows. App menu is app-named with About/Hide roles on darwin, File menu elsewhere. Packaging: `appId dev.rakazo.desktop`, mac `dmg+zip`, `notarize: true`, icon from `packages/ui-tokens/assets/Rakazo.icon` (needs Xcode 26+); Windows `nsis` with signature verify; Linux `AppImage`.

**iOS (mobile) specifics.** `app.json` ios: `com.rakazo.app`, `supportsTablet: false`, shared `Rakazo.icon`, `usesNonExemptEncryption: false`; camera, photo-library, local-network usage descriptions; `NSAllowsLocalNetworking: true`. `with-scene-lifecycle.js` adopts `ExpoReactNativeFactoryProvider` for iOS 26 SDK with scene manifest on `EXExpoAppSceneDelegate`. `with-worklets-headers.js` adds Worklets header search paths for Reanimated release builds. Runtime: portrait lock in `_layout.tsx` (computer/image viewers unlock); `NativeSymbol` uses SF Symbols; `message-action-sheet` uses `ActionSheetIOS`; select-text sheet uses iOS pageSheet.

**Android (mobile) specifics.** `app.json` android: `com.rakazo.app`, `versionCode 10`, `resize` keyboard mode, raster plus adaptive/monochrome icons. Only native module in repo is `apps/mobile/modules/rakazo-notifications` (Android-only): `POST_NOTIFICATIONS`, foreground `remoteMessaging` service polling `runs/list` every 8s; 4 channels (live/messages/scheduled/attention); Keystore AES-GCM session token; `rakazo://thread|group-thread` deep-link intents; Android 36 promoted-ongoing support. JS loads it only when `Platform.OS === "android"`. `EndpointAllowlist.kt` mirrors LAN rules (10/8, 172.16/12, 192.168/16, 100.64/10, `.local`, loopback).

**Desktop ↔ web relationship.** Packaged via `electron-builder` extraResources (`../web/dist` → `web/`). Bundled renderer served only when `servesBundledRenderer()` (packaged build plus managed loopback stack); `/api`, `/rpc`, `/novnc` always pass through to server. Setup wizard is a separate offline `loadFile(setup.html)` window with strict CSP, never the remote renderer. Main-process IPC guards reject cross-window senders (`fromSetupWindow`/`fromMainWindow`).

**Mobile ↔ web relationship.** None embedded — all screens native. Only `computer.tsx` (noVNC) and `SandboxedHtmlPreview` use `react-native-webview`; HTML preview disables cookies/storage and locks navigation to `about:blank`.

## 3. Annotated directory tree

```
apps/
  api/src/            Hono server, oRPC router, inbound webhooks
  worker/src/         Executor host, job consumer, reconciler loop
  web/src/
    main.tsx, App.tsx Entry plus session-gated route definitions
    pages/            Shell chat plus settings and overlay screens
    lib/              RPC client, session, voice, computer helpers
    components/       AI primitives, call, computer, integrations, teach
    locales/          Lingui .po catalogs for ten locales
  www/src/
    pages/            Astro routes plus markdown twins and llms.txt
    components/       Landing sections, header, dialogs, demo
    i18n/             Four-locale copy tables and locale helpers
  desktop/src/        Electron main, preload bridges, setup wizard
  mobile/
    app/              Expo Router screens (22 routes registered)
    components/       Native avatars, cards, sheets, viewers
    lib/              API client, session, notifications, voice, inbox
    modules/rakazo-notifications/  Android-only foreground notification module
    plugins/          Expo config plugins applied at prebuild
packages/
  contracts/src/      Zod schemas plus oRPC appContract map
  core/src/           Pure domain helpers plus node/ shell builders
  db/prisma/          Schema plus 92 migration directories
  db/src/             Client, scope, repos, messages, credentials
  auth/src/           Better Auth factory with gates and hooks
  memory/src/         Markdown memory store implementation file
  logging/src/        Logger, sinks, correlation, redaction, middleware
  ui-tokens/src/      Palette source plus generated tokens.css
  ui-web/src/         Vendored shadcn wrappers plus avatar components
  chat-ui/src/        Shared markdown plus web and native renderers
  adapter-kit/src/    Neutral types, interfaces, registry, job schemas
  adapters/src/       Vendor providers, factories, emulators, tools
  testkit/src/        Harness, CLIs, evals, replay, report builders
infra/
  compose/            Compose files, Caddyfiles, deploy/backup scripts
  sandboxes/computer/ Bot desktop image (Xvfb, Chromium, noVNC)
  sandboxes/supervisor/ Docker computer lifecycle HTTP service
  sandboxes/desktop/  Minimal Xvfb VNC desktop test image
  systemd/            Nightly backup service plus timer unit
  updater/src/        Self-update Hono service (plan/apply/rollback)
scripts/              Backup, restore, watch, publishing helper scripts
docs/                 Self-host, computer, release, eval documentation
.agents/skills/       pr-watch and composio agent skill definitions
.github/workflows/    CI, E2E, replay, screenshots, release pipelines
```

## 4. apps/web — main product SPA

Purpose: Vite + React 19 single-page app behind a session gate. All product UI lives here; backend owns orchestration. Dev proxy forwards `/api` + `/rpc` to API and serves an authorized noVNC screen proxy.

Entry: `index.html` → `src/main.tsx` → `src/App.tsx`; routes `/`, `/sign-in|up|forgot-password|reset-password`, `/onboarding`, `/mcp/oauth/callback`, `/integrations/setup`, `/app`, `/app/g/:groupId`, `/app/artifacts[/:artifactId]`, `/app/:botId`.

**Root + entry files.**

| File | Summary |
|---|---|
| `apps/web/index.html` | HTML shell bootstraps theme, mounts React root |
| `apps/web/vite.config.ts` | Dev proxy /api /rpc; noVNC WS+HTTP proxy |
| `apps/web/lingui.config.ts` | Defines ten locales and .po catalog paths |
| `apps/web/playwright.config.ts` | Chromium e2e against live dev server |
| `apps/web/playwright.screen-proxy.config.ts` | Runs only screen-proxy isolation spec file |
| `apps/web/src/main.tsx` | Creates root, router, i18n, appearance providers |
| `apps/web/src/App.tsx` | Session gate plus all route definitions |
| `apps/web/src/styles.css` | Tailwind imports, scrollbar, theme base styles |
| `apps/web/src/vite-env.d.ts` | Vite client types plus .po declarations |
| `apps/web/src/novnc-html.ts` | Capped streaming reader for noVNC HTML |
| `apps/web/src/screen-proxy.ts` | Resolves screen targets via API authority check |

**Components (`src/components/`).**

| File | Summary |
|---|---|
| `ai/primitives.tsx` | Terminal loader, shimmer, timer, success pop primitives |
| `ai/beautiful-ui.css` | Keyframes for loader, shimmer, pop animations |
| `ai/CollaborationMarker.tsx` | Peer-activity chip and active-bot loading glyph |
| `ApprovalRulesSettings.tsx` | Email/purchase approval presets plus auto-review toggle |
| `ArtifactFileCard.tsx` | Downloadable artifact card with preview dialog |
| `AskCard.tsx` | Renders answerable ask/approval/secret prompt card |
| `CloudAgentCard.tsx` | Status badge card linking cloud-agent PR/branch |
| `ComputerMaintenanceActions.tsx` | Recover/reset/update menu for bot computer |
| `ComputersUnavailableHint.tsx` | Sandbox-off guidance with recheck and recovery |
| `ComputerUpdateProgress.tsx` | Live update banner, staged dialog, release flow |
| `DesktopUpdates.tsx` | Desktop-app update state provider and banner |
| `I18nBootstrap.tsx` | Loads locale catalog before rendering children |
| `MessageHoverMetadata.tsx` | Hover/touch reveal rail beside message bubbles |
| `PdfViewer.tsx` | Renders PDF bytes in sandboxed iframe |
| `SandboxedHtmlViewer.tsx` | Double-iframe CSP-isolated HTML artifact preview |
| `SoftwareUpdateSection.tsx` | Sidecar server update check/apply with reconnect |
| `ToolActivityDisclosure.tsx` | Collapsible tool-steps card and slim line variant |
| `call/CallCard.tsx` | Floating voice-call controls with live transcript |
| `call/VoiceChatCard.tsx` | Expandable grouped voice-chat transcript card |
| `computer/ComputerWorkspace.tsx` | Dock with draggable terminal/files windows overlay |
| `computer/FilesApp.tsx` | Bot workspace browser with preview/upload/download |
| `computer/TerminalApp.tsx` | xterm activity feed plus interactive shell tabs |
| `integrations/IntegrationSetup.tsx` | Composio and Pipedream plus direct-MCP connect form |
| `LaunchSplash.tsx` | macOS launch mark overlay, once per launch |
| `teach/SkillDraftCard.tsx` | Editable taught-skill playbook with save/test |
| `teach/teach-computer-input-chain.ts` | Serializes per-bot teaching input request queue |
| `teach/TeachCaptureOverlay.tsx` | Captures pointer/keyboard into computer input RPCs |
| `teach/TeachComputerOverlay.tsx` | Start-teaching popover with recording lock probe |
| `teach/TeachRecordingChrome.tsx` | Recording timer, protected input, stop button |

**lib (`src/lib/`, ~50 modules).**

| File | Summary |
|---|---|
| `rpc.ts` | oRPC client injecting `x-rakazo-space-id` header |
| `auth.ts` | better-auth client with organization plugin |
| `session-gate.ts` | Distinguishes loading, unreachable, authenticated, anonymous sessions |
| `bootstrap.ts` | Speculative bootstrap fetch reused by Shell |
| `bootstrap-target.ts` | Parses initial bootstrap botId from path |
| `thread-events.ts` | Pure SSE/snapshot reducers for thread/computer state |
| `call-session.ts` | Full duplex voice-call state machine and orchestration |
| `computer-screen.ts` | Latest-wins screen load plus iframe sandbox rules |
| `computer-sandbox.ts` | Sandbox availability checks and .env guidance |
| `computer-updates.ts` | Shared computer-updates store bound to RPC |
| `computer-workspace.ts` | Command feed folding, formatting, terminal URLs |
| `desktop.ts` | Desktop bridge accessors and OAuth callback helpers |
| `dictation.ts` | WebSpeech/MediaRecorder dictation with server transcription fallback |
| `tts.ts` | Chunked TTS synthesis with space-scoped requests |
| `mcp-connect.ts` | MCP OAuth popup flow via BroadcastChannel completion |
| `model-auth.ts` | Model OAuth completion polling via RPC |
| `model-catalog.ts` | Localized thinking-level labels for models |
| `use-model-oauth-signin.ts` | Subscription OAuth lifecycle incl. desktop capture |
| `i18n.ts` | Locale catalog loading, activation, fallback logic |
| `ui-locale.ts` | Supported locales, normalization, resolving, persisting choice |
| `ui-appearance.ts` | Theme preference resolution and DOM application |
| `apply-ui-direction.ts` | Sets document dir/lang from UI locale |
| `messaging.ts` | Provider and transport display-label mapping helper functions |
| `message-text.ts` | Extracts plain copyable text from message blocks |
| `peer-messages.ts` | Groups bot-to-bot messages into peer conversations |
| `peer-history.ts` | Paginated peer-history loader with total timeout |
| `activity-mode.ts` | Persists sidebar Now/Recent list mode flag |
| `bots-sidebar-pref.ts` | Persists per-user sidebar collapsed preference |
| `bot-profile-patch.ts` | Sends description+instructions only when changed |
| `right-panel-state.ts` | Per-user space-target panel persistence helper functions |
| `roster-status.ts` | Sidebar working-status labels for run states |
| `response-streaming.ts` | Streaming-replies preference store and subscription |
| `tool-activity-preference.ts` | Show-tool-activity preference store and subscription |
| `tool-activity-view.ts` | Tool-card visibility and duration formatting rules |
| `transcript-scroll.ts` | Near-end and snap scroll-position predicate helper functions |
| `run-error-storage.ts` | Capped localStorage set of dismissed run errors |
| `pending-attachments.ts` | File drag/paste detection and base64 reading |
| `artifact-open.ts` | Fetches artifact bytes and triggers downloads |
| `quote-selection.ts` | Maps text selection to single-region quote draft |
| `copy-text.ts` | Clipboard copy hook with transient copied flag |
| `use-object-url.ts` | Object URL hook with automatic revocation |
| `client-id.ts` | Secure-context-safe UUID generation for nonces |
| `local-timezone.ts` | Returns browser IANA timezone or UTC |
| `localized-provider-hint.ts` | Localizes provider auth-hint fallback strings |
| `optional-catalog-feed.ts` | Soft-fails optional catalog probe to empty |
| `relative-time.ts` | Localized relative timestamps with date fallback |
| `focus-prompt.ts` | Delayed focus-choice card scheduler with abort |
| `chart-viewport.ts` | Computes capped expanded-chart modal dimensions |
| `browser-notifications.ts` | Eligibility, formatting, delivery of browser notifications |
| `performance.ts` | Performance marks once and after-paint helpers |
| `preload-recovery.ts` | Reloads once on stale Vite chunk errors |
| `shared-inflight.ts` | Coalesces concurrent same-key async work |
| `updater-recreate.ts` | Recreate-disconnect detection and update confirmation |

**Pages (`src/pages/`).** `Shell.tsx` is the 6904-line main chat shell (roster, thread, computer, routines; render JSX partly UNVERIFIED).

| File | Summary |
|---|---|
| `Shell.tsx` | Main chat shell: roster, thread, computer, routines |
| `Auth.tsx` | Sign-in, sign-up, forgot, reset forms via authClient |
| `Onboarding.tsx` | Model connect → integrations → first-bot creation |
| `Welcome.tsx` | Logged-out landing with sign-up CTA |
| `LocalSettings.tsx` | Desktop-loopback local owner models/integrations page |
| `WindowChrome.tsx` | Desktop window controls or drag spacer |
| `Artifacts.tsx` | Space artifact browser with filters and preview |
| `AccountSettingsOverlay.tsx` | Account, appearance, language, avatar, password settings panels |
| `SettingsOverlay.tsx` | Settings dialog shell with section navigation |
| `ActivityList.tsx` | Polling Now/Recent run activity sidebar list |
| `BotContextMenu.tsx` | Pin, move, read, edit, duplicate, clear, archive, delete menu |
| `ExternalConversationSettings.tsx` | Team-chat listening, rules, sender policies editor panel |
| `GroupPanel.tsx` | Group create form and membership settings |
| `HostComputerPrompt.tsx` | Docker-vs-host computer choice dialog (desktop) |
| `IntegrationSetup.tsx` | Route wrapper loading bots and setup state |
| `KnowledgeSection.tsx` | Bot memory documents plus shared skills editor |
| `McpOAuthCallback.tsx` | OAuth popup callback completing via BroadcastChannel |
| `McpServersOverlay.tsx` | MCP server CRUD plus per-bot assignments |
| `MemorySettingsOverlay.tsx` | Memory provider connect/disconnect and scope |
| `MessagingSettingsOverlay.tsx` | Chat apps, channels, agent connections management |
| `ModelSettingsOverlay.tsx` | Provider catalog, keys, OAuth, defaults, limits |
| `PeerMessagesOverlay.tsx` | Read-only bot-to-bot conversation transcript view |
| `PluginsOverlay.tsx` | Connection catalog, custom sources, account management |
| `ResizableSidePanel.tsx` | Draggable/resizable right panel with persisted width |
| `RoutineEditor.tsx` | Routine draft editor with triggers and history |
| `RoutineRunHistory.tsx` | Expandable polling routine run history list |
| `RoutineSchedule.tsx` | Localized cron preset picker and describer |
| `ScratchpadSection.tsx` | Per-bot open-work todo list CRUD |
| `SpaceSearch.tsx` | Renders space search hits for selection |
| `VoiceSettingsOverlay.tsx` | Voice provider keys, voices, test playback |
| `shell/bot-panel.tsx` | Create-bot form and bot settings panel |
| `shell/bot-picker.tsx` | To-picker with bot/group/space creation actions |
| `shell/command-palette.tsx` | Bot-switch command palette with shortcuts |
| `shell/command-palette-hotkey.ts` | Detects Cmd or Ctrl plus K palette hotkey |
| `shell/dialogs.tsx` | Space, section, clear, delete confirmation dialog components |
| `shell/message-cards.tsx` | Choice, app-connect, MCP-approval, chart, artifact message cards |
| `shell/bot-credentials.tsx` | Per-bot encrypted credentials manager UI |
| `shell/avatar-studio-popover.tsx` | Bot avatar shape/color/upload studio dialog |
| `memory-providers/registry.ts` | Supermemory and Serenity provider settings configuration registry |
| `memory-providers/serenity-settings.ts` | Serenity endpoint, token, label configuration builder |
| `memory-providers/SerenitySettingsForm.tsx` | Serenity endpoint, token, and label settings form |
| `memory-providers/SupermemorySettingsForm.tsx` | Supermemory cloud and local connection settings form |

Public interfaces: same-origin oRPC at `/rpc` plus `POST /api/voice/transcribe`, `POST /api/voice/speak`, `fetch("/api/auth/capabilities")`; `window.rakazoDesktop` bridge when hosted in Electron (browser build degrades to popup flows).

Gotchas: tenant unit is Space via `x-rakazo-space-id`, never the org plugin; `Shell.openSpaceChat` full-reloads on space change so bootstrapped data matches header; no auth tokens in web code (cookie session only); `Shell.tsx` render region UNVERIFIED past line 1620.

## 5. apps/www — static marketing site

Purpose: Astro static site, four locales, no session and no tenant concept. Only server endpoint is waitlist signup. Fully isolated from `apps/api`.

| File | Summary |
|---|---|
| `apps/www/astro.config.mjs` | Static build, 4 locales, sitemap, dev port |
| `apps/www/middleware.ts` | Serves markdown/HTML/406 by Accept header |
| `apps/www/www-port.mjs` | Validates WWW_PORT, defaults to 4321 |
| `apps/www/api/waitlist.ts` | Validates email, honeypot-spam-tolerant PostHog signup |
| `apps/www/src/site.ts` | Canonical URLs, brand, contact constants |
| `apps/www/src/analytics.ts` | Lazy PostHog pageview init when key present |
| `apps/www/src/demo.ts` | Static fictional demo bots/threads/screens dataset |
| `apps/www/src/github.ts` | Cached GitHub star-count fetch and formatter |
| `apps/www/src/waitlist.ts` | Email validation plus PostHog capture helper |
| `apps/www/src/agent-content.ts` | Markdown docs plus Accept-negotiation helpers |
| `apps/www/src/layouts/BaseLayout.astro` | SEO/OG/hreflang head, skip link, shell |
| `apps/www/src/components/HomePage.astro` | Full landing page composition and sections |
| `apps/www/src/components/Header.astro` | Localized nav, star pill, mobile menu |
| `apps/www/src/components/Footer.astro` | Brand, language switcher, legal links |
| `apps/www/src/components/GetStartedDialog.astro` | Self-host vs cloud-waitlist choice dialog |
| `apps/www/src/components/WaitlistForm.astro` | Email form posting to /api/waitlist |
| `apps/www/src/components/Button.astro` | Single link button with size and variant options |
| `apps/www/src/components/Logo.astro` | Brand mark plus wordmark link |
| `apps/www/src/components/LandingBotAvatar.tsx` | Color-mapped static demo bot avatar image |
| `apps/www/src/components/RosterBotAvatar.astro` | Roster card image by bot name |
| `apps/www/src/components/ProductDemo.tsx` | Interactive fictional product demo component |
| `apps/www/src/components/product-demo-when.ts` | Demo schedule parsing, describing, resolving helper functions |
| `apps/www/src/i18n/locales.ts` | Four locales, paths, OG/lang mappings |
| `apps/www/src/i18n/home.ts` | Complete per-locale landing page copy deck |
| `apps/www/src/i18n/demo.ts` | Chinese demo-string table plus translators |
| `apps/www/src/styles/global.css` | Entire marketing stylesheet, tail UNVERIFIED |

Page routes under `apps/www/src/pages/`: `index.astro`, `about.astro`, `privacy.astro`, `support.astro`, `404.astro` (each plus an `.md.ts` markdown twin), `llms.txt.ts`, `robots.txt.ts`, plus locale `de/index.astro`, `ko/index.astro`, `zh/index.astro`.

Gotchas: i18n is Astro path-based (`en` unprefixed), unrelated to web Lingui catalogs; no shared auth/tenant code.

## 6. apps/desktop — Electron shell (macOS, Windows, Linux)

Purpose: privileged shell around the web UI. Owns windows, IPC, Docker local stack, OAuth loopback, updates. Renderer stays unprivileged behind two narrow preload bridges.

Entry: `src/main.ts` → `dist/main.js`; bridges `src/preload.cjs` (app window) and `src/setup-preload.cjs` (wizard); wizard `src/setup.html` + `setup.js` + `setup.css`.

| File | Summary |
|---|---|
| `apps/desktop/src/main.ts` | Electron main process orchestrating windows, stack, updates |
| `apps/desktop/src/preload.cjs` | Exposes sandboxed desktop bridge to renderer |
| `apps/desktop/src/setup-preload.cjs` | Exposes setup-only IPC bridge to wizard |
| `apps/desktop/src/setup.html` | Static first-run server chooser window markup |
| `apps/desktop/src/setup.js` | Drives setup wizard stack progress UI |
| `apps/desktop/src/setup.css` | Dark editorial styles for setup window |
| `apps/desktop/src/auto-update.ts` | Manages electron-updater state machine and checks |
| `apps/desktop/src/browser-auth.ts` | Handles loopback OAuth via system browser |
| `apps/desktop/src/docker-cli.ts` | Locates Docker binary, runs CLI securely |
| `apps/desktop/src/local-settings.ts` | Proxies authenticated local settings RPC requests |
| `apps/desktop/src/local-stack.ts` | Installs, starts Docker Compose local stack |
| `apps/desktop/src/oauth-callback.ts` | Parses loopback OAuth codes from URLs |
| `apps/desktop/src/renderer-assets.ts` | Serves bundled web UI overlaying managed stack |
| `apps/desktop/src/session-permissions.ts` | Restricts Electron permissions to app origin |
| `apps/desktop/src/setup-config.ts` | Validates server URLs, startup routing logic |
| `apps/desktop/src/setup-store.ts` | Reads, writes private setup files atomically |
| `apps/desktop/src/window-open.ts` | Decides OAuth popups versus external browser |
| `apps/desktop/src/window-options.ts` | Defines window chrome per operating system |
| `apps/desktop/scripts/copy-static.mjs` | Copies preload bridges, setup assets into dist |

Tests: 16 colocated `src/*.test.ts` suites mirror modules above (contents UNVERIFIED). E2E under `apps/desktop/e2e/` (`playwright.config.ts`, `smoke.spec.ts`, `setup.spec.ts`, `local-stack.spec.ts`, `window-drag.spec.ts`) opens real windows — CI-only, steals macOS focus.

Public interfaces: `rakazoDesktop` bridge (window chrome, OAuth capture, updater state), `rakazoSetup` bridge (wizard-only), `/.well-known/rakazo-desktop-stack` token-gated probe, `probeServer` via `${url}/rpc/health`.

Gotchas: only `@rakazo/contracts` + `@rakazo/ui-tokens` are shared-package deps — desktop is a shell, not a reimplementation; setup IPC refuses non-setup senders and app bridge refuses non-app senders; `0600` setup secrets; macOS specifics in §2.

## 7. apps/mobile — Expo native app (iOS + Android)

Purpose: native-first client — all screens are React Native via Expo Router. No `ios/` or `android/` dirs; native projects come from prebuild plus two config plugins. 22 routes registered in root layout with global `CallCard` + `ComputerUpdateProgress` overlays.

Entry: `expo-router/entry` → `app/_layout.tsx`.

**Router (`app/`).** Large screens partially read — detail UNVERIFIED where noted.

| File | Summary |
|---|---|
| `apps/mobile/app/_layout.tsx` | Root layout, theme, splash, notification hooks |
| `apps/mobile/app/index.tsx` | Inbox home with spaces, search, activity |
| `apps/mobile/app/sign-in.tsx` | Email auth plus custom server sheet |
| `apps/mobile/app/thread.tsx` | Bot conversation with composer, streaming, attachments |
| `apps/mobile/app/group-thread.tsx` | Re-exports single thread screen implementation |
| `apps/mobile/app/new.tsx` | Creates bot then opens its thread |
| `apps/mobile/app/new-group.tsx` | Creates group from selected member bots |
| `apps/mobile/app/new-space.tsx` | Creates space then selects it home |
| `apps/mobile/app/account.tsx` | Manages profile, locale, notifications, sessions |
| `apps/mobile/app/ai-data-sharing.tsx` | Manages per-recipient mobile AI permissions |
| `apps/mobile/app/artifact.tsx` | Shows artifact versions with share support |
| `apps/mobile/app/artifacts.tsx` | Lists, searches space artifacts with pagination |
| `apps/mobile/app/bot-settings.tsx` | Edits bot profile, model, computer mode |
| `apps/mobile/app/change-password.tsx` | Changes password with confirmation validation |
| `apps/mobile/app/computer.tsx` | Embeds noVNC desktop with takeover controls |
| `apps/mobile/app/group-settings.tsx` | Renames group, edits membership, deletes |
| `apps/mobile/app/image.tsx` | Fullscreen image viewer managing orientation locks |
| `apps/mobile/app/integration-setup.tsx` | First-run provider credential onboarding flow |
| `apps/mobile/app/integrations.tsx` | Browses connector catalog, manages connections |
| `apps/mobile/app/models.tsx` | Configures providers, keys, OAuth, thinking levels |
| `apps/mobile/app/routine.tsx` | Displays routine schedule, prompt, thread link |
| `apps/mobile/app/voice.tsx` | Configures voice provider and device speech |

**Components (`components/`, 21 files).**

| File | Summary |
|---|---|
| `bot-avatar.tsx` | Renders themed bot avatar with working animation |
| `group-avatar.tsx` | Stacks member avatars with overflow count |
| `avatar-style.tsx` | Provides server-synced avatar style context |
| `native-symbol.tsx` | Renders iOS symbols, Android Ionicons fallback |
| `WorkingIndicator.tsx` | Shows pulsing dots while bot works |
| `CallCard.tsx` | Floating voice-call controls with transcript toggle |
| `AskActions.tsx` | Renders approval answer buttons with pending state |
| `McpApprovalCard.tsx` | Approves or dismisses MCP connection requests |
| `AppConnectCard.tsx` | Authorizes OAuth app connections via browser |
| `VoiceChatCard.tsx` | Collapses call transcript into expandable card |
| `bot-organize-modal.tsx` | Pins bots, assigns sections, silences notifications |
| `bot-member-picker.tsx` | Selects group members with max enforcement |
| `computer-maintenance-actions.tsx` | Recovers, resets, updates computer container |
| `computer-mode-picker.tsx` | Chooses Team versus Private computer mode |
| `computer-update-progress.tsx` | Shows global computer update pills modal |
| `connector-icon.tsx` | Displays connector logo with letter fallback |
| `image-artifact-viewer.tsx` | Pinch-zoom image viewer with share support |
| `inline-image-attachment.tsx` | Renders cached chat image inline bubbles |
| `markdown-artifact-preview.tsx` | Fullscreen markdown preview with share action |
| `sandboxed-html-preview.tsx` | Sandboxes bot HTML without session access |
| `select-text-sheet.tsx` | Shows message text for cross-paragraph selection |

**lib (`lib/`, non-test).** Large files partially read — detail UNVERIFIED where noted.

| File | Summary |
|---|---|
| `api.ts` | Authenticated RPC client, spaces, thread subscriptions |
| `session.ts` | Stores session token in SecureStore securely |
| `endpoint.ts` | Normalizes and probes custom server URLs |
| `auth-routing.ts` | Defines sign-in mode and route constants |
| `native.ts` | Maps shared tokens to PlatformColor chrome |
| `appearance.ts` | Persists light, dark, system theme choice |
| `theme.ts` | Re-exports shared product palette tokens |
| `i18n.ts` | Manages locale catalogs and direction bootstrap |
| `ui-locale.ts` | Resolves en, zh-CN, ru, de locales |
| `ui-direction.ts` | Applies RTL and reloads when needed |
| `app-version.ts` | Formats native version and OTA identity |
| `push.ts` | Registers Expo push token with backend |
| `live-notifications.ts` | Bridges Android foreground notification service |
| `notification-open.ts` | Parses notification payloads into thread routes |
| `open-notification.ts` | Opens tapped notification exactly once |
| `voice.ts` | Speaks replies via server or device |
| `call-session.ts` | Runs listen, think, speak call loop |
| `voice-call-entry.ts` | Chooses device, provider, settings, dictation path |
| `dictation.ts` | On-device speech recognition with silence endpointing |
| `device-voice.ts` | Persists on-device voice preference flag |
| `auto-speak.ts` | Decides when finished replies should speak |
| `computer.ts` | Builds screen URLs and computer labels |
| `computer-refresh.ts` | Polls computer status without rotating URLs |
| `computer-updates.ts` | Wires computer update store to RPC |
| `artifacts.ts` | Lists, fetches, deletes space artifacts |
| `artifact-open.ts` | Caches artifact bytes then shares files |
| `artifact-file.ts` | Sanitizes artifact cache and share filenames |
| `inbox.ts` | Filters bots and formats thread timestamps |
| `inbox-spaces.ts` | Builds grouped sidebar items across spaces |
| `search.ts` | Queries server search for current space |
| `search-destination.ts` | Routes search hits to thread or routine |
| `activity.ts` | Fetches and labels run activity feeds |
| `activity-mode.ts` | Persists home activity mode toggle |
| `inline-image.ts` | Fits images, caches in-flight downloads |
| `pick-attachments.ts` | Picks photos and documents as base64 |
| `pick-attachments-filter.ts` | Enforces attachment count, size, type limits |
| `message-action-sheet.ts` | Shows iOS sheets, paged Android alerts |
| `message-presentation.ts` | Segments blocks and extracts quotable text |
| `selectable-text.ts` | Converts markdown preserving code and lists |
| `thread-scroll.ts` | Tracks detached scroll and unread state |
| `refresh.ts` | Chooses thread poll interval by status |
| `preview.ts` | Truncates markdown to twelve-word snippet |
| `response-streaming.ts` | Persists streaming replies preference flag |
| `model-auth.ts` | Polls model OAuth completion via RPC |
| `app-connect.ts` | Presents app connection authorization state |
| `avatar-style.ts` | Caches and serializes avatar style writes |
| `bot-avatar.ts` | Resolves stored color into avatar presentation |
| `bot-lifecycle.ts` | Confirms bot deletion including memories choice |
| `avatar-motion.ts` | Re-exports shared avatar animation helpers |
| `ai-consent.ts` | Prompts AI data-sharing consent with fallback |
| `focus-prompt.ts` | Schedules delayed new-bot focus card |
| `last-bot.ts` | Persists last opened bot identifier |
| `locales/de.ts` | Provides German UI message catalog |
| `locales/ru.ts` | Provides Russian UI message catalog |
| `locales/zh.ts` | Provides Simplified Chinese message catalog |

~40 `lib/*.test.ts` suites mirror modules above (contents UNVERIFIED).

**Native module + plugins.**

| File | Summary |
|---|---|
| `apps/mobile/modules/rakazo-notifications/package.json` | Declares private Android notification module |
| `apps/mobile/modules/rakazo-notifications/expo-module.config.json` | Registers Android-only Expo native module |
| `apps/mobile/modules/rakazo-notifications/android/build.gradle` | Builds Android library via Expo plugin |
| `apps/mobile/modules/rakazo-notifications/android/src/main/AndroidManifest.xml` | Declares notification and foreground service permissions |
| `apps/mobile/modules/rakazo-notifications/android/src/main/java/com/rakazo/notifications/EndpointAllowlist.kt` | Allows HTTPS or local-network HTTP endpoints |
| `apps/mobile/modules/rakazo-notifications/android/src/main/java/com/rakazo/notifications/NotificationStorage.kt` | Encrypts token via Keystore, stores settings |
| `apps/mobile/modules/rakazo-notifications/android/src/main/java/com/rakazo/notifications/RakazoNotificationsModule.kt` | Exposes settings, resume, stop to JavaScript |
| `apps/mobile/modules/rakazo-notifications/android/src/main/java/com/rakazo/notifications/RakazoNotificationService.kt` | Polls runs every 8s, posts thread notifications |
| `apps/mobile/modules/rakazo-notifications/android/src/main/res/drawable/ic_rakazo_notification.xml` | White two-bar vector notification icon |
| `apps/mobile/plugins/with-scene-lifecycle.js` | Migrates iOS AppDelegate to UIScene lifecycle |
| `apps/mobile/plugins/with-worklets-headers.js` | Adds Worklets headers for Reanimated iOS |

`.maestro/` flows: `smoke.yaml` (sign-in, create bot, message, computer), `notification-demo.yaml`, `screenshots.yaml`; opt-in, needs emulator plus disposable account; PR CI excluded.

Public interfaces: `rpc()` against `currentApiBase()` (default `EXPO_PUBLIC_API_URL` else loopback `http://127.0.0.1:3100`), session bearer from SecureStore, Space header with rollback recovery.

Gotchas: `lib/native.ts` is the shared-vs-native seam (shared tokens via `mobileTokens()`, system chrome via PlatformColor only when preference is `system`); storage is `expo-secure-store` throughout (`rakazo.session_token`, `rakazo.api_base`, `rakazo.space_id`); mobile does NOT import `ui-web`; iOS/Android specifics in §2.

## 8. apps/api — Hono + oRPC backend

Purpose: sole HTTP authority. Owns auth edge, tenant scoping, all domain writes, inbound webhooks, voice routes, screen proxy, updater proxy. Composition root is `src/app.ts`; contract implementation is the ~6376-line `src/router.ts`.

Entry: `src/index.ts` (env, createApp, serve; tracks raw sockets so SSE streams survive shutdown; 2s grace then destroy).

| File | Summary |
|---|---|
| `apps/api/src/index.ts` | Boots Hono server with graceful shutdown handling |
| `apps/api/src/app.ts` | Composes auth, jobs, connectors, routes, messaging |
| `apps/api/src/env.ts` | Loads and validates typed server environment config |
| `apps/api/src/router.ts` | Implements full oRPC contract with tenant checks |
| `apps/api/src/health.ts` | Serves public liveness plus internal details |
| `apps/api/src/webhook.ts` | Mounts authenticated bot webhook HTTP route |
| `apps/api/src/webhook-inbound.ts` | Formats payloads, enqueues idempotent webhook runs |
| `apps/api/src/github-webhook.ts` | Verifies signatures, routes GitHub routine events |
| `apps/api/src/messaging-webhook.ts` | Mounts provider messaging webhook endpoints |
| `apps/api/src/messaging-inbound.ts` | Routes DMs, channels, invites, routine wakes |
| `apps/api/src/voice.ts` | Manages voice credentials plus synthesis routes |
| `apps/api/src/search.ts` | Searches bots, messages, artifacts, routines scoped |
| `apps/api/src/runs.ts` | Lists active/recent runs with prompt snippets |
| `apps/api/src/routine-runs.ts` | Paginates routine runs with reply links |
| `apps/api/src/artifacts.ts` | Stores, versions, resolves, deletes scoped artifacts |
| `apps/api/src/agent-secrets.ts` | Owner-gated space environment secret management |
| `apps/api/src/agent-skills.ts` | Manages user skills alongside builtin catalog |
| `apps/api/src/ai-consent.ts` | Computes AI recipients and records consent |
| `apps/api/src/bot-thread.ts` | Requires bot thread, updates message blocks |
| `apps/api/src/bot-update.ts` | Persists bot plus emits bot.updated event |
| `apps/api/src/computer-status.ts` | Maps computer rows to status responses |
| `apps/api/src/http-body.ts` | Reads bodies with strict byte limits |
| `apps/api/src/integration-catalog.ts` | Queries remote integration catalog safely |
| `apps/api/src/local-settings.ts` | Gates owner RPC via desktop stack token |
| `apps/api/src/mcp-approval.ts` | Resolves MCP approval cards transactionally |
| `apps/api/src/mcp-material.ts` | Computes next MCP credential blob update |
| `apps/api/src/memory-provider-config.ts` | Validates, stores memory provider config |
| `apps/api/src/onboarding.ts` | Posts focus choices and connector cards |
| `apps/api/src/request-body-limit.ts` | Enforces JSON size limits per route |
| `apps/api/src/screen-proxy.ts` | Authorizes proxied screen URLs via capabilities |
| `apps/api/src/serializable-retry.ts` | Re-exports serializable transaction retry helper |
| `apps/api/src/server-update.ts` | Proxies update sidecar, never runs git |
| `apps/api/src/taught-skills.ts` | Records teaching sessions, saves executable playbooks |
| `apps/api/src/team-chat-bridge.ts` | Reconciles external messages, delivers agent replies |
| `apps/api/src/team-chat-judge.ts` | Judges ambient channel engagement via model |
| `apps/api/src/team-chat-startup.ts` | Buffers inbound events during bridge startup |
| `apps/api/src/thread-message-pages.ts` | Loads pages, filters peer-run noise |
| `apps/api/src/thread-target.ts` | Sends messages, snapshots threads, stops runs |

30 colocated `src/*.test.ts` suites mirror modules above (contents UNVERIFIED).

Public interfaces: `/rpc/*` (full `appContract`), `/api/auth/*` (Better Auth handler), `/api/voice/*`, webhook mounts (bot, GitHub, messaging providers), `/health`, screen-target endpoint, local-settings RPC mount, updater proxy.

Gotchas: `authed` gate throws UNAUTHORIZED when actor missing; tenant scope threads `actor{userId, spaceId, isDeploymentOwner}` into every Prisma clause; cross-tenant miss surfaces as `IsolationError`; writes use serializable transactions plus advisory locks; webhook/GitHub routes return identical 401s to avoid bot-ID enumeration; bodies bounded before target lookup.

## 9. apps/worker — job consumer + reconciler

Purpose: background execution. Builds executor, secret store, sandbox/MCP/messaging stack, background handlers, Graphile host with 53300 retry loop, and job reconciler. No auth surface, no contracts import.

| File | Summary |
|---|---|
| `apps/worker/src/index.ts` | Runs executor, job host, reconciler loop |

Job types consumed (from `adapter-kit`): `runContinueJob`, `routineWakeupJob`, `messagingDeliverJob`, `skillTeachingExpireJob`, `computerControlExpireJob`, `scheduleComputerSleep`, `runJobKey` cancels.

Gotchas: worker declares no `@rakazo/auth` or `@rakazo/contracts` dependency; both processes must agree on deployment model/provider/key; reconciler repairs missed wakes; `pollInboundMessages` stays false in worker.

## 10. packages/contracts — API shapes source of truth

Purpose: Zod schemas plus the oRPC `appContract` procedure map. Zero runtime workspace imports. Every client and the API compile against this.

| File | Summary |
|---|---|
| `src/domain.ts` | Defines bots, spaces, models, credentials, deployment schemas |
| `src/rpc.ts` | Defines full oRPC app contract with procedures |
| `src/events.ts` | Defines product events, message blocks, thread schemas |
| `src/ids.ts` | Defines IDs, actors, run and memory enums |
| `src/runs.ts` | Defines routine runs, cursors, activity rows |
| `src/search.ts` | Defines search hits requiring bot-or-group target |
| `src/reactions.ts` | Defines allowed message reaction emoji set |
| `src/attachments.ts` | Defines attachment limits and MIME type helpers |
| `src/bot-avatar.ts` | Validates avatar colors, shapes, image values |
| `src/bot-secrets.ts` | Defines bot secret names, origins, auth schemas |
| `src/mcp.ts` | Defines MCP transports, endpoints, header schemas |
| `src/ai-consent.ts` | Defines AI disclosure versions and consent schemas |
| `src/integration-settings.ts` | Defines integration provider configs and setup state |
| `src/cloudflare-ai-gateway.ts` | Validates Cloudflare gateway routing identifiers |
| `src/openai-compatible-ui.ts` | Helpers for OpenAI-compatible connect UI flow |
| `src/markdown-text.ts` | Extracts canonical text from dropped table HTML |
| `src/terminal.ts` | Encodes browser-to-computer terminal input frames |
| `src/desktop.ts` | Types desktop update, setup, and bridge interfaces |
| `src/local-settings.js` | Whitelists local-settings RPC procedures and routes |
| `src/local-settings.d.ts` | Types local-settings JS bridge for TypeScript |
| `src/index.ts` | Re-exports every contract module as package entry |

Public interfaces: root barrel (all schemas + `appContract`/`AppContract` covering aiConsent, health, me, spaces, bootstrap, deployment, updater, models, bots, groups, botSections, threads, computer, memory, routines, scratchpad, skills, agentSkills, capabilities, mcp, onboarding, integrationSetup, connections, messaging, approvalRules, autoReview, artifacts, usage, export, notifications, search, runs, voice, externalConversations, agentSecrets, botSecrets); `./local-settings` subpath (~13 procedures).

Gotchas: `local-settings` is plain JS plus `.d.ts`, not TS; contract changes require updating producers and consumers together.

## 11. packages/core — pure domain rules

Purpose: framework-free logic shared by web, mobile, API, worker. No DB, no servers — except string shell/Python builders under `node/`. Root barrel re-exports 57 modules; `approval-effect-key` and `message-quote` need their subpaths.

| File | Summary |
|---|---|
| `action-approval.ts` | Resolves tool approval rules and auto-review gating |
| `agent-skill.ts` | Parses SKILL.md frontmatter and expands skill references |
| `ai-consent.ts` | Gates AI procedures on disclosure consent prompts |
| `answerable-ask.ts` | Finds latest unanswered ask for waiting runs |
| `approval-effect-key.ts` | Builds stable idempotency keys for approval effects |
| `artifact-sandbox.ts` | Wraps bot HTML with restrictive CSP meta |
| `async.ts` | Abortable delay helper for cancellable waits |
| `attachments.ts` | Validates attachments and maps blocks to prompts |
| `avatar-motion.ts` | Computes working avatar animation frames and durations |
| `avatar-shape.ts` | Generates deterministic organic avatar SVG paths |
| `barge-in.ts` | Detects voice call interruptions versus speaker echo |
| `bot-avatar-colors.ts` | Defines avatar color palette and deterministic resolution |
| `bot-avatar-shapes.ts` | Stores shipped avatar SVG paths and shape lookup |
| `bot-messages.ts` | Clamps bot messages and builds wake prompts |
| `bot-sections.ts` | Groups sidebar bots and nests roster hierarchies |
| `call-nonce.ts` | Encodes and parses voice call client nonces |
| `cloud-agent.ts` | Validates cloud agent URLs and message blocks |
| `compose-update.ts` | Plans Compose image updates and rollback targets |
| `composer-mention-picker.ts` | Handles keyboard navigation for mention picker |
| `composer-mentions.ts` | Builds mention options and send routing plans |
| `composer-slash.ts` | Serializes composer slash skills and mention prefixes |
| `computer-updates.ts` | Polls computer update operations with local state |
| `cron.ts` | Builds cron presets and computes next runs |
| `echo.ts` | Detects microphone echo of played speech output |
| `events.ts` | Projects events to messages; sanitizes JSON payloads |
| `farewell.ts` | Detects whole-utterance voice call goodbye phrases |
| `featured-connectors.ts` | Matches featured connectors and filters catalog items |
| `format-file-size.ts` | Formats byte counts as human-readable sizes |
| `group-mentions.ts` | Parses @mentions and resolves group target bots |
| `http-response.ts` | Reads bounded JSON responses with abort support |
| `markdown-plain.ts` | Converts Markdown source to single-line plain text |
| `mcp.ts` | Derives URL-safe MCP server slugs from names |
| `message-pages.ts` | Merges paginated thread histories without duplicates |
| `message-quote.ts` | Derives authoritative reply quotes from Markdown blocks |
| `message-reactions.ts` | Folds emoji replies into parent message reactions |
| `message-time.ts` | Formats message timestamps relative to today |
| `message-visibility.ts` | Filters peer-bot chatter from user-visible threads |
| `messaging-commands.ts` | Parses owner YES/NO/LEAVE messaging commands |
| `messaging-prompts.ts` | Provides messaging surface prompts and channel helpers |
| `model-oauth.ts` | Polls model OAuth completion with cancellation support |
| `model-probe.ts` | Manages latest-wins OpenAI-compatible endpoint probing |
| `model-providers.ts` | Ranks providers and resolves selectable model ids |
| `response-bytes.ts` | Reads bounded response bodies within byte budgets |
| `run-state.ts` | Defines run lifecycle states and transition rules |
| `sandbox-command.ts` | Resolves sandbox command timeouts from environment |
| `screen-lease.ts` | Compares fenced screen control lease identifiers |
| `search.ts` | Extracts links and matches search query fields |
| `secrets-guard.ts` | Resolves secrets and validates dedicated token boundaries |
| `self-update.ts` | Validates repos and plans source-checkout updates |
| `signup-policy.ts` | Evaluates allowlists and first-account admission decisions |
| `speech-text.ts` | Converts Markdown to speakable utterances and narrations |
| `stuck-work.ts` | Detects stalled runs and builds reminder notifications |
| `teach-playbook.ts` | Builds skill playbooks from recorded demonstrations |
| `teach-recording.ts` | Captures keys and maps viewer pointers accurately |
| `text-direction.ts` | Infers LTR or RTL from locale tags |
| `thread-message-updates.ts` | Updates live and cloud-agent thread messages |
| `thread-subscription.ts` | Recovers durable event streams with idle timeouts |
| `tool-activity.ts` | Identifies provider tool-activity message blocks |
| `voice-chat-groups.ts` | Groups call messages into voice chat cards |
| `node/desktop-runtime.ts` | Generates shell for displays, browsers, gateways |
| `node/load-root-env.ts` | Loads nearest .env without overriding existing values |
| `node/screen-capability.ts` | Seals and opens encrypted screen capability URLs |
| `node/screen-proxy-response.ts` | Strips sensitive headers; enforces sandbox policies |
| `node/terminal-server.ts` | Embeds Python PTY server for browser terminals |
| `plot/plot-spec.ts` | Validates and renders Observable Plot chart specs |
| `index.ts` | Re-exports all core modules except specialised subpaths |

~64 colocated `*.test.ts` suites mirror modules above (contents UNVERIFIED).

Public interfaces: root barrel (57 modules); `./message-quote`; `./plot`; `./node/load-root-env`; `./node/approval-effect-key`; `./node/screen-proxy-response`; `./node/desktop-runtime`; `./node/screen-capability`.

Gotchas: keep `node:crypto` out of browser-reachable modules (`secrets-guard` hand-rolls timing-safe compare for that reason); run-state machine is enforced by `db` writes.

## 12. packages/db — Postgres access + tenancy enforcement

Purpose: Prisma client factory plus repository modules. All tenant isolation checks live here (`scope.ts`). ~60 models in `prisma/schema.prisma`; 92 migrations (contents UNVERIFIED).

| File | Summary |
|---|---|
| `src/client.ts` | Creates Postgres pools and Prisma clients |
| `src/scope.ts` | Enforces space membership and record isolation checks |
| `src/repos.ts` | Manages bots, sections, ordering, computer linkage |
| `src/groups.ts` | Manages chat groups with lease-aware teardown logic |
| `src/spaces.ts` | Creates and deletes spaces with advisory locks |
| `src/messages.ts` | Creates thread messages with run-write guards |
| `src/events.ts` | Implements thread events, runs, steering, realtime fanout |
| `src/thread-listing.ts` | Selects active runs; derives message previews |
| `src/cancel-runs.ts` | Cancels runs, attempts, tasks inside transactions |
| `src/expire-stuck-run.ts` | Cancels aged queued or waiting runs transactionally |
| `src/computers.ts` | Manages computer records with per-user quotas |
| `src/artifact-versions.ts` | Allocates sequential artifact versions under locks |
| `src/credential-secrets.ts` | Deletes unreferenced secrets; retires dead credentials |
| `src/model-credentials.ts` | Selects space model preferences and credential candidates |
| `src/voice-credentials.ts` | Selects space voice preferences and default credentials |
| `src/memory-config.ts` | Reads memory config; resolves effective memory scope |
| `src/messaging.ts` | Provisions messaging identities and link codes |
| `src/external-conversations.ts` | Lists and updates external conversation policies |
| `src/bootstrap-user.ts` | Creates personal org, space, memory, preferences |
| `src/transaction-retry.ts` | Retries serializable transaction conflicts up to thrice |
| `src/index.ts` | Re-exports all database repository modules publicly |
| `prisma/schema.prisma` | Defines Postgres models, relations, indexes, cascades |
| `prisma.config.ts` | Loads .env and configures Prisma datasource URL |

Public interfaces: `createDb/createPool`, `requireMembership/scoped/IsolationError`, `createRepos`, `createGroupRepos`, `createSpaceForMember` + deletion-claim helpers, thread/event/run/steering writers, credential selectors, `withTransactionRetry`. Generated client under `src/generated/prisma` is build output — never import paths inside it directly (layout UNVERIFIED).

Gotchas: no Postgres RLS — application-level only; `pg_advisory_xact_lock` guards space create-vs-delete and per-user quotas; thread idempotency via `Message @@unique([threadId, clientNonce])` and `Run @@unique([spaceId, clientNonce])`; space deletion is two-phase (claim → provider destroy → delete) with 5-minute stale-claim recovery; `MemoryDocument @@unique` omits `userId` — queries add it manually; artifact family index is raw SQL invisible to Prisma; deliberately FK-free rows (`MessagingIdentity`, `UsageRecord.botId`, `CloudAgent`) are cleaned manually.

## 13. packages/auth, packages/memory, packages/logging

**auth** — Better Auth factory, single main file.

| File | Summary |
|---|---|
| `packages/auth/src/index.ts` | Configures Better Auth with signup gates, hooks |

Public interfaces: `createAuth(prisma, env)`, `Auth` type, `AuthEnv`, `resolveSignupPolicy`, `authRateLimitOptions`, verification/password-reset emails, `buildTrustedOrigins/loopbackTwinOrigins/isBlockedAuthPath`.

Gotchas: `before` hook rejects `@messaging.invalid` emails and nulls messaging/unverified sessions; first admitted session bootstraps space; `/organization*` routes blocked; credential rate-limit is DB-backed only in production.

**memory** — Markdown store implementing the adapter-kit `MemoryStore` contract.

| File | Summary |
|---|---|
| `packages/memory/src/index.ts` | Implements Markdown memory store with revision history |

Gotchas: search is in-process substring scan (no FTS); `exportMarkdown("all")` maps to `"user"`; `importMarkdown` always writes `scope:"user"`.

**logging** — standalone, zero workspace deps.

| File | Summary |
|---|---|
| `packages/logging/src/logger.ts` | Implements level-filtered logger with redaction, sinks |
| `packages/logging/src/redaction.ts` | Redacts secrets, emails, tokens from logs |
| `packages/logging/src/serialize-error.ts` | Serializes errors with redaction and cause chains |
| `packages/logging/src/context.ts` | Stores log bindings in AsyncLocalStorage context |
| `packages/logging/src/correlation.ts` | Establishes request correlation and outgoing headers |
| `packages/logging/src/ids.ts` | Generates request, trace, span identifiers; parses traceparent |
| `packages/logging/src/env.ts` | Resolves log level/format; creates service loggers |
| `packages/logging/src/console-sink.ts` | Writes JSON or pretty logs to console |
| `packages/logging/src/test-sink.ts` | In-memory log sink capturing events for tests |
| `packages/logging/src/sink-guard.ts` | Guards sink writes against failures with throttling |
| `packages/logging/src/hono.ts` | Hono middleware logging requests with correlation context |
| `packages/logging/src/jobs.ts` | Wraps background jobs with trace correlation bindings |
| `packages/logging/src/axiom.ts` | Creates Axiom sinks and root logger installers |
| `packages/logging/src/types.ts` | Defines log levels, events, sinks, correlations |
| `packages/logging/src/index.ts` | Re-exports logger, sinks, correlation, redaction APIs |

Public interfaces: root (`createLogger/getLogger/installLogger`, sinks, correlation, service loggers, job wrappers, redaction); `./hono` (`requestLogging`); `./axiom`.

Gotchas: redaction is aggressive (emails, prompts, `*token*` keys); sink failures are swallowed with throttled `console.error` — never throw from logging.

## 14. packages/ui-tokens, packages/ui-web, packages/chat-ui

**ui-tokens** — single source of truth for color. Edit `src/index.ts`, then regenerate; never edit `tokens.css` by hand.

| File | Summary |
|---|---|
| `packages/ui-tokens/src/index.ts` | Canonical palettes plus appearance preference helpers |
| `packages/ui-tokens/src/generate-css.ts` | Writes tokens.css from TypeScript palette |
| `packages/ui-tokens/src/tokens.css` | Generated CSS variables for both themes |
| `packages/ui-tokens/assets/README.md` | Documents shared macOS iOS icon workflow |
| `packages/ui-tokens/assets/Rakazo.icon/icon.json` | Icon Composer project metadata file |
| `packages/ui-tokens/assets/Rakazo.icon/Assets/orange-bot.png` | Orange bot foreground artwork asset |

Public interfaces: `.` (`ColorTokens`, `darkTokens`, `lightTokens`, appearance resolvers, `renderTokensCss`); `./css` (`tokens.css`). `appearance.test.ts` fails CI when source and CSS drift.

**ui-web** — vendored shadcn-on-Base-UI kit plus bot avatars. Consumed by web/www only; mobile does not import it.

| File | Summary |
|---|---|
| `packages/ui-web/src/index.ts` | Public barrel for avatars components utilities |
| `packages/ui-web/src/lib/utils.ts` | Merges class names with tailwind-merge |
| `packages/ui-web/src/bot-avatar.tsx` | Bot avatars marks wordmark with motion |
| `packages/ui-web/src/group-avatar.tsx` | Stacked group avatar with overflow count |
| `packages/ui-web/src/avatar-style.tsx` | Robot organic avatar style context |
| `packages/ui-web/src/components/logo-start.tsx` | WebGL liquid-metal renderer for the launch mark |
| `packages/ui-web/src/components/start.tsx` | Launch mark SVG fed to the metal renderer |
| `packages/ui-web/src/model-thinking-options.tsx` | Advanced model options disclosure form |
| `packages/ui-web/src/motion-provider.tsx` | MotionConfig wrapper installing luxe defaults |
| `packages/ui-web/src/motion.ts` | Blur-in motion presets, easings, durations |
| `packages/ui-web/src/styles.css` | Tailwind theme mapping plus avatar animations |
| `packages/ui-web/src/shadcn.css` | Vendored variants scroll-fade shimmer utilities |
| `packages/ui-web/components.json` | Shadcn registry style path alias config |
| `packages/ui-web/src/components/ui/alert-dialog.tsx` | Modal confirmation dialog Base UI wrapper |
| `packages/ui-web/src/components/ui/badge.tsx` | Variant pill badge Base UI wrapper |
| `packages/ui-web/src/components/ui/button.tsx` | Variant-sized button Base UI wrapper |
| `packages/ui-web/src/components/ui/card.tsx` | Structured card sections with spacing |
| `packages/ui-web/src/components/ui/checkbox.tsx` | Accessible checkbox Base UI wrapper |
| `packages/ui-web/src/components/ui/command.tsx` | Command palette dialog cmdk wrapper |
| `packages/ui-web/src/components/ui/dialog.tsx` | Accessible modal dialog Base UI wrapper |
| `packages/ui-web/src/components/ui/dropdown-menu.tsx` | Menu popover Base UI wrapper |
| `packages/ui-web/src/components/ui/field.tsx` | Labeled form field layout primitives |
| `packages/ui-web/src/components/ui/input.tsx` | Styled text input Base UI wrapper |
| `packages/ui-web/src/components/ui/input-group.tsx` | Composite input with addons wrapper |
| `packages/ui-web/src/components/ui/kbd.tsx` | Keyboard shortcut hint styling element |
| `packages/ui-web/src/components/ui/label.tsx` | Accessible form label wrapper element |
| `packages/ui-web/src/components/ui/native-select.tsx` | Styled native select dropdown element |
| `packages/ui-web/src/components/ui/popover.tsx` | Floating popover Base UI wrapper |
| `packages/ui-web/src/components/ui/scroll-area.tsx` | Custom scrollbar Base UI wrapper |
| `packages/ui-web/src/components/ui/select.tsx` | Custom select Base UI wrapper |
| `packages/ui-web/src/components/ui/separator.tsx` | Horizontal vertical divider Base UI wrapper |
| `packages/ui-web/src/components/ui/skeleton.tsx` | Pulsing loading placeholder block element |
| `packages/ui-web/src/components/ui/spinner.tsx` | Animated loading spinner icon element |
| `packages/ui-web/src/components/ui/switch.tsx` | Toggle switch Base UI wrapper |
| `packages/ui-web/src/components/ui/tabs.tsx` | Tabbed navigation Base UI wrapper |
| `packages/ui-web/src/components/ui/textarea.tsx` | Styled multiline textarea element wrapper |
| `packages/ui-web/src/components/ui/toggle.tsx` | Pressed-state toggle Base UI wrapper |
| `packages/ui-web/src/components/ui/tooltip.tsx` | Hover tooltip Base UI wrapper |

Avatar test suites (`bot-avatar.test.tsx`, `group-avatar.test.tsx`, `avatar-motion-sync.test.ts`) — contents UNVERIFIED. `src/styles.d.ts` UNVERIFIED (presumed CSS shim). `"./hooks/*"` export has no backing `src/hooks/` directory — UNVERIFIED whether any consumer uses it.

Gotchas: add components only via `pnpm exec shadcn add` from the official registry; monochrome rule (primary is ink); reuse `apps/web/src/components/ai/` for AI moments.

**chat-ui** — dual-platform chat markdown. No root export; `./web` and `./native` only.

| File | Summary |
|---|---|
| `packages/chat-ui/src/markdown.ts` | Shared URL sanitizing and link-splitting helpers |
| `packages/chat-ui/src/markdown.web.tsx` | GFM renderer with safe links tables |
| `packages/chat-ui/src/markdown.native.tsx` | Token-styled Expo renderer with safe links |
| `packages/chat-ui/src/markdown-table.tsx` | Sortable paged table card with export |
| `packages/chat-ui/src/table-utils.ts` | Pure table extraction sorting serialization helpers |
| `packages/chat-ui/src/icons.tsx` | Copy and check SVG icons |
| `packages/chat-ui/src/native-test-stubs.tsx` | Vite stubs for native-only dependencies |

`markdown.web.css`, `markdown-table.css`, `linkify-it.d.ts`, `styles.d.ts` UNVERIFIED (presumed styles/shims, not read). Test suites (`markdown.test.ts`, `table-utils.test.ts`, `markdown.linkified.test.tsx`, `markdown.native.test.tsx`) — contents UNVERIFIED.

Gotchas: only inline `data:` rasters render as images; remote images degrade to links; CSV export neutralizes `=+-@` formula prefixes; `parseBotAvatar` renders only `data:image/` (no remote `<img src>`).

## 15. packages/adapter-kit — neutral contracts, no vendors

Purpose: provider-neutral interfaces every adapter implements and every consumer codes against. Depends only on `@rakazo/contracts` + zod. Vendors live in `packages/adapters` and composition roots only.

| File | Summary |
|---|---|
| `packages/adapter-kit/src/types.ts` | Shared DTOs for every adapter contract |
| `packages/adapter-kit/src/interfaces.ts` | Provider-neutral interfaces for all slots |
| `packages/adapter-kit/src/registry.ts` | Slot-keyed registry plus slot names |
| `packages/adapter-kit/src/background-jobs.ts` | Validated job constructors and dispatch helpers |
| `packages/adapter-kit/src/cloud-agents.ts` | Rejected-request error for cloud agents |
| `packages/adapter-kit/src/index.ts` | Re-exports all kit modules publicly |

Public interfaces: `AdapterContext` (operation/trace/space/user/bot/run ids, screen lease, abort signal), `AdapterDescriptor`, all `*Capabilities` types, provider interfaces (`SandboxProvider`, `ConnectorProvider`, `ManagedConnectorProvider`, `ConnectionAuthProvider`, `MemoryStore`, `SemanticMemoryProvider`, `AgentRuntime`, `ModelProvider`, `JobPublisher`/`JobWorkerHost`, `AgentHomeStore`, `ArtifactStore`, `SecretStore`, `RealtimeFanout`, `NotificationProvider`, `TransactionalEmailProvider`, `ExecutionRunner`, `VoiceProvider`, `MessagingSurface`, `WebSearchProvider`/`WebFetchProvider`/`WebProvider`, `BrowserProvider`, `CloudAgentProvider`, `AutoReviewProvider`), `AdapterRegistry` + canonical slot names (runtime, sandbox, memory, home, artifacts, secrets, jobs, realtime, notifications, models, connector, auth, runner, voice, web, browser, cloudAgent, autoReview), background-job builders/validators.

Consumed by: adapters, api, worker, auth, db, memory, testkit.

## 16. packages/adapters — vendors + factories + offline doubles

Purpose: implements every `adapter-kit` slot. Factories (`*factory`, `resolve*Kind`, `*provider-env`) bind one adapter per slot from env. Every slot has fake/emulator/scripted doubles backing deterministic offline conformance tests (`sandbox/web/browser/cloud-agent-conformance`, `secrets-model-visibility-conformance`). ~140 non-test modules; 171 `*.test.ts` suites (per-module bodies UNVERIFIED).

**Entry + LLM runtime.**

| File | Summary |
|---|---|
| `packages/adapters/src/index.ts` | Barrel exporting all adapter modules |
| `packages/adapters/src/executor.ts` | Core agent run orchestration tool dispatch |
| `packages/adapters/src/tool-loop.ts` | Guards against repeated identical tool calls |
| `packages/adapters/src/runtime-stream.ts` | Cleanup wrapper for interrupted runtime iterators |
| `packages/adapters/src/pi-runtime.ts` | Pi agent streaming runtime tool orchestration |
| `packages/adapters/src/pi-models.ts` | Unified Pi model catalog with auth |
| `packages/adapters/src/pi-credentials.ts` | Pi credential store with retirement handling |
| `packages/adapters/src/pi-oauth.ts` | Model OAuth flows plus secret serialization |
| `packages/adapters/src/pi-anthropic-oauth.ts` | Anthropic manual OAuth code exchange helpers |
| `packages/adapters/src/pi-session.ts` | JSONL session persistence plus retention pruning |
| `packages/adapters/src/pi-runtime-limits.ts` | Stream timeouts token clipping retry helpers |
| `packages/adapters/src/pi-local-provider.ts` | Keyless local OpenAI-compatible provider registration |
| `packages/adapters/src/pi-openai-compatible-provider.ts` | Custom OpenAI-compatible provider with SSRF guards |
| `packages/adapters/src/pi-catalog-availability.ts` | Filters catalog by credential auth kind |
| `packages/adapters/src/pi-codex-catalog.ts` | Live Codex subscription model availability checks |
| `packages/adapters/src/pi-current-models.ts` | Patches catalog with recent model releases |
| `packages/adapters/src/model-connect.ts` | Builds persists model credential connection secrets |
| `packages/adapters/src/model-selection.ts` | Chooses run credential from catalog availability |
| `packages/adapters/src/model-modalities.ts` | Operator-declared vision modality parsing helpers |
| `packages/adapters/src/model-vision.ts` | Gates screenshot tools on image support |
| `packages/adapters/src/deployment-model.ts` | Deployment default provider model key resolution |
| `packages/adapters/src/openai-compatible-url.ts` | Validates normalizes OpenAI-compatible base URLs |
| `packages/adapters/src/openai-tool-parameters.ts` | Normalizes tool schemas for strict providers |
| `packages/adapters/src/cloudflare-ai-gateway.ts` | Cloudflare gateway routing identifiers (impl side) |
| `packages/adapters/src/history-compaction.ts` | Summarizes threads via history compaction jobs |
| `packages/adapters/src/shell-command-stream.ts` | Streams slow shell output while running |
| `packages/adapters/src/scripted-runtime.ts` | Scripted deterministic agent runtime for tests |
| `packages/adapters/src/test-runtime.ts` | Detects Vitest runtime for adapter gating |

**Sandbox + computer.**

| File | Summary |
|---|---|
| `packages/adapters/src/sandbox-factory.ts` | Constructs sandbox provider from kind string |
| `packages/adapters/src/sandbox-provider-env.ts` | Resolves sandbox kind with safe fallbacks |
| `packages/adapters/src/sandbox-test-support.ts` | Provision-plus-prepare helper function for sandbox tests |
| `packages/adapters/src/none-sandbox.ts` | Fail-closed unavailable computer provider stub |
| `packages/adapters/src/fake-sandbox.ts` | Deterministic local fake sandbox provider implementation |
| `packages/adapters/src/docker-sandbox.ts` | Supervisor-backed Docker sandbox provider implementation |
| `packages/adapters/src/e2b-sandbox.ts` | E2B desktop vendor sandbox provider |
| `packages/adapters/src/e2b-emulator.ts` | Deterministic managed sandbox emulator base class |
| `packages/adapters/src/daytona-sandbox.ts` | Daytona vendor sandbox provider implementation |
| `packages/adapters/src/daytona-emulator.ts` | Daytona-identified managed sandbox emulator subclass |
| `packages/adapters/src/createos-sandbox.ts` | CreateOS vendor sandbox provider implementation |
| `packages/adapters/src/box-sandbox.ts` | Box vendor graphical sandbox provider implementation |
| `packages/adapters/src/box-emulator.ts` | Box-identified managed sandbox emulator subclass |
| `packages/adapters/src/box-errors.ts` | Redacted Box SDK error translation helpers |
| `packages/adapters/src/desktop-sandbox.ts` | Local host-backed desktop sandbox provider |
| `packages/adapters/src/desktop-sandbox-paths.ts` | Cross-platform desktop path containment validation |
| `packages/adapters/src/desktop-sandbox-win32-path.ts` | Windows native path handle utilities |
| `packages/adapters/src/host-aware-sandbox.ts` | Environment-aware sandbox provider selector wrapper |
| `packages/adapters/src/file-handle-path.ts` | Resolves kernel path from open handle |
| `packages/adapters/src/linux-desktop.ts` | Linux desktop session management over sandbox |
| `packages/adapters/src/linux-desktop.test-support.ts` | Shell responder fixture for desktop tests |
| `packages/adapters/src/computer-browser.ts` | Live CDP page browser provider implementation |
| `packages/adapters/src/computer-control.ts` | Screen takeover lease expiry revocation logic |
| `packages/adapters/src/computer-idle.ts` | Idle detection plus computer sleep scheduling |
| `packages/adapters/src/computer-lifecycle.ts` | Computer provisioning replacement update orchestration |
| `packages/adapters/src/computer-screens.ts` | Screen lease errors and availability guards |
| `packages/adapters/src/computer-support.ts` | Computer refs paths action normalization helpers |
| `packages/adapters/src/computer-tools.ts` | Visual-action dedup guards for computer tools |
| `packages/adapters/src/computer-update.ts` | Coordinates computer software update flows |
| `packages/adapters/src/computer-workspace.ts` | Workspace checkpoint portable transfer helpers |
| `packages/adapters/src/extra-displays.ts` | Multi-display observation shell command builders |
| `packages/adapters/src/fake-terminal.ts` | Loopback websocket terminal gateway emulator implementation |
| `packages/adapters/src/fake-browser.ts` | Injected-page offline browser provider implementation |
| `packages/adapters/src/browser-emulator.ts` | Offline emulator browser provider subclass |
| `packages/adapters/src/browser-provider-factory.ts` | Resolves computer fake emulator browser providers |
| `packages/adapters/src/browser-tools.ts` | Agent-facing browser navigate snapshot act |
| `packages/adapters/src/page-browser-session.ts` | JSDOM page session snapshot act logic |

**Connectors + integrations.**

| File | Summary |
|---|---|
| `packages/adapters/src/composio-connector.ts` | Composio managed connector with OAuth catalog |
| `packages/adapters/src/composio-catalog-cache.ts` | Cached Composio toolkit directory merging |
| `packages/adapters/src/composio-emulator.ts` | Deterministic offline Composio catalog emulator |
| `packages/adapters/src/pipedream-connector.ts` | Pipedream managed connector with catalog |
| `packages/adapters/src/mcp-connector.ts` | MCP-backed connector provider with OAuth |
| `packages/adapters/src/mcp-emulator.ts` | Minimal local MCP HTTP test server |
| `packages/adapters/src/mcp-oauth.ts` | MCP OAuth discovery credential brokerage helpers |
| `packages/adapters/src/mcp-transport.ts` | MCP client transport constructors with fallback |
| `packages/adapters/src/mcp-server-tool.ts` | Parses and validates add_mcp_server tool arguments |
| `packages/adapters/src/remote-mcp.ts` | SSRF-guarded remote MCP fetch plus discovery |
| `packages/adapters/src/graphql-connectors.ts` | Authenticated GraphQL installed-connector executor implementation |
| `packages/adapters/src/installed-connectors.ts` | User-installed API connector provider implementation |
| `packages/adapters/src/integration-provider-settings.ts` | Cached Composio Pipedream settings resolution wrapper |
| `packages/adapters/src/third-party-connector-emulator.ts` | Records third-party connector emulator operations |
| `packages/adapters/src/connector-http.ts` | Validated credentialed HTTP connector primitives |
| `packages/adapters/src/connector-safety.ts` | Secret redaction plus error sanitization helpers |
| `packages/adapters/src/destination-emulator.ts` | UNVERIFIED: in-memory connector destination emulator presumably |
| `packages/adapters/src/lazy-tool-catalog.ts` | Paginated lazy connector tool catalog controls |
| `packages/adapters/src/agent-connections.ts` | Wakes bot-message chains across bots |
| `packages/adapters/src/agent-environment.ts` | Decrypts per-agent environment secrets mapping |

**Memory, messaging, voice, web, cloud agents.**

| File | Summary |
|---|---|
| `packages/adapters/src/memory-provider-factory.ts` | Space-scoped semantic memory provider resolution |
| `packages/adapters/src/memory-context.ts` | Loads bounded agent memory prompt context |
| `packages/adapters/src/memory-tools.ts` | Filters memory tools by provider configuration |
| `packages/adapters/src/serenity-client.ts` | Serenity MCP client transport with guards |
| `packages/adapters/src/serenity-memory-provider.ts` | Serenity semantic memory provider implementation |
| `packages/adapters/src/supermemory-client.ts` | Supermemory HTTP client with SSRF guards |
| `packages/adapters/src/supermemory-memory-provider.ts` | Supermemory semantic memory provider implementation |
| `packages/adapters/src/messaging-platforms.ts` | Slack Telegram WhatsApp Lark Sendblue wiring |
| `packages/adapters/src/messaging-context.ts` | Answers bot messaging identity membership queries |
| `packages/adapters/src/messaging-delivery.ts` | Delivers mirrored outbound messaging queue items |
| `packages/adapters/src/messaging-team-chat-emulator.ts` | Offline team-chat messaging surface emulator |
| `packages/adapters/src/team-chat-messaging.ts` | Maps inbound messages to team events |
| `packages/adapters/src/chat-sdk-surface.ts` | Chat SDK messaging surface orchestration adapter |
| `packages/adapters/src/sendblue-emulator.ts` | Sendblue messaging platform test double |
| `packages/adapters/src/expo-push.ts` | Expo push notification provider with receipts |
| `packages/adapters/src/smtp-email.ts` | SMTP transactional email with retry drain |
| `packages/adapters/src/email-emulator.ts` | Deterministic offline transactional email emulator |
| `packages/adapters/src/github-webhook-emulator.ts` | HMAC-signed GitHub webhook delivery minter |
| `packages/adapters/src/bot-messages.ts` | Persists routes bot-to-bot wake messages |
| `packages/adapters/src/voice-factory.ts` | Constructs voice provider from kind string |
| `packages/adapters/src/voice-http.ts` | Shared voice HTTP audio helpers |
| `packages/adapters/src/openai-voice.ts` | OpenAI TTS plus transcription voice provider |
| `packages/adapters/src/elevenlabs-voice.ts` | ElevenLabs TTS plus transcription voice provider |
| `packages/adapters/src/cartesia-voice.ts` | Cartesia low-latency TTS voice provider |
| `packages/adapters/src/fish-audio-voice.ts` | Fish Audio TTS voice provider |
| `packages/adapters/src/scripted-voice.ts` | Deterministic offline voice provider for tests |
| `packages/adapters/src/web-provider-factory.ts` | Resolves keyless fake web providers |
| `packages/adapters/src/web-tools.ts` | Agent-facing web search fetch wrappers |
| `packages/adapters/src/web-limits.ts` | Clamps web search fetch result sizes |
| `packages/adapters/src/web-ssrf.ts` | SSRF-safe bounded web fetch implementation |
| `packages/adapters/src/keyless-http-web.ts` | Keyless DuckDuckGo search Readability fetch |
| `packages/adapters/src/fake-web.ts` | In-memory offline web search provider |
| `packages/adapters/src/network-address.ts` | DNS pinning private metadata address guards |
| `packages/adapters/src/undici-fetch.ts` | Version-paired undici fetch plus FormData |
| `packages/adapters/src/cloud-agent-factory.ts` | Builds space-bound cloud agent connections |
| `packages/adapters/src/cloud-agent-provider-env.ts` | Resolves cloud provider from environment variables |
| `packages/adapters/src/cloud-agent-service.ts` | Persists enqueues cloud agent thread work |
| `packages/adapters/src/cloud-agent-tools.ts` | Zod schemas for cloud agent tools |
| `packages/adapters/src/cloud-agent-tools-select.ts` | Filters cloud tools when provider unconfigured |
| `packages/adapters/src/cloud-agent-poll.ts` | Reconciles persisted remote agent intent state |
| `packages/adapters/src/cloud-agent-emulator.ts` | In-memory deterministic cloud agent provider |
| `packages/adapters/src/cursor-cloud-agent.ts` | Cursor vendor cloud coding agent provider |
| `packages/adapters/src/testing/cursor-cloud-agent-emulator.ts` | UNVERIFIED: Cursor API test double presumably |

**Jobs, home, secrets, misc.**

| File | Summary |
|---|---|
| `packages/adapters/src/wakeup.ts` | Graphile graphile-worker publisher host and dispatch |
| `packages/adapters/src/job-reconciler.ts` | Re-enqueues stuck overdue background work items |
| `packages/adapters/src/background-job-handlers.ts` | Wires background jobs to domain handlers |
| `packages/adapters/src/home.ts` | Local filesystem agent home store |
| `packages/adapters/src/artifacts.ts` | Local filesystem artifact store implementation |
| `packages/adapters/src/thread-artifacts.ts` | Thread attachment artifact persistence helpers |
| `packages/adapters/src/secrets.ts` | AES-GCM encrypted secret store implementation |
| `packages/adapters/src/run-secret.ts` | Run-scoped secret ask pause helpers |
| `packages/adapters/src/bot-secrets.ts` | Stores injects bot secrets with redaction |
| `packages/adapters/src/bot-avatar.ts` | Encodes validates bot avatar image values |
| `packages/adapters/src/builtin-skills.ts` | Built-in generic agent skill recipe catalog |
| `packages/adapters/src/builtin-tools.ts` | Lazily built core agent tool definitions |
| `packages/adapters/src/skill-tools.ts` | Skill CRUD tool handlers and merging |
| `packages/adapters/src/schedule-tools.ts` | Schedule create list cancel tool handlers |
| `packages/adapters/src/scratchpad-context.ts` | Loads bounded scratchpad prompt context items |
| `packages/adapters/src/scratchpad-tools.ts` | Scratchpad CRUD tool handlers and validation |
| `packages/adapters/src/task-catalog.ts` | Aggregates schedules scratchpad skills into catalog |
| `packages/adapters/src/teaching-session.ts` | Records teaching sessions into skill playbooks |
| `packages/adapters/src/takeover-resume.ts` | Takeover checkpoint parsing and messaging |
| `packages/adapters/src/stuck-work.ts` | Detects notifies stuck runs for recovery |
| `packages/adapters/src/user-progress.ts` | Clamps mid-turn progress update messages |
| `packages/adapters/src/reply-context.ts` | Builds quoted reply context for prompts |
| `packages/adapters/src/silent-reply.ts` | Detects silent NO_RESPONSE routine replies |
| `packages/adapters/src/ai-consent.ts` | Maps providers to privacy policy URLs |
| `packages/adapters/src/approval-ask.ts` | Builds redacted approval ask message blocks |
| `packages/adapters/src/approval-effect.ts` | Replay queue for approved tool effects |
| `packages/adapters/src/auto-review.ts` | LLM judge for tool auto-allow decisions |
| `packages/adapters/src/auto-review-factory.ts` | Selects auto-review provider by environment |
| `packages/adapters/src/jev-auto-review.ts` | Hosted Jev verdict auto-review provider |
| `packages/adapters/src/scripted-auto-review.ts` | Deterministic offline auto-review test provider |
| `packages/adapters/src/current-time.ts` | Formats present-moment instruction for prompts |
| `packages/adapters/src/plot-tool.ts` | Re-exports plot plus SVG rasterizer |
| `packages/adapters/src/private-endpoint.ts` | Deployment-owner private endpoint authorization check |
| `packages/adapters/src/realtime.ts` | Postgres pub/sub realtime fanout implementation |
| `packages/adapters/src/release-watch.ts` | Release monitoring eval model constants |
| `packages/adapters/src/child-bots.ts` | Child bot lifecycle home cleanup handlers |
| `packages/adapters/src/group-handoff.ts` | Hands runs to group member bots |
| `packages/adapters/src/tool-text.ts` | Coerces tool arguments to safe text |

`destination-emulator.ts` (in-memory connector destination record emulator) also exists — name-derived summary UNVERIFIED.

Gotchas: vendors live ONLY here plus composition roots; `isVitestRuntime()` gates live adapters in tests; conformance suites assert `contractVersion: "1"` and identical behavior; secrets must never reach model-visible payloads (`secrets-model-visibility-conformance`); SSRF/DNS-pinning plus metadata-IP blocks in `web-ssrf`/`network-address`; deployment-owner gate for private endpoints.

## 17. packages/testkit — test harness + CLIs

Purpose: shared test infrastructure. Boots the real API against disposable Postgres with emulated edges; runs journeys, E2E, evals, replay, screenshots, performance.

| File | Summary |
|---|---|
| `packages/testkit/src/index.ts` | Exports emulators plus session cookie helper |
| `packages/testkit/src/pin-test-env.ts` | Forces emulator-only environment for unit tests |
| `packages/testkit/src/model-emulator.ts` | Loopback scripted OpenAI-compatible model fixture |
| `packages/testkit/src/computer-replay.ts` | Scripted contacts-export replay through real Pi |
| `packages/testkit/src/computer-recording.ts` | Narrow closed-vocabulary contacts journey recorder |
| `packages/testkit/src/computer-replay-fixture.ts` | Fake contacts site with CSV fixtures |
| `packages/testkit/src/computer-test-config.ts` | Selects live sandbox provider API key |
| `packages/testkit/src/discard-bot-intro.ts` | Stops bot creation intro runs deterministically |
| `packages/testkit/src/performance-report.ts` | Performance report schema, summarize, parse helpers |
| `packages/testkit/src/png-validation.ts` | Validates PNG size, integrity, dimensions |
| `packages/testkit/src/playwright-report-dashboard.ts` | Dashboard, gallery, history, baseline comparison logic |
| `packages/testkit/src/playwright-pr-screenshot-comment.ts` | Builds PR screenshot comments with feature frames |
| `packages/testkit/src/cli/harness.ts` | Integration and E2E orchestrator with disposable Postgres |
| `packages/testkit/src/cli/canary.ts` | Runs live provider canary test suites |
| `packages/testkit/src/cli/evals.ts` | Runs real-model product evals writing reports |
| `packages/testkit/src/cli/computer.ts` | Runs live computer-use E2E test |
| `packages/testkit/src/cli/computer-replay.ts` | Offline Docker computer replay without inference |
| `packages/testkit/src/cli/topology.ts` | Production-shaped Docker topology smoke test |
| `packages/testkit/src/cli/process.ts` | Spawns processes rejecting nonzero exit codes |
| `packages/testkit/src/cli/mobile-screenshots.ts` | Maestro screenshots against isolated disposable backend |
| `packages/testkit/src/cli/desktop-performance.ts` | Measures Electron launch, interaction, bundle metrics |
| `packages/testkit/src/cli/compare-performance.ts` | Compares before-and-after performance JSON reports |
| `packages/testkit/src/cli/generate-playwright-report-dashboard.ts` | Builds dashboard, gallery, history from artifacts |
| `packages/testkit/src/cli/generate-mobile-screenshot-gallery.ts` | Builds mobile screenshot gallery HTML page |
| `packages/testkit/src/cli/build-playwright-pr-screenshot-comment.ts` | Generates PR comment from screenshot review |
| `packages/testkit/src/evals/service-contract.ts` | Customer support provider and tool constants |
| `packages/testkit/src/evals/services.ts` | Synthetic Gmail, CRM, GitHub emulator services |
| `packages/testkit/src/evals/runner.ts` | Executes eval trials with cleanup and polling |
| `packages/testkit/src/evals/report.ts` | Trial types, redaction, summarize, control validation |
| `packages/testkit/src/evals/cases.ts` | Sixteen product eval scenarios with grading |
| `packages/testkit/src/evals/sandbox.ts` | Offline eval sandbox blocking shell execution |

~36 `*.test.ts` suites (journeys, authorization, attachments, voice, search, messaging, connections, bot-secrets, postgres/docker variants, canaries) — contents UNVERIFIED.

Gotchas: `pin-test-env` strips live keys unless `VERIFY_PROVIDERS=1`; integration harness clones a pristine template DB per suite; eval reports redact secrets/URLs/emails/paths; computer-replay builds a minimal env allowlist.

## 18. infra, scripts, root config, docs

**infra/compose** — all deployment surfaces.

| File | Summary |
|---|---|
| `infra/compose/docker-compose.yml` | Local development stack with Docker computers |
| `infra/compose/docker-compose.prod.yml` | Production HTTPS stack with updater sidecar |
| `infra/compose/docker-compose.images.yml` | Pull-based published-image self-host stack with supervisor |
| `infra/compose/docker-compose.prod.docker.yml` | Overlay adding local Docker computers to production |
| `infra/compose/docker-compose.topology.yml` | Fixed-secret verification stack for topology tests |
| `infra/compose/docker-compose.postgres-host.yml` | Overlay publishing Postgres on host loopback |
| `infra/compose/Dockerfile` | Production app image building web bundle |
| `infra/compose/Dockerfile.topology` | Verification image reusing production build steps |
| `infra/compose/Caddyfile.prod` | Reverse proxy routing with security headers |
| `infra/compose/Caddyfile.cloudflare.example` | Cloudflare allowlist reverse proxy example configuration |
| `infra/compose/.env.images.example` | Example environment for pull-based image installs |
| `infra/compose/docker-daemon.json` | Daemon log limits and security defaults |
| `infra/compose/deploy-main.sh` | Builds and rolls out origin main |
| `infra/compose/install-images.sh` | Bootstraps secrets and pulls published images |
| `infra/compose/backup-prod.sh` | Verified Postgres dump plus appdata archive |
| `infra/compose/harden-host.sh` | Hardens SSH, firewall, sysctl, audit logging |
| `infra/compose/restrict-computer-egress.sh` | Restricts computer bridges to public egress |
| `infra/compose/run-smokes.sh` | Runs every compose smoke script sequentially |

Five `*.smoke.sh` installer/egress/doc scripts — contents UNVERIFIED. No root Dockerfile or root docker-compose file exists (verified absent).

**infra/sandboxes** — bot computers.

| File | Summary |
|---|---|
| `infra/sandboxes/computer/Dockerfile` | Debian desktop with Xvfb, Chromium, noVNC |
| `infra/sandboxes/computer/start.sh` | Boots Xvfb, window manager, VNC services |
| `infra/sandboxes/computer/control.py` | Token-authenticated desktop control HTTP service |
| `infra/sandboxes/computer/xcapture.c` | Native X11 screen capture shared library |
| `infra/sandboxes/desktop/Dockerfile` | Minimal Xvfb VNC desktop test image |
| `infra/sandboxes/supervisor/src/index.ts` | Docker computer lifecycle HTTP API server |
| `infra/sandboxes/supervisor/src/supervisor-logic.ts` | Screen leases, locks, control fallback helpers |
| `infra/sandboxes/supervisor/src/computer-spec.ts` | Container specs, limits, networks, screen ports |
| `infra/sandboxes/supervisor/src/home-ownership.ts` | Validates computer home directory writability |

`computer/` helper scripts (`rakazo-browser`, `rakazo-page-browser`, `rakazo-focus-or-launch`, `clipboard-bridge.*`, `mobile-keyboard.*`, `embed.html`, `fluxbox.*`, `user-env.sh`, `rakazo-local-bin.sh`, `rakazo-browser.desktop`) and 3 `test_*.py` files — contents UNVERIFIED. 13 supervisor `*.test.ts` suites — contents UNVERIFIED.

Supervisor: one container plus one `rakazo-c*` network per bot, homes at `DATA_DIR/homes/<botId>`; reached via `SANDBOX_SUPERVISOR_URL` + token; checks `x-rakazo-bot-id`/`space-id` headers plus timing-safe bearer.

**infra/updater + systemd.**

| File | Summary |
|---|---|
| `infra/updater/src/index.ts` | Hono update API: plan, apply, rollback |
| `infra/updater/src/updater-logic.ts` | Resolves config, image tags, env parsing |
| `infra/systemd/rakazo-backup.service` | Oneshot service invoking production backup script |
| `infra/systemd/rakazo-backup.timer` | Nightly backup schedule with randomized delay |

9 updater `*.test.ts` suites — contents UNVERIFIED. Updater owns `RAKAZO_IMAGE_TAG`/`_PREVIOUS` in `.env`, recreates `api, worker, web` only, never itself; refuses dirty checkouts, missing `.git`, unknown tags; rollbacks never reverse migrations. Sidecar sits on `control` network only, no ports, no `env_file`.

**scripts/.**

| File | Summary |
|---|---|
| `scripts/backup.sh` | Dumps Postgres and archives data directory |
| `scripts/restore.sh` | Restores database dump and data files |
| `scripts/dev-watch.mjs` | Spawns tsx watch with stdin ignored |
| `scripts/extract-playwright-artifacts.py` | Safely extracts untrusted Playwright ZIP archives |
| `scripts/publish-playwright-report.sh` | Publishes Playwright dashboard and gallery to S3 |
| `scripts/publish-mobile-screenshot-gallery.sh` | Publishes Android screenshot gallery to S3 |

**Root config.**

| File | Summary |
|---|---|
| `package.json` | Defines workspaces, scripts, package manager, overrides |
| `turbo.json` | Configures build, check, test, dev task pipelines |
| `biome.json` | Linter and formatter config excluding generated directories |
| `vitest.config.ts` | Unit test globs with emulator-only environment setup |
| `tsconfig.base.json` | Shared strict TypeScript compiler options base |
| `.env.example` | Documents every environment variable with defaults |

**docs, .agents, .github (top level).** `docs/` holds self-host (4 files), computer-runtime, agent-verification, bot-secrets, desktop-release, mobile-release, performance, tool-activity, ai-data-sharing-review guides (bodies not deep-read). `.agents/skills/` holds `pr-watch` (PR-to-green procedure) and `composio` (For-You vs Platform router) skills. `.github/workflows/` holds 11 pipelines: ci, playwright, computer-replay, topology-verification, nightly-verification, publish-playwright-report, publish-server-image, release-desktop, desktop-macos-screenshot, mobile-android-screenshots, model-catalog-bump.

## 19. Stack, commands, conventions

Stack: pnpm workspaces + turbo; Node 22 (engines allow 22/24/26+); TypeScript strict (`NodeNext`, `verbatimModuleSyntax`); Biome lint/format; Vitest; Postgres 16; Docker Compose; Hono services on `tsx`; Playwright + Maestro + Electron E2E. Gotcha: `packageManager` field says `bun@1.4.2`, but every script, Dockerfile, and CI job uses pnpm — bun appears vestigial.

| Command | Purpose |
|---|---|
| `pnpm dev` | Runs api + worker + web + supervisor via turbo |
| `pnpm build` | Builds all packages via turbo pipeline |
| `pnpm check` | Typechecks every package (`tsc --noEmit`) |
| `pnpm lint` / `pnpm format` | Biome check / check with autofix |
| `pnpm test` | Unit tests, emulator-only via `pin-test-env` |
| `pnpm test:integration` | Postgres journey suites, one cloned DB each |
| `pnpm test:e2e` | Playwright web E2E vs ephemeral API+PG |
| `pnpm test:compose-smoke` | Bash-only compose installer smokes, no Docker |
| `pnpm test:topology` | Full Docker topology recovery and isolation asserts |
| `pnpm test:computer-replay` | Offline Docker replay, no inference by default |
| `pnpm test:computer` | Live computer E2E, needs provider keys |
| `pnpm test:canary` | Live provider canaries, needs provider keys |
| `pnpm test:pi` | Offline Pi plus emulator focused tests |
| `pnpm test:evals` | Real-model product evals, `--live` required |
| `pnpm test:mobile-screenshots` | Maestro Android flows, needs `DATABASE_URL` |
| `pnpm perf:desktop` / `perf:compare` | Electron benchmark / before-after compare |
| `pnpm compose:up` / `compose:down` | Dev compose up `--build` / down with volumes |
| `pnpm sandbox:build` | Builds the rakazo computer local image |
| `pnpm db:generate` / `db:migrate` | Prisma generate / migrate via db package |

Conventions: top-level `import type`, never inline; dynamic `import()` only for deferred loading; shared behavior in packages, platform-only code in apps; provider-neutral interfaces with offline conformance for new vendors; deterministic offline tests by default; monochrome UI with semantic tokens; no provider/model-specific env vars when generic connection expresses it.

## 20. Critical invariants (must never break)

- **Tenant isolation.** Space is the tenant. Every RPC path requires `requireMembership`; every repo filters `spaceId` (+ `userId` where present); misses throw `IsolationError`, never empty fallthrough. No Postgres RLS exists — do not assume the database enforces anything.
- **Auth edge.** Cookie session via Better Auth; web holds no tokens. `authed` gate throws UNAUTHORIZED on missing actor. Webhook/GitHub routes return identical 401s (no bot-ID enumeration). Bodies are bounded before target lookup.
- **Owner gates.** Space secrets, memory LAN endpoints, private endpoints (`MCP_ALLOW_PRIVATE_ENDPOINT` excepted), screen-proxy interactive targets (capability + generation match + control lease), local-settings RPC (64-hex token + deployment owner), updater status/check/apply (`isDeploymentOwner`).
- **Event + seq integrity.** Thread writes go through `nextEventSeq`/`nextMessageSeq` counters in-transaction with `appendEventInTransaction`; notify fanout is best-effort after commit. Never invent sequence numbers client-side.
- **Idempotency.** `Message @@unique([threadId, clientNonce])`, `Run @@unique([spaceId, clientNonce])` with `send:<messageId>` keys; losers replay the winner. Approval effects use stable idempotency keys (`approval-effect-key`).
- **Run state machine.** `core/run-state` transitions are enforced on write; cancel/expire paths run inside transactions. Reconciler repairs missed wakes — do not add parallel schedulers.
- **Job ownership.** API enqueues, worker consumes; worker never polls messaging inbound; API runs handlers only in in-memory mode. One credential binds to exactly one Space.
- **Secrets.** AES-GCM at rest; redaction in logs (`email/prompt/messages/headers/*token*`); secrets never reach model-visible payloads; `0600`/umask-077 files; random-hex `POSTGRES_PASSWORD` must stay URI-safe.
- **Sandbox boundaries.** Per-bot Docker networks stop cross-bot traffic; supervisor/updater hold the Docker socket (root-equivalent) and stay unexposed; `SANDBOX_COMPUTER_EGRESS=restricted` needs the host egress script (Linux iptables backend only); `down -v` deletes all Postgres state.
- **Screen leases.** Takeover requires capability secret + bot/computer generation match + active control lease; proxy strips auth/cookie/host headers and rechecks authorization on interval.
- **Space deletion.** Two-phase claim → provider destroy → delete with 5-minute stale-claim recovery; content creation holds the same advisory lock and rejects `deletingAt` spaces.
- **Desktop trust.** Renderer is unprivileged; setup IPC refuses non-setup senders; bundled renderer only for managed loopback stack; `/api`, `/rpc`, `/novnc` always pass through.
- **Mobile trust.** Session token in SecureStore; endpoint allowlist mirrors native LAN rules; HTML preview has no session access.
- **Conformance.** New providers reuse `adapter-kit` contracts plus deterministic offline doubles; every slot asserts `contractVersion: "1"`.

## 21. Keeping this updated

Any agent that changes the repo structure or adds main files must update this file in the same change: add the new path with a 5–10 word summary under the correct module section, adjust the annotated tree in §3 if top-level layout changed, and update commands in §19 if scripts changed. Keep summaries 5–10 words, mark unverified claims UNVERIFIED, and never list generated output, vendored deps, or lockfiles.
