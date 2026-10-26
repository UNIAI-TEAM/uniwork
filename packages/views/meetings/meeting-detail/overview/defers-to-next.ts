import { foldVi } from "@uniwork/core/chat/search-fold";

// Folded phrases that put a question on the next meeting's agenda (PLAN D3).
const NEXT_MEETING_PHRASES = ["tuan sau", "tuan toi", "buoi sau", "hop sau", "lan hop toi"];

/**
 * Whether an open question defers itself to the next meeting ("…quyết trong
 * tuần sau", "…ở buổi tuần sau…"), so its row may say "Bàn ở: {next} ›".
 * Accent-folded, so a summary written without marks reads the same.
 */
export function defersToNextMeeting(text: string): boolean {
  const folded = foldVi(text).replace(/\s+/g, " ");
  return NEXT_MEETING_PHRASES.some((phrase) => folded.includes(phrase));
}

/**
 * "Giao ban tuần 44" for "Giao ban tuần 44 — Ra mắt SaoMai POS 3.0" beside
 * "Giao ban tuần 43 — Ra mắt SaoMai POS 3.0": the suffix both share is dropped.
 */
export function seriesShortTitle(title: string, current: string): string {
  const at = current.indexOf(" — ");
  const suffix = at >= 0 ? current.slice(at) : "";
  return suffix && title.endsWith(suffix) && title.length > suffix.length ? title.slice(0, -suffix.length) : title;
}
