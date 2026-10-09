import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allocatePostgresPort,
  databaseUrl,
  desktopPostgresSettings,
  isPortInUse,
  isPostgresCredentials,
  LocalPostgresController,
  type LocalPostgresDeps,
  type PostgresState,
  postgresBinary,
  postgresClusterDir,
  postgresLogDir,
  postgresRuntimeDir,
  type RunPostgres,
  type RunPostgresResult,
  readPostgresCredentials,
  writePostgresCredentials,
} from "./local-postgres.js";

const fakeHex = (bytes: number) => "ab".repeat(bytes);
const ok: RunPostgresResult = { code: 0, stdout: "", stderr: "" };
const fail = (stderr: string): RunPostgresResult => ({ code: 1, stdout: "", stderr });

interface RunCall {
  binary: string;
  args: string[];
  env: Record<string, string>;
}

/** Records every invocation and answers with a scripted result per binary. */
type Scripted =
  | RunPostgresResult
  | ((call: RunCall) => RunPostgresResult | Promise<RunPostgresResult>);

/** Records every invocation, answers with a scripted result, and emits output lines. */
function scriptedRun(plan: Partial<Record<string, Scripted>>): {
  run: RunPostgres;
  calls: RunCall[];
} {
  const calls: RunCall[] = [];
  const run: RunPostgres = async (binary, args, options) => {
    const call: RunCall = { binary, args, env: options.env };
    calls.push(call);
    const entry = plan[path.basename(binary)];
    const result =
      entry === undefined ? ok : await (typeof entry === "function" ? entry(call) : entry);
    for (const line of `${result.stdout}\n${result.stderr}`.split("\n")) {
      if (line.trim() !== "") options.onLine?.(line.trimEnd());
    }
    return result;
  };
  return { run, calls };
}

function depsFor(dataDir: string, run: RunPostgres, overrides: Partial<LocalPostgresDeps> = {}) {
  return {
    platform: "darwin",
    arch: "arm64",
    env: { HOME: "/Users/tester", PATH: "/usr/bin", OPENROUTER_API_KEY: "secret-key" },
    run,
    dataDir,
    binDir: "/App/runtime/postgres/arm64/bin",
    randomHex: fakeHex,
    sleep: async () => {},
    allocatePort: async () => 55432,
    startupTimeoutMs: 0,
    pollIntervalMs: 1,
    ...overrides,
  } satisfies LocalPostgresDeps;
}

describe("postgres locations", () => {
  it("keeps the cluster and logs under user data", () => {
    expect(postgresClusterDir("/data/sapphire")).toBe(path.join("/data/sapphire", "postgres"));
    expect(postgresLogDir("/data/sapphire")).toBe(path.join("/data/sapphire", "logs"));
  });

  it("reads the pinned distribution from resources when packaged", () => {
    expect(
      postgresRuntimeDir({
        packaged: true,
        resourcesPath: "/App/Contents/Resources",
        appPath: "/x",
        arch: "x64",
      }),
    ).toBe(path.join("/App/Contents/Resources", "runtime", "postgres", "x64", "bin"));
    expect(
      postgresRuntimeDir({
        packaged: false,
        resourcesPath: "/x",
        appPath: "/repo/apps/desktop",
        arch: "arm64",
      }),
    ).toBe(path.resolve("/repo/runtime/postgres/arm64/bin"));
  });

  it("rejects an architecture the release does not ship", () => {
    expect(() =>
      postgresRuntimeDir({ packaged: true, resourcesPath: "/x", appPath: "/x", arch: "ppc64" }),
    ).toThrow(/Unsupported macOS architecture/);
  });

  it("names binaries per platform", () => {
    expect(postgresBinary("/bin", "pg_ctl")).toBe(path.join("/bin", "pg_ctl"));
    expect(postgresBinary("/bin", "pg_isready", "win32")).toBe(path.join("/bin", "pg_isready.exe"));
  });
});

describe("desktopPostgresSettings", () => {
  it("binds loopback with bounded desktop limits", () => {
    const settings = desktopPostgresSettings(55432);
    expect(settings).toContain("listen_addresses=127.0.0.1");
    expect(settings).toContain("port=55432");
    expect(settings).toContain("max_connections=20");
    expect(settings).toContain("shared_buffers=128MB");
    expect(settings.every((setting) => !setting.includes("0.0.0.0"))).toBe(true);
  });
});

