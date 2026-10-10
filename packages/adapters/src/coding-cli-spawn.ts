// Portions adapted from OpenMausBot (server/procs.ts, server/env-path.ts)
// (Apache-2.0). Cross-platform spawning for agent CLIs: own process group on
// POSIX so a turn can be reaped as a tree, hidden console on Windows, human
// wording for spawn failures, and a PATH augmented with the installer
// locations GUI-launched backends otherwise miss (~/.bun/bin, brew, ...).
import {
  type ChildProcess,
  type ChildProcessByStdio,
  execFile,
  type SpawnOptions,
  spawn,
} from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { Readable, Writable } from "node:stream";

function knownInstallDirs(home: string): string[] {
  const dirs =
    process.platform === "win32"
      ? [
          join(home, "AppData", "Roaming", "npm"),
          join(home, ".claude", "local"),
          join(home, ".bun", "bin"),
          join(home, "bin"),
        ]
      : [
          join(home, ".local", "bin"),
          join(home, ".opencode", "bin"),
          join(home, ".claude", "local"),
          "/opt/homebrew/bin",
          "/usr/local/bin",
          join(home, ".bun", "bin"),
          join(home, "bin"),
        ];
  return dirs.filter((dir) => existsSync(dir));
}

/** Backend PATH plus CLI installer locations, deduplicated. */
export function augmentedCliPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME || env.USERPROFILE || homedir();
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const dir of [...knownInstallDirs(home), ...(env.PATH ?? "").split(delimiter)]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    parts.push(dir);
  }
  return parts.join(delimiter);
}

/** Resolve a CLI name to an absolute path when it is not on the raw PATH. */
export function resolveCliBinary(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (/[/\\]/.test(name)) return existsSync(name) ? name : null;
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of augmentedCliPath(env).split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = join(dir, `${name}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export type SpawnedCli = {
  child: ChildProcessByStdio<Writable, Readable, Readable>;
  command: string;
};

/**
 * Spawn an agent CLI with piped stdio. Prompts travel over stdin, never argv,
 * so long prompts cannot hit Windows' command-line limit or leak into `ps`.
 */
export function spawnCli(
  command: string,
  args: string[],
  options: SpawnOptions & { env?: NodeJS.ProcessEnv },
): { child: ChildProcessByStdio<Writable, Readable, Readable>; command: string } {
  const child = spawn(command, args, {
    ...options,
    stdio: ["pipe", "pipe", "pipe"],
    ...(process.platform === "win32" ? { windowsHide: true } : { detached: true }),
  }) as ChildProcessByStdio<Writable, Readable, Readable>;
  // A write to a dying child's stdin can error asynchronously with no
  // listener; turns settle on `close`, which carries the same information.
  child.stdin?.on("error", () => undefined);
  return { child, command };
}

/** Run a CLI probe (e.g. `--version`) and resolve its trimmed stdout. */
export function execCli(
  command: string,
  args: string[],
  options: { timeoutMs?: number; env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        timeout: options.timeoutMs ?? 8_000,
        env: options.env,
        cwd: options.cwd,
        windowsHide: true,
        encoding: "utf8",
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(String(stdout).trim());
      },
    );
  });
}

/** Human wording for a failed CLI spawn: ENOENT/EACCES are setup problems. */
export function describeCliSpawnFailure(error: unknown, cli: string): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOENT") return `\`${cli}\` is not installed, or is not on PATH`;
  if (code === "EACCES" || code === "EPERM")
    return `\`${cli}\` is not executable — check its file permissions`;
  return error instanceof Error ? error.message : String(error);
}

/** Stop a spawned CLI tree: TERM grace period, then KILL. Resolves true when reaped. */
export function killCliTree(child: ChildProcess, timeoutMs = 5_000): Promise<boolean> {
  const pid = child.pid;
  if (!pid || !Number.isInteger(pid) || pid <= 1 || pid === process.pid) {
    return Promise.resolve(!pid);
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(grace);
      resolve(value);
    };
    const grace = setTimeout(
      () => {
        try {
          if (process.platform === "win32") child.kill("SIGKILL");
          else process.kill(-pid, "SIGKILL");
        } catch {
          // Already gone.
        }
        setTimeout(() => done(child.exitCode !== null || child.signalCode !== null), 1_000);
      },
      Math.max(0, timeoutMs),
    );
    child.once("close", () => done(true));
    try {
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
        });
        killer.once("close", () => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        });
      } else {
        process.kill(-pid, "SIGTERM");
      }
    } catch {
      done(child.exitCode !== null || child.signalCode !== null);
    }
  });
}
