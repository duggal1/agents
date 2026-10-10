import { describe, expect, it } from "vitest";
import {
  isLocalModelBaseUrl,
  openAiCompatibleConnectReady,
  openAiCompatibleProbeSuccessMessage,
} from "./openai-compatible-ui.js";

describe("openAiCompatibleConnectReady", () => {
  it("allows a new connection with base URL and explicit model id", () => {
    expect(
      openAiCompatibleConnectReady({
        baseUrl: "http://127.0.0.1:8000/v1",
        modelId: "qwen",
      }),
    ).toBe(true);
  });

  it("rejects empty base URL or model id", () => {
    expect(
      openAiCompatibleConnectReady({
        baseUrl: "  ",
        modelId: "qwen",
      }),
    ).toBe(false);
    expect(
      openAiCompatibleConnectReady({
        baseUrl: "http://127.0.0.1:8000/v1",
        modelId: "",
      }),
    ).toBe(false);
  });

  it("guides manual entry when a successful probe lists no models", () => {
    expect(openAiCompatibleProbeSuccessMessage(0)).toBe("Server found. Enter a model name.");
  });
});

describe("isLocalModelBaseUrl", () => {
  it("recognizes loopback URLs on known local model host ports", () => {
    expect(isLocalModelBaseUrl("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLocalModelBaseUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLocalModelBaseUrl("http://127.0.0.1:1234/v1")).toBe(true);
    expect(isLocalModelBaseUrl("  http://127.0.0.1:8888/v1 ")).toBe(true);
  });

  it("keeps custom and remote endpoints key-gated", () => {
    expect(isLocalModelBaseUrl("http://127.0.0.1:8090/v1")).toBe(false);
    expect(isLocalModelBaseUrl("https://api.example.com/v1")).toBe(false);
    expect(isLocalModelBaseUrl("http://192.168.1.10:11434/v1")).toBe(false);
    expect(isLocalModelBaseUrl("not-a-url")).toBe(false);
    expect(isLocalModelBaseUrl("")).toBe(false);
  });
});
