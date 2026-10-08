import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { SpawnOptions } from "node:child_process";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DESKTOP_MACOS_ARCHITECTURES,
  DESKTOP_MINIMUM_MACOS,
  LocalProcess,
  type LocalServiceManifest,
  type ManagedChild,
  redactRuntimeLogLine,
  resolveRuntimeEntry,
  runtimeChildEnv,
  runtimeResourceDir,
  type SpawnManagedChild,
} from "./local-runtime.js";

class FakeChild extends EventEmitter implements ManagedChild {
  pid = 4321;
  stdout = new PassThrough();
  stderr = new PassThrough();
  signals: NodeJS.Signals[] = [];

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal ?? "SIGTERM");
    return true;
  }

  write(line: string) {
    this.stdout.write(`${line}\n`);
  }

  exit(code: number | null = 0, signal: NodeJS.Signals | null = null) {
    this.emit("exit", code, signal);
  }

  error(error: Error) {
    this.emit("error", error);
  }
}

interface SpawnRecord {
  command: string;
  args: string[];
  options: SpawnOptions;
}

function fakeSpawn() {
  const children: FakeChild[] = [];
  const calls: SpawnRecord[] = [];
  const spawn: SpawnManagedChild = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new FakeChild();
    children.push(child);
    return child;
  };
  return { children, calls, spawn };
}

function manifest(overrides: Partial<LocalServiceManifest> = {}): LocalServiceManifest {
  return {
    id: "api",
    entry: "api/index.js",
    args: [],
    env: {},
    readiness: { kind: "immediate" },
    startupTimeoutMs: 5_000,
    restart: { maxRestarts: 0, backoffMs: 100 },
    shutdown: { signal: "SIGTERM", timeoutMs: 2_000 },
    ...overrides,
  };
}

function makeProcess(
  overrides: Partial<LocalServiceManifest> = {},
  options: {
    spawn?: SpawnManagedChild;
    secrets?: string[];
    env?: Record<string, string>;
    inheritedEnv?: NodeJS.ProcessEnv;
    onOutput?: (line: string) => void;
  } = {},
) {
  const fake = options.spawn === undefined ? fakeSpawn() : null;
  const process = new LocalProcess({
    manifest: manifest(overrides),
    root: "/runtime",
    execPath: "/opt/node/bin/node",
    env: options.env ?? { DATABASE_URL: "postgres://127.0.0.1:5432/sapphire" },
    inheritedEnv: options.inheritedEnv ?? { HOME: "/Users/me", PATH: "/usr/bin", SECRET_KEY: "leak" },
    platform: "darwin",
    secrets: options.secrets,
    spawn: options.spawn ?? fake?.spawn,
    onOutput: options.onOutput,
  });
  return { process, fake };
}

describe("runtime packaging contract", () => {
  it("pins the minimum macOS the shipped Electron artifact supports", () => {
    expect(DESKTOP_MINIMUM_MACOS).toBe("13.0");
    expect([...DESKTOP_MACOS_ARCHITECTURES]).toEqual(["arm64", "x64"]);
  });

  it("reads runtime resources from the bundle when packaged and the repo otherwise", () => {
    expect(runtimeResourceDir({ packaged: true, resourcesPath: "/App/Resources", appPath: "/x" })).toBe(
      path.join("/App/Resources", "runtime"),
    );
    expect(
      runtimeResourceDir({ packaged: false, resourcesPath: "/x", appPath: "/repo/apps/desktop" }),
    ).toBe(path.resolve("/repo/runtime"));
  });

  it("rejects absolute and traversing entries", () => {
    expect(resolveRuntimeEntry("/runtime", "api/index.js")).toBe(
      path.join("/runtime", "api", "index.js"),
    );
    expect(resolveRuntimeEntry("/runtime", "../escape.js")).toBeNull();
    expect(resolveRuntimeEntry("/runtime", "/etc/passwd")).toBeNull();
    expect(resolveRuntimeEntry("/runtime", "")).toBeNull();
  });
});

describe("runtimeChildEnv", () => {
  it("inherits only what a Node service needs and merges the explicit service env", () => {
    const env = runtimeChildEnv(
      "darwin",
      { HOME: "/Users/me", PATH: "/usr/bin", LANG: "en_US.UTF-8", E2B_API_KEY: "leak", SECRET_KEY: "leak" },
      { DATABASE_URL: "postgres://127.0.0.1:5432/sapphire", NODE_ENV: "production" },
    );
    expect(env).toEqual({
      HOME: "/Users/me",
      LANG: "en_US.UTF-8",
      DATABASE_URL: "postgres://127.0.0.1:5432/sapphire",
      NODE_ENV: "production",
    });
    expect(env).not.toHaveProperty("PATH");
    expect(env).not.toHaveProperty("E2B_API_KEY");
    expect(env).not.toHaveProperty("SECRET_KEY");
  });

  it("keeps the Windows system variables Node depends on", () => {
    expect(
      runtimeChildEnv("win32", { SystemRoot: "C:\\Windows", APPDATA: "C:\\Users\\me\\AppData" }, {}),
    ).toEqual({ SystemRoot: "C:\\Windows", APPDATA: "C:\\Users\\me\\AppData" });
  });
});

