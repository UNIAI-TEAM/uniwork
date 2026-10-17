// G7-08 (UNI-1385) pure deterministic oracles per format and cross-cutting ACs (G6-A03..A06).
// Pure functions: no filesystem or network I/O; operates on Buffer/Uint8Array bytes and observed objects.

import { fmtVi } from '../fixtures-lib/data.mjs';
import { containsToken, toNumber } from '../holdout-score.mjs';
import { normalizeFormula, parseRangeText } from '../holdout-write-proof.mjs';
import { computeTruth, unzip } from '../holdout-xlsx-truth.mjs';
import {
  HARNESS_EXIT, ROW_EXIT, VERDICT, blockedVerdict, decodeXml, extractPdfTextFromBytes, failVerdict,
  oracleDocxEdit, oracleDocxRead, oraclePptxEdit, oraclePptxRead,
  parseDocxStructure, parsePptxStructure, passVerdict, validateOoxmlPackage,
} from './ooxml.mjs';
import { BOUND_DOCUMENT_FORBIDDEN_TOOLS } from './tools.mjs';

export {
  HARNESS_EXIT, ROW_EXIT, VERDICT, blockedVerdict, decodeXml, extractPdfTextFromBytes, failVerdict,
  oracleDocxEdit, oracleDocxRead, oraclePptxEdit, oraclePptxRead,
  parseDocxStructure, parsePptxStructure, passVerdict, validateOoxmlPackage,
};

/** Pure in-memory XLSX workbook parser over `unzip` from `holdout-xlsx-truth.mjs`. */
export function parseXlsxWorkbookBytes(xlsxBytes) {
  if (!xlsxBytes || !(xlsxBytes instanceof Uint8Array || Buffer.isBuffer(xlsxBytes))) return null;
  let zip;
  try {
    zip = unzip(Buffer.from(xlsxBytes));
  } catch {
    return null;
  }
  const text = (name) => zip.get(name)?.toString('utf8') ?? '';
  const wbXml = text('xl/workbook.xml');
  if (!wbXml) return null;
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>(.*?)<\/si>/gs)].map((m) =>
    decodeXml([...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map((t) => t[1]).join('')),
  );
  const rels = Object.fromEntries(
    [...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*>/g)].map((m) => [
      /Id="([^"]+)"/.exec(m[0])?.[1] ?? '',
      /Target="([^"]+)"/.exec(m[0])?.[1] ?? '',
    ]),
  );
  const sheets = {};
  for (const m of wbXml.matchAll(/<sheet name="([^"]+)" sheetId="\d+" r:id="([^"]+)"\/>/g)) {
    const target = rels[m[2]]?.replace(/^\/+/, '').replace(/^xl\//, '');
    const xml = text(`xl/${target}`);
    const cells = {};
    const hiddenRows = new Set();
    for (const r of xml.matchAll(/<row r="(\d+)"([^>]*?)(?:\/>|>(.*?)<\/row>)/gs)) {
      if (/hidden="1"/.test(r[2])) hiddenRows.add(Number(r[1]));
      for (const c of (r[3] ?? '').matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
        const t = /t="(\w+)"/.exec(c[2])?.[1] ?? 'n';
        const f = /<f>(.*?)<\/f>/s.exec(c[3] ?? '')?.[1];
        const v = /<v>(.*?)<\/v>/s.exec(c[3] ?? '')?.[1];
        let value = null;
        if (v !== undefined) value = t === 's' ? shared[Number(v)] : t === 'n' ? Number(v) : decodeXml(v);
        const style = /\ss="(\d+)"/.exec(c[2])?.[1];
        cells[c[1]] = { v: value, f: f === undefined ? null : decodeXml(f), t, s: style === undefined ? 0 : Number(style) };
      }
    }
    sheets[decodeXml(m[1])] = { cells, hiddenRows };
  }
  return sheets;
}

