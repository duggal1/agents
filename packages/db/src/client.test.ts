import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDb,
  isTooManyDatabaseConnections,
  parsePositiveInteger,
  retryOnTooManyConnections,
} from "./client.js";

const created: Array<{ $disconnect: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((db) => db.$disconnect()));
});

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "sapphire-db-test-")), "test.db");
}

describe("createDb", () => {
  it("creates parent directories and opens a WAL sqlite database", async () => {
    const filePath = tempDbPath();
    const { prisma } = createDb(filePath);
    created.push(prisma);

    expect(prisma).toBeDefined();
    const check = new Database(filePath, { readonly: true });
    try {
      // journal_mode persists on the database; the other pragmas are
      // per-connection, so they are verified through the adapter below.
      expect(check.pragma("journal_mode", { simple: true })).toBe("wal");
    } finally {
      check.close();
    }
    const busy = (await prisma.$queryRawUnsafe("PRAGMA busy_timeout")) as Array<{
      timeout: number | bigint;
    }>;
    expect(Number(busy[0]?.timeout)).toBe(10000);
    const fk = (await prisma.$queryRawUnsafe("PRAGMA foreign_keys")) as Array<{
      foreign_keys: number | bigint;
    }>;
    expect(Number(fk[0]?.foreign_keys)).toBe(1);
    await expect(prisma.$queryRaw`SELECT 1`).resolves.toBeDefined();
  });
});

describe("parsePositiveInteger", () => {
  it("falls back when the value is missing, zero, or not an integer", () => {
    expect(parsePositiveInteger(undefined, 8)).toBe(8);
    expect(parsePositiveInteger("0", 8)).toBe(8);
    expect(parsePositiveInteger("nope", 8)).toBe(8);
    expect(parsePositiveInteger("6", 8)).toBe(6);
  });
});

describe("isTooManyDatabaseConnections", () => {
  it("never matches on sqlite, which serializes writers instead", () => {
    expect(isTooManyDatabaseConnections({ code: "P2037" })).toBe(false);
    expect(isTooManyDatabaseConnections({ code: "53300" })).toBe(false);
    expect(
      isTooManyDatabaseConnections(
        new Error("Too many database connections opened: sorry, too many clients already"),
      ),
    ).toBe(false);
    expect(isTooManyDatabaseConnections(undefined)).toBe(false);
  });
});

describe("retryOnTooManyConnections", () => {
  it("runs the operation once and returns its result", async () => {
    const sleep = vi.fn(async () => undefined);
    await expect(
      retryOnTooManyConnections(async () => "ok", { sleep }),
    ).resolves.toBe("ok");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("propagates failures without retrying", async () => {
    const error = new Error("boom");
    await expect(
      retryOnTooManyConnections(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
