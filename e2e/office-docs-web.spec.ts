import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { e2eBaseUrl } from "./api-url";
import {
  listVersions, readPinnedFrame, seedDocx, setFlag, versionBodyXml, versionEntries, type SeededDocx,
} from "./office-docs-web-fixtures";

/**
 * Docs web frame (UNI-1013): the genoffice Docs renderer served from
 * /office-frame/docs/<version>/ and opened for a DOCX behind `office_docs_web`.
 *
 * Two groups:
 *  - "frame serving" needs only the web app with a synced bundle
 *    (`pnpm --filter @uniwork/web office-frame:sync`): headers, caching, 404s.
 *  - "open, edit, save" needs the whole lane (W5 OfficeDocsFrame, W6 endpoints):
 *    sign in -> open a DOCX -> edit in the frame -> save -> a new Documents
 *    version holds the edit -> reopening shows it.
 *
 * Run with OFFICE_DOCS_WEB_E2E=1. Evidence (traces, screenshots, the version
 * rows) lands in PLAYWRIGHT_OUTPUT_DIR (default e2e/test-results).
 */
test.describe.configure({ timeout: 180_000 });
test.skip(process.env.OFFICE_DOCS_WEB_E2E !== "1", "Set OFFICE_DOCS_WEB_E2E=1 to run the Docs web frame contract.");

const baseUrl = e2eBaseUrl;
// Read only when the suite runs: a checkout without a pin must still list the specs.
const pin = process.env.OFFICE_DOCS_WEB_E2E === "1" ? readPinnedFrame() : { version: "unpinned", entry: "index.html" };
const frameBase = `/office-frame/docs/${pin.version}`;
const FRAME_SELECTOR = 'iframe[src*="/office-frame/docs/"]';
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const EDITOR = '.ProseMirror[contenteditable="true"]';

