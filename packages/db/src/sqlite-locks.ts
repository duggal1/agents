import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

const LOCK_TABLE_DDL = `CREATE TABLE IF NOT EXISTS rakazo_locks(
  name TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  acquiredAt INTEGER NOT NULL
)`;

/**
 * Nesting depth per connection. SQLite savepoints let one connection hold
 * nested critical sections under different names; the outermost level owns
 * the BEGIN IMMEDIATE write lock.
 */
const savepointDepth = new WeakMap<Database.Database, number>();

export interface SqliteLockOptions {
  /**
   * Bounded wait for the write lock. On expiry the call fails with a clear
   * error naming the lock instead of blocking forever.
   */
  timeoutMs?: number;
  /** Delay between acquisition attempts while another holder owns the lock. */
  retryIntervalMs?: number;
  /** Test seam for the retry delay. */
  sleep?: (ms: number) => Promise<void>;
  /** Owner token recorded in rakazo_locks for debugging. Defaults to a UUID. */
  owner?: string;
}

function isBusyError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "SQLITE_BUSY"
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Serialize a critical section across processes sharing one SQLite file.
 *
 * Replaces one pg_advisory-lock site: acquires the database write lock with
 * BEGIN IMMEDIATE (held for the duration of `fn`), records ownership in the
 * rakazo_locks table, runs `fn`, then releases. A killed holder's SQLite
 * transaction rolls back with its connection, so the next acquirer proceeds
 * without any stale-lock timeout.
 *
 * Different lock names may nest on one connection (via savepoints);
 * re-entering the same name on one connection fails fast with a clear error.
 * The connection's busy_timeout is forced to 0 during acquisition so the
 * bounded wait is exact, then restored before `fn` runs.
 */
export async function withSqliteLock<T>(
  db: Database.Database,
  name: string,
  fn: () => T | Promise<T>,
  options: SqliteLockOptions = {},
): Promise<T> {
  if (!name) throw new Error("SQLite lock name must not be empty");
  const timeoutMs = options.timeoutMs ?? 5_000;
  const retryIntervalMs = options.retryIntervalMs ?? 10;
  const sleep = options.sleep ?? defaultSleep;
  const owner = options.owner ?? randomUUID();
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error(`SQLite lock "${name}" needs a non-negative timeoutMs`);
  }
  if (!Number.isFinite(retryIntervalMs) || retryIntervalMs < 0) {
    throw new Error(`SQLite lock "${name}" needs a non-negative retryIntervalMs`);
  }

  const depth = savepointDepth.get(db) ?? 0;
  if (depth === 0 && db.inTransaction) {
    throw new Error(`SQLite lock "${name}" needs a connection without an open transaction`);
  }
  const savepoint = `rakazo_lock_${depth}`;
  if (depth > 0) {
    const held = db.prepare("SELECT owner FROM rakazo_locks WHERE name = ?").get(name) as
      | { owner: string }
      | undefined;
    if (held) {
      throw new Error(`SQLite lock "${name}" is not re-entrant on one connection`);
    }
  }

  const previousBusyTimeout = db.pragma("busy_timeout", { simple: true }) as number;
  db.pragma("busy_timeout = 0");
  const deadline = Date.now() + timeoutMs;
  const acquireError = () =>
    new Error(`Timed out acquiring SQLite lock "${name}" after ${timeoutMs}ms`);
  try {
    // Conditional DDL still takes a write lock when the connection's schema
    // cache predates another process's schema change, so creating the table
    // joins the same bounded wait instead of burning the ambient
    // busy_timeout outside of it.
    for (;;) {
      try {
        db.exec(LOCK_TABLE_DDL);
        break;
      } catch (error) {
        if (!isBusyError(error)) throw error;
        if (Date.now() >= deadline) throw acquireError();
        await sleep(retryIntervalMs);
      }
    }
    for (;;) {
      let begun = false;
      try {
        db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
        begun = true;
        const held = db.prepare("SELECT owner FROM rakazo_locks WHERE name = ?").get(name) as
          | { owner: string }
          | undefined;
        if (held) {
          throw new Error(`SQLite lock "${name}" is not re-entrant on one connection`);
        }
        db.prepare("INSERT INTO rakazo_locks(name, owner, acquiredAt) VALUES (?, ?, ?)").run(
          name,
          owner,
          Date.now(),
        );
        break;
      } catch (error) {
        if (begun) {
          try {
            db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
          } catch {
            // Acquisition already failed; the cleanup best-effort must not mask it.
          }
        }
        if (!isBusyError(error)) throw error;
        if (Date.now() >= deadline) throw acquireError();
        await sleep(retryIntervalMs);
      }
    }
  } finally {
    db.pragma(`busy_timeout = ${previousBusyTimeout}`);
  }

  savepointDepth.set(db, depth + 1);
  try {
    const result = await fn();
    db.prepare("DELETE FROM rakazo_locks WHERE name = ? AND owner = ?").run(name, owner);
    db.exec(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    try {
      db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    } catch {
      // The original failure explains the state; cleanup must not mask it.
    }
    throw error;
  } finally {
    if (savepointDepth.get(db) === depth + 1) savepointDepth.set(db, depth);
  }
}
