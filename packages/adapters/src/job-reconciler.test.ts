import type { BackgroundJob, JobPublisher } from "@sapphire/adapter-kit";
import { stuckWorkStatusMessages } from "@sapphire/core";
import type { PrismaClient, ThreadEvents } from "@sapphire/db";
import { describe, expect, it, vi } from "vitest";
import { returnBotMessageOutcome } from "./bot-messages.js";
import { createJobReconciler } from "./job-reconciler.js";

vi.mock("./bot-messages.js", () => ({ returnBotMessageOutcome: vi.fn() }));

function publisher() {
  const enqueue = vi.fn(async (_job: BackgroundJob) => undefined);
  const jobs: JobPublisher = {
    enqueue,
    cancel: async () => undefined,
    close: async () => undefined,
  };
  return { jobs, enqueue };
}

function fakePrisma(
  runs: Array<{ id: string; updatedAt: Date }> = [],
  routines: Array<{ id: string; nextRunAt: Date | null }> = [],
  controls: Array<{
    id: string;
    controlBotId: string | null;
    controlLeaseId: string | null;
    controlLeaseExpiresAt: Date | null;
    updatedAt: Date;
  }> = [],
) {
  return {
    run: { findMany: vi.fn(async () => runs) },
    routine: { findMany: vi.fn(async () => routines) },
    computer: { findMany: vi.fn(async () => controls) },
    messagingOutbound: { findFirst: vi.fn(async () => null) },
  } as unknown as PrismaClient;
}

