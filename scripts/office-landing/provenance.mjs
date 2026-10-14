#!/usr/bin/env node
// Record source provenance for the Office marketing screenshots without changing raster bytes.
// node scripts/office-landing/provenance.mjs --report scripts/office-landing/capture-report.json
//   --embed-script <impeccable/scripts/embed-prompt.mjs>
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "apps/web/public/landing/office");
const arg = (name) => { const at = process.argv.indexOf(`--${name}`); return at >= 0 ? process.argv[at + 1] : undefined; };
const embedScript = arg("embed-script");
const reviewed = process.argv.includes("--reviewed");
if (!embedScript) throw new Error("--embed-script must name Impeccable's embed-prompt.mjs");
const report = JSON.parse(readFileSync(resolve(arg("report") ?? join(root, "scripts/office-landing/capture-report.json")), "utf8"));
const newRows = new Map(report.rows.filter((row) => !row.error).map((row) => [row.filename, row]));
const requireFromE2e = createRequire(join(root, "e2e/package.json"));
const { chromium } = requireFromE2e("@playwright/test");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceFiles = ["scripts/office-landing/capture.mjs", "scripts/office-landing/samples.mjs", "scripts/office-landing/deck.mjs", "scripts/office-landing/report.mjs"];
const sources = sourceFiles.map((path) => ({ path, sha256: hash(readFileSync(join(root, path))) }));
const approvedComp = ".impeccable/mocks/decision/office-20261014/a-split.png";
const sourceArchive = JSON.parse(readFileSync(join(root, "apps/web/platform/office-frame/source.json"), "utf8"));
const files = readdirSync(out).filter((name) => /^(docs|sheets|slides|pdf|html|markdown)\.(vi|en)(\.dark)?\.webp$/.test(name)).sort();
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
const rows = [];
try {
  const page = await browser.newPage();
  for (const filename of files) {
    const path = `apps/web/public/landing/office/${filename}`;
    const bytes = readFileSync(join(out, filename));
    const [editor, lang] = filename.split(".");
    const theme = filename.includes(".dark.") ? "dark" : "light";
    const capture = newRows.get(filename);
    const dimensions = await page.evaluate(async (encoded) => {
      const img = new Image();
      await new Promise((done, fail) => { img.onload = done; img.onerror = fail; img.src = `data:image/webp;base64,${encoded}`; });
      return { width: img.naturalWidth, height: img.naturalHeight };
    }, bytes.toString("base64"));
    if (dimensions.width !== 2400 || dimensions.height !== 1500) throw new Error(`${filename}: expected 2400x1500`);
    const historicalCommit = !capture ? execFileSync("git", ["log", "-1", "--format=%H", "--", path], { cwd: root, encoding: "utf8" }).trim() : null;
    const historicalBlob = historicalCommit ? execFileSync("git", ["rev-parse", `${historicalCommit}:${path}`], { cwd: root, encoding: "utf8" }).trim() : null;
    const rowSources = historicalCommit ? sourceFiles.map((sourcePath) => ({ path: sourcePath, commit: historicalCommit,
      sha256: hash(execFileSync("git", ["show", `${historicalCommit}:${sourcePath}`], { cwd: root })),
    })) : sources;
    const rowArchive = historicalCommit ? JSON.parse(execFileSync("git", ["show", `${historicalCommit}:apps/web/platform/office-frame/source.json`], { cwd: root, encoding: "utf8" })) : sourceArchive;
    const origin = capture
      ? `Source: actual UniWork ${editor} editor, installed pinned product frame ${capture.entry}, fork ${capture.pin.gitSha}, manifest SHA-256 ${capture.pin.manifestSha256}. Captured ${capture.capturedAt} from ${report.web}, language ${lang}, native dark theme through the standard uniwork.office.docs v1 init protocol. Real sample ${capture.sample.name} supplied as raw bytes, SHA-256 ${capture.sample.sha256}; sample content from scripts/office-landing/samples.mjs (with deck.mjs/report.mjs where applicable) is illustrative and names a fictional company. Playwright with system Chrome, 1200x750 CSS viewport at 2x, 2400x1500 WebP encoded at quality 0.86 without recoloring or filters. The invisible fixture host grants standard editor capabilities to expose the real empty AI panel; no server data, customer results, AI output, save, or authentication behavior is claimed.`
      : `Source: pre-existing UniWork ${editor} ${lang} light editor screenshot committed in repository commit ${historicalCommit}, git blob ${historicalBlob}, exact file apps/web/public/landing/office/${filename}. Source capture workflow: scripts/office-landing/capture.mjs and illustrative source samples in samples.mjs, deck.mjs and report.mjs at that commit. Raster bytes are preserved. Historical runtime, exact capture timestamp, sample binary hash and original browser session are not retained, so this record identifies the committed origin rather than certifying those unknown details. The depicted sample content is illustrative and names a fictional company.`;
    execFileSync(process.execPath, [resolve(embedScript), join(out, filename), "--prompt", origin], { cwd: root, stdio: "pipe" });
    const row = {
      id: `${editor}-${lang}-${theme}`, bucket: capture ? "produce" : "direct", source_crop: null,
      source_reference: approvedComp, output_path: path, strategy: capture ? "real-product-frame-source-fixture-capture" : "preserve-existing-committed-product-screenshot",
      prompt_used: null, origin, dimensions, format: "webp", transparency: false, bytes: bytes.length, sha256: hash(bytes),
      illustrative_data: true, source_files: rowSources, source_archive: rowArchive,
      ...(capture ? { capture } : { historical_commit: historicalCommit, historical_blob: historicalBlob }),
      deviations: capture && editor === "docs" ? ["The actual editor's native dark theme also darkens document paper; the approved visual comp depicted white paper."] : [],
      qa_status: reviewed && (!capture || (capture.errors.length === 0 && capture.protocolErrors.length === 0)) ? "accepted" : "needs_parent_review",
    };
    const sidecarPath = join(out, `${filename}.json`);
    const embedded = JSON.parse(readFileSync(sidecarPath, "utf8"));
    writeFileSync(sidecarPath, `${JSON.stringify({ ...embedded, ...row }, null, 2)}\n`);
    rows.push(row);
  }
  // Review gallery contains the actual raster files, no modified editor imagery.
  await page.setViewportSize({ width: 1800, height: 1700 });
  for (const theme of ["light", "dark"]) {
    const galleryRows = rows.filter((row) => row.id.endsWith(`-${theme}`));
    await page.setContent(`<html><head><style>body{margin:0;background:#17191d;color:#fff;font:18px Arial;display:grid;grid-template-columns:repeat(3,600px)}figure{margin:0;padding:12px;box-sizing:border-box}img{width:576px;display:block}figcaption{padding:8px 0}</style></head><body>${galleryRows.map((row) => `<figure><img src="data:image/webp;base64,${readFileSync(join(root, row.output_path)).toString("base64")}"><figcaption>${row.id}</figcaption></figure>`).join("")}</body></html>`);
    await page.evaluate(async () => { await Promise.all([...document.images].map((img) => img.decode())); });
    await page.screenshot({ path: join(root, `scripts/office-landing/${theme}-contact-sheet.png`), fullPage: true });
  }
} finally { await browser.close(); }

