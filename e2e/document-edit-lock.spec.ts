import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { e2eApiUrl } from "./api-url";
import { VI_LOCALE_STATE } from "./locale-state";
import {
  createRecordingAccount,
  joinWorkspaceAsMember,
  loginViaUi,
  registerApiUser,
  type ApiUser,
  type RecordingAccount,
} from "./meeting-recording-fixture";

/**
 * UNI-1645 (addendum 2026-10-15 §12 card (b), AC EL-A01..A03): one person
 * edits a document at a time, on the real stack with two (or three) browser
 * contexts. The organization owner is the manager; A and B are workspace
 * members with `edit` on a workspace-visible page.
 *
 *   1. A edits -> B reads only, names A and the time; B's save over the API -> 423.
 *   2. A closes the editor -> B gets "Sửa ngay" without a reload and types.
 *   3. A's tab dies without releasing -> after the TTL B can edit.
 *   4. The manager takes over -> A turns read-only and downloads the unsaved text.
 *   5. B requests -> A saves and hands over -> B edits.
 *   6. Same user, two tabs -> the second offers "Sửa ở đây" and takes the lock.
 *
 * Needs: documents flag ON (`FF_DOCUMENTS=true`, globalSetup), Postgres + Redis
 * up, this worktree's migrations applied, web app on E2E_BASE_URL built against
 * NEXT_PUBLIC_API_URL. Step 3 waits for the lock to expire, so it runs only
 * when the API server was started with a short TTL; with the defaults (2m TTL,
 * 30s sweep) it is skipped and says why. The server env for the full run:
 *
 *   DOCUMENT_EDIT_LOCK_TTL=20s
 *   DOCUMENT_EDIT_LOCK_HEARTBEAT=5s
 *   DOCUMENT_EDIT_LOCK_SWEEP_INTERVAL=5s
 *
 * (HEARTBEAT must stay at most half the TTL or the server refuses to start.)
 * The short heartbeat also keeps step 6 quick: the first tab learns that the
 * lock moved at its next heartbeat.
 */
test.describe.configure({ timeout: 360_000 });

const api = e2eApiUrl;
const stamp = Date.now();
/** The longest TTL step 3 waits out; the default 2m is skipped, not waited. */
const SHORT_TTL_MAX_MS = 30_000;
/** The heartbeat the server answers with the defaults (step 6 waits one of them). */
const DEFAULT_HEARTBEAT_MS = 30_000;

let owner: RecordingAccount;
let memberA: ApiUser;
let memberB: ApiUser;
// registerApiUser / createRecordingAccount use the tag as the display name.
const ownerName = `lock-mgr-${stamp}`;
const nameA = `lock-a-${stamp}`;
const nameB = `lock-b-${stamp}`;

const opened: BrowserContext[] = [];

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function pageContent(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    owner = await createRecordingAccount(page, api, ownerName);
    memberA = await registerApiUser(page, api, nameA);
    await joinWorkspaceAsMember(page, api, owner.token, owner.wsId, memberA);
    memberB = await registerApiUser(page, api, nameB);
    await joinWorkspaceAsMember(page, api, owner.token, owner.wsId, memberB);
  } finally {
    await page.close();
  }
});

test.afterEach(async () => {
  for (const ctx of opened.splice(0)) await ctx.close().catch(() => undefined);
});

/** A workspace-visible page every member may edit; returns its id and app path. */
async function createLockPage(page: Page, title: string, text: string): Promise<{ id: string; path: string }> {
  const created = await page.request.post(`${api}/api/v1/workspaces/${owner.wsId}/documents`, {
    headers: authHeader(owner.token),
    data: { kind: "page", title, visibility: "workspace", content: pageContent(text) },
  });
  expect(created.ok(), `create page: HTTP ${created.status()} ${await created.text()}`).toBeTruthy();
  const id = ((await created.json()) as { document: { id: string } }).document.id;
  return { id, path: `/${owner.orgSlug}/${owner.wsSlug}/documents/${id}` };
}

/** A fresh browser (own cookies, own session) signed in as `email`. */
async function signedIn(browser: Browser, email: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ locale: "vi-VN", storageState: VI_LOCALE_STATE });
  opened.push(ctx);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginViaUi(page, email);
  return { ctx, page };
}

