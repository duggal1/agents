# Plan: Local-first models — UI fix + OpenMausBot backend integration

## Summary

Fix two critical issues: (1) UI currently demands API key for models but should offer free local models first with no key, (2) dropdown items have zero padding (text flush against edge). Then port validated local inference logic from OpenMausBot (Apache 2.0 licensed) to support free on-device inference via OpenCode, pi, and OpenAI-compatible local hosts (Ollama, oMLX, EXO, LM Studio, Unsloth).

## 1. License verification (MUST DO FIRST)

**OpenMausBot License**: Apache License 2.0
- Permits: reproduction, preparation of derivative works, distribution, modification
- Requirements: preserve copyright notice, include license copy, state changes with prominent notices, include NOTICE file attribution
- Attribution needed: "OpenMausBot, Copyright 2026 Milind Soni and OpenMausBot contributors, used under Apache License 2.0"

**NOTICE file dependencies to track**:
- T3 Code (MIT) - Google Antigravity ACP integration
- hpke-js (MIT) - secure phone credential transport
- models.dev (MIT) - provider/model data
- opencode (MIT) - cache/refresh logic
- noVNC (MPL-2.0) - desktop viewer (not used here)
- WebRTC (BSD 3-Clause) - companion app (not used here)

**Action**: Before copying any code, add to Sapphire's NOTICE file:
```
Local model discovery and OpenCode integration adapts code from OpenMausBot,
Copyright 2026 Milind Soni and OpenMausBot contributors, used under the Apache
License 2.0. The full license text is in third_party/openmausbot/LICENSE.
```

## 2. Track A — UI fixes (Subagent A)

### 2.1 Files to inspect and modify

**Primary targets**:
- `apps/web/src/pages/Onboarding.tsx` - onboarding model selection step
- `apps/web/src/pages/ModelSettingsOverlay.tsx` - model settings dialog
- `packages/ui-web/src/components/ui/select.tsx` - dropdown primitive (if padding bug is here)
- `packages/ui-web/src/components/ui/dropdown-menu.tsx` - dropdown menu primitive (if used)
- `packages/ui-web/src/components/ui/command.tsx` - command palette (if used for model picker)

### 2.2 Task A1: Local-first model option (no API key required)

**Current problem**: Screenshots show "Connect a model" asking for API key. Local models should be available first with zero key configuration.

**Implementation**:
1. Detect if a local endpoint is reachable (Ollama at `http://127.0.0.1:11434`, or other OpenAI-compatible hosts)
2. Probe `/models` endpoint to list available models
3. Present local models at the TOP of the model picker, before cloud providers
4. When a local model is selected, show no API key field (keyless inference)
5. Cloud providers remain as opt-in options below local section

**UI flow**:
- Onboarding model step:
  - Section header: "Local models (free, no key)"
  - List detected local models (e.g., "llama3.2 (Ollama)", "qwen2.5 (oMLX)")
  - Section header: "Cloud providers (requires key)"
  - List OpenAI, Anthropic, etc. (existing flow)
- ModelSettingsOverlay: same structure

**Retrofit path**:
- Check if `packages/adapters/src/pi-local-provider.ts` already has endpoint detection
- If not, add a lightweight probe function (async fetch with 1s timeout)
- Wire probe results into the model catalog used by Onboarding/ModelSettingsOverlay

### 2.3 Task A2: Fix dropdown padding (DESIGN.MD compliance)

**Current problem**: Dropdown items render flush against popover edge with zero padding.

**DESIGN.MD required spec** (§"Dropdowns, selects, popovers, command palette"):
- Content surface: `rounded-lg border border-neutral-800 bg-neutral-850`, `shadow-none`, no ring
- Section labels: `px-1.5 py-1 text-[12px] text-neutral-500 cursor-default`
- Items: `cursor-pointer rounded-md px-1.5 py-1 text-[14px] font-normal hover/focus:bg-neutral-800`
- Trigger: `cursor-pointer`, label left, chevron right

**Implementation**:
1. Identify which primitive is broken (Select, DropdownMenu, or Command)
2. Apply the exact DESIGN.MD classes to:
   - Popover/dropdown content wrapper
   - Section labels (if any)
   - Individual items
3. Ensure trigger has `cursor-pointer`
4. Verify no hardcoded `px-0` or padding removal in parent components

**Test**: After fix, visually inspect dropdown - text must have clear 6px (1.5rem) padding on all sides.

### 2.4 Task A3: Real-world verification (mandatory)

**Using desktop Playwright e2e** (`apps/desktop/e2e/` conventions):
1. Launch packaged Electron app with isolated temp profile
2. Navigate to onboarding model step
3. Screenshot the model picker with dropdown open
4. READ the PNG with the Read tool and confirm:
   - Local model section visible at top
   - No API key field shown when local model selected
   - Dropdown items have proper padding (not flush to edge)
5. Extend existing e2e test to assert:
   - Local option exists (aria label or text)
   - Dropdown ariaSnapshot shows padded items
   - Zero console/page errors during flow
