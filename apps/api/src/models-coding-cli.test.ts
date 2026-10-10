import { RPCHandler } from "@orpc/server/fetch";
import type { Actor, RouterDeps } from "./router.js";
import { createRouter } from "./router.js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sapphire/adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sapphire/adapters")>();
  return {
    ...actual,
    detectCodingClis: vi.fn(async () => [
      {
        provider: "codex-cli",
        name: "Codex",
        installed: false,
        version: null,
        signedIn: false,
        loginHint: "Run `codex login` in a terminal, then reconnect.",
      },
      {
        provider: "claude-cli",
        name: "Claude Code",
        installed: true,
        version: "2.1.0",
        signedIn: false,
        loginHint: "Run `claude login` in a terminal, then reconnect.",
      },
      {
        provider: "opencode-cli",
        name: "OpenCode",
        installed: true,
        version: "1.0.0",
        signedIn: true,
        loginHint: "Run `opencode auth login` in a terminal, then reconnect.",
      },
    ]),
  };
});

const actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "user@rakazo.test",
  isDeploymentOwner: true,
} satisfies Actor;

function fixture() {
  const put = vi.fn().mockResolvedValue({ id: "secret-1", ciphertext: "cipher" });
  const userModelCredential = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation(async ({ data }: { data: { provider: string } }) => ({
      id: "cred-1",
      userId: actor.userId,
      provider: data.provider,
      label: data.provider,
      secretId: "secret-1",
      supportsImages: false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
  };
  const spaceModelPreference = {
    findFirst: vi.fn().mockResolvedValue(null),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    upsert: vi.fn().mockResolvedValue({ id: "preference" }),
  };
  const tx = {
    userModelCredential,
    secret: { create: vi.fn().mockResolvedValue({}) },
    spaceModelPreference,
  };
  const deps = {
    prisma: {
      userModelCredential,
      spaceModelPreference,
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    },
    secrets: { put },
    oauthLogins: {},
    env: {
      defaultProvider: "openrouter",
      defaultModel: "openai/gpt-5.6-luna",
      webOrigin: "http://127.0.0.1:5173",
      screenProxySecret: "fake-test-secret",
      sandboxProvider: "fake",
      agentRuntime: "pi",
    },
  } as unknown as RouterDeps;
  return { deps, put, handler: new RPCHandler(createRouter(deps)) };
}

async function call(
  handler: RPCHandler<never>,
  path: string,
  body: unknown,
): Promise<Response> {
  const { response } = await handler.handle(
    new Request(`http://127.0.0.1/rpc/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: body }),
    }),
    { prefix: "/rpc", context: { actor } },
  );
  return response;
}

describe("coding CLI models", () => {
  it("reports installed versions and login state", async () => {
    const { handler } = fixture();
    const response = await call(handler, "models/codingCliStatus", null);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { json: unknown };
    expect(body.json).toEqual([
      expect.objectContaining({ provider: "codex-cli", installed: false }),
      expect.objectContaining({ provider: "claude-cli", installed: true, signedIn: false }),
      expect.objectContaining({ provider: "opencode-cli", installed: true, signedIn: true }),
    ]);
  });

  it("refuses to persist a CLI that is not installed", async () => {
    const { put, handler } = fixture();
    const response = await call(handler, "models/connect", {
      provider: "codex-cli",
      modelId: "default",
    });
    expect(response.status).toBe(400);
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses to persist a CLI that is not signed in", async () => {
    const { put, handler } = fixture();
    const response = await call(handler, "models/connect", {
      provider: "claude-cli",
      modelId: "default",
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { json: { message?: string } };
    expect(body.json.message).toContain("claude login");
    expect(put).not.toHaveBeenCalled();
  });

  it("persists a keyless credential for a signed-in CLI", async () => {
    const { put, handler } = fixture();
    const response = await call(handler, "models/connect", {
      provider: "opencode-cli",
      modelId: "default",
    });
    expect(response.status).toBe(200);
    expect(put).toHaveBeenCalledWith(
      JSON.stringify({ kind: "cli" }),
      expect.objectContaining({ userId: actor.userId }),
    );
  });
});
