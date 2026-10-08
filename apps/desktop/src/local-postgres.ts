import { spawn } from "node:child_process";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { DESKTOP_MACOS_ARCHITECTURES, RUNTIME_DIR_NAME, runtimeChildEnv } from "./local-runtime.js";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

/**
 * The self-hosted stack pins PostgreSQL 16. The native cluster must be the same
 * major so an exported dump from the old Compose volume restores unchanged.
 */
export const POSTGRES_MAJOR_VERSION = 16;
export const POSTGRES_DATA_DIR_NAME = "postgres";
export const POSTGRES_LOG_DIR_NAME = "logs";
export const POSTGRES_LOG_FILE = "postgres.log";
export const POSTGRES_CREDENTIALS_FILE = ".desktop-postgres.json";
/** Rotate the log once it exceeds this size so it cannot grow without bound. */
export const POSTGRES_LOG_MAX_BYTES = 4 * 1024 * 1024;
export const POSTGRES_LOG_LINES = 200;
export const POSTGRES_CREDENTIALS_VERSION = 1;
export const POSTGRES_DEFAULT_USER = "rakazo";
export const POSTGRES_DEFAULT_DATABASE = "rakazo";
export const POSTGRES_START_TIMEOUT_MS = 60_000;
export const POSTGRES_STOP_TIMEOUT_MS = 30_000;
export const POSTGRES_POLL_INTERVAL_MS = 250;

/** The cluster lives under the app's user data; the distribution lives in resources. */
export function postgresClusterDir(userDataDir: string): string {
  return path.join(userDataDir, POSTGRES_DATA_DIR_NAME);
}

export function postgresLogDir(userDataDir: string): string {
  return path.join(userDataDir, POSTGRES_LOG_DIR_NAME);
}

const PACKAGED_ARCHES = new Set<string>(DESKTOP_MACOS_ARCHITECTURES);

/**
 * Installed builds ship the pinned PostgreSQL 16 distribution per architecture under
 * `Resources/runtime/postgres/<arch>/bin`; development builds read the fetched copy
 * next to the repository root. Mirrors `runtimeResourceDir`.
 */
export function postgresRuntimeDir(input: {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
  arch: string;
}): string {
  if (!PACKAGED_ARCHES.has(input.arch)) {
    throw new Error(`Unsupported macOS architecture: ${input.arch}`);
  }
  const base = input.packaged
    ? path.join(input.resourcesPath, RUNTIME_DIR_NAME)
    : path.resolve(input.appPath, "..", "..", "runtime");
  return path.join(base, "postgres", input.arch, "bin");
}

export type PostgresBinary = "initdb" | "pg_ctl" | "pg_isready" | "psql";

export function postgresBinary(binDir: string, name: PostgresBinary, platform = "darwin"): string {
  return path.join(binDir, platform === "win32" ? `${name}.exe` : name);
}

/**
 * A desktop profile: one local user, loopback only. Bounded memory, few connections,
 * modest WAL. Advanced tuning stays out of reach of user-edited files because the
 * settings are passed as fixed `-c` options instead of an editable `postgresql.conf`.
 */
export function desktopPostgresSettings(port: number): string[] {
  return [
    "listen_addresses=127.0.0.1",
    `port=${port}`,
    "max_connections=20",
    "shared_buffers=128MB",
    "work_mem=4MB",
    "maintenance_work_mem=64MB",
    "effective_cache_size=512MB",
    "min_wal_size=64MB",
    "max_wal_size=256MB",
    "max_worker_processes=4",
    "max_parallel_workers=2",
    "max_parallel_workers_per_gather=1",
    "password_encryption=scram-sha-256",
    "logging_collector=off",
  ];
}

export interface PostgresCredentials {
  version: typeof POSTGRES_CREDENTIALS_VERSION;
  port: number;
  user: string;
  database: string;
  password: string;
}

export function databaseUrl(credentials: PostgresCredentials): string {
  return `postgres://${credentials.user}:${credentials.password}@127.0.0.1:${credentials.port}/${credentials.database}`;
}

