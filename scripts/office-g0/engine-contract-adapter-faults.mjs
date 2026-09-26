// G0 only: real HTTP engine transport; reference auth/store/commit remain modeled.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { CONTRACT_VERSION, PROTOCOL_VERSION, BoundaryError, createBoundary, validateEnvelope } from './engine-contract.mjs';
import { createAttemptSpies } from './engine-contract-adapter-checksum.mjs';
import { createAdapterClient } from './engine-contract-adapter.mjs';

export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
export function makeEnvelope(bytes, id, deadline = 30000, revision = 7, version = '01J8Z0V0000000000000000A') {
  return {
    request_id: 'REQ-' + id, contract_version: CONTRACT_VERSION, protocol_version: PROTOCOL_VERSION,
    operation: 'serialize', format: 'docx', deadline_ms: deadline, idempotency_key: 'IDEMP-' + id,
    client_engine_version: 'genoffice@09485f88+uniwork-office.0',
    payload: { document_model_ref: 'g48:' + id, input_bytes: bytes.toString('base64'), input_checksum: sha256(bytes),
      input_length: bytes.length, base_revision: revision, base_version_id: version },
  };
}

export function contained(root, target) {
  const base = fs.realpathSync(root);
  const resolved = path.resolve(target);
  if (resolved === base || !resolved.startsWith(base + path.sep)) throw new Error('outside owned root: ' + resolved);
  let cursor = base;
  for (const part of path.relative(base, resolved).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) break;
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('linked writable path: ' + cursor);
  }
  return resolved;
}

