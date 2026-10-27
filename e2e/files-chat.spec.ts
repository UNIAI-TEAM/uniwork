import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { VERIFICATION_CODE, registerVerified } from "./auth-nav";
import { latestChatFileMessage } from "./db";
import { joinInvitation } from "./invitations";

/**
 * Bước 0 regression for UNI-745 (chat file + voice messages, plan §6.1): pin
 * what the legacy chat file/voice path does today, before T7 moves it onto the
 * shared FileService. The Go suites in server/internal/{service,handler} pin
 * the same behaviors at the API level; this spec is the browser layer — two
 * members of one organization plus a member of a second organization.
 *
 * Requires `make start-worktree` (this lane's ports) on MinIO (`make minio-up`):
 * since UNI-1633 file and voice bytes come from signed storage URLs, which
 * the local disk backend cannot issue.
 */

// Chromium's fake devices make the voice recorder testable without a real
// microphone; the permission is what getUserMedia asks for.
test.use({
  permissions: ["microphone"],
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  },
});

const stamp = Date.now();
const orgSlug = `tep-chat-${stamp}`;
const orgName = `Tep Chat ${stamp}`;
const wsSlug = `team-files-${stamp}`;
const wsName = `Team Files ${stamp}`;
const ownerEmail = `chat-owner-${stamp}@example.com`;
const memberEmail = `chat-member-${stamp}@example.com`;

let ownerContext: BrowserContext;
let memberContext: BrowserContext;
let owner: Page;
let member: Page;

// A real 1x1 PNG: the plain-file route sniffs the content type of the bytes
// (a text body labelled image/png is refused), and since UNI-2012 D1c an
// editor-format file (pdf, txt, docx, ...) never takes that route from the
// composer, so an image is the one plain file left.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let fileBody = "";
let fileName = "";
let imageName = "";

/** Invitee: the invitation already exists, so verification lands on the invite screen. */
async function registerInvitee(page: Page, name: string, email: string) {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await expect(page).toHaveURL(/\/verify$/, { timeout: 15_000 });
  await page.getByLabel("Mã xác thực").fill(VERIFICATION_CODE);
  await page.waitForURL(/\/(invitations|onboarding)$/, { timeout: 15_000 });
}

