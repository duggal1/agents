import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_MACOS_ARCHITECTURES,
  DESKTOP_MINIMUM_MACOS,
} from "./local-runtime.js";
import { LOCAL_RESOURCE_BUDGETS } from "./resource-budgets.js";

const desktopDir = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(desktopDir, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
  build: {
    mac: { target: string[]; notarize: boolean };
    extraResources: Array<{ from: string; to: string }>;
  };
};

/**
 * macOS local-mode installer contract (T9): native PostgreSQL (both Mac
 * architectures) plus the API/worker runtime ship inside the installer;
 * Compose stack assets do not. The universal target and macOS 13.0 minimum
 * are pinned here and verified against the release workflow.
 */
describe("native macOS packaging", () => {
  it("ships the native runtime and both PostgreSQL architectures", () => {
    const destinations = packageJson.build.extraResources.map((entry) => entry.to);
    expect(destinations).toContain("runtime");
    expect(destinations).toContain("web");
  });

  it("excludes Compose stack assets from the local-mode installer", () => {
    const sources = packageJson.build.extraResources.map((entry) => entry.from);
    expect(sources).not.toContain("../../infra/compose/docker-compose.images.yml");
    expect(sources).not.toContain("../../infra/compose/.env.images.example");
    expect(
      packageJson.build.extraResources.some((entry) => entry.to.startsWith("stack/")),
    ).toBe(false);
  });

  it("builds the runtime before every artifact-producing pack script", () => {
    for (const script of ["pack", "pack:dir", "release"]) {
      expect(packageJson.scripts[script]).toContain("runtime:build");
      const buildIndex = (packageJson.scripts[script] as string).indexOf("runtime:build");
      const builderIndex = (packageJson.scripts[script] as string).indexOf("electron-builder");
      expect(buildIndex).toBeGreaterThan(-1);
      expect(builderIndex).toBeGreaterThan(buildIndex);
    }
  });

  it("keeps the universal target with notarization on dmg+zip", () => {
    expect(packageJson.build.mac.target).toEqual(["dmg", "zip"]);
    expect(packageJson.build.mac.notarize).toBe(true);
  });

  it("pins both Mac architectures and the macOS 13.0 minimum", () => {
    expect([...DESKTOP_MACOS_ARCHITECTURES]).toEqual(["arm64", "x64"]);
    expect(DESKTOP_MINIMUM_MACOS).toBe("13.0");
  });

  it("keeps the locked resource budgets beside the packaging contract", () => {
    expect(LOCAL_RESOURCE_BUDGETS.totalRssIdleBytes).toBe(1536 * 1024 * 1024);
    expect(LOCAL_RESOURCE_BUDGETS.totalRssActiveP95Bytes).toBe(2560 * 1024 * 1024);
  });
});
