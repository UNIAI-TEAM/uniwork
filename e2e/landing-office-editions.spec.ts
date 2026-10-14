import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { auditText } from "./contrast";
import { landingReady } from "./landing-ready";

for (const scenario of [
  { width: 1440, theme: "light", locale: "vi", personal: "Office for Personal", status: "Đang phát triển" },
  { width: 390, theme: "dark", locale: "en", personal: "Office for Personal", status: "In development" },
] as const) {
  test(`Office menu keeps Enterprise and truthful upcoming Personal at ${scenario.width}px in ${scenario.theme}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "uniwork-locale", value: scenario.locale, url: baseURL! }]);
    await page.setViewportSize({ width: scenario.width, height: 900 });
    await page.emulateMedia({ colorScheme: scenario.theme, reducedMotion: "reduce" });
    await page.goto("/");
    await landingReady(page);
    if (scenario.width < 1100) {
      await page.locator(".header-mobile-toggle").click();
      await page.locator("#landing-mobile-menu summary").filter({ hasText: /^Office$/ }).click();
    } else {
      await page.getByRole("banner").getByRole("button", { name: "Office", exact: true }).click();
      expect((await auditText(page, "#header-directory-office")).fails).toEqual([]);
    }
    const menu = page.locator(scenario.width < 1100 ? "#landing-mobile-menu" : "#header-directory-office");
    await expect(menu.locator('a[href="/office#office-business"]')).toContainText("Office for Enterprise");
    await expect(menu.locator("[data-office-personal]")).toContainText(scenario.personal);
    await expect(menu.locator("[data-office-personal]")).toContainText(scenario.status);
    await expect(menu.locator('a[href*="office-personal"]')).toHaveCount(0);
    await page.screenshot({ path: resolve(import.meta.dirname, `../.impeccable/review/office-B/menu-${scenario.width}-${scenario.theme}.png`), animations: "disabled" });
    await menu.locator('a[href="/office#office-business"]').click();
    await expect(page).toHaveURL(/\/office#office-business$/);
    await expect(page.locator("#office-title")).toBeInViewport();
    await expect(page.locator(".office-editions, .office-personal")).toHaveCount(0);
  });
}

test("Office trial opens a published Windows installer download", async ({ page }) => {
  const configResponse = page.waitForResponse(response => response.url().includes("/api/v1/config") && response.request().method() === "GET");
  await page.goto("/office");
  await landingReady(page);
  const config = await (await configResponse).json();
  const published = [config.office_installers?.stable, config.office_installers?.beta, config.office_installers?.dev]
    .find((rows: { platform: string; url: string }[] | undefined) => rows?.length) ?? [];
  const installer = published.find((row: { platform: string; url: string }) => row.platform === "win32-x64");
  test.skip(!installer, "This deployment has no published Windows installer.");
  await page.locator(".office-trial-action").click();
  const windows = page.locator('[data-office-os="windows"] a[download]');
  await expect(windows).toHaveAttribute("href", installer.url);
  const [download] = await Promise.all([page.waitForEvent("download"), windows.click()]);
  expect(download.suggestedFilename()).toBe(decodeURIComponent(new URL(installer.url).pathname.split("/").at(-1)!));
  await download.cancel();
});
