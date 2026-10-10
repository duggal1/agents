import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { getLogger } from "@sapphire/logging";
import Database from "better-sqlite3";
import { PrismaClient } from "./generated/prisma/client.js";

export type Db = PrismaClient;

export function createDb(filePath: string): { prisma: PrismaClient } {
  if (filePath !== ":memory:") {
    mkdirSync(dirname(filePath), { recursive: true });
  }
  // journal_mode is persistent: set once here so the adapter's own connection
  // inherits WAL without needing access to it.
  const setup = new Database(filePath);
  try {
    setup.pragma("journal_mode = WAL");
  } finally {
    setup.close();
  }
  // timeout is better-sqlite3's busy_timeout; the adapter opens and owns its
  // single connection from this url.
  const url = filePath === ":memory:" ? ":memory:" : `file:${filePath}`;
  const adapter = new PrismaBetterSqlite3({ url, timeout: 10_000 });
  const prisma = new PrismaClient({ adapter });
  // foreign_keys is per-connection. The adapter executes queries serially in
  // call order on one connection, and this is submitted before any caller
  // query can be, so it always lands first.
  void prisma.$queryRawUnsafe("PRAGMA foreign_keys = ON").catch((error: unknown) => {
    getLogger().error("failed to enable sqlite foreign keys", error);
  });
  return { prisma };
}

// SQLite serializes writers instead of surfacing "too many clients", so these
// never match. They stay exported because the queue and worker call sites
// (owned by a follow-up migration step) still import them.
export function isTooManyDatabaseConnections(_error: unknown): boolean {
  return false;
}

export async function retryOnTooManyConnections<T>(
  operation: () => Promise<T>,
  _options: {
    attempts?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  return operation();
}

export function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export * from "./generated/prisma/client.js";
export { Prisma, PrismaClient } from "./generated/prisma/client.js";
