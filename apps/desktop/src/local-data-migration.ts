import path from "node:path";
import { dockerSpawnEnv, resolveDockerBinary, type RunDocker } from "./docker-cli.js";
import {
  type DatabaseController,
  type DatabaseControllerState,
  runtimeChildEnv,
} from "./local-runtime.js";
import { POSTGRES_VERSION_FILE, postgresClusterDir, type RunPostgres } from "./local-postgres.js";
import { STACK_COMPOSE_FILE, STACK_ENV_FILE, STACK_PROJECT_NAME } from "./local-stack.js";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

/**
 * One-time migration from the legacy Docker Compose PostgreSQL volume to the
 * app-managed native cluster. Docker is needed at most once, to read the old
 * database out of its container. The legacy stack directory, its volumes, and
 * its credentials are never modified or deleted here; only new files under the
 * migration directory, the staging cluster, and (after verification) the live
 * cluster and secrets file are written.
 */

export const MIGRATION_DIR_NAME = "migration";
export const MIGRATION_EXPORT_FILE = "export.sql";
export const MIGRATION_STATE_FILE = "migration-state.json";
export const MIGRATION_STAGING_DIR_NAME = "postgres-staging";
export const MIGRATION_STATE_VERSION = 1;

/** Refuse to start when less than this is free; a dump plus a second cluster needs room. */
export const MIGRATION_MIN_FREE_BYTES = 1 * 1024 * 1024 * 1024;

const COMPOSE_START_TIMEOUT_MS = 120_000;
const EXPORT_TIMEOUT_MS = 30 * 60_000;
const RESTORE_TIMEOUT_MS = 30 * 60_000;
const QUERY_TIMEOUT_MS = 60_000;
/** The official postgres image trusts local-socket connections, so no password travels on argv. */
const CONTAINER_SOCKET_DIR = "/var/run/postgresql";

/** Tables whose row counts must match exactly between the old and new database. */
export const MIGRATION_COUNT_TABLES = [
  '"user"',
  "spaces",
  "bots",
  "messages",
  "computers",
  "secrets",
  "graphile_worker.jobs",
] as const;

export interface LegacyComposeInstall {
  stackDir: string;
  composeFile: string;
  envFile: string;
  dbUser: string;
  dbName: string;
}

export type MigrationStatus = "in-progress" | "done" | "skipped-empty";

export interface MigrationStateRecord {
  version: typeof MIGRATION_STATE_VERSION;
  status: MigrationStatus;
  phase: string | null;
  at: string;
  sourceCounts?: Record<string, number>;
}

export type MigrationOutcome =
  | { outcome: "not-needed" }
  | { outcome: "skipped" }
  | { outcome: "migrated"; counts: Record<string, number> }
  | { outcome: "needs-docker"; message: string }
  | { outcome: "failed"; message: string; retryable: boolean };

