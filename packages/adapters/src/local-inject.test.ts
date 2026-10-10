// Portions adapted from OpenMausBot (server/drivers/local-inject.ts)
// Copyright 2026 Milind Soni and OpenMausBot contributors
// Licensed under Apache License 2.0
// Full license: third_party/openmausbot/LICENSE

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  contextWindowsFromPs,
  decodeInjectId,
  encodeInjectId,
  hostApiKey,
  loadedIdsFromPayloads,
  localHost,
  probeLocalInjects,
  type InjectedModel,
} from "./local-inject.js";

describe("local-inject", () => {
  describe("encodeInjectId / decodeInjectId", () => {
    it("encodes and decodes correctly", () => {
      expect(encodeInjectId("ollama", "llama3.2:1b")).toBe("ollama::llama3.2:1b");
      expect(decodeInjectId("ollama::llama3.2:1b")).toEqual({
        host: "ollama",
        model: "llama3.2:1b",
      });
    });

    it("rejects invalid formats", () => {
      expect(decodeInjectId(null)).toBeNull();
      expect(decodeInjectId(undefined)).toBeNull();
      expect(decodeInjectId("")).toBeNull();
      expect(decodeInjectId("invalid")).toBeNull();
      expect(decodeInjectId("::model")).toBeNull();
      expect(decodeInjectId("host::")).toBeNull();
      expect(decodeInjectId("unknown::model")).toBeNull();
    });

    it("roundtrips", () => {
      const cases: Array<[host: string, model: string]> = [
        ["ollama", "llama3.2:1b"],
        ["omlx", "qwen2.5:0.5b"],
        ["exo", "phi-3"],
        ["lmstudio", "gemma-2-9b"],
      ];
      for (const [host, model] of cases) {
        const encoded = encodeInjectId(host, model);
        const decoded = decodeInjectId(encoded);
        expect(decoded).toEqual({ host, model });
      }
    });
  });

  describe("localHost", () => {
    it("returns host by id", () => {
      const host = localHost("ollama");
      expect(host).toBeDefined();
      expect(host?.id).toBe("ollama");
      expect(host?.baseUrl).toBe("http://127.0.0.1:11434/v1");
    });

    it("returns undefined for unknown host", () => {
      expect(localHost("unknown")).toBeUndefined();
    });
  });

  describe("hostApiKey", () => {
    it("returns hardcoded apiKey when set", () => {
      const host = localHost("ollama");
      expect(hostApiKey(host!)).toBe("ollama");
    });

    it("returns env var when apiKeyEnv is set", () => {
      const host = localHost("unsloth");
      process.env.UNSLOTH_STUDIO_AUTH_TOKEN = "test-token";
      expect(hostApiKey(host!)).toBe("test-token");
      delete process.env.UNSLOTH_STUDIO_AUTH_TOKEN;
    });

    it("returns 'local' as fallback", () => {
      const host = localHost("omlx");
      expect(hostApiKey(host!)).toBe("omlx");
    });
  });

  describe("contextWindowsFromPs", () => {
    it("extracts context windows from Ollama /api/ps", () => {
      const payload = {
        models: [
          { model: "llama3.2:1b", context_length: 2048 },
          { model: "qwen2.5:0.5b", context_length: 4096 },
        ],
      };
      const windows = contextWindowsFromPs(payload);
      expect(windows.get("llama3.2:1b")).toBe(2048);
      expect(windows.get("qwen2.5:0.5b")).toBe(4096);
    });

    it("handles base model IDs", () => {
      const payload = {
        models: [
          { model: "llama3.2:1b", context_length: 2048 },
          { model: "llama3.2:3b", context_length: 4096 },
        ],
      };
      const windows = contextWindowsFromPs(payload);
      expect(windows.get("llama3.2")).toBe(2048); // min of variants
    });

    it("returns empty map for invalid input", () => {
      expect(contextWindowsFromPs(null)).toEqual(new Map());
      expect(contextWindowsFromPs({})).toEqual(new Map());
      expect(contextWindowsFromPs({ models: [] })).toEqual(new Map());
    });
  });

  describe("loadedIdsFromPayloads", () => {
    it("detects loaded models from state flags", () => {
      const catalog = { data: [{ id: "llama3.2:1b" }] };
      const extra = { models: [{ id: "llama3.2:1b", loaded: true }] };
      const loaded = loadedIdsFromPayloads(localHost("ollama")!, catalog, extra);
      expect(loaded.has("llama3.2:1b")).toBe(true);
    });

    it("detects loaded models from state strings", () => {
      const catalog = { data: [{ id: "llama3.2:1b" }] };
      const extra = { models: [{ id: "llama3.2:1b", state: "loaded" }] };
      const loaded = loadedIdsFromPayloads(localHost("ollama")!, catalog, extra);
      expect(loaded.has("llama3.2:1b")).toBe(true);
    });

    it("excludes unloaded models", () => {
      const catalog = { data: [{ id: "llama3.2:1b" }] };
      const extra = { models: [{ id: "llama3.2:1b", loaded: false }] };
      const loaded = loadedIdsFromPayloads(localHost("ollama")!, catalog, extra);
      expect(loaded.has("llama3.2:1b")).toBe(false);
    });

    it("handles default_model fallback", () => {
      const catalog = { data: [{ id: "llama3.2:1b" }] };
      const extra = { default_model: "llama3.2:1b" };
      const loaded = loadedIdsFromPayloads(localHost("ollama")!, catalog, extra);
      expect(loaded.has("llama3.2:1b")).toBe(true);
    });
  });

  describe("probeLocalInjects", () => {
    it("probes all hosts and returns discovered models", async () => {
      const mockFetch = vi.fn();
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/models")) {
          return {
            ok: true,
            json: async () => ({ data: [{ id: "test-model" }] }),
          };
        }
        return { ok: false };
      });

      const results = await probeLocalInjects({}, mockFetch as any);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toMatchObject({
        host: expect.any(String),
        model: "test-model",
        id: expect.stringContaining("::"),
      });
    });

    it("handles unreachable hosts gracefully", async () => {
      const mockFetch = vi.fn();
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const results = await probeLocalInjects({}, mockFetch as any);
      expect(results).toEqual([]);
    });

    it("filters out embedding models", async () => {
      const mockFetch = vi.fn();
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/models")) {
          return {
            ok: true,
            json: async () => ({
              data: [
                { id: "llama3.2:1b" },
                { id: "nomic-embed-text" },
                { id: "bge-small-en" },
              ],
            }),
          };
        }
        return { ok: false };
      });

      const results = await probeLocalInjects({}, mockFetch as any);
      const modelIds = results.map((r) => r.model);
      expect(modelIds).toContain("llama3.2:1b");
      expect(modelIds).not.toContain("nomic-embed-text");
      expect(modelIds).not.toContain("bge-small-en");
    });
  });
});
