import { describe, expect, it } from "vitest";
import { isLocalMode, LOCAL_OWNER_EMAIL } from "./local-actor.js";

describe("isLocalMode", () => {
  it("is off unless RAKAZO_LOCAL_MODE=1", () => {
    expect(isLocalMode({})).toBe(false);
    expect(isLocalMode({ RAKAZO_LOCAL_MODE: "0" })).toBe(false);
    expect(isLocalMode({ RAKAZO_LOCAL_MODE: "true" })).toBe(false);
    expect(isLocalMode({ RAKAZO_LOCAL_MODE: "1" })).toBe(true);
  });

  it("pins a stable local owner identity", () => {
    expect(LOCAL_OWNER_EMAIL).toContain("@");
  });
});
