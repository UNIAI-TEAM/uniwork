import { expect, test } from "@playwright/test";
import { auditText } from "./contrast";
import { landingReady } from "./landing-ready";
import { formatPlanAmount } from "../packages/core/billing/format";
import type { Plan } from "../packages/core/types/billing";

// Deliberately different from seed prices: these are test-only API responses.
// This proves the page follows catalog edits rather than marketing translations.
const features = [
  { feature_key: "members.max", enabled: true, quota_limit: 42 },
  { feature_key: "workspaces.max", enabled: true, quota_limit: 7 },
  { feature_key: "tasks.max", enabled: true, quota_limit: null },
  { feature_key: "storage.bytes", enabled: true, quota_limit: 1.5 * 1024 ** 3 },
  { feature_key: "meeting.participant_minutes", enabled: true, quota_limit: 8000 },
  { feature_key: "meeting.transcription", enabled: true, quota_limit: 321 },
  { feature_key: "ai.tokens", enabled: true, quota_limit: 650000 },
  { feature_key: "office.ai_cloud", enabled: true, quota_limit: null },
  { feature_key: "meeting.recording", enabled: true, quota_limit: null },
  { feature_key: "meeting.ai_summary", enabled: false, quota_limit: null },
  { feature_key: "documents.public_links", enabled: true, quota_limit: null },
  { feature_key: "sso.oidc", enabled: false, quota_limit: null },
];
const plans = [
  { id: "a", code: "starter", name: "Starter", price_amount: 0, price_currency: "VND", billing_period: "none", is_default: true, features },
  { id: "b", code: "team", name: "Team", price_amount: 789000, price_currency: "VND", billing_period: "month", features },
  { id: "c", code: "business", name: "Business", price_amount: 1899000, price_currency: "VND", billing_period: "year", features },
];

for (const sample of [
  { width: 1440, locale: "en", theme: "light" },
  { width: 390, locale: "vi", theme: "dark" },
  { width: 768, locale: "en", theme: "dark" },
] as const) {
  test(`catalog pricing is readable at ${sample.width}px in ${sample.locale} ${sample.theme}`, async ({ page }) => {
    await page.setViewportSize({ width: sample.width, height: 1000 });
    await page.emulateMedia({ colorScheme: sample.theme, reducedMotion: "reduce" });
    await page.route("**/api/v1/plans", route => route.fulfill({ json: { plans } }));
    await page.goto(sample.locale === "vi" ? "/vi/pricing" : "/pricing");
    await landingReady(page);
    const section = page.locator(".public-pricing-section");
    await expect(section.locator(".public-pricing-plan")).toHaveCount(3);
    await expect(section.locator('[data-plan-code="team"] .public-pricing-price')).toContainText(/789[.,]000/);
    await expect(section.locator('[data-plan-code="business"] .public-pricing-price')).toContainText(sample.locale === "vi" ? "năm" : "year");
    await expect(section.locator('[data-plan-code="starter"] dd').first()).toHaveText("42");
    await expect(section.locator('[data-plan-code="starter"] .public-pricing-limits')).toContainText(/1[.,]5 GB/);
    await expect(page.locator(".chapter-hero-media")).toHaveCount(0);
    await expect(section.locator(".public-pricing-comparison")).toHaveCount(0);
    await expect(section.locator('[data-plan-code="starter"] dd').nth(5)).toHaveText("321");
    for (const button of await section.locator(".public-pricing-action").all()) {
      expect((await button.innerText()).trim().length).toBeGreaterThan(4);
      expect(await button.getAttribute("href")).toBe("/register");
      expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    const layout = await section.locator(".public-pricing-plan").evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right };
    }));
    if (sample.width === 1440) {
      expect(Math.max(...layout.map(box => box.y)) - Math.min(...layout.map(box => box.y))).toBeLessThan(2);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const contrast = await auditText(page, ".public-pricing-section");
    expect(contrast.checked).toBeGreaterThan(40);
    expect(contrast.fails).toEqual([]);
    await section.screenshot({ path: test.info().outputPath(`pricing-${sample.width}-${sample.theme}.png`) });
  });
}

