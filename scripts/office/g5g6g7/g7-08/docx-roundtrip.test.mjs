/**
 * Unit tests for `scripts/office/g5g6g7/g7-08/docx-roundtrip.mjs` (G7-08 W2).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DOCX_ROUND_TRIP_ROUTES,
  docxRoundTripHook,
  normalizeDocxPackage,
  roundTripDocxSync,
  runDocxRoundTrip,
} from './docx-roundtrip.mjs';
import { zipStore } from '../fixtures-lib/zip.mjs';
import { readZipEntries, sha256Hex } from '../harness/fixture-files.mjs';
import { oracleDocxEdit, parseDocxStructure } from './ooxml.mjs';
import { ROW_EXIT } from './rows.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(HERE, '../../../../docs/office/g5g6g7/fixtures');
const DOCX_BYTES = new Uint8Array(
  fs.readFileSync(path.join(FIXTURES_DIR, 'fx-docx-report-vi.docx')),
);
const ORIGINAL_PARA_2 = parseDocxStructure(DOCX_BYTES).paragraphs[2].text;

function mutateDocxParagraphText(bytes, fromText, toText, extraRunXml = '') {
  const entries = new Map(readZipEntries(bytes).map((e) => [e.name, e.data]));
  const docXml = entries.get('word/document.xml').toString('utf8');
  const updated = docXml.replace(fromText, `${toText}${extraRunXml}`);
  entries.set('word/document.xml', Buffer.from(updated, 'utf8'));
  return new Uint8Array(
    zipStore([...entries.entries()].map(([name, data]) => ({ name, data }))),
  );
}

// The engine helpers live in TypeScript sources (or the built bundle), and the
// repo pins only `22` in `.nvmrc`, so a Node 22 without type stripping cannot
// load them. These tests therefore inject equivalents and never touch the `.ts`
// file: the module under test is the round-trip orchestration, the engine
// helpers are its inputs.
const SCAN_TAG_RE = /<\/?(?:[^<>"']|"[^"]*"|'[^']*')*>/g;

/** Minimal `scanBody` equivalent: top-level `<w:body>` children with their ranges. */
function scanBodyStub(documentXml) {
  const open = /<w:body(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>/.exec(documentXml);
  if (!open) throw new Error('document.xml has no <w:body> element');
  const scanFrom = open.index + open[0].length;
  const elements = [];
  let depth = 0;
  let start = -1;
  let name = '';
  SCAN_TAG_RE.lastIndex = scanFrom;
  let match;
  while ((match = SCAN_TAG_RE.exec(documentXml)) !== null) {
    const tag = match[0];
    if (tag.startsWith('<!--') || tag.startsWith('<![') || tag.startsWith('<?')) continue;
    const closing = tag.startsWith('</');
    const selfClosing = !closing && tag.endsWith('/>');
    const tagName = /^<\/?\s*([A-Za-z_][\w:.-]*)/.exec(tag)?.[1] ?? '';
    if (closing) {
      if (depth === 0) break;
      depth -= 1;
      if (depth === 0) elements.push({ name, start, end: match.index + tag.length });
    } else if (selfClosing) {
      if (depth === 0) elements.push({ name: tagName, start: match.index, end: match.index + tag.length });
    } else {
      if (depth === 0) {
        start = match.index;
        name = tagName;
      }
      depth += 1;
    }
  }
  if (elements.length === 0) return { elements, innerStart: scanFrom, innerEnd: scanFrom };
  return {
    elements,
    innerStart: elements[0].start,
    innerEnd: elements[elements.length - 1].end,
  };
}

const HELPER_OPTS = { scanBodyFn: scanBodyStub, normalizeFn: (xml) => xml, needsNormalizeFn: () => false };

describe('G7-08 W2 docx-roundtrip validator', () => {
  it('passes synchronous docxRoundTripHook and async runDocxRoundTrip on edited fx-docx-report-vi and satisfies oracleDocxEdit', async () => {
    const editedBytes = mutateDocxParagraphText(
      DOCX_BYTES,
      ORIGINAL_PARA_2,
      'Báo cáo quý 1 ghi nhận tổng doanh thu 22.060.000 đồng, dẫn đầu là khu vực Bắc với 9.060.000 đồng.',
    );
    const syncRes = docxRoundTripHook(editedBytes, HELPER_OPTS);
    assert.equal(syncRes.normalizedOk, true);
    assert.equal(syncRes.roundTripOk, true);

    const asyncRes = await runDocxRoundTrip(editedBytes, HELPER_OPTS);
    assert.equal(asyncRes.normalizedOk, true);
    assert.equal(asyncRes.roundTripOk, true);

    const beforeHash = sha256Hex(DOCX_BYTES);
    const verdict = oracleDocxEdit({
      beforeBytes: DOCX_BYTES,
      afterBytes: editedBytes,
      oldVersionSha256: beforeHash,
      roundTripHook: (bytes) => docxRoundTripHook(bytes, HELPER_OPTS),
      targetParagraphIndex: 2,
      requiredTokens: ['22.060.000', 'Bắc', '9.060.000'],
    });
    assert.equal(verdict.status, 'PASS');
    assert.equal(verdict.exitCode, ROW_EXIT.PASS);
  });

  it('G708-R2-10: records which route produced the result, never passing the sync repack off as the engine', async () => {
    const editedBytes = mutateDocxParagraphText(
      DOCX_BYTES,
      ORIGINAL_PARA_2,
      'Báo cáo quý 1 ghi nhận 22.060.000 đồng (cập nhật)',
    );
    // No engine bundle: only the sync scan + repack ran and the artifact says so.
    const syncOnly = await runDocxRoundTrip(editedBytes, { ...HELPER_OPTS, docxEngine: null });
    assert.equal(syncOnly.roundTripOk, true);
    assert.equal(syncOnly.route, 'scan-repack-sync');
    assert.equal(DOCX_ROUND_TRIP_ROUTES.syncRepack, 'scan-repack-sync');
    // An engine without parseDocx/saveDocx is the same sync-only route.
    assert.equal((await runDocxRoundTrip(editedBytes, { ...HELPER_OPTS, docxEngine: {} })).route, 'scan-repack-sync');

    // A working engine: open -> save -> reopen, named as such.
    const blocks = [{ kind: 'paragraph', originalXml: '<w:p/>', docxIndex: 0 }];
    const engineRes = await runDocxRoundTrip(editedBytes, {
      ...HELPER_OPTS,
      docxEngine: { parseDocx: async () => ({ blocks }), saveDocx: async () => editedBytes },
    });
    assert.equal(engineRes.roundTripOk, true);
    assert.equal(engineRes.route, 'docx-engine-parse-save');

    // A failing engine names the engine route too.
    const failing = await runDocxRoundTrip(editedBytes, {
      ...HELPER_OPTS,
      docxEngine: { parseDocx: async () => { throw new Error('boom'); }, saveDocx: async () => editedBytes },
    });
    assert.equal(failing.roundTripOk, false);
    assert.equal(failing.route, 'docx-engine-parse-save');
  });

  it('runs the injected normalizer over every XML and rels entry during step (i)', async () => {
    const marker = '<!--g708-normalize-marker-->';
    const withMarker = mutateDocxParagraphText(DOCX_BYTES, ORIGINAL_PARA_2, `${marker}${ORIGINAL_PARA_2}`);
    const seen = [];
    const stripMarker = (xml) => {
      seen.push(xml);
      return xml.split(marker).join('');
    };

    const norm = normalizeDocxPackage(withMarker, {
      ...HELPER_OPTS,
      normalizeFn: stripMarker,
    });
    assert.equal(norm.ok, true);
    assert.ok(norm.normalizedBytes instanceof Uint8Array);
    assert.ok(seen.length > 1, 'expected the normalizer to run once per XML/rels entry');
    assert.equal(norm.docXml.includes(marker), false);

    const rt = await runDocxRoundTrip(withMarker, { ...HELPER_OPTS, normalizeFn: stripMarker });
    assert.equal(rt.normalizedOk, true);
    assert.equal(rt.roundTripOk, true);
  });

  it('maps step (i) normalization failures to normalizedOk=false and FAIL docx_ooxml_normalize_or_round_trip_failed in oracleDocxEdit', async () => {
    assert.equal(docxRoundTripHook(new Uint8Array(0), HELPER_OPTS).normalizedOk, false);
    assert.equal((await runDocxRoundTrip(new Uint8Array(0), HELPER_OPTS)).normalizedOk, false);

    const emptyNormHook = (bytes) =>
      docxRoundTripHook(bytes, {
        ...HELPER_OPTS,
        normalizeFn: () => '',
      });
    const editedBytes = mutateDocxParagraphText(
      DOCX_BYTES,
      ORIGINAL_PARA_2,
      'Báo cáo quý 1 ghi nhận 22.060.000 đồng (cập nhật)',
    );
    const hookRes = emptyNormHook(editedBytes);
    assert.equal(hookRes.normalizedOk, false);
    assert.equal(hookRes.roundTripOk, false);
    assert.match(hookRes.detail, /normalize_empty_output/);

    const beforeHash = sha256Hex(DOCX_BYTES);
    const verdict = oracleDocxEdit({
      beforeBytes: DOCX_BYTES,
      afterBytes: editedBytes,
      oldVersionSha256: beforeHash,
      roundTripHook: emptyNormHook,
      targetParagraphIndex: 2,
      requiredTokens: ['22.060.000'],
    });
    assert.equal(verdict.status, 'FAIL');
    assert.equal(verdict.exitCode, ROW_EXIT.FAIL);
    assert.equal(verdict.reason, 'docx_ooxml_normalize_or_round_trip_failed');
  });

  it('maps step (ii) round-trip failures to normalizedOk=true, roundTripOk=false and FAIL docx_ooxml_normalize_or_round_trip_failed in oracleDocxEdit', async () => {
    const editedBytes = mutateDocxParagraphText(
      DOCX_BYTES,
      ORIGINAL_PARA_2,
      'Báo cáo quý 1 ghi nhận 22.060.000 đồng (cập nhật)',
    );
    const brokenSyncRt = roundTripDocxSync(
      new Map(),
      '<w:document><w:body></w:body></w:document>',
      HELPER_OPTS,
    );
    assert.equal(brokenSyncRt.ok, false);

    let parseCalls = 0;
    const driftingEngineRes = await runDocxRoundTrip(editedBytes, {
      ...HELPER_OPTS,
      docxEngine: {
        async parseDocx() {
          parseCalls += 1;
          return {
            blocks:
              parseCalls === 1
                ? [{ kind: 'paragraph', originalXml: '<w:p/>', docxIndex: 0 }]
                : [
                    { kind: 'paragraph', originalXml: '<w:p/>', docxIndex: 0 },
                    { kind: 'paragraph', originalXml: '<w:p/>', docxIndex: 1 },
                  ],
          };
        },
        async saveDocx() {
          return editedBytes;
        },
      },
    });
    assert.equal(driftingEngineRes.normalizedOk, true);
    assert.equal(driftingEngineRes.roundTripOk, false);
    assert.match(driftingEngineRes.detail, /docx_engine_block_count_drift/);

    const throwingEngineRes = await runDocxRoundTrip(editedBytes, {
      ...HELPER_OPTS,
      docxEngine: {
        async parseDocx() {
          throw new Error('simulated parseDocx failure');
        },
        async saveDocx() {
          return editedBytes;
        },
      },
    });
    assert.equal(throwingEngineRes.normalizedOk, true);
    assert.equal(throwingEngineRes.roundTripOk, false);
    assert.match(throwingEngineRes.detail, /docx_engine_roundtrip_threw/);

    const beforeHash = sha256Hex(DOCX_BYTES);
    const verdict = oracleDocxEdit({
      beforeBytes: DOCX_BYTES,
      afterBytes: editedBytes,
      oldVersionSha256: beforeHash,
      roundTrip: driftingEngineRes,
      targetParagraphIndex: 2,
      requiredTokens: ['22.060.000'],
    });
    assert.equal(verdict.status, 'FAIL');
    assert.equal(verdict.exitCode, ROW_EXIT.FAIL);
    assert.equal(verdict.reason, 'docx_ooxml_normalize_or_round_trip_failed');
  });

  it('BLOCKs with a named reason when no engine helper can be loaded (never PASS)', async () => {
    const editedBytes = mutateDocxParagraphText(
      DOCX_BYTES,
      ORIGINAL_PARA_2,
      'Báo cáo quý 1 ghi nhận 22.060.000 đồng (cập nhật)',
    );
    const noHelpers = { normalizeFn: null, needsNormalizeFn: null, scanBodyFn: null };

    const noNormalizer = docxRoundTripHook(editedBytes, { ...noHelpers, scanBodyFn: scanBodyStub });
    assert.equal(noNormalizer.status, 'BLOCKED');
    assert.equal(noNormalizer.reason, 'docx_normalizer_unavailable');
    assert.equal(noNormalizer.normalizedOk, false);

    const noScanner = docxRoundTripHook(editedBytes, { ...noHelpers, normalizeFn: (xml) => xml });
    assert.equal(noScanner.status, 'BLOCKED');
    assert.equal(noScanner.reason, 'docx_scan_body_unavailable');

    const asyncBlocked = await runDocxRoundTrip(editedBytes, { ...noHelpers, scanBodyFn: scanBodyStub });
    assert.equal(asyncBlocked.status, 'BLOCKED');
    assert.equal(asyncBlocked.reason, 'docx_normalizer_unavailable');

    const beforeHash = sha256Hex(DOCX_BYTES);
    const verdict = oracleDocxEdit({
      beforeBytes: DOCX_BYTES,
      afterBytes: editedBytes,
      oldVersionSha256: beforeHash,
      roundTripHook: (bytes) => docxRoundTripHook(bytes, noHelpers),
      targetParagraphIndex: 2,
      requiredTokens: ['22.060.000'],
    });
    assert.equal(verdict.status, 'BLOCKED');
    assert.equal(verdict.exitCode, ROW_EXIT.BLOCKED);
    assert.equal(verdict.reason, 'docx_normalizer_unavailable');
  });
});
