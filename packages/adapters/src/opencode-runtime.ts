import type { OpencodeClient } from "@opencode-ai/sdk";
import { createOpencodeClient } from "@opencode-ai/sdk";
import type {
  AdapterContext,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
} from "@rakazo/adapter-kit";

/** Default `opencode serve` address. Override with OPENCODE_SERVER_URL. */
export const DEFAULT_OPENCODE_SERVER_URL = "http://127.0.0.1:4096";

export interface OpencodeRuntimeModel {
  providerID: string;
  modelID: string;
}

/** Minimal server-event view the runtime consumes. Real SDK events adapt into this. */
export type OpencodeServerEvent =
  | { type: "text"; sessionID: string; text: string }
  | {
      type: "tool";
      sessionID: string;
      callID: string;
      tool: string;
      input: Record<string, unknown>;
    }
  | { type: "permission"; sessionID: string; permissionID: string; summary: string }
  | { type: "idle"; sessionID: string }
  | { type: "error"; sessionID: string; message: string };

/** Narrow seam over the opencode server. Tests inject a fake; production adapts the SDK. */
export interface OpencodeServerClient {
  createSession(directory: string | undefined, title: string): Promise<string>;
  promptSession(
    sessionID: string,
    input: {
      text: string;
      model?: OpencodeRuntimeModel;
      agent?: string;
    },
  ): Promise<void>;
  abortSession(sessionID: string): Promise<void>;
  subscribeEvents(signal: AbortSignal): AsyncIterable<OpencodeServerEvent>;
}

export interface OpencodeRuntimeOptions {
  baseUrl: string;
  /** Working directory for opencode sessions. Defaults to the current directory. */
  directory?: string;
  /** opencode agent name (e.g. "build"). Omit for the server default. */
  agent?: string;
  /** Model override. Omit and the server default applies. */
  model?: OpencodeRuntimeModel;
  createClient?: (baseUrl: string) => OpencodeServerClient;
}

function readInput(state: unknown): Record<string, unknown> {
  if (typeof state !== "object" || state === null) return {};
  const input = (state as { input?: unknown }).input;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Adapt the real SDK client to the narrow seam. */
export function createOpencodeServerClient(baseUrl: string): OpencodeServerClient {
  const client: OpencodeClient = createOpencodeClient({ baseUrl });
  return {
    async createSession(directory: string | undefined, title: string): Promise<string> {
      const result = await client.session.create({
        query: directory ? { directory } : undefined,
        body: { title },
      });
      if (result.error) throw new Error(describeError(result.error));
      const id = (result.data as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || !id)
        throw new Error("opencode created a session without an id");
      return id;
    },
    async promptSession(sessionID: string, input): Promise<void> {
      const result = await client.session.promptAsync({
        path: { id: sessionID },
        body: {
          agent: input.agent,
          model: input.model,
          parts: [{ type: "text", text: input.text }],
        },
      });
      if (result.error) throw new Error(describeError(result.error));
    },
    async abortSession(sessionID: string): Promise<void> {
      const result = await client.session.abort({ path: { id: sessionID } });
      if (result.error) throw new Error(describeError(result.error));
    },
    async *subscribeEvents(signal: AbortSignal): AsyncIterable<OpencodeServerEvent> {
      const { stream } = await client.global.event();
      try {
        for await (const item of stream as AsyncIterable<unknown>) {
          if (signal.aborted) return;
          const payload = readEnvelope(item);
          if (!payload) continue;
          const event = adaptEvent(payload.type, payload.properties);
          if (event) yield event;
        }
      } finally {
        await stream.return?.(undefined).catch(() => {
          // Teardown is best-effort; the run already ended.
        });
      }
    },
  };
}

function describeError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const data = (error as { data?: { message?: unknown } }).data;
    if (typeof data?.message === "string" && data.message) return `opencode: ${data.message}`;
  }
  return "opencode request failed";
}

/** Global event envelopes carry the payload; bare payloads pass through. */
function readEnvelope(item: unknown): { type: string; properties: Record<string, unknown> } | null {
  if (typeof item !== "object" || item === null) return null;
  const record = item as Record<string, unknown>;
  const payload =
    typeof record.payload === "object" && record.payload !== null
      ? (record.payload as Record<string, unknown>)
      : record;
  if (typeof payload.type !== "string") return null;
  const properties =
    typeof payload.properties === "object" && payload.properties !== null
      ? (payload.properties as Record<string, unknown>)
      : {};
  return { type: payload.type, properties };
}

/** Map one opencode server event onto the narrow seam. Unknown types are ignored. */
export function adaptOpencodeEvent(
  type: string,
  properties: Record<string, unknown>,
): OpencodeServerEvent | null {
  switch (type) {
    case "message.part.updated": {
      const part = properties.part as { type?: unknown } | undefined;
      if (part?.type === "text") {
        const sessionID = readSession(properties.part);
        const text = readText((properties.delta as unknown) ?? readPartText(properties.part));
        if (sessionID && text) return { type: "text", sessionID, text };
        return null;
      }
      if (part?.type === "tool") {
        const sessionID = readSession(properties.part);
        const callID = readText((properties.part as { callID?: unknown }).callID);
        const tool = readText((properties.part as { tool?: unknown }).tool);
        if (sessionID && callID && tool) {
          return {
            type: "tool",
            sessionID,
            callID,
            tool,
            input: readInput((properties.part as { state?: unknown }).state),
          };
        }
      }
      return null;
    }
    case "permission.updated": {
      const sessionID = readText(properties.sessionID);
      const permissionID = readText(properties.id);
      if (!sessionID || !permissionID) return null;
      const pattern = properties.pattern;
      const summary = typeof pattern === "string" ? pattern : (readText(properties.type) ?? "tool");
      return { type: "permission", sessionID, permissionID, summary };
    }
    case "session.idle": {
      const sessionID = readText(properties.sessionID);
      return sessionID ? { type: "idle", sessionID } : null;
    }
    case "session.error": {
      const sessionID = readText(properties.sessionID);
      const message = readText(properties.message) ?? "opencode session failed";
      return sessionID ? { type: "error", sessionID, message } : null;
    }
    default:
      return null;
  }
}