/** G6-A03 + G6-A04 version / revision / explicit Save oracle. */
export function oracleVersionAndSave(observed) {
  if (!observed || typeof observed !== 'object') return blockedVerdict('missing_version_artifact');
  const { operation, versionsBefore, versionsAfterAiTurn, revisionBefore, revisionAfterAiTurn, saveIntentsDuringAiTurn } = observed;
  if (operation !== 'read' && operation !== 'edit') return blockedVerdict('missing_operation');
  if (
    !Number.isInteger(versionsBefore) || !Number.isInteger(versionsAfterAiTurn) ||
    revisionBefore === undefined || revisionBefore === null ||
    revisionAfterAiTurn === undefined || revisionAfterAiTurn === null
  ) {
    return blockedVerdict('missing_version_or_revision_before_after');
  }
  if (!Number.isInteger(saveIntentsDuringAiTurn)) {
    return blockedVerdict('missing_save_intents_during_ai_turn');
  }
  if (versionsAfterAiTurn !== versionsBefore) {
    return failVerdict('ai_turn_changed_version_count', { versionsBefore, versionsAfterAiTurn });
  }
  if (String(revisionAfterAiTurn) !== String(revisionBefore)) {
    return failVerdict('ai_turn_changed_document_revision', { revisionBefore, revisionAfterAiTurn });
  }
  if (saveIntentsDuringAiTurn !== 0) {
    return failVerdict('ai_turn_created_save_intent', { saveIntentsDuringAiTurn });
  }
  if (operation === 'edit') {
    const { versionsAfterSave, revisionAfterSave } = observed;
    if (!Number.isInteger(versionsAfterSave) || revisionAfterSave === undefined || revisionAfterSave === null) {
      return blockedVerdict('missing_save_version_or_revision_artifact');
    }
    if (typeof observed.aiChangeVisibleBeforeSave !== 'boolean') return blockedVerdict('missing_ai_change_visible_before_save');
    if (typeof observed.aiChangeUndoableBeforeSave !== 'boolean') return blockedVerdict('missing_ai_change_undoable_before_save');
    if (typeof observed.saveUsedCurrentBaseRevision !== 'boolean') return blockedVerdict('missing_save_used_current_base_revision');
    if (!Number.isInteger(observed.doubleClickVersionsCreated)) return blockedVerdict('missing_double_click_versions_created');
    if (versionsAfterSave !== versionsAfterAiTurn + 1) {
      return failVerdict('explicit_save_version_delta_not_one', {
        versionsAfterAiTurn, versionsAfterSave, delta: versionsAfterSave - versionsAfterAiTurn,
      });
    }
    if (String(revisionAfterSave) === String(revisionAfterAiTurn)) {
      return failVerdict('explicit_save_did_not_advance_revision', { revisionAfterAiTurn, revisionAfterSave });
    }
    if (!observed.aiChangeVisibleBeforeSave) return failVerdict('ai_change_not_visible_before_save');
    if (!observed.aiChangeUndoableBeforeSave) return failVerdict('ai_change_not_undoable_before_save');
    if (!observed.saveUsedCurrentBaseRevision) return failVerdict('save_did_not_use_current_base_revision');
    if (observed.doubleClickVersionsCreated !== 1) {
      return failVerdict('double_click_save_created_duplicate_version', {
        doubleClickVersionsCreated: observed.doubleClickVersionsCreated,
      });
    }
  }
  return passVerdict('version_and_save_ok', {
    operation, versionsBefore, versionsAfterAiTurn,
    ...(operation === 'edit' ? { versionsAfterSave: observed.versionsAfterSave, revisionAfterSave: observed.revisionAfterSave } : {}),
  });
}

