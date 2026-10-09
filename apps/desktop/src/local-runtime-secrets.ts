import path from "node:path";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

/**
 * Owner-only secrets the native API and worker processes require at launch.
 * Stored as one JSON file under the app's user data; never exposed to the
 * renderer, URLs, logs, or IPC responses.
 */
export const RUNTIME_SECRETS_FILE = "local-runtime-secrets.json";
export const RUNTIME_SECRETS_VERSION = 1;

/** Minimum length for dedicated credentials outside local tests. */
export const RUNTIME_SECRET_MIN_LENGTH = 32;

export interface RuntimeSecrets {
  BETTER_AUTH_SECRET: string;
  ENCRYPTION_KEY: string;
  SCREEN_PROXY_SECRET: string;
  SANDBOX_SUPERVISOR_TOKEN: string;
}

const SECRET_NAMES = [
  "BETTER_AUTH_SECRET",
  "ENCRYPTION_KEY",
  "SCREEN_PROXY_SECRET",
  "SANDBOX_SUPERVISOR_TOKEN",
] as const;

function isUsableSecret(name: (typeof SECRET_NAMES)[number], value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  // Dedicated credentials must be long and pairwise distinct so a leak at one
  // boundary never unlocks another. The auth secret and encryption key only
  // need to be non-empty: their strength was chosen when they were generated.
  if (name === "SCREEN_PROXY_SECRET" || name === "SANDBOX_SUPERVISOR_TOKEN") {
    return value.length >= RUNTIME_SECRET_MIN_LENGTH;
  }
  return true;
}

function isUsableSecretSet(value: unknown): value is RuntimeSecrets {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.version !== RUNTIME_SECRETS_VERSION) return false;
  const secrets = record.secrets;
  if (typeof secrets !== "object" || secrets === null) return false;
  const entries = secrets as Record<string, unknown>;
  for (const name of SECRET_NAMES) {
    if (!isUsableSecret(name, entries[name])) return false;
  }
  const dedicated = [entries.SCREEN_PROXY_SECRET, entries.SANDBOX_SUPERVISOR_TOKEN];
  if (new Set(dedicated).size !== dedicated.length) return false;
  for (const name of SECRET_NAMES) {
    if (typeof entries[name] !== "string" || (entries[name] as string).trim() === "") return false;
  }
  return true;
}

/**
 * Reads the persisted secrets, or null when absent, unreadable, or malformed.
 * Never throws: a missing file is the normal fresh-install case.
 */
export async function readRuntimeSecrets(dir: string): Promise<RuntimeSecrets | null> {
  const raw = await readPrivateFile(path.join(dir, RUNTIME_SECRETS_FILE), 8192);
  if (raw === null) return null;
  const parsed = parseSecretRecord(raw);
  return parsed !== null && isUsableSecretSet({ version: RUNTIME_SECRETS_VERSION, secrets: parsed })
    ? parsed
    : null;
}

/** Parses the file shape without judging whether the entries are usable. */
function parseSecretRecord(raw: string): RuntimeSecrets | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record.version !== RUNTIME_SECRETS_VERSION) return null;
  const secrets = record.secrets;
  if (typeof secrets !== "object" || secrets === null) return null;
  const entries = secrets as Record<string, unknown>;
  const result = {} as RuntimeSecrets;
  for (const name of SECRET_NAMES) {
    const value = entries[name];
    result[name] = typeof value === "string" ? value : "";
  }
  return result;
}

/** Fills unusable entries and resolves dedicated-credential collisions. */
function completeSecrets(
  base: RuntimeSecrets,
  randomHex: (bytes: number) => string,
): { secrets: RuntimeSecrets; changed: boolean } {
  const next: RuntimeSecrets = { ...base };
  let changed = false;
  for (const name of SECRET_NAMES) {
    if (!isUsableSecret(name, next[name])) {
      next[name] = randomHex(32);
      changed = true;
    }
  }
  // The two dedicated credentials must differ; regenerate the supervisor token
  // when a hand-edited file made them equal.
  if (next.SCREEN_PROXY_SECRET === next.SANDBOX_SUPERVISOR_TOKEN) {
    next.SANDBOX_SUPERVISOR_TOKEN = randomHex(32);
    changed = true;
  }
  return { secrets: next, changed };
}

