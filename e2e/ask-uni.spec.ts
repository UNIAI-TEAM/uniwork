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
// provider the topbar has no "Hỏi UNI" button and the spec skips itself.
const stamp = Date.now();

async function onboard(page: Page, tag: string, orgName: string, wsName: string): Promise<string> {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill(tag);
  await page.getByLabel("Email").fill(`${tag.toLowerCase().replace(/\s+/g, "-")}-${stamp}@example.com`);
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

/**
 * Reloads and waits until ⌘J reads the organization's flags: the shell keeps
 * the org-less flags until the organization's /config answer lands, and ⌘J
 * does nothing until the AI capability answer shows the "Hỏi UNI" button.
 */
async function reloadWithOrgFlags(page: Page) {
  const scoped = page.waitForResponse((r) => {
    const url = new URL(r.url());
    return url.pathname === "/api/v1/config" && url.searchParams.has("organization_id");
  });
  await page.reload();
  await scoped;
  await expect(page.getByRole("button", { name: /Hỏi UNI/ })).toBeVisible();
}

async function ask(page: Page, question: string) {
  await page.keyboard.press("ControlOrMeta+j");
  const dialog = page.getByRole("dialog", { name: "Hỏi UNI" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Hỏi UNI về công việc…" }).fill(question);
  await dialog.getByRole("button", { name: "Gửi" }).click();
  return dialog;
}

test("⌘J answers from the asker's own workspace only", async ({ browser, page: a }) => {
  // Each setFlag below can wait out the server's 30 s override cache (featureflags.CacheTTL).
  test.setTimeout(150_000);
  const orgA = await onboard(a, "Chủ Nhóm", `Alpha ${stamp}`, "Đội Alpha");
  const askButton = a.getByRole("button", { name: /Hỏi UNI/ });
  test.skip(!(await askButton.isVisible().catch(() => false)), "AI provider not configured on this server");
  // The legacy dialog, even on a server that turns the docked panel on for everyone (FF_ASK_UNI_STREAM=true).
  await setFlag("ask_uni_stream", orgA, false);
  await reloadWithOrgFlags(a);

  const title = `Việc cho UNI ${stamp}`;
  await a.getByRole("button", { name: "Tạo việc" }).click();
  await a.getByLabel("Tiêu đề").fill(title);
  await a.getByRole("button", { name: "Tạo", exact: true }).click();
  await expect(a.getByText(title)).toBeVisible();

  const dialog = await ask(a, `việc cho UNI ${stamp} thế nào?`);
  const source = dialog.getByRole("link", { name: /\[S1\]/ });
  await expect(source).toBeVisible({ timeout: 15_000 });
  await expect(source).toHaveAttribute("href", /\/tasks\/[0-9A-Z]+$/);
  await expect(dialog.getByText(/\d+ vào · \d+ ra/)).toBeVisible();

  // B: own organization, same question, nothing of A's comes back.
  const ctx = await browser.newContext({ locale: "vi-VN", storageState: VI_LOCALE_STATE });
  const b = await ctx.newPage();
  const orgB = await onboard(b, "Người Khác", `Beta ${stamp}`, "Đội Beta");
  await setFlag("ask_uni_stream", orgB, false);
  await reloadWithOrgFlags(b);
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
  const orgId = await onboard(page, "Chủ Dock", `Dock ${stamp}`, "Đội Dock");
  test.skip(!(await page.getByRole("button", { name: /Hỏi UNI/ }).isVisible().catch(() => false)), "AI provider not configured on this server");

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
    // Sources sit behind "Nguồn (n)"; the dock shows no token meter (only the legacy panel does).
    await dock.getByRole("button", { name: /^Nguồn \(\d+\)$/ }).click({ timeout: 15_000 });
    await expect(dock.getByRole("list", { name: "Nguồn" }).getByRole("link").first()).toBeVisible();

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

// P2b: from a task's page the dock offers the page as a chip, "@" mentions a task as a card, the
// answer cites it as an entity link, and a stored answer keeps its "Xong sau n bước" line.
test("docked Ask UNI offers the page chip, @ mentions a task and keeps the steps after a reload", async ({ page }) => {
  const orgId = await onboard(page, "Chủ Nhắc", `Nhắc ${stamp}`, "Đội Nhắc");
  test.skip(!(await page.getByRole("button", { name: /Hỏi UNI/ }).isVisible().catch(() => false)), "AI provider not configured on this server");

  // Steps exist only when ask_uni_agent is on. It is not a public flag, so /config cannot confirm an
  // override; the steps line below is asserted only when the server already runs the agent.
  await setFlag("ask_uni_stream", orgId, true);
  try {
    const title = `Việc nhắc ${stamp}`;
    await page.reload();
    await page.getByRole("button", { name: "Tạo việc" }).click();
    await page.getByLabel("Tiêu đề").fill(title);
    await page.getByRole("button", { name: "Tạo", exact: true }).click();
    await expect(page.getByText(title)).toBeVisible();

    // Open the task's own page; ⌘J then shows it as "Trang này: <title>".
    await page.getByText(title).click();
    await expect(page).toHaveURL(/\/tasks\/[0-9A-Z]+$/);
    await page.keyboard.press("ControlOrMeta+j");
    const dock = page.getByRole("complementary", { name: "Hỏi UNI" });
    await expect(dock).toBeVisible();
    await expect(dock.getByText(`Trang này: ${title}`)).toBeVisible();

    // "@" opens the object picker; it needs real key events, not fill().
    const box = dock.getByLabel("Câu hỏi cho UNI");
    await box.click();
    // One word: the picker's query ends at a space.
    await box.pressSequentially(`@${stamp}`);
    await page.getByRole("option", { name: new RegExp(title) }).click();
    await box.pressSequentially(" thế nào?");
    await dock.getByRole("button", { name: "Gửi" }).click();

    // The mentioned task is a retrieved source whatever the model cites.
    await dock.getByRole("button", { name: /^Nguồn \(\d+\)$/ }).click({ timeout: 15_000 });
    const source = dock.getByRole("list", { name: "Nguồn" }).getByRole("link", { name: title });
    await expect(source).toHaveAttribute("href", /\/tasks\/[0-9A-Z]+$/);
    // The inline entity chip exists only when the model cited [S#]; the fake provider may not.
    const chip = dock.getByRole("link", { name: `Task: ${title}` }).first();
    if (await chip.isVisible().catch(() => false)) {
      await expect(chip).toHaveAttribute("href", /\/tasks\/[0-9A-Z]+$/);
    } else {
      test.info().annotations.push({ type: "note", description: "answer cited no [S#]; entity chip not asserted" });
    }

    // Reload, reopen the conversation from the history: the stored answer keeps its steps line.
    await page.reload();
    // The button, not ⌘J: a key pressed before hydration is lost.
    await page.getByRole("button", { name: "Hỏi UNI", exact: true }).click();
    await expect(dock).toBeVisible();
    await dock.getByRole("button", { name: /^Lịch sử hội thoại/ }).click();
    await page.getByRole("group", { name: "Lịch sử hội thoại" }).getByRole("button").first().click();
    await expect(dock.getByText("thế nào?").first()).toBeVisible();
    // Steps exist only when the agent made tool calls; the fake provider may answer without any.
    const steps = dock.getByText(/Xong sau \d+ bước/);
    if (await steps.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false)) {
      await expect(steps).toBeVisible();
    } else {
      test.info().annotations.push({ type: "note", description: "run had no tool steps; steps line not asserted" });
    }
  } finally {
    await setFlag("ask_uni_stream", orgId, false);
  }
});

// P3: the docked Ask UNI proposes a write, the asker applies it and takes it back. The fake provider turns
// "Tạo task <tên>" into a create_task call when write tools are sent (server/internal/ai/fake.go); the row stays
// pending until the asker presses "Áp dụng", and the card never claims the task exists before that.
test("docked Ask UNI answers with a source, proposes a task, applies it and undoes it", async ({ page }) => {
  // Each setFlag below can wait out the server's 30 s override cache (featureflags.CacheTTL).
  test.setTimeout(150_000);
  const orgId = await onboard(page, "Chủ Hành Động", `Hành động ${stamp}`, "Đội Hành động");
  test.skip(!(await page.getByRole("button", { name: /Hỏi UNI/ }).isVisible().catch(() => false)), "AI provider not configured on this server");

  await setFlag("ask_uni_stream", orgId, true);
  await setFlag("ask_uni_agent", orgId, true);
  await setFlag("ask_uni_actions", orgId, true);
  try {
    const title = `Việc có nguồn ${stamp}`;
    await reloadWithOrgFlags(page);
    await page.getByRole("button", { name: "Tạo việc" }).click();
    await page.getByLabel("Tiêu đề").fill(title);
    await page.getByRole("button", { name: "Tạo", exact: true }).click();
    await expect(page.getByText(title)).toBeVisible();

    await page.keyboard.press("ControlOrMeta+j");
    const dock = page.getByRole("complementary", { name: "Hỏi UNI" });
    await expect(dock).toBeVisible();
    const box = dock.getByRole("textbox", { name: "Câu hỏi cho UNI" });

    // 1. A read question: the answer comes with its sources.
    await box.fill(`việc có nguồn ${stamp} thế nào?`);
    await dock.getByRole("button", { name: "Gửi" }).click();
    await dock.getByRole("button", { name: /^Nguồn \(\d+\)$/ }).click({ timeout: 15_000 });
    await expect(dock.getByRole("list", { name: "Nguồn" }).getByRole("link").first()).toBeVisible();

    // 2. A write request: a proposal card, and nothing is created yet.
    const made = `Soạn báo cáo ${stamp}`;
    await box.fill(`Tạo task ${made}`);
    await dock.getByRole("button", { name: "Gửi" }).click();
    const card = dock.getByRole("region", { name: "UNI đề xuất · cần bạn xác nhận" });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText(made)).toBeVisible();
    await expect(page.getByText(made).and(page.locator(":not(aside *)"))).toHaveCount(0);

    // 3. Apply: the row turns applied and the task exists.
    await card.getByRole("button", { name: "Áp dụng", exact: true }).click();
    await expect(dock.getByText("Đã áp dụng")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(made).and(page.locator(":not(aside *)")).first()).toBeVisible({ timeout: 15_000 });

    // 4. Undo: the row turns undone and the task is gone.
    await dock.getByRole("button", { name: "Hoàn tác", exact: true }).click();
    await expect(dock.getByText("Đã hoàn tác")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(made).and(page.locator(":not(aside *)"))).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await setFlag("ask_uni_actions", orgId, false);
    await setFlag("ask_uni_agent", orgId, false);
    await setFlag("ask_uni_stream", orgId, false);
  }
});

// The memory flow (UNI-2156, P4): a stated preference becomes a "Nhớ điều này?" card (server/internal/ai/fake.go
// proposes memory for a question starting "Từ giờ "), nothing is kept until "Nhớ", the next answer says it used the
// memory, and the entry can be edited and deleted from the Bộ nhớ screen.
test("docked Ask UNI remembers a preference, uses it, and the memory screen edits and deletes it", async ({ page }) => {
  test.setTimeout(150_000);
  const orgId = await onboard(page, "Chủ Bộ Nhớ", `Bộ nhớ ${stamp}`, "Đội Bộ nhớ");
  test.skip(!(await page.getByRole("button", { name: /Hỏi UNI/ }).isVisible().catch(() => false)), "AI provider not configured on this server");

  await setFlag("ask_uni_stream", orgId, true);
  await setFlag("ask_uni_agent", orgId, true);
  await setFlag("ask_uni_memory", orgId, true);
  try {
    await reloadWithOrgFlags(page);
    await page.keyboard.press("ControlOrMeta+j");
    const dock = page.getByRole("complementary", { name: "Hỏi UNI" });
    await expect(dock).toBeVisible();
    const box = dock.getByRole("textbox", { name: "Câu hỏi cho UNI" });

    // 1. A stated preference: a card, and nothing is remembered until the asker says so.
    await box.fill("Từ giờ trả lời tôi bằng gạch đầu dòng");
    await dock.getByRole("button", { name: "Gửi" }).click();
    const card = dock.getByRole("region", { name: "Đề xuất bộ nhớ" });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText("Từ giờ trả lời tôi bằng gạch đầu dòng")).toBeVisible();
    await card.getByRole("button", { name: "Nhớ", exact: true }).click();
    await expect(card.getByText("Đã nhớ")).toBeVisible({ timeout: 15_000 });

    // 2. A new question: the answer says it used the memory.
    await box.fill("việc nào đang trễ?");
    await dock.getByRole("button", { name: "Gửi" }).click();
    await expect(dock.getByRole("button", { name: /Dùng \d+ mục bộ nhớ/ })).toBeVisible({ timeout: 15_000 });

    // 3. The memory screen: edit the line, then delete it.
    await dock.getByRole("button", { name: "Bộ nhớ", exact: true }).click();
    // The entry is a button named by its text ("Sửa mục này" is only its title); its pencil and bin name it too, so match exactly.
    await dock.getByRole("button", { name: "Từ giờ trả lời tôi bằng gạch đầu dòng", exact: true }).click();
    const edit = dock.getByRole("textbox", { name: "Nội dung mục bộ nhớ" });
    await edit.fill("Trả lời ngắn gọn");
    await edit.press("Enter");
    await expect(dock.getByRole("button", { name: "Trả lời ngắn gọn", exact: true })).toBeVisible({ timeout: 15_000 });
    await dock.getByRole("button", { name: "Xóa mục: Trả lời ngắn gọn" }).click();
    // The confirmation is a toast outside the dock; the row itself must be gone.
    await expect(page.getByText("Đã xóa một mục")).toBeVisible({ timeout: 15_000 });
    await expect(dock.getByRole("button", { name: "Trả lời ngắn gọn", exact: true })).toHaveCount(0);
  } finally {
    await setFlag("ask_uni_memory", orgId, false);
    await setFlag("ask_uni_agent", orgId, false);
    await setFlag("ask_uni_stream", orgId, false);
  }
});
