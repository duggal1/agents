import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import {
  redactRuntimeLogLine,
  resolveRuntimeEntry,
  runtimeChildEnv,
  type ManagedChild,
  type SpawnManagedChild,
} from "./local-runtime.js";

/**
 * T6 optional Docker sandbox supervisor (fallback only). Reuses the existing
 * `infra/sandboxes/supervisor` bundle — there is no second container-control
 * implementation here. Electron starts it only when the user enabled Docker
 * fallback and a Docker daemon is present; E2B-only launches never start it.
 */

/** Supervisor bundle entry relative to the runtime resource root. */
export const DOCKER_SUPERVISOR_ENTRY = "services/supervisor/index.js";
/** Staged computer build-context directory relative to the runtime root. */
export const COMPUTER_CONTEXT_DIR = "computer";
/**
 * Exact build-context files `ensureComputerImage` needs. The image is built
 * lazily by the supervisor on the first Docker fallback — never during install
 * or E2B startup, and no image tar is bundled.
 */
export const COMPUTER_CONTEXT_FILES = [
  "Dockerfile",
  "start.sh",
  "user-env.sh",
  "control.py",
  "xcapture.c",
  "rakazo-browser",
  "rakazo-page-browser",
  "rakazo-browser.desktop",
  "embed.html",
  "clipboard-bridge.js",
  "mobile-keyboard.js",
  "fluxbox.init",
  "fluxbox.apps",
  "fluxbox.menu",
] as const;
/** The supervisor never binds anywhere except loopback. */
export const DOCKER_SUPERVISOR_HOST = "127.0.0.1";
/** Label selecting managed bot computers for stop-without-delete on shutdown. */
export const MANAGED_CONTAINER_LABEL = "rakazo.managed=true";
export const DOCKER_SUPERVISOR_LOG_LINES = 200;
export const DOCKER_INFO_TIMEOUT_MS = 15_000;
export const DOCKER_STOP_TIMEOUT_MS = 60_000;
export const DOCKER_SUPERVISOR_START_TIMEOUT_MS = 30_000;
export const DOCKER_SUPERVISOR_HEALTH_INTERVAL_MS = 250;
export const DOCKER_SUPERVISOR_STOP_TIMEOUT_MS = 10_000;

export const DOCKER_UNAVAILABLE_MESSAGE =
  "Docker is not available, so Docker computer fallback is off. E2B computers are unaffected.";
export const DAEMON_UNREACHABLE_MESSAGE =
  "The Docker daemon is not reachable, so Docker computer fallback is off. E2B computers are unaffected.";
export const SUPERVISOR_START_FAILED_MESSAGE =
  "The Docker computer service did not start, so Docker computer fallback is off. E2B computers are unaffected.";

/**
 * Selects the Docker socket for the supervisor child. Mirrors the supervisor's
 * own resolution so both agree; `DOCKER_HOST` defers to the Docker toolchain.
 */
export function resolveDockerSocket(input: {
  platform: string;
  env: NodeJS.ProcessEnv;
  exists: (file: string) => boolean;
}): string | undefined {
  if ((input.env.DOCKER_HOST ?? "").trim() !== "") return undefined;
  const override = (input.env.DOCKER_SOCKET ?? "").trim();
  if (override !== "") return override;
  if (input.platform === "darwin") {
    const home = (input.env.HOME ?? "").trim();
    if (home !== "") {
      const userSocket = path.join(home, ".docker", "run", "docker.sock");
      if (input.exists(userSocket)) return userSocket;
    }
  }
  return input.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock";
}

export function dockerSupervisorHealthUrl(port: number): string {
  return `http://${DOCKER_SUPERVISOR_HOST}:${port}/health`;
}

/**
 * Environment for the supervisor child. Loopback bind, generated private
 * token, selected socket, staged computer-image context, and an absolute data
 * directory (the packaged layout has no repository root to resolve from).
 * `SANDBOX_CONTROL_VIA_LOOPBACK` is set where the daemon cannot reach
 * container IPs (Docker Desktop on macOS/Windows).
 */
