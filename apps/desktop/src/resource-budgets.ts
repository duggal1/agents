/**
 * Native-runtime resource budgets for the packaged macOS local backend.
 *
 * Proposed product targets from the local-macOS plan: with E2B primary and
 * local model inference disabled, total Sapphire RSS must stay at or below
 * 1.5 GiB after five minutes idle and the 95th percentile at or below 2.5 GiB
 * during one active chat turn plus one E2B computer session. Docker Desktop
 * VM memory is absent from the local path and excluded.
 *
 * If a measured build misses either target, stop and report the measurements
 * for user review — never quietly raise these ceilings.
 */

/** Every Sapphire child process counted toward the totals. */
export const BUDGETED_PROCESSES = [
  "electron-main",
  "electron-renderer",
  "api",
  "worker",
  "postgres",
] as const;

export type BudgetedProcess = (typeof BUDGETED_PROCESSES)[number];

export const LOCAL_RESOURCE_BUDGETS = {
  /** Minutes of steady state before the idle measurement counts. */
  idleSettleMinutes: 5,
  /** Total RSS ceiling after five idle minutes, bytes (1.5 GiB). */
  totalRssIdleBytes: 1536 * 1024 * 1024,
  /** p95 total RSS ceiling during an active chat turn + E2B session, bytes (2.5 GiB). */
  totalRssActiveP95Bytes: 2560 * 1024 * 1024,
} as const;

export interface ResourceSample {
  process: BudgetedProcess;
  rssBytes: number;
}

export interface ResourceVerdict {
  withinBudget: boolean;
  totalRssBytes: number;
  budgetBytes: number;
  /** Present only when the budget is missed: the blocker to report. */
  blocker: string | null;
}

function verdict(
  label: string,
  samples: ResourceSample[],
  budgetBytes: number,
): ResourceVerdict {
  const totalRssBytes = samples.reduce((sum, sample) => sum + sample.rssBytes, 0);
  if (totalRssBytes <= budgetBytes) {
    return { withinBudget: true, totalRssBytes, budgetBytes, blocker: null };
  }
  return {
    withinBudget: false,
    totalRssBytes,
    budgetBytes,
    blocker:
      `${label} RSS ${formatBytes(totalRssBytes)} exceeds the ${formatBytes(budgetBytes)} budget. ` +
      "Stop and report measurements; do not raise the budget.",
  };
}

/** Check one settled idle measurement (all processes sampled together). */
export function checkIdleRss(samples: ResourceSample[]): ResourceVerdict {
  return verdict("Idle", samples, LOCAL_RESOURCE_BUDGETS.totalRssIdleBytes);
}

/** Check active-window samples by their 95th percentile total. */
export function checkActiveRssP95(windowTotals: number[]): ResourceVerdict {
  if (windowTotals.length === 0) {
    return {
      withinBudget: false,
      totalRssBytes: 0,
      budgetBytes: LOCAL_RESOURCE_BUDGETS.totalRssActiveP95Bytes,
      blocker: "Active RSS check needs at least one window sample.",
    };
  }
  const sorted = [...windowTotals].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
  return verdict("Active p95", [{ process: "api", rssBytes: p95 }], LOCAL_RESOURCE_BUDGETS.totalRssActiveP95Bytes);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${bytes} B`;
}