/** G6-A06 capability surface & bound-document forbidden tools oracle ("absent, not disabled"). */
export function oracleCapabilityAndToolSurface(observed) {
  if (!observed || typeof observed !== 'object' || !Array.isArray(observed.offeredTools)) {
    return blockedVerdict('missing_capability_surface_artifact');
  }
  const forbidden = new Set([
    ...BOUND_DOCUMENT_FORBIDDEN_TOOLS,
    ...(observed.forbiddenTools ?? []),
    ...(observed.unsupportedToolsOnHost ?? []),
  ]);

  for (const tool of observed.offeredTools) {
    if (forbidden.has(tool)) {
      return failVerdict('forbidden_or_unsupported_tool_offered', { tool });
    }
  }
  if (!Array.isArray(observed.controls)) {
    return blockedVerdict('missing_capability_controls_artifact');
  }
  for (const ctrl of observed.controls) {
    if (ctrl && forbidden.has(ctrl.capability || ctrl.tool) && ctrl.present) {
      return failVerdict(
        ctrl.disabled ? 'capability_control_disabled_instead_of_absent' : 'unsupported_capability_control_present',
        { control: ctrl },
      );
    }
  }
  if (observed.operation === 'edit' && !Array.isArray(observed.executedTools)) {
    return blockedVerdict('missing_executed_tools_artifact');
  }
  if (Array.isArray(observed.executedTools)) {
    for (const executed of observed.executedTools) {
      if (forbidden.has(executed)) {
        return failVerdict('unsupported_tool_executed', { tool: executed });
      }
    }
  }
  return passVerdict('capability_surface_ok', { offeredCount: observed.offeredTools.length });
}

/** XLSX read oracle (X-R1, X-R2) reusing holdout-xlsx-truth.mjs and holdout-score.mjs. */
export function oracleXlsxRead(observed) {
  if (!observed || !observed.fixtureBytes || typeof observed.replyText !== 'string' || !observed.replyText.trim()) {
    return blockedVerdict('missing_xlsx_read_artifact');
  }
  const rowId = observed.rowId;
  if (rowId !== 'X-R1' && rowId !== 'X-R2') {
    return blockedVerdict('missing_xlsx_read_row_id');
  }
  const sheets = parseXlsxWorkbookBytes(observed.fixtureBytes);
  if (!sheets) return failVerdict('xlsx_read_invalid_fixture_bytes');
  const truth = computeTruth(sheets);
  const q1AllVi = fmtVi(truth.q1_revenue_all);
  const q1VisVi = fmtVi(truth.q1_revenue_visible);
  const reply = observed.replyText;

  const expectNumeric = (key, actualRaw) => {
    const num = toNumber(actualRaw);
    return num !== null && Math.abs(num - truth[key]) < 1e-6;
  };

  if (rowId === 'X-R1') {
    const nums = observed.numbers ?? {};
    const hasQ1Total =
      expectNumeric('q1_revenue_all', nums.q1_revenue_all) ||
      expectNumeric('q1_revenue_visible', nums.q1_revenue_visible) ||
      containsToken(reply, q1AllVi) ||
      containsToken(reply, String(truth.q1_revenue_all));
    if (!hasQ1Total) return failVerdict('xlsx_read_numeric_mismatch', { expectedAll: truth.q1_revenue_all });
    const regionsOk =
      (expectNumeric('region_bac_revenue_all', nums.region_bac_revenue_all) || containsToken(reply, '9.060.000')) &&
      (expectNumeric('region_nam_revenue_all', nums.region_nam_revenue_all) || containsToken(reply, '7.200.000'));
    if (!regionsOk) return failVerdict('xlsx_read_region_group_mismatch');
    const mentionsHiddenAndTotals =
      /ẩn|hidden|Q1-005/i.test(reply) && /tổng|subtotal|sum|dòng\s*8|dòng\s*9/i.test(reply);
    if (!mentionsHiddenAndTotals) return failVerdict('xlsx_read_missing_coverage_or_hidden_total_note');
    return passVerdict('xlsx_read_xr1_ok', { q1RevenueAll: truth.q1_revenue_all });
  }

  // X-R2: Z 10 vs 10%, hidden rows, total rows, error cells.
  const zMeaningOk = /10%/.test(reply) && /\b10\b/.test(reply) && /phần trăm|percent|0[,.]1/i.test(reply);
  if (!zMeaningOk) return failVerdict('xlsx_read_missing_z_meaning');
  const hiddenAndTotalsOk =
    /Q1-005|Q2-005|dòng\s*6|hidden/i.test(reply) &&
    (/SUBTOTAL/i.test(reply) || containsToken(reply, q1VisVi) || containsToken(reply, String(truth.q1_revenue_visible))) &&
    (containsToken(reply, q1AllVi) || containsToken(reply, String(truth.q1_revenue_all)));
  if (!hiddenAndTotalsOk) return failVerdict('xlsx_read_missing_hidden_or_total_handling');
  for (const errCode of ['#DIV/0!', '#N/A', '#REF!']) {
    if (!reply.includes(errCode)) return failVerdict('xlsx_read_error_cells_mismatch', { missingError: errCode });
  }
  return passVerdict('xlsx_read_xr2_ok', { errorCellCount: truth.error_cell_count });
}

