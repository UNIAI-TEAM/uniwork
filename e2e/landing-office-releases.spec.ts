import { expect, test } from "@playwright/test";
import { manifestUrls, testManifest } from "../apps/web/features/landing/office-download/test-manifest";
import { landingReady, gotoLanding } from "./landing-ready";

// The manifest in the shape the release job writes, served by the route: beta has one release, dev two.
const manifest = testManifest();
const download = "#office-download";
const spot = `${download} .office-dl-spot:not(.is-skeleton)`;

for (const width of [1440, 390]) {
  test(`Office download reads the release manifest and switches channel at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route("**/downloads/office/releases.json", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(manifest) }));
    await gotoLanding(page, "/apps/office");
    await landingReady(page);
    await expect(page.locator(`${download} .office-dl-quiet-alert`)).toHaveCount(0);
    // Beta is the most stable published channel. The visitor's own system leads, whichever system runs the browser.
    await expect(page.locator(`${download} [role=tab][aria-selected=true]`)).toContainText("Beta");
    await expect(page.locator(`${spot} .office-dl-spot-meta`)).toContainText("0.10.0-beta.1");
    const beta = await page.locator(`${spot} a[download]`).evaluateAll(anchors => anchors.map(anchor => anchor.getAttribute("href")));
    expect(beta.length).toBeGreaterThan(0);
    for (const href of beta) {
      expect(manifestUrls(manifest).has(href ?? "")).toBe(true);
      expect(href).toContain("/beta/0.10.0-beta.1/");
    }
    await page.locator(`${download} [role=tab]`).filter({ hasText: /^Dev/ }).click();
    await expect(page).toHaveURL(/[?&]channel=dev(&|$)/);
    await expect(page.locator(`${spot} .office-dl-spot-meta`)).toContainText("0.11.0-dev.3");
    const dev = await page.locator(`${spot} a[download]`).evaluateAll(anchors => anchors.map(anchor => anchor.getAttribute("href")));
    expect(dev.length).toBeGreaterThan(0);
    for (const href of dev) {
      expect(manifestUrls(manifest).has(href ?? "")).toBe(true);
      expect(href).toContain("/dev/0.11.0-dev.3/");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
