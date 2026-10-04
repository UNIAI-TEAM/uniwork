// Read-only views of a parse's session-plan surface, extracted verbatim from
// model.ts when B7 pushed that file past the 500-line budget (the B5
// payloads.ts precedent: a behaviour-neutral move, not a redesign). model.ts
// re-exports every name, so existing importers are untouched.
import type { DocxParsed } from "./engine";

/** Every legal original top-level block in document order — the only set a
 * save plan may draw originals from. Hidden blocks are not listed; saveDocx
 * appends them automatically. */
export function visibleIndexes(parsed: DocxParsed): number[] {
  return parsed.blocks
    .filter((b) => !b.hidden && b.docxIndex !== null)
    .map((b) => b.docxIndex as number);
}

/** Visible paragraphs — the text-editable subset. Headings/lists/tables/
 * images/passthrough stay inventoried but are never silently retyped. */
export function editableIndexes(parsed: DocxParsed): number[] {
  return parsed.blocks
    .filter((b) => !b.hidden && b.docxIndex !== null && b.type === "paragraph")
    .map((b) => b.docxIndex as number);
}

export function plainText(parsed: DocxParsed): string {
  return parsed.blocks
    .map((b) => (b.runs ?? []).map((r) => r.text ?? "").join(""))
    .join("\n");
}