describe("postgres credentials", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sapphire-pg-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips owner-only credentials", async () => {
    const credentials = {
      version: 1 as const,
      port: 55432,
      user: "rakazo",
      database: "rakazo",
      password: fakeHex(16),
    };
    await writePostgresCredentials(dir, credentials);
    await expect(readPostgresCredentials(dir)).resolves.toEqual(credentials);
    const file = path.join(dir, ".desktop-postgres.json");
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(databaseUrl(credentials)).toBe(
      `postgres://rakazo:${fakeHex(16)}@127.0.0.1:55432/rakazo`,
    );
  });

  it("rejects malformed credentials", async () => {
    await writeFile(path.join(dir, ".desktop-postgres.json"), "{not json", "utf8");
    await expect(readPostgresCredentials(dir)).resolves.toBeNull();
    expect(isPostgresCredentials({ version: 1, port: 80 })).toBe(false);
    expect(
      isPostgresCredentials({
        version: 2,
        port: 55432,
        user: "u",
        database: "d",
        password: fakeHex(16),
      }),
    ).toBe(false);
  });

  it("allocates a free loopback port", async () => {
    const port = await allocatePostgresPort();
    expect(port).toBeGreaterThan(1023);
    expect(port).toBeLessThan(65536);
  });

  it("detects the port-in-use wording", () => {
    expect(isPortInUse("could not bind IPv4 address: Address already in use")).toBe(true);
    expect(isPortInUse("Is another postmaster already running?")).toBe(true);
    expect(isPortInUse("all good")).toBe(false);
  });
});

