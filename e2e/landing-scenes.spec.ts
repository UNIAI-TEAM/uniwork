import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("original UNI artwork and face stay unchanged while the foreleg waves", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const character = page.locator('[data-scene="character"]');
  await character.scrollIntoViewIfNeeded();
  const portrait = character.locator(".mascot-portrait");
  const canvas = portrait.locator("canvas");
  // Isolate the foreleg deformation from the unrelated scroll-reveal entrance.
  // The face box also covers transparent artwork above the head, where the
  // stage's radial gradients show through; Chrome re-rasterises (and re-dithers)
  // them once the canvas animates, by up to three levels even far from the
  // canvas. A flat stage keeps the measurement on the artwork itself.
  await page.addStyleTag({ content: ".ai-stage, .ai-visual, .horse-mascot { transform: none !important; } .landing-site .ai-stage { background-image: none !important; }" });
  await expect(portrait).toHaveAttribute("data-rendered", "true", { timeout: 20000 });
  await expect(portrait.locator("img")).toHaveAttribute("src", /\/landing\/mascot\/uni-horse-v2\.webp$/);
  const faceClip = async () => canvas.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const side = Math.min(rect.width, rect.height);
    return { x: Math.round(rect.x + (rect.width - side) / 2 + side * .33), y: Math.round(rect.y + (rect.height - side) / 2 + side * .03), width: Math.floor(side * .48), height: Math.floor(side * .43) };
  });
  const originalClip = await faceClip();
  const originalFace = await page.screenshot({ clip: originalClip });
  const still = await canvas.screenshot();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await character.scrollIntoViewIfNeeded();
  await expect.poll(async () => (await canvas.screenshot()).equals(still)).toBe(false);
  const wavingClip = await faceClip();
  const wavingFace = await page.screenshot({ clip: wavingClip });
  if (process.env.LANDING_CAPTURE === "1") {
    await test.info().attach("original-face", { body: originalFace, contentType: "image/png" });
    await test.info().attach("waving-face", { body: wavingFace, contentType: "image/png" });
    await test.info().attach("face-bounds", { body: JSON.stringify({ originalClip, wavingClip }), contentType: "application/json" });
  }
  expect(wavingClip).toEqual(originalClip);
  const maxChannelChange = await page.evaluate(async ([before, after]) => {
    const decode = async (base64: string) => {
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      bitmap.close();
      return pixels;
    };
    const [a, b] = await Promise.all([decode(before!), decode(after!)]);
    return a.reduce((maximum, channel, index) => Math.max(maximum, Math.abs(channel - b[index]!)), 0);
  }, [originalFace.toString("base64"), wavingFace.toString("base64")]);
  // Responsive canvas sampling and Chrome compositing can differ by two
  // 8-bit rounding steps. Displaced facial edges exceed this narrow tolerance.
  expect(maxChannelChange).toBeLessThanOrEqual(2);
});

