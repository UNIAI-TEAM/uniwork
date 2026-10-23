import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { e2eApiUrl } from "./api-url";
import { loginFolderUser, seedFolderWorkspace } from "./documents-folders-fixtures";
import { installUniChatBridge } from "./unichat-bridge";

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
 * The comments of a docx are served by the editor frame (its own Discussion
 * panel is the page's only one), so steps 3 and 4 drive the frame.
 */
test.describe.configure({ timeout: 360_000 });

const stamp = Date.now();
const FILE_NAME = `bao-cao-q3-${stamp}.docx`;
const COMMENT_TEXT = `Nhận xét từ quản lý ${stamp}`;

const repoRoot =
  basename(process.cwd()).toLowerCase() === "e2e" ? resolve(process.cwd(), "..") : process.cwd();
const DOCX_FIXTURE = resolve(repoRoot, "docs/office/g0/fixtures/files/docs/docx-simple.docx");
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Opens the editor frame's Discussion panel. The frame loads asynchronously
 * (its toolbar and the Discussion toggle appear after the document opens), and
 * the toggle flips the panel, so click it once and only when it is closed.
 */
async function openFrameDiscussion(frame: FrameLocator, panel: Locator): Promise<void> {
  const toggle = frame.getByRole("button", { name: /^(Thảo luận|Discussion)$/ });
  await expect(toggle).toBeVisible({ timeout: 90_000 });
  if (!(await panel.isVisible())) await toggle.click();
  await expect(panel).toBeVisible({ timeout: 30_000 });
}

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

  // The comment surface: the editor frame serves the comments of a docx, so
  // its own panel is the page's only one (invariant 8) — the page's header
  // trigger and panel go away once the frame says it has comments. The
  // Discussion lives in the frame; the page's `document-comments-pane` does
  // not exist for a docx, so the spec drives the frame, not the page.
  const frame = page.frameLocator("iframe").first();
  const discussion = frame.getByRole("complementary", { name: /^(Thảo luận|Discussion)$/ });
  await openFrameDiscussion(frame, discussion);

  // Step 3 — the manager writes into the Discussion (the comment-level grant
  // is write access to discussion, so the composer is not view-only).
  const box = discussion.getByRole("textbox", { name: /Viết vào thảo luận|Write in the discussion/ });
  await box.click();
  await box.pressSequentially(COMMENT_TEXT);
  await discussion.getByRole("button", { name: /^Gửi$|^Send$/ }).click();
  await expect(discussion.getByText(COMMENT_TEXT).first()).toBeVisible({ timeout: 30_000 });

  // Step 4 — staff sees the comment on the same document.
  await loginFolderUser(page, staff.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents/${documentId}`);
  const staffFrame = page.frameLocator("iframe").first();
  const staffDiscussion = staffFrame.getByRole("complementary", { name: /^(Thảo luận|Discussion)$/ });
  await openFrameDiscussion(staffFrame, staffDiscussion);
  await expect(staffDiscussion.getByText(COMMENT_TEXT).first()).toBeVisible({ timeout: 30_000 });
});

const DOCX_V2_FIXTURE = resolve(repoRoot, "docs/office/g0/fixtures/files/docs/docx-vietnamese.docx");

/**
 * A DM with a plain docx file message the sender already holds — the shape
 * share-as-document converts (UNI-1966 §2.2): the file went out the old way,
 * before any share level was picked. Only the setup uses the API.
 */
async function seedDmWithPlainDocx(page: Page, slug: string, fileName: string) {
  const ws = await seedFolderWorkspace(page, slug, { withMemberB: true });
  const sender = ws.owner;
  const peer = ws.member;
  expect(peer, "seedFolderWorkspace with member B").toBeTruthy();
  const auth = { authorization: `Bearer ${sender.token}` };

  const dm = await page.request.post(`${e2eApiUrl}/api/v1/workspaces/${ws.wsId}/chat/dm`, {
    headers: { ...auth, "content-type": "application/json" },
    data: { user_id: peer!.id },
  });
  expect(dm.ok(), `resolve dm: ${dm.status()} ${await dm.text()}`).toBeTruthy();
  const roomId = ((await dm.json()) as { room: { id: string } }).room.id;

  const sent = await page.request.post(`${e2eApiUrl}/api/v1/workspaces/${ws.wsId}/chat/rooms/${roomId}/messages/file`, {
    headers: auth,
    multipart: {
      file: { name: fileName, mimeType: DOCX_MIME, buffer: readFileSync(DOCX_FIXTURE) },
      client_msg_id: `msg-old-docx-${stamp}-${slug}`,
    },
  });
  expect(sent.ok(), `send file: ${sent.status()} ${await sent.text()}`).toBeTruthy();
  const messageId = ((await sent.json()) as { message: { id: string } }).message.id;
  expect(messageId).toBeTruthy();
  return { ws, sender, roomId, messageId, auth };
}

test("the sender turns an old file message into a document card in place", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `bien-ban-cu-${stamp}.docx`;
  const { ws, sender, roomId, messageId } = await seedDmWithPlainDocx(page, `docold${stamp}`, name);

  await loginFolderUser(page, sender.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/chat?room=${roomId}`);

  // The old message is still a file card: no document title button yet, and
  // the sender (only the sender) has the conversion action.
  const row = page.locator(`article#chat-msg-${messageId}`);
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row.getByRole("button", { name: /^Mở trong Tài liệu:/ })).toHaveCount(0);
  await row.getByRole("button", { name: "Chia sẻ dạng tài liệu" }).click();
  await page.getByRole("menuitem", { name: "Nhận xét", exact: true }).click();

  // The same message turns into the document card — same article, no second
  // row for the file.
  await expect(row.getByRole("button", { name: /^Mở trong Tài liệu:/ })).toBeVisible({ timeout: 60_000 });
  // The card shows the viewer's own level, and the sender owns the document:
  // "Quản lý" plus the share count. The level the peer got (Nhận xét) is pinned
  // from the peer's side by the first test.
  await expect(row.getByText("Quản lý", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText(/Đã chia sẻ với 1 người/)).toBeVisible({ timeout: 30_000 });
  await expect(row.getByRole("button", { name: "Chia sẻ dạng tài liệu" })).toHaveCount(0);
  await expect(page.locator('article[id^="chat-msg-"]').filter({ hasText: name })).toHaveCount(1);
});