describe("redactRuntimeLogLine", () => {
  it("scrubs exact secret values wherever they appear", () => {
    expect(redactRuntimeLogLine("connecting with supersecret-token now", ["supersecret-token"])).toBe(
      "connecting with [redacted] now",
    );
  });

  it("masks labelled and bearer credentials", () => {
    expect(redactRuntimeLogLine("POSTGRES_PASSWORD=hunter2")).toBe("POSTGRES_PASSWORD=[redacted]");
    expect(redactRuntimeLogLine("Authorization: Bearer abc.def.ghi")).toBe(
      "Authorization: Bearer [redacted]",
    );
  });

  it("leaves ordinary lines untouched", () => {
    expect(redactRuntimeLogLine("server listening on 127.0.0.1:45173")).toBe(
      "server listening on 127.0.0.1:45173",
    );
  });
});

describe("LocalProcess", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("spawns the resolved entry with the configured runtime and service env", () => {
    const { process, fake } = makeProcess();
    process.start();
    expect(fake?.calls).toHaveLength(1);
    expect(fake?.calls[0]?.command).toBe("/opt/node/bin/node");
    expect(fake?.calls[0]?.args).toEqual([path.join("/runtime", "api", "index.js")]);
    expect(fake?.calls[0]?.options.env).toMatchObject({
      HOME: "/Users/me",
      DATABASE_URL: "postgres://127.0.0.1:5432/sapphire",
    });
    expect(process.current().phase).toBe("running");
  });

  it("waits for a readiness log line before reporting running", async () => {
    const { process, fake } = makeProcess({
      readiness: { kind: "log", pattern: "ready to serve" },
      startupTimeoutMs: 100,
    });
    process.start();
    const ready = process.whenReady();
    expect(process.current().phase).toBe("starting");
    fake?.children[0]?.write("booting");
    await Promise.resolve();
    expect(process.current().phase).toBe("starting");
    fake?.children[0]?.write("server ready to serve requests");
    await ready;
    expect(process.current().phase).toBe("running");
  });

  it("fails when readiness never arrives within the startup timeout", async () => {
    const { process } = makeProcess({ readiness: { kind: "log", pattern: "ready" }, startupTimeoutMs: 100 });
    process.start();
    const ready = process.whenReady();
    const assertion = expect(ready).rejects.toThrow(/did not become ready/);
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
    expect(process.current().phase).toBe("failed");
  });

  it("fails on an early unexpected exit with no restarts allowed", () => {
    const { process, fake } = makeProcess();
    process.start();
    fake?.children[0]?.exit(1, null);
    expect(process.current().phase).toBe("failed");
    expect(process.current().message).toMatch(/exited unexpectedly/);
  });

  it("restarts on unexpected exit up to the bound, then fails", async () => {
    const { process, fake } = makeProcess({ restart: { maxRestarts: 2, backoffMs: 100 } });
    process.start();
    fake?.children[0]?.exit(1, null);
    expect(process.current()).toMatchObject({ phase: "starting", restarts: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(fake?.children).toHaveLength(2);
    fake?.children[1]?.exit(1, null);
    await vi.advanceTimersByTimeAsync(200);
    expect(fake?.children).toHaveLength(3);
    fake?.children[2]?.exit(1, null);
    await vi.advanceTimersByTimeAsync(300);
    expect(fake?.children).toHaveLength(3);
    expect(process.current().phase).toBe("failed");
  });

  it("stops gracefully with the configured signal", async () => {
    const { process, fake } = makeProcess();
    process.start();
    const stopping = process.stop();
    expect(fake?.children[0]?.signals).toEqual(["SIGTERM"]);
    fake?.children[0]?.exit(0, "SIGTERM");
    await stopping;
    expect(process.current().phase).toBe("stopped");
  });

  it("hard-kills a process that ignores the graceful signal", async () => {
    const { process, fake } = makeProcess({ shutdown: { signal: "SIGTERM", timeoutMs: 2_000 } });
    process.start();
    const stopping = process.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fake?.children[0]?.signals).toEqual(["SIGTERM", "SIGKILL"]);
    fake?.children[0]?.exit(null, "SIGKILL");
    await stopping;
    expect(process.current().phase).toBe("stopped");
  });

  it("redacts secrets from captured output", async () => {
    const lines: string[] = [];
    const { process, fake } = makeProcess(
      { readiness: { kind: "log", pattern: "ready" }, startupTimeoutMs: 1_000 },
      { secrets: ["e2b-live-key"], onOutput: (line) => lines.push(line) },
    );
    process.start();
    fake?.children[0]?.write("using key e2b-live-key");
    await Promise.resolve();
    expect(lines).toEqual(["using key [redacted]"]);
    expect(process.output()).toEqual(["using key [redacted]"]);
  });

  it("rejects a pending readiness wait when stopped before ready", async () => {
    const { process, fake } = makeProcess({ readiness: { kind: "log", pattern: "ready" } });
    process.start();
    const ready = process.whenReady();
    const assertion = expect(ready).rejects.toThrow(/stopped/);
    const stopping = process.stop();
    fake?.children[0]?.exit(0, "SIGTERM");
    await stopping;
    await assertion;
  });
});
