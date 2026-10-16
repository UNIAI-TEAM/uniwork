import { expect, test } from "@playwright/test";
import { gotoLanding, landingReady } from "./landing-ready";

for (const width of [1440, 768, 390]) {
  test(`one app menu supports keyboard navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoLanding(page, "/#email");
    await landingReady(page);
    await page.waitForLoadState("networkidle");
    const stage = page.locator("#product-preview");
    const toggle = stage.locator('[data-action="toggle-demo-menu"]');
    if (width < 768) await toggle.click();
    await expect(stage.getByRole("tablist")).toHaveCount(1);
    await expect(stage.getByRole("tab")).toHaveCount(26);
    const email = stage.locator('[data-feature="email"]');
    await expect(email).toHaveAttribute("tabindex", "0");
    await email.focus();
    await page.keyboard.press("ArrowDown");
    const meetings = stage.locator('[data-feature="meetings"]');
    await expect(meetings).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#hop$/);
    await expect(stage.getByRole("tabpanel")).toHaveCount(1);
    await expect(stage.locator(".product-playback")).toBeVisible();
    if (width < 768) {
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await stage.getByRole("tabpanel").focus();
      await toggle.click();
      await page.keyboard.press("Escape");
      await expect(toggle).toBeFocused();
    } else {
      await stage.locator('[data-action="toggle-demo-sidebar"]').click();
      await expect(stage.locator(".product-demo-shell")).toHaveAttribute("data-collapsed", "true");
      await stage.locator('[data-feature="tasks"]').click();
      await expect(page).toHaveURL(/#du-an$/);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}
