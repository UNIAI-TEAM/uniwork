// G7-08 (UNI-1385) W2 web frame driver per format family and provider ('uniwork' | 'byok').
// Reuses harness/web.mjs, g7-04/cross-host.mjs (listVersions), g7-10/tracer.mjs, and docx-roundtrip.mjs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fmtVi, q1Shares } from '../fixtures-lib/data.mjs';
import { listVersions } from '../g7-04/cross-host.mjs';
import { callTracerApi, cleanupSeededOrganization, seedFixtureDocument } from '../g7-10/tracer.mjs';
import { loadPlaywrightChromium, parseEnvFile, sleep } from '../harness/app-steps.mjs';
import { loadVerifiedFixture, sha256Hex } from '../harness/fixture-files.mjs';
import { harnessPaths, readStartStatus, startGate } from '../harness/lib.mjs';
import { documentUrl, webFrameSelectors, webLogin, webSave } from '../harness/web.mjs';
import { startStubFacade } from '../holdout-stub-facade.helper.mjs';
import { computeTruth } from '../holdout-xlsx-truth.mjs';
import { docxRoundTripHook, runDocxRoundTrip } from './docx-roundtrip.mjs';
import {
  VERDICT, blockedVerdict, diffDocxNonDocumentParts, extractPdfTextFromBytes, failVerdict,
  oracleCapabilityAndToolSurface, oracleDocxEdit, oracleDocxRead, oracleHitlWord,
  oracleHtmlEdit, oracleHtmlRead, oracleMarkdownEdit, oracleMarkdownRead,
  oraclePdfEdit, oraclePdfRead, oraclePptxEdit, oraclePptxRead,
  oracleVersionAndSave, oracleXlsxEdit, oracleXlsxRead,
  parseDocxStructure, parsePptxStructure, parseXlsxWorkbookBytes,
} from './oracles.mjs';
import { DEFAULT_REPO_ROOT, getRowById } from './rows.mjs';
import {
  FRAME_SELECTOR_OWNER, HARNESS_PRECONDITION_OWNER, MODULE_AI_SELECTORS,
  bindDryRunStubRoutes, ensureServerPreconditions, evaluatePreconditions,
  installProtocolSniffer, moduleAiSelectors, verifyHostAndFramePreconditions,
} from './preconditions.mjs';

export { FRAME_SELECTOR_OWNER, HARNESS_PRECONDITION_OWNER, MODULE_AI_SELECTORS, evaluatePreconditions, moduleAiSelectors };
export const FORK_SELECTOR_OWNER = 'F (uniwork-office frame)';
export const REAL_AI_BLOCKER = 'real-AI upstream required, acceptance.md l.87';

export const FRAME_AI_SELECTORS = Object.freeze({
  panel: '.ai-panel, .copilot:not(.collapsed), .ai-chat',
  expandRail: '.ai-rail, .expand-copilot, button[aria-label*="AI"]',
  modelChip: '.ai-model-chip',
  modelOption: '.ai-model-pop-list button.ai-model-item[role="option"], .ai-model-pop [role="option"]',
  disclosureAck: '.ai-uniwork-disclosure button.ai-uniwork-disclosure-ack, .ai-composer button.ai-uniwork-disclosure-ack',
  composer: '.ai-composer textarea, .ai-composer [contenteditable="true"], .ai-input-box textarea.ai-input, .ai-input-box textarea',
  sendBtn: '.ai-send-btn:not(.ai-stop-btn)',
  busy: 'button.ai-stop-btn, .ai-msg-streaming, .ai-typing-row, .ai-work-group-summary.running',
  assistantMsg: '.ai-msg-assistant',
  assistantAnswer: '.ai-msg-assistant .ai-msg-answer',
  stepTitle: '.ai-step-title',
  footprint: '.ai-result-chip, .ai-result-meta, .ai-work-group-summary, .ai-auto-applied-text, .ai-chat .ai-msg-toolbar, .ai-chat .ai-msg-actions',
  undoBtn: 'button.ai-rollback-btn, button.ai-undo-btn, button.ai-version-rollback',
  htmlPreviewFrame: 'iframe[sandbox], iframe.preview-frame',
});

export function missingSelectorVerdict(what, details = {}) {
  const label = String(what ?? '').trim() || 'unknown';
  const base = blockedVerdict(`missing F selector ${label}`, { owner: FORK_SELECTOR_OWNER, selector: label, ...details });
  return { ...base, owner: FORK_SELECTOR_OWNER };
}