describe("createJobReconciler", () => {
  it("continues the main scans when an auxiliary reconciler fails", async () => {
    const prisma = fakePrisma();
    const { jobs } = publisher();
    const reconcileCloudAgents = vi.fn(async () => {
      throw new Error("cloud unavailable");
    });
    const reconcileComputerUpdates = vi.fn(() => {
      throw new Error("queue unavailable");
    });
    await createJobReconciler({
      prisma,
      jobs,
      reconcileCloudAgents,
      reconcileComputerUpdates,
    }).reconcileOnce();
    expect(reconcileCloudAgents).toHaveBeenCalledOnce();
    expect(reconcileComputerUpdates).toHaveBeenCalledOnce();
    expect(prisma.run.findMany).toHaveBeenCalled();
    expect(prisma.routine.findMany).toHaveBeenCalled();
    expect(prisma.computer.findMany).toHaveBeenCalled();
    expect(prisma.messagingOutbound.findFirst).toHaveBeenCalled();
  });

  it("restores a due pending messaging outbox drain", async () => {
    const prisma = fakePrisma();
    vi.mocked(prisma.messagingOutbound.findFirst).mockResolvedValue({ id: "outbound-1" } as never);
    const { jobs, enqueue } = publisher();

    await createJobReconciler({ prisma, jobs }).reconcileOnce();

    expect(prisma.messagingOutbound.findFirst).toHaveBeenCalledWith({
      where: {
        status: "pending",
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: expect.any(Date) } }],
      },
      select: { id: true },
    });
    expect(enqueue).toHaveBeenCalledWith({
      name: "messaging.deliver",
      payload: {},
      replaceKey: "messaging.deliver:drain",
    });
  });

  it("restores a completed messaging run that was not durably mirrored", async () => {
    const prisma = fakePrisma();
    vi.mocked(prisma.run.findMany)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "run-unmirrored" }] as never);
    const { jobs, enqueue } = publisher();

    await createJobReconciler({ prisma, jobs }).reconcileOnce();

    expect(prisma.run.findMany).toHaveBeenCalledWith({
      where: { trigger: "messaging", status: "completed", messagingMirroredAt: null },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: 100,
      select: { id: true },
    });
    expect(enqueue).toHaveBeenCalledWith({
      name: "messaging.deliver",
      payload: { runId: "run-unmirrored" },
      replaceKey: "messaging.deliver:run-unmirrored",
    });
  });

  it("restores queued runs and near-due routines with stable replacement keys", async () => {
    const scheduledFor = new Date(Date.now() + 30_000);
    const controlExpiresAt = new Date(Date.now() + 15_000);
    const prisma = fakePrisma(
      [{ id: "run-1", updatedAt: new Date() }],
      [{ id: "routine-1", nextRunAt: scheduledFor }],
      [
        {
          id: "computer-1",
          controlBotId: "bot-1",
          controlLeaseId: "lease-1",
          controlLeaseExpiresAt: controlExpiresAt,
          updatedAt: new Date(),
        },
      ],
    );
    const { jobs, enqueue } = publisher();
    const reconciler = createJobReconciler({ prisma, jobs });

    await reconciler.reconcileOnce();

    expect(enqueue).toHaveBeenCalledWith({
      name: "run.continue",
      payload: { runId: "run-1" },
      replaceKey: "run:run-1",
    });
    expect(enqueue).toHaveBeenCalledWith({
      name: "routine.wakeup",
      payload: { routineId: "routine-1", scheduledFor: scheduledFor.toISOString() },
      availableAt: scheduledFor,
      replaceKey: "routine:routine-1",
    });
    expect(enqueue).toHaveBeenCalledWith({
      name: "computer.control-expire",
      payload: { computerId: "computer-1", leaseId: "lease-1" },
      availableAt: controlExpiresAt,
      replaceKey: "computer.control-expire:computer-1:lease-1",
    });
    expect(vi.mocked(prisma.computer.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { controlLeaseId: { not: null } },
            {
              OR: [
                { controlLeaseExpiresAt: null },
                { controlLeaseExpiresAt: { lte: expect.any(Date) } },
              ],
            },
          ],
        },
        orderBy: [{ controlLeaseExpiresAt: "asc" }, { id: "asc" }],
      }),
    );
  });

  it("restores expiry for orphaned user-control leases without a control bot", async () => {
    const controlExpiresAt = new Date(Date.now() - 5_000);
    const prisma = fakePrisma(
      [],
      [],
      [
        {
          id: "computer-orphan",
          controlBotId: null,
          controlLeaseId: "lease-orphan",
          controlLeaseExpiresAt: controlExpiresAt,
          updatedAt: new Date(),
        },
      ],
    );
    const { jobs, enqueue } = publisher();

    await createJobReconciler({ prisma, jobs }).reconcileOnce();

    expect(enqueue).toHaveBeenCalledWith({
      name: "computer.control-expire",
      payload: { computerId: "computer-orphan", leaseId: "lease-orphan" },
      availableAt: controlExpiresAt,
      replaceKey: "computer.control-expire:computer-orphan:lease-orphan",
    });
  });

  it("finishes a frozen control scan before admitting leases ahead of its cursor", async () => {
    const firstExpiry = new Date(Date.now() + 10_000);
    const secondExpiry = new Date(Date.now() + 20_000);
    const controls = [
      {
        id: "computer-1",
        controlBotId: "bot-1",
        controlLeaseId: "lease-1",
        controlLeaseExpiresAt: firstExpiry,
      },
      {
        id: "computer-2",
        controlBotId: "bot-2",
        controlLeaseId: "lease-2",
        controlLeaseExpiresAt: secondExpiry,
      },
      {
        id: "computer-3",
        controlBotId: "bot-3",
        controlLeaseId: "lease-3",
        controlLeaseExpiresAt: null,
      },
    ];
    const computerFindMany = vi
      .fn()
      .mockResolvedValueOnce(controls.slice(0, 2))
      .mockResolvedValueOnce(controls.slice(2))
      .mockResolvedValueOnce([
        {
          id: "computer-0",
          controlBotId: "bot-0",
          controlLeaseId: "lease-0",
          controlLeaseExpiresAt: firstExpiry,
        },
      ]);
    const prisma = {
      run: { findMany: vi.fn(async () => []) },
      routine: { findMany: vi.fn(async () => []) },
      computer: { findMany: computerFindMany },
      messagingOutbound: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaClient;
    const { jobs, enqueue } = publisher();
    const reconciler = createJobReconciler({ prisma, jobs }, { batchSize: 2 });

    await reconciler.reconcileOnce();
    await reconciler.reconcileOnce();
    await reconciler.reconcileOnce();

    expect(enqueue).toHaveBeenCalledTimes(4);
    expect(computerFindMany.mock.calls[1]?.[0]).toMatchObject({
      orderBy: [{ controlLeaseExpiresAt: "asc" }, { id: "asc" }],
      where: {
        AND: [
          expect.anything(),
          expect.anything(),
          {
            OR: [
              { controlLeaseExpiresAt: { gt: secondExpiry } },
              { controlLeaseExpiresAt: secondExpiry, id: { gt: "computer-2" } },
              { controlLeaseExpiresAt: null },
            ],
          },
        ],
      },
    });
    const firstDeadline =
      computerFindMany.mock.calls[0]?.[0].where.AND[1].OR[1].controlLeaseExpiresAt.lte;
    const secondDeadline =
      computerFindMany.mock.calls[1]?.[0].where.AND[1].OR[1].controlLeaseExpiresAt.lte;
    expect(secondDeadline).toEqual(firstDeadline);
    expect(computerFindMany.mock.calls[2]?.[0].where.AND).toHaveLength(2);
    expect(enqueue).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: { computerId: "computer-0", leaseId: "lease-0" },
      }),
    );
  });

  it("advances stable cursors so recoverable work beyond one batch is dispatched", async () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    const runs = Array.from({ length: 5 }, (_, index) => ({
      id: `run-${index + 1}`,
      updatedAt: at,
    }));
    const routines = Array.from({ length: 5 }, (_, index) => ({
      id: `routine-${index + 1}`,
      nextRunAt: new Date(at.getTime() + index),
    }));
    const runPages = [runs.slice(0, 2), runs.slice(2, 4), runs.slice(4)];
    let runPage = 0;
    const runFindMany = vi.fn(async (args: { where?: Record<string, unknown> } = {}) => {
      if (args.where?.messagingMirroredAt === null) return [];
      const status = args.where?.status as { in?: string[] } | undefined;
      if (status?.in?.includes("waiting_takeover")) return [];
      return runPages[runPage++] ?? [];
    });
    const routineFindMany = vi
      .fn()
      .mockResolvedValueOnce(routines.slice(0, 2))
      .mockResolvedValueOnce(routines.slice(2, 4))
      .mockResolvedValueOnce(routines.slice(4));
    const prisma = {
      run: { findMany: runFindMany },
      routine: { findMany: routineFindMany },
      computer: { findMany: vi.fn(async () => []) },
      messagingOutbound: { findFirst: vi.fn(async () => null) },
    } as unknown as PrismaClient;
    const { jobs, enqueue } = publisher();
    const reconciler = createJobReconciler({ prisma, jobs }, { batchSize: 2 });

    await reconciler.reconcileOnce();
    await reconciler.reconcileOnce();
    await reconciler.reconcileOnce();

    expect(enqueue).toHaveBeenCalledTimes(10);
    expect(enqueue.mock.calls.map(([job]) => job.replaceKey)).toEqual([
      "run:run-1",
      "run:run-2",
      "routine:routine-1",
      "routine:routine-2",
      "run:run-3",
      "run:run-4",
      "routine:routine-3",
      "routine:routine-4",
      "run:run-5",
      "routine:routine-5",
    ]);
    expect(runFindMany.mock.calls[4]?.[0]).toMatchObject({
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      where: {
        AND: [
          expect.anything(),
          {
            OR: [{ updatedAt: { gt: at } }, { updatedAt: at, id: { gt: "run-2" } }],
          },
        ],
      },
    });
    expect(routineFindMany.mock.calls[1]?.[0]).toMatchObject({
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
      where: {
        AND: [
          expect.anything(),
          {
            OR: [
              { nextRunAt: { gt: routines[1]?.nextRunAt } },
              {
                nextRunAt: routines[1]?.nextRunAt,
                id: { gt: "routine-2" },
              },
            ],
          },
        ],
      },
    });
  });

  it("retries terminal bot outcomes that were not returned", async () => {
    const terminalRun = {
      id: "run-terminal",
      spaceId: "workspace-1",
      threadId: "thread-1",
      botId: "bot-1",
      userId: "user-1",
      sourceMessageId: "message-1",
      status: "completed",
      error: null,
      bot: { name: "Researcher" },
    };
    let terminalScan = 0;
    const runFindMany = vi.fn(async (args: { where?: Record<string, unknown> } = {}) => {
      if (args.where?.messagingMirroredAt === null) return [];
      if (args.where?.trigger === "bot_message") {
        terminalScan += 1;
        return terminalScan === 2 ? [] : [terminalRun];
      }
      return [];
    });
    const prisma = {
      run: { findMany: runFindMany, updateMany: vi.fn(async () => ({ count: 1 })) },
      routine: { findMany: vi.fn(async () => []) },
      computer: { findMany: vi.fn(async () => []) },
      messagingOutbound: { findFirst: vi.fn(async () => null) },
      message: {
        findMany: vi.fn(async () => [
          { blocks: [{ kind: "text", text: "Finished." }], clientNonce: null },
        ]),
      },
    } as unknown as PrismaClient;
    const { jobs } = publisher();
    const events = { notify: vi.fn() } as unknown as ThreadEvents;
    vi.mocked(returnBotMessageOutcome).mockResolvedValue(true).mockResolvedValueOnce(false);

    const reconciler = createJobReconciler({ prisma, jobs, events }, { batchSize: 1 });

    await reconciler.reconcileOnce();
    await reconciler.reconcileOnce();
    await reconciler.reconcileOnce();

    expect(runFindMany).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        where: {
          trigger: "bot_message",
          botOutcomeReturnedAt: null,
          OR: [
            { status: { in: ["completed", "failed"] } },
            { status: "cancelled", error: { in: [...stuckWorkStatusMessages()] } },
          ],
        },
      }),
    );
    expect(returnBotMessageOutcome).toHaveBeenCalledWith(
      { prisma, jobs, events },
      terminalRun,
      { id: "bot-1", name: "Researcher" },
      "Finished.",
      "result",
    );
    expect(prisma.run.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: terminalRun.id, botOutcomeReturnedAt: null },
        data: { updatedAt: expect.any(Date) },
      }),
    );
    expect(returnBotMessageOutcome).toHaveBeenCalledTimes(2);
  });

  it("prefers the latest final reply over earlier untagged narration", async () => {
    const terminalRun = {
      id: "run-takeover",
      spaceId: "workspace-1",
      threadId: "thread-1",
      botId: "bot-1",
      userId: "user-1",
      sourceMessageId: "message-1",
      status: "completed",
      error: null,
      bot: { name: "Researcher" },
    };
    const runFindMany = vi.fn(async (args: { where?: Record<string, unknown> } = {}) => {
      if (args.where?.messagingMirroredAt === null) return [];
      if (args.where?.trigger === "bot_message") return [terminalRun];
      return [];
    });
    const prisma = {
      run: { findMany: runFindMany, updateMany: vi.fn(async () => ({ count: 1 })) },
      routine: { findMany: vi.fn(async () => []) },
      computer: { findMany: vi.fn(async () => []) },
      messagingOutbound: { findFirst: vi.fn(async () => null) },
      message: {
        findMany: vi.fn(async () => [
          {
            blocks: [{ kind: "text", text: "Opening the calendar app…" }],
            clientNonce: null,
          },
          {
            blocks: [{ kind: "text", text: "Tuesday afternoon works." }],
            clientNonce: null,
          },
        ]),
      },
    } as unknown as PrismaClient;
    const { jobs } = publisher();
    const events = { notify: vi.fn() } as unknown as ThreadEvents;
    vi.mocked(returnBotMessageOutcome).mockResolvedValue(true);

    const reconciler = createJobReconciler({ prisma, jobs, events }, { batchSize: 1 });
    await reconciler.reconcileOnce();

    expect(returnBotMessageOutcome).toHaveBeenCalledWith(
      { prisma, jobs, events },
      terminalRun,
      { id: "bot-1", name: "Researcher" },
      "Tuesday afternoon works.",
      "result",
    );
  });

  it("prefers the final reply over progress when reconciling", async () => {
    const terminalRun = {
      id: "run-mixed",
      spaceId: "workspace-1",
      threadId: "thread-1",
      botId: "bot-1",
      userId: "user-1",
      sourceMessageId: "message-1",
      status: "completed",
      error: null,
      bot: { name: "Researcher" },
    };
    const runFindMany = vi.fn(async (args: { where?: Record<string, unknown> } = {}) => {
      if (args.where?.messagingMirroredAt === null) return [];
      if (args.where?.trigger === "bot_message") return [terminalRun];
      return [];
    });
    const prisma = {
      run: { findMany: runFindMany, updateMany: vi.fn(async () => ({ count: 1 })) },
      routine: { findMany: vi.fn(async () => []) },
      computer: { findMany: vi.fn(async () => []) },
      messagingOutbound: { findFirst: vi.fn(async () => null) },
      message: {
        findMany: vi.fn(async () => [
          {
            blocks: [{ kind: "text", text: "Checking calendars…" }],
            clientNonce: "user-progress:run-mixed:0",
          },
          {
            blocks: [{ kind: "text", text: "Tuesday afternoon works." }],
            clientNonce: null,
          },
        ]),
      },
    } as unknown as PrismaClient;
    const { jobs } = publisher();
    const events = { notify: vi.fn() } as unknown as ThreadEvents;
    vi.mocked(returnBotMessageOutcome).mockResolvedValue(true);

    const reconciler = createJobReconciler({ prisma, jobs, events }, { batchSize: 1 });
    await reconciler.reconcileOnce();

    expect(returnBotMessageOutcome).toHaveBeenCalledWith(
      { prisma, jobs, events },
      terminalRun,
      { id: "bot-1", name: "Researcher" },
      "Tuesday afternoon works.",
      "result",
    );
  });

  it("returns progress-only transcripts as status", async () => {
    const terminalRun = {
      id: "run-progress",
      spaceId: "workspace-1",
      threadId: "thread-1",
      botId: "bot-1",
      userId: "user-1",
      sourceMessageId: "message-1",
      status: "completed",
      error: null,
      bot: { name: "Researcher" },
    };
    const runFindMany = vi.fn(async (args: { where?: Record<string, unknown> } = {}) => {
      if (args.where?.messagingMirroredAt === null) return [];
      if (args.where?.trigger === "bot_message") return [terminalRun];
      return [];
    });
    const prisma = {
      run: { findMany: runFindMany, updateMany: vi.fn(async () => ({ count: 1 })) },
      routine: { findMany: vi.fn(async () => []) },
      computer: { findMany: vi.fn(async () => []) },
      messagingOutbound: { findFirst: vi.fn(async () => null) },
      message: {
        findMany: vi.fn(async () => [
          {
            blocks: [{ kind: "text", text: "Checking calendars…" }],
            clientNonce: "user-progress:run-progress:0",
          },
        ]),
      },
    } as unknown as PrismaClient;
    const { jobs } = publisher();
    const events = { notify: vi.fn() } as unknown as ThreadEvents;
    vi.mocked(returnBotMessageOutcome).mockResolvedValue(true);

    const reconciler = createJobReconciler({ prisma, jobs, events }, { batchSize: 1 });
    await reconciler.reconcileOnce();

    expect(returnBotMessageOutcome).toHaveBeenCalledWith(
      { prisma, jobs, events },
      terminalRun,
      { id: "bot-1", name: "Researcher" },
      "Checking calendars…",
      "status",
    );
  });

  it("returns a stuck cancellation to the delegating bot as status", async () => {
    const terminalRun = {
      id: "run-stuck",
      spaceId: "workspace-1",
      threadId: "thread-1",
      botId: "bot-1",
      userId: "user-1",
      sourceMessageId: "message-1",
      status: "cancelled",
      error: stuckWorkStatusMessages()[0],
      bot: { name: "Researcher" },
    };
    const runFindMany = vi.fn(async (args: { where?: Record<string, unknown> } = {}) => {
      if (args.where?.messagingMirroredAt === null) return [];
      if (args.where?.trigger === "bot_message") return [terminalRun];
      return [];
    });
    const prisma = {
      run: { findMany: runFindMany, updateMany: vi.fn(async () => ({ count: 1 })) },
      routine: { findMany: vi.fn(async () => []) },
      computer: { findMany: vi.fn(async () => []) },
      messagingOutbound: { findFirst: vi.fn(async () => null) },
      message: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaClient;
    const { jobs } = publisher();
    const events = { notify: vi.fn() } as unknown as ThreadEvents;
    vi.mocked(returnBotMessageOutcome).mockResolvedValue(true);

    await createJobReconciler({ prisma, jobs, events }).reconcileOnce();

    expect(returnBotMessageOutcome).toHaveBeenCalledWith(
      { prisma, jobs, events },
      terminalRun,
      { id: "bot-1", name: "Researcher" },
      stuckWorkStatusMessages()[0],
      "status",
    );
    expect(prisma.message.findMany).not.toHaveBeenCalled();
  });
});
