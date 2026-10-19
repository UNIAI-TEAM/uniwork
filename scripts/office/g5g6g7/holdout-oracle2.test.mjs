// Scorer, figure and backend fixes of FU-G7-12-ORACLE round 2 (UNI-1874, C7 triage items O2-S1..S4, O2-F1..F3,
// O2-B1..B3). Every case, view and reply here is synthetic: no holdout case text is read or copied.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ANSWER_MARKER, deriveAnswer } from './holdout-answer.mjs';
import { createBackend } from './holdout-backend.mjs';
import { quantitiesOf } from './holdout-figures.mjs';
import { score, validateCase, valuesEqual } from './holdout-score.mjs';

const FX = 'f'.repeat(64);

const mkCase = (over = {}) => {
  const c = {
    id: 'HO-XLSX-970',
    format: 'xlsx',
    category: 'lookup',
    query: { vi: 'Synthetic vi', en: 'Synthetic en' },
    fixtures: [{ id: 'fx-xlsx-synthetic', sha256: FX, version: 'v1' }],
    host: ['web'],
    role: 'editor',
    sourceAnchors: ['SheetZ!A1'],
    tools: { allowed: ['read_sheet_list', 'read_range'], required: ['read_range'] },
    expected: { numeric: [{ name: 'total', value: 25, tolerance: 0, rounding: 'none', unit: 'VND' }], structural: [], writes: 0, mustNotContain: [] },
    oracle: { type: 'deterministic', source: 'synthetic' },
    referenceAnswer: { numeric: { total: 25 }, structural: [], writes: 0, text: 'Synthetic.' },
    ...over,
  };
  assert.deepEqual(validateCase(c), [], `synthetic case ${c.id} must be valid`);
  return c;
};

const line = (over = {}) => `${ANSWER_MARKER} ${JSON.stringify({ numbers: [], items: [], refused: false, not_found: false, caveats: [], ...over })}`;
const readAsk = (tool, module, result, text, report, over = {}) => ({
  reply: `${text}\n${line(report)}`,
  calls: [{ name: tool }],
  writes: 0,
  writeLog: [],
  dropped: [],
  modules: [module],
  sheetNames: [],
  sourceText: '',
  toolResults: [{ name: tool, text: JSON.stringify(result) }],
  ...over,
});
const derived = (c, ask) => deriveAnswer(c, ask);
const verdict = (c, ask) => score(c, derived(c, ask).answer).status;
const extras = (c, ask) => Object.keys(derived(c, ask).answer.numeric).filter((k) => k.startsWith('extra_figure_'));
const checkOf = (c, answer, id) => score(c, answer).checks.find((x) => x.id === id)?.status;

describe('O2-S1: a cell value followed by its formula after a separator is the value', () => {
  it('matches an error value or a number that carries "; formula =" or ", formula:" after it', () => {
    assert.equal(valuesEqual('#DIV/0!', '#DIV/0!; formula =B2/C2', 'cell'), true);
    assert.equal(valuesEqual('#N/A', '#N/A; formula =VLOOKUP(A2,SheetY!$A$2:$C$9,3,FALSE)', 'cell'), true);
    assert.equal(valuesEqual(120, '120, formula: =SUM(A1:A3)', 'cell'), true);
    assert.equal(valuesEqual('#N/A', '#N/A; công thức =B2/C2', 'cell'), true);
  });

  it('keeps a different value failing whatever formula note it carries', () => {
    assert.equal(valuesEqual('#DIV/0!', '#N/A; formula =B2/C2', 'cell'), false);
    assert.equal(valuesEqual(120, '121; formula =SUM(A1:A3)', 'cell'), false);
    assert.equal(valuesEqual('#DIV/0!', 'formula =B2/C2', 'cell'), false, 'a formula alone is no value');
  });

  it('O2R1-03: strips separator formula notes for kind === "cell" only', () => {
    assert.equal(valuesEqual('Approved', 'Approved; formula =B2/C2', 'table_cell'), false, 'P-S1-NONCELL-NO-LOOSEN table_cell');
    assert.equal(valuesEqual('Approved', 'Approved; formula =B2/C2', 'heading'), false, 'P-S1-NONCELL-NO-LOOSEN heading');
    assert.equal(valuesEqual('Approved', 'Approved; formula =B2/C2', null), false, 'P-S1-NONCELL-NO-LOOSEN default kind');
  });
});