export function isPostgresCredentials(value: unknown): value is PostgresCredentials {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === POSTGRES_CREDENTIALS_VERSION &&
    typeof record.port === "number" &&
    Number.isInteger(record.port) &&
    record.port >= 1024 &&
    record.port <= 65535 &&
    typeof record.user === "string" &&
    record.user !== "" &&
    typeof record.database === "string" &&
    record.database !== "" &&
    typeof record.password === "string" &&
    record.password.length >= 16
  );
}

/** Reads the private credentials; returns null when absent, unreadable, or malformed. */
export async function readPostgresCredentials(dir: string): Promise<PostgresCredentials | null> {
  const raw = await readPrivateFile(path.join(dir, POSTGRES_CREDENTIALS_FILE), 4096);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPostgresCredentials(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Persists credentials owner-only; the renderer never reads this file. */
export async function writePostgresCredentials(
  dir: string,
  credentials: PostgresCredentials,
): Promise<void> {
  await writePrivateFile(
    path.join(dir, POSTGRES_CREDENTIALS_FILE),
    `${JSON.stringify(credentials)}\n`,
  );
}

/** Allocates a free loopback port; a racing bind is handled by the start retry. */
export async function allocatePostgresPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (address && typeof address !== "string") resolve(address.port);
        else reject(new Error("No loopback port allocated."));
      });
    });
  });
}

export interface RunPostgresOptions {
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
}

export interface RunPostgresResult {
  /** Exit status; 124 after the timeout, 130 after an abort. */
  code: number;
  stdout: string;
  stderr: string;
}

export type RunPostgres = (
  binary: string,
  args: string[],
  options: RunPostgresOptions,
) => Promise<RunPostgresResult>;

/** Fixed argv, bounded lifetime, process-group termination — mirrors `runDocker`. */
export function runPostgres(
  binary: string,
  args: string[],
  options: RunPostgresOptions,
): Promise<RunPostgresResult> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const captured = { stdout: "", stderr: "" };
    const pending = { stdout: "", stderr: "" };
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      resolve({ code, ...captured });
    };
    const terminate = (code: number) => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            // The process already exited between the check and the kill.
          }
        }
      }
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish(code);
    };
    const abort = () => terminate(130);
    const timer = setTimeout(() => terminate(124), options.timeoutMs);
    timer.unref?.();
    options.signal?.addEventListener("abort", abort, { once: true });

    const emit = (raw: string) => {
      const line = raw.trimEnd();
      if (line !== "") options.onLine?.(line);
    };
    for (const stream of ["stdout", "stderr"] as const) {
      child[stream]?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        captured[stream] += text;
        const parts = (pending[stream] + text).split("\n");
        pending[stream] = parts.pop() ?? "";
        for (const part of parts) emit(part);
      });
    }
    child.on("error", (error) => {
      captured.stderr += error.message;
      finish(1);
    });
    child.on("close", (code) => {
      emit(pending.stdout);
      emit(pending.stderr);
      finish(code ?? 1);
    });
    if (options.signal?.aborted) abort();
  });
}

export type PostgresPhase =
  | "stopped"
  | "starting-database"
  | "migrating"
  | "ready"
  | "stopping"
  | "failed";

export interface PostgresState {
  phase: PostgresPhase;
  message: string | null;
}

export interface LocalPostgresDeps {
  platform: string;
  /** macOS architecture whose distribution directory is used. */
  arch: string;
  env: NodeJS.ProcessEnv;
  /** `run` is injected so lifecycle tests never touch a real server. */
  run: RunPostgres;
  /** Cluster directory under the app's user data. */
  dataDir: string;
  /** Directory holding the pinned `initdb`, `pg_ctl`, `pg_isready`, `psql`. */
  binDir: string;
  randomHex: (bytes: number) => string;
  /** Applies Prisma migrations once the server accepts connections. */
  migrate?: (context: { databaseUrl: string; signal?: AbortSignal }) => Promise<void>;
  onState?: (state: PostgresState) => void;
  onOutput?: (line: string) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  allocatePort?: () => Promise<number>;
  /** Default log rotation; tests inject a spy. */
  rotateLog?: (file: string, maxBytes: number) => Promise<void>;
  mkdir?: (dir: string) => Promise<void>;
  startupTimeoutMs?: number;
  stopTimeoutMs?: number;
  pollIntervalMs?: number;
}

