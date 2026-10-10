import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { launchApp, type LaunchedApp } from "./launch.js";

/**
 * Acceptance Run for the native macOS backend (RULES Level 4-6): the REAL
 * packaged app boots its own PostgreSQL + API + worker on an isolated
 * profile and opens the app window. No stubs, no fakes — initdb, the 92
 * Prisma migrations, and the service health gates all run for real.
 *
 * First launch never renders the setup screen: the Mac's local server is the
 * silent default, so the first window is the app itself and the backend
 * boots behind it (SAPPHIRE_FORCE_SETUP is explicitly off here; the shared
 * launcher defaults it on for specs that exercise the setup window itself).
 *
 * Profile isolation: the shared launch helper gives every launch a fresh
 * temp profile, so the maintainer's real ~/Library profile is never touched.
 */

const EXECUTABLE = path.resolve(
  import.meta.dirname,
  "../out/mac-arm64/Sapphire.app/Contents/MacOS/Sapphire",
);
const shots = (name: string) => path.join(import.meta.dirname, "screenshots", name);

let userData = "";
let app: ElectronApplication | undefined;
let mainErrors: string[] = [];
let consoleErrors: string[] = [];

test.afterEach(async () => {
  await app?.close().catch(() => undefined);
  app = undefined;
  if (userData !== "") await rm(userData, { recursive: true, force: true });
  userData = "";
});

async function launch(
  prepareUserData?: (userData: string) => Promise<void>,
  extraEnv?: Record<string, string>,
): Promise<LaunchedApp> {
  const launched = await launchApp({ executablePath: EXECUTABLE, prepareUserData, extraEnv });
  app = launched.app;
  userData = launched.userData;
  mainErrors = launched.mainErrors;
  consoleErrors = launched.consoleErrors;
  return launched;
}

/** First launch provisions the local server silently; the setup screen never renders. */
const NO_SETUP_ENV = { SAPPHIRE_FORCE_SETUP: "0" };

function expectNoMainErrors() {
  expect(mainErrors.join("\n")).toBe("");
}

function expectNoRendererErrors() {
  // The logged-out bootstrap probe is designed to reject (App.tsx: the API
  // serves logged-out requests as anonymous, so takeInitialBootstrap's 401
  // means "show the logged-out surface"). Browsers log failed fetches to the
  // console regardless of the catch, so exactly this message is expected on
  // a fresh profile. Anything else is a real defect.
  const benign = consoleErrors.filter((message) =>
    message.includes("the server responded with a status of 401"),
  );
  const unexpected = consoleErrors.filter((message) => !benign.includes(message));
  expect(unexpected).toEqual([]);
}

test.setTimeout(300_000);

test("cold native boot reaches the app with zero crashes", async () => {
  const launched = await launch(undefined, NO_SETUP_ENV);
  const appWindow = await launched.app.firstWindow();

  // No setup screen on first launch: the first window is the app itself.
  await expect(appWindow.locator("#setup")).toHaveCount(0);
  await expect(appWindow.getByRole("heading", { name: "Welcome to Sapphire" })).toHaveCount(0);

  // The Mac's local server is the silent default, persisted up front while
  // the backend boots behind the window.
  await expect
    .poll(
      async () => {
        try {
          return JSON.parse(await readFile(path.join(userData, "setup.json"), "utf8"));
        } catch {
          return null;
        }
      },
      { timeout: 60_000 },
    )
    .toEqual({ mode: "new", serverUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/) });

  // The backend is real: a cluster was initialized on disk for this profile.
  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(userData, "postgres", "PG_VERSION"));
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 180_000 },
    )
    .toBe(true);

  // Local-first: no login on the packaged path. The backend serves every
  // request as the fixed owner actor, so the bootstrap succeeds without a
  // session and the app lands straight on the shell — no auth screens.
  await expect(appWindow.locator('[data-testid="shell-root"]')).toBeVisible({
    timeout: 240_000,
  });
  await appWindow.screenshot({ path: shots("11-native-app-window.png") });
  const url = appWindow.url();
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  expectNoRendererErrors();
  expectNoMainErrors();
});

test("warm relaunch reopens the app without setup interaction", async () => {
  const launched = await launch(undefined, NO_SETUP_ENV);
  const firstWindow = await launched.app.firstWindow();
  await expect(firstWindow.locator("#setup")).toHaveCount(0);
  await expect(firstWindow.locator('[data-testid="shell-root"]')).toBeVisible({
    timeout: 240_000,
  });
  await launched.app.close();

  // A relaunch with the backend down boots it again behind the app window;
  // setup never appears as an undecided first run.
  app = undefined;
  const relaunched = await launch(undefined, NO_SETUP_ENV);
  app = relaunched.app;
  const window = await relaunched.app.firstWindow();
  await expect(window.locator("#setup")).toHaveCount(0);
  await expect
    .poll(async () => window.url(), { timeout: 180_000 })
    .toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  await window.screenshot({ path: shots("12-native-warm-relaunch.png") });
  expectNoRendererErrors();
  expectNoMainErrors();
});

test("a postgres dir poisoned by failed first launches self-heals", async () => {
  // Exactly the reported failure state: our dotfiles in the cluster dir,
  // which used to make initdb refuse it on every retry.
  const launched = await launch(async (dir) => {
    const poisoned = path.join(dir, "postgres");
    await import("node:fs/promises").then((fs) => fs.mkdir(poisoned, { recursive: true }));
    await writeFile(
      path.join(poisoned, ".desktop-postgres.json"),
      JSON.stringify({ version: 1, port: 55431, user: "rakazo", database: "rakazo", password: "stale".repeat(4) }),
    );
    await writeFile(path.join(poisoned, ".pwfile-99999"), "stale\n");
  }, NO_SETUP_ENV);
  const appWindow = await launched.app.firstWindow();
  await expect(appWindow.locator("#setup")).toHaveCount(0);

  await expect
    .poll(async () => {
      try {
        await stat(path.join(userData, "postgres", "PG_VERSION"));
        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);
  await expect(appWindow.locator('[data-testid="shell-root"]')).toBeVisible({
    timeout: 240_000,
  });
  expectNoRendererErrors();
  expectNoMainErrors();
});