export function dockerSupervisorEnv(input: {
  port: number;
  token: string;
  socket: string | undefined;
  dockerHost: string | undefined;
  computerContextDir: string;
  dataDir: string;
  platform: string;
}): Record<string, string> {
  const env: Record<string, string> = {
    SUPERVISOR_HOST: DOCKER_SUPERVISOR_HOST,
    SUPERVISOR_PORT: String(input.port),
    SANDBOX_SUPERVISOR_TOKEN: input.token,
    RAKAZO_COMPUTER_CONTEXT: input.computerContextDir,
    DATA_DIR: input.dataDir,
  };
  if (input.socket !== undefined) env.DOCKER_SOCKET = input.socket;
  if (input.dockerHost !== undefined && input.dockerHost !== "") {
    env.DOCKER_HOST = input.dockerHost;
  }
  if (input.platform === "darwin" || input.platform === "win32") {
    env.SANDBOX_CONTROL_VIA_LOOPBACK = "true";
  }
  return env;
}

export type DockerSupervisorPhase = "stopped" | "starting" | "ready" | "stopping" | "failed";

export interface DockerSupervisorState {
  phase: DockerSupervisorPhase;
  message: string | null;
  url: string | null;
}

export interface DockerSupervisorConnection {
  url: string;
  token: string;
}

export interface RunDockerLike {
  (
    binary: string,
    args: string[],
    options: { cwd: string; env: Record<string, string>; timeoutMs: number; signal?: AbortSignal },
  ): Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface LocalDockerSupervisorDeps {
  platform: string;
  env: NodeJS.ProcessEnv;
  /** The user's explicit fallback choice. False never starts the supervisor. */
  enabled: boolean;
  /** Runtime resource root the supervisor bundle resolves under. */
  runtimeRoot: string;
  /** Node binary that launches the supervisor bundle. */
  execPath: string;
  /** Absolute data directory passed through to the supervisor. */
  dataDir: string;
  /** Resolved docker CLI, or null when Docker is not installed. */
  dockerBinary: string | null;
  runDocker: RunDockerLike;
  spawn?: SpawnManagedChild;
  checkHealth?: (url: string) => Promise<boolean>;
  randomHex?: (bytes: number) => string;
  allocatePort?: () => Promise<number>;
  /** Persisted supervisor token; generated per launch when absent. */
  supervisorToken?: string;
  exists?: (file: string) => boolean;
  entry?: string;
  computerContextDir?: string;
  startupTimeoutMs?: number;
  healthIntervalMs?: number;
  stopTimeoutMs?: number;
  logLimit?: number;
  onState?: (state: DockerSupervisorState) => void;
  onOutput?: (line: string) => void;
}

async function defaultCheckHealth(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return false;
    const payload = (await response.json().catch(() => null)) as { ok?: unknown } | null;
    return payload?.ok === true;
  } catch {
    return false;
  }
}

function defaultRandomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

async function defaultAllocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, DOCKER_SUPERVISOR_HOST, () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else if (address && typeof address !== "string") resolve(address.port);
        else reject(new Error("No loopback port allocated."));
      });
    });
  });
}

const defaultSpawn: SpawnManagedChild = (command, args, options) => spawn(command, args, options);

/**
 * Supervises the optional Docker sandbox supervisor as a separate
 * authenticated loopback-only child process. The Docker socket stays host
 * authority: the renderer never sees it, and only the local API process talks
 * to the supervisor through its existing token-authenticated API.
 */
export class LocalDockerSupervisor {
  private current: DockerSupervisorState = { phase: "stopped", message: null, url: null };
  private child: ManagedChild | null = null;
  private activeConnection: DockerSupervisorConnection | null = null;
  private logLines: string[] = [];
  private running: Promise<DockerSupervisorState> | null = null;
  private exited: Promise<void> | null = null;
  private resolveExited: (() => void) | null = null;

  constructor(private readonly deps: LocalDockerSupervisorDeps) {}

  state(): DockerSupervisorState {
    return this.current;
  }

  /** Loopback URL plus private token for the local API process. Null until ready. */
  connection(): DockerSupervisorConnection | null {
    return this.activeConnection;
  }

