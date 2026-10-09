import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearE2BKey,
  e2bKeyFilePath,
  hasE2BKey,
  loadE2BKey,
  localRuntimeStatus,
  localServiceSandboxEnv,
  readLocalRuntimeSettings,
  runtimeSettingsFilePath,
  type SafeStorageLike,
  storeE2BKey,
  writeLocalRuntimeSettings,
} from "./local-runtime-settings.js";

function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText: string) => Buffer.from(`enc:${plainText}`, "utf8"),
    decryptString: (encrypted: Buffer) => {
      const text = encrypted.toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("decrypt failed");
      return text.slice("enc:".length);
    },
  };
}

let userData: string;

beforeEach(async () => {
  userData = await mkdtemp(path.join(tmpdir(), "rakazo-runtime-settings-"));
});

afterEach(async () => {
  await rm(userData, { recursive: true, force: true });
});

describe("local runtime settings", () => {
  it("starts with no key and fallback disabled on first launch", async () => {
    await expect(hasE2BKey(userData, fakeSafeStorage())).resolves.toBe(false);
    await expect(loadE2BKey(userData, fakeSafeStorage())).resolves.toBeNull();
    await expect(readLocalRuntimeSettings(userData)).resolves.toEqual({
      version: 1,
      allowDockerComputerFallback: false,
    });
    await expect(localRuntimeStatus(userData, fakeSafeStorage())).resolves.toEqual({
      hasE2BKey: false,
      allowDockerComputerFallback: false,
    });
  });

  it("stores a valid key encrypted, never as plaintext", async () => {
    await storeE2BKey(userData, fakeSafeStorage(), "test-e2b-key");
    await expect(loadE2BKey(userData, fakeSafeStorage())).resolves.toBe("test-e2b-key");
    await expect(hasE2BKey(userData, fakeSafeStorage())).resolves.toBe(true);
    const raw = await readFile(e2bKeyFilePath(userData), "utf8");
    expect(raw).not.toContain("test-e2b-key");
  });

  it("treats a corrupt key store as absent without throwing", async () => {
    await writeFile(e2bKeyFilePath(userData), "not-a-valid-blob\n", "utf8");
    await expect(loadE2BKey(userData, fakeSafeStorage())).resolves.toBeNull();
    await expect(hasE2BKey(userData, fakeSafeStorage())).resolves.toBe(false);
    await expect(localRuntimeStatus(userData, fakeSafeStorage())).resolves.toEqual({
      hasE2BKey: false,
      allowDockerComputerFallback: false,
    });
  });

  it("rotates the key and clears it on request", async () => {
    await storeE2BKey(userData, fakeSafeStorage(), "test-e2b-key-one");
    await storeE2BKey(userData, fakeSafeStorage(), "test-e2b-key-two");
    await expect(loadE2BKey(userData, fakeSafeStorage())).resolves.toBe("test-e2b-key-two");
    await clearE2BKey(userData);
    await expect(hasE2BKey(userData, fakeSafeStorage())).resolves.toBe(false);
  });

  it("fails closed when secure storage is unavailable", async () => {
    const unavailable = fakeSafeStorage(false);
    await expect(storeE2BKey(userData, unavailable, "test-e2b-key")).rejects.toThrow(
      /Secure storage/,
    );
    await expect(loadE2BKey(userData, unavailable)).resolves.toBeNull();
    await expect(hasE2BKey(userData, unavailable)).resolves.toBe(false);
    await expect(storeE2BKey(userData, null, "test-e2b-key")).rejects.toThrow(/Secure storage/);
  });

  it("rejects empty and oversized keys", async () => {
    await expect(storeE2BKey(userData, fakeSafeStorage(), "   ")).rejects.toThrow(/valid E2B/);
    await expect(storeE2BKey(userData, fakeSafeStorage(), "x".repeat(4097))).rejects.toThrow(
      /valid E2B/,
    );
    await expect(hasE2BKey(userData, fakeSafeStorage())).resolves.toBe(false);
  });

  it("persists the fallback policy across restarts and fails closed on corruption", async () => {
    await expect(
      writeLocalRuntimeSettings(userData, { version: 1, allowDockerComputerFallback: true }),
    ).resolves.toEqual({ version: 1, allowDockerComputerFallback: true });
    // A fresh reader over the same directory sees the persisted policy (restart).
    await expect(readLocalRuntimeSettings(userData)).resolves.toEqual({
      version: 1,
      allowDockerComputerFallback: true,
    });
    await writeFile(runtimeSettingsFilePath(userData), "{ corrupt\n", "utf8");
    await expect(readLocalRuntimeSettings(userData)).resolves.toEqual({
      version: 1,
      allowDockerComputerFallback: false,
    });
  });

  it("exposes only booleans to the renderer, never the key", async () => {
    await storeE2BKey(userData, fakeSafeStorage(), "test-e2b-key");
    await writeLocalRuntimeSettings(userData, { version: 1, allowDockerComputerFallback: true });
    const status = await localRuntimeStatus(userData, fakeSafeStorage());
    expect(status).toEqual({ hasE2BKey: true, allowDockerComputerFallback: true });
    expect(Object.keys(status).sort()).toEqual(["allowDockerComputerFallback", "hasE2BKey"]);
    expect(JSON.stringify(status)).not.toContain("test-e2b-key");
  });

  it("maps posture to an explicit child-process provider policy", () => {
    const base = { settingsPath: "/tmp/local-runtime-settings.json" };
    expect(
      localServiceSandboxEnv({
        ...base,
        e2bApiKey: "test-e2b-key",
        allowDockerComputerFallback: false,
        dockerFallbackReady: false,
      }),
    ).toEqual({
      RAKAZO_LOCAL_RUNTIME_SETTINGS_PATH: "/tmp/local-runtime-settings.json",
      SANDBOX_PROVIDER: "e2b",
      E2B_API_KEY: "test-e2b-key",
    });
    // E2B stays primary even when fallback is enabled and ready.
    expect(
      localServiceSandboxEnv({
        ...base,
        e2bApiKey: "test-e2b-key",
        allowDockerComputerFallback: true,
        dockerFallbackReady: true,
      }).SANDBOX_PROVIDER,
    ).toBe("e2b");
    expect(
      localServiceSandboxEnv({
        ...base,
        e2bApiKey: null,
        allowDockerComputerFallback: true,
        dockerFallbackReady: true,
      }),
    ).toMatchObject({ SANDBOX_PROVIDER: "docker" });
    // No key and no ready fallback: computers unavailable, backend unaffected.
    for (const input of [
      { ...base, e2bApiKey: null, allowDockerComputerFallback: false, dockerFallbackReady: false },
      { ...base, e2bApiKey: null, allowDockerComputerFallback: true, dockerFallbackReady: false },
    ] as const) {
      const env = localServiceSandboxEnv(input);
      expect(env.SANDBOX_PROVIDER).toBe("none");
      expect(env).not.toHaveProperty("E2B_API_KEY");
    }
  });
});
