# Plan: Local-first models — free on-device inference + honest model UI

## 1. Objective

Sapphire runs its whole backend natively on the Mac, then asks the user for
a cloud API key on the "Connect a model" screen. That is backwards. The
product direction is **local-first**: free on-device inference that works
with zero keys, with cloud providers kept as an explicit opt-in.

Two tracks, two subagents, one shared contract surface:

- **Track A (UI):** onboarding + model settings lead with a local-model
  option (no key), and the model dropdowns meet DESIGN.MD spacing.
- **Track B (backend):** port OpenMausBot's *validated inference-driving
  logic only* (no UI, no design, no assets, no copy) behind Sapphire's
  provider-neutral contracts, and prove a real model answers through it.

## 2. Fixed facts (verified, do not re-investigate)

- `packages/adapters/src/pi-local-provider.ts` already speaks to an
  OpenAI-compatible endpoint (`RAKAZO_LOCAL_MODELS_URL`,
  `RAKAZO_LOCAL_MODELS` ids). The seam exists; it is not surfaced in UI
  and has no bundled server behind it.
- Ollama is installed (`/opt/homebrew/bin/ollama`), serving
  `http://127.0.0.1:11434` with **zero models**. Any real-inference test
  must first pull a small CPU-runnable instruct model and record
  name, bytes, and time.
- OpenMausBot (`OpenMausBot/`, sibling checkout, Apache-2.0 — same as
  Sapphire) drives models through `server/drivers/` (`pi.ts`,
  `local-inject.ts`, `acp/` incl. an opencode client). Read that code;
  do not guess what it does.
- `OpenMausBot/` is gitignored. It must never be committed.
- Honesty rule for provider claims: Devin is a cloud product (not free);
  Claude Code / Codex CLIs spend the user's own subscriptions where
  present. Only local weights are actually free. Verify each claim with
  a real run and report what was free vs key-gated.
- Sapphire repo rules that still bind: provider-neutral interfaces in
  `adapter-kit` (vendor SDKs live only in `adapters` + composition
  roots), deterministic offline tests by default, no secrets in commits,
  monochrome UI under DESIGN.MD, hugeicons only for icons.

## 3. Explicit non-goals

- No OpenMausBot UI, design tokens, styles, assets, mascot, docs, or copy.
  DESIGN.MD governs every pixel changed here.
- No deletion of cloud providers from the catalog; local becomes first,
  cloud stays opt-in.
- No Better Auth / session / Space changes.
- No migration-history or schema changes.
- No commits or pushes by subagents (coordinator reviews, commits, pushes).

## 4. Track A — model UI goes local-first (subagent A)

Primary files: `apps/web/src/pages/Onboarding.tsx`,
`apps/web/src/pages/ModelSettingsOverlay.tsx` (check exact name),
model picker/combobox components under `apps/web/src`,
`packages/ui-web` select/dropdown primitives if the bug is there.

1. **Local option first.** The "Connect a model" flow must offer a local
   model path that asks for **no API key**: detect a reachable local
   endpoint, list its models, let the user pick one, continue. Cloud
   providers stay below as explicit opt-in. Follow the existing
   onboarding step structure; do not redesign the page.
2. **Dropdown padding (the reported bug).** Items render flush against the
   popover edge. Apply DESIGN.MD "Dropdowns, selects, popovers" exactly:
   content `rounded-lg border border-neutral-800 bg-neutral-850`,
   `shadow-none`, no ring; section labels `px-1.5 py-1 text-[12px]
   text-neutral-500 cursor-default`; items `cursor-pointer rounded-md
   px-1.5 py-1 text-[14px] font-normal hover/focus:bg-neutral-800`;
   trigger keeps label-left/chevron-right with `cursor-pointer`; blur
   in/out motion only, never slide/zoom. If the bug is in the vendored
   primitive, fix it in `packages/ui-web` so every consumer heals.
