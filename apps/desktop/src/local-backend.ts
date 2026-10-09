import { existsSync } from "node:fs";
import { mkdir, statfs } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import type { DesktopLocalRuntimeState } from "@sapphire/contracts";
import {
  type DatabaseController,
  type LocalRuntimeState,
  LocalRuntimeController,
  type LocalServiceId,
  type LocalServiceManifest,
  runtimeChildEnv,
  runtimeResourceDir,
  SERVICE_READINESS,
} from "./local-runtime.js";
import {
  type LocalPostgresDeps,
  LocalPostgresController,
  postgresClusterDir,
  postgresRuntimeDir,
  type PostgresState,
  type RunPostgres,
  runPostgres,
} from "./local-postgres.js";
import { ensureRuntimeSecrets, seedRuntimeSecretsFromLegacyEnv } from "./local-runtime-secrets.js";
import {
  migrateComposeDataToNative,
  skipMigrationPreservingLegacy,
  stagingDir,
} from "./local-data-migration.js";
import {
  allocateLoopbackPort,
  ensureStackToken,
  readStackToken,
  stackDir,
  STACK_WEB_URL_FILE,
} from "./local-stack.js";
import { DEFAULT_LOCAL_WEB_URL, isLoopbackHost } from "./setup-config.js";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

/**
 * Owns the packaged macOS "This computer" backend: one app-managed PostgreSQL
 * 16 cluster plus supervised API and worker Node processes, all on loopback.
 * The renderer only ever sees status/start/stop through typed preload IPC; it
 * never supplies paths, ports, or environment.
 *
 * Startup order: one-time Compose data migration (when a legacy stack exists
 * and no native cluster does), then database, then migrations, then API, then
 * worker. Shutdown order: worker and API first, then the database.
 */

/** Marker env var that runs the bundled services under Electron-as-Node. */
export const RUNTIME_EXEC_PATH_ENV = "ELECTRON_RUN_AS_NODE";

export interface LocalBackendStartOptions {
  fresh?: boolean;
}

/**
 * Narrows an untrusted renderer value to `{ fresh?: boolean }`. Anything else,
 * including paths, ports, environment maps, or commands, is dropped: the main
 * process alone chooses what to launch and where it binds.
 */
export function normalizeStartOptions(value: unknown): LocalBackendStartOptions {
  if (typeof value !== "object" || value === null) return {};
  const fresh = (value as Record<string, unknown>).fresh;
  return fresh === true ? { fresh: true } : {};
}

export interface BackendServiceEnv {
  api: Record<string, string>;
  worker: Record<string, string>;
}

export interface LocalBackendDeps {
  userDataDir: string;
  platform: string;
  /** macOS architecture whose PostgreSQL distribution is launched. */
  arch: string;
  env: NodeJS.ProcessEnv;
  /** Node runtime binary for the service entry points (Electron as Node). */
  execPath: string;
  packaged: boolean;
  resourcesPath: string;
  appPath: string;
  appVersion: string;
  randomHex: (bytes: number) => string;
  run?: RunPostgres;
  exists?: (file: string) => boolean;
  freeDiskBytes?: () => Promise<number>;
  allocatePort?: () => Promise<number>;
  /** Health probe against the loopback API; injected so tests never bind sockets. */
  probeApi?: (url: string, signal?: AbortSignal) => Promise<boolean>;
  createDatabase?: (deps: LocalPostgresDeps) => DatabaseController;
  createRuntime?: (args: {
    database: DatabaseController;
    manifests: Record<LocalServiceId, LocalServiceManifest>;
    serviceEnv: BackendServiceEnv;
  }) => BackendRuntime;
  /**
   * Sandbox policy env (E2B key, explicit provider, settings path, supervisor
   * wiring) merged into both service envs. Absent keeps E2B-primary defaults.
   * Invoked before API/worker boot so an enabled Docker fallback can start its
   * supervisor first; a failed supervisor still boots the backend.
   */
  resolveSandboxServiceEnv?: (context: { appDataDir: string }) => Promise<Record<string, string>>;
  /** Runs after API/worker/database stop (fallback supervisor shutdown). */
  afterServicesStop?: () => Promise<void>;
  onState?: (state: DesktopLocalRuntimeState) => void;
}

