import { expect, test } from "@playwright/test";
import { openManualPreview, selectWorkspaceFeature } from "./landing-catalog-helpers";

for (const width of [1440, 768, 390]) {
  test(`manual navigation layers share one preview at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#hop");
    await page.waitForLoadState("networkidle");
    await openManualPreview(page);
    const stage = page.locator("#product-preview");
    const rail = stage.getByRole("navigation", { name: "Điều hướng trong bản xem trước" });
    await expect(rail).toBeVisible();
    await expect(rail.locator("button")).toHaveCount(6);
    await expect(rail.locator('[aria-current="page"]')).toHaveAttribute("data-app-section", "connect");
    await expect(stage.getByRole("tablist")).toHaveCount(1);
    await expect(stage.getByRole("tabpanel")).toHaveCount(1);

    const ai = rail.locator('[data-app-section="ai"]');
    await ai.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#hoi-uni$/);
    await expect(stage.locator('[role="tab"][data-feature="ask"]')).toHaveAttribute("aria-selected", "true");
    await expect(ai).toBeFocused();
    await expect(ai).toHaveAttribute("aria-current", "page");

    await selectWorkspaceFeature(page, "email", false);
    await expect(rail.locator('[data-app-section="connect"]')).toHaveAttribute("aria-current", "page");
    await rail.locator('[data-app-section="connect"]').click();
    await expect(page).toHaveURL(/#email$/);
    await rail.locator('[data-app-section="work"]').click();
    await expect(page).toHaveURL(/#du-an$/);
    await expect(stage.getByRole("tabpanel")).toHaveCount(1);

    const railBox = await rail.boundingBox();
    const content = await stage.locator(".preview-main").boundingBox();
    expect(railBox).not.toBeNull();
    expect(content).not.toBeNull();
    if (width > 600) expect(content!.x).toBeGreaterThanOrEqual(railBox!.x + railBox!.width - 1);
    else expect(content!.y).toBeGreaterThanOrEqual(railBox!.y + railBox!.height - 1);
    for (const button of await rail.locator("button").all()) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await stage.screenshot({ path: `.impeccable/review/dual-navigation-${width}.png`, animations: "disabled" });
  });
}

for (const width of [1440, 390]) {
  test(`English dark navigation stays legible at ${width}px`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "uniwork-locale", value: "en", url: baseURL! }]);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await page.goto("/#email");
    await page.waitForLoadState("networkidle");
    await openManualPreview(page);
    const stage = page.locator("#product-preview");
    const rail = stage.getByRole("navigation", { name: "Preview app navigation" });
    await expect(rail).toBeVisible();
    await expect(rail.locator('[data-app-section="connect"]')).toHaveAttribute("aria-current", "page");
    for (const [feature, section] of [["today", "home"], ["calendar", "work"], ["approvals", "docs"], ["knowledge", "docs"], ["agents", "ai"], ["audit", "team"]]) {
      await selectWorkspaceFeature(page, feature!, false);
      await expect(rail.locator('[aria-current="page"]')).toHaveAttribute("data-app-section", section!);
    }
    await selectWorkspaceFeature(page, "meetings", false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.mouse.move(0, 0);
    await stage.screenshot({ path: `.impeccable/review/dual-navigation-en-dark-${width}.png`, animations: "disabled" });
  });
}
