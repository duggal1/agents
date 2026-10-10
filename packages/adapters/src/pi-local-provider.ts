import {
  createProvider,
  type Model,
  type MutableModels,
  type Provider,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

import { declaredVisionModelIds, inputModalities } from "./model-modalities.js";
import {
  assertAllowedOpenAiCompatibleRequestUrl,
  normalizeOpenAiCompatibleBaseUrl,
} from "./openai-compatible-url.js";
import {
  decodeInjectId,
  encodeInjectId,
  hostApiKey,
  localHost,
  mergeLocalInject,
  probeLocalInjects,
  type InjectedModel,
} from "./local-inject.js";

/**
 * Local OpenAI-compatible model server (Ollama, LM Studio, llama.cpp, MLX).
 *
 * Pi's built-in catalog only ships hosted providers, so a model running on the
 * operator's own machine has no catalog entry to select. This registers one
 * from environment configuration. The server is keyless: `resolve` returns a
 * placeholder because OpenAI-compatible local servers ignore the header, but
 * Models treats a provider with no resolvable auth as unconfigured and hides
 * its models.
 *
 * Live discovery follows the OpenMausBot local-inject pattern (Apache-2.0,
 * Copyright 2026 Milind Soni and OpenMausBot contributors): probe the
 * loopback endpoint's /models, merge whatever it serves into the catalog,
 * and stream chat-completions with the same SSE framing. Adapted to Sapphire's
 * provider-neutral contracts — no OpenMausBot code is copied verbatim.
 */
export const LOCAL_PROVIDER_ID = "local";

/** Model ids the local server serves with vision, declared by the operator. */
export const LOCAL_VISION_MODELS_ENV = "RAKAZO_LOCAL_VISION_MODELS";

export function localVisionModelIds(): ReadonlySet<string> {
  return declaredVisionModelIds(LOCAL_VISION_MODELS_ENV);
}

const DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_CONTEXT_WINDOW = 32_768;
const DEFAULT_MAX_TOKENS = 4_096;

export function localBaseUrl(): string {
  const value = process.env.RAKAZO_LOCAL_MODELS_URL?.trim() || DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("RAKAZO_LOCAL_MODELS_URL must be an absolute HTTP(S) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("RAKAZO_LOCAL_MODELS_URL must be an absolute HTTP(S) URL");
  }
  return value;
}

/**
 * A token count from the environment, or the default when unset.
 *
 * Token limits are only meaningful as finite positive integers, so anything
 * else is a configuration mistake. Throwing beats `Number(x) || default`, which
 * would accept a negative window and silently swallow a typo as the default.
 */
function tokenLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}"`);
  }
  return value;
}

/** Comma-separated model ids exactly as the local server names them. */
function localModelIds(): string[] {
  return (process.env.RAKAZO_LOCAL_MODELS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

function localModel(id: string, baseUrl?: string, contextWindow?: number): Model<"openai-completions"> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: LOCAL_PROVIDER_ID,
    baseUrl: baseUrl ?? localBaseUrl(),
    reasoning: false,
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    input: inputModalities(localVisionModelIds().has(id)),
    // Runs on the operator's own hardware, so there is nothing to bill.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: contextWindow ?? tokenLimit("RAKAZO_LOCAL_CONTEXT_WINDOW", DEFAULT_CONTEXT_WINDOW),
    maxTokens: tokenLimit("RAKAZO_LOCAL_MAX_TOKENS", DEFAULT_MAX_TOKENS),
  };
}

/** The provider, or undefined when no local models are configured. */
export function localProvider(): Provider | undefined {
  const ids = localModelIds();
  if (!ids.length) return undefined;
  return createProvider({
    id: LOCAL_PROVIDER_ID,
    name: "Local (Ollama / LM Studio)",
    baseUrl: localBaseUrl(),
    auth: {
      apiKey: {
        name: "Local model server",
        resolve: async () => ({
          auth: { apiKey: "local", baseUrl: localBaseUrl() },
          source: "local model server",
        }),
      },
    },
    models: ids.map((id) => localModel(id)),
    api: openAICompletionsApi(),
  });
}

/**
 * Register the local provider on a Models collection. No-op when unconfigured.
 * If local inject discovery is enabled, probes localhost hosts and adds discovered models.
 */
export async function registerLocalProvider(models: MutableModels): Promise<MutableModels> {
  const envProvider = localProvider();
  if (envProvider) models.setProvider(envProvider);

  // Probe local hosts for live models
  const injectModels = await probeLocalInjects();
  for (const inject of injectModels) {
    const host = localHost(inject.host);
    if (!host) continue;

    // Create or update the provider for this host
    const providerId = inject.host;
    const existingProvider = models.getProvider(providerId);
    const existingModels = existingProvider?.getModels() ?? [];

    // Check if model already exists
    const modelExists = existingModels.some((m) => m.id === inject.model);
    if (modelExists) continue;

    const newModel = localModel(inject.model, host.baseUrl, inject.contextWindow);
    // Provider has no incremental add: rebuild it from the host config with every model kept.
    models.setProvider(
      createProvider({
        id: providerId,
        name: host.label,
        baseUrl: host.baseUrl,
        auth: {
          apiKey: {
            name: host.label,
            resolve: async () => ({
              auth: { apiKey: hostApiKey(host), baseUrl: host.baseUrl },
              source: "local model server",
            }),
          },
        },
        models: [...existingModels, newModel],
        api: openAICompletionsApi(),
      }),
    );
  }

  return models;
}

/**
 * Synchronous version of registerLocalProvider that only registers env-configured models
 * (no probing). Used for catalog building and tests.
 */
export function registerLocalProviderSync(models: MutableModels): MutableModels {
  const envProvider = localProvider();
  if (envProvider) models.setProvider(envProvider);
  return models;
}

/**
 * Discover local inject models and return them as catalog entries.
 * This is used by the backend RPC to populate the model catalog.
 */
export async function discoverLocalInjectModels(): Promise<Array<{ provider: string; id: string; label: string; baseUrl: string }>> {
  const injects = await probeLocalInjects();
  return injects.map((inject) => {
    const host = localHost(inject.host);
    return {
      provider: inject.host,
      id: inject.id,
      label: inject.label,
      baseUrl: host?.baseUrl ?? "",
    };
  });
}

/**
 * Resolve a local inject model ID to its execution parameters.
 * Returns null if the ID is not a valid inject ID.
 */
export function resolveLocalInjectModel(modelId: string): { baseUrl: string; apiKey: string; model: string } | null {
  const inject = decodeInjectId(modelId);
  if (!inject) return null;
  const host = localHost(inject.host);
  if (!host) return null;
  return {
    baseUrl: host.baseUrl,
    apiKey: hostApiKey(host),
    model: inject.model,
  };
}
