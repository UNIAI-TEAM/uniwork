/**
 * Pure unit tests for `web-driver.mjs` and `run-g7-08.mjs` (G7-08 W2).
 * No browser or live server: uses synthetic fixtures, temp dirs, and injected rowRunner.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { REQUIRED_FIELDS } from '../evidence.mjs';
import { buildDocx } from '../fixtures-lib/docx.mjs';
import { buildPdf } from '../fixtures-lib/pdf.mjs';
import { buildPptx } from '../fixtures-lib/pptx.mjs';
import { buildHtml, buildMarkdown } from '../fixtures-lib/text.mjs';
import { buildXlsx } from '../fixtures-lib/xlsx.mjs';
import { sha256Hex } from '../harness/fixture-files.mjs';
import { VERDICT, failVerdict, passVerdict } from './oracles.mjs';
import { MATRIX_ROWS, ROW_EXIT, getRowById } from './rows.mjs';
import {
  DEFAULT_OUTPUT_TOKEN_BUDGET,
  DEFAULT_OUTPUT_TOKEN_GUARD,
  createBudgetTracker,
   parseRunArgs,
  primaryRequirementForRow,
  runG708Matrix,
  verifyRecordedRunResult,
} from './run-g7-08.mjs';
import {
  FORK_SELECTOR_OWNER,
  FRAME_AI_SELECTORS,
  FRAME_SELECTOR_OWNER,
  HARNESS_PRECONDITION_OWNER,
  REAL_AI_BLOCKER,
  buildCapabilityObserved,
  buildDryRunStubModel,
  buildFormatObserved,
  buildVersionAndSaveObserved,
  evaluatePreconditions,
  evaluateRowObserved,
  extractWireToolCalls,
  extractWireUsage,
  missingSelectorVerdict,
  moduleAiSelectors,
  moduleFrameSelectors,
  runWebDocxRow,
  runWebHtmlRow,
  runWebMarkdownRow,
  runWebMatrixRow,
  runWebPdfRow,
  runWebPptxRow,
  runWebXlsxRow,
} from './web-driver.mjs';

const xlsxBytes = buildXlsx().bytes;
const docxBytes = buildDocx().bytes;
const pptxBytes = buildPptx().bytes;
const pdfBytes = buildPdf().bytes;
const mdBytes = buildMarkdown().bytes;
const htmlBytes = buildHtml().bytes;

function makeTempRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'g708-w2-test-'));
}

describe('G7-08 W2 web-driver pure observation builders and preflight guards', () => {
  it('builds wire tool calls, usage, frame selectors, and missing F selector BLOCKED verdicts', () => {
    const v = missingSelectorVerdict(FRAME_AI_SELECTORS.panel, { rowId: 'X-R1' });
    assert.equal(v.status, VERDICT.BLOCKED);
    assert.equal(v.exitCode, ROW_EXIT.BLOCKED);
    assert.equal(v.reason, `missing F selector ${FRAME_AI_SELECTORS.panel}`);
    assert.equal(v.owner, FORK_SELECTOR_OWNER);

    assert.match(moduleFrameSelectors('sheets').ready, /data-office-module="sheets"/);
    assert.match(moduleFrameSelectors('markdown').ready, /data-office-module="markdown"/);
    assert.match(moduleFrameSelectors('html').iframe, /office-docs-frame-iframe/);

    const wire = extractWireToolCalls(
      [
        {
          body: {
            tools: [{ function: { name: 'read_range' } }, { function: { name: 'aggregate_range' } }],
            messages: [{ role: 'assistant', tool_calls: [{ function: { name: 'aggregate_range' } }] }],
          },
        },
      ],
      [{ toolCallNames: ['read_range'] }],
    );
    assert.deepEqual(wire.offeredTools, ['read_range', 'aggregate_range']);
    assert.deepEqual(wire.executedTools, ['aggregate_range', 'read_range']);

    const usage = extractWireUsage([
      { usage: { prompt_tokens: 120, completion_tokens: 30 } },
      { usage: { input_tokens: 80, output_tokens: 20 } },
    ]);
    assert.deepEqual(usage, { modelCalls: 2, inputTokens: 200, outputTokens: 50 });
  });

  it('evaluates read/edit observations and enforces BLOCKED on missing fields or unknown rows', async () => {
    assert.equal(evaluateRowObserved(null, {}).reason, 'unknown_matrix_row');
    assert.equal(evaluateRowObserved(getRowById('X-R1'), null).reason, 'missing_row_observation');
    assert.equal(
      evaluateRowObserved({ id: 'CUSTOM-99', mode: 'automated', operation: 'read' }, {}).reason,
      'unsupported_matrix_row',
    );

    const missingSel = evaluateRowObserved(getRowById('X-R1'), {
      missingSelector: FRAME_AI_SELECTORS.composer,
    });
    assert.equal(missingSel.status, VERDICT.BLOCKED);
    assert.equal(missingSel.exitCode, ROW_EXIT.BLOCKED);
    assert.equal(missingSel.owner, FORK_SELECTOR_OWNER);

    // Hitl row D-W1
    const hitlPending = await runWebDocxRow({ rowId: 'D-W1', host: 'web' }, { observedOverride: {} });
    assert.equal(hitlPending.status, VERDICT.BLOCKED);
    assert.equal(hitlPending.reason, 'hitl_word_open_pending_user');

    const hitlPass = await runWebDocxRow(
      { rowId: 'D-W1', host: 'web' },
      { observedOverride: { openedCleanly: true, note: 'Word opened cleanly' } },
    );
    assert.equal(hitlPass.status, VERDICT.PASS);

    // F-E1 when hostSupportsPdfTextEdit is false -> BLOCKED with named gap
    const fe1Blocked = await runWebPdfRow(
      { rowId: 'F-E1', host: 'web' },
      {
        observedOverride: {
          hostSupportsPdfTextEdit: false,
          offeredTools: ['read_pages', 'get_outline'],
          controls: [],
          executedTools: [],
        },
      },
    );
    assert.equal(fe1Blocked.status, VERDICT.BLOCKED);
    assert.equal(fe1Blocked.exitCode, ROW_EXIT.BLOCKED);
    assert.match(fe1Blocked.reason, /ẩn công cụ sửa text khi pdfium không có/);
  });

  it('builds scripted dry-run replies and tool calls from fixture truth for all row families', async () => {
    for (const [rowId, bytes] of [
      ['X-R1', xlsxBytes],
      ['X-R2', xlsxBytes],
      ['D-R1', docxBytes],
      ['P-R1', pptxBytes],
      ['F-R1', pdfBytes],
      ['M-R1', mdBytes],
      ['H-R1', htmlBytes],
    ]) {
      const row = getRowById(rowId);
      const model = buildDryRunStubModel(row, bytes);
      const step0 = model({ state: { step: 0 } });
      assert.ok(Array.isArray(step0.toolCalls) && step0.toolCalls.length > 0);
      const step1 = model({ state: { step: 1 } });
      assert.ok(typeof step1.content === 'string' && step1.content.length > 0);
    }

    // Verify scripted read replies pass their format oracles via row runners with observedOverride
    const xr1Reply = buildDryRunStubModel(getRowById('X-R1'), xlsxBytes)({ state: { step: 1 } }).content;
    const baseReadMeta = {
      versionsBefore: 1,
      versionsAfterAiTurn: 1,
      revisionBefore: 'r1',
      revisionAfterAiTurn: 'r1',
      saveIntentsDuringAiTurn: 0,
      offeredTools: ['aggregate_range', 'read_range'],
      controls: [],
      executedTools: ['aggregate_range'],
    };
    const xr1Res = await runWebXlsxRow(
      { rowId: 'X-R1', host: 'web' },
      { observedOverride: { ...baseReadMeta, fixtureBytes: xlsxBytes, replyText: xr1Reply } },
    );
    assert.equal(xr1Res.status, VERDICT.PASS);

    const pr1Reply = buildDryRunStubModel(getRowById('P-R1'), pptxBytes)({ state: { step: 1 } }).content;
    const pr1Res = await runWebPptxRow(
      { rowId: 'P-R1', host: 'web' },
      { observedOverride: { ...baseReadMeta, offeredTools: ['read_slide'], fixtureBytes: pptxBytes, replyText: pr1Reply } },
    );
    assert.equal(pr1Res.status, VERDICT.PASS);

    const mr1Reply = buildDryRunStubModel(getRowById('M-R1'), mdBytes)({ state: { step: 1 } }).content;
    const mr1Res = await runWebMarkdownRow(
      { rowId: 'M-R1', host: 'web' },
      { observedOverride: { ...baseReadMeta, offeredTools: ['read_blocks'], fixtureBytes: mdBytes, replyText: mr1Reply } },
    );
    assert.equal(mr1Res.status, VERDICT.PASS);

    const hr1Reply = buildDryRunStubModel(getRowById('H-R1'), htmlBytes)({ state: { step: 1 } }).content;
    const hr1Res = await runWebHtmlRow(
      { rowId: 'H-R1', host: 'web' },
      { observedOverride: { ...baseReadMeta, offeredTools: ['get_outline'], fixtureBytes: htmlBytes, replyText: hr1Reply } },
    );
    assert.equal(hr1Res.status, VERDICT.PASS);

    assert.equal(buildVersionAndSaveObserved(null), null);
    assert.equal(buildCapabilityObserved(null, null), null);
    assert.equal(buildFormatObserved(null, null), null);
    assert.equal(
      buildFormatObserved({ id: 'D-E1', target: { paragraphIndex: 2, requiredTokens: ['22.060.000'] } }, { beforeBytes: docxBytes, afterBytes: docxBytes, oldVersionSha256: sha256Hex(docxBytes) }).targetParagraphIndex,
      2,
    );
  });

  it('enforces desktop W3, real-upstream guard, and harness start/ports.env guards in runWebMatrixRow', async () => {
    const desktopRes = await runWebMatrixRow({ rowId: 'X-R1', host: 'desktop' });
    assert.equal(desktopRes.status, VERDICT.BLOCKED);
    assert.equal(desktopRes.exitCode, ROW_EXIT.BLOCKED);
    assert.equal(desktopRes.reason, 'W3');

    const noUpstreamRes = await runWebMatrixRow(
      { rowId: 'X-R1', host: 'web' },
      { dryRun: false, env: {} },
    );
    assert.equal(noUpstreamRes.status, VERDICT.BLOCKED);
    assert.equal(noUpstreamRes.reason, REAL_AI_BLOCKER);

    const tmp = makeTempRunDir();
    try {
      fs.writeFileSync(path.join(tmp, 'start-status.json'), JSON.stringify({ state: 'up', reason: '' }));
      const noPorts = await runWebMatrixRow({ rowId: 'X-R1', host: 'web' }, { runDir: tmp, dryRun: true });
      assert.equal(noPorts.status, VERDICT.BLOCKED);
      assert.equal(noPorts.reason, 'missing_harness_ports_env');

      fs.writeFileSync(path.join(tmp, 'ports.env'), 'API_ORIGIN=http://127.0.0.1:9999\n');
      const noWebOrigin = await runWebMatrixRow({ rowId: 'X-R1', host: 'web' }, { runDir: tmp, dryRun: true });
      assert.equal(noWebOrigin.status, VERDICT.BLOCKED);
      assert.equal(noWebOrigin.reason, 'missing_api_or_web_origin_in_ports_env');

      const saveFailVerdict = failVerdict('web_save_failed_after_ai_edit', {});
      assert.equal(saveFailVerdict.reason, 'web_save_failed_after_ai_edit');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('G7-08 W2 run-g7-08 CLI argument parsing, budget stop, and evidence writing', () => {
  it('parses CLI arguments and rejects invalid flags, hosts, providers, or rows', () => {
    const parsed = parseRunArgs([
      '--rows', 'X-R1,D-E1',
      '--providers', 'uniwork',
      '--host', 'web',
      '--run-dir', '/tmp/g708-run',
      '--dry-run',
    ]);
    assert.deepEqual(parsed.rows.map((r) => r.id), ['X-R1', 'D-E1']);
    assert.deepEqual(parsed.providers, ['uniwork']);
    assert.equal(parsed.host, 'web');
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.maxOutputTokens, DEFAULT_OUTPUT_TOKEN_BUDGET);
    assert.equal(parsed.guardOutputTokens, DEFAULT_OUTPUT_TOKEN_GUARD);

    const desktopParsed = parseRunArgs(['--host', 'desktop']);
    assert.equal(desktopParsed.host, 'desktop');

    assert.throws(() => parseRunArgs(['--unknown-flag']), /unknown argument/);
    assert.throws(() => parseRunArgs(['--host', 'mobile', '--run-dir', '/tmp/x']), /--host must be one of/);
    assert.throws(() => parseRunArgs(['--host', 'web'], {}), /--run-dir <dir> is required/);
    assert.throws(() => parseRunArgs(['--providers', 'bad', '--run-dir', '/tmp/x']), /--providers must be/);
    assert.throws(() => parseRunArgs(['--rows', 'NO-SUCH-ROW', '--run-dir', '/tmp/x']), /unknown row id/);
  });

  it('exits 77 with reason "W3" when --host desktop is passed', async () => {
    const logs = [];
    const res = await runG708Matrix(
      { host: 'desktop', rows: [], providers: [], runDir: '' },
      { log: (line) => logs.push(line) },
    );
    assert.equal(res.status, VERDICT.BLOCKED);
    assert.equal(res.exitCode, ROW_EXIT.BLOCKED);
    assert.equal(res.reason, 'W3');
    assert.ok(logs.some((l) => l.includes('W3')));
  });

  it('tracks usage per row and stops before 100k output tokens with BLOCKED budget_exhausted_output_tokens', async () => {
    const tracker = createBudgetTracker({ maxOutputTokens: 100_000, guardOutputTokens: 90_000 });
    assert.equal(tracker.canStartNextRun().allowed, true);
    tracker.recordRun('X-R1:uniwork:web', { modelCalls: 2, inputTokens: 1000, outputTokens: 50_000 });
    assert.equal(tracker.canStartNextRun().allowed, true);
    tracker.recordRun('D-E1:uniwork:web', { modelCalls: 2, inputTokens: 1200, outputTokens: 41_000 });
    const stopCheck = tracker.canStartNextRun();
    assert.equal(stopCheck.allowed, false);
    assert.equal(stopCheck.verdict.status, VERDICT.BLOCKED);
    assert.equal(stopCheck.verdict.exitCode, ROW_EXIT.BLOCKED);
    assert.equal(stopCheck.verdict.reason, 'budget_exhausted_output_tokens');

    const tmp = makeTempRunDir();
    try {
      let calls = 0;
      const res = await runG708Matrix(
        {
          rows: [getRowById('X-R1'), getRowById('D-E1'), getRowById('P-R1')],
          providers: ['uniwork'],
          host: 'web',
          runDir: tmp,
          dryRun: true,
          maxOutputTokens: 100_000,
          guardOutputTokens: 90_000,
        },
        {
          evidenceFn: () => null,
          log: () => {},
          rowRunner: async (entry) => {
            calls += 1;
            return {
              ...passVerdict(`${entry.rowId}_ok`),
              usage: { modelCalls: 1, inputTokens: 500, outputTokens: 46_000 },
            };
          },
        },
      );
      // First 2 rows run (total 92,000 >= 90,000 guard); 3rd row is BLOCKED by budget stop without calling rowRunner!
      assert.equal(calls, 2);
      assert.equal(res.runs.length, 3);
      assert.equal(res.runs[0].status, VERDICT.PASS);
      assert.equal(res.runs[1].status, VERDICT.PASS);
      assert.equal(res.runs[2].status, VERDICT.BLOCKED);
      assert.equal(res.runs[2].reason, 'budget_exhausted_output_tokens');
      assert.equal(res.status, VERDICT.BLOCKED);
      assert.equal(res.exitCode, ROW_EXIT.BLOCKED);
      assert.equal(res.usage.outputTokens, 92_000);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('writes one valid 18-field evidence line per (row, provider, host) and maps verifyRecordedRunResult exit codes', async () => {
    for (const row of MATRIX_ROWS) {
      const reqId = primaryRequirementForRow(row);
      assert.match(reqId, /^G6-A0[3456]$/);
    }

    const tmp = makeTempRunDir();
    try {
      const res = await runG708Matrix(
        {
          rows: [getRowById('X-R1'), getRowById('D-E1')],
          providers: ['uniwork'],
          host: 'web',
          runDir: tmp,
          dryRun: true,
          maxOutputTokens: 100_000,
          guardOutputTokens: 90_000,
        },
        {
          log: () => {},
          rowRunner: async (entry) => ({
            ...passVerdict(`${entry.rowId}_ok`),
            usage: { modelCalls: 2, inputTokens: 200, outputTokens: 20 },
          }),
        },
      );
      assert.equal(res.status, VERDICT.PASS);
      assert.equal(res.exitCode, ROW_EXIT.PASS);
      assert.equal(res.evidenceRecords.length, 2);

      const ledgerLines = fs
        .readFileSync(path.join(tmp, 'evidence.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      assert.equal(ledgerLines.length, 2);
      for (const record of ledgerLines) {
        for (const field of REQUIRED_FIELDS) {
          assert.ok(field in record, `missing ${field} in evidence line`);
        }
        assert.equal(record.result, 'PASS');
        assert.equal(record.exitCode, 0);
      }

      // Check throwing rowRunner maps to FAIL row_runner_threw
      const failRes = await runG708Matrix(
        {
          rows: [getRowById('X-R1')],
          providers: ['uniwork'],
          host: 'web',
          runDir: tmp,
          dryRun: true,
          maxOutputTokens: 100_000,
          guardOutputTokens: 90_000,
        },
        {
          evidenceFn: () => null,
          log: () => {},
          rowRunner: async () => {
            throw new Error('simulated crash');
          },
        },
      );
      assert.equal(failRes.status, VERDICT.FAIL);
      assert.equal(failRes.exitCode, ROW_EXIT.FAIL);
      assert.equal(failRes.runs[0].reason, 'row_runner_threw');

      const silent = { write() {} };
      assert.equal(verifyRecordedRunResult(path.join(tmp, 'missing.json'), silent), ROW_EXIT.BLOCKED);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('maps server/host/frame preconditions to D (harness) vs F owner verdicts (W2b contract)', () => {
    assert.equal(moduleAiSelectors('sheets').openPanel, '.copilot:not(.collapsed)');
    assert.match(moduleAiSelectors('sheets').toggle, /\.expand-copilot/);
    assert.equal(moduleAiSelectors('docs').openPanel, '.ai-panel');
    assert.equal(moduleAiSelectors('docs').toggle, '.ai-rail');

    // (a) Server precondition fails -> BLOCKED with owner "D (harness)", never "F"
    const srvFail = evaluatePreconditions({
      server: { met: false, failureReason: 'capability ai_uniwork=false' },
      host: { met: false },
      frame: { met: false },
    });
    assert.equal(srvFail.status, VERDICT.BLOCKED);
    assert.equal(srvFail.exitCode, ROW_EXIT.BLOCKED);
    assert.equal(srvFail.owner, HARNESS_PRECONDITION_OWNER);
    assert.match(srvFail.reason, /^precondition server not met/);

    // (b) Host precondition fails -> BLOCKED with owner "D (harness)", never "F"
    const hostFail = evaluatePreconditions({
      server: { met: true },
      host: { met: false, failureReason: 'init.payload.capabilities.uniworkAi=false' },
      frame: { met: false },
    });
    assert.equal(hostFail.status, VERDICT.BLOCKED);
    assert.equal(hostFail.exitCode, ROW_EXIT.BLOCKED);
    assert.equal(hostFail.owner, HARNESS_PRECONDITION_OWNER);
    assert.match(hostFail.reason, /^precondition host not met/);

    // (c) Only when (a) and (b) hold and frame lacks selector -> BLOCKED "missing F selector <what>" with owner "F"
    const frameFail = evaluatePreconditions({
      server: { met: true },
      host: { met: true, capabilitiesUniworkAi: true },
      frame: { met: false, missingSelector: '.copilot:not(.collapsed)' },
    });
    assert.equal(frameFail.status, VERDICT.BLOCKED);
    assert.equal(frameFail.exitCode, ROW_EXIT.BLOCKED);
    assert.equal(frameFail.owner, FRAME_SELECTOR_OWNER);
    assert.equal(frameFail.reason, 'missing F selector .copilot:not(.collapsed)');

    // All three preconditions met -> PASS
    const allPass = evaluatePreconditions({
      server: { met: true },
      host: { met: true, capabilitiesUniworkAi: true },
      frame: { met: true, panelOpened: true },
    });
    assert.equal(allPass.status, VERDICT.PASS);
    assert.equal(allPass.exitCode, ROW_EXIT.PASS);
    assert.equal(allPass.owner, null);
  });
});

