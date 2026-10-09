/**
 * Classifies sandbox provider failures for the E2B-first local-macOS fallback.
 *
 * Only a permanent account/quota/credit exhaustion (`permanent-quota`) is
 * eligible for automatic Docker fallback. Everything else — bad keys,
 * transient network trouble, rate limits, unknown shapes — must never move a
 * computer to another provider on its own.
 */

export type ProviderFailureKind =
  | "permanent-quota"
  | "auth-config"
  | "transient"
  | "unknown";

/** Matches exhausted-credit/quota wording across E2B SDK and HTTP surfaces. */
const QUOTA_MESSAGE =
  /quota|credit|billing|insufficient|exhausted|out of (credits|funds)|payment required|over (the )?limit|usage limit/i;
/** Matches credential problems that are NOT quota exhaustion. */
const AUTH_MESSAGE = /unauthorized|forbidden|invalid (api key|token|credentials)|authentication|api key/i;
/** Matches problems that may clear on their own: never fallback-worthy. */
const TRANSIENT_MESSAGE =
  /timeout|timed out|temporar|econn|enotfound|eai_again|socket hang up|dns|network|rate.?limit|too many requests|service unavailable|bad gateway|gateway timeout|internal server error|try again/i;

function failureMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause =
      error.cause instanceof Error ? ` ${error.cause.message}` : error.cause ? ` ${String(error.cause)}` : "";
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}

function failureStatus(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    for (const key of ["status", "statusCode", "code"]) {
      const value = (error as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && /^\d{3}$/.test(value)) return Number(value);
    }
    const response = (error as Record<string, unknown>).response;
    if (response && typeof response === "object") {
      const status = (response as Record<string, unknown>).status;
      if (typeof status === "number" && Number.isFinite(status)) return status;
    }
  }
  return undefined;
}

/**
 * Classify a provider failure. Quota wording wins over generic auth wording:
 * E2B reports an exhausted account as 401/402/403 with billing language, and
 * that is the only shape that may trigger automatic fallback.
 */
export function classifyProviderFailure(error: unknown): ProviderFailureKind {
  const message = failureMessage(error);
  const status = failureStatus(error);
  if (QUOTA_MESSAGE.test(message) || status === 402) return "permanent-quota";
  if (status === 429 || TRANSIENT_MESSAGE.test(message)) return "transient";
  if (status !== undefined && status >= 500) return "transient";
  if (status === 401 || status === 403 || AUTH_MESSAGE.test(message)) return "auth-config";
  if (isSandboxGoneShape(message)) return "transient";
  return "unknown";
}

/**
 * The single gate for automatic Docker fallback. A failed E2B call may be
 * retried on Docker only when this returns true.
 */
export function isPermanentQuotaFailure(error: unknown): boolean {
  return classifyProviderFailure(error) === "permanent-quota";
}

/** A sandbox that vanished is a reconnect case, never a quota case. */
function isSandboxGoneShape(message: string): boolean {
  return /probably not running anymore|not found|does not exist/i.test(message);
}