6. If Track B backend is ready, coordinate to test against a real local endpoint

**Do not**: Use smoke tests, claim success without screenshots, skip reading the PNG.

## 3. Track B — Backend local inference (Subagent B)

### 3.1 Files to inspect and modify

**Source (OpenMausBot, read-only)**:
- `server/drivers/local-inject.ts` - local host probing, model discovery, inject encoding
- `server/drivers/pi.ts` - pi agent driver, model catalog merging
- `server/drivers/acp/opencode-go.ts` - OpenCode CLI driver, model parsing
- `server/drivers/acp/core.ts` - ACP driver foundation

**Destination (Sapphire)**:
- `packages/adapter-kit/src/*` - contracts (extend only if existing slots insufficient)
- `packages/adapters/src/pi-local-provider.ts` - existing OpenAI-compatible local provider
- `packages/adapters/src/model-selection.ts` - model selection logic
- `packages/adapters/src/pi-models.ts` - pi-specific model handling
- `apps/api/src/*` - composition root (if any wiring needed)
- `apps/worker/src/*` - executor composition (if any wiring needed)

### 3.2 Task B1: Mechanism investigation (write 1-page summary)

Before copying, understand and document:

**From `local-inject.ts`**:
- How `LOCAL_HOSTS` list is structured (id, label, baseUrl, apiKey handling)
- How `probeLocalInjects()` discovers models from multiple hosts (Ollama, oMLX, EXO, LM Studio, Unsloth)
- How `encodeInjectId()` / `decodeInjectId()` encode `host::model` format
- How `mergeLocalInject()` augments existing catalog with local models
- How `applyOpenAIInject()` / `applyClaudeInject()` redirect CLI env vars to local host

**From `pi.ts`**:
- How pi speaks JSON-RPC over stdio
- How `get_available_models` returns model catalog
- How local inject models are merged into pi's catalog
- How `set_model` splits `provider/modelId` composites

**From `acp/opencode-go.ts`**:
- How OpenCode CLI is spawned and queried
- How `models --verbose` output is parsed
- How free vs paid models are detected (`cost: {input: 0, output: 0}` or `-free` suffix)
- How local model records are identified (`api.url` is localhost)

**Output**: Write mechanism summary to `work/plan/new-features/local-inject-mechanism.md` (1 page max).

### 3.3 Task B2: Extract and adapt minimum logic

**Strategy**: Port only the validated driving logic. If code is too large to adapt cleanly, copy the smallest working unit verbatim with attribution comment, then simplify in place.

**Minimum extraction**:

1. **Local host probing** (from `local-inject.ts`):
   - Copy `LOCAL_HOSTS` constant (or subset: Ollama, oMLX, EXO, LM Studio, Unsloth)
   - Copy `probeLocalInjects()` function
   - Copy `encodeInjectId()` / `decodeInjectId()` helpers
   - Copy `mergeLocalInject()` function
   - Adapt to Sapphire's model catalog contract

2. **OpenCode integration** (from `acp/opencode-go.ts`):
   - Copy OpenCode CLI spawning logic
   - Copy `parseOpenCodeModels()` function
   - Copy `isFreeOpenCodeModel()` function
   - Adapt to Sapphire's provider interface

3. **Pi integration** (from `pi.ts`):
   - Copy pi JSON-RPC protocol handling
   - Copy `get_available_models` catalog parsing
   - Copy model merging logic
   - Adapt to Sapphire's adapter-kit contracts

**Attribution**: At top of each copied file, add:
```typescript
// Portions adapted from OpenMausBot (server/drivers/local-inject.ts)
// Copyright 2026 Milind Soni and OpenMausBot contributors
// Licensed under Apache License 2.0
// Full license: third_party/openmausbot/LICENSE
```

**Contract alignment**:
- Extend `adapter-kit` contracts only if existing `ModelProvider`/catalog slots cannot express local hosts
- Prefer extending `pi-local-provider.ts` rather than creating new provider
- Ensure keyless local models store no secret (empty string or sentinel value)

### 3.4 Task B3: Wire selection end-to-end

**Requirements**:
1. Local models appear in the model catalog (returned by backend RPC)
2. Local models can be chosen per bot/space (like other credentials)
3. Choice persists like other credentials (keyless = no key material stored)
4. Executor streams real completions through local provider
5. Existing cloud flows keep working (regression test: current model unit tests stay green)

**Data flow**:
- `packages/adapters/src/model-selection.ts` - add local model to selection logic
- `packages/db/src/*` - credential storage (keyless local models store empty key)
- `apps/api/src/*` - RPC handler returns augmented catalog with local models
- `apps/worker/src/*` - executor uses local provider when selected

### 3.5 Task B4: Verification (mandatory, not fakes)

**Unit tests**:
- Fake local host probe (return canned model list)
- Test `encodeInjectId()` / `decodeInjectId()` roundtrip
- Test `mergeLocalInject()` catalog augmentation
- Test error handling (host unreachable, malformed response, absence)
- Test keyless credential storage/retrieval

