/**
 * A one-line, plain-text gist of a comment for quotes and thread chips.
 *
 * Deliberately a small stripper, not a Markdown parser: it removes the syntax a
 * person actually types in a comment and collapses the rest to one line. It is
 * never used for rendering the comment itself — that stays with RichContent.
 */
// Table-divider row: only pipes, dashes, colons and spaces, at least one dash
// (`| --- | :--: |`). Matched and dropped before the generic row rule below,
// which would otherwise turn it into a meaningless "--- · ---".
const TABLE_DIVIDER_RE =
  /^[ \t]*\|?(?:[ \t]*:?-{2,}:?[ \t]*\|)*[ \t]*:?-{2,}:?[ \t]*\|?[ \t]*$/gm;
// Any remaining table row: cells joined by " · " to keep reading order
// instead of mashing them together once whitespace collapses.
const TABLE_ROW_RE = /^[ \t]*\|(.+)\|[ \t]*$/gm;

export function commentPreviewText(body: string, max = 120): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    // File attachments serialise as `!file[filename](href)`, not the
    // standard `![alt](src)` image shape — handle it before the image and
    // link rules so neither leaves a stray leading `!file`.
    .replace(/!file\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(TABLE_DIVIDER_RE, "")
    .replace(TABLE_ROW_RE, (_match, inner: string) =>
      inner
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(" · "),
    )
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}\d+\.\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/==(.*?)==/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}