describe('O2-S2: an empty cell reported with an empty-cell word', () => {
  it('matches an expected empty cell value', () => {
    for (const word of ['blank', 'Blank', 'empty', '(empty)', 'trống', '(trống)', 'rỗng', '']) {
      assert.equal(valuesEqual('', word, 'cell'), true, word);
    }
  });

  it('never matches a cell that holds a value, and is only an empty-cell reading', () => {
    assert.equal(valuesEqual(10, 'blank', 'cell'), false);
    assert.equal(valuesEqual('Blank', 'empty', 'cell'), false, 'a cell whose text is a word is not empty');
    assert.equal(valuesEqual('', 'blank row', 'cell'), false);
    assert.equal(valuesEqual('', '0', 'cell'), false);
  });
});

describe('O2-S3: a percent cell value written in percent form', () => {
  it('matches a fraction written as a percent or as both forms', () => {
    assert.equal(valuesEqual(0.1, '10%', 'cell'), true);
    assert.equal(valuesEqual(0.25, '25 %', 'cell'), true);
    assert.equal(valuesEqual(0.1, '0.1 (10%)', 'cell'), true);
    assert.equal(valuesEqual(0.1, '10% (0,1)', 'cell'), true);
  });

  it('fails a wrong percent, and a pair whose two forms disagree', () => {
    assert.equal(valuesEqual(0.1, '1%', 'cell'), false);
    assert.equal(valuesEqual(0.1, '0.1 (1%)', 'cell'), false);
    assert.equal(valuesEqual(0.1, '0.2 (10%)', 'cell'), false);
  });
});

describe('O2-S4: a count value written with the counted noun', () => {
  const countCase = mkCase({
    id: 'HO-DOCX-970',
    format: 'docx',
    category: 'structure',
    tools: { allowed: ['read_document'], required: ['read_document'] },
    expected: { numeric: [], structural: [{ kind: 'count', anchor: 'slides', value: 3 }], writes: 0, mustNotContain: [] },
    referenceAnswer: { numeric: {}, structural: [{ kind: 'count', anchor: 'slides', value: 3 }], writes: 0, text: 'x' },
  });
  const answer = (value) => ({ numeric: {}, structural: [{ kind: 'count', anchor: 'Deck', value }], writes: 0, tools: { used: ['read_document'] }, text: 'x' });

  it('reads "3 slide", "3 slides" and "3 follow-up actions" as 3', () => {
    assert.equal(valuesEqual(3, '3 slide', 'count'), true);
    assert.equal(valuesEqual(3, '3 follow-up actions', 'count'), true);
    assert.equal(checkOf(countCase, answer('3 slides'), 'structural:count@slides'), 'pass');
  });

  it('keeps another number, a second figure and a leading word failing', () => {
    assert.equal(valuesEqual(3, '4 slides', 'count'), false);
    assert.equal(valuesEqual(3, '3 of 5 slides', 'count'), false);
    assert.equal(valuesEqual(3, 'level 3 headings', 'count'), false);
    assert.equal(checkOf(countCase, answer('2 slides'), 'structural:count@slides'), 'fail');
  });
});

describe('O2-F1: a space-grouped number never splits a longer digit run', () => {
  it('reads a quarter label and a year as no grouped thousands', () => {
    const raws = quantitiesOf('The report covers Q3 2031 only.', { prose: true }).map((q) => q.raw);
    assert.ok(!raws.includes('3 203'), `no "3 203" in ${JSON.stringify(raws)}`);
    assert.ok(raws.includes('2031'));
  });

  it('still reads a real space-grouped amount', () => {
    assert.deepEqual(quantitiesOf('Total 1 234 567 VND.', { prose: true }).map((q) => q.raw), ['1 234 567 VND']);
  });
});

