import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  LOCAL_RUNTIME_SETTINGS_FILE,
  LOCAL_RUNTIME_SETTINGS_PATH_ENV,
  parseLocalRuntimeSettings,
  toLocalRuntimeStatus,
  type LocalRuntimeSettings,
  type LocalRuntimeStatus,
} from "@sapphire/contracts";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

/**
 * T5 Electron-owned local runtime settings. The fallback policy lives in a
 * versioned JSON file under the app data directory; the E2B key lives in a
 * separate file encrypted with the OS secure storage (Electron safeStorage).
 * The renderer only ever sees the boolean status view — never the key.
 */
export const LOCAL_E2B_KEY_FILE = "local-e2b-key.enc";
/** Bounds the encrypted key blob the same way other private desktop files are. */
export const MAX_RUNTIME_FILE_BYTES = 64 * 1024;
/** E2B keys are short API tokens; this only bounds the file, not the format. */
export const MAX_E2B_KEY_CHARS = 4096;

/** The Electron safeStorage surface this module needs; injected for tests. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export function runtimeSettingsFilePath(userDataDir: string): string {
  return path.join(userDataDir, LOCAL_RUNTIME_SETTINGS_FILE);
}

export function e2bKeyFilePath(userDataDir: string): string {
  return path.join(userDataDir, LOCAL_E2B_KEY_FILE);
}

/** Reads the fallback policy; missing or corrupt files fail closed to defaults. */
export async function readLocalRuntimeSettings(
  userDataDir: string,
): Promise<LocalRuntimeSettings> {
  const raw = await readPrivateFile(runtimeSettingsFilePath(userDataDir), MAX_RUNTIME_FILE_BYTES);
  if (raw === null) return parseLocalRuntimeSettings(undefined);
  try {
    return parseLocalRuntimeSettings(JSON.parse(raw));
  } catch {
    return parseLocalRuntimeSettings(undefined);
  }
}

/** Persists the fallback policy owner-only; normalizes forward-compat fields. */
export async function writeLocalRuntimeSettings(
  userDataDir: string,
  value: unknown,
): Promise<LocalRuntimeSettings> {
  const next = parseLocalRuntimeSettings(value);
  await mkdir(userDataDir, { recursive: true, mode: 0o700 });
  await writePrivateFile(runtimeSettingsFilePath(userDataDir), `${JSON.stringify(next)}\n`);
  return next;
}

export function normalizeE2BKey(candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  const key = candidate.trim();
  if (key === "" || key.length > MAX_E2B_KEY_CHARS) return null;
  return key;
}

/**
 * Stores the E2B key OS-encrypted. Fails closed when secure storage is
 * unavailable — there is no plaintext fallback. Throws on failure.
 */
export async function storeE2BKey(
  userDataDir: string,
  safeStorage: SafeStorageLike | null | undefined,
  candidate: unknown,
): Promise<void> {
  const key = normalizeE2BKey(candidate);
  if (key === null) throw new Error("Enter a valid E2B API key.");
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure storage is unavailable, so the key was not saved.");
  }
  const encrypted = safeStorage.encryptString(key).toString("base64");
  await mkdir(userDataDir, { recursive: true, mode: 0o700 });
  await writePrivateFile(e2bKeyFilePath(userDataDir), `${encrypted}\n`);
}

/**
 * Decrypts the E2B key for child-process launch only. Returns null when absent,
 * corrupt, or undecryptable — never throws, never returns plaintext storage.
 */
export async function loadE2BKey(
  userDataDir: string,
  safeStorage: SafeStorageLike | null | undefined,
): Promise<string | null> {
  try {
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) return null;
    const raw = await readPrivateFile(e2bKeyFilePath(userDataDir), MAX_RUNTIME_FILE_BYTES);
    if (raw === null) return null;
    return normalizeE2BKey(safeStorage.decryptString(Buffer.from(raw.trim(), "base64")));
  } catch {
    return null;
  }
}

export async function hasE2BKey(
  userDataDir: string,
  safeStorage: SafeStorageLike | null | undefined,
): Promise<boolean> {
  return (await loadE2BKey(userDataDir, safeStorage)) !== null;
}

/** Removes the stored key; the policy file is untouched. */
export async function clearE2BKey(userDataDir: string): Promise<void> {
  await rm(e2bKeyFilePath(userDataDir), { force: true });
}

/** Renderer-safe posture: booleans only, safe to return through typed IPC. */
export async function localRuntimeStatus(
  userDataDir: string,
  safeStorage: SafeStorageLike | null | undefined,
): Promise<LocalRuntimeStatus> {
  const [settings, key] = await Promise.all([
    readLocalRuntimeSettings(userDataDir),
    loadE2BKey(userDataDir, safeStorage),
  ]);
  return toLocalRuntimeStatus({
    hasE2BKey: key !== null,
    allowDockerComputerFallback: settings.allowDockerComputerFallback,
  });
}

export interface LocalServiceSandboxInput {
  /** Private policy file both services read; always passed through. */
  settingsPath: string;
  /** Decrypted key, or null when none is stored. */
  e2bApiKey: string | null;
  allowDockerComputerFallback: boolean;
  /** Present only when fallback is enabled and a supervised daemon is ready. */
  dockerFallbackReady: boolean;
}

/**
 * Translates Electron-owned posture into the child-process environment. The
 * decrypted key is included only when present; Docker is selected only when
 * explicitly enabled and ready; otherwise the provider is `none` so computers
 * stay unavailable without blocking the backend. The flag itself is never
 * duplicated here — services read it from the settings path.
 */
export function localServiceSandboxEnv(input: LocalServiceSandboxInput): Record<string, string> {
  const env: Record<string, string> = {
    [LOCAL_RUNTIME_SETTINGS_PATH_ENV]: input.settingsPath,
  };
  if (input.e2bApiKey !== null && input.e2bApiKey !== "") {
    env.SANDBOX_PROVIDER = "e2b";
    env.E2B_API_KEY = input.e2bApiKey;
  } else if (input.allowDockerComputerFallback && input.dockerFallbackReady) {
    env.SANDBOX_PROVIDER = "docker";
  } else {
    env.SANDBOX_PROVIDER = "none";
  }
  return env;
}
