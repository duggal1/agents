import { type SpawnOptions, spawn } from "node:child_process";
import type { EventEmitter } from "node:events";
import path from "node:path";

/**
 * Verified from the shipped Electron 44 artifact's `Info.plist`
 * (`LSMinimumSystemVersion`). Native runtime binaries must be built against this
 * version or older so a signed release keeps the same minimum macOS.
 */
export const DESKTOP_MINIMUM_MACOS = "13.0";
/** `electron-builder --mac --universal` produces one artifact for both Mac architectures. */
export const DESKTOP_MACOS_ARCHITECTURES = ["arm64", "x64"] as const;

/** Native runtime resources live next to the renderer bundle, outside asar. */
export const RUNTIME_DIR_NAME = "runtime";
export const RUNTIME_MANIFEST_FILE = "runtime-manifest.json";
/** Schema version of the packaged runtime manifest file. */
export const RUNTIME_MANIFEST_VERSION = 1;
export const DEFAULT_LOG_LINES = 200;

/** The app-managed services. PostgreSQL is supervised separately by `local-postgres`. */
export type LocalServiceId = "api" | "worker";

export type LocalReadiness = { kind: "immediate" } | { kind: "log"; pattern: string };

export interface LocalRestartPolicy {
  /** Restarts allowed after an unexpected exit before the service is `failed`. */
  maxRestarts: number;
  backoffMs: number;
}

export interface LocalShutdownPolicy {
  signal: NodeJS.Signals;
  timeoutMs: number;
}

export interface LocalServiceManifest {
  id: LocalServiceId;
  /** Entry point relative to the runtime resource root. Never absolute or user-supplied. */
  entry: string;
  args: string[];
  /**
   * Extra environment merged after the inherited-environment allowlist. It carries
   * the resolved service configuration (database URL, secrets, provider policy).
   */
  env: Record<string, string>;
  readiness: LocalReadiness;
  startupTimeoutMs: number;
  restart: LocalRestartPolicy;
  shutdown: LocalShutdownPolicy;
}

export interface LocalRuntimeManifest {
  version: typeof RUNTIME_MANIFEST_VERSION;
  /** The desktop app version this runtime was packaged for. */
  appVersion: string;
  services: LocalServiceManifest[];
  /** The PostgreSQL distribution shipped beside the services. */
  postgres: { minimumMacos: string; major: number };
  /** koffi architectures staged for a universal build. */
  koffiArches: string[];
}

/** Ordered phases of the whole local backend, exposed to the setup UI. */
export type LocalRuntimePhase =
  | "stopped"
  | "starting-database"
  | "migrating"
  | "starting-api"
  | "starting-worker"
  | "ready"
  | "degraded"
  | "stopping"
  | "failed";

export interface LocalRuntimeState {
  phase: LocalRuntimePhase;
  /** One actionable sentence; null while the backend is progressing normally. */
  message: string | null;
  /** Bounded, redacted, prefixed log tail across every managed process, oldest first. */
  output: string[];
}

/**
 * Installed builds read the runtime from `Contents/Resources/runtime`; development
 * builds read a `runtime/` directory at the repository root produced by the build
 * script. Mirrors `stackResourceDir`.
 */
export function runtimeResourceDir(input: {
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
}): string {
  if (input.packaged) return path.join(input.resourcesPath, RUNTIME_DIR_NAME);
  return path.resolve(input.appPath, "..", "..", RUNTIME_DIR_NAME);
}

/** Resolves a manifest entry under the runtime root, rejecting traversal and absolutes. */
export function resolveRuntimeEntry(root: string, entry: string): string | null {
  if (entry === "" || path.isAbsolute(entry)) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, entry);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

