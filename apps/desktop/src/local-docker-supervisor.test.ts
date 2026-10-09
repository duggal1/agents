import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  COMPUTER_CONTEXT_DIR,
  COMPUTER_CONTEXT_FILES,
  DAEMON_UNREACHABLE_MESSAGE,
  DOCKER_SUPERVISOR_ENTRY,
  DOCKER_SUPERVISOR_HOST,
  DOCKER_UNAVAILABLE_MESSAGE,
  dockerSupervisorEnv,
  dockerSupervisorHealthUrl,
  LocalDockerSupervisor,
  type LocalDockerSupervisorDeps,
  type RunDockerLike,
  MANAGED_CONTAINER_LABEL,
  resolveDockerSocket,
  SUPERVISOR_START_FAILED_MESSAGE,
} from "./local-docker-supervisor.js";
import type { ManagedChild, SpawnManagedChild } from "./local-runtime.js";

class FakeChild extends EventEmitter {
  pid = 4321;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed: string[] = [];
  kill(signal?: NodeJS.Signals): boolean {
    this.killed.push(signal ?? "SIGTERM");
    setImmediate(() => this.emit("exit", null, signal ?? "SIGTERM"));
    return true;
  }
}

interface SpawnCall {
  command: string;
  args: string[];
  env: Record<string, string>;
}

function fakeDocker(responses: Record<string, { code: number; stdout?: string }>) {
  const calls: { args: string[] }[] = [];
  const run = vi.fn(async (_binary: string, args: string[]) => {
    calls.push({ args });
    const response = responses[args[0] ?? ""] ?? { code: 0, stdout: "" };
    return { code: response.code, stdout: response.stdout ?? "", stderr: "" };
  });
  return { calls, run };
}

function deps(
  overrides: Partial<LocalDockerSupervisorDeps> = {},
  dockerResponses: Record<string, { code: number; stdout?: string }> = {
    info: { code: 0, stdout: "28.0.0" },
  },
) {
  const spawns: SpawnCall[] = [];
  const child = new FakeChild();
  const docker = fakeDocker(dockerResponses);
  const spawn: SpawnManagedChild = (command, args, options) => {
    spawns.push({
      command,
      args,
      env: (options.env ?? {}) as Record<string, string>,
    });
    return child as unknown as ManagedChild;
  };
  const full: LocalDockerSupervisorDeps = {
    platform: "darwin",
    env: { HOME: "/Users/example", PATH: "/usr/bin" },
    enabled: true,
    runtimeRoot: "/tmp/runtime",
    execPath: "/tmp/node",
    dataDir: "/tmp/rakazo-data",
    dockerBinary: "/usr/local/bin/docker",
    runDocker: docker.run as unknown as RunDockerLike,
    spawn,
    checkHealth: async () => true,
    randomHex: () => "ab".repeat(32),
    allocatePort: async () => 7091,
    exists: () => false,
    startupTimeoutMs: 2_000,
    healthIntervalMs: 10,
    stopTimeoutMs: 500,
    ...overrides,
  };
  return { deps: full, spawns, child, docker };
}

describe("docker socket resolution", () => {
  it("prefers explicit overrides and the Docker toolchain", () => {
    expect(
      resolveDockerSocket({ platform: "darwin", env: { DOCKER_SOCKET: "/tmp/custom.sock" }, exists: () => false }),
    ).toBe("/tmp/custom.sock");
    expect(
      resolveDockerSocket({ platform: "linux", env: { DOCKER_HOST: "tcp://1.2.3.4:2375" }, exists: () => false }),
    ).toBeUndefined();
  });

  it("selects the per-user socket on macOS and the default elsewhere", () => {
    const userSocket = path.join("/Users/example", ".docker", "run", "docker.sock");
    expect(
      resolveDockerSocket({
        platform: "darwin",
        env: { HOME: "/Users/example" },
        exists: (file) => file === userSocket,
      }),
    ).toBe(userSocket);
    expect(
      resolveDockerSocket({ platform: "darwin", env: { HOME: "/Users/example" }, exists: () => false }),
    ).toBe("/var/run/docker.sock");
    expect(resolveDockerSocket({ platform: "linux", env: {}, exists: () => false })).toBe(
      "/var/run/docker.sock",
    );
    expect(resolveDockerSocket({ platform: "win32", env: {}, exists: () => false })).toBe(
      "//./pipe/docker_engine",
    );
  });
});

