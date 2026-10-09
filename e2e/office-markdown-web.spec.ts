import { expect, test } from "@playwright/test";
import { e2eBaseUrl } from "./api-url";
import { listVersions, seedDocument, setFlag, type SeededDocx } from "./office-docs-web-fixtures";
import { moduleFrameBase, moduleFrameHost, moduleFrameInstalled, readModulePin, signInAs, versionBytes } from "./office-module-web-fixtures";

/**
 * Markdown web frame (UNI-1014): the genoffice Markdown editor served from
 * /office-frame/markdown/<version>/ and opened for a .md behind
 * `office_markdown_web`. The first module spec; the others copy its shape.
 *
 * Runs with OFFICE_MODULES_WEB_E2E=1 against a production build that installed
 * the markdown bundle (markdown.pin.json + OFFICE_FRAME_SOURCE = a fork dist-web
 * root); without it every case skips.
 */
test.describe.configure({ timeout: 180_000 });
test.skip(process.env.OFFICE_MODULES_WEB_E2E !== "1", "Set OFFICE_MODULES_WEB_E2E=1 to run the module web frame contract.");

const baseUrl = e2eBaseUrl;
const pin = readModulePin("markdown");
const frameBase = pin ? moduleFrameBase("markdown", pin) : "/office-frame/markdown/unpinned";
const FRAME_SELECTOR = 'iframe[src*="/office-frame/markdown/"]';

test.beforeEach(async ({ request }) => {
  test.skip(!(await moduleFrameInstalled(request, baseUrl, "markdown")), "no markdown bundle is installed in this web build");
});

test("index.html is served with the module's pinned CSP and same-origin framing", async ({ request }) => {
  const response = await request.get(`${baseUrl}${frameBase}/${pin!.entry}`);
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(headers["content-security-policy"]).toContain("script-src 'self'");
  expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
  expect(headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
});

test.describe("open, edit, save", () => {
  let seeded: SeededDocx;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ baseURL: baseUrl });
    try {
      seeded = await seedDocument(await context.newPage(), baseUrl, `md-web-${Date.now().toString(36)}`, {
        name: "notes.md", mimeType: "text/markdown", buffer: Buffer.from("# Ghi chú\n\nĐoạn đầu tiên.\n"),
      });
    } finally {
      await context.close();
    }
    await setFlag("office_engine", seeded.organizationId, true);
    await setFlag("office_markdown_web", seeded.organizationId, true);
  });

  test.afterAll(async () => {
    if (seeded) await setFlag("office_markdown_web", seeded.organizationId, false);
  });

  test("a .md opens in the markdown frame and the handshake completes", async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
    await signInAs(page, seeded.account.email);
    await page.goto(seeded.documentUrl);
    const frame = page.locator(FRAME_SELECTOR);
    await expect(frame).toBeVisible({ timeout: 60_000 });
    expect(await frame.getAttribute("src")).toContain(`${frameBase}/`);
    // data-state="ready" is set only after the frame acknowledged init (module checked, token handed over).
    await expect(moduleFrameHost(page, "markdown")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
    await page.screenshot({ path: test.info().outputPath("01-opened-in-markdown-frame.png") });
    expect(violations).toEqual([]);
  });

  // PENDING (MH): save is being wired in the fork's markdown module; un-fixme once the bundle saves.
  test.fixme("an edit is saved as a new version and survives a reopen", async ({ page, request }) => {
    const marker = `uw-md-web-${Date.now().toString(36)}`;
    const before = await listVersions(request, seeded.account.token, seeded.documentId);
    await signInAs(page, seeded.account.email);
    await page.goto(seeded.documentUrl);
    await expect(moduleFrameHost(page, "markdown")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
    const editor = page.frameLocator(FRAME_SELECTOR).locator('[contenteditable="true"]').first();
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(` ${marker}`);
    await page.keyboard.press("Control+s");
    await expect.poll(async () => (await listVersions(request, seeded.account.token, seeded.documentId)).length, { timeout: 60_000, intervals: [1_000] })
      .toBeGreaterThan(before.length);
    const newest = (await listVersions(request, seeded.account.token, seeded.documentId)).reduce((a, b) => (b.version > a.version ? b : a));
    expect((await versionBytes(request, seeded.account.token, seeded.documentId, newest.version)).toString("utf8")).toContain(marker);
    await page.goto("about:blank");
    await page.goto(seeded.documentUrl);
    await expect(page.frameLocator(FRAME_SELECTOR).locator('[contenteditable="true"]').first()).toContainText(marker, { timeout: 60_000 });
  });

  test("with the flag off the G3 editor opens and no frame mounts", async ({ page }) => {
    await setFlag("office_markdown_web", seeded.organizationId, false);
    try {
      await signInAs(page, seeded.account.email);
      await page.goto(seeded.documentUrl);
      await expect(page.locator("[data-office-editor-host]").first()).toBeVisible({ timeout: 60_000 });
      await expect(page.locator(FRAME_SELECTOR)).toHaveCount(0);
    } finally {
      await setFlag("office_markdown_web", seeded.organizationId, true);
    }
  });
});