describe('O2-F2: the literals of a spreadsheet formula quoted in prose are no figures', () => {
  const c = mkCase();
  const result = { sheetName: 'SheetZ', rows: [{ row: 2, cells: { A2: '25 [formula =SUBTOTAL(109,B2:B7)]' } }] };
  const say = (text) => readAsk('read_range', 'sheets', result, text, { numbers: [25] });

  it('exempts the numbers inside a function call and inside a leading "=" expression', () => {
    assert.deepEqual(extras(c, say('A2 is 25, from `=SUBTOTAL(109,B2:B7)`.')), []);
    assert.deepEqual(extras(c, say('A2 is 25 (formula SUBTOTAL(109,B2:B7)).')), []);
    assert.deepEqual(extras(c, say("A2 is 25 via VLOOKUP(A2,'Sheet Y'!$A$2:$G$7,7,FALSE).")), []);
    assert.deepEqual(extras(c, say('A2 is 25 via =B2*(1-0.1).')), []);
    assert.equal(verdict(c, say('A2 is 25, from `=SUBTOTAL(109,B2:B7)`.')), 'pass');
  });

  it('keeps a figure outside the formula a figure, and credits nothing from inside it', () => {
    assert.equal(verdict(c, say('A2 is 25, from `=SUBTOTAL(109,B2:B7)`, about 31 in all.')), 'fail', 'the 31 outside stays untraceable');
    const fromFormula = mkCase({ expected: { numeric: [{ name: 'total', value: 109, tolerance: 0, rounding: 'none', unit: 'VND' }], structural: [], writes: 0, mustNotContain: [] }, referenceAnswer: { numeric: { total: 109 }, structural: [], writes: 0, text: 'x' } });
    assert.equal(verdict(fromFormula, readAsk('read_range', 'sheets', result, 'It is SUBTOTAL(109,B2:B7).', { numbers: [] })), 'fail', 'a formula literal fills no slot');
  });

  it('O2R1-01: masks only the complete "=" formula expression so an adjacent figure after punctuation stays a figure', () => {
    assert.equal(verdict(c, say('A2 is 25 via =B2*(1-0.1),31.')), 'fail', 'P-F2-OUTSIDE-ADJACENT after comma');
    assert.equal(verdict(c, say('A2 is 25 via =B2*(1-0.1);31.')), 'fail', 'P-F2-OUTSIDE-ADJACENT after semicolon');
    assert.equal(verdict(c, say('A2 is 25 (=B2*(1-0.1)):31.')), 'fail', 'P-F2-OUTSIDE-ADJACENT after closing paren');
    assert.equal(verdict(c, say('A2 is 25 via =B2*(1-0.1), 31.')), 'fail', 'P-F2-OUTSIDE-SPACED control');
  });

  it('O2R1-02: masks a bare UPPERCASE(...) span only when its body has formula syntax', () => {
    assert.equal(verdict(c, say('A2 is 25, NOTE(see 31).')), 'fail', 'P-F2-NONFORMULA-CAPS prose inside parentheses');
    assert.equal(verdict(c, say('A2 is 25, TOTAL(31).')), 'fail', 'P-F2-NONFORMULA-CAPS bare number inside parentheses');
    assert.equal(verdict(c, say('A2 is 25, NOTE(A2 is 31).')), 'fail', 'P-F2-NONFORMULA-CAPS cell and prose inside parentheses');
  });
});

