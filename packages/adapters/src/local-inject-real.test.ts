// Portions adapted from OpenMausBot (server/drivers/local-inject.ts)
// Copyright 2026 Milind Soni and OpenMausBot contributors
// Licensed under Apache License 2.0
// Full license: third_party/openmausbot/LICENSE

/**
 * Real test against actual Ollama server. Gated so default runs stay offline:
 * SAPPHIRE_LIVE_LOCAL_MODELS=1 vitest run packages/adapters/src/local-inject-real.test.ts
 */

import { describe, expect, it } from "vitest";
import { probeLocalInjects, decodeInjectId, localHost } from "./local-inject.js";

// Live localhost Ollama only: default unit runs stay offline-deterministic.
// Run with: SAPPHIRE_LIVE_LOCAL_MODELS=1 vitest run packages/adapters/src/local-inject-real.test.ts
const describeLive =
  process.env.SAPPHIRE_LIVE_LOCAL_MODELS !== undefined ? describe : describe.skip;
describeLive("live local model server", () => {
it("discovers models from actual Ollama server", async () => {
  const results = await probeLocalInjects();
  console.log("Discovered models:", JSON.stringify(results, null, 2));

  const ollamaModels = results.filter((r) => r.host === "ollama");
  expect(ollamaModels.length).toBeGreaterThan(0);

  const firstModel = ollamaModels[0]!;
  expect(firstModel.id).toMatch(/^ollama::/);
  expect(firstModel.model).toBeTruthy();
  expect(firstModel.label).toBeTruthy();

  const decoded = decodeInjectId(firstModel.id);
  expect(decoded).toEqual({
    host: "ollama",
    model: firstModel.model,
  });
});

it("includes context window if Ollama reports it", async () => {
  const results = await probeLocalInjects();
  const ollamaModels = results.filter((r) => r.host === "ollama");

  // Ollama's /api/ps may not report context window for unloaded models
  // So we just check the structure is correct
  for (const model of ollamaModels) {
    if (model.contextWindow) {
      expect(model.contextWindow).toBeGreaterThan(0);
    }
  }
});
});
