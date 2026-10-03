// C2 (UNI-924): reading the compared .docx the user picks from disk.
//
// The chosen file is untrusted input. It is parsed in memory, off the open
// session (no adapter session, no save path): the engine's parseDocx only
// produces a model, and a failure is a typed refusal the dialog translates —
// never a crash and never a partially rendered diff. The parse also applies
// the vendored engine's own zip limits (assertZipWithinLimits).

import { parseDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { rendererBlockTexts } from "./sources";

export type CompareReadFailure = "invalid_docx" | "unreadable";

export type CompareReadResult = { ok: true; texts: string[] } | { ok: false; reason: CompareReadFailure };

export async function readCompareFile(file: File): Promise<CompareReadResult> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  try {
    const parsed = await parseDocx(bytes);
    return { ok: true, texts: rendererBlockTexts(parsed.blocks) };
  } catch {
    return { ok: false, reason: "invalid_docx" };
  }
}
