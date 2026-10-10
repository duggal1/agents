import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import {
  createProvider,
  type Model,
  type MutableModels,
  type Provider,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { DEFAULT_MODEL_CONTEXT_WINDOW, DEFAULT_MODEL_MAX_TOKENS } from "@sapphire/contracts";
import { Agent } from "undici";
import { declaredVisionModelIds, inputModalities } from "./model-modalities.js";
import {
  createAddressCheckedLookup,
  isCloudMetadataAddress,
  isLinkLocalAddress,
  isPrivateAddress,
  type ResolveHostname,
} from "./network-address.js";
import {
  assertAllowedOpenAiCompatibleRequestUrl,
  assertAllowedOpenAiCompatibleUrl,
  assertHttpsForKeyedOpenAiCompatibleUrl,
  isPrivateOpenAiCompatibleHostname,
  normalizeOpenAiCompatibleBaseUrl,
  OPENAI_COMPATIBLE_PROVIDER_ID,
} from "./openai-compatible-url.js";
import { dispatcherFetch, fetchPairedWithDispatcher } from "./undici-fetch.js";

export { OPENAI_COMPATIBLE_PROVIDER_ID };

/** Placeholder catalog model id; users enter the real id when connecting. */
export const OPENAI_COMPATIBLE_CATALOG_MODEL_ID = "custom";

/** Model ids this endpoint serves with vision, declared by the operator. */
export const OPENAI_COMPATIBLE_VISION_MODELS_ENV = "RAKAZO_OPENAI_COMPATIBLE_VISION_MODELS";

export function openAiCompatibleVisionModelIds(): ReadonlySet<string> {
  return declaredVisionModelIds(OPENAI_COMPATIBLE_VISION_MODELS_ENV);
}

const OPENAI_COMPAT_BASE = "http://127.0.0.1:1/v1";
const resolveHostname: ResolveHostname = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export function openAiCompatibleModel(
  id: string,
  baseUrl: string,
  reasoning = false,
  acceptsImages = false,
  maxTokens = DEFAULT_MODEL_MAX_TOKENS,
  contextWindow = DEFAULT_MODEL_CONTEXT_WINDOW,
): Model<"openai-completions"> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: OPENAI_COMPATIBLE_PROVIDER_ID,
    baseUrl,
    reasoning,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: reasoning,
      thinkingFormat: "openai",
    },
    thinkingLevelMap: { off: "none" },
    input: inputModalities(acceptsImages),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens,
  };
}

function openAiCompatibleProvider(models: Model<"openai-completions">[]): Provider {
  const api = openAICompletionsApi();
  // Guard the fetch the caller supplied (the runtime's seam for tests) or the
  // dispatcher-matched default; never the bare global.
  const safeApi: ProviderStreams = {
    stream: (model, context, options) =>
      api.stream(model, context, {
        ...options,
        fetch: createOpenAiCompatibleFetch(options?.fetch),
      }),
    streamSimple: (model, context, options) =>
      api.streamSimple(model, context, {
        ...options,
        fetch: createOpenAiCompatibleFetch(options?.fetch),
      }),
  };
  return createProvider({
    id: OPENAI_COMPATIBLE_PROVIDER_ID,
    name: "OpenAI-compatible",
    baseUrl: models[0]?.baseUrl ?? OPENAI_COMPAT_BASE,
    auth: {
      apiKey: {
        name: "OpenAI-compatible server",
        resolve: async () => ({
          auth: { apiKey: "local" },
          source: "OpenAI-compatible endpoint",
        }),
      },
    },
    models,
    api: safeApi,
  });
}

export function createOpenAiCompatibleLookup(
  url: URL,
  resolve: ResolveHostname = resolveHostname,
): LookupFunction {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const privateHostname = isPrivateOpenAiCompatibleHostname(hostname);
  return createAddressCheckedLookup(resolve, (addresses) => {
    if (addresses.length === 0) throw new Error("Model server did not resolve to an address");
    if (addresses.some((entry) => isCloudMetadataAddress(entry.address))) {
      throw new Error("Model server hostname resolved to a blocked metadata address");
    }
    if (privateHostname) {
      if (
        addresses.some(
          (entry) =>
            isIP(entry.address) === 0 ||
            !isPrivateAddress(entry.address) ||
            isLinkLocalAddress(entry.address),
        )
      ) {
        throw new Error("Local model server hostname resolved outside the private network");
      }
      return;
    }
    if (addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new Error("Public model server hostname resolved to a private address");
    }
  });
}

function headersCarryAuthorization(headers: HeadersInit): boolean {
  if (headers instanceof Headers) return Boolean(headers.get("authorization"));
  if (Array.isArray(headers)) {
    return headers.some(
      ([name, value]) => name.toLowerCase() === "authorization" && Boolean(value),
    );
  }
  return Object.entries(headers).some(
    ([name, value]) => name.toLowerCase() === "authorization" && Boolean(value),
  );
}

/** Matches fetch: when init.headers is set it replaces Request headers entirely. */
function requestCarriesAuthorization(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (init?.headers !== undefined) return headersCarryAuthorization(init.headers);
  return input instanceof Request ? Boolean(input.headers.get("authorization")) : false;
}

