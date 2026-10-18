/**
 * Pure unit tests for `pdf-text-edit.mjs` (G7-08 w2l, F-E1): the PDF frame's text-edit availability is
 * read from what the frame renders (the `.rb-big` ribbon buttons, shown only while its pdfTextEdit
 * capability is on) and from the pdfium init warning it logs, never from a data attribute the pin
 * does not have and never from a tool surface the harness made up.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { observePdfTextEdit } from './pdf-text-edit.mjs';

// A frame whose ribbon shows `reads[i]` on the i-th read (the last one repeats); time moves 250 ms per sleep.
function fake(reads, notes = []) {
  let read = 0;
  let now = 0;
  return {
    frame: { async $$eval() { return reads[Math.min(read++, reads.length - 1)]; } },
    opts: { waitMs: 6_000, pollMs: 250, stableMs: 1_000, now: () => now, sleep: async (ms) => { now += ms; }, notes: () => notes },
  };
}
const EDIT = { text: 'Chỉnh sửa văn bản', disabled: false };
const INSERT = { text: 'Chèn văn bản', disabled: false };
const OTHER = { text: 'Chèn hình ảnh', disabled: false };

describe('G7-08 w2l observePdfTextEdit', () => {
  it('text-edit buttons that stay on the ribbon mean the frame offers text edit', async () => {
    const { frame, opts } = fake([[OTHER, EDIT, INSERT]]);
    const out = await observePdfTextEdit(frame, opts);
    assert.equal(out.available, true);
    assert.deepEqual(out.editText, { present: true, disabled: false });
    assert.deepEqual(out.insertText, { present: true, disabled: false });
    assert.equal(out.pdfiumUnavailable, false);
  });

  it('the English labels count too', async () => {
    const { frame, opts } = fake([[{ text: 'Edit text', disabled: false }, { text: 'Insert text', disabled: false }]]);
    assert.equal((await observePdfTextEdit(frame, opts)).available, true);
  });

  it('a ribbon without the buttons is unavailable, and nothing is invented about the tool surface', async () => {
    const { frame, opts } = fake([[OTHER]]);
    const out = await observePdfTextEdit(frame, opts);
    assert.equal(out.available, false);
    assert.equal(out.editText.present, false);
    assert.equal('offeredTools' in out, false);
    assert.equal('controls' in out, false);
  });

  it('buttons that vanish before they have been stable (pdfium init failed and the capability went off) are unavailable', async () => {
    const { frame, opts } = fake([[EDIT, INSERT], [OTHER]]);
    assert.equal((await observePdfTextEdit(frame, opts)).available, false);
  });

  it('the pdfium init warning the frame logs makes it unavailable even while the buttons are still up', async () => {
    const { frame, opts } = fake([[EDIT, INSERT]], ['[pdf-web] pdfium is unavailable; text/image edit and annotation delete are off: boom']);
    const out = await observePdfTextEdit(frame, opts);
    assert.equal(out.available, false);
    assert.equal(out.pdfiumUnavailable, true);
  });

  it('a disabled edit button is still an offered control (recorded, not hidden)', async () => {
    const { frame, opts } = fake([[{ ...EDIT, disabled: true }, INSERT]]);
    const out = await observePdfTextEdit(frame, opts);
    assert.equal(out.available, true);
    assert.equal(out.editText.disabled, true);
  });
});
