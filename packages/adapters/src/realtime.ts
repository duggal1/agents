import type { RealtimeFanout } from "@sapphire/adapter-kit";

type Subscriber = (payload: string) => void;

export class InMemoryRealtimeFanout implements RealtimeFanout {
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private closed = false;

  describe() {
    return {
      id: "memory",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { distributed: false, push: true },
    };
  }

  async publish(topic: string, payload: string): Promise<void> {
    if (this.closed) return;
    for (const subscriber of [...(this.subscribers.get(topic) ?? [])]) subscriber(payload);
  }

  async subscribe(topic: string, onMessage: Subscriber): Promise<() => Promise<void>> {
    if (this.closed) throw new Error("Realtime fanout is closed");
    const topicSubscribers = this.subscribers.get(topic) ?? new Set<Subscriber>();
    topicSubscribers.add(onMessage);
    this.subscribers.set(topic, topicSubscribers);
    let subscribed = true;
    return async () => {
      if (!subscribed) return;
      subscribed = false;
      const current = this.subscribers.get(topic);
      current?.delete(onMessage);
      if (current?.size === 0) this.subscribers.delete(topic);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.subscribers.clear();
  }
}
