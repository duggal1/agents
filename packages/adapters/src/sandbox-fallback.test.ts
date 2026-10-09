import type { AdapterContext, ComputerRef, SandboxProvider } from "@sapphire/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { FakeSandboxProvider } from "./fake-sandbox.js";
import {
  FALLBACK_BROWSER_PROFILE_NOTICE,
  QuotaFallbackSandbox,
} from "./sandbox-fallback.js";

const context = {
  operationId: "test",
  traceId: "test",
  spaceId: "workspace-1",
  userId: "user-1",
  botId: "bot-1",
  signal: new AbortController().signal,
} satisfies AdapterContext;

function quotaError() {
  return Object.assign(new Error("402 Payment Required: out of credits"), { status: 402 });
}

/**
 * Deterministic pair: a real fake fallback plus a real fake primary whose
 * provision is scripted. The sandbox routes the "fake" kind to the fallback
 * and "e2b" to the primary.
 */
function pair(options?: { primaryFailure?: unknown; fallbackAllowed?: boolean }) {
  const primary = new FakeSandboxProvider() as unknown as SandboxProvider & {
    provision: ReturnType<typeof vi.fn>;
  };
  if (options?.primaryFailure !== undefined) {
    primary.provision = vi.fn().mockRejectedValue(options.primaryFailure);
  } else {
    const inner = primary.provision.bind(primary);
    primary.provision = vi.fn(async (request: { botId: string; homePath: string }) => {
      const ref = await inner(request, context);
      return { ...ref, kind: "e2b" as const, providerRef: `e2b-${request.botId}` };
    });
  }
  const fallback = new FakeSandboxProvider();
  const sandbox = new QuotaFallbackSandbox(primary, fallback, {
    primaryKind: "e2b",
    fallbackKind: "fake",
    fallbackAllowed: () => options?.fallbackAllowed ?? true,
  });
  return { primary, fallback, sandbox };
}

describe("quota fallback routing", () => {
  it("provisions new computers on the primary when it succeeds", async () => {
    const { primary, sandbox } = pair();
    const ref = await sandbox.provision({ botId: "bot-1", homePath: "/tmp/home" }, context);
    expect(ref.kind).toBe("e2b");
    expect(primary.provision).toHaveBeenCalledOnce();
  });

  it("falls back to Docker only on permanent quota failure", async () => {
    const { primary, fallback, sandbox } = pair({ primaryFailure: quotaError() });
    const provision = vi.spyOn(fallback, "provision");
    const ref = await sandbox.provision({ botId: "bot-1", homePath: "/tmp/home" }, context);
    expect(ref.kind).toBe("fake");
    expect(ref.fresh).toBe(true);
    expect(primary.provision).toHaveBeenCalledOnce();
    expect(provision).toHaveBeenCalledOnce();
    // The failed primary ref is never carried into the fallback provision.
    expect(provision.mock.calls[0]?.[0]).not.toHaveProperty("providerRef");
  });

  it.each([
    ["transient", Object.assign(new Error("sandbox timed out"), { status: 503 })],
    ["auth-config", Object.assign(new Error("invalid api key"), { status: 401 })],
    ["unknown", new Error("brand new SDK shape")],
  ])("does not fall back on %s failures", async (_kind, failure) => {
    const { sandbox, fallback } = pair({ primaryFailure: failure });
    const provision = vi.spyOn(fallback, "provision");
    await expect(
      sandbox.provision({ botId: "bot-1", homePath: "/tmp/home" }, context),
    ).rejects.toThrowError();
    expect(provision).not.toHaveBeenCalled();
  });

  it("stays on the primary error when fallback is disabled or Docker is missing", async () => {
    const { fallback, sandbox } = pair({ primaryFailure: quotaError(), fallbackAllowed: false });
    const provision = vi.spyOn(fallback, "provision");
    await expect(
      sandbox.provision({ botId: "bot-1", homePath: "/tmp/home" }, context),
    ).rejects.toThrow(/out of credits/);
    expect(provision).not.toHaveBeenCalled();
  });

  it("routes existing computers by persisted kind, including recovery ops", async () => {
    const { primary, fallback, sandbox } = pair();
    // Seed a fallback-kind computer through the real fake provider.
    const seeded = await fallback.provision({ botId: "bot-1", homePath: "/tmp/home" }, context);
    const dockerComputer: ComputerRef = { ...seeded, kind: "fake" };
    await sandbox.stop(dockerComputer, context);
    expect(primary.provision).not.toHaveBeenCalled();
    // Re-provisioning an existing fallback computer never touches the primary.
    const ref = await sandbox.provision(
      {
        botId: "bot-1",
        homePath: "/tmp/home",
        providerRef: seeded.providerRef,
        providerKind: "fake",
      },
      context,
    );
    expect(ref.kind).toBe("fake");
    expect(primary.provision).not.toHaveBeenCalled();
  });

  it("never replays a failed primary execute on the fallback", async () => {
    const primary = new FakeSandboxProvider();
    primary.execute = (async function* () {
      throw quotaError();
      yield { type: "exit", code: 0 };
    }) as SandboxProvider["execute"];
    const fallback = new FakeSandboxProvider();
    const execute = vi.spyOn(fallback, "execute");
    const sandbox = new QuotaFallbackSandbox(primary, fallback, {
      primaryKind: "e2b",
      fallbackKind: "fake",
      fallbackAllowed: () => true,
    });
    const computer: ComputerRef = {
      id: "e2b-1",
      botId: "bot-1",
      kind: "e2b",
      providerRef: "e2b-1",
    };
    await expect(async () => {
      for await (const _event of sandbox.execute(computer, { argv: ["echo", "hi"] }, context)) {
        // drain
      }
    }).rejects.toThrow(/out of credits/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("fails closed on unrouted kinds instead of guessing a provider", async () => {
    const { sandbox } = pair();
    const computer: ComputerRef = {
      id: "x-1",
      botId: "bot-1",
      kind: "daytona",
      providerRef: "x-1",
    };
    await expect(sandbox.stop(computer, context)).rejects.toThrow(/not routed/);
  });

  it("explains the clean browser profile", () => {
    expect(FALLBACK_BROWSER_PROFILE_NOTICE).toMatch(/clean browser profile/);
    expect(FALLBACK_BROWSER_PROFILE_NOTICE).toMatch(/fresh turn/);
  });
});
