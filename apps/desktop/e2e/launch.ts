import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type ElectronApplication,
  _electron as electron,
  type Page,
} from "@playwright/test";

/**
 * Single Playwright launcher for the desktop e2e specs. Two copies of this
 * logic previously diverged (one passed a stray "." to the packaged binary
 * and killed it at startup); keep every spec on this helper.
 *
 * - Packaged binary (`executablePath`): launched with `args: []`. A packaged
 *   Electron binary treats the first positional arg as the app path, so the
 *   dev default `["."]` must never reach it.
 * - Dev (`electron .`): `args: ["."]` with cwd at the package root.
 * - Every launch gets an isolated profile via SAPPHIRE_PERFORMANCE_USER_DATA,
 *   and stale harness overrides (WEB_URL, FORCE_SETUP) are removed so they
 *   cannot bypass setup or leak between runs.
 * - Renderer console errors/pageerrors and main-process stderr/stdout are
 *   collected for failure diagnosis; the setup UI log alone is not enough.
 */
export interface LaunchedApp {
  app: ElectronApplication;
  userData: string;
  consoleErrors: string[];
  mainErrors: string[];
  mainOutput: string[];
}

export async function launchApp(
  options: {
    executablePath?: string;
    extraEnv?: Record<string, string>;
    /** Runs after the profile dir is created but before the app launches. */
    prepareUserData?: (userData: string) => Promise<void>;
  } = {},
): Promise<LaunchedApp> {
  const userData = await mkdtemp(path.join(tmpdir(), "sapphire-desktop-e2e-"));
  await options.prepareUserData?.(userData);
  const env: NodeJS.ProcessEnv = { ...process.env, SAPPHIRE_PERFORMANCE_USER_DATA: userData };
  // A stale override from the developer's shell would bypass setup entirely.
  delete env.SAPPHIRE_WEB_URL;
  delete env.SAPPHIRE_FORCE_SETUP;
  const launched = await electron.launch({
    ...(options.executablePath !== undefined && options.executablePath !== ""
      ? { executablePath: path.resolve(options.executablePath), args: [] as string[] }
      : { args: ["."], cwd: path.resolve(import.meta.dirname, "..") }),
    env: { ...env, ...options.extraEnv },
  });
  const consoleErrors: string[] = [];
  const mainErrors: string[] = [];
  const mainOutput: string[] = [];
  const hook = (page: Page) => {
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(`console.error: ${message.text()}`);
    });
    page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error)}`));
  };
  launched.on("window", hook);
  const child = launched.process();
  child.stderr?.on("data", (chunk: Buffer) => mainErrors.push(String(chunk)));
  child.stdout?.on("data", (chunk: Buffer) => mainOutput.push(String(chunk)));
  return { app: launched, userData, consoleErrors, mainErrors, mainOutput };
}
