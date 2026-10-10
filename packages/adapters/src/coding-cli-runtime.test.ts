import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRuntime, AgentRunRequest } from "@sapphire/adapter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { CodingCliRuntime } from "./coding-cli-runtime.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stubEnv(scripts: Record<string, string>): {
  env: NodeJS.ProcessEnv;
  bin: (name: string) => string;
} {
  const dir = mkdtempSync(join(tmpdir(), "sapphire-cli-rt-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  }
  const home = mkdtempSync(join(tmpdir(), "sapphire-cli-home-"));
  dirs.push(home);
  return { env: { HOME: home, PATH: dir } as NodeJS.ProcessEnv, bin: (name) => join(dir, name) };
}

function runRequest(provider: string): AgentRunRequest {
  return {
    botId: "bot-1",
    threadId: "thread-1",
    runId: `run-${provider}`,
    prompt: "Say hi",
    instructions: "",
    history: [],
    tools: [],
    model: { provider, id: "default" },
  };
}

describe("CodingCliRuntime", () => {
  it("delegates non-CLI providers untouched", async () => {
    const delegate: AgentRuntime = {
      describe: () => ({
        id: "fake",
        contractVersion: "1",
        adapterVersion: "0",
        capabilities: { streaming: true, compaction: false, tools: false, scripted: true },
      }),
      run: async function* () {
        yield { type: "text", text: "from delegate" };
      },
      abort: async () => undefined,
    };
    const runtime = new CodingCliRuntime({ delegate });
    const events = [];
    for await (const event of runtime.run(runRequest("openrouter"))) events.push(event);
    expect(events).toEqual([{ type: "text", text: "from delegate" }]);
  });

  it("routes CLI providers to headless turns", async () => {
    const { env, bin } = stubEnv({ opencode: 'echo "cli reply"' });
    const delegate: AgentRuntime = {
      describe: () => ({
        id: "fake",
        contractVersion: "1",
        adapterVersion: "0",
        capabilities: { streaming: true, compaction: false, tools: false, scripted: true },
      }),
      run: async function* () {
        yield { type: "text", text: "must not run" };
      },
      abort: async () => undefined,
    };
    const runtime = new CodingCliRuntime({
      delegate,
      env,
      commands: { "opencode-cli": bin("opencode") },
    });
    const events = [];
    for await (const event of runtime.run(runRequest("opencode-cli"))) events.push(event);
    expect(events).toEqual([
      { type: "progress", text: "Running headless coding agent…" },
      { type: "text", text: "cli reply" },
    ]);
  });

  it("forwards abort to the CLI turn", async () => {
    const { env, bin } = stubEnv({ opencode: "while :; do :; done" });
    const delegate: AgentRuntime = {
      describe: () => ({
        id: "fake",
        contractVersion: "1",
        adapterVersion: "0",
        capabilities: { streaming: true, compaction: false, tools: false, scripted: true },
      }),
      run: async function* () {},
      abort: async () => undefined,
    };
    const runtime = new CodingCliRuntime({
      delegate,
      env,
      commands: { "opencode-cli": bin("opencode") },
    });
    const runId = "run-abort-me";
    const pending = (async () => {
      const events = [];
      for await (const event of runtime.run({ ...runRequest("opencode-cli"), runId })) {
        events.push(event);
      }
      return events;
    })();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await runtime.abort(runId);
    await expect(pending).rejects.toThrow();
  });
});