/** Walks the onboarding wizard as the founder and invites one colleague. */
async function createWorkspaceInviting(page: Page, email: string) {
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("radio", { name: "Kỹ sư / phát triển" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByLabel("Tên tổ chức").fill(orgName);
  await page.getByRole("button", { name: `Tạo ${orgName}` }).click();
  await page.getByLabel("Tên workspace").fill(wsName);
  await page.getByRole("button", { name: `Tạo ${wsName}` }).click();
  await page.getByRole("heading", { name: /Mời đồng nghiệp/ }).waitFor();
  await page.getByLabel("Email đồng nghiệp").fill(email);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Gửi lời mời" }).click();
  // "Hoàn tất" is aria-disabled while the invitation request is in flight and
  // the primitive blocks that click instead of queueing it, so wait for the
  // recorded invite first.
  await expect(page.getByText("Đã gửi email").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Hoàn tất" }).click();
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/tasks$`), { timeout: 20_000 });
  await page.getByRole("button", { name: "Để sau" }).click();
}

// GET .../chat/rooms/{roomID}: the room detail, the one read that carries the
// viewer's can_send_document (the room list and .../messages do not match).
const ROOM_DETAIL_PATH = /\/api\/v1\/workspaces\/[^/]+\/chat\/rooms\/[^/]+$/;
// Per page: whether the room it opened offers documents, as that read answered
// (undefined when the read was never seen).
const roomOffersDocuments = new WeakMap<Page, Promise<boolean | undefined>>();

/** Start listening for the room detail read before the page navigates. */
function watchRoomDetail(page: Page) {
  roomOffersDocuments.set(
    page,
    page
      .waitForResponse((res) => res.request().method() === "GET" && ROOM_DETAIL_PATH.test(new URL(res.url()).pathname), {
        timeout: 60_000,
      })
      .then(
        async (res) => ((await res.json()) as { room?: { can_send_document?: boolean } }).room?.can_send_document === true,
        () => undefined,
      ),
  );
}

/** The article of a plain image message: its open button carries the file name (the name is not text). */
function imageCard(page: Page, name: string) {
  return page.locator('article[id^="chat-msg-"]').filter({ has: page.getByRole("button", { name: `Xem ${name}` }) });
}

/**
 * Sends one staged plain file through the composer (attach → send). Only an
 * image takes the plain route: no level picker shows for it, whatever the
 * room allows.
 */
async function sendFile(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer });
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
}

/**
 * Sends one staged editor-format file as a document (UNI-2012 D1c): the level
 * picker follows the room detail's can_send_document, which can land after the
 * chip, so wait on that read (watched since openChat) before sending at the
 * default level.
 */
async function sendDocument(page: Page, name: string, mimeType: string, body: string) {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer: Buffer.from(body, "utf8") });
  expect(await roomOffersDocuments.get(page), "the room allows documents").toBe(true);
  const picker = page.getByRole("button", { name: "Quyền cho mọi người trong cuộc trò chuyện" });
  await expect(picker).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
}

async function openChat(page: Page) {
  watchRoomDetail(page);
  await page.goto(`/${orgSlug}/${wsSlug}/chat`);
  await expect(page.getByPlaceholder("Nhập tin nhắn…")).toBeVisible({ timeout: 30_000 });
}

// Since UNI-1965 direct messages live in their own "Tin nhắn" view: the
// new-conversation button and the DM list render only there, not in the
// workspace channels list that openChat lands on.
async function openMessages(page: Page) {
  watchRoomDetail(page);
  await page.goto(`/${orgSlug}/${wsSlug}/chat?view=messages`);
  await expect(page.getByRole("button", { name: "Tạo cuộc trò chuyện" })).toBeVisible({ timeout: 30_000 });
}

test.describe.serial("chat file and voice messages", () => {
  // Registration, invitation and the second organization need more than the
  // 60s default; the assertions themselves stay short.
  test.describe.configure({ timeout: 240_000 });
  test.beforeAll(async ({ browser }) => {
    ownerContext = await browser.newContext();
    memberContext = await browser.newContext();
    owner = await ownerContext.newPage();
    member = await memberContext.newPage();

    // A failing setup step is otherwise a bare URL timeout; name the API call
    // that refused it (rate limits and permission gates look identical from
    // the DOM).
    for (const page of [owner, member]) {
      page.on("response", (res) => {
        if (res.url().includes("/api/") && res.status() >= 400) {
          console.log(`[api] ${res.status()} ${res.request().method()} ${res.url()}`);
        }
      });
    }

    await registerVerified(owner, "chat-owner", stamp);
    await createWorkspaceInviting(owner, memberEmail);

    await registerInvitee(member, "Thành Viên", memberEmail);
    await joinInvitation(member, orgName);
    await expect(member).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/`), { timeout: 20_000 });

    fileBody = `Bước 0 chat file ${stamp}\n`.repeat(20);
    fileName = `ghi-chu-${stamp}.txt`;
    imageName = `anh-${stamp}.png`;
  });

  test.afterAll(async () => {
    await ownerContext?.close();
    await memberContext?.close();
  });

  test("an image sent in the room reaches the second member and downloads @files-smoke", async () => {
    await openChat(owner);
    await openChat(member);

    await sendFile(owner, imageName, "image/png", PNG_BYTES);

    // The sender sees the image message with the human name on its open button.
    await expect(imageCard(owner, imageName)).toBeVisible({ timeout: 20_000 });

    // The second member sees the same attachment, opens it and downloads
    // exactly those bytes from the signed storage URL the message list handed
    // it (UNI-1633).
    const memberCard = imageCard(member, imageName);
    await expect(memberCard).toBeVisible({ timeout: 20_000 });
    await memberCard.getByRole("button", { name: `Xem ${imageName}` }).click();
    const [download] = await Promise.all([
      member.waitForEvent("download", { timeout: 20_000 }),
      member.getByRole("dialog").getByRole("button", { name: "Tải xuống" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(imageName);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).equals(PNG_BYTES)).toBe(true);
  });

  test("a text file sent from the composer becomes a document card for both members", async () => {
    await openChat(owner);
    await openChat(member);

    await sendDocument(owner, fileName, "text/plain", fileBody);

    // No plain file card (no download button): the card opens the document in
    // Tài liệu, and the title carries the file's name.
    const titled = new RegExp(`^Mở trong Tài liệu:.*ghi-chu-${stamp}`);
    for (const page of [owner, member]) {
      const card = page.locator('article[id^="chat-msg-"]').filter({ has: page.getByRole("button", { name: titled }) });
      await expect(card.last()).toBeVisible({ timeout: 60_000 });
      await expect(card.last().getByRole("button", { name: `Tải ${fileName} xuống` })).toHaveCount(0);
    }
  });

  test("a voice message plays for the second member with its duration", async () => {
    await openChat(owner);
    await openChat(member);

    await owner.getByRole("button", { name: "Ghi âm tin nhắn thoại" }).click();
    await expect(owner.getByRole("button", { name: "Dừng" })).toBeVisible({ timeout: 15_000 });
    await owner.waitForTimeout(1500);
    await owner.getByRole("button", { name: "Dừng" }).click();
    await owner.getByRole("button", { name: "Gửi", exact: true }).click();

    const ownerRow = owner.locator('article[id^="chat-msg-"]').filter({ hasText: "Tin nhắn thoại" }).last();
    await expect(ownerRow).toBeVisible({ timeout: 20_000 });
    const memberRow = member.locator('article[id^="chat-msg-"]').filter({ hasText: "Tin nhắn thoại" }).last();
    await expect(memberRow).toBeVisible({ timeout: 20_000 });
    // Metadata duration, not the player's own estimate: both rows render the
    // duration the uploader measured. Since #348 the duration opens the line that
    // also carries the time and delivery state, so it is matched at the start only.
    await expect(memberRow.getByText(/^0:0[1-3]/).first()).toBeVisible({ timeout: 20_000 });

    await memberRow.getByRole("button", { name: "Phát tin nhắn thoại" }).click();
    await expect(memberRow.getByRole("button", { name: "Tạm dừng tin nhắn thoại" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(memberRow.getByRole("slider", { name: "Vị trí phát" })).toBeVisible();
  });

  test("a resend with the same client_msg_id does not duplicate the message", async () => {
    await openChat(owner);

    const idempotentName = `gui-lai-${stamp}.png`;
    const fileName2 = idempotentName;
    let firstID = "";
    let secondID = "";
    let uploads = 0;

    await owner.route("**/messages/file", async (route) => {
      const request = route.request();
      uploads += 1;
      const headers = await request.allHeaders();
      const body = request.postDataBuffer();
      const options = { headers, postData: body ?? undefined } as Parameters<typeof route.fetch>[0];
      const first = await route.fetch(options);
      // The client retried because the response was lost: same bytes, same
      // client_msg_id, one message.
      const second = await route.fetch(options);
      firstID = ((await first.json()) as { message?: { id?: string } }).message?.id ?? "";
      secondID = ((await second.json()) as { message?: { id?: string } }).message?.id ?? "";
      await route.fulfill({ response: first });
    });

    await sendFile(owner, fileName2, "image/png", PNG_BYTES);
    const card2 = imageCard(owner, fileName2);
    await expect(card2).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => uploads, { timeout: 20_000 }).toBe(1);
    expect(firstID).not.toBe("");
    expect(secondID).toBe(firstID);

    // Exactly one card for that name, whatever the retry did server-side.
    await expect(card2).toHaveCount(1);
    await owner.unroute("**/messages/file");
  });

  test("a member of another organization cannot reach the workspace or its files", async () => {
    const outsiderContext = await ownerContext.browser()!.newContext();
    const outsider = await outsiderContext.newPage();
    await registerVerified(outsider, "chat-outsider", stamp);
    await outsider.getByRole("button", { name: /Bắt đầu/ }).click();
    await outsider.getByRole("button", { name: "Bỏ qua" }).click();
    await outsider.getByLabel("Tên tổ chức").fill(`Ngoai Org ${stamp}`);
    await outsider.getByRole("button", { name: `Tạo Ngoai Org ${stamp}` }).click();
    await outsider.getByLabel("Tên workspace").fill(`Ngoai WS ${stamp}`);
    await outsider.getByRole("button", { name: `Tạo Ngoai WS ${stamp}` }).click();
    await outsider.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
    await expect(outsider).toHaveURL(new RegExp(`/ngoai-org-${stamp}/ngoai-ws-${stamp}/`), { timeout: 20_000 });
    await outsider.getByRole("button", { name: "Để sau" }).click();

    // Real ids from the database: the outsider knows exactly where the file
    // lives, which is the "guesses the id/URL" case from plan §6.1.
    const ref = await latestChatFileMessage(orgSlug, wsSlug);
    expect(ref.roomId).not.toBe("");
    expect(ref.messageId).not.toBe("");

    await outsider.goto(`/${orgSlug}/${wsSlug}/chat`);
    // The workspace gate refuses the URL pair: no file name, no room, and the
    // app sends them back to their own workspace picker.
    await expect(outsider).toHaveURL(/\/workspaces$/, { timeout: 20_000 });
    await expect(outsider.locator('article[id^="chat-msg-"]').filter({ hasText: ref.filename })).toHaveCount(0);
    await outsiderContext.close();
  });

  test("an unsupported file type is refused before it is sent", async () => {
    await openChat(owner);
    // The composer is visible before the message list finishes loading; wait
    // for a known earlier message so `before` counts a settled list.
    await expect(imageCard(owner, `gui-lai-${stamp}.png`)).toBeVisible({ timeout: 20_000 });
    const before = await owner.locator('article[id^="chat-msg-"]').count();

    await owner.locator('input[type="file"]').setInputFiles({
      name: "tai-lieu.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("PK\u0003\u0004 khong-phai-tap-duoc-phep", "binary"),
    });

    await expect(owner.getByText("Loại tệp không được hỗ trợ. Dùng ảnh, PDF, văn bản thuần, CSV hoặc Markdown.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(owner.locator('article[id^="chat-msg-"]').filter({ hasText: "tai-lieu.zip" })).toHaveCount(0);
    expect(await owner.locator('article[id^="chat-msg-"]').count()).toBe(before);
  });

  test("blocking a peer closes the direct messages in both directions", async () => {
    await openMessages(member);
    // Member opens a direct conversation with the owner.
    await member.getByRole("button", { name: "Tạo cuộc trò chuyện" }).click();
    await member.getByRole("menuitem", { name: "Nhắn tin với người mới" }).click();
    // The owner's display name comes from registerVerified("chat-owner").
    await member.getByLabel("Tên hoặc email").fill("chat-owner");
    // Scoped to the picker: since the person card (15e833f0d) the owner's earlier
    // file messages carry an avatar button "Xem thông tin của chat-owner" in the
    // list behind the dialog, and it comes first in the DOM.
    await member
      .getByRole("dialog")
      .getByRole("button", { name: /chat-owner/ })
      .first()
      .click();

    const dmComposer = member.getByPlaceholder("Nhập tin nhắn…");
    await expect(dmComposer).toBeVisible({ timeout: 20_000 });
    await dmComposer.fill("xin chao");
    await member.getByRole("button", { name: "Gửi", exact: true }).click();
    // Scoped to the message list: the composer still holds the same text.
    await expect(member.locator('article[id^="chat-msg-"]').filter({ hasText: "xin chao" })).toBeVisible({
      timeout: 20_000,
    });

    // The DM settings sheet carries the block action; it opens from the info panel,
    // which docks open on a wide pane and is opened from the header otherwise.
    const panelToggle = member.getByRole("button", { name: "Thông tin cuộc trò chuyện" });
    if ((await panelToggle.getAttribute("aria-pressed")) !== "true") await panelToggle.click();
    await member.getByRole("button", { name: "Cài đặt cuộc trò chuyện" }).click();
    await member.getByRole("button", { name: "Chặn nhắn tin" }).click();
    await member.getByRole("alertdialog").getByRole("button", { name: "Chặn nhắn tin" }).click();

    // The owner opens the same conversation and finds the composer closed.
    await openMessages(owner);
    // The Messages view already opens the most recent DM; click its row (scoped to
    // the conversation list, not the header or the author name in the timeline).
    await owner
      .getByRole("navigation", { name: "Danh sách trò chuyện" })
      .getByRole("button", { name: /Thành Viên/ })
      .click();
    // A closed composer exposes the reason as the textbox's accessible name, not as a placeholder.
    const blockedComposer = owner.getByRole("textbox", { name: "Không thể nhắn tin" });
    await expect(blockedComposer).toBeVisible({ timeout: 20_000 });
    await expect(blockedComposer).toBeDisabled();
    await expect(owner.getByRole("button", { name: "Gửi", exact: true })).toHaveCount(0);
  });
});
