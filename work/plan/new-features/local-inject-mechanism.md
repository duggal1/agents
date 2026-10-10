# Local Inject Mechanism Summary

Source: OpenMausBot `server/drivers/local-inject.ts`, `server/drivers/pi.ts`, `server/drivers/acp/opencode-go.ts` (Apache 2.0 licensed)

## Overview

OpenMausBot implements a "local inject" pattern that discovers on-device model servers (Ollama, oMLX, EXO, LM Studio, Unsloth) by probing their OpenAI-compatible `/models` endpoints, then merges the discovered models into the model catalog under `host::model` encoded IDs. This enables free on-device inference without API keys.

## Key Components

### 1. Local Host Registry (`LOCAL_HOSTS`)

- Array of `LocalHost` objects: `{ id, label, baseUrl, apiKey?, apiKeyEnv? }`
- Pre-configured hosts for common local servers:
  - oMLX: `http://127.0.0.1:8080/v1` (apiKey: "omlx")
  - Ollama: `http://127.0.0.1:11434/v1` (apiKey: "ollama")
  - EXO: `http://127.0.0.1:52415/v1` (apiKey: "exo")
  - LM Studio: `http://127.0.0.1:1234/v1` (apiKey: "lm-studio")
  - Unsloth: `http://127.0.0.1:8888/v1` (reads from `UNSLOTH_STUDIO_AUTH_TOKEN` env or `~/.unsloth/studio/auth/agent_api_key.json`)

### 2. Model Discovery (`probeLocalInjects`)

For each local host:
1. Query `/models` endpoint (1.2s timeout)
2. Optional query for running models:
   - oMLX: `/v1/models/status`
   - Ollama: `/api/ps` (returns context window via `context_length`)
   - LM Studio: `/api/v0/models`
3. Parse model IDs from response (handles multiple response shapes: `data[]`, `models[]`, or plain array)
4. Filter out embedding models (ids containing "embed", "bge-", "nomic")
5. Track which models are loaded in VRAM via `loaded` flag
6. Return `InjectedModel[]` with `{ id, host, model, label, loaded?, contextWindow? }`

### 3. ID Encoding/Decoding

- **Encode**: `encodeInjectId(host, model)` → `"host::model"` (e.g., `"ollama::llama3.2:1b"`)
- **Decode**: `decodeInjectId(id)` extracts host and model, validates against `LOCAL_HOSTS` registry
- Separator is `"::"` (`INJECT_SEP`)
- Validation regex for model IDs: `^[\w][\w./:+-]*$`

### 4. Catalog Merging (`mergeLocalInject`)

Takes existing `ModelCatalog` and augments it:
1. Call `probeLocalInjects()` to discover live models
2. Filter out duplicates: if a plain model ID (e.g., "llama3.2:1b") exists in catalog and a live inject exists (e.g., "ollama::llama3.2:1b"), keep only the inject version
3. Append new inject models as `custom: true` entries
4. Preserve `loaded` and `contextWindow` metadata
5. Skip probing in vitest unless `OPENMAUSBOT_PROBE_LOCAL_INJECT=1`

### 5. Environment Injection for CLIs

- **OpenAI CLI**: `applyOpenAIInject()` sets `OPENAI_BASE_URL` and `OPENAI_API_KEY`
- **Claude Code**: `applyClaudeInject()` sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- Strips trailing `/v1` for Anthropic-compatible endpoints
- API key resolved via `hostApiKey()` which checks: `apiKeyEnv` → `apiKey` → file read (Unsloth) → fallback "local"

### 6. Pi Agent Integration

Pi speaks JSON-RPC over stdio (`pi --mode rpc --no-session`):
- `get_available_models` RPC returns `{ provider, id, name? }[]`
- Model IDs are `provider/modelId` composites (e.g., `ollama-cloud/glm-5.2`)
- `splitPiModel()` handles both native composites and inject IDs
- `ensurePiInjectModel()` upserts local hosts into `~/.pi/agent/models.json` so pi can reach them
- `applyPiLocalCatalog()` merges inject models into pi's catalog, preferring inject over duplicate `host/model` entries

### 7. OpenCode CLI Integration

OpenCode is queried via ACP stdio protocol:
- Spawn `opencode acp` in a git-isolated discovery folder
- Send `initialize` and `session/new` RPCs
- Extract model list from `configOptions` (the `model` select)
- Parallel `opencode models --verbose` run for metadata (prices, context windows, local detection)
- `localModelRecord()` detects local models by checking if `api.url` hostname is localhost/127.0.0.1/::1
- Free models detected via `cost.input === 0 && cost.output === 0` or `-free` suffix

## Data Flow

1. **Discovery**: App startup or user action → `probeLocalInjects()` → HTTP probes to localhost ports
2. **Catalog merge**: Discovered models → `mergeLocalInject()` → augmented model catalog returned to UI
3. **Selection**: User picks `host::model` → stored as model credential (keyless = empty string or sentinel)
4. **Execution**: Turn starts → decode inject ID → set CLI env vars → agent talks to local endpoint
5. **Fallback**: If host unreachable, graceful degradation (model not shown or marked unavailable)

## Key Design Decisions

- **Host encoding**: `host::model` rather than per-host namespaces enables single credential field and avoids provider proliferation
- **Timeout**: 1.2s per host prevents blocking on unavailable servers
- **Filtering**: Embedding models excluded (not useful for chat)
- **VRAM awareness**: `loaded` flag pins running models first in picker (instant response)
- **Context window**: Real window from Ollama `/api/ps` overrides guessed values
- **Environment injection**: Direct env var mutation works for OpenAI/Claude Code CLIs; pi needs explicit `models.json` upsert
- **Keyless**: Local servers ignore API key, but header still required by most servers → use "local" or host-specific placeholder

## Sapphire Adaptation Strategy

1. **Reuse host registry**: Copy `LOCAL_HOSTS` as-is
2. **Reuse probe logic**: Copy `probeLocalInjects()`, `encodeInjectId()`, `decodeInjectId()`, `mergeLocalInject()`
3. **Wire into pi-local-provider**: Extend existing provider to call probe on `listModels()`
4. **Credential storage**: Keyless local models store empty string in secret field
5. **No CLI env injection**: Sapphire doesn't spawn CLIs, so `applyOpenAIInject()`/`applyClaudeInject()` not needed
6. **Skip OpenCode integration**: Not in scope for local inference (OpenCode is for cloud Zen/Go)
7. **Pi integration**: If Sapphire uses pi agent, copy `splitPiModel()` and `ensurePiInjectModel()` logic

## Verification Requirements

- Unit tests with fake probe responses
- Real Ollama test: pull model, probe, stream completion
- Regression: existing cloud model tests stay green
