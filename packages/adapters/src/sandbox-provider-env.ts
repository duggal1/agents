import type { SandboxProviderOptions } from "./sandbox-factory.js";

/**
 * E2B first, Docker fallback. Empty or remote provider without a key becomes
 * none so services can boot for signup. An explicit `e2b` without a key falls
 * back to Docker (then through Docker's own gates) instead of failing closed.
 */
export function resolveSandboxProvider(source: NodeJS.ProcessEnv = process.env): string {
  const configured = source.SANDBOX_PROVIDER;
  if (configured !== undefined && !configured.trim()) return "none";
  let requested = configured?.trim();
  if (requested === "none") return "none";
  if (requested === undefined) {
    requested = optional(source.E2B_API_KEY) ? "e2b" : "docker";
  } else if (requested === "e2b" && !optional(source.E2B_API_KEY)) {
    requested = "docker";
  }
  if (requested === "daytona" && !optional(source.DAYTONA_API_KEY)) return "none";
  if (requested === "createos" && !optional(source.CREATEOS_SANDBOX_API_KEY)) return "none";
  if (requested === "box" && !optional(source.BOX_API_KEY)) return "none";
  // Production without a supervisor token cannot run Docker computers; boot as none instead of exiting.
  if (
    requested === "docker" &&
    source.NODE_ENV === "production" &&
    !optional(source.SANDBOX_SUPERVISOR_TOKEN)
  ) {
    return "none";
  }
  return requested;
}

/** Remote computer credentials for the adapter factory. */
export function sandboxProviderOptionsFromEnv(
  source: NodeJS.ProcessEnv = process.env,
): Pick<
  SandboxProviderOptions,
  | "e2bApiKey"
  | "daytonaApiKey"
  | "daytonaApiUrl"
  | "daytonaTarget"
  | "createosApiKey"
  | "createosBaseUrl"
  | "createosShape"
  | "createosRootfs"
  | "boxApiKey"
  | "boxApiUrl"
> {
  return {
    e2bApiKey: source.E2B_API_KEY,
    daytonaApiKey: source.DAYTONA_API_KEY,
    daytonaApiUrl: source.DAYTONA_API_URL,
    daytonaTarget: source.DAYTONA_TARGET,
    createosApiKey: source.CREATEOS_SANDBOX_API_KEY,
    createosBaseUrl: source.CREATEOS_SANDBOX_BASE_URL,
    createosShape: source.CREATEOS_SANDBOX_SHAPE,
    createosRootfs: source.CREATEOS_SANDBOX_ROOTFS,
    boxApiKey: source.BOX_API_KEY,
    boxApiUrl: source.BOX_API_URL ?? source.BOX_BASE_URL,
  };
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
