import { readFileSync, statSync } from "node:fs";
import {
  defaultLocalRuntimeSettings,
  LOCAL_RUNTIME_SETTINGS_PATH_ENV,
  parseLocalRuntimeSettingsJson,
  type LocalRuntimeSettings,
} from "@sapphire/contracts";

/** Upper bound for the tiny Electron-owned policy file; anything larger is ignored. */
export const MAX_RUNTIME_SETTINGS_BYTES = 64 * 1024;

/** The policy file path the desktop main process passes to API/worker, if any. */
export function localRuntimeSettingsPath(
  source: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = source[LOCAL_RUNTIME_SETTINGS_PATH_ENV]?.trim();
  return raw ? raw : undefined;
}

/**
 * Reads the Electron-owned policy file both processes share. Never throws:
 * a missing, unreadable, oversized, or corrupt file means defaults (Docker
 * fallback disabled). The E2B key never lives in this file.
 */
export function readLocalRuntimeSettingsFile(
  filePath: string | undefined,
): LocalRuntimeSettings {
  if (!filePath) return defaultLocalRuntimeSettings();
  try {
    if (statSync(filePath).size > MAX_RUNTIME_SETTINGS_BYTES) {
      return defaultLocalRuntimeSettings();
    }
    return parseLocalRuntimeSettingsJson(readFileSync(filePath, "utf8"));
  } catch {
    return defaultLocalRuntimeSettings();
  }
}
