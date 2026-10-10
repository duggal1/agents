// Portions adapted from OpenMausBot (server/drivers/local-inject.ts)
// Copyright 2026 Milind Soni and OpenMausBot contributors
// Licensed under Apache License 2.0
// Full license: third_party/openmausbot/LICENSE

/**
 * Local host inject — probe on-device model servers (Ollama, oMLX, EXO, LM Studio, Unsloth)
 * and merge discovered models into the catalog as host::model encoded IDs.
 */

export interface LocalHost {
  id: string;
  label: string;
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
}

export const LOCAL_HOSTS: LocalHost[] = [
  { id: "omlx", label: "oMLX", baseUrl: "http://127.0.0.1:8080/v1", apiKey: "omlx" },
  { id: "ollama", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "ollama" },
  { id: "exo", label: "EXO", baseUrl: "http://127.0.0.1:52415/v1", apiKey: "exo" },
  { id: "lmstudio", label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", apiKey: "lm-studio" },
  { id: "unsloth", label: "Unsloth", baseUrl: "http://127.0.0.1:8888/v1", apiKeyEnv: "UNSLOTH_STUDIO_AUTH_TOKEN" },
];

export const INJECT_SEP = "::";

const HOST_BY_ID = new Map(LOCAL_HOSTS.map((host) => [host.id, host]));
const MODEL_ID = /^[\w][\w./:+-]*$/;

export interface InjectedModel {
  id: string;
  host: string;
  model: string;
  label: string;
  /** In VRAM / running on the host right now */
  loaded?: boolean;
  /** Context window reported by the host (e.g., Ollama's /api/ps) */
  contextWindow?: number;
}

/**
 * Ollama's /api/ps lists running models with their context_length.
 * Extracts context windows from the extra payload.
 */
export function contextWindowsFromPs(extra: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const rec = extra && typeof extra === "object" ? (extra as { models?: unknown }) : null;
  if (!rec || !Array.isArray(rec.models)) return out;
  for (const m of rec.models) {
    if (!m || typeof m !== "object") continue;
    const row = m as { name?: unknown; model?: unknown; context_length?: unknown };
    const id = typeof row.model === "string" ? row.model : typeof row.name === "string" ? row.name : null;
    const ctx = typeof row.context_length === "number" && Number.isFinite(row.context_length) && row.context_length > 0 ? row.context_length : null;
    if (id && ctx) {
      out.set(id, ctx);
      const baseId = id.split(":")[0]!;
      const current = out.get(baseId);
      out.set(baseId, current === undefined ? ctx : Math.min(current, ctx));
    }
  }
  return out;
}

export function encodeInjectId(host: string, model: string): string {
  return `${host}${INJECT_SEP}${model}`;
}

export function decodeInjectId(id: string | null | undefined): { host: string; model: string } | null {
  if (!id) return null;
  const sep = id.indexOf(INJECT_SEP);
  if (sep <= 0) return null;
  const host = id.slice(0, sep);
  const model = id.slice(sep + INJECT_SEP.length);
  if (!HOST_BY_ID.has(host) || !MODEL_ID.test(model)) return null;
  return { host, model };
}

export function localHost(id: string): LocalHost | undefined {
  return HOST_BY_ID.get(id);
}

export function injectedApiModel(id: string | null | undefined): string | null {
  return decodeInjectId(id)?.model ?? null;
}

/**
 * Anthropic-compatible base (strips trailing /v1).
 */
export function anthropicBaseUrl(host: LocalHost): string {
  return host.baseUrl.replace(/\/v1\/?$/, "");
}

export function hostApiKey(host: LocalHost, env: Record<string, string | undefined> = process.env): string {
  if (host.apiKeyEnv && env[host.apiKeyEnv]) return env[host.apiKeyEnv]!;
  if (host.apiKey) return host.apiKey;
  return "local";
}

function idsFromModelsPayload(payload: unknown): string[] {
  const records = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : payload && typeof payload === "object" && Array.isArray((payload as { models?: unknown }).models)
        ? (payload as { models: unknown[] }).models
        : [];
  return records.flatMap((record) => {
    if (typeof record === "string") return MODEL_ID.test(record) ? [record] : [];
    if (!record || typeof record !== "object") return [];
    const id = (record as { id?: unknown; name?: unknown }).id ?? (record as { name?: unknown }).name;
    if (typeof id !== "string" || !MODEL_ID.test(id)) return [];
    const low = id.toLowerCase();
    if (low.includes("embed") || low.includes("bge-") || low.includes("nomic")) return [];
    return [id];
  });
}

async function timedJson(
  url: string,
  env: Record<string, string | undefined>,
  host: LocalHost,
  fetchImpl: typeof fetch,
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${hostApiKey(host, env)}` },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Which of this host's models are actually in memory / running. */
export function loadedIdsFromPayloads(_host: LocalHost, catalog: unknown, extra: unknown): Set<string> {
  const loaded = new Set<string>();
  const catalogIds = new Set(idsFromModelsPayload(catalog));
  const add = (id: string) => {
    const base = id.split(":")[0]!;
    if (catalogIds.size && !catalogIds.has(id) && !catalogIds.has(base)) return;
    if (!MODEL_ID.test(id)) return;
    loaded.add(id);
    if (catalogIds.has(base)) loaded.add(base);
  };

  if (extra && typeof extra === "object") {
    const rec = extra as {
      default_model?: unknown;
      models?: unknown;
      data?: unknown;
    };
    const running = Array.isArray(rec.models)
      ? rec.models
      : Array.isArray(rec.data)
        ? rec.data
        : [];
    const hasLoadedFlags = running.some(
      (row) => row && typeof row === "object" && ("loaded" in row || "state" in row),
    );
    if (!hasLoadedFlags && typeof rec.default_model === "string") add(rec.default_model);
    for (const row of running) {
      if (typeof row === "string") {
        if (!hasLoadedFlags) add(row);
        continue;
      }
      if (!row || typeof row !== "object") continue;
      const item = row as { name?: unknown; model?: unknown; id?: unknown; state?: unknown; loaded?: unknown };
      const id =
        (typeof item.name === "string" && item.name) ||
        (typeof item.model === "string" && item.model) ||
        (typeof item.id === "string" && item.id) ||
        "";
      if (!id) continue;
      const state = typeof item.state === "string" ? item.state.toLowerCase() : "";
      if (item.loaded === false || state === "not-loaded" || state === "unloaded") continue;
      if (item.loaded === true || state === "loaded" || state === "idle" || !hasLoadedFlags) {
        add(id);
      }
    }
  }

  if (!loaded.size && catalog && typeof catalog === "object") {
    const rec = catalog as { default_model?: unknown; data?: unknown };
    if (typeof rec.default_model === "string") add(rec.default_model);
    const records = Array.isArray(rec.data) ? rec.data : [];
    for (const row of records) {
      if (!row || typeof row !== "object") continue;
      const item = row as { id?: unknown; state?: unknown; loaded?: unknown };
      if (typeof item.id !== "string") continue;
      const state = typeof item.state === "string" ? item.state.toLowerCase() : "";
      if (item.loaded === true || state === "loaded") add(item.id);
    }
  }

  return loaded;
}

function loadedProbeUrl(host: LocalHost): string | null {
  const origin = anthropicBaseUrl(host);
  if (host.id === "omlx") return `${origin}/v1/models/status`;
  if (host.id === "ollama") return `${origin}/api/ps`;
  if (host.id === "lmstudio") return `${origin}/api/v0/models`;
  return null;
}

/** Live models from the same local hosts. */
export async function probeLocalInjects(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<InjectedModel[]> {
  const seenHosts = new Set<string>();
  const hosts = LOCAL_HOSTS.filter((host) => {
    const key = host.baseUrl.replace(/\/$/, "");
    if (seenHosts.has(key)) return false;
    seenHosts.add(key);
    return true;
  });
  const found: InjectedModel[] = [];
  const pages = await Promise.all(
    hosts.map(async (host) => {
      const catalogUrl = `${host.baseUrl.replace(/\/$/, "")}/models`;
      const extraUrl = loadedProbeUrl(host);
      const [catalog, extra] = await Promise.all([
        timedJson(catalogUrl, env, host, fetchImpl),
        extraUrl ? timedJson(extraUrl, env, host, fetchImpl) : Promise.resolve(null),
      ]);
      const catalogIds = catalog ? idsFromModelsPayload(catalog) : [];
      const extraIds = extra ? idsFromModelsPayload(extra) : [];
      const loaded = loadedIdsFromPayloads(host, catalog ?? extra, extra);
      const ids = [...new Set([...catalogIds, ...extraIds, ...loaded])];
      const windows = contextWindowsFromPs(extra);
      return { host, ids, loaded, windows };
    }),
  );
  for (const { host, ids, loaded, windows } of pages) {
    for (const model of ids) {
      const contextWindow = windows.get(model);
      found.push({
        id: encodeInjectId(host.id, model),
        host: host.id,
        model,
        label: `${model} (${host.label})`,
        loaded: loaded.has(model),
        ...(contextWindow ? { contextWindow } : {}),
      });
    }
  }
  return found;
}

/** Append live local models as custom rows. Official rows stay first. */
export async function mergeLocalInject(
  catalog: { default: string; options: Array<{ id: string; label: string; custom?: boolean; loaded?: boolean; contextWindow?: number }> },
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ default: string; options: Array<{ id: string; label: string; custom?: boolean; loaded?: boolean; contextWindow?: number }> }> {
  const extras = await probeLocalInjects(env, fetchImpl);
  if (!extras.length) return catalog;
  const liveApiIds = new Set(extras.map((extra) => extra.model));
  const options = catalog.options
    .filter((option) => decodeInjectId(option.id) || !option.custom || !liveApiIds.has(option.id))
    .map((option) => ({ ...option }));
  const seen = new Set(options.map((option) => option.id));
  for (const extra of extras) {
    const existing = options.find((option) => option.id === extra.id);
    if (existing) {
      if (extra.loaded) existing.loaded = true;
      if (extra.contextWindow) existing.contextWindow = extra.contextWindow;
      continue;
    }
    seen.add(extra.id);
    options.push({
      id: extra.id,
      label: extra.label,
      custom: true,
      ...(extra.loaded ? { loaded: true } : {}),
      ...(extra.contextWindow ? { contextWindow: extra.contextWindow } : {}),
    });
  }
  return { default: catalog.default, options };
}
