#!/usr/bin/env node
// Re-shoot the screenshots of the public Office page (/office): the six web editors, once per language,
// selected theme, 2x pixel ratio, written as webp to apps/web/public/landing/office/<editor>.<lang>[.dark].webp.
//
//   E2E_BASE_URL=http://localhost:3000 NEXT_PUBLIC_API_URL=http://localhost:8080 \
//     node scripts/office-landing/capture.mjs [--only docs,sheets] [--lang vi,en] [--theme light,dark] [--require-ai] [--out dir]
//
// Needs the web app and the API running (a production build that installed the pinned office frame bundles,
// the same environment the office-*-web e2e specs use). Every shot is a fresh verified account with one
// seeded sample file (samples.mjs); the editor is the real same-origin frame the Documents page opens.
// Nothing is mocked: if the AI panel is not offered to the account, the shot is still taken, the report says
// `aiPanel: false`, and --require-ai turns that into a failed run so a shot without it never ships by accident.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildDocx, buildPptx, buildXlsx, htmlPage, markdownNotes, pdfHtml, REPORT_PDF_OPTIONS } from "./samples.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Playwright and jszip are the e2e workspace's dependencies.
const requireFromE2e = createRequire(join(repoRoot, "e2e", "package.json"));
const { chromium } = requireFromE2e("@playwright/test");
const JSZip = requireFromE2e("jszip");

const WEB = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const CODE = process.env.E2E_VERIFICATION_CODE ?? "123456";
const PASSWORD = "password123";
const EDITORS = ["docs", "sheets", "slides", "pdf", "html", "markdown"];
const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf", html: "text/html", md: "text/markdown",
};
/** Where each editor's AI panel shows up once the account is offered AI. */
const AI_PANEL = ".ai-panel-header, [class*='ai-panel'], [class*='AiPanel'], [data-ai-state]";
const WIDTH = 2400;
const HEIGHT = 1500;

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}
const only = (arg("only")?.split(",") ?? EDITORS).filter((name) => EDITORS.includes(name));
const languages = (arg("lang")?.split(",") ?? ["vi", "en"]).filter((name) => ["vi", "en"].includes(name));
const themes = (arg("theme")?.split(",") ?? ["light"]).filter((name) => ["light", "dark"].includes(name));
const out = resolve(arg("out") ?? join(repoRoot, "apps/web/public/landing/office"));
const requireAi = process.argv.includes("--require-ai");
const fixtureMode = process.argv.includes("--fixture");
// Local mail-log mode: only read the verification message for the synthetic account this run created.
// Staging previews can use random mailed codes even when DEV_VERIFICATION_CODE is unavailable.
const verificationLog = arg("verification-log");

async function verificationCode(email) {
  if (!verificationLog) return CODE;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const messages = readFileSync(resolve(verificationLog), "utf8").split(/\r?\n/);
    for (const line of messages.reverse()) {
      if (!line.includes(email)) continue;
      try {
        const message = JSON.parse(line);
        if (message.kind !== "verification_code" || message.to !== email) continue;
        const code = message.subject?.match(/\b\d{6}\b/)?.[0] ?? message.text?.match(/\b\d{6}\b/)?.[0];
        if (code) return code;
      } catch { /* the log can end in a partly written line */ }
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`verification message for this capture account was not found in ${verificationLog}`);
}

async function sampleFile(editor, lang, browser) {
  switch (editor) {
    case "docs": return { name: "plan.docx", mimeType: MIME.docx, buffer: await buildDocx(JSZip, lang) };
    case "sheets": return { name: "revenue.xlsx", mimeType: MIME.xlsx, buffer: await buildXlsx(JSZip, lang) };
    case "slides": {
      const fixture = readFileSync(join(repoRoot, "docs/office/g0/fixtures/files/slides/pptx-standard-business.pptx"));
      return { name: "results.pptx", mimeType: MIME.pptx, buffer: await buildPptx(JSZip, fixture, lang) };
    }
    case "pdf": {
      const page = await browser.newPage();
      await page.setContent(pdfHtml(lang));
      const buffer = Buffer.from(await page.pdf(REPORT_PDF_OPTIONS));
      await page.close();
      return { name: "report.pdf", mimeType: MIME.pdf, buffer };
    }
    case "html": return { name: "summit.html", mimeType: MIME.html, buffer: Buffer.from(htmlPage(lang)) };
    default: return { name: "notes.md", mimeType: MIME.md, buffer: Buffer.from(markdownNotes(lang)) };
  }
}

