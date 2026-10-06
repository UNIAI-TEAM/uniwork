// C2 (UNI-924): the pure diff behind Review ▸ Compare.
//
// The comparison is TEXT ONLY: each side is the list of plain texts of its
// visible blocks, in document order. Formatting, images, charts and other
// non-text payloads are not compared — the parsed side contributes a block's
// preview text and the live side its plain text content — so a formatting-only
// edit reads as unchanged. The dialog states this limit to the user and
// worker-C2.md records it.
//
// The walk is ported from genoffice's renderer/editor/compare.ts (paragraph
// LCS; a removal directly followed by an addition merges into "changed"), with
// word-level segments added for changed pairs.

export type CompareKind = "same" | "added" | "removed" | "changed";

export interface CompareWord {
  kind: "same" | "added" | "removed";
  text: string;
}

export interface CompareEntry {
  kind: CompareKind;
  /** Current-document text; null for an added block. */
  left: string | null;
  /** Compared-document text; null for a removed block. */
  right: string | null;
  /** Word-level split of a changed entry's current-document text. */
  leftWords?: CompareWord[];
  /** Word-level split of a changed entry's compared text. */
  rightWords?: CompareWord[];
}

export interface CompareSummary {
  same: number;
  added: number;
  removed: number;
  changed: number;
}

export type CompareRow = { kind: "same"; count: number } | { kind: "entry"; entry: CompareEntry };

/** Longest-common-subsequence table over two token lists (suffix lengths). */
function lcsTable(left: readonly string[], right: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      table[i]![j] = left[i] === right[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

/** Splits text into whitespace and non-whitespace runs; the LCS works on
 * tokens, so spacing survives in the rendered segments. */
function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

function pushWord(list: CompareWord[], kind: CompareWord["kind"], text: string): void {
  const last = list[list.length - 1];
  if (last && last.kind === kind) last.text += text;
  else list.push({ kind, text });
}

/** Word-level split of a changed pair: tokens common to both sides stay
 * "same" on both; the rest is "removed" on the left and "added" on the right. */
export function diffWords(left: string, right: string): { left: CompareWord[]; right: CompareWord[] } {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  const lcs = lcsTable(leftTokens, rightTokens);
  const leftWords: CompareWord[] = [];
  const rightWords: CompareWord[] = [];
  let i = 0;
  let j = 0;
  while (i < leftTokens.length && j < rightTokens.length) {
    if (leftTokens[i] === rightTokens[j]) {
      pushWord(leftWords, "same", leftTokens[i]!);
      pushWord(rightWords, "same", rightTokens[j]!);
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      pushWord(leftWords, "removed", leftTokens[i]!);
      i++;
    } else {
      pushWord(rightWords, "added", rightTokens[j]!);
      j++;
    }
  }
  while (i < leftTokens.length) pushWord(leftWords, "removed", leftTokens[i++]!);
  while (j < rightTokens.length) pushWord(rightWords, "added", rightTokens[j++]!);
  return { left: leftWords, right: rightWords };
}

/** Block-level comparison of two text lists, in deterministic document order.
 * Every input row lands in exactly one entry, so nothing is dropped silently. */
export function compareTextBlocks(left: readonly string[], right: readonly string[]): CompareEntry[] {
  const lcs = lcsTable(left, right);
  const raw: CompareEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      raw.push({ kind: "same", left: left[i]!, right: right[j]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      raw.push({ kind: "removed", left: left[i]!, right: null });
      i++;
    } else {
      raw.push({ kind: "added", left: null, right: right[j]! });
      j++;
    }
  }
  while (i < left.length) raw.push({ kind: "removed", left: left[i++]!, right: null });
  while (j < right.length) raw.push({ kind: "added", left: null, right: right[j++]! });

  const entries: CompareEntry[] = [];
  for (const entry of raw) {
    const previous = entries[entries.length - 1];
    if (entry.kind === "added" && previous?.kind === "removed") {
      const words = diffWords(previous.left ?? "", entry.right ?? "");
      entries[entries.length - 1] = {
        kind: "changed",
        left: previous.left,
        right: entry.right,
        leftWords: words.left,
        rightWords: words.right,
      };
      continue;
    }
    entries.push(entry);
  }
  return entries;
}

export function summarizeCompare(entries: readonly CompareEntry[]): CompareSummary {
  const summary: CompareSummary = { same: 0, added: 0, removed: 0, changed: 0 };
  for (const entry of entries) summary[entry.kind] += 1;
  return summary;
}

/** Collapses runs of unchanged blocks into one countable row, so a long shared
 * prefix does not flood the result list (genoffice's ComparePanel behaviour). */
export function compareRows(entries: readonly CompareEntry[]): CompareRow[] {
  const rows: CompareRow[] = [];
  let run = 0;
  for (const entry of entries) {
    if (entry.kind === "same") {
      run += 1;
      continue;
    }
    if (run > 0) {
      rows.push({ kind: "same", count: run });
      run = 0;
    }
    rows.push({ kind: "entry", entry });
  }
  if (run > 0) rows.push({ kind: "same", count: run });
  return rows;
}
