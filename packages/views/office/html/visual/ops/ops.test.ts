import { describe, expect, it } from "vitest";
import { applyOp, expectByteIdentical, openFixture, type OpenFixture } from "./test-fixture";
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
  setTextNode,
  strReplace,
  unwrap,
  wrapText,
  type HtmlOpContext,
  elementByPath,
  HtmlOpError,
} from "./index";


const SOURCE = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Ti</title></head>
<body>
  <main id="m">
    <h1 class='t'>Chào</h1>
    <!-- keep this comment -->
    <p class="a">Đoạn <b>đậm</b> thường</p>
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

const P = "html > body > main:nth-of-type(1) > p:nth-of-type(1)";
const H1 = "html > body > main:nth-of-type(1) > h1:nth-of-type(1)";
const IMG = "html > body > main:nth-of-type(1) > img:nth-of-type(1)";
const B = "html > body > main:nth-of-type(1) > p:nth-of-type(1) > b:nth-of-type(1)";

describe("html visual ops: one test per op", () => {
  it("str_replace: replaces only the matched bytes", async () => {
    const f = await fixture();
    const set = strReplace(context(f), "đậm", "mạnh");
    expect(set.origin).toBe("inspector");
    const after = applyOp(f, set);
    const at = SOURCE.indexOf("đậm");
    expectByteIdentical(SOURCE, after, [{ from: at, to: at + "đậm".length, text: "mạnh" }], "str_replace");
  });

  it("str_replace: scoped to an element and replacing all occurrences", async () => {
    const f = await fixture();
    const p = elementByPath(f.map, P)!;
    const set = strReplace(context(f), "n", "N", { target: { sid: p.sid }, all: true });
    const after = applyOp(f, set);
    const inner = SOURCE.slice(p.inner[0], p.inner[1]);
    const edits = [...inner.matchAll(/n/g)].map((m) => ({
      from: p.inner[0] + m.index,
      to: p.inner[0] + m.index + 1,
      text: "N",
    }));
    expect(edits.length).toBeGreaterThan(0);
    expectByteIdentical(SOURCE, after, edits, "str_replace-all");
    // Every edit landed inside the element, so the h1 text is untouched.
    expect(after).toContain("Chào");
  });

  // A case-insensitive match must report SOURCE offsets. "İ" (U+0130) folds to
  // two code units ("i" + U+0307), so reading positions off a folded haystack
  // used to shift every later match and to size the patch from the needle
  // rather than the matched span. Each case below is a reviewer repro.
  describe("str_replace: case-insensitive matches never drift off the source", () => {
    it("replaces a match after a length-expanding fold", async () => {
      const source = "<p>İstanbul and apples</p>";
      const f = await openFixture(source);
      const after = applyOp(f, strReplace(context(f), "apples", "ORANGES"));
      const at = source.indexOf("apples");
      expectByteIdentical(source, after, [{ from: at, to: at + "apples".length, text: "ORANGES" }], "str_replace:after-fold");
      expect(after).toBe("<p>İstanbul and ORANGES</p>");
    });

    it("replaces every match after a length-expanding fold", async () => {
      const source = "<p>cat İ cat cat</p>";
      const f = await openFixture(source);
      const after = applyOp(f, strReplace(context(f), "cat", "dog", { all: true }));
      const edits = [...source.matchAll(/cat/g)].map((m) => ({ from: m.index!, to: m.index! + 3, text: "dog" }));
      expectByteIdentical(source, after, edits, "str_replace:all-after-fold");
      expect(after).toBe("<p>dog İ dog dog</p>");
    });

    it("patches the whole source span when the needle folds to two code units", async () => {
      const source = "<p>i\u0307x done</p>"; // i + U+0307, the fold of İ
      const f = await openFixture(source);
      const after = applyOp(f, strReplace(context(f), "İ", "Q"));
      expectByteIdentical(source, after, [{ from: 3, to: 5, text: "Q" }], "str_replace:expanding-span");
      expect(after).toBe("<p>Qx done</p>");
    });

    it("patches the one-code-unit source span when the needle is the fold", async () => {
      const source = "<p>İx end</p>";
      const f = await openFixture(source);
      const after = applyOp(f, strReplace(context(f), "i\u0307", "Q"));
      expectByteIdentical(source, after, [{ from: 3, to: 4, text: "Q" }], "str_replace:contracting-span");
      expect(after).toBe("<p>Qx end</p>");
    });
  });

  it("replace_element: swaps the whole element, tags included", async () => {
    const f = await fixture();
    const element = elementByPath(f.map, H1)!;
    const set = replaceElement(context(f), { sid: element.sid }, "<h2>Mới</h2>");
    const after = applyOp(f, set);
    expectByteIdentical(SOURCE, after, [{ from: element.range[0], to: element.range[1], text: "<h2>Mới</h2>" }], "replace_element");
  });

  it("set_inner_html: replaces content, keeps the start and end tags", async () => {
    const f = await fixture();
    const element = elementByPath(f.map, P)!;
    const set = setInnerHtml(context(f), { sid: element.sid }, "Mới <i>in</i>");
    const after = applyOp(f, set);
    expectByteIdentical(SOURCE, after, [{ from: element.inner[0], to: element.inner[1], text: "Mới <i>in</i>" }], "set_inner_html");
    expect(after.startsWith('<p class="a">Mới <i>in</i></p>', element.range[0])).toBe(true);
  });

  it("set_text: escapes the text it writes into the element", async () => {
    const f = await fixture();
    const element = elementByPath(f.map, P)!;
    const set = setText(context(f), { sid: element.sid }, "a & b < c");
    const after = applyOp(f, set);
    expectByteIdentical(SOURCE, after, [{ from: element.inner[0], to: element.inner[1], text: "a &amp; b &lt; c" }], "set_text");
  });

  it("insert_html: before, after, appendTo and an absolute offset", async () => {
    const cases: Array<[string, (p: { sid: number; range: [number, number]; inner: [number, number] }) => Parameters<typeof insertHtml>[2], (p: { range: [number, number]; inner: [number, number] }) => number]> = [
      ["before", (p) => ({ before: { sid: p.sid } }), (p) => p.range[0]],
      ["after", (p) => ({ after: { sid: p.sid } }), (p) => p.range[1]],
      ["appendTo", (p) => ({ appendTo: { sid: p.sid } }), (p) => p.inner[1]],
      ["at", () => ({ at: 12 }), () => 12],
    ];
    for (const [label, position, offset] of cases) {
      // A fresh session per case: each apply bumps the revision, and a second
      // apply against the old baseVersion is correctly refused as stale.
      const f = await fixture();
      const p = elementByPath(f.map, P)!;
      const at = offset(p);
      const after = applyOp(f, insertHtml(context(f), "<hr>", position(p)));
      expectByteIdentical(SOURCE, after, [{ from: at, to: at, text: "<hr>" }], "insert_html:" + label);
    }
  });

  it("remove: deletes exactly the element range", async () => {
    const f = await fixture();
    const element = elementByPath(f.map, H1)!;
    const after = applyOp(f, remove(context(f), { sid: element.sid }));
    expectByteIdentical(SOURCE, after, [{ from: element.range[0], to: element.range[1], text: "" }], "remove");
    expect(after).not.toContain("Chào");
  });

  it("move: deletes the source range and inserts the same bytes elsewhere", async () => {
    const f = await fixture();
    const h1 = elementByPath(f.map, H1)!;
    const p = elementByPath(f.map, P)!;
    const moved = SOURCE.slice(h1.range[0], h1.range[1]);
    const after = applyOp(f, move(context(f), { sid: h1.sid }, { after: { sid: p.sid } }));
    expectByteIdentical(SOURCE, after, [
      { from: h1.range[0], to: h1.range[1], text: "" },
      { from: p.range[1], to: p.range[1], text: moved },
    ], "move");
  });

  it("move: refuses a destination inside the moved element", async () => {
    const f = await fixture();
    const p = elementByPath(f.map, P)!;
    const b = elementByPath(f.map, B)!;
    expect(() => move(context(f), { sid: p.sid }, { before: { sid: b.sid } })).toThrow(HtmlOpError);
    try {
      move(context(f), { sid: p.sid }, { before: { sid: b.sid } });
    } catch (error) {
      expect((error as HtmlOpError).code).toBe("invalid_move");
    }
  });

  it("set_attr: replaces an existing value in place", async () => {
    const f = await fixture();
    const img = elementByPath(f.map, IMG)!;
    const after = applyOp(f, setAttr(context(f), { sid: img.sid }, "alt", "Ảnh mới"));
    const at = SOURCE.indexOf('alt="Ảnh"');
    expectByteIdentical(SOURCE, after, [{ from: at + 5, to: at + 5 + "Ảnh".length, text: "Ảnh mới" }], "set_attr:replace");
  });

  it("set_attr: adds a missing attribute and removes one", async () => {
    const addedFixture = await fixture();
    const addedImg = elementByPath(addedFixture.map, IMG)!;
    const added = applyOp(addedFixture, setAttr(context(addedFixture), { sid: addedImg.sid }, "loading", "lazy"));
    expectByteIdentical(SOURCE, added, [{ from: addedImg.startTag[1] - 1, to: addedImg.startTag[1] - 1, text: ' loading="lazy"' }], "set_attr:add");

    const removedFixture = await fixture();
    const removedImg = elementByPath(removedFixture.map, IMG)!;
    const removed = applyOp(removedFixture, setAttr(context(removedFixture), { sid: removedImg.sid }, "width", null));
    const at = SOURCE.indexOf("width=10");
    expectByteIdentical(SOURCE, removed, [{ from: at - 1, to: at + "width=10".length, text: "" }], "set_attr:remove");
  });

  // A quoted attribute's `valueEnd` sits INSIDE the closing quote, and a
  // valueless attribute's value position is the end of its name - not the next
  // token. Removing a quoted attribute used to stop mid-attribute and setting a
  // value on a valueless one used to splice into the next attribute's name.
  describe("set_attr: quoted removal and valueless attributes stay well-formed", () => {
    async function only(source: string, name: string, value: string | null): Promise<string> {
      const f = await openFixture(source);
      const root = f.map.elements.find((element) => element.parentSid === null && element.tag !== "html") ?? f.map.elements[0]!;
      return applyOp(f, setAttr(context(f), { sid: root.sid }, name, value));
    }

    it("removes a double-quoted attribute including its quotes", async () => {
      expect(await only('<img src="a.png" alt="x">', "alt", null)).toBe('<img src="a.png">');
    });

    it("removes a double-quoted attribute before another attribute", async () => {
      expect(await only('<div class="x" id="y">', "class", null)).toBe('<div id="y">');
    });

    it("removes a single-quoted attribute including its quotes", async () => {
      expect(await only("<img src='a.png' alt='x'>", "alt", null)).toBe("<img src='a.png'>");
    });

    it("removes a valueless attribute without eating the next one's name", async () => {
      expect(await only('<input disabled type="text">', "disabled", null)).toBe('<input type="text">');
    });

    it("adds a value to a valueless attribute", async () => {
      expect(await only("<div hidden>", "hidden", "yes")).toBe('<div hidden="yes">');
    });

    it("adds a value to a valueless attribute followed by another", async () => {
      expect(await only('<div hidden class="c">', "hidden", "yes")).toBe('<div hidden="yes" class="c">');
    });

    it("sets style on an element whose style attribute is valueless", async () => {
      const source = '<div style id="x">';
      const f = await openFixture(source);
      const div = f.map.elements[0]!;
      expect(applyOp(f, setStyle(context(f), { sid: div.sid }, { width: 40 }))).toBe('<div style="width:40px" id="x">');
    });
  });

  it("set_style: merges with the author's style and keeps other declarations", async () => {
    const f = await fixture();
    const img = elementByPath(f.map, IMG)!;
    const styled = applyOp(f, setStyle(context(f), { sid: img.sid }, { width: 200, align: "center" }));
    expectByteIdentical(SOURCE, styled, [
      { from: img.startTag[1] - 1, to: img.startTag[1] - 1, text: ' style="width:200px;display:block;margin-left:auto;margin-right:auto"' },
    ], "set_style:add");
  });

  it("set_style: replaces only the named properties of an existing style", async () => {
    const source = '<p style="color:red;width:10px">x</p>';
    const f = await openFixture(source);
    const p = elementByPath(f.map, "p:nth-of-type(1)")!;
    const after = applyOp(f, setStyle(context(f), { sid: p.sid }, { width: 40 }));
    const at = source.indexOf("width:10px");
    expectByteIdentical(source, after, [{ from: at, to: at + "width:10px".length, text: "width:40px" }], "set_style:merge");
    expect(after).toContain("color:red");
  });

  it("set_tag: renames both the start and the end tag", async () => {
    const f = await fixture();
    const h1 = elementByPath(f.map, H1)!;
    const after = applyOp(f, setTag(context(f), { sid: h1.sid }, "h2"));
    expectByteIdentical(SOURCE, after, [
      { from: h1.startTag[0] + 1, to: h1.startTag[0] + 3, text: "h2" },
      { from: h1.endTag![0] + 2, to: h1.endTag![0] + 4, text: "h2" },
    ], "set_tag");
    expect(after).toContain("<h2 class='t'>");
  });

  it("set_tag: renames only the start tag of a void element", async () => {
    const f = await fixture();
    const img = elementByPath(f.map, IMG)!;
    const after = applyOp(f, setTag(context(f), { sid: img.sid }, "picture"));
    expectByteIdentical(SOURCE, after, [{ from: img.startTag[0] + 1, to: img.startTag[0] + 4, text: "picture" }], "set_tag:void");
  });

  it("set_text_node: replaces one direct text node", async () => {
    const f = await fixture();
    const p = elementByPath(f.map, P)!;
    const node = p.textNodes[0]!;
    const after = applyOp(f, setTextNode(context(f), { sid: p.sid }, 0, "Đoạn mới "));
    expectByteIdentical(SOURCE, after, [{ from: node[0], to: node[1], text: "Đoạn mới " }], "set_text_node");
    expect(after).toContain("<b>đậm</b>");
  });

  it("set_text_node: throws when there is no text node at the index", async () => {
    const f = await fixture();
    const b = elementByPath(f.map, B)!;
    expect(() => setTextNode(context(f), { sid: b.sid }, 5, "x")).toThrow(HtmlOpError);
  });

  it("wrap_text: brackets a range without touching the wrapped bytes", async () => {
    const f = await fixture();
    const b = elementByPath(f.map, B)!;
    const after = applyOp(f, wrapText(context(f), [b.inner[0], b.inner[1]], "strong"));
    expectByteIdentical(SOURCE, after, [
      { from: b.inner[0], to: b.inner[0], text: "<strong>" },
      { from: b.inner[1], to: b.inner[1], text: "</strong>" },
    ], "wrap_text");
    expect(after).toContain("<strong>đậm</strong>");
  });

  it("unwrap: replaces the element with its own inner content", async () => {
    const f = await fixture();
    const b = elementByPath(f.map, B)!;
    const inner = SOURCE.slice(b.inner[0], b.inner[1]);
    const after = applyOp(f, unwrap(context(f), { sid: b.sid }));
    expectByteIdentical(SOURCE, after, [{ from: b.range[0], to: b.range[1], text: inner }], "unwrap");
    expect(after).toContain("Đoạn đậm thường");
    expect(after).not.toContain("<b>");
  });

  it("unwrap: refuses a void element that has no end tag", async () => {
    const f = await fixture();
    const img = elementByPath(f.map, IMG)!;
    expect(() => unwrap(context(f), { sid: img.sid })).toThrow(HtmlOpError);
  });
});