  /** Bounded, token-redacted tail of supervisor output, oldest first. */
  output(): string[] {
    return [...this.logLines];
  }

  /** Starts the supervisor; resolves `ready` or `failed` but never throws. */
  start(): Promise<DockerSupervisorState> {
    if (this.running !== null) return this.running;
    const attempt = this.boot().finally(() => {
      if (this.running === attempt) this.running = null;
    });
    this.running = attempt;
    return attempt;
  }

  /**
   * Shutdown order: stop API/worker first (the caller owns those), then stop
   * active computer containers without deleting their data, then stop the
   * supervisor. Safe to call at any phase.
   */
  async stop(): Promise<DockerSupervisorState> {
    await this.running?.catch(() => undefined);
    this.setState({ phase: "stopping", message: null });
    await this.stopManagedContainers();
    await this.stopChild();
    this.activeConnection = null;
    this.setState({ phase: "stopped", message: null, url: null });
    return this.current;
  }

  private async boot(): Promise<DockerSupervisorState> {
    if (!this.deps.enabled) {
      this.setState({ phase: "stopped", message: null, url: null });
      return this.current;
    }
    if (this.child !== null) return this.current;
    const entry = resolveRuntimeEntry(
      this.deps.runtimeRoot,
      this.deps.entry ?? DOCKER_SUPERVISOR_ENTRY,
    );
    if (entry === null) {
      return this.fail("The Docker computer service is missing from the app. Reinstall Sapphire.");
    }
    if (this.deps.dockerBinary === null) {
      return this.fail(DOCKER_UNAVAILABLE_MESSAGE);
    }
    this.setState({ phase: "starting", message: null, url: null });
    if (!(await this.dockerDaemonReachable())) {
      return this.fail(DAEMON_UNREACHABLE_MESSAGE);
    }
    const token = this.deps.supervisorToken?.trim() || (this.deps.randomHex ?? defaultRandomHex)(32);
    if (token === "") return this.fail(SUPERVISOR_START_FAILED_MESSAGE);
    const port = await (this.deps.allocatePort ?? defaultAllocatePort)().catch(() => null);
    if (port === null) return this.fail(SUPERVISOR_START_FAILED_MESSAGE);
    const url = dockerSupervisorHealthUrl(port);
    const socket = resolveDockerSocket({
      platform: this.deps.platform,
      env: this.deps.env,
      exists: this.deps.exists ?? (() => false),
    });
    const env = runtimeChildEnv(this.deps.platform, this.deps.env, {
      ...dockerSupervisorEnv({
        port,
        token,
        socket,
        dockerHost: (this.deps.env.DOCKER_HOST ?? "").trim() || undefined,
        computerContextDir: path.join(
          this.deps.runtimeRoot,
          this.deps.computerContextDir ?? COMPUTER_CONTEXT_DIR,
        ),
        dataDir: this.deps.dataDir,
        platform: this.deps.platform,
      }),
    });
    const spawn = this.deps.spawn ?? defaultSpawn;
    let child: ManagedChild;
    try {
      child = spawn(this.deps.execPath, [entry], {
        cwd: this.deps.runtimeRoot,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        detached: this.deps.platform !== "win32",
      });
    } catch {
      return this.fail(SUPERVISOR_START_FAILED_MESSAGE);
    }
    this.child = child;
    this.exited = new Promise((resolve) => {
      this.resolveExited = resolve;
    });
    child.stdout?.on("data", (chunk: Buffer | string) =>
      this.capture(chunk.toString(), token),
    );
    child.stderr?.on("data", (chunk: Buffer | string) =>
      this.capture(chunk.toString(), token),
    );
    child.once("error", () => this.onUnexpectedExit());
    child.once("exit", () => this.onUnexpectedExit());
    const healthy = await this.waitHealthy(url);
    if (!healthy) {
      await this.stopChild();
      return this.fail(SUPERVISOR_START_FAILED_MESSAGE);
    }
    this.activeConnection = { url: url.replace(/\/health$/, ""), token };
    this.setState({ phase: "ready", message: null, url: this.activeConnection.url });
    return this.current;
  }

