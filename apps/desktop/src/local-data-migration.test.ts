import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type DatabaseController, type DatabaseControllerState } from "./local-runtime.js";
import {
  type DataMigrationDeps,
  detectLegacyComposeInstall,
  hasNativeCluster,
  MIGRATION_STATE_FILE,
  migrateComposeDataToNative,
  migrationDir,
  skipMigrationPreservingLegacy,
} from "./local-data-migration.js";
import type { RunPostgresResult } from "./local-postgres.js";

const DUMP = `-- PostgreSQL database dump
SELECT 1;
`;

const SOURCE_COUNTS: Record<string, number> = {
  '"user"': 2,
  spaces: 3,
  bots: 5,
  messages: 11,
  computers: 1,
  secrets: 4,
  "graphile_worker.jobs": 7,
};

interface MemFs {
  files: Map<string, string>;
  ops: string[];
}

function memFiles(): MemFs & {
  filesApi: NonNullable<DataMigrationDeps["files"]>;
} {
  const mem: MemFs = { files: new Map(), ops: [] };
  return {
    ...mem,
    filesApi: {
      readText: async (file, maxBytes) => {
        const text = mem.files.get(file) ?? null;
        return text !== null && text.length <= maxBytes ? text : null;
      },
      writeText: async (file, text) => {
        mem.ops.push(`write:${file}`);
        mem.files.set(file, text);
      },
      mkdirRecursive: async (dir) => {
        mem.ops.push(`mkdir:${dir}`);
      },
      removeRecursive: async (target) => {
        mem.ops.push(`remove:${target}`);
        for (const key of [...mem.files.keys()]) {
          if (key === target || key.startsWith(`${target}/`)) mem.files.delete(key);
        }
      },
      rename: async (from, to) => {
        mem.ops.push(`rename:${from}->${to}`);
        for (const key of [...mem.files.keys()]) {
          if (key === from || key.startsWith(`${from}/`)) {
            mem.files.set(key.replace(from, to), mem.files.get(key) ?? "");
            mem.files.delete(key);
          }
        }
      },
    },
  };
}

const ok: RunPostgresResult = { code: 0, stdout: "", stderr: "" };

