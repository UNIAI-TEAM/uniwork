import { selectWorkspaceFeature, workspaceGroups } from "./landing-catalog-helpers";
import { expect, test } from "@playwright/test";
import { auditText } from "./contrast";

for (const locale of ["vi", "en"] as const) {
  test(`all explorer states and disclosures have translated text and labels: ${locale}`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "uniwork-locale", value: locale, url: baseURL! }]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.evaluate((lang) => document.documentElement.classList.toggle("dark", lang === "en"), locale);
    const checkKeys = async () => {
      const text = await page.locator("body").innerText();
      const labels = await page.locator("[aria-label], [placeholder], img[alt]").evaluateAll((elements) => elements.map((element) => [element.getAttribute("aria-label"), element.getAttribute("placeholder"), element.getAttribute("alt")].join(" ")).join(" "));
      expect(`${text} ${labels}`).not.toMatch(/\b(?:landing|common)\.[a-zA-Z][\w.]+/);
    };
    for (const key of Object.values(workspaceGroups).flat()) {
      await selectWorkspaceFeature(page, key);
      for (const trigger of await page.locator("#platform [data-slot=accordion-trigger]:visible").all()) await trigger.click();
      await checkKeys();
      expect((await auditText(page)).fails).toEqual([]);
    }
    const more = page.locator(".faq-more");
    await expect(page.locator(".landing-faq [data-slot=accordion-trigger]:visible")).toHaveCount(5);
    await more.click();
    await expect(page.locator(".landing-faq [data-slot=accordion-trigger]:visible")).toHaveCount(10);
    for (const trigger of await page.locator("#security, #lo-trinh, #work-products, #nhan-su-ai, .landing-faq").locator("[data-slot=accordion-trigger]").all()) {
      await trigger.click();
      await checkKeys();
    }
    await more.click();
    await expect(page.locator(".landing-faq [data-slot=accordion-trigger]:visible")).toHaveCount(5);
  });
}

test("grouped feature navigation supports keyboard selection", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  for (const [group, features] of Object.entries(workspaceGroups)) {
    const heading = page.locator(`[data-feature-group="${group}"]`);
    await heading.focus();
    await page.keyboard.press("Enter");
    const tabs = page.locator("#product-preview").getByRole("tab");
    await expect(tabs).toHaveCount(features.length);
    await tabs.first().focus();
    for (let index = 0; index < features.length; index++) {
      await expect(tabs.nth(index)).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(tabs.nth(index)).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("ArrowDown");
    }
  }
});

test("security and roadmap details are available without overwhelming the default view", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const security = page.locator("#security");
  const mechanism = security.getByRole("button", { name: "Lịch sử thay đổi", exact: true });
  await expect(mechanism).toHaveAttribute("aria-expanded", "false");
  await mechanism.click();
  await expect(security.getByText("Nhật ký chỉ ghi thêm", { exact: false })).toBeVisible();
  const roadmap = page.locator("#lo-trinh");
  const phase = roadmap.getByRole("button", { name: /Đang phát triển/ });
  await expect(phase).toHaveAttribute("aria-expanded", "false");
  await phase.click();
  await expect(roadmap.getByText("Lịch cá nhân và lịch nhóm", { exact: false })).toBeVisible();
});

test("decision sections use prominent semantic icon anchors", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("#security .security-mechanism-icon")).toHaveCount(3);
  await page.locator("#work-products [data-slot=accordion-trigger]").click();
  await expect(page.locator("#work-products .work-product-icon")).toHaveCount(4);
  await expect(page.locator("#bang-gia .pricing-plan-mark")).toHaveCount(1);
  await expect(page.locator("#bang-gia .pricing-check")).toHaveCount(8);
  await expect(page.locator(".landing-faq .faq-heading-mark")).toHaveCount(1);
  await expect(page.locator(".landing-faq .faq-question-icon:visible")).toHaveCount(5);
  for (const selector of [
    "#security .security-mechanism-icon",
    "#work-products .work-product-icon",
    "#bang-gia .pricing-plan-mark",
    ".landing-faq .faq-question-icon",
  ]) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

test("trust band explains provider choice without repeating security claims", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const trust = page.locator(".trust-band");
  await expect(trust.locator(".trust-provider-mark")).toHaveCount(3);
  await expect(trust.locator(".trust-guarantees")).toHaveCount(0);
  for (const selector of [".trust-provider-mark"]) {
    const box = await trust.locator(selector).first().boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

test("feature selector stays visible in reduced motion without a decorative rail", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.locator("#platform").scrollIntoViewIfNeeded();
  await expect(page.locator(".workflow-progress, .landing-signal")).toHaveCount(0);
  await expect(page.locator(".workspace-group-button")).toHaveCount(6);
  await expect(page.locator(".workspace-tabs [role=tab]")).toHaveCount(5);
  for (const link of await page.locator(".workspace-tabs [role=tab]").all()) {
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