function surface(page: Page) {
  return page.getByRole("textbox", { name: "Nội dung tài liệu" });
}

function lockBanner(page: Page) {
  return page.getByTestId("edit-lock-banner");
}

/** The editor accepts input: this tab holds the edit lock. */
async function expectEditable(page: Page, timeout = 60_000) {
  await expect(surface(page)).toHaveAttribute("contenteditable", "true", { timeout });
}

async function expectReadOnly(page: Page, timeout = 60_000) {
  await expect(surface(page)).toHaveAttribute("contenteditable", "false", { timeout });
}

async function typeAtEnd(page: Page, text: string) {
  await surface(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
}

async function expectSaved(page: Page) {
  await expect(page.getByRole("status", { name: /^Đã lưu/ })).toBeVisible({ timeout: 30_000 });
}

/** Marks the window; the mark survives anything but a reload or a navigation. */
async function markNoReload(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __editLockNoReload?: boolean }).__editLockNoReload = true;
  });
}

async function expectNotReloaded(page: Page) {
  const kept = await page.evaluate(() => (window as unknown as { __editLockNoReload?: boolean }).__editLockNoReload === true);
  expect(kept, "the page reloaded").toBe(true);
}

test("A edits: B reads only with A's name and time, and B's API save answers 423 document_locked", async ({ browser }) => {
  const a = await signedIn(browser, memberA.email);
  const doc = await createLockPage(a.page, `Khóa sửa 1 ${stamp}`, "Bản đầu của bước một");
  await a.page.goto(doc.path);
  await expectEditable(a.page);

  const b = await signedIn(browser, memberB.email);
  await b.page.goto(doc.path);
  await expect(surface(b.page)).toContainText("Bản đầu của bước một", { timeout: 60_000 });
  await expectReadOnly(b.page);
  const banner = lockBanner(b.page);
  await expect(banner).toHaveAttribute("data-state", "other", { timeout: 30_000 });
  await expect(banner).toContainText(new RegExp(`${nameA} đang sửa từ \\d{1,2}:\\d{2}\\. Bạn đang xem ở chế độ chỉ đọc\\.`));
  await expect(banner.getByRole("button", { name: "Yêu cầu quyền sửa" })).toBeVisible();

  // B's own write over the API, at the right base and without a lock id: refused before the revision check.
  const current = await b.page.request.get(`${api}/api/v1/documents/${doc.id}`, { headers: authHeader(memberB.token) });
  expect(current.ok(), `read page: HTTP ${current.status()}`).toBeTruthy();
  const revision = ((await current.json()) as { document: { revision: string } }).document.revision;
  const refused = await b.page.request.patch(`${api}/api/v1/documents/${doc.id}`, {
    headers: authHeader(memberB.token),
    data: { revision, content: pageContent("B ghi đè") },
  });
  expect(refused.status()).toBe(423);
  const body = (await refused.json()) as { error: { code: string; fields?: Record<string, unknown> } };
  expect(body.error.code).toBe("document_locked");
  expect(body.error.fields?.holder_name).toBe(nameA);
  expect(body.error.fields?.held_by_me).toBe(false);
  expect(body.error.fields?.current_revision).toBe(revision);
  expect(body.error.fields).not.toHaveProperty("lock_id");
});

test("A closes the editor: B sees Edit now without a reload and can type", async ({ browser }) => {
  const a = await signedIn(browser, memberA.email);
  const doc = await createLockPage(a.page, `Khóa sửa 2 ${stamp}`, "Bản đầu của bước hai");
  await a.page.goto(doc.path);
  await expectEditable(a.page);

  const b = await signedIn(browser, memberB.email);
  await b.page.goto(doc.path);
  await expectReadOnly(b.page);
  await expect(lockBanner(b.page)).toHaveAttribute("data-state", "other", { timeout: 30_000 });
  await markNoReload(b.page);

  // Leaving the document unmounts A's editor, which releases the lock.
  await a.page.goto(`/${owner.orgSlug}/${owner.wsSlug}/documents`);

  const banner = lockBanner(b.page);
  await expect(banner).toHaveAttribute("data-state", "unheld", { timeout: 30_000 });
  await expect(banner).toContainText("Không còn ai sửa tài liệu này.");
  await banner.getByRole("button", { name: "Sửa ngay" }).click();
  await expectEditable(b.page, 30_000);
  await expectNotReloaded(b.page);
  await typeAtEnd(b.page, " B sửa tiếp");
  await expectSaved(b.page);
  await expect(surface(b.page)).toContainText("B sửa tiếp");
});

