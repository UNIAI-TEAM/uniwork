import { writeZip, type ZipInput } from "./zip.ts";

// Minimal WordprocessingML writer for the Q7 .odt -> .docx converter: one
// body part with the source's paragraphs and a small stylesheet that names
// Normal and Heading1, so the copy opens in the docx editor with the heading
// structure the source had.

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

export interface DocxParagraph {
  readonly text: string;
  readonly heading: boolean;
}

export function writeDocxPackage(paragraphs: readonly DocxParagraph[]): Uint8Array {
  const entries: ZipInput[] = [
    { path: "[Content_Types].xml", data: xml(CONTENT_TYPES) },
    { path: "_rels/.rels", data: xml(ROOT_RELS) },
    { path: "word/document.xml", data: xml(documentXml(paragraphs)) },
    { path: "word/styles.xml", data: xml(STYLES) },
  ];
  return writeZip(entries);
}

const CONTENT_TYPES =
  XML_DECL +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  "</Types>";

const ROOT_RELS =
  XML_DECL +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  "</Relationships>";

const STYLES =
  XML_DECL +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>' +
  "</w:styles>";

function documentXml(paragraphs: readonly DocxParagraph[]): string {
  const body = paragraphs.map(paragraphXml).join("");
  return (
    XML_DECL +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:body>" +
    body +
    "<w:sectPr/></w:body></w:document>"
  );
}

function paragraphXml(paragraph: DocxParagraph): string {
  if (paragraph.text === "") return "<w:p/>";
  const style = paragraph.heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : "";
  const runs = paragraph.text
    .split("\n")
    .map((line, index) => `${index > 0 ? "<w:br/>" : ""}<w:t xml:space="preserve">${escapeText(line)}</w:t>`)
    .join("");
  return `<w:p>${style}<w:r>${runs}</w:r></w:p>`;
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function xml(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
