import { expect, test } from "@playwright/test";

test("the product directory covers the AI-to-output workflow", async ({ page }) => {
  await page.goto("/features");
  for (const slug of ["ai-brain", "skills", "work-catalog", "decisions", "decision-history", "ai-market", "reports"]) {
    await expect(page.locator(`.feature-directory a[href='/features/${slug}']`)).toBeVisible();
  }
  await page.goto("/features/approvals");
  await expect(page.locator(".feature-page-details")).toContainText("phiên bản");
  await expect(page.locator(".feature-workflow")).toBeVisible();
  await expect(page.locator(".feature-questions details")).toHaveCount(2);
});

test("the connected story demonstrates an explicit review boundary", async ({ page }) => {
  await page.goto("/");
  const journey = page.locator(".work-journey");
  await journey.locator(".journey-steps button").nth(3).click();
  await expect(journey.locator(".journey-result")).toContainText("v2");
  await expect(journey.locator(".journey-steps button").nth(3)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("footer a").filter({ hasText: /^Liên hệ$/ })).toHaveCount(0);
});

test("mobile previews are readable summaries, including in the dialog", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/features/tasks");
  const preview = page.locator(".feature-page-visual");
  await expect(preview.locator(".mobile-feature-story")).toBeVisible();
  await expect(preview.locator(".lovable-canvas")).toBeHidden();
  await preview.locator(".mobile-story-steps button").nth(2).click();
  await expect(preview.locator(".mobile-story-steps button").nth(2)).toHaveAttribute("aria-pressed", "true");
  await preview.locator('[data-action="expand-preview"]').click();
  await expect(page.getByRole("dialog").locator(".mobile-feature-story")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("learn includes actionable steps and metadata follows the locale", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await page.goto("http://localhost:3000/learn");
  await expect(page).toHaveTitle(/Start with one working flow/);
  await expect(page.locator(".learning-instructions")).toHaveCount(3);
  await expect(page.locator("#setup")).toContainText("configuration");
  await context.close();
});

test("changing language also refreshes the title without losing the selected story", async ({ page }) => {
  await page.goto("/");
  await page.locator(".journey-steps button").nth(2).click();
  await page.getByRole("button", { name: "Ngôn ngữ", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "English", exact: true }).click();
  await expect(page.locator("h1")).toContainText("Your team.");
  await expect(page).toHaveTitle(/Your team/);
  await expect(page.locator(".journey-steps button").nth(2)).toHaveAttribute("aria-pressed", "true");
});
