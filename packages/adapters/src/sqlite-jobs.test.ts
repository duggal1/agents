import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BackgroundJobHandlers } from "@sapphire/adapter-kit";
import { historyCompactJob, messagingDeliverJob, runContinueJob } from "@sapphire/adapter-kit";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteJobQueue, sqliteJobRetryDelayMs } from "./sqlite-jobs.js";

function handlers(): BackgroundJobHandlers {
  return {
    "run.continue": vi.fn(async () => undefined),
    "routine.wakeup": vi.fn(async () => undefined),
    "computer.update": vi.fn(async () => undefined),
    "computer.sleep": vi.fn(async () => undefined),
    "computer.control-expire": vi.fn(async () => undefined),
    "skill.teaching-expire": vi.fn(async () => undefined),
    "history.compact": vi.fn(async () => undefined),
    "messaging.deliver": vi.fn(async () => undefined),
    "cloud_agent.poll": vi.fn(async () => undefined),
  };
}

async function waitFor(assertion: () => void, timeoutMs = 5_000): Promise<void> {
  await vi.waitFor(assertion, { timeout: timeoutMs, interval: 10 });
}

describe("SqliteJobQueue", () => {
  let dir = "";
  let dbPath = "";
  let queues: SqliteJobQueue[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rakazo-sqlite-jobs-"));
    dbPath = path.join(dir, "jobs.db");
    queues = [];
  });

  afterEach(async () => {
    for (const queue of queues) await queue.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function open(options?: Partial<ConstructorParameters<typeof SqliteJobQueue>[0]>) {
    const queue = new SqliteJobQueue({
      path: dbPath,
      pollIntervalMs: 10,
      random: () => 0,
      ...options,
    });
    queues.push(queue);
    return queue;
  }

  function rowCount(): number {
    const probe = new Database(dbPath, { readonly: true });
    try {
      return (probe.prepare("SELECT COUNT(*) AS n FROM background_jobs").get() as { n: number }).n;
    } finally {
      probe.close();
    }
  }

  it("dispatches an enqueued job to the matching handler", async () => {
    const queue = open();
    const seen = handlers();
    await queue.start(seen);
    await queue.enqueue(runContinueJob("run-1"));
    await waitFor(() => expect(seen["run.continue"]).toHaveBeenCalledWith({ runId: "run-1" }));
    expect(rowCount()).toBe(0);
  });

  it("holds delayed jobs until their runAt passes", async () => {
    const queue = open();
    const seen = handlers();
    await queue.start(seen);
    await queue.enqueue(messagingDeliverJob("run-9", new Date(Date.now() + 300)));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(seen["messaging.deliver"]).not.toHaveBeenCalled();
    await waitFor(() => expect(seen["messaging.deliver"]).toHaveBeenCalledWith({ runId: "run-9" }));
  });

  it("replaces a pending job on the same replaceKey with the latest payload", async () => {
    const queue = open();
    const seen = handlers();
    await queue.enqueue(runContinueJob("first"));
    await queue.enqueue(runContinueJob("first"));
    await queue.start(seen);
    await waitFor(() => expect(seen["run.continue"]).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(seen["run.continue"]).toHaveBeenCalledTimes(1);
    expect(rowCount()).toBe(0);
  });

  it("cancels a pending job by key", async () => {
    const queue = open();
    const seen = handlers();
    await queue.start(seen);
    await queue.enqueue(messagingDeliverJob("run-7", new Date(Date.now() + 5_000)));
    await queue.cancel("messaging.deliver:run-7");
    await queue.cancel("messaging.deliver:missing");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(seen["messaging.deliver"]).not.toHaveBeenCalled();
    expect(rowCount()).toBe(0);
  });

  it("retries failures with backoff and drops the row after maxAttempts", async () => {
    const queue = open();
    const seen = handlers();
    let calls = 0;
    (seen["history.compact"] as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      calls += 1;
      throw new Error("boom");
    });
    await queue.start(seen);
    await queue.enqueue({ ...historyCompactJob("thread-1"), maxAttempts: 3 });
    await waitFor(() => expect(calls).toBe(3), 10_000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(calls).toBe(3);
    expect(rowCount()).toBe(0);
  });

  it("delivers jobs enqueued before the worker starts", async () => {
    const publisher = open();
    await publisher.enqueue(runContinueJob("early"));
    const seen = handlers();
    await publisher.start(seen);
    await waitFor(() => expect(seen["run.continue"]).toHaveBeenCalledWith({ runId: "early" }));
  });

  it("shares durable state across instances on one file", async () => {
    const publisher = open();
    const worker = open();
    const seen = handlers();
    await worker.start(seen);
    await publisher.enqueue(runContinueJob("shared"));
    await waitFor(() => expect(seen["run.continue"]).toHaveBeenCalledWith({ runId: "shared" }));
  });

  it("reclaims a stale lock left by a dead holder", async () => {
    const queue = open({ staleLockMs: 50 });
    const seen = handlers();
    await queue.start(seen);
    await queue.enqueue(runContinueJob("orphan"));
    await waitFor(() => expect(rowCount()).toBe(1));
    const poke = new Database(dbPath);
    try {
      poke
        .prepare("UPDATE background_jobs SET lockedBy = ?, lockedAt = ? WHERE key = ?")
        .run("dead-worker", Date.now() - 10_000, "run:orphan");
    } finally {
      poke.close();
    }
    await waitFor(() => expect(seen["run.continue"]).toHaveBeenCalledWith({ runId: "orphan" }));
  });

  it("does not steal a fresh lock held by another worker", async () => {
    const queue = open({ staleLockMs: 60_000 });
    const seen = handlers();
    await queue.start(seen);
    await queue.enqueue(runContinueJob("held"));
    await waitFor(() => expect(rowCount()).toBe(1));
    const poke = new Database(dbPath);
    try {
      poke
        .prepare("UPDATE background_jobs SET lockedBy = ?, lockedAt = ? WHERE key = ?")
        .run("live-worker", Date.now(), "run:held");
    } finally {
      poke.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(seen["run.continue"]).not.toHaveBeenCalled();
    expect(rowCount()).toBe(1);
  });

  it("drops malformed payload rows without stalling the loop", async () => {
    const queue = open();
    const seen = handlers();
    await queue.start(seen);
    const poke = new Database(dbPath);
    try {
      poke
        .prepare(
          "INSERT INTO background_jobs(key, type, payload, runAt, attempts) VALUES (?, ?, ?, ?, 0)",
        )
        .run("bad:1", "run.continue", "not-json{{", Date.now());
      poke
        .prepare(
          "INSERT INTO background_jobs(key, type, payload, runAt, attempts) VALUES (?, ?, ?, ?, 0)",
        )
        .run(
          "bad:2",
          "nope.task",
          JSON.stringify({ v: 1, maxAttempts: 2, payload: {} }),
          Date.now(),
        );
    } finally {
      poke.close();
    }
    await queue.enqueue(runContinueJob("healthy"));
    await waitFor(() => expect(seen["run.continue"]).toHaveBeenCalledWith({ runId: "healthy" }));
    expect(rowCount()).toBe(0);
  });

  it("close() stops polling and rejects further use", async () => {
    const queue = open();
    const seen = handlers();
    await queue.start(seen);
    await queue.close();
    await queue.close();
    await expect(queue.enqueue(runContinueJob("late"))).rejects.toThrow("closed");
    await expect(queue.cancel("run:late")).rejects.toThrow("closed");
    await expect(queue.start(seen)).rejects.toThrow("closed");
    expect(seen["run.continue"]).not.toHaveBeenCalled();
  });

  it("stop() drains in-flight work and allows restart", async () => {
    const queue = open();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen = handlers();
    (seen["run.continue"] as ReturnType<typeof vi.fn>).mockImplementation(() => gate);
    await queue.start(seen);
    await queue.enqueue(runContinueJob("slow"));
    await waitFor(() => expect(seen["run.continue"]).toHaveBeenCalledTimes(1));
    const stopping = queue.stop();
    release();
    await stopping;
    await queue.start(seen);
    await queue.enqueue(runContinueJob("after"));
    await waitFor(() => expect(seen["run.continue"]).toHaveBeenCalledTimes(2));
  });

  it("mirrors the graphile retry curve within its documented bounds", () => {
    expect(sqliteJobRetryDelayMs(0, () => 0)).toBe(100);
    expect(sqliteJobRetryDelayMs(0, () => 1)).toBe(300);
    expect(sqliteJobRetryDelayMs(1, () => 0)).toBe(150);
    expect(sqliteJobRetryDelayMs(1, () => 1)).toBe(450);
    expect(sqliteJobRetryDelayMs(1_000, () => 1)).toBe(45_000);
  });
});
