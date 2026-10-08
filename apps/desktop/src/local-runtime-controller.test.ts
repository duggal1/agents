import { describe, expect, it } from "vitest";
import {
  type DatabaseController,
  type DatabaseControllerState,
  type LocalProcessOptions,
  type LocalProcessState,
  LocalRuntimeController,
  type LocalRuntimeDeps,
  type LocalRuntimePhase,
  type LocalServiceId,
  type LocalServiceManifest,
  SERVICE_READINESS,
} from "./local-runtime.js";

type Scripted = { ready?: "auto" | "manual"; fail?: string };

class FakeProcess {
  readonly options: LocalProcessOptions;
  started = false;
  stopped = false;
  outputLines: string[] = [];
  private state: LocalProcessState;
  private settle: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;

  constructor(options: LocalProcessOptions) {
    this.options = options;
    this.state = {
      id: options.manifest.id,
      phase: "stopped",
      pid: null,
      restarts: 0,
      message: null,
    };
    this.settle = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
    return Promise.resolve();
  }
  whenReady() {
    return this.settle;
  }
  current() {
    return this.state;
  }
  output() {
    return this.outputLines;
  }

  becomeReady() {
    this.state = { ...this.state, phase: "running", pid: 4321 };
    this.options.onState?.(this.state);
    this.resolveReady();
  }
  fail(message: string) {
    this.state = { ...this.state, phase: "failed", message };
    this.options.onState?.(this.state);
    this.rejectReady(new Error(message));
  }
  exitUnexpectedly() {
    this.state = { ...this.state, phase: "starting", restarts: this.state.restarts + 1 };
    this.options.onState?.(this.state);
  }
  reportFailed(message: string) {
    this.state = { ...this.state, phase: "failed", message };
    this.options.onState?.(this.state);
  }
}

function processFactory(
  config: Partial<Record<LocalServiceId, Scripted>> = {},
  onCreate?: (process: FakeProcess) => void,
) {
  const created: FakeProcess[] = [];
  const createProcess = (options: LocalProcessOptions): FakeProcess => {
    const process = new FakeProcess(options);
    created.push(process);
    onCreate?.(process);
    const spec = config[options.manifest.id] ?? { ready: "auto" };
    if (spec.ready !== "manual") {
      queueMicrotask(() => (spec.fail ? process.fail(spec.fail) : process.becomeReady()));
    }
    return process;
  };
  return { createProcess, created };
}

function fakeDatabase(
  options: { result?: "ready" | "failed"; url?: string | null; message?: string } = {},
) {
  const listeners: ((state: DatabaseControllerState) => void)[] = [];
  const output: string[] = [];
  let state: DatabaseControllerState = { phase: "stopped", message: null };
  const emit = (next: DatabaseControllerState) => {
    state = next;
    for (const listener of listeners) listener(next);
  };
  const controller: DatabaseController = {
    start: async () => {
      emit({ phase: "starting-database", message: null });
      emit({ phase: "migrating", message: null });
      if (options.result === "failed") {
        emit({ phase: "failed", message: options.message ?? "database failed" });
        return state;
      }
      emit({ phase: "ready", message: null });
      return state;
    },
    stop: async () => {
      emit({ phase: "stopped", message: null });
      return state;
    },
    state: () => state,
    url: () => (options.url === undefined ? "postgres://u:p@127.0.0.1:5432/rakazo" : options.url),
    output: () => [...output],
    subscribe: (listener) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
  };
  return { controller, pushOutput: (line: string) => output.push(line) };
}

function manifest(id: LocalServiceId, entry: string): LocalServiceManifest {
  return {
    id,
    entry,
    args: [],
    env: {},
    readiness: SERVICE_READINESS[id],
    startupTimeoutMs: 10_000,
    restart: { maxRestarts: 3, backoffMs: 500 },
    shutdown: { signal: "SIGTERM", timeoutMs: 5_000 },
  };
}

function buildDeps(overrides: Partial<LocalRuntimeDeps> = {}) {
  const phases: LocalRuntimePhase[] = [];
  const deps: LocalRuntimeDeps = {
    database: fakeDatabase().controller,
    runtimeRoot: "/App/Contents/Resources/runtime",
    execPath: "/usr/bin/node",
    platform: "darwin",
    manifests: {
      api: manifest("api", "api/index.js"),
      worker: manifest("worker", "worker/index.js"),
    },
    serviceEnv: { api: { API_PORT: "45173", RAKAZO_LOCAL_MODE: "1" }, worker: {} },
    inheritedEnv: { HOME: "/Users/tester", PATH: "/usr/bin" },
    onState: (state) => phases.push(state.phase),
    ...overrides,
  };
  return { deps, phases };
}