export function createOpenAiCompatibleFetch(
  baseFetch: typeof globalThis.fetch = dispatcherFetch,
  resolve: ResolveHostname = resolveHostname,
): typeof globalThis.fetch {
  return async (input, init) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = assertAllowedOpenAiCompatibleRequestUrl(rawUrl);
    if (requestCarriesAuthorization(input, init)) {
      assertHttpsForKeyedOpenAiCompatibleUrl(url, "present");
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const dispatcher =
      isIP(hostname) === 0
        ? new Agent({ connect: { lookup: createOpenAiCompatibleLookup(url, resolve) } })
        : undefined;
    // Node's fetch rejects this package Agent. Pair them only when the
    // dispatcher is attached; a caller-supplied fetch stays in charge.
    const transport = dispatcher ? fetchPairedWithDispatcher(baseFetch) : baseFetch;
    try {
      const response = await transport(url, {
        ...(await requestInitFor(input, init)),
        redirect: "error",
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit & { dispatcher?: Agent });
      return dispatcher ? await closeDispatcherWithResponse(response, dispatcher) : response;
    } catch (error) {
      await dispatcher?.close().catch(() => undefined);
      throw error;
    }
  };
}

/** The base fetch comes from the undici package, which recognizes only its own
 * Request class and reads a global Request as the string "[object Request]".
 * Flatten Request inputs to a URL plus init, with init overriding the
 * Request's fields the way fetch itself merges them. */
async function requestInitFor(input: RequestInfo | URL, init?: RequestInit): Promise<RequestInit> {
  if (!(input instanceof Request)) return init ?? {};
  const request = new Request(input, init);
  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  return { method: request.method, headers: request.headers, body, signal: request.signal };
}

async function closeDispatcherWithResponse(
  response: Response,
  dispatcher: Agent,
): Promise<Response> {
  if (!response.body) {
    await dispatcher.close();
    return response;
  }
  const reader = response.body.getReader();
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await dispatcher.close().catch(() => undefined);
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          await close();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        controller.error(error);
        await close();
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await close();
      }
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Always-visible catalog provider with a placeholder model entry. */
export function openAiCompatibleCatalogProvider(): Provider {
  // The vision gate resolves against this catalog rather than the per-run
  // registry, so a model only declared at runtime would still read as
  // text-only. Register the operator's declared vision models here too.
  //
  // If the reserved placeholder id ("custom") is itself declared vision-
  // capable, upgrade the placeholder entry rather than appending a second
  // model with the same id — Models.getModel returns the first match, so a
  // duplicate would leave the gate reading the text-only placeholder.
  const visionIds = openAiCompatibleVisionModelIds();
  const placeholderAcceptsImages = visionIds.has(OPENAI_COMPATIBLE_CATALOG_MODEL_ID);
  const visionModels = [...visionIds]
    .filter((id) => id !== OPENAI_COMPATIBLE_CATALOG_MODEL_ID)
    .map((id) => openAiCompatibleModel(id, OPENAI_COMPAT_BASE, false, true));
  return openAiCompatibleProvider([
    {
      ...openAiCompatibleModel(
        OPENAI_COMPATIBLE_CATALOG_MODEL_ID,
        OPENAI_COMPAT_BASE,
        false,
        placeholderAcceptsImages,
      ),
      name: "Custom model id",
    },
    ...visionModels,
  ]);
}

export function registerOpenAiCompatibleCatalog(models: MutableModels): MutableModels {
  models.setProvider(openAiCompatibleCatalogProvider());
  return models;
}

/** Register a concrete model + base URL for an agent run. */
export function registerOpenAiCompatibleRuntime(
  models: MutableModels,
  opts: {
    modelId: string;
    baseUrl: string;
    reasoning?: boolean;
    acceptsImages?: boolean;
    maxTokens?: number;
    contextWindow?: number;
  },
): MutableModels {
  const baseUrl = normalizeOpenAiCompatibleBaseUrl(opts.baseUrl);
  const modelId = opts.modelId.trim();
  const acceptsImages = opts.acceptsImages || openAiCompatibleVisionModelIds().has(modelId);
  models.setProvider(
    openAiCompatibleProvider([
      openAiCompatibleModel(
        modelId,
        baseUrl,
        opts.reasoning,
        acceptsImages,
        opts.maxTokens,
        opts.contextWindow,
      ),
    ]),
  );
  return models;
}

export type OpenAiCompatibleConnectInput = {
  provider: string;
  baseUrl?: string;
  modelId?: string;
  apiKey?: string;
};

export function prepareOpenAiCompatibleConnect(input: OpenAiCompatibleConnectInput): {
  baseUrl: string;
  modelId: string;
  apiKey?: string;
} {
  const baseUrl = input.baseUrl?.trim();
  const modelId = input.modelId?.trim();
  if (!baseUrl) throw new Error("Base URL is required for OpenAI-compatible models");
  if (!modelId) throw new Error("Model id is required for OpenAI-compatible models");
  const allowed = assertAllowedOpenAiCompatibleUrl(baseUrl);
  const apiKey = input.apiKey?.trim();
  assertHttpsForKeyedOpenAiCompatibleUrl(allowed, apiKey);
  const normalized = allowed.href;
  return apiKey ? { baseUrl: normalized, modelId, apiKey } : { baseUrl: normalized, modelId };
}