const CHILD_ENV_ALLOWLIST = ["HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "TZ"];
const WIN32_ENV_ALLOWLIST = ["SystemRoot", "SystemDrive", "APPDATA", "LOCALAPPDATA", "ProgramData"];

/**
 * Node services need almost none of the developer's shell environment. Only what a
 * Node process requires to start is inherited; everything else arrives through the
 * explicit `extra` map so a developer's API keys never leak into a managed service.
 */
export function runtimeChildEnv(
  platform: string,
  env: NodeJS.ProcessEnv,
  extra: Record<string, string> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  const names =
    platform === "win32" ? [...CHILD_ENV_ALLOWLIST, ...WIN32_ENV_ALLOWLIST] : CHILD_ENV_ALLOWLIST;
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== "") result[name] = value;
  }
  return { ...result, ...extra };
}

/**
 * Replaces exact secret values first (the only reliable way to catch a credential
 * echoed without a label), then masks obvious `key=value` and bearer shapes. Child
 * output can contain paths, so callers store the redacted tail, never raw output.
 */
export function redactRuntimeLogLine(line: string, secrets: readonly string[] = []): string {
  let redacted = line;
  for (const secret of secrets) {
    if (secret.length >= 6) redacted = redacted.split(secret).join("[redacted]");
  }
  // Bearer first: a labelled-key mask would otherwise swallow the scheme word
  // and leave the credential exposed after it.
  redacted = redacted.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]");
  redacted = redacted.replace(
    /(\b[A-Za-z0-9_]*(?:pass(?:word)?|secret|token|api[_-]?key)[A-Za-z0-9_]*\b\s*[:=]\s*)(\S+)/gi,
    "$1[redacted]",
  );
  return redacted;
}

/** A child process surface narrow enough to fake in tests, satisfied by `ChildProcess`. */
export interface ManagedChild extends EventEmitter {
  pid?: number | undefined;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnManagedChild = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ManagedChild;

export interface LocalProcessOptions {
  manifest: LocalServiceManifest;
  /** Runtime resource root the manifest entry is resolved under. */
  root: string;
  /** The Node runtime binary used to launch the service entry point. */
  execPath: string;
  /** Resolved service environment (already includes secrets). */
  env: Record<string, string>;
  /** Inherited process environment, filtered through the allowlist. */
  inheritedEnv: NodeJS.ProcessEnv;
  platform: string;
  /** Exact secret values to scrub from captured output. */
  secrets?: readonly string[];
  spawn?: SpawnManagedChild;
  /** Receives each redacted output line. */
  onOutput?: (line: string) => void;
  /** Receives every state transition. */
  onState?: (state: LocalProcessState) => void;
  logLimit?: number;
}

export type LocalProcessPhase = "stopped" | "starting" | "running" | "stopping" | "failed";

export interface LocalProcessState {
  id: LocalServiceId;
  phase: LocalProcessPhase;
  pid: number | null;
  restarts: number;
  message: string | null;
}

const defaultSpawn: SpawnManagedChild = (command, args, options) => spawn(command, args, options);

/**
 * Supervises exactly one long-running service process. It owns spawn, readiness,
 * bounded restart on unexpected exit, and a graceful stop with a hard-kill fallback.
 * Readiness is either immediate (the process is up) or matched from a log line. It
 * never reads the file system, so the orchestrator resolves paths and environment.
 */
export class LocalProcess {
  private state: LocalProcessState;
  private child: ManagedChild | null = null;
  private readonly spawn: SpawnManagedChild;
  private readonly logLimit: number;
  private readonly secrets: readonly string[];
  private logLines: string[] = [];
  private startupTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private stopTimer: NodeJS.Timeout | null = null;
  private stopping = false;
  private readyWaiters: { resolve: () => void; reject: (error: Error) => void }[] = [];
  private readinessMatcher: ((line: string) => boolean) | null = null;
  private stopResolve: (() => void) | null = null;

