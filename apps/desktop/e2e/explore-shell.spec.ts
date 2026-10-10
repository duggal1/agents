import { rm } from "node:fs/promises";
import { type ElectronApplication, expect, test } from "@playwright/test";
import { launchApp } from "./launch.js";

/**
 * Exploration for the local-first packaged Acceptance Run: cold boot the
 * freshly packed app on an isolated profile, walk setup, and dump the
 * first-run shell state (aria snapshot + screenshot) so the acceptance
 * assertions target real selectors, not guesses.
 */

const EXECUTABLE = new URL(
  "../out/mac-arm64/Sapphire.app/Contents/MacOS/Sapphire",
  import.meta.url,
).pathname;

test.setTimeout(300_000);

test("explore first-run shell state", async () => {
  let app: ElectronApplication | undefined;
  let userData = "";
  try {
    const launched = await launchApp({ executablePath: EXECUTABLE });
    app = launched.app;
    userData = launched.userData;
    const setup = await app.firstWindow();
    await expect(setup.getByRole("heading", { name: "Welcome to Sapphire" })).toBeVisible();
    const appWindowPromise = app.waitForEvent("window", { timeout: 240_000 });
    await setup.getByRole("button", { name: "Continue" }).click();
    const appWindow = await appWindowPromise;
    await expect(appWindow.locator('[data-testid="shell-root"]')).toBeVisible({ timeout: 60_000 });
    await appWindow.waitForTimeout(3000);
    await appWindow.screenshot({ path: "e2e/screenshots/20-explore-shell.png" });
    const snapshot = await appWindow.locator("body").ariaSnapshot();
    const { writeFile } = await import("node:fs/promises");
    await writeFile("e2e/screenshots/20-explore-shell.aria.yml", snapshot);
    console.log(`SHELL-URL ${appWindow.url()}`);
  } finally {
    await app?.close().catch(() => undefined);
    if (userData !== "") await rm(userData, { recursive: true, force: true });
  }
});