describe('O2-F3: a block or row ordinal that a read holds is a location, not a figure', () => {
  const c = mkCase();
  const sheet = { sheetName: 'SheetZ', hiddenRows: [6], rows: [2, 3, 4, 5, 6, 7, 8, 9].map((row) => ({ row, cells: { [`A${row}`]: row === 9 ? '25' : 'x' } })) };
  const sAsk = (text) => readAsk('read_range', 'sheets', sheet, text, { numbers: [25] });
  const docx = mkCase({ id: 'HO-DOCX-971', format: 'docx', tools: { allowed: ['read_document'], required: ['read_document'] } });
  const blocks = { paragraphCount: 6, blocks: [0, 1, 2, 3, 4, 5].map((index) => ({ index, style: 'Normal', preview: index === 2 ? 'Total 25' : 'x' })) };
  const dAsk = (text) => readAsk('get_document_context', 'docs', blocks, text, { numbers: [25] });

  it('exempts row numbers and row ranges the read holds (en and vi)', () => {
    for (const text of [
      'The total is 25 (row 9).',
      'The total is 25; hidden row 6 is included.',
      'The total is 25 over rows 2–7.',
      'Rows 8-9 hold totals; the total is 25.',
      'Tổng là 25, hàng 9.',
      'Tổng là 25, các dòng dữ liệu 2–7; dòng ẩn 6 được tính.',
      'Tổng là 25; dòng tổng `8:9` không đổi.',
    ]) assert.equal(verdict(c, sAsk(text)), 'pass', text);
  });

  it('exempts a block index the read holds, 0-based included', () => {
    assert.equal(verdict(docx, dAsk('The total is 25; the note in block 4 was ignored.')), 'pass');
    assert.equal(verdict(docx, dAsk('The total is 25 (block 0).')), 'pass');
    assert.equal(verdict(docx, dAsk('Tổng là 25 (khối 5).')), 'pass');
  });

  it('fails a row or block no read holds, a plural without a range, and other shapes', () => {
    assert.equal(verdict(c, sAsk('The total is 25 (row 12).')), 'fail');
    assert.equal(verdict(c, sAsk('The total is 25 over rows 2–14.')), 'fail', 'the end of the range is not held');
    assert.equal(verdict(c, sAsk('The total is 25 (rows 9).')), 'fail', 'a plural with one number names a count');
    assert.equal(verdict(c, sAsk('The total is 25 (row 9.5).')), 'fail');
    assert.equal(verdict(docx, dAsk('The total is 25 (block 6).')), 'fail', 'one past the last 0-based index');
    assert.equal(verdict(docx, dAsk('The total is 25 (blocks 3).')), 'fail');
  });

  it('never credits: a row or block ordinal fills no slot and is no operand', () => {
    const nine = mkCase({ expected: { numeric: [{ name: 'total', value: 9, tolerance: 0, rounding: 'none', unit: 'VND' }], structural: [], writes: 0, mustNotContain: [] }, referenceAnswer: { numeric: { total: 9 }, structural: [], writes: 0, text: 'x' } });
    assert.equal(verdict(nine, readAsk('read_range', 'sheets', sheet, 'See row 9.', { numbers: [] })), 'fail');
    assert.equal(verdict(c, readAsk('read_range', 'sheets', { ...sheet, rows: [{ row: 9, cells: { A9: '16' } }] }, 'The total is 25, from 16 and row 9.', { numbers: [25] })), 'fail');
  });
});

describe('O2-B1: read_slide takes the real 0-based slideIndex', () => {
  const pptx = mkCase({ id: 'HO-PPTX-970', format: 'pptx', fixtures: [{ id: 'fx-pptx-synthetic', sha256: FX, version: 'v1' }], tools: { allowed: ['read_slide'], required: ['read_slide'] } });
  const view = () => ({ format: 'pptx', slides: [{ index: 1, texts: ['one'] }, { index: 2, texts: ['two'] }, { index: 3, texts: ['three'] }], titles: [] });

  it('answers slideIndex 0, 1 and 2 with the first, second and third slide', () => {
    const backend = createBackend(pptx, { views: [view()] });
    assert.deepEqual(backend.execute('read_slide', { slideIndex: 0 }).slides.map((s) => s.texts[0]), ['one']);
    assert.deepEqual(backend.execute('read_slide', { slideIndex: 1 }).slides.map((s) => s.texts[0]), ['two']);
    assert.deepEqual(backend.execute('read_slide', { slideIndex: 2 }).slides.map((s) => s.texts[0]), ['three']);
  });

  it('refuses an index past the deck instead of answering another slide', () => {
    const res = createBackend(pptx, { views: [view()] }).execute('read_slide', { slideIndex: 3 });
    assert.equal(res.error, 'invalid_arguments');
  });

  it('O2R1-04: refuses an explicit negative or non-integer slideIndex instead of returning the whole deck', () => {
    const backend = createBackend(pptx, { views: [view()] });
    assert.equal(backend.execute('read_slide', { slideIndex: -1 }).error, 'invalid_arguments', 'P-B1-NEGATIVE');
    assert.equal(backend.execute('read_slide', { slideIndex: 'bad' }).error, 'invalid_arguments', 'P-B1-NAN');
    assert.equal(backend.execute('read_slide', { slideIndex: 1.5 }).error, 'invalid_arguments');
    assert.equal(backend.execute('read_slide', { slideIndex: null }).error, 'invalid_arguments');
  });
});