describe("LocalPostgresController", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sapphire-pg-life-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function warmCluster(version = "16") {
    await writeFile(path.join(dir, "PG_VERSION"), `${version}\n`, "utf8");
    await writePostgresCredentials(dir, {
      version: 1,
      port: 55432,
      user: "rakazo",
      database: "rakazo",
      password: fakeHex(16),
    });
  }

  it("initializes a cold cluster, creates the database, migrates, and becomes ready", async () => {
    const phases: PostgresState[] = [];
    // pg_ctl status reports "not running" (code 3) so boot takes the normal
    // spawn path; the adopt path has its own tests below.
    const notRunning = { code: 3, stdout: "stopped", stderr: "" };
    const { run, calls } = scriptedRun({
      pg_ctl: (call) => (call.args.at(-1) === "status" ? notRunning : ok),
      pg_isready: ok,
    });
    const migrated: string[] = [];
    const controller = new LocalPostgresController(
      depsFor(dir, run, {
        onState: (state) => phases.push(state),
        migrate: async ({ databaseUrl: url }) => {
          migrated.push(url);
        },
      }),
    );

    const state = await controller.start();

    expect(state.phase).toBe("ready");
    expect(calls.map((call) => path.basename(call.binary))).toEqual([
      "initdb",
      "pg_ctl",
      "pg_ctl",
      "psql",
      "psql",
      "pg_isready",
    ]);
    // initdb gets the generated password through a private password file that is removed.
    const initdb = calls[0]!;
    expect(initdb.args).toContain("--pwfile");
    expect(initdb.args.join(" ")).toContain(`-U rakazo`);
    expect(initdb.args.join(" ")).toContain("-A scram-sha-256");
    // The server binds loopback on the persisted port.
    const start = calls.find((call) => call.args.at(-1) === "start")!;
    expect(start.args.join(" ")).toContain("listen_addresses=127.0.0.1");
    expect(start.args.join(" ")).toContain("port=55432");
    // psql creates the database with only the password in the environment.
    expect(calls[3]!.env.PGPASSWORD).toBe(fakeHex(16));
    expect(calls[3]!.env.OPENROUTER_API_KEY).toBeUndefined();
    // psql must address the server over TCP loopback: the default /tmp unix
    // socket is not where this server listens, so bare psql never connects.
    for (const query of calls.slice(3, 5)) {
      expect(query.args).toEqual(
        expect.arrayContaining(["-h", "127.0.0.1", "-p", "55432", "-U", "rakazo"]),
      );
    }
    expect(migrated).toEqual([`postgres://rakazo:${fakeHex(16)}@127.0.0.1:55432/rakazo`]);
    expect(phases.map((entry) => entry.phase)).toEqual(["starting-database", "migrating", "ready"]);
    await expect(readPrivateJson(dir)).resolves.toMatchObject({ port: 55432 });
  });

  it("starts a warm cluster without initdb or database creation", async () => {
    await warmCluster();
    const { run, calls } = scriptedRun({
      pg_ctl: (call) =>
        call.args.at(-1) === "status" ? { code: 3, stdout: "stopped", stderr: "" } : ok,
      pg_isready: ok,
      psql: fail("should not run"),
    });
    const controller = new LocalPostgresController(depsFor(dir, run));

    const state = await controller.start();

    expect(state.phase).toBe("ready");
    expect(calls.map((call) => path.basename(call.binary))).toEqual([
      "pg_ctl",
      "pg_ctl",
      "pg_isready",
    ]);
  });

  it("refuses a cluster from another PostgreSQL major version", async () => {
    await warmCluster("15");
    const { run, calls } = scriptedRun({ pg_isready: ok });
    const controller = new LocalPostgresController(depsFor(dir, run));

    const state = await controller.start();

    expect(state.phase).toBe("failed");
    expect(state.message).toMatch(/PostgreSQL 16/);
    expect(calls).toEqual([]);
  });

  it("refuses a warm cluster whose credentials are missing", async () => {
    await writeFile(path.join(dir, "PG_VERSION"), "16\n", "utf8");
    const { run, calls } = scriptedRun({ pg_isready: ok });
    const controller = new LocalPostgresController(depsFor(dir, run));

    const state = await controller.start();

    expect(state.phase).toBe("failed");
    expect(state.message).toMatch(/credentials/i);
    expect(calls).toEqual([]);
  });

  it("retries the start on a new port when the persisted port is taken", async () => {
    await warmCluster();
    let started = 0;
    const { run, calls } = scriptedRun({
      pg_ctl: (call) => {
        const last = call.args.at(-1);
        if (last === "status") return { code: 3, stdout: "stopped", stderr: "" };
        if (last !== "start") return ok;
        started += 1;
        return started === 1 ? fail("could not bind IPv4 address: Address already in use") : ok;
      },
      pg_isready: ok,
    });
    const controller = new LocalPostgresController(
      depsFor(dir, run, { allocatePort: async () => 55999 }),
    );

    const state = await controller.start();

    expect(state.phase).toBe("ready");
    const starts = calls.filter((call) => call.args.at(-1) === "start");
    expect(starts).toHaveLength(2);
    expect(starts[1]!.args.join(" ")).toContain("port=55999");
    await expect(readPrivateJson(dir)).resolves.toMatchObject({ port: 55999 });
  });

  it("fails cleanly when the server cannot start", async () => {
    await warmCluster();
    const { run } = scriptedRun({ pg_ctl: fail("could not create shared memory") });
    const controller = new LocalPostgresController(depsFor(dir, run));

    const state = await controller.start();

    expect(state.phase).toBe("failed");
    expect(state.message).toMatch(/did not start/);
  });

  it("fails when the server never accepts connections", async () => {
    await warmCluster();
    const { run, calls } = scriptedRun({ pg_ctl: ok, pg_isready: fail("no response") });
    const controller = new LocalPostgresController(depsFor(dir, run));

    const state = await controller.start();

    expect(state.phase).toBe("failed");
    expect(state.message).toMatch(/did not accept connections/);
    // One probe during adoption plus one poll inside the readiness wait.
    expect(calls.filter((call) => path.basename(call.binary) === "pg_isready")).toHaveLength(2);
  });

  it("keeps the data and reports a repairable error when migration fails", async () => {
    await warmCluster();
    const { run } = scriptedRun({ pg_ctl: ok, pg_isready: ok });
    const controller = new LocalPostgresController(
      depsFor(dir, run, {
        migrate: async () => {
          throw new Error("migration 0042 failed");
        },
      }),
    );

    const state = await controller.start();

    expect(state.phase).toBe("failed");
    expect(state.message).toMatch(/could not be updated/);
    await expect(readFile(path.join(dir, "PG_VERSION"), "utf8")).resolves.toBe("16\n");
  });

  it("stops the server cleanly and reports a failed stop", async () => {
    await warmCluster();
    const { run, calls } = scriptedRun({ pg_ctl: ok, pg_isready: ok });
    const controller = new LocalPostgresController(depsFor(dir, run));
    await controller.start();

    await expect(controller.stop()).resolves.toEqual({ phase: "stopped", message: null });
    const stopArgs = calls.at(-1)!.args.join(" ");
    expect(stopArgs).toContain("-m fast");
    expect(stopArgs.endsWith(" stop")).toBe(true);

    const { run: failing } = scriptedRun({
      pg_ctl: (call) => (call.args.at(-1) === "stop" ? fail("server did not shut down") : ok),
      pg_isready: ok,
    });
    const second = new LocalPostgresController(depsFor(dir, failing));
    await second.start();
    await expect(second.stop()).resolves.toMatchObject({ phase: "failed" });
  });

  it("stops without a running server and rotates the log before start", async () => {
    const rotated: { file: string; maxBytes: number }[] = [];
    const { run } = scriptedRun({ pg_ctl: ok, pg_isready: ok });
    const controller = new LocalPostgresController(
      depsFor(dir, run, {
        rotateLog: async (file, maxBytes) => {
          rotated.push({ file, maxBytes });
        },
      }),
    );

    await expect(controller.stop()).resolves.toEqual({ phase: "stopped", message: null });
    await controller.start();
    expect(rotated).toHaveLength(1);
    expect(rotated[0]!.file).toBe(path.join(dir, "postgres.log"));
  });

  it("redacts the database password from captured output", async () => {
    await warmCluster();
    const { run } = scriptedRun({
      pg_ctl: { code: 0, stdout: `password ${fakeHex(16)} accepted`, stderr: "" },
      pg_isready: ok,
    });
    const controller = new LocalPostgresController(depsFor(dir, run));

    await controller.start();

    expect(controller.output().join("\n")).toContain("[redacted]");
    expect(controller.output().join("\n")).not.toContain(fakeHex(16));
  });

  it("joins an in-flight start instead of booting twice", async () => {
    await warmCluster();
    let release: (() => void) | null = null;
    let reachedSpawn: () => void = () => undefined;
    const atSpawn = new Promise<void>((resolve) => {
      reachedSpawn = resolve;
    });
    const { run, calls } = scriptedRun({
      pg_ctl: (call) =>
        call.args.at(-1) === "status"
          ? { code: 3, stdout: "stopped", stderr: "" }
          : new Promise<RunPostgresResult>((resolve) => {
              release = () => resolve(ok);
              reachedSpawn();
            }),
      pg_isready: ok,
    });
    const controller = new LocalPostgresController(depsFor(dir, run));

    const first = controller.start();
    const second = controller.start();
    await atSpawn;
    release?.();
    const [a, b] = await Promise.all([first, second]);

    expect(a.phase).toBe("ready");
    expect(b.phase).toBe("ready");
    expect(calls.filter((call) => call.args.at(-1) === "start")).toHaveLength(1);
  });
});

