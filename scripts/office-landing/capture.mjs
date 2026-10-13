#!/usr/bin/env node
// Re-shoot the screenshots of the public Office page (/office): the six web editors, once per language,
// light theme, 2x pixel ratio, written as webp to apps/web/public/landing/office/<editor>.<lang>.webp.
//
//   E2E_BASE_URL=http://localhost:3000 NEXT_PUBLIC_API_URL=http://localhost:8080 \
//     node scripts/office-landing/capture.mjs [--only docs,sheets] [--lang vi,en] [--require-ai] [--out dir]
//
// Needs the web app and the API running (a production build that installed the pinned office frame bundles,
// the same environment the office-*-web e2e specs use). Every shot is a fresh verified account with one
// seeded sample file (samples.mjs); the editor is the real same-origin frame the Documents page opens.
// Nothing is mocked: if the AI panel is not offered to the account, the shot is still taken, the report says
// `aiPanel: false`, and --require-ai turns that into a failed run so a shot without it never ships by accident.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
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
const out = resolve(arg("out") ?? join(repoRoot, "apps/web/public/landing/office"));
const requireAi = process.argv.includes("--require-ai");

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
  await ok(await request.post(`${API}/api/v1/me/email/verify`, { headers: headers(token), data: { code: CODE } }), "verify email");
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

async function shoot(browser, editor, lang) {
  const tag = `shot-${editor}-${lang}`;
  const context = await browser.newContext({
    baseURL: WEB, locale: lang === "vi" ? "vi-VN" : "en-US", colorScheme: "light",
    viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2,
  });
  try {
    await context.addCookies([{ name: "uniwork-locale", value: lang, url: WEB }]);
    // The frames are same-origin, so their stored "AI panel open" preference is set before they boot.
    await context.addInitScript(() => { for (const key of ["aidocs.showAi", "htmlapp.showAi", "mdapp.showAi"]) localStorage.setItem(key, "1"); });
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
    writeFileSync(join(out, `${editor}.${lang}.webp`), webp);
    return { editor, lang, aiPanel, frame: box && `${Math.round(box.width)}x${Math.round(box.height)}`, bytes: webp.length };
  } finally { await context.close(); }
}

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
const report = [];
let failed = false;
try {
  for (const lang of languages) {
    for (const editor of only) {
      try {
        const row = await shoot(browser, editor, lang);
        console.log(`${row.editor}.${row.lang}.webp  ${row.bytes} bytes  frame ${row.frame}  AI panel: ${row.aiPanel ? "yes" : "NO"}`);
        if (requireAi && !row.aiPanel) failed = true;
        report.push(row);
      } catch (error) {
        failed = true;
        console.error(`${editor}.${lang}: ${error instanceof Error ? error.message : error}`);
        report.push({ editor, lang, error: String(error) });
      }
    }
  }
} finally { await browser.close(); }
const reportPath = join(tmpdir(), "office-landing-capture.json");
writeFileSync(reportPath, JSON.stringify({ web: WEB, api: API, rows: report }, null, 2));
console.log(`report: ${reportPath}`);
process.exit(failed ? 1 : 0);
