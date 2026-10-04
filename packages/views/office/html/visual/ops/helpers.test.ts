import { describe, expect, it } from "vitest";
// Imported through the barrel: this test is what keeps the package's public
// surface (index.ts) reachable, so knip does not read the barrel as dead code.
import {
  assertMovable,
  blockquotePreset,
  buttonPreset,
  elementByPath,
  escapeHtmlText,
  HEADING_LEVELS,
  headingPreset,
  horizontalRulePreset,
  HtmlOpError,
  imagePreset,
  imageStyleDeclarations,
  imageStyleValue,
  isImageAlign,
  isImageFit,
  listPreset,
  mergeImageStyle,
  paragraphPreset,
  readImageStyle,
  resolveMoveDestination,
  sectionPreset,
  siblingInDirection,
  siblingMoveDestination,
  tablePreset,
  targetAncestors,
} from "./index";
import { buildFixtureParseMap } from "./test-fixture";

const SOURCE = `<main id="m"><h1>A</h1><p>B</p><p>C</p></main>`;

describe("insert-presets", () => {
  it("escapes author text and emits no style attributes", () => {
    expect(escapeHtmlText("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
    expect(headingPreset(2, { text: "Tiêu đề" })).toBe("<h2>Tiêu đề</h2>");
    expect(paragraphPreset({ text: "a & b" })).toBe("<p>a &amp; b</p>");
    expect(blockquotePreset({ text: "q" })).toBe("<blockquote>q</blockquote>");
    expect(horizontalRulePreset()).toBe("<hr>");
  });

  it("builds lists, sections, buttons and images", () => {
    expect(listPreset("ordered", ["a", "b"])).toBe("<ol><li>a</li><li>b</li></ol>");
    expect(listPreset("unordered")).toBe("<ul></ul>");
    expect(sectionPreset({ id: "s1", className: "c", inner: "<p>x</p>" })).toBe('<section id="s1" class="c"><p>x</p></section>');
    expect(buttonPreset({ label: "Lưu", type: "submit" })).toBe('<button type="submit">Lưu</button>');
    expect(buttonPreset({ label: "Đi", href: "/x" })).toBe('<a href="/x">Đi</a>');
    expect(imagePreset({ src: "a.png", alt: "Ảnh", width: 40 })).toBe('<img src="a.png" alt="Ảnh" width="40">');
  });

  it("builds a table with an optional header row and clamps dimensions", () => {
    const table = tablePreset({ rows: 1, columns: 2, header: true, cells: [["H1", "H2"], ["a", "b"]] });
    expect(table).toBe("<table><thead><tr><th>H1</th><th>H2</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>");
    expect(tablePreset({ rows: 1, columns: 0 }).match(/<td>/g)).toHaveLength(1);
    expect(tablePreset({ rows: 0, columns: 1 }).match(/<tr>/g)).toHaveLength(1);
  });

  it("exposes the ribbon's heading levels in order", () => {
    expect(HEADING_LEVELS).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("image-style", () => {
  it("turns a fit and alignment into declarations in a stable order", () => {
    expect(imageStyleDeclarations({ width: 200, fit: "cover", align: "center" })).toEqual([
      "width:200px",
      "object-fit:cover",
      "display:block",
      "margin-left:auto",
      "margin-right:auto",
    ]);
    expect(imageStyleValue({ align: "left" })).toBe("display:block;margin-right:auto");
    expect(imageStyleValue({ align: "right" })).toBe("display:block;margin-left:auto");
    expect(imageStyleValue({ width: 50, widthUnit: "%" })).toBe("width:50%");
  });

  it("fills the locked dimension from the natural ratio", () => {
    expect(imageStyleDeclarations({ width: 200, aspectLock: true, aspectRatio: 2 })).toEqual(["width:200px", "height:100px"]);
    expect(imageStyleDeclarations({ width: 200, aspectLock: true })).toEqual(["width:200px"]);
  });

  it("merges new declarations and keeps the author's other properties", () => {
    expect(mergeImageStyle("color:red;width:10px", ["width:40px"])).toBe("color:red;width:40px");
    expect(mergeImageStyle("color:red", ["object-fit:cover"], ["color"])).toBe("object-fit:cover");
    expect(mergeImageStyle("", [])).toBe("");
  });

  it("reads back a style it wrote and validates the enum values", () => {
    const style = readImageStyle('<img style="width:200px;object-fit:cover;margin-left:auto;margin-right:auto">');
    expect(style.width).toBe(200);
    expect(style.widthUnit).toBe("px");
    expect(style.fit).toBe("cover");
    expect(style.align).toBe("center");
    expect(readImageStyle('<img style="width:50%">').widthUnit).toBe("%");
    expect(isImageFit("cover")).toBe(true);
    expect(isImageFit("squish")).toBe(false);
    expect(isImageAlign("left")).toBe(true);
    expect(isImageAlign("middle")).toBe(false);
  });
});

describe("move-target", () => {
  it("resolves a destination to a source offset", () => {
    const map = buildFixtureParseMap(SOURCE, 1);
    const h1 = elementByPath(map, "main:nth-of-type(1) > h1:nth-of-type(1)")!;
    const p = elementByPath(map, "main:nth-of-type(1) > p:nth-of-type(1)")!;
    expect(resolveMoveDestination(map, { before: { sid: p.sid } }).offset).toBe(p.range[0]);
    expect(resolveMoveDestination(map, { after: { sid: p.sid } }).offset).toBe(p.range[1]);
    expect(resolveMoveDestination(map, { appendTo: { sid: h1.sid } }).offset).toBe(h1.inner[1]);
  });

  it("rejects a destination inside the moved element or at its own edge", () => {
    const map = buildFixtureParseMap(SOURCE, 1);
    const main = elementByPath(map, "main:nth-of-type(1)")!;
    const p = elementByPath(map, "main:nth-of-type(1) > p:nth-of-type(1)")!;
    expect(() => assertMovable(map, main, { offset: p.range[0], element: p })).toThrow(HtmlOpError);
    expect(() => assertMovable(map, p, { offset: p.range[0], element: p })).toThrow(HtmlOpError);
    expect(() => assertMovable(map, p, { offset: p.range[1], element: p })).toThrow(HtmlOpError);
  });

  it("finds the previous and next sibling and the move destination", () => {
    const map = buildFixtureParseMap(SOURCE, 1);
    const first = elementByPath(map, "main:nth-of-type(1) > p:nth-of-type(1)")!;
    const second = elementByPath(map, "main:nth-of-type(1) > p:nth-of-type(2)")!;
    expect(siblingInDirection(map, second.sid, "up")).toBe(first);
    expect(siblingInDirection(map, first.sid, "down")).toBe(second);
    expect(siblingInDirection(map, first.sid, "up")?.tag).toBe("h1");
    expect(siblingMoveDestination(map, second.sid, "up")).toEqual({ before: { sid: first.sid } });
    expect(siblingMoveDestination(map, first.sid, "down")).toEqual({ after: { sid: second.sid } });
  });

  it("returns null at the edge of the sibling list", () => {
    const map = buildFixtureParseMap("<div><p>a</p></div>", 1);
    const p = elementByPath(map, "div:nth-of-type(1) > p:nth-of-type(1)")!;
    expect(siblingInDirection(map, p.sid, "up")).toBeNull();
    expect(siblingInDirection(map, p.sid, "down")).toBeNull();
    expect(siblingMoveDestination(map, p.sid, "down")).toBeNull();
  });

  it("lists a target's ancestors outermost first", () => {
    const map = buildFixtureParseMap(SOURCE, 1);
    const p = elementByPath(map, "main:nth-of-type(1) > p:nth-of-type(1)")!;
    expect(targetAncestors(map, { sid: p.sid }).map((e) => e.tag)).toEqual(["main"]);
  });
});