describe('O2-B2: an overview tool returns truncated previews, as the real frame does', () => {
  const longCell = `| Region | ${'Revenue '.repeat(12)}|`;
  const lines = ['# Title', '', 'Intro paragraph.', '', '| A | B |', '|---|---|', longCell, '| North | 4.321.000 |'];
  const md = mkCase({ id: 'HO-MD-970', format: 'md', fixtures: [{ id: 'fx-md-synthetic', sha256: FX, version: 'v1' }], tools: { allowed: ['read_document', 'read_table'], required: ['read_table'] } });
  const html = mkCase({ id: 'HO-HTML-970', format: 'html', fixtures: [{ id: 'fx-html-synthetic', sha256: FX, version: 'v1' }], tools: { allowed: ['read_document', 'read_table'], required: ['read_table'] } });
  const htmlLines = ['<html><body>', '<h1>Title</h1>', '<table>', `<tr><td>${'Revenue '.repeat(12)}</td></tr>`, '<tr><td>North</td><td>4.321.000</td></tr>', '</table>', '</body></html>'];

  it('markdown get_document_context lists blocks with at most 60 preview characters, and read_blocks gives the full text', () => {
    const backend = createBackend(md, { views: [{ format: 'md', lines: [...lines] }] });
    const ctx = backend.execute('get_document_context', {});
    assert.ok(Array.isArray(ctx.blocks) && ctx.blocks.length === 3, JSON.stringify(ctx));
    for (const b of ctx.blocks) assert.ok(b.preview.length <= 61, b.preview);
    assert.ok(!JSON.stringify(ctx).includes('4.321.000'), 'the overview must not carry the last table row');
    assert.ok(JSON.stringify(backend.execute('read_blocks', { startIndex: 2, endIndex: 2 })).includes('4.321.000'));
  });

  it('html get_outline lists elements with at most 60 preview characters, and read_source gives the full source', () => {
    const backend = createBackend(html, { views: [{ format: 'html', lines: [...htmlLines] }] });
    const outline = JSON.stringify(backend.execute('get_outline', {}));
    assert.ok(!outline.includes('4.321.000'), outline);
    assert.ok(JSON.stringify(backend.execute('read_source', {})).includes('4.321.000'));
  });

  it('pdf get_outline returns the outline (none in the synthetic page), never the page text', () => {
    const pdf = mkCase({ id: 'HO-PDF-970', format: 'pdf', fixtures: [{ id: 'fx-pdf-synthetic', sha256: FX, version: 'v1' }], tools: { allowed: ['read_page'], required: ['read_page'] } });
    const backend = createBackend(pdf, { views: [{ format: 'pdf', pages: [{ page: 1, lines: ['Total 4.321.000'] }], pageCount: 1 }] });
    assert.ok(!JSON.stringify(backend.execute('get_outline', {})).includes('4.321.000'));
    assert.ok(JSON.stringify(backend.execute('read_pages', { start: 1 })).includes('4.321.000'));
  });

  it('O2R1-05: html get_outline honours an explicit depth argument while keeping default 3', () => {
    const backend = createBackend(html, { views: [{ format: 'html', lines: [...htmlLines] }] });
    assert.deepEqual(backend.execute('get_outline', { depth: 1 }).blocks, [], 'P-B2-HTML-DEPTH-ARG shallower than h1/table');
    assert.ok(JSON.stringify(backend.execute('get_outline', { depth: 4 })).includes('4.321.000'), 'P-B2-HTML-DEPTH-ARG deeper reaches tr');
  });
});

