// DOC-003 fixtures: one feature-bearing file per format group, all small.
//
// DOCX/XLSX/PPTX come from the prepared source's own builders so the fixture
// is guaranteed to exercise the code path the editor is tested against; PDF,
// Markdown and HTML are written here because upstream has no generator for them.
//
// Run through the prepared source's tsx, from the source root:
//   node_modules/.bin/tsx <spike>/e2e/office-g0/make-fixtures.mts --out <dir>
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf("--" + name);
  return index === -1 ? fallback : args[index + 1];
};
const OUT = resolve(argOf("out", "fixtures/lab"));
// the script runs with cwd at the prepared source root
const SOURCE = resolve(argOf("source", "."));

const load = (relative) => import(pathToFileURL(join(SOURCE, relative)).href);
// dependencies resolve inside the prepared source tree (the spike has no node_modules)
const loadPackage = (specifier) =>
  import(pathToFileURL(join(SOURCE, "node_modules", specifier)).href);

await mkdir(OUT, { recursive: true });
const written = [];

async function write(name, data) {
  const path = join(OUT, name);
  await writeFile(path, data);
  written.push({ name, path, bytes: data.length });
}

// ---- DOCX: rich content through the docx-engine's own test builder ----
const docxHelpers = await load("packages/docx-engine/tests/helpers/build-docx.ts");
const kitchen = await docxHelpers.buildKitchenSinkDocx();
await write("g0-kitchen-sink.docx", Buffer.from(kitchen));

// ---- XLSX: formulas + formatting through the sheets fixture builder ----
const sheetsFixtures = await load("apps/sheets/tests/fixture-builder.ts");
await write("g0-compatibility-edit.xlsx", await sheetsFixtures.buildEditFixture());
await write("g0-compatibility-kitchen-sink.xlsx", await sheetsFixtures.buildKitchenSinkFixture());

// ---- PPTX: a deck with two slides, one text and one table ----
const pptxgenModule = await loadPackage("pptxgenjs/dist/pptxgen.cjs.js");
const PptxGenJS = pptxgenModule.default ?? pptxgenModule;
const deck = new PptxGenJS();
deck.layout = "LAYOUT_16x9";
const slide = deck.addSlide();
slide.addText("DOC-003 slide title", { x: 0.5, y: 0.4, w: 8, h: 0.8, fontSize: 28, bold: true });
slide.addText("edited-by-lab", { x: 0.5, y: 1.4, w: 4, h: 0.6, fontSize: 18 });
slide.addTable(
  [
    ["Feature", "Value"],
    ["formula", "=SUM(A1:A2)"],
    ["unicode", "Tiếng Việt — 日本語"],
  ],
  { x: 0.5, y: 2.4, w: 6, h: 2, border: { pt: 1, color: "666666" } },
);
const second = deck.addSlide();
second.addText("Second slide", { x: 0.5, y: 0.5, w: 6, h: 1, fontSize: 24 });
await write("g0-slides.pptx", Buffer.from(await deck.write({ outputType: "nodebuffer" })));

// ---- PDF: a real text layer (font embedding) so text edit has something to hit ----
const { PDFDocument, StandardFonts, rgb } = await loadPackage("pdf-lib/cjs/index.js");
const pdf = await PDFDocument.create();
const page = pdf.addPage([595, 842]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText("DOC-003 lab fixture", { x: 60, y: 780, size: 20, font, color: rgb(0, 0, 0) });
page.drawText("editable text line", { x: 60, y: 740, size: 14, font });
// the standard font cannot encode Vietnamese; a text layer in ASCII is what
// DOC-003 edits, and the Unicode path is covered by the DOCX/HTML fixtures
page.drawText("unicode latin: cafe resume", { x: 60, y: 700, size: 14, font });
page.drawRectangle({ x: 60, y: 600, width: 200, height: 60, borderWidth: 1, borderColor: rgb(0, 0, 0) });
const pdf2 = await PDFDocument.create();
const page2 = pdf2.addPage([595, 842]);
const helv2 = await pdf2.embedFont(StandardFonts.Helvetica);
page2.drawText("second page", { x: 60, y: 780, size: 16, font: helv2 });
const [p1] = await pdf.copyPages(pdf2, [0]);
pdf.addPage(p1);
await write("g0-text.pdf", Buffer.from(await pdf.save()));

// ---- Markdown: table, code, unicode, relative image link ----
await write(
  "g0-notes.md",
  Buffer.from(
    [
      "---",
      "title: DOC-003 notes",
      "tags: [lab, office]",
      "---",
      "",
      "# DOC-003 notes",
      "",
      "Vietnamese: Tiếng Việt. Japanese: 日本語.",
      "",
      "| Feature | State |",
      "| --- | --- |",
      "| markdown | editing |",
      "| code | block |",
      "",
      "\u0060\u0060\u0060js",
      "const lab = true;",
      "\u0060\u0060\u0060",
      "",
      "![local asset](assets/dot.png)",
      "",
      "[relative link](./g0-html.html)",
      "",
    ].join("\n"),
    "utf8",
  ),
);

// ---- HTML: source with a script that must stay inert in the preview ----
await write(
  "g0-html.html",
  Buffer.from(
    [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="utf-8">',
      "  <title>DOC-003 HTML</title>",
      "  <style>body { font-family: system-ui, sans-serif; }</style>",
      "</head>",
      "<body>",
      "  <h1 id=\"doc003-title\">DOC-003 HTML fixture</h1>",
      "  <p id=\"doc003-para\">Vietnamese: Tiếng Việt.</p>",
      "  <table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>",
      "  <img src=\"assets/dot.png\" alt=\"dot\">",
      "  <script>document.title = 'mutated-by-inline-script';</script>",
      "</body>",
      "</html>",
      "",
    ].join("\n"),
    "utf8",
  ),
);

await write("assets.dummy", Buffer.from(""));
await mkdir(join(OUT, "assets"), { recursive: true });
// 1x1 transparent PNG used by the markdown and HTML fixtures
await write(
  join("assets", "dot.png"),
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

console.log(JSON.stringify({ out: OUT, files: written }, null, 2));
