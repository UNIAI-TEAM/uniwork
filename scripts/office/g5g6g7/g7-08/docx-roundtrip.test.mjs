/**
 * Unit tests for `scripts/office/g5g6g7/g7-08/docx-roundtrip.mjs` (G7-08 W2).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
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

describe('G7-08 W2 docx-roundtrip validator', () => {
  it('passes synchronous docxRoundTripHook and async runDocxRoundTrip on edited fx-docx-report-vi and satisfies oracleDocxEdit', async () => {
    const editedBytes = mutateDocxParagraphText(
      DOCX_BYTES,
      ORIGINAL_PARA_2,
      'Báo cáo quý 1 ghi nhận tổng doanh thu 22.060.000 đồng, dẫn đầu là khu vực Bắc với 9.060.000 đồng.',
    );
    const syncRes = docxRoundTripHook(editedBytes);
    assert.equal(syncRes.normalizedOk, true);
    assert.equal(syncRes.roundTripOk, true);

    const asyncRes = await runDocxRoundTrip(editedBytes);
    assert.equal(asyncRes.normalizedOk, true);
    assert.equal(asyncRes.roundTripOk, true);

    const beforeHash = sha256Hex(DOCX_BYTES);
    const verdict = oracleDocxEdit({
      beforeBytes: DOCX_BYTES,
      afterBytes: editedBytes,
      oldVersionSha256: beforeHash,
      roundTripHook: docxRoundTripHook,
      targetParagraphIndex: 2,
      requiredTokens: ['22.060.000', 'Bắc', '9.060.000'],
    });
    assert.equal(verdict.status, 'PASS');
    assert.equal(verdict.exitCode, ROW_EXIT.PASS);
  });

  it('normalizes out-of-order w:rPr inside w:r during step (i) and round-trips cleanly', async () => {
    // Inject an out-of-order `<w:r><w:t>Test</w:t><w:rPr><w:b/></w:rPr></w:r>` run
    // that triggers `needsOoxmlNormalization` -> `normalizeOoxmlXml`.
    const unnormalizedBytes = mutateDocxParagraphText(
      DOCX_BYTES,
      ORIGINAL_PARA_2,
      'Báo cáo quý 1 ghi nhận 22.060.000 đồng</w:t><w:rPr><w:b/></w:rPr></w:r><w:r><w:t> (Bắc 9.060.000)',
    );
    const norm = normalizeDocxPackage(unnormalizedBytes);
    assert.equal(norm.ok, true);
    assert.ok(norm.normalizedBytes instanceof Uint8Array);

    const rt = await runDocxRoundTrip(unnormalizedBytes);
    assert.equal(rt.normalizedOk, true);
    assert.equal(rt.roundTripOk, true);
  });

  it('maps step (i) normalization failures to normalizedOk=false and FAIL docx_ooxml_normalize_or_round_trip_failed in oracleDocxEdit', async () => {
    assert.equal(docxRoundTripHook(new Uint8Array(0)).normalizedOk, false);
    assert.equal((await runDocxRoundTrip(new Uint8Array(0))).normalizedOk, false);

    const emptyNormHook = (bytes) =>
      docxRoundTripHook(bytes, {
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
    );
    assert.equal(brokenSyncRt.ok, false);

    let parseCalls = 0;
    const driftingEngineRes = await runDocxRoundTrip(editedBytes, {
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
});
