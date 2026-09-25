import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRealAdapter, startAdapterSurface, makeEnvelope, sha256, contained } from './engine-contract-adapter-faults.mjs';
import { httpCall } from './engine-contract-adapter.mjs';
import { findWorkspaceRoot, verifySourceProvenance, resolvePinState, assertPinState, verifyNodeIdentity,
  verifyUpstreamCheckout, sourceTreeDigest, spawnHost, waitForIdentity, probePortFree,
  captureOwnedChildDescendants, cleanupOwned } from './run-engine-contract-lab.mjs';

const rootIndex = process.argv.indexOf('--owned-root');
if (rootIndex < 0 || !process.argv[rootIndex + 1]) throw new Error('--owned-root is required');
const q = fs.realpathSync(process.argv[rootIndex + 1]);
const owner = JSON.parse(fs.readFileSync(path.join(q, 'managed-root.json'), 'utf8'));
assert.equal(owner.feature, 'UNI-668-real-adapter-faults-g48');
assert.equal(fs.realpathSync(owner.root), q, 'managed root must match the explicit owner record');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workspace = findWorkspaceRoot(q);
assert.ok(q.startsWith(path.join(workspace, '.uniwork-dev') + path.sep), 'scratch must be in managed workspace');
assert.ok(!q.startsWith(repoRoot + path.sep) && !repoRoot.startsWith(q + path.sep) || repoRoot === path.join(q, 'runner'), 'only the staged runner may overlap its managed scratch');
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const pin = '09485f884dc845cf3bf27fb7edfe489f9d457aad';
const manifest = path.join(repoRoot, 'docs/office/g0/source-manifest.json');
const source = path.join(workspace, '.uniwork-dev/office-g0/bootstrap-source');
const pins = json(path.join(q, 'source-pins.json'));
for (const row of pins.files) {
  assert.equal(sha256(fs.readFileSync(path.join(q, row.path))), row.sha256, 'staged pin ' + row.path);
  if (row.path.startsWith('runner/')) assert.equal(sha256(fs.readFileSync(path.join(repoRoot, row.path.slice(7)))), row.sha256, 'executing baseline pin ' + row.path);
}
const original = fs.readFileSync(path.join(q, 'inputs/g0-kitchen-sink.docx'));
fs.mkdirSync(contained(q, path.join(q, 'lab')), { recursive: true });
const work = fs.mkdtempSync(contained(q, path.join(q, 'lab/run-')));
const plan = {
  workDir: work, labDir: path.join(work, 'lab'), tmpDir: path.join(work, 'tmp'), logDir: path.join(work, 'logs'),
  evidenceDir: work, existsSync: fs.existsSync,
  sourceRoot: source, nodeExe: process.execPath, tsx: path.join(source, 'node_modules/tsx/dist/cli.mjs'),
  hostEntry: path.join(repoRoot, 'e2e/office-g0/engine-contract-fault-host.mts'), prebundlePath: path.join(q, 'inputs/pptx-ops.mjs'),
};
for (const dir of [plan.labDir, plan.tmpDir, plan.logDir]) fs.mkdirSync(contained(q, dir), { recursive: true });
const childEnv = { ...process.env, TEMP: plan.tmpDir, TMP: plan.tmpDir, TMPDIR: plan.tmpDir, OFFICE_G0_TEST_TMP: plan.tmpDir, TSX_DISABLE_CACHE: '1' };
delete childEnv.TYPESAFE_API_KEY;
const record = {
  schemaVersion: 1, issue: 'UNI-668', task: 'DOC-004 six canonical real-adapter faults', startedAt: new Date().toISOString(),
  scope: 'real pinned DOCX engine and loopback HTTP adapter; modeled reference business auth/store/commit and local document catalogue',
  input: { path: path.join(q, 'inputs/g0-kitchen-sink.docx'), sha256: sha256(original), bytes: original.length },
  work, source, sourcePins: pins.files, hostRuns: [], cleanup: [], cases: [], controls: [], ok: false,
  limitations: ['No product Go service, ACL, real object storage or durable database.', 'Cancellation/deadline discard results at adapter boundary; the engine still finishes staging bytes.', 'Engine restart is real; reference business job map survives in the parent, not a durable service restart.', 'Windows process cleanup follows accepted launcher observation limits; no Job Object guarantee.', 'No browser/native cross-platform or whole DOC004/G0 acceptance.'],
};
const save = () => fs.writeFileSync(path.join(work, 'evidence.json'), JSON.stringify(record, null, 2) + '\n');
let host = null;
let descendants = null;
let generation = 0;
const surfaces = new Set();
const artifactPins = new Map();
const transcript = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function call(baseUrl, route, body = {}) {
  const response = await httpCall({ baseUrl, route, body, timeoutMs: 10000 });
  transcript.push({ at: new Date().toISOString(), baseUrl, route, request: body, response });
  return response;
}
const engineUrl = () => 'http://127.0.0.1:' + plan.enginePort;
async function result(baseUrl, route, body = {}) {
  const response = await call(baseUrl, route, body);
  assert.equal(response.parsed?.ok, true, route + ': ' + JSON.stringify(response));
  return response.parsed.result;
}
async function until(probe, predicate, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let latest;
  while (Date.now() < deadline) {
    latest = await probe();
    if (predicate(latest)) return latest;
    await pause(35);
  }
  throw new Error('timed out waiting for ' + label + ': ' + JSON.stringify(latest));
}
async function boot() {
  assert.equal((await probePortFree(plan.enginePort)).free, true, 'refuse occupied port');
  plan.logDir = contained(q, path.join(work, 'logs/host-' + (++generation)));
  host = spawnHost(plan, { env: childEnv });
  host.child.on('error', () => {});
  const identity = await waitForIdentity({ baseUrl: engineUrl(), expected: { source, lab: plan.labDir, prebundle: plan.prebundlePath },
    child: host.child, requiredRoutes: ['/engine/docx-edit', '/engine/read-file'], timeoutMs: 30000 });
  descendants = await captureOwnedChildDescendants(host.child);
  const ping = await result(engineUrl(), '/engine/ping');
  record.hostRuns.push({ generation, pid: host.child.pid, identity, ping, descendants, command: host.command,
    stdoutLog: host.outPath, stderrLog: host.errPath });
  save();
}
async function stop(reason) {
  if (!host) return;
  const owned = host;
  const cleanup = await cleanupOwned({ plan, host: owned.child, descendants: descendants?.ok ? descendants.pids : null });
  record.cleanup.push({ generation, pid: owned.child.pid, reason, ...cleanup });
  host = null;
  descendants = null;
  assert.equal(cleanup.host.ok, true, 'owned host cleanup');
  assert.equal(cleanup.portReleased.released, true, 'owned port release');
  save();
}
async function context(id) {
  const labDir = contained(q, path.join(plan.labDir, id));
  fs.mkdirSync(labDir);
  const originalPath = path.join(labDir, 'original.docx');
  fs.writeFileSync(originalPath, original, { flag: 'wx' });
  const adapter = createRealAdapter({ labDir, originalPath, baseUrl: engineUrl() });
  const surface = await startAdapterSurface(adapter);
  surfaces.add(surface);
  return { id, adapter, surface, originalPath };
}
async function submit(ctx, id, { deadline = 30000, fault = null, text = 'UNI-668 G48 ' + id } = {}) {
  const metadata = await result(ctx.surface.baseUrl, '/documents/metadata');
  const envelope = makeEnvelope(original, id, deadline, metadata.revision, metadata.version);
  const request = { envelope, editText: text, fault };
  return { request, ...(await result(ctx.surface.baseUrl, '/lab/submit', request)) };
}
async function status(ctx, job) { return result(ctx.surface.baseUrl, '/lab/status', { job_id: job.job_id }); }
async function finish(ctx, job) {
  await ctx.adapter.wait(job.job_id);
  const actual = await status(ctx, job);
  if (actual.output) {
    const bytes = fs.readFileSync(actual.output.path);
    assert.equal(sha256(bytes), actual.output.sha256, 'real output matches disk');
    assert.equal(actual.output.editPersisted, true);
    assert.equal(actual.output.allOriginalsRetained, true);
    assert.equal(actual.output.editText, actual.editText);
    artifactPins.set(actual.output.path, actual.output.sha256);
  }
  return actual;
}
async function held(job) {
  const hold = await until(() => result(engineUrl(), '/fault/status', { viewId: job.view_id }), (r) => r.held, 'real output held');
  assert.equal(hold.result.editPersisted, true);
  assert.equal(sha256(fs.readFileSync(hold.result.path)), hold.result.persistedHash);
  artifactPins.set(hold.result.path, hold.result.persistedHash);
  return hold;
}
async function release(job) { return result(engineUrl(), '/fault/release', { viewId: job.view_id }); }
async function caseRun(id, expected, run) {
  const start = transcript.length;
  const row = { id, expected, input: record.input, runtime: { before: record.hostRuns.at(-1), node: record.runtime, upstream_pin: pin }, evidence_kind: 'real_adapter_with_modeled_business_boundary', pass: false };
  try { row.actual = await run(); row.pass = true; }
  catch (error) { row.blocker = error.stack; }
  row.runtime.after = record.hostRuns.at(-1);
  row.transcript = transcript.slice(start);
  record.cases.push(row);
  fs.writeFileSync(path.join(work, id + '.json'), JSON.stringify(row, null, 2) + '\n');
  save();
  console.log(id + ': ' + (row.pass ? 'PASS' : 'BLOCKED ' + row.blocker));
}

