# mobile-context.md — Mobile / iOS cold-start reference

Companion to `AGENTS.md`. Same rules apply (`RULES.md`, `GIT-SKILLS.md`).
Scope: `apps/mobile` only (Expo native, iOS + Android, no embedded web).

> How to read: §1–§3 give the whole picture. §4–§7 are per-directory deep dives — jump to the one you need. Every file summary is 5–10 words. Anything not directly verified in code is tagged UNVERIFIED. Generated output, vendored deps, and lockfiles are skipped. Path rule: a full `apps/mobile/...` path is repo-rooted; a bare filename in a table resolves under that section's root plus the directory in the table caption (e.g. `rpc` under `lib/` means `apps/mobile/lib/api.ts`).

## 1. Architecture quick

**Layers (mobile view).**

```
apps/mobile (Expo 57, RN 0.86.3, React 19.2) — native client
  → apps/api (Hono + oRPC, sole HTTP authority)
  → apps/worker (job consumer, no HTTP auth surface)
Shared (mobile imports only these)
  packages/contracts (Zod + oRPC shapes), packages/core (pure domain),
  packages/ui-tokens (TS palette), packages/chat-ui (markdown renderers)
  Mobile does NOT depend on packages/db.
```

**Request flow (mobile → response).**

```
expo-router/entry → app/_layout.tsx Layout
  loadApiBase + appearance + avatarStyle + i18n + resumeLiveNotifications
  rpc(proc, body) POSTs {currentApiBase()}/rpc/{proc} {json: body}
    headers: authorization Bearer + x-rakazo-space-id, origin rakazo://
    timeouts: RPC 8s, probe 8s/64KB, RPC resp cap 16MB
  → api: getSession → requireMembership → actor{userId, spaceId}
  → transactional write + events.notify → worker executor
  → PostgresRealtimeFanout → SSE threads/subscribe → client reducers
```

**Multi-tenant model: Space is the tenant.** Every authed call sends `x-rakazo-space-id` (`lib/api.ts:authHeaders`). Backend `requireMembership` (`packages/db/src/scope.ts`) gates; misses throw `IsolationError`. No Postgres RLS. One credential binds exactly one Space; endpoint switch wipes session+space atomically.

**API → worker handoff (mobile-irrelevant, do not touch from mobile).** Shared Postgres queue, default `WAKEUP_DRIVER=graphile`; worker never polls messaging inbound.

## 2. Platform quick — iOS view vs Android view

| Surface | Stack | Entry | Build/run |
|---|---|---|---|
| Mobile | Expo managed + Expo Router | `expo-router/entry` → `app/_layout.tsx` | `start` expo start; `android` / `ios` run |

**iOS specifics** (`app.json` ios: `com.rakazo.app`, `supportsTablet: false`, shared `Rakazo.icon`, `usesNonExemptEncryption: false`; camera, photo-library, local-network descriptions; `NSAllowsLocalNetworking: true`).

| Item | Behavior |
|---|---|
| `with-scene-lifecycle.js` | Adopts UIScene factory for iOS 26 SDK |
| `with-worklets-headers.js` | Adds Worklets headers for Reanimated release |
| Orientation | Portrait locked in `_layout.tsx`; `computer.tsx` + `image.tsx` unlock while open |
| Symbols | `NativeSymbol` renders SF Symbols, Ionicons fallback |
| Sheets | `ActionSheetIOS` for message actions; `pageSheet` for select-text/schedule/sign-in sheets; `formSheet` for change-password |

**Android specifics** (`app.json` android: `com.rakazo.app`, `versionCode 10`, `resize` keyboard, raster + adaptive/monochrome icons).

| Item | Behavior |
|---|---|
| Native module | `modules/rakazo-notifications`, Android-only, loaded only when `Platform.OS === "android"` |
| Service | Foreground `remoteMessaging` service polling `runs/list` every 8s |
| Channels | 4 channels (live/messages/scheduled/attention) |
| Storage | Keystore AES-GCM session token |
| Deep links | `rakazo://thread` + `rakazo://group-thread` intents |
| Allowlist | `EndpointAllowlist.kt` mirrors LAN rules (10/8, 172.16/12, 192.168/16, 100.64/10, `.local`, loopback) |

**Mobile ↔ web relationship.** None embedded — all screens native. Only `computer.tsx` (noVNC) and `SandboxedHtmlPreview` use `react-native-webview`; HTML preview disables cookies/storage and locks navigation to `about:blank`.

## 3. Annotated directory tree (mobile only)

