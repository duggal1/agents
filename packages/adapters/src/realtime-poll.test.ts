import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PollingRealtimeFanout } from "./realtime-poll.js";

async function waitFor(assertion: () => void, timeoutMs = 5_000): Promise<void> {
  await vi.waitFor(assertion, { timeout: timeoutMs, interval: 10 });
}

describe("PollingRealtimeFanout", () => {
  let dir = "";
  let dbPath = "";
  let fanouts: PollingRealtimeFanout[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rakazo-realtime-poll-"));
    dbPath = path.join(dir, "events.db");
    fanouts = [];
  });

  afterEach(async () => {
    for (const fanout of fanouts) await fanout.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function open(options?: Partial<ConstructorParameters<typeof PollingRealtimeFanout>[0]>) {
    const fanout = new PollingRealtimeFanout({ path: dbPath, pollIntervalMs: 10, ...options });
    fanouts.push(fanout);
    return fanout;
  }

  it("exposes the realtime contract surface", () => {
    expect(open().describe()).toEqual({
      id: "sqlite-poll",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { distributed: true, push: false },
    });
  });

  it("delivers published payloads to local subscribers", async () => {
    const fanout = open();
    const received: string[] = [];
    await fanout.subscribe("thread:1", (payload) => received.push(payload));
    await fanout.publish("thread:1", "hello");
    await waitFor(() => expect(received).toEqual(["hello"]));
  });

  it("delivers in seq order exactly once to two instances on one file", async () => {
    const a = open();
    const b = open();
    const receivedA: string[] = [];
    const receivedB: string[] = [];
    await a.subscribe("thread:9", (payload) => receivedA.push(payload));
    await b.subscribe("thread:9", (payload) => receivedB.push(payload));
    await a.publish("thread:9", "one");
    await a.publish("thread:9", "two");
    await b.publish("thread:9", "three");
    await waitFor(() => expect(receivedA).toEqual(["one", "two", "three"]));
    await waitFor(() => expect(receivedB).toEqual(["one", "two", "three"]));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(receivedA).toEqual(["one", "two", "three"]);
    expect(receivedB).toEqual(["one", "two", "three"]);
  });

  it("only delivers messages published after subscribing", async () => {
    const fanout = open();
    await fanout.publish("thread:2", "before");
    const received: string[] = [];
    await fanout.subscribe("thread:2", (payload) => received.push(payload));
    await fanout.publish("thread:2", "after");
    await waitFor(() => expect(received).toEqual(["after"]));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toEqual(["after"]);
  });

  it("isolates topics from each other", async () => {
    const fanout = open();
    const received: string[] = [];
    await fanout.subscribe("thread:a", (payload) => received.push(payload));
    await fanout.publish("thread:b", "elsewhere");
    await fanout.publish("thread:a", "here");
    await waitFor(() => expect(received).toEqual(["here"]));
  });

  it("stops delivery after unsubscribe and tolerates double unsubscribe", async () => {
    const fanout = open();
    const received: string[] = [];
    const stop = await fanout.subscribe("thread:3", (payload) => received.push(payload));
    await fanout.publish("thread:3", "first");
    await waitFor(() => expect(received).toEqual(["first"]));
    await stop();
    await stop();
    await fanout.publish("thread:3", "second");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(received).toEqual(["first"]);
  });

  it("keeps delivering to healthy subscribers when one throws", async () => {
    const fanout = open();
    const received: string[] = [];
    await fanout.subscribe("thread:4", () => {
      throw new Error("broken subscriber");
    });
    await fanout.subscribe("thread:4", (payload) => received.push(payload));
    await fanout.publish("thread:4", "still-here");
    await waitFor(() => expect(received).toEqual(["still-here"]));
  });

  it("close() is idempotent and rejects further use", async () => {
    const fanout = open();
    await fanout.close();
    await fanout.close();
    await expect(fanout.publish("thread:5", "x")).rejects.toThrow("closed");
    await expect(fanout.subscribe("thread:5", () => undefined)).rejects.toThrow("closed");
  });
});
