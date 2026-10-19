import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { e2eApiUrl } from "./api-url";
import { loginFolderUser, seedFolderWorkspace } from "./documents-folders-fixtures";

/**
 * UNI-1966 (contract §7.3, RFC-05): a file sent in a conversation at a level
 * is a real document. Staff sends a docx in a DM through the composer's own
 * surface — the staged file opens the share-level picker at its Nhận xét
 * default and the send goes out on the document route; the manager opens the
 * card (no request access — the grant already exists), lands on the document
 * page, and writes into the Discussion; staff reads it back from the same
 * document. The API only seeds the workspace and resolves the DM.
 *
 * The fixture is a real minimal docx: the route verifies the payload's type
 * from the bytes (http.DetectContentType reads a zip container, not the
 * declared MIME or the extension), so a plain-text body under a .docx name
 * would be refused 415.
 *
 * Prerequisites (same as documents-comments.spec.ts): the app on
 * E2E_BASE_URL with `FF_DOCUMENTS=true`, Postgres + Redis + storage up, this
 * worktree's migrations applied, and the genoffice frame pin the document
 * page needs to open a docx.
 *
 * Deliberately not asserted yet: the manager's view carries no path into the
 * staff's "My Folder" — that surface lands with UNI-1974 on the root; until
 * then there is nothing stable to pin the check on.
 *
 * Not run locally: it needs the server half of UNI-1966 and the office frame.
 * It runs in the cloud round after the server lands.
 */
test.describe.configure({ timeout: 360_000 });

const stamp = Date.now();
const FILE_NAME = `bao-cao-q3-${stamp}.docx`;
const COMMENT_TEXT = `Nhận xét từ quản lý ${stamp}`;

const repoRoot =
  basename(process.cwd()).toLowerCase() === "e2e" ? resolve(process.cwd(), "..") : process.cwd();
const DOCX_FIXTURE = resolve(repoRoot, "docs/office/g0/fixtures/files/docs/docx-simple.docx");
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test("staff sends a docx in a DM at comment level; the manager comments and staff reads it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ws = await seedFolderWorkspace(page, `docshare${stamp}`, { withMemberB: true });
  const staff = ws.owner;
  const manager = ws.member;
  expect(manager, "seedFolderWorkspace with member B").toBeTruthy();

  const authA = { authorization: `Bearer ${staff.token}` };

  // The DM the card lives in — the only setup the API still does.
  const dm = await page.request.post(`${e2eApiUrl}/api/v1/workspaces/${ws.wsId}/chat/dm`, {
    headers: { ...authA, "content-type": "application/json" },
    data: { user_id: manager!.id },
  });
  expect(dm.ok(), `resolve dm: ${dm.status()} ${await dm.text()}`).toBeTruthy();
  const roomId = ((await dm.json()) as { room: { id: string } }).room.id;

  // Step 1 — staff drives the UI: open the DM, stage the docx on the
  // composer input, read the picker's Nhận xét default, send.
  await loginFolderUser(page, staff.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/chat?room=${roomId}`);
  await expect(page.getByPlaceholder("Nhập tin nhắn…")).toBeVisible({ timeout: 30_000 });

  await page.locator('input[type="file"]').setInputFiles({
    name: FILE_NAME,
    mimeType: DOCX_MIME,
    buffer: readFileSync(DOCX_FIXTURE),
  });
  // The staged file sits on its chip until send.
  await expect(page.getByText(FILE_NAME)).toBeVisible({ timeout: 15_000 });
  const picker = page.getByRole("button", { name: "Quyền cho mọi người trong cuộc trò chuyện" });
  await expect(picker).toBeVisible({ timeout: 15_000 });
  await expect(picker).toHaveText(/Nhận xét/);

  await page.getByRole("button", { name: "Gửi", exact: true }).click();

  // The document card lands on staff's own timeline: title button "Mở trong
  // Tài liệu" inside a chat message article.
  const card = page
    .locator('article[id^="chat-msg-"]')
    .filter({ has: page.getByRole("button", { name: /^Mở trong Tài liệu:/ }) })
    .first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText(/Báo cáo Q3|bao-cao-q3/)).toBeVisible({ timeout: 30_000 });

  // Step 2 — the manager opens the card and lands on the document page.
  await loginFolderUser(page, manager!.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/chat?room=${roomId}`);
  // The card, not the locked state: the grant already exists, so there is no
  // "Yêu cầu quyền truy cập" and no "Không có quyền truy cập" text.
  const managerCard = page
    .locator('article[id^="chat-msg-"]')
    .filter({ has: page.getByRole("button", { name: /^Mở trong Tài liệu:/ }) })
    .first();
  await expect(managerCard).toBeVisible({ timeout: 60_000 });
  await expect(managerCard.getByText("Không có quyền truy cập")).toHaveCount(0);
  // The viewer's own level: the manager reads Nhận xét.
  await expect(managerCard.getByText("Nhận xét")).toBeVisible({ timeout: 30_000 });
  await managerCard.getByRole("button", { name: /Mở trong Tài liệu/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${ws.orgSlug}/${ws.wsSlug}/documents/[^/]+$`), {
    timeout: 60_000,
  });
  const documentId = /\/documents\/([^/]+)$/.exec(new URL(page.url()).pathname)?.[1];
  expect(documentId, "the document page carries its id").toBeTruthy();

  // The comment surface: a docx page has the Bình luận + Thảo luận tabs.
  await page.getByRole("button", { name: /^(Bình luận|Comments|Thảo luận|Discussion)$/ }).click();
  const pane = page.getByTestId("document-comments-pane");
  await expect(pane).toBeVisible({ timeout: 30_000 });

  // Step 3 — the manager writes into the Discussion (the comment-level grant
  // is write access to discussion, so the composer is not view-only).
  const composer = pane.getByTestId("document-discussion-composer");
  const box = composer.getByRole("textbox", { name: /Viết vào thảo luận|Write in the discussion/ });
  await box.click();
  await box.pressSequentially(COMMENT_TEXT);
  await composer.getByRole("button", { name: /^Gửi$|^Send$/ }).click();
  await expect(pane.getByText(COMMENT_TEXT).first()).toBeVisible({ timeout: 30_000 });

  // Step 4 — staff sees the comment on the same document.
  await loginFolderUser(page, staff.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents/${documentId}`);
  await page.getByRole("button", { name: /^(Bình luận|Comments|Thảo luận|Discussion)$/ }).click();
  const staffPane = page.getByTestId("document-comments-pane");
  await expect(staffPane).toBeVisible({ timeout: 30_000 });
  await expect(staffPane.getByText(COMMENT_TEXT).first()).toBeVisible({ timeout: 30_000 });
});
