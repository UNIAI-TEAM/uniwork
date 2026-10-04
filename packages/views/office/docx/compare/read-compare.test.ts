// The parser-failure path is the security contract: the picked file is
// untrusted, so a bad file must come back as a typed refusal the dialog can
// translate — never a throw and never a partial result.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { readCompareFile } from "./read-compare";

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

async function docxWithParagraphs(texts: readonly string[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
  );
  const paragraphs = texts.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join("");
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="${w}"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}

describe("readCompareFile", () => {
  it("parses a picked .docx into its visible block texts in order", async () => {
    const bytes = await docxWithParagraphs(["Alpha", "Beta"]);
    const result = await readCompareFile(new File([bytes], "other.docx"));
    expect(result).toEqual({ ok: true, texts: ["Alpha", "Beta"] });
  });

  it("refuses a file that is not a readable .docx", async () => {
    const broken = new Uint8Array([1, 2, 3]);
    const result = await readCompareFile(new File([broken.buffer as ArrayBuffer], "broken.docx"));
    expect(result).toEqual({ ok: false, reason: "invalid_docx" });
  });

  it("refuses a file whose bytes cannot be read at all", async () => {
    const unreadable = {
      name: "gone.docx",
      arrayBuffer: async () => {
        throw new Error("io");
      },
    } as unknown as File;
    const result = await readCompareFile(unreadable);
    expect(result).toEqual({ ok: false, reason: "unreadable" });
  });
});