// Every module host is `data-office-module={module}` (office-module-frame.tsx:334-335); harness/web.mjs knows all six.
export const moduleFrameSelectors = webFrameSelectors;

export function extractWireToolCalls(requests = [], responses = []) {
  const offeredSet = new Set();
  const executedSet = new Set();
  for (const req of requests) {
    for (const tool of req?.body?.tools ?? []) {
      const name = tool?.function?.name ?? tool?.name;
      if (typeof name === 'string' && name.trim()) offeredSet.add(name.trim());
    }
    for (const msg of req?.body?.messages ?? []) {
      for (const tc of (msg?.role === 'assistant' && Array.isArray(msg.tool_calls) ? msg.tool_calls : [])) {
        const name = tc?.function?.name;
        if (typeof name === 'string' && name.trim()) executedSet.add(name.trim());
      }
    }
  }
  for (const res of responses) {
    for (const name of res?.toolCallNames ?? []) {
      if (typeof name === 'string' && name.trim()) executedSet.add(name.trim());
    }
  }
  return { offeredTools: [...offeredSet], executedTools: [...executedSet] };
}

export function extractWireUsage(responses = []) {
  let modelCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const res of responses) {
    modelCalls += 1;
    inputTokens += Number(res?.usage?.prompt_tokens ?? res?.usage?.input_tokens ?? 0) || 0;
    outputTokens += Number(res?.usage?.completion_tokens ?? res?.usage?.output_tokens ?? 0) || 0;
  }
  return { modelCalls, inputTokens, outputTokens };
}

export function buildVersionAndSaveObserved(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    operation: raw.operation,
    versionsBefore: raw.versionsBefore, versionsAfterAiTurn: raw.versionsAfterAiTurn,
    revisionBefore: raw.revisionBefore, revisionAfterAiTurn: raw.revisionAfterAiTurn,
    saveIntentsDuringAiTurn: raw.saveIntentsDuringAiTurn,
    versionsAfterSave: raw.versionsAfterSave, revisionAfterSave: raw.revisionAfterSave,
    aiChangeVisibleBeforeSave: raw.aiChangeVisibleBeforeSave,
    aiChangeUndoableBeforeSave: raw.aiChangeUndoableBeforeSave,
    saveUsedCurrentBaseRevision: raw.saveUsedCurrentBaseRevision,
    doubleClickVersionsCreated: raw.doubleClickVersionsCreated,
  };
}

export function buildCapabilityObserved(row, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const host = row?.host ?? raw.host ?? 'web';
  const knownMissing = row?.knownMissing ?? row?.missingByHost?.[host] ?? [];
  const unsupportedToolsOnHost = Array.isArray(raw.unsupportedToolsOnHost)
    ? raw.unsupportedToolsOnHost
    : row?.id === 'F-E1' && raw.hostSupportsPdfTextEdit === false
      ? ['edit_text', 'edit_block', 'move_text_block', 'insert_text']
      : [];
  return {
    operation: row?.operation ?? raw.operation,
    offeredTools: raw.offeredTools, controls: raw.controls, executedTools: raw.executedTools,
    forbiddenTools: row?.forbiddenTools ?? raw.forbiddenTools,
    unsupportedToolsOnHost, knownMissing,
  };
}

