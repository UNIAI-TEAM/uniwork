import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { landingReady, gotoLanding } from "./landing-ready";

test("skip link remains hidden without focus across tall section captures", async ({ page }) => {
  for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: 960 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLanding(page, "/");
  await landingReady(page);
  // The shared app Providers remount landing after auth/config settles.
  // Focus assertions must use that final tree, not the pre-refresh DOM.
  await page.waitForLoadState("networkidle");
  const link = page.locator(".landing-skip");
  const region = page.locator(".landing-trust-story");
  await region.scrollIntoViewIfNeeded();
  await page.locator(".security-explore").focus();
  const probe = () => link.evaluate(element => ({ focused: element.matches(":focus"), transform: getComputedStyle(element).transform, top: element.getBoundingClientRect().top, bottom: element.getBoundingClientRect().bottom, scrollY }));
  await region.screenshot();
  expect((await probe()).bottom).toBeLessThanOrEqual(0);
  await expect(link).toHaveCSS("clip-path", "inset(50%)");
  await gotoLanding(page, "/");
  await landingReady(page);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".landing-site h1")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  expect((await probe()).top).toBeGreaterThanOrEqual(0);
  await expect(link).toHaveCSS("clip-path", "none");
  if (process.env.LANDING_CAPTURE === "1") await page.screenshot({ path: resolve(import.meta.dirname, `../.impeccable/review/skip-focused-${width}.png`), style: "nextjs-portal { display: none !important; }" });
  await page.locator(".security-explore").focus();
  expect((await probe()).bottom).toBeLessThanOrEqual(0);
  await expect(link).toHaveCSS("clip-path", "inset(50%)");
  if (process.env.LANDING_CAPTURE === "1") await page.screenshot({ path: resolve(import.meta.dirname, `../.impeccable/review/skip-unfocused-${width}.png`), style: "nextjs-portal { display: none !important; }" });
  }
});