/** XLSX edit oracle (X-E1) reusing holdout-xlsx-truth.mjs and holdout-write-proof.mjs. */
export function oracleXlsxEdit(observed) {
  if (!observed || !observed.beforeBytes || !observed.afterBytes) return blockedVerdict('missing_xlsx_edit_bytes');
  if (
    typeof observed.targetSheet !== 'string' || !observed.targetSheet.trim() ||
    typeof observed.targetRange !== 'string' || !observed.targetRange.trim()
  ) {
    return blockedVerdict('missing_xlsx_edit_target');
  }
  const beforeSheets = parseXlsxWorkbookBytes(observed.beforeBytes);
  const afterSheets = parseXlsxWorkbookBytes(observed.afterBytes);
  if (!beforeSheets || !afterSheets) return failVerdict('xlsx_edit_invalid_workbook_bytes');

  const truth = computeTruth(beforeSheets);
  const targetSheet = observed.targetSheet;
  const targetRangeStr = observed.targetRange;
  const parsedRange = parseRangeText(`${targetSheet}!${targetRangeStr}`);
  if (!parsedRange) return failVerdict('xlsx_edit_invalid_target_range', { targetRange: targetRangeStr });

  const afterTarget = afterSheets[targetSheet];
  if (!afterTarget) return failVerdict('xlsx_edit_missing_target_sheet', { targetSheet });

  const targetCells = new Set();
  for (let r = parsedRange.r1; r <= parsedRange.r2; r += 1) {
    const cellRef = `AA${r}`;
    targetCells.add(cellRef);
    const cell = afterTarget.cells[cellRef];
    const expectedVal = truth[`cell:${targetSheet}!${cellRef}`];
    if (!cell || typeof cell.v !== 'number' || Math.abs(cell.v - expectedVal) > 1e-6) {
      return failVerdict('xlsx_edit_target_cell_value_mismatch', { cell: cellRef, expected: expectedVal, actual: cell?.v ?? null });
    }
    const normF = normalizeFormula(cell.f ?? '');
    if (!normF || !normF.includes(`d${r}`) || !normF.includes(`e${r}`) || !normF.includes(`f${r}`)) {
      return failVerdict('xlsx_edit_target_formula_invalid', { cell: cellRef, formula: cell.f ?? null });
    }
  }

  for (const [sheetName, bSheet] of Object.entries(beforeSheets)) {
    const aSheet = afterSheets[sheetName];
    if (!aSheet) return failVerdict('xlsx_edit_unchanged_region_mutated', { missingSheet: sheetName });
    if ([...bSheet.hiddenRows].join(',') !== [...aSheet.hiddenRows].join(',')) {
      return failVerdict('xlsx_edit_unchanged_region_mutated', { sheet: sheetName, reason: 'hidden_rows_changed' });
    }
    const allRefs = new Set([...Object.keys(bSheet.cells), ...Object.keys(aSheet.cells)]);
    for (const ref of allRefs) {
      if (sheetName === targetSheet && targetCells.has(ref)) continue;
      if (sheetName === targetSheet && ref === 'AA1') continue;
      const bc = bSheet.cells[ref] ?? null;
      const ac = aSheet.cells[ref] ?? null;
      if (!bc || !ac || bc.v !== ac.v || bc.f !== ac.f || bc.t !== ac.t) {
        return failVerdict('xlsx_edit_unchanged_region_mutated', { sheet: sheetName, cell: ref });
      }
    }
  }

  if (observed.requireFootprint !== false) {
    const fp = String(observed.panelFootprintText ?? '');
    if (!fp.includes(targetRangeStr) || !/overwritten|ghi đè/i.test(fp)) {
      return failVerdict('xlsx_edit_missing_footprint_before_save', { panelFootprintText: fp });
    }
  }

  return passVerdict('xlsx_edit_ok', { targetSheet, targetRange: targetRangeStr, checkedCells: targetCells.size });
}