const INIT_FAILED = "The local database could not be created. Retry, and check the log below.";
const CREDENTIALS_MISSING =
  "The saved database credentials are missing or unreadable. Keep the existing data and reinstall the app, or start a new local profile.";
const VERSION_MISMATCH = `This database was created by another PostgreSQL version. This app manages PostgreSQL ${POSTGRES_MAJOR_VERSION}. Keep the old data and install the matching app version.`;
const START_FAILED = "The local database did not start. Check the log below, then retry.";
const READY_TIMEOUT = "The local database started but did not accept connections in time.";
const MIGRATE_FAILED =
  "The local database could not be updated. Your data was kept. Fix the reported problem, then retry.";
const STOP_FAILED = "The local database did not stop cleanly. Retry, or quit and reopen the app.";

function defaultSleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** One rotated copy beside the live log is enough; older history is not required. */
async function defaultRotateLog(file: string, maxBytes: number): Promise<void> {
  try {
    const info = await stat(file);
    if (info.size < maxBytes) return;
    const previous = `${file}.1`;
    await unlink(previous).catch(() => undefined);
    await rename(file, previous);
  } catch {
    // The file does not exist yet.
  }
}

/** `pg_ctl start` reports a taken port as one of these; the wording differs by version. */
export function isPortInUse(output: string): boolean {
  const text = output.toLowerCase();
  return (
    text.includes("address already in use") ||
    text.includes("could not bind") ||
    text.includes("another postmaster")
  );
}

/**
 * Owns exactly one PostgreSQL 16 cluster. It initializes a cold cluster, starts a warm
 * one, waits for it to accept connections, runs migrations, and stops it cleanly. Every
 * external command is injected so the whole lifecycle is testable offline.
 */
export class LocalPostgresController {
  private current: PostgresState = { phase: "stopped", message: null };
  private credentials: PostgresCredentials | null = null;
  private logLines: string[] = [];
  private running: Promise<PostgresState> | null = null;
  private serverRunning = false;
  private listeners: ((state: PostgresState) => void)[] = [];

  constructor(private readonly deps: LocalPostgresDeps) {}

  /** Observes phase changes in addition to the constructor's `onState` callback. */
  subscribe(listener: (state: PostgresState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((candidate) => candidate !== listener);
    };
  }

  state(): PostgresState {
    return this.current;
  }

  /** The exact connection URL both services must receive, once the cluster is known. */
  url(): string | null {
    return this.credentials === null ? null : databaseUrl(this.credentials);
  }

  /** Redacted, bounded tail of PostgreSQL output, oldest first. */
  output(): string[] {
    return [...this.logLines];
  }

  /** Idempotent while starting; a later call joins the in-flight lifecycle. */
  start(signal?: AbortSignal): Promise<PostgresState> {
    if (this.running !== null) return this.running;
    const attempt = this.boot(signal).finally(() => {
      if (this.running === attempt) this.running = null;
    });
    this.running = attempt;
    return attempt;
  }

  async stop(): Promise<PostgresState> {
    await this.running?.catch(() => undefined);
    if (!this.serverRunning) {
      this.setState({ phase: "stopped", message: null });
      return this.current;
    }
    this.setState({ phase: "stopping", message: null });
    const result = await this.runTool("pg_ctl", [
      "-D",
      this.deps.dataDir,
      "-m",
      "fast",
      "-w",
      "-t",
      String(this.stopTimeoutSeconds),
      "stop",
    ]);
    this.serverRunning = false;
    this.setState(
      result.code === 0
        ? { phase: "stopped", message: null }
        : { phase: "failed", message: STOP_FAILED },
    );
    return this.current;
  }

  private get startupTimeoutMs(): number {
    return this.deps.startupTimeoutMs ?? POSTGRES_START_TIMEOUT_MS;
  }