test("catalog failure and empty states never substitute seed prices; retry recovers", async ({ page }) => {
  let response: unknown = { error: { code: "unavailable" } };
  let status = 503;
  await page.route("**/api/v1/plans", route => route.fulfill({ status, json: response }));
  await page.goto("/pricing");
  const section = page.locator(".public-pricing-section");
  await expect(section.getByRole("heading", { name: "We couldn’t load the current prices." })).toBeVisible({ timeout: 20_000 });
  await expect(section.locator(".public-pricing-plan")).toHaveCount(0);
  response = { plans: [] }; status = 200;
  await section.getByRole("button", { name: "Retry" }).click();
  await expect(section.getByRole("heading", { name: "No plans are published yet." })).toBeVisible();
  response = { plans: [{ ...plans[0], name: "Custom published name", code: "custom", price_amount: null }] };
  await section.getByRole("button", { name: "Retry" }).click();
  await expect(section.locator(".public-pricing-plan")).toHaveCount(1);
  await expect(section.locator(".public-pricing-plan h3")).toHaveText("Custom published name");
  await expect(section.locator(".public-pricing-action")).toHaveAttribute("href", "/request-demo");
  await expect(section.locator(".public-pricing-price")).toContainText("Contact us for pricing");
});

test("loading and a changed catalog retain only returned plans and explicit feature states", async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/v1/plans", async route => {
    await ready;
    await route.fulfill({ json: { plans: [{
      ...plans[1], code: "new-plan", name: "Published organization plan",
      features: [{ feature_key: "members.max", enabled: true, quota_limit: 0 }],
    }] } });
  });
  await page.goto("/pricing");
  const section = page.locator(".public-pricing-section");
  await expect(section.getByRole("status")).toContainText("Loading current plans");
  await expect(section.locator(".public-pricing-plan")).toHaveCount(0);
  release();
  await expect(section.locator(".public-pricing-plan")).toHaveCount(1);
  await expect(section.locator(".public-pricing-limits dd").first()).toHaveText("0");
  await expect(section.locator(".public-pricing-comparison")).toHaveCount(0);
  await expect(section.locator(".public-pricing-limits dd").nth(5)).toHaveText("Not specified");
});

test("anonymous pricing matches the live billing API without a test response", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  const response = page.waitForResponse(value => new URL(value.url()).pathname === "/api/v1/plans");
  await page.goto("/pricing");
  const catalog = await response;
  expect(catalog.status()).toBe(200);
  expect(catalog.request().headers()["authorization"]).toBeUndefined();
  const body = await catalog.json() as { plans: Plan[] };
  const offers = page.locator(".public-pricing-plan");
  await expect(offers).toHaveCount(body.plans.length);
  for (const plan of body.plans) {
    const offer = page.locator(`[data-plan-code="${plan.code}"]`);
    await expect(offer.getByRole("heading")).toHaveText(plan.name);
    const price = plan.price_amount === null ? "Contact us for pricing" : plan.price_amount === 0 ? "Free" : formatPlanAmount(plan.price_amount, plan.price_currency, "en");
    await expect(offer.locator(".public-pricing-price strong")).toHaveText(price);
    const transcription = plan.features.find(feature => feature.feature_key === "meeting.transcription");
    if (transcription?.enabled && transcription.quota_limit !== null) {
      await expect(offer.locator("dd").nth(5)).toHaveText(transcription.quota_limit.toLocaleString("en"));
    }
    const members = plan.features.find(feature => feature.feature_key === "members.max");
    if (members?.enabled && members.quota_limit !== null) {
      await expect(offer.locator("dd").first()).toHaveText(members.quota_limit.toLocaleString("en"));
    }
  }
  await page.screenshot({ path: test.info().outputPath("pricing-live-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await page.goto("/vi/pricing");
  await expect(offers).toHaveCount(body.plans.length);
  await page.screenshot({ path: test.info().outputPath("pricing-live-mobile-dark.png") });
  // The homepage reuses this catalog and has its own legacy stylesheet cascade.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await page.goto("/");
  await expect(offers).toHaveCount(body.plans.length);
  const homePricing = page.locator(".public-pricing-section");
  await homePricing.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const positions = await offers.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(2);
});

test("comparison requires several real differences and excludes catalog-only SSO", async ({ page }) => {
  const excluded = new Set(["meeting.recording", "meeting.ai_summary", "office.ai_cloud"]);
  let count = 3;
  await page.route("**/api/v1/plans", route => route.fulfill({ json: { plans: plans.map((plan, index) => ({
    ...plan,
    features: features.map(feature => ({
      ...feature,
      enabled: index !== 1 || !new Set([...excluded].slice(0, count)).has(feature.feature_key),
    })),
  })) } }));
  await page.goto("/pricing");
  const comparison = page.locator(".public-pricing-comparison");
  await expect(comparison.locator("tbody tr")).toHaveCount(3);
  await expect(comparison).toContainText("Office cloud AI tools");
  await expect(comparison).not.toContainText("SSO");
  await expect(comparison).not.toContainText("Public links for documents");
  await expect(comparison.getByRole("row", { name: /Office cloud AI tools/ })).toContainText("Not in this plan");
  count = 2;
  await page.reload();
  await expect(page.locator(".public-pricing-plan")).toHaveCount(3);
  await expect(comparison).toHaveCount(0);
});