describe('O2-B3: a written formula is filled and evaluated as the editor would', () => {
  const xlsx = mkCase({ id: 'HO-XLSX-971', category: 'edit', tools: { allowed: ['read_range', 'write_range'], required: ['write_range'] }, expected: { numeric: [], structural: [], writes: 1, mustNotContain: [] }, referenceAnswer: { numeric: {}, structural: [], writes: 1, text: 'x' } });
  const view = () => ({
    format: 'xlsx',
    workbook: {
      sheets: {
        SheetZ: {
          cells: {
            A2: { v: 2, t: 'n' }, B2: { v: 10, t: 'n' }, C2: { v: 10, t: 'n' },
            A3: { v: 3, t: 'n' }, B3: { v: 20, t: 'n' }, C3: { v: 0.5, t: 'n' },
            A4: { v: 4, t: 'n' }, B4: { v: 30, t: 'n' },
          },
          hiddenRows: new Set(),
        },
      },
      formatKinds: {},
    },
  });
  const cell = (backend, ref) => backend.execute('read_cells', { addresses: [ref] }).cells[ref];

  it('evaluates IF with comparisons and an empty-cell test', () => {
    const backend = createBackend(xlsx, { views: [view()] });
    backend.execute('propose_operations', { operations: [{ op: 'set_formula', sheetId: 'sheet-1', address: 'D2', formula: '=A2*B2*(1-IF(C2>1,C2/100,IF(C2="",0,C2)))' }] });
    assert.equal(cell(backend, 'D2'), '18 [formula =A2*B2*(1-IF(C2>1,C2/100,IF(C2="",0,C2)))]');
  });

  it('fills a relative formula over a range row by row', () => {
    const backend = createBackend(xlsx, { views: [view()] });
    backend.execute('propose_operations', { operations: [{ op: 'fill_range', sheetId: 'sheet-1', range: 'D2:D4', formula: '=A2*B2*(1-IF(C2>1,C2/100,IF(C2="",0,C2)))' }] });
    assert.equal(cell(backend, 'D2'), '18 [formula =A2*B2*(1-IF(C2>1,C2/100,IF(C2="",0,C2)))]');
    assert.equal(cell(backend, 'D3'), '30 [formula =A3*B3*(1-IF(C3>1,C3/100,IF(C3="",0,C3)))]');
    assert.equal(cell(backend, 'D4'), '120 [formula =A4*B4*(1-IF(C4>1,C4/100,IF(C4="",0,C4)))]');
  });

  it('fills a range from a source cell, keeping absolute references', () => {
    const backend = createBackend(xlsx, { views: [view()] });
    backend.execute('propose_operations', { operations: [
      { op: 'set_formula', sheetId: 'sheet-1', address: 'E2', formula: '=B2*$A$2' },
      { op: 'fill_range', sheetId: 'sheet-1', range: 'E3:E4', fillType: 'series', sourceRange: 'E2' },
    ] });
    assert.equal(cell(backend, 'E3'), '40 [formula =B3*$A$2]');
    assert.equal(cell(backend, 'E4'), '60 [formula =B4*$A$2]');
  });

  it('keeps SUM and plain arithmetic as before, and leaves an unknown function unevaluated', () => {
    const backend = createBackend(xlsx, { views: [view()] });
    backend.execute('propose_operations', { operations: [
      { op: 'set_formula', sheetId: 'sheet-1', address: 'F2', formula: '=SUM(B2:B4)' },
      { op: 'set_formula', sheetId: 'sheet-1', address: 'F3', formula: '=B2+B3' },
      { op: 'set_formula', sheetId: 'sheet-1', address: 'F4', formula: '=NOSUCH(B2)' },
    ] });
    assert.equal(cell(backend, 'F2'), '60 [formula =SUM(B2:B4)]');
    assert.equal(cell(backend, 'F3'), '30 [formula =B2+B3]');
    assert.equal(cell(backend, 'F4'), ' [formula =NOSUCH(B2)]');
  });
});
