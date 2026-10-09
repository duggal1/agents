import type { ComputerRef, SandboxProvider } from "@sapphire/adapter-kit";
import { BoxSandboxEmulator } from "./box-emulator.js";
import { BoxSandboxProvider } from "./box-sandbox.js";
import { CreateOSSandboxProvider } from "./createos-sandbox.js";
import { DaytonaSandboxEmulator } from "./daytona-emulator.js";
import { DaytonaSandboxProvider } from "./daytona-sandbox.js";
import { DesktopSandboxProvider } from "./desktop-sandbox.js";
import { DockerSandboxProvider } from "./docker-sandbox.js";
import { ManagedSandboxEmulator } from "./e2b-emulator.js";
import { E2BSandboxProvider } from "./e2b-sandbox.js";
import { FakeSandboxProvider } from "./fake-sandbox.js";
import { NoneSandboxProvider } from "./none-sandbox.js";
import {
  QuotaFallbackSandbox,
  type QuotaFallbackPolicy,
} from "./sandbox-fallback.js";

export interface SandboxProviderOptions {
  supervisorUrl?: string;
  supervisorToken?: string;
  e2bApiKey?: string;
  daytonaApiKey?: string;
  daytonaApiUrl?: string;
  daytonaTarget?: string;
  createosApiKey?: string;
  createosBaseUrl?: string;
  createosShape?: string;
  createosRootfs?: string;
  boxApiKey?: string;
  boxApiUrl?: string;
  dataDir?: string;
}

function missingRemoteKey(
  provider: "e2b" | "daytona" | "createos" | "box",
  envName: string,
): SandboxProvider {
  return new NoneSandboxProvider(
    `Computers unavailable: ${envName} is required for SANDBOX_PROVIDER=${provider}.`,
  );
}

export function createSandboxProvider(kind: string, opts: SandboxProviderOptions): SandboxProvider {
  switch (kind) {
    case "none":
    case "":
      return new NoneSandboxProvider();
    case "e2b":
      if (!opts.e2bApiKey?.trim()) return missingRemoteKey("e2b", "E2B_API_KEY");
      return new E2BSandboxProvider(opts.e2bApiKey);
    case "daytona":
      if (!opts.daytonaApiKey?.trim()) return missingRemoteKey("daytona", "DAYTONA_API_KEY");
      return new DaytonaSandboxProvider({
        apiKey: opts.daytonaApiKey,
        apiUrl: opts.daytonaApiUrl,
        target: opts.daytonaTarget,
      });
    case "createos":
      if (!opts.createosApiKey?.trim())
        return missingRemoteKey("createos", "CREATEOS_SANDBOX_API_KEY");
      return new CreateOSSandboxProvider({
        apiKey: opts.createosApiKey,
        baseUrl: opts.createosBaseUrl,
        shape: opts.createosShape,
        rootfs: opts.createosRootfs,
      });
    case "box":
      if (!opts.boxApiKey?.trim()) return missingRemoteKey("box", "BOX_API_KEY");
      return new BoxSandboxProvider({ apiKey: opts.boxApiKey, apiUrl: opts.boxApiUrl });
    case "docker":
      return new DockerSandboxProvider(
        opts.supervisorUrl ?? "http://127.0.0.1:7091",
        opts.supervisorToken,
      );
    case "e2b-emulator":
      return new ManagedSandboxEmulator();
    case "daytona-emulator":
      return new DaytonaSandboxEmulator();
    case "box-emulator":
      return new BoxSandboxEmulator();
    case "desktop":
      return new DesktopSandboxProvider({
        root: opts.dataDir,
      });
    case "fake":
      return new FakeSandboxProvider();
    default:
      throw new Error(
        `Unknown SANDBOX_PROVIDER "${kind}". Use none | docker | e2b | daytona | createos | box | e2b-emulator | daytona-emulator | box-emulator | desktop | fake.`,
      );
  }
}

/**
 * Build the E2B-primary/Docker-fallback routing pair for local macOS mode.
 * The primary is E2B when its key is present, otherwise a closed `none`
 * provider so the backend boots healthy with computers unavailable. The
 * fallback is Docker when its supervisor is configured, otherwise `none`.
 * Never constructs the host `desktop` provider: there is no host-execution
 * fallback. Only a classified permanent quota failure moves provisioning to
 * Docker, gated by `policy.fallbackAllowed` (user opt-in + daemon reachable).
 */
export function createE2BFallbackSandbox(
  opts: SandboxProviderOptions,
  policy: Pick<QuotaFallbackPolicy, "fallbackAllowed"> & {
    primaryKind?: ComputerRef["kind"];
    fallbackKind?: ComputerRef["kind"];
  },
): QuotaFallbackSandbox {
  const primaryKind = policy.primaryKind ?? "e2b";
  const fallbackKind = policy.fallbackKind ?? "docker";
  if (primaryKind === "desktop" || fallbackKind === "desktop") {
    throw new Error("Computer fallback must never route to the host desktop provider");
  }
  const primary = opts.e2bApiKey?.trim()
    ? createSandboxProvider("e2b", opts)
    : new NoneSandboxProvider(
        "Computers unavailable: E2B_API_KEY is not configured. Add E2B credits or enable Docker computer fallback.",
      );
  const fallback =
    opts.supervisorUrl || opts.supervisorToken
      ? createSandboxProvider("docker", opts)
      : new NoneSandboxProvider(
          "Computers unavailable: Docker fallback is not configured. Add E2B credits or enable Docker computer fallback.",
        );
  return new QuotaFallbackSandbox(primary, fallback, {
    primaryKind,
    fallbackKind,
    fallbackAllowed: policy.fallbackAllowed,
  });
}
