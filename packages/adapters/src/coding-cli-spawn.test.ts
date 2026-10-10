import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  augmentedCliPath,
  describeCliSpawnFailure,
  execCli,
  killCliTree,
  resolveCliBinary,
  spawnCli,
} from "./coding-cli-spawn.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stubBin(scripts: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sapphire-cli-stub-"));
  dirs.push(dir);
  for (const [name, body] of Object.entries(scripts)) {
    const file = join(dir, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    chmodSync(file, 0o755);
  }
  return dir;
}

describe("coding CLI spawn", () => {
  it("augments PATH with installer locations", () => {
    const home = mkdtempSync(join(tmpdir(), "sapphire-cli-home-"));
    dirs.push(home);
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    const path = augmentedCliPath({ HOME: home, PATH: "/usr/bin" } as NodeJS.ProcessEnv);
    expect(path).toContain(join(home, ".local", "bin"));
    expect(path).toContain("/usr/bin");
  });

  it("resolves stub binaries off the augmented PATH", () => {
    const dir = stubBin({ "fake-cli": 'echo "fake-cli 1.2.3"' });
    const found = resolveCliBinary("fake-cli", { PATH: dir } as NodeJS.ProcessEnv);
    expect(found).toBe(join(dir, "fake-cli"));
    expect(
      resolveCliBinary("definitely-not-a-real-binary-xyz", {
        PATH: dir,
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it("executes probes and reports versions", async () => {
    const dir = stubBin({ "fake-cli": 'echo "fake-cli 1.2.3"' });
    const binary = resolveCliBinary("fake-cli", { PATH: dir } as NodeJS.ProcessEnv)!;
    await expect(execCli(binary, ["--version"], {})).resolves.toBe("fake-cli 1.2.3");
  });

  it("words spawn failures as setup problems", () => {
    expect(describeCliSpawnFailure({ code: "ENOENT" } as never, "codex")).toContain(
      "not installed",
    );
    expect(describeCliSpawnFailure(new Error("boom"), "codex")).toBe("boom");
  });

  it("reaps a spawned tree", async () => {
    const { child } = spawnCli(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {});
    await expect(killCliTree(child, 1_000)).resolves.toBe(true);
  });
});
