import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PortableFile } from "@sapphire/adapter-kit";
import {
  assertPortableSnapshotPath,
  collectWorkspaceSnapshot,
  DEFAULT_SNAPSHOT_LIMITS,
  discardWorkspaceSnapshot,
  readWorkspaceSnapshot,
  SnapshotLimitError,
  snapshotEntryIsSymlink,
  snapshotFileMode,
} from "./workspace-snapshot.js";

async function* files(list: PortableFile[]): AsyncIterable<PortableFile> {
  yield* list;
}

const blob = (size: number) => new Uint8Array(size);

describe("portable snapshot paths", () => {
  it("rejects empty, traversal, absolute, and home paths", () => {
    expect(() => assertPortableSnapshotPath("")).toThrow();
    expect(() => assertPortableSnapshotPath("../evil")).toThrow();
    expect(() => assertPortableSnapshotPath("a/../../evil")).toThrow();
    expect(() => assertPortableSnapshotPath("~/evil")).toThrow();
    expect(assertPortableSnapshotPath("/workspace/notes.md")).toBe("workspace/notes.md");
    expect(assertPortableSnapshotPath("bots/bot-1/shared.md")).toBe("bots/bot-1/shared.md");
  });

  it("preserves modes only when safe", () => {
    expect(snapshotFileMode(true)).toBe(process.platform === "win32" ? 0o600 : 0o700);
    expect(snapshotFileMode(false)).toBe(0o600);
  });
});

describe("bounded snapshot collection", () => {
  it("collects portable files and reads them back", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sapphire-snap-"));
    try {
      const collected = await collectWorkspaceSnapshot(
        files([
          { path: "notes.md", content: new TextEncoder().encode("hello") },
          { path: "src/run.sh", content: new TextEncoder().encode("echo hi"), executable: true },
        ]),
        dir,
      );
      expect(collected).toEqual({ files: 2, bytes: 12 });
      const restored: PortableFile[] = [];
      for await (const file of readWorkspaceSnapshot(dir)) restored.push(file);
      expect(restored.map((file) => file.path).sort()).toEqual(["notes.md", "src/run.sh"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("enforces file count, per-file, and total byte bounds", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sapphire-snap-"));
    try {
      await expect(
        collectWorkspaceSnapshot(files([{ path: "big.bin", content: blob(9 * 1024 * 1024) }]), dir),
      ).rejects.toBeInstanceOf(SnapshotLimitError);
      await expect(
        collectWorkspaceSnapshot(files([{ path: "a", content: blob(1) }]), dir, {
          ...DEFAULT_SNAPSHOT_LIMITS,
          maxFiles: 0,
        }),
      ).rejects.toBeInstanceOf(SnapshotLimitError);
      await expect(
        collectWorkspaceSnapshot(
          files([
            { path: "a", content: blob(10) },
            { path: "b", content: blob(10) },
          ]),
          dir,
          { ...DEFAULT_SNAPSHOT_LIMITS, maxTotalBytes: 15 },
        ),
      ).rejects.toBeInstanceOf(SnapshotLimitError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects traversal inside the stream and symlinks on read", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sapphire-snap-"));
    try {
      await expect(
        collectWorkspaceSnapshot(files([{ path: "../escape", content: blob(1) }]), dir),
      ).rejects.toThrow(/escapes/);
      const link = path.join(dir, "link");
      await writeFile(path.join(dir, "real"), "x");
      await symlink(path.join(dir, "real"), link).catch(() => undefined);
      if (await snapshotEntryIsSymlink(link)) {
        const seen: string[] = [];
        await expect(
          (async () => {
            for await (const file of readWorkspaceSnapshot(dir)) seen.push(file.path);
          })(),
        ).rejects.toThrow(/symlink/);
        expect(seen).not.toContain("link");
      }
      await discardWorkspaceSnapshot(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
