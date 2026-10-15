// The `--exits` slice of the G7-03a app-layer fault runner (UNI-1380, FIX-15):
// one cloud command is capped (~30 min) while a row such as FQ-43 (9 exits) or
// FQ-50 (5 exits) needs longer, so a caller can ask for a range of a row's exits
// and run the rest in a later command. A slice is never a verdict on the row: the
// exits it skipped are not evidence, so a row whose remaining exits all PASS
// reports BLOCKED, not PASS, and its line says `partial a-b of N`.
//
// Pure logic only (parsing, selection, the skipped line, the partial row result):
// app-cases.mjs runs it and app-cases-exits.test.mjs pins it.

/** A bad `--exits` value, or `--exits` without `--case`: the CLI exits 2, never 1. */
export class ExitRangeError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExitRangeError";
  }
}

/** `--exits a-b` (1-based, inclusive) or `--exits n` -> `{from, to, label}`; anything else throws. */
export function parseExitRange(text) {
  const raw = String(text ?? "").trim();
  const match = /^(\d+)(?:-(\d+))?$/.exec(raw);
  if (!match) throw new ExitRangeError(`--exits expects <a>-<b> or <n> (1-based, got "${raw}")`);
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  if (from < 1 || to < from) {
    throw new ExitRangeError(`--exits ${raw}: a range starts at exit 1 or later and never counts down`);
  }
  return { from, to, label: `${from}-${to}` };
}

/**
 * The runs a range covers and the ones it skips (both in the row's exit order):
 * exits are numbered by position, so `--exits 1` names the first run of a row
 * that lists no `exits` array as well. No range = every run, nothing skipped. A
 * range that starts past the row's last exit names no exit of that row at all: a
 * caller mistake, not an empty slice.
 */
export function selectExitRange(runs, range, rowId = "the row") {
  if (!range) return { ran: runs, skipped: [] };
  if (range.from > runs.length) {
    throw new ExitRangeError(`--exits ${range.label}: ${rowId} has ${runs.length} exit(s)`);
  }
  const inside = (_run, i) => i + 1 >= range.from && i + 1 <= range.to;
  return { ran: runs.filter(inside), skipped: runs.filter((run, i) => !inside(run, i)) };
}

/** The line one skipped exit prints: neither PASS, FAIL nor BLOCKED. */
export const skippedExitLine = (rowId, run, total, range) =>
  `${rowId} [${run.index}/${total}] ${run.label}: SKIPPED - outside --exits ${range.label}`;

/** The phrase a sliced row's line carries and its blocker opens with. */
export const partialLabel = (range, total) => `partial ${range.label} of ${total}`;

/**
 * The row result of a sliced run: the worst of the exits it ran, never a PASS (a
 * PASS would claim exits that never ran), with `exitRange` recording the slice. A
 * FAIL keeps its own verdict and its predicted/infra tags: the slice says nothing
 * about the exits it did not run. A range covering the whole row skips nothing,
 * so it only records itself.
 */
export function partialCaseResult(result, { range, total, skipped = [] }) {
  if (!range) return result;
  const exitRange = { from: range.from, to: range.to, of: total, skipped: skipped.map((run) => run.index) };
  if (skipped.length === 0) return { ...result, exitRange };
  if (result.result === "FAIL") return { ...result, exitRange };
  const note = `${partialLabel(range, total)}: exit(s) ${exitRange.skipped.join(", ")} not run`;
  return {
    ...result,
    result: "BLOCKED",
    blocker: result.blocker ? `${result.blocker}; ${note}` : note,
    exitRange,
  };
}