describe("supervisor environment", () => {
  it("binds loopback with the private token, socket, image path, and data dir", () => {
    const env = dockerSupervisorEnv({
      port: 7091,
      token: "test-token",
      socket: "/var/run/docker.sock",
      dockerHost: undefined,
      computerContextDir: "/tmp/runtime/computer",
      dataDir: "/tmp/rakazo-data",
      platform: "darwin",
    });
    expect(env).toMatchObject({
      SUPERVISOR_HOST: "127.0.0.1",
      SUPERVISOR_PORT: "7091",
      SANDBOX_SUPERVISOR_TOKEN: "test-token",
      DOCKER_SOCKET: "/var/run/docker.sock",
      SAPPHIRE_COMPUTER_CONTEXT: "/tmp/runtime/computer",
      DATA_DIR: "/tmp/rakazo-data",
      SANDBOX_CONTROL_VIA_LOOPBACK: "true",
    });
    expect(dockerSupervisorHealthUrl(7091)).toBe("http://127.0.0.1:7091/health");
    expect(DOCKER_SUPERVISOR_HOST).toBe("127.0.0.1");
  });

  it("omits the loopback control flag on Linux and passes DOCKER_HOST through", () => {
    const env = dockerSupervisorEnv({
      port: 7091,
      token: "test-token",
      socket: undefined,
      dockerHost: "tcp://1.2.3.4:2375",
      computerContextDir: "/tmp/runtime/computer",
      dataDir: "/tmp/rakazo-data",
      platform: "linux",
    });
    expect(env).not.toHaveProperty("SANDBOX_CONTROL_VIA_LOOPBACK");
    expect(env).not.toHaveProperty("DOCKER_SOCKET");
    expect(env.DOCKER_HOST).toBe("tcp://1.2.3.4:2375");
  });

  it("covers every file the supervisor image build needs", () => {
    expect(COMPUTER_CONTEXT_FILES).toContain("Dockerfile");
    expect(COMPUTER_CONTEXT_FILES).toContain("control.py");
    expect(COMPUTER_CONTEXT_FILES).toContain("start.sh");
    expect(COMPUTER_CONTEXT_DIR).toBe("computer");
    expect(DOCKER_SUPERVISOR_ENTRY).toBe("services/supervisor/index.js");
    expect(SUPERVISOR_START_FAILED_MESSAGE).toContain("E2B computers are unaffected");
  });

  it("stages the supervisor bundle and computer context in the runtime build", () => {
    const desktopDir = path.resolve(import.meta.dirname, "..");
    const buildScript = readFileSync(path.join(desktopDir, "scripts", "build-runtime.mjs"), "utf8");
    expect(buildScript).toContain("infra/sandboxes/supervisor/src/index.ts");
    expect(buildScript).toContain('id: "supervisor"');
    expect(buildScript).toContain("stageComputerContext");
    for (const file of COMPUTER_CONTEXT_FILES) {
      expect(buildScript).toContain(`"${file}"`);
    }
    // The service manifest keeps only api/worker; the fallback supervisor is
    // launched explicitly by Electron, never by the service supervisor.
    const servicesBlock = buildScript.match(/const SERVICES = \[[\s\S]*?\];/);
    expect(servicesBlock?.[0]).not.toContain("supervisor");
  });
});

