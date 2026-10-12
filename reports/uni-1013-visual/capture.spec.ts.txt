import { test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import { resolve } from "node:path";
import { e2eApiUrl, e2eBaseUrl } from "../../e2e/api-url";
import { seedDocx, setFlag } from "../../e2e/office-docs-web-fixtures";

/**
 * Visual evidence capture for the Docs web frame (UNI-1013). Evidence only.
 * Env: VIS_LANG=vi|en  VIS_THEME=light|dark  VIS_VP=1440|1024
 * Copied into e2e/ to run (it needs that Playwright config), see REPORT.md.
 */
const LANG = (process.env.VIS_LANG ?? "vi") as "vi" | "en";
const THEME = (process.env.VIS_THEME ?? "light") as "light" | "dark";
const VP = process.env.VIS_VP === "1024" ? { width: 1024, height: 768 } : { width: 1440, height: 900 };
const OUT = resolve(process.env.VIS_OUT ?? "reports/uni-1013-visual/screenshots", `${VP.width}`, `${LANG}-${THEME}`);
const FRAME = 'iframe[src*="/office-frame/docs/"]';
const EDITOR = '.ProseMirror[contenteditable="true"]';
const base = e2eBaseUrl;

test.describe.configure({ timeout: 600_000 });
test.use({ viewport: VP, colorScheme: THEME, actionTimeout: 20_000 });

const metrics: Record<string, unknown> = {};
const notes: string[] = [];

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  try {
    metrics[name] = await page.evaluate(() => {
      const de = document.documentElement;
      const f = document.querySelector<HTMLIFrameElement>('iframe[src*="/office-frame/docs/"]');
      const r = f?.getBoundingClientRect();
      let inner: unknown = null;
      try {
        const d = f?.contentDocument;
        if (d) {
          const page = d.querySelector(".ProseMirror");
          inner = {
            htmlClass: d.documentElement.className, dataTheme: d.documentElement.getAttribute("data-theme"),
            lang: d.documentElement.lang, title: d.title,
            bodyBg: getComputedStyle(d.body).backgroundColor,
            proseBg: page ? getComputedStyle(page).backgroundColor : null,
            proseColor: page ? getComputedStyle(page).color : null,
            hScroll: d.documentElement.scrollWidth > d.documentElement.clientWidth,
          };
        }
      } catch { inner = "cross-origin"; }
      return {
        title: document.title, htmlClass: de.className, lang: de.lang,
        hOverflow: de.scrollWidth > de.clientWidth, vOverflow: de.scrollHeight > de.clientHeight,
        iframe: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null, inner,
      };
    });
  } catch (e) { metrics[name] = { error: String(e) }; }
}

async function prep(context: BrowserContext, page: Page, email: string): Promise<void> {
  // Sign in with the vi form labels, then switch locale + theme.
  await context.addCookies([{ name: "uniwork-locale", value: "vi", url: base }]);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60_000 });
  await context.addCookies([{ name: "uniwork-locale", value: LANG, url: base }]);
  await page.evaluate((t) => localStorage.setItem("theme", t), THEME);
}

async function openDoc(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator(FRAME).waitFor({ state: "visible", timeout: 60_000 });
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  if (process.env.VIS_ONLY && !name.startsWith(process.env.VIS_ONLY)) return;
  try { await fn(); notes.push(`${name}: ok`); } catch (e) { notes.push(`${name}: FAILED ${String(e).split("\n")[0]}`); }
}

