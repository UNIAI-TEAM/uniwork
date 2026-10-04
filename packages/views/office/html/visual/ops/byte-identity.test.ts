import { describe, expect, it } from "vitest";
import { applyOp, expectByteIdentical, openFixture, outsideEditsUnchanged, type Edit } from "./test-fixture";
import {
  insertHtml,
  move,
  remove,
  replaceElement,
  setAttr,
  setInnerHtml,
  setStyle,
  setTag,
  setText,
  strReplace,
  unwrap,
  wrapText,
  type HtmlOpContext,
  elementByPath,
  HtmlOpError,
  type HtmlElementEntry,
} from "./index";

import type { UpstreamPatchSet } from "@uniwork/office-engine/html";

// The heart of the task. One kitchen-sink fixture exercises every byte a
// "looks equal" HTML writer would quietly normalise: a doctype, an XML
// declaration-ish comment, mixed single/double/unquoted attributes, entities,
// a raw <style> and <script> body, an HTML comment, a <pre> with tabs and
// trailing spaces, an inline SVG with foreign attributes, a void <img> with a
// spaced path, and a template's unrendered content. Each op below asserts the
// new source equals the original with EXACTLY the intended range replaced.

const FIXTURE = `<!doctype html>
<html lang="vi" data-build='7'>
<head>
  <meta charset="utf-8">
  <meta name=viewport content="width=device-width, initial-scale=1">
  <title>Báo cáo &amp; số liệu</title>
  <style>
    .card { color: #123456; padding: 8px 12px; }
    .card > .title::after { content: "→"; }
  </style>
  <script>var config = { "keep": "<b>raw</b>", n: 1 };</script>
</head>
<body class="page">
  <!-- giữ nguyên: đây là ghi chú tác giả, không được đổi một byte -->
  <main id="report" class="layout wide">
    <h1 class="title">Báo cáo tháng 10</h1>
    <p class="lede">Số liệu <b>quan trọng</b> và <i>ổn định</i>.</p>
    <pre class="code">
	giữ	tab		và khoảng trắng cuối   
</pre>
    <figure class="chart">
      <svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="0" y="0" width="10" height="10" fill="#0a0"></rect>
      </svg>
      <figcaption>Hình 1</figcaption>
    </figure>
    <img src="assets/biểu đồ.png" alt='Biểu đồ' width=320 height="180">
    <template id="row-tpl"><tr class="row"><td>chưa render</td></tr></template>
    <table class="t"><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
  </main>
  <footer>© 2026</footer>
</body>
</html>`;

const H1 = "html > body > main:nth-of-type(1) > h1:nth-of-type(1)";
const P = "html > body > main:nth-of-type(1) > p:nth-of-type(1)";
const IMG = "html > body > main:nth-of-type(1) > img:nth-of-type(1)";
const PRE = "html > body > main:nth-of-type(1) > pre:nth-of-type(1)";
const FIGURE = "html > body > main:nth-of-type(1) > figure:nth-of-type(1)";
const TABLE = "html > body > main:nth-of-type(1) > table:nth-of-type(1)";

function element(f: Awaited<ReturnType<typeof openFixture>>, path: string): HtmlElementEntry {
  const found = elementByPath(f.map, path);
  if (!found) throw new Error("fixture path missing: " + path);
  return found;
}

function context(f: Awaited<ReturnType<typeof openFixture>>): HtmlOpContext {
  return { text: f.text, map: f.map, version: f.version };
}

/** Assert the op applied AND that every byte outside the edits is unchanged,
 * through both the constructive check and the direct outside-range scan. */
function expectOp(
  source: string,
  after: string,
  edits: readonly Edit[],
  label: string,
): void {
  expectByteIdentical(source, after, edits, label);
  expect(outsideEditsUnchanged(source, after, edits)).toBe(true);
}

