import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test(
  "onboarding local-first: continues without an API key when a local model is available",
  async ({ page }, testInfo) => {
    // Local-owner mode lands the user on /app when needsModel is false, so the
    // "Connect a model" slot is not part of the default local path. To exercise
    // the local-first model step in this environment, intercept rpc.me and force
    // the model step the same way hosted onboarding e2e force needsModel:true.
    await page.route("**/rpc/me", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as any;
      await route.fulfill({
        response,
        json: {
          json: {
            ...body.json,
            needsModel: true,
            defaultProvider: "openai-compatible",
            defaultModel: "custom",
          },
        },
      });
    });

    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: "Connect a model" })).toBeVisible({
      timeout: 20_000,
    });

    // Without a local model server there is no local-first path to exercise.
    const probe = await page
      .request.get("http://127.0.0.1:11434/v1/models")
      .then((response) => (response.ok() ? response.json() : null))
      .catch(() => null);
    test.skip(
      !probe,
      "no local model server on 127.0.0.1:11434: local-first onboarding needs one",
    );

    const provider = page.getByRole("combobox", { name: "Provider" });
    await expect(provider).toContainText("OpenAI-compatible");

    const localModelButton = page.getByRole("button", { name: /:/i }).first();

    await expect(localModelButton).toBeVisible({
      timeout: 25_000,
    });
    await localModelButton.click();

    // Allow the connect-ready flow to settle: the selected local model must show
    // a discovered-models Select once the subsequent probe completes.
    await expect(
      page.getByRole("combobox", { name: "Models from server" }),
    ).toBeVisible({ timeout: 25_000 });

    await captureScreenshot(page, testInfo, "local-first-connect-a-model");
    await captureScreenshot(page, testInfo, "local-first-connect-a-model-selected");

    // Dropdown padding proof (the reported sticky-text bug): open the
    // discovered-models Select and assert DESIGN.MD item padding — px-1.5
    // resolves to 6px on each side — before screenshotting the open state.
    const modelsCombobox = page.getByRole("combobox", { name: "Models from server" });
    await modelsCombobox.click();
    const firstOption = page.getByRole("option").first();
    await expect(firstOption).toBeVisible({ timeout: 10_000 });
    await expect(firstOption).toHaveCSS("padding-left", "6px");
    await expect(firstOption).toHaveCSS("padding-right", "6px");
    await expect(firstOption).toHaveCSS("padding-top", "4px");
    await captureScreenshot(page, testInfo, "local-first-models-dropdown-open");
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Continue" }).click();
    // The model step is followed by the Server integrations step, not the
    // shell: skip it the same way the shared onboarding helper does.
    const integrations = page.getByRole("heading", { name: "Server integrations", exact: true });
    await integrations.or(page.getByText("Chief").first()).waitFor({ timeout: 20_000 });
    if (await integrations.isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "Skip", exact: true }).click();
    }
    await page.waitForURL(/\/app\/[^/]+$/, { timeout: 40_000 });
  },
);
