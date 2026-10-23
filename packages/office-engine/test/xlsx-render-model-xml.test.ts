// UNI-952: the entity decoder every XLSX model reader shares.
import { describe, expect, it } from "vitest";
import { decodeXml } from "../src/xlsx/render-model-xml";

describe("decodeXml", () => {
  it("decodes decimal and hex character references to exactly one character", () => {
    expect(decodeXml("A&#66;C")).toBe("ABC");
    expect(decodeXml("&#7889;")).toBe("ố");
    expect(decodeXml("&#x1F600;")).toBe("😀");
  });

  it("decodes the named entities and leaves an escaped ampersand reference literal", () => {
    expect(decodeXml("&lt;a&gt; &quot;b&quot; &apos;c&apos;")).toBe(`<a> "b" 'c'`);
    expect(decodeXml("&amp;#65;")).toBe("&#65;");
  });
});