for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`mascot expression and native scene handoff: ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    const character = page.locator('[data-scene="character"]');
    await character.scrollIntoViewIfNeeded();
    const portrait = character.locator(".mascot-portrait");
    await expect(portrait).toHaveAttribute("data-running", "true", { timeout: 20000 });
    await expect(portrait).toHaveAttribute("data-expression", "idle", { timeout: 6000 });
    await expect(portrait).toHaveAttribute("data-running", "false");
    await page.locator(".landing-site > footer").scrollIntoViewIfNeeded();
    await character.scrollIntoViewIfNeeded();
    await expect(portrait).toHaveAttribute("data-running", "false");
    await expect(character.getByRole("button")).toHaveCount(0);
    await expect(character.locator(".scene-character-caption")).toHaveCount(0);
    if (process.env.LANDING_CAPTURE === "1") {
      const dir = resolve(import.meta.dirname, "../.impeccable/review");
      await mkdir(dir, { recursive: true });
      await page.locator(".ai-stage").screenshot({ path: resolve(dir, `uni-original-${viewport.name}.png`), style: ".site-header, nextjs-portal { visibility: hidden !important; }" });
    }

    const destination = await page.locator(".landing-trust-story").evaluate(el => el.getBoundingClientRect().top + window.scrollY - window.innerHeight * .52);
    // Wheel-driven movement keeps the preceding scene and next scene in view.
    const current = await page.evaluate(() => window.scrollY);
    for (let step = 0; step < 6; step++) {
      await page.mouse.wheel(0, (destination - current) / 6);
      await page.waitForTimeout(120);
    }
    await expect(page.locator("#security-title")).toBeInViewport();
    await expect(page.locator("#security > div")).toHaveAttribute("data-scroll-reveal", "ready");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const panels = await page.locator(".ai-stage, .landing-trust-story").evaluateAll(elements => elements.map(el => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
    }));
    expect(panels[1]!.top - panels[0]!.bottom).toBeGreaterThan(12);
    expect(panels[1]!.top - panels[0]!.bottom).toBeLessThan(60);
    if (process.env.LANDING_CAPTURE === "1") {
      const dir = resolve(import.meta.dirname, "../.impeccable/review");
      await mkdir(dir, { recursive: true });
      await page.screenshot({ path: resolve(dir, `${viewport.name}-framed-handoff.png`), style: "nextjs-portal { display:none !important; }" });
    }
  });
}

test("missing original artwork leaves the shared mark without removed controls", async ({ page }) => {
  await page.route("**/uni-horse-v2.webp", route => route.abort());
  await page.goto("/");
  const character = page.locator('[data-scene="character"]');
  await character.scrollIntoViewIfNeeded();
  const portrait = character.locator(".mascot-portrait");
  await expect(portrait.locator(".mascot-unavailable")).toBeVisible();
  await expect(portrait.locator(".mascot-unavailable svg")).toBeVisible();
  await expect(character.getByRole("button")).toHaveCount(0);
  await expect(character.locator(".mascot-shirt-logo")).toHaveCount(0);
});

test("shirt mark and artwork share coordinates before and after resize", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#nhan-su-ai");
  const character = page.locator('[data-scene="character"]');
  const portrait = character.locator(".mascot-portrait");
  await character.scrollIntoViewIfNeeded();
  await expect(portrait).toHaveAttribute("data-rendered", "true", { timeout: 20000 });
  const aligned = () => portrait.evaluate(element => {
    const host = element.getBoundingClientRect();
    const canvas = element.querySelector("canvas")!.getBoundingClientRect();
    const plane = element.querySelector(".mascot-brand-plane")!.getBoundingClientRect();
    const mark = element.querySelector(".mascot-shirt-logo")!.getBoundingClientRect();
    const side = Math.min(host.width, host.height);
    return Math.abs(canvas.width - host.width) < 1 && Math.abs(canvas.height - host.height) < 1 &&
      Math.abs(plane.width - side) < 1 && Math.abs(plane.height - side) < 1 &&
      Math.abs((mark.x + mark.width / 2 - plane.x) / side - .428) < .002 &&
      Math.abs((mark.y + mark.height / 2 - plane.y) / side - .625) < .002;
  });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await character.scrollIntoViewIfNeeded();
    await expect.poll(aligned).toBe(true);
    // Recreate resize during an in-flight scroll reveal. Canvas CSS size must
    // remain 100% even while its ancestor is scaled by the presentation layer.
    await portrait.evaluate(element => { element.style.transform = "scale(.83)"; element.style.width = "calc(100% - 12px)"; });
    await expect.poll(aligned).toBe(true);
    await portrait.evaluate(element => { element.style.removeProperty("transform"); element.style.removeProperty("width"); });
    await expect.poll(aligned).toBe(true);
    await expect(character.getByRole("button")).toHaveCount(0);
    await character.screenshot({ path: `.impeccable/review/mascot-aligned-${width}.png` });
  }
});