const manifest = {
  schema: 1, generated_at: new Date().toISOString(), approved_comp: approvedComp,
  produce: rows.filter((row) => row.bucket === "produce"), direct: rows.filter((row) => row.bucket === "direct"),
  semantic: [{ id: "editor-preview-presentation", implementation: "Use one semantic picture per editor with theme-specific sources and locale-aware asset names. The marketing page owns tab buttons, tab panels, illustrative-data caption, screenshot border, corner clipping and shadow in HTML/CSS. Keep the image undecorated; render copy and calls to action outside it.", notes: "The parent builds responsive composition A and exposes the active editor through accessible tabs. Screenshots preserve actual product UI but are static illustrations of source sample files.", qa_status: "needs_parent_review" }],
  execution_order: ["Open source samples in the installed real editor bundle through the standard frame protocol.", "Capture native dark UI and encode 2400x1500 WebP.", "Preserve existing light raster bytes and attach exact committed origins.", "Review the complete contact sheet and consume matching light/dark locale pairs."],
  blockers: [],
  limitations: ["Authenticated sample capture could not seed a document: the local preview API returned 503 storage_unavailable.", "Fixture screenshots depict the actual installed renderer and source files; the fixture grants an empty AI panel and does not validate backend, authentication, save, customer data or AI execution.", "Existing light rasters have exact committed origins; original capture timestamps and runtime sessions were not retained."],
  assumptions: ["The approved hero requires real editor screenshots as final image assets.", "All report/deck metrics belong to fictional sample documents and must retain the page's illustrative-data label."],
  totals: { rasters: rows.length, new_dark_rasters: rows.filter((row) => row.bucket === "produce").length, bytes: rows.reduce((sum, row) => sum + row.bytes, 0), dark_bytes: rows.filter((row) => row.bucket === "produce").reduce((sum, row) => sum + row.bytes, 0) },
};
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest.totals));
