// Headless single-shot turns over agent CLIs, adapted from OpenMausBot's
// driver layer (server/drivers/claude.ts, codex.ts — Apache-2.0):
// Claude takes stream-json over stdin and settles with a `result` event,
// Codex runs `exec --json` with the final text captured via `-o`, OpenCode
// runs non-interactively with default-format stdout as the reply. Turns are
// stateless: Sapphire folds recent history into the prompt, so no session
// persistence is needed for correctness.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodingCliProvider } from "./coding-cli-providers.js";
import { CODING_CLI_META } from "./coding-cli-providers.js";
import {
  augmentedCliPath,
  describeCliSpawnFailure,
  killCliTree,
  resolveCliBinary,
  spawnCli,
} from "./coding-cli-spawn.js";

export type CodingCliTurnInput = {
  provider: CodingCliProvider;
  /** Full prompt with Sapphire-side history already folded in. */
  prompt: string;
  /** Working directory for the CLI. Defaults to an isolated temp dir. */
  cwd?: string;
  /** Model id override (e.g. `-m`); omit for the CLI's own default. */
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  /** Explicit binary paths (custom installs, tests). Defaults to PATH resolution. */
  commands?: Partial<Record<CodingCliProvider, string>>;
};

export type CodingCliTurnResult = {
  provider: CodingCliProvider;
  text: string;
};

const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;

/** Codex sign-in refusal, ported from OpenMausBot's codexSignInRefused. */
const CODEX_SIGN_IN_REFUSED =
  /workspace routing discovery unauthorized|access token could not be refreshed|authentication session could not be refreshed|ChatGPT login is required|auth data is not available|please (?:log out and )?sign in again/i;

function isSignInRefused(provider: CodingCliProvider, output: string): boolean {
  if (provider === "codex-cli") return CODEX_SIGN_IN_REFUSED.test(output);
  if (provider === "claude-cli")
    return /not logged in|no account|invalid (api key|x-api-key)|authentication failed|unauthorized|please run \/login|run `claude login`/i.test(
      output,
    );
  return /not authenticated|no auth|unauthorized|please (log in|authenticate)|opencode auth login/i.test(
    output,
  );
}

function turnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, PATH: augmentedCliPath(env) };
}

function claudeArgs(input: { model?: string }): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--input-format",
    "stream-json",
    "--verbose",
    // Headless turns cannot answer permission prompts; edits stay confined
    // to the run directory passed as cwd.
    "--permission-mode",
    "acceptEdits",
  ];
  if (input.model?.trim()) args.push("--model", input.model.trim());
  return args;
}

function claudeStdin(prompt: string): string {
  return `${JSON.stringify({ type: "user", message: { role: "user", content: prompt } })}\n`;
}

export function parseClaudeResult(stdout: string): string | null {
  let fallback = "";
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed) as {
        type?: unknown;
        result?: unknown;
        message?: { content?: Array<{ type?: unknown; text?: unknown }> };
      };
      if (event.type === "result" && typeof event.result === "string") return event.result;
      if (event.type === "assistant" && Array.isArray(event.message?.content)) {
        for (const block of event.message.content) {
          if (block?.type === "text" && typeof block.text === "string") fallback += block.text;
        }
      }
    } catch {
      // Progress lines are not JSON; ignore them.
    }
  }
  return fallback || null;
}

function codexArgs(input: { cwd: string; outFile: string; model?: string }): string[] {
  const args = [
    "exec",
    "-C",
    input.cwd,
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--json",
    "-o",
    input.outFile,
  ];
  if (input.model?.trim()) args.push("-m", input.model.trim());
  // Prompt travels over stdin (`-`); never argv.
  args.push("-");
  return args;
}

function opencodeArgs(input: { model?: string; prompt: string }): string[] {
  const args = ["run", "--format", "default"];
  if (input.model?.trim()) args.push("-m", input.model.trim());
  // Opencode reads the message positionally; keep it out of files. Prompts
  // are user text, not secrets, but argv leaks into process listings.
  args.push(input.prompt);
  return args;
}

function readOutFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export async function runCodingCliTurn(input: CodingCliTurnInput): Promise<CodingCliTurnResult> {
  const meta = CODING_CLI_META[input.provider];
  const env = turnEnv(input.env ?? process.env);
  const binary = input.commands?.[input.provider] ?? resolveCliBinary(meta.binary, env);
  if (!binary) throw new Error(describeCliSpawnFailure({ code: "ENOENT" } as never, meta.binary));
  const timeoutMs = input.timeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  const cwd = input.cwd ?? mkdtempSync(join(tmpdir(), "sapphire-cli-turn-"));
  const outFile = input.provider === "codex-cli" ? join(cwd, "last-message.txt") : "";
  const args =
    input.provider === "claude-cli"
      ? claudeArgs({ model: input.model })
      : input.provider === "codex-cli"
        ? codexArgs({ cwd, outFile, model: input.model })
        : opencodeArgs({ model: input.model, prompt: input.prompt });

  let child: ReturnType<typeof spawnCli>["child"];
  try {
    ({ child } = spawnCli(binary, args, { cwd, env }));
  } catch (error) {
    throw new Error(describeCliSpawnFailure(error, meta.binary));
  }

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let spawnError: unknown;
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  if (input.signal?.aborted) {
    await killCliTree(child);
    throw input.signal.reason instanceof Error ? input.signal.reason : new Error("Aborted");
  }
  const onAbort = () => {
    void killCliTree(child);
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });

  const timer = setTimeout(() => {
    void killCliTree(child);
  }, timeoutMs);

  try {
    if (input.provider === "claude-cli") {
      child.stdin.write(claudeStdin(input.prompt));
    } else if (input.provider === "codex-cli") {
      child.stdin.write(input.prompt);
    }
    // Opencode takes the message positionally; nothing on stdin.
    child.stdin.end();

    const exitCode: number | null = await new Promise((resolve) => {
      child.on("error", (error) => {
        spawnError = error;
        resolve(null);
      });
      child.on("close", (code) => resolve(code));
    });

    if (spawnError) throw new Error(describeCliSpawnFailure(spawnError, meta.binary));

    const stdout = Buffer.concat(stdoutChunks).toString("utf8");
    const stderr = Buffer.concat(stderrChunks).toString("utf8");
    const combined = `${stdout}\n${stderr}`;

    if (isSignInRefused(input.provider, combined)) {
      throw new Error(`${meta.name} sign-in is missing or expired. ${meta.loginHint}`);
    }
    if (exitCode !== 0) {
      const detail = (stderr || stdout).trim().slice(-500);
      throw new Error(
        `${meta.name} exited with code ${exitCode ?? "unknown"}${detail ? `: ${detail}` : ""}`,
      );
    }

    const text =
      input.provider === "claude-cli"
        ? (parseClaudeResult(stdout) ?? stdout.trim())
        : input.provider === "codex-cli"
          ? readOutFile(outFile).trim() || stdout.trim()
          : stdout.trim();
    if (!text) throw new Error(`${meta.name} returned an empty reply.`);
    return { provider: input.provider, text };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", onAbort);
    await killCliTree(child).catch(() => undefined);
    if (!input.cwd) rmSync(cwd, { recursive: true, force: true });
  }
}