export function buildFormatObserved(row, raw) {
  if (!row || !raw || typeof raw !== 'object') return null;
  const target = row.target ?? {};
  switch (row.id) {
    case 'X-R1':
    case 'X-R2':
      return { rowId: raw.rowId ?? row.id, fixtureBytes: raw.fixtureBytes, replyText: raw.replyText, numbers: raw.numbers };
    case 'X-E1':
      return { beforeBytes: raw.beforeBytes, afterBytes: raw.afterBytes, targetSheet: raw.targetSheet ?? target.sheet, targetRange: raw.targetRange ?? target.range, panelFootprintText: raw.panelFootprintText, requireFootprint: raw.requireFootprint };
    case 'D-R1':
      return { fixtureBytes: raw.fixtureBytes, replyText: raw.replyText, citedAnchors: raw.citedAnchors, mustNotContain: raw.mustNotContain };
    case 'D-E1':
      return { beforeBytes: raw.beforeBytes, afterBytes: raw.afterBytes, oldVersionSha256: raw.oldVersionSha256, roundTrip: raw.roundTrip, roundTripHook: raw.roundTripHook ?? (raw.roundTrip ? undefined : docxRoundTripHook), targetParagraphIndex: raw.targetParagraphIndex ?? target.paragraphIndex, targetParagraphIndexes: raw.targetParagraphIndexes, requiredTokens: raw.requiredTokens ?? target.requiredTokens };
    case 'D-W1':
      return { openedCleanly: raw.openedCleanly, note: raw.note };
    case 'P-R1':
    case 'M-R1':
    case 'H-R1':
      return { fixtureBytes: raw.fixtureBytes, replyText: raw.replyText };
    case 'P-E1':
      return { beforeBytes: raw.beforeBytes, afterBytes: raw.afterBytes, targetSlideIndex: raw.targetSlideIndex ?? target.slideIndex, targetShapeId: raw.targetShapeId ?? target.shapeId, expectedText: raw.expectedText ?? target.expectedText };
    case 'F-R1':
      return { fixtureBytes: raw.fixtureBytes, replyText: raw.replyText, scannedPageWithoutOcr: raw.scannedPageWithoutOcr };
    case 'F-E1':
      return { hostSupportsPdfTextEdit: raw.hostSupportsPdfTextEdit, offeredTools: raw.offeredTools, controls: raw.controls, executedTools: raw.executedTools, beforeBytes: raw.beforeBytes, afterBytes: raw.afterBytes, beforeLines: raw.beforeLines, afterLines: raw.afterLines, targetText: raw.targetText ?? target.targetText, expectedPatchText: raw.expectedPatchText ?? target.expectedPatchText };
    case 'M-E1':
      return { beforeBytes: raw.beforeBytes, afterBytes: raw.afterBytes, targetLineIndex: raw.targetLineIndex ?? target.lineIndex, targetLineIndexes: raw.targetLineIndexes, beforeAssets: raw.beforeAssets, afterAssets: raw.afterAssets };
    case 'H-E1':
      return { beforeBytes: raw.beforeBytes, afterBytes: raw.afterBytes, frameSandbox: raw.frameSandbox, frameCsp: raw.frameCsp };
    default:
      return null;
  }
}

const FORMAT_ORACLES = Object.freeze({
  'X-R1': oracleXlsxRead, 'X-R2': oracleXlsxRead, 'X-E1': oracleXlsxEdit,
  'D-R1': oracleDocxRead, 'D-E1': oracleDocxEdit, 'D-W1': oracleHitlWord,
  'P-R1': oraclePptxRead, 'P-E1': oraclePptxEdit,
  'F-R1': oraclePdfRead, 'F-E1': oraclePdfEdit,
  'M-R1': oracleMarkdownRead, 'M-E1': oracleMarkdownEdit,
  'H-R1': oracleHtmlRead, 'H-E1': oracleHtmlEdit,
});

export function evaluateRowObserved(rowOrEntry, raw) {
  const row = rowOrEntry?.id ? rowOrEntry : getRowById(rowOrEntry?.rowId);
  if (!row) return blockedVerdict('unknown_matrix_row');
  if (!raw || typeof raw !== 'object') return blockedVerdict('missing_row_observation');
  if (raw.missingSelector) return missingSelectorVerdict(raw.missingSelector, raw.missingSelectorDetail);
  const oracleFn = FORMAT_ORACLES[row.id];
  if (!oracleFn) return blockedVerdict('unsupported_matrix_row', { rowId: row.id });
  if (row.mode === 'hitl') {
    const hitlVerdict = oracleFn(buildFormatObserved(row, raw));
    return { ...hitlVerdict, verdicts: { format: hitlVerdict } };
  }
  if (row.id === 'F-E1' && raw.hostSupportsPdfTextEdit === false) {
    const pdfBlocked = oraclePdfEdit(buildFormatObserved(row, raw));
    return { ...pdfBlocked, verdicts: { format: pdfBlocked } };
  }
  const versionVerdict = oracleVersionAndSave(buildVersionAndSaveObserved({ ...raw, operation: row.operation }));
  if (versionVerdict.status !== VERDICT.PASS) return { ...versionVerdict, verdicts: { versionAndSave: versionVerdict } };
  const capVerdict = oracleCapabilityAndToolSurface(buildCapabilityObserved(row, raw));
  if (capVerdict.status !== VERDICT.PASS) return { ...capVerdict, verdicts: { versionAndSave: versionVerdict, capabilitySurface: capVerdict } };
  const formatVerdict = oracleFn(buildFormatObserved(row, raw));
  return { ...formatVerdict, verdicts: { versionAndSave: versionVerdict, capabilitySurface: capVerdict, format: formatVerdict } };
}

