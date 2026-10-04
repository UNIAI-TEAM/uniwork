/**
 * Slide-show navigation math (C2, UNI-927).
 *
 * Pure helpers kept out of the components so the show's keyboard contract and
 * its counter/timer formatting are unit-testable: which key means what, and how
 * one action moves the index. Nothing here knows about React or the deck.
 */

/** What one key press asks the show to do. `null` = not a show key. */
export type PptxShowNavAction = "next" | "previous" | "first" | "last" | "exit";

/**
 * PowerPoint's presentation keys: Right / Space / Enter / PageDown / N advance,
 * Left / PageUp / Backspace / P go back, Home / End jump to the ends, Esc exits.
 * The event's raw `key` is matched here, so the caller never re-implements it.
 */
export function resolveShowNavAction(key: string): PptxShowNavAction | null {
  switch (key) {
    case "ArrowRight":
    case " ":
    case "Spacebar":
    case "PageDown":
    case "Enter":
    case "n":
    case "N":
      return "next";
    case "ArrowLeft":
    case "PageUp":
    case "Backspace":
    case "p":
    case "P":
      return "previous";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "Escape":
    case "Esc":
      return "exit";
    default:
      return null;
  }
}

/**
 * Space and Enter also activate a focused control; those two stay with the
 * control, every other show key is handled by the show surface. Shared by the
 * slide-show surface and the presenter overlay so the keyboard contract cannot
 * drift between the two.
 */
export function isShowActivationKey(key: string): boolean {
  return key === " " || key === "Spacebar" || key === "Enter";
}

/** A focused control (button, link, field, contenteditable) owns its own keys. */
export function isShowInteractiveTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName.toLowerCase();
  return tag === "button" || tag === "a" || tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable;
}

/** Bound an index into `[0, count - 1]`; an empty deck stays at 0. */
export function clampSlideIndex(index: number, count: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), Math.max(count - 1, 0));
}

/**
 * Move the index by one action. `next` at the last slide stays on the last
 * slide (PowerPoint ends the show; a web surface that cannot close itself
 * honestly stays put rather than pretending to exit).
 */
export function applyShowNavAction(action: PptxShowNavAction, index: number, count: number): number {
  const current = clampSlideIndex(index, count);
  switch (action) {
    case "next":
      return clampSlideIndex(current + 1, count);
    case "previous":
      return clampSlideIndex(current - 1, count);
    case "first":
      return clampSlideIndex(0, count);
    case "last":
      return clampSlideIndex(count - 1, count);
    case "exit":
      return current;
  }
}

/** True when the action would leave the index unchanged (used for end-of-show hints). */
export function isShowNavNoop(action: PptxShowNavAction, index: number, count: number): boolean {
  return applyShowNavAction(action, index, count) === clampSlideIndex(index, count);
}

/**
 * Elapsed wall-clock as `MM:SS`, growing to `H:MM:SS` past an hour. A negative
 * or non-finite input reads as `00:00` instead of printing a broken clock.
 */
export function formatElapsedClock(elapsedMs: number): string {
  const safeMs = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
