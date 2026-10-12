import { expect, test } from "@playwright/test";

for (const width of [1440, 940, 768]) test("desktop staging keeps UNI visible beside the foreground at " + width + "px", async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" }); await page.goto("/");
  const world = page.locator(".studio-world");
  await expect(world).toHaveAttribute("data-rendered", "true", { timeout: 20000 });
  for (const progress of [0, .1, .2, .3, .5, .7, .8, .9, 1]) {
    await page.evaluate(p => window.scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * p, behavior: "instant" }), progress);
    await expect.poll(async () => Math.abs(Number(await world.getAttribute("data-pose")) - progress)).toBeLessThan(.001);
    await expect(world).toHaveAttribute("data-running", "false");
    const actor = await world.evaluate(el => ({
      left: Number((el as HTMLElement).dataset.characterLeft),
      right: Number((el as HTMLElement).dataset.characterRight),
      top: Number((el as HTMLElement).dataset.characterTop),
      bottom: Number((el as HTMLElement).dataset.characterBottom),
    }));
    expect(Number.isFinite(actor.left)).toBe(true);
    expect(actor.right).toBeLessThanOrEqual(width - 12);
    expect(actor.top).toBeGreaterThan(90);
    const panels = await page.locator(".landing-hero-copy, #platform, #business-os, #giai-phap, .ai-stage-copy, .landing-trust-story, #lo-trinh, #bang-gia, .landing-faq, #lien-he, .landing-site > footer").evaluateAll(elements =>
      elements.map(el => el.getBoundingClientRect().toJSON()).filter(r => r.bottom > 0 && r.top < innerHeight));
    for (const panel of panels) if (panel.bottom > actor.top && panel.top < actor.bottom)
      expect(actor.left, "visible actor must clear the reading surface").toBeGreaterThanOrEqual(panel.right + 12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
test("phone jumps and greeting occur in the actual native-scroll scene windows", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" }); await page.goto("/");
  const world = page.locator(".studio-world");
  await expect(world).toHaveAttribute("data-rendered", "true", { timeout: 20000 });
  const windows = page.locator(".studio-world-passage");
  for (let index = 0; index < 3; index++) {
    const target = await windows.nth(index).evaluate(el => { const r = el.getBoundingClientRect(); return r.top + scrollY + r.height / 2 - innerHeight / 2; });
    await page.evaluate(top => window.scrollTo({ top, behavior: "instant" }), target);
    const scenePose = [.30, .695, 1][index]!;
    await expect.poll(async () => Math.abs(Number(await world.getAttribute("data-scene-pose")) - scenePose)).toBeLessThan(.001);
    await expect(world).toHaveAttribute("data-running", "false");
    await expect(world).toHaveAttribute("data-action", index < 2 ? "jump" : "idle");
    const actor = await world.evaluate(el => ({ top: Number((el as HTMLElement).dataset.characterTop), bottom: Number((el as HTMLElement).dataset.characterBottom) }));
    const visibleWindow = await windows.nth(index).boundingBox();
    expect(actor.top).toBeGreaterThan(84);
    expect(actor.bottom).toBeLessThan(832);
    expect(actor.top).toBeGreaterThanOrEqual(visibleWindow!.y);
    expect(actor.bottom).toBeLessThanOrEqual(visibleWindow!.y + visibleWindow!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});