test("A's tab dies without releasing: after the TTL B can edit", async ({ browser }) => {
  const a = await signedIn(browser, memberA.email);
  const doc = await createLockPage(a.page, `Khóa sửa 3 ${stamp}`, "Bản đầu của bước ba");
  const acquired = a.page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/v1/documents/${doc.id}/edit-lock`,
  );
  await a.page.goto(doc.path);
  const lock = (await (await acquired).json()) as { ttl_ms: number; heartbeat_interval_ms: number };
  await expectEditable(a.page);
  test.skip(
    lock.ttl_ms > SHORT_TTL_MAX_MS,
    `the API runs DOCUMENT_EDIT_LOCK_TTL=${lock.ttl_ms}ms; start it with DOCUMENT_EDIT_LOCK_TTL=20s, ` +
      "DOCUMENT_EDIT_LOCK_HEARTBEAT=5s and DOCUMENT_EDIT_LOCK_SWEEP_INTERVAL=5s to run the expiry step",
  );

  const b = await signedIn(browser, memberB.email);
  await b.page.goto(doc.path);
  await expectReadOnly(b.page);
  await expect(lockBanner(b.page)).toHaveAttribute("data-state", "other", { timeout: 30_000 });
  await markNoReload(b.page);

  // The tab dies: offline first, so neither the pagehide release nor a heartbeat gets out.
  await a.ctx.setOffline(true);
  await a.ctx.close();

  const banner = lockBanner(b.page);
  await expect(banner).toHaveAttribute("data-state", "unheld", { timeout: lock.ttl_ms + 60_000 });
  await banner.getByRole("button", { name: "Sửa ngay" }).click();
  await expectEditable(b.page, 30_000);
  await expectNotReloaded(b.page);
  await typeAtEnd(b.page, " B sau khi hết hạn");
  await expectSaved(b.page);
});

test("a manager takes over: A turns read-only and downloads the unsaved text", async ({ browser }) => {
  const title = `Khóa sửa 4 ${stamp}`;
  const a = await signedIn(browser, memberA.email);
  const doc = await createLockPage(a.page, title, "Bản đầu của bước bốn");
  await a.page.goto(doc.path);
  await expectEditable(a.page);
  // A's autosave never lands, so what A types stays unsaved when the lock goes.
  await a.page.route(
    (url) => url.pathname === `/api/v1/documents/${doc.id}`,
    (route) => (route.request().method() === "PATCH" ? route.abort() : route.continue()),
  );
  const unsaved = " chưa lưu của A";
  await typeAtEnd(a.page, unsaved);
  await expect(surface(a.page)).toContainText(unsaved.trim());

  const m = await signedIn(browser, owner.email);
  await m.page.goto(doc.path);
  const banner = lockBanner(m.page);
  await expect(banner).toHaveAttribute("data-state", "other", { timeout: 60_000 });
  await banner.getByRole("button", { name: "Lấy quyền sửa" }).click();
  const confirm = m.page.getByRole("alertdialog", { name: `Lấy quyền sửa từ ${nameA}?` });
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  await confirm.getByRole("button", { name: "Vẫn lấy quyền sửa" }).click();
  await expect(confirm).toBeHidden({ timeout: 30_000 });
  await expectEditable(m.page, 30_000);

  // A: read-only, the unsaved text still on screen, the lost dialog names the manager.
  const lost = a.page.getByRole("alertdialog", { name: "Bạn không còn quyền sửa" });
  await expect(lost).toBeVisible({ timeout: 60_000 });
  await expect(lost).toContainText(`${ownerName} đã lấy quyền sửa. Thay đổi chưa lưu của bạn vẫn ở đây.`);
  // The lost dialog is a modal alertdialog: the page behind it is aria-hidden,
  // so the surface is read through the hidden tree while the dialog is open.
  const behind = a.page.getByRole("textbox", { name: "Nội dung tài liệu", includeHidden: true });
  await expect(behind).toHaveAttribute("contenteditable", "false", { timeout: 30_000 });
  await expect(behind).toContainText(unsaved.trim());

  const downloading = a.page.waitForEvent("download");
  await lost.getByRole("button", { name: "Tải bản của tôi" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${title} (bản của tôi).html`);
  const file = await download.path();
  const html = await readFile(file, "utf8");
  expect(html).toMatch(/^<!doctype html>/);
  expect(html).toContain('<meta charset="utf-8">');
  expect(html).toContain(unsaved.trim());
  expect(html).toContain("Bản đầu của bước bốn");

  // The download closes the dialog: the read-only surface keeps the unsaved text in view.
  await expect(lost).toBeHidden({ timeout: 30_000 });
  await expectReadOnly(a.page, 30_000);
  await expect(surface(a.page)).toContainText(unsaved.trim());
});

