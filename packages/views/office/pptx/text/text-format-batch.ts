/**
 * One text-format gesture over several selected elements (UNI-927 W10a, W9 review F2/F6).
 *
 * The ribbon Font/Paragraph groups and the text-format panel both build their edits here,
 * so the same action gives the same result from either surface: one `TextEdit` per
 * text-capable id (anchor first), sent by the caller as ONE batch so undo reverts the
 * whole format in one step. An id whose builder refuses is skipped; the first refusal is
 * returned so the caller reports it once, not once per id.
 */
import type { TextEdit } from "@uniwork/office-engine/pptx";

interface PptxTextEditBatch {
  edits: TextEdit[];
  /** The first builder refusal, or null when every id built. */
  refusal: unknown;
}

/** `ids` empty falls back to `[anchor]`; a null anchor builds nothing. */
export function buildPptxTextEditBatch(
  anchor: string | null,
  ids: readonly string[] | undefined,
  build: (elementId: string) => TextEdit,
): PptxTextEditBatch {
  const targets = ids && ids.length > 0 ? ids : anchor ? [anchor] : [];
  const edits: TextEdit[] = [];
  let refusal: unknown = null;
  for (const id of targets) {
    try {
      edits.push(build(id));
    } catch (error) {
      refusal ??= error;
    }
  }
  return { edits, refusal };
}
