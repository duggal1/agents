import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("computer rail resizes its preview and remembers width", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await signup(
    page,
    `computer-prefs-${Date.now()}@rakazo.test`,
    "password12",
    "Computer Preferences",
  );
  await completeOnboarding(page);
  await page.getByTitle("Agent computer").click();
  const panel = page.getByTestId("side-panel");
  const separator = page.getByRole("separator", { name: "Resize panel" });
  await expect(separator).toBeVisible();
  await expect(panel).toHaveCSS("width", "384px");
  const before = (await page.getByTestId("computer-preview").boundingBox())!;
  const handle = (await separator.boundingBox())!;
  await page.mouse.move(handle.x + 3, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x - 250, handle.y + 100, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(600);
  const after = (await page.getByTestId("computer-preview").boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width + 200);
  expect(after.height).toBeGreaterThan(before.height + 100);
  await page.reload();
  await page.getByTitle("Agent computer").waitFor({ state: "visible" });
  if ((await page.getByTestId("side-panel").getAttribute("data-panel")) === "closed") {
    await page.getByTitle("Agent computer").click();
  }
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(600);
  const preferredWidth = await page.evaluate(() =>
    Number(localStorage.getItem("rakazo:right-panel-width")),
  );
  await expect
    .poll(async () => Math.round((await panel.boundingBox())!.width))
    .toBe(preferredWidth);
  await page.setViewportSize({ width: 1000, height: 1000 });
  await expect(separator).toHaveAttribute("aria-valuemax", "364");
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(364);
  expect(await page.evaluate(() => localStorage.getItem("rakazo:right-panel-width"))).toBe(
    String(preferredWidth),
  );
  await page.setViewportSize({ width: 1500, height: 1000 });
  await expect(separator).toHaveAttribute("aria-valuemax", "864");
  await expect
    .poll(async () => Math.round((await panel.boundingBox())!.width))
    .toBe(preferredWidth);
  await captureScreenshot(page, testInfo, "computer-resizable-rail");
  await separator.focus();
  await page.keyboard.press("Home");
  await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(320);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(separator).not.toBeVisible();
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(390);
});