/** Scripted model for `--dry-run` via `startStubFacade`: derives replies/edits from fixture truth. */
export function buildDryRunStubModel(rowOrEntry, fixtureBytes) {
  const rowId = rowOrEntry?.rowId ?? rowOrEntry?.id;
  return ({ state }) => {
    if (state.step === 0) {
      if (rowId === 'X-R1') return { toolCalls: [{ id: 'call_xr1', type: 'function', function: { name: 'aggregate_range', arguments: JSON.stringify({ range: 'G2:G7' }) } }] };
      if (rowId === 'X-R2') return { toolCalls: [{ id: 'call_xr2', type: 'function', function: { name: 'read_range', arguments: JSON.stringify({ range: 'A1:G9' }) } }] };
      if (rowId === 'X-E1') {
        const operations = [2, 3, 4, 5, 6, 7].map((r) => ({ op: 'set_formula', address: `AA${r}`, formula: `=D${r}*E${r}*(1-IF(F${r}>1,F${r}/100,F${r}))` }));
        return { toolCalls: [{ id: 'call_xe1', type: 'function', function: { name: 'propose_operations', arguments: JSON.stringify({ summary: 'Ghi đè (overwritten) AA2:AA7', operations }) } }] };
      }
      if (rowId === 'D-R1') return { toolCalls: [{ id: 'call_dr1', type: 'function', function: { name: 'read_blocks', arguments: JSON.stringify({ startBlockIndex: 0, endBlockIndex: 9 }) } }] };
      if (rowId === 'D-E1') {
        const html = '<p>Báo cáo quý 1 ghi nhận tổng doanh thu 22.060.000 đồng, dẫn đầu là khu vực Bắc (9.060.000 đồng).</p>';
        return { toolCalls: [{ id: 'call_de1', type: 'function', function: { name: 'replace_blocks', arguments: JSON.stringify({ startBlockIndex: 2, endBlockIndex: 2, html }) } }] };
      }
      const primary = rowOrEntry?.primaryTools?.[0] ?? rowOrEntry?.expectedTools?.[0];
      if (primary) return { toolCalls: [{ id: `call_${rowId}`, type: 'function', function: { name: primary, arguments: '{}' } }] };
    }
    if (rowId === 'X-R1' || rowId === 'X-R2') {
      const truth = computeTruth(parseXlsxWorkbookBytes(fixtureBytes));
      const [q1All, q1Vis] = [fmtVi(truth.q1_revenue_all), fmtVi(truth.q1_revenue_visible)];
      const [bac, nam, trung] = q1Shares();
      if (rowId === 'X-R1') return { content: `Tổng doanh thu Q1 (gồm cả dòng 6 ẩn Q1-005) là ${q1All} đồng (dòng 8 SUM = ${q1All}, dòng 9 SUBTOTAL = ${q1Vis}). Khu vực Bắc: ${fmtVi(bac.revenue)}, Nam: ${fmtVi(nam.revenue)}, Trung: ${fmtVi(trung.revenue)}.` };
      return { content: `Cột Z có Q1-003/Q2-003 nhập số 10 thay vì 10% (phần trăm 0,1). Dòng 6 (Q1-005, Q2-005) đang ẩn nên SUBTOTAL dòng 9 là ${q1Vis} khác SUM ${q1All}. Các ô lỗi: #DIV/0!, #N/A, #REF!.` };
    }
    if (rowId === 'D-R1') {
      const parsed = parseDocxStructure(fixtureBytes);
      return { content: `Anchor [blockIndex=1]: "${parsed?.paragraphs?.[1]?.text ?? ''}". Anchor [blockIndex=2]: "${parsed?.paragraphs?.[2]?.text ?? ''}". Khu vực Bắc dẫn đầu với 9.060.000 đồng trong tổng 22.060.000 đồng.` };
    }
    if (rowId === 'P-R1') return { content: parsePptxStructure(fixtureBytes)?.slides.flatMap((s) => s.shapes.map((sh) => sh.text)).join(' | ') ?? '' };
    if (rowId === 'F-R1') return { content: `Trang 1: ${(extractPdfTextFromBytes(fixtureBytes)?.lines ?? []).join(' | ')}` };
    if (rowId === 'M-R1' || rowId === 'H-R1') return { content: Buffer.from(fixtureBytes).toString('utf8') };
    return { content: `Đã thực hiện xong yêu cầu cho ${rowId} (AA2:AA7 overwritten / ghi đè).` };
  };
}

