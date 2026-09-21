export function wrapTextareaSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  fallback = "",
) {
  const selected = value.slice(start, end) || fallback;
  const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
  const cursor = start + before.length + selected.length + after.length;
  return { next, cursor, selectionStart: start + before.length, selectionEnd: start + before.length + selected.length };
}

export function insertTextareaAtCursor(value: string, start: number, end: number, insert: string) {
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
  const cursor = start + insert.length;
  return { next, cursor };
}
