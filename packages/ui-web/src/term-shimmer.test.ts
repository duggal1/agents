import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The terminal shimmer must keep its label painted: the text is rendered
 * through background-clip with no repeat, so if the animated sweep ever
 * parks the gradient off the glyphs the label blinks out every cycle.
 * This test re-derives coverage from the shipped keyframes instead of
 * trusting them by eye.
 */
describe("term-shimmer sweep coverage", () => {
  const css = readFileSync(path.join(import.meta.dirname, "styles.css"), "utf8");

  function numberAfter(pattern: RegExp): number {
    const match = css.match(pattern);
    if (!match) throw new Error(`pattern not found: ${pattern}`);
    return Number(match[1]);
  }

  it("keeps the gradient over the text at every keyframe position", () => {
    // background-size: 250% 100% — the image is 2.5 element widths wide.
    const sizeMatch = css.match(/\.term-label,\s*\.term-shimmer \{[^}]*background-size:\s*([\d.]+)%/s);
    expect(sizeMatch).not.toBeNull();
    const size = Number(sizeMatch![1]) / 100;

    // Keyframe endpoints as fractions of background-position.
    const from = numberAfter(/@keyframes term-shimmer \{\s*from \{\s*background-position:\s*([\d.]+)%/s) / 100;
    const to = numberAfter(/@keyframes term-shimmer \{\s*from \{[^}]*\}\s*to \{\s*background-position:\s*([\d.]+)%/s) / 100;

    // background-position p% puts the image's left edge at (1 - size) * p
    // in element widths; the text [0, 1] is covered iff edge <= 0 and
    // edge + size >= 1 at both endpoints (linear interpolation stays
    // between them, so endpoints suffice).
    for (const p of [from, to]) {
      const edge = (1 - size) * p;
      expect(edge).toBeLessThanOrEqual(0);
      expect(edge + size).toBeGreaterThanOrEqual(1);
    }
  });

  it("never repeats the gradient (a repeated tile would double the sweep)", () => {
    const block = css.match(/\.term-label,\s*\.term-shimmer \{[^}]*\}/s)?.[0] ?? "";
    expect(block).toContain("no-repeat");
  });
});
