import { expect, test } from "@playwright/test";

const features = ["dashboard", "tasks", "projects", "today", "calendar", "workflows", "meetings", "chat", "email", "outputs", "documents", "approvals", "knowledge", "ask", "agents", "automation", "organization", "audit"];

test("product menu opens real introduction routes, with demo explicitly separate", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const product = page.locator(".header-directory-toggle").nth(0);
  await product.click();
  const menu = page.locator("#header-directory-products");
  await expect(menu).toBeVisible();
  await expect(menu.locator('a[href^="/features/"]')).toHaveCount(18);
  await expect(menu.locator('a[href="/#platform"]')).toHaveText(/Xem demo/);
  await page.screenshot({ path: ".impeccable/review/product-menu-desktop.png", animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(product).toBeFocused();
  await expect(menu).not.toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(menu.locator("a").first()).toBeFocused();
  await menu.locator('a[href="/features/tasks"]').click();
  await expect(page).toHaveURL(/\/features\/tasks$/, { timeout: 20000 });
  await expect(page.locator("h1")).toContainText("Rõ việc");
  await expect(page.locator('.marketing-actions a[href="/#du-an"]')).toBeVisible();
  await expect(page.locator("main")).not.toContainText("landing.productPages");
  await expect(page.locator('.header-navigation a[href="/features/agents"]')).toHaveText("Nhân sự AI");
});

test("all feature introductions have unique content, canonical URL and reference UI", async ({ page }) => {
  test.setTimeout(180000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const headings = new Set<string>();
  for (const key of features) {
    const response = await page.goto(`/features/${key}`);
    expect(response?.status()).toBe(200);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveCount(1);
    headings.add(await heading.innerText());
    await expect(page.locator(".feature-page-details li")).toHaveCount(3);
    await expect(page.locator(".feature-page-visual .lovable-canvas")).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/features/${key}$`));
    expect(await page.locator("main").innerText()).not.toContain("landing.");
  }
  expect(headings.size).toBe(features.length);
  await page.goto("/features/not-a-feature");
  // Streamed App Router responses can already have sent 200 when notFound runs.
  // The app-wide not-found screen (apps/web/app/not-found.tsx) has no "404" heading.
  await expect(page.getByTestId("app-not-found")).toBeVisible();
  await expect(page.locator('meta[name="robots"][content="noindex"]').first()).toBeAttached();
  await expect(page.locator(".feature-page-hero")).toHaveCount(0);
});

for (const sample of [{ width: 1440, color: "light" }, { width: 390, color: "dark" }] as const) {
  test(`public pages render without overflow ${sample.width}-${sample.color}`, async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: sample.width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: sample.color });
    for (const route of ["features/tasks", "features", "solutions", "learn", "pricing", "enterprise"]) {
      const response = await page.goto(`/${route}`);
      expect(response?.status()).toBe(200);
      await expect(page.locator("h1")).toHaveCount(1);
      expect(await page.locator("main").innerText()).not.toContain("landing.");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      if (route === "learn") {
        await expect(page.locator(".faq-question-label").first()).toHaveCSS("display", "flex");
        const questions = page.locator("#questions");
        await questions.getByRole("button", { name: /Xem thêm câu hỏi/ }).click();
        await expect(questions.getByRole("button", { name: /Thu gọn/ })).toBeVisible();
        await questions.getByRole("button", { name: /Thu gọn/ }).click();
        await page.evaluate(() => scrollTo(0, 0));
      }
      if (["features/tasks", "pricing", "learn"].includes(route)) await page.screenshot({ path: `.impeccable/review/product-${route.replaceAll("/", "-")}-${sample.width}.png`, animations: "disabled", fullPage: true });
    }
    if (sample.width === 390) {
      await page.getByRole("button", { name: "Mở menu", exact: true }).click();
      const mobile = page.locator("#landing-mobile-menu");
      await mobile.locator("summary").first().click();
      await expect(mobile.locator('a[href="/features/chat"]')).toBeVisible();
      await page.screenshot({ path: ".impeccable/review/product-menu-mobile.png", animations: "disabled" });
      await mobile.locator('a[href="/features/chat"]').click();
      await expect(page).toHaveURL(/\/features\/chat$/);
      await expect(mobile).toHaveCount(0);
    }
  });
}

test("English introductions and solution/resources links remain usable", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "uniwork-locale", value: "en", url: baseURL! }]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/features/meetings");
  await expect(page.locator("h1")).toHaveText("Meet together. Keep the context.");
  await page.locator(".header-directory-toggle").nth(1).click();
  await expect(page.locator('#header-directory-solutions a[href="/solutions/product"]')).toBeVisible();
  await page.locator(".header-directory-toggle").nth(2).click();
  await expect(page.locator("#header-directory-solutions")).toHaveCount(0);
  await page.locator('#header-directory-learn a[href="/learn"]').first().click();
  await expect(page).toHaveURL(/\/learn$/);
  await expect(page.locator("h1")).toHaveText("Start with one working flow.");
});