```
apps/mobile/
  app/              Expo Router screens (22 files, 21 Stack.Screen + _layout)
  components/       Native avatars, cards, sheets, viewers (+ ui/ extras)
  lib/              API client, session, notifications, voice, inbox (+ 44 *.test.ts)
  modules/rakazo-notifications/  Android-only foreground notification module
  plugins/          Expo config plugins applied at prebuild
  .maestro/         Opt-in flows (smoke, notification-demo, screenshots)
  app.json          Expo config (ios/android/plugins/scheme rakazo)
  app.config.ts     Requires HTTPS EXPO_PUBLIC_API_URL for EAS prod
```

Entry: `main: expo-router/entry` (`package.json:5`) → `app/_layout.tsx` `Layout()` → boot (`loadApiBase`, appearance, avatarStyle, i18n, `resumeLiveNotifications`) → `Stack` + global `<ComputerUpdateProgress />` + `<CallCard />` overlays.

## 4. app/ — routes

| File | Summary |
|---|---|
| `_layout.tsx` | Root layout, theme, splash, 21 screens, overlays |
| `index.tsx` | Inbox home with spaces, search, activity |
| `sign-in.tsx` | Email auth plus custom server sheet |
| `thread.tsx` | Bot conversation with composer, streaming, attachments |
| `group-thread.tsx` | Re-exports single thread screen implementation |
| `new.tsx` | Creates bot then opens its thread |
| `new-group.tsx` | Creates group from selected member bots |
| `new-space.tsx` | Creates space then selects it home |
| `account.tsx` | Manages profile, locale, notifications, sessions |
| `ai-data-sharing.tsx` | Manages per-recipient mobile AI permissions |
| `artifact.tsx` | Shows artifact versions with share support |
| `artifacts.tsx` | Lists, searches space artifacts with pagination |
| `bot-settings.tsx` | Edits bot profile, model, computer mode |
| `change-password.tsx` | Changes password with confirmation validation |
| `computer.tsx` | Embeds noVNC desktop with takeover controls |
| `group-settings.tsx` | Renames group, edits membership, deletes |
| `image.tsx` | Fullscreen image viewer managing orientation locks |
| `integration-setup.tsx` | First-run provider credential onboarding flow |
| `integrations.tsx` | Browses connector catalog, manages connections |
| `models.tsx` | Configures providers, keys, OAuth, thinking levels |
| `routine.tsx` | Displays routine schedule, prompt, thread link |
| `voice.tsx` | Configures voice provider and device speech |

Large screens (`thread`, `models`, `integrations`, `index`, `account`) partially read — detail UNVERIFIED where noted.

## 5. components/

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
| `ui/badge.tsx` | Tint status badge, neutral default variant |
| `ui/glass.tsx` | Liquid-glass surface with blur fallback |
| `ui/glass-button.tsx` | Circular glass bar button with haptics |

## 6. lib/

| File | Summary |
|---|---|
| `api.ts` | Authenticated RPC client, spaces, thread subscriptions |
| `session.ts` | Stores session token in SecureStore securely |
| `endpoint.ts` | Normalizes and probes custom server URLs |
| `auth-routing.ts` | Defines sign-in mode and route constants |
| `native.ts` | Maps shared tokens to PlatformColor chrome |
| `appearance.ts` | Persists light, dark, system theme choice |
| `theme.ts` | Re-exports shared product palette tokens |
| `design.ts` | Spacing, radii, type, badge design system |
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

44 `lib/*.test.ts` suites mirror modules above (contents UNVERIFIED).

## 7. Native module + plugins + config + flows

| File | Summary |
|---|---|
| `modules/rakazo-notifications/package.json` | Declares private Android notification module |
| `modules/rakazo-notifications/expo-module.config.json` | Registers Android-only Expo native module |
| `modules/rakazo-notifications/android/build.gradle` | Builds Android library via Expo plugin |
| `modules/rakazo-notifications/android/src/main/AndroidManifest.xml` | Declares notification and foreground service permissions |
| `modules/rakazo-notifications/android/src/main/java/com/rakazo/notifications/EndpointAllowlist.kt` | Allows HTTPS or local-network HTTP endpoints |
| `modules/rakazo-notifications/android/src/main/java/com/rakazo/notifications/NotificationStorage.kt` | Encrypts token via Keystore, stores settings |
| `modules/rakazo-notifications/android/src/main/java/com/rakazo/notifications/RakazoNotificationsModule.kt` | Exposes settings, resume, stop to JavaScript |
| `modules/rakazo-notifications/android/src/main/java/com/rakazo/notifications/RakazoNotificationService.kt` | Polls runs every 8s, posts thread notifications |
| `modules/rakazo-notifications/android/src/main/res/drawable/ic_rakazo_notification.xml` | White two-bar vector notification icon |
| `plugins/with-scene-lifecycle.js` | Migrates iOS AppDelegate to UIScene lifecycle |
| `plugins/with-worklets-headers.js` | Adds Worklets headers for Reanimated iOS |

