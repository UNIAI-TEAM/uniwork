// Guards the Office page capture samples: the Slides deck is a five-slide business deck and the PDF is a
// multi-section report, in both languages, and neither says what the page may not claim.
// Run: node --test scripts/office-landing/samples.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { deckSlides } from "./deck.mjs";
import { REPORT_PDF_OPTIONS, reportHtml } from "./report.mjs";
import { buildPptx } from "./samples.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const JSZip = createRequire(join(repoRoot, "e2e", "package.json"))("jszip");
const fixture = readFileSync(join(repoRoot, "docs/office/g0/fixtures/files/slides/pptx-standard-business.pptx"));
const BANNED = /github|genspark|genoffice|open[- ]source|miễn phí|image generation|tạo ảnh/i;
const texts = (xml) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((match) => match[1]);

for (const lang of ["vi", "en"]) {
  test(`the ${lang} deck has title, agenda, chart and table, timeline and team slides`, async () => {
    const slides = deckSlides(lang);
    assert.equal(slides.length, 5);
    for (const xml of slides) {
      const ids = [...xml.matchAll(/<p:cNvPr id="(\d+)"/g)].map((match) => match[1]);
      assert.equal(new Set(ids).size, ids.length, "shape ids are unique within a slide");
      assert.equal((xml.match(/<p:ph type="title"\/>/g) ?? []).length, 1, "one title placeholder");
    }
    assert.match(slides[2], /<a:tbl>/, "the chart slide carries a table");
    assert.ok((slides[2].match(/name="Bar /g) ?? []).length >= 4, "and four bars");
    assert.ok((slides[3].match(/name="Milestone /g) ?? []).length >= 4, "the timeline has milestones");
    assert.ok((slides[4].match(/name="Avatar /g) ?? []).length >= 4, "the team slide has people");
    assert.ok(texts(slides.join("")).length > 60, "a real amount of text");
    assert.doesNotMatch(slides.join(""), BANNED);
  });

  test(`the ${lang} pptx keeps five slide parts, their layouts and drops the unused picture`, async () => {
    const zip = await JSZip.loadAsync(await buildPptx(JSZip, fixture, lang));
    for (let index = 1; index <= 5; index += 1) {
      assert.ok(zip.file(`ppt/slides/slide${index}.xml`), `slide${index}.xml`);
      assert.match(await zip.file(`ppt/slides/_rels/slide${index}.xml.rels`).async("string"), /slideLayout\d+\.xml/);
    }
    assert.equal(zip.file("ppt/media/image1.png"), null);
    assert.match(await zip.file("ppt/slides/slide1.xml").async("string"), lang === "vi" ? /Kết quả kinh doanh quý 3/ : /Q3 business results/);
  });

  test(`the ${lang} report is three pages with headings and tables`, () => {
    const html = reportHtml(lang);
    assert.equal((html.match(/<section class="page">/g) ?? []).length, 3);
    assert.ok((html.match(/<h2>/g) ?? []).length >= 6, "six numbered sections");
    assert.equal((html.match(/<table>/g) ?? []).length, 3);
    assert.match(html, /<h1>/);
    assert.doesNotMatch(html, BANNED);
  });
}

test("the report prints with backgrounds and page numbers", () => {
  assert.equal(REPORT_PDF_OPTIONS.printBackground, true);
  assert.match(REPORT_PDF_OPTIONS.footerTemplate, /pageNumber/);
  assert.match(REPORT_PDF_OPTIONS.footerTemplate, /totalPages/);
});
