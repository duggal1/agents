import { AsyncLocalStorage } from "node:async_hooks";
import Database from "better-sqlite3";
import { type SqliteLockOptions, withSqliteLock } from "./sqlite-locks.js";

/**
 * Cross-process named locks replacing `pg_advisory_xact_lock`. Lock state
 * lives in a sidecar table of a shared SQLite file so api and worker
 * serialize on the same names. The file resolves from an explicit path,
 * else the `file:` DATABASE_URL both processes already share; without a
 * file database the lock degrades to a process-local mutex (correct for
 * single-process tests, best-effort otherwise).
 *
 * Nesting: the same name re-enters directly (this flow already holds it);
 * a different name acquires on a free pooled handle so quota-inside-space
 * style critical sections still block correctly.
 */
const MAX_HANDLES_PER_FILE = 4;

type PooledHandle = { db: Database.Database; heldBy: object | null };

const pools = new Map<string, PooledHandle[]>();
const heldNames = new AsyncLocalStorage<Set<string>>();

function poolFor(file: string): PooledHandle[] {
  const existing = pools.get(file);
  if (existing) return existing;
  const created: PooledHandle[] = [];
  pools.set(file, created);
  return created;
}

function acquireHandle(file: string): PooledHandle {
  const pool = poolFor(file);
  const free = pool.find((handle) => handle.heldBy === null);
  if (free) return free;
  if (pool.length < MAX_HANDLES_PER_FILE) {
    const db = new Database(file);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 10000");
    const handle: PooledHandle = { db, heldBy: null };
    pool.push(handle);
    return handle;
  }
  throw new Error(`No free SQLite lock handle for ${file} (pool exhausted)`);
}

const localChains = new Map<string, Promise<unknown>>();

export function sqliteDbFileFromDatabaseUrl(url: string | undefined): string | null {
  if (!url) return null;
  const match = url.match(/^file:([^?]+)(\?.*)?$/);
  const path = match?.[1]?.trim();
  return path ? path : null;
}

export type NamedLockOptions = SqliteLockOptions & {
  /** Shared file. Defaults to the `file:` DATABASE_URL. */
  dbFile?: string;
};

export async function withNamedLock<T>(
  name: string,
  fn: () => T | Promise<T>,
  options: NamedLockOptions = {},
): Promise<T> {
  const held = heldNames.getStore();
  if (held?.has(name)) return fn();
  const file = options.dbFile ?? sqliteDbFileFromDatabaseUrl(process.env.DATABASE_URL);
  if (!file) {
    // No shared file: serialize within this process.
    const previous = localChains.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    localChains.set(
      name,
      previous.then(() => current),
    );
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (localChains.get(name) === current) localChains.delete(name);
    }
  }
  const handle = acquireHandle(file);
  const token = {};
  handle.heldBy = token;
  const nextHeld = new Set(held ?? []);
  nextHeld.add(name);
  try {
    return await heldNames.run(nextHeld, () => withSqliteLock(handle.db, name, fn, options));
  } finally {
    if (handle.heldBy === token) handle.heldBy = null;
  }
}