describe("byte identity outside the edited range (kitchen-sink fixture)", () => {
  it("the fixture is preserved verbatim by the engine on open", async () => {
    const f = await openFixture(FIXTURE);
    expect(f.text).toBe(FIXTURE);
  });

  it("str_replace changes only the needle, leaving the comment and style bytes", async () => {
    const f = await openFixture(FIXTURE);
    const after = applyOp(f, strReplace(context(f), "quan trọng", "cốt lõi"));
    const at = FIXTURE.indexOf("quan trọng");
    expectOp(FIXTURE, after, [{ from: at, to: at + "quan trọng".length, text: "cốt lõi" }], "str_replace");
    expect(after).toContain("<!-- giữ nguyên: đây là ghi chú tác giả, không được đổi một byte -->");
    expect(after).toContain(".card > .title::after { content: \"→\"; }");
    expect(after).toContain('<script>var config = { "keep": "<b>raw</b>", n: 1 };</script>');
  });

  it("replace_element swaps only the h1 range and leaves its siblings byte-equal", async () => {
    const f = await openFixture(FIXTURE);
    const h1 = element(f, H1);
    const after = applyOp(f, replaceElement(context(f), { sid: h1.sid }, '<h1 class="title" id="top">Báo cáo</h1>'));
    expectOp(FIXTURE, after, [{ from: h1.range[0], to: h1.range[1], text: '<h1 class="title" id="top">Báo cáo</h1>' }], "replace_element");
    expect(after).toContain("<pre class=\"code\">");
    expect(after).toContain("width=320");
  });

  it("set_inner_html keeps the exact start tag including unquoted attributes", async () => {
    const f = await openFixture(FIXTURE);
    const img = element(f, IMG);
    const after = applyOp(f, setInnerHtml(context(f), { sid: img.sid }, ""));
    // img is void: its inner is empty, so this is a genuine no-op patch set.
    expect(after).toBe(FIXTURE);
    expect(img.endTag).toBeNull();
  });

  it("set_text escapes markup and touches only the element content", async () => {
    const f = await openFixture(FIXTURE);
    const p = element(f, P);
    const after = applyOp(f, setText(context(f), { sid: p.sid }, "a < b & c"));
    expectOp(FIXTURE, after, [{ from: p.inner[0], to: p.inner[1], text: "a &lt; b &amp; c" }], "set_text");
    expect(after).toContain('<p class="lede">');
  });

  it("insert_html appends inside the figure without reflowing the SVG bytes", async () => {
    const f = await openFixture(FIXTURE);
    const figure = element(f, FIGURE);
    const after = applyOp(f, insertHtml(context(f), "<span>nhãn</span>", { appendTo: { sid: figure.sid } }));
    expectOp(FIXTURE, after, [{ from: figure.inner[1], to: figure.inner[1], text: "<span>nhãn</span>" }], "insert_html");
    expect(after).toContain('<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">');
  });

  it("remove deletes only the table, leaving the template's raw row intact", async () => {
    const f = await openFixture(FIXTURE);
    const table = element(f, TABLE);
    const after = applyOp(f, remove(context(f), { sid: table.sid }));
    expectOp(FIXTURE, after, [{ from: table.range[0], to: table.range[1], text: "" }], "remove");
    expect(after).toContain('<template id="row-tpl"><tr class="row"><td>chưa render</td></tr></template>');
  });

  it("move relocates the figure bytes verbatim, keeping the pre's tabs and trailing spaces", async () => {
    const f = await openFixture(FIXTURE);
    const figure = element(f, FIGURE);
    const img = element(f, IMG);
    const moved = FIXTURE.slice(figure.range[0], figure.range[1]);
    const after = applyOp(f, move(context(f), { sid: figure.sid }, { after: { sid: img.sid } }));
    expectOp(FIXTURE, after, [
      { from: figure.range[0], to: figure.range[1], text: "" },
      { from: img.range[1], to: img.range[1], text: moved },
    ], "move");
    expect(after).toContain("\tgiữ\ttab\t\tvà khoảng trắng cuối   \n");
  });

  it("set_attr edits only the quoted value and preserves every other attribute's quoting", async () => {
    const f = await openFixture(FIXTURE);
    const img = element(f, IMG);
    const after = applyOp(f, setAttr(context(f), { sid: img.sid }, "alt", "Biểu đồ mới"));
    const at = FIXTURE.indexOf("alt='Biểu đồ'");
    expectOp(FIXTURE, after, [{ from: at + 5, to: at + 5 + "Biểu đồ".length, text: "Biểu đồ mới" }], "set_attr");
    // The single-quoted alt stays single-quoted; width stays unquoted.
    expect(after).toContain("alt='Biểu đồ mới'");
    expect(after).toContain("width=320");
    expect(after).toContain('height="180"');
  });

  it("set_style merges into the class-preserving element without rewriting neighbours", async () => {
    const f = await openFixture(FIXTURE);
    const img = element(f, IMG);
    const after = applyOp(f, setStyle(context(f), { sid: img.sid }, { fit: "cover", align: "right" }));
    expectOp(FIXTURE, after, [
      { from: img.startTag[1] - 1, to: img.startTag[1] - 1, text: ' style="object-fit:cover;display:block;margin-left:auto"' },
    ], "set_style");
    expect(after).toContain('<meta name=viewport content="width=device-width, initial-scale=1">');
  });

  it("set_tag renames the tag in place, keeping attributes and content bytes", async () => {
    const f = await openFixture(FIXTURE);
    const h1 = element(f, H1);
    const after = applyOp(f, setTag(context(f), { sid: h1.sid }, "h2"));
    expectOp(FIXTURE, after, [
      { from: h1.startTag[0] + 1, to: h1.startTag[0] + 3, text: "h2" },
      { from: h1.endTag![0] + 2, to: h1.endTag![0] + 4, text: "h2" },
    ], "set_tag");
    expect(after).toContain('<h2 class="title">Báo cáo tháng 10</h2>');
  });

  it("wrap_text brackets a range without disturbing the wrapped bytes", async () => {
    const f = await openFixture(FIXTURE);
    const p = element(f, P);
    const after = applyOp(f, wrapText(context(f), [p.inner[0], p.inner[1]], "mark"));
    expectOp(FIXTURE, after, [
      { from: p.inner[0], to: p.inner[0], text: "<mark>" },
      { from: p.inner[1], to: p.inner[1], text: "</mark>" },
    ], "wrap_text");
  });

  it("unwrap drops the <pre> tags but keeps its whitespace bytes exactly", async () => {
    const f = await openFixture(FIXTURE);
    const pre = element(f, PRE);
    const inner = FIXTURE.slice(pre.inner[0], pre.inner[1]);
    const after = applyOp(f, unwrap(context(f), { sid: pre.sid }));
    expectOp(FIXTURE, after, [{ from: pre.range[0], to: pre.range[1], text: inner }], "unwrap");
    expect(after).toContain("\tgiữ\ttab\t\tvà khoảng trắng cuối   \n");
    expect(after).not.toContain("<pre class=\"code\">");
  });

  it("a batch of ops applied in sequence keeps the outside bytes stable at each step", async () => {
    // Each op is applied to a FRESH session so every patch set is validated
    // against its own revision; the invariant under test is per op, over the
    // same kitchen-sink source.
    const ops: Array<[string, (f: Awaited<ReturnType<typeof openFixture>>) => UpstreamPatchSet, (f: Awaited<ReturnType<typeof openFixture>>) => Edit[]]> = [
      ["set_tag", (f) => setTag(context(f), { sid: element(f, H1).sid }, "h2"), (f) => [
        { from: element(f, H1).startTag[0] + 1, to: element(f, H1).startTag[0] + 3, text: "h2" },
        { from: element(f, H1).endTag![0] + 2, to: element(f, H1).endTag![0] + 4, text: "h2" },
      ]],
      ["set_attr", (f) => setAttr(context(f), { sid: element(f, IMG).sid }, "loading", "lazy"), (f) => [
        { from: element(f, IMG).startTag[1] - 1, to: element(f, IMG).startTag[1] - 1, text: ' loading="lazy"' },
      ]],
      ["str_replace", (f) => strReplace(context(f), "Hình 1", "Hình 2"), () => {
        const at = FIXTURE.indexOf("Hình 1");
        return [{ from: at, to: at + "Hình 1".length, text: "Hình 2" }];
      }],
    ];
    for (const [label, build, edits] of ops) {
      const f = await openFixture(FIXTURE);
      const after = applyOp(f, build(f));
      expectOp(FIXTURE, after, edits(f), "batch:" + label);
    }
  });
});
