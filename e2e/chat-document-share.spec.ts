import { expect, test } from "@playwright/test";
import { e2eApiUrl } from "./api-url";
import { loginFolderUser, seedFolderWorkspace } from "./documents-folders-fixtures";

/**
 * UNI-1966 (contract §7.3): a file sent in a conversation at a level is a real
 * document. Staff sends a docx in a DM at Nhận xét through the real route;
 * the manager opens the card (no request access — the grant already exists),
 * lands on the document page, and writes into the Discussion; staff reads it
 * back from the same document.
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

// Minimal real docx container: a plain text payload under the docx name is
// enough — the route verifies the filename's format against the allowlist
// (the Go side decodes the MIME from the extension), and the card's document
// page opens whatever bytes the version holds.
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test("staff sends a docx in a DM at comment level; the manager comments and staff reads it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ws = await seedFolderWorkspace(page, `docshare${stamp}`, { withMemberB: true });
  const staff = ws.owner;
  const manager = ws.member;
  expect(manager, "seedFolderWorkspace with member B").toBeTruthy();

  const authA = { authorization: `Bearer ${staff.token}` };

  // The DM the card lives in.
  const dm = await page.request.post(`${e2eApiUrl}/api/v1/workspaces/${ws.wsId}/chat/dm`, {
    headers: { ...authA, "content-type": "application/json" },
    data: { user_id: manager!.id },
  });
  expect(dm.ok(), `resolve dm: ${dm.status()} ${await dm.text()}`).toBeTruthy();
  const roomId = ((await dm.json()) as { room: { id: string } }).room.id;

  // Step 1 — staff sends the docx at Nhận xét through the real route.
  const sent = await page.request.post(
    `${e2eApiUrl}/api/v1/workspaces/${ws.wsId}/chat/rooms/${roomId}/messages/document`,
    {
      headers: authA,
      multipart: {
        file: { name: FILE_NAME, mimeType: DOCX_MIME, buffer: Buffer.from(`Báo cáo Q3 ${stamp}\n`) },
        share_level: "comment",
        client_msg_id: `msg-doc-share-${stamp}`,
      },
    },
  );
  expect(sent.ok(), `send document: ${sent.status()} ${await sent.text()}`).toBeTruthy();
  const message = ((await sent.json()) as { message: { id: string; kind?: string; document?: { document_id?: string } } }).message;
  expect(message.kind).toBe("document");
  const documentId = message.document?.document_id;
  expect(documentId, "the card carries its document id").toBeTruthy();

  // Step 2 — the manager opens the card and lands on the document page.
  await loginFolderUser(page, manager!.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/chat?room=${roomId}`);
  // The card, not the locked state: the grant already exists, so there is no
  // "Yêu cầu quyền truy cập" and no "Không có quyền truy cập" text.
  const card = page.locator(`#chat-msg-${message.id}`);
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText("Không có quyền truy cập")).toHaveCount(0);
  await expect(card.getByText("Nhận xét")).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: /Mở trong Tài liệu/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${ws.orgSlug}/${ws.wsSlug}/documents/${documentId}`), {
    timeout: 60_000,
  });

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
