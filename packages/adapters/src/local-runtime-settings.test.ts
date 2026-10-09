import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  localRuntimeSettingsPath,
  readLocalRuntimeSettingsFile,
} from "./local-runtime-settings.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rakazo-runtime-settings-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("local runtime settings file", () => {
  it("returns the configured settings path, if any", () => {
    expect(localRuntimeSettingsPath({})).toBeUndefined();
    expect(localRuntimeSettingsPath({ SAPPHIRE_LOCAL_RUNTIME_SETTINGS_PATH: "  " })).toBeUndefined();
    expect(
      localRuntimeSettingsPath({ SAPPHIRE_LOCAL_RUNTIME_SETTINGS_PATH: " /tmp/settings.json " }),
    ).toBe("/tmp/settings.json");
  });

  it("reads the shared policy both processes consume", () => {
    const file = path.join(dir, "settings.json");
    writeFileSync(file, JSON.stringify({ version: 1, allowDockerComputerFallback: true }));
    expect(readLocalRuntimeSettingsFile(file)).toEqual({
      version: 1,
      allowDockerComputerFallback: true,
    });
  });

  it("fails closed to defaults on missing, corrupt, or oversized files", () => {
    expect(readLocalRuntimeSettingsFile(undefined)).toEqual({
      version: 1,
      allowDockerComputerFallback: false,
    });
    expect(readLocalRuntimeSettingsFile(path.join(dir, "missing.json"))).toEqual({
      version: 1,
      allowDockerComputerFallback: false,
    });
    const corrupt = path.join(dir, "corrupt.json");
    writeFileSync(corrupt, "{ not json");
    expect(readLocalRuntimeSettingsFile(corrupt)).toEqual({
      version: 1,
      allowDockerComputerFallback: false,
    });
    const wrongVersion = path.join(dir, "future.json");
    writeFileSync(wrongVersion, JSON.stringify({ version: 99, allowDockerComputerFallback: true }));
    expect(readLocalRuntimeSettingsFile(wrongVersion)).toEqual({
      version: 1,
      allowDockerComputerFallback: false,
    });
  });
});
