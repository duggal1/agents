import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseClaudeResult, runCodingCliTurn } from "./coding-cli-turn.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stubClis(scripts: Record<string, string>): {
  env: NodeJS.ProcessEnv;
  bin: (name: string) => string;
} {
  const dir = mkdtempSync(join(tmpdir(), "sapphire-cli-turn-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  }
  const home = mkdtempSync(join(tmpdir(), "sapphire-cli-home-"));
  dirs.push(home);
  return {
    env: { HOME: home, PATH: dir } as NodeJS.ProcessEnv,
    bin: (name: string) => join(dir, name),
  };
}

describe("parseClaudeResult", () => {
  it("prefers the result event over assistant text", () => {
    const stdout = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "draft " }] } }),
      "some progress line",
      JSON.stringify({ type: "result", subtype: "success", result: "final answer" }),
    ].join("\n");
    expect(parseClaudeResult(stdout)).toBe("final answer");
  });

  it("falls back to concatenated assistant text", () => {
    const stdout = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
    });
    expect(parseClaudeResult(stdout)).toBe("ab");
  });

  it("returns null when nothing parses", () => {
    expect(parseClaudeResult("progress only\n")).toBeNull();
  });
});

describe("runCodingCliTurn", () => {
  it("runs claude headlessly and parses the result event", async () => {
    const { env, bin } = stubClis({
      claude: `cat > /dev/null; echo '${JSON.stringify({ type: "result", result: "claude says hi" })}'`,
    });
    const result = await runCodingCliTurn({
      provider: "claude-cli",
      prompt: "hi",
      env,
      commands: { "claude-cli": bin("claude") },
    });
    expect(result).toEqual({ provider: "claude-cli", text: "claude says hi" });
  });

  it("reads codex output from the last-message file", async () => {
    const { env, bin } = stubClis({
      codex: [
        "out=''; prev='';",
        "for a in \"$@\"; do if [ \"$prev\" = \"-o\" ]; then out=\"$a\"; fi; prev=\"$a\"; done;",
        "cat > /dev/null;",
        "echo 'codex says hi' > \"$out\";",
        "echo '{\"type\":\"turn.completed\"}';",
      ].join("\n"),
    });
    const result = await runCodingCliTurn({
      provider: "codex-cli",
      prompt: "hi",
      env,
      commands: { "codex-cli": bin("codex") },
    });
    expect(result).toEqual({ provider: "codex-cli", text: "codex says hi" });
  });

  it("reads opencode default-format stdout", async () => {
    const { env, bin } = stubClis({ opencode: 'echo "opencode says hi"' });
    const result = await runCodingCliTurn({
      provider: "opencode-cli",
      prompt: "hi",
      env,
      commands: { "opencode-cli": bin("opencode") },
    });
    expect(result).toEqual({ provider: "opencode-cli", text: "opencode says hi" });
  });

  it("reports missing CLIs as setup problems", async () => {
    const home = mkdtempSync(join(tmpdir(), "sapphire-cli-home-"));
    dirs.push(home);
    await expect(
      runCodingCliTurn({
        provider: "codex-cli",
        prompt: "hi",
        env: { HOME: home, PATH: "" } as NodeJS.ProcessEnv,
        commands: { "codex-cli": join(home, "no-such-binary") },
      }),
    ).rejects.toThrow(/not installed/);
  });

  it("translates sign-in failures into login guidance", async () => {
    const { env, bin } = stubClis({ codex: 'echo "ChatGPT login is required" >&2; exit 1' });
    await expect(
      runCodingCliTurn({
        provider: "codex-cli",
        prompt: "hi",
        env,
        commands: { "codex-cli": bin("codex") },
      }),
    ).rejects.toThrow(/codex login/);
  });

  it("surfaces non-zero exits with stderr detail", async () => {
    const { env, bin } = stubClis({ opencode: 'echo "bad flags" >&2; exit 2' });
    await expect(
      runCodingCliTurn({
        provider: "opencode-cli",
        prompt: "hi",
        env,
        commands: { "opencode-cli": bin("opencode") },
      }),
    ).rejects.toThrow(/code 2.*bad flags/);
  });
});
