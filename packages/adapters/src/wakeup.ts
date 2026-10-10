import {
  type BackgroundJob,
  type BackgroundJobHandlers,
  dispatchBackgroundJob,
  type JobPublisher,
  type JobWorkerHost,
} from "@sapphire/adapter-kit";
import { runCorrelatedJob, unwrapJobPayload, wrapJobPayload } from "@sapphire/logging";

interface QueuedJob {
  name: BackgroundJob["name"];
  payload: unknown;
  availableAt?: Date;
  replaceKey?: string;
}

function toQueuedJob(job: BackgroundJob): QueuedJob {
  return {
    name: job.name,
    payload: wrapJobPayload(job.payload),
    availableAt: job.availableAt,
    replaceKey: job.replaceKey,
  };
}

export class InMemoryJobQueue implements JobPublisher, JobWorkerHost {
  private handlers: BackgroundJobHandlers | undefined;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly scheduled = new Map<ReturnType<typeof setTimeout>, QueuedJob>();
  private readonly keyed = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly active = new Set<Promise<void>>();
  private readonly closingJobs: QueuedJob[] = [];
  private draining: Promise<void> | undefined;
  private closed = false;
  private stopped = false;
  private closing = false;
  private acceptingClosingJobs = false;
  private closeRequested = false;

  async enqueue(job: BackgroundJob): Promise<void> {
    const stored = toQueuedJob(job);
    if (this.closed) throw new Error("Background job publisher is closed");
    if (this.stopped) throw new Error("Background job publisher is stopped");
    if (this.closing) {
      this.enqueueWhileClosing(stored);
      return;
    }
    if (stored.replaceKey) {
      await this.cancel(stored.replaceKey);
      if (this.closed) throw new Error("Background job publisher is closed");
      if (this.stopped) throw new Error("Background job publisher is stopped");
      if (this.closing) {
        this.enqueueWhileClosing(stored);
        return;
      }
    }
    const delay = stored.availableAt ? Math.max(0, stored.availableAt.getTime() - Date.now()) : 0;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.scheduled.delete(timer);
      if (stored.replaceKey && this.keyed.get(stored.replaceKey) === timer) {
        this.keyed.delete(stored.replaceKey);
      }
      const handlers = this.handlers;
      if (!handlers) return;
      void this.dispatch(handlers, stored);
    }, delay);
    this.timers.add(timer);
    this.scheduled.set(timer, stored);
    if (stored.replaceKey) this.keyed.set(stored.replaceKey, timer);
  }

  async cancel(replaceKey: string): Promise<void> {
    const closing = this.closingJobs.findIndex((job) => job.replaceKey === replaceKey);
    if (closing >= 0) this.closingJobs.splice(closing, 1);
    const timer = this.keyed.get(replaceKey);
    if (!timer) return;
    clearTimeout(timer);
    this.keyed.delete(replaceKey);
    this.timers.delete(timer);
    this.scheduled.delete(timer);
  }

  async start(handlers: BackgroundJobHandlers): Promise<void> {
    this.handlers = handlers;
    this.stopped = false;
  }

  async stop(): Promise<void> {
    await this.drain();
  }

  private dispatch(handlers: BackgroundJobHandlers, job: QueuedJob): Promise<void> {
    const unpacked = unwrapJobPayload(job.payload);
    const active = runCorrelatedJob({
      name: job.name,
      payload: unpacked.payload,
      correlation: unpacked.correlation,
      run: () => dispatchBackgroundJob(handlers, job.name, unpacked.payload),
    }).catch(() => undefined);
    this.active.add(active);
    void active.finally(() => this.active.delete(active));
    return active;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closeRequested = true;
    await this.drain();
  }

  private enqueueWhileClosing(job: QueuedJob): void {
    if (job.replaceKey) {
      const existing = this.closingJobs.findIndex((queued) => queued.replaceKey === job.replaceKey);
      if (existing >= 0) this.closingJobs.splice(existing, 1);
    }
    if (job.availableAt && job.availableAt.getTime() > Date.now()) {
      // Delayed in-memory jobs are intentionally discarded on shutdown; durable
      // schedulers reconcile them after restart. Never run them early.
      return;
    }
    if (!this.acceptingClosingJobs) throw new Error("Background job publisher is closing");
    this.closingJobs.push(job);
  }

  private async drain(): Promise<void> {
    if (this.draining) return this.draining;
    const draining = this.performDrain();
    this.draining = draining;
    try {
      await draining;
    } finally {
      if (this.draining === draining) this.draining = undefined;
    }
  }

  private async performDrain(): Promise<void> {
    this.closing = true;
    this.acceptingClosingJobs = true;
    for (const timer of this.timers) {
      clearTimeout(timer);
      const job = this.scheduled.get(timer);
      if (job) this.enqueueWhileClosing(job);
    }
    this.timers.clear();
    this.scheduled.clear();
    this.keyed.clear();
    await Promise.all(this.active);
    this.acceptingClosingJobs = false;
    const handlers = this.handlers;
    const closingJobs = this.closingJobs.splice(0);
    if (!handlers && closingJobs.length > 0) {
      throw new Error("Background job publisher is closing");
    }
    if (handlers) {
      for (const job of closingJobs) void this.dispatch(handlers, job);
    }
    await Promise.all(this.active);
    this.handlers = undefined;
    this.closed = this.closeRequested;
    this.stopped = !this.closeRequested;
    this.closing = false;
  }
}