export function createRealAdapter({ labDir, originalPath, baseUrl, post, now = Date.now, timers = true }) {
  const root = fs.realpathSync(labDir);
  const original = Buffer.from(fs.readFileSync(contained(root, originalPath)));
  const send = post ?? createAdapterClient({ baseUrl, timeoutMs: 30000 }).post;
  const spies = createAttemptSpies();
  const produced = new Map();
  const entries = new Map();
  const instanceId = crypto.randomBytes(6).toString('hex');
  const boundary = createBoundary({ now, objectStore: spies.store, documents: spies.documents, ledger: spies.ledger,
    engine: { run: ({ jobId }) => produced.get(jobId) } });
  const observations = () => ({ jobs: boundary.jobs.size, puts: spies.store.puts.length,
    commits: spies.documents.commitCalls, ledgerRows: spies.ledger.records.length,
    revision: spies.documents.currentRevision(), version: spies.documents.currentVersionId() });
  const snapshot = (id) => {
    const entry = entries.get(id);
    if (!entry) throw new Error('unknown job');
    const job = entry.job;
    return { job_id: id, view_id: entry.viewId, state: job.state, error: job.error ?? null,
      settled: job.settled, accepted_at: job.accepted_at, deadline_ms: job.deadline_ms,
      editText: entry.editText, input: entry.input, transport: entry.transport,
      output: entry.output, lateDiscarded: entry.lateDiscarded, events: [...entry.events],
      output_checksum: job.output_checksum ?? null, observations: observations() };
  };
  const expire = (id) => {
    const entry = entries.get(id);
    if (!entry || entry.job.settled) return;
    if (now() < entry.job.accepted_at + entry.job.deadline_ms) return;
    boundary.run(entry.job, { grant: entry.grant });
    entry.events.push({ event: 'deadline-settled', at: now(), state: entry.job.state });
  };
  async function execute(entry, fault) {
    const { job, viewId } = entry;
    try {
      entry.transport = await send('/engine/docx-edit', {
        path: entry.input.path, viewId, text: entry.editText, name: 'edited.docx', __g48_fault: fault,
      });
      if (!entry.transport.ok) {
        if (!job.settled) {
          if (entry.transport.reachable !== true) boundary.run(job, { grant: entry.grant, cause: 'crash' });
          else {
            const code = entry.transport.mapped_code ?? 'engine_result_invalid';
            boundary.settle(job, code === 'engine_timeout' ? 'timed_out' : code === 'engine_crashed' ? 'crashed' : 'failed');
            job.error = new BoundaryError(code, { adapter_code: entry.transport.adapter_code }).toJSON();
          }
        }
        entry.events.push({ event: 'transport-refused', at: now() });
        return;
      }
      const result = entry.transport.result;
      const bytesReply = await send('/engine/read-file', { path: result.path });
      if (!bytesReply.ok) throw new Error('real artifact bytes unavailable');
      const bytes = Buffer.from(bytesReply.result.base64, 'base64');
      if (sha256(bytes) !== bytesReply.result.hash || bytes.length !== bytesReply.result.size) throw new Error('read-file integrity mismatch');
      entry.output = { path: result.path, sha256: sha256(bytes), bytes: bytes.length,
        declared_checksum: result.persistedHash, editPersisted: result.editPersisted,
        allOriginalsRetained: result.allOriginalsRetained, editText: result.replacedBlockText,
        readResponse: bytesReply };
      entry.events.push({ event: 'real-output-received', at: now() });
      // Cancellation/deadline wins at this boundary, even when the engine finishes later.
      if (job.settled) { entry.lateDiscarded = true; return; }
      produced.set(job.job_id, { bytes, declared_checksum: result.persistedHash,
        declared_length: result.persistedBytes, warnings: [] });
      boundary.run(job, { grant: entry.grant });
      entry.events.push({ event: 'boundary-settled', at: now(), state: job.state });
    } catch (error) {
      entry.events.push({ event: 'adapter-error', message: error.message, at: now() });
      if (!job.settled) boundary.run(job, { grant: entry.grant, cause: 'crash' });
    } finally {
      clearTimeout(entry.timer);
      produced.delete(job.job_id);
    }
  }
  return {
    submit({ envelope, editText }, { fault = null } = {}) {
      validateEnvelope(envelope);
      if (envelope.operation !== 'serialize' || envelope.format !== 'docx') throw new Error('G48 adapter supports DOCX serialize only');
      if (typeof editText !== 'string' || !editText.trim()) throw new Error('editText required');
      if (![null, 'hold', 'checksum'].includes(fault)) throw new Error('unknown lab fault');
      const accepted = boundary.submit(envelope);
      if (accepted.replay) {
        const entry = entries.get(accepted.job.job_id);
        if (!entry || entry.editText !== editText) throw new Error('replay edit differs from accepted request');
        return { job_id: accepted.job.job_id, view_id: entry.viewId, replay: true };
      }
      const job = accepted.job;
      const viewId = 'g48-' + instanceId + '-' + job.job_id.toLowerCase();
      const inputPath = contained(root, path.join(root, 'requests', viewId + '.docx'));
      const inputBytes = Buffer.from(envelope.payload.input_bytes, 'base64');
      fs.mkdirSync(path.dirname(inputPath), { recursive: true });
      fs.writeFileSync(inputPath, inputBytes, { flag: 'wx' });
      const entry = { job, viewId, editText, input: { path: inputPath, sha256: sha256(inputBytes), bytes: inputBytes.length },
        grant: boundary.grantFor(job), output: null, transport: null, lateDiscarded: false,
        events: [{ event: 'accepted', at: now() }], timer: null, pending: null };
      entries.set(job.job_id, entry);
      job.state = 'running';
      if (timers) entry.timer = setTimeout(() => expire(job.job_id), job.deadline_ms);
      entry.pending = execute(entry, fault);
      return { job_id: job.job_id, view_id: viewId, replay: false };
    },
    cancel(id) {
      const cancelled = boundary.cancel({ request_id: 'CANCEL-' + id, contract_version: CONTRACT_VERSION,
        protocol_version: PROTOCOL_VERSION, operation: 'cancel', format: 'docx', payload: { job_id: id } });
      const entry = entries.get(id);
      if (entry) { clearTimeout(entry.timer); entry.events.push({ event: 'cancel', at: now(), ...cancelled }); }
      return cancelled;
    },
    expire, snapshot, observations,
    async wait(id) { await entries.get(id)?.pending; return snapshot(id); },
    read(route) {
      if (route === '/documents/list') return { documents: boundary.listDocuments() };
      if (route === '/documents/metadata') return { document_id: 'DOC-1', ...observations(), sha256: sha256(original), bytes: original.length };
      if (route === '/documents/original') return { document_id: 'DOC-1', base64: original.toString('base64'), sha256: sha256(original), bytes: original.length };
      throw new Error('unknown document route');
    },
    close() { for (const entry of entries.values()) clearTimeout(entry.timer); },
  };
}

export async function startAdapterSurface(adapter) {
  const server = createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      if (req.method !== 'POST') return reply(405, { ok: false });
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('request too large'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      let result;
      if (req.url === '/lab/submit') result = adapter.submit(body, { fault: body.fault ?? null });
      else if (req.url === '/lab/cancel') result = adapter.cancel(body.job_id);
      else if (req.url === '/lab/status') result = adapter.snapshot(body.job_id);
      else result = adapter.read(req.url);
      reply(200, { ok: true, result });
    } catch (error) { reply(400, { ok: false, error: error.toJSON?.() ?? { message: error.message } }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { baseUrl: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((resolve, reject) => { adapter.close(); server.close((error) => error ? reject(error) : resolve()); }) };
}
