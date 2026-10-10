import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClaudeMark, CodexMark, CodingAgentMark, OpenCodeMark } from "./coding-agent-marks.js";

describe("coding agent marks", () => {
  it.each([
    ["claude-cli", ClaudeMark],
    ["codex-cli", CodexMark],
    ["opencode-cli", OpenCodeMark],
  ] as const)("renders the %s brand mark as monochrome SVG", (_provider, Mark) => {
    const html = renderToString(<Mark />);
    expect(html).toContain("<svg");
    expect(html).toContain("<path");
    expect(html).not.toContain("#d97757");
  });

  it("resolves marks by provider id", () => {
    expect(renderToString(<CodingAgentMark provider="codex-cli" />)).toContain("<svg");
    expect(renderToString(<CodingAgentMark provider="unknown" />)).toBe("");
  });
});