`.maestro/` flows: `smoke.yaml` (sign-in, create bot, message, computer), `notification-demo.yaml`, `screenshots.yaml`; opt-in, needs emulator plus disposable account; PR CI excluded.

Public interfaces: `rpc()` against `currentApiBase()` (default `EXPO_PUBLIC_API_URL` else loopback `http://127.0.0.1:3100`), session bearer from SecureStore, Space header with rollback recovery. SecureStore keys: `rakazo.session_token`, `rakazo.api_base`, `rakazo.space_id`, `rakazo.space_rollback`, `rakazo.avatar-style`. Deep links: `rakazo://thread`, `rakazo://group-thread`.

Gotchas: `lib/native.ts` is the shared-vs-native seam (shared tokens via `mobileTokens()`, system chrome via PlatformColor only when preference is `system`); storage is `expo-secure-store` throughout; mobile does NOT import `ui-web`; iOS/Android specifics in §2.

## 8. Lookup quick

```sh
pnpm --filter @sapphire/mobile start    # expo start
pnpm --filter @sapphire/mobile android  # expo run:android
pnpm --filter @sapphire/mobile ios      # expo run:ios
pnpm --filter @sapphire/mobile check    # expo install --check + tsc --noEmit
pnpm --filter @sapphire/mobile test     # vitest run --root ../.. apps/mobile/lib
pnpm --filter @sapphire/mobile test:e2e # maestro test .maestro/smoke.yaml
DATABASE_URL=postgres://... pnpm test:mobile-screenshots  # disposable backend + Maestro gallery
```

Conventions: top-level `import type`, never inline; dynamic `import()` only for deferred loading (`expo-audio`, `expo-speech`, `expo-speech-recognition`); native-first (Expo Router, Expo UI, native sheets/menus/alerts/pickers); custom surfaces use plain StyleSheet + shared tokens via `lib/appearance.ts`; system chrome via PlatformColor in `lib/native.ts`; monochrome UI (primary ink, destructive/success/warning status, bots carry only identity color); deterministic offline tests by default.

Security: SecureStore throughout; endpoint allowlist mirrors native LAN rules; HTML preview has no session access; never commit secrets; never log bearer tokens.

Testing: unit via `lib/*.test.ts`; Maestro opt-in (emulator + disposable account); for UI PRs with native-only mobile UI, say so on the PR instead of linking a web screenshot.

## 9. Critical invariants (mobile subset)

- **Tenant isolation.** Space is the tenant. Mobile sends `x-rakazo-space-id` on every authed call. Backend `requireMembership` + `IsolationError`; no Postgres RLS — do not assume DB enforcement.
- **Auth edge.** Session bearer from SecureStore, never hardcoded. 401 with stale Space probes once without header; safe retry only for `spaces/list`/`me`; mutations never replay. Endpoint change wipes session+space, restores both on failure.
- **Owner gates.** Space secrets, memory LAN endpoints, private endpoints, screen-proxy interactive targets, local-settings RPC, updater — all backend-gated; mobile only surfaces state.
- **Event + seq integrity.** Thread writes go through server-side counters; never invent sequence numbers client-side. SSE `threads/subscribe` has 45s idle timeout; thread poll interval varies by status (750ms/1500ms/5000ms).
- **Mobile trust.** Endpoint allowlist mirrors native LAN rules; prod EAS requires HTTPS `EXPO_PUBLIC_API_URL`; HTML preview has no session access.
- **Notifications.** Android foreground poll every 8s; open tapped notification exactly once (occurrence-key claim); 4 channels (live/messages/scheduled/attention).
- **Orientation.** Portrait locked globally; `computer.tsx` + `image.tsx` unlock while open, relock on close.
- **Conformance.** New providers reuse `adapter-kit` contracts plus offline doubles; mobile adds no vendor SDKs outside adapters/composition roots.

## 10. Keeping this updated

Any agent that changes `apps/mobile` structure or adds main files must update this file in the same change: add the new path with a 5–10 word summary under the correct section, adjust the tree in §3 if layout changed, and update commands in §8 if scripts changed. Keep summaries 5–10 words, mark unverified claims UNVERIFIED, and never list generated output, vendored deps, or lockfiles.
