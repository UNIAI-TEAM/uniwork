#!/usr/bin/env node
// G6-08 dev set runner & measurement harness (UNI-1373).
//
// Runs all 20 cases in docs/office/g5g6g7/devset/cases.json against the real
// UniWork AI façade route (/api/v1/office-frame/documents/{id}/ai/uniwork/chat/completions)
// backed by a local D server + dev upstream (AI_PROVIDER=openai), and optionally
// drives the real fork web frame (app dev via Vite in a detached worktree of
// uniwork-office) with headless Playwright across (xlsx, docx) x (vi, en) to
// prove end-to-end panel parity.
//
// Usage:
//   node scripts/office/devset-run.mjs --help
//   node scripts/office/devset-run.mjs --server-url <server-origin> \
//     --db-url <postgres-url> \
//     [--frame-dir /home/ubuntu/orca/workspaces/uniwork-office/g6-08-panel-run] \
//     [--out /tmp/g6-08-run-v1.json]
//   node scripts/office/devset-run.mjs --server-sha <commit> --db-url <postgres-url> [...]
//     builds, migrates and starts the server at that commit in a temporary
//     worktree (removed afterwards), so the @1 baseline (4df589a37) reruns
//     without a new env var or a second checkout.
// The panel proof (--frame-dir) types each case's own prompt into the real
// fork web panel, scores the reply with scoreDevCase and refuses to write a
// summary unless all four combinations reached the façade with a bearer frame
// token.

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadDevSet, scanForSecrets, scoreDevCase } from './devset.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOOPBACK_HOST = 'localhost';

function localHttpOrigin(port) {
  return ['http', '://', LOOPBACK_HOST, ':', String(port)].join('');
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1),
  );
  return Number(sortedValues[idx].toFixed(1));
}

export function summarizeRunResults(caseResults, meta = {}) {
  const total = caseResults.length;
  const passed = caseResults.filter((r) => r.passed).length;
  const byLang = {};
  for (const lang of ['vi', 'en']) {
    const sub = caseResults.filter((r) => r.lang === lang);
    const subPass = sub.filter((r) => r.passed).length;
    byLang[lang] = {
      total: sub.length,
      passed: subPass,
      accuracy: sub.length ? Number((subPass / sub.length).toFixed(4)) : 0,
    };
  }
  const byFormat = {};
  for (const fmt of ['xlsx', 'docx']) {
    const sub = caseResults.filter((r) => r.format === fmt);
    const subPass = sub.filter((r) => r.passed).length;
    byFormat[fmt] = {
      total: sub.length,
      passed: subPass,
      accuracy: sub.length ? Number((subPass / sub.length).toFixed(4)) : 0,
    };
  }
  const modelLat = caseResults.map((r) => r.latenciesMs.model).sort((a, b) => a - b);
  const toolLat = caseResults.map((r) => r.latenciesMs.tool).sort((a, b) => a - b);
  const e2eLat = caseResults.map((r) => r.latenciesMs.endToEnd).sort((a, b) => a - b);
  const outsideAllowlistTotal = caseResults.reduce(
    (acc, r) => acc + (r.outsideAllowlist?.length ?? 0),
    0,
  );

  return {
    ...meta,
    total,
    passed,
    accuracy: total ? Number((passed / total).toFixed(4)) : 0,
    byLang,
    byFormat,
    outsideAllowlistTotal,
    latenciesMs: {
      model: { p50: percentile(modelLat, 50), p95: percentile(modelLat, 95) },
      tool: { p50: percentile(toolLat, 50), p95: percentile(toolLat, 95) },
      endToEnd: { p50: percentile(e2eLat, 50), p95: percentile(e2eLat, 95) },
    },
    cases: caseResults,
  };
}

// ---- Tool schemas offered by the fork web frame (apps/sheets & apps/docs) ----

