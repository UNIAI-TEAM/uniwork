// UNI-927 X1 (R2-3) - speaker notes held outside a body placeholder.
//
// The vendored getSlideNotes (pptx-engine/src/notes.ts:66) reads only the
// `<p:ph type="body">` shape of the notes part. A notes part written without
// that placeholder (the G0 fixture pptx-notes.pptx, other generators) then
// reads as '' although it carries text. This fallback reads such a part the
// way the vendored read would read the body: the first shape that is not a
// placeholder (slide image, number, header...) and carries `<a:t>` text,
// paragraphs joined by \n, trailing empty paragraphs dropped. A part that HAS a
// body placeholder answers '' here: the vendored read already spoke for it,
// and an emptied body must not resurrect older text. Browser-safe.
import type { PptxArchiveLike } from "./engine";

const NOTES_SLIDE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";

function unescapeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** `../notesSlides/notesSlide1.xml` against `ppt/slides/slide1.xml`. */
function resolvePartTarget(fromPart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = fromPart.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== "." && segment !== "") parts.push(segment);
  }
  return parts.join("/");
}

function notesPartOf(archive: PptxArchiveLike, slidePath: string): string | null {
  const slash = slidePath.lastIndexOf("/");
  const rels = archive.readText?.(slidePath.slice(0, slash + 1) + "_rels/" + slidePath.slice(slash + 1) + ".rels");
  if (!rels) return null;
  for (const [tag] of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const type = /\bType="([^"]*)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]*)"/.exec(tag)?.[1];
    if (type === NOTES_SLIDE_REL && target) return resolvePartTarget(slidePath, target);
  }
  return null;
}

/** @public - notes text of a notes part that has no body placeholder ('' otherwise). */
export function readPptxNotesWithoutBodyPlaceholder(archive: PptxArchiveLike | undefined, slidePath: string): string {
  const notesPath = archive ? notesPartOf(archive, slidePath) : null;
  const xml = notesPath ? archive?.readText?.(notesPath) : undefined;
  if (!xml) return "";
  const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]);
  if (shapes.some((shape) => /<p:ph\b[^>]*type="body"/.test(shape))) return "";
  for (const shape of shapes) {
    if (/<p:ph\b/.test(shape)) continue;
    const body = /<p:txBody>([\s\S]*?)<\/p:txBody>/.exec(shape)?.[1];
    if (!body) continue;
    const paragraphs = [...body.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((p) =>
      [...p[1]!.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => unescapeXml(t[1]!)).join(""),
    );
    while (paragraphs.length > 0 && paragraphs[paragraphs.length - 1] === "") paragraphs.pop();
    if (paragraphs.length > 0) return paragraphs.join("\n");
  }
  return "";
}
