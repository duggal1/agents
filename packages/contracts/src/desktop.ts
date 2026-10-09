/**
 * `unsupported` covers an unpackaged build and a repository with no published releases, which is
 * the normal state for a fork. It is not an error the user needs to act on. Automatic checks stay
 * frozen after an empty feed; a manual check may retry when the install itself supports updates.
 */
export type DesktopUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "unsupported"
  | "error";

export interface DesktopUpdateState {
  phase: DesktopUpdatePhase;
  /** The installed desktop release, which can drift from the server this app points at. */
  currentVersion: string;
  availableVersion: string | null;
  /** Download progress 0-100, only while `downloading`. */
  percent: number | null;
  message: string | null;
  checkedAt: string | null;
}

export interface RakazoDesktopUpdate {
  state: () => Promise<DesktopUpdateState>;
  check: () => Promise<DesktopUpdateState>;
  download: () => Promise<DesktopUpdateState>;
  /** Quits and relaunches into the downloaded release; only useful once `phase` is `ready`. */
  install: () => Promise<DesktopUpdateState>;
}

export interface RakazoDesktopOAuthCallback {
  code: string;
  state?: string;
}

export type { LocalRuntimeStatus } from "./local-runtime-settings.js";
import type { LocalRuntimeStatus } from "./local-runtime-settings.js";

/**
 * Local runtime posture for the packaged native backend (T5/T6). Every method
 * returns booleans or ok/error shapes — the E2B key itself never crosses IPC.
 */
export interface RakazoDesktopRuntime {
  status: () => Promise<LocalRuntimeStatus>;
  /** Stores (or replaces) the E2B key OS-encrypted in the main process. */
  setKey: (key: string) => Promise<{ ok: boolean; error?: string }>;
  clearKey: () => Promise<{ ok: boolean; error?: string }>;
  /** Persists the per-install Docker fallback toggle. */
  setFallbackAllowed: (allowed: boolean) => Promise<{ ok: boolean; error?: string }>;
}

export interface RakazoSetupRuntime {
  status: () => Promise<LocalRuntimeStatus>;
  /** First-run key entry for This computer; Existing instance never calls this. */
  setKey: (key: string) => Promise<{ ok: boolean; error?: string }>;
}

export interface RakazoDesktop {
  /** Only the isolated local settings window is authorized to call this bridge. */
  localSettings?: {
    request: (pathname: string, body: string) => Promise<{ status: number; body: string }>;
  };
  /** Present in the packaged desktop app; absent in browsers. */
  runtime?: RakazoDesktopRuntime;
  platform: string;
  window: {
    close: () => Promise<void>;
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    state: () => Promise<{ minimized: boolean; maximized: boolean; fullScreen: boolean }>;
  };
  update: RakazoDesktopUpdate;
  oauth: {
    /**
     * Open system-browser auth. A redirect_uri must be HTTP loopback with state;
     * URLs without a redirect use backend polling. Optional for older desktops.
     */
    open?: (authorizationUrl: string) => Promise<void>;
    cancel?: (authorizationUrl: string) => Promise<void>;
    /**
     * Authorization codes captured from the system browser or a legacy popup.
     * Returns an unsubscribe function.
     */
    onCallback: (listener: (callback: RakazoDesktopOAuthCallback) => void) => () => void;
  };
}

/**
 * How the desktop app was pointed at a Sapphire server during first-run setup.
 * `new` is the app-managed native local backend (PostgreSQL plus API and worker
 * processes supervised by Electron) on the same computer.
 */
export type DesktopInstanceMode = "new" | "existing";

export interface DesktopSetup {
  mode: DesktopInstanceMode;
  serverUrl: string;
}

export interface DesktopSetupState {
  defaultLocalUrl: string;
  saved: DesktopSetup | null;
  /** Present when a saved or newly selected server could not be reopened. */
  error?: string;
}

