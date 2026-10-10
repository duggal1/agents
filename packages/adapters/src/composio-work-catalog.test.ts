import { describe, expect, it } from "vitest";
import {
  extractComposioApiKey,
  isWorkToolkitSlug,
  mergeWithWorkCatalog,
  NON_WORK_TOOLKIT_DENYLIST,
  WORK_CATALOG,
  WORK_CATALOG_SIZE,
} from "./composio-work-catalog.js";

describe("composio professional-work catalog", () => {
  it("ships at least 500 professional integrations", () => {
    expect(WORK_CATALOG_SIZE).toBeGreaterThanOrEqual(500);
    expect(WORK_CATALOG.length).toBeGreaterThanOrEqual(500);
  });

  it("leads with Apollo and Slack", () => {
    expect(WORK_CATALOG[0]?.slug).toBe("APOLLO");
    expect(WORK_CATALOG[1]?.slug).toBe("SLACK");
    expect(isWorkToolkitSlug("apollo")).toBe(true);
    expect(isWorkToolkitSlug("SLACK")).toBe(true);
  });

  it("covers sales, communication, project, and developer work", () => {
    for (const slug of ["SALESFORCE", "HUBSPOT", "GITHUB", "GITLAB", "JIRA", "LINEAR", "GMAIL"]) {
      expect(isWorkToolkitSlug(slug)).toBe(true);
    }
  });

  it("has unique case-insensitive slugs", () => {
    const keys = WORK_CATALOG.map((entry) => entry.slug.trim().toLowerCase());
    expect(new Set(keys).size).toBe(WORK_CATALOG.length);
  });

  it("contains no consumer/entertainment apps", () => {
    const keys = new Set(WORK_CATALOG.map((entry) => entry.slug.trim().toLowerCase()));
    for (const banned of NON_WORK_TOOLKIT_DENYLIST) {
      expect(keys.has(banned)).toBe(false);
    }
  });

  it("fills gaps when the live directory is empty or partial", () => {
    expect(mergeWithWorkCatalog([])).toHaveLength(WORK_CATALOG.length);
    const merged = mergeWithWorkCatalog([
      { slug: "gmail", name: "Gmail Live", logo: null, noAuth: false },
    ]);
    // Live entry wins on conflict; curated catalog still fills the rest.
    expect(merged.find((item) => item.slug.toLowerCase() === "gmail")?.name).toBe("Gmail Live");
    expect(merged.length).toBeGreaterThanOrEqual(500);
    expect(merged[0]?.slug).toBe("APOLLO");
  });
});

describe("extractComposioApiKey", () => {
  it("parses KEY=value lines", () => {
    expect(extractComposioApiKey("COMPOSIO_API_KEY=abc123xyz")).toBe("abc123xyz");
  });

  it("parses export prefixes, quotes, and surrounding lines", () => {
    const text = ["# comment", "OTHER=1", 'export COMPOSIO_API_KEY="quoted-key-123"'].join("\n");
    expect(extractComposioApiKey(text)).toBe("quoted-key-123");
  });

  it("parses single-quoted values and ignores inline comments", () => {
    expect(extractComposioApiKey("COMPOSIO_API_KEY='single-456' # prod")).toBe("single-456");
    expect(extractComposioApiKey("COMPOSIO_API_KEY=bare-789 # prod")).toBe("bare-789");
  });

  it("accepts a bare pasted key", () => {
    expect(extractComposioApiKey("  barekey12345678  ")).toBe("barekey12345678");
  });

  it("returns undefined when no key is present", () => {
    expect(extractComposioApiKey("FOO=1\nBAR=2")).toBeUndefined();
    expect(extractComposioApiKey("")).toBeUndefined();
    expect(extractComposioApiKey("COMPOSIO_API_KEY=")).toBeUndefined();
  });
});
