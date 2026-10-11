import { describe, expect, it } from "vitest";
import { ConvertTypedError, convertOdfText } from "./index.ts";
import { OdfError, readOdfTextPackage } from "./odt.ts";
import { writeZip } from "./zip.ts";

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const MIME = "application/vnd.oasis.opendocument.text";

const content = (body: string): string =>
  `<?xml version="1.0"?><office:document-content xmlns:office="o" xmlns:text="t"><office:body><office:text>${body}</office:text></office:body></office:document-content>`;

const odt = (entries: Record<string, string>): Uint8Array =>
  writeZip(Object.entries(entries).map(([path, data]) => ({ path, data: enc(data) })));

function reason(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof OdfError) return error.reason;
    throw error;
  }
  throw new Error("expected an OdfError");
}

describe("readOdfTextPackage", () => {
  it("reads headings and paragraphs in document order and decodes spaces, tabs, breaks and entities", () => {
    const bytes = odt({
      mimetype: MIME,
      "content.xml": content(
        '<text:h text:outline-level="1">Tiêu đề &amp; &lt;mục&gt;</text:h>' +
          "<text:p>a<text:s/>b<text:s text:c=\"3\"/>c<text:tab/>d<text:line-break/>e</text:p>" +
          "<text:p text:style-name=\"P1\">it&apos;s &quot;<text:span>nested</text:span>&quot;</text:p>",
      ),
    });
    expect(readOdfTextPackage(bytes)).toEqual([
      { heading: true, text: "Tiêu đề & <mục>" },
      { heading: false, text: "a b   c\td\ne" },
      { heading: false, text: 'it\'s "nested"' },
    ]);
  });

  it("accepts a package that declares ODF text only in the manifest", () => {
    const bytes = odt({
      "META-INF/manifest.xml": `<manifest:file-entry manifest:media-type="${MIME}"/>`,
      "content.xml": content("<text:p>x</text:p>"),
    });
    expect(readOdfTextPackage(bytes)).toEqual([{ heading: false, text: "x" }]);
  });

  it("refuses bytes that are not a zip", () => {
    expect(reason(() => readOdfTextPackage(enc("plain text, not a zip")))).toBe("not_odt");
  });

  it("refuses a zip that does not declare ODF text (other mimetype, no manifest, manifest of another type)", () => {
    expect(reason(() => readOdfTextPackage(odt({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": content("") })))).toBe("not_odt");
    expect(reason(() => readOdfTextPackage(odt({ "content.xml": content("") })))).toBe("not_odt");
    expect(
      reason(() =>
        readOdfTextPackage(odt({ "META-INF/manifest.xml": "media-type=spreadsheet", "content.xml": content("") })),
      ),
    ).toBe("not_odt");
  });

  it("refuses a text package without content.xml or with content that is not an ODF document", () => {
    expect(reason(() => readOdfTextPackage(odt({ mimetype: MIME })))).toBe("not_odt");
    expect(reason(() => readOdfTextPackage(odt({ mimetype: MIME, "content.xml": "<html/>" })))).toBe("not_odt");
  });

  it("returns no paragraphs for a document without text elements", () => {
    expect(readOdfTextPackage(odt({ mimetype: MIME, "content.xml": content("") }))).toEqual([]);
  });
});

describe("convertOdfText error mapping", () => {
  it("maps an OdfError to a typed engine_result_invalid with the ODF reason", () => {
    try {
      convertOdfText(odt({ mimetype: "text/plain", "content.xml": "" }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConvertTypedError);
      expect(error).toMatchObject({ code: "engine_result_invalid", reason: "not_odt" });
    }
  });

  it("carries the paragraph texts into the change list and the docx", () => {
    const result = convertOdfText(odt({ mimetype: MIME, "content.xml": content("<text:h>One</text:h><text:p>Two</text:p>") }));
    expect(result.content.paragraphs).toEqual(["One", "Two"]);
    expect(result.fidelity.lost).toContain("tables_images_and_embedded_objects");
  });
});