const SHEETS_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'get_workbook_context',
      description:
        'Get a workbook overview: all sheets (id/name/data-extent rows-columns), active sheet, current selection, known non-empty cell addresses.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_range',
      description:
        'Read current values/formulas by rectangular range, returning a grid with row numbers and column letters, plus [type; raw value; format] notes and formula provenance warnings.',
      parameters: {
        type: 'object',
        properties: {
          range: { type: 'string', description: 'Range like "A1:I9"' },
          sheetId: { type: 'string', description: 'Sheet id or name from get_workbook_context' },
        },
        required: ['range'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_cells',
      description:
        'Read current values/formulas/provenance of specific scattered cells.',
      parameters: {
        type: 'object',
        properties: {
          addresses: { type: 'array', items: { type: 'string' } },
          sheetId: { type: 'string' },
        },
        required: ['addresses'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_formats',
      description: 'Read number formats and cell types over a range.',
      parameters: {
        type: 'object',
        properties: {
          range: { type: 'string' },
          sheetId: { type: 'string' },
        },
        required: ['range'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_sheet_features',
      description: 'Read worksheet AutoFilter, hidden rows, totals rows, and protection state.',
      parameters: {
        type: 'object',
        properties: {
          sheetId: { type: 'string' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'aggregate_range',
      description:
        'Compute non-empty count, numeric sum/average/min/max over a range, optionally skipping hidden rows.',
      parameters: {
        type: 'object',
        properties: {
          range: { type: 'string' },
          sheetId: { type: 'string' },
          skipHiddenRows: { type: 'boolean' },
        },
        required: ['range'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_range',
      description:
        'Read-only conditional statistics over a table range (sum/count/average/min/max), grouped by a column or filtered by conditions, skipping total/subtotal rows.',
      parameters: {
        type: 'object',
        properties: {
          range: { type: 'string' },
          sheetId: { type: 'string' },
          function: { type: 'string', enum: ['sum', 'count', 'average', 'min', 'max'] },
          valueColumn: { type: 'string' },
          groupByColumn: { type: 'string' },
          skipHiddenRows: { type: 'boolean' },
        },
        required: ['range'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_cells',
      description: 'Search the workbook or one sheet for cells matching a query or errors_only=true.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          errors_only: { type: 'boolean' },
          sheetId: { type: 'string' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trace_precedents',
      description: 'List the cells/ranges a formula reads and their current values/errors.',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string' },
          sheetId: { type: 'string' },
        },
        required: ['address'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_clarification',
      description:
        'Ask the user up to 4 short multiple-choice clarification questions before computing or editing when the request is ambiguous.',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                options: { type: 'array', items: { type: 'string' } },
              },
              required: ['label', 'options'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_operations',
      description: 'Submit a batch of workbook change operations.',
      parameters: {
        type: 'object',
        properties: {
          operations: { type: 'array', items: { type: 'object' } },
        },
        required: ['operations'],
      },
    },
  },
];

const DOCS_TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'get_document_context',
      description:
        'Get document overview: title, block count, headings outline, current selection (<sel>…</sel>) and selected block index.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_blocks',
      description: 'Read document blocks by 0-based startBlockIndex and endBlockIndex.',
      parameters: {
        type: 'object',
        properties: {
          startBlockIndex: { type: 'integer' },
          endBlockIndex: { type: 'integer' },
        },
        required: ['startBlockIndex', 'endBlockIndex'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_selection',
      description:
        "Replace the user's selected text in the selected block with new inline content, leaving all other blocks unchanged.",
      parameters: {
        type: 'object',
        properties: {
          html: { type: 'string', description: 'Replacement text or inline HTML for the selection' },
        },
        required: ['html'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_blocks',
      description: 'Replace a block range [startBlockIndex..endBlockIndex] with new HTML content.',
      parameters: {
        type: 'object',
        properties: {
          startBlockIndex: { type: 'integer' },
          endBlockIndex: { type: 'integer' },
          html: { type: 'string' },
        },
        required: ['startBlockIndex', 'endBlockIndex', 'html'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_ops',
      description: 'Run structured document operations.',
      parameters: {
        type: 'object',
        properties: {
          ops: { type: 'array', items: { type: 'object' } },
          dryRun: { type: 'boolean' },
        },
        required: ['ops'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_clarification',
      description: 'Ask the user clarifying questions before editing when the request is ambiguous.',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                options: { type: 'array', items: { type: 'string' } },
              },
              required: ['label', 'options'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
];

// ---- Deterministic tool executor matching the fork's sheets & docs engines ----

// The two fixture-backed grids of dev-xlsx-orders-xyz.xlsx. They back the
// façade runner tool executor and, through the generated panel harness sheets
// skill (BE68-3), the panel run: both paths execute the model tool calls
// against this one fixture data.
export const DEVSET_SHEET1_GRID = {
  sheetId: 'sheet-1',
  sheetName: 'Bán hàng T1',
  dimension: 'A1:I9',
  hiddenRows: [6],
  autoFilter: 'A1:I7',
  totalsRows: [
    { row: 8, label: 'Tổng cộng', formulaD8: '=SUM(D2:D7)', valueD8: 65, formulaG8: '=SUM(G2:G7)', valueG8: 61020, includesHiddenRow6: true },
    { row: 9, label: 'Tổng dòng hiển thị', formulaD9: '=SUBTOTAL(109,D2:D7)', valueD9: 53, formulaG9: '=SUBTOTAL(109,G2:G7)', valueG9: 51300, includesHiddenRow6: false },
  ],
  rows: [
    { row: 1, cells: { A1: 'Mã phiếu', B1: 'Chi nhánh', C1: 'Mặt hàng', D1: 'Số lượng (X)', E1: 'Đơn giá (Y)', F1: 'Chiết khấu (Z)', G1: 'Doanh thu ròng', H1: 'Đơn giá sau CK', I1: 'Tra cứu mã' } },
    { row: 2, cells: { A2: 'BH-101', B2: 'Miền Bắc', C2: 'Sổ tay A5', D2: 10, E2: 1200, F2: '5% [percent; raw 0.05; format 0%]', G2: '11400 [formula =D2*E2*(1-IF(F2>1,F2/100,F2))]', H2: '1140 [formula =G2/D2]', I2: 'Hợp lệ' }, net: 11400, unitAfter: 1140, branch: 'Miền Bắc', hidden: false },
    { row: 3, cells: { A3: 'BH-102', B3: 'Miền Trung', C3: 'Bút bi xanh', D3: 20, E3: 800, F3: '10 [number; raw 10; format General — plain number 10 representing 10% (0.1)]', G3: '14400 [formula =D3*E3*(1-IF(F3>1,F3/100,F3))]', H3: '720 [formula =G3/D3]', I3: 'Hợp lệ' }, net: 14400, unitAfter: 720, branch: 'Miền Trung', hidden: false },
    { row: 4, cells: { A4: 'BH-103', B4: 'Miền Nam', C4: 'Kẹp tài liệu', D4: 15, E4: 1000, F4: '10% [percent; raw 0.1; format 0%]', G4: '13500 [formula =D4*E4*(1-IF(F4>1,F4/100,F4))]', H4: '900 [formula =G4/D4]', I4: 'Hợp lệ' }, net: 13500, unitAfter: 900, branch: 'Miền Nam', hidden: false },
    { row: 5, cells: { A5: 'BH-104', B5: 'Miền Bắc', C5: 'Thước kẻ', D5: 8, E5: 1500, F5: '[blank -> 0%]', G5: '12000 [formula =D5*E5*(1-IF(F5>1,F5/100,F5))]', H5: '1500 [formula =G5/D5]', I5: 'Hợp lệ' }, net: 12000, unitAfter: 1500, branch: 'Miền Bắc', hidden: false },
    { row: 6, hidden: true, note: 'HIDDEN ROW (row 6 hidden="1")', cells: { A6: 'BH-105', B6: 'Miền Trung', C6: 'Bìa hồ sơ', D6: 12, E6: 900, F6: '10% [percent; raw 0.1; format 0%; hidden row]', G6: '9720 [formula =D6*E6*(1-IF(F6>1,F6/100,F6))]', H6: '810 [formula =G6/D6]', I6: 'Ẩn kiểm kê' }, net: 9720, unitAfter: 810, branch: 'Miền Trung' },
    { row: 7, cells: { A7: 'BH-106', B7: 'Miền Nam', C7: 'Nhãn dán', D7: 0, E7: 1100, F7: '[blank -> 0%]', G7: '0 [formula =D7*E7*(1-IF(F7>1,F7/100,F7))]', H7: '#DIV/0! [error; formula =G7/D7]', I7: '#N/A [error; formula =VLOOKUP(A7,\'Kiểm toán\'!$A$2:$B$6,2,FALSE)]' }, net: 0, unitAfter: null, branch: 'Miền Nam', hidden: false },
    { row: 8, isTotalRow: true, cells: { A8: 'Tổng cộng', D8: '65 [formula =SUM(D2:D7); includes hidden row 6]', G8: '61020 [formula =SUM(G2:G7); includes hidden row 6]' } },
    { row: 9, isTotalRow: true, cells: { A9: 'Tổng dòng hiển thị', D9: '53 [formula =SUBTOTAL(109,D2:D7); visible rows only, excludes hidden row 6]', G9: '51300 [formula =SUBTOTAL(109,G2:G7); visible rows only, excludes hidden row 6]' } },
  ],
  computedSummary: {
    visibleOnlyNetRevenue: 51300,
    allRowsIncludingHiddenRow6NetRevenue: 61020,
    hiddenRow6BH105NetRevenue: 9720,
    byBranchVisibleOnly: { 'Miền Bắc': 23400, 'Miền Trung': 14400, 'Miền Nam': 13500 },
    byBranchWithHiddenRow6: { 'Miền Bắc': 23400, 'Miền Trung': 24120, 'Miền Nam': 13500 },
    columnHUnitAfterDiscount: {
      validRows: 'H2:H6 (5 numeric cells: 1140, 720, 900, 1500, 810)',
      validCount: 5,
      validSum: 5070,
      validAverage: 1014,
      skippedErrorCells: [{ cell: 'H7', error: '#DIV/0!', formula: '=G7/D7' }],
      skippedErrorCellsColI: [{ cell: 'I7', error: '#N/A', formula: "=VLOOKUP(A7,'Kiểm toán'!$A$2:$B$6,2,FALSE)" }],
    },
  },
};

export const DEVSET_SHEET2_GRID = {
  sheetId: 'sheet-2',
  sheetName: 'Kiểm toán',
  dimension: 'A1:E6',
  hiddenRows: [],
  rows: [
    { row: 1, cells: { A1: 'Khoản mục', B1: 'Giá trị gốc', C1: 'Hệ số', D1: 'Kết quả công thức', E1: 'Quy tắc và ghi chú' } },
    {
      row: 2,
      cells: {
        A2: 'Doanh thu dự phòng',
        B2: 2500,
        C2: 4,
        D2: '99999 [formula =LEGACYCACHE(B2,C2); NOT RECALCULATED — cached value from the file; engine returns #NAME? (unsupported function: LEGACYCACHE); true product B2*C2 = 10000]',
        E2: 'Giá trị cache lưu trong tệp (99999) đã cũ (NOT RECALCULATED); công thức đúng là B2*C2 = 10000',
      },
    },
    {
      row: 3,
      cells: {
        A3: 'Chi phí vận hành chuẩn',
        B3: 2500,
        C3: 4,
        D3: '10000 [formula =B3*C3; file had stale cached value 88888, recalculated by engine to 10000]',
        E3: 'Cache cũ trong tệp là 88888 nhưng tích thực tế B3*C3 = 10000',
      },
    },
    {
      row: 4,
      cells: {
        A4: 'Tỷ giá XML ngoại vi',
        B4: '<root><tygia>25</tygia></root> [text]',
        C4: 1,
        D4: '#NAME? [error; formula =FILTERXML(B4,"//tygia"); unsupported function: FILTERXML — NOT RECALCULATED]',
        E4: 'Hàm FILTERXML không được hỗ trợ trong bộ tính công thức hiện tại',
      },
    },
    {
      row: 5,
      cells: {
        A5: 'Phí vận chuyển (văn bản locale)',
        B5: '"1.250,5" [text; raw string "1.250,5" — locale-formatted text, NOT a number; skipped by numeric sum/aggregate]',
        C5: 1,
        D5: '3200.756 [number; raw 3200.756; rounded to 0dp per E5 = 3201]',
        E5: 'Làm tròn kết quả cột D đến hàng đơn vị (0 chữ số thập phân)',
      },
    },
    {
      row: 6,
      cells: {
        A6: 'Phí bảo hiểm kho',
        B6: '800 [number; raw 800]',
        C6: 1,
        D6: '1450.244 [number; raw 1450.244; rounded to 0dp per E6 = 1450]',
        E6: 'Làm tròn kết quả cột D đến hàng đơn vị (0 chữ số thập phân)',
      },
    },
  ],
  computedSummary: {
    b5b6NumericAggregation: {
      numericCellsCount: 1,
      numericSum: 800,
      skippedTextCells: [{ cell: 'B5', text: '1.250,5', reason: 'stored as text (locale string), never cast to number' }],
    },
    d5d6Rounding: {
      ruleCell: 'E5:E6 (round column D to integer / 0 decimal places)',
      d5Raw: 3200.756,
      d5Rounded: 3201,
      d6Raw: 1450.244,
      d6Rounded: 1450,
      sumRaw: 4651.0,
      sumRounded: 4651,
    },
  },
};

// ---- Deterministic tool executor matching the fork sheets & docs engines ----

function createCaseToolExecutor(caseDoc, xlsxOracle, docxOracle) {
  const docxBlocks = docxOracle.blocks.map((b) => ({ ...b }));
  let writes = 0;
  const sheet1Grid = DEVSET_SHEET1_GRID;
  const sheet2Grid = DEVSET_SHEET2_GRID;

  function resolveSheet(sheetIdOrName) {
    const s = String(sheetIdOrName ?? caseDoc.context?.activeSheet ?? 'Bán hàng T1').toLowerCase();
    if (s.includes('2') || s.includes('kiểm') || s.includes('kiem')) return sheet2Grid;
    return sheet1Grid;
  }

  function stripHtml(html) {
    return String(html ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
  }

  return {
    getMutatedBlocks: () => docxBlocks.map((b) => ({ ...b })),
    getWrites: () => writes,
    execute(name, rawArgs) {
      let args = {};
      if (typeof rawArgs === 'string' && rawArgs.trim()) {
        try {
          args = JSON.parse(rawArgs);
        } catch {
          args = {};
        }
      } else if (rawArgs && typeof rawArgs === 'object') {
        args = rawArgs;
      }

      if (caseDoc.format === 'xlsx') {
        if (name === 'get_workbook_context') {
          return {
            activeSheetId:
              caseDoc.context?.activeSheet === 'Kiểm toán' ? 'sheet-2' : 'sheet-1',
            activeSheetName: caseDoc.context?.activeSheet ?? 'Bán hàng T1',
            selection: caseDoc.selection,
            sheets: [
              {
                id: 'sheet-1',
                name: 'Bán hàng T1',
                rows: 9,
                columns: 9,
                dataRange: 'A1:I9',
                hiddenRows: [6],
                totalsRows: [8, 9],
                autoFilter: 'A1:I7',
              },
              {
                id: 'sheet-2',
                name: 'Kiểm toán',
                rows: 6,
                columns: 5,
                dataRange: 'A1:E6',
                hiddenRows: [],
              },
            ],
          };
        }
        if (name === 'read_range' || name === 'read_cells' || name === 'read_formats') {
          const target = resolveSheet(args.sheetId);
          return target;
        }
        if (name === 'read_sheet_features') {
          const target = resolveSheet(args.sheetId);
          return {
            sheetId: target.sheetId,
            sheetName: target.sheetName,
            hiddenRows: target.hiddenRows,
            autoFilter: target.autoFilter ?? null,
            totalsRows: target.totalsRows ?? [],
            protected: false,
          };
        }
        if (name === 'aggregate_range' || name === 'summarize_range') {
          const target = resolveSheet(args.sheetId);
          return {
            sheetId: target.sheetId,
            sheetName: target.sheetName,
            range: args.range ?? target.dimension,
            skipHiddenRows: Boolean(args.skipHiddenRows),
            summary: target.computedSummary,
            rows: target.rows,
          };
        }
        if (name === 'find_cells' || name === 'trace_precedents') {
          return {
            sheet1Errors: sheet1Grid.computedSummary.columnHUnitAfterDiscount,
            sheet2Formulas: sheet2Grid.rows,
          };
        }
        if (name === 'ask_clarification') {
          return {
            status: 'clarification_requested',
            questions: args.questions ?? [],
            note: 'User paused to review clarification options; conclude your turn by summarizing the clarification needed without editing.',
          };
        }
        if (name === 'propose_operations') {
          writes += 1;
          return { status: 'applied', operationsCount: (args.operations ?? []).length };
        }
        return { error: `unsupported tool ${name}` };
      }

      // DOCX tools
      if (name === 'get_document_context') {
        const selIdx = caseDoc.selection?.blockIndex ?? 4;
        return {
          title: docxOracle.title,
          paragraphCount: docxBlocks.length,
          selectedBlockIndex: selIdx,
          selection: `<sel block="${selIdx}">${caseDoc.selection?.text ?? ''}</sel>`,
          blocks: docxBlocks.map((b) => ({
            index: b.index,
            style: b.style,
            preview: b.text,
          })),
        };
      }
      if (name === 'read_blocks') {
        const start = Math.max(0, Number(args.startBlockIndex ?? 0));
        const end = Math.min(docxBlocks.length - 1, Number(args.endBlockIndex ?? docxBlocks.length - 1));
        return {
          startBlockIndex: start,
          endBlockIndex: end,
          blocks: docxBlocks.slice(start, end + 1),
        };
      }
      if (name === 'replace_selection') {
        const selIdx = caseDoc.selection?.blockIndex ?? 4;
        const newText = stripHtml(args.html);
        if (newText && docxBlocks[selIdx]) {
          docxBlocks[selIdx] = { ...docxBlocks[selIdx], text: newText };
          writes += 1;
        }
        return {
          ok: true,
          editedBlockIndex: selIdx,
          newText: docxBlocks[selIdx]?.text ?? '',
          note: 'Edit applied in editor (not yet saved). Other blocks [0..6] outside selection are unchanged.',
        };
      }
      if (name === 'replace_blocks') {
        const start = Number(args.startBlockIndex ?? caseDoc.selection?.blockIndex ?? 4);
        const end = Number(args.endBlockIndex ?? start);
        const newText = stripHtml(args.html);
        if (start === end && newText && docxBlocks[start]) {
          docxBlocks[start] = { ...docxBlocks[start], text: newText };
          writes += 1;
        }
        return {
          ok: true,
          startBlockIndex: start,
          endBlockIndex: end,
          newText: docxBlocks[start]?.text ?? '',
          note: 'Edit applied in editor (not yet saved). Other blocks outside [start..end] are unchanged.',
        };
      }
      if (name === 'apply_ops') {
        const selIdx = caseDoc.selection?.blockIndex ?? 4;
        const ops = Array.isArray(args.ops) ? args.ops : [];
        for (const op of ops) {
          const idx = Number(op.blockIndex ?? op.target?.blockIndex ?? selIdx);
          const candidate = stripHtml(op.text ?? op.html ?? op.replacement ?? '');
          if (candidate && docxBlocks[idx]) {
            docxBlocks[idx] = { ...docxBlocks[idx], text: candidate };
          }
        }
        if (!args.dryRun) writes += 1;
        return {
          ok: true,
          editedBlockIndex: selIdx,
          newText: docxBlocks[selIdx]?.text ?? '',
          note: 'Edit applied in editor (not yet saved).',
        };
      }
      if (name === 'ask_clarification') {
        return {
          status: 'clarification_requested',
          questions: args.questions ?? [],
        };
      }
      return { error: `unsupported tool ${name}` };
    },
  };
}

// ---- Parse one-chunk SSE or JSON response from the UniWork AI façade ----

function parseUniworkFacadeResponse(rawText) {
  const trimmed = String(rawText ?? '').trim();
  if (trimmed.startsWith('{')) {
    const obj = JSON.parse(trimmed);
    const choice = obj.choices?.[0] ?? {};
    const msg = choice.message ?? choice.delta ?? {};
    return {
      model: obj.model ?? '',
      content: msg.content ?? '',
      toolCalls: msg.tool_calls ?? [],
      finishReason: choice.finish_reason ?? '',
      xUniwork: obj.x_uniwork ?? null,
    };
  }
  let model = '';
  let content = '';
  const toolCalls = [];
  let finishReason = '';
  let xUniwork = null;
  for (const line of trimmed.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const payload = s.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    const chunk = JSON.parse(payload);
    if (chunk.model) model = chunk.model;
    if (chunk.x_uniwork) xUniwork = chunk.x_uniwork;
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const msg = choice.delta ?? choice.message ?? {};
    if (typeof msg.content === 'string') content += msg.content;
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        toolCalls.push(tc);
      }
    }
  }
  return { model, content, toolCalls, finishReason, xUniwork };
}

// ---- Bootstrap tenant, documents, and frame tokens on the local D server ----

function execPsql(dbUrl, extraArgs) {
  let dbName = 'uniwork_g608_dev';
  try {
    const u = new URL(dbUrl);
    dbName = u.pathname.replace(/^\/+/, '') || dbName;
  } catch {
    // keep default
  }
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'uniwork', '-d', dbName, ...extraArgs],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

async function bootstrapServerTenant(serverUrl, dbUrl) {
  const email = `g608-devset-${Date.now()}@example.com`;
  const password = 'DevSetPassword123!';
  const regRes = await fetch(`${serverUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      display_name: 'G6-08 Devset Runner',
    }),
  });
  if (!regRes.ok) {
    throw new Error(`register failed: ${regRes.status} ${await regRes.text()}`);
  }
  const regBody = await regRes.json();
  const token = regBody.access_token || regBody.token;
  const userId = regBody.user?.id;

  if (dbUrl) {
    const preSql = `
      UPDATE users SET email_verified_at = now() WHERE id = '${userId}';
      INSERT INTO feature_flag_overrides (id, flag_key, scope_type, scope_id, enabled, note, created_by, created_by_kind)
      VALUES
        ('01J00000000000000000000001', 'office_ai_uniwork', 'global', '', true, 'G6-08 devset evaluation', '${userId}', 'human'),
        ('01J00000000000000000000002', 'office_ai_uniwork_xlsx', 'global', '', true, 'G6-08 devset evaluation', '${userId}', 'human'),
        ('01J00000000000000000000003', 'office_ai_uniwork_docx', 'global', '', true, 'G6-08 devset evaluation', '${userId}', 'human'),
        ('01J00000000000000000000004', 'office_docs_web', 'global', '', true, 'G6-08 devset evaluation', '${userId}', 'human'),
        ('01J00000000000000000000005', 'office_sheets_web', 'global', '', true, 'G6-08 devset evaluation', '${userId}', 'human'),
        ('01J00000000000000000000006', 'documents', 'global', '', true, 'G6-08 devset evaluation', '${userId}', 'human')
      ON CONFLICT (flag_key, scope_type, scope_id) DO UPDATE SET enabled = EXCLUDED.enabled;
    `;
    execPsql(dbUrl, ['-v', 'ON_ERROR_STOP=1', '-c', preSql]);
  }

  const orgRes = await fetch(`${serverUrl}/api/v1/orgs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name: 'G6-08 Org', slug: `g608-org-${Date.now()}` }),
  });
  if (!orgRes.ok) {
    throw new Error(`create org failed: ${orgRes.status} ${await orgRes.text()}`);
  }
  const orgBody = await orgRes.json();
  const orgId = orgBody.organization?.id || orgBody.id;

  const wsRes = await fetch(`${serverUrl}/api/v1/orgs/${orgId}/workspaces`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: 'G6-08 Workspace',
      slug: `g608-ws-${Date.now()}`,
    }),
  });
  if (!wsRes.ok) {
    throw new Error(`create workspace failed: ${wsRes.status} ${await wsRes.text()}`);
  }
  const wsBody = await wsRes.json();
  const wsId = wsBody.workspace?.id || wsBody.id;

  // Enable enterprise/AI entitlements in the temporary devset DB
  if (dbUrl) {
    const sql = `
      UPDATE subscriptions
      SET overrides = '{"office.ai_cloud": true, "ai.tokens": 100000000}'::jsonb
      WHERE organization_id = '${orgId}';
    `;
    execPsql(dbUrl, ['-v', 'ON_ERROR_STOP=1', '-c', sql]);
  }

  return { token, userId, orgId, wsId };
}

async function uploadFixtureAndMintFrameToken(serverUrl, session, fixtureRelPath, fileName, mimeType) {
  const bytes = fs.readFileSync(path.join(repoRoot, fixtureRelPath));
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType }), fileName);
  form.append('title', fileName);

  const upRes = await fetch(
    `${serverUrl}/api/v1/workspaces/${session.wsId}/documents/files`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
      body: form,
    },
  );
  if (!upRes.ok) {
    throw new Error(`upload file ${fileName} failed: ${upRes.status} ${await upRes.text()}`);
  }
  const upBody = await upRes.json();
  const docId = upBody.document?.id || upBody.file?.document_id || upBody.file?.id || upBody.id;

  const mintRes = await fetch(
    `${serverUrl}/api/v1/documents/${docId}/office/frame-token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({}),
    },
  );
  if (!mintRes.ok) {
    throw new Error(`mint frame token for ${fileName} failed: ${mintRes.status} ${await mintRes.text()}`);
  }
  const mintBody = await mintRes.json();
  return {
    docId,
    frameToken: mintBody.token,
    aiGrant: mintBody.ai,
  };
}

function queryLatestUsageRow(dbUrl, orgId) {
  if (!dbUrl) return null;
  try {
    const out = execPsql(dbUrl, [
      '-At',
      '-F',
      '|',
      '-c',
      `SELECT prompt_id, model, status, latency_ms, input_tokens, output_tokens
       FROM ai_usage_events
       WHERE organization_id = '${orgId}' AND capability = 'office_uniwork_ai'
       ORDER BY created_at DESC LIMIT 1;`,
    ]).trim();
    if (!out) return null;
    const [promptId, model, status, latencyMs, inTok, outTok] = out.split('|');
    return {
      promptId,
      model,
      status,
      latencyMs: Number(latencyMs || 0),
      inputTokens: Number(inTok || 0),
      outputTokens: Number(outTok || 0),
    };
  } catch {
    return null;
  }
}

// ---- Run one dev case over the D server frame-token UniWork AI façade ----

async function runCaseOnFacade({
  caseDoc,
  serverUrl,
  dbUrl,
  orgId,
  docMount,
  xlsxOracle,
  docxOracle,
}) {
  const executor = createCaseToolExecutor(caseDoc, xlsxOracle, docxOracle);
  const allSchemas = caseDoc.format === 'xlsx' ? SHEETS_TOOL_SCHEMAS : DOCS_TOOL_SCHEMAS;
  const offeredTools = allSchemas.filter((t) =>
    caseDoc.allowedTools.includes(t.function.name),
  );

  const endpoint = `${serverUrl}/api/v1/office-frame/documents/${docMount.docId}/ai/uniwork/chat/completions`;
  let conversationId = '';
  let runId = '';
  const recordedToolCalls = [];
  const droppedCalls = [];
  let modelMsTotal = 0;
  let toolMsTotal = 0;
  let finalAnswer = '';
  let resolvedModel = '';
  let promptId = '';

  const contextPrefix =
    caseDoc.format === 'xlsx'
      ? `[Active sheet: "${caseDoc.context?.activeSheet ?? 'Bán hàng T1'}", Selection: ${caseDoc.selection?.sheet ?? 'Bán hàng T1'}!${caseDoc.selection?.range ?? 'A1:I9'}]\n`
      : `[Document: "${caseDoc.context?.title ?? ''}", Selected block ${caseDoc.selection?.blockIndex ?? 4}: <sel>${caseDoc.selection?.text ?? ''}</sel>]\n`;

  let nextMessages = [{ role: 'user', content: contextPrefix + caseDoc.prompt }];

  const e2eStart = performance.now();
  for (let step = 0; step < 6; step++) {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${docMount.frameToken}`,
    };
    if (conversationId) headers['X-UniWork-AI-Conversation'] = conversationId;
    if (runId) headers['X-UniWork-AI-Run'] = runId;

    const reqBody = {
      model: 'uniwork',
      stream: true,
      messages: nextMessages,
      tools: offeredTools,
    };

    const tModel0 = performance.now();
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
    });
    const rawText = await res.text();
    modelMsTotal += performance.now() - tModel0;

    const convHdr = res.headers.get('x-uniwork-ai-conversation');
    if (convHdr) conversationId = convHdr;
    const runHdr = res.headers.get('x-uniwork-ai-run');
    if (runHdr) runId = runHdr;

    if (!res.ok) {
      throw new Error(
        `Case ${caseDoc.id} step ${step} HTTP ${res.status}: ${rawText.slice(0, 300)}`,
      );
    }

    const parsed = parseUniworkFacadeResponse(rawText);
    if (parsed.model) resolvedModel = parsed.model;
    if (parsed.xUniwork?.dropped_tool_calls?.length) {
      droppedCalls.push(...parsed.xUniwork.dropped_tool_calls);
    }

    if (!parsed.toolCalls || parsed.toolCalls.length === 0) {
      finalAnswer = parsed.content;
      break;
    }

    // Execute tool calls locally using the fork-equivalent tool executor
    const toolResultMessages = [];
    let askedClarification = false;
    for (const tc of parsed.toolCalls) {
      const fnName = tc.function?.name ?? '';
      const fnArgs = tc.function?.arguments ?? '{}';
      const tTool0 = performance.now();
      const out = executor.execute(fnName, fnArgs);
      toolMsTotal += performance.now() - tTool0;

      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(fnArgs);
      } catch {
        parsedArgs = {};
      }
      recordedToolCalls.push({
        name: fnName,
        input: parsedArgs,
        output: out,
      });

      if (fnName === 'ask_clarification') {
        askedClarification = true;
        const qText = (parsedArgs.questions ?? [])
          .map((q) => `${q.label}: ${(q.options ?? []).join(' / ')}`)
          .join('; ');
        finalAnswer = parsed.content ? `${parsed.content}\n${qText}` : qText;
      }

      toolResultMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(out),
      });
    }

    if (askedClarification) {
      break;
    }
    nextMessages = toolResultMessages;
  }
  const endToEndMs = performance.now() - e2eStart;

  const usageRow = queryLatestUsageRow(dbUrl, orgId);
  if (usageRow?.promptId) promptId = usageRow.promptId;
  if (usageRow?.model) resolvedModel = usageRow.model;

  const runResult = {
    answerText: finalAnswer,
    toolCalls: recordedToolCalls,
    mutatedBlocks: executor.getMutatedBlocks(),
    writes: executor.getWrites(),
  };
  const scored = scoreDevCase(caseDoc, runResult);
  const outsideAllowlist = [
    ...recordedToolCalls
      .map((c) => c.name)
      .filter((n) => !caseDoc.allowedTools.includes(n)),
    ...droppedCalls.map((d) => d.name),
  ];

  return {
    id: caseDoc.id,
    pairId: caseDoc.pairId,
    lang: caseDoc.lang,
    format: caseDoc.format,
    category: caseDoc.category,
    promptId: promptId || 'office_uniwork_ai@1',
    resolvedModel: resolvedModel || 'unknown',
    passed: scored.passed && outsideAllowlist.length === 0,
    score: scored.score,
    checks: scored.checks,
    toolCalls: recordedToolCalls.map((c) => c.name),
    outsideAllowlist,
    writes: executor.getWrites(),
    latenciesMs: {
      model: Number(modelMsTotal.toFixed(1)),
      tool: Number(toolMsTotal.toFixed(1)),
      endToEnd: Number(endToEndMs.toFixed(1)),
    },
    answerExcerpt: finalAnswer.slice(0, 400),
  };
}

// ---- Real Panel UI End-to-End Verification via Playwright + Fork Vite Frame ----

// The dev case each panel combination runs (BE68-3): the harness types the
// case's own prompt into the panel and the reply is scored with scoreDevCase,
// so an unusable panel cannot pass as a green panel proof. The runner refuses
// to write a summary unless all four combinations ran and reached the façade
// with a bearer frame token.
const PANEL_CASE_SPECS = [
  { caseId: 'DV-DOCX-001', module: 'docs', lang: 'vi', selectedBlockIndex: 4 },
  { caseId: 'DV-DOCX-002', module: 'docs', lang: 'en', selectedBlockIndex: 4 },
  { caseId: 'DV-XLSX-001', module: 'sheets', lang: 'vi' },
  { caseId: 'DV-XLSX-002', module: 'sheets', lang: 'en' },
];

// The write tool calls of the docs/sheets registries: what the façade executor
// counts as a write, an apply_ops dry run included as a non-write here too.
const PANEL_WRITE_TOOLS = new Set(['replace_selection', 'replace_blocks', 'apply_ops', 'propose_operations']);

function parseToolInput(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw ?? '{}'));
  } catch {
    return {};
  }
}

