import { selectWorkspaceFeature, workspaceGroups } from "./landing-catalog-helpers";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { auditText } from "./contrast";
import { landingReady, gotoLanding } from "./landing-ready";

for (const size of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
  for (const locale of ["vi", "en"]) {
    test(`unified workspace views render in both themes: ${size.name}-${locale}`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: "uniwork-locale", value: locale, url: baseURL! }]);
      await page.setViewportSize(size);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await gotoLanding(page, "/");
      await landingReady(page);
      await page.waitForLoadState("networkidle");
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => document.documentElement.classList.toggle("dark", value === "dark"), theme);
        for (const key of Object.values(workspaceGroups).flat()) {
          await selectWorkspaceFeature(page, key);
          await expect(page.locator("body")).not.toContainText(/landing\.[a-zA-Z][\w.]+/);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          expect.soft((await auditText(page)).fails).toEqual([]);
          if (process.env.LANDING_CAPTURE === "1" && (locale === "vi" && theme === "light" && ["tasks", "projects", "documents", "organization"].includes(key) || locale === "en" && theme === "dark" && ["knowledge", "audit"].includes(key))) {
            const directory = resolve(import.meta.dirname, "../.impeccable/review");
            await mkdir(directory, { recursive: true });
            await page.locator("#platform").screenshot({ path: resolve(directory, `catalog-${size.name}-${locale}-${theme}-${key}.png`), style: ".site-header, .landing-skip, nextjs-portal { visibility: hidden !important; }" });
          }
        }
      }
    });
  }
}

test("workspace finishes revealing without extra scrolling and respect reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await gotoLanding(page, "/");
  await landingReady(page);
  await page.waitForLoadState("networkidle");
  for (const id of ["platform"]) {
    const surface = page.locator(`#${id} > div`);
    await page.evaluate((target) => {
      const section = document.getElementById(target)!;
      window.scrollTo({ top: section.getBoundingClientRect().top + window.scrollY - innerHeight * .8, behavior: "instant" });
    }, id);
    await expect(surface).toHaveAttribute("data-scroll-reveal", "ready");
    await expect.poll(() => surface.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const id of ["platform"]) {
    await expect.poll(() => page.locator(`#${id}`).evaluate((element) => getComputedStyle(element).transform)).toBe("none");
    await expect.poll(() => page.locator(`#${id} > div`).evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  }
});
