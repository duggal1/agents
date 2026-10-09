import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BackendRuntime,
  buildServiceManifests,
  LocalBackend,
  type LocalBackendDeps,
} from "./local-backend.js";
import type { DatabaseController } from "./local-runtime.js";
import { localSandboxServiceEnv } from "./local-runtime-settings.js";

const secrets = {
  BETTER_AUTH_SECRET: "a".repeat(64),
  ENCRYPTION_KEY: "b".repeat(64),
  SCREEN_PROXY_SECRET: "c".repeat(64),
  SANDBOX_SUPERVISOR_TOKEN: "d".repeat(64),
};

function fakeDatabase() {
  const database: DatabaseController = {
    start: async () => ({ phase: "ready", message: null }),
    stop: async () => ({ phase: "stopped", message: null }),
    state: () => ({ phase: "ready", message: null }),
    url: () => "postgres://rakazo:pw1234567890123456@127.0.0.1:55432/rakazo",
    output: () => [],
    subscribe: () => () => undefined,
  };
  return database;
}

function fakeRuntime(): BackendRuntime & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    state: () => ({ phase: "ready", message: null, output: [] }),
    output: () => [],
    start: async () => void calls.push("start"),
    stop: async () => void calls.push("stop"),
    databaseUrl: () => "postgres://rakazo:pw@127.0.0.1:55432/rakazo",
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "rakazo-backend-sandbox-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function depsFor(overrides: Partial<LocalBackendDeps> = {}): LocalBackendDeps {
  return {
    userDataDir: dir,
    platform: process.platform,
    arch: process.arch,
    env: {
      HOME: "/Users/tester",
      PATH: "/usr/bin",
      SAPPHIRE_LOCAL_WEB_URL: "http://127.0.0.1:45173",
    },
    execPath: process.execPath,
    packaged: false,
    resourcesPath: "/resources",
    appPath: "/repo/apps/desktop",
    appVersion: "0.1.6",
    randomHex: (bytes) => "ef".repeat(bytes),
    run: (async () => ({ code: 0, stdout: "", stderr: "" })) as LocalBackendDeps["run"],
    exists: () => false,
    probeApi: async () => true,
    createDatabase: () => fakeDatabase(),
    ...overrides,
  };
}

