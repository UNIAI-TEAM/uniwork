#!/usr/bin/env node
// DOC-002 (UNI-666) - observable handling of a fixture by the pinned docx engine.
//
// Fixture-level probe, not an editor run: it answers "what does the pinned
// parser do with these bytes, within a bounded heap and wall clock" so the
// fixture manifest can state an expectation that was actually observed. The
// editor/worker path stays DOC-003.
//
//   node scripts/office-g0/probe-fixture-handling.mjs \
//     --engine <bundle.cjs> --record <build.json> --file <fixture> \
//     [--timeout-ms 20000] [--max-old-space-mb 768] --out <receipt.json>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();

/** Runs in the child: load the bundle, parse the file, report a bounded result. */
function childMain(engineFile, file) {
  const requireFromHere = createRequire(pathToFileURL(path.resolve(import.meta.url)));
  const engine = requireFromHere(path.resolve(engineFile));
  const started = Date.now();
  const bytes = fs.readFileSync(file);
  let outcome = { ok: false };
  engine.parseDocx(bytes).then((parsed) => {
    outcome = { ok: true, blocks: (parsed.blocks || []).length, ms: Date.now() - started };
    process.stdout.write('PROBE_RESULT ' + JSON.stringify(outcome) + '\n');
  }).catch((error) => {
    outcome = { ok: false, error: String(error && error.message ? error.message : error), ms: Date.now() - started };
    process.stdout.write('PROBE_RESULT ' + JSON.stringify(outcome) + '\n');
  });
}

export function probe({ engineFile, file, timeoutMs = 20000, maxOldSpaceMb = 768, selfPath }) {
  const started = Date.now();
  const result = spawnSync(process.execPath, ['--max-old-space-size=' + maxOldSpaceMb, selfPath, '--child', '--engine', engineFile, '--file', file], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const wallMs = Date.now() - started;
  const output = (result.stdout || '') + (result.stderr || '');
  const match = /PROBE_RESULT (\{.*\})/.exec(output);
  const parsed = match ? JSON.parse(match[1]) : null;
  const timedOut = result.error && result.error.code === 'ETIMEDOUT';
  const killed = result.signal !== null || (result.status === null && !match);
  return {
    file: path.basename(file),
    fileSha256: sha256(fs.readFileSync(file)),
    fileBytes: fs.statSync(file).size,
    limits: { timeoutMs, maxOldSpaceMb },
    outcome: parsed ? (parsed.ok ? 'parsed' : 'refused') : (timedOut ? 'timeout' : killed ? 'killed' : 'unknown'),
    detail: parsed || null,
    exitCode: result.status,
    signal: result.signal,
    wallMs,
    stdoutTail: (result.stdout || '').slice(-2000),
    stderrTail: (result.stderr || '').slice(-2000),
  };
}

async function main(argv) {
  if (argv[0] === '--child') {
    childMain(argv[argv.indexOf('--engine') + 1], argv[argv.indexOf('--file') + 1]);
    return;
  }
  const value = (name, fallback) => { const i = argv.indexOf('--' + name); return i === -1 ? fallback : argv[i + 1]; };
  const engine = value('engine', null);
  const record = value('record', null);
  const files = [];
  for (let i = 0; i < argv.length; i += 1) if (argv[i] === '--file') files.push(path.resolve(argv[i + 1]));
  const out = value('out', null);
  if (!engine || !record || !files.length || !out) {
    process.stdout.write('usage: node probe-fixture-handling.mjs --engine <bundle> --record <build.json> --file <fixture> [--file ...] --out <receipt.json>\n');
    process.exit(2);
  }
  const build = JSON.parse(fs.readFileSync(record, 'utf8'));
  if (build.bundleSha256 !== sha256(fs.readFileSync(engine))) throw new Error('engine bundle does not match the build record');
  const receipt = [];
  for (const file of files) receipt.push(probe({ engineFile: path.resolve(engine), file, selfPath: path.resolve(process.argv[1]), timeoutMs: Number(value('timeout-ms', 20000)), maxOldSpaceMb: Number(value('max-old-space-mb', 768)) }));
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(path.resolve(out), JSON.stringify({ schemaVersion: 1, kind: 'uniwork-office-fixture-handling-probe', engineBundleSha256: build.bundleSha256, pin: build.pin, measuredUtc: new Date().toISOString(), results: receipt }, null, 2) + '\n');
  process.stdout.write(JSON.stringify(receipt.map((r) => ({ file: r.file, outcome: r.outcome, detail: r.detail, wallMs: r.wallMs })), null, 2) + '\n');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));