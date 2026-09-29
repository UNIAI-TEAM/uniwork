import { expect, test } from "@playwright/test";
import { auditText } from "./contrast";

for (const theme of ["light", "dark"] as const) {
  test(`Business OS shows all capabilities around four readable ${theme} previews`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.goto("/");
    const os = page.locator("#business-os");
    await expect(os.getByRole("heading", { name: "UniWork Business OS", exact: true })).toBeVisible();
    await expect(os.locator(".business-os-layer")).toHaveCount(4);
    await expect(os.locator(".business-os-showcase")).toHaveCount(4);
    const items = os.locator("[data-capability]");
    await expect(items).toHaveCount(37);
    for (const item of await items.all()) await expect(item).toBeVisible();
    await expect(os.locator("[data-capability=graph]")).toContainText("Work Graph");
    await expect(os.locator("[data-capability=word]")).toContainText("Word");
    await expect(os.locator("[data-capability=company]")).toContainText("Thành lập doanh nghiệp");
    await expect(os.locator("[data-capability=contract]")).toContainText("Hợp đồng điện tử");

    const ai = os.locator(".business-os-layer[data-layer=ai]");
    await ai.focus();
    await page.keyboard.press("Enter");
    await expect(ai).toHaveAttribute("aria-pressed", "true");
    await expect(os.locator(".business-os-grid [data-highlighted=true]")).toHaveCount(7);
    await expect(items).toHaveCount(37);
    await page.keyboard.press("Enter");
    await expect(ai).toHaveAttribute("aria-pressed", "false");

    const availability = os.getByRole("button", { name: "Tình trạng triển khai" });
    await expect(availability).toHaveAttribute("aria-expanded", "false");
    let contrast = await auditText(page, "#business-os");
    expect(contrast.checked).toBeGreaterThan(30);
    expect(contrast.fails).toEqual([]);
    await availability.focus();
    await page.keyboard.press("Enter");
    await expect(availability).toHaveAttribute("aria-expanded", "true");
    const details = os.locator(".business-os-availability-content");
    await expect(details).toBeVisible();
    await expect(details).toContainText("Theo cấu hình");
    await expect(details).toContainText("Định hướng");
    await expect(details).toContainText("chưa mở đặt mua");
    contrast = await auditText(page, "#business-os");
    expect(contrast.fails).toEqual([]);
    await page.keyboard.press("Enter");
    await expect(availability).toHaveAttribute("aria-expanded", "false");
  });
}

test("the full Business OS gallery fits mobile in English", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "uniwork-locale", value: "en", url: baseURL! }]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    const os = page.locator("#business-os");
    const items = os.locator("[data-capability]");
    await expect(items).toHaveCount(37);
    for (const item of await items.all()) await expect(item).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await os.innerText()).not.toContain("landing.businessOs.");
    await os.getByRole("button", { name: "Availability", exact: true }).click();
    await expect(os.locator(".business-os-availability-content")).toContainText("In development");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await os.getByRole("button", { name: "Availability", exact: true }).click();
  }
  await page.locator("#business-os").getByRole("link", { name: "Explore UniWork Core" }).click();
  await expect(page).toHaveURL(/#platform$/);
});

test("previews respond to keyboard and respect reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/#business-os");
  const project = page.locator("[data-showcase=projects] button");
  const board = project.locator(".os-preview-board");
  const check = project.locator(".os-preview-check");
  await page.mouse.move(0, 0);
  const restingTransform = await board.evaluate(el => getComputedStyle(el).transform);
  await project.focus();
  await page.keyboard.press("Enter");
  await expect(project).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => check.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
  await expect.poll(() => board.evaluate(el => getComputedStyle(el).transform)).not.toBe(restingTransform);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(project).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => check.evaluate(el => getComputedStyle(el).opacity)).toBe("0");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await project.focus();
  await page.keyboard.press("Space");
  await expect(project).toHaveAttribute("aria-pressed", "true");
  expect(await board.evaluate(el => getComputedStyle(el).transform)).toBe("none");
  expect(await project.locator(".os-preview-moving-task").evaluate(el => getComputedStyle(el).transform)).toBe("none");
  await expect.poll(() => check.evaluate(el => getComputedStyle(el).opacity)).toBe("1");
});

test("gallery motion pauses on request and outside the viewport", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const os = page.locator("#business-os");
  const project = os.locator("[data-showcase=projects]");
  await project.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const preview = project.locator(".os-preview");
  await expect.poll(() => preview.evaluate(el => el.getAnimations().some(animation => animation.playState === "running"))).toBe(true);
  await os.getByRole("button", { name: "Dừng chuyển động", exact: true }).click();
  await expect.poll(() => preview.evaluate(el => el.getAnimations().every(animation => animation.playState === "paused"))).toBe(true);
  const pausedTime = await preview.evaluate(el => Number(el.getAnimations()[0]?.currentTime));
  await page.waitForTimeout(200);
  expect(await preview.evaluate(el => Number(el.getAnimations()[0]?.currentTime))).toBe(pausedTime);
  await os.getByRole("button", { name: "Bật chuyển động", exact: true }).click();
  await project.scrollIntoViewIfNeeded();
  await expect.poll(() => preview.evaluate(el => el.getAnimations().some(animation => animation.playState === "running"))).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect.poll(() => preview.evaluate(el => el.getAnimations().every(animation => animation.playState === "paused"))).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await project.scrollIntoViewIfNeeded();
  await expect(os.locator(".business-os-motion-toggle")).toBeHidden();
  expect(await preview.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
});