export interface MigrationFiles {
  readText(file: string, maxBytes: number): Promise<string | null>;
  writeText(file: string, text: string): Promise<void>;
  mkdirRecursive(dir: string): Promise<void>;
  removeRecursive(target: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export interface DataMigrationDeps {
  userDataDir: string;
  stackDir: string;
  platform: string;
  env: NodeJS.ProcessEnv;
  exists: (file: string) => boolean;
  /** Bounded, fixed-argv runner for pg tools, psql, and the docker CLI. */
  run: RunPostgres;
  /** Staged native PostgreSQL `bin` directory (pg_dump, psql). */
  binDir: string;
  freeDiskBytes: () => Promise<number>;
  files?: MigrationFiles;
  minFreeBytes?: number;
  /** Staging cluster in a scratch directory; migrations are a deliberate noop. */
  createStagingDatabase: () => DatabaseController;
  /** Applies the current Prisma migrations to the staged database. */
  migrate: (context: { databaseUrl: string; signal?: AbortSignal }) => Promise<void>;
  /** Boots API/worker against the staged database and probes health. */
  verifyServices: (databaseUrl: string, signal?: AbortSignal) => Promise<boolean>;
  /**
   * Persists the native service secrets, seeding them from the legacy `.env`
   * text when available so sessions and encrypted credentials survive. The
   * legacy file itself is never modified.
   */
  seedSecrets: (legacyEnvText: string | null) => Promise<void>;
  onPhase?: (phase: string, message: string | null) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const NEEDS_DOCKER_MESSAGE =
  "Your previous data lives in Docker and Docker is not available. Start Docker and press Retry to copy it, or start fresh below. Nothing was changed.";
const DAEMON_DOWN_MESSAGE =
  "Docker is installed but is not running. Start Docker and press Retry to copy your previous data, or start fresh below. Nothing was changed.";
const LOW_DISK_MESSAGE =
  "There is not enough free disk space to copy your previous data safely. Free at least 1 GB and press Retry. Nothing was changed.";

function defaultFiles(): MigrationFiles {
  return {
    readText: (file, maxBytes) => readPrivateFile(file, maxBytes),
    writeText: (file, text) => writePrivateFile(file, text),
    mkdirRecursive: async (dir) => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true, mode: 0o700 });
    },
    removeRecursive: async (target) => {
      const { rm } = await import("node:fs/promises");
      await rm(target, { recursive: true, force: true });
    },
    rename: async (from, to) => {
      const { rename } = await import("node:fs/promises");
      await rename(from, to);
    },
  };
}

/** Present when a previous attempt (or version) already created the native cluster. */
export function hasNativeCluster(userDataDir: string, exists: (file: string) => boolean): boolean {
  return exists(path.join(postgresClusterDir(userDataDir), POSTGRES_VERSION_FILE));
}

export function migrationDir(userDataDir: string): string {
  return path.join(userDataDir, MIGRATION_DIR_NAME);
}

export function stagingDir(userDataDir: string): string {
  return path.join(userDataDir, MIGRATION_STAGING_DIR_NAME);
}

async function readMigrationState(
  files: MigrationFiles,
  userDataDir: string,
): Promise<MigrationStateRecord | null> {
  const raw = await files.readText(
    path.join(migrationDir(userDataDir), MIGRATION_STATE_FILE),
    65536,
  );
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MigrationStateRecord>;
    if (parsed.version !== MIGRATION_STATE_VERSION) return null;
    if (parsed.status !== "in-progress" && parsed.status !== "done" && parsed.status !== "skipped-empty") {
      return null;
    }
    return {
      version: MIGRATION_STATE_VERSION,
      status: parsed.status,
      phase: typeof parsed.phase === "string" ? parsed.phase : null,
      at: typeof parsed.at === "string" ? parsed.at : new Date(0).toISOString(),
      ...(parsed.sourceCounts !== undefined ? { sourceCounts: parsed.sourceCounts } : {}),
    };
  } catch {
    return null;
  }
}

async function writeMigrationState(
  files: MigrationFiles,
  userDataDir: string,
  record: Omit<MigrationStateRecord, "version" | "at"> & { sourceCounts?: Record<string, number> },
): Promise<void> {
  await files.mkdirRecursive(migrationDir(userDataDir));
  await files.writeText(
    path.join(migrationDir(userDataDir), MIGRATION_STATE_FILE),
    `${JSON.stringify({ version: MIGRATION_STATE_VERSION, ...record, at: new Date().toISOString() })}\n`,
  );
}

/**
 * Detects a legacy Compose installation by its compose file. The `.env` file is
 * optional: when present it supplies custom database names and seeds the native
 * secrets so sessions and encrypted credentials survive; when absent the
 * long-standing defaults apply and secrets are generated fresh.
 */
