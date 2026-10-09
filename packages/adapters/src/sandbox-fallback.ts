import type {
  AdapterContext,
  CommandRequest,
  ComputerActionRequest,
  ComputerActionResult,
  ComputerFileEntry,
  ComputerInput,
  ComputerObservation,
  ComputerRef,
  ControlLeaseRef,
  PageBrowserCommand,
  PageBrowserResult,
  PortableFile,
  ProcessEvent,
  SandboxProvider,
  ScreenRequest,
  ScreenSession,
  SnapshotRef,
  TerminalRequest,
} from "@sapphire/adapter-kit";
import { isPermanentQuotaFailure } from "./provider-failure.js";

/**
 * Concise notice surfaced when Docker fallback starts with a clean browser
 * profile. Browser login state and provider-specific desktop state are
 * non-portable and never cross the E2B→Docker boundary.
 */
export const FALLBACK_BROWSER_PROFILE_NOTICE =
  "Docker fallback started with a clean browser profile. " +
  "Browser logins and provider desktop state did not carry over from E2B; " +
  "the interrupted turn was not retried — start a fresh turn.";

export interface QuotaFallbackPolicy {
  /** E2B-equivalent kind routed to the primary provider. */
  primaryKind: ComputerRef["kind"];
  /** Docker-equivalent kind routed to the fallback provider. */
  fallbackKind: ComputerRef["kind"];
  /**
   * True when Docker fallback is usable: the user opted in AND a Docker
   * daemon/supervisor is reachable. Missing Docker never blocks the backend;
   * it only disables this fallback.
   */
  fallbackAllowed: () => boolean | Promise<boolean>;
}

/**
 * Routes every computer operation by its persisted provider identity
 * (`computer.kind`), never by process environment.
 *
 * Provisioning tries the primary first. A failure classified as permanent
 * quota/credit exhaustion — and only that shape — provisions a fresh fallback
 * computer when the policy allows it. Auth/config failures, transient
 * network/rate-limit failures, and unknown failures always rethrow: the
 * backend stays healthy and the computer reports unavailable instead.
 *
 * Execution fence: `execute` (and every other operation) routes strictly by
 * the computer's persisted kind. A failed primary call is never replayed on
 * the fallback — the in-flight turn is interrupted and requires a fresh turn.
 * This wrapper never constructs or routes to the host `desktop` provider.
 */
export class QuotaFallbackSandbox implements SandboxProvider {
  readonly pageBrowser?: SandboxProvider["pageBrowser"];

  constructor(
    private readonly primary: SandboxProvider,
    private readonly fallback: SandboxProvider,
    private readonly policy: QuotaFallbackPolicy,
  ) {
    if (primary.pageBrowser || fallback.pageBrowser) {
      this.pageBrowser = async (
        computer: ComputerRef,
        request: PageBrowserCommand,
        context: AdapterContext,
      ): Promise<PageBrowserResult> => {
        const provider = this.route(computer);
        return provider.pageBrowser
          ? provider.pageBrowser(computer, request, context)
          : Promise.resolve({
              ok: false,
              uncertain: false,
              fallback: "computer_act",
              error: "Page browser is unavailable on this computer.",
            });
      };
    }
  }

  describe() {
    return this.primary.describe();
  }

  private route(computer: ComputerRef): SandboxProvider {
    if (computer.kind === this.policy.primaryKind) return this.primary;
    if (computer.kind === this.policy.fallbackKind) return this.fallback;
    throw new Error(
      `Computer provider "${computer.kind}" is not routed by this fallback pair ` +
        `(${this.policy.primaryKind} → ${this.policy.fallbackKind}).`,
    );
  }

  async provision(
    request: {
      botId: string;
      homePath: string;
      providerRef?: string;
      providerKind?: ComputerRef["kind"];
    },
    context: AdapterContext,
  ): Promise<ComputerRef> {
    // An existing fallback computer re-provisions on its own provider.
    if (request.providerKind === this.policy.fallbackKind) {
      return this.fallback.provision(request, context);
    }
    try {
      return await this.primary.provision(request, context);
    } catch (error) {
      if (!isPermanentQuotaFailure(error)) throw error;
      if (!(await this.policy.fallbackAllowed())) throw error;
      // Fresh fallback computer: never carry the failed primary providerRef,
      // and never replay whatever the primary rejected.
      const ref = await this.fallback.provision(
        { botId: request.botId, homePath: request.homePath },
        context,
      );
      return { ...ref, fresh: true };
    }
  }

