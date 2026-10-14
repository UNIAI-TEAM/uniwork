import { selectWorkspaceFeature, openManualPreview } from "./landing-catalog-helpers";
import { expect, test } from "@playwright/test";

test("landing demo controls perform the actions they advertise without workspace writes", async ({ page }) => {
  await page.goto("/");
  const demo = page.locator("#product-preview");
  await openManualPreview(page);
  const writes: string[] = [];
  // The app shell refreshes auth and sends RUM; neither is a workspace mutation.
  page.on("request", request => { const path = new URL(request.url()).pathname; if (request.method() !== "GET" && path.startsWith("/api/v1/") && !path.includes("/auth/") && path !== "/api/v1/rum") writes.push(request.url()); });
  await demo.getByRole("searchbox").fill("phạm vi");
  await expect(demo.locator(".preview-task")).toHaveCount(1);
  await demo.getByRole("searchbox").clear();
  await demo.getByRole("button", { name: /Thiết kế trải nghiệm/ }).click();
  await demo.getByRole("button", { name: "Đánh dấu hoàn thành", exact: true }).click();
  await expect(demo.locator(".status-done").locator("..")).toContainText("Thiết kế trải nghiệm");
  await selectWorkspaceFeature(page, "chat");
  await demo.getByRole("textbox", { name: "Tin nhắn minh họa" }).fill("Nhóm mình đã sẵn sàng");
  await demo.getByRole("button", { name: "Gửi tin nhắn", exact: true }).click();
  await expect(demo.getByRole("tabpanel", { name: "Trao đổi", exact: true }).locator(".preview-message").last()).toContainText("Nhóm mình đã sẵn sàng");
  await selectWorkspaceFeature(page, "ask");
  await demo.getByRole("button", { name: "Ai đang phụ trách?", exact: true }).click();
  await expect(demo.locator(".preview-answer")).toContainText("Hoàng Anh");
  expect(writes).toEqual([]);
});

test("product showcase, cinematic playback and reduced motion remain usable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const core = page.locator('.landing-hero');
  await expect(core).toBeVisible();
  await expect(core.locator('h1')).toBeVisible();
  const character = page.locator('[data-scene="character"]');
  await character.scrollIntoViewIfNeeded();
  await expect(character.locator('.mascot-portrait img')).toHaveJSProperty('complete', true);
  await expect(character.locator('.mascot-portrait')).toHaveAttribute('data-rendered', 'true', { timeout: 20000 });
  await expect(character.locator('.mascot-portrait')).toHaveAttribute('data-running', 'false');
  await expect(character.getByRole('button', { name: 'Xoay mô hình', exact: true })).toHaveCount(0);
  await expect(character).toHaveAttribute('data-motion', 'paused');
  await expect(character.getByRole("button")).toHaveCount(0);
  await selectWorkspaceFeature(page, "meetings");
  await page.locator(".meeting-follow-up [data-slot=accordion-trigger]").click();
  const film = page.locator(".workflow-film");
  await film.scrollIntoViewIfNeeded();
  await expect(film.locator("video")).toHaveJSProperty("paused", true);
  await film.getByRole("button", { name: "Phát phim", exact: true }).click();
  await expect(film.locator("video")).toHaveJSProperty("paused", false);
  await film.getByRole("button", { name: "Tạm dừng phim", exact: true }).click();
  await expect(film.locator("video")).toHaveJSProperty("paused", true);
});

test("hero offers registration and a demo request in a minimal opening", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const hero = page.locator(".landing-hero");
  await expect(hero.locator(".landing-hero-actions a")).toHaveCount(2);
  await expect(hero.locator('img')).toHaveCount(0);
  await expect(hero.locator('.hero-product-callout')).toHaveCount(0);
  await expect(hero.locator('.hero-product-feature')).toHaveCount(0);
  const preview = page.locator("#product-preview");
  await openManualPreview(page);
  await expect(preview.locator(".workspace-group-button")).toHaveCount(6);
  // Work & projects: Dashboard, Tasks, Projects, Today, Calendar, Workflows.
  await expect(preview.getByRole("tab")).toHaveCount(6);
  await expect(hero.getByRole("tab")).toHaveCount(0);
  await expect(preview.locator(".preview-sidebar")).toHaveCount(0);
  await expect(page.locator(".landing-product-story > section")).toHaveCount(4);
});

test("Starter and FAQ signals animate only while visible and respect reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const pricing = page.locator("#bang-gia");
  const faq = page.locator(".landing-faq");
  await pricing.scrollIntoViewIfNeeded();
  await expect(pricing).toHaveAttribute("data-motion-visible", "true");
  await expect(pricing.locator(".pricing-plan-diagram")).toBeVisible();
  await expect.poll(() => pricing.locator(".pricing-diagram-lines path").first().evaluate(element => getComputedStyle(element).animationPlayState)).toBe("running");
  await expect.poll(() => pricing.locator(".pricing-diagram-lines path").first().evaluate(element => getComputedStyle(element).animationIterationCount)).toBe("1");

  await faq.scrollIntoViewIfNeeded();
  await expect(pricing).toHaveAttribute("data-motion-visible", "false");
  await expect.poll(() => pricing.locator(".pricing-diagram-lines path").first().evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  await expect(faq).toHaveAttribute("data-motion-visible", "true");
  await expect(faq.locator(".faq-story-wiring path")).toHaveCount(3);
  await expect.poll(() => faq.locator(".faq-story-wiring path").first().evaluate(element => getComputedStyle(element).animationPlayState)).toBe("running");
  await expect.poll(() => faq.locator(".faq-story-wiring path").first().evaluate(element => getComputedStyle(element).animationIterationCount)).toBe("1");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => faq.locator(".faq-story-wiring path").first().evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  await faq.locator("[data-slot=accordion-trigger]").first().click();
  await expect(faq.locator("[data-slot=accordion-item]").first()).toHaveAttribute("data-open", "");
});

