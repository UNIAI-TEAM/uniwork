import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { VERIFICATION_CODE, registerVerified } from "./auth-nav";
import { latestChatFileMessage } from "./db";

/**
 * Bước 0 regression for UNI-745 (chat file + voice messages, plan §6.1): pin
 * what the legacy chat file/voice path does today, before T7 moves it onto the
 * shared FileService. The Go suites in server/internal/{service,handler} pin
 * the same behaviors at the API level; this spec is the browser layer — two
 * members of one organization plus a member of a second organization.
 *
 * Requires `make start-worktree` (this lane's ports) with LOCAL_UPLOAD_DIR.
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
const outsiderEmail = `chat-outsider-${stamp}@example.com`;

let ownerContext: BrowserContext;
let memberContext: BrowserContext;
let outsiderContext: BrowserContext;
let owner: Page;
let member: Page;
let outsider: Page;

let fileBody = "";
let fileName = "";

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

/** Sends one staged file through the composer (attach → send). */
async function sendFile(page: Page, name: string, mimeType: string, body: string) {
  await page.locator('input[type="file"]').setInputFiles({
    name,
    mimeType,
    buffer: Buffer.from(body, "utf8"),
  });
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
}

async function openChat(page: Page) {
  await page.goto(`/${orgSlug}/${wsSlug}/chat`);
  await expect(page.getByPlaceholder("Nhập tin nhắn…")).toBeVisible({ timeout: 30_000 });
}

test.describe.serial("chat file and voice messages", () => {
  // Registration, invitation and the second organization need more than the
  // 60s default; the assertions themselves stay short.
  test.describe.configure({ timeout: 240_000 });
  test.beforeAll(async ({ browser }) => {
    ownerContext = await browser.newContext();
    memberContext = await browser.newContext();
    outsiderContext = await browser.newContext();
    owner = await ownerContext.newPage();
    member = await memberContext.newPage();
    outsider = await outsiderContext.newPage();

    // A failing setup step is otherwise a bare URL timeout; name the API call
    // that refused it (rate limits and permission gates look identical from
    // the DOM).
    for (const page of [owner, member, outsider]) {
      page.on("response", (res) => {
        if (res.url().includes("/api/") && res.status() >= 400) {
          console.log(`[api] ${res.status()} ${res.request().method()} ${res.url()}`);
        }
      });
    }

    await registerVerified(owner, "chat-owner", stamp);
    await createWorkspaceInviting(owner, memberEmail);

    await registerInvitee(member, "Thành Viên", memberEmail);
    await member.goto("/invitations");
    await member.getByRole("button", { name: /Tham gia|Chấp nhận/ }).first().click();
    await expect(member).toHaveURL(new RegExp(`/${orgSlug}/${wsSlug}/`), { timeout: 20_000 });

    // A second organization: the outsider owns their own workspace and is in
    // no way a member of the one under test.
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

    fileBody = `Bước 0 chat file ${stamp}\n`.repeat(20);
    fileName = `ghi-chu-${stamp}.txt`;
  });

  test.afterAll(async () => {
    await ownerContext?.close();
    await memberContext?.close();
    await outsiderContext?.close();
  });

  test("a file sent in the room reaches the second member and downloads @files-smoke", async () => {
    await openChat(owner);
    await openChat(member);

    await sendFile(owner, fileName, "text/plain", fileBody);

    // The sender sees the file card with the human name.
    const ownerCard = owner.locator('article[id^="chat-msg-"]').filter({ hasText: fileName });
    await expect(ownerCard).toBeVisible({ timeout: 20_000 });

    // The second member sees the same attachment and downloads exactly those
    // bytes through the room-authorized route.
    const memberCard = member.locator('article[id^="chat-msg-"]').filter({ hasText: fileName });
    await expect(memberCard).toBeVisible({ timeout: 20_000 });
    const [download] = await Promise.all([
      member.waitForEvent("download", { timeout: 20_000 }),
      member.getByRole("button", { name: `Tải ${fileName} xuống` }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(fileName);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf8")).toBe(fileBody);
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
    // duration the uploader measured.
    await expect(memberRow.getByText(/^0:0[1-3]$/)).toBeVisible({ timeout: 20_000 });

    await memberRow.getByRole("button", { name: "Phát tin nhắn thoại" }).click();
    await expect(memberRow.getByRole("button", { name: "Tạm dừng tin nhắn thoại" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(memberRow.getByRole("slider", { name: "Vị trí phát" })).toBeVisible();
  });

  test("a resend with the same client_msg_id does not duplicate the message", async () => {
    await openChat(owner);

    const idempotentName = `gui-lai-${stamp}.txt`;
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

    await sendFile(owner, fileName2, "text/plain", fileBody);
    const card2 = owner.locator('article[id^="chat-msg-"]').filter({ hasText: fileName2 });
    await expect(card2).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => uploads, { timeout: 20_000 }).toBe(1);
    expect(firstID).not.toBe("");
    expect(secondID).toBe(firstID);

    // Exactly one card for that name, whatever the retry did server-side.
    await expect(card2).toHaveCount(1);
    await owner.unroute("**/messages/file");
  });

  test("a member of another organization cannot reach the workspace or its files", async () => {
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
  });

  test("an unsupported file type is refused before it is sent", async () => {
    await openChat(owner);
    const before = await owner.locator('article[id^="chat-msg-"]').count();

    await owner.locator('input[type="file"]').setInputFiles({
      name: "tai-lieu.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("PK\u0003\u0004 khong-phai-tap-duoc-phep", "binary"),
    });

    await expect(owner.getByText("Loại tệp không được hỗ trợ. Dùng ảnh, PDF hoặc văn bản thuần.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(owner.locator('article[id^="chat-msg-"]').filter({ hasText: "tai-lieu.zip" })).toHaveCount(0);
    expect(await owner.locator('article[id^="chat-msg-"]').count()).toBe(before);
  });

  test("blocking a peer closes the direct messages in both directions", async () => {
    await openChat(member);
    // Member opens a direct conversation with the owner.
    await member.getByRole("button", { name: "Tạo cuộc trò chuyện" }).click();
    await member.getByRole("menuitem", { name: "Nhắn tin với người mới" }).click();
    await member.getByLabel("Tên hoặc email").fill("Chủ Tệp");
    await member.getByRole("button", { name: /Chủ Tệp/ }).first().click();

    const dmComposer = member.getByPlaceholder("Nhập tin nhắn…");
    await expect(dmComposer).toBeVisible({ timeout: 20_000 });
    await dmComposer.fill("xin chao");
    await member.getByRole("button", { name: "Gửi", exact: true }).click();
    await expect(member.getByText("xin chao", { exact: true })).toBeVisible({ timeout: 20_000 });

    // The DM settings sheet carries the block action.
    await member.getByRole("button", { name: "Cài đặt cuộc trò chuyện" }).click();
    await member.getByRole("button", { name: "Chặn nhắn tin" }).click();
    await member.getByRole("alertdialog").getByRole("button", { name: "Chặn nhắn tin" }).click();

    // The owner opens the same conversation and finds the composer closed.
    await openChat(owner);
    await owner.getByText("Thành Viên", { exact: true }).first().click();
    await expect(owner.getByPlaceholder("Không thể nhắn tin")).toBeVisible({ timeout: 20_000 });
    await expect(owner.getByPlaceholder("Không thể nhắn tin")).toBeDisabled();
    await expect(owner.getByRole("button", { name: "Gửi", exact: true })).toHaveCount(0);
  });
});