  private get stopTimeoutSeconds(): number {
    return Math.ceil((this.deps.stopTimeoutMs ?? POSTGRES_STOP_TIMEOUT_MS) / 1000);
  }

  private get pollIntervalMs(): number {
    return this.deps.pollIntervalMs ?? POSTGRES_POLL_INTERVAL_MS;
  }

  private async boot(signal?: AbortSignal): Promise<PostgresState> {
    this.setState({ phase: "starting-database", message: null });
    try {
      await (this.deps.mkdir ?? ((dir: string) => mkdir(dir, { recursive: true, mode: 0o700 })))(
        this.deps.dataDir,
      );
      const warm = await this.hasCluster();
      if (warm) {
        if ((await this.clusterVersion()) !== String(POSTGRES_MAJOR_VERSION)) {
          this.fail(VERSION_MISMATCH);
          return this.current;
        }
        this.credentials = await readPostgresCredentials(this.deps.dataDir);
        if (this.credentials === null) {
          this.fail(CREDENTIALS_MISSING);
          return this.current;
        }
      } else {
        this.credentials = await this.createCredentials();
        if (this.credentials === null) return this.current;
      }

      await (this.deps.rotateLog ?? defaultRotateLog)(this.logPath(), POSTGRES_LOG_MAX_BYTES);

      if (!warm && !(await this.initCluster())) return this.current;
      if (!(await this.startServer(signal))) return this.current;
      if (!warm && !(await this.createDatabase())) return this.current;
      if (!(await this.waitReady(signal))) return this.current;

      this.setState({ phase: "migrating", message: null });
      try {
        await this.deps.migrate?.({
          databaseUrl: this.url() ?? "",
          ...(signal === undefined ? {} : { signal }),
        });
      } catch {
        this.fail(MIGRATE_FAILED);
        return this.current;
      }
      this.setState({ phase: "ready", message: null });
      return this.current;
    } catch {
      this.fail(INIT_FAILED);
      return this.current;
    }
  }

  private async hasCluster(): Promise<boolean> {
    return (await readPrivateFile(path.join(this.deps.dataDir, "PG_VERSION"), 16)) !== null;
  }

  private async clusterVersion(): Promise<string | null> {
    const raw = await readPrivateFile(path.join(this.deps.dataDir, "PG_VERSION"), 16);
    return raw?.trim() ?? null;
  }

  private async createCredentials(): Promise<PostgresCredentials | null> {
    const port = await (this.deps.allocatePort ?? allocatePostgresPort)();
    const password = this.deps.randomHex(16);
    if (password.length < 16) {
      this.fail(INIT_FAILED);
      return null;
    }
    const credentials: PostgresCredentials = {
      version: POSTGRES_CREDENTIALS_VERSION,
      port,
      user: POSTGRES_DEFAULT_USER,
      database: POSTGRES_DEFAULT_DATABASE,
      password,
    };
    await writePostgresCredentials(this.deps.dataDir, credentials);
    return credentials;
  }

  private async initCluster(): Promise<boolean> {
    const credentials = this.credentials;
    if (credentials === null) return false;
    const pwFile = path.join(this.deps.dataDir, `.pwfile-${process.pid}`);
    await writePrivateFile(pwFile, `${credentials.password}\n`);
    try {
      const result = await this.runTool("initdb", [
        "-D",
        this.deps.dataDir,
        "-U",
        credentials.user,
        "-A",
        "scram-sha-256",
        "--pwfile",
        pwFile,
        "-E",
        "UTF8",
        "--locale=C",
      ]);
      if (result.code !== 0) {
        this.fail(INIT_FAILED);
        return false;
      }
      return true;
    } finally {
      await unlink(pwFile).catch(() => undefined);
    }
  }

  private async startServer(signal?: AbortSignal): Promise<boolean> {
    const first = await this.spawnServer(signal);
    if (first === true) return true;
    if (first === "port-in-use") {
      const port = await (this.deps.allocatePort ?? allocatePostgresPort)();
      const current = this.credentials;
      if (current === null) return false;
      this.credentials = { ...current, port };
      await writePostgresCredentials(this.deps.dataDir, this.credentials);
      if ((await this.spawnServer(signal)) === true) return true;
    }
    this.fail(START_FAILED);
    return false;
  }

