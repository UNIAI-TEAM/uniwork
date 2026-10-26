// Vietnamese search folding, shared by the web's pickers and searches and the
// phone's (ADR 0011: a pure module both hosts import).
/**
 * Fold a string for Vietnamese search: NFD, strip combining marks, đ → d,
 * lower-case. "tuan" finds "Tuấn", and a name typed on a keyboard that emits
 * decomposed marks still matches one stored precomposed.
 */
export function foldVi(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

/** True when every folded word of `query` appears in the folded `text`. */
export function foldedIncludes(text: string, query: string): boolean {
  const q = foldVi(query).trim();
  if (!q) return true;
  const hay = foldVi(text);
  return q.split(/\s+/).every((word) => hay.includes(word));
}
