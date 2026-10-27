const MAX_VISIBLE_PATH_SEGMENTS = 2;
const MAX_VISIBLE_PATH_CHARS = 36;
const MAX_SEGMENT_CHARS = 24;

function truncateSegmentFromLeft(segment: string): string {
  if (segment.length <= MAX_SEGMENT_CHARS) return segment;
  return `…${segment.slice(-(MAX_SEGMENT_CHARS - 1)).trimStart()}`;
}

/**
 * Formats a document's ancestor path (root -> direct parent) for search result
 * rows and cards: truncates from the left ("… › Parent") when there are more
 * than two ancestors, a segment is long, or the joined text exceeds the cap,
 * while returning the full path for the `title` tooltip and screen-reader
 * announcement.
 */
export function formatSearchPath(
  path: { id: string; title: string }[] | undefined,
  rootLabel?: string,
): { display: string; full: string } {
  const segments = (path ?? []).map((item) => item.title.trim()).filter(Boolean);
  if (segments.length === 0) {
    if (!rootLabel) return { display: "", full: "" };
    return { display: rootLabel, full: rootLabel };
  }
  const full = segments.join(" › ");
  if (segments.length <= MAX_VISIBLE_PATH_SEGMENTS && full.length <= MAX_VISIBLE_PATH_CHARS) {
    return { display: full, full };
  }
  const capped = segments.map(truncateSegmentFromLeft);
  const tailSegments = capped.slice(-MAX_VISIBLE_PATH_SEGMENTS);
  const tail = tailSegments.join(" › ");
  if (segments.length === 1) {
    return { display: tail, full };
  }
  if (tail.length > MAX_VISIBLE_PATH_CHARS) {
    return { display: `… › ${tailSegments.at(-1)!}`, full };
  }
  return { display: `… › ${tail}`, full };
}

/**
 * Normalises a string the way the backend's `uw_fold_search` / `foldForSearch`
 * does: NFD decomposition, combining marks dropped, Vietnamese `đ`/`Đ` mapped
 * to `d`, lowercase, and whitespace collapsed.
 */
export function foldSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
