import { readZip } from "./zip.ts";

// ODF text reader for the Q7 .odt -> .docx converter. ODF is a zip whose first
// entry, `mimetype`, names the media type; the text lives in content.xml. The
// reader keeps paragraph and heading text only: inline styling, tables,
// images and embedded objects are named as losses by the converter, never
// silently dropped from the change list.

export interface OdfParagraph {
  readonly text: string;
  readonly heading: boolean;
}

export const ODF_TEXT_MIMETYPE = "application/vnd.oasis.opendocument.text";

export class OdfError extends Error {
  readonly reason: string;
  constructor(reason: string, detail: string) {
    super(detail);
    this.name = "OdfError";
    this.reason = reason;
  }
}

/** Proves the package is ODF text and reads its paragraphs in document order. */
export function readOdfTextPackage(bytes: Uint8Array): OdfParagraph[] {
  let pkg: Map<string, Uint8Array>;
  try {
    pkg = readZip(bytes);
  } catch {
    throw new OdfError("not_odt", "the package is not a readable zip");
  }
  if (!isOdfText(pkg)) throw new OdfError("not_odt", "the package does not declare ODF text");
  const content = pkg.get("content.xml");
  if (!content) throw new OdfError("not_odt", "content.xml is missing");
  return readOdfText(new TextDecoder().decode(content));
}

function isOdfText(pkg: Map<string, Uint8Array>): boolean {
  const mimetype = pkg.get("mimetype");
  if (mimetype && new TextDecoder().decode(mimetype).trim() === ODF_TEXT_MIMETYPE) return true;
  const manifest = pkg.get("META-INF/manifest.xml");
  return manifest ? new TextDecoder().decode(manifest).includes(ODF_TEXT_MIMETYPE) : false;
}

/** Extract text:h and text:p elements in document order. */
export function readOdfText(contentXml: string): OdfParagraph[] {
  if (!contentXml.includes("<office:document-content")) {
    throw new OdfError("not_odt", "content.xml is not an ODF document");
  }
  const out: OdfParagraph[] = [];
  const pattern = /<text:(h|p)(?:\s[^>]*)?>([\s\S]*?)<\/text:\1>/g;
  for (const match of contentXml.matchAll(pattern)) {
    out.push({ heading: match[1] === "h", text: plainText(match[2] ?? "") });
  }
  return out;
}

function plainText(fragment: string): string {
  return decodeEntities(
    fragment
      .replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, count: string | undefined) => " ".repeat(count ? Number(count) : 1))
      .replace(/<text:tab\s*\/>/g, "\t")
      .replace(/<text:line-break\s*\/>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
