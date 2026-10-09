import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertLoopbackWebUrl,
  type BackendRuntime,
  buildServiceManifests,
  LocalBackend,
  type LocalBackendDeps,
  normalizeStartOptions,
  prismaMigrateDeploy,
  RUNTIME_EXEC_PATH_ENV,
} from "./local-backend.js";
import type { DatabaseController } from "./local-runtime.js";
import { resolveRuntimeEntry } from "./local-runtime.js";

const secrets = {
  BETTER_AUTH_SECRET: "a".repeat(64),
  ENCRYPTION_KEY: "b".repeat(64),
  SCREEN_PROXY_SECRET: "c".repeat(64),
  SANDBOX_SUPERVISOR_TOKEN: "d".repeat(64),
};

function fakeDatabase(url = "postgres://rakazo:pw1234567890123456@127.0.0.1:55432/rakazo") {
  const database: DatabaseController = {
    start: async () => ({ phase: "ready", message: null }),
    stop: async () => ({ phase: "stopped", message: null }),
    state: () => ({ phase: "ready", message: null }),
    url: () => url,
    output: () => [],
    subscribe: () => () => undefined,
  };
  return database;
}

function fakeRuntime(outcome: "ready" | "failed" = "ready"): BackendRuntime & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    state: () => ({
      phase: outcome,
      message: outcome === "ready" ? null : "service did not start",
      output: [],
    }),
    output: () => [],
    start: async () => void calls.push("start"),
    stop: async () => void calls.push("stop"),
    databaseUrl: () => "postgres://rakazo:pw@127.0.0.1:55432/rakazo",
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "rakazo-backend-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function depsFor(overrides: Partial<LocalBackendDeps> = {}): LocalBackendDeps {
  return {
    userDataDir: dir,
    platform: process.platform,
    arch: process.arch,
    env: { HOME: "/Users/tester", PATH: "/usr/bin" },
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

describe("start options", () => {
  it("drops everything except an explicit fresh flag", () => {
    expect(normalizeStartOptions(undefined)).toEqual({});
    expect(normalizeStartOptions(null)).toEqual({});
    expect(normalizeStartOptions("start")).toEqual({});
    expect(normalizeStartOptions({ fresh: true })).toEqual({ fresh: true });
    expect(
      normalizeStartOptions({
        fresh: true,
        entry: "../../evil/index.js",
        env: { PORT: "1", DATABASE_URL: "x" },
        port: 9,
        command: "rm -rf /",
      }),
    ).toEqual({ fresh: true });
    expect(normalizeStartOptions({ fresh: "yes" })).toEqual({});
  });
});

describe("loopback binds", () => {
  it("accepts only http(s) loopback origins", () => {
    expect(assertLoopbackWebUrl("http://127.0.0.1:45173")).toBe("http://127.0.0.1:45173");
    expect(assertLoopbackWebUrl("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(assertLoopbackWebUrl("http://[::1]:8080/x")).toBe("http://[::1]:8080");
    for (const target of [
      "http://0.0.0.0:3100",
      "http://192.168.1.20:3100",
      "http://10.0.0.5:3100",
      "http://example.com:3100",
      "http://[::]:3100",
      "file:///etc/passwd",
      "not a url",
      "",
    ]) {
      expect(() => assertLoopbackWebUrl(target), target).toThrow(/non-loopback/);
    }
  });
});

describe("service manifests", () => {
  const built = () =>
    buildServiceManifests({
      apiPort: 45173,
      webUrl: "http://127.0.0.1:45173",
      secrets,
      stackToken: "e".repeat(64),
      appDataDir: "/user/appdata",
      nodeEnv: "production",
    });

  it("binds the API to loopback only and runs services under Electron-as-Node", () => {
    const { manifests, serviceEnv } = built();
    expect(serviceEnv.api.API_HOST).toBe("127.0.0.1");
    expect(serviceEnv.api.API_PORT).toBe("45173");
    for (const env of [serviceEnv.api, serviceEnv.worker]) {
      expect(env[RUNTIME_EXEC_PATH_ENV]).toBe("1");
      for (const value of Object.values(env)) {
        expect(value).not.toContain("0.0.0.0");
      }
      expect(env).not.toHaveProperty("DATABASE_URL");
    }
    expect(manifests.api.entry).toBe("services/api/index.js");
    expect(manifests.worker.entry).toBe("services/worker/index.js");
  });

  it("keeps manifest entries inside the runtime root", () => {
    const { manifests } = built();
    for (const manifest of Object.values(manifests)) {
      expect(resolveRuntimeEntry("/runtime", manifest.entry)).not.toBeNull();
    }
  });
});

describe("backend lifecycle", () => {
  it("boots an empty backend when no legacy stack exists", async () => {
    const runtime = fakeRuntime();
    const seen: Array<{
      manifests: unknown;
      serviceEnv: { api: Record<string, string>; worker: Record<string, string> };
    }> = [];
    const backend = new LocalBackend(
      depsFor({
        createRuntime: (args) => {
          seen.push(args);
          return runtime;
        },
      }),
    );
    const state = await backend.start();
    expect(state.phase).toBe("ready");
    expect(state.freshStartAvailable).toBe(false);
    expect(runtime.calls).toEqual(["start"]);
    const args = seen[0];
    if (args === undefined) throw new Error("runtime was not created");
    expect(args.serviceEnv.api.API_HOST).toBe("127.0.0.1");
    // Secrets and the stack token were generated owner-only for the services.
    expect(args.serviceEnv.api.BETTER_AUTH_SECRET?.length).toBeGreaterThanOrEqual(32);
    expect(args.serviceEnv.api.RAKAZO_DESKTOP_STACK_TOKEN).toMatch(/^[a-f0-9]{64}$/);
  });

  it("stops gracefully at any phase", async () => {
    const runtime = fakeRuntime();
    const backend = new LocalBackend(depsFor({ createRuntime: () => runtime }));
    expect((await backend.stop()).phase).toBe("idle");
    await backend.start();
    expect((await backend.stop()).phase).toBe("idle");
    expect(runtime.calls).toEqual(["start", "stop"]);
  });

  it("reports strict readiness for setup save", async () => {
    const backend = new LocalBackend(depsFor({ createRuntime: () => fakeRuntime() as never }));
    expect(await backend.matchesDesired()).toBe(false);
    await backend.start();
    expect(await backend.matchesDesired()).toBe(true);
    const closed = new LocalBackend(
      depsFor({ createRuntime: () => fakeRuntime() as never, probeApi: async () => false }),
    );
    await closed.start();
    expect(await closed.matchesDesired()).toBe(false);
  });

  it("exposes the settings target only when ready, never the secrets", async () => {
    const backend = new LocalBackend(depsFor({ createRuntime: () => fakeRuntime() as never }));
    expect(await backend.localSettingsTarget()).toBeNull();
    await backend.start();
    const target = await backend.localSettingsTarget();
    expect(target?.origin).toBe(backend.webUrl());
    expect(target?.token).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(backend.state())).not.toContain(target?.token ?? "impossible");
  });

  it("asks for Docker and offers a fresh start when legacy data is stuck", async () => {
    const stackDirPath = path.join(dir, "stack");
    await mkdir(stackDirPath, { recursive: true });
    await writeFile(path.join(stackDirPath, "docker-compose.images.yml"), "services: {}");
    const created: unknown[] = [];
    const backend = new LocalBackend(
      depsFor({
        // A missing binary even though Docker may exist on this machine.
        env: { HOME: "/Users/tester", SAPPHIRE_DOCKER_BINARY: "/nonexistent/docker" },
        exists: existsSync,
        createRuntime: (...args: unknown[]) => {
          created.push(args);
          return fakeRuntime();
        },
      }),
    );
    const state = await backend.start();
    expect(state.phase).toBe("failed");
    expect(state.freshStartAvailable).toBe(true);
    expect(state.message).toMatch(/Docker/i);
    expect(created).toEqual([]);
    // The legacy stack is untouched.
    expect(await readFile(path.join(stackDirPath, "docker-compose.images.yml"), "utf8")).toBe(
      "services: {}",
    );
  });

  it("starts fresh on explicit request while preserving the legacy stack", async () => {
    const stackDirPath = path.join(dir, "stack");
    await mkdir(stackDirPath, { recursive: true });
    await writeFile(path.join(stackDirPath, "docker-compose.images.yml"), "services: {}");
    const backend = new LocalBackend(
      depsFor({ exists: existsSync, createRuntime: () => fakeRuntime() }),
    );
    const state = await backend.start({ fresh: true });
    expect(state.phase).toBe("ready");
    const marker = JSON.parse(
      await readFile(path.join(dir, "migration", "migration-state.json"), "utf8"),
    ) as { status: string };
    expect(marker.status).toBe("skipped-empty");
    expect(await readFile(path.join(stackDirPath, "docker-compose.images.yml"), "utf8")).toBe(
      "services: {}",
    );
  });

  it("ignores malicious start options and boots normally", async () => {
    const backend = new LocalBackend(depsFor({ createRuntime: () => fakeRuntime() as never }));
    const state = await backend.start({ entry: "/bin/sh", env: { EVIL: "1" } });
    expect(state.phase).toBe("ready");
  });

  it("reallocates the web URL when the saved port is taken", async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const address = taken.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    try {
      const stackDirPath = path.join(dir, "stack");
      await mkdir(stackDirPath, { recursive: true });
      await writeFile(
        path.join(stackDirPath, ".desktop-web-url"),
        `http://127.0.0.1:${address.port}`,
      );
      const backend = new LocalBackend(
        depsFor({
          createRuntime: () => fakeRuntime() as never,
          allocatePort: async () => 45999,
        }),
      );
      const state = await backend.start();
      expect(state.phase).toBe("ready");
      expect(backend.webUrl()).toBe("http://127.0.0.1:45999");
      expect(await readFile(path.join(stackDirPath, ".desktop-web-url"), "utf8")).toBe(
        "http://127.0.0.1:45999",
      );
    } finally {
      taken.close();
    }
  });

  it("refuses a non-loopback override from the environment", async () => {
    const backend = new LocalBackend(
      depsFor({
        createRuntime: () => fakeRuntime() as never,
        env: { SAPPHIRE_LOCAL_WEB_URL: "http://0.0.0.0:3100" },
      }),
    );
    const state = await backend.start();
    expect(state.phase).toBe("failed");
    expect(state.message).toMatch(/non-loopback/);
  });
});

describe("prismaMigrateDeploy", () => {
  const base = {
    runtimeRoot: "/runtime",
    repoRoot: "/repo",
    databaseUrl: "postgres://rakazo:pw@127.0.0.1:1/rakazo",
    platform: "darwin",
    execPath: "/App/Sapphire",
    arch: "arm64",
    env: {},
    timeoutMs: 1000,
  };

  it("fails closed when the packaged migration tool is missing", async () => {
    const run = vi.fn();
    await expect(
      prismaMigrateDeploy({ ...base, packaged: true, run: run as never, exists: () => false }),
    ).rejects.toThrow(/migration tool/);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the staged migrate tool on the service runtime with an explicit engine", async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    await prismaMigrateDeploy({
      ...base,
      packaged: true,
      run: run as never,
      exists: () => true,
    });
    expect(run).toHaveBeenCalledOnce();
    const [binary, args, options] = run.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string>; cwd: string },
    ];
    // The CLI bundle needs CJS-main globals, so it runs on the same
    // Node-capable runtime as the services; no --schema flag because the
    // staged config in cwd already declares schema and migrations paths.
    expect(binary).toBe("/App/Sapphire");
    expect(args).toEqual([
      "/runtime/prisma/bin/prisma.mjs",
      "migrate",
      "deploy",
    ]);
    expect(options.cwd).toBe("/runtime/prisma");
    expect(options.env.DATABASE_URL).toBe(base.databaseUrl);
    expect(options.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(options.env.PRISMA_SCHEMA_ENGINE_BINARY).toBe(
      "/runtime/prisma/engines/arm64/schema-engine-arm64",
    );
  });

  it("runs a fixed argv with only DATABASE_URL added", async () => {
    const run = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    await prismaMigrateDeploy({
      ...base,
      packaged: false,
      run: run as never,
      exists: (file) => file === "/repo/node_modules/.bin/prisma",
    });
    expect(run).toHaveBeenCalledOnce();
    const [binary, args, options] = run.mock.calls[0] as [string, string[], { env: Record<string, string> }];
    expect(binary).toBe("/repo/node_modules/.bin/prisma");
    expect(args).toEqual(["migrate", "deploy"]);
    expect(options.env.DATABASE_URL).toBe(base.databaseUrl);
    expect(options.env).not.toHaveProperty("E2B_API_KEY");
  });

  it("treats a nonzero exit as a failed migration", async () => {
    const run = vi.fn(async () => ({ code: 1, stdout: "", stderr: "boom" }));
    await expect(
      prismaMigrateDeploy({
        ...base,
        packaged: false,
        run: run as never,
        exists: () => true,
      }),
    ).rejects.toThrow(/could not be updated/);
  });
});
