import { expect, test } from "@playwright/test";

test("UNI follows scroll, yields to the AI portrait, and respects reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");

  const companion = page.locator(".landing-scroll-mascot");
  await expect(companion).toHaveAttribute("data-visible", "false");
  await page.evaluate(() => window.scrollTo({ top: 650, behavior: "instant" }));
  await expect(companion).toHaveAttribute("data-visible", "true");
  const firstY = (await companion.boundingBox())!.y;

  const duringScroll = await page.evaluate(async () => {
    window.scrollTo({ top: 800, behavior: "instant" });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return document.querySelector<HTMLElement>(".landing-scroll-mascot")?.dataset.running;
  });
  expect(duringScroll).toBe("true");

  await page.evaluate(() => window.scrollTo({ top: 1350, behavior: "instant" }));
  await expect.poll(async () => Math.abs((await companion.boundingBox())!.y - firstY)).toBeGreaterThan(40);
  await expect(companion).toHaveAttribute("data-running", "false");

  await page.locator(".ai-stage").scrollIntoViewIfNeeded();
  await expect(companion).toHaveAttribute("data-visible", "false");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => window.scrollTo({ top: 650, behavior: "instant" }));
  await expect(companion).toHaveCSS("display", "none");
});

test("the mobile companion gives controls and the product demo room", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const companion = page.locator(".landing-scroll-mascot");
  await expect(companion).toHaveCSS("width", "72px");
  await page.evaluate(() => window.scrollTo({ top: 730, behavior: "instant" }));
  await expect(companion).toHaveAttribute("data-visible", "false");
  await page.evaluate(() => window.scrollTo({ top: 1500, behavior: "instant" }));
  await expect(companion).toHaveAttribute("data-visible", "true");
});