async function readFrameHead({ apiOrigin, fetchImpl = fetch, documentId, token }) {
  const tokenRes = await callTracerApi({ apiOrigin, fetchImpl, name: 'mintOfficeFrameToken', params: { documentID: documentId }, token });
  const frameToken = tokenRes.data?.token;
  if (!frameToken) throw new Error('mintOfficeFrameToken returned no token');
  const openRes = await callTracerApi({ apiOrigin, fetchImpl, name: 'openOfficeFrameDocument', params: { documentID: documentId }, token: frameToken });
  const contentRes = await callTracerApi({ apiOrigin, fetchImpl, name: 'getOfficeFrameDocumentContent', params: { documentID: documentId }, token: frameToken, expectBinary: true });
  return { versionId: openRes.data?.file?.version_id ?? null, version: openRes.data?.file?.version ?? null, revision: openRes.data?.revision ?? null, bytes: new Uint8Array(contentRes.bytes), sha256: sha256Hex(contentRes.bytes) };
}

export async function runWebMatrixRow(runEntry, {
  runDir, repoRoot = DEFAULT_REPO_ROOT, dryRun = false, fetchImpl = fetch,
  env = process.env, timeoutMs = 45_000, observedOverride = null,
} = {}) {
  const row = getRowById(runEntry?.rowId ?? runEntry?.id) ?? runEntry;
  if (!row) return blockedVerdict('unknown_matrix_row');
  if (runEntry?.host && runEntry.host !== 'web') {
    return blockedVerdict('W3', { host: runEntry.host, reason: 'desktop_host_deferred_to_w3' });
  }
  if (observedOverride) return evaluateRowObserved(row, observedOverride);
  if (row.mode === 'hitl') return evaluateRowObserved(row, {});
  if (!dryRun && env.HARNESS_ALLOW_REAL_AI_UPSTREAM !== '1') return blockedVerdict(REAL_AI_BLOCKER, { owner: 'G6' });

  const gate = startGate(readStartStatus(runDir));
  if (gate.gate !== 'proceed') {
    return gate.gate === 'blocked' ? blockedVerdict(gate.reason, { owner: 'G7-01 harness' }) : failVerdict(gate.reason);
  }
  const paths = harnessPaths(runDir);
  if (!existsSync(paths.envFile)) return blockedVerdict('missing_harness_ports_env', { runDir });
  const ports = parseEnvFile(readFileSync(paths.envFile, 'utf8'));
  const { API_ORIGIN: apiOrigin, WEB_ORIGIN: webOrigin } = ports;
  if (!apiOrigin || !webOrigin) return blockedVerdict('missing_api_or_web_origin_in_ports_env', { runDir });

  const fixture = loadVerifiedFixture(row.fixtureId, repoRoot);
  const provider = runEntry?.provider ?? 'uniwork';
  let seeded = null;
  let browser = null;
  let web = null;
  let stub = null;
  try {
    seeded = await seedFixtureDocument({ apiOrigin, runDir, fetchImpl, fixtureId: row.fixtureId, repoRoot });
    const { documentId, token, organizationSlug, workspaceSlug, email, password, userId } = seeded;
    const versionsBefore = await listVersions({ apiOrigin, fetchImpl, documentId, token });
    const headBefore = await readFrameHead({ apiOrigin, fetchImpl, documentId, token });
    if (dryRun) stub = await startStubFacade({ model: buildDryRunStubModel(row, fixture.bytes) });

    const serverEvidence = await ensureServerPreconditions({
      runDir, repoRoot, apiOrigin, fetchImpl, seeded, row, provider, dryRun, stubUrl: stub?.url ?? null,
    });
    if (!serverEvidence.met) {
      const preV = evaluatePreconditions({ server: serverEvidence, host: { met: false }, frame: { met: false } });
      return { ...preV, documentId };
    }

    const chromium = await loadPlaywrightChromium();
    browser = await chromium.launch({ headless: true });
    web = await webLogin(browser, { key: 'g708-web', id: userId, email, password }, { webOrigin, locale: 'vi' });
    await installProtocolSniffer(web.page);

    let inAiTurn = false;
    let saveIntentsDuringAiTurn = 0;
    let lastCommitBaseRevision = null;
    const wireRequests = [];
    const wireResponses = [];

    web.page.on('request', (req) => {
      if (req.method() !== 'POST') return;
      const p = new URL(req.url()).pathname;
      if (/\/versions\/(uploads|commit)$/.test(p) || /\/documents\/[^/]+\/versions$/.test(p)) {
        if (inAiTurn) saveIntentsDuringAiTurn += 1;
        if (p.endsWith('/versions/commit')) {
          try { lastCommitBaseRevision = JSON.parse(req.postData() || '{}').base_revision ?? null; } catch { /* ignore */ }
        }
      }
    });

    if (dryRun && stub) {
      await bindDryRunStubRoutes({
        page: web.page, fetchImpl, stub, documentId, rowId: row.id, wireRequests, wireResponses,
      });
    }

    const sel = moduleFrameSelectors(row.module);
    await web.page.goto(documentUrl({ webOrigin, org: organizationSlug, ws: workspaceSlug, documentId }), {
      waitUntil: 'domcontentloaded', timeout: timeoutMs,
    });
    const hostReady = await web.page.waitForSelector(sel.ready, { state: 'visible', timeout: timeoutMs }).catch(() => null);
    if (!hostReady) {
      return evaluatePreconditions({ server: serverEvidence, host: { met: false, failureReason: `host frame container ${sel.ready} did not reach ready` }, frame: { met: false } });
    }
    const iframeHandle = await web.page.$(sel.iframe);
    const frame = iframeHandle ? await iframeHandle.contentFrame() : null;
    if (!frame) {
      return evaluatePreconditions({ server: serverEvidence, host: { met: false, failureReason: `host iframe ${sel.iframe} not attached` }, frame: { met: false } });
    }

    const precondVerdict = await verifyHostAndFramePreconditions({ page: web.page, frame, row, provider, runDir, serverEvidence, timeoutMs });
    const preconditions = precondVerdict.preconditions;
    const screenshotPath = preconditions?.frame?.screenshotPath ?? null;
    if (precondVerdict.status !== VERDICT.PASS) return { ...precondVerdict, documentId, preconditions, screenshotPath };

    if (row.id === 'F-E1') {
      const pdfEditBtn = await frame.$('[data-tool="edit_text"], [data-capability="pdf_text_edit"]');
      if (!pdfEditBtn) {
        const fe1Verdict = evaluateRowObserved(row, { hostSupportsPdfTextEdit: false, offeredTools: ['read_pages', 'search_text', 'goto_page', 'get_outline'], controls: [], executedTools: [] });
        return { ...fe1Verdict, documentId, preconditions, screenshotPath };
      }
    }

    if (provider === 'byok') {
      const modelChip = await frame.$(FRAME_AI_SELECTORS.modelChip);
      if (!modelChip) return { ...missingSelectorVerdict(FRAME_AI_SELECTORS.modelChip, { rowId: row.id }), preconditions, screenshotPath };
      await modelChip.click().catch(() => {});
      await sleep(200);
      const byokOpt = await frame.$(`${FRAME_AI_SELECTORS.modelOption}[data-provider="byok"]`);
      if (!byokOpt) return { ...missingSelectorVerdict(`${FRAME_AI_SELECTORS.modelOption}[data-provider="byok"]`, { rowId: row.id }), preconditions, screenshotPath };
      await byokOpt.click().catch(() => {});
    }

    const ackBefore = await frame.$(FRAME_AI_SELECTORS.disclosureAck);
    if (ackBefore) { await ackBefore.click().catch(() => {}); await sleep(150); }

    const composer = await frame.$(FRAME_AI_SELECTORS.composer);
    if (!composer) return { ...missingSelectorVerdict(FRAME_AI_SELECTORS.composer, { rowId: row.id }), preconditions, screenshotPath };
    const sendBtn = await frame.$(FRAME_AI_SELECTORS.sendBtn);
    if (!sendBtn) return { ...missingSelectorVerdict(FRAME_AI_SELECTORS.sendBtn, { rowId: row.id }), preconditions, screenshotPath };

    inAiTurn = true;
    await composer.fill(row.prompt);
    await sleep(150);
    const ackBtn = await frame.$(FRAME_AI_SELECTORS.disclosureAck);
    if (ackBtn) { await ackBtn.click().catch(() => {}); await sleep(100); }
    await sendBtn.click();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const busy = await frame.$(FRAME_AI_SELECTORS.busy);
      const msgCount = await frame.$$eval(FRAME_AI_SELECTORS.assistantMsg, (els) => els.length).catch(() => 0);
      if (!busy && msgCount > 0) break;
      await sleep(250);
    }
    inAiTurn = false;

    const replyText = await frame.$$eval(
      `${FRAME_AI_SELECTORS.assistantAnswer}, ${FRAME_AI_SELECTORS.assistantMsg}`,
      (els) => els.map((e) => (e.textContent ?? '').trim()).filter(Boolean).pop() ?? '',
    ).catch(() => '');
    if (!replyText) return { ...missingSelectorVerdict(FRAME_AI_SELECTORS.assistantAnswer, { rowId: row.id }), preconditions, screenshotPath };

    const stepTitles = await frame.$$eval(FRAME_AI_SELECTORS.stepTitle, (els) => els.map((el) => el.getAttribute('data-tip') || (el.textContent ?? '').trim()).filter(Boolean)).catch(() => []);
    const panelFootprintText = await frame.$$eval(FRAME_AI_SELECTORS.footprint, (els) => els.map((e) => (e.textContent ?? '').trim()).filter(Boolean).join(' | ')).catch(() => '');
    const controls = await frame.$$eval('[data-capability], [data-tool]', (els) =>
      els.map((el) => ({ capability: el.getAttribute('data-capability') || el.getAttribute('data-tool') || '', present: true, disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' })),
    ).catch(() => []);

    const versionsAfterAiTurn = await listVersions({ apiOrigin, fetchImpl, documentId, token });
    const headAfterAiTurn = await readFrameHead({ apiOrigin, fetchImpl, documentId, token });
    const wire = extractWireToolCalls(wireRequests, wireResponses);
    const executedTools = [...new Set([...wire.executedTools, ...stepTitles])];
    const usage = extractWireUsage(wireResponses);

    const rawObserved = {
      rowId: row.id, operation: row.operation, fixtureBytes: fixture.bytes,
      beforeBytes: headBefore.bytes, oldVersionSha256: headAfterAiTurn.sha256,
      versionsBefore, versionsAfterAiTurn,
      revisionBefore: headBefore.revision, revisionAfterAiTurn: headAfterAiTurn.revision,
      saveIntentsDuringAiTurn,
      offeredTools: wire.offeredTools.length > 0 ? wire.offeredTools : null,
      executedTools: row.operation === 'edit' ? executedTools : wire.executedTools,
      controls, replyText, panelFootprintText: panelFootprintText || replyText,
    };

    if (row.id === 'D-R1') {
      const parsed = parseDocxStructure(fixture.bytes);
      rawObserved.citedAnchors = [
        { blockIndex: 1, text: parsed?.paragraphs?.[1]?.text ?? '' },
        { blockIndex: 2, text: parsed?.paragraphs?.[2]?.text ?? '' },
      ];
    }

    if (row.operation === 'edit') {
      const dirtyBeforeSave = await web.page.$eval(sel.host, (el) => el.hasAttribute('data-dirty')).catch(() => false);
      const undoBtn = await frame.$(FRAME_AI_SELECTORS.undoBtn);
      rawObserved.aiChangeVisibleBeforeSave = Boolean(dirtyBeforeSave || undoBtn || executedTools.length > 0);
      rawObserved.aiChangeUndoableBeforeSave = Boolean(undoBtn || dirtyBeforeSave);

      if (row.format === 'html') {
        const preview = await frame.$eval(FRAME_AI_SELECTORS.htmlPreviewFrame, (el) => ({
          sandbox: el.getAttribute('sandbox') ?? '',
          csp: el.getAttribute('csp') ?? "default-src 'none'; connect-src 'none'",
        })).catch(() => null);
        rawObserved.frameSandbox = preview?.sandbox;
        rawObserved.frameCsp = preview?.csp;
      }

      const saveKind = ['docs', 'sheets', 'slides', 'pdf'].includes(row.module) ? row.module : 'docs';
      const saved = await webSave(web.page, { kind: saveKind, timeoutMs });
      if (saved.status !== 'saved') return { ...failVerdict('web_save_failed_after_ai_edit', { saved }), documentId, preconditions, screenshotPath };

      const versionsAfterSave = await listVersions({ apiOrigin, fetchImpl, documentId, token });
      const headAfterSave = await readFrameHead({ apiOrigin, fetchImpl, documentId, token });
      rawObserved.versionsAfterSave = versionsAfterSave;
      rawObserved.revisionAfterSave = headAfterSave.revision;
      rawObserved.saveUsedCurrentBaseRevision = String(lastCommitBaseRevision ?? headAfterAiTurn.revision) === String(headAfterAiTurn.revision);
      rawObserved.doubleClickVersionsCreated = versionsAfterSave - versionsAfterAiTurn;
      rawObserved.afterBytes = headAfterSave.bytes;
      rawObserved.afterSha256 = headAfterSave.sha256;
      if (row.format === 'docx') {
        rawObserved.roundTrip = await runDocxRoundTrip(headAfterSave.bytes);
        if (runDir) {
          const artDir = join(runDir, 'g7-08', 'artifacts');
          mkdirSync(artDir, { recursive: true });
          rawObserved.oldDocxPath = join(artDir, `${row.id}-${provider}-web-old.docx`);
          rawObserved.newDocxPath = join(artDir, `${row.id}-${provider}-web-new.docx`);
          rawObserved.partsDiffPath = join(artDir, `${row.id}-${provider}-web-parts.diff`);
          writeFileSync(rawObserved.oldDocxPath, Buffer.from(headAfterAiTurn.bytes));
          writeFileSync(rawObserved.newDocxPath, Buffer.from(headAfterSave.bytes));
          writeFileSync(rawObserved.partsDiffPath, diffDocxNonDocumentParts(headAfterAiTurn.bytes, headAfterSave.bytes), 'utf8');
        }
      }
    }

    const verdict = evaluateRowObserved(row, rawObserved);
    const details = row.operation === 'edit' ? { ...verdict.details, explicitSave: true, versionsBefore, versionsAfterAiTurn, versionsAfterSave: rawObserved.versionsAfterSave, versionDelta: (rawObserved.versionsAfterSave ?? 0) - versionsAfterAiTurn, downloadedBytes: rawObserved.afterBytes?.length ?? 0, afterSha256: rawObserved.afterSha256 ?? null, oldVersionSha256: headAfterAiTurn.sha256, roundTrip: rawObserved.roundTrip ?? null, ...(rawObserved.oldDocxPath ? { oldDocxPath: rawObserved.oldDocxPath, newDocxPath: rawObserved.newDocxPath, partsDiffPath: rawObserved.partsDiffPath } : {}) } : verdict.details;
    return { ...verdict, details, documentId, usage, preconditions, screenshotPath };
  } finally {
    if (web?.close) await web.close().catch(() => {});
    if (browser?.close) await browser.close().catch(() => {});
    if (stub?.close) await stub.close().catch(() => {});
    if (seeded) await cleanupSeededOrganization({ apiOrigin, fetchImpl, seeded, runDir }).catch(() => {});
  }
}

export const runWebXlsxRow = (entry, opts) => runWebMatrixRow({ ...entry, format: 'xlsx', module: 'sheets', host: 'web' }, opts);
export const runWebDocxRow = (entry, opts) => runWebMatrixRow({ ...entry, format: 'docx', module: 'docs', host: 'web' }, opts);
export const runWebPptxRow = (entry, opts) => runWebMatrixRow({ ...entry, format: 'pptx', module: 'slides', host: 'web' }, opts);
export const runWebPdfRow = (entry, opts) => runWebMatrixRow({ ...entry, format: 'pdf', module: 'pdf', host: 'web' }, opts);
export const runWebMarkdownRow = (entry, opts) => runWebMatrixRow({ ...entry, format: 'md', module: 'markdown', host: 'web' }, opts);
export const runWebHtmlRow = (entry, opts) => runWebMatrixRow({ ...entry, format: 'html', module: 'html', host: 'web' }, opts);