describe("cold init keeps the cluster directory initdb-clean", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sapphire-pg-init-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * The real initdb refuses a non-empty directory ("exists but is not
   * empty ... dot-prefixed/invisible file"). The fake enforces the same
   * invariant against the real temp dir so the ordering bug that broke
   * every first launch cannot regress silently.
   */
  function initdbLikeReal(plan: Partial<Record<string, Scripted>> = {}) {
    return scriptedRun({
      initdb: async (call) => {
        const dataDir = call.args[call.args.indexOf("-D") + 1]!;
        const entries = await readdir(dataDir);
        if (entries.length > 0) {
          return fail(`directory "${dataDir}" exists but is not empty`);
        }
        // initdb must not observe our credentials file: it is persisted
        // only after init succeeds.
        if ((await readPostgresCredentials(dataDir)) !== null) {
          return fail("credentials file visible to initdb");
        }
        return ok;
      },
      pg_isready: ok,
      ...plan,
    });
  }

  it("initializes an empty directory and persists credentials after", async () => {
    const { run, calls } = initdbLikeReal();
    const controller = new LocalPostgresController(depsFor(dir, run));

    const state = await controller.start();

    expect(state.phase).toBe("ready");
    expect(calls.map((call) => path.basename(call.binary))[0]).toBe("initdb");
    await expect(readPostgresCredentials(dir)).resolves.toMatchObject({ port: 55432 });
    // The password file never lands in the cluster dir (it would break a
    // retry the same way the credentials file did).
    expect(await readdir(dir)).not.toContain(`.pwfile-${process.pid}`);
    const initdb = calls[0]!;
    const pwfile = initdb.args[initdb.args.indexOf("--pwfile") + 1]!;
    expect(path.dirname(pwfile)).not.toBe(dir);
  });

  it("repairs a directory poisoned by failed first launches", async () => {
    // Exactly what a broken retry loop leaves behind: our credentials file
    // plus an orphaned password file from a dead process.
    await writePostgresCredentials(dir, {
      version: 1,
      port: 55432,
      user: "rakazo",
      database: "rakazo",
      password: fakeHex(16),
    });
    await writeFile(path.join(dir, ".pwfile-99999"), "stale\n", "utf8");
    const { run } = initdbLikeReal();
    const controller = new LocalPostgresController(depsFor(dir, run));

    const state = await controller.start();

    expect(state.phase).toBe("ready");
    expect(await readdir(dir)).not.toContain(".pwfile-99999");
  });

  it("fails closed on foreign files instead of deleting them", async () => {
    await writeFile(path.join(dir, "user-data.txt"), "not ours\n", "utf8");
    const { run } = initdbLikeReal();
    const controller = new LocalPostgresController(depsFor(dir, run));

    const state = await controller.start();

    expect(state.phase).toBe("failed");
    // Our cleanup touches only our dotfiles; foreign content is preserved
    // for the user to move, and initdb reports it.
    await expect(readFile(path.join(dir, "user-data.txt"), "utf8")).resolves.toBe("not ours\n");
  });

  it("recovers on retry after initdb itself fails once", async () => {
    let attempts = 0;
    const { run } = initdbLikeReal({
      initdb: async () => {
        attempts += 1;
        return attempts === 1 ? fail("disk hiccup") : ok;
      },
      pg_isready: ok,
    });
    const first = new LocalPostgresController(depsFor(dir, run));
    expect((await first.start()).phase).toBe("failed");

    const second = new LocalPostgresController(depsFor(dir, run));
    expect((await second.start()).phase).toBe("ready");
    expect(attempts).toBe(2);
  });
});