**Real run** (actual Ollama required):
1. Pull a small instruct model: `ollama pull qwen2.5:0.5b` or `ollama pull llama3.2:1b`
2. Record model name, download size, and pull time
3. Send a real prompt through Sapphire stack using the local model
4. Quote the actual reply in verification report
5. Measure and report latency (first token + completion time)

**Fallback if no local server available**:
- Report "Blocked: cannot produce local server for verification"
- Specify exact missing piece (e.g., "Ollama not installed on test machine")
- Do NOT claim success from fakes alone

## 4. Invariants and safety checks

**Never violate**:
- Local inference binds loopback only (127.0.0.1/localhost), current desktop user, no elevated privileges
- No LAN exposure, no telemetry, no model downloads without explicit user action in UI
- Model files live outside repo and outside app bundle (user data dir)
- Never commit weights or model files
- Secrets stay in existing credential stores; keyless local stores no key
- Existing cloud flows keep working (regression guard)
- Do not touch in-flight files (see plan §6 "Explicit non-goals")

**Files NOT to modify** (uncommitted work lands separately):
- `apps/desktop/e2e/native-local.spec.ts`
- `apps/desktop/src/local-backend.ts`
- `apps/desktop/src/local-backend.test.ts`
- `apps/web/index.html`
- `apps/web/src/App.tsx`
- `packages/ui-tokens/src/index.ts`
- `packages/ui-tokens/src/appearance.test.ts`

## 5. Acceptance Run (both tracks combined)

1. Clean pack of desktop app
2. Fresh temp profile → setup → "This computer" → Continue
3. Onboarding model step shows:
   - Local model section at top (e.g., "qwen2.5:0.5b (Ollama)")
   - No API key field when local model selected
   - Cloud providers below as opt-in
4. Pick local model → app reaches shell
5. Send chat message → real reply streams from local model
6. Open model dropdown → screenshot shows DESIGN.MD padding on every item
7. Check logs: zero console/page/main errors at any step
8. Relaunch on same profile → choice persists, no re-prompt

## 6. Subagent coordination

**Subagent A (UI)**:
- Profile: `subagent_general` (needs write access for UI changes)
- Scope: Onboarding.tsx, ModelSettingsOverlay.tsx, ui-web primitives
- Goals: Local-first UI, dropdown padding fix, Playwright verification
- No backend changes (Track B owns all adapter logic)

**Subagent B (Backend)**:
- Profile: `subagent_general` (needs write access for adapter code)
- Scope: adapters packages, api/worker composition
- Goals: Port OpenMausBot local inference logic, wire end-to-end, real verification
- No UI changes (Track A owns all pixels)

**Coordinator (this agent)**:
- Launch both subagents in parallel
- Review their outputs before integration
- Run final Acceptance Run
- Update NOTICE file with attribution
- Add OpenMausBot to .gitignore
- Commit and push (following GIT-SKILLS.md: main branch, add/commit/push every task)

## 7. Execution order

1. **Coordinator**: Read OpenMausBot LICENSE and NOTICE, add attribution to Sapphire NOTICE
2. **Parallel launch**:
   - Subagent A: UI fixes (A1, A2, A3)
   - Subagent B: Backend integration (B1, B2, B3, B4)
3. **Coordinator**: Review both outputs, check for conflicts
4. **Coordinator**: Run Acceptance Run (desktop e2e, real local model test)
5. **Coordinator**: Add `OpenMausBot/` to `.gitignore`
6. **Coordinator**: Commit with message "Add local-first models with OpenMausBot backend integration"
7. **Coordinator**: Push to main

## 8. Blocking conditions

Stop and report if:
- OpenMausBot license forbids the intended use (unlikely with Apache 2.0, but verify)
- OpenMausBot code is too large to adapt cleanly AND cannot be copied verbatim with attribution
- Cannot produce a local server for real verification (report blocked, do not fake success)
- UI subagent cannot achieve DESIGN.MD padding without breaking other components
- Backend subagent breaks existing cloud model tests (regression)

## 9. Success criteria

**UI (Track A)**:
- [ ] Local models appear first in picker with no key field
- [ ] Dropdown items have `px-1.5 py-1` padding per DESIGN.MD
- [ ] Playwright screenshot READ by agent confirms both
- [ ] Zero console/page/main errors during flow

**Backend (Track B)**:
- [ ] Mechanism summary written to `local-inject-mechanism.md`
- [ ] Local host probing works (Ollama/oMLX/EXO/LM Studio/Unsloth)
- [ ] OpenCode integration returns model catalog
- [ ] Pi integration streams completions
- [ ] Unit tests pass (fakes + error cases)
- [ ] Real run with actual local model succeeds (model name, size, latency, reply quoted)
- [ ] Existing cloud model tests still pass (no regression)

**Combined**:
- [ ] Acceptance Run passes end-to-end
- [ ] NOTICE file updated with OpenMausBot attribution
- [ ] OpenMausBot/ added to .gitignore
- [ ] Committed and pushed to main