  constructor(private readonly options: LocalProcessOptions) {
    this.spawn = options.spawn ?? defaultSpawn;
    this.secrets = options.secrets ?? [];
    this.logLimit = options.logLimit ?? DEFAULT_LOG_LINES;
    this.state = {
      id: options.manifest.id,
      phase: "stopped",
      pid: null,
      restarts: 0,
      message: null,
    };
  }

  current(): LocalProcessState {
    return this.state;
  }

  /** Redacted tail of this process's output, oldest first. */
  output(): string[] {
    return [...this.logLines];
  }

  /** Starts the process. Idempotent while starting, running, or restarting. */
  start(): void {
    if (this.state.phase !== "stopped" && this.state.phase !== "failed") return;
    this.stopping = false;
    this.state = { ...this.state, restarts: 0, message: null };
    this.spawnChild();
  }

  /**
   * Resolves once the service reports ready; rejects when it fails or is stopped
   * before becoming ready. A later unexpected exit does not reject a settled waiter.
   */
  whenReady(): Promise<void> {
    if (this.state.phase === "running") return Promise.resolve();
    if (this.state.phase === "failed") {
      return Promise.reject(new Error(this.state.message ?? `${this.state.id} failed to start.`));
    }
    return new Promise((resolve, reject) => {
      this.readyWaiters.push({ resolve, reject });
    });
  }

