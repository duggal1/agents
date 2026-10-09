import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCAL_RESOURCE_BUDGETS } from "./resource-budgets.js";

const desktopDir = path.resolve(import.meta.dirname, "..");
const checkScript = path.join(desktopDir, "scripts", "check-resource-budgets.mjs");

function runCheck(measurements: unknown): { status: number; output: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sapphire-budgets-"));
  const file = path.join(dir, "measurements.json");
  writeFileSync(file, JSON.stringify(measurements));
  try {
    const output = execFileSync(process.execPath, [checkScript, "--measurements", file], {
      encoding: "utf8",
    });
    return { status: 0, output };
  } catch (error) {
    const result = error as { status?: number; stdout?: string; stderr?: string; message?: string };
    return {
      status: result.status ?? 1,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.message ?? ""}`,
    };
  }
}

const within = {
  idle: [
    { process: "electron-main", rssBytes: 200 * 1024 * 1024 },
    { process: "electron-renderer", rssBytes: 300 * 1024 * 1024 },
    { process: "api", rssBytes: 350 * 1024 * 1024 },
    { process: "worker", rssBytes: 250 * 1024 * 1024 },
    { process: "postgres", rssBytes: 200 * 1024 * 1024 },
  ],
  activeWindowTotals: [2 * 1024 * 1024 * 1024],
};

describe("resource budget check", () => {
  it("uses the same locked budgets as the TypeScript contract", () => {
    expect(LOCAL_RESOURCE_BUDGETS.totalRssIdleBytes).toBe(1536 * 1024 * 1024);
    expect(LOCAL_RESOURCE_BUDGETS.totalRssActiveP95Bytes).toBe(2560 * 1024 * 1024);
  });

  it("passes a within-budget measurement", () => {
    const result = runCheck(within);
    expect(result.status).toBe(0);
    expect(result.output).toContain("Within budget.");
  });

  it("fails closed with the blocker on an idle miss", () => {
    const result = runCheck({
      idle: [{ process: "api", rssBytes: 2 * 1024 * 1024 * 1024 }],
      activeWindowTotals: [1024],
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("do not raise the budget");
  });

  it("fails closed with the blocker on an active p95 miss", () => {
    const result = runCheck({ ...within, activeWindowTotals: [3 * 1024 * 1024 * 1024] });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("do not raise the budget");
  });

  it("rejects malformed measurements instead of passing silently", () => {
    for (const bad of [{}, { idle: [], activeWindowTotals: [] }, { idle: [{ process: "nope" }] }]) {
      expect(runCheck(bad).status).not.toBe(0);
    }
  });
});
