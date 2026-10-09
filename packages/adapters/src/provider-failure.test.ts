import { describe, expect, it } from "vitest";
import { classifyProviderFailure, isPermanentQuotaFailure } from "./provider-failure.js";

function httpError(status: number, message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

describe("provider failure classification", () => {
  it("treats exhausted-credit wording as permanent quota", () => {
    for (const message of [
      "402 Payment Required: out of credits",
      "quota exceeded for this account",
      "insufficient credit balance",
      "billing limit reached",
    ]) {
      expect(classifyProviderFailure(new Error(message))).toBe("permanent-quota");
    }
    expect(classifyProviderFailure(httpError(402, "pay up"))).toBe("permanent-quota");
    // E2B reports exhausted accounts with auth-shaped statuses plus billing words.
    expect(classifyProviderFailure(httpError(401, "quota exhausted, add credits"))).toBe(
      "permanent-quota",
    );
    expect(classifyProviderFailure(httpError(403, "insufficient credits"))).toBe("permanent-quota");
  });

  it("treats credential problems without quota wording as auth-config", () => {
    expect(classifyProviderFailure(httpError(401, "invalid api key"))).toBe("auth-config");
    expect(classifyProviderFailure(httpError(403, "forbidden"))).toBe("auth-config");
    expect(classifyProviderFailure(new Error("authentication failed"))).toBe("auth-config");
  });

  it("treats timeouts, rate limits, and 5xx as transient", () => {
    expect(classifyProviderFailure(new Error("sandbox command timed out"))).toBe("transient");
    expect(classifyProviderFailure(httpError(429, "too many requests"))).toBe("transient");
    expect(classifyProviderFailure(httpError(503, "service unavailable"))).toBe("transient");
    expect(classifyProviderFailure(new Error("socket hang up"))).toBe("transient");
    expect(classifyProviderFailure(new Error("sandbox probably not running anymore"))).toBe(
      "transient",
    );
  });

  it("treats anything else as unknown", () => {
    expect(classifyProviderFailure(new Error("weird new SDK shape"))).toBe("unknown");
    expect(classifyProviderFailure("plain string boom")).toBe("unknown");
  });

  it("gates automatic fallback on permanent quota only", () => {
    expect(isPermanentQuotaFailure(new Error("out of credits"))).toBe(true);
    expect(isPermanentQuotaFailure(httpError(429, "slow down"))).toBe(false);
    expect(isPermanentQuotaFailure(httpError(401, "invalid api key"))).toBe(false);
    expect(isPermanentQuotaFailure(new Error("mystery"))).toBe(false);
  });
});
