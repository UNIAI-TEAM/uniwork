/**
 * Pure unit tests for `save-observe.mjs` (G7-08 w2e, review r2 findings
 * G708-R2-1, R2-2, R2-3, R2-5, R2-6, R2-7, R2-9). No browser, no live server:
 * every case feeds the helper what the driver would have seen and asserts the
 * scored field or the BLOCKED reason (contract w1b: an absent scored field is
 * BLOCKED, never a default).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listVersions } from '../g7-04/cross-host.mjs';
import {
  buildEditSaveObservation,
  buildUndoRedoObserved,
  extractWireUsage,
  isSaveIntentPath,
  observeOldVersionAfterSave,
  parseCommitBaseRevision,
  readVersionBytes,
  readVersionCount,
} from './save-observe.mjs';

describe('G7-08 w2e save-observe pure helpers', () => {
  it('R2-2: isSaveIntentPath matches the frame upload/commit routes and the legacy version route only', () => {
    // The three real routes: host upload (docs-frame-api.ts:246), frame commit
    // (:249), legacy version create (handler documents.go).
    assert.equal(isSaveIntentPath('/api/v1/office-frame/documents/01J8X4VER0N1P2Q3R4S5T6U7V8/uploads'), true);
    assert.equal(isSaveIntentPath('/api/v1/office-frame/documents/01J8X4VER0N1P2Q3R4S5T6U7V8/versions/commit'), true);
    assert.equal(isSaveIntentPath('/api/v1/documents/01J8X4VER0N1P2Q3R4S5T6U7V8/versions'), true);
    // Not save intents: reads, the AI turn itself, an unrelated POST.
    assert.equal(isSaveIntentPath('/api/v1/office-frame/documents/01J8X4VER0N1P2Q3R4S5T6U7V8/content'), false);
    assert.equal(isSaveIntentPath('/api/v1/office-frame/documents/01J8X4VER0N1P2Q3R4S5T6U7V8/ai/uniwork/chat/completions'), false);
    // The Documents commit route (router/documents.go:164) is a save intent too.
    assert.equal(isSaveIntentPath('/api/v1/documents/01J8X4VER0N1P2Q3R4S5T6U7V8/versions/commit'), true);
    assert.equal(isSaveIntentPath('/api/v1/documents/01J8X4VER0N1P2Q3R4S5T6U7V8/versions/3'), false);
    assert.equal(isSaveIntentPath(''), false);
    assert.equal(isSaveIntentPath(undefined), false);
  });

  it('R2-3: parseCommitBaseRevision reads the commit base or reports nothing (never a default)', () => {
    assert.equal(parseCommitBaseRevision('{"upload_id":"u1","base_revision":2}'), '2');
    assert.equal(parseCommitBaseRevision('{"base_revision":"7"}'), '7');
    assert.equal(parseCommitBaseRevision(null), null);
    assert.equal(parseCommitBaseRevision(''), null);
    assert.equal(parseCommitBaseRevision('{}'), null);
    assert.equal(parseCommitBaseRevision('{"base_revision":null}'), null);
    assert.equal(parseCommitBaseRevision('not json'), null);
  });

  it('R2-7: extractWireUsage counts a response without usage as unknown, never as 0', () => {
    assert.deepEqual(extractWireUsage([]), { modelCalls: 0, inputTokens: 0, outputTokens: 0, missingUsageCalls: 0 });
    assert.deepEqual(
      extractWireUsage([
        { usage: { prompt_tokens: 120, completion_tokens: 30 } },
        { usage: { input_tokens: 80, output_tokens: 20 } },
      ]),
      { modelCalls: 2, inputTokens: 200, outputTokens: 50, missingUsageCalls: 0 },
    );
    // The review's case: a 200 with no usage must not be a trusted 0-token call.
    assert.deepEqual(extractWireUsage([{ status: 200 }]), {
      modelCalls: 1, inputTokens: 0, outputTokens: 0, missingUsageCalls: 1,
    });
    // One count without the other is unknown too.
    assert.equal(extractWireUsage([{ usage: { prompt_tokens: 10 } }]).missingUsageCalls, 1);
    assert.deepEqual(extractWireUsage([{ usage: { prompt_tokens: 10, completion_tokens: 5 } }, {}]), {
      modelCalls: 2, inputTokens: 10, outputTokens: 5, missingUsageCalls: 1,
    });
  });

  it('R2-6: readVersionCount asks for the strict list and BLOCKs when the array is absent', async () => {
    const seen = [];
    const ok = await readVersionCount(async (args) => (seen.push(args), 3), { apiOrigin: 'http://a', documentId: 'D1', token: 't' });
    assert.deepEqual(ok, { ok: true, count: 3 });
    assert.equal(seen[0].strict, true, 'the g7-08 side asks for the strict form');

    const missing = await readVersionCount(async () => {
      throw new Error('missing_version_list: the body carries no versions array');
    }, { apiOrigin: 'http://a', documentId: 'D1', token: 't' });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, 'missing_version_list');
  });

  it('R2-6: listVersions keeps its lenient default and throws only for the strict g7-08 caller', async () => {
    const fetchWith = (body) => async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    const args = { apiOrigin: 'http://api.test', documentId: 'D1', token: 't' };
    // G7-04 semantics unchanged: a 200 without a versions array is still 0.
    assert.equal(await listVersions({ ...args, fetchImpl: fetchWith({}) }), 0);
    assert.equal(await listVersions({ ...args, fetchImpl: fetchWith({ versions: [{}, {}] }) }), 2);
    // The strict form: no array is an absent scored field, an empty array is a real 0.
    await assert.rejects(listVersions({ ...args, fetchImpl: fetchWith({}), strict: true }), /missing_version_list/);
    await assert.rejects(listVersions({ ...args, fetchImpl: fetchWith({ versions: null }), strict: true }), /missing_version_list/);
    assert.equal(await listVersions({ ...args, fetchImpl: fetchWith({ versions: [] }), strict: true }), 0);
    const blocked = await readVersionCount(listVersions, { ...args, fetchImpl: fetchWith({}) });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'missing_version_list');
  });

  it('R2-4: the old version is read again by number; no number or a failed GET is BLOCKED', async () => {
    const seen = [];
    const ok = await observeOldVersionAfterSave({ readBytes: async (v) => (seen.push(v), { bytes: new Uint8Array([1]), sha256: 'abc' }), version: 3 });
    assert.deepEqual({ ok: ok.ok, sha256: ok.sha256, version: ok.version }, { ok: true, sha256: 'abc', version: 3 });
    assert.deepEqual(seen, [3]);
    for (const version of [null, undefined, '3']) {
      const noNumber = await observeOldVersionAfterSave({ readBytes: async () => assert.fail('no GET without a number'), version });
      assert.equal(noNumber.reason, 'missing_old_version_bytes_after_save');
    }
    const failed = await observeOldVersionAfterSave({ readBytes: async () => { throw new Error('HTTP 404'); }, version: 1 });
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, 'missing_old_version_bytes_after_save');
    assert.match(failed.detail, /404/);
  });

  it('R2-4: readVersionBytes asks the owner download route for that version and hashes the bytes', async () => {
    const urls = [];
    const fetchImpl = async (url) => { urls.push(String(url)); return new Response(new Uint8Array([7, 8, 9]), { status: 200 }); };
    const out = await readVersionBytes({ apiOrigin: 'http://api.test', fetchImpl, documentId: 'D1', token: 't', version: 2 });
    assert.deepEqual(urls, ['http://api.test/api/v1/documents/D1/download?version=2']);
    assert.deepEqual([...out.bytes], [7, 8, 9]);
    assert.match(out.sha256, /^[0-9a-f]{64}$/);
  });

  it('R2-5: undo/redo observation never infers visibility from executed tools', () => {
    // executedTools alone (dirty false, nothing reverted) is not visibility.
    assert.deepEqual(
      buildUndoRedoObserved({ contentChanged: false, dirtyAfterEdit: false, undoReverted: false, redoRestored: false, undoControl: true, redoControl: true }),
      { aiChangeVisibleBeforeSave: false, aiChangeUndoableBeforeSave: false, missingControl: null },
    );
    // Visible but the undo/redo round trip did not hold: not undoable.
    assert.deepEqual(
      buildUndoRedoObserved({ contentChanged: true, dirtyAfterEdit: true, undoReverted: true, redoRestored: false, undoControl: true, redoControl: true }),
      { aiChangeVisibleBeforeSave: true, aiChangeUndoableBeforeSave: false, missingControl: null },
    );
    // The full round trip: undo reverted, redo restored.
    assert.deepEqual(
      buildUndoRedoObserved({ contentChanged: true, dirtyAfterEdit: true, undoReverted: true, redoRestored: true, undoControl: true, redoControl: true }),
      { aiChangeVisibleBeforeSave: true, aiChangeUndoableBeforeSave: true, missingControl: null },
    );
    // A canvas module with no readable text surface: the host dirty flag speaks.
    assert.deepEqual(
      buildUndoRedoObserved({ contentChanged: null, dirtyAfterEdit: true, undoReverted: true, redoRestored: true, undoControl: true, redoControl: true }),
      { aiChangeVisibleBeforeSave: true, aiChangeUndoableBeforeSave: true, missingControl: null },
    );
    // Missing controls: BLOCKED for the caller, owner F.
    assert.deepEqual(
      buildUndoRedoObserved({ contentChanged: true, dirtyAfterEdit: true, undoControl: false, redoControl: false }),
      { aiChangeVisibleBeforeSave: false, aiChangeUndoableBeforeSave: false, missingControl: 'undo' },
    );
    assert.equal(buildUndoRedoObserved({ undoControl: true, redoControl: false }).missingControl, 'redo');
  });

  it('R2-1/R2-3: buildEditSaveObservation scores the SECOND Save delta, never the first', () => {
    const base = {
      doubleSave: { presses: 2, first: { status: 'saved' }, second: { status: 'saved' } },
      versionsAfterFirstSave: 2, versionsAfterSecondSave: 2,
      revisionAfterAiTurn: '2', lastCommitBaseRevision: '2',
    };
    const ok = buildEditSaveObservation(base);
    assert.equal(ok.ok, true);
    assert.equal(ok.observed.doubleClickVersionsCreated, 0, 'two Saves of one edit add no second version');
    assert.equal(ok.observed.versionsAfterSave, 2);
    assert.equal(ok.observed.saveUsedCurrentBaseRevision, true);

    // A second Save that DID create a version is scored as the duplicate it is.
    assert.equal(buildEditSaveObservation({ ...base, versionsAfterSecondSave: 3 }).observed.doubleClickVersionsCreated, 1);

    // A single Save is never the first delta: BLOCKED.
    assert.equal(buildEditSaveObservation({ ...base, doubleSave: { presses: 1, first: { status: 'saved' } } }).reason, 'missing_double_click_save');
    assert.equal(buildEditSaveObservation({ ...base, doubleSave: null }).reason, 'missing_double_click_save');

    // A second Save that never committed (skipped, timed out, errored) is a lost Save, not a +0.
    for (const second of [{ status: 'timeout', dirty: false }, { status: 'timeout', dirty: true }, { status: 'error', httpStatus: 500 }, null]) {
      assert.equal(
        buildEditSaveObservation({ ...base, doubleSave: { presses: 2, first: { status: 'saved' }, second } }).reason,
        'missing_double_click_save',
      );
    }

    // A failed first Save names its own reason.
    assert.equal(
      buildEditSaveObservation({ ...base, doubleSave: { presses: 2, first: { status: 'error', httpStatus: 409 }, second: { status: 'saved' } } }).reason,
      'web_save_failed_after_ai_edit',
    );

    // No commit base captured (R2-3): BLOCKED, never "used the current revision".
    assert.equal(buildEditSaveObservation({ ...base, lastCommitBaseRevision: null }).reason, 'missing_save_base_revision');
    assert.equal(buildEditSaveObservation({ ...base, lastCommitBaseRevision: undefined }).reason, 'missing_save_base_revision');

    // A stale base is reported as the failure it is, not as a pass.
    assert.equal(
      buildEditSaveObservation({ ...base, lastCommitBaseRevision: '1' }).observed.saveUsedCurrentBaseRevision,
      false,
    );

    // A missing version count is BLOCKED (R2-6), not a delta of 0.
    assert.equal(buildEditSaveObservation({ ...base, versionsAfterSecondSave: undefined }).reason, 'missing_version_list');
    assert.equal(buildEditSaveObservation({ ...base, versionsAfterFirstSave: undefined }).reason, 'missing_version_list');
  });
});
