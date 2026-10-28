import { expect, test, type Locator, type Page } from "@playwright/test";
import { settle } from "./contrast";
import { expectReadable, pendingSignIn, setMode, sidewaysOverflow, type PendingSignIn } from "./sign-in-page";

/**
 * The choice screen a Google or Apple sign-in that found no account lands on
 * (/auth/continue, spec 2026-10-27 §4.3), measured on the rendered page in
 * each state a signed-out person reaches. The CI server cannot run a provider
 * sign-in, so the pending sign-in it would hold is stubbed; the expired
 * screen is the server's own answer when there is none.
 *
 * The identities are the hard cases on purpose: a name with Vietnamese
 * diacritics over a long address that has no break opportunity, and Apple's
 * hidden email, which the screen must never print raw.
 */

interface State {
  name: string;
  ticket: PendingSignIn | null;
  heading: string;
  /** What the person can press here; each is a full touch target on a phone. */
  actions: (page: Page) => Locator[];
}

/** One of the three choice rows, by its title (the row's name also carries its one-line body). */
const choice = (page: Page, title: string) =>
  page.getByRole("list", { name: "Chọn cách tiếp tục" }).getByRole("listitem").filter({ hasText: title }).locator("a, button");
const cancel = (page: Page) => page.getByRole("button", { name: "Hủy", exact: true });
const threeChoices = (page: Page) => [
  choice(page, "Tôi đã có tài khoản UniWork"),
  choice(page, "Tôi được mời bằng email khác"),
  choice(page, "Tạo tài khoản mới"),
  cancel(page),
];

const STATES: State[] = [
  {
    name: "unmatched Google",
    ticket: {
      provider: "google",
      kind: "unmatched",
      email: "nguyen.van.an.phongkinhdoanhmienbac@gmail.com",
      name: "Nguyễn Văn An",
      private_relay: false,
    },
    heading: "Tiếp tục với Google",
    actions: threeChoices,
  },
  {
    name: "unmatched Apple, hidden email",
    ticket: { provider: "apple", kind: "unmatched", email: "k7x2m9qp4z@privaterelay.appleid.com", name: "", private_relay: true },
    heading: "Tiếp tục với Apple",
    actions: threeChoices,
  },
  {
    name: "link required",
    ticket: { provider: "google", kind: "link_required", email: "an.nguyen@congty.vn", name: "Nguyễn Văn An", private_relay: false },
    heading: "Email này đã có tài khoản UniWork",
    actions: (page) => [page.getByRole("link", { name: "Đăng nhập để liên kết" }), cancel(page)],
  },
  {
    name: "expired",
    ticket: null,
    heading: "Lượt đăng nhập đã hết hạn",
    actions: (page) => [page.getByRole("link", { name: "Về trang đăng nhập" })],
  },
];

async function open(page: Page, state: State) {
  if (state.ticket) await pendingSignIn(page, state.ticket);
  await page.goto("/auth/continue");
  await page.getByRole("heading", { level: 1, name: state.heading }).waitFor();
}

for (const mode of ["light", "dark"] as const) {
  for (const state of STATES) {
    test(`the choice screen meets WCAG AA — ${state.name} ${mode}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, state);
      await setMode(page, mode);
      await expectReadable(page, `/auth/continue ${state.name} (${mode})`);
    });
  }
}

test("Apple's hidden email is named, never printed", async ({ page }) => {
  const state = STATES.find((s) => s.ticket?.private_relay)!;
  await open(page, state);
  const main = page.locator("main");
  await expect(main.getByRole("group", { name: "Tài khoản Apple" })).toContainText("Email ẩn của Apple");
  await expect(main.getByText('Tổ chức mời bạn qua email công việc? Chọn "Tôi được mời bằng email khác".')).toBeVisible();
  await expect(main).not.toContainText("privaterelay");
});

/**
 * On a phone (375px, coarse pointer): nothing scrolls sideways, the long
 * address wraps inside its block, and every action is a 44px target inside
 * the 16px gutters.
 */
test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

  /**
   * The skeleton draws the copy the screen most likely shows as skeleton
   * text, so on a phone, where the title, its line and each row's body wrap,
   * the card keeps its place and its height when the pending sign-in lands:
   * the logo and the language switch above it do not move either. The
   * identity uses an address of the length the skeleton stands in for; a
   * longer one may add the lines it wraps to.
   */
  test("the card holds still when the pending sign-in lands", async ({ page }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/api\/v1\/auth\/sign-in-ticket(\?.*)?$/, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      await held;
      const ticket: PendingSignIn = { provider: "google", kind: "unmatched", email: "nguyenvanan@gmail.com", name: "Nguyễn Văn An", private_relay: false };
      await route.fulfill({ response, status: 200, json: ticket });
    });
    await page.goto("/auth/continue");
    await page.getByText("Đang tải lượt đăng nhập…").waitFor({ state: "attached" });
    const card = page.locator("main div:has(> div > h1)");
    await settle(page);
    const before = (await card.boundingBox())!;

    release();
    await page.getByRole("heading", { level: 1, name: "Tiếp tục với Google" }).waitFor();
    await settle(page);
    const after = (await card.boundingBox())!;
    expect(Math.abs(after.y - before.y), `the card moved ${after.y - before.y}px`).toBeLessThanOrEqual(2);
    expect(Math.abs(after.height - before.height), `the card grew ${after.height - before.height}px`).toBeLessThanOrEqual(2);
  });

  for (const state of STATES) {
    test(`fits the screen with full touch targets — ${state.name}`, async ({ page }) => {
      await open(page, state);
      expect(await sidewaysOverflow(page), `${state.name}: the page scrolls sideways`).toBe(0);

      const actions = state.actions(page);
      for (const action of actions) await expect(action).toBeVisible();
      for (const action of actions) {
        const box = (await action.boundingBox())!;
        const label = `${state.name}: "${((await action.textContent()) ?? "").trim().slice(0, 28)}"`;
        expect(Math.min(box.width, box.height), `${label} is ${Math.round(box.width)}×${Math.round(box.height)}`).toBeGreaterThanOrEqual(44);
        expect(box.x, `${label}: left gutter`).toBeGreaterThanOrEqual(16);
        expect(box.x + box.width, `${label}: right gutter`).toBeLessThanOrEqual(375 - 16);
      }
    });
  }
});
