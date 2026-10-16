import { expect, test } from "@playwright/test";
import { e2eApiUrl } from "./api-url";
import { loginFolderUser, seedFolderWorkspace } from "./documents-folders-fixtures";
import { libraryRowButton } from "./documents-onboard";

/**
 * UNI-1814: "Đi tới bản gốc" on a chat file in Documents → "Từ nơi khác" lands
 * in the room the file was sent in, not the workspace chat. User A sends a file
 * in a DM with user B through the API; B opens Documents, picks the file from
 * its chat origin and follows the row's go-to-source action. The jump is the
 * one a chat search result makes: the room opens (`/chat?room=<dm room id>`,
 * the message param is dropped once used) and the message article carries the
 * highlight ring for 2.5 s.
 *
 * Needs the app on E2E_BASE_URL with the `documents` flag ON (FF_DOCUMENTS),
 * Postgres + Redis + storage up and this worktree's migrations applied - the
 * same environment as documents-home.spec.ts. Run by the cloud runner, not locally.
 */
test.describe.configure({ timeout: 360_000 });

const stamp = Date.now();
const FILE_NAME = `de-xuat-dm-${stamp}.txt`;

test("go to source on a DM file opens that DM at the message", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ws = await seedFolderWorkspace(page, `srcchat${stamp}`, { withMemberB: true });
  const sender = ws.owner;
  const reader = ws.member;
  expect(reader, "seedFolderWorkspace with member B").toBeTruthy();

  const authA = { authorization: `Bearer ${sender.token}` };
  const dm = await page.request.post(`${e2eApiUrl}/api/v1/workspaces/${ws.wsId}/chat/dm`, {
    headers: { ...authA, "content-type": "application/json" },
    data: { user_id: reader!.id },
  });
  expect(dm.ok(), `resolve dm: ${dm.status()} ${await dm.text()}`).toBeTruthy();
  const roomId = ((await dm.json()) as { room: { id: string } }).room.id;

  const sent = await page.request.post(`${e2eApiUrl}/api/v1/workspaces/${ws.wsId}/chat/rooms/${roomId}/messages/file`, {
    headers: authA,
    multipart: {
      file: { name: FILE_NAME, mimeType: "text/plain", buffer: Buffer.from(`đề xuất ${stamp}\n`) },
      client_msg_id: `msg-src-chat-${stamp}`,
    },
  });
  expect(sent.ok(), `send file: ${sent.status()} ${await sent.text()}`).toBeTruthy();
  const messageId = ((await sent.json()) as { message: { id: string } }).message.id;
  expect(messageId).toBeTruthy();

  await loginFolderUser(page, reader!.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents`);
  const sidebar = page.getByRole("navigation", { name: "Điều hướng tài liệu" });
  await expect(sidebar.getByText("Từ nơi khác")).toBeVisible({ timeout: 60_000 });
  await sidebar.getByRole("button", { name: "Trò chuyện" }).click();

  const table = page.getByRole("table", { name: "Tài liệu" });
  await expect(libraryRowButton(table, FILE_NAME)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: `Thao tác cho ${FILE_NAME}` }).click();
  await page.getByRole("menuitem", { name: "Đi tới bản gốc" }).click();

  // The DM opens, not the workspace chat, and the message param is consumed.
  await expect(page).toHaveURL(new RegExp(`/${ws.orgSlug}/${ws.wsSlug}/chat\\?room=${roomId}$`), { timeout: 60_000 });
  const message = page.locator(`article#chat-msg-${messageId}`);
  await expect(message).toContainText(FILE_NAME, { timeout: 30_000 });
  await expect(message).toHaveClass(/ring-brand/, { timeout: 30_000 });
});
