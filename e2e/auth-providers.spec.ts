import { expect, test, type Locator, type Page } from "@playwright/test";
import { settle } from "./contrast";
import { expectReadable, offerProviders, setMode, sidewaysOverflow } from "./sign-in-page";

/**
 * The Google and Apple buttons over the sign-in and register forms (spec
 * 2026-10-27 §4.1), measured on the rendered page with /auth/providers
 * stubbed to offer both: the CI server has neither, and without the stub the
 * buttons are simply not drawn.
 *
 * What only a rendered page shows:
 *  - Apple's pill turns white with a black label on a dark page (Apple's
 *    HIG) through `dark:` classes that must win over the outline variant's
 *    own `dark:bg-input/30` inside cn(); a merge that drops them leaves a
 *    grey pill that still passes every unit test;
 *  - the Apple mark is painted in currentColor, so it follows that label;
 *  - the space held while /auth/providers is in flight is exactly the block
 *    that replaces it, so the form does not jump under a thumb on its way.
 */

const google = (page: Page) => page.getByRole("link", { name: "Tiếp tục với Google" });
const apple = (page: Page) => page.getByRole("link", { name: "Tiếp tục với Apple" });

type Rgb = [number, number, number];

/** A pill's fill, label, edge and mark as the browser paints them, each laid on white. */
async function paint(pill: Locator): Promise<{ fill: Rgb; label: Rgb; edge: Rgb; mark: Rgb | null }> {
  return pill.evaluate((el) => {
    // The browser's own painter turns any colour syntax (oklch, color-mix) into pixels.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgb = (colour: string): Rgb => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!];
    };
    const style = getComputedStyle(el);
    const mark = el.querySelector("svg");
    return {
      fill: rgb(style.backgroundColor),
      label: rgb(style.color),
      edge: rgb(style.borderTopColor),
      mark: mark ? rgb(getComputedStyle(mark).color) : null,
    };
  });
}

const box = async (l: Locator) => (await l.boundingBox())!;

const luminance = (c: Rgb) =>
  c
    .map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i]!, 0);
const ratio = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

for (const mode of ["light", "dark"] as const) {
  for (const route of ["/login", "/register"] as const) {
    test(`provider buttons meet WCAG AA and Apple's colours — ${route} ${mode}`, async ({ page }) => {
      await offerProviders(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(route);
      await apple(page).waitFor();
      await setMode(page, mode);
      await expectReadable(page, `${route} (${mode})`);

      // White with a dark label in both modes: the outline pill on a light
      // page, Apple's filled white on a dark one. Never the grey of the
      // outline variant's dark fill.
      const a = await paint(apple(page));
      expect(luminance(a.fill), `${route} ${mode}: Apple's fill is lighter than its label`).toBeGreaterThan(luminance(a.label));
      expect(ratio(a.fill, a.label), `${route} ${mode}: Apple's label on its fill`).toBeGreaterThanOrEqual(7);
      if (mode === "light") {
        // A white pill on a light page is held by its edge (button.outline.test.tsx pins the token's 3:1).
        expect(ratio(a.edge, a.fill), `${route}: Apple's edge against its fill`).toBeGreaterThanOrEqual(3);
      }
      expect(a.mark, `${route} ${mode}: the Apple mark is painted in the label's colour`).toEqual(a.label);
    });
  }

  // A provider sign-in comes back to /login with ?error= (spec §4.2): a
  // cancel is a quiet status, anything else the soft destructive alert, both
  // drawn over the provider buttons.
  test(`the provider errors on /login meet WCAG AA — ${mode}`, async ({ page }) => {
    await offerProviders(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [code, sentence] of [
      ["apple_denied", "Bạn đã hủy đăng nhập Apple."],
      ["sign_in_failed", "Chưa hoàn tất đăng nhập. Thử lại."],
    ] as const) {
      await page.goto(`/login?error=${code}`);
      await page.getByText(sentence).waitFor();
      await apple(page).waitFor();
      await setMode(page, mode);
      await expectReadable(page, `/login?error=${code} (${mode})`);
    }
  });
}

/**
 * Where the buttons stand (spec §4.1): above the form, Google first, each the
 * form's full width and a full touch target, and links, so /login still has
 * one *button* named "Đăng nhập" and /register one named "Đăng ký". `next`
 * and the register intent ride the start URL. 375px is the narrowest phone
 * the auth screens are held to.
 */
for (const [route, submit, signUp] of [
  ["/login", "Đăng nhập", false],
  ["/register", "Đăng ký", true],
] as const) {
  test(`provider buttons lead the form, full width, as links — ${route}`, async ({ page }) => {
    await offerProviders(page);
    await page.goto(`${route}?next=${encodeURIComponent("/settings")}`);
    await apple(page).waitFor();

    await expect(page.getByRole("button", { name: submit, exact: true })).toHaveCount(1);
    for (const [pill, start] of [
      [google(page), "/api/v1/auth/google/start?"],
      [apple(page), "/api/v1/auth/apple/start?"],
    ] as const) {
      const href = (await pill.getAttribute("href")) ?? "";
      expect(href, route).toContain(start);
      expect(href, route).toContain(`next=${encodeURIComponent("/settings")}`);
      if (signUp) expect(href, route).toContain("intent=sign_up");
      else expect(href, route).not.toContain("intent=");
    }

    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 });
      const at = `${route} @${width}px`;
      const g = await box(google(page));
      const a = await box(apple(page));
      const form = await box(page.locator("main form"));
      const email = await box(page.getByLabel("Email"));
      expect(g.y + g.height, `${at}: Google above Apple`).toBeLessThanOrEqual(a.y);
      expect(a.y + a.height, `${at}: Apple above the email field`).toBeLessThan(email.y);
      for (const [name, pill] of [["Google", g], ["Apple", a]] as const) {
        expect(Math.abs(pill.width - form.width), `${at}: ${name} spans the form's width`).toBeLessThanOrEqual(1);
        expect(pill.height, `${at}: ${name} is a full touch target`).toBeGreaterThanOrEqual(44);
      }
      expect(await sidewaysOverflow(page), `${at}: the page scrolls sideways`).toBe(0);
      expect(g.x, `${at}: left gutter`).toBeGreaterThanOrEqual(16);
      expect(g.x + g.width, `${at}: right gutter`).toBeLessThanOrEqual(width - 16);
    }
  });
}

test("the form does not move when the provider buttons land", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await offerProviders(page, held);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  const email = page.getByLabel("Email");
  await email.waitFor();
  await expect(page.locator('[data-slot="social-placeholder"]')).toHaveCount(1);
  // The column rises in on mount: measure where it comes to rest, not where it passes.
  await settle(page);
  const before = await box(email);

  release();
  await apple(page).waitFor();
  await expect(page.locator('[data-slot="social-placeholder"]')).toHaveCount(0);
  await settle(page);
  const after = await box(email);
  expect(Math.abs(after.y - before.y), `the email field moved ${after.y - before.y}px`).toBeLessThanOrEqual(1);
});
