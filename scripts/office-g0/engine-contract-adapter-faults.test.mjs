import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRealAdapter, makeEnvelope, sha256, contained } from './engine-contract-adapter-faults.mjs';

const root = process.env.OFFICE_G0_TEST_TMP;
if (!root) throw new Error('OFFICE_G0_TEST_TMP must name owned scratch');
const original = Buffer.from('unit original');
const output = Buffer.from('unit edited output');
function fixture(t, { held = false, tamper = false, fail = false, refuse = false } = {}) {
  const dir = fs.mkdtempSync(path.join(root, 'unit-'));
  const originalPath = path.join(dir, 'original.docx');
  fs.writeFileSync(originalPath, original);
  let resolve;
  const barrier = new Promise((done) => { resolve = done; });
  let calls = 0;
  let time = 0;
  const post = async (route) => {
    calls++;
    if (route === '/engine/read-file') return { ok: true, result: { base64: output.toString('base64'), hash: sha256(output), size: output.length } };
    if (held) await barrier;
    if (fail) return { ok: false, reachable: false, adapter_code: 'ECONNRESET' };
    if (refuse) return { ok: false, reachable: true, adapter_code: 'engine_error', mapped_code: 'engine_result_invalid' };
    return { ok: true, reachable: true, result: { path: path.join(dir, 'output.docx'), persistedHash: tamper ? '0'.repeat(64) : sha256(output), persistedBytes: output.length, editPersisted: true, allOriginalsRetained: true, replacedBlockText: 'edited' } };
  };
  const adapter = createRealAdapter({ labDir: dir, originalPath, post, now: () => time, timers: false });
  t.after(() => { adapter.close(); fs.rmSync(dir, { recursive: true }); });
  return { adapter, release: resolve, calls: () => calls, advance: (n) => { time = n; }, envelope: (id = 'unit') => makeEnvelope(original, id, 5000) };
}

test('reject wrong contract, protocol type/version and engine before transport or commit', (t) => {
  const f = fixture(t);
  for (const change of [{ contract_version: 'bad' }, { protocol_version: '1' }, { protocol_version: 2 }, { client_engine_version: 'bad' }]) {
    assert.throws(() => f.adapter.submit({ envelope: { ...f.envelope(), ...change }, editText: 'edited' }));
  }
  assert.equal(f.calls(), 0);
  assert.equal(f.adapter.observations().commits, 0);
  assert.equal(f.adapter.observations().jobs, 0);
});

test('checksum mismatch refuses real-result-shaped bytes before any modeled put', async (t) => {
  const f = fixture(t, { tamper: true });
  const job = f.adapter.submit({ envelope: f.envelope(), editText: 'edited' });
  const done = await f.adapter.wait(job.job_id);
  assert.equal(done.state, 'failed');
  assert.equal(done.error.code, 'engine_checksum_mismatch');
  assert.equal(done.observations.puts, 0);
  assert.equal(done.observations.commits, 0);
  assert.equal(done.observations.revision, 7);
});

test('deadline wins while result is held and late result cannot commit', async (t) => {
  const f = fixture(t, { held: true });
  const job = f.adapter.submit({ envelope: f.envelope(), editText: 'edited' });
  f.advance(5000);
  f.adapter.expire(job.job_id);
  assert.equal(f.adapter.snapshot(job.job_id).state, 'timed_out');
  f.release();
  const done = await f.adapter.wait(job.job_id);
  assert.equal(done.state, 'timed_out');
  assert.equal(done.lateDiscarded, true);
  assert.equal(done.observations.commits, 0);
});

test('cancel first discards late completion and retains pending edit', async (t) => {
  const f = fixture(t, { held: true });
  const job = f.adapter.submit({ envelope: f.envelope(), editText: 'edited' });
  assert.equal(f.adapter.cancel(job.job_id).linearized, true);
  f.release();
  const done = await f.adapter.wait(job.job_id);
  assert.equal(done.state, 'cancelled');
  assert.equal(done.editText, 'edited');
  assert.equal(done.lateDiscarded, true);
  assert.equal(done.observations.puts, 0);
});

test('complete first commits once; replay and late cancel do not undo it', async (t) => {
  const f = fixture(t);
  const request = { envelope: f.envelope(), editText: 'edited' };
  const job = f.adapter.submit(request);
  assert.equal((await f.adapter.wait(job.job_id)).state, 'completed');
  const before = f.adapter.observations();
  assert.equal(f.adapter.cancel(job.job_id).already_committed, true);
  assert.equal(f.adapter.submit(request).replay, true);
  assert.equal(f.adapter.observations().commits, 1);
  assert.deepEqual(f.adapter.observations(), before);
  assert.equal(f.calls(), 2);
});

test('transport crash leaves failed job terminal and retry uses a distinct job', async (t) => {
  const f = fixture(t, { fail: true });
  const one = f.adapter.submit({ envelope: f.envelope('one'), editText: 'edited' });
  const done = await f.adapter.wait(one.job_id);
  assert.equal(done.state, 'crashed');
  assert.equal(done.error.code, 'engine_crashed');
  const two = f.adapter.submit({ envelope: f.envelope('two'), editText: 'edited' });
  await f.adapter.wait(two.job_id);
  assert.notEqual(one.job_id, two.job_id);
  assert.equal(f.adapter.observations().commits, 0);
});

test('list, metadata and original bytes never call the unavailable engine', (t) => {
  const f = fixture(t, { fail: true });
  assert.equal(f.adapter.read('/documents/list').documents.length, 1);
  assert.equal(f.adapter.read('/documents/metadata').sha256, sha256(original));
  assert.equal(f.adapter.read('/documents/original').base64, original.toString('base64'));
  assert.equal(f.calls(), 0);
});

test('reachable typed engine refusal is failed, never a fabricated process crash', async (t) => {
  const f = fixture(t, { refuse: true });
  const job = f.adapter.submit({ envelope: f.envelope(), editText: 'edited' });
  const done = await f.adapter.wait(job.job_id);
  assert.equal(done.state, 'failed');
  assert.equal(done.error.code, 'engine_result_invalid');
  assert.equal(done.observations.puts, 0);
  assert.equal(done.observations.commits, 0);
});

test('same-key replay cannot substitute a different retained edit', async (t) => {
  const f = fixture(t);
  const job = f.adapter.submit({ envelope: f.envelope(), editText: 'edited' });
  await f.adapter.wait(job.job_id);
  assert.throws(() => f.adapter.submit({ envelope: f.envelope(), editText: 'different' }), /replay edit differs/);
  assert.equal(f.calls(), 2);
  assert.equal(f.adapter.observations().commits, 1);
});

test('owned-path guard rejects parent traversal without creating a file', () => {
  const outside = path.resolve(root, '../escape.docx');
  const existed = fs.existsSync(outside);
  assert.throws(() => contained(root, outside), /outside owned root/);
  assert.equal(fs.existsSync(outside), existed);
});