test("B requests: A saves and hands over, B edits", async ({ browser }) => {
  const a = await signedIn(browser, memberA.email);
  const doc = await createLockPage(a.page, `Khóa sửa 5 ${stamp}`, "Bản đầu của bước năm");
  await a.page.goto(doc.path);
  await expectEditable(a.page);

  const b = await signedIn(browser, memberB.email);
  await b.page.goto(doc.path);
  await expectReadOnly(b.page);
  const banner = lockBanner(b.page);
  await expect(banner).toHaveAttribute("data-state", "other", { timeout: 30_000 });
  await markNoReload(b.page);
  await banner.getByRole("button", { name: "Yêu cầu quyền sửa" }).click();
  await expect(banner).toContainText(`Đã gửi yêu cầu tới ${nameA}.`, { timeout: 30_000 });
  await expect(banner.getByRole("button", { name: "Hủy yêu cầu" })).toBeVisible();

  // A types a last line, then answers the prompt: the line is saved before the handover.
  await typeAtEnd(a.page, " A trước khi nhường");
  const prompt = a.page.getByRole("region", { name: `${nameB} muốn sửa tài liệu này` });
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await prompt.getByRole("button", { name: "Lưu và nhường quyền" }).click();
  await expect(prompt).toBeHidden({ timeout: 30_000 });
  await expectReadOnly(a.page, 30_000);

  await expectEditable(b.page, 30_000);
  await expectNotReloaded(b.page);
  await expect(surface(b.page)).toContainText("A trước khi nhường", { timeout: 30_000 });
  await typeAtEnd(b.page, " B sau khi được nhường");
  await expectSaved(b.page);
});

test("same user, two tabs: the second offers Edit here and the first goes read-only", async ({ browser }) => {
  const a = await signedIn(browser, memberA.email);
  const doc = await createLockPage(a.page, `Khóa sửa 6 ${stamp}`, "Bản đầu của bước sáu");
  const acquired = a.page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === `/api/v1/documents/${doc.id}/edit-lock`,
  );
  await a.page.goto(doc.path);
  const lock = (await (await acquired).json()) as { heartbeat_interval_ms?: number };
  await expectEditable(a.page);

  const second = await a.ctx.newPage();
  await second.setViewportSize({ width: 1440, height: 900 });
  await second.goto(doc.path);
  await expectReadOnly(second);
  const banner = lockBanner(second);
  await expect(banner).toHaveAttribute("data-state", "selfElsewhere", { timeout: 30_000 });
  await expect(banner).toContainText("Bạn đang sửa tài liệu này ở cửa sổ khác.");
  await banner.getByRole("button", { name: "Sửa ở đây" }).click();
  await expectEditable(second, 30_000);

  // The first tab learns at its next heartbeat at the latest.
  const heartbeat = lock.heartbeat_interval_ms ?? DEFAULT_HEARTBEAT_MS;
  await expectReadOnly(a.page, heartbeat + 30_000);
  await expect(lockBanner(a.page)).toHaveAttribute("data-state", "selfElsewhere", { timeout: 30_000 });
  await expect(lockBanner(a.page).getByRole("button", { name: "Sửa ở đây" })).toBeVisible();

  await typeAtEnd(second, " tab hai");
  await expectSaved(second);
});