  async prepare(computer: ComputerRef, context: AdapterContext): Promise<void> {
    return this.route(computer).prepare(computer, context);
  }

  execute(
    computer: ComputerRef,
    request: CommandRequest,
    context: AdapterContext,
  ): AsyncIterable<ProcessEvent> {
    return this.route(computer).execute(computer, request, context);
  }

  async inspectBackgroundWork(
    computer: ComputerRef,
    markerId: string,
    context: AdapterContext,
  ): Promise<"active" | "idle" | "unknown"> {
    const provider = this.route(computer);
    return provider.inspectBackgroundWork?.(computer, markerId, context) ?? Promise.resolve("unknown");
  }

  async connectScreen(
    computer: ComputerRef,
    request: ScreenRequest,
    context: AdapterContext,
  ): Promise<ScreenSession> {
    return this.route(computer).connectScreen(computer, request, context);
  }

  async connectTerminal(
    computer: ComputerRef,
    request: TerminalRequest,
    context: AdapterContext,
  ): Promise<{ url: string }> {
    const provider = this.route(computer);
    if (!provider.connectTerminal) {
      return Promise.reject(new Error("terminal is unavailable on this computer"));
    }
    return provider.connectTerminal(computer, request, context);
  }

  async setScreenControl(
    computer: ComputerRef,
    interactive: boolean,
    context: AdapterContext,
    controlToken?: string,
  ): Promise<void> {
    return (
      this.route(computer).setScreenControl?.(computer, interactive, context, controlToken) ??
      Promise.resolve()
    );
  }

  async sendInput(
    computer: ComputerRef,
    input: ComputerInput,
    lease: ControlLeaseRef,
    context: AdapterContext,
  ): Promise<void> {
    return this.route(computer).sendInput(computer, input, lease, context);
  }

  async observe(computer: ComputerRef, context: AdapterContext): Promise<ComputerObservation> {
    return this.route(computer).observe(computer, context);
  }

  async act(
    computer: ComputerRef,
    request: ComputerActionRequest,
    context: AdapterContext,
  ): Promise<ComputerActionResult> {
    return this.route(computer).act(computer, request, context);
  }

  async listFiles(
    computer: ComputerRef,
    path: string,
    context: AdapterContext,
  ): Promise<ComputerFileEntry[]> {
    return this.route(computer).listFiles(computer, path, context);
  }

  async readFile(
    computer: ComputerRef,
    path: string,
    context: AdapterContext,
    options?: { maxBytes?: number },
  ): Promise<Uint8Array> {
    return this.route(computer).readFile(computer, path, context, options);
  }

  async writeFile(computer: ComputerRef, file: PortableFile, context: AdapterContext): Promise<void> {
    return this.route(computer).writeFile(computer, file, context);
  }

  exportWorkspace(computer: ComputerRef, context: AdapterContext): AsyncIterable<PortableFile> {
    return this.route(computer).exportWorkspace(computer, context);
  }

  async importWorkspace(
    computer: ComputerRef,
    files: AsyncIterable<PortableFile>,
    context: AdapterContext,
  ): Promise<void> {
    return this.route(computer).importWorkspace(computer, files, context);
  }

  async snapshot(computer: ComputerRef, context: AdapterContext): Promise<SnapshotRef> {
    return this.route(computer).snapshot(computer, context);
  }

  async keepAlive(computer: ComputerRef): Promise<void> {
    return this.route(computer).keepAlive?.(computer) ?? Promise.resolve();
  }

  async releaseScreen(computer: ComputerRef, context: AdapterContext): Promise<void> {
    return this.route(computer).releaseScreen?.(computer, context) ?? Promise.resolve();
  }

  async stop(computer: ComputerRef, context: AdapterContext): Promise<void> {
    return this.route(computer).stop(computer, context);
  }

  async destroy(computer: ComputerRef, context: AdapterContext): Promise<void> {
    return this.route(computer).destroy(computer, context);
  }
}

/** Build the E2B-primary/Docker-fallback routing pair from factory options. */
export function createQuotaFallbackSandbox(
  primary: SandboxProvider,
  fallback: SandboxProvider,
  policy: QuotaFallbackPolicy,
): QuotaFallbackSandbox {
  return new QuotaFallbackSandbox(primary, fallback, policy);
}