function adaptEvent(type: string, properties: Record<string, unknown>): OpencodeServerEvent | null {
  return adaptOpencodeEvent(type, properties);
}

function readSession(part: unknown): string | null {
  if (typeof part !== "object" || part === null) return null;
  return readText((part as { sessionID?: unknown }).sessionID);
}

function readPartText(part: unknown): unknown {
  if (typeof part !== "object" || part === null) return null;
  return (part as { text?: unknown }).text;
}

function composePrompt(request: AgentRunRequest): string {
  const transcript = request.history
    .map(
      (turn) =>
        `${turn.role === "assistant" ? "Assistant" : turn.role === "system" ? "System" : "User"}: ${turn.content}`,
    )
    .join("\n");
  const sections = [request.instructions.trim(), transcript.trim(), request.prompt.trim()].filter(
    (section) => section.length > 0,
  );
  return sections.join("\n\n");
}

function resolveDirectory(options: OpencodeRuntimeOptions): string | undefined {
  return options.directory;
}

export class OpencodeRuntime implements AgentRuntime {
  private readonly options: OpencodeRuntimeOptions;
  private readonly sessions = new Map<string, string>();
  private readonly threads = new Map<string, string>();

  constructor(options: OpencodeRuntimeOptions) {
    const baseUrl = options.baseUrl?.trim();
    if (!baseUrl) throw new Error("OpencodeRuntime requires a server baseUrl");
    this.options = { ...options, baseUrl };
  }

  describe() {
    return {
      id: "opencode",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { streaming: true, compaction: true, tools: true, scripted: false },
    };
  }

  async abort(runId: string): Promise<void> {
    const sessionID = this.sessions.get(runId);
    if (!sessionID) return;
    this.sessions.delete(runId);
    await this.client()
      .abortSession(sessionID)
      .catch(() => {
        // Aborting a finished or missing session is not a failure.
      });
  }

  run(
    request: AgentRunRequest,
    context?: Partial<AdapterContext>,
  ): AsyncIterableIterator<AgentRuntimeEvent> {
    const controller = new AbortController();
    const events = this.runEvents(request, controller, context);
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => events.next(),
      return: () => {
        controller.abort();
        return events.return();
      },
      throw: (error) => {
        controller.abort();
        return events.throw(error);
      },
    };
  }

  private client(): OpencodeServerClient {
    return (this.options.createClient ?? createOpencodeServerClient)(this.options.baseUrl);
  }

  private async *runEvents(
    request: AgentRunRequest,
    controller: AbortController,
    context?: Partial<AdapterContext>,
  ): AsyncGenerator<AgentRuntimeEvent, void> {
    const signal = context?.signal
      ? AbortSignal.any([controller.signal, context.signal])
      : controller.signal;
    const server = this.client();
    const sessionID = await this.sessionFor(server, request);
    this.sessions.set(request.runId, sessionID);
    try {
      // Subscribe before prompting so no server event is missed.
      const stream = server.subscribeEvents(signal);
      await server.promptSession(sessionID, {
        text: composePrompt(request),
        model: this.options.model,
        agent: this.options.agent,
      });
      for await (const event of stream) {
        if (signal.aborted) return;
        if (event.sessionID !== sessionID) continue;
        switch (event.type) {
          case "text":
            yield { type: "text", text: event.text };
            break;
          case "tool":
            yield { type: "tool", name: event.tool, args: event.input, executionId: event.callID };
            break;
          case "permission":
            yield {
              type: "ask",
              text: `opencode requests approval: ${event.summary}`,
              detail: event.permissionID,
              actions: [
                { id: "approve", label: "Allow" },
                { id: "deny", label: "Deny" },
              ],
            };
            break;
          case "error":
            throw new Error(event.message);
          case "idle":
            return;
        }
      }
    } finally {
      this.sessions.delete(request.runId);
      controller.abort();
    }
  }

  private async sessionFor(
    server: OpencodeServerClient,
    request: AgentRunRequest,
  ): Promise<string> {
    const existing = this.threads.get(request.threadId);
    if (existing) return existing;
    const created = await server.createSession(
      resolveDirectory(this.options),
      `bot ${request.botId} thread ${request.threadId}`,
    );
    this.threads.set(request.threadId, created);
    return created;
  }
}

/** Build an opencode runtime from environment. Returns null when not selected. */
export function opencodeRuntimeFromEnv(
  source: NodeJS.ProcessEnv = process.env,
): OpencodeRuntime | null {
  if ((source.AGENT_RUNTIME ?? "").trim() !== "opencode") return null;
  const baseUrl = (source.OPENCODE_SERVER_URL ?? "").trim() || DEFAULT_OPENCODE_SERVER_URL;
  return new OpencodeRuntime({
    baseUrl,
    directory: source.OPENCODE_DIRECTORY?.trim() || undefined,
    agent: source.OPENCODE_AGENT?.trim() || undefined,
  });
}
