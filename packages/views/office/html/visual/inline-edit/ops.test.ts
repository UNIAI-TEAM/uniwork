import { describe, expect, it } from "vitest";
import { applyOp, expectByteIdentical, openFixture, type OpenFixture } from "../ops/test-fixture";
import { elementByPath, HtmlOpError, type HtmlOpContext } from "../ops";
import { moveSelectionOp, resizeSelectionOp, textEditOp, type ResizeInput } from "./index";

const SOURCE = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Ti</title></head>
<body>
  <main id="m">
    <h1 class='t'>Chào</h1>
    <p class="a">Đoạn <b>đậm</b> thường</p>
    <p class="b">Hai</p>
    <img src="a b.png" alt="Ảnh" width=10>
  </main>
</body></html>`;

async function fixture(): Promise<OpenFixture> {
  return openFixture(SOURCE);
}

function context(f: OpenFixture): HtmlOpContext {
  return { text: f.text, map: f.map, version: f.version };
}

function sid(f: OpenFixture, path: string): number {
  const element = elementByPath(f.map, path);
  if (!element) throw new Error("fixture path missing: " + path);
  return element.sid;
}

const P1 = "html > body > main:nth-of-type(1) > p:nth-of-type(1)";
const P2 = "html > body > main:nth-of-type(1) > p:nth-of-type(2)";
const H1 = "html > body > main:nth-of-type(1) > h1:nth-of-type(1)";
const IMG = "html > body > main:nth-of-type(1) > img:nth-of-type(1)";

describe("textEditOp: committed text edit -> set_text / set_inner_html", () => {
  it("a plain-text element takes set_text and escapes the committed text", async () => {
    const f = await fixture();
    const h1 = elementByPath(f.map, H1)!;
    const set = textEditOp(context(f), { sid: h1.sid, text: "a < b & c" })!;
    expect(set.label).toBe("set_text");
    const after = applyOp(f, set);
    expectByteIdentical(SOURCE, after, [{ from: h1.inner[0], to: h1.inner[1], text: "a &lt; b &amp; c" }], "set_text");
  });

  it("an element with child markup takes set_inner_html with escaped text", async () => {
    const f = await fixture();
    const p = elementByPath(f.map, P1)!;
    const set = textEditOp(context(f), { sid: p.sid, text: "Đoạn mạnh thường" })!;
    expect(set.label).toBe("set_inner_html");
    const after = applyOp(f, set);
    // The child <b> is replaced by plain text; the tags are gone.
    expectByteIdentical(SOURCE, after, [{ from: p.inner[0], to: p.inner[1], text: "Đoạn mạnh thường" }], "set_inner_html");
    expect(after).not.toContain("<b>đậm</b>");
  });

  it("escapes a markup-looking payload so it lands as inert text", async () => {
    const f = await fixture();
    const p = elementByPath(f.map, P2)!;
    const set = textEditOp(context(f), { sid: p.sid, text: '<img src=x onerror="alert(1)">' })!;
    const after = applyOp(f, set);
    expect(after).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(after).not.toContain("<img src=x");
  });

  it("an unchanged commit is no op: the element keeps its markup and whitespace", async () => {
    const f = await fixture();
    // The frame reports the element's normalised text; for <p class="a"> that is the same words.
    expect(textEditOp(context(f), { sid: sid(f, P1), text: "Đoạn đậm thường" })).toBeNull();
    expect(textEditOp(context(f), { sid: sid(f, P2), text: "Hai" })).toBeNull();
  });

  it("an unchanged commit ignores source whitespace, entities and a script child", async () => {
    const g = await openFixture('<div id="d">\n  a&nbsp;<b>b</b>\n  &amp; c <script>x()</script></div><pre id="e">p\n  q</pre>');
    const ctx = context(g);
    expect(textEditOp(ctx, { sid: sid(g, "div:nth-of-type(1)"), text: "a b & c" })).toBeNull();
    expect(textEditOp(ctx, { sid: sid(g, "pre:nth-of-type(1)"), text: "p q" })).toBeNull();
    expect(textEditOp(ctx, { sid: sid(g, "div:nth-of-type(1)"), text: "a b & d" })).not.toBeNull();
  });

  it("a changed commit still edits", async () => {
    const f = await fixture();
    expect(textEditOp(context(f), { sid: sid(f, P2), text: "Ba" })).not.toBeNull();
  });

  it("throws HtmlOpError for a void element (the controller turns it into no-op)", async () => {
    const f = await fixture();
    const img = elementByPath(f.map, IMG)!;
    expect(() => textEditOp(context(f), { sid: img.sid, text: "x" })).toThrow(HtmlOpError);
  });
});

describe("moveSelectionOp: move up/down -> move", () => {
  it("moves an element before its previous sibling", async () => {
    const f = await fixture();
    const p1 = elementByPath(f.map, P1)!;
    const set = moveSelectionOp(context(f), p1.sid, "up");
    expect(set).not.toBeNull();
    expect(set!.label).toBe("move");
    const after = applyOp(f, set!);
    // p1 moves before its previous sibling h1: it now leads the list.
    expect(after.indexOf("Đoạn")).toBeLessThan(after.indexOf("Hai"));
    expect(after.indexOf("Đoạn")).toBeLessThan(after.indexOf("Chào"));
  });

  it("moves an element after its next sibling", async () => {
    const f = await fixture();
    const p1 = elementByPath(f.map, P1)!;
    const after = applyOp(f, moveSelectionOp(context(f), p1.sid, "down")!);
    // p1 moves after its next sibling p2: the two paragraphs swapped.
    expect(after.indexOf("Hai")).toBeLessThan(after.indexOf("Đoạn"));
  });

  it("returns null at the edge of the sibling list", async () => {
    const f = await fixture();
    // The first child of <main> has no previous sibling.
    const h1 = elementByPath(f.map, H1)!;
    expect(moveSelectionOp(context(f), h1.sid, "up")).toBeNull();
  });
});

describe("resizeSelectionOp: resize -> set_style", () => {
  it("writes clamped pixel dimensions", async () => {
    const f = await fixture();
    const img = elementByPath(f.map, IMG)!;
    const size: ResizeInput = { width: 120.4, height: 0 };
    const set = resizeSelectionOp(context(f), img.sid, size);
    expect(set).not.toBeNull();
    expect(set!.label).toBe("set_style");
    const after = applyOp(f, set!);
    expect(after).toContain('style="width:120px;height:1px"');
    // The author's other attributes are untouched.
    expect(after).toContain('alt="Ảnh" width=10');
  });

  it("returns null when neither dimension is a usable number", async () => {
    const f = await fixture();
    const img = elementByPath(f.map, IMG)!;
    expect(resizeSelectionOp(context(f), img.sid, {})).toBeNull();
    expect(resizeSelectionOp(context(f), img.sid, { width: Number.NaN })).toBeNull();
  });
});