  /** Stops the process: graceful signal, then a hard kill after the shutdown timeout. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.clearRestartTimer();
    if (this.child === null) {
      this.settleReady("stop");
      this.setState({ phase: "stopped", pid: null, message: null });
      return;
    }
    this.setState({ phase: "stopping", message: null });
    // The exit handler resolves this, so an exit that lands mid-stop cannot hang it.
    const exited = new Promise<void>((resolve) => {
      this.stopResolve = resolve;
      if (this.child === null) resolve();
    });
    this.sendSignal(this.options.manifest.shutdown.signal);
    this.stopTimer = setTimeout(() => {
      this.sendSignal("SIGKILL");
    }, this.options.manifest.shutdown.timeoutMs);
    await exited;
    this.clearStopTimer();
  }

  private spawnChild() {
    const command = this.options.execPath;
    const args = [
      resolveRuntimeEntry(this.options.root, this.options.manifest.entry) ??
        path.join(this.options.root, this.options.manifest.entry),
      ...this.options.manifest.args,
    ];
    const env = runtimeChildEnv(this.options.platform, this.options.inheritedEnv, {
      ...this.options.env,
      ...this.options.manifest.env,
    });
    this.setState({ phase: "starting", pid: null, message: null });
    let child: ManagedChild;
    try {
      child = this.spawn(command, args, {
        cwd: this.options.root,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        detached: this.options.platform !== "win32",
      });
    } catch (error) {
      this.failFrom(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    this.child = child;

    child.stdout?.on("data", (chunk: Buffer | string) => this.consume(chunk));
    child.stderr?.on("data", (chunk: Buffer | string) => this.consume(chunk));
    child.once("error", (error: Error) => this.failFrom(error));
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) =>
      this.handleExit(code, signal),
    );

    if (this.options.manifest.readiness.kind === "immediate") {
      this.markRunning();
    } else {
      const { pattern } = this.options.manifest.readiness;
      const matcher = safeRegExp(pattern);
      this.startupTimer = setTimeout(
        () => this.failFrom(new Error(`${this.options.manifest.id} did not become ready in time.`)),
        this.options.manifest.startupTimeoutMs,
      );
      this.readinessMatcher = (line) => matcher.test(line);
    }
  }

  private consume(chunk: Buffer | string) {
    const text = chunk.toString();
    const parts = text.split("\n");
    for (const raw of parts) {
      const line = raw.trimEnd();
      if (line === "") continue;
      const redacted = redactRuntimeLogLine(line, this.secrets);
      this.logLines = [...this.logLines, redacted].slice(-this.logLimit);
      this.options.onOutput?.(redacted);
      if (this.readinessMatcher?.(redacted) === true) {
        this.readinessMatcher = null;
        this.clearStartupTimer();
        this.markRunning();
      }
    }
  }

  private markRunning() {
    this.clearStartupTimer();
    if (this.state.phase === "stopping" || this.stopping) return;
    this.setState({ phase: "running", pid: this.child?.pid ?? null, message: null });
    this.settleReady("ready");
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null) {
    this.child = null;
    this.clearStartupTimer();
    if (this.stopping) {
      this.clearStopTimer();
      this.setState({ phase: "stopped", pid: null, message: null });
      this.settleReady("stop");
      const resolve = this.stopResolve;
      this.stopResolve = null;
      resolve?.();
      return;
    }
    const reason = signal !== null ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    if (this.state.restarts < this.options.manifest.restart.maxRestarts) {
      const restarts = this.state.restarts + 1;
      const backoffMs = this.options.manifest.restart.backoffMs * restarts;
      this.setState({ phase: "starting", pid: null, restarts, message: null });
      this.clearRestartTimer();
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        if (!this.stopping && this.state.phase === "starting") this.spawnChild();
      }, backoffMs);
      return;
    }
    this.failFrom(new Error(`${this.options.manifest.id} exited unexpectedly (${reason}).`));
  }

  private failFrom(error: Error) {
    this.clearStartupTimer();
    this.clearRestartTimer();
    this.clearStopTimer();
    this.child = null;
    this.setState({ phase: "failed", pid: null, message: error.message });
    this.settleReady("fail", error);
  }

  private sendSignal(signal: NodeJS.Signals) {
    const child = this.child;
    if (child === null) return;
    try {
      child.kill(signal);
    } catch {
      // The process already exited between the check and the signal.
    }
  }

  private settleReady(kind: "ready" | "stop" | "fail", error?: Error) {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const waiter of waiters) {
      if (kind === "ready") waiter.resolve();
      else
        waiter.reject(
          error ?? new Error(`${this.state.id} ${kind === "stop" ? "stopped" : "failed"}.`),
        );
    }
  }

  private setState(next: Partial<LocalProcessState>) {
    const merged: LocalProcessState = { ...this.state, ...next };
    if (
      merged.phase === this.state.phase &&
      merged.pid === this.state.pid &&
      merged.restarts === this.state.restarts &&
      merged.message === this.state.message
    ) {
      return;
    }
    this.state = merged;
    this.options.onState?.(merged);
  }

  private clearStartupTimer() {
    if (this.startupTimer !== null) clearTimeout(this.startupTimer);
    this.startupTimer = null;
  }

  private clearRestartTimer() {
    if (this.restartTimer !== null) clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private clearStopTimer() {
    if (this.stopTimer !== null) clearTimeout(this.stopTimer);
    this.stopTimer = null;
  }
}

function safeRegExp(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    // A malformed packaged pattern must never match and never throw mid-supervision.
    return /$.^/;
  }
}

/**
 * Readiness is the log line each service already writes when it can serve traffic.
 * Nothing else in these services emits it, so a packaged pattern stays unambiguous.
 */
export const SERVICE_READINESS: Record<LocalServiceId, LocalReadiness> = {
  api: { kind: "log", pattern: "api listening" },
  worker: { kind: "log", pattern: "worker ready" },
};

export const RUNTIME_OUTPUT_LINES = 400;
/** Prefixes keep one merged log readable without leaking which process said what. */
export const RUNTIME_LOG_PREFIX: Record<LocalServiceId | "database", string> = {
  database: "[database]",
  api: "[api]",
  worker: "[worker]",
};

/** The native runtime consumes a PostgreSQL controller through this narrow surface. */
export type DatabasePhase =
  | "stopped"
  | "starting-database"
  | "migrating"
  | "ready"
  | "stopping"
  | "failed";

export interface DatabaseControllerState {
  phase: DatabasePhase;
  message: string | null;
}

export interface DatabaseController {
  start(signal?: AbortSignal): Promise<DatabaseControllerState>;
  stop(): Promise<DatabaseControllerState>;
  state(): DatabaseControllerState;
  /** Null until the cluster's connection URL is known. */
  url(): string | null;
  output(): string[];
  subscribe(listener: (state: DatabaseControllerState) => void): () => void;
}

/** The narrow surface a supervised service exposes; satisfied by `LocalProcess`. */
export interface RuntimeProcess {
  start(): void;
  stop(): Promise<void>;
  whenReady(): Promise<void>;
  current(): LocalProcessState;
  output(): string[];
}

export interface LocalRuntimeDeps {
  database: DatabaseController;
  /** Runtime resource root the service entry points resolve under. */
  runtimeRoot: string;
  /** The Node runtime binary that launches the service entry points. */
  execPath: string;
  platform: string;
  manifests: Record<LocalServiceId, LocalServiceManifest>;
  /** Resolved per-service environment; `DATABASE_URL` is injected by the orchestrator. */
  serviceEnv: Record<LocalServiceId, Record<string, string>>;
  inheritedEnv: NodeJS.ProcessEnv;
  secrets?: readonly string[];
  logLimit?: number;
  onState?: (state: LocalRuntimeState) => void;
  onOutput?: (line: string) => void;
  createProcess?: (options: LocalProcessOptions) => RuntimeProcess;
}

const DATABASE_FAILED = "The local database did not become ready. Check the log below, then retry.";

/**
 * Boots the whole local backend in dependency order: PostgreSQL (which migrates),
 * then API, then worker. It never starts a service before the database is ready and
 * never starts the worker before the API. Only an unexpected exit degrades or fails it.
 */
export class LocalRuntimeController {
  private current: LocalRuntimeState = { phase: "stopped", message: null, output: [] };
  private api: RuntimeProcess | null = null;
  private worker: RuntimeProcess | null = null;
  private running: Promise<LocalRuntimeState> | null = null;
  private unsubscribeDatabase: (() => void) | null = null;
  private databaseUrlValue: string | null = null;
  private outputLines: string[] = [];