test(`capture ${VP.width} ${LANG} ${THEME}`, async ({ browser }) => {
  const context = await browser.newContext({ baseURL: base, viewport: VP, colorScheme: THEME });
  const page = await context.newPage();
  const seeded = await seedDocx(page, base, `vis-${LANG}-${THEME}-${VP.width}-${Date.now().toString(36)}`);
  await setFlag("office_engine", seeded.organizationId, true);
  await setFlag("office_docs_web", seeded.organizationId, true);
  await prep(context, page, seeded.account.email);
  const listUrl = `${base}/${seeded.account.orgSlug}/${seeded.account.wsSlug}/documents`;
  const frame = () => page.frameLocator(FRAME);
  const editor = () => frame().locator(EDITOR).first();

  await step("01 list", async () => { await page.goto(listUrl); await page.getByText("docs-web.docx").first().waitFor({ timeout: 30_000 }).catch(() => notes.push("01: docs-web.docx text not found")); await shot(page, "01-document-list"); });

  await step("02 opened", async () => {
    // Slow the frame's document fetch so the loading state can be captured.
    await context.route("**/api/v1/office-frame/**", async (r) => { await new Promise((ok) => setTimeout(ok, 4000)); await r.continue().catch(() => undefined); });
    await page.goto(seeded.documentUrl);
    await page.locator(FRAME).waitFor({ state: "attached", timeout: 60_000 });
    await page.waitForTimeout(1500);
    await shot(page, "02a-opening-loading");
    await context.unroute("**/api/v1/office-frame/**");
    await editor().waitFor({ state: "visible", timeout: 60_000 });
    await shot(page, "02b-opened-editor-ready");
  });

  await step("02c flash", async () => {
    // Hold the frame's index.html so the iframe is on screen before its own page paints (white-flash check).
    const idx = "**/office-frame/docs/**/index.html";
    await context.route(idx, async (r) => { await new Promise((ok) => setTimeout(ok, 3500)); await r.continue().catch(() => undefined); });
    await page.goto(seeded.documentUrl);
    await page.locator(FRAME).waitFor({ state: "attached", timeout: 60_000 });
    await page.waitForTimeout(1200);
    await shot(page, "02c-frame-html-pending");
    await page.waitForTimeout(3500);
    await context.unroute(idx);
  });

  await step("03 editing", async () => {
    await editor().click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" Biên tập thử / editing test — Việt Nam.");
    await shot(page, "03-editing");
  });

  await step("03b ribbon", async () => {
    const f = frame();
    const probe = async (label: string) => {
      metrics[label] = await f.locator("body").evaluate(() => {
        const out: unknown[] = [];
        document.querySelectorAll<HTMLElement>("*").forEach((el) => {
          const r = el.getBoundingClientRect();
          const ox = getComputedStyle(el).overflowX;
          if (r.top < 230 && r.width > 300 && el.scrollWidth > el.clientWidth + 1 && /auto|scroll|hidden/.test(ox)) out.push({ tag: el.tagName, cls: String(el.className).slice(0, 60), ox, sw: el.scrollWidth, cw: el.clientWidth });
        });
        return out.slice(0, 6);
      }).catch((e) => String(e));
    };
    await probe("03b-ribbon-overflow-home");
    await shot(page, "03b-ribbon-home");
    for (const [name, rx] of [["references", /^(Tham khảo|Tham chiếu|References)$/], ["view", /^(Xem|View)$/]] as const) {
      await f.getByText(rx).first().click();
      await page.waitForTimeout(500);
      await probe(`03b-ribbon-overflow-${name}`);
      await shot(page, `03b-ribbon-${name}`);
    }
    await f.getByText(/^(Trang đầu|Home)$/).first().click();
    await page.waitForTimeout(400);
    const h1 = f.getByText(/Tiêu đề 1|Heading 1/).first();
    notes.push("03b heading1 card visible: " + await h1.isVisible().catch(() => false));
    if (await h1.isVisible().catch(() => false)) { await h1.click(); await page.waitForTimeout(500); await shot(page, "03b-styles-heading1-applied"); await page.keyboard.press("Control+z"); }
  });

  await step("04 dirty+leave", async () => {
    await shot(page, "04a-dirty");
    const nav = page.locator('a[href*="/documents"], a[href$="/tasks"], nav a').first();
    await nav.click();
    await page.waitForTimeout(800);
    await shot(page, "04b-leave-dialog");
    const stay = page.getByRole("button", { name: /ở lại|stay|cancel|hủy/i }).first();
    if (await stay.isVisible().catch(() => false)) await stay.click();
  });

  await step("05 saved", async () => {
    await page.goto(seeded.documentUrl);
    await editor().waitFor({ state: "visible", timeout: 60_000 });
    await editor().click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" saved-edit");
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(3500);
    await shot(page, "05a-saved");
    await page.goto(`${seeded.documentUrl}`);
    notes.push(`url-after-save: ${page.url()}`);
  });

  await step("05b versions", async () => {
    const trigger = page.getByRole("button", { name: /phiên bản|version|history|lịch sử/i }).first();
    if (await trigger.isVisible().catch(() => false)) { await trigger.click(); await shot(page, "05b-version-history"); } else notes.push("05b: no version history control visible in host UI");
  });

  await step("06 conflict", async () => {
    await openDoc(page, seeded.documentUrl);
    await editor().waitFor({ state: "visible", timeout: 60_000 });
    const other = await context.newPage();
    await other.goto(seeded.documentUrl);
    const oe = other.frameLocator(FRAME).locator(EDITOR).first();
    await oe.waitFor({ state: "visible", timeout: 60_000 });
    await oe.click(); await other.keyboard.press("Control+End"); await other.keyboard.type(" other-writer");
    await other.keyboard.press("Control+s"); await other.waitForTimeout(3500);
    await other.close();
    await page.bringToFront();
    await editor().click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" stale-writer");
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(3000);
    await shot(page, "06-save-conflict");
    notes.push("06 inert-count-host: " + await page.evaluate(() => document.querySelectorAll("[inert]").length));
    notes.push("06 frame-activeElement: " + await frame().locator("body").evaluate((b) => { const a = b.ownerDocument.activeElement as HTMLElement | null; return a ? `${a.tagName} "${(a.textContent ?? "").trim().slice(0, 30)}"` : "none"; }).catch(() => "n/a"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    await shot(page, "06b-conflict-after-escape");
  });

  await step("07 save-as", async () => {
    await openDoc(page, seeded.documentUrl);
    await editor().waitFor({ state: "visible", timeout: 60_000 });
    await editor().click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" copy-edit");
    await frame().getByText(/^(Tệp|File)$/).first().click();
    await shot(page, "07a-file-menu");
    await frame().getByText(/Lưu thành|Lưu dưới dạng|Save as/i).first().click();
    await page.waitForTimeout(500);
    await shot(page, "07b-save-as-in-progress");
    await page.waitForURL((u) => !u.href.includes(seeded.documentId), { timeout: 60_000 });
    await editor().waitFor({ state: "visible", timeout: 60_000 });
    await shot(page, "07c-save-as-copy-opened");
  });

  await step("08 print fallback", async () => {
    await openDoc(page, seeded.documentUrl);
    await editor().waitFor({ state: "visible", timeout: 60_000 });
    await frame().locator("body").evaluate(() => {
      window.print = () => { setTimeout(() => window.dispatchEvent(new Event("afterprint")), 4000); };
    });
    const p = frame().locator("body").evaluate(() => (window as unknown as { __exportPdf: () => Promise<boolean> }).__exportPdf());
    await page.waitForTimeout(1200);
    await shot(page, "08a-export-in-progress");
    await p;
    await shot(page, "08b-export-print-fallback");
  });

  await step("10 error states", async () => {
    const sdo = (status: number, code: string, message: string) => ({ status, contentType: "application/json", body: JSON.stringify({ error: { code, message } }) });
    const mint = "**/api/v1/documents/*/office/frame-token";
    const cases: [string, () => Promise<void>][] = [
      ["10a-token-mint-unavailable-503", () => context.route(mint, (r) => r.fulfill(sdo(503, "office_not_configured", "Office is not configured")))],
      ["10b-token-mint-network-error", () => context.route(mint, (r) => r.abort("connectionreset"))],
      ["10c-token-mint-denied-403", () => context.route(mint, (r) => r.fulfill(sdo(403, "forbidden", "Forbidden")))],
      ["10d-token-mint-failed-500", () => context.route(mint, (r) => r.fulfill(sdo(500, "internal", "Internal error")))],
    ];
    for (const [name, arm] of cases) {
      await arm();
      await page.goto(seeded.documentUrl);
      await page.waitForTimeout(5000);
      await shot(page, name);
      await context.unroute(mint);
    }
    const open = "**/api/v1/office-frame/documents/**";
    await context.route(open, (r) => r.request().method() === "GET" ? r.fulfill(sdo(500, "internal", "Internal error")) : r.continue());
    await page.goto(seeded.documentUrl);
    await page.waitForTimeout(8000);
    await shot(page, "10e-frame-open-500");
    await context.unroute(open);
  });

  await step("13 own page colour", async () => {
    const zip = await JSZip.loadAsync(readFileSync(resolve(process.cwd(), "../docs/office/g0/fixtures/files/docs/docx-simple.docx")));
    const doc = await zip.file("word/document.xml")!.async("string");
    zip.file("word/document.xml", doc.replace(/(<w:document[^>]*>)/, '$1<w:background w:color="FFF2CC"/>'));
    const settings = await zip.file("word/settings.xml")?.async("string");
    if (settings) zip.file("word/settings.xml", settings.replace(/(<w:settings[^>]*>)/, "$1<w:displayBackgroundShape/>"));
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const res = await page.request.post(`${e2eApiUrl}/api/v1/workspaces/${seeded.account.wsId}/documents/files`, {
      headers: { authorization: `Bearer ${seeded.account.token}`, "Idempotency-Key": `own-${Date.now().toString(36)}` },
      multipart: { file: { name: "own-page-colour.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: buf } },
    });
    const { document } = (await res.json()) as { document: { id: string } };
    await openDoc(page, `${base}/${seeded.account.orgSlug}/${seeded.account.wsSlug}/documents/${document.id}`);
    await editor().waitFor({ state: "visible", timeout: 60_000 });
    await shot(page, "13-own-page-colour");
  });

  await step("14 print and saved file keep authored colours", async () => {
    await openDoc(page, seeded.documentUrl);
    await editor().waitFor({ state: "visible", timeout: 60_000 });
    await editor().click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" colour-check");
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(3500);
    const api = e2eApiUrl;
    const dl = await page.request.get(`${api}/api/v1/documents/${seeded.documentId}/download`, { headers: { authorization: `Bearer ${seeded.account.token}` } });
    const xml = (await (await JSZip.loadAsync(await dl.body())).file("word/document.xml")!.async("string"));
    const colours = [...xml.matchAll(/w:(?:color|fill)="([0-9A-Fa-f]{6}|auto)"/g)].map((m) => m[1]!.toLowerCase());
    notes.push(`14 saved-docx colour attrs (dark=${THEME === "dark"}): ${JSON.stringify([...new Set(colours)])}; has 1e1e1e=${/1e1e1e/i.test(xml)}`);
    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(600);
    await shot(page, "14-print-media");
    metrics["14-print-prose"] = await frame().locator(".ProseMirror").first().evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, color: c.color }; }).catch((e) => String(e));
    await page.emulateMedia({ media: "screen" });
  });

  await step("09 flag off -> G3", async () => {
    await setFlag("office_docs_web", seeded.organizationId, false);
    await page.goto(seeded.documentUrl);
    await page.locator("[data-office-editor-host]").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);
    await shot(page, "09-flag-off-g3-editor");
  });

  mkdirSync(OUT, { recursive: true });
  if (!process.env.VIS_ONLY) writeFileSync(resolve(OUT, "metrics.json"), JSON.stringify({ notes, metrics }, null, 2));
  await context.close();
});