test("framed scenes arrive on scroll and remain readable after the entrance", async ({ page }) => {
  await page.setViewportSize({ width: 1294, height: 584 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator(".landing-signal, .landing-chapter-junction")).toHaveCount(0);
  await expect(page.locator(".landing-product-story > section")).toHaveCount(4);
  await expect(page.locator(".landing-conversion-story > section")).toHaveCount(3);

  const chapter = page.locator(".landing-trust-story");
  await expect.poll(() => chapter.evaluate((element) => {
    const styles = getComputedStyle(element);
    return styles.maskImage || (styles as CSSStyleDeclaration & { webkitMaskImage?: string }).webkitMaskImage || "none";
  })).toBe("none");
  const frame = await chapter.boundingBox();
  expect(frame!.x).toBeGreaterThan(20);
  expect(frame!.width).toBeLessThan(1294);

  // The compact opening leaves #platform's top inside the 584px viewport, so
  // it is revealed on load. The solutions chapter is the first one that only
  // arrives on scroll.
  const revealSurface = page.locator("#giai-phap > div");
  await expect(revealSurface).toHaveAttribute("data-scroll-reveal", "pending");
  const beforeOpacity = Number(await revealSurface.evaluate((element) => getComputedStyle(element).opacity));
  const beforeTransform = await revealSurface.evaluate((element) => getComputedStyle(element).transform);
  expect(beforeOpacity).toBeLessThan(.5);
  expect(beforeTransform).not.toBe("none");
  await page.evaluate(() => {
    const section = document.querySelector("#giai-phap");
    if (!section) return;
    const top = section.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top - window.innerHeight * .8, behavior: "instant" });
  });
  // A single wheel movement is enough: reading does not require more scrolling.
  await expect(revealSurface).toHaveAttribute("data-scroll-reveal", "ready");
  await expect.poll(async () => Number(await revealSurface.evaluate((element) => getComputedStyle(element).opacity))).toBe(1);
  await page.locator("#giai-phap").scrollIntoViewIfNeeded();
  await expect.poll(async () => Number(await revealSurface.evaluate((element) => getComputedStyle(element).opacity))).toBeGreaterThan(.98);
  await expect.poll(() => revealSurface.evaluate((element) => getComputedStyle(element).transform)).not.toBe(beforeTransform);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.locator("#giai-phap").scrollIntoViewIfNeeded();
  await expect(revealSurface).toHaveAttribute("data-scroll-reveal", "ready");
  await expect.poll(async () => Number(await revealSurface.evaluate((element) => getComputedStyle(element).opacity))).toBe(1);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => revealSurface.evaluate((element) => getComputedStyle(element).transform)).toBe("none");
  await expect.poll(() => revealSurface.evaluate((element) => getComputedStyle(element).clipPath)).toBe("none");
  await expect.poll(async () => Number(await revealSurface.evaluate((element) => getComputedStyle(element).opacity))).toBe(1);
});

test("nonessential motion stops offscreen", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await selectWorkspaceFeature(page, "meetings");
  await openManualPreview(page);
  await expect(page.locator("#product-preview")).toHaveAttribute("data-presentation", "explore");
  await page.locator(".meeting-follow-up [data-slot=accordion-trigger]").click();
  const film = page.locator(".workflow-film");
  await film.scrollIntoViewIfNeeded();
  await expect(film.locator("video")).toHaveJSProperty("paused", false);
  const startedAt = await film.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime);
  await expect.poll(() => film.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime)).not.toBe(startedAt);
  await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
  await expect(film.locator("video")).toHaveJSProperty("paused", true);
  const character = page.locator('[data-scene="character"]');
  await character.scrollIntoViewIfNeeded();
  await expect(character.locator('.mascot-portrait')).toHaveAttribute('data-running', 'true', { timeout: 20000 });
  await expect(character.getByRole('button')).toHaveCount(0);
  await expect(character.locator('.mascot-portrait')).toHaveAttribute('data-running', 'false', { timeout: 6000 });
  const pausedFrame = await character.locator('canvas').screenshot();
  await character.locator('.mascot-portrait').hover({ position: { x: 40, y: 60 } });
  expect((await character.locator('canvas').screenshot()).equals(pausedFrame)).toBe(true);
  await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
  await expect(character.locator('.mascot-portrait')).toHaveAttribute('data-running', 'false');
});

test("GPU unavailable leaves the product showcase and demo intact", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof original>) {
      if (String(args[0]).startsWith("webgl")) return null;
      return Reflect.apply(original, this, args);
    } as typeof original;
  });
  await page.goto("/");
  await expect(page.locator('#landing-title')).toBeVisible();
  await selectWorkspaceFeature(page, "chat");
  await openManualPreview(page);
  await expect(page.locator("#product-preview")).toHaveAttribute("data-presentation", "explore");
  await expect(page.getByRole("textbox", { name: "Tin nhắn minh họa" })).toBeVisible();
  const character = page.locator('[data-scene="character"]');
  await character.scrollIntoViewIfNeeded();
  await expect(character.locator('img')).toBeVisible();
  await expect(character.locator('img')).toHaveJSProperty('naturalWidth', 1200);
  await expect(character.getByRole('button')).toHaveCount(0);
});