  constructor(private readonly deps: LocalRuntimeDeps) {}

  state(): LocalRuntimeState {
    return this.current;
  }

  /** The connection URL both services received, once the cluster is known. */
  databaseUrl(): string | null {
    return this.databaseUrlValue;
  }

  /** Merged, prefixed log tail; database lines arrive through `recordDatabaseOutput`. */
  output(): string[] {
    return [...this.outputLines];
  }

  /** Wired to the PostgreSQL controller's `onOutput` so its log shares one surface. */
  recordDatabaseOutput(line: string) {
    this.record("database", line);
  }

  /** Idempotent while starting; a later call joins the in-flight boot. */
  start(): Promise<LocalRuntimeState> {
    if (this.running !== null) return this.running;
    const attempt = this.boot().finally(() => {
      if (this.running === attempt) this.running = null;
    });
    this.running = attempt;
    return attempt;
  }

  /** Stops worker, then API, then the database. Safe to call at any phase. */
  async stop(): Promise<LocalRuntimeState> {
    this.setState({ phase: "stopping", message: null });
    await this.worker?.stop().catch(() => undefined);
    await this.api?.stop().catch(() => undefined);
    this.worker = null;
    this.api = null;
    this.unsubscribeDatabase?.();
    this.unsubscribeDatabase = null;
    await this.deps.database.stop().catch(() => undefined);
    this.setState({ phase: "stopped", message: null });
    return this.current;
  }

  /** Controlled restart for a runtime-policy change; used at the next safe boundary. */
  async restart(): Promise<LocalRuntimeState> {
    await this.stop();
    return this.start();
  }

