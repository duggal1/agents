import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { POSTGRES_MAJOR_VERSION } from "./local-postgres.js";
import {
  DESKTOP_MINIMUM_MACOS,
  RUNTIME_MANIFEST_FILE,
  RUNTIME_MANIFEST_VERSION,
  SERVICE_READINESS,
} from "./local-runtime.js";

const desktopDir = path.resolve(import.meta.dirname, "..");
const buildScript = readFileSync(path.join(desktopDir, "scripts", "build-runtime.mjs"), "utf8");
const packageJson = JSON.parse(readFileSync(path.join(desktopDir, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("runtime packaging", () => {
  it("exposes a build script the release pipeline can call", () => {
    expect(packageJson.scripts["runtime:build"]).toBe("node scripts/build-runtime.mjs");
  });

  it("pins the same minimum macOS version as the supervisor contract", () => {
    expect(buildScript).toContain(`const DESKTOP_MINIMUM_MACOS = "${DESKTOP_MINIMUM_MACOS}"`);
  });

  it("pins PostgreSQL 16 and both Mac architectures", () => {
    expect(buildScript).toContain("POSTGRES_MAJOR_VERSION = 16");
    expect(buildScript).toContain("koffi-darwin-${arch}");
    expect(buildScript).toContain("arm64");
    expect(buildScript).toContain("x64");
    expect(POSTGRES_MAJOR_VERSION).toBe(16);
  });

  it("declares each service's readiness line the same way the supervisor does", () => {
    for (const readiness of Object.values(SERVICE_READINESS)) {
      expect(readiness.kind).toBe("log");
      if (readiness.kind === "log") expect(buildScript).toContain(readiness.pattern);
    }
  });

  it("writes the manifest filename and version the supervisor reads", () => {
    expect(buildScript).toContain("runtime-manifest.json");
    expect(buildScript).toContain("RUNTIME_MANIFEST_VERSION = 1");
    expect(RUNTIME_MANIFEST_FILE).toBe("runtime-manifest.json");
    expect(RUNTIME_MANIFEST_VERSION).toBe(1);
  });
});
