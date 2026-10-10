import { expect, test, type FrameLocator } from "@playwright/test";
import { e2eApiUrl, e2eBaseUrl } from "./api-url";
import { listVersions, seedDocument, setFlag, type SeededDocx } from "./office-docs-web-fixtures";
import { moduleFrameHost, moduleFrameInstalled, signInAs, versionBytes } from "./office-module-web-fixtures";

/**
 * Pictures of a Markdown document in the web frame (UNI-1232): a relative
 * picture stored next to the document resolves through the open answer's
 * `assets` map, and a pasted picture uploads as a document asset (no data:
 * URI in the saved file) that resolves again after a reopen. Both load from
 * the app's own origin (the frame's CSP allows only 'self').
 *
 * OFFICE_MODULES_WEB_E2E=1 against a production build with the markdown
 * bundle installed, as office-markdown-web.spec.ts.
 */
test.describe.configure({ timeout: 180_000 });
test.skip(process.env.OFFICE_MODULES_WEB_E2E !== "1", "Set OFFICE_MODULES_WEB_E2E=1 to run the module web frame contract.");

const baseUrl = e2eBaseUrl;
const FRAME_SELECTOR = 'iframe[src*="/office-frame/markdown/"]';
// 2x2 opaque PNGs: one stored next to the document, one pasted.
const SIBLING_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGNQSDgARAwQCgAgjgUB59mTewAAAABJRU5ErkJggg==", "base64");
const PASTED_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Waits for an <img> of the editor whose source is a signed frame route and that decoded. */
async function expectLoadedFrameImage(editor: FrameLocator, alt: string): Promise<string> {
  const img = editor.locator(`img[alt="${alt}"]`);
  await expect(img).toHaveCount(1, { timeout: 60_000 });
  await expect.poll(async () => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth), { timeout: 30_000 })
    .toBeGreaterThan(0);
  const src = (await img.evaluate((el) => (el as HTMLImageElement).currentSrc)) ?? "";
  expect(new URL(src).origin, "pictures load from the app's own origin").toBe(new URL(baseUrl).origin);
  expect(new URL(src).pathname).toMatch(/^\/api\/v1\/office-frame\/documents\/[0-9A-Z]+\/(assets|linked)\/[0-9A-Z]+$/);
  return src;
}

test.describe("markdown pictures", () => {
  let seeded: SeededDocx;

  test.beforeAll(async ({ browser, request }) => {
    test.skip(!(await moduleFrameInstalled(request, baseUrl, "markdown")), "no markdown bundle is installed in this web build");
    const context = await browser.newContext({ baseURL: baseUrl });
    try {
      seeded = await seedDocument(await context.newPage(), baseUrl, `md-assets-${Date.now().toString(36)}`, {
        name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Ảnh\n\n![logo](logo.png)\n\nĐoạn cuối.\n"),
      });
      // The picture the document points at, in the same folder (the workspace root).
      const response = await context.request.post(`${e2eApiUrl}/api/v1/workspaces/${seeded.account.wsId}/documents/files`, {
        headers: { authorization: `Bearer ${seeded.account.token}`, "Idempotency-Key": `md-assets-logo-${Date.now().toString(36)}` },
        multipart: { file: { name: "logo.png", mimeType: "image/png", buffer: SIBLING_PNG } },
      });
      expect(response.ok(), `seed logo.png: HTTP ${response.status()} ${await response.text()}`).toBeTruthy();
    } finally {
      await context.close();
    }
    await setFlag("office_engine", seeded.organizationId, true);
    await setFlag("office_markdown_web", seeded.organizationId, true);
  });

  test.afterAll(async () => {
    if (seeded) await setFlag("office_markdown_web", seeded.organizationId, false);
  });

  test("a relative picture resolves, and a pasted one is stored as a document asset", async ({ page, request }) => {
    const violations: string[] = [];
    page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
    await signInAs(page, seeded.account.email);
    await page.goto(seeded.documentUrl);
    await expect(moduleFrameHost(page, "markdown")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
    const editor = page.frameLocator(FRAME_SELECTOR).locator(".doc-editor");
    await expectLoadedFrameImage(page.frameLocator(FRAME_SELECTOR), "logo");
    await page.screenshot({ path: test.info().outputPath("01-md-relative-picture.png") });

    // Paste a picture at the end of the last paragraph.
    await editor.locator("p", { hasText: "Đoạn cuối." }).click();
    await page.keyboard.press("End");
    await editor.locator(".ProseMirror").evaluate((el, b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, PASTED_PNG);
    await expectLoadedFrameImage(page.frameLocator(FRAME_SELECTOR), "pasted");

    const before = await listVersions(request, seeded.account.token, seeded.documentId);
    await page.keyboard.press("Control+s");
    await expect.poll(async () => (await listVersions(request, seeded.account.token, seeded.documentId)).length, { timeout: 60_000, intervals: [1_000] })
      .toBeGreaterThan(before.length);
    const newest = (await listVersions(request, seeded.account.token, seeded.documentId)).reduce((a, b) => (b.version > a.version ? b : a));
    const saved = (await versionBytes(request, seeded.account.token, seeded.documentId, newest.version)).toString("utf8");
    expect(saved).toContain("](logo.png)");
    expect(saved).toMatch(/!\[pasted\]\(assets\/image-[^)]+\.png\)/);
    expect(saved).not.toContain("data:image");
    expect(saved).not.toContain("/api/v1/");

    // Reopened, both resolve again from the stored references.
    await page.goto("about:blank");
    await page.goto(seeded.documentUrl);
    await expect(moduleFrameHost(page, "markdown")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
    await expectLoadedFrameImage(page.frameLocator(FRAME_SELECTOR), "logo");
    await expectLoadedFrameImage(page.frameLocator(FRAME_SELECTOR), "pasted");
    await page.screenshot({ path: test.info().outputPath("02-md-pasted-picture-reopened.png") });
    expect(violations).toEqual([]);
  });
});