  private async dockerDaemonReachable(): Promise<boolean> {
    if (this.deps.dockerBinary === null) return false;
    try {
      const result = await this.deps.runDocker(this.deps.dockerBinary, ["info", "--format", "{{.ServerVersion}}"], {
        cwd: this.deps.runtimeRoot,
        env: runtimeChildEnv(this.deps.platform, this.deps.env),
        timeoutMs: DOCKER_INFO_TIMEOUT_MS,
      });
      return result.code === 0;
    } catch {
      return false;
    }
  }

  private async waitHealthy(url: string): Promise<boolean> {
    const check = this.deps.checkHealth ?? defaultCheckHealth;
    const timeoutMs = this.deps.startupTimeoutMs ?? DOCKER_SUPERVISOR_START_TIMEOUT_MS;
    const intervalMs = this.deps.healthIntervalMs ?? DOCKER_SUPERVISOR_HEALTH_INTERVAL_MS;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.child === null) return false;
      try {
        if (await check(url)) return true;
      } catch {
        // Retry until the deadline; a refusing port is the normal cold path.
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
  }

  /** Stops managed computers without deleting them; volumes and data survive. */
  private async stopManagedContainers(): Promise<void> {
    const binary = this.deps.dockerBinary;
    if (binary === null) return;
    try {
      const listed = await this.deps.runDocker(
        binary,
        ["ps", "-q", "--filter", `label=${MANAGED_CONTAINER_LABEL}`],
        {
          cwd: this.deps.runtimeRoot,
          env: runtimeChildEnv(this.deps.platform, this.deps.env),
          timeoutMs: DOCKER_STOP_TIMEOUT_MS,
        },
      );
      const ids = listed.stdout.split(/\s+/).map((id) => id.trim()).filter(Boolean);
      if (ids.length === 0) return;
      // `stop` only: never `rm` — computer data must survive app shutdown.
      await this.deps.runDocker(binary, ["stop", "-t", "30", ...ids], {
        cwd: this.deps.runtimeRoot,
        env: runtimeChildEnv(this.deps.platform, this.deps.env),
        timeoutMs: DOCKER_STOP_TIMEOUT_MS,
      });
    } catch {
      // Shutdown is best-effort; a stuck daemon must not hang app quit.
    }
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (child === null) return;
    const exited = this.exited;
    this.exited = null;
    this.resolveExited = null;
    try {
      child.kill("SIGTERM");
    } catch {
      // Already exited.
    }
    const timeoutMs = this.deps.stopTimeoutMs ?? DOCKER_SUPERVISOR_STOP_TIMEOUT_MS;
    await Promise.race([
      exited ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    try {
      child.kill("SIGKILL");
    } catch {
      // Exited during the grace period.
    }
  }

  private onUnexpectedExit() {
    if (this.child === null) return;
    this.child = null;
    this.resolveExited?.();
    this.exited = null;
    this.resolveExited = null;
    this.activeConnection = null;
    if (this.current.phase === "starting" || this.current.phase === "ready") {
      this.setState({ phase: "failed", message: SUPERVISOR_START_FAILED_MESSAGE, url: null });
    }
  }

  private capture(chunk: string, token: string) {
    for (const raw of chunk.split("\n")) {
      const line = raw.trimEnd();
      if (line === "") continue;
      const redacted = redactRuntimeLogLine(line, [token]);
      const limit = this.deps.logLimit ?? DOCKER_SUPERVISOR_LOG_LINES;
      this.logLines = [...this.logLines, redacted].slice(-limit);
      this.deps.onOutput?.(redacted);
    }
  }

  private fail(message: string): DockerSupervisorState {
    this.setState({ phase: "failed", message, url: null });
    return this.current;
  }

  private setState(next: Partial<DockerSupervisorState>) {
    const merged: DockerSupervisorState = {
      phase: next.phase ?? this.current.phase,
      message: next.message !== undefined ? next.message : this.current.message,
      url: next.url !== undefined ? next.url : this.current.url,
    };
    if (
      merged.phase === this.current.phase &&
      merged.message === this.current.message &&
      merged.url === this.current.url
    ) {
      return;
    }
    this.current = merged;
    this.deps.onState?.(merged);
  }
}
