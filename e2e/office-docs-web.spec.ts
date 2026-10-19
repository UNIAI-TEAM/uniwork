import { expect, test, type APIRequestContext, type FrameLocator, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { e2eApiUrl, e2eBaseUrl } from "./api-url";
import {
  listVersions, openSeededDocument, readPinnedFrame, releaseSeededEditLock, seedDocument, seedDocx, seedUntitledDocx, setFlag, versionBodyXml, versionEntries, type SeededDocx,
} from "./office-docs-web-fixtures";
import { expectFrameNotice, moduleFrameHost, moduleFrameInstalled } from "./office-module-web-fixtures";

/**
 * Docs web frame (UNI-1013): the genoffice Docs renderer served from
 * /office-frame/docs/<version>/ and opened for a DOCX behind `office_docs_web`.
 *
 * Three groups, chosen by what the web build under test has installed (CI has the
 * bundle from the committed source (apps/web/platform/office-frame/source.json, a public
 * release tarball), so it normally does; a build that could not download it still has to
 * say the server is not set up):
 *  - "frame serving" (bundle installed): headers, caching, 404s, CSP boot.
 *  - "open, edit, save" (bundle installed): sign in -> open a DOCX -> edit in the frame ->
 *    save -> a new Documents version holds the edit -> reopening shows it; save as, image,
 *    PDF export, flag off, and a server-refused token showing the unavailable notice.
 *  - "bundle not installed" (bundle absent): flag on by default, yet the DOCX shows the
 *    "not set up" notice with Download and no iframe is mounted.
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

/** Whether the web build under test serves the pinned bundle. */
async function frameInstalled(request: APIRequestContext): Promise<boolean> {
  try {
    return (await request.get(`${baseUrl}${frameBase}/manifest.json`)).ok();
  } catch {
    return false;
  }
}

test.describe("frame serving", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await frameInstalled(request)), "the pinned Docs bundle is not installed in this web build");
  });

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

  test.beforeAll(async ({ browser, request }) => {
    test.skip(!(await frameInstalled(request)), "the pinned Docs bundle is not installed in this web build");
    const context = await browser.newContext({ baseURL: baseUrl });
    try {
      seeded = await seedDocx(await context.newPage(), baseUrl, `docs-web-${Date.now().toString(36)}`);
    } finally {
      await context.close();
    }
    // office_docs_web defaults on (UNI-1013): the frame cases need no override of their own.
    await setFlag("office_engine", seeded.organizationId, true);
  });

  test.afterEach(async ({ request }) => {
    await releaseSeededEditLock(request, seeded);
  });

  test("a DOCX opens in the frame, an edit is saved as a new version and survives a reopen", async ({ page, request }) => {
    const marker = `uw-docs-web-${Date.now().toString(36)}`;
    const before = await listVersions(request, seeded.account.token, seeded.documentId);
    await signInAs(page, seeded.account.email);
    await openSeededDocument(page, seeded);

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
    await releaseSeededEditLock(request, seeded);
    await openSeededDocument(page, seeded);
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
    await openSeededDocument(page, seeded);
    const editor = page.frameLocator(FRAME_SELECTOR).locator(EDITOR).first();
    await expect(editor).toBeVisible({ timeout: 60_000 });
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(` ${marker}`);
    await page.frameLocator(FRAME_SELECTOR).getByText("Tệp", { exact: true }).first().click();
    await page.frameLocator(FRAME_SELECTOR).getByText("Lưu dưới dạng…").first().click();

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
    // Intended: the page mounts a fresh frame for the new document id (the document screen swaps its host while the
    // copy loads), so the copy opens clean from its stored version. The in-place rebind of a live frame is covered in
    // packages/views (office-docs-frame.test.tsx); here we prove what the user sees and what the server stored.
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

  test("the first save of a never-saved blank names it before it uploads (UNI-1847, SAVE-01)", async ({ page, request, browser }) => {
    // Seed through a throwaway context so this test's blank does not share the suite's document.
    const context = await browser.newContext({ baseURL: baseUrl });
    let blank: SeededDocx;
    try {
      blank = await seedUntitledDocx(await context.newPage(), baseUrl, `docs-web-blank-${Date.now().toString(36)}`);
    } finally {
      await context.close();
    }
    await signInAs(page, blank.account.email);
    await openSeededDocument(page, blank);

    const editor = page.frameLocator(FRAME_SELECTOR).locator(EDITOR).first();
    await expect(editor).toBeVisible({ timeout: 60_000 });
    await editor.click();
    await page.keyboard.press("Control+s");

    // The page asks for a name before any upload leaves the frame.
    const dialog = page.getByRole("dialog", { name: "Đặt tên tài liệu" });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    const input = dialog.getByLabel("Tên tài liệu");
    await expect(input).toHaveValue("untitled");
    const title = `Kế hoạch ${Date.now().toString(36)}`;
    await input.fill(title);
    await dialog.getByRole("button", { name: "Lưu" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // The title changed on the server and the save went through as a new version.
    await expect.poll(
      async () => (await listVersions(request, blank.account.token, blank.documentId)).length,
      { timeout: 60_000, intervals: [1_000] },
    ).toBeGreaterThan(0);
    const detail = await request.get(`${e2eApiUrl}/api/v1/documents/${blank.documentId}`, {
      headers: { authorization: `Bearer ${blank.account.token}` },
    });
    expect(detail.ok(), `document detail: HTTP ${detail.status()}`).toBeTruthy();
    const { document } = (await detail.json()) as { document: { title: string } };
    expect(document.title).toBe(title);

    // Named now: the next save asks nothing and stores another version.
    await editor.click();
    await page.keyboard.type(".");
    await page.keyboard.press("Control+s");
    await expect(page.getByRole("dialog", { name: "Đặt tên tài liệu" })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("05-first-save-named.png") });
  });

  test("an inserted image passes the frame CSP and is stored in the docx", async ({ page, request }) => {
    // The frame embeds images as data: URIs (it never calls api.images.upload), which `img-src 'self' data: blob:` allows.
    const violations: string[] = [];
    page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
    const token = seeded.account.token;
    const before = await listVersions(request, token, seeded.documentId);
    await signInAs(page, seeded.account.email);
    await openSeededDocument(page, seeded);
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
    await openSeededDocument(page, seeded);
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

  test("a token mint the server refuses with feature_disabled shows the unavailable notice", async ({ page }) => {
    // The page's config answer says "on" (cached up to 5 minutes) while the server has already turned the flag off.
    await page.route(/\/api\/v1\/documents\/[^/]+\/office\/frame-token$/, (route) => route.fulfill({
      status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "feature_disabled", message: "feature is disabled" } }),
    }));
    await signInAs(page, seeded.account.email);
    await openSeededDocument(page, seeded);
    await expectFrameNotice(page, "unavailable", "chưa bật mở loại tệp này trên web");
    await expect(page.locator(FRAME_SELECTOR)).toHaveCount(0);
  });

  test("an organization override turning the flag off shows the unavailable notice and no frame mounts", async ({ page }) => {
    await setFlag("office_docs_web", seeded.organizationId, false);
    try {
      await signInAs(page, seeded.account.email);
      await openSeededDocument(page, seeded);
      await expectFrameNotice(page, "unavailable", "chưa bật mở loại tệp này trên web");
      await expect(page.locator(FRAME_SELECTOR)).toHaveCount(0);
    } finally {
      await setFlag("office_docs_web", seeded.organizationId, true);
    }
  });
});

