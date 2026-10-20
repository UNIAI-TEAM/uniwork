// G7-08 (UNI-1385) w2l, F-E1: is PDF text edit available in the pinned PDF frame? Read from what the
// frame renders. Its ribbon shows the "Edit text" / "Insert text" `.rb-big` buttons only while its
// pdfTextEdit capability is on (pdf index bundle, `It("pdfTextEdit")&&...`), and it turns that capability
// off after logging "pdfium is unavailable" when the bundled pdfium core fails to start. The pin has no
// `data-tool` / `data-capability` attributes, so the old selector could never match. This module never
// supplies a tool surface: the real offered tools come from the model request the AI turn makes.

import { sleep } from '../harness/app-steps.mjs';

const EDIT_TEXT_LABELS = Object.freeze(['Chỉnh sửa văn bản', 'Edit text']);
const INSERT_TEXT_LABELS = Object.freeze(['Chèn văn bản', 'Insert text']);
const PDFIUM_WARNING = /pdfium is unavailable/i;

const find = (buttons, labels) => {
  const hit = buttons.find((b) => labels.includes(b.text));
  return hit ? { present: true, disabled: hit.disabled === true } : { present: false, disabled: null };
};

/**
 * The frame offers text edit when its Edit-text button stays on the ribbon for `stableMs` (the pdfium
 * init can still switch the capability off just after the frame is ready) and no pdfium warning was
 * logged. `notes()` returns the console lines the driver collected from the frame.
 */
export async function observePdfTextEdit(frame, {
  waitMs = 8_000, pollMs = 250, stableMs = 2_000, now = Date.now, sleep: pause = sleep, notes = () => [],
} = {}) {
  const start = now();
  let presentSince = null;
  let editText = { present: false, disabled: null };
  let insertText = { present: false, disabled: null };
  for (;;) {
    const buttons = await frame.$$eval('.rb-big', (els) => els.map((el) => ({
      text: (el.textContent ?? '').trim(), disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
    }))).catch(() => []);
    editText = find(buttons, EDIT_TEXT_LABELS);
    insertText = find(buttons, INSERT_TEXT_LABELS);
    const pdfiumUnavailable = notes().some((line) => PDFIUM_WARNING.test(String(line)));
    const result = (available) => ({ available, editText, insertText, pdfiumUnavailable, waitedMs: now() - start });
    if (pdfiumUnavailable) return result(false);
    if (editText.present) {
      presentSince ??= now();
      if (now() - presentSince >= stableMs) return result(true);
    } else {
      presentSince = null;
    }
    if (now() - start >= waitMs) return result(false);
    await pause(pollMs);
  }
}
