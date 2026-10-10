import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { CODING_CLI_PROVIDER_IDS, isCodingCliProviderId } from "@sapphire/contracts";
import { execCli, resolveCliBinary } from "./coding-cli-spawn.js";

/** Headless coding agents run on the user's own machine under their own logins. */
export const CODING_CLI_PROVIDERS = CODING_CLI_PROVIDER_IDS;

export type CodingCliProvider = (typeof CODING_CLI_PROVIDERS)[number];

export function isCodingCliProvider(provider: string): provider is CodingCliProvider {
  return isCodingCliProviderId(provider);
}

export type CodingCliMeta = {
  provider: CodingCliProvider;
  name: string;
  binary: string;
  loginHint: string;
};

export const CODING_CLI_META: Record<CodingCliProvider, CodingCliMeta> = {
  "codex-cli": {
    provider: "codex-cli",
    name: "Codex",
    binary: "codex",
    loginHint: "Run `codex login` in a terminal, then reconnect.",
  },
  "claude-cli": {
    provider: "claude-cli",
    name: "Claude Code",
    binary: "claude",
    loginHint: "Run `claude login` in a terminal, then reconnect.",
  },
  "opencode-cli": {
    provider: "opencode-cli",
    name: "OpenCode",
    binary: "opencode",
    loginHint: "Run `opencode auth login` in a terminal, then reconnect.",
  },
};

function userHome(env: NodeJS.ProcessEnv): string {
  return env.HOME || env.USERPROFILE || homedir();
}

function codexHome(env: NodeJS.ProcessEnv): string | null {
  if (env.CODEX_HOME) {
    return isAbsolute(env.CODEX_HOME) ? resolve(env.CODEX_HOME) : null;
  }
  const home = userHome(env);
  return isAbsolute(home) ? join(home, ".codex") : null;
}

function opencodeDataDir(env: NodeJS.ProcessEnv): string | null {
  const base =
    env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME)
      ? env.XDG_DATA_HOME
      : join(userHome(env), ".local", "share");
  return isAbsolute(base) ? join(base, "opencode") : null;
}

/** Auth-file presence per CLI. A stale file can lie; connects verify for real. */
export function codingCliSignedIn(
  provider: CodingCliProvider,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const home = userHome(env);
  if (!isAbsolute(home)) return false;
  switch (provider) {
    case "codex-cli": {
      const dir = codexHome(env);
      return dir !== null && existsSync(join(dir, "auth.json"));
    }
    case "claude-cli":
      return existsSync(join(home, ".claude", ".credentials.json"));
    case "opencode-cli": {
      const dir = opencodeDataDir(env);
      return dir !== null && existsSync(join(dir, "auth.json"));
    }
  }
}

export type CodingCliStatus = {
  provider: CodingCliProvider;
  name: string;
  installed: boolean;
  version: string | null;
  signedIn: boolean;
  loginHint: string;
};

async function cliVersion(
  binary: string,
  env: NodeJS.ProcessEnv,
): Promise<{ path: string; version: string | null }> {
  const resolved = resolveCliBinary(binary, env);
  if (!resolved) return { path: binary, version: null };
  try {
    const version = await execCli(resolved, ["--version"], { env });
    return { path: resolved, version: version.split("\n")[0]?.trim() || null };
  } catch {
    return { path: resolved, version: null };
  }
}

/** Detect installed coding CLIs and their login state on this machine. */
export async function detectCodingClis(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CodingCliStatus[]> {
  return Promise.all(
    CODING_CLI_PROVIDERS.map(async (provider) => {
      const meta = CODING_CLI_META[provider];
      const { version } = await cliVersion(meta.binary, env);
      return {
        provider,
        name: meta.name,
        installed: version !== null,
        version,
        signedIn: version !== null && codingCliSignedIn(provider, env),
        loginHint: meta.loginHint,
      };
    }),
  );
}