test.describe("frame serving", () => {
  test("index.html carries the pinned CSP, same-origin framing and revalidation", async ({ request }) => {
    const response = await request.get(`${baseUrl}${frameBase}/${pin.entry}`);
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(headers["content-security-policy"]).toContain("script-src 'self'");
    expect(headers["content-security-policy"]).not.toMatch(/'unsafe-eval'/);
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
    expect(await response.text()).not.toMatch(/http-equiv=["']Content-Security-Policy/i);
  });

  test("hashed assets and fonts are immutable and match the manifest digest", async ({ request }) => {
    const manifest = (await (await request.get(`${baseUrl}${frameBase}/manifest.json`)).json()) as { files: { path: string; sha256: string }[] };
    const asset = manifest.files.find((f) => f.path.startsWith("assets/") && f.path.endsWith(".js"));
    expect(asset, "manifest lists no assets/*.js").toBeTruthy();
    const response = await request.get(`${baseUrl}${frameBase}/${asset!.path}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(createHash("sha256").update(await response.body()).digest("hex")).toBe(asset!.sha256);
    const font = manifest.files.find((f) => f.path.startsWith("fonts/"));
    if (font) expect((await request.get(`${baseUrl}${frameBase}/${font.path}`)).headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  test("an unpinned version is a 404 that still carries the locked-down policy", async ({ request }) => {
    const response = await request.get(`${baseUrl}/office-frame/docs/9.9.9-unpinned/index.html`);
    expect(response.status()).toBe(404);
    expect(response.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  });

  test("the frame boots under its own CSP without a single violation", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
    page.on("pageerror", (e) => violations.push(`pageerror: ${e.message}`));
    await page.goto(`${baseUrl}${frameBase}/${pin.entry}`);
    await expect(page.locator("#root")).not.toBeEmpty({ timeout: 30_000 });
    expect(violations).toEqual([]);
  });
});

async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

test.describe("open, edit, save", () => {
  let seeded: SeededDocx;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ baseURL: baseUrl });
    try {
      seeded = await seedDocx(await context.newPage(), baseUrl, `docs-web-${Date.now().toString(36)}`);
    } finally {
      await context.close();
    }
    await setFlag("office_engine", seeded.organizationId, true);
    await setFlag("office_docs_web", seeded.organizationId, true);
  });

  test.afterAll(async () => {
    // Leave the database as the suite found it: the flag defaults off.
    if (seeded) await setFlag("office_docs_web", seeded.organizationId, false);
  });

  test("a DOCX opens in the frame, an edit is saved as a new version and survives a reopen", async ({ page, request }) => {
    const marker = `uw-docs-web-${Date.now().toString(36)}`;
    const before = await listVersions(request, seeded.account.token, seeded.documentId);
    await signInAs(page, seeded.account.email);
    await page.goto(seeded.documentUrl);

    const frame = page.locator(FRAME_SELECTOR);
    await expect(frame).toBeVisible({ timeout: 60_000 });
    expect(await frame.getAttribute("src")).toContain(`${frameBase}/`);
    const editor = page.frameLocator(FRAME_SELECTOR).locator(EDITOR).first();
    await expect(editor).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: test.info().outputPath("01-opened-in-frame.png") });

    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(` ${marker}`);
    await expect(editor).toContainText(marker);
    await page.keyboard.press("Control+s");

    // The server is the source of truth: a new version exists and its bytes hold the edit.
    await expect.poll(async () => (await listVersions(request, seeded.account.token, seeded.documentId)).length, { timeout: 60_000, intervals: [1_000] })
      .toBeGreaterThan(before.length);
    const after = await listVersions(request, seeded.account.token, seeded.documentId);
    const newest = after.reduce((a, b) => (b.version > a.version ? b : a));
    expect(await versionBodyXml(request, seeded.account.token, seeded.documentId, newest.version)).toContain(marker);
    test.info().attach("versions.json", { body: JSON.stringify({ before, after }, null, 2), contentType: "application/json" });
    await page.screenshot({ path: test.info().outputPath("02-saved.png") });

    // Reopen from scratch: the edit comes back from the stored version.
    await page.goto("about:blank");
    await page.goto(seeded.documentUrl);
    const reopened = page.frameLocator(FRAME_SELECTOR).locator(EDITOR).first();
    await expect(reopened).toBeVisible({ timeout: 60_000 });
    await expect(reopened).toContainText(marker, { timeout: 30_000 });
    await page.screenshot({ path: test.info().outputPath("03-reopened.png") });
  });

  test("Save as makes a copy, the page follows it and the frame keeps editing the copy", async ({ page, request }) => {
    const marker = `uw-docs-web-copy-${Date.now().toString(36)}`;
    const token = seeded.account.token;
    const originalBefore = await listVersions(request, token, seeded.documentId);
    await signInAs(page, seeded.account.email);
    await page.goto(seeded.documentUrl);
    const editor = page.frameLocator(FRAME_SELECTOR).locator(EDITOR).first();
    await expect(editor).toBeVisible({ timeout: 60_000 });
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(` ${marker}`);
    await page.frameLocator(FRAME_SELECTOR).getByText("Tệp", { exact: true }).first().click();
    await page.frameLocator(FRAME_SELECTOR).getByText("Lưu thành…").first().click();

    // The page follows the copy: same workspace, another document id.
    await expect(page).not.toHaveURL(seeded.documentUrl, { timeout: 60_000 });
    const copyId = page.url().split("/documents/")[1]!.split(/[?#]/)[0]!;
    expect(copyId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(copyId).not.toBe(seeded.documentId);
    await page.screenshot({ path: test.info().outputPath("04-save-as-copy.png") });

    // The copy holds the edit; the original gained no version.
    const copyVersions = await listVersions(request, token, copyId);
    expect(copyVersions.length).toBeGreaterThan(0);
    expect(await versionBodyXml(request, token, copyId, copyVersions.reduce((a, b) => (b.version > a.version ? b : a)).version)).toContain(marker);
    expect((await listVersions(request, token, seeded.documentId)).length).toBe(originalBefore.length);

    // The frame edits the copy: it shows the copy's content and the next save lands on the copy, never the original.
    // (The page may mount a fresh frame for the new document id; the session-level rebind is covered in packages/views.)
    await expect(editor).toContainText(marker, { timeout: 60_000 });
    const second = `${marker}-again`;
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(` ${second}`);
    await page.keyboard.press("Control+s");
    await expect.poll(async () => (await listVersions(request, token, copyId)).length, { timeout: 60_000, intervals: [1_000] }).toBeGreaterThan(copyVersions.length);
    const latest = (await listVersions(request, token, copyId)).reduce((a, b) => (b.version > a.version ? b : a));
    expect(await versionBodyXml(request, token, copyId, latest.version)).toContain(second);
    expect((await listVersions(request, token, seeded.documentId)).length).toBe(originalBefore.length);
  });

  test("an inserted image passes the frame CSP and is stored in the docx", async ({ page, request }) => {
    // The frame embeds images as data: URIs (it never calls api.images.upload), which `img-src 'self' data: blob:` allows.
    const violations: string[] = [];
    page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
    const token = seeded.account.token;
    const before = await listVersions(request, token, seeded.documentId);
    await signInAs(page, seeded.account.email);
    await page.goto(seeded.documentUrl);
    const frame = page.frameLocator(FRAME_SELECTOR);
    await expect(frame.locator(EDITOR).first()).toBeVisible({ timeout: 60_000 });

    await frame.getByText("Chèn", { exact: true }).first().click();
    const chooser = page.waitForEvent("filechooser", { timeout: 15_000 });
    await frame.getByText("Hình ảnh", { exact: true }).first().click();
    await (await chooser).setFiles({ name: "dot.png", mimeType: "image/png", buffer: PNG_1X1 });
    const image = frame.locator(".ProseMirror img").first();
    await expect(image).toBeVisible({ timeout: 30_000 });
    expect(await image.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: test.info().outputPath("05-image-inserted.png") });

    await frame.locator(EDITOR).first().click();
    await page.keyboard.press("Control+s");
    await expect.poll(async () => (await listVersions(request, token, seeded.documentId)).length, { timeout: 60_000, intervals: [1_000] }).toBeGreaterThan(before.length);
    const newest = (await listVersions(request, token, seeded.documentId)).reduce((a, b) => (b.version > a.version ? b : a));
    expect((await versionEntries(request, token, seeded.documentId, newest.version)).some((name) => name.startsWith("word/media/"))).toBe(true);
    expect(violations).toEqual([]);
  });

  test("PDF export: a real PDF when the engine renders, otherwise the in-frame print fallback", async ({ page }) => {
    await signInAs(page, seeded.account.email);
    await page.goto(seeded.documentUrl);
    const frame = page.frameLocator(FRAME_SELECTOR);
    await expect(frame.locator(EDITOR).first()).toBeVisible({ timeout: 60_000 });
    // The web build has no menu entry for PDF export; the renderer exposes the action as window.__exportPdf.
    // Printing is stubbed (a headless run has no print dialog) and settles like the real one, on afterprint.
    await frame.locator("body").evaluate(() => {
      const w = window as unknown as { __printed?: number };
      w.__printed = 0;
      window.print = () => { w.__printed = (w.__printed ?? 0) + 1; setTimeout(() => window.dispatchEvent(new Event("afterprint")), 50); };
    });
    const answered = page.waitForResponse((r) => /\/office-frame\/documents\/[^/]+\/export\/pdf$/.test(r.url()) && r.request().method() === "POST", { timeout: 60_000 });
    await frame.locator("body").evaluate(() => (window as unknown as { __exportPdf: () => Promise<boolean> }).__exportPdf());
    const response = await answered;
    const printed = await frame.locator("body").evaluate(() => (window as unknown as { __printed?: number }).__printed ?? 0);
    if (response.status() === 200) {
      expect((await response.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
      test.info().annotations.push({ type: "export", description: "real PDF from the office engine" });
    } else {
      // No engine or renderer on this deployment: 501 unsupported_operation or 503 office_not_configured.
      expect([501, 503]).toContain(response.status());
      expect(printed).toBe(1);
      test.info().annotations.push({ type: "export", description: `HTTP ${response.status()} -> in-frame print fallback` });
    }
  });

  test("with the flag off the G3 editor stays the default and no frame mounts", async ({ page }) => {
    await setFlag("office_docs_web", seeded.organizationId, false);
    try {
      await signInAs(page, seeded.account.email);
      await page.goto(seeded.documentUrl);
      await expect(page.locator("[data-office-editor-host]")).toBeVisible({ timeout: 60_000 });
      await expect(page.locator(FRAME_SELECTOR)).toHaveCount(0);
    } finally {
      await setFlag("office_docs_web", seeded.organizationId, true);
    }
  });
});