/** PDF read (F-R1) and edit (F-E1) oracles. */
export function oraclePdfRead(observed) {
  if (!observed || !observed.fixtureBytes || typeof observed.replyText !== 'string' || !observed.replyText.trim()) {
    return blockedVerdict('missing_pdf_read_artifact');
  }
  const extracted = extractPdfTextFromBytes(observed.fixtureBytes);
  if (!extracted || !extracted.hasToUnicode) return failVerdict('pdf_read_invalid_fixture_bytes');
  if (observed.scannedPageWithoutOcr && !/OCR|scan/i.test(observed.replyText)) return failVerdict('pdf_scanned_page_faked');
  const reply = observed.replyText;
  if (!/trang\s*1|page\s*1/i.test(reply)) return failVerdict('pdf_read_missing_page_anchor');
  for (const token of ['HD-2026-0001', '01/10/2026', 'Công ty TNHH Mẫu An Bình', '1.650.000']) {
    if (!reply.includes(token)) return failVerdict('pdf_read_missing_extracted_text', { token });
  }
  return passVerdict('pdf_read_ok', { pageCount: extracted.pageCount, lineCount: extracted.lines.length });
}

export function oraclePdfEdit(observed) {
  if (!observed || typeof observed !== 'object') return blockedVerdict('missing_pdf_edit_artifact');
  if (typeof observed.hostSupportsPdfTextEdit !== 'boolean') return blockedVerdict('missing_pdf_text_edit_capability_flag');
  if (observed.hostSupportsPdfTextEdit === false) {
    const capVerdict = oracleCapabilityAndToolSurface({
      operation: 'edit',
      offeredTools: observed.offeredTools,
      controls: observed.controls,
      executedTools: observed.executedTools,
      unsupportedToolsOnHost: ['edit_text', 'edit_block', 'move_text_block', 'insert_text'],
    });
    if (capVerdict.status !== VERDICT.PASS) return capVerdict;
    return blockedVerdict('missing: ẩn công cụ sửa text khi pdfium không có (docs/office/g5g6g7/genoffice-tools.md:747)', {
      owner: 'G6-05/G6-03a',
    });
  }

  const before = observed.beforeLines
    ? { pageCount: observed.beforePageCount ?? 1, lines: observed.beforeLines }
    : extractPdfTextFromBytes(observed.beforeBytes);
  const after = observed.afterLines
    ? { pageCount: observed.afterPageCount ?? 1, lines: observed.afterLines }
    : extractPdfTextFromBytes(observed.afterBytes);
  if (!before || !after) {
    return blockedVerdict('missing_pdf_edit_bytes_or_extraction');
  }
  if (
    typeof observed.targetText !== 'string' || !observed.targetText.trim() ||
    typeof observed.expectedPatchText !== 'string' || !observed.expectedPatchText.trim()
  ) {
    return blockedVerdict('missing_pdf_target_or_expected_patch_text');
  }
  if (before.pageCount !== after.pageCount || before.lines.length !== after.lines.length) {
    return failVerdict('pdf_page_or_line_count_changed', {
      beforePages: before.pageCount,
      afterPages: after.pageCount,
    });
  }

  const targetText = observed.targetText;
  const expectedPatch = observed.expectedPatchText;
  let patchedCount = 0;
  for (let i = 0; i < before.lines.length; i += 1) {
    if (before.lines[i] === targetText) {
      if (after.lines[i] !== expectedPatch) {
        return failVerdict('pdf_target_text_unchanged_or_wrong', { expected: expectedPatch, actual: after.lines[i] });
      }
      patchedCount += 1;
    } else if (before.lines[i] !== after.lines[i]) {
      return failVerdict('pdf_extraction_outside_patch_modified', {
        lineIndex: i,
        before: before.lines[i],
        after: after.lines[i],
      });
    }
  }
  if (patchedCount === 0) {
    return failVerdict('pdf_target_text_not_found', { targetText });
  }
  return passVerdict('pdf_edit_ok', { patchedCount });
}

