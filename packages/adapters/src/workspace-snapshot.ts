import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PortableFile } from "@sapphire/adapter-kit";

/**
 * Provider-neutral local workspace snapshots for E2B→Docker fallback.
 *
 * Snapshots are written only after completed tasks/checkpoints — never from
 * in-flight state — under the app data directory. Every bound exists so one
 * runaway workspace cannot fill the user's disk or stall the fallback.
 */
export interface WorkspaceSnapshotLimits {
  /** Maximum files in one snapshot. */
  maxFiles: number;
  /** Maximum bytes across all files. */
  maxTotalBytes: number;
  /** Maximum bytes for a single file. */
  maxFileBytes: number;
  /** Maximum wall-clock time to collect the snapshot. */
  maxElapsedMs: number;
}

export const DEFAULT_SNAPSHOT_LIMITS: WorkspaceSnapshotLimits = {
  maxFiles: 2000,
  maxTotalBytes: 256 * 1024 * 1024,
  maxFileBytes: 8 * 1024 * 1024,
  maxElapsedMs: 60_000,
};

export class SnapshotLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotLimitError";
  }
}

/**
 * Reject anything that is not a plain portable workspace path: empty paths,
 * traversal (`..`), absolute paths, and symlink-shaped entries. Provider
 * exports arrive as content bytes, so a symlink can only sneak in through a
 * compromised or buggy provider — fail closed.
 */
export function assertPortableSnapshotPath(relative: string): string {
  if (!relative || typeof relative !== "string") {
    throw new Error("Workspace snapshots cannot contain an empty file path");
  }
  const normalized = relative.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) throw new Error("Workspace snapshots cannot contain an empty file path");
  if (segments.some((segment) => segment === "." || segment === ".." || segment === "~")) {
    throw new Error(`Workspace snapshot path escapes its directory: ${relative}`);
  }
  if (normalized.length > 512) throw new Error(`Workspace snapshot path too long: ${relative}`);
  return segments.join("/");
}

/** File modes are preserved only on POSIX; Windows ACLs never round-trip. */
export function snapshotFileMode(executable: boolean | undefined): number {
  if (process.platform === "win32") return 0o600;
  return executable === true ? 0o700 : 0o600;
}

export interface CollectedSnapshot {
  files: number;
  bytes: number;
}

/**
 * Drain a provider workspace export into a local directory, enforcing file
 * count, per-file, total-byte, and elapsed-time bounds. Returns file/byte
 * totals for the migration record.
 */
export async function collectWorkspaceSnapshot(
  files: AsyncIterable<PortableFile>,
  dir: string,
  limits: WorkspaceSnapshotLimits = DEFAULT_SNAPSHOT_LIMITS,
): Promise<CollectedSnapshot> {
  const startedAt = Date.now();
  const root = path.resolve(dir);
  await mkdir(root, { recursive: true });
  let count = 0;
  let total = 0;
  for await (const file of files) {
    if (Date.now() - startedAt > limits.maxElapsedMs) {
      throw new SnapshotLimitError(
        `Workspace snapshot exceeded ${limits.maxElapsedMs}ms collection time`,
      );
    }
    const relative = assertPortableSnapshotPath(file.path);
    const size = file.content.byteLength;
    if (size > limits.maxFileBytes) {
      throw new SnapshotLimitError(
        `Workspace snapshot file ${relative} is ${size} bytes (limit ${limits.maxFileBytes})`,
      );
    }
    count += 1;
    if (count > limits.maxFiles) {
      throw new SnapshotLimitError(`Workspace snapshot exceeds ${limits.maxFiles} files`);
    }
    total += size;
    if (total > limits.maxTotalBytes) {
      throw new SnapshotLimitError(
        `Workspace snapshot exceeds ${limits.maxTotalBytes} total bytes`,
      );
    }
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Workspace snapshot path escapes its staging directory: ${relative}`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, { mode: snapshotFileMode(file.executable) });
  }
  return { files: count, bytes: total };
}

/** Read a collected snapshot back as portable files for import into Docker. */
export async function* readWorkspaceSnapshot(dir: string): AsyncIterable<PortableFile> {
  const root = path.resolve(dir);
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Workspace snapshot contains a symlink: ${full}`);
      }
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const content = await readFile(full);
      const relative = path.relative(root, full).split(path.sep).join("/");
      yield { path: relative, content: new Uint8Array(content) };
    }
  }
}

/** Best-effort cleanup of a staging directory; never throws. */
export async function discardWorkspaceSnapshot(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

/** True when a path inside a collected snapshot is a symlink (must not restore). */
export async function snapshotEntryIsSymlink(fullPath: string): Promise<boolean> {
  try {
    return (await lstat(fullPath)).isSymbolicLink();
  } catch {
    return false;
  }
}
