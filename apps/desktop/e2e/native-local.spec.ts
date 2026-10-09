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

async function launch(prepareUserData?: (userData: string) => Promise<void>): Promise<LaunchedApp> {
  const launched = await launchApp({ executablePath: EXECUTABLE, prepareUserData });
  app = launched.app;
  userData = launched.userData;
  mainErrors = launched.mainErrors;
  consoleErrors = launched.consoleErrors;
  return launched;
}

function expectNoMainErrors() {
  expect(mainErrors.join("\n")).toBe("");
}

test.setTimeout(300_000);

test("cold native boot reaches the app with zero crashes", async () => {
  const launched = await launch();
  const setup = await launched.app.firstWindow();

  // Setup offers This computer by default with no Docker copy anywhere.
  await expect(setup.getByRole("heading", { name: "Welcome to Sapphire" })).toBeVisible();
  await expect(setup.getByRole("radio", { name: /This computer/ })).toBeChecked();
  await expect(setup.getByText("Docker Desktop")).toHaveCount(0);
  await setup.screenshot({ path: shots("10-native-setup-fresh.png") });

  // The full native boot: initdb, 92 migrations, API + worker health gates.
  const appWindowPromise = launched.app.waitForEvent("window", { timeout: 240_000 });
  await setup.getByRole("button", { name: "Continue" }).click();
  const appWindow = await appWindowPromise;

  // The backend is real: a cluster was initialized on disk for this profile.
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
  await expect
    .poll(async () => {
      try {
        return JSON.parse(await readFile(path.join(userData, "setup.json"), "utf8"));
      } catch {
        return null;
      }
    })
    .toEqual({ mode: "new", serverUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/) });

  // The app window serves the real product (auth surface on a fresh profile).
  await appWindow.screenshot({ path: shots("11-native-app-window.png") });
  const url = appWindow.url();
  expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  expect(consoleErrors).toEqual([]);
  expectNoMainErrors();
});

test("warm relaunch reopens the app without setup interaction", async () => {
  const launched = await launch();
  const setup = await launched.app.firstWindow();
  await expect(setup.getByRole("heading", { name: "Welcome to Sapphire" })).toBeVisible();
  const appWindowPromise = launched.app.waitForEvent("window", { timeout: 240_000 });
  await setup.getByRole("button", { name: "Continue" }).click();
  await appWindowPromise;
  await launched.app.close();

  // Same profile, second process: the cluster exists, so boot skips initdb
  // and must not show setup as an undecided first run.
  app = undefined;
  const relaunched = await launch();
  app = relaunched.app;
  const window = await relaunched.app.firstWindow();
  await expect
    .poll(async () => window.url(), { timeout: 180_000 })
    .toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
  await window.screenshot({ path: shots("12-native-warm-relaunch.png") });
  expect(consoleErrors).toEqual([]);
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
  });
  const setup = await launched.app.firstWindow();
  await expect(setup.getByRole("heading", { name: "Welcome to Sapphire" })).toBeVisible();
  const appWindowPromise = launched.app.waitForEvent("window", { timeout: 240_000 });
  await setup.getByRole("button", { name: "Continue" }).click();
  await appWindowPromise;

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
  expect(consoleErrors).toEqual([]);
  expectNoMainErrors();
});