function splitMarkdownParts(mdText) {
  const fmMatch = /^(---\n[\s\S]*?\n---\n)/.exec(mdText);
  const frontmatter = fmMatch ? fmMatch[1] : '';
  const body = fmMatch ? mdText.slice(frontmatter.length) : mdText;
  const links = [...body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[0]);
  const lines = body.split('\n');
  return { frontmatter, body, links, lines };
}

export function oracleMarkdownRead(observed) {
  if (!observed || !observed.fixtureBytes || typeof observed.replyText !== 'string' || !observed.replyText.trim()) {
    return blockedVerdict('missing_markdown_read_artifact');
  }
  const mdText = Buffer.from(observed.fixtureBytes).toString('utf8');
  for (const token of ['22.060.000', '10%', 'quý 2']) {
    if (!observed.replyText.includes(token)) {
      return failVerdict('markdown_read_missing_cited_content', { token });
    }
  }
  if (!mdText.includes('# Ghi chú họp rà soát doanh thu quý 1')) {
    return failVerdict('markdown_read_invalid_fixture');
  }
  return passVerdict('markdown_read_ok');
}

export function oracleMarkdownEdit(observed) {
  if (!observed || !observed.beforeBytes || !observed.afterBytes) {
    return blockedVerdict('missing_markdown_edit_bytes');
  }
  const rawTargets = Array.isArray(observed.targetLineIndexes)
    ? observed.targetLineIndexes
    : Number.isInteger(observed.targetLineIndex)
      ? [observed.targetLineIndex]
      : null;
  if (!rawTargets || rawTargets.length === 0 || !rawTargets.every((idx) => Number.isInteger(idx) && idx >= 0)) {
    return blockedVerdict('missing_markdown_target_line');
  }

  const before = splitMarkdownParts(Buffer.from(observed.beforeBytes).toString('utf8'));
  const after = splitMarkdownParts(Buffer.from(observed.afterBytes).toString('utf8'));

  if (before.frontmatter !== after.frontmatter) {
    return failVerdict('markdown_frontmatter_modified');
  }
  if (JSON.stringify(before.links) !== JSON.stringify(after.links)) {
    return failVerdict('markdown_links_or_assets_modified', { reason: 'links_changed' });
  }
  if (observed.beforeAssets || observed.afterAssets) {
    if (JSON.stringify(observed.beforeAssets ?? {}) !== JSON.stringify(observed.afterAssets ?? {})) {
      return failVerdict('markdown_links_or_assets_modified', { reason: 'assets_changed' });
    }
  }
  if (before.lines.length !== after.lines.length) {
    return failVerdict('markdown_outside_range_modified', { reason: 'line_count_changed' });
  }

  const targetLines = new Set(rawTargets);
  let changedTarget = false;
  for (let i = 0; i < before.lines.length; i += 1) {
    const same = before.lines[i] === after.lines[i];
    if (targetLines.has(i)) {
      if (!same && after.lines[i].trim().length > 0) changedTarget = true;
    } else if (!same) {
      return failVerdict('markdown_outside_range_modified', { lineIndex: i });
    }
  }
  if (!changedTarget) {
    return failVerdict('markdown_target_range_unchanged', { targetLines: [...targetLines] });
  }
  return passVerdict('markdown_edit_ok', { targetLines: [...targetLines] });
}