// panelWrites counts write tool calls the way the façade executor counts a
// write result: an apply_ops dry run mutates nothing.
function panelWrites(toolCalls) {
  return toolCalls.filter(
    (c) => PANEL_WRITE_TOOLS.has(c.name) && !(c.name === 'apply_ops' && c.input?.dryRun === true),
  ).length;
}

// Snapshot of <frameDir>/node_modules/@genoffice on the filesystem (BE68-G2-5):
// git status cannot see changes inside gitignored node_modules, so we record
// the directory entries and symlink targets directly on disk and assert they
// do not change when the panel harness builds or runs.
export function snapshotGenofficeDir(frameDir) {
  const forkGenDir = path.join(frameDir, 'node_modules', '@genoffice');
  if (!fs.existsSync(forkGenDir)) return [];
  return fs
    .readdirSync(forkGenDir)
    .sort()
    .map((name) => {
      const full = path.join(forkGenDir, name);
      const st = fs.lstatSync(full);
      return {
        name,
        isSymbolicLink: st.isSymbolicLink(),
        target: st.isSymbolicLink() ? fs.readlinkSync(full) : null,
        ino: st.ino,
      };
    });
}

export function assertPanelHarnessFilesystem(frameDir, harnessDir, beforeSnapshot) {
  const absFrame = path.resolve(frameDir);
  const absHarness = path.resolve(harnessDir);
  const harnessModules = path.join(absHarness, 'node_modules');
  const genDir = path.join(harnessModules, '@genoffice');

  const afterSnapshot = snapshotGenofficeDir(absFrame);
  if (JSON.stringify(afterSnapshot) !== JSON.stringify(beforeSnapshot)) {
    throw new Error(
      `fork node_modules/@genoffice was modified by panel harness: before=${JSON.stringify(beforeSnapshot)}, after=${JSON.stringify(afterSnapshot)}`,
    );
  }

  if (!fs.existsSync(genDir)) {
    throw new Error(`missing harness @genoffice directory ${genDir}`);
  }
  const genEntries = fs.readdirSync(genDir).sort();
  if (genEntries.length === 0) {
    throw new Error(`expected @genoffice links inside ${genDir}, found none`);
  }
  for (const name of genEntries) {
    const linkPath = path.join(genDir, name);
    if (!linkPath.startsWith(absHarness + path.sep)) {
      throw new Error(`harness link ${linkPath} is outside ${absHarness}`);
    }
    const st = fs.lstatSync(linkPath);
    if (!st.isSymbolicLink()) {
      throw new Error(`expected ${linkPath} to be a symlink`);
    }
    const resolvedTarget = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
    if (!resolvedTarget.startsWith(absFrame + path.sep)) {
      throw new Error(`harness @genoffice/${name} target ${resolvedTarget} is outside ${absFrame}`);
    }
  }

  for (const name of fs.readdirSync(harnessModules).sort()) {
    if (name === '@genoffice') continue;
    const linkPath = path.join(harnessModules, name);
    if (!linkPath.startsWith(absHarness + path.sep)) {
      throw new Error(`harness module link ${linkPath} is outside ${absHarness}`);
    }
    const st = fs.lstatSync(linkPath);
    if (!st.isSymbolicLink()) {
      throw new Error(`expected ${linkPath} to be a symlink`);
    }
    const resolvedTarget = path.resolve(path.dirname(linkPath), fs.readlinkSync(linkPath));
    if (!resolvedTarget.startsWith(path.join(absFrame, 'node_modules') + path.sep)) {
      throw new Error(`harness node_modules/${name} target ${resolvedTarget} is outside ${absFrame}/node_modules`);
    }
  }
  return { genEntries, forkGenSnapshot: afterSnapshot };
}