function scriptedRun(options: {
  startOk?: boolean;
  dumpOk?: boolean;
  targetCounts?: Record<string, number>;
  unfinishedMigrations?: number;
}): { run: DataMigrationDeps["run"]; calls: string[][] } {
  const calls: string[][] = [];
  const run: DataMigrationDeps["run"] = async (binary, args) => {
    calls.push([binary, ...args]);
    const name = path.basename(binary);
    if (name === "docker") {
      if (args.includes("start")) {
        return options.startOk === false
          ? { code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" }
          : ok;
      }
      if (args.includes("pg_dump")) {
        return options.dumpOk === false
          ? { code: 1, stdout: "", stderr: "pg_dump: error" }
          : { code: 0, stdout: DUMP, stderr: "" };
      }
      if (args.includes("psql")) {
        const sql = args[args.indexOf("-tAc") + 1] ?? "";
        const table = Object.keys(SOURCE_COUNTS).find((candidate) => sql.includes(candidate));
        const count = table === undefined ? 0 : (SOURCE_COUNTS[table] ?? 0);
        return { code: 0, stdout: `${count}\n`, stderr: "" };
      }
      return ok;
    }
    if (name === "psql") {
      if (args.includes("-f")) return ok;
      const sql = args[args.indexOf("-tAc") + 1] ?? "";
      if (sql.includes("_prisma_migrations")) {
        return { code: 0, stdout: `${options.unfinishedMigrations ?? 0}\n`, stderr: "" };
      }
      if (sql === "SELECT 1 FROM messages LIMIT 3") return ok;
      const table = Object.keys(SOURCE_COUNTS).find((candidate) => sql.includes(candidate));
      const counts = options.targetCounts ?? SOURCE_COUNTS;
      if (table === undefined) return { code: 1, stdout: "", stderr: "no such table" };
      return { code: 0, stdout: `${counts[table] ?? 0}\n`, stderr: "" };
    }
    return ok;
  };
  return { run, calls };
}

function fakeDatabase(url: string | null = "postgres://rakazo:secret-password@127.0.0.1:55432/rakazo") {
  const state: DatabaseControllerState = { phase: "ready", message: null };
  const database: DatabaseController = {
    start: async () => state,
    stop: async () => ({ phase: "stopped", message: null }),
    state: () => state,
    url: () => url,
    output: () => [],
    subscribe: () => () => undefined,
  };
  return database;
}

function depsFor(overrides: Partial<DataMigrationDeps> & { mem: MemFs }): DataMigrationDeps {
  const docker = overrides.run !== undefined ? null : scriptedRun({});
  return {
    userDataDir: "/user",
    stackDir: "/user/stack",
    platform: "darwin",
    env: { HOME: "/Users/tester", SAPPHIRE_DOCKER_BINARY: "/usr/local/bin/docker" },
    exists: (file) => file === "/usr/local/bin/docker" || overrides.mem.files.has(file),
    run: docker?.run ?? (overrides.run as DataMigrationDeps["run"]),
    binDir: "/runtime/postgres/arm64/bin",
    freeDiskBytes: async () => 8 * 1024 * 1024 * 1024,
    files: overrides.files as DataMigrationDeps["files"],
    createStagingDatabase: () => fakeDatabase(),
    migrate: async () => undefined,
    verifyServices: async () => true,
    seedSecrets: async () => undefined,
    ...overrides,
  } as DataMigrationDeps;
}

function legacyStack(mem: MemFs, env = "POSTGRES_PASSWORD=old-secret-value\n") {
  mem.files.set("/user/stack/docker-compose.images.yml", "services: {}");
  mem.files.set("/user/stack/.env", env);
}

describe("legacy detection", () => {
  it("returns null without a compose file", async () => {
    const mem = memFiles();
    const found = await detectLegacyComposeInstall("/user/stack", mem.filesApi, (file) =>
      mem.files.has(file),
    );
    expect(found).toBeNull();
    expect(hasNativeCluster("/user", (file) => mem.files.has(file))).toBe(false);
  });

  it("detects custom database names from the legacy env", async () => {
    const mem = memFiles();
    legacyStack(mem, "POSTGRES_USER=custom\nPOSTGRES_DB=customdb\n");
    const found = await detectLegacyComposeInstall("/user/stack", mem.filesApi, (file) =>
      mem.files.has(file),
    );
    expect(found).toEqual({
      stackDir: "/user/stack",
      composeFile: "/user/stack/docker-compose.images.yml",
      envFile: "/user/stack/.env",
      dbUser: "custom",
      dbName: "customdb",
    });
  });
});

describe("migrateComposeDataToNative", () => {
  it("does nothing when no legacy stack exists", async () => {
    const mem = memFiles();
    const run = vi.fn(async () => ok);
    const outcome = await migrateComposeDataToNative(
      depsFor({ mem, files: mem.filesApi, run: run as DataMigrationDeps["run"] }),
    );
    expect(outcome).toEqual({ outcome: "not-needed" });
    expect(run).not.toHaveBeenCalled();
  });

  it("does nothing when the native cluster already exists", async () => {
    const mem = memFiles();
    legacyStack(mem);
    mem.files.set("/user/postgres/PG_VERSION", "16\n");
    const run = vi.fn(async () => ok);
    const outcome = await migrateComposeDataToNative(
      depsFor({ mem, files: mem.filesApi, run: run as DataMigrationDeps["run"] }),
    );
    expect(outcome).toEqual({ outcome: "not-needed" });
    expect(run).not.toHaveBeenCalled();
  });

  it("asks for Docker once when the daemon binary is missing", async () => {
    const mem = memFiles();
    legacyStack(mem);
    const outcome = await migrateComposeDataToNative(
      depsFor({
        mem,
        files: mem.filesApi,
        env: { HOME: "/Users/tester", PATH: "/usr/bin" },
        exists: (file) => (file.endsWith("docker") ? false : mem.files.has(file)),
      }),
    );
    expect(outcome.outcome).toBe("needs-docker");
    // Only the retry marker was written; the old profile is intact for later.
    expect(mem.ops).toEqual([
      "mkdir:/user/migration",
      "write:/user/migration/migration-state.json",
    ]);
    expect(mem.files.has("/user/stack/docker-compose.images.yml")).toBe(true);
  });

  it("migrates, verifies, and cuts over atomically on the happy path", async () => {
    const mem = memFiles();
    legacyStack(mem);
    const seeded: Array<string | null> = [];
    const outcome = await migrateComposeDataToNative(
      depsFor({ mem, files: mem.filesApi, seedSecrets: async (text) => void seeded.push(text) }),
    );
    expect(outcome).toEqual({ outcome: "migrated", counts: SOURCE_COUNTS });
    // Legacy stack untouched: no remove or rename under /user/stack.
    expect(mem.ops.filter((op) => op.includes("/user/stack"))).toEqual([]);
    expect(mem.files.has("/user/stack/docker-compose.images.yml")).toBe(true);
    expect(mem.files.has("/user/stack/.env")).toBe(true);
    // Export kept, staging renamed to live, marker done.
    expect(mem.files.get("/user/migration/export.sql")).toContain("PostgreSQL database dump");
    expect(mem.ops).toContain("rename:/user/postgres-staging->/user/postgres");
    const state = JSON.parse(mem.files.get("/user/migration/migration-state.json") ?? "{}") as {
      status: string;
    };
    expect(state.status).toBe("done");
    expect(seeded).toEqual(["POSTGRES_PASSWORD=old-secret-value\n"]);
  });

  it("fails retryably when the export does not match, keeping everything", async () => {
    const mem = memFiles();
    legacyStack(mem);
    const { run } = scriptedRun({ targetCounts: { ...SOURCE_COUNTS, bots: 1 } });
    const outcome = await migrateComposeDataToNative(depsFor({ mem, files: mem.filesApi, run }));
    expect(outcome.outcome).toBe("failed");
    expect((outcome as { retryable: boolean }).retryable).toBe(true);
    expect(mem.files.has("/user/postgres")).toBe(false);
    expect(mem.files.has("/user/stack/docker-compose.images.yml")).toBe(true);
  });

  it("fails retryably on low disk before touching anything", async () => {
    const mem = memFiles();
    legacyStack(mem);
    const run = vi.fn(async () => ok);
    const outcome = await migrateComposeDataToNative(
      depsFor({
        mem,
        files: mem.filesApi,
        run: run as DataMigrationDeps["run"],
        freeDiskBytes: async () => 128,
      }),
    );
    expect(outcome).toEqual({
      outcome: "failed",
      message: expect.stringContaining("disk space"),
      retryable: true,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("fails retryably when unfinished migrations remain after migrate", async () => {
    const mem = memFiles();
    legacyStack(mem);
    const { run } = scriptedRun({ unfinishedMigrations: 2 });
    const outcome = await migrateComposeDataToNative(depsFor({ mem, files: mem.filesApi, run }));
    expect(outcome.outcome).toBe("failed");
    expect(mem.files.has("/user/postgres")).toBe(false);
  });

  it("fails retryably when the service health check fails", async () => {
    const mem = memFiles();
    legacyStack(mem);
    const outcome = await migrateComposeDataToNative(
      depsFor({ mem, files: mem.filesApi, verifyServices: async () => false }),
    );
    expect(outcome.outcome).toBe("failed");
    expect(mem.files.has("/user/postgres")).toBe(false);
    expect(mem.files.has("/user/stack/.env")).toBe(true);
  });

  it("retries idempotently after an interrupted attempt", async () => {
    const mem = memFiles();
    legacyStack(mem);
    const first = depsFor({ mem, files: mem.filesApi });
    mem.files.set("/user/migration/migration-state.json", '{"version":1,"status":"interrupted"}');
    const outcome = await migrateComposeDataToNative(first);
    expect(outcome.outcome).toBe("migrated");
  });
});

describe("skipMigrationPreservingLegacy", () => {
  it("marks an explicit fresh start without deleting the legacy stack", async () => {
    const mem = memFiles();
    legacyStack(mem);
    const result = await skipMigrationPreservingLegacy({
      userDataDir: "/user",
      stackDir: "/user/stack",
      exists: (file) => mem.files.has(file),
      files: mem.filesApi,
    });
    expect(result).toEqual({ skipped: true });
    expect(mem.files.has("/user/stack/docker-compose.images.yml")).toBe(true);
    expect(mem.files.has("/user/stack/.env")).toBe(true);
    const state = JSON.parse(
      mem.files.get(path.join(migrationDir("/user"), MIGRATION_STATE_FILE)) ?? "{}",
    ) as { status: string };
    expect(state.status).toBe("skipped-empty");
  });

  it("refuses to skip once migration already completed", async () => {
    const mem = memFiles();
    legacyStack(mem);
    mem.files.set(
      path.join(migrationDir("/user"), MIGRATION_STATE_FILE),
      '{"version":1,"status":"done"}',
    );
    const result = await skipMigrationPreservingLegacy({
      userDataDir: "/user",
      stackDir: "/user/stack",
      exists: (file) => mem.files.has(file),
      files: mem.filesApi,
    });
    expect(result).toEqual({ skipped: false });
  });
});
