import { describe, expect, it } from "vitest";
import {
  BUDGETED_PROCESSES,
  checkActiveRssP95,
  checkIdleRss,
  LOCAL_RESOURCE_BUDGETS,
} from "./resource-budgets.js";

const GIB = 1024 ** 3;

describe("local resource budgets", () => {
  it("pins the plan ceilings: 1.5 GiB idle, 2.5 GiB active p95", () => {
    expect(LOCAL_RESOURCE_BUDGETS.idleSettleMinutes).toBe(5);
    expect(LOCAL_RESOURCE_BUDGETS.totalRssIdleBytes).toBe(1.5 * GIB);
    expect(LOCAL_RESOURCE_BUDGETS.totalRssActiveP95Bytes).toBe(2.5 * GIB);
  });

  it("counts every Sapphire child process and no Docker VM", () => {
    expect([...BUDGETED_PROCESSES]).toEqual([
      "electron-main",
      "electron-renderer",
      "api",
      "worker",
      "postgres",
    ]);
  });

  it("passes idle samples under budget and reports a blocker over it", () => {
    const under = checkIdleRss([
      { process: "electron-main", rssBytes: 0.2 * GIB },
      { process: "electron-renderer", rssBytes: 0.3 * GIB },
      { process: "api", rssBytes: 0.3 * GIB },
      { process: "worker", rssBytes: 0.2 * GIB },
      { process: "postgres", rssBytes: 0.2 * GIB },
    ]);
    expect(under.withinBudget).toBe(true);
    expect(under.blocker).toBeNull();

    const over = checkIdleRss([{ process: "postgres", rssBytes: 2 * GIB }]);
    expect(over.withinBudget).toBe(false);
    expect(over.blocker).toMatch(/exceeds/);
    expect(over.blocker).toMatch(/do not raise the budget/);
  });

  it("judges the active window by p95, not the worst spike", () => {
    const totals = Array.from({ length: 19 }, () => GIB).concat([10 * GIB]);
    const verdict = checkActiveRssP95(totals);
    expect(verdict.withinBudget).toBe(true);
    expect(verdict.totalRssBytes).toBe(GIB);

    const hot = checkActiveRssP95(Array.from({ length: 20 }, () => 3 * GIB));
    expect(hot.withinBudget).toBe(false);
    expect(hot.blocker).toMatch(/Active p95/);
  });

  it("refuses an empty active window instead of passing vacuously", () => {
    expect(checkActiveRssP95([]).withinBudget).toBe(false);
  });
});
