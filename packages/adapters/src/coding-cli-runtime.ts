import type {
  AdapterContext,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
} from "@sapphire/adapter-kit";
import { getLogger } from "@sapphire/logging";
import { type CodingCliProvider, isCodingCliProvider } from "./coding-cli-providers.js";
import { runCodingCliTurn } from "./coding-cli-turn.js";

export type CodingCliRuntimeOptions = {
  /** Pi/API runtime for every non-CLI provider. */
  delegate: AgentRuntime;
  /** Abort a CLI turn after this long. */
  turnTimeoutMs?: number;
  /** Environment for CLI detection and spawn. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Explicit CLI binaries. Defaults to PATH resolution. */
  commands?: Partial<Record<CodingCliProvider, string>>;
};

const HISTORY_TURNS = 8;

function historyBlock(history: AgentRunRequest["history"]): string {
  const turns = history.slice(-HISTORY_TURNS * 2);
  if (turns.length === 0) return "";
  const lines = turns.map((message) => {
    const role =
      message.role === "assistant" ? "Assistant" : message.role === "system" ? "System" : "User";
    return `${role}: ${message.content}`;
  });
  return `Conversation so far (oldest first):\n${lines.join("\n\n")}\n\n---\n\n`;
}

/**
 * Routes CLI-provider runs to headless coding agents on this machine and
 * delegates everything else to the configured API runtime. No executor
 * changes needed: routing keys off `request.model.provider`.
 */
export class CodingCliRuntime implements AgentRuntime {
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly options: CodingCliRuntimeOptions) {}

  describe() {
    return {
      id: "coding-cli",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { streaming: false, compaction: false, tools: false, scripted: false },
    };
  }

  async *run(
    request: AgentRunRequest,
    context?: Partial<AdapterContext>,
  ): AsyncIterable<AgentRuntimeEvent> {
    if (!isCodingCliProvider(request.model.provider)) {
      yield* this.options.delegate.run(request, context);
      return;
    }
    const controller = new AbortController();
    this.controllers.set(request.runId, controller);
    try {
      const prompt = `${request.instructions ? `${request.instructions}\n\n` : ""}${historyBlock(request.history)}${request.prompt}`;
      yield { type: "progress", text: "Running headless coding agent…" };
      const result = await runCodingCliTurn({
        provider: request.model.provider,
        prompt,
        model: request.model.id && request.model.id !== "default" ? request.model.id : undefined,
        timeoutMs: this.options.turnTimeoutMs,
        signal: controller.signal,
        env: this.options.env ?? process.env,
        commands: this.options.commands,
      });
      yield { type: "text", text: result.text };
    } catch (error) {
      getLogger().error("coding CLI turn failed", error, {
        "run.id": request.runId,
        "model.provider": request.model.provider,
      });
      throw error;
    } finally {
      this.controllers.delete(request.runId);
    }
  }

  async abort(runId: string): Promise<void> {
    this.controllers.get(runId)?.abort();
  }
}