test("a new version uploaded from the card writes a version line into the conversation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `bien-ban-v2-${stamp}.docx`;
  const { ws, sender, roomId, messageId, auth } = await seedDmWithPlainDocx(page, `docver${stamp}`, name);

  // The card exists through the API (the conversion is the previous test's
  // subject); this one starts from the document card the DM holds.
  const shared = await page.request.post(
    `${e2eApiUrl}/api/v1/workspaces/${ws.wsId}/chat/rooms/${roomId}/messages/${messageId}/share-as-document`,
    {
      headers: { ...auth, "content-type": "application/json" },
      data: { share_level: "comment", client_msg_id: `share-old-docx-${stamp}` },
    },
  );
  expect(shared.ok(), `share as document: ${shared.status()} ${await shared.text()}`).toBeTruthy();

  await loginFolderUser(page, sender.email);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/chat?room=${roomId}`);
  const card = page.locator(`article#chat-msg-${messageId}`);
  await expect(card.getByRole("button", { name: /^Mở trong Tài liệu:/ })).toBeVisible({ timeout: 60_000 });

  // The document's actions live in the message menu (UNI-2012 S7): a right
  // click on the card opens it; the card itself has no upload button.
  await expect(card.getByRole("button", { name: "Tải lên phiên bản mới" })).toHaveCount(0);
  await card.getByRole("button", { name: /^Mở trong Tài liệu:/ }).click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Lịch sử phiên bản" })).toBeVisible({ timeout: 15_000 });
  await menu.getByRole("menuitem", { name: "Tải lên phiên bản mới" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  // Different bytes: an identical upload is refused as "nothing changed".
  await dialog.locator('input[type="file"]').setInputFiles({
    name: `v2-${name}`,
    mimeType: DOCX_MIME,
    buffer: readFileSync(DOCX_V2_FIXTURE),
  });
  await dialog.getByRole("button", { name: "Tải lên", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 60_000 });

  // The compact system line: "{name} đã tải lên phiên bản {n}".
  const line = page.locator('article[id^="chat-msg-"]').filter({ hasText: /đã tải lên phiên bản \d+/ });
  await expect(line).toHaveCount(1, { timeout: 60_000 });
});

test("inside the UniChat shell the card offers no Office entry and opens its pages in the browser (UNI-2012 D7)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `bien-ban-shell-${stamp}.docx`;
  const { ws, sender, roomId, messageId, auth } = await seedDmWithPlainDocx(page, `docshell${stamp}`, name);
  const shared = await page.request.post(
    `${e2eApiUrl}/api/v1/workspaces/${ws.wsId}/chat/rooms/${roomId}/messages/${messageId}/share-as-document`,
    {
      headers: { ...auth, "content-type": "application/json" },
      data: { share_level: "comment", client_msg_id: `share-shell-docx-${stamp}` },
    },
  );
  expect(shared.ok(), `share as document: ${shared.status()} ${await shared.text()}`).toBeTruthy();

  // Signed in on the web first (the refresh cookie backs the fake bridge's
  // session), then every later load boots as the UniChat host.
  await loginFolderUser(page, sender.email);
  await installUniChatBridge(page);
  const chatPath = `/${ws.orgSlug}/${ws.wsSlug}/chat`;
  await page.goto(`${chatPath}?room=${roomId}`);
  const card = page.locator(`article#chat-msg-${messageId}`);
  await expect(card.getByRole("button", { name: /^Mở trong Tài liệu:/ })).toBeVisible({ timeout: 60_000 });

  await card.getByRole("button", { name: /^Mở trong Tài liệu:/ }).click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Lịch sử phiên bản" })).toBeVisible({ timeout: 15_000 });
  // The shell cannot launch the desktop app: the entry is not offered at all.
  await expect(menu.getByRole("menuitem", { name: "Chỉnh sửa trong UniWork Office" })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "Chia sẻ", exact: true })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Lịch sử phiên bản" }).click();

  // The document page leaves the shell for the browser; the shell stays on chat.
  await expect
    .poll(() => page.evaluate(() => window.__uniChat.external))
    .toEqual([expect.stringMatching(new RegExp(`/${ws.orgSlug}/${ws.wsSlug}/documents/[^/?]+\\?panel=versions$`))]);
  await expect(page).toHaveURL(new RegExp(`${chatPath}\\?room=${roomId}`));
});