// BE68-12 / BE68-G2-5: the fork checkout is read-only. Every link the harness
// needs is built inside the harness directory (its own node_modules, with
// @genoffice pointing at the fork's packages and apps); frameDir/node_modules
// is only read, never rewritten, and assertPanelHarnessFilesystem verifies on
// the filesystem that all links live inside harnessDir and
// <frameDir>/node_modules/@genoffice is unchanged.
export function setupPanelHarnessLinks(frameDir, harnessDir) {
  const beforeSnapshot = snapshotGenofficeDir(frameDir);
  const harnessModules = path.join(harnessDir, 'node_modules');
  fs.mkdirSync(harnessModules, { recursive: true });
  const genDir = path.join(harnessModules, '@genoffice');
  fs.mkdirSync(genDir, { recursive: true });
  for (const group of ['packages', 'apps']) {
    for (const name of fs.readdirSync(path.join(frameDir, group))) {
      const p = path.join(frameDir, group, name);
      if (fs.statSync(p).isDirectory()) {
        fs.symlinkSync(p, path.join(genDir, name));
      }
    }
  }
  for (const name of fs.readdirSync(path.join(frameDir, 'node_modules'))) {
    if (name === '@genoffice') continue;
    fs.symlinkSync(
      path.join(frameDir, 'node_modules', name),
      path.join(harnessModules, name),
    );
  }
  const verified = assertPanelHarnessFilesystem(frameDir, harnessDir, beforeSnapshot);
  return { beforeSnapshot, ...verified };
}

