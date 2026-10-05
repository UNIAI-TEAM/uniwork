// B4ui (UNI-927) - pure helpers for the Transitions panel's advance-timing
// control. Kept out of the component so the ms <-> seconds conversion and the
// validation are unit-testable without a DOM.
//
// The engine half (B4e) stores the auto-advance time as whole milliseconds on
// the slide part; set_advance_time accepts a finite number >= 0 or null to
// clear the timer. The panel edits it in SECONDS (what a presenter thinks in),
// so the conversion lives here with one rounding rule.

/** Seconds shown in the input for an ms value: null/undefined (no timer) is an
 * empty field, not a literal "0". Trailing zeros are trimmed so 5000 ms reads
 * "5" and 1500 ms reads "1.5". */
export function advanceMsToSecondsText(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "";
  const seconds = Math.max(0, ms) / 1000;
  return String(Number(seconds.toFixed(3)));
}

/** What a seconds field means: "clear" (empty -> no auto-advance timer), a
 * non-negative whole number of milliseconds, or "invalid". */
export type PptxAdvanceParse = { kind: "clear" } | { kind: "ms"; ms: number } | { kind: "invalid" };

/** Parse the seconds field. An empty/blank field clears the timer; a finite
 * number >= 0 becomes whole milliseconds (the engine rounds to whole ms);
 * anything else - negative, NaN, Infinity, non-numeric - is invalid and must
 * not reach the edit channel. */
export function parseAdvanceSeconds(text: string): PptxAdvanceParse {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { kind: "clear" };
  // Number("") is 0 and Number("1abc") is NaN; the trimmed guard above already
  // handled the empty case, so a lone "-"/"." stays invalid.
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return { kind: "invalid" };
  return { kind: "ms", ms: Math.round(value * 1000) };
}

/** Whether a seconds field can be committed (a value or a clear, never invalid). */
export function advanceSecondsIsValid(text: string): boolean {
  return parseAdvanceSeconds(text).kind !== "invalid";
}
