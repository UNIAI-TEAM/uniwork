import type { PptxStatusCounts } from "./status-bar";

/** Word and character totals over the deck's text runs (the find model's flattened runs). */
export function pptxTextCounts(runs: readonly { text: string }[]): PptxStatusCounts {
  let words = 0;
  let characters = 0;
  for (const { text } of runs) {
    characters += text.length;
    const trimmed = text.trim();
    if (trimmed !== "") words += trimmed.split(/\s+/).length;
  }
  return { words, characters };
}
