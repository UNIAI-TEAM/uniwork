import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";
import { e2eBaseUrl } from "./api-url";
import { listVersions, seedDocument, setFlag, type SeededDocx } from "./office-docs-web-fixtures";
import {
  moduleFrameBase, moduleFrameHost, moduleFrameInstalled, readModulePin, signInAs, versionBytes, type FrameModule, type ModulePin,
} from "./office-module-web-fixtures";

/**
 * One document per module through the real host (UNI-1014/1015/1016): each
 * module's pinned bundle is served from /office-frame/<module>/<version>/,
 * its frame completes the handshake for a stored file of its format, and the
 * modules whose bundle saves (markdown, html, sheets) save one edit that
 * lands as a new stored version. pdf and slides are open-only here: their
 * edit round trips (annotate/ink, slide edit) are the fork's own e2e.
 *
 * OFFICE_MODULES_WEB_E2E=1, against a production build that installed every
 * pinned module (OFFICE_FRAME_SOURCE = a tarball or dist-web root holding all
 * of them); a module that is not installed in the build under test skips.
 * Docs and markdown keep their own deeper specs (office-docs-web.spec.ts,
 * office-markdown-web.spec.ts).
 */
test.describe.configure({ timeout: 240_000 });
test.skip(process.env.OFFICE_MODULES_WEB_E2E !== "1", "Set OFFICE_MODULES_WEB_E2E=1 to run the module web frame contract.");

const baseUrl = e2eBaseUrl;
const repoRoot = process.cwd().toLowerCase().endsWith("e2e") ? resolve(process.cwd(), "..") : process.cwd();
const fixture = (path: string): Buffer => readFileSync(resolve(repoRoot, "docs/office/g0/fixtures/files", path));