try {
  record.pin = assertPinState(resolvePinState({ manifestPath: manifest, sourceRoot: source, expectedPin: pin, adapterUpstreamPin: pin }));
  record.provenance = verifySourceProvenance({ manifestPath: manifest, sourceRoot: source });
  assert.equal(record.provenance.verified, true, JSON.stringify(record.provenance.problems));
  record.runtime = verifyNodeIdentity({ plan, manifestNode: json(manifest).runtime.node, observedVersion: process.version, workspaceRoot: workspace });
  assert.equal(record.runtime.verified, true, JSON.stringify(record.runtime.problems));
  record.upstream = verifyUpstreamCheckout({ upstreamRoot: path.join(workspace, 'genoffice'), manifestPath: manifest });
  assert.equal(record.upstream.verified, true, 'upstream commit/tree/clean proof');
  record.sourceBefore = sourceTreeDigest(source);
  record.candidateHashes = ['scripts/office-g0/engine-contract-adapter-faults.mjs', 'e2e/office-g0/engine-contract-fault-host.mts', 'scripts/office-g0/run-engine-contract-faults.mjs', 'scripts/office-g0/engine-contract-adapter-faults.test.mjs'].map((name) => ({ path: name, sha256: sha256(fs.readFileSync(path.join(repoRoot, name))) }));
  plan.enginePort = await availablePort();
  await boot();

  await caseRun('type-version-mismatch', { wrongTypesAndVersionsRefused: true, invalidJobs: 0, invalidPuts: 0, invalidCommits: 0, validControl: 'completed' }, async () => {
    const ctx = await context('type-version');
    const refusals = [];
    for (const patch of [{ contract_version: 'uniwork-office-engine-contract/999' }, { protocol_version: '1' }, { protocol_version: 2 }, { client_engine_version: 'untrusted@0' }]) {
      const reply = await call(ctx.surface.baseUrl, '/lab/submit', { envelope: { ...makeEnvelope(original, 'invalid'), ...patch }, editText: 'invalid' });
      assert.equal(reply.transport_status, 400);
      assert.equal(reply.parsed.ok, false);
      refusals.push(reply);
    }
    const before = ctx.adapter.observations();
    assert.deepEqual([before.jobs, before.puts, before.commits, before.revision], [0, 0, 0, 7]);
    const malformed = await result(ctx.surface.baseUrl, '/lab/submit', {
      envelope: makeEnvelope(Buffer.from('not a DOCX package'), 'real-refusal'), editText: 'must not commit',
    });
    const engineRefusal = await finish(ctx, malformed);
    assert.equal(engineRefusal.state, 'failed');
    assert.equal(engineRefusal.error.code, 'engine_result_invalid');
    assert.deepEqual([engineRefusal.observations.puts, engineRefusal.observations.commits], [0, 0]);
    const control = await finish(ctx, await submit(ctx, 'valid-control'));
    assert.equal(control.state, 'completed');
    assert.equal(control.observations.commits, 1);
    return { refusals, before, engineRefusal, control };
  });

  await caseRun('checksum-mismatch', { state: 'failed', code: 'engine_checksum_mismatch', puts: 0, commits: 0, revision: 7 }, async () => {
    const ctx = await context('checksum');
    const rejected = await finish(ctx, await submit(ctx, 'checksum-refusal', { fault: 'checksum' }));
    assert.equal(rejected.state, 'failed');
    assert.equal(rejected.error.code, 'engine_checksum_mismatch');
    assert.equal(rejected.error.status, 502);
    assert.deepEqual([rejected.observations.puts, rejected.observations.commits, rejected.observations.ledgerRows, rejected.observations.revision], [0, 0, 0, 7]);
    assert.notEqual(rejected.output.declared_checksum, rejected.output.sha256);
    const control = await finish(ctx, await submit(ctx, 'checksum-control'));
    assert.equal(control.state, 'completed');
    return { rejected, control, qualification: 'Real bytes; controlled host-response checksum field; modeled auth/store/commit. Prior UNMET one-put revision remains historical.' };
  });

  await caseRun('timeout', { state: 'timed_out', code: 'engine_timeout', lateDiscarded: true, puts: 0, commits: 0, editRetained: true }, async () => {
    const ctx = await context('timeout');
    const job = await submit(ctx, 'deadline', { deadline: 5000, fault: 'hold' });
    const barrier = await held(job);
    const timedOut = await until(() => status(ctx, job), (r) => r.state === 'timed_out', 'deadline settles');
    assert.equal(timedOut.error.code, 'engine_timeout');
    await release(job);
    const late = await finish(ctx, job);
    assert.equal(late.state, 'timed_out');
    assert.equal(late.lateDiscarded, true);
    assert.deepEqual([late.observations.puts, late.observations.commits, late.observations.revision], [0, 0, 7]);
    const retry = await finish(ctx, await submit(ctx, 'deadline-retry', { text: late.editText }));
    assert.equal(retry.state, 'completed');
    assert.equal(retry.output.editText, late.editText);
    return { job, barrier, timedOut, late, retry };
  });

  await caseRun('cancel-complete-race', { cancelFirst: 'cancelled', cancelFirstCommits: 0, lateDiscarded: true, completeFirst: 'completed', completeFirstCommits: 1 }, async () => {
    const first = await context('cancel-first');
    const job = await submit(first, 'cancel-first', { fault: 'hold' });
    const barrier = await held(job);
    const cancel = await result(first.surface.baseUrl, '/lab/cancel', { job_id: job.job_id });
    assert.equal(cancel.linearized, true);
    await release(job);
    const cancelled = await finish(first, job);
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(cancelled.lateDiscarded, true);
    assert.equal(cancelled.observations.commits, 0);
    assert.equal(cancelled.observations.puts, 0);
    const retry = await finish(first, await submit(first, 'cancel-retry', { text: cancelled.editText }));
    assert.equal(retry.state, 'completed');
    const second = await context('complete-first');
    const winner = await submit(second, 'complete-first', { fault: 'hold' });
    await held(winner);
    await release(winner);
    const completed = await finish(second, winner);
    assert.equal(completed.state, 'completed');
    const lateCancel = await result(second.surface.baseUrl, '/lab/cancel', { job_id: winner.job_id });
    assert.equal(lateCancel.linearized, false);
    assert.equal(lateCancel.already_committed, true);
    const after = await status(second, winner);
    assert.equal(after.state, 'completed');
    assert.equal(after.observations.commits, 1);
    const replay = await result(second.surface.baseUrl, '/lab/submit', winner.request);
    assert.equal(replay.replay, true);
    assert.equal(second.adapter.observations().commits, 1);
    return { barrier, cancel, cancelled, retry, completed, lateCancel, after, replay };
  });

  await caseRun('crash-restart', { oldJob: 'crashed', oldCommits: 0, newJob: 'completed', distinctJobAndProcess: true, priorArtifactPreserved: true }, async () => {
    const ctx = await context('crash');
    const job = await submit(ctx, 'crash-held', { fault: 'hold' });
    const barrier = await held(job);
    const oldHost = record.hostRuns.at(-1);
    await stop('injected actual process crash while real result held');
    const crashed = await finish(ctx, job);
    assert.equal(crashed.state, 'crashed');
    assert.equal(crashed.error.code, 'engine_crashed');
    assert.equal(crashed.observations.commits, 0);
    const down = await call(engineUrl(), '/engine/ping');
    assert.equal(down.reachable, false);
    await boot();
    const newHost = record.hostRuns.at(-1);
    assert.notEqual(newHost.ping.g48.pid, oldHost.ping.g48.pid);
    const newJob = await submit(ctx, 'crash-retry', { text: crashed.editText });
    const recovered = await finish(ctx, newJob);
    assert.notEqual(newJob.job_id, job.job_id);
    assert.equal(recovered.state, 'completed');
    assert.equal(recovered.observations.commits, 1);
    const oldAfter = await status(ctx, job);
    assert.equal(oldAfter.state, 'crashed');
    assert.equal(sha256(fs.readFileSync(barrier.result.path)), barrier.result.persistedHash);
    return { job, barrier, oldHost, crashed, down, newHost, newJob, recovered, oldAfter };
  });

  await caseRun('metadata-access-engine-down', { engineReachable: false, list: true, metadata: true, originalBytesMatch: true, writes: 0 }, async () => {
    const ctx = await context('metadata');
    const before = {};
    for (const route of ['/documents/list', '/documents/metadata', '/documents/original']) before[route] = await result(ctx.surface.baseUrl, route);
    await stop('engine unavailable for business host reads');
    const engine = await call(engineUrl(), '/engine/ping');
    assert.equal(engine.reachable, false);
    const after = {};
    for (const route of ['/documents/list', '/documents/metadata', '/documents/original']) after[route] = await result(ctx.surface.baseUrl, route);
    assert.deepEqual(after, before);
    assert.equal(sha256(Buffer.from(after['/documents/original'].base64, 'base64')), sha256(original));
    assert.equal(after['/documents/list'].documents.length, 1);
    assert.equal(ctx.adapter.observations().commits, 0);
    return { engine, before, after, boundary: 'Real loopback adapter host; modeled local document catalogue and original bytes, no product ACL/database.' };
  });
} catch (error) {
  record.blocker = error.stack;
  console.error(record.blocker);
} finally {
  try { await stop('final owned cleanup'); } catch (error) { record.cleanupError = error.stack; }
  for (const surface of surfaces) {
    try {
      const port = Number(new URL(surface.baseUrl).port);
      await surface.close();
      record.cleanup.push({ adapterPort: port, released: (await probePortFree(port)).free });
    } catch (error) { record.cleanupError = error.stack; }
  }
  record.sourceAfter = sourceTreeDigest(source);
  record.sourceUnchanged = record.sourceBefore?.digest === record.sourceAfter.digest;
  record.artifacts = [...artifactPins].map(([file, hash]) => ({ path: file, sha256: hash, unchanged: fs.existsSync(file) && sha256(fs.readFileSync(file)) === hash }));
  record.originalUnchanged = sha256(fs.readFileSync(record.input.path)) === record.input.sha256;
  record.ok = !record.blocker && !record.cleanupError && record.cases.length === 6 && record.cases.every((row) => row.pass)
    && record.sourceUnchanged && record.originalUnchanged && record.artifacts.every((row) => row.unchanged)
    && record.cleanup.every((row) => row.adapterPort ? row.released : row.host.ok && row.portReleased.released);
  record.finishedAt = new Date().toISOString();
  save();
  fs.writeFileSync(path.join(q, 'latest-run.json'), JSON.stringify({ work, evidence: path.join(work, 'evidence.json'), ok: record.ok }, null, 2) + '\n');
  console.log(JSON.stringify({ ok: record.ok, cases: record.cases.map(({ id, pass }) => ({ id, pass })), evidence: path.join(work, 'evidence.json') }));
}
process.exitCode = record.ok ? 0 : 1;
