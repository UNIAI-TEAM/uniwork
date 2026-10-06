import { describe, expect, it } from "vitest";
import { buildHtmlParseMap } from "./html-parse-map";

const SOURCE = `<!doctype html><html><head><title>T</title></head><body><main id="m"><h1 class='t'>Hi &amp; bye</h1><img src="a.png"><ul><li>a<li>b</ul><p>One <b>two</b></p></main></body></html>`;

describe("buildHtmlParseMap", () => {
  it("maps every element to exact source ranges", () => {
    const map = buildHtmlParseMap(SOURCE, 1);
    const h1 = map.elements.find((element) => element.tag === "h1")!;
    expect(SOURCE.slice(...h1.range)).toBe(`<h1 class='t'>Hi &amp; bye</h1>`);
    expect(SOURCE.slice(...h1.startTag)).toBe(`<h1 class='t'>`);
    expect(SOURCE.slice(...h1.inner)).toBe("Hi &amp; bye");
    expect(SOURCE.slice(...h1.endTag!)).toBe("</h1>");
    expect(h1.path).toBe("html > body > main:nth-of-type(1) > h1:nth-of-type(1)");
    const img = map.elements.find((element) => element.tag === "img")!;
    expect(img.endTag).toBeNull();
    expect(SOURCE.slice(...img.range)).toBe(`<img src="a.png">`);
  });

  it("reports parents, depth and direct text nodes", () => {
    const map = buildHtmlParseMap(SOURCE, 1);
    const p = map.elements.find((element) => element.tag === "p")!;
    const main = map.elements.find((element) => element.tag === "main")!;
    expect(p.parentSid).toBe(main.sid);
    expect(p.textNodes.map(([from, to]) => SOURCE.slice(from, to))).toEqual(["One "]);
    expect(map.bySid.get(p.sid)).toBe(p);
    expect(map.version).toBe(1);
  });

  it("handles implied end tags: the li ranges stop where the next begins", () => {
    const map = buildHtmlParseMap(SOURCE, 1);
    const items = map.elements.filter((element) => element.tag === "li");
    expect(items.map((item) => SOURCE.slice(...item.range))).toEqual(["<li>a", "<li>b"]);
  });

  it("skips elements parse5 invents (implied html/head/body have no start tag)", () => {
    const text = "<p>x</p>";
    const map = buildHtmlParseMap(text, 1);
    expect(map.elements.map((element) => element.tag)).toEqual(["p"]);
  });

  it("keeps sids for unchanged elements when rebuilt after an edit elsewhere", () => {
    const first = buildHtmlParseMap(SOURCE, 1);
    const edited = SOURCE.replace("Hi &amp; bye", "A much longer heading text");
    const second = buildHtmlParseMap(edited, 2, first);
    const sidOf = (map: typeof first, tag: string) => map.elements.find((element) => element.tag === tag)!.sid;
    for (const tag of ["main", "h1", "img", "ul", "p", "b"]) expect(sidOf(second, tag)).toBe(sidOf(first, tag));
  });

  it("gives a new element a fresh sid and never reuses one", () => {
    const first = buildHtmlParseMap("<p>a</p>", 1);
    const second = buildHtmlParseMap("<p>a</p><p>b</p>", 2, first);
    const sids = second.elements.map((element) => element.sid);
    expect(new Set(sids).size).toBe(2);
    expect(sids[0]).toBe(first.elements[0]!.sid);
  });

  it("counts parse errors of malformed markup without throwing", () => {
    const map = buildHtmlParseMap("<p><b>x</p></b><div", 1);
    expect(map.errorCount).toBeGreaterThan(0);
    expect(map.elements.length).toBeGreaterThan(0);
  });

  it("an empty document has no elements", () => {
    expect(buildHtmlParseMap("", 1).elements).toEqual([]);
  });
});
