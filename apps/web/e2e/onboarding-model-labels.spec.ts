import { expect, test } from "@playwright/test";
import { captureScreenshot, signup } from "./helpers";

test("onboarding offers coding agents first and catalog models on toggle", async ({
  page,
}, testInfo) => {
  await page.route("**/rpc/me", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { json: Record<string, unknown> };
    await route.fulfill({
      response,
      json: {
        json: {
          ...body.json,
          needsModel: true,
          defaultProvider: "openrouter",
          defaultModel: "openai/gpt-5.6-luna",
        },
      },
    });
  });

  const stamp = Date.now();
  await signup(page, `model-labels-${stamp}@rakazo.test`, "password12", `Model labels ${stamp}`);
  await expect(page.getByRole("heading", { name: "Connect a model" })).toBeVisible({
    timeout: 20_000,
  });

  // The default view is coding agents: brand cards, no provider dropdown,
  // no server URL, and no API key anywhere on the front page.
  await expect(page.getByRole("button", { name: /Codex/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Claude Code/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /OpenCode/ })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Provider" })).toHaveCount(0);
  await expect(page.getByText("Server URL")).toHaveCount(0);
  await expect(page.getByLabel(/API key/)).toHaveCount(0);

  await page.getByRole("button", { name: "Use subscription or API models instead" }).click();

  const provider = page.getByRole("combobox", { name: "Provider" });
  await expect(provider).toContainText("OpenRouter");
  await page.getByLabel("API key").fill("openrouter-only-key");
  await provider.click();
  await expect(page.getByRole("option", { name: "ChatGPT" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Vercel AI Gateway" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Anthropic" })).click();
  await expect(provider).toContainText("Anthropic");
  await expect(page.getByLabel(/API key/)).toHaveValue("");

  const models = page.getByRole("combobox", { name: "Model", exact: true });
  await models.click();
  const labels = await page.getByRole("option").allTextContents();
  // "latest" is an upstream alias marker, so it lands on families like Claude Opus 4.5 while
  // newer models carry no marker. Rendered as-is it tells the user the opposite of the truth.
  expect(labels.filter((label) => /\blatest\b/i.test(label))).toEqual([]);

  // Select a non-default model and keep its user-facing alias visible in the compact trigger.
  const alias = labels.find((label) => label.includes("(auto-updates)"));
  expect(alias).toBeTruthy();
  await page.getByRole("option", { name: alias! }).click();
  await expect(models).toContainText(alias!);

  // Custom servers are gone from the picker: no compatible option, no probe UI.
  await provider.click();
  await expect(page.getByRole("option", { name: "OpenAI-compatible" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find models" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Use coding agents instead" }).click();
  await expect(page.getByRole("button", { name: /Codex/ })).toBeVisible();

  await captureScreenshot(page, testInfo, "onboarding-model-labels");
});
