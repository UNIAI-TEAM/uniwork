#!/usr/bin/env node
// DOC-002 (UNI-666) - cross-check the observed-handling narrative in the fixture
// manifest against the probe receipt it cites (BE review finding 1, g119).
//
// The manifest carries, for every expansion/complexity fixture, an
// `expected.handling.observed` block written from a real probe run. This tool
// makes that narrative self-defending: it opens the cited receipt, finds the
// entry for the same fixture bytes and fails when the outcome, error text or
// wall time in the manifest differ from what the receipt recorded.
//
//   node scripts/office-g0/verify-fixture-observations.mjs \
//     --manifest docs/office/g0/fixtures/manifest.json --receipt <probe-receipt.json> \
//     [--root <dir the receipt paths are relative to>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();

export function verifyObservedHandling({ manifest, receipts, root }) {
  const failures = [];
  let checked = 0;
  for (const fixture of manifest.fixtures) {
    const expected = fixture.expected || {};
    const observed = expected.observed || (expected.handling && expected.handling.observed);
    if (!observed) continue;
    checked += 1;
    const receiptPath = typeof observed.receipt === 'string' ? observed.receipt : null;
    if (!receiptPath) { failures.push(fixture.id + ': observed.receipt is required'); continue; }
    const receipt = receipts.get(receiptPath);
    if (!receipt) { failures.push(fixture.id + ': receipt ' + receiptPath + ' was not provided or does not exist'); continue; }
    const entry = (receipt.results || []).find((result) => result.file === path.basename(fixture.path));
    if (!entry) { failures.push(fixture.id + ': receipt ' + receiptPath + ' has no result for ' + path.basename(fixture.path)); continue; }
    if (entry.fileSha256 !== fixture.sha256) {
      failures.push(fixture.id + ': receipt probed bytes ' + entry.fileSha256 + ' but the manifest pins ' + fixture.sha256);
    }
    if (observed.outcome !== entry.outcome) {
      failures.push(fixture.id + ': manifest claims outcome ' + observed.outcome + ' but the receipt recorded ' + entry.outcome);
    }
    if (observed.error !== undefined && observed.error !== (entry.detail && entry.detail.error)) {
      failures.push(fixture.id + ': manifest error text does not match the receipt (' + String(entry.detail && entry.detail.error) + ')');
    }
    if (typeof observed.wallMs === 'number' && observed.wallMs !== entry.wallMs) {
      failures.push(fixture.id + ': manifest wallMs ' + observed.wallMs + ' but the receipt recorded ' + entry.wallMs);
    }
    if (observed.by && typeof receipt.engineBundleSha256 === 'string' && !String(observed.by).includes(receipt.engineBundleSha256.slice(0, 8))) {
      failures.push(fixture.id + ': manifest names engine ' + observed.by + ' but the receipt engine bundle is ' + receipt.engineBundleSha256);
    }
    if (fixture.bytes !== undefined) {
      const onDisk = path.resolve(root, manifest.__fixtureRoot || '', fixture.path);
      if (fs.existsSync(onDisk) && fs.statSync(onDisk).size !== fixture.bytes) {
        failures.push(fixture.id + ': fixture bytes on disk differ from the manifest');
      }
    }
  }
  return { failures, checked };
}

async function main(argv) {
  const value = (name, fallback) => { const i = argv.indexOf('--' + name); return i === -1 ? fallback : argv[i + 1]; };
  const manifestPath = value('manifest', null);
  const receiptPath = value('receipt', null);
  const root = path.resolve(value('root', '.'));
  if (!manifestPath || !receiptPath) {
    process.stdout.write('usage: node verify-fixture-observations.mjs --manifest <manifest.json> --receipt <probe receipt.json> [--root <dir>]\n');
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  const receipts = new Map();
  const resolvedReceipt = path.resolve(root, receiptPath);
  receipts.set(receiptPath, JSON.parse(fs.readFileSync(resolvedReceipt, 'utf8').replace(/^\uFEFF/, '')));
  const { failures, checked } = verifyObservedHandling({ manifest, receipts, root });
  if (!checked) {
    process.stderr.write('verify-fixture-observations: no fixture declares expected.handling.observed\n');
    return 1;
  }
  if (failures.length) {
    for (const failure of failures) process.stderr.write('FAIL ' + failure + '\n');
    process.stderr.write('verify-fixture-observations: ' + failures.length + ' problem(s)\n');
    return 1;
  }
  process.stdout.write('verify-fixture-observations: ' + checked + ' observed-handling narrative(s) match the receipt\n');
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exit(await main(process.argv.slice(2)));
}