3. **Proof (mandatory, not smoke):** drive the real packaged app with
   Playwright (`apps/desktop/e2e/` conventions, isolated temp profile):
   screenshot the onboarding model step and the open dropdown, READ each
   PNG with the Read tool, and confirm with your own eyes: local option
   present without a key field, dropdown text padded on all sides, zero
   console/page errors. Extend the repo e2e (not a scratch file) so the
   assertions survive: local option visible, `ariaSnapshot` shows padded
   items, continue works keyless against the Track B backend if ready
   (coordinate endpoint/port with Track B; do not hardcode clashing ports).

## 5. Track B — local inference provider (subagent B)

Primary files: `OpenMausBot/server/drivers/` (read-only source),
`packages/adapter-kit/src/*` (contracts — extend only if the existing
`ModelProvider`/catalog slots cannot express it),
`packages/adapters/src/pi-local-provider.ts`,
`packages/adapters/src/model-selection.ts`,
`packages/adapters/src/pi-models.ts`, model credential/selection
plumbing (`UserModelCredential`, space preferences), `apps/api`,
`apps/worker` composition roots.

1. **License gate first.** Read `OpenMausBot/LICENSE` + `NOTICE`. Record
   the license and what attribution Sapphire owes for ported code. If the
   terms forbid it, stop and report instead of copying.
2. **Investigate before extracting.** Map how OpenMausBot lists local
   models, spawns/drives inference (opencode CLI? codex? raw
   OpenAI-compatible HTTP? bundled runner?), streams tokens, reports
   errors, and detects absence. Write the 1-page mechanism summary into
   the final report.
3. **Extract the minimum.** Port only the validated driving logic, adapted
   to `adapter-kit` contracts (new slot only if no existing slot fits;
   prefer extending `pi-local-provider`/`model-selection`). If the code
   is too big to adapt cleanly, copy the smallest working unit verbatim
   (with attribution comment + NOTICE update if required), then simplify
   in place. No vendor SDKs outside `adapters`; no UI changes (Track A
   owns all pixels).
4. **Wire selection end to end:** local models appear in the model
   catalog, can be chosen per bot/space, persist like other credentials
   (no key material for keyless local), and the executor streams a real
   completion through them.
5. **Proof (mandatory):** unit tests with fakes for the new provider
   (selection, errors, absence, malformed responses) PLUS one real run:
   pull a small instruct model into local Ollama, send a real prompt
   through the Sapphire stack, and quote the reply. Record model name,
   download size, and latency. If no local server can be produced,
   report Blocked with the exact missing piece — never claim success
   from fakes alone.

## 6. Contracts and safety invariants

- Local inference binds loopback only, current desktop user, no elevated
  privileges. No LAN exposure, no telemetry, no model downloads without
  explicit user action in UI.
- Model files live outside the repo and outside the app bundle
  (user data dir); never commit weights.
- Secrets stay in existing credential stores; keyless local stores no key.
- Existing cloud flows keep working (regression: current model unit
  tests stay green; do not weaken them).
- Do not touch these in-flight files (uncommitted work lands
  separately): `apps/desktop/e2e/native-local.spec.ts`,
  `apps/desktop/src/local-backend.ts`,
  `apps/desktop/src/local-backend.test.ts`, `apps/web/index.html`,
  `apps/web/src/App.tsx`, `packages/ui-tokens/src/index.ts`,
  `packages/ui-tokens/src/appearance.test.ts`.

## 7. Acceptance Run (both tracks, real app)

1. Clean pack of the desktop app.
2. Fresh temp profile → setup → This computer → Continue.
3. Onboarding model step shows a **local model option with no key
   field**; screenshots show it.
4. Pick it; the app reaches the shell; send a chat message; a real
   reply streams back from the local model.
5. Open a model dropdown; screenshot shows DESIGN.MD padding on every
   item; no console/page/main errors at any step.
6. Relaunch on the same profile: choice persists, no re-prompt.

## 8. Verification and reporting

- Subagents: typecheck + unit tests for every touched package; Playwright
  evidence (screenshots READ by the agent, traces on failure); report
  using only: Verified working / Fix applied, not verified /
  Not fixed / Blocked, with files changed, tests run + outcome, and
  remaining risks. No commits, no pushes — leave the tree dirty for
  coordinator review.
- Coordinator: final e2e, screenshot review, commit (specific paths),
  push, user-facing report.