describe("adopting a live server orphaned by a dead app", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sapphire-pg-adopt-"));
    await writeFile(path.join(dir, "PG_VERSION"), "16\n", "utf8");
    await writePostgresCredentials(dir, {
      version: 1,
      port: 55432,
      user: "rakazo",
      database: "rakazo",
      password: fakeHex(16),
    });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("adopts a server that answers our credentials instead of failing on its lock", async () => {
    const { run, calls } = scriptedRun({
      pg_ctl: (call) => {
        const last = call.args.at(-1);
        if (last === "status") return ok;
        if (last === "stop") return ok;
        return fail("pg_ctl start must not run when a live server is adopted");
      },
      pg_isready: ok,
    });
    const controller = new LocalPostgresController(depsFor(dir, run));

    const state = await controller.start();

    expect(state.phase).toBe("ready");
    expect(calls.some((call) => call.args.at(-1) === "start")).toBe(false);
    // An adopted server is still ours to stop on quit.
    await expect(controller.stop()).resolves.toEqual({ phase: "stopped", message: null });
  });

  it("does not adopt a live server that rejects our login", async () => {
    let probes = 0;
    const { run, calls } = scriptedRun({
      pg_ctl: (call) => {
        const last = call.args.at(-1);
        if (last === "status") return ok;
        if (last === "start") return ok;
        if (last === "stop") return ok;
        return ok;
      },
      pg_isready: () => {
        probes += 1;
        // First probe (adoption check) rejects; the readiness wait passes.
        return probes === 1 ? fail("password authentication failed") : ok;
      },
    });
    const controller = new LocalPostgresController(depsFor(dir, run));

    const state = await controller.start();

    expect(state.phase).toBe("ready");
    expect(calls.some((call) => call.args.at(-1) === "start")).toBe(true);
  });

  it("starts normally when no server holds the directory", async () => {
    const { run, calls } = scriptedRun({
      pg_ctl: (call) => (call.args.at(-1) === "status" ? fail("no server running") : ok),
      pg_isready: ok,
      psql: fail("should not run"),
    });
    const controller = new LocalPostgresController(depsFor(dir, run));

    const state = await controller.start();

    expect(state.phase).toBe("ready");
    expect(calls.some((call) => call.args.at(-1) === "start")).toBe(true);
  });
});

async function readPrivateJson(dir: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dir, ".desktop-postgres.json"), "utf8"));
}
