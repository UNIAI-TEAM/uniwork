/** 1-based line and column of a caret offset in a plain-text source (the status row's "Ln 3, Col 14"). */
interface TextCaret {
  line: number;
  column: number;
}

/** Caret position for `offset` into `text`; the offset is clamped into the text. */
export function textCaret(text: string, offset: number): TextCaret {
  const at = Math.min(Math.max(0, Math.trunc(Number.isFinite(offset) ? offset : 0)), text.length);
  const before = text.slice(0, at);
  const lastBreak = before.lastIndexOf("\n");
  let line = 1;
  for (const char of before) if (char === "\n") line += 1;
  return { line, column: at - (lastBreak + 1) + 1 };
}

/** Character and line counts of a plain-text source; an empty source is one line. */
export function textFigures(text: string): { characters: number; lines: number } {
  return { characters: text.length, lines: text.length === 0 ? 1 : text.split("\n").length };
}
