import { describe, expect, it } from "vitest";
import { buildModelConnectPlaintext } from "./model-connect.js";
import { codingCliCatalogEntries } from "./pi-models.js";
import { parseModelSecret, resolveModelAuth, secretValuesToRedact } from "./pi-oauth.js";

describe("coding CLI credentials", () => {
  it("persists a keyless secret for CLI providers", () => {
    const plaintext = buildModelConnectPlaintext({ provider: "codex-cli", modelId: "default" });
    expect(plaintext).toBe(JSON.stringify({ kind: "cli" }));
    expect(parseModelSecret(plaintext)).toEqual({ kind: "cli", maxTokens: undefined });
    expect(parseModelSecret(plaintext).kind).toBe("cli");
  });

  it("redacts nothing and resolves without a key", async () => {
    const plaintext = buildModelConnectPlaintext({ provider: "claude-cli", modelId: "default" });
    expect(secretValuesToRedact(parseModelSecret(plaintext))).toEqual([]);
    const resolved = await resolveModelAuth(plaintext, "claude-cli");
    expect(resolved.apiKey).toBe("");
    expect(resolved.secret.kind).toBe("cli");
  });

  it("lists one default entry per CLI with cli auth", () => {
    const entries = codingCliCatalogEntries();
    expect(entries.map((entry) => entry.provider)).toEqual([
      "codex-cli",
      "claude-cli",
      "opencode-cli",
    ]);
    expect(entries.every((entry) => entry.auth === "cli" && entry.id === "default")).toBe(true);
  });
});
