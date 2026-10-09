import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdapterContext, AgentHomeStore, SandboxProvider } from "@sapphire/adapter-kit";
import type { PrismaClient } from "@sapphire/db";
import { describe, expect, it, vi } from "vitest";
import {
  ComputerBusyError,
  DockerFallbackUnavailableError,
  migrateComputerToFallback,
} from "./computer-lifecycle.js";
import { FakeSandboxProvider } from "./fake-sandbox.js";
import { LocalAgentHomeStore } from "./home.js";
import { FALLBACK_BROWSER_PROFILE_NOTICE } from "./sandbox-fallback.js";

const context = {
  operationId: "test",
  traceId: "test",
  spaceId: "workspace-1",
  userId: "user-1",
  botId: "bot-1",
  signal: new AbortController().signal,
} satisfies AdapterContext;

function computerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "computer-1",
    spaceId: "workspace-1",
    userId: "user-1",
    homeKey: "bot-1",
    homeRevision: "rev-1",
    kind: "e2b",
    providerRef: "e2b-box-1",
    state: "running",
    scope: "team",
    maintenanceId: null,
    controlHolder: "none",
    controlLeaseId: null,
    controlLeaseExpiresAt: null,
    controlBotId: null,
    controlRunId: null,
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** Minimal prisma double: CAS updateMany always succeeds, no live runs. */
function prismaDouble(row: Record<string, unknown>, options?: { liveRun?: boolean }) {
  const updates: unknown[] = [];
  return {
    updates,
    prisma: {
      computer: {
        findUniqueOrThrow: vi.fn(async () => ({ ...row })),
        updateMany: vi.fn(async (args: unknown) => {
          updates.push(args);
          return { count: 1 };
        }),
      },
      run: {
        findFirst: vi.fn(async () => (options?.liveRun ? { id: "run-live" } : null)),
      },
    } as unknown as PrismaClient,
  };
}

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "sapphire-fallback-"));
  const dataDir = path.join(root, "data");
  const snapshots = path.join(root, "snapshots");
  await mkdir(dataDir, { recursive: true });
  const home = new LocalAgentHomeStore(dataDir);
  const primary = new FakeSandboxProvider();
  const fallback = new FakeSandboxProvider();
  return {
    root,
    dataDir,
    snapshots,
    home: home as AgentHomeStore,
    primary: primary as SandboxProvider,
    fallback: fallback as SandboxProvider,
    primaryFake: primary,
    fallbackFake: fallback,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

const migration = (snapshots: string, fallbackAllowed = true) => ({
  primaryKind: "e2b",
  fallbackKind: "docker",
  fallbackAllowed: () => fallbackAllowed,
  snapshotBaseDir: snapshots,
});

describe("migrateComputerToFallback", () => {
  it("provisions a new computer straight onto Docker and lets the turn continue", async () => {
    const env = await setup();
    try {
      const row = computerRow({ providerRef: null, state: "stopped" });
      const { prisma, updates } = prismaDouble(row);
      const result = await migrateComputerToFallback(
        { prisma, primary: env.primary, fallback: env.fallback, home: env.home, dataDir: env.dataDir },
        "computer-1",
        migration(env.snapshots),
        context,
      );
      expect(result.snapshotRestored).toBe(false);
      expect(result.snapshotRefreshed).toBe(false);
      expect(result.interruptedInflight).toBe(false);
      expect(result.notice).toBeNull();
      const activation = updates.at(-1) as { data: Record<string, unknown> };
      expect(activation.data).toMatchObject({ state: "running", kind: "fake" });
      expect(typeof activation.data.providerRef).toBe("string");
    } finally {
      await env.cleanup();
    }
  });

  it("refreshes the snapshot from a reachable primary and restores it into Docker", async () => {
    const env = await setup();
    try {
      // Seed the primary box with completed work.
      const seeded = await env.primaryFake.provision(
        { botId: "bot-1", homePath: path.join(env.dataDir, "home") },
        context,
      );
      await env.primaryFake.writeFile(
        seeded,
        { path: "notes.md", content: new TextEncoder().encode("completed work") },
        context,
      );
      const row = computerRow({ providerRef: seeded.id });
      const { prisma } = prismaDouble(row);
      const result = await migrateComputerToFallback(
        { prisma, primary: env.primary, fallback: env.fallback, home: env.home, dataDir: env.dataDir },
        "computer-1",
        migration(env.snapshots),
        context,
      );
      expect(result.snapshotRefreshed).toBe(true);
      expect(result.snapshotRestored).toBe(true);
      expect(result.interruptedInflight).toBe(true);
      expect(result.notice).toBe(FALLBACK_BROWSER_PROFILE_NOTICE);
      // The restored file is readable on the Docker computer.
      const restored = await env.fallbackFake.readFile(result.computer, "notes.md", context);
      expect(new TextDecoder().decode(restored)).toBe("completed work");
    } finally {
      await env.cleanup();
    }
  });

  it("restores the last completed snapshot when the primary is unreachable", async () => {
    const env = await setup();
    try {
      // Last completed checkpoint in the home store.
      const src = path.join(env.root, "src");
      await mkdir(src, { recursive: true });
      await writeFile(path.join(src, "plan.md"), "last completed plan");
      await env.home.commit("bot-1", src, context);
      const unreachable = new FakeSandboxProvider() as unknown as SandboxProvider & {
        exportWorkspace: ReturnType<typeof vi.fn>;
      };
      unreachable.exportWorkspace = vi.fn(async function* () {
        throw Object.assign(new Error("402 Payment Required: out of credits"), { status: 402 });
        yield { path: "x", content: new Uint8Array() };
      });
      const row = computerRow({ providerRef: "e2b-dead" });
      const { prisma } = prismaDouble(row);
      const result = await migrateComputerToFallback(
        { prisma, primary: unreachable, fallback: env.fallback, home: env.home, dataDir: env.dataDir },
        "computer-1",
        migration(env.snapshots),
        context,
      );
      expect(result.snapshotRefreshed).toBe(false);
      expect(result.snapshotRestored).toBe(true);
      expect(result.interruptedInflight).toBe(true);
      const restored = await env.fallbackFake.readFile(result.computer, "plan.md", context);
      expect(new TextDecoder().decode(restored)).toBe("last completed plan");
    } finally {
      await env.cleanup();
    }
  });

  it("refuses while a live run owns the computer and provisions nothing", async () => {
    const env = await setup();
    try {
      const provision = vi.spyOn(env.fallbackFake, "provision");
      const { prisma } = prismaDouble(computerRow(), { liveRun: true });
      await expect(
        migrateComputerToFallback(
          { prisma, primary: env.primary, fallback: env.fallback, home: env.home, dataDir: env.dataDir },
          "computer-1",
          migration(env.snapshots),
          context,
        ),
      ).rejects.toBeInstanceOf(ComputerBusyError);
      expect(provision).not.toHaveBeenCalled();
    } finally {
      await env.cleanup();
    }
  });

  it("keeps the backend healthy with computer-unavailable when fallback is disabled", async () => {
    const env = await setup();
    try {
      const provision = vi.spyOn(env.fallbackFake, "provision");
      const { prisma } = prismaDouble(computerRow());
      await expect(
        migrateComputerToFallback(
          { prisma, primary: env.primary, fallback: env.fallback, home: env.home, dataDir: env.dataDir },
          "computer-1",
          migration(env.snapshots, false),
          context,
        ),
      ).rejects.toBeInstanceOf(DockerFallbackUnavailableError);
      expect(provision).not.toHaveBeenCalled();
    } finally {
      await env.cleanup();
    }
  });

  it("never routes to the host desktop provider", async () => {
    const env = await setup();
    try {
      const { prisma } = prismaDouble(computerRow());
      await expect(
        migrateComputerToFallback(
          { prisma, primary: env.primary, fallback: env.fallback, home: env.home, dataDir: env.dataDir },
          "computer-1",
          { ...migration(env.snapshots), fallbackKind: "desktop" },
          context,
        ),
      ).rejects.toThrow(/never route to the host desktop/);
    } finally {
      await env.cleanup();
    }
  });

  it("is idempotent when the computer already migrated", async () => {
    const env = await setup();
    try {
      const provision = vi.spyOn(env.fallbackFake, "provision");
      const { prisma } = prismaDouble(computerRow({ kind: "docker", providerRef: "docker-1" }));
      const result = await migrateComputerToFallback(
        { prisma, primary: env.primary, fallback: env.fallback, home: env.home, dataDir: env.dataDir },
        "computer-1",
        migration(env.snapshots),
        context,
      );
      expect(result.interruptedInflight).toBe(false);
      expect(result.notice).toBeNull();
      expect(provision).not.toHaveBeenCalled();
    } finally {
      await env.cleanup();
    }
  });
});
