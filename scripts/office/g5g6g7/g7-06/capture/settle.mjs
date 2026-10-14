// "Settled" per contract section 3: no spinner, no transient notification and
// identical consecutive frames over a quiet window. The loop is pure (the
// caller injects the screenshot, the busy probe and the clock) so it is
// unit-tested without a display.
import { createHash } from "node:crypto";

export function frameHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Polls until `identicalFrames` consecutive screenshots hash the same, for at
 * least `quietMs`, while `isBusy()` stays falsy. A busy poll (spinner, a toast
 * or in-progress status message on screen, fonts still loading, the frame not
 * ready) restarts the count, so a frame taken under a spinner never counts.
 * `isBusy` may answer a string saying what is busy; it comes back as `busyWhy`.
 * The budget is `timeoutMs`, or `streamingTimeoutMs` once a poll reported a
 * streaming-load status (`isStreamingStatus`).
 *
 * The quiet window exists because two identical frames 300 ms apart settle on
 * any pause: round 1 shot the sheets view in the middle of "Đang tải theo
 * luồng ..." and the next run after "Đã tải đầy đủ ...", 5177 px apart.
 *
 * Resolves `{status:"settled", frame, frames, waitedMs}` or
 * `{status:"timeout", reason, busyWhy, frames, waitedMs}` where `reason` is
 * `still_busy` (the last poll was busy) or `frames_differ` (the page never
 * stopped changing: animation, a ticking clock or a caret nobody hid).
 */
export async function settle({ grab, isBusy, sleep, now = Date.now, intervalMs = 300, identicalFrames = 2, quietMs = 0, timeoutMs = 45_000, streamingTimeoutMs = 90_000 }) {
  if (!Number.isInteger(identicalFrames) || identicalFrames < 2) throw new Error("settle needs identicalFrames >= 2");
  const started = now();
  let streak = 0;
  let streakSince = started;
  let lastHash = "";
  let lastFrame = null;
  let lastBusy = false;
  let frames = 0;
  let budgetMs = timeoutMs;
  for (;;) {
    lastBusy = await isBusy();
    // a module that says it is streaming its document in gets the longer budget (kept for the rest of the run)
    if (isStreamingStatus(lastBusy)) budgetMs = Math.max(timeoutMs, streamingTimeoutMs);
    if (lastBusy) {
      streak = 0;
      lastHash = "";
    } else {
      const frame = await grab();
      frames += 1;
      const hash = frameHash(frame);
      if (hash === lastHash) streak += 1;
      else {
        streak = 1;
        streakSince = now();
      }
      lastHash = hash;
      lastFrame = frame;
      if (streak >= identicalFrames && now() - streakSince >= quietMs) return { status: "settled", frame, frames, waitedMs: now() - started };
    }
    if (now() - started >= budgetMs) {
      return { status: "timeout", reason: lastBusy ? "still_busy" : "frames_differ", busyWhy: typeof lastBusy === "string" ? lastBusy : "", frame: lastFrame, frames, waitedMs: now() - started };
    }
    await sleep(intervalMs);
  }
}

/**
 * A busy answer of the status kind that says the document is being streamed in
 * ("Đang tải theo luồng a.xlsx: 9 hàng khả dụng.", "Streaming ..."). Only this
 * earns the longer settle budget: a spinner, a toast or any other in-progress
 * status keeps the default.
 */
export function isStreamingStatus(busyWhy) {
  return typeof busyWhy === "string" && /^status "/.test(busyWhy) && /đang\s+tải\s+theo\s+luồng|\bstreaming\b/i.test(busyWhy);
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

/** Transient notifications: a visible match is a screen that is about to change (it fades or is dismissed), so the shot waits for it to go instead of masking it. */
export const TRANSIENT_SELECTORS = [
  "[data-sonner-toast]",
  '[role="alert"]',
  '[class*="toast" i]',
  '[class*="snackbar" i]',
  '[class*="notification" i]',
];

/** Status regions: their text is a message about the state of the app (the sheets status bar, the ribbon echo). */
export const STATUS_SELECTORS = ['[role="status"]', "[aria-live]", '[class*="status-msg" i]', '[class*="workbook-status" i]'];

/**
 * A status text that says the work is still going on (vi + en): "Đang tải theo
 * luồng a.xlsx: 9 hàng khả dụng.", "Đang lập chỉ mục ...", "Loading ...". The
 * finished message ("Đã tải đầy đủ ...") is not busy: it stays, and the shot
 * must show it, not the one before it.
 */
export const PROGRESS_TEXT = /^\s*(đang\s|loading\b|opening\b|saving\b|processing\b|indexing\b|streaming\b|please wait\b|vui lòng chờ\b)|(…|\.\.\.)\s*$/i;

/**
 * In-page probe (runs in every frame of a page): a string saying what is busy,
 * or "" when nothing is. Busy: the document is not complete, web fonts are
 * still loading, a visible spinner-like element is on screen, a visible
 * transient notification is up, or a visible status region reads as in
 * progress. Serialised by Playwright, so it must not close over anything.
 */
export function busyProbe({ selectors, transient, statusSelectors, progressSource }) {
  if (document.readyState !== "complete") return "document not complete";
  if (document.fonts && document.fonts.status === "loading") return "fonts loading";
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const full = (el) => String(el.textContent ?? "").replace(/\s+/g, " ").trim();
  const say = (el) => full(el).slice(0, 80);
  // the probe walks open shadow roots too: a spinner or toast inside a web component is still on screen
  const roots = [document];
  for (let i = 0; i < roots.length; i += 1) {
    // the Next dev overlay (its badge is a persistent "toast") is the dev server's, not the product's
    for (const el of roots[i].querySelectorAll("*")) if (el.shadowRoot && !/^next(js-portal|-route-announcer)$/i.test(el.tagName)) roots.push(el.shadowRoot);
  }
  const first = (list, accept) => {
    for (const root of roots) {
      for (const selector of list) {
        for (const el of root.querySelectorAll(selector)) {
          if (visible(el) && accept(el)) return el;
        }
      }
    }
    return null;
  };
  const spinner = first(selectors, () => true);
  if (spinner) return `spinner ${spinner.getAttribute("role") ?? spinner.tagName.toLowerCase()}`;
  const toast = first(transient, (el) => say(el) !== "");
  if (toast) return `notification "${say(toast)}"`;
  const progress = new RegExp(progressSource, "i");
  // a live region that wraps a whole document is not a status message: only short texts count
  const status = first(statusSelectors, (el) => full(el).length <= 200 && progress.test(full(el)));
  if (status) return `status "${say(status)}"`;
  return "";
}

/** The page-level busy check: any frame of the page reporting busy makes the page busy. */
export async function pageIsBusy(page, selectors = BUSY_SELECTORS) {
  for (const frame of page.frames()) {
    let busy = "";
    try {
      busy = await frame.evaluate(busyProbe, { selectors, transient: TRANSIENT_SELECTORS, statusSelectors: STATUS_SELECTORS, progressSource: PROGRESS_TEXT.source });
    } catch {
      // a frame that is navigating or detached has no answer: not busy-proof, so treat it as busy
      busy = "frame not readable";
    }
    if (busy) return busy;
  }
  return false;
}

/** The failed-fixture reason of a settle that timed out: why, how long, and what was still busy. */
export function notSettledReason(result) {
  return `not_settled:${result.reason}${result.busyWhy ? ` (${result.busyWhy})` : ""} after ${result.waitedMs}ms (${result.frames} frames)`;
}

export const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