async function proveRealPanelEndToEnd({
  frameDir,
  serverUrl,
  cases,
  xlsxMount,
  docxMount,
  docxOracle,
  // Debug aid: run only the first N combinations (0 = all four). The measured
  // runs use all four; the assert below counts whatever was asked for.
  panelLimit = 0,
}) {
  const panelSpecs = panelLimit > 0 ? PANEL_CASE_SPECS.slice(0, panelLimit) : PANEL_CASE_SPECS;
  const viteBin = path.join(frameDir, 'node_modules/vite/bin/vite.js');
  if (!fs.existsSync(viteBin)) {
    throw new Error(`Missing ${viteBin} in fork worktree ${frameDir}`);
  }

  const harnessDir = '/tmp/g608-panel-harness';
  fs.rmSync(harnessDir, { recursive: true, force: true });
  fs.mkdirSync(harnessDir, { recursive: true });

  const { beforeSnapshot } = setupPanelHarnessLinks(frameDir, harnessDir);

  const vitePort = 15173;
  const proxyPort = 15180;
  const nodeStubsPath = path.join(frameDir, 'web/modules/sheets/engine/node-stubs.ts');

  fs.writeFileSync(
    path.join(harnessDir, 'vite.config.mjs'),
    `import react from '@vitejs/plugin-react';
export default {
  root: ${JSON.stringify(harnessDir)},
  plugins: [react()],
  cacheDir: ${JSON.stringify(path.join(harnessDir, '.vite-cache'))},
  server: { port: ${vitePort}, strictPort: true, host: ${JSON.stringify(LOOPBACK_HOST)}, fs: { strict: false } },
  resolve: {
    preserveSymlinks: false,
    alias: [
      { find: /^node:(crypto|fs|fs\\/promises|os|path)$/, replacement: ${JSON.stringify(nodeStubsPath)} },
    ],
  },
};
`,
  );

  fs.writeFileSync(
    path.join(harnessDir, 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8"><title>G6-08 Panel</title></head><body><div id="status">booting</div><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>`,
  );

  fs.writeFileSync(
    path.join(harnessDir, 'entry.tsx'),
    `import { createRoot } from 'react-dom/client';
import { useRef, useState } from 'react';
import { Editor } from '@tiptap/core';

const F = ${JSON.stringify(frameDir)};
const xlsxMount = ${JSON.stringify(xlsxMount)};
const docxMount = ${JSON.stringify(docxMount)};
const docxOracle = ${JSON.stringify(docxOracle)};
const grids = ${JSON.stringify({ sheet1: DEVSET_SHEET1_GRID, sheet2: DEVSET_SHEET2_GRID })};

const q = new URLSearchParams(location.search);
const mod = (q.get('module') ?? 'docs') as 'docs' | 'sheets';
const lang = (q.get('lang') ?? 'vi') as 'vi' | 'en';
const selIndex = Number(q.get('sel') ?? '-1');
document.documentElement.setAttribute('data-theme', 'light');
document.documentElement.lang = lang;

// The sheets skill executes the model's tool calls against the same fixture
// grids the façade runner reads: one fixture, two paths (BE68-3).
function sheetsTools() {
  const grid1 = (grids as any).sheet1;
  const grid2 = (grids as any).sheet2;
  const resolve = (sheetId: unknown) => {
    const s = String(sheetId ?? '').toLowerCase();
    if (s.includes('2') || s.includes('kiem') || s.includes('kiểm')) return grid2;
    return grid1;
  };
  const defs = [
    {
      name: 'get_workbook_context',
      description: 'Get a workbook overview: all sheets (id/name/data extent), active sheet and selection.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      run: () => ({
        activeSheetId: grid1.sheetId,
        activeSheetName: grid1.sheetName,
        selection: { sheet: grid1.sheetName, range: grid1.dimension },
        sheets: [
          { id: grid1.sheetId, name: grid1.sheetName, dataRange: grid1.dimension, hiddenRows: grid1.hiddenRows, totalsRows: (grid1.totalsRows ?? []).map((r: any) => r.row), autoFilter: grid1.autoFilter },
          { id: grid2.sheetId, name: grid2.sheetName, dataRange: grid2.dimension, hiddenRows: grid2.hiddenRows },
        ],
      }),
    },
    {
      name: 'read_range',
      description: 'Read current values/formulas by rectangular range, with row numbers and column letters.',
      inputSchema: { type: 'object', properties: { range: { type: 'string' }, sheetId: { type: 'string' } }, required: ['range'] },
      run: (args: any) => resolve(args.sheetId),
    },
    {
      name: 'read_cells',
      description: 'Read current values/formulas/provenance of specific scattered cells.',
      inputSchema: { type: 'object', properties: { addresses: { type: 'array', items: { type: 'string' } }, sheetId: { type: 'string' } }, required: ['addresses'] },
      run: (args: any) => resolve(args.sheetId),
    },
    {
      name: 'read_formats',
      description: 'Read number formats and cell types over a range.',
      inputSchema: { type: 'object', properties: { range: { type: 'string' }, sheetId: { type: 'string' } }, required: ['range'] },
      run: (args: any) => resolve(args.sheetId),
    },
    {
      name: 'read_sheet_features',
      description: 'Read worksheet AutoFilter, hidden rows, totals rows and protection state.',
      inputSchema: { type: 'object', properties: { sheetId: { type: 'string' } }, required: [] },
      run: (args: any) => {
        const t = resolve(args.sheetId);
        return { sheetId: t.sheetId, sheetName: t.sheetName, hiddenRows: t.hiddenRows, autoFilter: t.autoFilter ?? null, totalsRows: t.totalsRows ?? [], protected: false };
      },
    },
    {
      name: 'aggregate_range',
      description: 'Compute non-empty count, numeric sum/average/min/max over a range, optionally skipping hidden rows.',
      inputSchema: { type: 'object', properties: { range: { type: 'string' }, sheetId: { type: 'string' }, skipHiddenRows: { type: 'boolean' } }, required: ['range'] },
      run: (args: any) => {
        const t = resolve(args.sheetId);
        return { sheetId: t.sheetId, sheetName: t.sheetName, range: args.range ?? t.dimension, skipHiddenRows: Boolean(args.skipHiddenRows), summary: t.computedSummary, rows: t.rows };
      },
    },
    {
      name: 'summarize_range',
      description: 'Read-only conditional statistics over a table range, grouped or filtered, skipping total/subtotal rows.',
      inputSchema: { type: 'object', properties: { range: { type: 'string' }, sheetId: { type: 'string' }, function: { type: 'string' }, valueColumn: { type: 'string' }, groupByColumn: { type: 'string' }, skipHiddenRows: { type: 'boolean' } }, required: ['range'] },
      run: (args: any) => {
        const t = resolve(args.sheetId);
        return { sheetId: t.sheetId, sheetName: t.sheetName, range: args.range ?? t.dimension, summary: t.computedSummary, rows: t.rows };
      },
    },
    {
      name: 'find_cells',
      description: 'Search the workbook or one sheet for cells matching a query or errors_only=true.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, errors_only: { type: 'boolean' }, sheetId: { type: 'string' } }, required: [] },
      run: () => ({ sheet1Errors: grid1.computedSummary.columnHUnitAfterDiscount, sheet2Formulas: grid2.rows }),
    },
    {
      name: 'ask_clarification',
      description: 'Ask the user up to 4 short multiple-choice clarification questions before computing or editing.',
      inputSchema: { type: 'object', properties: { questions: { type: 'array', items: { type: 'object' } } }, required: ['questions'] },
      run: (args: any) => ({ status: 'clarification_requested', questions: args.questions ?? [] }),
    },
  ];
  return defs;
}

function sheetsSkill() {
  const defs = sheetsTools();
  return {
    id: 'sheets-devset',
    systemPrompt: 'Spreadsheet assistant. Use the listed tools for every reading; never invent numbers.',
    tools: defs.map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema })),
    executeTool: async (call: any) => {
      const def = defs.find((d) => d.name === call.name);
      if (!def) return { output: 'Unknown tool: ' + call.name, isError: true, summary: call.name };
      try {
        return { output: JSON.stringify(def.run(call.input ?? {})), summary: call.name };
      } catch (err: any) {
        return { output: String(err?.message ?? err), isError: true, summary: call.name };
      }
    },
  } as any;
}

async function main() {
  const { createWebAi, withWebAi } = await import(/* @vite-ignore */ F + '/web/modules/shared/ai/web-ai.ts');
  const aiBrowser = await import('@genoffice/ai-provider/browser');
  const { AgentLoop } = await import('@genoffice/agent-core');
  await import('@genoffice/ui/tokens.css');
  await import('@genoffice/ui/ai-model-picker.css');
  await import('@genoffice/ui/ai-panel-prefs.css');
  await import('@genoffice/ui/ai-scope-quote.css');
  await import('@genoffice/ui/markdown.css');
  await import('@genoffice/ui/dropdown.css');

  const mount = mod === 'sheets' ? xlsxMount : docxMount;
  const webAi = createWebAi({
    port: {
      whenInitialized: () => Promise.resolve({
        protocolVersion: 1,
        token: mount.frameToken,
        tokenExpiresAt: Date.now() + 3600000,
        documentId: mount.docId,
        workspaceId: 'ws-g608',
        apiBase: location.origin + '/api/v1',
        apiMode: 'host-proxy',
        locale: lang,
        theme: 'light',
        module: mod,
        capabilities: { ai: true, uniworkAi: true, save: true, saveAs: true },
      } as any),
      getToken: () => mount.frameToken,
      refreshToken: async () => mount.frameToken,
    },
    capabilities: { ai: true, uniworkAi: true },
    module: mod,
  });
  await webAi.active();
  if (typeof aiBrowser.setUniworkAiAvailable === 'function') {
    aiBrowser.setUniworkAiAvailable(true);
  }
  webAi.choose('uniwork');
  const aiMembers = withWebAi({}, webAi);
  (window as any).uniworkAiFlag = { get: async () => true, onChange: () => () => {} };
  if (typeof aiBrowser.mirrorUniworkAiFlag === 'function') {
    aiBrowser.mirrorUniworkAiFlag();
  }

  const proxyApi = new Proxy(
    {
      ...aiMembers,
      onLanguageChanged: () => () => {},
      capabilities: { platform: 'web', ai: true, uniworkAi: true },
    } as any,
    {
      get(t, k) {
        if (k in t) return t[k];
        if (typeof k !== 'string') return undefined;
        if (/^on[A-Z]/.test(k)) return () => () => {};
        return async () => ({});
      },
    },
  );
  (window as any).desktop = proxyApi;
  (window as any).desktopApi = proxyApi;

  const rootEl = document.getElementById('root')!;
  const statusEl = document.getElementById('status')!;

  if (mod === 'docs') {
    await import(/* @vite-ignore */ F + '/apps/docs/src/renderer/styles.css');
    const { editorExtensions } = await import(/* @vite-ignore */ F + '/apps/docs/src/renderer/editor/extensions');
    const { AiPanel } = await import(/* @vite-ignore */ F + '/apps/docs/src/renderer/ai/AiPanel');
    const { LocaleProvider, setModuleLang } = await import(/* @vite-ignore */ F + '/apps/docs/src/renderer/i18n/locale');
    setModuleLang(lang);
    const settings = await webAi.settings();
    const blocks = (docxOracle.blocks ?? []).map((b: any) => ({
      index: b.index,
      type: b.style && b.style.startsWith('Heading') ? 'heading' : 'paragraph',
      text: b.text,
      style: b.style,
    }));
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: {
        type: 'doc',
        content: (docxOracle.blocks ?? []).map((b: any) => ({
          type: 'docParagraph',
          attrs: { docxIndex: b.index },
          content: [{ type: 'text', text: b.text }],
        })),
      },
    });
    // The case's selected paragraph: the panel reads the selection from the
    // live editor, so the harness selects it before the run (BE68-3).
    if (selIndex >= 0 && selIndex < editor.state.doc.childCount) {
      let from = 0;
      editor.state.doc.forEach((node: any, offset: number, index: number) => {
        if (index === selIndex) from = offset;
      });
      const node = editor.state.doc.child(selIndex);
      editor.commands.setTextSelection({ from: from + 1, to: from + node.nodeSize - 1 });
    }
    (window as any).__devsetEditor = editor;
    createRoot(rootEl).render(
      <LocaleProvider initial={lang}>
        <div className="ai-dock" style={{ width: '400px', height: '760px' }}>
          <AiPanel editor={editor} blocks={blocks} settings={settings as any} open filePath="/docs/dev-docx-proposal-vi.docx" />
        </div>
      </LocaleProvider>,
    );
    statusEl.textContent = 'initialised';
  } else {
    await import(/* @vite-ignore */ F + '/apps/sheets/src/renderer/styles.css');
    const { AiChatPanel } = await import(/* @vite-ignore */ F + '/apps/sheets/src/renderer/ai/AiChatPanel');
    const { createElectronTransport } = await import(/* @vite-ignore */ F + '/apps/sheets/src/renderer/ai/transport');
    const { LocaleProvider, setModuleLang } = await import(/* @vite-ignore */ F + '/apps/sheets/src/renderer/i18n/locale');
    setModuleLang(lang);
    const settings = await webAi.settings();
    const transport = createElectronTransport(() => settings as any);
    const skill = sheetsSkill();

    function SheetsHost() {
      const [chat, setChat] = useState<any[]>([]);
      const [prompt, setPrompt] = useState('');
      const [busy, setBusy] = useState(false);
      const promptRef = useRef('');
      promptRef.current = prompt;

      const handleSend = () => {
        const qText = promptRef.current.trim();
        if (!qText || busy) return;
        setPrompt('');
        setBusy(true);
        setChat((prev) => [
          ...prev,
          { role: 'user', text: qText, tools: [] },
          { role: 'assistant', text: '', tools: [], streaming: true },
        ]);
        const loop = new AgentLoop({
          transport,
          skill,
          events: {
            onText(text: string) {
              setChat((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { ...copy[copy.length - 1], text };
                return copy;
              });
            },
            onDone(res: any) {
              setChat((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = {
                  ...copy[copy.length - 1],
                  text: res.text || copy[copy.length - 1].text,
                  streaming: false,
                };
                return copy;
              });
              setBusy(false);
            },
            onError(err: string) {
              setChat((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = {
                  ...copy[copy.length - 1],
                  text: 'Error: ' + err,
                  streaming: false,
                };
                return copy;
              });
              setBusy(false);
            },
          },
        });
        void loop.run(qText);
      };

      return (
        <LocaleProvider initial={lang}>
          <div style={{ display: 'flex', width: '420px', height: '760px' }}>
            <AiChatPanel
              isOpen
              hasContent
              chat={chat}
              attachments={[]}
              attachNotice={null}
              onPickAttachments={() => {}}
              onAddAttachmentPaths={() => {}}
              onAddPastedImage={() => {}}
              onRemoveAttachment={() => {}}
              prompt={prompt}
              preview={null}
              aiBusy={busy}
              onPromptChange={(v: string) => {
                promptRef.current = v;
                setPrompt(v);
              }}
              onSend={handleSend}
              onStop={() => {}}
              onNewChat={() => setChat([])}
              onUndo={() => {}}
              scopeRange={null}
              scopeColumns={null}
              scopeLocked={false}
              onScopeDismiss={() => {}}
              onCitation={() => {}}
              onExpand={() => {}}
              onCollapse={() => {}}
            />
          </div>
        </LocaleProvider>
      );
    }

    createRoot(rootEl).render(<SheetsHost />);
    statusEl.textContent = 'initialised';
  }
}

main().catch((err) => {
  const statusEl = document.getElementById('status');
  if (statusEl) statusEl.textContent = 'error: ' + String(err?.message ?? err);
  console.error(err);
});
`,
  );

  const viteProc = spawn(
    process.execPath,
    [viteBin, '--config', path.join(harnessDir, 'vite.config.mjs')],
    {
      cwd: harnessDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const waitPort = async (port, timeoutMs = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        const r = await fetch(`${localHttpOrigin(port)}/`);
        if (r.status < 500) return;
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Vite on :${port} did not start within ${timeoutMs}ms`);
  };

  const proxyRequests = [];
  let proxyServer = null;

  try {
    await waitPort(vitePort);

    proxyServer = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', localHttpOrigin(proxyPort));
        if (url.pathname.startsWith('/api/v1/')) {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const bodyBuf = Buffer.concat(chunks);
          const t0 = performance.now();
          const upstreamRes = await fetch(`${serverUrl}${url.pathname}${url.search}`, {
            method: req.method,
            headers: {
              ...(req.headers['content-type']
                ? { 'Content-Type': req.headers['content-type'] }
                : {}),
              ...(req.headers.authorization
                ? { Authorization: req.headers.authorization }
                : {}),
              ...(req.headers['x-uniwork-ai-conversation']
                ? { 'X-UniWork-AI-Conversation': req.headers['x-uniwork-ai-conversation'] }
                : {}),
              ...(req.headers['x-uniwork-ai-run']
                ? { 'X-UniWork-AI-Run': req.headers['x-uniwork-ai-run'] }
                : {}),
            },
            body:
              req.method !== 'GET' && req.method !== 'HEAD' ? bodyBuf : undefined,
          });
          const respBuf = Buffer.from(await upstreamRes.arrayBuffer());
          const elapsedMs = Number((performance.now() - t0).toFixed(1));
          // The streamed body is the panel's actual model answer: the tool
          // calls and the final text are read back from it for scoring.
          const record = {
            method: req.method,
            path: url.pathname,
            status: upstreamRes.status,
            elapsedMs,
            hasAuthBearer: /^Bearer\s+\S+/.test(String(req.headers.authorization ?? '')),
            conversationHeader:
              upstreamRes.headers.get('x-uniwork-ai-conversation') ?? '',
            runHeader: upstreamRes.headers.get('x-uniwork-ai-run') ?? '',
            content: '',
            toolCalls: [],
          };
          if (url.pathname.endsWith('/ai/uniwork/chat/completions')) {
            try {
              const parsed = parseUniworkFacadeResponse(respBuf.toString('utf8'));
              record.content = parsed.content;
              record.toolCalls = (parsed.toolCalls ?? []).map((tc) => ({
                name: tc.function?.name ?? '',
                input: parseToolInput(tc.function?.arguments),
              }));
            } catch {
              // a body this parser cannot read leaves content/toolCalls empty
            }
          }
          proxyRequests.push(record);
          const outHeaders = { 'Cache-Control': 'no-store' };
          for (const h of [
            'content-type',
            'x-uniwork-ai-conversation',
            'x-uniwork-ai-run',
          ]) {
            const v = upstreamRes.headers.get(h);
            if (v) outHeaders[h] = v;
          }
          res.writeHead(upstreamRes.status, outHeaders);
          res.end(respBuf);
          return;
        }

        const vRes = await fetch(`${localHttpOrigin(vitePort)}${url.pathname}${url.search}`);
        const buf = Buffer.from(await vRes.arrayBuffer());
        const ct = vRes.headers.get('content-type') ?? 'application/octet-stream';
        res.writeHead(vRes.status, { 'Content-Type': ct });
        res.end(buf);
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(String(err?.message ?? err));
      }
    });

    await new Promise((resolve) => proxyServer.listen(proxyPort, LOOPBACK_HOST, resolve));

    const { createRequire } = await import('node:module');
    const reqFromFrame = createRequire(path.join(frameDir, 'package.json'));
    const { chromium } = reqFromFrame('playwright');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const panelProofs = [];
    try {
      for (const spec of panelSpecs) {
        const caseDoc = cases.find((c) => c.id === spec.caseId);
        if (!caseDoc) {
          throw new Error(`dev set has no case ${spec.caseId} for the panel run`);
        }
        const page = await browser.newPage();
        const diagnostics = [];
        let loads = 0;
        page.on('load', () => {
          loads += 1;
        });
        page.on('pageerror', (err) => diagnostics.push(`pageerror: ${err}`));
        page.on('console', (msg) => {
          if (msg.type() === 'error') diagnostics.push(`console: ${msg.text()}`);
        });
        // The frame's host bridge opens a WebSocket at the proxy origin. The
        // harness has no realtime host behind the proxy, and a refused
        // handshake makes the frame tear its session down mid-run, so the
        // socket is answered with an inert one instead.
        await page.routeWebSocket(/\/\?token=/, () => {});
        const beforeCount = proxyRequests.length;
        const t0 = performance.now();
        const sel = spec.selectedBlockIndex === undefined ? '' : `&sel=${spec.selectedBlockIndex}`;
        const panelUrl = `${localHttpOrigin(proxyPort)}/index.html?module=${spec.module}&lang=${spec.lang}${sel}`;
        // A vite dev server can fail the first dynamic import while it is still
        // transforming modules, and the panel renders after its own session
        // handshake: the boot is retried until the composer itself is there.
        let booted = false;
        let statusText = '';
        for (let attempt = 1; attempt <= 3 && !booted; attempt++) {
          await page.goto(panelUrl, { waitUntil: 'domcontentloaded' });
          const settled = await page
            .waitForFunction(
              () => {
                const t = document.getElementById('status')?.textContent ?? '';
                const hasComposer = Boolean(document.querySelector('.ai-input-box textarea'));
                return (t === 'initialised' && hasComposer) || t.startsWith('error:');
              },
              null,
              { timeout: 45000 },
            )
            .then(() => true)
            .catch(() => false);
          statusText = await page.locator('#status').innerText().catch(() => '<no status>');
          if (settled && !statusText.startsWith('error:')) {
            booted = true;
            break;
          }
          diagnostics.push(`boot attempt ${attempt}: ${statusText.slice(0, 200)}`);
          await page.waitForTimeout(3000);
        }

        try {
          if (!booted) {
            throw new Error(`panel boot did not reach the composer: ${statusText.slice(0, 200)}`);
          }
          const box = page.locator('.ai-input-box textarea').first();
          await box.waitFor({ state: 'visible', timeout: 30000 });
          await box.fill(caseDoc.prompt);
          await box.press('Enter');
          // The composer mounts before the AI session may be ready, and Enter on
          // an unready composer is a no-op: the send has to show up as a message
          // entry, and when it does not, the send button is pressed (same
          // handler) before the run is called a failure.
          const sent = await page
            .waitForSelector('.ai-msg', { timeout: 15000 })
            .then(() => true)
            .catch(() => false);
          if (!sent) {
            diagnostics.push('Enter produced no message entry; pressing the send button');
            const sendBtn = page.locator('button.ai-send-btn').first();
            await sendBtn.click({ timeout: 10000 }).catch((err) => {
              diagnostics.push(`send button not clickable: ${err?.message ?? err}`);
            });
            const sentNow = await page
              .waitForSelector('.ai-msg', { timeout: 15000 })
              .then(() => true)
              .catch(() => false);
            if (!sentNow) {
              throw new Error('the panel accepted no send: neither Enter nor the send button produced a message entry');
            }
          }

          await page.waitForFunction(
            () => {
              const msgs = document.querySelectorAll('.ai-msg-assistant');
              if (!msgs || msgs.length === 0) return false;
              const last = msgs[msgs.length - 1];
              if (last.classList.contains('ai-msg-streaming')) return false;
              const txt = (last.textContent ?? '').trim();
              return txt.length > 0;
            },
            null,
            { timeout: 240000 },
          );
        } catch (err) {
          // A panel that never answers is the failure this proof exists for:
          // report what the page showed and what the proxy saw, so the run
          // log explains it without a second reproduction.
          const chatState = await page
            .evaluate(() => {
              const nodes = Array.from(document.querySelectorAll('[class*="ai-msg"]'));
              const lines = nodes
                .slice(-6)
                .map((el) => `${el.className}#${(el.textContent ?? '').length}`);
              const dock = document.querySelector('.ai-dock');
              const ta = document.querySelector('.ai-input-box textarea');
              const btn = document.querySelector('button.ai-send-btn');
              return `${lines.join(' | ') || 'no ai-msg element'}\ntextarea.value=${(ta?.value ?? '').length} chars, send.disabled=${btn?.disabled ?? 'n/a'}\n${(dock?.innerText ?? '').slice(-600)}`;
            })
            .catch(() => '<no chat state>');
          const seen = proxyRequests.slice(beforeCount);
          throw new Error(
            `panel run ${spec.caseId} (${spec.module}/${spec.lang}) produced no assistant answer: ${err?.message ?? err}\n` +
              `facade calls: ${seen.filter((r) => r.path.endsWith('/ai/uniwork/chat/completions')).length} of ${seen.length} proxied requests\n` +
              `chat state: ${chatState}\nloads: ${loads}\n` +
              `diagnostics: ${diagnostics.slice(0, 8).join(' | ') || 'none'}`,
          );
        }
        const replyText = await page
          .locator('.ai-msg-assistant')
          .last()
          .innerText();
        const e2eMs = Number((performance.now() - t0).toFixed(1));
        const calls = proxyRequests
          .slice(beforeCount)
          .filter((r) => r.path.endsWith('/ai/uniwork/chat/completions'));
        const toolCalls = calls.flatMap((c) => c.toolCalls);
        const answerText =
          calls.map((c) => c.content).filter(Boolean).join('\n') || replyText.trim();
        const editorBlocks = await page.evaluate(() => {
          const ed = window.__devsetEditor;
          if (!ed) return null;
          const json = ed.getJSON();
          return (json.content ?? []).map((n, i) => ({
            index: n.attrs?.docxIndex ?? i,
            text: (n.content ?? []).map((t) => t.text ?? '').join(''),
          }));
        });
        const writes = panelWrites(toolCalls);
        const outsideAllowlist = toolCalls
          .map((c) => c.name)
          .filter((n) => !caseDoc.allowedTools.includes(n));
        const scored = scoreDevCase(caseDoc, {
          answerText,
          toolCalls,
          mutatedBlocks: editorBlocks ?? [],
          writes,
        });
        panelProofs.push({
          caseId: spec.caseId,
          module: spec.module,
          lang: spec.lang,
          prompt: caseDoc.prompt,
          facadeRouteCalled: calls.length > 0,
          facadeCallsCount: calls.length,
          paths: [...new Set(calls.map((c) => c.path))],
          allAuthBearer: calls.length > 0 && calls.every((c) => c.hasAuthBearer),
          toolCalls: toolCalls.map((c) => c.name),
          writes,
          outsideAllowlist,
          editSource:
            spec.module === 'docs'
              ? editorBlocks
                ? 'editor'
                : 'editor-unavailable'
              : 'no-document-mutation',
          score: scored.score,
          passed: scored.passed && outsideAllowlist.length === 0,
          checks: scored.checks,
          endToEndMs: e2eMs,
          answerExcerpt: answerText.trim().slice(0, 400),
        });
        await page.close();
      }
    } finally {
      await browser.close();
    }

    const unreached = panelProofs.filter((p) => !p.facadeRouteCalled || !p.allAuthBearer);
    if (panelProofs.length !== panelSpecs.length || unreached.length > 0) {
      throw new Error(
        `panel proof failed: ${panelProofs.length}/${panelSpecs.length} combinations ran; ` +
          `without a bearer-authenticated façade call: ${unreached.map((p) => p.caseId).join(', ') || 'none'}`,
      );
    }
    assertPanelHarnessFilesystem(frameDir, harnessDir, beforeSnapshot);
    return panelProofs;
  } finally {
    if (proxyServer) {
      await new Promise((r) => proxyServer.close(r));
    }
    viteProc.kill('SIGTERM');
    fs.rmSync(harnessDir, { recursive: true, force: true });
  }
}

