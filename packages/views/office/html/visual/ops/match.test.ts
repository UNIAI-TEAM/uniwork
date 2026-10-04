import { describe, expect, it } from "vitest";
import {
  ancestorsOf,
  attributeInsertionPoint,
  decodeAttributeValue,
  elementByPath,
  elementBySid,
  elementCovering,
  encodeAttributeValue,
  findAttribute,
  HtmlOpError,
  isDescendant,
  parseStartTagAttributes,
  requireElement,
  resolveElement,
} from "./index";
import { buildFixtureParseMap, openFixture, utf8 } from "./test-fixture";

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

describe("match: parse-map target resolution", () => {
  it("builds a fixture parse map whose ranges slice back to the exact source", () => {
    const map = buildFixtureParseMap(SOURCE, 3);
    expect(map.version).toBe(3);
    expect(map.errorCount).toBe(0);
    for (const element of map.elements) {
      const startTag = SOURCE.slice(element.startTag[0], element.startTag[1]);
      expect(startTag.startsWith("<" + element.tag)).toBe(true);
      expect(SOURCE.slice(element.range[0], element.range[1])).toBe(
        SOURCE.slice(element.startTag[0], element.startTag[1]) +
          SOURCE.slice(element.inner[0], element.inner[1]) +
          (element.endTag ? SOURCE.slice(element.endTag[0], element.endTag[1]) : ""),
      );
    }
  });

  it("resolves an element by sid, path and covering range", () => {
    const map = buildFixtureParseMap(SOURCE, 1);
    const h1 = elementByPath(map, "html > head > title:nth-of-type(1)")!;
    expect(h1.tag).toBe("title");
    expect(elementBySid(map, h1.sid)).toBe(h1);
    const body = elementByPath(map, "html > body")!;
    expect(resolveElement(map, { sid: body.sid })).toBe(body);
    expect(resolveElement(map, { path: body.path })).toBe(body);
    const p = elementByPath(map, "html > body > main:nth-of-type(1) > p:nth-of-type(1)")!;
    expect(resolveElement(map, { range: [p.inner[0], p.inner[1]] })).toBe(p);
  });

  it("picks the smallest covering element and reports a miss as null", () => {
    const map = buildFixtureParseMap(SOURCE, 1);
    const p = elementByPath(map, "html > body > main:nth-of-type(1) > p:nth-of-type(1)")!;
    const b = elementByPath(map, "html > body > main:nth-of-type(1) > p:nth-of-type(1) > b:nth-of-type(1)")!;
    expect(elementCovering(map, b.range[0], b.range[1])).toBe(b);
    expect(elementCovering(map, b.range[0], b.range[1])).not.toBe(p);
    expect(elementBySid(map, 9999)).toBeNull();
    expect(elementByPath(map, "nope")).toBeNull();
  });

  it("throws element_not_found from requireElement, never a silent edit", () => {
    const map = buildFixtureParseMap(SOURCE, 1);
    expect(() => requireElement(map, { sid: 4242 })).toThrow(HtmlOpError);
    try {
      requireElement(map, { sid: 4242 });
    } catch (error) {
      expect((error as HtmlOpError).code).toBe("element_not_found");
    }
  });

  it("walks ancestors, subtree containment and text nodes", () => {
    const map = buildFixtureParseMap(SOURCE, 1);
    const b = elementByPath(map, "html > body > main:nth-of-type(1) > p:nth-of-type(1) > b:nth-of-type(1)")!;
    const main = elementByPath(map, "html > body > main:nth-of-type(1)")!;
    expect(ancestorsOf(map, b.sid).map((e) => e.tag)).toEqual(["html", "body", "main", "p"]);
    expect(isDescendant(map, main.sid, b.sid)).toBe(true);
    expect(isDescendant(map, b.sid, main.sid)).toBe(false);
    expect(isDescendant(map, main.sid, main.sid)).toBe(false);
    const p = elementByPath(map, "html > body > main:nth-of-type(1) > p:nth-of-type(1)")!;
    expect(p.textNodes.map(([from, to]) => SOURCE.slice(from, to))).toEqual(["Đoạn ", " thường"]);
  });

  it("parses start-tag attributes with exact ranges and quoting", () => {
    const map = buildFixtureParseMap(SOURCE, 1);
    const img = elementByPath(map, "html > body > main:nth-of-type(1) > img:nth-of-type(1)")!;
    const attrs = parseStartTagAttributes(SOURCE, img.startTag);
    expect(attrs.map((a) => a.name)).toEqual(["src", "alt", "width"]);
    const src = findAttribute(attrs, "src")!;
    expect(SOURCE.slice(src.valueStart, src.valueEnd)).toBe("a b.png");
    expect(src.quote).toBe('"');
    const width = findAttribute(attrs, "width")!;
    expect(width.quote).toBeNull();
    expect(SOURCE.slice(width.valueStart, width.valueEnd)).toBe("10");
    expect(SOURCE.slice(src.nameStart, src.nameEnd)).toBe("src");
  });

  it("gives each attribute a whole-attribute end and a name-end value for valueless attrs", () => {
    const quoted = buildFixtureParseMap('<img src="a.png" alt="x">', 1);
    const img = elementByPath(quoted, "img:nth-of-type(1)")!;
    const [src, alt] = parseStartTagAttributes('<img src="a.png" alt="x">', img.startTag);
    // `end` covers the closing quote; `valueEnd` stops inside it.
    expect('<img src="a.png" alt="x">'.slice(src!.end, alt!.nameStart)).toBe(" ");
    expect(alt!.end).toBe('<img src="a.png" alt="x">'.length - 1);

    const boolean = '<input disabled type="text">';
    const input = elementByPath(buildFixtureParseMap(boolean, 1), "input:nth-of-type(1)")!;
    const [disabled, type] = parseStartTagAttributes(boolean, input.startTag);
    // A valueless attribute's empty value sits at the END OF ITS NAME.
    expect(disabled!.valueStart).toBe(disabled!.nameEnd);
    expect(disabled!.valueEnd).toBe(disabled!.nameEnd);
    expect(disabled!.end).toBe(disabled!.nameEnd);
    expect(boolean.slice(disabled!.nameEnd, type!.nameStart)).toBe(" ");
  });

  it("finds the attribute insertion point before the tag end", () => {
    const plain = buildFixtureParseMap('<p class="x">t</p>', 1);
    const p = elementByPath(plain, "p:nth-of-type(1)")!;
    expect(attributeInsertionPoint('<p class="x">t</p>', p.startTag)).toBe(p.startTag[1] - 1);
    const selfClosing = buildFixtureParseMap('<img src="a.png"/>', 1);
    const img = elementByPath(selfClosing, "img:nth-of-type(1)")!;
    expect(attributeInsertionPoint('<img src="a.png"/>', img.startTag)).toBe(img.startTag[1] - 2);
  });

  it("decodes and re-encodes attribute values without disturbing entities", () => {
    expect(decodeAttributeValue("a&amp;b")).toBe("a&b");
    expect(decodeAttributeValue("&#65;&#x42;")).toBe("AB");
    expect(decodeAttributeValue("keep &unknown; as-is")).toBe("keep &unknown; as-is");
    expect(encodeAttributeValue('say "hi" & <bye>', '"')).toBe("say &quot;hi&quot; &amp; &lt;bye>");
    expect(encodeAttributeValue("it's", "'")).toBe("it&#39;s");
    expect(encodeAttributeValue("a b", null)).toBe("a&#32;b");
  });

  it("opens the source in the real engine so ops apply through applyPatchSet", async () => {
    const fixture = await openFixture(SOURCE);
    expect(fixture.text).toBe(SOURCE);
    expect(fixture.map.elements.length).toBeGreaterThan(0);
    expect(fixture.version).toBe(0);
    expect(utf8(SOURCE).length).toBeGreaterThan(0);
  });
});