/**
 * Ctrl/Cmd+P routes one print to the document (UNI-1920): the page's handler
 * answers a press whose focus sits in the page chrome with one `host.print`
 * request; inside a Docs or HTML frame the pin's own capture-phase binding
 * runs the frame's print path instead, and the keydown never leaves the
 * iframe, so the page stays silent.
 *
 * `installPrintProbe` instruments one realm: `windowPrints` counts its
 * window.print() calls (stubbed - a headless run has no dialog and settles
 * the real path with afterprint), `hostPrints` counts host->frame `print`
 * envelopes the realm's postMessage receives, and `ctrlP` records each
 * mod+P keydown's final defaultPrevented (read in a microtask, after every
 * listener ran), so a binding that forgot preventDefault fails the case even
 * though headless Playwright would never show the browser dialog. An
 * `appendChild` wrap hands the count of the hidden srcdoc iframe the HTML
 * module prints through back to the module's probe, re-stubbing on the
 * child's `load` so the count survives a Window swap at the srcdoc
 * navigation. `REQUIRE_ALL_FRAMES` turns "bundle not installed" from a skip
 * into a failure on the lanes that install every frame.
 */
interface PrintCounts { windowPrints: number; hostPrints: number; ctrlP: boolean[] }

const REQUIRE_ALL_FRAMES = process.env.OFFICE_FRAME_REQUIRE_ALL === "1";
/** Hold after the print's own settle so a second print has room to show up. */
const PRINT_SETTLE_MS = 1500;

