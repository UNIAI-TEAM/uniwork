import { expect, test } from "@playwright/test";

const features = ["dashboard", "tasks", "projects", "today", "calendar", "workflows", "meetings", "chat", "email", "outputs", "documents", "approvals", "knowledge", "ask", "agents", "automation", "organization", "audit"];

test("every product chapter retains visual examples on a narrow English screen", async ({ page, context, baseURL }) => {
  test.setTimeout(180000);
  await context.addCookies([{ name: "uniwork-locale", value: "en", url: baseURL! }]);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const key of features) {
    await page.goto(`/features/${key}`);
    const illustrations = page.locator('.feature-world .feature-art[role="img"]');
    await expect(illustrations).toHaveCount(4);
    for (const illustration of await illustrations.all()) {
      await expect(illustration).toBeVisible();
      await expect(illustration).toHaveAttribute("aria-label", /^Illustrative data:/);
      expect((await illustration.boundingBox())!.width).toBeGreaterThan(250);
    }
    expect(await page.locator("main").innerText()).not.toContain("landing.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator('.feature-page-art .feature-art-window')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.feature-demo [data-action="expand-preview"]')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("visual directory navigates to chapters and the full preview still expands", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/features");
  const cards = page.locator('.feature-directory-visual a[href^="/features/"]');
  await expect(cards).toHaveCount(18);
  await expect(cards.locator('.feature-art[aria-hidden="true"]')).toHaveCount(18);
  await page.locator('.feature-directory-visual a[href="/features/chat"]').click();
  await expect(page).toHaveURL(/\/features\/chat$/);
  await page.locator('.feature-demo [data-action="expand-preview"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').locator('[data-lovable-screen="chat"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
