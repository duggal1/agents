import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withSqliteLock } from "./sqlite-locks.js";

describe("withSqliteLock", () => {
  let dir = "";
  let dbPath = "";
  let handles: Database.Database[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rakazo-sqlite-locks-"));
    dbPath = path.join(dir, "locks.db");
  });

  afterEach(async () => {
    for (const handle of handles) {
      try {
        handle.close();
      } catch {
        // A killed-holder simulation may leave the handle unusable; ignore.
      }
    }
    handles = [];
    await rm(dir, { recursive: true, force: true });
  });

  function open(): Database.Database {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    handles.push(db);
    return db;
  }

  function lockRowCount(db: Database.Database): number {
    return (db.prepare("SELECT COUNT(*) AS n FROM rakazo_locks").get() as { n: number }).n;
  }

  it("runs the critical section and releases the lock row", async () => {
    const db = open();
    const result = await withSqliteLock(db, "alpha", () => 42);
    expect(result).toBe(42);
    expect(lockRowCount(db)).toBe(0);
  });

  it("serializes two holders across two connections", async () => {
    const a = open();
    const b = open();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = withSqliteLock(a, "shared", async () => {
      order.push("a-enter");
      await gate;
      order.push("a-exit");
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const waiting = withSqliteLock(b, "shared", () => {
      order.push("b");
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(order).toEqual(["a-enter"]);
    release();
    await holding;
    await waiting;
    expect(order).toEqual(["a-enter", "a-exit", "b"]);
  });

  it("times out with a clear error naming the lock", async () => {
    const a = open();
    const b = open();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holding = withSqliteLock(a, "contended", () => gate);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(
      withSqliteLock(b, "contended", () => undefined, { timeoutMs: 100, retryIntervalMs: 5 }),
    ).rejects.toThrow('Timed out acquiring SQLite lock "contended" after 100ms');
    release();
    await holding;
    await expect(
      withSqliteLock(b, "contended", () => "recovered", { timeoutMs: 1_000 }),
    ).resolves.toBe("recovered");
  });

  it("releases the lock when the critical section throws", async () => {
    const db = open();
    await expect(
      withSqliteLock(db, "failing", () => {
        throw new Error("critical failure");
      }),
    ).rejects.toThrow("critical failure");
    expect(lockRowCount(db)).toBe(0);
    await expect(withSqliteLock(db, "failing", () => "ok")).resolves.toBe("ok");
  });

  it("lets a new holder in after the previous handle dies mid-lock", async () => {
    const victim = open();
    victim.exec(
      "CREATE TABLE IF NOT EXISTS rakazo_locks(name TEXT PRIMARY KEY, owner TEXT NOT NULL, acquiredAt INTEGER NOT NULL)",
    );
    victim.exec("BEGIN IMMEDIATE");
    victim
      .prepare("INSERT INTO rakazo_locks(name, owner, acquiredAt) VALUES (?, ?, ?)")
      .run("doomed", "dead-process", Date.now());
    try {
      victim.close();
    } catch {
      // Closing mid-transaction is the kill simulation; ignore handle errors.
    }
    handles = handles.filter((handle) => handle !== victim);
    const survivor = open();
    await expect(
      withSqliteLock(survivor, "doomed", () => "recovered", { timeoutMs: 2_000 }),
    ).resolves.toBe("recovered");
  });

  it("nests different locks on one connection and rejects same-name re-entry", async () => {
    const db = open();
    const result = await withSqliteLock(db, "outer", async () =>
      withSqliteLock(db, "inner", () => "nested"),
    );
    expect(result).toBe("nested");
    await expect(
      withSqliteLock(db, "same", () => withSqliteLock(db, "same", () => "x")),
    ).rejects.toThrow('SQLite lock "same" is not re-entrant on one connection');
    expect(lockRowCount(db)).toBe(0);
  });

  it("rejects empty names and negative timeouts", async () => {
    const db = open();
    await expect(withSqliteLock(db, "", () => undefined)).rejects.toThrow("must not be empty");
    await expect(withSqliteLock(db, "x", () => undefined, { timeoutMs: -1 })).rejects.toThrow(
      "non-negative timeoutMs",
    );
  });
});
