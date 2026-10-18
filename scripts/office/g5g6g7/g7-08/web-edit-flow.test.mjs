/**
 * Pure unit tests for `web-edit-flow.mjs` `runEditStage` (G7-08 w2e2, review r2 findings
 * G708-R2-1, R2-3, R2-4, R2-5, R2-6, R2-9). Every IO step is a scripted fake: the cases assert
 * the order of the steps, what is scored from which step, and the BLOCKED / FAIL mapping.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NATIVE_REDO_SELECTOR, NATIVE_UNDO_SELECTOR, driveUndoRedo, runEditStage } from './web-edit-flow.mjs';

const UNDOABLE = { aiChangeVisibleBeforeSave: true, aiChangeUndoableBeforeSave: true, missingControl: null, undoVia: 'ribbon', redoVia: 'ribbon', undoReverted: true, redoRestored: true };

function makeIo(over = {}) {
  const calls = [];
  const saves = over.saves ?? [{ status: 'saved', versionId: 'V2', revision: '2', version: 2 }, { status: 'saved', versionId: 'V2b', revision: '2', version: 2 }];
  const counts = over.counts ?? [2, 2];
  const io = {
    calls,
    async driveUndoRedo() { calls.push(['undoRedo']); return over.undoRedo ?? UNDOABLE; },
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
  page: {}, frame: {}, sel: { host: '[data-host]' },
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
    assert.equal(out.details.saves.second.revision, '2', 'the artifact carries what the server held after each Save');
    // Order: undo/redo before the first Save; count between the Saves; old bytes after both.
    const order = io.calls.map((c) => c[0]);
    assert.deepEqual(order, ['undoRedo', 'webSave', 'count', 'head', 'webSave', 'count', 'head', 'oldBytes']);
    assert.deepEqual(io.calls.at(-1), ['oldBytes', 1], 'the previous version number is read again');
  });

  it('R2-1: a second Save that added a version is scored as the duplicate, not hidden', async () => {
    const out = await runEditStage(ctx(), makeIo({ counts: [2, 3] }));
    assert.equal(out.observed.doubleClickVersionsCreated, 1);
  });

  it('R2-1: a second Save that never commits is BLOCKED, whatever the host says about being dirty', async () => {
    for (const second of [{ status: 'timeout', reason: 'no commit' }, { status: 'error', httpStatus: 500 }]) {
      const out = await runEditStage(ctx(), makeIo({ saves: [{ status: 'saved', versionId: 'V2', revision: '2', version: 2 }, second], dirtyAfterSecond: false }));
      assert.equal(out.stop.status, 'BLOCKED');
      assert.equal(out.stop.reason, 'missing_double_click_save');
    }
  });

  it('w2m: a second Save that sends no commit is satisfied when the version count is unchanged', async () => {
    const noCommit = { status: 'timeout', reason: 'no frame commit within the bound (save state saved)' };
    const saves = [{ status: 'saved', versionId: 'V2', revision: '2', version: 2 }, noCommit];
    const out = await runEditStage(ctx(), makeIo({ saves, counts: [2, 2] }));
    assert.equal(out.stop, undefined);
    assert.deepEqual(out.details.secondSave, { commitSent: false, versionsDelta: 0 });
    assert.equal(out.observed.doubleClickVersionsCreated, 0);
    const order = io => io.calls.map((c) => c[0]);
    const io = makeIo({ saves, counts: [2, 2] });
    await runEditStage(ctx(), io);
    assert.deepEqual(order(io).slice(-4, -1), ['webSave', 'count', 'head'], 'the count is read after the second Save bound');
  });

  it('w2m: a second Save that committed records commitSent true', async () => {
    const out = await runEditStage(ctx(), makeIo({ counts: [2, 2] }));
    assert.deepEqual(out.details.secondSave, { commitSent: true, versionsDelta: 0 });
  });

  it('w2m: no commit but an unreadable count stays BLOCKED, and a new version is the duplicate', async () => {
    const noCommit = { status: 'timeout', reason: 'no frame commit within the bound' };
    const saves = [{ status: 'saved', versionId: 'V2', revision: '2', version: 2 }, noCommit];
    const blocked = await runEditStage(ctx(), makeIo({ saves, counts: [2, null] }));
    assert.equal(blocked.stop.status, 'BLOCKED');
    assert.equal(blocked.stop.reason, 'missing_version_list');
    const dup = await runEditStage(ctx(), makeIo({ saves, counts: [2, 3] }));
    assert.equal(dup.observed.doubleClickVersionsCreated, 1);
    assert.deepEqual(dup.details.secondSave, { commitSent: false, versionsDelta: 1 });
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

  it('R2-5: undo/redo comes first; a missing control names the native selector; a change that does not come back stops before the Save', async () => {
    const noUndo = await runEditStage(ctx(), makeIo({ undoRedo: { aiChangeVisibleBeforeSave: false, aiChangeUndoableBeforeSave: false, missingControl: 'undo' } }));
    assert.deepEqual(noUndo.stop, { missingSelector: NATIVE_UNDO_SELECTOR });
    const noRedo = await runEditStage(ctx(), makeIo({ undoRedo: { aiChangeVisibleBeforeSave: false, aiChangeUndoableBeforeSave: false, missingControl: 'redo' } }));
    assert.deepEqual(noRedo.stop, { missingSelector: NATIVE_REDO_SELECTOR });
    const io = makeIo({ undoRedo: { ...UNDOABLE, aiChangeUndoableBeforeSave: false, redoRestored: false } });
    const notBack = await runEditStage(ctx(), io);
    assert.equal(notBack.stop.reason, 'ai_change_not_undoable_before_save');
    assert.equal(notBack.stop.details.failed, 'redo', 'a FAIL says which half of the pair failed');
    assert.equal(notBack.stop.details.undoRedo.undoReverted, true);
    assert.equal(notBack.stop.details.undoRedo.redoRestored, false);
    assert.equal(io.calls.some((c) => c[0] === 'webSave'), false, 'nothing is saved after a failed undo/redo');
    const undoFail = await runEditStage(ctx(), makeIo({ undoRedo: { ...UNDOABLE, aiChangeUndoableBeforeSave: false, undoReverted: false, redoRestored: true } }));
    assert.equal(undoFail.stop.details.failed, 'undo');
  });

  it('w2l: an AI turn that produced no edit is named as that, not as a broken undo', async () => {
    const io = makeIo({ undoRedo: { aiChangeVisibleBeforeSave: false, aiChangeUndoableBeforeSave: false, missingControl: null, undoReverted: false, redoRestored: false } });
    const aiTurn = { executedTools: ['propose_operations'], stepTitles: ['Đề xuất thao tác'], panelFootprintText: '', replyText: 'xong' };
    const out = await runEditStage(ctx({ aiTurn }), io);
    assert.equal(out.stop.reason, 'ai_change_not_visible_before_save');
    assert.deepEqual(out.stop.details.aiTurn, aiTurn, 'the row json says what the panel showed and which tools ran');
    assert.equal(io.calls.some((c) => c[0] === 'webSave'), false);
  });

  it('w2l: the row json carries the undo and the redo result separately', async () => {
    const out = await runEditStage(ctx(), makeIo());
    assert.deepEqual(out.details.undoRedo, {
      via: 'ribbon', redoVia: 'ribbon', visible: true, undoable: true, undoReverted: true, redoRestored: true,
    });
  });

  it('R2-6: a missing version list is BLOCKED at either count', async () => {
    const first = await runEditStage(ctx(), makeIo({ counts: [null] }));
    assert.equal(first.stop.reason, 'missing_version_list');
    const second = await runEditStage(ctx(), makeIo({ counts: [2, null] }));
    assert.equal(second.stop.reason, 'missing_version_list');
  });
});

// w2l: a scripted editor. `steps` history entries were made by the AI turn; the ribbon and the
// editor shortcut both walk that history, and the ribbon buttons are enabled only when their
// direction has something to do (the pinned frames bind `disabled` to canUndo / canRedo).
function simEditor({ steps = 1, text = true, ribbon = true, undoWorks = true, redoWorks = true, ribbonUndoEnabled = true, dirtyAfterEdit = true } = {}) {
  const st = { undone: 0 };
  const log = [];
  const move = (which) => {
    if (which === 'undo' && undoWorks && st.undone < steps) st.undone += 1;
    if (which === 'redo' && redoWorks && st.undone > 0) st.undone -= 1;
  };
  const io = {
    log,
    async readEditorText() { return text ? ['after', 'mid', 'mid2', 'before'][Math.min(st.undone, steps) === steps ? 3 : Math.min(st.undone, 2)] : null; },
    async readHostDirty() { return st.undone === 0 ? dirtyAfterEdit : false; },
    async control(_frame, which) {
      if (!ribbon) return { present: false, enabled: null };
      return { present: true, enabled: which === 'undo' ? ribbonUndoEnabled && st.undone < steps : st.undone > 0 };
    },
    async click(_frame, which) { log.push(['click', which]); move(which); },
    async shortcut(_page, which) { log.push(['shortcut', which]); move(which); },
    async focusEditor() {},
    async sleep() {},
  };
  return io;
}
const args = (over = {}) => ({ page: {}, frame: {}, hostSelector: '[data-host]', textBeforeTurn: 'before', ...over });

describe('G7-08 w2l driveUndoRedo: the editor\'s own undo and redo', () => {
  it('H-E1: a text module undoes and redoes through its ribbon controls, never the AI panel snapshot rollback', async () => {
    const io = simEditor({ steps: 1 });
    const out = await driveUndoRedo(args(), io);
    assert.deepEqual(io.log, [['click', 'undo'], ['click', 'redo']]);
    assert.equal(out.undoVia, 'ribbon');
    assert.equal(out.redoVia, 'ribbon');
    assert.equal(out.undoReverted, true);
    assert.equal(out.redoRestored, true);
    assert.equal(out.aiChangeUndoableBeforeSave, true);
    assert.equal(out.missingControl, null);
  });

  it('H-E1: a broken redo is reported as the redo, with the undo still shown as working', async () => {
    const out = await driveUndoRedo(args(), simEditor({ redoWorks: false }));
    assert.equal(out.undoReverted, true);
    assert.equal(out.redoRestored, false);
    assert.equal(out.aiChangeUndoableBeforeSave, false);
  });

  it('H-E1: a broken undo is reported as the undo', async () => {
    const out = await driveUndoRedo(args(), simEditor({ undoWorks: false }));
    assert.equal(out.undoReverted, false);
    assert.equal(out.aiChangeUndoableBeforeSave, false);
  });

  it('a text module whose frame shows no ribbon control falls back to the editor shortcut', async () => {
    const io = simEditor({ ribbon: false });
    const out = await driveUndoRedo(args(), io);
    assert.deepEqual(io.log, [['shortcut', 'undo'], ['shortcut', 'redo']]);
    assert.equal(out.undoVia, 'editor-shortcut');
    assert.equal(out.aiChangeUndoableBeforeSave, true);
  });

  it('a disabled ribbon undo is not clicked: the module history has nothing to undo, which is an observation', async () => {
    const io = simEditor({ ribbonUndoEnabled: false });
    const out = await driveUndoRedo(args(), io);
    assert.equal(io.log.some((c) => c[1] === 'undo'), false);
    assert.equal(out.undoReverted, false);
    assert.equal(out.nativeUndoEnabledAfterEdit, false);
    assert.equal(out.aiChangeUndoableBeforeSave, false);
  });

  it('X-E1 / P-E1: a canvas module (no text surface) walks its own history with the ribbon controls', async () => {
    const io = simEditor({ text: false, steps: 3 });
    const out = await driveUndoRedo(args({ textBeforeTurn: null }), io);
    assert.deepEqual(io.log.map((c) => c[1]), ['undo', 'undo', 'undo', 'redo', 'redo', 'redo']);
    assert.equal(out.missingControl, null, 'a canvas module is not missing a redo control');
    assert.equal(out.undoSteps, 3);
    assert.equal(out.redoSteps, 3);
    assert.equal(out.undoReverted, true);
    assert.equal(out.redoRestored, true);
    assert.equal(out.aiChangeVisibleBeforeSave, true);
    assert.equal(out.aiChangeUndoableBeforeSave, true);
  });

  it('a canvas redo that does not return to the edited state is not restored', async () => {
    const out = await driveUndoRedo(args({ textBeforeTurn: null }), simEditor({ text: false, steps: 2, redoWorks: false }));
    assert.equal(out.undoReverted, true);
    assert.equal(out.redoRestored, false);
  });

  it('a canvas module with no ribbon control names the missing control; a canvas AI turn with no history entry is not visible', async () => {
    const none = await driveUndoRedo(args({ textBeforeTurn: null }), simEditor({ text: false, ribbon: false }));
    assert.equal(none.missingControl, 'undo');
    const quiet = await driveUndoRedo(args({ textBeforeTurn: null }), simEditor({ text: false, steps: 0, dirtyAfterEdit: false }));
    assert.equal(quiet.aiChangeVisibleBeforeSave, false);
    assert.equal(quiet.nativeUndoEnabledAfterEdit, false);
  });
});
