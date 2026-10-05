import { expect, test } from "@playwright/test";
import { auditText } from "./contrast";

const overview = ["learn", "features", "solutions", "solutions/product", "solutions/operations", "pricing", "enterprise"];
const features = ["dashboard", "tasks", "projects", "today", "calendar", "workflows", "meetings", "chat", "email", "outputs", "documents", "approvals", "knowledge", "ask", "agents", "automation", "organization", "audit"];
const samples = [
  { width: 1440, locale: "vi", mode: "light", all: true },
  { width: 390, locale: "en", mode: "dark", all: true },
  { width: 1510, locale: "en", mode: "dark", all: false },
  { width: 768, locale: "vi", mode: "light", all: false },
  { width: 320, locale: "vi", mode: "light", all: false },
] as const;

for (const sample of samples) {
  test(`public chapters ${sample.width}-${sample.locale}-${sample.mode}`, async ({ page, context, baseURL }) => {
    test.setTimeout(300000);
    await context.addCookies([{ name: "uniwork-locale", value: sample.locale, url: baseURL! }]);
    await page.setViewportSize({ width: sample.width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: sample.mode });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const leaves = sample.all ? features : ["tasks", "chat", "automation"];
    for (const route of [...overview, ...leaves.map(key => `features/${key}`)]) {
      const response = await page.goto(`/${route}`);
      expect(response?.status(), route).toBe(200);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      expect(await page.locator("main").innerText(), route).not.toMatch(/landing\.(chapters|productPages|featureVisuals)\./);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), route).toBeLessThanOrEqual(1);
      const contrast = await auditText(page, ".chapter-world > :not(.feature-demo)");
      expect(contrast.fails, `${route} contrast`).toEqual([]);
      if (route.startsWith("features/")) {
        await expect(page.locator(".feature-example-copy h3")).toHaveCount(3);
        await expect(page.locator('.feature-page-art .feature-art[role="img"]')).toBeVisible();
        await expect(page.locator('.feature-page-details .feature-art[role="img"]')).toHaveCount(3);
        await expect(page.locator('.feature-demo [data-action="expand-preview"]'), route).toBeVisible();
      } else {
        await expect(page.locator(".chapter-hero .chapter-scene")).toBeVisible();
      }
      if (["solutions", "pricing", "enterprise"].includes(route)) {
        await expect(page.getByRole("table")).toHaveCount(1);
        await expect(page.locator(".chapter-table tbody tr")).toHaveCount(3);
      }
      if (route === "features") {
        await expect(page.locator(".feature-family-nav a")).toHaveCount(6);
        await expect(page.locator('.feature-directory-visual a[href^="/features/"]')).toHaveCount(18);
        await page.locator('.feature-family-nav a[href="#family-ai"]').click();
        await expect(page).toHaveURL(/#family-ai$/);
        await expect(page.locator("#family-ai")).toBeInViewport();
      }
      if (route === "learn") {
        for (const key of ["workspace", "task", "sources"]) {
          await page.locator(`.chapter-jumps a[href="#learn-${key}"]`).click();
          await expect(page).toHaveURL(new RegExp(`#learn-${key}$`));
          await expect(page.locator(`#learn-${key}`)).toBeInViewport();
        }
        const faq = page.locator("#questions");
        await faq.locator(".faq-more").click();
        await expect(faq.locator(".faq-more")).toHaveAttribute("aria-expanded", "true");
        await faq.locator(".faq-more").click();
        await expect(faq.locator(".faq-more")).toHaveAttribute("aria-expanded", "false");
      }
    }
    expect(errors).toEqual([]);
    await page.goto("/solutions");
    await page.locator('.chapter-table a[href="/solutions/product"]').click();
    await expect(page).toHaveURL(/\/solutions\/product$/);
    await expect(page.locator(".chapter-row")).toHaveCount(3);
  });
}

test("contextual closing demo links open their actual preview", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "uniwork-locale", value: "en", url: baseURL! }]);
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  const destinations = [
    ["learn", "tasks"], ["pricing", "tasks"], ["enterprise", "organization"],
    ["solutions/product", "tasks"], ["solutions/operations", "organization"],
  ] as const;
  for (const [route, feature] of destinations) {
    await page.goto(`/${route}`);
    const demo = page.locator(".final-compact-demo");
    await expect(demo).toHaveAttribute("href", `/features/${feature}#feature-preview`);
    await demo.click();
    await expect(page).toHaveURL(new RegExp(`/features/${feature}#feature-preview$`));
    await expect(page.locator("#feature-demo-title")).toBeInViewport();
    await expect(page.locator('.feature-demo [data-action="expand-preview"]')).toBeVisible();
  }
});
