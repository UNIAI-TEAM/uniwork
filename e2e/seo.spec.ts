import { expect, test } from "@playwright/test";
import { landingReady } from "./landing-ready";

test("public locale follows URLs even when the cookie asks for the other language", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "uniwork-locale", value: "vi", url: baseURL! }]);
  const hydrationErrors: string[] = [];
  page.on("pageerror", error => hydrationErrors.push(error.message));
  await page.goto("/office");
  await landingReady(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".office-sub")).toContainText("Create documents");
  await page.getByRole("button", { name: "Language", exact: true }).click();
  const vietnamese = page.getByRole("menuitem", { name: "Tiếng Việt" });
  await expect(vietnamese).toHaveAttribute("href", "/vi/office");
  await vietnamese.click();
  await landingReady(page);
  await expect(page).toHaveURL(/\/vi\/office$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  await expect(page.locator(".office-sub")).toContainText("Soạn thảo");
  await expect(page.locator('.office-hero a[href="/vi/request-demo"]')).toBeVisible();
  await page.locator('.office-hero a[href="/vi/request-demo"]').click();
  await landingReady(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  await expect(page.locator('form input[name="full_name"]')).toBeVisible();
  expect(hydrationErrors).toEqual([]);
});

test("guides render without JavaScript and expose related localized destinations", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/vi/learn/office-files-and-ai");
  await expect(page.locator("h1")).toContainText("Hướng dẫn UniWork Office");
  await expect(page.locator('.public-guide-related a[href="/vi/office"]')).toBeVisible();
  await expect(page.locator(".public-guide-table tbody tr")).toHaveCount(6);
  await expect(page.locator(".public-guide-table")).toContainText("10 MiB");
  await expect(page.locator("article")).toContainText("yêu cầu dùng khóa API riêng đi qua máy chủ UniWork");
  await expect(page.locator('link[hreflang="en"]')).toHaveAttribute("href", /\/learn\/office-files-and-ai$/);
  await context.close();
});

test("Office guide facts, example images and tables work on mobile in both languages and themes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const theme of ["light", "dark"] as const) {
    for (const prefix of ["", "/vi"]) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.goto(`${prefix}/learn/office-files-and-ai`);
      await landingReady(page);
      await expect(page.locator(".public-guide-table tbody tr")).toHaveCount(6);
      await expect(page.locator(".public-guide-table")).toContainText("10 MiB");
      const figure = page.locator(".public-guide-illustration");
      await figure.scrollIntoViewIfNeeded();
      const selected = figure.locator(`.public-guide-image-${theme}`);
      await expect(selected).toBeVisible();
      await expect.poll(() => selected.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      await expect(figure.locator(`.public-guide-image-${theme === "dark" ? "light" : "dark"}`)).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});

test("public auth links load the application provider and retain Vietnamese", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "uniwork-locale", value: "en", url: baseURL! }]);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/vi/office");
  await landingReady(page);
  await page.locator('.header-login[href="/login"]').click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  expect(errors).toEqual([]);
});

test("Vietnamese and English mobile guides work in both themes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const path of ["/learn/start-with-tasks", "/vi/learn/start-with-tasks", "/security", "/vi/security"]) {
      await page.goto(path);
      await landingReady(page);
      await expect(page.locator("h1")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
});
