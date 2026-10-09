#!/usr/bin/env node
// Validates a captured native-runtime resource measurement against the locked
// budgets in src/resource-budgets.ts. RSS cannot be measured headlessly in CI,
// so the procedure is: capture per-process RSS on a clean Mac (see
// docs/desktop-release.md), write the measurements file, run this check. A
// miss fails closed with the blocker text; budgets are never raised here.
//
//   node scripts/check-resource-budgets.mjs --measurements <file.json>
//
// File format:
//   {
//     "idle": [{ "process": "api", "rssBytes": 12345 }, ...],
//     "activeWindowTotals": [12345, ...],
//     "note": "free text describing the run (optional)"
//   }
//
// Collect one RSS sample per budgeted process (electron-main,
// electron-renderer, api, worker, postgres), e.g. with:
//   ps -o rss= -p <pid>   # KiB on macOS; multiply by 1024
import { readFileSync } from "node:fs";

/** Must match LOCAL_RESOURCE_BUDGETS in src/resource-budgets.ts. */
const TOTAL_RSS_IDLE_BYTES = 1536 * 1024 * 1024;
const TOTAL_RSS_ACTIVE_P95_BYTES = 2560 * 1024 * 1024;
const BUDGETED_PROCESSES = ["electron-main", "electron-renderer", "api", "worker", "postgres"];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${bytes} B`;
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function main() {
  const file = process.argv[process.argv.indexOf("--measurements") + 1];
  if (!file) fail("Usage: check-resource-budgets.mjs --measurements <file.json>");
  let measurements;
  try {
    measurements = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Could not read measurements file: ${error instanceof Error ? error.message : error}`);
  }
  const problems = [];
  if (!Array.isArray(measurements.idle) || measurements.idle.length === 0) {
    problems.push("idle: needs at least one per-process sample");
  } else {
    for (const sample of measurements.idle) {
      if (!BUDGETED_PROCESSES.includes(sample?.process) || typeof sample?.rssBytes !== "number") {
        problems.push(`idle: invalid sample ${JSON.stringify(sample)}`);
      }
    }
  }
  if (!Array.isArray(measurements.activeWindowTotals) || measurements.activeWindowTotals.length === 0) {
    problems.push("activeWindowTotals: needs at least one window total");
  }
  if (problems.length > 0) fail(problems.join("\n"));

  const idleTotal = measurements.idle.reduce((sum, sample) => sum + sample.rssBytes, 0);
  const activeP95 = percentile([...measurements.activeWindowTotals].sort((a, b) => a - b), 0.95);
  console.log(`Idle total RSS: ${formatBytes(idleTotal)} (budget ${formatBytes(TOTAL_RSS_IDLE_BYTES)})`);
  console.log(
    `Active p95 RSS: ${formatBytes(activeP95)} (budget ${formatBytes(TOTAL_RSS_ACTIVE_P95_BYTES)})`,
  );

  const misses = [];
  if (idleTotal > TOTAL_RSS_IDLE_BYTES) {
    misses.push(`Idle RSS ${formatBytes(idleTotal)} exceeds the ${formatBytes(TOTAL_RSS_IDLE_BYTES)} budget.`);
  }
  if (activeP95 > TOTAL_RSS_ACTIVE_P95_BYTES) {
    misses.push(
      `Active p95 RSS ${formatBytes(activeP95)} exceeds the ${formatBytes(TOTAL_RSS_ACTIVE_P95_BYTES)} budget.`,
    );
  }
  if (misses.length > 0) {
    fail(`${misses.join(" ")}\nStop and report measurements; do not raise the budget.`);
  }
  console.log("Within budget.");
}

main();
