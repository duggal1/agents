import type { RealtimeFanout } from "@sapphire/adapter-kit";
import Database from "better-sqlite3";

export const SQLITE_FANOUT_DEFAULT_POLL_INTERVAL_MS = 500;
/** Slow-subscriber catch-up window before old rows are pruned. */
export const SQLITE_FANOUT_DEFAULT_RETENTION_MS = 5 * 60_000;
const POLL_BATCH_SIZE = 200;

const EVENTS_TABLE_DDL = `CREATE TABLE IF NOT EXISTS realtime_events(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  payload TEXT NOT NULL,
  createdAt INTEGER NOT NULL
)`;
const EVENTS_CHANNEL_INDEX_DDL = `CREATE INDEX IF NOT EXISTS realtime_events_channel_seq
  ON realtime_events(channel, seq)`;

export interface PollingRealtimeOptions {
  /** SQLite file shared by every process. Created (with parents) on open. */
  path: string;
  pollIntervalMs?: number;
  busyTimeoutMs?: number;
  /**
   * Rows older than this are pruned on publish. Must comfortably exceed the
   * poll interval so a restarted process still catches up. Set to 0 or a
   * negative number to disable pruning (the table then grows without bound).
   */
  retentionMs?: number;
}

type Subscriber = (payload: string) => void;

/**
 * SQLite-backed RealtimeFanout. Publishers append to the realtime_events
 * table; each instance polls the channels it subscribes to and delivers new
 * rows in seq order with per-topic high-water dedupe.
 *
 * Delivery is new-messages-only like LISTEN/NOTIFY: subscribing starts from
 * the current max seq, so rows published before the subscription are never
 * replayed. Unlike the Postgres NOTIFY path there is no payload size cap;
 * unlike the in-memory path, delivery crosses processes. A process down
 * longer than `retentionMs` may miss messages; that tradeoff is inherent to
 * polling without a durable subscriber registry.
 */
export class PollingRealtimeFanout implements RealtimeFanout {
  private readonly db: Database.Database;
  private readonly pollIntervalMs: number;
  private readonly retentionMs: number;
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly lastSeq = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private polling = false;
  private closed = false;

  constructor(options: PollingRealtimeOptions) {
    if (!options.path) throw new Error("PollingRealtimeFanout needs a database file path");
    this.pollIntervalMs = options.pollIntervalMs ?? SQLITE_FANOUT_DEFAULT_POLL_INTERVAL_MS;
    this.retentionMs = options.retentionMs ?? SQLITE_FANOUT_DEFAULT_RETENTION_MS;
    if (!Number.isFinite(this.pollIntervalMs) || this.pollIntervalMs < 0) {
      throw new Error("PollingRealtimeFanout needs a non-negative pollIntervalMs");
    }
    const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    if (!Number.isFinite(busyTimeoutMs) || busyTimeoutMs < 0) {
      throw new Error("PollingRealtimeFanout needs a non-negative busyTimeoutMs");
    }
    this.db = new Database(options.path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma(`busy_timeout = ${busyTimeoutMs}`);
    this.db.exec(EVENTS_TABLE_DDL);
    this.db.exec(EVENTS_CHANNEL_INDEX_DDL);
  }

  describe() {
    return {
      id: "sqlite-poll",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { distributed: true, push: false },
    };
  }

  async publish(topic: string, payload: string): Promise<void> {
    if (this.closed) throw new Error("Realtime fanout is closed");
    const now = Date.now();
    this.db
      .prepare("INSERT INTO realtime_events(channel, payload, createdAt) VALUES (?, ?, ?)")
      .run(topic, payload, now);
    if (this.retentionMs > 0) {
      this.db
        .prepare("DELETE FROM realtime_events WHERE createdAt < ?")
        .run(now - this.retentionMs);
    }
  }

  async subscribe(topic: string, onMessage: Subscriber): Promise<() => Promise<void>> {
    if (this.closed) throw new Error("Realtime fanout is closed");
    const topicSubscribers = this.subscribers.get(topic) ?? new Set<Subscriber>();
    topicSubscribers.add(onMessage);
    this.subscribers.set(topic, topicSubscribers);
    if (!this.lastSeq.has(topic)) {
      const row = this.db
        .prepare("SELECT MAX(seq) AS maxSeq FROM realtime_events WHERE channel = ?")
        .get(topic) as { maxSeq: number | null };
      this.lastSeq.set(topic, row.maxSeq ?? 0);
    }
    this.scheduleNext(0);

    let subscribed = true;
    return async () => {
      if (!subscribed) return;
      subscribed = false;
      const current = this.subscribers.get(topic);
      current?.delete(onMessage);
      if (current?.size === 0) {
        this.subscribers.delete(topic);
        this.lastSeq.delete(topic);
      }
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.subscribers.clear();
    this.lastSeq.clear();
    this.db.close();
  }

  private scheduleNext(delayMs: number): void {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.poll();
    }, delayMs);
    this.timer.unref?.();
  }

  private async poll(): Promise<void> {
    if (this.polling || this.closed) {
      this.scheduleNext(this.pollIntervalMs);
      return;
    }
    this.polling = true;
    try {
      for (const topic of [...this.subscribers.keys()]) {
        if (this.closed) break;
        this.deliverTopic(topic);
      }
    } finally {
      this.polling = false;
      this.scheduleNext(this.pollIntervalMs);
    }
  }

  private deliverTopic(topic: string): void {
    const subscribers = this.subscribers.get(topic);
    if (!subscribers || subscribers.size === 0) return;
    for (;;) {
      const from = this.lastSeq.get(topic) ?? 0;
      let rows: Array<{ seq: number; payload: string }>;
      try {
        rows = this.db
          .prepare(
            `SELECT seq, payload FROM realtime_events
             WHERE channel = ? AND seq > ?
             ORDER BY seq ASC
             LIMIT ${POLL_BATCH_SIZE}`,
          )
          .all(topic, from) as Array<{ seq: number; payload: string }>;
      } catch {
        return;
      }
      if (rows.length === 0) return;
      for (const row of rows) {
        for (const subscriber of [...subscribers]) {
          try {
            subscriber(row.payload);
          } catch {
            // One broken local subscriber must not block the others.
          }
        }
        this.lastSeq.set(topic, row.seq);
      }
      if (rows.length < POLL_BATCH_SIZE) return;
    }
  }
}