describe("LocalRuntimeController", () => {
  it("boots the database, API, then worker and injects the database URL", async () => {
    const database = fakeDatabase();
    const processes = processFactory();
    const { deps, phases } = buildDeps({
      database: database.controller,
      createProcess: processes.createProcess,
    });
    const runtime = new LocalRuntimeController(deps);

    const state = await runtime.start();

    expect(state.phase).toBe("ready");
    expect(processes.created.map((process) => process.options.manifest.id)).toEqual([
      "api",
      "worker",
    ]);
    expect(runtime.databaseUrl()).toBe("postgres://u:p@127.0.0.1:5432/rakazo");
    expect(processes.created[0]!.options.env.DATABASE_URL).toBe(runtime.databaseUrl());
    expect(processes.created[0]!.options.env.REALTIME_DATABASE_URL).toBe(runtime.databaseUrl());
    expect(processes.created[0]!.options.env.RAKAZO_LOCAL_MODE).toBe("1");
    expect(phases).toEqual([
      "starting-database",
      "migrating",
      "starting-api",
      "starting-worker",
      "ready",
    ]);
  });

  it("fails without starting a service when the database never becomes ready", async () => {
    const database = fakeDatabase({ result: "failed", message: "disk full" });
    const processes = processFactory();
    const { deps } = buildDeps({
      database: database.controller,
      createProcess: processes.createProcess,
    });
    const runtime = new LocalRuntimeController(deps);

    const state = await runtime.start();

    expect(state.phase).toBe("failed");
    expect(state.message).toBe("disk full");
    expect(processes.created).toEqual([]);
  });

  it("fails when the database URL is unavailable", async () => {
    const database = fakeDatabase({ url: null });
    const processes = processFactory();
    const { deps } = buildDeps({
      database: database.controller,
      createProcess: processes.createProcess,
    });
    const runtime = new LocalRuntimeController(deps);

    expect((await runtime.start()).phase).toBe("failed");
    expect(processes.created).toEqual([]);
  });

  it("stops the API and never starts the worker when the API cannot become ready", async () => {
    const processes = processFactory({ api: { fail: "api exited" } });
    const { deps } = buildDeps({ createProcess: processes.createProcess });
    const runtime = new LocalRuntimeController(deps);

    const state = await runtime.start();

    expect(state.phase).toBe("failed");
    expect(state.message).toBe("api exited");
    expect(processes.created.map((process) => process.options.manifest.id)).toEqual(["api"]);
    expect(processes.created[0]!.stopped).toBe(true);
  });

  it("stops the worker when it cannot become ready", async () => {
    const processes = processFactory({ worker: { fail: "worker exited" } });
    const { deps } = buildDeps({ createProcess: processes.createProcess });
    const runtime = new LocalRuntimeController(deps);

    const state = await runtime.start();

    expect(state.phase).toBe("failed");
    expect(processes.created.map((process) => process.options.manifest.id)).toEqual([
      "api",
      "worker",
    ]);
    expect(processes.created[1]!.stopped).toBe(true);
  });

  it("degrades on an unexpected exit and returns to ready on recovery", async () => {
    const processes = processFactory();
    const { deps } = buildDeps({ createProcess: processes.createProcess });
    const runtime = new LocalRuntimeController(deps);
    await runtime.start();

    processes.created[0]!.exitUnexpectedly();
    expect(runtime.state().phase).toBe("degraded");
    expect(runtime.state().message).toMatch(/api stopped unexpectedly/);

    processes.created[0]!.becomeReady();
    expect(runtime.state()).toMatchObject({ phase: "ready", message: null });
  });

  it("fails when a running service reports a failed state", async () => {
    const processes = processFactory();
    const { deps } = buildDeps({ createProcess: processes.createProcess });
    const runtime = new LocalRuntimeController(deps);
    await runtime.start();

    processes.created[1]!.reportFailed("worker lost the database");

    expect(runtime.state()).toMatchObject({ phase: "failed", message: "worker lost the database" });
  });

  it("stops worker, then API, then the database", async () => {
    const order: string[] = [];
    const database = fakeDatabase();
    const { controller } = database;
    const processes = processFactory({}, (process) => {
      const originalStop = process.stop.bind(process);
      process.stop = () => {
        order.push(process.options.manifest.id);
        return originalStop();
      };
    });
    const { deps } = buildDeps({
      database: {
        ...controller,
        stop: async () => {
          order.push("database");
          return controller.stop();
        },
      },
      createProcess: processes.createProcess,
    });
    const runtime = new LocalRuntimeController(deps);
    await runtime.start();

    await runtime.stop();

    expect(order).toEqual(["worker", "api", "database"]);
    expect(runtime.state().phase).toBe("stopped");
  });

  it("prefixes database output and forwards raw lines", async () => {
    const received: string[] = [];
    const { deps } = buildDeps({ onOutput: (line) => received.push(line) });
    const runtime = new LocalRuntimeController(deps);

    runtime.recordDatabaseOutput("database system is ready to accept connections");

    expect(runtime.output()).toEqual(["[database] database system is ready to accept connections"]);
    expect(received).toEqual(["database system is ready to accept connections"]);
    expect(runtime.state().output).toEqual(runtime.output());
  });

  it("restarts the whole stack after a stop", async () => {
    const database = fakeDatabase();
    let starts = 0;
    const processes = processFactory();
    const { deps } = buildDeps({
      database: {
        ...database.controller,
        start: async () => {
          starts += 1;
          return database.controller.start();
        },
      },
      createProcess: processes.createProcess,
    });
    const runtime = new LocalRuntimeController(deps);

    await runtime.start();
    await runtime.restart();

    expect(starts).toBe(2);
    expect(processes.created).toHaveLength(4);
    expect(runtime.state().phase).toBe("ready");
  });

  it("joins an in-flight start instead of booting twice", async () => {
    let atApi: (() => void) | null = null;
    const apiReady = new Promise<void>((resolve) => {
      atApi = resolve;
    });
    const processes = processFactory(
      { api: { ready: "manual" }, worker: { ready: "auto" } },
      (process) => {
        if (process.options.manifest.id === "api") atApi?.();
      },
    );
    const { deps } = buildDeps({ createProcess: processes.createProcess });
    const runtime = new LocalRuntimeController(deps);

    const first = runtime.start();
    const second = runtime.start();
    await apiReady;
    processes.created[0]!.becomeReady();
    const [a, b] = await Promise.all([first, second]);

    expect(a.phase).toBe("ready");
    expect(b.phase).toBe("ready");
    expect(processes.created.map((process) => process.options.manifest.id)).toEqual([
      "api",
      "worker",
    ]);
  });
});
