import { darkTokens } from "@sapphire/ui-tokens";
import { describe, expect, it } from "vitest";
import { botColors, tokens } from "./theme.js";

describe("mobile theme tokens", () => {
  it("exposes the shared product palette used by custom surfaces", () => {
    expect(tokens.background).toBe(darkTokens.background);
    expect(tokens.foreground).toBe(darkTokens.foreground);
    expect(tokens.primary).toBe(darkTokens.primary);
  });

  it("re-exports botColors for identity accents", () => {
    expect(botColors.length).toBeGreaterThan(0);
    expect(botColors[0]).toBe("#3EC5A8");
  });
});
