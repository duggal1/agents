import { z } from "zod";

/**
 * Electron-owned local runtime policy (T5). The desktop main process writes this
 * file under its app data directory; the local API and worker processes read the
 * same schema through one generic `SAPPHIRE_LOCAL_RUNTIME_SETTINGS_PATH` variable.
 * The E2B key itself never lives here — it is OS-encrypted via Electron
 * safeStorage in a separate file. Failing closed means fallback stays off.
 */
export const LOCAL_RUNTIME_SETTINGS_VERSION = 1;
/** File name under Electron's app data directory. */
export const LOCAL_RUNTIME_SETTINGS_FILE = "local-runtime-settings.json";
/** Single generic variable carrying the policy file path to API/worker. */
export const LOCAL_RUNTIME_SETTINGS_PATH_ENV = "SAPPHIRE_LOCAL_RUNTIME_SETTINGS_PATH";

export const LocalRuntimeSettingsSchema = z.object({
  version: z.literal(LOCAL_RUNTIME_SETTINGS_VERSION),
  /** Global per-install Docker computer fallback. Disabled by default. */
  allowDockerComputerFallback: z.boolean().default(false),
});

export type LocalRuntimeSettings = z.infer<typeof LocalRuntimeSettingsSchema>;

export function defaultLocalRuntimeSettings(): LocalRuntimeSettings {
  return { version: LOCAL_RUNTIME_SETTINGS_VERSION, allowDockerComputerFallback: false };
}

/**
 * Lenient parse: missing, corrupt, or foreign content falls back to defaults
 * (fallback disabled). Never throws.
 */
export function parseLocalRuntimeSettings(value: unknown): LocalRuntimeSettings {
  const parsed = LocalRuntimeSettingsSchema.safeParse(value);
  if (!parsed.success) return defaultLocalRuntimeSettings();
  return parsed.data;
}

export function parseLocalRuntimeSettingsJson(
  raw: string | null | undefined,
): LocalRuntimeSettings {
  if (!raw) return defaultLocalRuntimeSettings();
  try {
    return parseLocalRuntimeSettings(JSON.parse(raw));
  } catch {
    return defaultLocalRuntimeSettings();
  }
}

type EnvLike = Readonly<Record<string, string | undefined>>;

/** Packaged local mode is signalled by the settings-path variable alone. */
export function isPackagedLocalMode(source: EnvLike = process.env): boolean {
  return (source[LOCAL_RUNTIME_SETTINGS_PATH_ENV] ?? "").trim() !== "";
}

/**
 * Renderer-safe view of the local runtime posture: booleans only. The E2B key
 * itself is never exposed through IPC, storage, URLs, logs, or telemetry.
 */
export interface LocalRuntimeStatus {
  hasE2BKey: boolean;
  allowDockerComputerFallback: boolean;
}

export function toLocalRuntimeStatus(input: {
  hasE2BKey: unknown;
  allowDockerComputerFallback: unknown;
}): LocalRuntimeStatus {
  return {
    hasE2BKey: input.hasE2BKey === true,
    allowDockerComputerFallback: input.allowDockerComputerFallback === true,
  };
}
