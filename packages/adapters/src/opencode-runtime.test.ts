import type { AgentRunRequest, AgentRuntimeEvent } from "@sapphire/adapter-kit";
import { describe, expect, it } from "vitest";
import {
  adaptOpencodeEvent,
  DEFAULT_OPENCODE_SERVER_URL,
  OpencodeRuntime,
  type OpencodeServerClient,
  type OpencodeServerEvent,
  opencodeRuntimeFromEnv,
} from "./opencode-runtime.js";

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    botId: "bot-1",
    threadId: "thread-1",
    runId: "run-1",
    prompt: "Summarize the inbox",
    instructions: "Be terse.",
    history: [{ role: "user", content: "Hello" }],
    tools: [],
    model: { provider: "anthropic", id: "claude-sonnet-4-5" },
    ...overrides,
  };
}

function fakeClient(events: OpencodeServerEvent[]): OpencodeServerClient & {
  calls: { created: number; prompted: number; aborted: string[] };
} {
  const calls = { created: 0, prompted: 0, aborted: [] as string[] };
  return {
    calls,
    async createSession() {
      calls.created += 1;
      return "session-1";
    },
    async promptSession() {
      calls.prompted += 1;
    },
    async abortSession(sessionID: string) {
      calls.aborted.push(sessionID);
    },
    async *subscribeEvents() {
      for (const event of events) yield event;
    },
  };
}

async function collect(
  runtime: OpencodeRuntime,
  req: AgentRunRequest,
): Promise<AgentRuntimeEvent[]> {
  const seen: AgentRuntimeEvent[] = [];
  for await (const event of runtime.run(req)) seen.push(event);
  return seen;
}

describe("OpencodeRuntime.describe", () => {
  it("advertises the opencode contract", () => {
    const runtime = new OpencodeRuntime({
      baseUrl: DEFAULT_OPENCODE_SERVER_URL,
      createClient: () => fakeClient([]),
    });
    expect(runtime.describe()).toMatchObject({ id: "opencode", contractVersion: "1" });
  });

  it("rejects an empty baseUrl", () => {
    expect(() => new OpencodeRuntime({ baseUrl: "  " })).toThrow(/baseUrl/);
  });
});

describe("OpencodeRuntime.run", () => {
  it("streams text, tool and ask events then ends on idle", async () => {
    const client = fakeClient([
      { type: "text", sessionID: "session-1", text: "Working on it" },
      {
        type: "tool",
        sessionID: "session-1",
        callID: "call-1",
        tool: "read",
        input: { path: "a" },
      },
      { type: "permission", sessionID: "session-1", permissionID: "perm-1", summary: "edit" },
      { type: "idle", sessionID: "session-1" },
    ]);
    const runtime = new OpencodeRuntime({
      baseUrl: DEFAULT_OPENCODE_SERVER_URL,
      createClient: () => client,
    });
    const events = await collect(runtime, request());
    expect(events).toEqual([
      { type: "text", text: "Working on it" },
      { type: "tool", name: "read", args: { path: "a" }, executionId: "call-1" },
      {
        type: "ask",
        text: "opencode requests approval: edit",
        detail: "perm-1",
        actions: [
          { id: "approve", label: "Allow" },
          { id: "deny", label: "Deny" },
        ],
      },
    ]);
    expect(client.calls).toMatchObject({ created: 1, prompted: 1 });
  });

  it("reuses one server session per thread", async () => {
    const client = fakeClient([{ type: "idle", sessionID: "session-1" }]);
    const runtime = new OpencodeRuntime({
      baseUrl: DEFAULT_OPENCODE_SERVER_URL,
      createClient: () => client,
    });
    await collect(runtime, request({ runId: "run-1" }));
    await collect(runtime, request({ runId: "run-2" }));
    expect(client.calls.created).toBe(1);
    expect(client.calls.prompted).toBe(2);
  });

  it("surfaces server errors as run failures", async () => {
    const client = fakeClient([{ type: "error", sessionID: "session-1", message: "boom" }]);
    const runtime = new OpencodeRuntime({
      baseUrl: DEFAULT_OPENCODE_SERVER_URL,
      createClient: () => client,
    });
    await expect(collect(runtime, request())).rejects.toThrow("boom");
  });

  it("aborts the mapped server session", async () => {
    const client = fakeClient([
      { type: "text", sessionID: "session-1", text: "started" },
      { type: "idle", sessionID: "session-1" },
    ]);
    const runtime = new OpencodeRuntime({
      baseUrl: DEFAULT_OPENCODE_SERVER_URL,
      createClient: () => client,
    });
    const run = runtime.run(request({ runId: "run-9" }));
    const iterator = run[Symbol.asyncIterator]();
    // Prime past the first event so the session mapping exists, then abort mid-flight.
    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "text" } });
    await runtime.abort("run-9");
    expect(client.calls.aborted).toEqual(["session-1"]);
    await iterator.next();
  });

  it("ignores abort for unknown runs", async () => {
    const client = fakeClient([]);
    const runtime = new OpencodeRuntime({
      baseUrl: DEFAULT_OPENCODE_SERVER_URL,
      createClient: () => client,
    });
    await expect(runtime.abort("missing")).resolves.toBeUndefined();
    expect(client.calls.aborted).toEqual([]);
  });
});

describe("adaptOpencodeEvent", () => {
  it("maps text deltas", () => {
    expect(
      adaptOpencodeEvent("message.part.updated", {
        part: { type: "text", sessionID: "s", text: "ignored-full" },
        delta: "hi",
      }),
    ).toEqual({ type: "text", sessionID: "s", text: "hi" });
  });

  it("maps completed tool parts with input", () => {
    expect(
      adaptOpencodeEvent("message.part.updated", {
        part: {
          type: "tool",
          sessionID: "s",
          callID: "c",
          tool: "bash",
          state: { status: "completed", input: { command: "ls" } },
        },
      }),
    ).toEqual({
      type: "tool",
      sessionID: "s",
      callID: "c",
      tool: "bash",
      input: { command: "ls" },
    });
  });

  it("drops tool parts without identity", () => {
    expect(adaptOpencodeEvent("message.part.updated", { part: { type: "tool" } })).toBeNull();
  });

  it("ignores unknown event types", () => {
    expect(adaptOpencodeEvent("file.edited", { sessionID: "s" })).toBeNull();
  });
});

describe("opencodeRuntimeFromEnv", () => {
  it("returns null unless opencode is selected", () => {
    expect(opencodeRuntimeFromEnv({})).toBeNull();
    expect(opencodeRuntimeFromEnv({ AGENT_RUNTIME: "pi" })).toBeNull();
  });

  it("builds a runtime with the default server url", () => {
    const runtime = opencodeRuntimeFromEnv({ AGENT_RUNTIME: "opencode" });
    expect(runtime).toBeInstanceOf(OpencodeRuntime);
    expect(runtime?.describe().id).toBe("opencode");
  });
});
