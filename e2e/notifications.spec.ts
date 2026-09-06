import { expect, test, type Page } from "@playwright/test";
import { VERIFICATION_CODE, verifyEmail } from "./auth-nav";

// The golden path for F-07 (spec §8.3): A assigns a task to B; B sees the
// badge without reloading, opens the inbox, follows the row to the task, and
// the badge is gone. Nothing in Tasks knows notifications exist — the row is
// born on the outbox and reaches B over the user scope of the socket.
//
// Requires `make dev`.
const stamp = Date.now();
const orgSlug = `thong-bao-${stamp}`;
const wsSlug = "doi-inbox";

async function onboardOwner(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("Chủ Nhóm");
  await page.getByLabel("Email").fill(`owner-${stamp}@example.com`);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(`Thông báo ${stamp}`);
  await page.getByRole("button", { name: `Tạo Thông báo ${stamp}` }).click();
  await page.getByLabel("Tên workspace").fill("Đội Inbox");
  await page.getByRole("button", { name: "Tạo Đội Inbox" }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/tasks$`), { timeout: 15_000 });
  await page.getByRole("button", { name: "Đã hiểu" }).click({ timeout: 15_000 });
}

test("assigning a task lights the assignee's inbox badge without a reload", async ({ browser, page: owner }) => {
  await onboardOwner(owner);

  // Invite B from the Members page; the token comes out of the mail outbox.
  const memberEmail = `member-${stamp}@example.com`;
  await owner.goto(`/${orgSlug}/${wsSlug}/members`);
  await owner.getByLabel("Email đồng nghiệp").fill(memberEmail);
  await owner.getByLabel("Email đồng nghiệp").press("Enter");
  await owner.getByRole("button", { name: "Mời thành viên" }).click();
  await expect(owner.getByText(/Đã gửi 1 lời mời/).first()).toBeVisible({ timeout: 15_000 });

  // B: register and verify under the invited address. With an invitation
  // waiting, verification lands on /invitations rather than onboarding;
  // joining there is what marks B onboarded and opens the workspace.
  const memberContext = await browser.newContext({ locale: "vi-VN" });
  const member = await memberContext.newPage();
  await member.goto("/register");
  await member.getByLabel("Tên hiển thị").fill("Thành Viên");
  await member.getByLabel("Email").fill(memberEmail);
  await member.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await member.getByRole("button", { name: "Đăng ký" }).click();
  await member.getByLabel("Mã xác thực").fill(VERIFICATION_CODE);
  await expect(member).toHaveURL(/\/invitations$/, { timeout: 15_000 });
  await member.getByRole("button", { name: "Tham gia", exact: true }).click();
  await expect(member).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/`), { timeout: 15_000 });
  const inboxLink = member.getByRole("link", { name: /^Hộp việc/ });
  await expect(inboxLink).toBeVisible();
  await expect(inboxLink).not.toContainText(/\d/);

  // A: create a task and hand it to B.
  await owner.goto(`/${orgSlug}/${wsSlug}/tasks`);
  await owner.getByRole("button", { name: "Việc mới" }).click();
  await owner.getByLabel("Tiêu đề").fill(`Việc cho B ${stamp}`);
  await owner.getByRole("button", { name: "Tạo", exact: true }).click();
  await owner.getByText(`Việc cho B ${stamp}`).click();
  await expect(owner).toHaveURL(/\/tasks\/[0-9A-Z]+$/);
  const taskURL = owner.url();
  await owner.getByRole("combobox").filter({ hasText: "Chưa giao" }).click();
  await owner.getByRole("option", { name: "Thành Viên" }).click();

  // B: the badge appears over the socket, no reload. The row crosses the
  // outbox twice (task.updated → consumer, notification.created → socket) at
  // the dispatcher's 1 s tick, so allow a few seconds — far under a reload.
  await expect(inboxLink).toContainText("1", { timeout: 5_000 });

  // B: open the inbox, follow the row to the task, badge gone.
  await inboxLink.click();
  // First visit compiles the route under `next dev`; give it the same slack as the other specs.
  await expect(member).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/inbox$`), { timeout: 15_000 });
  const row = member.getByRole("link", { name: new RegExp(`Chủ Nhóm đã giao bạn việc “Việc cho B ${stamp}”`) });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();
  await expect(member).toHaveURL(new RegExp(taskURL.replace(/^https?:\/\/[^/]+/, "") + "$"));
  await expect(member.getByRole("link", { name: /^Hộp việc/ })).not.toContainText(/\d/, { timeout: 5_000 });

  await memberContext.close();
});
