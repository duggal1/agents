import { describe, expect, it } from "vitest";
import { LOCAL_RUNTIME_SETTINGS_PATH_ENV } from "@sapphire/contracts";
import { resolveSandboxProvider, sandboxProviderOptionsFromEnv } from "./sandbox-provider-env.js";

const PACKAGED_LOCAL = { [LOCAL_RUNTIME_SETTINGS_PATH_ENV]: "/tmp/local-runtime-settings.json" };

describe("resolveSandboxProvider", () => {
  it("defaults to e2b when its key is set, docker otherwise", () => {
    expect(resolveSandboxProvider({})).toBe("docker");
    expect(resolveSandboxProvider({ E2B_API_KEY: "test-e2b-key" })).toBe("e2b");
  });

  it("falls back to docker when e2b is requested without a key", () => {
    expect(resolveSandboxProvider({ SANDBOX_PROVIDER: "e2b" })).toBe("docker");
    expect(resolveSandboxProvider({ SANDBOX_PROVIDER: "e2b", E2B_API_KEY: "test-e2b-key" })).toBe(
      "e2b",
    );
  });

  it("selects none instead of docker in packaged local mode without a key", () => {
    expect(resolveSandboxProvider({ ...PACKAGED_LOCAL })).toBe("none");
    expect(resolveSandboxProvider({ ...PACKAGED_LOCAL, SANDBOX_PROVIDER: "e2b" })).toBe("none");
    expect(
      resolveSandboxProvider({ ...PACKAGED_LOCAL, E2B_API_KEY: "test-e2b-key" }),
    ).toBe("e2b");
    expect(
      resolveSandboxProvider({
        ...PACKAGED_LOCAL,
        SANDBOX_PROVIDER: "e2b",
        E2B_API_KEY: "test-e2b-key",
      }),
    ).toBe("e2b");
  });

  it("keeps an explicitly supervised docker fallback in packaged local mode", () => {
    expect(
      resolveSandboxProvider({
        ...PACKAGED_LOCAL,
        NODE_ENV: "production",
        SANDBOX_PROVIDER: "docker",
        SANDBOX_SUPERVISOR_TOKEN: "prod-supervisor-token-with-enough-length",
      }),
    ).toBe("docker");
  });

  it("keeps explicit none", () => {
    expect(resolveSandboxProvider({ SANDBOX_PROVIDER: "none" })).toBe("none");
    expect(resolveSandboxProvider({ SANDBOX_PROVIDER: "" })).toBe("none");
  });

  it("falls back to none when a remote provider key is missing", () => {
    expect(resolveSandboxProvider({ SANDBOX_PROVIDER: "daytona" })).toBe("none");
    expect(resolveSandboxProvider({ SANDBOX_PROVIDER: "createos" })).toBe("none");
    expect(resolveSandboxProvider({ SANDBOX_PROVIDER: "box" })).toBe("none");
  });

  it("keeps CreateOS when its API key is set", () => {
    expect(
      resolveSandboxProvider({
        SANDBOX_PROVIDER: "createos",
        CREATEOS_SANDBOX_API_KEY: "test-createos-key",
      }),
    ).toBe("createos");
  });

  it("falls back to none in production when Docker has no supervisor token", () => {
    expect(
      resolveSandboxProvider({
        NODE_ENV: "production",
        SANDBOX_PROVIDER: "docker",
      }),
    ).toBe("none");
  });

  it("keeps docker in production when a supervisor token is set", () => {
    expect(
      resolveSandboxProvider({
        NODE_ENV: "production",
        SANDBOX_PROVIDER: "docker",
        SANDBOX_SUPERVISOR_TOKEN: "prod-supervisor-token-with-enough-length",
      }),
    ).toBe("docker");
  });
});

describe("sandboxProviderOptionsFromEnv", () => {
  it("loads CreateOS settings from the shared env contract", () => {
    expect(
      sandboxProviderOptionsFromEnv({
        CREATEOS_SANDBOX_API_KEY: "test-createos-key",
        CREATEOS_SANDBOX_BASE_URL: "https://api.example.test",
        CREATEOS_SANDBOX_SHAPE: "s-4vcpu-8gb",
        CREATEOS_SANDBOX_ROOTFS: "desktop:2",
      }),
    ).toMatchObject({
      createosApiKey: "test-createos-key",
      createosBaseUrl: "https://api.example.test",
      createosShape: "s-4vcpu-8gb",
      createosRootfs: "desktop:2",
    });
  });
});
