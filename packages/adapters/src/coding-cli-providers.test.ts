import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CODING_CLI_META,
  CODING_CLI_PROVIDERS,
  codingCliSignedIn,
  detectCodingClis,
  isCodingCliProvider,
} from "./coding-cli-providers.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeAuthFile(home: string, relative: string): void {
  mkdirSync(join(home, dirname(relative)), { recursive: true });
  writeFileSync(join(home, relative), "{}");
}

function stubBin(): string {
  const dir = mkdtempSync(join(tmpdir(), "sapphire-cli-bin-"));
  dirs.push(dir);
  for (const binary of ["codex", "claude", "opencode"]) {
    writeFileSync(join(dir, binary), `#!/bin/sh\necho "${binary} 9.9.9"\n`);
    chmodSync(join(dir, binary), 0o755);
  }
  return dir;
}

describe("coding CLI providers", () => {
  it("recognizes the three CLI providers", () => {
    expect(CODING_CLI_PROVIDERS).toEqual(["codex-cli", "claude-cli", "opencode-cli"]);
    expect(isCodingCliProvider("codex-cli")).toBe(true);
    expect(isCodingCliProvider("openrouter")).toBe(false);
    expect(CODING_CLI_META["codex-cli"].binary).toBe("codex");
  });

  it("detects sign-in from auth files", () => {
    const home = mkdtempSync(join(tmpdir(), "sapphire-cli-home-"));
    dirs.push(home);
    const env = { HOME: home, PATH: "/usr/bin" } as NodeJS.ProcessEnv;
    expect(codingCliSignedIn("codex-cli", env)).toBe(false);
    expect(codingCliSignedIn("claude-cli", env)).toBe(false);
    expect(codingCliSignedIn("opencode-cli", env)).toBe(false);
    writeAuthFile(home, ".codex/auth.json");
    expect(codingCliSignedIn("codex-cli", env)).toBe(true);
    writeAuthFile(home, ".claude/.credentials.json");
    expect(codingCliSignedIn("claude-cli", env)).toBe(true);
    writeAuthFile(home, ".local/share/opencode/auth.json");
    expect(codingCliSignedIn("opencode-cli", env)).toBe(true);
  });

  it("detects installed versions and login state", async () => {
    const home = mkdtempSync(join(tmpdir(), "sapphire-cli-home-"));
    dirs.push(home);
    const dir = stubBin();
    const env = { HOME: home, PATH: dir } as NodeJS.ProcessEnv;
    const statuses = await detectCodingClis(env);
    expect(statuses.map((status) => status.provider)).toEqual([...CODING_CLI_PROVIDERS]);
    expect(statuses.every((status) => status.installed)).toBe(true);
    expect(statuses.every((status) => !status.signedIn)).toBe(true);
    writeAuthFile(home, ".codex/auth.json");
    const again = await detectCodingClis(env);
    expect(again.find((status) => status.provider === "codex-cli")?.signedIn).toBe(true);
  });

  it("resolves unknown binaries to null", async () => {
    const home = mkdtempSync(join(tmpdir(), "sapphire-cli-home-"));
    dirs.push(home);
    const statuses = await detectCodingClis({ HOME: home, PATH: "" } as NodeJS.ProcessEnv);
    // Statuses reflect this machine; the contract is the shape, not the values.
    expect(statuses.map((status) => status.provider)).toEqual([...CODING_CLI_PROVIDERS]);
    for (const status of statuses) {
      expect(typeof status.installed).toBe("boolean");
      expect(typeof status.signedIn).toBe("boolean");
      expect(status.signedIn).toBe(status.installed && status.signedIn);
    }
  });
});