async function writeRuntimeSecrets(dir: string, secrets: RuntimeSecrets): Promise<void> {
  await writePrivateFile(
    path.join(dir, RUNTIME_SECRETS_FILE),
    `${JSON.stringify({ version: RUNTIME_SECRETS_VERSION, secrets })}\n`,
  );
}

/**
 * Returns the persisted secrets, generating and persisting only the entries
 * that are missing or unusable. Existing entries are never rotated: rotating
 * BETTER_AUTH_SECRET would sign everyone out and rotating ENCRYPTION_KEY would
 * make every stored credential undecryptable.
 */
export async function ensureRuntimeSecrets(
  dir: string,
  randomHex: (bytes: number) => string,
): Promise<RuntimeSecrets> {
  const raw = await readPrivateFile(path.join(dir, RUNTIME_SECRETS_FILE), 8192);
  const base: RuntimeSecrets =
    raw === null
      ? { BETTER_AUTH_SECRET: "", ENCRYPTION_KEY: "", SCREEN_PROXY_SECRET: "", SANDBOX_SUPERVISOR_TOKEN: "" }
      : (parseSecretRecord(raw) ?? {
          BETTER_AUTH_SECRET: "",
          ENCRYPTION_KEY: "",
          SCREEN_PROXY_SECRET: "",
          SANDBOX_SUPERVISOR_TOKEN: "",
        });
  const { secrets, changed } = completeSecrets(base, randomHex);
  if (changed || raw === null) await writeRuntimeSecrets(dir, secrets);
  return secrets;
}

/**
 * Parses `KEY=value` lines the way the legacy Compose `.env` file stores them:
 * blank lines and `#` comments are ignored, only the first `=` splits, and
 * surrounding quotes are stripped. Values are never logged or returned except
 * inside the resulting secrets object.
 */
export function parseLegacyStackEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (name !== "" && value !== "") result[name] = value;
  }
  return result;
}

/**
 * Seeds the native secrets file from a legacy Compose `.env` so migration
 * preserves sessions and encrypted credentials: BETTER_AUTH_SECRET keeps
 * login cookies valid and ENCRYPTION_KEY keeps stored credentials decryptable.
 * Entries that are missing or unusable are generated fresh. The legacy file is
 * never modified.
 */
export async function seedRuntimeSecretsFromLegacyEnv(
  dir: string,
  envText: string,
  randomHex: (bytes: number) => string,
): Promise<RuntimeSecrets> {
  const legacy = parseLegacyStackEnv(envText);
  const raw = await readPrivateFile(path.join(dir, RUNTIME_SECRETS_FILE), 8192);
  const base: RuntimeSecrets =
    raw === null
      ? { BETTER_AUTH_SECRET: "", ENCRYPTION_KEY: "", SCREEN_PROXY_SECRET: "", SANDBOX_SUPERVISOR_TOKEN: "" }
      : (parseSecretRecord(raw) ?? {
          BETTER_AUTH_SECRET: "",
          ENCRYPTION_KEY: "",
          SCREEN_PROXY_SECRET: "",
          SANDBOX_SUPERVISOR_TOKEN: "",
        });
  let changed = raw === null;
  for (const name of SECRET_NAMES) {
    if (isUsableSecret(name, base[name])) continue;
    const candidate = legacy[name];
    if (isUsableSecret(name, candidate)) {
      base[name] = candidate as string;
      changed = true;
    }
  }
  const { secrets, changed: completed } = completeSecrets(base, randomHex);
  if (changed || completed) await writeRuntimeSecrets(dir, secrets);
  return secrets;
}
