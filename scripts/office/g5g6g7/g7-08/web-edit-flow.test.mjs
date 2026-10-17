/**
 * Pure unit tests for `web-edit-flow.mjs` `runEditStage` (G7-08 w2e2, review r2 findings
 * G708-R2-1, R2-3, R2-4, R2-5, R2-6, R2-9). Every IO step is a scripted fake: the cases assert
 * the order of the steps, what is scored from which step, and the BLOCKED / FAIL mapping.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runEditStage } from './web-edit-flow.mjs';

const UNDOABLE = { aiChangeVisibleBeforeSave: true, aiChangeUndoableBeforeSave: true, missingControl: null, undoVia: 'editor-shortcut' };

function makeIo(over = {}) {
  const calls = [];
  const saves = over.saves ?? [{ status: 'saved', versionId: 'V2', revision: '2', version: 2 }, { status: 'saved', versionId: 'V2b', revision: '2', version: 2 }];
  const counts = over.counts ?? [2, 2];
  const io = {
    calls,
    async driveUndoRedo(args) { calls.push(['undoRedo', args.undoSelector]); return over.undoRedo ?? UNDOABLE; },
    async webSave(_page, opts) { calls.push(['webSave', opts.kind, opts.timeoutMs]); return saves[calls.filter((c) => c[0] === 'webSave').length - 1]; },
    async readVersionCount() {
      calls.push(['count']);
      const next = counts[calls.filter((c) => c[0] === 'count').length - 1];
      return next === null ? { ok: false, reason: 'missing_version_list', detail: 'no versions array' } : { ok: true, count: next };
    },
    async readFrameHead() { calls.push(['head']); return { revision: '2', bytes: new Uint8Array([2]), sha256: 'new-sha', version: 2, versionId: 'V2' }; },
    async readVersionBytes(args) {
      calls.push(['oldBytes', args.version]);
      if (over.oldBytesError) throw new Error(over.oldBytesError);
      return { bytes: new Uint8Array([1]), sha256: over.oldSha ?? 'pre-turn-sha' };
    },
    async readHostDirty() { return over.dirtyAfterSecond ?? false; },
    async readHostState() { return { dirty: false, saveState: 'saved' }; },
  };
  return io;
}

const ctx = (over = {}) => ({
  row: { id: 'M-E1', module: 'markdown', format: 'md' },
  page: {}, frame: {}, sel: { host: '[data-host]' }, undoSelector: 'button.ai-rollback-btn',
  apiOrigin: 'http://api.test', fetchImpl: null, documentId: 'D1', token: 't', timeoutMs: 45_000,
  textBeforeTurn: 'before', versionsAfterAiTurn: 1,
  headAfterAiTurn: { revision: '1', version: 1, versionId: 'V1', sha256: 'pre-turn-sha', bytes: new Uint8Array([1]) },
  commitBases: ['1'],
  ...over,
});

describe('G7-08 w2e2 runEditStage', () => {
  it('R2-1/R2-8: sends the second Save on the row module, scores the second delta, and reads the old version again', async () => {
    const io = makeIo({ counts: [2, 2] });
    const out = await runEditStage(ctx(), io);
    assert.equal(out.stop, undefined);
    assert.deepEqual(io.calls.filter((c) => c[0] === 'webSave').map((c) => c[1]), ['markdown', 'markdown'], 'two Saves, on the markdown host');
    assert.equal(out.observed.doubleClickVersionsCreated, 0);
    assert.equal(out.observed.versionsAfterSave, 2);
    assert.equal(out.observed.saveUsedCurrentBaseRevision, true);
    assert.equal(out.observed.revisionAfterSave, '2');
    assert.equal(out.details.secondSaveOutcome, 'committed');
    // Order: undo/redo before the first Save; count between the Saves; old bytes after both.
    const order = io.calls.map((c) => c[0]);
    assert.deepEqual(order, ['undoRedo', 'webSave', 'count', 'head', 'webSave', 'count', 'head', 'oldBytes']);
    assert.deepEqual(io.calls.at(-1), ['oldBytes', 1], 'the previous version number is read again');
  });

  it('R2-1: a second Save that added a version is scored as the duplicate, not hidden', async () => {
    const out = await runEditStage(ctx(), makeIo({ counts: [2, 3] }));
    assert.equal(out.observed.doubleClickVersionsCreated, 1);
  });

  it('R2-1: a clean second Save that never commits is measured as skipped, a dirty one that never commits is BLOCKED', async () => {
    const skipped = await runEditStage(ctx(), makeIo({ saves: [{ status: 'saved', versionId: 'V2', revision: '2', version: 2 }, { status: 'timeout', reason: 'no commit' }] }));
    assert.equal(skipped.details.secondSaveOutcome, 'skipped_clean');
    assert.equal(skipped.observed.doubleClickVersionsCreated, 0);
    const lost = await runEditStage(ctx(), makeIo({ saves: [{ status: 'saved', versionId: 'V2', revision: '2', version: 2 }, { status: 'timeout', reason: 'no commit' }], dirtyAfterSecond: true }));
    assert.equal(lost.stop.status, 'BLOCKED');
    assert.equal(lost.stop.reason, 'missing_double_click_save');
  });

  it('R2-1: a failed first Save is a FAIL and no second Save is sent', async () => {
    const io = makeIo({ saves: [{ status: 'error', httpStatus: 409 }] });
    const out = await runEditStage(ctx(), io);
    assert.equal(out.stop.status, 'FAIL');
    assert.equal(out.stop.reason, 'web_save_failed_after_ai_edit');
    assert.equal(io.calls.filter((c) => c[0] === 'webSave').length, 1);
  });

  it('R2-3: a Save with no captured commit base_revision is BLOCKED, never "used the current revision"', async () => {
    for (const commitBases of [[], [null]]) {
      const out = await runEditStage(ctx({ commitBases }), makeIo());
      assert.equal(out.stop.status, 'BLOCKED');
      assert.equal(out.stop.reason, 'missing_save_base_revision');
    }
    const stale = await runEditStage(ctx({ commitBases: ['0'] }), makeIo());
    assert.equal(stale.observed.saveUsedCurrentBaseRevision, false);
  });

  it('R2-4: the old-version evidence is the bytes read after the Save; a failed GET is BLOCKED', async () => {
    const mutated = await runEditStage(ctx(), makeIo({ oldSha: 'mutated-in-place' }));
    assert.equal(mutated.observed.oldVersionSha256, 'mutated-in-place', 'not the pre-save head hash');
    assert.notEqual(mutated.observed.oldVersionSha256, ctx().headAfterAiTurn.sha256);
    const failed = await runEditStage(ctx(), makeIo({ oldBytesError: 'HTTP 404' }));
    assert.equal(failed.stop.status, 'BLOCKED');
    assert.equal(failed.stop.reason, 'missing_old_version_bytes_after_save');
    const noNumber = await runEditStage(ctx({ headAfterAiTurn: { revision: '1', version: null, sha256: 'x' } }), makeIo());
    assert.equal(noNumber.stop.reason, 'missing_old_version_bytes_after_save');
  });

  it('R2-5: undo/redo comes first; a missing control names the F selector; a change that does not come back stops before the Save', async () => {
    const noUndo = await runEditStage(ctx(), makeIo({ undoRedo: { aiChangeVisibleBeforeSave: false, aiChangeUndoableBeforeSave: false, missingControl: 'undo' } }));
    assert.deepEqual(noUndo.stop, { missingSelector: 'button.ai-rollback-btn' });
    const noRedo = await runEditStage(ctx(), makeIo({ undoRedo: { aiChangeVisibleBeforeSave: false, aiChangeUndoableBeforeSave: false, missingControl: 'redo' } }));
    assert.match(noRedo.stop.missingSelector, /redo control/);
    const io = makeIo({ undoRedo: { aiChangeVisibleBeforeSave: true, aiChangeUndoableBeforeSave: false, missingControl: null } });
    const notBack = await runEditStage(ctx(), io);
    assert.equal(notBack.stop.reason, 'ai_change_not_undoable_before_save');
    assert.equal(io.calls.some((c) => c[0] === 'webSave'), false, 'nothing is saved after a failed undo/redo');
  });

  it('R2-6: a missing version list is BLOCKED at either count', async () => {
    const first = await runEditStage(ctx(), makeIo({ counts: [null] }));
    assert.equal(first.stop.reason, 'missing_version_list');
    const second = await runEditStage(ctx(), makeIo({ counts: [2, null] }));
    assert.equal(second.stop.reason, 'missing_version_list');
  });
});