  private async spawnServer(signal?: AbortSignal): Promise<true | "port-in-use" | false> {
    const credentials = this.credentials;
    if (credentials === null) return false;
    const options = desktopPostgresSettings(credentials.port)
      .map((setting) => `-c ${setting}`)
      .join(" ");
    const result = await this.runTool(
      "pg_ctl",
      [
        "-D",
        this.deps.dataDir,
        "-l",
        this.logPath(),
        "-w",
        "-t",
        String(Math.ceil(this.startupTimeoutMs / 1000)),
        "-o",
        options,
        "start",
      ],
      signal,
    );
    if (result.code === 0) {
      this.serverRunning = true;
      return true;
    }
    return isPortInUse(`${result.stdout}\n${result.stderr}`) ? "port-in-use" : false;
  }

  private async createDatabase(): Promise<boolean> {
    const credentials = this.credentials;
    if (credentials === null) return false;
    const exists = await this.psql([
      "--dbname",
      "postgres",
      "-tAc",
      `SELECT 1 FROM pg_database WHERE datname='${credentials.database}'`,
    ]);
    if (exists.code !== 0) {
      this.fail(INIT_FAILED);
      return false;
    }
    if (exists.stdout.trim() === "1") return true;
    const created = await this.psql([
      "--dbname",
      "postgres",
      "-c",
      `CREATE DATABASE "${credentials.database}"`,
    ]);
    if (created.code !== 0) {
      this.fail(INIT_FAILED);
      return false;
    }
    return true;
  }

  private async waitReady(signal?: AbortSignal): Promise<boolean> {
    const credentials = this.credentials;
    if (credentials === null) return false;
    const sleep = this.deps.sleep ?? defaultSleep;
    const deadline = Date.now() + this.startupTimeoutMs;
    while (signal?.aborted !== true) {
      const probe = await this.runTool(
        "pg_isready",
        [
          "-h",
          "127.0.0.1",
          "-p",
          String(credentials.port),
          "-U",
          credentials.user,
          "-d",
          credentials.database,
          "-q",
        ],
        signal,
      );
      if (probe.code === 0) return true;
      if (Date.now() >= deadline) break;
      await sleep(this.pollIntervalMs, signal);
    }
    this.fail(READY_TIMEOUT);
    return false;
  }

  private psql(args: string[], signal?: AbortSignal) {
    const credentials = this.credentials;
    return this.runTool(
      "psql",
      args,
      signal,
      credentials === null ? {} : { PGPASSWORD: credentials.password },
    );
  }

  private runTool(
    name: PostgresBinary,
    args: string[],
    signal?: AbortSignal,
    extraEnv: Record<string, string> = {},
  ) {
    return this.deps.run(postgresBinary(this.deps.binDir, name, this.deps.platform), args, {
      cwd: this.deps.dataDir,
      env: runtimeChildEnv(this.deps.platform, this.deps.env, extraEnv),
      timeoutMs: this.startupTimeoutMs,
      ...(signal === undefined ? {} : { signal }),
      onLine: (line) => this.capture(line),
    });
  }

  private logPath(): string {
    return path.join(this.deps.dataDir, POSTGRES_LOG_FILE);
  }

  private capture(line: string) {
    const redacted = this.redact(line);
    this.logLines = [...this.logLines, redacted].slice(-POSTGRES_LOG_LINES);
    this.deps.onOutput?.(redacted);
  }

  private redact(line: string): string {
    const password = this.credentials?.password;
    return password === undefined ? line : line.split(password).join("[redacted]");
  }

  private fail(message: string) {
    this.setState({ phase: "failed", message });
  }

  private setState(next: PostgresState) {
    if (next.phase === this.current.phase && next.message === this.current.message) return;
    this.current = next;
    this.deps.onState?.(next);
    for (const listener of this.listeners) listener(next);
  }
}
