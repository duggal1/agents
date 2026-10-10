import { randomUUID } from "node:crypto";
import type {
  BackgroundJob,
  BackgroundJobHandlers,
  JobPublisher,
  JobWorkerHost,
} from "@sapphire/adapter-kit";
import { dispatchBackgroundJob, parseBackgroundJob } from "@sapphire/adapter-kit";
import { getLogger, runCorrelatedJob, unwrapJobPayload, wrapJobPayload } from "@sapphire/logging";
import Database from "better-sqlite3";
import { recordHistoryCompactAttemptsExhausted } from "./history-compaction.js";

/** Graphile-worker's default when a job sets no max_attempts. */
export const SQLITE_JOB_DEFAULT_MAX_ATTEMPTS = 25;
/** Graphile runner default, mirrored for poll cadence. */
export const SQLITE_JOB_DEFAULT_POLL_INTERVAL_MS = 500;
/** GraphileJobWorkerHost default concurrency, mirrored. */
export const SQLITE_JOB_DEFAULT_CONCURRENCY = 4;
/** Locks left by a dead process become claimable after this. */
export const SQLITE_JOB_DEFAULT_STALE_LOCK_MS = 5 * 60_000;

const JOBS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS background_jobs(
  key TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  runAt INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  lockedBy TEXT,
  lockedAt INTEGER
)`;
const JOBS_DUE_INDEX_DDL = `CREATE INDEX IF NOT EXISTS background_jobs_due
  ON background_jobs(runAt, lockedBy, lockedAt)`;

/**
 * Graphile-worker's retry curve (lib.calculateDelay with its defaults:
 * minDelay 200, multiplier 1.5, maxDelay 30000, jitter 0.5 + random()).
 * `failedAttempt` is 0-based: the first failure passes 0 and retries in
 * roughly 100-300ms.
 */
export function sqliteJobRetryDelayMs(
  failedAttempt: number,
  random: () => number = Math.random,
): number {
  return Math.min(200 * 1.5 ** Math.max(0, failedAttempt), 30_000) * (0.5 + random());
}

export interface SqliteJobQueueOptions {
  /** SQLite file both the API and worker open. Created (with parents) on open. */
  path: string;
  pollIntervalMs?: number;
  concurrency?: number;
  /** Default cap when a job sets no maxAttempts. */
  maxAttempts?: number;
  busyTimeoutMs?: number;
  staleLockMs?: number;
  /** Jitter seam for retry delays. */
  random?: () => number;
}

interface StoredEnvelope {
  v: 1;
  maxAttempts: number;
  payload: unknown;
}

class PoisonJobError extends Error {}

function decodeStoredPayload(stored: string): StoredEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    throw new PoisonJobError("Background job payload is not valid JSON");
  }
  if (raw === null || typeof raw !== "object") {
    throw new PoisonJobError("Background job payload must be a JSON object");
  }
  const envelope = raw as Partial<StoredEnvelope>;
  if (envelope.v !== 1 || !("payload" in envelope)) {
    throw new PoisonJobError("Background job payload has an unknown envelope");
  }
  const maxAttempts =
    typeof envelope.maxAttempts === "number" &&
    Number.isInteger(envelope.maxAttempts) &&
    envelope.maxAttempts >= 1
      ? envelope.maxAttempts
      : SQLITE_JOB_DEFAULT_MAX_ATTEMPTS;
  return { v: 1, maxAttempts, payload: envelope.payload };
}

interface ClaimedJob {
  key: string;
  type: string;
  payload: string;
  attempts: number;
}

/**
 * Durable SQLite-backed background-job queue. One class plays both roles,
 * like InMemoryJobQueue: the API constructs it as a JobPublisher, the worker
 * as a JobWorkerHost, both pointed at the same file.
 *
 * Semantics mirror GraphileJobPublisher/GraphileJobWorkerHost: `replaceKey`
 * upserts (a new enqueue replaces the pending job and resets attempts),
 * cancel-by-key removes the row even if absent, failures retry with the
 * Graphile backoff curve, and per-job maxAttempts travels in the stored
 * row so any process enforces the producer's cap. Claims use BEGIN
 * IMMEDIATE; a dead holder's row lock is reclaimed after `staleLockMs`.
 */
export class SqliteJobQueue implements JobPublisher, JobWorkerHost {
  private readonly db: Database.Database;
  private readonly workerId = randomUUID();
  private readonly pollIntervalMs: number;
  private readonly concurrency: number;
  private readonly defaultMaxAttempts: number;
  private readonly staleLockMs: number;
  private readonly random: () => number;
  private handlers: BackgroundJobHandlers | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly active = new Set<Promise<void>>();
  private stopping = false;
  private closed = false;

  constructor(options: SqliteJobQueueOptions) {
    if (!options.path) throw new Error("SqliteJobQueue needs a database file path");
    this.pollIntervalMs = options.pollIntervalMs ?? SQLITE_JOB_DEFAULT_POLL_INTERVAL_MS;
    this.concurrency = options.concurrency ?? SQLITE_JOB_DEFAULT_CONCURRENCY;
    this.defaultMaxAttempts = options.maxAttempts ?? SQLITE_JOB_DEFAULT_MAX_ATTEMPTS;
    this.staleLockMs = options.staleLockMs ?? SQLITE_JOB_DEFAULT_STALE_LOCK_MS;
    this.random = options.random ?? Math.random;
    if (!Number.isFinite(this.pollIntervalMs) || this.pollIntervalMs < 0) {
      throw new Error("SqliteJobQueue needs a non-negative pollIntervalMs");
    }
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) {
      throw new Error("SqliteJobQueue needs a positive integer concurrency");
    }
    if (!Number.isInteger(this.defaultMaxAttempts) || this.defaultMaxAttempts < 1) {
      throw new Error("SqliteJobQueue needs a positive integer maxAttempts");
    }
    const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    if (!Number.isFinite(busyTimeoutMs) || busyTimeoutMs < 0) {
      throw new Error("SqliteJobQueue needs a non-negative busyTimeoutMs");
    }
    this.db = new Database(options.path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma(`busy_timeout = ${busyTimeoutMs}`);
    this.db.exec(JOBS_TABLE_DDL);
    this.db.exec(JOBS_DUE_INDEX_DDL);
  }

  async enqueue(job: BackgroundJob): Promise<void> {
    if (this.closed) throw new Error("Background job publisher is closed");
    const key = job.replaceKey ?? randomUUID();
    const runAt = job.availableAt ? job.availableAt.getTime() : Date.now();
    if (!Number.isFinite(runAt)) throw new Error("Background job availableAt must be a date");
    const maxAttempts = job.maxAttempts ?? this.defaultMaxAttempts;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new Error("Background job maxAttempts must be a positive integer");
    }
    const stored = JSON.stringify({
      v: 1,
      maxAttempts,
      payload: wrapJobPayload(job.payload),
    } satisfies StoredEnvelope);
    this.db
      .prepare(
        `INSERT INTO background_jobs(key, type, payload, runAt, attempts, lockedBy, lockedAt)
         VALUES (?, ?, ?, ?, 0, NULL, NULL)
         ON CONFLICT(key) DO UPDATE SET
           type = excluded.type,
           payload = excluded.payload,
           runAt = excluded.runAt,
           attempts = 0,
           lockedBy = NULL,
           lockedAt = NULL`,
      )
      .run(key, job.name, stored, runAt);
    if (this.handlers && runAt <= Date.now()) this.kick();
  }

  async cancel(key: string): Promise<void> {
    if (this.closed) throw new Error("Background job publisher is closed");
    this.db.prepare("DELETE FROM background_jobs WHERE key = ?").run(key);
  }

  async start(handlers: BackgroundJobHandlers): Promise<void> {
    if (this.closed) throw new Error("Background job worker is closed");
    if (this.handlers && !this.stopping) return;
    this.handlers = handlers;
    this.stopping = false;
    this.scheduleNext(0);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await Promise.all([...this.active]);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await Promise.all([...this.active]);
    this.handlers = undefined;
    this.db.close();
  }

  private kick(): void {
    if (this.closed || this.stopping || !this.handlers) return;
    this.scheduleNext(0);
  }

  private scheduleNext(delayMs: number): void {
    if (this.closed || this.stopping || !this.handlers) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.poll();
    }, delayMs);
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    try {
      while (
        !this.closed &&
        !this.stopping &&
        this.handlers &&
        this.active.size < this.concurrency
      ) {
        const claimed = this.claimDueJob();
        if (!claimed) break;
        void this.executeClaimed(claimed);
      }
    } finally {
      this.scheduleNext(this.pollIntervalMs);
    }
  }

  private claimDueJob(): ClaimedJob | undefined {
    try {
      this.db.exec("BEGIN IMMEDIATE");
    } catch {
      return undefined;
    }
    try {
      const now = Date.now();
      const row = this.db
        .prepare(
          `SELECT key, type, payload, attempts FROM background_jobs
           WHERE runAt <= ?
             AND (lockedBy IS NULL OR (lockedAt IS NOT NULL AND lockedAt < ?))
           ORDER BY runAt ASC, key ASC
           LIMIT 1`,
        )
        .get(now, now - this.staleLockMs) as
        | { key: string; type: string; payload: string; attempts: number }
        | undefined;
      if (!row) {
        this.db.exec("ROLLBACK");
        return undefined;
      }
      this.db
        .prepare(
          "UPDATE background_jobs SET lockedBy = ?, lockedAt = ?, attempts = ? WHERE key = ?",
        )
        .run(this.workerId, now, row.attempts + 1, row.key);
      this.db.exec("COMMIT");
      return { key: row.key, type: row.type, payload: row.payload, attempts: row.attempts + 1 };
    } catch {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // Claim already failed; cleanup must not mask it.
      }
      return undefined;
    }
  }

  private async executeClaimed(claimed: ClaimedJob): Promise<void> {
    const task = (async () => {
      let envelope: StoredEnvelope;
      let payload: unknown;
      try {
        envelope = decodeStoredPayload(claimed.payload);
        payload = unwrapJobPayload(envelope.payload).payload;
        // Validate before running: unknown names and schema violations are
        // permanent, so they must drop the row instead of retrying forever.
        parseBackgroundJob(claimed.type, payload);
      } catch (error) {
        this.db.prepare("DELETE FROM background_jobs WHERE key = ?").run(claimed.key);
        getLogger().error("dropping poisoned background job", error, { "job.type": claimed.type });
        return;
      }
      const handlers = this.handlers;
      if (!handlers) {
        this.db
          .prepare("UPDATE background_jobs SET lockedBy = NULL, lockedAt = NULL WHERE key = ?")
          .run(claimed.key);
        return;
      }
      try {
        const unpacked = unwrapJobPayload(envelope.payload);
        await runCorrelatedJob({
          name: claimed.type,
          payload: unpacked.payload,
          correlation: unpacked.correlation,
          run: () => dispatchBackgroundJob(handlers, claimed.type, unpacked.payload),
        });
        this.db.prepare("DELETE FROM background_jobs WHERE key = ?").run(claimed.key);
      } catch (error) {
        if (claimed.attempts >= envelope.maxAttempts) {
          this.db.prepare("DELETE FROM background_jobs WHERE key = ?").run(claimed.key);
          recordHistoryCompactAttemptsExhausted(
            {
              task_identifier: claimed.type,
              payload: envelope.payload,
              attempts: claimed.attempts,
              max_attempts: envelope.maxAttempts,
            },
            error,
          );
          return;
        }
        const delay = sqliteJobRetryDelayMs(claimed.attempts - 1, this.random);
        this.db
          .prepare(
            "UPDATE background_jobs SET runAt = ?, lockedBy = NULL, lockedAt = NULL WHERE key = ?",
          )
          .run(Date.now() + Math.round(delay), claimed.key);
      }
    })();
    this.active.add(task);
    try {
      await task;
    } finally {
      this.active.delete(task);
    }
  }
}
