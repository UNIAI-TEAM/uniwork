import type { JSONContent } from "@tiptap/core";
import type { DocxAdapter } from "@uniwork/office-engine/docx";
import { saveDocx } from "@uniwork/office-upstream/docs-renderer-editor";

/** Seed styles only in the isolated save source; live and captured state stay immutable. */
export async function prepareDocxHeadingStyles(adapter: DocxAdapter, ref: string, doc: JSONContent): Promise<Uint8Array | null> {
  const parsed = adapter.parsedOf(ref);
  const styles = parsed.styles;
  const headingStyles = parsed.headingStyleIds;
  // Deterministic engine doubles omit document-style metadata.
  if (!(styles instanceof Map) || !(headingStyles instanceof Map)) return null;
  const missing = new Set<number>();
  const visit = (node: JSONContent) => {
    const level = Number(node.attrs?.level);
    if (node.type === "docHeading" && !node.attrs?.styleId && !node.attrs?.outlineOnly
      && Number.isInteger(level) && level >= 1 && level <= 6 && !headingStyles.has(level)) missing.add(level);
    node.content?.forEach(visit);
  };
  visit(doc);
  if (!missing.size || !(parsed.internal?.originalBytes instanceof Uint8Array)) return null;
  const { default: JSZip } = await import("jszip");
  const source = await JSZip.loadAsync(parsed.internal.originalBytes);
  // Keep the existing compatibility limit when the entire styles part is absent.
  if (!source.file("word/styles.xml")) return null;
  const reserved = new Set(styles.keys());
  const styleUpserts = [...missing].sort((left, right) => left - right).map((level) => {
    let styleId = `Heading${level}`;
    for (let suffix = 0; reserved.has(styleId); suffix++) styleId = `UniWorkHeading${level}_${suffix}`;
    reserved.add(styleId);
    return {
      styleId, type: "paragraph", name: `heading ${level}`, quickFormat: true,
      ...(styles.has("Normal") ? { basedOn: "Normal", next: "Normal" } : {}),
      // Match the shared renderer's built-in heading defaults.
      pPr: { outlineLevel: level, keepNext: true, spaceBeforeTwips: 280, spaceAfterTwips: 80, lineSpacing: 1.2 },
      rPr: { sizeHalfPoints: level === 1 ? 32 : level === 2 ? 26 : level === 3 ? 24 : 22, bold: false, italic: level >= 4 },
    };
  });
  const originals = adapter.visibleIndexes(ref).map((docxIndex) => ({ kind: "original", docxIndex }));
  const prepared = await saveDocx(parsed, originals, { styleUpserts });
  const core = source.file("docProps/core.xml");
  if (!core) return prepared;
  // The preflight is not a user Save: only final serialization may change metadata.
  const zip = await JSZip.loadAsync(prepared);
  zip.file(core.name, await core.async("uint8array"), { date: core.date });
  return zip.generateAsync({ type: "uint8array" });
}