  private async boot(): Promise<LocalRuntimeState> {
    this.setState({ phase: "starting-database", message: null });
    this.unsubscribeDatabase = this.deps.database.subscribe((state) => this.onDatabase(state));
    const database = await this.deps.database.start();
    if (database.phase !== "ready") {
      this.setState({ phase: "failed", message: database.message ?? DATABASE_FAILED });
      return this.current;
    }
    const url = this.deps.database.url();
    if (url === null) {
      this.setState({ phase: "failed", message: DATABASE_FAILED });
      return this.current;
    }
    this.databaseUrlValue = url;
    if (!(await this.startService("api", url))) return this.current;
    if (!(await this.startService("worker", url))) return this.current;
    this.setState({ phase: "ready", message: null });
    return this.current;
  }

  private async startService(id: LocalServiceId, databaseUrl: string): Promise<boolean> {
    this.setState({ phase: id === "api" ? "starting-api" : "starting-worker", message: null });
    const process = this.createService(id, databaseUrl);
    if (id === "api") this.api = process;
    else this.worker = process;
    process.start();
    try {
      await process.whenReady();
    } catch (error) {
      await process.stop().catch(() => undefined);
      this.setState({
        phase: "failed",
        message: error instanceof Error ? error.message : `${id} failed to start.`,
      });
      return false;
    }
    return true;
  }

  private createService(id: LocalServiceId, databaseUrl: string): RuntimeProcess {
    const create =
      this.deps.createProcess ?? ((options: LocalProcessOptions) => new LocalProcess(options));
    return create({
      manifest: this.deps.manifests[id],
      root: this.deps.runtimeRoot,
      execPath: this.deps.execPath,
      env: {
        ...this.deps.serviceEnv[id],
        DATABASE_URL: databaseUrl,
        REALTIME_DATABASE_URL: databaseUrl,
      },
      inheritedEnv: this.deps.inheritedEnv,
      platform: this.deps.platform,
      secrets: this.deps.secrets ?? [],
      logLimit: this.deps.logLimit ?? DEFAULT_LOG_LINES,
      onOutput: (line) => this.record(id, line),
      onState: (state) => this.onServiceState(id, state),
    });
  }

  private onServiceState(id: LocalServiceId, state: LocalProcessState) {
    if (
      this.current.phase === "failed" ||
      this.current.phase === "stopping" ||
      this.current.phase === "stopped"
    ) {
      return;
    }
    if (state.phase === "failed") {
      this.setState({ phase: "failed", message: state.message ?? `${id} stopped unexpectedly.` });
      return;
    }
    if (state.phase === "starting" && state.restarts > 0) {
      if (this.current.phase === "ready" || this.current.phase === "degraded") {
        this.setState({
          phase: "degraded",
          message: `${id} stopped unexpectedly and is restarting.`,
        });
      }
      return;
    }
    if (state.phase === "running" && this.current.phase === "degraded") {
      this.setState({ phase: "ready", message: null });
    }
  }

  private onDatabase(state: DatabaseControllerState) {
    if (this.current.phase === "failed") return;
    if (state.phase === "starting-database") {
      this.setState({ phase: "starting-database", message: null });
      return;
    }
    if (state.phase === "migrating") {
      this.setState({ phase: "migrating", message: null });
      return;
    }
    if (state.phase === "failed") {
      this.setState({ phase: "failed", message: state.message ?? DATABASE_FAILED });
    }
  }

  private record(source: LocalServiceId | "database", line: string) {
    this.outputLines = [...this.outputLines, `${RUNTIME_LOG_PREFIX[source]} ${line}`].slice(
      -RUNTIME_OUTPUT_LINES,
    );
    this.deps.onOutput?.(line);
    this.setState({ output: this.outputLines });
  }

  private setState(next: Partial<LocalRuntimeState>) {
    const merged: LocalRuntimeState = { ...this.current, ...next };
    if (
      merged.phase === this.current.phase &&
      merged.message === this.current.message &&
      merged.output === this.current.output
    ) {
      return;
    }
    this.current = merged;
    this.deps.onState?.(merged);
  }
}