// ---- Optional: run the whole measurement against a server built from a SHA ----

// startServerFromSha builds, migrates and starts the D server at one commit in
// a temporary git worktree, so the @1 baseline (4df589a37, the last commit
// before the @2 pack) is reproducible without a new env var (BE68-4). The
// worktree is removed and the process stopped by the returned stop().
async function startServerFromSha(sha, { dbUrl, port }) {
  const dir = path.join('/tmp', `g608-server-${sha.slice(0, 12)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  execFileSync('git', ['worktree', 'add', '--detach', '--force', dir, sha], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverProc = null;
  let logStream = null;
  const remove = () => {
    try {
      execFileSync('git', ['worktree', 'remove', '--force', dir], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      // a worktree that was never added (or already pruned) is not an error
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  const stop = async () => {
    if (serverProc && serverProc.exitCode === null) {
      await new Promise((resolve) => {
        serverProc.once('exit', resolve);
        serverProc.kill('SIGTERM');
        setTimeout(() => {
          try {
            serverProc.kill('SIGKILL');
          } catch {
            // already gone
          }
          resolve();
        }, 10000);
      });
    }
    if (logStream) logStream.end();
    remove();
  };
  try {
    const buildEnv = { ...process.env, GOFLAGS: '-p=1' };
    execFileSync('go', ['build', '-o', path.join(dir, 'bin-server'), './cmd/server'], {
      cwd: path.join(dir, 'server'),
      env: buildEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync('go', ['build', '-o', path.join(dir, 'bin-migrate'), './cmd/migrate'], {
      cwd: path.join(dir, 'server'),
      env: buildEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync(path.join(dir, 'bin-migrate'), ['up'], {
      cwd: path.join(dir, 'server'),
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const logPath = path.join(dir, 'server.log');
    logStream = fs.createWriteStream(logPath);
    serverProc = spawn(path.join(dir, 'bin-server'), [], {
      cwd: path.join(dir, 'server'),
      env: { ...process.env, DATABASE_URL: dbUrl, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stdout.pipe(logStream);
    serverProc.stderr.pipe(logStream);
    const url = localHttpOrigin(port);
    const deadline = Date.now() + 90000;
    for (;;) {
      if (serverProc.exitCode !== null) {
        const tail = fs.existsSync(logPath)
          ? fs.readFileSync(logPath, 'utf8').split('\n').slice(-15).join('\n')
          : '';
        throw new Error(`server @${sha} exited with ${serverProc.exitCode}\n${tail}`);
      }
      try {
        const r = await fetch(`${url}/readyz`);
        if (r.status === 200) break;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) {
        throw new Error(`server @${sha} did not become ready on ${url} within 90s`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    process.stdout.write(`server @${sha} ready on ${url} (log: ${logPath})\n`);
    return { url, logPath, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      'Usage: node scripts/office/devset-run.mjs (--server-url <origin> | --server-sha <commit> --db-url <postgres-url>) ' +
        '[--server-port <port>] [--db-url <postgres-url>] [--frame-dir <path>] [--out <file.json>]\n' +
        '  --server-sha builds, migrates and starts the server at that commit in a temporary worktree\n' +
        '  (the @1 baseline is 4df589a37, the last commit before the office_uniwork_ai@2 pack), then removes it.\n' +
        '  --panel-limit <n> and --panel-only are debugging aids for the panel harness; the measured runs use neither.\n',
    );
    return;
  }

  const getArg = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : '';
  };

  const serverSha = getArg('--server-sha').trim();
  const serverPortArg = Number(getArg('--server-port') || '15200');
  const dbUrl = getArg('--db-url');
  const frameDir = getArg('--frame-dir');
  const outPath = getArg('--out');
  // Debug aid for the panel harness: 0 (default) runs all four combinations.
  const panelLimit = Number(getArg('--panel-limit') || '0');
  // Debug aid: measure only the panel combinations, skip the 20 case runs.
  const panelOnly = args.includes('--panel-only');

  let serverUrl = getArg('--server-url').replace(/\/+$/, '');
  let shaServer = null;
  if (serverSha) {
    if (!dbUrl) {
      throw new Error('--server-sha needs --db-url: the runner migrates and starts the server itself');
    }
    shaServer = await startServerFromSha(serverSha, { dbUrl, port: serverPortArg });
    serverUrl = shaServer.url;
  }
  if (!serverUrl) {
    throw new Error('Missing --server-url (or --server-sha with --db-url)');
  }

  const { cases } = loadDevSet(repoRoot);
  const xlsxOracle = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'docs/office/g5g6g7/devset/fixtures/dev-xlsx-orders-xyz.oracle.json'),
      'utf8',
    ),
  );
  const docxOracle = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'docs/office/g5g6g7/devset/fixtures/dev-docx-proposal-vi.oracle.json'),
      'utf8',
    ),
  );

  try {
    const session = await bootstrapServerTenant(serverUrl, dbUrl);
    const xlsxMount = await uploadFixtureAndMintFrameToken(
      serverUrl,
      session,
      'docs/office/g5g6g7/devset/fixtures/dev-xlsx-orders-xyz.xlsx',
      'dev-xlsx-orders-xyz.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const docxMount = await uploadFixtureAndMintFrameToken(
      serverUrl,
      session,
      'docs/office/g5g6g7/devset/fixtures/dev-docx-proposal-vi.docx',
      'dev-docx-proposal-vi.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    let panelProofs = [];
    if (frameDir) {
      process.stdout.write(`Proving real panel UI end-to-end via Playwright (${frameDir})...\n`);
      panelProofs = await proveRealPanelEndToEnd({
        frameDir,
        serverUrl,
        cases,
        xlsxMount,
        docxMount,
        docxOracle,
        panelLimit,
      });
      process.stdout.write(
        `Panel UI proof complete: ${panelProofs.length} case runs through the panel, ` +
          `${panelProofs.filter((p) => p.passed).length} scored pass.\n`,
      );
    }

    const caseResults = [];
    for (const c of panelOnly ? [] : cases) {
      const docMount = c.format === 'xlsx' ? xlsxMount : docxMount;
      const res = await runCaseOnFacade({
        caseDoc: c,
        serverUrl,
        dbUrl,
        orgId: session.orgId,
        docMount,
        xlsxOracle,
        docxOracle,
      });
      caseResults.push(res);
      process.stdout.write(
        `[${res.id}] (${res.lang}/${res.format}) ${res.passed ? 'PASS' : 'FAIL'} score=${res.score} prompt_id=${res.promptId} model=${res.resolvedModel} tools=[${res.toolCalls.join(',')}] lat(m=${res.latenciesMs.model}ms,t=${res.latenciesMs.tool}ms,e2e=${res.latenciesMs.endToEnd}ms)\n`,
      );
    }

    const summary = summarizeRunResults(caseResults, {
      date: new Date().toISOString().slice(0, 10),
      promptId: caseResults[0]?.promptId ?? 'office_uniwork_ai@1',
      resolvedModel: caseResults[0]?.resolvedModel ?? 'unknown',
      // Which commit the server under test was built from: a --server-sha run
      // names it, so the committed run JSON explains its own baseline (BE68-4/5).
      serverSha: serverSha || 'external-server',
      panelProofs,
    });

    const jsonOut = `${JSON.stringify(summary, null, 2)}\n`;
    const secretHits = scanForSecrets(jsonOut, 'devset-run-output');
    if (secretHits.length > 0) {
      throw new Error(`Refusing to write output with secret-looking values:\n${secretHits.join('\n')}`);
    }

    if (outPath) {
      fs.writeFileSync(outPath, jsonOut, 'utf8');
      process.stdout.write(`Wrote run summary to ${outPath}\n`);
    }
  } finally {
    if (shaServer) await shaServer.stop();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack ?? err}\n`);
    process.exit(1);
  });
}