describe("sandbox service env", () => {
  it("merges the sandbox policy into both services without touching core fields", () => {
    const sandboxEnv = {
      SAPPHIRE_LOCAL_RUNTIME_SETTINGS_PATH: "/user/settings.json",
      SANDBOX_PROVIDER: "e2b",
      E2B_API_KEY: "test-e2b-key",
    };
    const { serviceEnv } = buildServiceManifests({
      apiPort: 45173,
      webUrl: "http://127.0.0.1:45173",
      secrets,
      stackToken: "e".repeat(64),
      appDataDir: "/user/appdata",
      nodeEnv: "production",
      sandboxEnv,
    });
    for (const env of [serviceEnv.api, serviceEnv.worker]) {
      expect(env).toMatchObject(sandboxEnv);
    }
    expect(serviceEnv.api.API_HOST).toBe("127.0.0.1");
    // Absent by default: E2B-primary resolution happens from the process env.
    const { serviceEnv: plain } = buildServiceManifests({
      apiPort: 45173,
      webUrl: "http://127.0.0.1:45173",
      secrets,
      stackToken: "e".repeat(64),
      appDataDir: "/user/appdata",
      nodeEnv: "production",
    });
    expect(plain.api).not.toHaveProperty("SANDBOX_PROVIDER");
    expect(plain.worker).not.toHaveProperty("E2B_API_KEY");
  });

  it("boots services with the resolved sandbox policy", async () => {
    const runtime = fakeRuntime();
    const seen: { api: Record<string, string>; worker: Record<string, string> }[] = [];
    const backend = new LocalBackend(
      depsFor({
        createRuntime: (args) => {
          seen.push(args.serviceEnv);
          return runtime;
        },
        resolveSandboxServiceEnv: async (context) => {
          expect(context.appDataDir).toContain("appdata");
          return {
            SAPPHIRE_LOCAL_RUNTIME_SETTINGS_PATH: "/user/settings.json",
            SANDBOX_PROVIDER: "e2b",
            E2B_API_KEY: "test-e2b-key",
          };
        },
      }),
    );
    await expect(backend.start()).resolves.toMatchObject({ phase: "ready" });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.api.SANDBOX_PROVIDER).toBe("e2b");
    expect(seen[0]?.api.E2B_API_KEY).toBe("test-e2b-key");
    expect(seen[0]?.worker.SANDBOX_PROVIDER).toBe("e2b");
    await backend.stop();
  });

  it("still boots when sandbox resolution fails", async () => {
    const runtime = fakeRuntime();
    const backend = new LocalBackend(
      depsFor({
        createRuntime: () => runtime,
        resolveSandboxServiceEnv: async () => {
          throw new Error("supervisor unavailable");
        },
      }),
    );
    await expect(backend.start()).resolves.toMatchObject({ phase: "ready" });
    await backend.stop();
  });

  it("stops services before the fallback supervisor hook", async () => {
    const runtime = fakeRuntime();
    const order: string[] = [];
    const backend = new LocalBackend(
      depsFor({
        createRuntime: () => ({
          ...runtime,
          stop: async () => void order.push("services"),
        }),
        afterServicesStop: async () => void order.push("supervisor"),
      }),
    );
    await backend.start();
    await backend.stop();
    expect(order).toEqual(["services", "supervisor"]);
    expect(backend.state().phase).toBe("idle");
  });

  it("swallows a failing supervisor shutdown", async () => {
    const backend = new LocalBackend(
      depsFor({
        createRuntime: () => fakeRuntime(),
        afterServicesStop: async () => {
          throw new Error("docker stuck");
        },
      }),
    );
    await backend.start();
    await expect(backend.stop()).resolves.toMatchObject({ phase: "idle" });
  });
});

describe("local sandbox service env", () => {
  const base = { settingsPath: "/user/settings.json" };
  it("keeps E2B primary without supervisor credentials", () => {
    const env = localSandboxServiceEnv({
      ...base,
      e2bApiKey: "test-e2b-key",
      allowDockerComputerFallback: true,
      supervisor: { url: "http://127.0.0.1:7091", token: "test-token" },
    });
    expect(env.SANDBOX_PROVIDER).toBe("e2b");
    expect(env.E2B_API_KEY).toBe("test-e2b-key");
    expect(env).not.toHaveProperty("SANDBOX_SUPERVISOR_URL");
    expect(env).not.toHaveProperty("SANDBOX_SUPERVISOR_TOKEN");
  });

  it("wires the supervisor only when Docker fallback serves", () => {
    const env = localSandboxServiceEnv({
      ...base,
      e2bApiKey: null,
      allowDockerComputerFallback: true,
      supervisor: { url: "http://127.0.0.1:7091", token: "test-token" },
    });
    expect(env).toMatchObject({
      SANDBOX_PROVIDER: "docker",
      SANDBOX_SUPERVISOR_URL: "http://127.0.0.1:7091",
      SANDBOX_SUPERVISOR_TOKEN: "test-token",
    });
  });

  it("selects none when fallback cannot serve", () => {
    const env = localSandboxServiceEnv({
      ...base,
      e2bApiKey: null,
      allowDockerComputerFallback: true,
      supervisor: null,
    });
    expect(env.SANDBOX_PROVIDER).toBe("none");
    expect(env).not.toHaveProperty("SANDBOX_SUPERVISOR_TOKEN");
    expect(env.SAPPHIRE_LOCAL_RUNTIME_SETTINGS_PATH).toBe("/user/settings.json");
  });
});
