// "Settled" per contract section 3: no spinner and two identical consecutive
// frames. The loop is pure (the caller injects the screenshot, the busy probe
// and the clock) so it is unit-tested without a display.
import { createHash } from "node:crypto";

export function frameHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Polls until `identicalFrames` consecutive screenshots hash the same while
 * `isBusy()` stays false. A busy poll (spinner, fonts still loading, the frame
 * not ready) restarts the count, so a frame taken under a spinner never counts.
 *
 * Resolves `{status:"settled", frame, frames, waitedMs}` or
 * `{status:"timeout", reason, frames, waitedMs}` where `reason` is
 * `still_busy` (the last poll was busy) or `frames_differ` (the page never
 * stopped changing: animation, a ticking clock or a caret nobody hid).
 */
export async function settle({ grab, isBusy, sleep, now = Date.now, intervalMs = 300, identicalFrames = 2, timeoutMs = 45_000 }) {
  if (!Number.isInteger(identicalFrames) || identicalFrames < 2) throw new Error("settle needs identicalFrames >= 2");
  const started = now();
  let streak = 0;
  let lastHash = "";
  let lastFrame = null;
  let lastBusy = false;
  let frames = 0;
  for (;;) {
    lastBusy = await isBusy();
    if (lastBusy) {
      streak = 0;
      lastHash = "";
    } else {
      const frame = await grab();
      frames += 1;
      const hash = frameHash(frame);
      streak = hash === lastHash ? streak + 1 : 1;
      lastHash = hash;
      lastFrame = frame;
      if (streak >= identicalFrames) return { status: "settled", frame, frames, waitedMs: now() - started };
    }
    if (now() - started >= timeoutMs) {
      return { status: "timeout", reason: lastBusy ? "still_busy" : "frames_differ", frame: lastFrame, frames, waitedMs: now() - started };
    }
    await sleep(intervalMs);
  }
}

/** Selectors whose visible match means "still loading" on either host. */
export const BUSY_SELECTORS = [
  '[aria-busy="true"]',
  '[role="progressbar"]',
  '[data-testid="office-docs-frame-loading"]',
  '[data-testid="office-docs-frame-slow"]',
  ".spinner",
  '[data-state="booting"]',
];

/**
 * In-page probe (runs in every frame of a page): true while the document is not
 * complete, web fonts are still loading, or a visible spinner-like element is
 * on screen. Serialised by Playwright, so it must not close over anything.
 */
export function busyProbe(selectors) {
  if (document.readyState !== "complete") return true;
  if (document.fonts && document.fonts.status === "loading") return true;
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  for (const selector of selectors) {
    for (const el of document.querySelectorAll(selector)) {
      if (visible(el)) return true;
    }
  }
  return false;
}

/** The page-level busy check: any frame of the page reporting busy makes the page busy. */
export async function pageIsBusy(page, selectors = BUSY_SELECTORS) {
  for (const frame of page.frames()) {
    let busy = false;
    try {
      busy = await frame.evaluate(busyProbe, selectors);
    } catch {
      // a frame that is navigating or detached has no answer: not busy-proof, so treat it as busy
      busy = true;
    }
    if (busy) return true;
  }
  return false;
}

export const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
