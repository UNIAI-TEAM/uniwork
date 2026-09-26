import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModel } from './run-contracts.mjs';
import { createDraftStore } from './draft-store.mjs';

function session(model) {
  model.addDocument({ id: 'doc-1', orgId: 'org-1', wsId: 'ws-1', checksum: 'genesis' });
  model.grant('doc-1', 'account-a', 'edit');
  const { sessionId } = model.loginAs({ accountId: 'account-a', orgId: 'org-1', wsId: 'ws-1' });
  // A complete base: a caller that names EITHER half must name both, so the
  // convenience of one candidate is reserved for a call that names no base.
  return { sessionId, docId: 'doc-1', payload: 'unsent local changes', baseRevision: 1, baseVersion: 1 };
}
function memoryRoundTrip(model) {
  const input = session(model);
  const saved = model.saveDraft(input);
  assert.equal(saved.persisted, false, 'memory success must not claim disk persistence');
  assert.equal(model.recoverDraft(input).payload, input.payload);
  model.discardDraft(input);
  assert.deepEqual(model.listDrafts(input), []);
}
test('default memory model saves, recovers and discards without a disk claim', () => {
  memoryRoundTrip(createModel());
});
test('accepted store in memory mode preserves a truthful protocol result', () => {
  memoryRoundTrip(createModel({ draftStore: createDraftStore({ keyProvider: () => Buffer.alloc(32) }) }));
});
for (const identity of [{ durable: true }, {}]) {
  test('an unproven void write cannot become success: ' + JSON.stringify(identity), () => {
    const model = createModel({ draftStore: { ...identity, read: () => [], write: () => undefined } });
    assert.throws(() => model.saveDraft(session(model)), error => error.code === 'draft_recovery_locked');
  });
}
test('a non-array store read locks recovery and refuses replacement', () => {
  let writes = 0;
  const model = createModel({ draftStore: { durable: true, read: () => ({ corrupt: true }), write() { writes++; } } });
  const input = session(model);
  assert.equal(model.listDrafts(input).outcome, 'recovery_locked');
  assert.equal(model.recoverDraft(input).outcome, 'recovery_locked');
  assert.throws(() => model.saveDraft(input), error => error.code === 'draft_recovery_locked');
  assert.equal(writes, 0);
});
test('a thrown memory write still fails with the typed lock code', () => {
  const model = createModel({ draftStore: { durable: false, read: () => [], write() { throw Object.assign(new Error('test fault'), { code: 'EIO' }); } } });
  assert.throws(() => model.saveDraft(session(model)), error => error.code === 'draft_recovery_locked');
});

for (const [label, durable, report] of [
  ['memory failure', false, { persisted: false, failure: 'EIO' }],
  ['memory explicit unsuccessful report', false, { succeeded: false, persisted: false }],
  ['durable explicit unsuccessful report', true, { succeeded: false, persisted: true }],
]) {
  test(label + ' cannot be relabeled as a completed save', () => {
    const store = { durable, read: () => [], write: () => report };
    const model = createModel({ draftStore: store });
    model.addDocument({ id: 'doc-1', orgId: 'org-1', wsId: 'ws-1', checksum: 'genesis' });
    model.grant('doc-1', 'account-a', 'edit');
    const { sessionId } = model.loginAs({ accountId: 'account-a', orgId: 'org-1', wsId: 'ws-1' });
    assert.throws(() => model.saveDraft({ sessionId, docId: 'doc-1', payload: 'unsaved changes', baseRevision: 1 }),
      error => error.code === 'draft_recovery_locked');
  });
}

// --- malformed write reports (UNI-669) -------------------------------------
// The probe main-malformed-write-report-r1-red.json proved that a raw store
// report which is not a report at all was still accepted by memory mode while
// the store wrote nothing. Each value below writes nothing; saveDraft must lock
// recovery instead of returning a successful dirty draft.
const malformedReports = [
  ['empty object', {}],
  ['empty array', []],
  ['Date instance', new Date(0)],
  ['thenable', { then() {} }],
  ['resolved thenable', Promise.resolve({ persisted: true, succeeded: true })],
  ['persisted string', { persisted: 'false' }],
  ['inherited persisted', Object.create({ persisted: false })],
];
for (const [label, report] of malformedReports) {
  test('a malformed memory write report cannot be accepted: ' + label, () => {
    const model = createModel({ draftStore: { durable: false, read: () => [], write: () => report } });
    assert.throws(
      () => model.saveDraft(session(model)),
      (error) => error.code === 'draft_recovery_locked',
    );
  });
  test('a malformed durable write report is refused exactly like memory mode: ' + label, () => {
    const model = createModel({ draftStore: { durable: true, read: () => [], write: () => report } });
    assert.throws(
      () => model.saveDraft(session(model)),
      (error) => error.code === 'draft_recovery_locked',
    );
  });
}
test('a directory-mode report needs an own persisted boolean and no failure', async (t) => {
  const base = { persisted: true, replacedExisting: true, directorySync: { supported: true, synced: true } };
  const good = createModel({ draftStore: { durable: true, read: () => [], write: () => ({ ...base }) } });
  const saved = good.saveDraft(session(good));
  assert.equal(saved.persisted, true, 'an accepted directory report is a successful save');
  assert.equal(saved.replacedExisting, true, 'replacement metadata survives the wrapper');
  for (const [label, report] of [
    ['explicit succeeded:false', { ...base, succeeded: false }],
    ['explicit failure', { ...base, failure: 'EIO' }],
    ['succeeded not true', { ...base, succeeded: 1 }],
    ['missing persisted', { replacedExisting: true, succeeded: true }],
  ]) {
    await t.test('a contradicting directory report stays a failure: ' + label, () => {
      const model = createModel({ draftStore: { durable: true, read: () => [], write: () => report } });
      assert.throws(
        () => model.saveDraft(session(model)),
        (error) => error.code === 'draft_recovery_locked',
      );
    });
  }
});