const MIME = {
  html: "text/html",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

const HTML_PAGE = [
  "<!doctype html>",
  '<html lang="en"><head><meta charset="utf-8"><title>Module e2e</title></head>',
  "<body><h1>Module e2e page</h1><p>A paragraph with text to edit.</p></body></html>",
  "",
].join("\n");

interface ModuleCase {
  module: Exclude<FrameModule, "markdown">;
  file: { name: string; mimeType: string; buffer: Buffer };
  flag: string;
  /** Types one edit into the open frame and saves it; absent = open-only module. */
  edit?: (page: Page, marker: string) => Promise<void>;
  /** The stored version's bytes show the edit. */
  hasEdit?: (bytes: Buffer, marker: string) => Promise<boolean>;
}

const frameOf = (page: Page, module: FrameModule) => page.frameLocator(`iframe[src*="/office-frame/${module}/"]`);

const CASES: ModuleCase[] = [
  {
    module: "pdf",
    flag: "office_pdf_web",
    file: { name: "text.pdf", mimeType: MIME.pdf, buffer: fixture("pdf/pdf-text-editable.pdf") },
  },
  {
    module: "html",
    flag: "office_html_web",
    file: { name: "page.html", mimeType: MIME.html, buffer: Buffer.from(HTML_PAGE) },
    edit: async (page, marker) => {
      const frame = frameOf(page, "html");
      // The page opens in Preview; the source pane is the Source tab (English labels, see the locale cookie below).
      await frame.getByRole("tab", { name: /^Source$/ }).click();
      await frame.locator(".cm-line", { hasText: "A paragraph with" }).click();
      await page.keyboard.press("End");
      await page.keyboard.type(` ${marker}`);
      await page.keyboard.press("Control+s");
    },
    hasEdit: async (bytes, marker) => bytes.toString("utf8").includes(marker),
  },
  {
    module: "slides",
    flag: "office_slides_web",
    file: { name: "deck.pptx", mimeType: MIME.pptx, buffer: fixture("slides/pptx-standard-business.pptx") },
  },
  {
    module: "sheets",
    flag: "office_sheets_web",
    file: { name: "book.xlsx", mimeType: MIME.xlsx, buffer: fixture("sheets/xlsx-compatibility-basic.xlsx") },
    edit: async (page, marker) => {
      const frame = frameOf(page, "sheets");
      await frame.locator('canvas[id^="univer-sheet-main-canvas"]').first().click({ position: { x: 300, y: 200 } });
      const nameBox = frame.locator('[data-u-comp="defined-name"] input');
      await nameBox.click();
      await nameBox.fill("A1");
      await nameBox.press("Enter");
      await page.waitForTimeout(500);
      await page.keyboard.type(marker.replace(/\D/g, ""));
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
      await page.keyboard.press("Control+s");
    },
    hasEdit: async (bytes, marker) => {
      const sheet = await (await JSZip.loadAsync(bytes)).file("xl/worksheets/sheet1.xml")?.async("string");
      return (sheet ?? "").includes(`<v>${marker.replace(/\D/g, "")}</v>`);
    },
  },
];

/**
 * Serving contract of every pinned bundle, docs and markdown included: index.html carries
 * exactly the CSP its pin recorded and same-origin framing; the html module's preview.html
 * carries the sandboxed policy of its own (opaque origin, no 'self') and never the frame's.
 */
test.describe("served headers", () => {
  for (const module of ["pdf", "html", "slides", "sheets"] as const) {
    test(`${module}: index.html is served with the pinned policy`, async ({ request }) => {
      test.skip(!(await moduleFrameInstalled(request, baseUrl, module)), `no ${module} bundle is installed in this web build`);
      const pin = readModulePin(module)! as ModulePin & { headers: Record<string, string>; documents?: { path: string; value: string }[] };
      const response = await request.get(`${baseUrl}${moduleFrameBase(module, pin)}/${pin.entry}`);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-security-policy"]).toBe(pin.headers["Content-Security-Policy"]);
      expect(response.headers()["x-frame-options"]).toBe("SAMEORIGIN");
      expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    });
  }

  test("html: preview.html is served with its own sandboxed policy, not the frame's", async ({ request }) => {
    test.skip(!(await moduleFrameInstalled(request, baseUrl, "html")), "no html bundle is installed in this web build");
    const pin = readModulePin("html")! as ModulePin & { headers: Record<string, string>; documents: { path: string; value: string }[] };
    const response = await request.get(`${baseUrl}${moduleFrameBase("html", pin)}/preview.html`);
    expect(response.status()).toBe(200);
    const csp = response.headers()["content-security-policy"];
    expect(csp).toBe(pin.documents[0]!.value);
    expect(csp).toContain("sandbox allow-scripts allow-forms allow-popups allow-modals");
    expect(csp).not.toContain("allow-same-origin");
    expect(csp.replace("frame-ancestors 'self'", "")).not.toContain("'self'"); // only the framing rule names the host
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toBe(pin.headers["Content-Security-Policy"]);
    expect(response.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  });
});

for (const c of CASES) {
  test.describe(`${c.module} module`, () => {
    const pin = readModulePin(c.module);
    let seeded: SeededDocx;

    test.beforeAll(async ({ browser, request }) => {
      test.skip(!(await moduleFrameInstalled(request, baseUrl, c.module)), `no ${c.module} bundle is installed in this web build`);
      const context = await browser.newContext({ baseURL: baseUrl });
      try {
        seeded = await seedDocument(await context.newPage(), baseUrl, `${c.module}-web-${Date.now().toString(36)}`, c.file);
      } finally {
        await context.close();
      }
      await setFlag("office_engine", seeded.organizationId, true);
      await setFlag(c.flag, seeded.organizationId, true);
    });

    test.afterAll(async () => {
      if (seeded) await setFlag(c.flag, seeded.organizationId, false);
    });

    test(`a ${c.file.name} opens in the ${c.module} frame and the handshake completes`, async ({ page }) => {
      const violations: string[] = [];
      page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
      await signInAs(page, seeded.account.email);
      await page.goto(seeded.documentUrl);
      const frame = page.locator(`iframe[src*="/office-frame/${c.module}/"]`);
      await expect(frame).toBeVisible({ timeout: 60_000 });
      expect(await frame.getAttribute("src")).toContain(`${moduleFrameBase(c.module, pin!)}/`);
      await expect(moduleFrameHost(page, c.module)).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
      // The G3 host is not mounted next to it.
      await expect(page.locator("[data-office-editor-host]").first()).toBeHidden();
      await page.screenshot({ path: test.info().outputPath(`01-${c.module}-opened.png`) });
      expect(violations).toEqual([]);
    });

    if (c.edit) {
      test(`an edit in the ${c.module} frame is saved as a new version`, async ({ page, context, request }) => {
        // The frame follows the app's locale; the specs drive its English labels.
        await context.addCookies([{ name: "uniwork-locale", value: "en", url: baseUrl }]);
        const marker = `${Date.now()}`.slice(-8);
        const before = await listVersions(request, seeded.account.token, seeded.documentId);
        await signInAs(page, seeded.account.email);
        await page.goto(seeded.documentUrl);
        await expect(moduleFrameHost(page, c.module)).toHaveAttribute("data-state", "ready", { timeout: 90_000 });
        await c.edit!(page, marker);
        await expect.poll(async () => (await listVersions(request, seeded.account.token, seeded.documentId)).length, { timeout: 60_000, intervals: [1_000] })
          .toBeGreaterThan(before.length);
        const newest = (await listVersions(request, seeded.account.token, seeded.documentId)).reduce((a, b) => (b.version > a.version ? b : a));
        const bytes = await versionBytes(request, seeded.account.token, seeded.documentId, newest.version);
        expect(await c.hasEdit!(bytes, marker), `${c.module}: stored v${newest.version} lacks the edit ${marker}`).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`02-${c.module}-saved.png`) });
      });
    }
  });
}
