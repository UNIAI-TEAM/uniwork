/** Blank Markdown and HTML documents authored for UniWork (2026-10-05).
 * A text document IS its source, so the blank Markdown file is empty and the
 * blank HTML file is the smallest well-formed UTF-8 page. No BOM: a BOM is an
 * encoding property the text lane only preserves when the opened bytes had it.
 * Distributed under the repository license. */
const BLANK_HTML = "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<title></title>\n</head>\n<body>\n</body>\n</html>\n";

export function blankMarkdownBytes(): Uint8Array {
  return new Uint8Array(0);
}

export function blankHtmlBytes(): Uint8Array {
  return new TextEncoder().encode(BLANK_HTML);
}