export async function detectLegacyComposeInstall(
  stackDir: string,
  files: MigrationFiles,
  exists: (file: string) => boolean,
): Promise<LegacyComposeInstall | null> {
  const composeFile = path.join(stackDir, STACK_COMPOSE_FILE);
  if (!exists(composeFile)) return null;
  const envFile = path.join(stackDir, STACK_ENV_FILE);
  let dbUser = "rakazo";
  let dbName = "rakazo";
  const envText = await files.readText(envFile, 65536);
  if (envText !== null) {
    for (const rawLine of envText.split("\n")) {
      const line = rawLine.trim();
      if (line === "" || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const name = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (name === "POSTGRES_USER" && value !== "") dbUser = value;
      if (name === "POSTGRES_DB" && value !== "") dbName = value;
    }
  }
  return { stackDir, composeFile, envFile, dbUser, dbName };
}

function composeBaseArgs(): string[] {
  return [
    "compose",
    "--env-file",
    STACK_ENV_FILE,
    "-f",
    STACK_COMPOSE_FILE,
    "--project-name",
    STACK_PROJECT_NAME,
  ];
}

function dockerEnv(deps: DataMigrationDeps, binary: string): Record<string, string> {
  return dockerSpawnEnv(deps.platform, deps.env, binary, {});
}

function interrupted(signal: AbortSignal | undefined, code: number): boolean {
  return signal?.aborted === true || code === 130;
}

async function ensureLegacyPostgresRunning(
  deps: DataMigrationDeps,
  binary: string,
  signal?: AbortSignal,
): Promise<{ running: boolean; daemonDown: boolean }> {
  const started = await deps.run(binary, [...composeBaseArgs(), "start", "postgres"], {
    cwd: deps.stackDir,
    env: dockerEnv(deps, binary),
    timeoutMs: COMPOSE_START_TIMEOUT_MS,
    ...(signal === undefined ? {} : { signal }),
  });
  if (started.code === 0) return { running: true, daemonDown: false };
  if (interrupted(signal, started.code)) return { running: false, daemonDown: false };
  const text = `${started.stdout}\n${started.stderr}`.toLowerCase();
  const daemonDown =
    text.includes("cannot connect to the docker daemon") ||
    text.includes("docker daemon is not running") ||
    text.includes("no such host") ||
    text.includes("connection refused");
  return { running: false, daemonDown };
}

function looksLikeDump(text: string): boolean {
  return text.includes("PostgreSQL database dump");
}

async function exportLegacyDatabase(
  deps: DataMigrationDeps,
  files: MigrationFiles,
  install: LegacyComposeInstall,
  binary: string,
  signal?: AbortSignal,
): Promise<{ ok: true; rows: string } | { ok: false; daemonDown: boolean; message: string }> {
  const dumped = await deps.run(
    binary,
    [
      ...composeBaseArgs(),
      "exec",
      "-T",
      "postgres",
      "pg_dump",
      "-U",
      install.dbUser,
      "-d",
      install.dbName,
      "-h",
      CONTAINER_SOCKET_DIR,
      "-F",
      "p",
      "--no-owner",
      "--no-acl",
    ],
    {
      cwd: deps.stackDir,
      env: dockerEnv(deps, binary),
      timeoutMs: EXPORT_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    },
  );
  if (interrupted(signal, dumped.code)) {
    return { ok: false, daemonDown: false, message: "The export was interrupted. Retry to continue." };
  }
  if (dumped.code !== 0) {
    const text = `${dumped.stdout}\n${dumped.stderr}`.toLowerCase();
    const daemonDown =
      text.includes("cannot connect to the docker daemon") ||
      text.includes("no such service") ||
      text.includes("no container found");
    return {
      ok: false,
      daemonDown,
      message: daemonDown
        ? DAEMON_DOWN_MESSAGE
        : "Could not read the previous database from Docker. Check that the old local stack still exists, then retry.",
    };
  }
  if (!looksLikeDump(dumped.stdout)) {
    return {
      ok: false,
      daemonDown: false,
      message: "Docker answered but the export was empty. Retry, or start fresh below.",
    };
  }
  await files.mkdirRecursive(migrationDir(deps.userDataDir));
  await files.writeText(path.join(migrationDir(deps.userDataDir), MIGRATION_EXPORT_FILE), dumped.stdout);
  return { ok: true, rows: dumped.stdout };
}

/** Splits a `postgres://user:password@host:port/database` URL into psql parts. */
function splitDatabaseUrl(databaseUrl: string): {
  host: string;
  port: number;
  user: string;
  database: string;
  password: string;
} | null {
  try {
    const parsed = new URL(databaseUrl);
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port <= 0) return null;
    const database = parsed.pathname.replace(/^\//, "");
    if (parsed.hostname === "" || parsed.username === "" || database === "") return null;
    return {
      host: parsed.hostname,
      port,
      user: decodeURIComponent(parsed.username),
      database,
      password: decodeURIComponent(parsed.password),
    };
  } catch {
    return null;
  }
}

function pgEnv(deps: DataMigrationDeps, password: string): Record<string, string> {
  return runtimeChildEnv(deps.platform, deps.env, { PGPASSWORD: password });
}

async function psqlScalar(
  deps: DataMigrationDeps,
  connection: { host: string; port: number; user: string; database: string; password: string },
  sql: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const result = await deps.run(
    path.join(deps.binDir, "psql"),
    [
      "-h",
      connection.host,
      "-p",
      String(connection.port),
      "-U",
      connection.user,
      "-d",
      connection.database,
      "-tAc",
      sql,
    ],
    {
      cwd: deps.userDataDir,
      env: pgEnv(deps, connection.password),
      timeoutMs: QUERY_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    },
  );
  if (result.code !== 0) return null;
  const value = Number(result.stdout.trim());
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function containerPsqlScalar(
  deps: DataMigrationDeps,
  binary: string,
  install: LegacyComposeInstall,
  sql: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const result = await deps.run(
    binary,
    [
      ...composeBaseArgs(),
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      install.dbUser,
      "-d",
      install.dbName,
      "-h",
      CONTAINER_SOCKET_DIR,
      "-tAc",
      sql,
    ],
    {
      cwd: deps.stackDir,
      env: dockerEnv(deps, binary),
      timeoutMs: QUERY_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    },
  );
  if (result.code !== 0) return null;
  const value = Number(result.stdout.trim());
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function restoreExport(
  deps: DataMigrationDeps,
  password: { host: string; port: number; user: string; database: string; password: string },
  exportFile: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const result = await deps.run(
    path.join(deps.binDir, "psql"),
    [
      "-h",
      password.host,
      "-p",
      String(password.port),
      "-U",
      password.user,
      "-d",
      password.database,
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      exportFile,
    ],
    {
      cwd: deps.userDataDir,
      env: pgEnv(deps, password.password),
      timeoutMs: RESTORE_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    },
  );
  return result.code === 0 && !interrupted(signal, result.code);
}

interface VerifyResult {
  ok: boolean;
  counts?: Record<string, number>;
  message?: string;
}

async function verifyRestoredDatabase(
  deps: DataMigrationDeps,
  binary: string,
  install: LegacyComposeInstall,
  staging: { host: string; port: number; user: string; database: string; password: string },
  signal?: AbortSignal,
): Promise<VerifyResult> {
  // The migration history must exist and be fully applied: no unfinished or
  // rolled-back entries. The latest name is recorded, never enforced, because
  // `migrate` already applied anything pending before this check runs.
  const unfinished = await psqlScalar(
    deps,
    staging,
    'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL',
    signal,
  );
  if (unfinished === null) {
    return {
      ok: false,
      message: "The copied database is missing its migration history. Retry the copy.",
    };
  }
  if (unfinished > 0) {
    return {
      ok: false,
      message: "The copied database has unfinished migrations. Retry the copy.",
    };
  }
  const counts: Record<string, number> = {};
  for (const table of MIGRATION_COUNT_TABLES) {
    const source = await containerPsqlScalar(deps, binary, install, `SELECT count(*) FROM ${table}`, signal);
    // A table missing from the old database predates this app version; skip it
    // rather than failing a healthy older profile.
    if (source === null) continue;
    const target = await psqlScalar(deps, staging, `SELECT count(*) FROM ${table}`, signal);
    if (target === null) {
      return {
        ok: false,
        message: `The copied database is missing expected data (${table}). Retry the copy.`,
      };
    }
    if (target !== source) {
      return {
        ok: false,
        message: `The copy does not match the original (${table}: ${target} of ${source} rows). Retry the copy.`,
      };
    }
    counts[table] = target;
  }
  // One bounded sample read proving rows come back through a normal query path.
  const sampled = await deps.run(
    path.join(deps.binDir, "psql"),
    [
      "-h", staging.host, "-p", String(staging.port), "-U", staging.user, "-d", staging.database,
      "-tAc", "SELECT 1 FROM messages LIMIT 3",
    ],
    {
      cwd: deps.userDataDir,
      env: pgEnv(deps, staging.password),
      timeoutMs: QUERY_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    },
  );
  if (sampled.code !== 0) {
    return { ok: false, message: "The copied database did not answer a sample read. Retry the copy." };
  }
  return { ok: true, counts };
}

function failedState(state: DatabaseControllerState): string {
  return state.message ?? "The local database did not become ready.";
}

/**
 * Runs the full export → stage → verify → cutover sequence. Safe to retry:
 * every step before the final rename only touches the migration directory and
 * the staging cluster; the legacy stack and any live cluster are never written.
 */
export async function migrateComposeDataToNative(
  deps: DataMigrationDeps,
  signal?: AbortSignal,
): Promise<MigrationOutcome> {
  const files = deps.files ?? defaultFiles();
  const report = (phase: string, message: string | null) => deps.onPhase?.(phase, message);

  if (hasNativeCluster(deps.userDataDir, deps.exists)) return { outcome: "not-needed" };
  const previous = await readMigrationState(files, deps.userDataDir);
  if (previous?.status === "done") return { outcome: "not-needed" };
  if (previous?.status === "skipped-empty") return { outcome: "skipped" };

  const install = await detectLegacyComposeInstall(deps.stackDir, files, deps.exists);
  if (install === null) return { outcome: "not-needed" };

  await writeMigrationState(files, deps.userDataDir, { status: "in-progress", phase: "exporting" });

  const freeBytes = await deps.freeDiskBytes().catch(() => Number.POSITIVE_INFINITY);
  if (freeBytes < (deps.minFreeBytes ?? MIGRATION_MIN_FREE_BYTES)) {
    report("exporting", LOW_DISK_MESSAGE);
    return { outcome: "failed", message: LOW_DISK_MESSAGE, retryable: true };
  }

  const binary = resolveDockerBinary(deps.platform, deps.env, deps.exists);
  if (binary === null) {
    report("exporting", NEEDS_DOCKER_MESSAGE);
    return { outcome: "needs-docker", message: NEEDS_DOCKER_MESSAGE };
  }

  report("exporting", "Copying your previous data. This may take a few minutes.");
  const ensured = await ensureLegacyPostgresRunning(deps, binary, signal);
  if (!ensured.running) {
    if (signal?.aborted === true) {
      return { outcome: "failed", message: "The copy was interrupted. Retry to continue.", retryable: true };
    }
    const message = ensured.daemonDown ? DAEMON_DOWN_MESSAGE : NEEDS_DOCKER_MESSAGE;
    report("exporting", message);
    return ensured.daemonDown
      ? { outcome: "needs-docker", message }
      : { outcome: "failed", message, retryable: true };
  }

  const exported = await exportLegacyDatabase(deps, files, install, binary, signal);
  if (!exported.ok) {
    report("exporting", exported.message);
    return exported.daemonDown
      ? { outcome: "needs-docker", message: exported.message }
      : { outcome: "failed", message: exported.message, retryable: true };
  }

  report("restoring", "Preparing your data for the new database.");
  const staging = stagingDir(deps.userDataDir);
  await files.removeRecursive(staging).catch(() => undefined);
  const database = deps.createStagingDatabase();
  const started = await database.start(signal);
  if (started.phase !== "ready") {
    await database.stop().catch(() => undefined);
    const message = `Could not prepare the new database. ${failedState(started)} Your previous data is untouched.`;
    report("restoring", message);
    return { outcome: "failed", message, retryable: true };
  }
  const stagingUrl = database.url();
  const parsed = stagingUrl === null ? null : splitDatabaseUrl(stagingUrl);
  if (stagingUrl === null || parsed === null) {
    await database.stop().catch(() => undefined);
    const message = "Could not prepare the new database. Your previous data is untouched. Retry.";
    report("restoring", message);
    return { outcome: "failed", message, retryable: true };
  }
  const stagingConn = {
    host: "127.0.0.1",
    port: parsed.port,
    user: parsed.user,
    database: parsed.database,
    password: parsed.password,
  };

  const restored = await restoreExport(
    deps,
    stagingConn,
    path.join(migrationDir(deps.userDataDir), MIGRATION_EXPORT_FILE),
    signal,
  );
  if (!restored) {
    await database.stop().catch(() => undefined);
    const message = signal?.aborted === true
      ? "The copy was interrupted. Retry to continue."
      : "Could not restore your data into the new database. Your previous data is untouched. Retry.";
    report("restoring", message);
    return { outcome: "failed", message, retryable: true };
  }

  try {
    await deps.migrate({ databaseUrl: stagingUrl, ...(signal === undefined ? {} : { signal }) });
  } catch {
    await database.stop().catch(() => undefined);
    const message =
      "Your data was copied but could not be updated to this app version. Your previous data is untouched. Retry after updating, or start fresh below.";
    report("restoring", message);
    return { outcome: "failed", message, retryable: true };
  }

  report("verifying", "Checking the copied data before switching over.");
  const verified = await verifyRestoredDatabase(deps, binary, install, stagingConn, signal);
  if (!verified.ok) {
    await database.stop().catch(() => undefined);
    const message = `${verified.message ?? "Verification failed."} Your previous data is untouched.`;
    report("verifying", message);
    return { outcome: "failed", message, retryable: true };
  }

  report("verifying", "Starting your app services to confirm the copy works.");
  let healthy = false;
  try {
    healthy = await deps.verifyServices(stagingUrl, signal);
  } catch {
    healthy = false;
  }
  if (!healthy) {
    await database.stop().catch(() => undefined);
    const message =
      "Your data was copied and checked, but the app services did not pass their health check. Your previous data is untouched. Retry.";
    report("verifying", message);
    return { outcome: "failed", message, retryable: true };
  }

  // Cutover: stop staging, seed secrets from the legacy env so sessions and
  // encrypted credentials survive, then atomically rename staging to live.
  await database.stop().catch(() => undefined);
  const envText = await files.readText(install.envFile, 65536);
  await deps.seedSecrets(envText);
  const live = postgresClusterDir(deps.userDataDir);
  if (deps.exists(live)) {
    // A live cluster appeared while migrating (e.g. a concurrent fresh boot):
    // keep it and leave the verified staging copy for inspection instead of
    // overwriting either one.
    const message =
      "A local database already exists, so the verified copy was kept aside. Quit and reopen the app to use it, or contact support.";
    report("verifying", message);
    return { outcome: "failed", message, retryable: false };
  }
  try {
    await files.rename(staging, live);
  } catch {
    const message = "Could not switch to the new database. Your previous data is untouched. Retry.";
    report("verifying", message);
    return { outcome: "failed", message, retryable: true };
  }
  await writeMigrationState(files, deps.userDataDir, {
    status: "done",
    phase: null,
    sourceCounts: verified.counts ?? {},
  });
  return { outcome: "migrated", counts: verified.counts ?? {} };
}

/**
 * Records an explicit choice to start an empty profile while keeping the
 * legacy Compose stack, its volumes, and any export for a later import.
 * Never deletes anything.
 */
export async function skipMigrationPreservingLegacy(
  deps: Pick<DataMigrationDeps, "userDataDir" | "stackDir" | "exists" | "files">,
): Promise<{ skipped: boolean }> {
  const files = deps.files ?? defaultFiles();
  const previous = await readMigrationState(files, deps.userDataDir);
  if (previous?.status === "done") return { skipped: false };
  if (hasNativeCluster(deps.userDataDir, deps.exists)) return { skipped: false };
  const install = await detectLegacyComposeInstall(deps.stackDir, files, deps.exists);
  if (install === null) return { skipped: false };
  await writeMigrationState(files, deps.userDataDir, { status: "skipped-empty", phase: null });
  return { skipped: true };
}