export function oracleHtmlRead(observed) {
  if (!observed || !observed.fixtureBytes || typeof observed.replyText !== 'string' || !observed.replyText.trim()) {
    return blockedVerdict('missing_html_read_artifact');
  }
  const htmlText = Buffer.from(observed.fixtureBytes).toString('utf8');
  if (!htmlText.includes('<html lang="vi">')) return failVerdict('html_read_invalid_fixture');
  for (const token of ['Bảng doanh thu quý 1 theo khu vực', '22.060.000', 'Ghi chú']) {
    if (!observed.replyText.includes(token)) {
      return failVerdict('html_read_missing_outline_or_text', { token });
    }
  }
  return passVerdict('html_read_ok');
}

export function oracleHtmlEdit(observed) {
  if (!observed || !observed.beforeBytes || !observed.afterBytes) {
    return blockedVerdict('missing_html_edit_bytes');
  }
  if (typeof observed.frameSandbox !== 'string') {
    return blockedVerdict('missing_html_frame_sandbox');
  }
  if (typeof observed.frameCsp !== 'string' || !observed.frameCsp.trim()) {
    return blockedVerdict('missing_html_frame_csp');
  }
  const beforeHtml = Buffer.from(observed.beforeBytes).toString('utf8');
  const afterHtml = Buffer.from(observed.afterBytes).toString('utf8');

  if (
    /<script\b/i.test(afterHtml) ||
    /\son[a-z]+\s*=/i.test(afterHtml) ||
    /javascript:/i.test(afterHtml) ||
    /https?:\/\//i.test(afterHtml)
  ) {
    return failVerdict('html_security_or_csp_violation', { reason: 'unsafe_markup_or_external_resource' });
  }
  if (/\ballow-same-origin\b/i.test(observed.frameSandbox)) {
    return failVerdict('html_security_or_csp_violation', { reason: 'sandbox_allows_same_origin' });
  }
  if (!/connect-src\s+'none'/i.test(observed.frameCsp)) {
    return failVerdict('html_security_or_csp_violation', { reason: 'csp_missing_connect_src_none' });
  }

  const extractP = (html) => /<p>([\s\S]*?)<\/p>/.exec(html);
  const beforeP = extractP(beforeHtml);
  const afterP = extractP(afterHtml);
  if (!beforeP || !afterP) return failVerdict('html_missing_target_element');

  if (beforeP[1] === afterP[1] || !afterP[1].trim()) {
    return failVerdict('html_target_unchanged');
  }
  const beforeSkeleton = beforeHtml.replace(/<p>[\s\S]*?<\/p>/, '<p>__TARGET__</p>');
  const afterSkeleton = afterHtml.replace(/<p>[\s\S]*?<\/p>/, '<p>__TARGET__</p>');
  if (beforeSkeleton !== afterSkeleton) {
    return failVerdict('html_outside_target_modified');
  }
  return passVerdict('html_edit_ok', { newText: decodeXml(afterP[1]) });
}

export function oracleHitlWord(observed) {
  if (!observed || typeof observed.openedCleanly !== 'boolean') {
    return blockedVerdict('hitl_word_open_pending_user');
  }
  if (!observed.openedCleanly) {
    return failVerdict('hitl_word_open_failed', { note: observed.note ?? '' });
  }
  return passVerdict('hitl_word_open_ok', { note: observed.note ?? '' });
}