async function installPrintProbe(scope: Page | FrameLocator): Promise<void> {
  await scope.locator("body").evaluate(() => {
    interface Probe { windowPrints: number; hostPrints: number; ctrlP: boolean[] }
    const w = window as unknown as { __uwPrintProbe?: Probe }; // the spec's own counter bag; not on Window
    w.__uwPrintProbe = { windowPrints: 0, hostPrints: 0, ctrlP: [] };
    const probe = w.__uwPrintProbe;
    const stubPrint = (target: Window | null) => {
      if (!target) return;
      target.print = () => {
        probe.windowPrints += 1;
        target.setTimeout(() => target.dispatchEvent(new Event("afterprint")), 50);
      };
    };
    const append = Element.prototype.appendChild;
    Element.prototype.appendChild = function <T extends Node>(child: T): T {
      append.call(this, child);
      if (child instanceof HTMLIFrameElement) {
        // The HTML module prints through a hidden sandboxed srcdoc iframe: its
        // win.print() belongs to the module's count. Re-stub on every load in
        // case the srcdoc navigation swaps the Window, so the count cannot sit
        // on a discarded about:blank window.
        child.addEventListener("load", () => stubPrint(child.contentWindow));
        stubPrint(child.contentWindow);
      }
      // appendChild's result is the appended child itself.
      return child;
    };
    stubPrint(window);
    // Registered after the module's own binding; the microtask read still
    // records the final defaultPrevented no matter the listener order.
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") queueMicrotask(() => probe.ctrlP.push(e.defaultPrevented));
    }, true);
    // The DOM declares postMessage as overloads; forwarders need the rest-args shape.
    const postMessage = window.postMessage.bind(window) as unknown as (...args: unknown[]) => unknown;
    // Same signature as the native method: the wrapper forwards every form of the call.
    window.postMessage = ((message: unknown, ...rest: unknown[]) => {
      // A host.print envelope is { ns, kind: 'request', type: 'print' }: read fields via `in` guards.
      if (
        typeof message === "object" && message !== null &&
        "ns" in message && message.ns === "uniwork.office.docs" &&
        "kind" in message && message.kind === "request" &&
        "type" in message && message.type === "print"
      ) probe.hostPrints += 1;
      postMessage(message, ...rest);
    }) as typeof window.postMessage;
  });
}

async function readPrintCounts(scope: Page | FrameLocator): Promise<PrintCounts> {
  return scope.locator("body").evaluate(() => {
    const w = window as unknown as { __uwPrintProbe?: PrintCounts }; // the spec's own counter bag; not on Window
    return w.__uwPrintProbe ?? { windowPrints: 0, hostPrints: 0, ctrlP: [] };
  });
}

/**
 * Focus leaves the frame for the page chrome: the header's Save button
 * (`office.shell.save_to_cloud`, `aria-disabled` when clean so `.focus()` puts
 * keyboard focus on it without firing an action; `document-page-header`'s
 * `<textarea>` only mounts on `kind === "page"`, not on file documents).
 */
async function focusPageChrome(page: Page): Promise<void> {
  const saveButton = page.getByRole("button", { name: /^(Lưu vào UniWork|Save to UniWork)$/ });
  await expect(saveButton).toBeVisible({ timeout: 30_000 });
  await saveButton.focus();
  await expect(saveButton).toBeFocused();
  expect(
    await page.evaluate(() => document.activeElement !== null && document.activeElement.tagName !== "IFRAME"),
    "page chrome holds focus outside the iframe before pressing Ctrl+P",
  ).toBe(true);
}