/** The narrow surface the backend needs; satisfied by `LocalRuntimeController`. */
export interface BackendRuntime {
  state(): LocalRuntimeState;
  output(): string[];
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  databaseUrl(): string | null;
}

/** Rejects anything that is not an http(s) loopback origin. */
export function assertLoopbackWebUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Refusing non-loopback local backend target: ${url}`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !isLoopbackHost(parsed.hostname)
  ) {
    throw new Error(`Refusing non-loopback local backend target: ${url}`);
  }
  return parsed.origin;
}

/**
 * Builds the fixed service manifests. The database URL is never baked in: the
 * runtime controller injects the exact URL of the cluster it started. Entry
 * points are manifest-relative and resolved under the runtime root, so a
 * renderer or config value can never point them elsewhere.
 */
export function buildServiceManifests(input: {
  apiPort: number;
  webUrl: string;
  secrets: {
    BETTER_AUTH_SECRET: string;
    ENCRYPTION_KEY: string;
    SCREEN_PROXY_SECRET: string;
    SANDBOX_SUPERVISOR_TOKEN: string;
  };
  stackToken: string;
  appDataDir: string;
  nodeEnv: string;
  /**
   * Sandbox policy env merged into both services after the shared base. Core
   * fields below still win on collision; sandbox keys are distinct by design.
   */
  sandboxEnv?: Record<string, string>;
}): { manifests: Record<LocalServiceId, LocalServiceManifest>; serviceEnv: BackendServiceEnv } {
  const base = {
    args: [] as string[],
    startupTimeoutMs: 120_000,
    restart: { maxRestarts: 3, backoffMs: 1_000 },
    shutdown: { signal: "SIGTERM" as const, timeoutMs: 15_000 },
  };
  const sharedServiceEnv: Record<string, string> = {
    NODE_ENV: input.nodeEnv,
    [RUNTIME_EXEC_PATH_ENV]: "1",
    DATA_DIR: input.appDataDir,
    ...input.sandboxEnv,
  };
  const manifests: Record<LocalServiceId, LocalServiceManifest> = {
    api: {
      ...base,
      id: "api",
      entry: "services/api/index.js",
      env: {},
      readiness: SERVICE_READINESS.api,
    },
    worker: {
      ...base,
      id: "worker",
      entry: "services/worker/index.js",
      env: {},
      readiness: SERVICE_READINESS.worker,
    },
  };
  const serviceEnv: BackendServiceEnv = {
    api: {
      ...sharedServiceEnv,
      API_HOST: "127.0.0.1",
      API_PORT: String(input.apiPort),
      BETTER_AUTH_URL: input.webUrl,
      WEB_ORIGIN: input.webUrl,
      API_URL: input.webUrl,
      BETTER_AUTH_SECRET: input.secrets.BETTER_AUTH_SECRET,
      ENCRYPTION_KEY: input.secrets.ENCRYPTION_KEY,
      SCREEN_PROXY_SECRET: input.secrets.SCREEN_PROXY_SECRET,
      SANDBOX_SUPERVISOR_TOKEN: input.secrets.SANDBOX_SUPERVISOR_TOKEN,
      RAKAZO_DESKTOP_STACK_TOKEN: input.stackToken,
    },
    worker: {
      ...sharedServiceEnv,
      ENCRYPTION_KEY: input.secrets.ENCRYPTION_KEY,
    },
  };
  return { manifests, serviceEnv };
}

/** Runs `prisma migrate deploy` from staged tooling with a fixed argv, never a shell. */
export async function prismaMigrateDeploy(input: {
  packaged: boolean;
  runtimeRoot: string;
  repoRoot: string;
  databaseUrl: string;
  platform: string;
  /** Node-capable runtime (Electron with ELECTRON_RUN_AS_NODE) for the CLI. */
  execPath: string;
  /** Host architecture selecting the staged schema-engine binary. */
  arch: string;
  env: NodeJS.ProcessEnv;
  run: RunPostgres;
  exists: (file: string) => boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<void> {
  let binary: string;
  let args: string[];
  let cwd: string;
  let extraEnv: Record<string, string> = {};
  if (input.packaged) {
    const cli = path.join(input.runtimeRoot, "prisma", "bin", "prisma.mjs");
    // Mirrors the staged prisma/ layout (config + schema + migrations travel
    // together exactly as in packages/db): runtime/prisma/prisma.config.js
    // declares schema "prisma/schema.prisma" relative to itself.
    const schema = path.join(input.runtimeRoot, "prisma", "prisma", "schema.prisma");
    const engine = path.join(
      input.runtimeRoot,
      "prisma",
      "engines",
      input.arch,
      `schema-engine-${input.arch}`,
    );
    if (!input.exists(cli) || !input.exists(schema) || !input.exists(engine)) {
      throw new Error(
        "The packaged app is missing its database migration tool. Reinstall Sapphire and retry.",
      );
    }
    // The CLI bundle needs CJS-main globals (see bin/prisma.mjs) and therefore
    // a real Node runtime: the same Electron executable as the services with
    // ELECTRON_RUN_AS_NODE, because no system Node exists on a user's machine
    // and PATH is not inherited by design. No --schema flag: the staged
    // prisma.config.js in cwd already declares the schema and migrations
    // paths, exactly like the dev flow. The engine path is explicit so the
    // CLI never downloads anything at runtime.
    binary = input.execPath;
    args = [cli, "migrate", "deploy"];
    cwd = path.join(input.runtimeRoot, "prisma");
    extraEnv = {
      [RUNTIME_EXEC_PATH_ENV]: "1",
      PRISMA_SCHEMA_ENGINE_BINARY: engine,
    };
  } else {
    const base = path.join(input.repoRoot, "node_modules", ".bin", "prisma");
    binary = input.platform === "win32" ? `${base}.cmd` : base;
    if (!input.exists(binary)) {
      throw new Error(
        "The Prisma CLI is not installed. Run the package manager install, then retry.",
      );
    }
    args = ["migrate", "deploy"];
    cwd = path.join(input.repoRoot, "packages", "db");
  }
  const result = await input.run(binary, args, {
    cwd,
    env: runtimeChildEnv(input.platform, input.env, { DATABASE_URL: input.databaseUrl, ...extraEnv }),
    timeoutMs: input.timeoutMs ?? 10 * 60_000,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (result.code !== 0 || input.signal?.aborted === true) {
    throw new Error("The local database could not be updated to this app version.");
  }
}

async function isLoopbackPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

/**
 * Supervises the whole native backend behind the three setup IPC calls. All
 * filesystem, process, and network effects are injected for offline tests.
 */
export class LocalBackend {
  private current: DesktopLocalRuntimeState = {
    phase: "idle",
    message: null,
    output: [],
    freshStartAvailable: false,
  };
  private webUrlValue: string;
  private running: Promise<DesktopLocalRuntimeState> | null = null;
  private runtime: BackendRuntime | null = null;
  private abortController: AbortController | null = null;
  private freshStartAvailable = false;
  /** Staging cluster captured while a migration is in flight, for verification. */
  private migrationStaging: DatabaseController | null = null;

  constructor(private readonly deps: LocalBackendDeps) {
    this.webUrlValue = deps.env.SAPPHIRE_LOCAL_WEB_URL?.trim() || DEFAULT_LOCAL_WEB_URL;
  }

  /** The managed origin the app window opens; resolved to a free loopback port at start. */
  webUrl(): string {
    return this.webUrlValue;
  }

  state(): DesktopLocalRuntimeState {
    return this.current;
  }

  /** Idempotent while starting; a later call joins the in-flight attempt. */
  start(options?: unknown): Promise<DesktopLocalRuntimeState> {
    if (this.running !== null) return this.running;
    const attempt = this.boot(normalizeStartOptions(options)).finally(() => {
      if (this.running === attempt) this.running = null;
    });
    this.running = attempt;
    return attempt;
  }

  /** Graceful shutdown: worker and API first, then the database. Safe at any phase. */
  async stop(): Promise<DesktopLocalRuntimeState> {
    this.abortController?.abort();
    this.abortController = null;
    await this.runtime?.stop().catch(() => undefined);
    this.runtime = null;
    // The fallback supervisor stops after the services it served: its shutdown
    // stops managed containers without deleting them, then itself. The database
    // already stopped inside the runtime; the supervisor never touches it.
    await this.deps.afterServicesStop?.().catch(() => undefined);
    this.setState({ phase: "idle", message: null });
    return this.current;
  }

  /** Cancels an in-flight migration without stopping already-running services. */
  abort() {
    this.abortController?.abort();
  }

  /**
   * Strict readiness for opening the app: the supervisor is ready and the
   * loopback API answers health. Used before the setup window saves mode `new`.
   */
  async matchesDesired(): Promise<boolean> {
    if (this.current.phase !== "ready") return false;
    try {
      return await (this.deps.probeApi ?? (async () => false))(this.webUrlValue);
    } catch {
      return false;
    }
  }

  /** Origin plus private token for the isolated local-settings window. Main-process only. */
  async localSettingsTarget(): Promise<{ origin: string; token: string } | null> {
    if (this.current.phase !== "ready") return null;
    const token = await readStackToken(stackDir(this.deps.userDataDir));
    if (token === null) return null;
    return { origin: new URL(this.webUrlValue).origin, token };
  }

  private get stackDirectory(): string {
    return stackDir(this.deps.userDataDir);
  }

  private async boot(options: LocalBackendStartOptions): Promise<DesktopLocalRuntimeState> {
    const controller = new AbortController();
    this.abortController = controller;
    const signal = controller.signal;
    try {
      this.freshStartAvailable = false;
      if (options.fresh === true) {
        await skipMigrationPreservingLegacy({
          userDataDir: this.deps.userDataDir,
          stackDir: this.stackDirectory,
          exists: this.deps.exists ?? existsSync,
        }).catch(() => ({ skipped: false }));
      } else {
        const migrated = await this.runMigration(signal);
        if (!migrated) return this.current;
      }
      await this.bootServices(signal);
      return this.current;
    } catch (error) {
      this.setState({
        phase: "failed",
        message:
          error instanceof Error
            ? error.message
            : "The local app services did not start. Retry.",
      });
      return this.current;
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }
  }

  /** Returns false when startup must not continue (message already set). */
  private async runMigration(signal: AbortSignal): Promise<boolean> {
    this.setState({ phase: "migrating", message: "Checking your previous installation." });
    const run = this.deps.run ?? runPostgres;
    const exists = this.deps.exists ?? existsSync;
    this.migrationStaging = this.createDatabase(stagingDir(this.deps.userDataDir), async () => undefined);
    const staging = this.migrationStaging;
    try {
      const outcome = await migrateComposeDataToNative(
        {
          userDataDir: this.deps.userDataDir,
          stackDir: this.stackDirectory,
          platform: this.deps.platform,
          env: this.deps.env,
          exists,
          run,
          binDir: this.postgresBinDir(),
          freeDiskBytes:
            this.deps.freeDiskBytes ??
            (async () => {
              const stats = await statfs(this.deps.userDataDir);
              return Number(stats.bfree) * Number(stats.bsize);
            }),
          createStagingDatabase: () => staging,
          migrate: (context) =>
            prismaMigrateDeploy({
              packaged: this.deps.packaged,
              runtimeRoot: this.runtimeRoot(),
              repoRoot: path.resolve(this.deps.appPath, "..", ".."),
              databaseUrl: context.databaseUrl,
              platform: this.deps.platform,
              execPath: this.deps.execPath,
              arch: this.deps.arch,
              env: this.deps.env,
              run,
              exists,
              ...(context.signal === undefined ? {} : { signal: context.signal }),
            }),
          verifyServices: (databaseUrl, verifySignal) =>
            this.verifyStagingServices(databaseUrl, verifySignal),
          seedSecrets: (legacyEnvText) =>
            legacyEnvText === null
              ? ensureRuntimeSecrets(this.deps.userDataDir, this.deps.randomHex).then(
                  () => undefined,
                )
              : seedRuntimeSecretsFromLegacyEnv(
                  this.deps.userDataDir,
                  legacyEnvText,
                  this.deps.randomHex,
                ).then(() => undefined),
          onPhase: (phase, message) => {
            if (phase !== "exporting" && phase !== "restoring" && phase !== "verifying") return;
            this.setState({ phase: "migrating", message });
          },
        },
        signal,
      );
      if (
        outcome.outcome === "not-needed" ||
        outcome.outcome === "skipped" ||
        outcome.outcome === "migrated"
      ) {
        return true;
      }
      this.freshStartAvailable = true;
      this.setState({ phase: "failed", message: outcome.message });
      return false;
    } finally {
      this.migrationStaging = null;
    }
  }

  private async bootServices(signal: AbortSignal): Promise<void> {
    const exists = this.deps.exists ?? existsSync;
    const webUrl = await this.resolveWebUrl();
    assertLoopbackWebUrl(webUrl);
    const apiPort = portOf(webUrl);
    const secrets = await ensureRuntimeSecrets(this.deps.userDataDir, this.deps.randomHex);
    await mkdir(this.stackDirectory, { recursive: true, mode: 0o700 });
    const token = await ensureStackToken(this.stackDirectory, this.deps.randomHex);
    const appDataDir = path.join(this.deps.userDataDir, "appdata");
    await mkdir(appDataDir, { recursive: true, mode: 0o700 });

    const database = this.createDatabase(postgresClusterDir(this.deps.userDataDir), (context) =>
      prismaMigrateDeploy({
        packaged: this.deps.packaged,
        runtimeRoot: this.runtimeRoot(),
        repoRoot: path.resolve(this.deps.appPath, "..", ".."),
        databaseUrl: context.databaseUrl,
        platform: this.deps.platform,
        execPath: this.deps.execPath,
        arch: this.deps.arch,
        env: this.deps.env,
        run: this.deps.run ?? runPostgres,
        exists,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      }),
    );
    const { manifests, serviceEnv } = buildServiceManifests({
      apiPort,
      webUrl,
      secrets,
      stackToken: token,
      appDataDir,
      nodeEnv: this.deps.packaged ? "production" : (this.deps.env.NODE_ENV ?? "development"),
      sandboxEnv: await this.deps.resolveSandboxServiceEnv?.({ appDataDir }).catch(() => ({})),
    });
    const runtime = this.createRuntime(database, manifests, serviceEnv);
    this.runtime = runtime;
    this.setState({ phase: "starting-database", message: null });
    await runtime.start();
    if (this.mapRuntimePhase(runtime.state()) !== "ready") {
      await runtime.stop().catch(() => undefined);
      this.runtime = null;
      this.setState({
        phase: "failed",
        message: runtime.state().message ?? "The local app services did not start. Retry.",
      });
      return;
    }
    if (signal.aborted) {
      await this.stop();
      return;
    }
    this.setState({ phase: "ready", message: null });
  }

  private async verifyStagingServices(
    databaseUrl: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const staging = this.migrationStaging;
    if (staging === null) return false;
    const webUrl = assertLoopbackWebUrl(this.webUrlValue);
    const secrets = await ensureRuntimeSecrets(this.deps.userDataDir, this.deps.randomHex);
    await mkdir(this.stackDirectory, { recursive: true, mode: 0o700 });
    const token = await ensureStackToken(this.stackDirectory, this.deps.randomHex);
    const appDataDir = path.join(this.deps.userDataDir, "appdata");
    await mkdir(appDataDir, { recursive: true, mode: 0o700 });
    const { manifests, serviceEnv } = buildServiceManifests({
      apiPort: portOf(webUrl),
      webUrl,
      secrets,
      stackToken: token,
      appDataDir,
      nodeEnv: this.deps.packaged ? "production" : (this.deps.env.NODE_ENV ?? "development"),
      sandboxEnv: await this.deps.resolveSandboxServiceEnv?.({ appDataDir }).catch(() => ({})),
    });
    // The staging cluster is already running under the migration's controller;
    // this adapter only lends its URL to a throwaway supervisor that must not
    // stop the shared cluster when verification ends.
    const adapter: DatabaseController = {
      start: async () => staging.state(),
      stop: async () => staging.state(),
      state: () => staging.state(),
      url: () => databaseUrl,
      output: () => staging.output(),
      subscribe: () => () => undefined,
    };
    const runtime = this.createRuntime(adapter, manifests, serviceEnv);
    try {
      await runtime.start();
      if (this.mapRuntimePhase(runtime.state()) !== "ready") return false;
      const probe = this.deps.probeApi ?? (async () => false);
      return await probe(webUrl, signal);
    } catch {
      return false;
    } finally {
      await runtime.stop().catch(() => undefined);
    }
  }

  private createDatabase(
    dataDir: string,
    migrate: (context: { databaseUrl: string; signal?: AbortSignal }) => Promise<void>,
  ): DatabaseController {
    const factory =
      this.deps.createDatabase ??
      ((deps: LocalPostgresDeps) => new LocalPostgresController(deps) as DatabaseController);
    return factory({
      platform: this.deps.platform,
      arch: this.deps.arch,
      env: this.deps.env,
      run: this.deps.run ?? runPostgres,
      dataDir,
      binDir: this.postgresBinDir(),
      randomHex: this.deps.randomHex,
      migrate,
      onState: (state: PostgresState) => {
        if (state.phase === "starting-database" || state.phase === "migrating") {
          this.setState({ phase: state.phase, message: null });
        } else if (state.phase === "failed") {
          this.setState({ phase: "failed", message: state.message });
        }
      },
      onOutput: (line) => this.recordOutput(`[database] ${line}`),
    });
  }

  private createRuntime(
    database: DatabaseController,
    manifests: Record<LocalServiceId, LocalServiceManifest>,
    serviceEnv: BackendServiceEnv,
  ): BackendRuntime {
    const factory =
      this.deps.createRuntime ??
      ((args: {
        database: DatabaseController;
        manifests: Record<LocalServiceId, LocalServiceManifest>;
        serviceEnv: BackendServiceEnv;
      }) =>
        new LocalRuntimeController({
          database,
          runtimeRoot: this.runtimeRoot(),
          execPath: this.deps.execPath,
          platform: this.deps.platform,
          manifests: args.manifests,
          serviceEnv: args.serviceEnv,
          inheritedEnv: this.deps.env,
          onState: (state) => {
            const phase = this.mapRuntimePhase(state);
            if (phase === "idle" || phase === "stopping") return;
            this.setState({ phase, message: state.message });
          },
          onOutput: (line) => this.recordOutput(line),
        }));
    return factory({ database, manifests, serviceEnv });
  }

  private mapRuntimePhase(state: LocalRuntimeState): DesktopLocalRuntimeState["phase"] {
    switch (state.phase) {
      case "stopped":
        return "idle";
      case "starting-database":
      case "migrating":
      case "starting-api":
      case "starting-worker":
      case "ready":
      case "degraded":
      case "stopping":
      case "failed":
        return state.phase;
    }
  }

  private runtimeRoot(): string {
    return runtimeResourceDir({
      packaged: this.deps.packaged,
      resourcesPath: this.deps.resourcesPath,
      appPath: this.deps.appPath,
    });
  }

  private postgresBinDir(): string {
    return postgresRuntimeDir({
      packaged: this.deps.packaged,
      resourcesPath: this.deps.resourcesPath,
      appPath: this.deps.appPath,
      arch: this.deps.arch,
    });
  }

  /** Keeps the saved origin across restarts; allocates a fresh loopback port when taken. */
  private async resolveWebUrl(): Promise<string> {
    const override = this.deps.env.SAPPHIRE_LOCAL_WEB_URL?.trim();
    if (override) {
      this.webUrlValue = assertLoopbackWebUrl(override);
      return this.webUrlValue;
    }
    const saved = await readPrivateFile(path.join(this.stackDirectory, STACK_WEB_URL_FILE), 128);
    const origin = assertLoopbackWebUrl(saved?.trim() || DEFAULT_LOCAL_WEB_URL);
    if (await isLoopbackPortFree(portOf(origin))) {
      this.webUrlValue = origin;
      return origin;
    }
    const fresh = `http://127.0.0.1:${await (this.deps.allocatePort ?? allocateLoopbackPort)()}`;
    await mkdir(this.stackDirectory, { recursive: true, mode: 0o700 });
    await writePrivateFile(path.join(this.stackDirectory, STACK_WEB_URL_FILE), fresh);
    this.webUrlValue = fresh;
    return fresh;
  }

  private recordOutput(line: string) {
    this.setState({ output: [...this.current.output, line].slice(-400) });
  }

  private setState(next: Partial<DesktopLocalRuntimeState>) {
    const merged: DesktopLocalRuntimeState = {
      ...this.current,
      ...next,
      freshStartAvailable: this.freshStartAvailable,
    };
    if (
      merged.phase === this.current.phase &&
      merged.message === this.current.message &&
      merged.output === this.current.output &&
      merged.freshStartAvailable === this.current.freshStartAvailable
    ) {
      return;
    }
    this.current = merged;
    this.deps.onState?.(merged);
  }
}

function portOf(webUrl: string): number {
  const port = new URL(webUrl).port;
  return port === "" ? 80 : Number(port);
}
