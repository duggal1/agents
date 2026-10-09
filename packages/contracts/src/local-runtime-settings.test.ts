import { describe, expect, it } from "vitest";
import {
  defaultLocalRuntimeSettings,
  isPackagedLocalMode,
  LOCAL_RUNTIME_SETTINGS_PATH_ENV,
  parseLocalRuntimeSettings,
  parseLocalRuntimeSettingsJson,
  toLocalRuntimeStatus,
} from "./local-runtime-settings.js";

describe("local runtime settings", () => {
  it("parses a valid policy file", () => {
    expect(
      parseLocalRuntimeSettings({ version: 1, allowDockerComputerFallback: true }),
    ).toEqual({ version: 1, allowDockerComputerFallback: true });
  });

  it("defaults the fallback toggle to off when absent", () => {
    expect(parseLocalRuntimeSettings({ version: 1 })).toEqual({
      version: 1,
      allowDockerComputerFallback: false,
    });
  });

  it("fails closed to defaults on corrupt or foreign content", () => {
    expect(parseLocalRuntimeSettings(undefined)).toEqual(defaultLocalRuntimeSettings());
    expect(parseLocalRuntimeSettings(null)).toEqual(defaultLocalRuntimeSettings());
    expect(parseLocalRuntimeSettings({ version: 2, allowDockerComputerFallback: true })).toEqual(
      defaultLocalRuntimeSettings(),
    );
    expect(parseLocalRuntimeSettings({ version: 1, allowDockerComputerFallback: "yes" })).toEqual(
      defaultLocalRuntimeSettings(),
    );
    expect(parseLocalRuntimeSettingsJson(null)).toEqual(defaultLocalRuntimeSettings());
    expect(parseLocalRuntimeSettingsJson("{ not json")).toEqual(defaultLocalRuntimeSettings());
    expect(parseLocalRuntimeSettingsJson('{"version":1}')).toEqual({
      version: 1,
      allowDockerComputerFallback: false,
    });
  });

  it("detects packaged local mode from the settings-path variable alone", () => {
    expect(isPackagedLocalMode({})).toBe(false);
    expect(isPackagedLocalMode({ [LOCAL_RUNTIME_SETTINGS_PATH_ENV]: "  " })).toBe(false);
    expect(
      isPackagedLocalMode({ [LOCAL_RUNTIME_SETTINGS_PATH_ENV]: "/tmp/runtime-settings.json" }),
    ).toBe(true);
  });

  it("exposes only booleans to the renderer, never key material", () => {
    const status = toLocalRuntimeStatus({ hasE2BKey: true, allowDockerComputerFallback: false });
    expect(status).toEqual({ hasE2BKey: true, allowDockerComputerFallback: false });
    expect(Object.keys(status).sort()).toEqual([
      "allowDockerComputerFallback",
      "hasE2BKey",
    ]);
    // Even when the caller holds the real key, the serialized view cannot leak it.
    const internal = { key: "e2b_live_secret_value", hasE2BKey: true as unknown, allowDockerComputerFallback: false as unknown };
    const serialized = JSON.stringify(
      toLocalRuntimeStatus({ hasE2BKey: internal.hasE2BKey, allowDockerComputerFallback: internal.allowDockerComputerFallback }),
    );
    expect(serialized).not.toContain("e2b_live_secret_value");
    // Truthy non-booleans coerce to false so IPC can only carry strict booleans.
    expect(toLocalRuntimeStatus({ hasE2BKey: 1, allowDockerComputerFallback: "true" })).toEqual({
      hasE2BKey: false,
      allowDockerComputerFallback: false,
    });
  });
});
