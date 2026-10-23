import { expect, test, type Page } from "@playwright/test";
import { e2eApiUrl } from "./api-url";
import { loginFolderUser, seedFolderWorkspace } from "./documents-folders-fixtures";
import { libraryRowButton } from "./documents-onboard";

/**
 * UNI-1814: "Xem nơi đính kèm" on a chat file in Documents → "Từ nơi khác" lands
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
  const diag = recordJumpDiagnostics(page, messageId);
  await page.goto(`/${ws.orgSlug}/${ws.wsSlug}/documents`);
  await diag.watchRow();
  const sidebar = page.getByRole("navigation", { name: "Điều hướng tài liệu" });
  await expect(sidebar.getByText("Từ nơi khác")).toBeVisible({ timeout: 60_000 });
  await sidebar.getByRole("button", { name: "Trò chuyện" }).click();

  const table = page.getByRole("table", { name: "Tài liệu" });
  await expect(libraryRowButton(table, FILE_NAME)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: `Thao tác cho ${FILE_NAME}` }).click();
  diag.mark("go-to-source click");
  await page.getByRole("menuitem", { name: "Xem nơi đính kèm" }).click();

  try {
    // The DM opens, not the workspace chat, and the message param is consumed.
    await expect(page).toHaveURL(new RegExp(`/${ws.orgSlug}/${ws.wsSlug}/chat\\?room=${roomId}$`), { timeout: 60_000 });
    const message = page.locator(`article#chat-msg-${messageId}`);
    await expect(message).toContainText(FILE_NAME, { timeout: 30_000 });
    await expect(message).toHaveClass(/ring-brand/, { timeout: 30_000 });
  } catch (error) {
    await diag.report();
    throw error;
  }
});

/**
 * UNI-1814 W-FE3: the ring never showed on the cloud runner while every
 * component-level variant shows it, so a failure prints what the page did:
 * each URL the main frame committed (every `?room=` / `message=` rewrite),
 * the chat room/message requests with their status (the around call that
 * the jump makes, with the body head when it fails), console errors and page
 * errors, the toasts on screen, when the row appeared and gained or lost the
 * ring (a MutationObserver installed before the click, which survives the
 * client navigation into Chat), an aria snapshot and a screenshot.
 */
function recordJumpDiagnostics(page: Page, messageId: string) {
  const started = Date.now();
  const lines: string[] = [];
  const log = (line: string) => lines.push(`+${String(Date.now() - started).padStart(6)}ms ${line}`);
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) log(`url ${frame.url()}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") log(`console.${msg.type()} ${msg.text().slice(0, 300)}`);
  });
  page.on("pageerror", (err) => log(`pageerror ${err.message.slice(0, 300)}`));
  page.on("requestfailed", (req) => {
    if (req.url().includes("/chat/")) log(`requestfailed ${req.method()} ${new URL(req.url()).pathname} ${req.failure()?.errorText ?? ""}`);
  });
  page.on("response", (res) => {
    const url = new URL(res.url());
    if (!url.pathname.includes("/chat/")) return;
    log(`${res.request().method()} ${url.pathname}${url.search} -> ${res.status()}`);
    if (url.pathname.includes("/messages/around/") && !res.ok()) {
      void res.text().then((body) => log(`around body ${body.slice(0, 300)}`), () => undefined);
    }
  });
  return {
    mark: (what: string) => log(`mark ${what}`),
    async watchRow() {
      await page.evaluate((id) => {
        const w = window as unknown as { __jumpDiag?: string[] };
        const out: string[] = (w.__jumpDiag = []);
        const t0 = performance.now();
        let seen = false;
        let ringed = false;
        new MutationObserver(() => {
          const row = document.getElementById(`chat-msg-${id}`);
          const ring = Boolean(row?.className.includes("ring-brand"));
          if (Boolean(row) !== seen) out.push(`${Math.round(performance.now() - t0)}ms row ${row ? "mounted" : "gone"}`);
          if (ring !== ringed) out.push(`${Math.round(performance.now() - t0)}ms ring ${ring ? "on" : "off"}`);
          seen = Boolean(row);
          ringed = ring;
        }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
      }, messageId);
    },
    async report() {
      const rowEvents = await page
        .evaluate(() => (window as unknown as { __jumpDiag?: string[] }).__jumpDiag ?? ["observer gone (full reload?)"])
        .catch((err: unknown) => [`row events unreadable: ${String(err)}`]);
      const toasts = await page
        .locator("[data-sonner-toast]")
        .allInnerTexts()
        .catch(() => []);
      const aria = await page
        .locator("main")
        .first()
        .ariaSnapshot()
        .catch((err: unknown) => `aria snapshot failed: ${String(err)}`);
      const shot = test.info().outputPath("jump-failure.png");
      await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
      console.log(
        [
          "===== [jump-diag] begin",
          ...lines,
          `row events (page clock): ${rowEvents.join(" | ") || "none"}`,
          `toasts: ${toasts.length ? toasts.map((t) => t.replace(/\s+/g, " ")).join(" | ") : "none"}`,
          `final url: ${page.url()}`,
          "aria snapshot (main, first 4000 chars):",
          aria.slice(0, 4000),
          `screenshot: ${shot}`,
          "===== [jump-diag] end",
        ].join("\n"),
      );
    },
  };
}
