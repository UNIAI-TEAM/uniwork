import { expect, test, type Page } from "@playwright/test";
import { VI_LOCALE_STATE } from "./locale-state";
import { VERIFICATION_CODE, verifyEmail } from "./auth-nav";
import { setFlag } from "./office-docs-web-fixtures";

// The golden path for F-09 (spec §8): A creates a task, opens Ask UNI with
// ⌘J and asks about it; the answer cites [S1] as a link to that task. B, in a
// different organization, asks the same thing and gets none of A's sources —
// the context builder only ever reads as the asker.
//
// Requires `make dev` with AI_PROVIDER=fake (or a real key). Without a
// provider the topbar has no "Hỏi UNI" button and the spec skips itself,
// except in CI, whose e2e job sets AI_PROVIDER=fake: there it waits for the
// button and fails without it.
const stamp = Date.now();

async function askUniOrSkip(page: Page) {
  const askButton = page.getByRole("button", { name: /Hỏi UNI/ });
  if (process.env.CI) await expect(askButton, "CI runs AI_PROVIDER=fake: the topbar shows Hỏi UNI").toBeVisible({ timeout: 15_000 });
  test.skip(!(await askButton.isVisible().catch(() => false)), "AI provider not configured on this server");
}

async function onboard(page: Page, tag: string, orgName: string, wsName: string): Promise<string> {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill(tag);
  // ASCII only: "Chủ Nhóm" would make an address the server rejects (same rule as e2e/auth helpers).
  await page.getByLabel("Email").fill(`${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}@example.com`);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page, VERIFICATION_CODE);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(orgName);
  const createdOrg = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/orgs");
  await page.getByRole("button", { name: `Tạo ${orgName}` }).click();
  const orgId = ((await (await createdOrg).json()) as { organization: { id: string } }).organization.id;
  await page.getByLabel("Tên workspace").fill(wsName);
  await page.getByRole("button", { name: `Tạo ${wsName}` }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(/\/tasks$/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Để sau" }).click({ timeout: 15_000 });
  return orgId;
}

async function ask(page: Page, question: string) {
  await page.keyboard.press("ControlOrMeta+j");
  const dialog = page.getByRole("dialog", { name: "Hỏi UNI" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Câu hỏi cho UNI" }).fill(question);
  await dialog.getByRole("button", { name: "Hỏi" }).click();
  return dialog;
}

test("⌘J answers from the asker's own workspace only", async ({ browser, page: a }) => {
  await onboard(a, "Chủ Nhóm", `Alpha ${stamp}`, "Đội Alpha");
  await askUniOrSkip(a);

  const title = `Việc cho UNI ${stamp}`;
  await a.getByRole("button", { name: "Tạo việc" }).click();
  await a.getByLabel("Tiêu đề").fill(title);
  await a.getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(a.getByText(title)).toBeVisible();

  const dialog = await ask(a, `việc cho UNI ${stamp} thế nào?`);
  const source = dialog.getByRole("link", { name: /S1/ });
  await expect(source).toBeVisible({ timeout: 15_000 });
  await expect(source).toHaveAttribute("href", /\/tasks\/[0-9A-Z]+$/);
  await expect(dialog.getByText(/\d+ vào · \d+ ra/)).toBeVisible();

  // B: own organization, same question, nothing of A's comes back.
  const ctx = await browser.newContext({ locale: "vi-VN", storageState: VI_LOCALE_STATE });
  const b = await ctx.newPage();
  await onboard(b, "Người Khác", `Beta ${stamp}`, "Đội Beta");
  const dialogB = await ask(b, `việc cho UNI ${stamp} thế nào?`);
  // B's workspace has its own guide task, so UNI may cite that; A's task never comes back.
  await expect(dialogB.getByText(/\d+ vào · \d+ ra/)).toBeVisible({ timeout: 15_000 });
  await expect(dialogB.getByRole("link", { name: title })).toHaveCount(0);
  const sourcesB = await dialogB.getByRole("list", { name: "Nguồn" }).getByRole("link").all();
  for (const link of sourcesB) {
    await expect(link).toHaveAttribute("href", new RegExp(`^/beta-${stamp}/`));
  }
  await ctx.close();
});

// P2: with ask_uni_stream on, ⌘J opens the docked panel and the answer streams
// in over SSE. The fake provider answers in milliseconds, so the Stop step
// only asserts the stopped notice when the button was still there to press.
test("docked Ask UNI streams an answer, stops a run and opens with a focus", async ({ page }) => {
  // The flag is set for the organization, and an organization override never reaches the web
  // shell: WebFeatureFlagsProvider (apps/web/platform/feature-flags.tsx) asks GET /api/v1/config
  // without organization_id, so ⌘J keeps opening the legacy dialog. Found when CI started running
  // this spec under AI_PROVIDER=fake; tracked as UNI-2099 (in review): unfix when it lands.
  test.fixme(true, "UNI-2099: organization-scoped ask_uni_stream does not reach the web shell's flags");
  const orgId = await onboard(page, "Chủ Dock", `Dock ${stamp}`, "Đội Dock");
  await askUniOrSkip(page);

  await setFlag("ask_uni_stream", orgId, true);
  try {
    const title = `Việc dock ${stamp}`;
    await page.reload();
    await page.getByRole("button", { name: "Tạo việc" }).click();
    await page.getByLabel("Tiêu đề").fill(title);
    await page.getByRole("button", { name: "Tạo", exact: true }).click();
    await expect(page.getByText(title)).toBeVisible();

    await page.keyboard.press("ControlOrMeta+j");
    const dock = page.getByRole("complementary", { name: "Hỏi UNI" });
    await expect(dock).toBeVisible();
    const box = dock.getByRole("textbox", { name: "Câu hỏi cho UNI" });

    await box.fill(`việc dock ${stamp} thế nào?`);
    await dock.getByRole("button", { name: "Gửi" }).click();
    await expect(dock.getByRole("list", { name: "Nguồn" }).getByRole("link").first()).toBeVisible({ timeout: 15_000 });
    await expect(dock.getByText(/\d+ vào · \d+ ra/)).toBeVisible();

    await box.fill(`câu thứ hai ${stamp}`);
    await dock.getByRole("button", { name: "Gửi" }).click();
    // The fake provider streams with no delay, so the run usually ends before Stop can be pressed and the
    // notice is not reached here. It is covered by TestAskAgentStopStoresPartialAndCharges and
    // TestAskUniStreamClientLeavingStoresAStoppedTurn (Go) and the notices test in
    // packages/views/ai/ask-uni-answer.test.tsx.
    const stopped = await dock.getByRole("button", { name: "Dừng" }).click({ timeout: 2_000 }).then(() => true, () => false);
    if (stopped) {
      await expect(dock.getByText("Đã dừng trước khi trả lời xong.")).toBeVisible({ timeout: 15_000 });
    } else {
      test.info().annotations.push({ type: "note", description: "run finished before Stop could be pressed" });
    }

    // The first answer cites this task, so the dock holds a link with the same title: match outside the dock only.
    await page.getByText(title).and(page.locator(":not(aside *)")).click();
    await page.getByRole("button", { name: "Hỏi UNI về task này" }).click();
    await expect(dock.getByRole("button", { name: "Bỏ phạm vi Task" })).toBeVisible();
  } finally {
    await setFlag("ask_uni_stream", orgId, false);
  }
});
