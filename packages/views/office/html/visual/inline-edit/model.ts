/**
 * Pure model for the HTML visual inline-edit bridge (H8).
 *
 * Two decisions live here, both over data that crossed the sandbox boundary:
 *
 *   1. The frame's `text-edit-commit` payload is UNTRUSTED. This module accepts
 *      it only when it matches the shape the S1 protocol declares (`sid` a
 *      positive safe integer inside the inspector's own bound, `text` a
 *      string) and clamps the text to the same ceiling the inspector enforces
 *      (`INSPECTOR_MAX_TEXT`). Anything else is dropped, never coerced.
 *   2. A resize value is a clamped whole-pixel number. A non-finite value is
 *      not a size and returns null; anything outside the range a document may
 *      carry is clamped.
 *
 * Nothing here reads or writes a document, calls an H3 op or touches the DOM:
 * the op builders in `./ops` consume these values, and the bridge applies the
 * patch set they produce through the caller's engine port.
 */

/**
 * The inspector's own text ceiling (`INSPECTOR_MAX_TEXT` in
 * `apps/web/platform/office/preview-inspector.ts`). A commit longer than this
 * could not have been produced by a well-behaved frame, so the text is clamped
 * to it rather than trusted at any length.
 */
export const INLINE_MAX_TEXT = 100_000;

/** Mirrors the inspector's `MAX_SID`: a frame cannot name an unbounded id. */
const INLINE_MAX_SID = 2 ** 31 - 1;

/** The smallest and largest size a resize may write, in CSS pixels. */
const INLINE_MIN_SIZE = 1;
const INLINE_MAX_SIZE = 10_000;

/** A validated text-edit commit: the element id and its new plain text. */
export interface InlineTextCommit {
  sid: number;
  text: string;
}

/**
 * Validate one untrusted frame payload as a `text-edit-commit`.
 *
 * Returns null for every malformed case - not an object, the wrong `type`, a
 * missing/out-of-range `sid`, a non-string `text` - so the caller applies no
 * op. A well-formed commit with an over-long text is clamped, never rejected:
 * the text is escaped on write, and truncation keeps the edit bounded.
 */
export function parseTextEditCommit(event: unknown): InlineTextCommit | null {
  if (event === null || typeof event !== "object" || Array.isArray(event)) return null;
  const record = event as Record<string, unknown>;
  if (record.type !== "text-edit-commit") return null;
  const sid = record.sid;
  if (typeof sid !== "number" || !Number.isSafeInteger(sid) || sid <= 0 || sid > INLINE_MAX_SID) return null;
  const text = record.text;
  if (typeof text !== "string") return null;
  return { sid, text: text.length > INLINE_MAX_TEXT ? text.slice(0, INLINE_MAX_TEXT) : text };
}

/**
 * A resize value: finite, rounded to whole pixels and clamped to the range a
 * document may carry. Non-finite input is not a size and returns null.
 */
export function clampResizeValue(value: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(INLINE_MAX_SIZE, Math.max(INLINE_MIN_SIZE, Math.round(value)));
}