describe("local docker supervisor", () => {
  it("never starts when fallback is disabled", async () => {
    const { deps: d, spawns, docker, child } = deps({ enabled: false });
    void child;
    const supervisor = new LocalDockerSupervisor(d);
    await expect(supervisor.start()).resolves.toMatchObject({ phase: "stopped" });
    expect(spawns).toHaveLength(0);
    expect(docker.run).not.toHaveBeenCalled();
    expect(supervisor.connection()).toBeNull();
  });

  it("fails without touching Docker when the daemon is missing", async () => {
    const { deps: d, spawns } = deps({ dockerBinary: null });
    const supervisor = new LocalDockerSupervisor(d);
    await expect(supervisor.start()).resolves.toMatchObject({
      phase: "failed",
      message: DOCKER_UNAVAILABLE_MESSAGE,
    });
    expect(spawns).toHaveLength(0);
  });

  it("fails without starting the supervisor when the daemon is down", async () => {
    const { deps: d, spawns, docker } = deps({}, { info: { code: 1 } });
    const supervisor = new LocalDockerSupervisor(d);
    await expect(supervisor.start()).resolves.toMatchObject({
      phase: "failed",
      message: DAEMON_UNREACHABLE_MESSAGE,
    });
    expect(spawns).toHaveLength(0);
    expect(docker.calls.map((c) => c.args[0])).toEqual(["info"]);
  });

  it("starts loopback-only with a generated token and the staged image path", async () => {
    const { deps: d, spawns, docker, child } = deps();
    void child;
    const supervisor = new LocalDockerSupervisor(d);
    const state = await supervisor.start();
    expect(state.phase).toBe("ready");
    expect(state.url).toBe("http://127.0.0.1:7091");
    expect(spawns).toHaveLength(1);
    const [call] = spawns;
    expect(call?.command).toBe("/tmp/node");
    expect(call?.args).toEqual(["/tmp/runtime/services/supervisor/index.js"]);
    expect(call?.env.SUPERVISOR_HOST).toBe("127.0.0.1");
    expect(call?.env.SUPERVISOR_PORT).toBe("7091");
    expect(call?.env.SANDBOX_SUPERVISOR_TOKEN).toBe("ab".repeat(32));
    expect(call?.env.SAPPHIRE_COMPUTER_CONTEXT).toBe("/tmp/runtime/computer");
    expect(call?.env.SANDBOX_CONTROL_VIA_LOOPBACK).toBe("true");
    // The daemon check ran, but no image build was triggered (lazy on first use).
    expect(docker.calls.map((c) => c.args[0])).toEqual(["info"]);
    const connection = supervisor.connection();
    expect(connection?.url).toBe("http://127.0.0.1:7091");
    expect(connection?.token).toBe("ab".repeat(32));
  });

  it("reuses a persisted supervisor token instead of generating one", async () => {
    const { deps: d, spawns } = deps({ supervisorToken: "persisted-supervisor-token" });
    const supervisor = new LocalDockerSupervisor(d);
    await supervisor.start();
    expect(spawns[0]?.env.SANDBOX_SUPERVISOR_TOKEN).toBe("persisted-supervisor-token");
    expect(supervisor.connection()?.token).toBe("persisted-supervisor-token");
  });

  it("redacts the token from bounded logs", async () => {
    const seen: string[] = [];
    const { deps: d, child } = deps({ onOutput: (line) => seen.push(line) });
    const supervisor = new LocalDockerSupervisor(d);
    await supervisor.start();
    child.stderr.emit("data", `listening with token ${"ab".repeat(32)}\n`);
    expect(supervisor.output().join("\n")).toContain("[redacted]");
    expect(supervisor.output().join("\n")).not.toContain("ab".repeat(32));
    expect(seen.join("\n")).not.toContain("ab".repeat(32));
  });

  it("reports a crash without affecting the backend", async () => {
    const { deps: d, child } = deps();
    const supervisor = new LocalDockerSupervisor(d);
    await expect(supervisor.start()).resolves.toMatchObject({ phase: "ready" });
    child.emit("exit", 1, null);
    expect(supervisor.state().phase).toBe("failed");
    expect(supervisor.connection()).toBeNull();
    // A later start can recover; the failure never throws into the backend.
    child.removeAllListeners("exit");
    await expect(supervisor.start()).resolves.toMatchObject({ phase: "ready" });
  });

  it("stops containers without deleting them, then stops the supervisor", async () => {
    const { deps: d, spawns, docker, child } = deps(
      {},
      {
        info: { code: 0, stdout: "28.0.0" },
        ps: { code: 0, stdout: "abc123\ndef456\n" },
        stop: { code: 0 },
      },
    );
    void spawns;
    const supervisor = new LocalDockerSupervisor(d);
    await supervisor.start();
    await supervisor.stop();
    const argv = docker.calls.map((c) => c.args);
    expect(argv[0]?.[0]).toBe("info");
    expect(argv).toContainEqual(["ps", "-q", "--filter", `label=${MANAGED_CONTAINER_LABEL}`]);
    const stopCall = argv.find((args) => args[0] === "stop");
    expect(stopCall).toEqual(["stop", "-t", "30", "abc123", "def456"]);
    // No data deletion: no rm, remove, prune, or volume command anywhere.
    const verbs = argv.map((args) => args[0]);
    expect(verbs).not.toContain("rm");
    expect(verbs).not.toContain("remove");
    expect(verbs).not.toContain("prune");
    expect(verbs).not.toContain("volume");
    expect(child.killed).toContain("SIGTERM");
    expect(supervisor.state().phase).toBe("stopped");
    expect(supervisor.connection()).toBeNull();
  });

  it("stops cleanly with no containers running", async () => {
    const { deps: d } = deps();
    const supervisor = new LocalDockerSupervisor(d);
    await supervisor.stop();
    expect(supervisor.state().phase).toBe("stopped");
  });
});
