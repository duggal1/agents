import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureRuntimeSecrets,
  parseLegacyStackEnv,
  readRuntimeSecrets,
  RUNTIME_SECRETS_FILE,
  seedRuntimeSecretsFromLegacyEnv,
} from "./local-runtime-secrets.js";

let counter = 0;
const uniqueHex = (bytes: number) => {
  counter += 1;
  return `${String(counter).padStart(4, "0")}${"cd".repeat(bytes)}`.slice(0, bytes * 2);
};
/** Every entry differs, so the set passes the dedicated-credential distinctness check. */
const hex = uniqueHex;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "rakazo-secrets-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("runtime secrets", () => {
  it("generates and persists a full set on first launch", async () => {
    const secrets = await ensureRuntimeSecrets(dir, hex);
    expect(Object.keys(secrets).sort()).toEqual([
      "BETTER_AUTH_SECRET",
      "ENCRYPTION_KEY",
      "SANDBOX_SUPERVISOR_TOKEN",
      "SCREEN_PROXY_SECRET",
    ]);
    for (const value of Object.values(secrets)) expect(value.length).toBeGreaterThanOrEqual(32);
    expect(secrets.SCREEN_PROXY_SECRET).not.toBe(secrets.SANDBOX_SUPERVISOR_TOKEN);
    const mode = (await stat(path.join(dir, RUNTIME_SECRETS_FILE))).mode & 0o777;
    expect(mode).toBeLessThanOrEqual(0o600);
  });

  it("keeps existing entries instead of rotating them", async () => {
    const first = await ensureRuntimeSecrets(dir, hex);
    const second = await ensureRuntimeSecrets(dir, uniqueHex);
    expect(second).toEqual(first);
  });

  it("repairs only the unusable entries in a hand-edited file", async () => {
    const full = await ensureRuntimeSecrets(dir, hex);
    await writeFile(
      path.join(dir, RUNTIME_SECRETS_FILE),
      `${JSON.stringify({
        version: 1,
        secrets: { ...full, ENCRYPTION_KEY: "" },
      })}\n`,
    );
    const repaired = await ensureRuntimeSecrets(dir, uniqueHex);
    expect(repaired.BETTER_AUTH_SECRET).toBe(full.BETTER_AUTH_SECRET);
    expect(repaired.ENCRYPTION_KEY).not.toBe("");
    expect(repaired.ENCRYPTION_KEY.length).toBeGreaterThanOrEqual(32);
  });

  it("returns null for a missing or corrupt file", async () => {
    expect(await readRuntimeSecrets(dir)).toBeNull();
    await writeFile(path.join(dir, RUNTIME_SECRETS_FILE), "not json{{{");
    expect(await readRuntimeSecrets(dir)).toBeNull();
  });

  it("rejects dedicated credentials that collide", async () => {
    await writeFile(
      path.join(dir, RUNTIME_SECRETS_FILE),
      `${JSON.stringify({
        version: 1,
        secrets: {
          BETTER_AUTH_SECRET: "a".repeat(64),
          ENCRYPTION_KEY: "b".repeat(64),
          SCREEN_PROXY_SECRET: "c".repeat(64),
          SANDBOX_SUPERVISOR_TOKEN: "c".repeat(64),
        },
      })}\n`,
    );
    expect(await readRuntimeSecrets(dir)).toBeNull();
    const repaired = await ensureRuntimeSecrets(dir, uniqueHex);
    expect(repaired.SCREEN_PROXY_SECRET).not.toBe(repaired.SANDBOX_SUPERVISOR_TOKEN);
  });
});

describe("legacy stack env parsing", () => {
  it("parses KEY=value lines and ignores comments and blanks", () => {
    const parsed = parseLegacyStackEnv(
      `# comment\n\nPOSTGRES_PASSWORD=abc123\nQUOTED="a=b"\nSINGLE='x y'\nEMPTY=\nNOEQUALS\n`,
    );
    expect(parsed).toEqual({ POSTGRES_PASSWORD: "abc123", QUOTED: "a=b", SINGLE: "x y" });
  });

  it("seeds the auth secret and encryption key from the legacy file", async () => {
    const legacy = [
      "POSTGRES_PASSWORD=old-db-pass",
      "BETTER_AUTH_SECRET=legacy-auth-secret-abcdefghijklmnopqrstuvwxyz0123456789",
      "ENCRYPTION_KEY=legacy-encryption-key-abcdefghijklmnopqrstuvwxyz0123456789",
      "SCREEN_PROXY_SECRET=short",
      "SANDBOX_SUPERVISOR_TOKEN=legacy-supervisor-token-abcdefghijklmnopqrstuvwxyz01",
    ].join("\n");
    const secrets = await seedRuntimeSecretsFromLegacyEnv(dir, legacy, hex);
    expect(secrets.BETTER_AUTH_SECRET).toContain("legacy-auth-secret");
    expect(secrets.ENCRYPTION_KEY).toContain("legacy-encryption-key");
    // Too short to be a dedicated credential, so it is regenerated, not kept.
    expect(secrets.SCREEN_PROXY_SECRET).not.toBe("short");
    expect(secrets.SCREEN_PROXY_SECRET.length).toBeGreaterThanOrEqual(32);
    const stored = await readFile(path.join(dir, RUNTIME_SECRETS_FILE), "utf8");
    expect(stored).toContain("legacy-auth-secret");
  });

  it("never overwrites usable native secrets with legacy values", async () => {
    const native = await ensureRuntimeSecrets(dir, hex);
    const seeded = await seedRuntimeSecretsFromLegacyEnv(
      dir,
      "BETTER_AUTH_SECRET=another-legacy-auth-secret-abcdefghijklmnopqr",
      uniqueHex,
    );
    expect(seeded).toEqual(native);
  });
});
