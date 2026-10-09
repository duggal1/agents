import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  path.resolve(import.meta.dirname, "../../../.github/workflows/desktop-native-acceptance.yml"),
  "utf8",
);

const expression = (inner: string) => `\${{ ${inner} }}`;

describe("native acceptance workflow", () => {
  it("is manual-only and never runs automatically", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s*push:/m);
    expect(workflow).not.toMatch(/^\s*pull_request:/m);
    expect(workflow).not.toMatch(/^\s*schedule:/m);
    expect(workflow).not.toMatch(/tags:\s*\[/);
  });

  it("pins every third-party action to an immutable commit", () => {
    const actionReferences = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]);
    expect(actionReferences.length).toBeGreaterThan(0);
    for (const reference of actionReferences) {
      expect(reference, reference).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it("proves the packaged backend needs no Docker", () => {
    expect(workflow).toContain("LocalStackController");
    expect(workflow).toContain("extraResources");
    expect(workflow).toContain("setup.html");
  });

  it("verifies the universal provision with both slices and the macOS minimum", () => {
    expect(workflow).toContain("provision-postgres.mjs --universal");
    expect(workflow).toContain("lipo -archs");
    expect(workflow).toContain("arm64 x86_64");
    expect(workflow).toContain("13.0");
  });

  it("gates billed and daemon-dependent jobs behind explicit inputs", () => {
    expect(workflow).toContain(`if: inputs.live_e2b == true`);
    expect(workflow).toContain(`secrets.E2B_API_KEY`);
    expect(workflow).toContain("test -n \"$E2B_API_KEY\"");
    expect(workflow).toContain(`if: inputs.docker_fallback == true`);
    expect(workflow).toContain("docker info");
  });

  it("keeps live runs out of the default dispatch", () => {
    expect(workflow).toContain(`default: false`);
    expect(workflow).toContain(expression("secrets.E2B_API_KEY"));
  });
});
