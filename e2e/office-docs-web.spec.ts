import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { e2eBaseUrl } from "./api-url";
import {
  listVersions, readPinnedFrame, seedDocx, setOrgFlag, versionBodyXml, type SeededDocx,
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
    await setOrgFlag("office_engine", seeded.organizationId, true);
    await setOrgFlag("office_docs_web", seeded.organizationId, true);
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

  test("with the flag off the G3 editor stays the default and no frame mounts", async ({ page }) => {
    await setOrgFlag("office_docs_web", seeded.organizationId, false);
    try {
      await signInAs(page, seeded.account.email);
      await page.goto(seeded.documentUrl);
      await expect(page.locator("[data-office-editor-host]")).toBeVisible({ timeout: 60_000 });
      await expect(page.locator(FRAME_SELECTOR)).toHaveCount(0);
    } finally {
      await setOrgFlag("office_docs_web", seeded.organizationId, true);
    }
  });
});