test.describe("Ctrl/Cmd+P", () => {
  let docs: SeededDocx;
  let html: SeededDocx;

  test.beforeAll(async ({ browser, request }) => {
    const [docsInstalled, htmlInstalled] = await Promise.all([
      frameInstalled(request),
      moduleFrameInstalled(request, baseUrl, "html"),
    ]);
    // The cloud lane installs every frame (office-frame-sync --all): there an absent
    // bundle is a broken install, not a case to wave through (RR2-5).
    if (REQUIRE_ALL_FRAMES) {
      expect(docsInstalled, "the pinned Docs bundle is installed (OFFICE_FRAME_REQUIRE_ALL)").toBe(true);
      expect(htmlInstalled, "the pinned HTML module is installed (OFFICE_FRAME_REQUIRE_ALL)").toBe(true);
    }
    test.skip(!docsInstalled, "the pinned Docs bundle is not installed in this web build");
    const context = await browser.newContext({ baseURL: baseUrl });
    try {
      const seeding = await context.newPage();
      docs = await seedDocx(seeding, baseUrl, `docs-print-${Date.now().toString(36)}`);
      if (htmlInstalled) {
        html = await seedDocument(seeding, baseUrl, `html-print-${Date.now().toString(36)}`, {
          name: "print-page.html",
          mimeType: "text/html",
          buffer: Buffer.from("<!doctype html><html><body><h1>Print probe page</h1><p>A paragraph to print.</p></body></html>"),
        });
      }
    } finally {
      await context.close();
    }
    await setFlag("office_engine", docs.organizationId, true);
    if (html) {
      await setFlag("office_engine", html.organizationId, true);
      await setFlag("office_html_web", html.organizationId, true);
    }
  });

  test.afterEach(async ({ request }) => {
    await releaseSeededEditLock(request, docs);
    await releaseSeededEditLock(request, html);
  });

  test.afterAll(async () => {
    if (html) await setFlag("office_html_web", html.organizationId, false);
  });

  test("Docs: Ctrl+P inside the frame runs the frame's own print, never host.print", async ({ page }) => {
    await signInAs(page, docs.account.email);
    await openSeededDocument(page, docs);
    // The docs wrapper uses the same host attributes; moduleFrameHost's module union excludes "docs".
    await expect(page.locator('[data-office-docs-frame][data-office-module="docs"]')).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
    const frame = page.frameLocator(FRAME_SELECTOR);
    await installPrintProbe(frame);
    await installPrintProbe(page);
    // Focus in the frame: the press belongs to the frame's own binding. Its 'print'
    // menu command opens the app's print dialog; confirming it is the one print.
    await frame.locator(EDITOR).first().click();
    await page.keyboard.press("Control+p");
    const dialog = frame.locator(".modal.print-dialog");
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await readPrintCounts(frame)).windowPrints).toBe(0);
    await dialog.locator(".modal-actions button.primary").click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await readPrintCounts(frame)).windowPrints).toBe(1);
    // The frame's accelerator must have claimed the press: a missing preventDefault
    // leaves the browser's own print dialog on top of the module print in a real browser.
    await expect.poll(async () => (await readPrintCounts(frame)).ctrlP).toEqual([true]);
    await page.waitForTimeout(PRINT_SETTLE_MS);
    expect(await readPrintCounts(frame)).toEqual({ windowPrints: 1, hostPrints: 0, ctrlP: [true] });
    expect(await readPrintCounts(page)).toEqual({ windowPrints: 0, hostPrints: 0, ctrlP: [] });
  });

  test("Docs: Ctrl+P with the focus in the page sends exactly one host.print request", async ({ page }) => {
    await signInAs(page, docs.account.email);
    await openSeededDocument(page, docs);
    await expect(page.locator('[data-office-docs-frame][data-office-module="docs"]')).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
    const frame = page.frameLocator(FRAME_SELECTOR);
    await installPrintProbe(frame);
    await installPrintProbe(page);
    // Focus in the page chrome: the page's Ctrl+P handler sends one `host.print`;
    // the frame answers it with its print path (the same job's window.print).
    await focusPageChrome(page);
    await page.keyboard.press("Control+p");
    await expect.poll(async () => (await readPrintCounts(frame)).hostPrints).toBe(1);
    await expect.poll(async () => (await readPrintCounts(frame)).windowPrints).toBe(1);
    // The page's handler claims the press with preventDefault before it sends host.print.
    await expect.poll(async () => (await readPrintCounts(page)).ctrlP).toEqual([true]);
    await page.waitForTimeout(PRINT_SETTLE_MS);
    expect(await readPrintCounts(frame)).toEqual({ windowPrints: 1, hostPrints: 1, ctrlP: [] });
    expect(await readPrintCounts(page)).toEqual({ windowPrints: 0, hostPrints: 0, ctrlP: [true] });
  });

  test("HTML: Ctrl+P inside the frame runs the frame's print, never host.print", async ({ page }) => {
    test.skip(!html, "the pinned HTML module is not installed in this web build");
    await signInAs(page, html.account.email);
    await openSeededDocument(page, html);
    await expect(moduleFrameHost(page, "html")).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
    const frame = page.frameLocator('iframe[src*="/office-frame/html/"]');
    await installPrintProbe(frame);
    await installPrintProbe(page);
    // Ribbon view tabs have onMouseDown preventDefault (Ribbon.tsx:634) so a tab
    // click does not move focus out of the nested preview.html iframe. Switch to
    // the Source tab and click `.cm-content` so focus sits in the HTML module's
    // own document where `installPrintAccelerator` listens on `window`.
    await frame.getByRole("tab").nth(2).click();
    await frame.locator(".cm-content").click();
    expect(
      await frame.locator("body").evaluate(() => document.activeElement !== null && document.activeElement.tagName !== "IFRAME"),
      "HTML module document holds focus outside preview.html before pressing Ctrl+P",
    ).toBe(true);
    await page.keyboard.press("Control+p");
    await expect.poll(async () => (await readPrintCounts(frame)).windowPrints).toBe(1);
    // The frame's accelerator must have claimed the press: a missing preventDefault
    // leaves the browser's own print dialog on top of the module print in a real browser.
    await expect.poll(async () => (await readPrintCounts(frame)).ctrlP).toEqual([true]);
    await page.waitForTimeout(PRINT_SETTLE_MS);
    expect(await readPrintCounts(frame)).toEqual({ windowPrints: 1, hostPrints: 0, ctrlP: [true] });
    expect(await readPrintCounts(page)).toEqual({ windowPrints: 0, hostPrints: 0, ctrlP: [] });
  });

  test("HTML: Ctrl+P with the focus in the page sends exactly one host.print request", async ({ page }) => {
    test.skip(!html, "the pinned HTML module is not installed in this web build");
    await signInAs(page, html.account.email);
    await openSeededDocument(page, html);
    await expect(moduleFrameHost(page, "html")).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
    const frame = page.frameLocator('iframe[src*="/office-frame/html/"]');
    await installPrintProbe(frame);
    await installPrintProbe(page);
    await focusPageChrome(page);
    await page.keyboard.press("Control+p");
    await expect.poll(async () => (await readPrintCounts(frame)).hostPrints).toBe(1);
    await expect.poll(async () => (await readPrintCounts(frame)).windowPrints).toBe(1);
    // The page's handler claims the press with preventDefault before it sends host.print.
    await expect.poll(async () => (await readPrintCounts(page)).ctrlP).toEqual([true]);
    await page.waitForTimeout(PRINT_SETTLE_MS);
    expect(await readPrintCounts(frame)).toEqual({ windowPrints: 1, hostPrints: 1, ctrlP: [] });
    expect(await readPrintCounts(page)).toEqual({ windowPrints: 0, hostPrints: 0, ctrlP: [true] });
  });
});

test.describe("bundle not installed", () => {
  test("a flag-on organization sees the not-set-up notice and no iframe is mounted", async ({ page, browser, request }) => {
    test.skip(await frameInstalled(request), "the pinned Docs bundle is installed in this web build");
    const context = await browser.newContext({ baseURL: baseUrl });
    let seeded: SeededDocx;
    try {
      seeded = await seedDocx(await context.newPage(), baseUrl, `docs-web-absent-${Date.now().toString(36)}`);
    } finally {
      await context.close();
    }
    // The flag is on by default; no override is written.
    await setFlag("office_engine", seeded.organizationId, true);
    await signInAs(page, seeded.account.email);
    await page.goto(seeded.documentUrl);
    await expectFrameNotice(page, "unavailable", "chưa được thiết lập để mở tài liệu trên web");
    await expect(page.locator(FRAME_SELECTOR)).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("06-bundle-not-installed.png") });
  });
});