export interface DesktopReachability {
  ok: boolean;
  /** HTTP status when the server answered, absent when it could not be reached. */
  status?: number;
  /** Normalized URL that was probed, absent when the input was not a usable URL. */
  url?: string;
  error?: string;
}

export interface DesktopStackProbeResponse {
  ok: true;
  imageTag: string;
}

/**
 * Lifecycle of the legacy Docker Compose stack the desktop app used to manage for
 * mode `new`. Kept for the one-time data migration from Compose volumes; the live
 * local backend reports `DesktopLocalRuntimeState` instead.
 * `docker-missing` and `docker-not-running` wait for the person to act; `ready` and
 * `failed` are terminal until the next start.
 */
export type DesktopLocalStackPhase =
  | "idle"
  | "checking-docker"
  | "docker-missing"
  | "docker-not-running"
  | "preparing"
  | "pulling"
  | "starting"
  | "waiting-healthy"
  | "ready"
  | "failed";

export interface DesktopLocalStackState {
  phase: DesktopLocalStackPhase;
  /** One actionable sentence; null while the stack is progressing normally. */
  message: string | null;
  /** Bounded tail of docker output for the current attempt. */
  output: string[];
  /** Bytes pulled per image layer in the current attempt; the sum is the only progress Docker reports. */
  layerBytes: Record<string, number>;
  /** Image tag this app launches (`v<app version>` for installed builds, `edge` otherwise). */
  imageTag: string;
}

export type DesktopSetupLink = "docker-desktop" | "orbstack" | "docker-engine";

/**
 * Lifecycle of the app-managed native local backend for mode `new`: PostgreSQL,
 * then API, then worker, all bound to loopback. `failed` is terminal until the
 * next start; `degraded` keeps following until it recovers to `ready` or fails.
 */
export type DesktopLocalRuntimePhase =
  | "idle"
  | "starting-database"
  | "migrating"
  | "starting-api"
  | "starting-worker"
  | "ready"
  | "degraded"
  | "stopping"
  | "failed";

export interface DesktopLocalRuntimeState {
  phase: DesktopLocalRuntimePhase;
  /** One actionable sentence; null while the backend is progressing normally. */
  message: string | null;
  /** Bounded tail of redacted backend output for the current attempt. */
  output: string[];
  /** True when the last attempt ended in a migration failure the person may skip. */
  freshStartAvailable: boolean;
}

/** Options for starting the native local backend. Never paths, ports, or env. */
export interface DesktopLocalStartOptions {
  /** Skip the one-time Compose data migration and boot an empty profile instead. */
  fresh?: boolean;
}

/**
 * Bridge exposed only to the first-run setup window. The app window keeps the
 * narrower `rakazoDesktop` bridge so a connected server can never re-point the app.
 */
export interface RakazoSetup {
  /** Used only to reserve space for native window controls in the local setup UI. */
  platform: string;
  state: () => Promise<DesktopSetupState>;
  test: (url: string) => Promise<DesktopReachability>;
  save: (setup: DesktopSetup) => Promise<{ ok: boolean; error?: string }>;
  quit: () => Promise<void>;
  /**
   * Optional E2B key entry for the This-computer path. The Existing-instance
   * path never calls this; with no key, computers stay unavailable.
   */
  runtime: RakazoSetupRuntime;
  /**
   * The app-managed native local backend for mode `new`. Status, start, and stop
   * only: the renderer never supplies paths, ports, or environment. Optional
   * bot-computer credential fields are a follow-up and are not part of this bridge.
   */
  stack: {
    state: () => Promise<DesktopLocalRuntimeState>;
    /** Starts (or retries) the backend; a no-op while a start is already in flight. */
    start: (options?: DesktopLocalStartOptions) => Promise<DesktopLocalRuntimeState>;
    /** Stops backend services gracefully; safe to call at any phase. */
    stop: () => Promise<DesktopLocalRuntimeState>;
    /** Fires on every state change so progress never depends on a renderer timer. */
    onChange: (listener: (state: DesktopLocalRuntimeState) => void) => void;
  };
}