/** A verified account with one workspace, the same calls the e2e fixtures make. */
async function createAccount(request, tag) {
  const stamp = Date.now();
  const email = `${tag}-${stamp}@example.com`;
  const headers = (token) => ({ authorization: `Bearer ${token}` });
  const ok = async (response, what) => {
    if (!response.ok()) throw new Error(`${what}: HTTP ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const { access_token: token } = await ok(await request.post(`${API}/api/v1/auth/register`, { data: { email, password: PASSWORD, display_name: "Minh An" } }), "register");
  await ok(await request.post(`${API}/api/v1/me/email/verify`, { headers: headers(token), data: { code: await verificationCode(email) } }), "verify email");
  const orgSlug = `shot-org-${stamp}`;
  const { organization } = await ok(await request.post(`${API}/api/v1/orgs`, { headers: headers(token), data: { name: "Công ty Minh An", slug: orgSlug } }), "create organization");
  const wsSlug = `shot-ws-${stamp}`;
  const { workspace } = await ok(await request.post(`${API}/api/v1/orgs/${organization.id}/workspaces`, { headers: headers(token), data: { name: "Vận hành", slug: wsSlug } }), "create workspace");
  await ok(await request.post(`${API}/api/v1/me/onboarding/complete`, { headers: headers(token), data: { completion_path: "full", workspace_id: workspace.id } }), "complete onboarding");
  return { token, email, orgSlug, wsSlug, wsId: workspace.id };
}

async function seedDocument(request, account, file, tag) {
  const response = await request.post(`${API}/api/v1/workspaces/${account.wsId}/documents/files`, {
    headers: { authorization: `Bearer ${account.token}`, "Idempotency-Key": `${tag}-${Date.now().toString(36)}` },
    multipart: { file },
  });
  if (!response.ok()) throw new Error(`seed ${file.name}: HTTP ${response.status()} ${await response.text()}`);
  return (await response.json()).document.id;
}

/** PNG bytes -> webp at WIDTH x HEIGHT (cover, anchored top-left) through the browser's own encoder. */
async function toWebp(browser, png) {
  const page = await browser.newPage();
  try {
    const base64 = await page.evaluate(async ({ data, width, height }) => {
      const image = new Image();
      await new Promise((resolveImage, reject) => { image.onload = resolveImage; image.onerror = reject; image.src = `data:image/png;base64,${data}`; });
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const scale = Math.max(width / image.width, height / image.height);
      canvas.getContext("2d").drawImage(image, 0, 0, image.width * scale, image.height * scale);
      return canvas.toDataURL("image/webp", 0.86).split(",")[1];
    }, { data: png.toString("base64"), width: WIDTH, height: HEIGHT });
    return Buffer.from(base64, "base64");
  } finally { await page.close(); }
}

/** Real installed editor, source sample bytes, standard postMessage protocol. The fixture parent has no UI. */
async function shootFixture(browser, editor, lang, theme) {
  const pin = JSON.parse(readFileSync(join(repoRoot, `apps/web/platform/office-frame/${editor}.pin.json`), "utf8"));
  const entry = `/office-frame/${editor}/${pin.version}/${pin.entry}`;
  const file = await sampleFile(editor, lang, browser);
  const context = await browser.newContext({
    baseURL: WEB, locale: lang === "vi" ? "vi-VN" : "en-US", colorScheme: theme,
    viewport: { width: WIDTH / 2, height: HEIGHT / 2 }, deviceScaleFactor: 2,
  });
  try {
    await context.addInitScript(() => {
      // HTML document previews are opaque sandbox frames and correctly cannot read storage.
      try {
        for (const key of ["aidocs.showAi", "htmlapp.showAi", "mdapp.showAi"]) localStorage.setItem(key, "1");
      } catch { /* only the actual editor needs these preferences */ }
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/__office_capture_fixture", (route) => route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body></body></html>',
    }));
    await page.goto("/__office_capture_fixture");
    await page.evaluate(({ editor, lang, theme, entry, name, mimeType, encoded }) => {
      const iframe = document.createElement("iframe");
      const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)).buffer;
      let sentInit = false;
      window.__officeCapture = { state: "waiting", messages: [], errors: [] };
      const send = (message) => iframe.contentWindow.postMessage({ ns: "uniwork.office.docs", v: 1, ...message }, location.origin);
      window.addEventListener("message", (event) => {
        if (event.source !== iframe.contentWindow || event.origin !== location.origin || event.data?.ns !== "uniwork.office.docs") return;
        const message = event.data;
        window.__officeCapture.messages.push({ kind: message.kind, type: message.type, payload: message.payload, error: message.error });
        if (message.kind === "event" && message.type === "ready" && !sentInit) {
          sentInit = true;
          send({ id: "capture-init", kind: "request", type: "init", payload: {
            protocolVersion: 1, module: editor, token: "local-source-fixture-no-server-token", tokenExpiresAt: Date.now() + 3600000,
            documentId: `illustrative-${editor}-${lang}`, workspaceId: "illustrative-local-samples",
            apiBase: `${location.origin}/api`, apiMode: "host-proxy", locale: lang, theme,
            capabilities: { save: true, ai: true, images: false, attachments: false, saveAs: false, recents: false, exportPdf: false, print: false },
            user: { displayName: "Minh An" },
            open: { file: { fileId: `illustrative-${editor}-${lang}`, name, mimeType, sizeBytes: bytes.byteLength, writable: true }, source: { kind: "bytes", data: bytes } },
          } });
        }
        if (message.kind === "response" && message.id === "capture-init") {
          window.__officeCapture.state = message.error ? "failed" : "ready";
          window.__officeCapture.capabilities = message.payload?.capabilities;
          if (message.error) window.__officeCapture.errors.push(message.error);
        }
        if (message.kind === "event" && message.type === "error") window.__officeCapture.errors.push(message.payload);
        if (message.kind === "request") {
          send({ id: message.id, kind: "response", type: message.type, error: { code: "unsupported", message: "Local screenshot fixture: service actions are unavailable" } });
        }
      });
      iframe.src = entry;
      document.body.append(iframe);
    }, { editor, lang, theme, entry, name: file.name, mimeType: file.mimeType, encoded: file.buffer.toString("base64") });
    await page.waitForFunction(() => ["ready", "failed"].includes(window.__officeCapture?.state), null, { timeout: 60000 });
    const session = await page.evaluate(() => window.__officeCapture);
    if (session.state !== "ready") throw new Error(`fixture init rejected: ${JSON.stringify(session.errors)}`);
    const iframe = page.locator("iframe").first();
    const frame = await (await iframe.elementHandle()).contentFrame();
    await frame.waitForFunction((selectedTheme) => document.documentElement.getAttribute("data-theme") === selectedTheme, theme, { timeout: 15000 });
    await frame.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2000);
    const aiPanel = await frame.locator(AI_PANEL).first().isVisible().catch(() => false);
    const png = await iframe.screenshot({ type: "png" });
    const webp = await toWebp(browser, png);
    const filename = `${editor}.${lang}${theme === "dark" ? ".dark" : ""}.webp`;
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, filename), webp);
    const state = await frame.evaluate(() => ({ theme: document.documentElement.getAttribute("data-theme"), locale: document.documentElement.lang, background: getComputedStyle(document.body).backgroundColor }));
    return { editor, lang, theme, filename, aiPanel, frame: `${WIDTH / 2}x${HEIGHT / 2}`, width: WIDTH, height: HEIGHT, bytes: webp.length,
      capturedAt: new Date().toISOString(), captureMode: "installed-product-frame-source-fixture", entry, pin,
      sample: { name: file.name, mimeType: file.mimeType, sha256: createHash("sha256").update(file.buffer).digest("hex"), illustrative: true },
      effectiveCapabilities: session.capabilities, state, errors, protocolErrors: session.errors,
    };
  } finally { await context.close(); }
}

async function shoot(browser, editor, lang, theme) {
  const tag = `shot-${editor}-${lang}-${theme}`;
  const context = await browser.newContext({
    baseURL: WEB, locale: lang === "vi" ? "vi-VN" : "en-US", colorScheme: theme,
    viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2,
  });
  try {
    await context.addCookies([{ name: "uniwork-locale", value: lang, url: WEB }]);
    // The frames are same-origin, so their stored "AI panel open" preference is set before they boot.
    await context.addInitScript((selectedTheme) => {
      localStorage.setItem("theme", selectedTheme);
      for (const key of ["aidocs.showAi", "htmlapp.showAi", "mdapp.showAi"]) localStorage.setItem(key, "1");
    }, theme);
    const page = await context.newPage();
    const account = await createAccount(context.request, tag);
    const documentId = await seedDocument(context.request, account, await sampleFile(editor, lang, browser), tag);
    await page.goto("/login");
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel(/^(Mật khẩu|Password)$/).fill(PASSWORD);
    await page.getByRole("button", { name: /^(Đăng nhập|Log in)$/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
    await page.goto(`/${account.orgSlug}/${account.wsSlug}/documents/${documentId}`);
    const host = page.locator("[data-office-docs-frame]").first();
    await host.waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => document.querySelector("[data-office-docs-frame]")?.getAttribute("data-state") === "ready", null, { timeout: 90_000 });
    const iframe = page.locator("iframe[src*='/office-frame/']").first();
    const frame = (await (await iframe.elementHandle()).contentFrame());
    const aiPanel = await frame.locator(AI_PANEL).first().waitFor({ state: "visible", timeout: 20_000 }).then(() => true, () => false);
    await page.waitForTimeout(2_000); // fonts, canvas and thumbnails settle
    const png = await iframe.screenshot({ type: "png" });
    const box = await iframe.boundingBox();
    const webp = await toWebp(browser, png);
    mkdirSync(out, { recursive: true });
    const filename = `${editor}.${lang}${theme === "dark" ? ".dark" : ""}.webp`;
    writeFileSync(join(out, filename), webp);
    return { editor, lang, theme, filename, aiPanel, frame: box && `${Math.round(box.width)}x${Math.round(box.height)}`, bytes: webp.length };
  } finally { await context.close(); }
}

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
const report = [];
let failed = false;
try {
  for (const lang of languages) {
   for (const theme of themes) {
    for (const editor of only) {
      try {
        const row = await (fixtureMode ? shootFixture : shoot)(browser, editor, lang, theme);
        console.log(`${row.filename}  ${row.bytes} bytes  frame ${row.frame}  AI panel: ${row.aiPanel ? "yes" : "NO"}`);
        if (requireAi && !row.aiPanel) failed = true;
        report.push(row);
      } catch (error) {
        failed = true;
        console.error(`${editor}.${lang}.${theme}: ${error instanceof Error ? error.message : error}`);
        report.push({ editor, lang, theme, error: String(error) });
      }
    }
   }
  }
} finally { await browser.close(); }
const reportPath = resolve(arg("report") ?? join(tmpdir(), "office-landing-capture.json"));
const oldRows = process.argv.includes("--append-report") && existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath, "utf8")).rows.filter((old) => !report.some((row) => row.editor === old.editor && row.lang === old.lang && row.theme === old.theme))
  : [];
writeFileSync(reportPath, `${JSON.stringify({ web: WEB, api: API, rows: [...oldRows, ...report] }, null, 2)}\n`);
console.log(`report: ${reportPath}`);
process.exit(failed ? 1 : 0);
