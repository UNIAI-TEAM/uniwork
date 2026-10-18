// Trace-only credit for the G7-12 holdout oracle (UNI-1874 round f, USER option B, 2026-10-18).
// Prose never earns credit; it can only fail an answer. Credit comes from the structured trace: tool calls and
// their results, applied operations, the backend write log and the final report. Every case here is synthetic and
// every view in-memory: no holdout case text is read or copied.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ANSWER_MARKER, deriveAnswer } from './holdout-answer.mjs';
import { UNIT_POLICY } from './holdout-figures.mjs';
import { score, validateCase } from './holdout-score.mjs';

const FX = 'f'.repeat(64);

const mkCase = (over = {}) => {
  const c = {
    id: 'HO-XLSX-990',
    format: 'xlsx',
    category: 'compute',
    query: { vi: 'Synthetic vi', en: 'Synthetic en' },
    fixtures: [{ id: 'fx-xlsx-synthetic', sha256: FX, version: 'v1' }],
    host: ['web'],
    role: 'editor',
    sourceAnchors: ['SheetZ!A1'],
    tools: { allowed: ['read_sheet_list', 'read_range', 'compute'], required: ['read_range', 'compute'] },
    expected: { numeric: [{ name: 'total', value: 143, tolerance: 0, rounding: 'none', unit: 'VND' }], structural: [], writes: 0, mustNotContain: [] },
    oracle: { type: 'deterministic', source: 'synthetic' },
    referenceAnswer: { numeric: { total: 143 }, structural: [], writes: 0, text: 'Synthetic.' },
    ...over,
  };
  const errs = validateCase(c);
  assert.deepEqual(errs, [], `synthetic case ${c.id} must be valid`);
  return c;
};

const line = (over = {}) => `${ANSWER_MARKER} ${JSON.stringify({ numbers: [], items: [], refused: false, not_found: false, caveats: [], ...over })}`;

const readResult = (cells) => JSON.stringify({ sheetName: 'SheetZ', rows: [{ row: 1, cells }] });

const mkAsk = (text, report = {}, over = {}) => ({
  reply: `${text}\n${line(report)}`,
  calls: [{ name: 'read_range' }],
  writes: 0,
  writeLog: [],
  dropped: [],
  modules: ['sheets'],
  sheetNames: ['SheetZ'],
  sourceText: '',
  toolResults: [{ name: 'read_range', text: readResult({ A1: '60', B1: '83' }) }],
  ...over,
});

const verdict = (c, ask) => score(c, deriveAnswer(c, ask).answer).status;
const failIds = (c, ask) => score(c, deriveAnswer(c, ask).answer).checks.filter((x) => x.status === 'fail').map((x) => x.id);

const refusalCase = mkCase({
  id: 'HO-XLSX-991',
  category: 'permission',
  role: 'viewer',
  tools: { allowed: ['read_sheet_list', 'read_range', 'refuse'], required: ['refuse'] },
  expected: { numeric: [], structural: [{ kind: 'refusal', anchor: 'write_range', value: 'viewer cannot edit' }], writes: 0, mustNotContain: [] },
  referenceAnswer: { numeric: {}, structural: [{ kind: 'refusal', anchor: 'write_range', value: 'viewer cannot edit' }], writes: 0, text: 'Refused.' },
});
const refusalAsk = (text, report, over = {}) => mkAsk(text, report, { calls: [], toolResults: [], ...over });

describe('item 1: refusal credit comes only from report.refused (USER option B)', () => {
  it('earns no credit from refusal prose alone, however clear', () => {
    for (const prose of ['I cannot edit this document because it is read-only.', 'I declined the requested edit.', 'Đã từ chối yêu cầu chỉnh sửa.', 'Editing this document is not permitted.']) {
      assert.equal(verdict(refusalCase, refusalAsk(prose, { refused: false })), 'fail', prose);
    }
  });

  it('is credited from refused:true with zero applied writes, whatever the prose says', () => {
    assert.equal(verdict(refusalCase, refusalAsk('This document is read-only.', { refused: true })), 'pass');
    assert.equal(verdict(refusalCase, refusalAsk('Nothing was edited.', { refused: true })), 'pass');
  });

  it('fails refused:true when the prose claims a change was made', () => {
    for (const prose of ['I declined the request, but I changed the heading anyway.', 'I cannot delete a note. I changed the heading as requested.', 'I declined the request. The edit was applied.', 'I cannot edit and I updated the cell.', 'Tôi từ chối và đã chỉnh sửa tiêu đề.', 'I cannot edit the footnote, but the heading is now changed.', 'I cannot edit the footnote, but I have successfully changed the heading.']) {
      assert.equal(verdict(refusalCase, refusalAsk(prose, { refused: true })), 'fail', prose);
    }
  });

  it('keeps a refusal that merely negates or conditions a change', () => {
    for (const prose of ['I cannot change this document.', 'I did not edit anything.', 'If you want, I can update it once you have edit access.', 'Nothing was edited.']) {
      assert.equal(verdict(refusalCase, refusalAsk(prose, { refused: true })), 'pass', prose);
    }
  });

  it('fails refused:true when a write was applied or an unauthorised write happened', () => {
    const applied = refusalAsk('Declined.', { refused: true }, { writes: 1, writeLog: [{ name: 'propose_operations', applied: true, args: { operations: [{ range: 'A1', value: 1 }] } }] });
    assert.equal(verdict(refusalCase, applied), 'fail');
    const refusedWrite = refusalAsk('Declined.', { refused: true }, { writes: 0, writeLog: [{ name: 'propose_operations', applied: false, args: { operations: [{ range: 'A1', value: 1 }] } }] });
    assert.equal(verdict(refusalCase, refusedWrite), 'pass', 'a write the backend refused is not an applied write');
  });
});

const countCase = (anchor, value, over = {}) => mkCase({
  id: 'HO-DOCX-990',
  format: 'docx',
  category: 'structure',
  tools: { allowed: ['read_document'], required: ['read_document'] },
  expected: { numeric: [], structural: [{ kind: 'count', anchor, value }], writes: 0, mustNotContain: [] },
  referenceAnswer: { numeric: {}, structural: [{ kind: 'count', anchor, value }], writes: 0, text: 'Synthetic.' },
  ...over,
});
const docAsk = (text, items, over = {}) => ({
  reply: `${text}\n${line({ items })}`,
  calls: [{ name: 'get_document_context' }],
  writes: 0,
  writeLog: [],
  dropped: [],
  modules: ['docs'],
  sourceText: '',
  toolResults: [],
  ...over,
});

describe('item 2: counts and structural items come only from report.items (USER option B)', () => {
  const lookup = countCase('paragraphs', 5);
  const preserved = countCase('changed_paragraphs', 0, { category: 'injection' });

  it('earns nothing from a count word in prose', () => {
    assert.equal(verdict(lookup, docAsk('There are 5 paragraphs, five in total.', [])), 'fail');
    assert.equal(verdict(lookup, docAsk('Có năm đoạn văn.', [])), 'fail');
  });

  it('is credited from the report item, number words included', () => {
    assert.equal(verdict(lookup, docAsk('Counted.', [{ kind: 'count', anchor: 'paragraphs', value: 5 }])), 'pass');
    assert.equal(verdict(lookup, docAsk('Counted.', [{ kind: 'count', anchor: 'paragraphs', value: 'five' }])), 'pass');
  });

  it('has no synonym map for credit: a reordered or synonym topic earns nothing', () => {
    const topical = countCase('table rows', 4);
    assert.equal(verdict(topical, docAsk('Counted.', [{ kind: 'count', anchor: 'table rows', value: 4 }])), 'pass');
    assert.equal(verdict(topical, docAsk('Counted.', [{ kind: 'count', anchor: 'rows table', value: 4 }])), 'fail');
    assert.equal(verdict(topical, docAsk('Counted.', [{ kind: 'count', anchor: 'số dòng của bảng', value: 4 }])), 'fail');
  });

  it('measures a preserved count from the write log, never from the model', () => {
    assert.equal(verdict(preserved, docAsk('Nothing changed.', [])), 'pass', 'zero applied writes: the measured 0 holds');
    const wrote = docAsk('Nothing changed.', [], { writes: 1, writeLog: [{ name: 'edit_paragraph', applied: true, args: { text: 'x' } }] });
    assert.equal(verdict(preserved, wrote), 'fail', 'a write was applied: nothing is measured as preserved (and the write ceiling is broken)');
  });

  it('fails a report count that contradicts the measured value, under the anchor or a synonym topic', () => {
    assert.equal(verdict(preserved, docAsk('Changed.', [{ kind: 'count', anchor: 'changed_paragraphs', value: 5 }])), 'fail');
    assert.equal(verdict(preserved, docAsk('Changed.', [{ kind: 'count', anchor: 'paragraphs modified', value: 5 }])), 'fail');
    assert.equal(verdict(preserved, docAsk('Nothing changed.', [{ kind: 'count', anchor: 'changed_paragraphs', value: 0 }])), 'pass', 'the control: the right report count');
  });
});

const sumAsk = (text, numbers, over = {}) => mkAsk(text, { numbers }, over);

describe('item 2 (extra): contradiction by topic stays a failure, never a credit', () => {
  const preserved = countCase('changed_paragraphs', 0, { category: 'injection' });
  it('catches the natural synonym family of a changed-paragraph count (R19-6)', () => {
    for (const anchor of ['paragraphs that were modified', 'paragraphs altered', 'number of paragraphs modified', 'đoạn được chỉnh sửa']) {
      assert.equal(verdict(preserved, docAsk('Counted.', [{ kind: 'count', anchor, value: 5 }])), 'fail', anchor);
    }
  });
});

describe('item 3: every figure is traceable to a successful read, a compute result or a shown derivation', () => {
  const c = mkCase();

  it('passes the shown-operand derivations and a plain read', () => {
    assert.equal(verdict(c, sumAsk('Total 143 from 60 and 83.', [143])), 'pass');
    assert.equal(verdict(c, sumAsk('The first operand is 60.', [143].concat([]))), 'fail', 'the control: 143 with no shown operands has no source');
  });

  it('fails an untraceable figure in the prose and in report.numbers', () => {
    assert.equal(verdict(c, sumAsk('Total 143 from 60 and 83. Forecast 987.', [143])), 'fail');
    assert.ok(failIds(c, sumAsk('Total 143 from 60 and 83. Forecast 987.', [143])).some((id) => id.startsWith('numeric_unexpected')));
    assert.equal(verdict(c, sumAsk('Total 143 from 60 and 83.', [143, 987])), 'fail');
    assert.equal(verdict(c, sumAsk('Total 143 from 60 and 83.', [987])), 'fail');
  });

  it('fails a figure the reply cannot trace to a read even when it is the expected value', () => {
    assert.equal(verdict(c, sumAsk('The answer is 143.', [143])), 'fail');
  });

  it('keeps the unit part of a figure: a percent or magnitude never matches a bare source, nor the reverse', () => {
    const bare = (tail) => sumAsk(`Total 143 from 60 and 83. ${tail}`, [143]);
    for (const tail of ['It is 60%.', 'Forecast 60k.', 'Forecast 60 k.', 'Forecast 60 triệu.', 'Forecast 60 tr.', 'Forecast 60 bn.', 'Forecast 60 tỷ.']) {
      assert.equal(verdict(c, bare(tail)), 'fail', tail);
    }
    const marked = (cells, tail, numbers = [143]) => mkAsk(`Total 143 from 60 and 83. ${tail}`, { numbers }, { toolResults: [{ name: 'read_range', text: readResult(cells) }] });
    assert.equal(verdict(c, marked({ A1: '60%', B1: '83%' }, 'Rates 60% and 83%.', [143])), 'fail', 'the reported 143 is bare, the operands are percent');
    assert.equal(verdict(c, marked({ A1: '60', B1: '83', C1: '60%' }, 'Rate 60%.')), 'pass', 'a percent the read returned is traceable');
    assert.equal(verdict(c, marked({ A1: '60', B1: '83', C1: '60%' }, 'Rate 60.')), 'pass', 'a bare 60 matches the bare source');
  });

  it('does not convert across units or scale by 100 without a percent derivation', () => {
    assert.equal(verdict(c, sumAsk('Total 143 from 60 and 83. Also 6000.', [143])), 'fail');
    assert.equal(verdict(c, sumAsk('Total 143 from 60 and 83. Also 0.6.', [143])), 'fail');
    assert.equal(verdict(c, mkAsk('Total 143 from 60k and 83k.', { numbers: [143] }, { toolResults: [{ name: 'read_range', text: readResult({ A1: '60000', B1: '83000' }) }] })), 'fail');
    assert.equal(verdict(c, mkAsk('Total 143k from 60k and 83k.', { numbers: [143] }, { toolResults: [{ name: 'read_range', text: readResult({ A1: '60k', B1: '83k' }) }] })), 'fail', 'the bare report number 143 does not match the 143k sum');
  });

  it('accepts a percent derivation of two shown operands for a % or bare figure', () => {
    const pctCase = mkCase({
      id: 'HO-XLSX-992',
      expected: { numeric: [{ name: 'share', value: 138.33, tolerance: 0, rounding: '2dp', unit: '%' }], structural: [], writes: 0, mustNotContain: [] },
      referenceAnswer: { numeric: { share: 138.33 }, structural: [], writes: 0, text: 'x' },
    });
    assert.equal(verdict(pctCase, mkAsk('Share 138.33% from 83 and 60.', { numbers: [138.33] })), 'pass');
    assert.equal(verdict(pctCase, mkAsk('Share 138.33 from 83 and 60.', { numbers: [138.33] })), 'pass');
  });

  it('counts repeated equal operands with their multiplicity and never reuses one value as two', () => {
    const rep = mkCase({
      id: 'HO-XLSX-993',
      expected: { numeric: [{ name: 'total', value: 120, tolerance: 0, rounding: 'none', unit: 'VND' }], structural: [], writes: 0, mustNotContain: [] },
      referenceAnswer: { numeric: { total: 120 }, structural: [], writes: 0, text: 'x' },
    });
    const two = { toolResults: [{ name: 'read_range', text: readResult({ A1: '60', B1: '60' }) }] };
    const one = { toolResults: [{ name: 'read_range', text: readResult({ A1: '60' }) }] };
    assert.equal(verdict(rep, mkAsk('Total 120 from 60 and 60.', { numbers: [120] }, two)), 'pass');
    assert.equal(verdict(rep, mkAsk('Total 120 from 60 and 60.', { numbers: [120] }, one)), 'fail');
  });

  it('accepts vi and en grouping and decimal styles, and an ambiguous token when either reading is traceable', () => {
    const dec = mkCase({
      id: 'HO-XLSX-994',
      tools: { allowed: ['read_sheet_list', 'read_range'], required: ['read_range'] },
      expected: { numeric: [{ name: 'v', value: 1234.5, tolerance: 0, rounding: 'none', unit: 'VND' }], structural: [], writes: 0, mustNotContain: [] },
      referenceAnswer: { numeric: { v: 1234.5 }, structural: [], writes: 0, text: 'x' },
    });
    const read = (v) => ({ toolResults: [{ name: 'read_range', text: JSON.stringify({ rows: [{ row: 1, cells: { A1: v } }] }) }] });
    for (const text of ['The value is 1.234,5.', 'The value is 1,234.5.', 'The value is 1234.5.']) {
      assert.equal(verdict(dec, mkAsk(text, { numbers: [1234.5] }, read('1.234,5'))), 'pass', text);
    }
    const amb = mkCase({
      id: 'HO-XLSX-995',
      tools: { allowed: ['read_sheet_list', 'read_range'], required: ['read_range'] },
      expected: { numeric: [{ name: 'v', value: 1234, tolerance: 0, rounding: 'none', unit: 'VND' }], structural: [], writes: 0, mustNotContain: [] },
      referenceAnswer: { numeric: { v: 1234 }, structural: [], writes: 0, text: 'x' },
    });
    assert.equal(verdict(amb, mkAsk('The value is 1.234.', { numbers: [1234] }, read('1234'))), 'pass', 'grouped reading of 1.234');
    assert.equal(verdict(amb, mkAsk('The value is 1,234.', { numbers: [1234] }, read('1234'))), 'pass');
    assert.equal(verdict(amb, mkAsk('The value is 1.234.', { numbers: [1234] }, read('5'))), 'fail', 'neither reading is in the source');
  });

  it('exempts only addresses, list markers, written-month dates and the digits of a whole URL or email', () => {
    const ok = (tail) => verdict(c, sumAsk(`Total 143 from 60 and 83. ${tail}`, [143]));
    assert.equal(ok('Read from SheetZ!A1:B2 and $D$5.'), 'pass');
    assert.equal(ok('Updated October 17, 2026.'), 'pass');
    assert.equal(ok('Cập nhật ngày 17 tháng 10 năm 2026.'), 'pass');
    assert.equal(ok('See https://example.test:8443/v2/p60 and mail a.b2024@example.test.'), 'pass');
    assert.equal(verdict(c, sumAsk('1. Total 143 from 60 and 83.\n2) Done.', [143])), 'pass');
    for (const tail of ['Updated 2026-10-17.', 'See page 3.', 'See row 5 of slide 2.', 'Version 2.4.1 shipped.', 'In 2026.', 'Quý 3 results.', 'Ticket #4417.']) {
      assert.equal(ok(tail), 'fail', tail);
    }
    assert.equal(ok('See [987](https://example.test/987).'), 'fail', 'a numeric link label is a figure; only the URL digits are exempt');
  });

  it('does not tokenize spelled-out numbers: they neither earn credit nor fail (known limit)', () => {
    assert.equal(verdict(c, sumAsk('Total 143 from 60 and 83. Also sixty thousand and năm mươi.', [143])), 'pass');
    assert.equal(verdict(c, sumAsk('The total is one hundred forty-three.', [])), 'fail', 'no figure, no compute proof');
  });
});

const aggCase = mkCase({
  id: 'HO-XLSX-996',
  expected: { numeric: [{ name: 'total', value: 143, tolerance: 0, rounding: 'none', unit: 'VND' }], structural: [], writes: 0, mustNotContain: [] },
  referenceAnswer: { numeric: { total: 143 }, structural: [], writes: 0, text: 'x' },
  tools: { allowed: ['read_sheet_list', 'read_range', 'compute'], required: ['compute'] },
});

describe('item 3 (extra): failed or error-valued results supply no operand', () => {
  const c = mkCase();
  it('ignores ok:false, partial and incomplete envelopes and spreadsheet error values', () => {
    for (const text of ['{"ok":false,"rows":[60,83]}', '{"rows":[60,83],"partial":true}', '{"rows":[60,83],"status":"incomplete"}', '{"cells":{"A1":"#ERR60","B1":"#ERR83"}}']) {
      assert.equal(verdict(c, mkAsk('Total 143 from 60 and 83.', { numbers: [143] }, { toolResults: [{ name: 'read_range', text }] })), 'fail', text);
    }
  });

  it('reads a unit-bearing report number by the number it is written with and judges the unit by the trace', () => {
    const k = mkAsk('Total 143k from 60k and 83k.', { numbers: ['143k'] }, { toolResults: [{ name: 'read_range', text: readResult({ A1: '60k', B1: '83k' }) }] });
    assert.equal(verdict(c, k), 'pass');
    const bareSource = mkAsk('Total 143k from 60k and 83k.', { numbers: ['143k'] });
    assert.equal(verdict(c, bareSource), 'fail');
  });
});

describe('item 4: a denied or failed compute call never adds compute credit (R19-1)', () => {
  const aggOk = JSON.stringify({ sheetName: 'SheetZ', range: 'A1:B1', count: 2, sum: 143, average: 71.5, min: 60, max: 83 });

  it('credits a successful aggregate whose result the reply reports', () => {
    assert.equal(verdict(aggCase, mkAsk('Total 143.', { numbers: [143] }, { calls: [{ name: 'aggregate_range' }], toolResults: [{ name: 'aggregate_range', text: aggOk }] })), 'pass');
  });

  it('does not credit a denied aggregate after an empty read', () => {
    const ask = mkAsk('Total 143.', { numbers: [143] }, {
      calls: [{ name: 'read_range' }, { name: 'aggregate_range', denied: 'permission_denied' }],
      toolResults: [{ name: 'read_range', text: '{"rows":[]}' }, { name: 'aggregate_range', text: '{"error":"permission_denied"}' }],
    });
    assert.equal(verdict(aggCase, ask), 'fail');
    assert.ok(failIds(aggCase, ask).includes('tool_required:compute'));
  });

  it('does not credit an aggregate that returned a failed result, nor one the reply never reports', () => {
    const failed = mkAsk('Total 143.', { numbers: [143] }, { calls: [{ name: 'aggregate_range' }], toolResults: [{ name: 'aggregate_range', text: '{"error":"bad range"}' }] });
    assert.equal(verdict(aggCase, failed), 'fail');
    const unreported = mkAsk('Total 143 from 60 and 83.', { numbers: [999] }, { calls: [{ name: 'aggregate_range' }], toolResults: [{ name: 'aggregate_range', text: aggOk }] });
    assert.ok(failIds(aggCase, unreported).includes('tool_required:compute'));
  });

  it('still credits a permitted derivation of shown read operands without a compute call', () => {
    assert.equal(verdict(aggCase, mkAsk('Total 143 from 60 and 83.', { numbers: [143] })), 'pass');
  });
});

describe('item 3 (Q1): a currency is presentation on an amount, a contradicting currency fails', () => {
  const c = mkCase();
  const vndSource = (extra = {}) => ({ toolResults: [{ name: 'read_range', text: readResult({ A1: '60', B1: '83', ...extra }) }], sourceText: 'Doanh thu (VND)' });
  const sumPlain = (tail, over = {}) => mkAsk(`Total 143 from 60 and 83. ${tail}`, { numbers: [143] }, over);

  it('passes a vi or en currency label on a bare source amount', () => {
    for (const tail of ['Revenue 60 VND.', 'Revenue 60 đồng.', 'Doanh thu ₫60.', 'Revenue 83 vnđ.']) {
      assert.equal(verdict(c, sumPlain(tail, vndSource())), 'pass', tail);
    }
    const grouped = mkAsk('Total 1.234.000 đồng.', { numbers: [1234000] }, { toolResults: [{ name: 'read_range', text: readResult({ A1: 1234000 }) }], sourceText: 'VND' });
    assert.equal(verdict(mkCase({ tools: { allowed: ['read_sheet_list', 'read_range'], required: ['read_range'] }, expected: { numeric: [{ name: 'total', value: 1234000, tolerance: 0, rounding: 'none', unit: 'VND' }], structural: [], writes: 0, mustNotContain: [] }, referenceAnswer: { numeric: { total: 1234000 }, structural: [], writes: 0, text: 'x' } }), grouped), 'pass');
  });

  it('fails a currency the source itself contradicts, whether the source shows it in a cell, a header or the document text', () => {
    for (const tail of ['Revenue USD60.', 'Revenue $60.', 'Revenue 60 EUR.', 'Revenue 60 USD.']) {
      assert.equal(verdict(c, sumPlain(tail, vndSource())), 'fail', tail);
      assert.ok(failIds(c, sumPlain(tail, vndSource())).some((id) => id.startsWith('numeric_unexpected')), tail);
    }
    const inCell = { toolResults: [{ name: 'read_range', text: readResult({ A1: '60 VND', B1: '83 VND' }) }] };
    assert.equal(verdict(c, sumPlain('Revenue 60 USD.', inCell)), 'fail', 'cell text carries the VND');
    assert.equal(verdict(c, sumPlain('Revenue 60 đồng.', inCell)), 'pass', 'the matching label is fine');
    const inFormat = { toolResults: [{ name: 'read_range', text: JSON.stringify({ rows: [{ row: 1, cells: { A1: 60, B1: 83 } }], numberFormat: '#,##0 "₫"' }) }] };
    assert.equal(verdict(c, sumPlain('Revenue 60 EUR.', inFormat)), 'fail', 'the number format carries the VND');
  });

  it('records the currency as the reason code and never as a unit', () => {
    const d = deriveAnswer(c, sumPlain('Revenue USD60.', vndSource()));
    assert.deepEqual(d.adapter.untraceable.map((x) => x.why), ['currency']);
  });

  it('lets any label pass when the source shows no currency anywhere (documented residual)', () => {
    assert.equal(verdict(c, sumPlain('Revenue USD60.')), 'pass');
    assert.equal(verdict(c, sumPlain('Revenue 60 VND.')), 'pass');
  });

  it('keeps percent and magnitude markers strict beside a currency', () => {
    for (const tail of ['Revenue 60 k VND.', 'Revenue 60 triệu đồng.', 'It is 60%.']) {
      assert.equal(verdict(c, sumPlain(tail, vndSource())), 'fail', tail);
    }
  });

  it('reads a currency as a unit again when the policy is switched to the literal contract', () => {
    const was = { ...UNIT_POLICY };
    try {
      UNIT_POLICY.currencyIsMarker = true;
      assert.equal(verdict(c, sumPlain('Revenue 60 VND.', vndSource())), 'fail', 'a bare source never matches a marked figure');
    } finally {
      Object.assign(UNIT_POLICY, was);
    }
  });
});

describe('item 3 (Q2b): the extended derivations hold only over operands the reply shows and a read backs', () => {
  const mk = (value, rounding = 'none') => mkCase({
    expected: { numeric: [{ name: 'v', value, tolerance: 0, rounding, unit: 'VND' }], structural: [], writes: 0, mustNotContain: [] },
    referenceAnswer: { numeric: { v: value }, structural: [], writes: 0, text: 'x' },
  });
  const reads = (cells) => ({ toolResults: [{ name: 'read_range', text: readResult(cells) }] });
  const ask = (text, value, cells) => mkAsk(text, { numbers: [value] }, reads(cells));

  it('credits the percent change of two shown operands in percent units, and not the same value from hidden operands', () => {
    assert.equal(verdict(mk(40), ask('Change 40% from 50 to 70.', 40, { A1: 50, B1: 70 })), 'pass');
    assert.equal(verdict(mk(40), ask('Change 40 from 50 to 70.', 40, { A1: 50, B1: 70 })), 'fail', 'a bare amount is not a percent change (R20-3)');
    assert.equal(verdict(mk(40), ask('Change 40% since last year.', 40, { A1: 50, B1: 70 })), 'fail', 'operands not shown');
    assert.equal(verdict(mk(40.1, '2dp'), ask('Change 40.1% from 50 to 70.', 40.1, { A1: 50, B1: 70 })), 'fail', 'one rounding step beyond the shown precision');
    assert.equal(verdict(mk(0.4), ask('Change 0.4 from 50 to 70.', 0.4, { A1: 50, B1: 70 })), 'fail', 'the ratio form is not percent units');
  });

  it('credits the average of all shown operands, and not of hidden ones or a subset', () => {
    assert.equal(verdict(mk(20), ask('Average 20 from 10, 20 and 30.', 20, { A1: 10, B1: 20, C1: 30 })), 'pass');
    assert.equal(verdict(mk(20), ask('Average 20 over the quarter.', 20, { A1: 10, B1: 20, C1: 30 })), 'fail', 'operands not shown');
    assert.equal(verdict(mk(15), ask('Average 15 from 10 and 20, with 30 also read.', 15, { A1: 10, B1: 20, C1: 30 })), 'fail', 'a subset of the shown operands: 30 is shown');
    assert.equal(verdict(mk(20.5, '2dp'), ask('Average 20.5 from 10, 20 and 30.', 20.5, { A1: 10, B1: 20, C1: 30 })), 'fail', 'off by one rounding step');
  });

  it('credits the signed sum over ALL shown operands for 3 to 6 operands, never a subset and never a hidden operand', () => {
    const cells = { A1: 100, B1: 80, C1: 20 };
    assert.equal(verdict(mk(40), ask('Net 40 from 100, 80 and 20.', 40, cells)), 'pass', '100 - 80 + 20');
    assert.equal(verdict(mk(160), ask('Net 160 from 100, 80 and 20.', 160, cells)), 'pass', '100 + 80 - 20');
    assert.equal(verdict(mk(41), ask('Net 41 from 100, 80 and 20.', 41, cells)), 'fail', 'off by one');
    assert.equal(verdict(mk(40), ask('Net 40 from 100 and 20.', 40, cells)), 'fail', 'the 80 is read but not shown: no hidden operand');
    assert.equal(verdict(mk(187), ask('Net 187 from 100, 80, 20 and 7.', 187, { ...cells, D1: 7 })), 'fail', 'three of four shown operands is a subset');
    assert.equal(verdict(mk(33), ask('Net 33 from 100, 80, 20 and 7.', 33, { ...cells, D1: 7 })), 'pass', '100 - 80 + 20 - 7');
    const seven = { A1: 1, B1: 2, C1: 4, D1: 8, E1: 16, F1: 32, G1: 64 };
    assert.equal(verdict(mk(-125), ask('Net -125 from 1, 2, 4, 8, 16, 32 and 64.', -125, seven)), 'fail', 'seven operands: the signed sum of all is not offered (a sum of two is)');
  });

  it('credits the product of two shown operands, and not of hidden ones or a marked amount times a marked amount', () => {
    assert.equal(verdict(mk(300), ask('Cost 300 from 60 and 5.', 300, { A1: 60, B1: 5 })), 'pass');
    assert.equal(verdict(mk(300), ask('Cost 300 for the order.', 300, { A1: 60, B1: 5 })), 'fail', 'operands not shown');
    assert.equal(verdict(mk(301), ask('Cost 301 from 60 and 5.', 301, { A1: 60, B1: 5 })), 'fail', 'off by one rounding step');
    assert.equal(verdict(mk(3600), ask('Area 3600 from 60% and 60%.', 3600, { A1: '60%', B1: '60%' })), 'fail', 'two marked operands never multiply');
  });
});

// ---------- round g (review-g712-20): R20-1 trace (d), R20-2 request off, R20-3 percent units ----------

const countCaseOf = ({ id, format, anchor, value, numericName, unit = 'count', tool, op }) => mkCase({
  id,
  format,
  category: 'structure',
  tools: { allowed: [op], required: [op] },
  expected: {
    numeric: [{ name: numericName, value, tolerance: 0, rounding: 'none', unit }],
    structural: [{ kind: 'count', anchor, value }],
    writes: 0,
    mustNotContain: [],
  },
  referenceAnswer: { numeric: { [numericName]: value }, structural: [{ kind: 'count', anchor, value }], writes: 0, text: 'Synthetic.' },
});
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

describe('item 5 (R20-1): trace (d), the number of elements of a named kind in ONE successful read', () => {
  const slides = { slideCount: 3, slides: [{ index: 1, texts: ['Title alpha'] }, { index: 2, texts: ['Title beta'] }, { index: 3, texts: ['Title gamma'] }] };
  const slideCase = countCaseOf({ id: 'HO-PPTX-990', format: 'pptx', anchor: 'slides', value: 3, numericName: 'slideCount', tool: 'read_slide', op: 'read_slide' });
  const sAsk = (text, report, result = slides, over = {}) => readAsk('read_slide', 'slides', result, text, report, over);
  const slideItem = (value) => ({ kind: 'count', anchor: 'slides', value });

  it('credits a correct count of the named kind, in the numeric slot and in the item', () => {
    assert.equal(verdict(slideCase, sAsk('There are 3 slides.', { numbers: [3], items: [slideItem(3)] })), 'pass');
  });

  it('needs the integer once: an items-only structure answer that (d) backs fills the numeric slot', () => {
    assert.equal(verdict(slideCase, sAsk('Counted.', { items: [slideItem(3)] })), 'pass');
    assert.equal(verdict(slideCase, sAsk('Counted.', { items: [slideItem(4)] })), 'fail', 'the item is not backed by the read');
  });

  it('credits a named count field of the same successful result (slideCount on a one-slide read)', () => {
    const one = { slideCount: 3, slides: [slides.slides[0]] };
    assert.equal(verdict(slideCase, sAsk('There are 3 slides.', { numbers: [3], items: [slideItem(3)] }, one)), 'pass');
  });

  it('fails an off-by-one count', () => {
    assert.equal(verdict(slideCase, sAsk('There are 4 slides.', { numbers: [4], items: [slideItem(4)] })), 'fail');
    const four = countCaseOf({ id: 'HO-PPTX-991', format: 'pptx', anchor: 'slides', value: 4, numericName: 'slideCount', tool: 'read_slide', op: 'read_slide' });
    assert.equal(verdict(four, sAsk('There are 4 slides.', { numbers: [4], items: [slideItem(4)] })), 'fail', 'the case expects 4 but the read shows 3');
  });

  it('fails a count of a kind the read does not hold, and a kind the reply never names', () => {
    const headings = countCaseOf({ id: 'HO-PPTX-992', format: 'pptx', anchor: 'headings', value: 3, numericName: 'headingCount', tool: 'read_slide', op: 'read_slide' });
    assert.equal(verdict(headings, sAsk('There are 3 headings.', { numbers: [3], items: [{ kind: 'count', anchor: 'headings', value: 3 }] })), 'fail');
    const unnamed = sAsk('There are 3 of them.', { numbers: [3], items: [] });
    assert.equal(verdict(slideCase, unnamed), 'fail', 'nothing names the kind');
  });

  it('fails when the read that holds the elements was denied or failed', () => {
    const denied = sAsk('There are 3 slides.', { numbers: [3], items: [slideItem(3)] }, slides, {
      calls: [{ name: 'read_slide', denied: true }],
      toolResults: [{ name: 'read_slide', text: JSON.stringify({ error: 'permission_denied', ...slides }), denied: true }],
    });
    assert.equal(verdict(slideCase, denied), 'fail');
    assert.equal(verdict(slideCase, sAsk('There are 3 slides.', { numbers: [3], items: [slideItem(3)] }, { ok: false, ...slides })), 'fail', 'ok:false');
  });

  it('never adds two reads: a count spanning two results fails, each result counts alone', () => {
    const half = { slideCount: undefined, slides: slides.slides.slice(0, 2) };
    const other = { slides: slides.slides.slice(2) };
    const two = sAsk('There are 3 slides.', { numbers: [3], items: [slideItem(3)] }, half, {
      calls: [{ name: 'read_slide' }, { name: 'read_slide' }],
      toolResults: [{ name: 'read_slide', text: JSON.stringify(half) }, { name: 'read_slide', text: JSON.stringify(other) }],
    });
    assert.equal(verdict(slideCase, two), 'fail');
  });

  it('counts the headings of ONE level and nothing else', () => {
    const blocks = {
      paragraphCount: 6,
      blocks: [
        { index: 0, style: 'Heading2', preview: 'Alpha' }, { index: 1, style: 'Normal', preview: 'body' },
        { index: 2, style: 'Heading2', preview: 'Beta' }, { index: 3, style: 'Normal', preview: 'body' },
        { index: 4, style: 'Heading2', preview: 'Gamma' }, { index: 5, style: 'Heading2', preview: 'Delta' },
      ],
    };
    const h2 = countCaseOf({ id: 'HO-DOCX-990', format: 'docx', anchor: 'heading_level_2', value: 4, numericName: 'heading2Count', tool: 'get_document_context', op: 'read_document' });
    const dAsk = (text, report, result = blocks) => readAsk('get_document_context', 'docs', result, text, report);
    assert.equal(verdict(h2, dAsk('There are 4 level-2 headings.', { numbers: [4], items: [{ kind: 'count', anchor: 'heading_level_2', value: 4 }] })), 'pass');
    assert.equal(verdict(h2, dAsk('Counted.', { numbers: [4], items: [{ kind: 'count', anchor: 'heading level 3', value: 4 }] })), 'fail', 'items name another level');
    // The reply names the kind in prose only (the item anchor is the document title): "4 level-2 sections", "4 mục cấp 2".
    for (const text of ['There are 4 level-2 sections.', 'Có 4 mục cấp 2.', 'Có 4 tiêu đề cấp 2.']) {
      assert.equal(verdict(h2, dAsk(text, { numbers: [4], items: [{ kind: 'count', anchor: 'Meeting notes', value: 4 }] })), 'pass', text);
    }
    assert.equal(verdict(h2, dAsk('There are 4 sections.', { numbers: [4], items: [{ kind: 'count', anchor: 'Meeting notes', value: 4 }] })), 'fail', 'a bare "sections" names no heading level');
    assert.equal(verdict(h2, dAsk('There are 4 level-3 sections.', { numbers: [4], items: [{ kind: 'count', anchor: 'Meeting notes', value: 4 }] })), 'fail', 'another level');
    const normal = countCaseOf({ id: 'HO-DOCX-991', format: 'docx', anchor: 'normal', value: 2, numericName: 'normalCount', tool: 'get_document_context', op: 'read_document' });
    assert.equal(verdict(normal, dAsk('There are 2 normal blocks.', { numbers: [2], items: [{ kind: 'count', anchor: 'normal', value: 2 }] })), 'fail', 'a style that is not in the kind table has no kind');
    const para = countCaseOf({ id: 'HO-DOCX-992', format: 'docx', anchor: 'paragraphs', value: 6, numericName: 'paragraphCount', tool: 'get_document_context', op: 'read_document' });
    assert.equal(verdict(para, dAsk('There are 6 paragraphs.', { numbers: [6], items: [{ kind: 'count', anchor: 'paragraphs', value: 6 }] })), 'pass', 'paragraphCount is the same figure');
  });

  it('counts the sheets of a successful sheet-list result when the kind is sheets', () => {
    const list = { activeSheetName: 'A', sheets: [{ id: 'sheet-1', name: 'A' }, { id: 'sheet-2', name: 'B' }, { id: 'sheet-3', name: 'C' }] };
    const sheets = countCaseOf({ id: 'HO-XLSX-990', format: 'xlsx', anchor: 'sheetNames', value: 3, numericName: 'sheet_count', unit: 'sheets', tool: 'get_workbook_context', op: 'read_sheet_list' });
    const lAsk = (text, report, over = {}) => readAsk('get_workbook_context', 'sheets', list, text, report, over);
    assert.equal(verdict(sheets, lAsk('The workbook has 3 sheets.', { numbers: [3], items: [{ kind: 'count', anchor: 'sheetNames', value: 3 }] })), 'pass');
    const denied = lAsk('The workbook has 3 sheets.', { numbers: [3], items: [{ kind: 'count', anchor: 'sheetNames', value: 3 }] }, { calls: [{ name: 'get_workbook_context', denied: true }] });
    assert.equal(verdict(sheets, denied), 'fail');
  });

  it('keeps the sheet list out of the value leaves: a cell figure never traces to it', () => {
    const list = { sheets: [{ id: 'sheet-1', name: 'A' }, { id: 'sheet-2', name: 'B' }] };
    const c = mkCase({ tools: { allowed: ['read_sheet_list', 'read_range'], required: ['read_sheet_list'] } });
    assert.equal(verdict(c, readAsk('get_workbook_context', 'sheets', list, 'There are 2 sheets.', { numbers: [143] })), 'fail');
  });

  it('closes the wrong-reason residual: a figure that report.items marks as a count traces only via (d)', () => {
    const lookup = mkCase({
      id: 'HO-PPTX-993',
      format: 'pptx',
      tools: { allowed: ['read_slide'], required: ['read_slide'] },
      expected: { numeric: [{ name: 'v', value: 4, tolerance: 0, rounding: 'none', unit: 'count' }], structural: [], writes: 0, mustNotContain: [] },
      referenceAnswer: { numeric: { v: 4 }, structural: [], writes: 0, text: 'x' },
    });
    const withDigit = { slideCount: 3, slides: [{ index: 1, texts: ['Room 4'] }, { index: 2, texts: ['beta'] }, { index: 3, texts: ['gamma'] }] };
    const bare = sAsk('The room is 4.', { numbers: [4] }, withDigit);
    assert.equal(verdict(lookup, bare), 'pass', 'the control: a text leaf is a figure when no count item claims it');
    const marked = sAsk('The room is 4.', { numbers: [4], items: [slideItem(4)] }, withDigit);
    assert.equal(verdict(lookup, marked), 'fail', 'the same 4 as a marked count is not a text leaf');
    const docx = countCaseOf({ id: 'HO-DOCX-993', format: 'docx', anchor: 'heading_level_1', value: 2, numericName: 'heading1Count', tool: 'get_document_context', op: 'read_document' });
    const three = { paragraphCount: 4, blocks: [{ index: 0, style: 'Heading1', preview: '2 Scope' }, { index: 1, style: 'Heading1', preview: 'Plan' }, { index: 2, style: 'Heading1', preview: 'Risks' }, { index: 3, style: 'Normal', preview: 'body' }] };
    const listed = sAsk('The room is 4.', { numbers: [4], items: [{ kind: 'count', anchor: 'list_items', value: 4 }] }, withDigit);
    assert.equal(verdict(lookup, listed), 'pass', 'a count of a kind the table does not know leaves its integer to the ordinary trace');
    assert.equal(verdict(docx, readAsk('get_document_context', 'docs', three, 'There are 2 headings.', { numbers: [2], items: [{ kind: 'count', anchor: 'heading_level_1', value: 2 }] })), 'fail', 'a heading that begins with 2 does not make the count 2');
  });
});

describe('item 6 (R20-2): the request is never a figure source; applied-write values stay on', () => {
  const asked = mkCase({
    query: { vi: 'Synthetic 999', en: 'What about 999?' },
    tools: { allowed: ['read_sheet_list', 'read_range'], required: ['read_range'] },
    expected: { numeric: [{ name: 'v', value: 999, tolerance: 0, rounding: 'none', unit: 'VND' }], structural: [], writes: 0, mustNotContain: [] },
    referenceAnswer: { numeric: { v: 999 }, structural: [], writes: 0, text: 'x' },
  });
  it('fails a number copied from the question when no successful read returned it (X1)', () => {
    assert.equal(verdict(asked, mkAsk('The value is 999.', { numbers: [999] }, { toolResults: [{ name: 'read_range', text: JSON.stringify({ rows: [] }) }] })), 'fail');
    assert.equal(verdict(asked, mkAsk('The value is 999.', { numbers: [999] }, { toolResults: [{ name: 'read_range', text: readResult({ A1: 999 }) }] })), 'pass', 'the control: the read returns it');
  });
  it('keeps the value an applied write carries as a source', () => {
    const edit = mkCase({
      category: 'edit',
      tools: { allowed: ['read_sheet_list', 'read_range', 'write_range'], required: ['write_range'] },
      expected: { numeric: [{ name: 'v', value: 888, tolerance: 0, rounding: 'none', unit: 'VND' }], structural: [{ kind: 'cell', anchor: 'SheetZ!A1', value: '888' }], writes: 1, mustNotContain: [] },
      referenceAnswer: { numeric: { v: 888 }, structural: [{ kind: 'cell', anchor: 'SheetZ!A1', value: '888' }], writes: 1, text: 'x' },
    });
    const wrote = mkAsk('Wrote 888.', { numbers: [888], items: [{ kind: 'cell', anchor: 'SheetZ!A1', value: '888' }] }, {
      calls: [{ name: 'propose_operations' }],
      writes: 1,
      writeLog: [{ name: 'propose_operations', applied: true, args: { operations: [{ range: 'SheetZ!A1', value: 888 }] } }],
      toolResults: [],
    });
    assert.equal(verdict(edit, wrote), 'pass');
  });
});

describe('item 7 (R20-3): a percent change matches only a claim in percent units', () => {
  const pct = (value) => mkCase({
    expected: { numeric: [{ name: 'v', value, tolerance: 0, rounding: 'none', unit: '%' }], structural: [], writes: 0, mustNotContain: [] },
    referenceAnswer: { numeric: { v: value }, structural: [], writes: 0, text: 'x' },
  });
  const cells = { toolResults: [{ name: 'read_range', text: readResult({ A1: 50, B1: 70 }) }] };
  it('fails a bare amount equal to the percent change of two shown operands (X5)', () => {
    assert.equal(verdict(pct(40), mkAsk('Change 40 from 50 to 70.', { numbers: [40] }, cells)), 'fail');
  });
  it('keeps a figure written in percent units (X6), with or without the percent sign in report.numbers', () => {
    assert.equal(verdict(pct(40), mkAsk('Change 40% from 50 to 70.', { numbers: [40] }, cells)), 'pass');
    assert.equal(verdict(pct(40), mkAsk('Change 40% from 50 to 70.', { numbers: ['40%'] }, cells)), 'pass');
    assert.equal(verdict(pct(40), mkAsk('Change 40% since last year.', { numbers: [40] }, cells)), 'fail', 'operands not shown');
  });
  it('still reads a bare ratio-times-100 share as before', () => {
    const share = mkCase({
      id: 'HO-XLSX-997',
      expected: { numeric: [{ name: 'share', value: 138.33, tolerance: 0, rounding: '2dp', unit: '%' }], structural: [], writes: 0, mustNotContain: [] },
      referenceAnswer: { numeric: { share: 138.33 }, structural: [], writes: 0, text: 'x' },
    });
    assert.equal(verdict(share, mkAsk('Share 138.33 from 83 and 60.', { numbers: [138.33] })), 'pass');
  });
});

describe('item 8 (round h, H-1): a plain report number may trace to a percent leaf, nothing else relaxes', () => {
  const pctCase = mkCase({
    tools: { allowed: ['read_sheet_list', 'read_range'], required: ['read_range'] },
    expected: { numeric: [{ name: 'v', value: 25, tolerance: 0, rounding: 'none', unit: '%' }], structural: [], writes: 0, mustNotContain: [] },
    referenceAnswer: { numeric: { v: 25 }, structural: [], writes: 0, text: 'x' },
  });
  const cell = (value) => ({ toolResults: [{ name: 'read_range', text: readResult({ A1: value }) }] });
  it('passes a plain report 25 against a read "25%", with a percent, a bare or no figure in the prose', () => {
    assert.equal(verdict(pctCase, mkAsk('The rate is 25%.', { numbers: [25] }, cell('25%'))), 'pass');
    assert.equal(verdict(pctCase, mkAsk('Done.', { numbers: [25] }, cell('25%'))), 'pass');
  });
  it('fails a bare prose 25 against a read "25%" (prose stays strict)', () => {
    assert.equal(verdict(pctCase, mkAsk('The rate is 25.', { numbers: [25] }, cell('25%'))), 'fail');
    assert.equal(verdict(pctCase, mkAsk('The rate is 25.', { numbers: [] }, cell('25%'))), 'fail');
  });
  it('fails prose "25%" against a plain read leaf 25 (prose stays strict)', () => {
    assert.equal(verdict(pctCase, mkAsk('The rate is 25%.', { numbers: [25] }, cell(25))), 'fail');
  });
  it('fails a plain report 25 against any other marker or currency: k, m, bn, tr, triệu, tỷ, nghìn, ngàn', () => {
    for (const mark of ['25k', '25m', '25bn', '25tr', '25 triệu', '25 tỷ', '25 nghìn', '25 ngàn']) {
      assert.equal(verdict(pctCase, mkAsk('Done.', { numbers: [25] }, cell(mark))), 'fail', mark);
    }
  });
  it('keeps a plain report 25 against a plain read 25 as a pass', () => {
    assert.equal(verdict(pctCase, mkAsk('Done.', { numbers: [25] }, cell(25))), 'pass');
  });
  it('does not widen the percent change: a bare report number matches it only when the prose writes the value with a percent sign', () => {
    const pct40 = mkCase({
      expected: { numeric: [{ name: 'v', value: 40, tolerance: 0, rounding: 'none', unit: '%' }], structural: [], writes: 0, mustNotContain: [] },
      referenceAnswer: { numeric: { v: 40 }, structural: [], writes: 0, text: 'x' },
    });
    const cells = { toolResults: [{ name: 'read_range', text: readResult({ A1: 50, B1: 70 }) }] };
    assert.equal(verdict(pct40, mkAsk('Change 40 from 50 to 70.', { numbers: [40] }, cells)), 'fail', 'X5');
    assert.equal(verdict(pct40, mkAsk('Change 40% from 50 to 70.', { numbers: [40] }, cells)), 'pass', 'X6');
  });
});

// ---------- round i (review-g712-21 + the USER request-echo decision of 2026-10-18) ----------

describe('item 9 (round i, I-1): a number echoed from the question never fails an answer and never credits anything', () => {
  const asked = (en, value = 25, vi = 'Trong 10 ngày, giá trị là bao nhiêu?') => mkCase({
    query: { vi, en },
    tools: { allowed: ['read_sheet_list', 'read_range'], required: ['read_range'] },
    expected: { numeric: [{ name: 'v', value, tolerance: 0, rounding: 'none', unit: 'VND' }], structural: [], writes: 0, mustNotContain: [] },
    referenceAnswer: { numeric: { v: value }, structural: [], writes: 0, text: 'x' },
  });
  const cell = (value) => ({ toolResults: [{ name: 'read_range', text: readResult({ A1: value }) }] });
  const within10 = asked('Within 10 days, what is the value?');

  it('passes a prose echo of a question figure next to a correct traced answer', () => {
    assert.equal(verdict(within10, mkAsk('Within 10 days the value is 25.', { numbers: [25] }, cell(25))), 'pass');
    assert.equal(verdict(within10, mkAsk('Trong 10 ngày, giá trị là 25.', { numbers: [25] }, cell(25))), 'pass');
  });

  it('still fails a prose figure that the question does not state', () => {
    assert.equal(verdict(within10, mkAsk('Within 11 days the value is 25.', { numbers: [25] }, cell(25))), 'fail');
  });

  it('never credits an expected numeric: an echo that is the only figure of the slot fails', () => {
    const ten = asked('Within 10 days, what is the value?', 10);
    assert.equal(verdict(ten, mkAsk('The value is 10.', { numbers: [] }, cell(25))), 'fail');
    assert.equal(verdict(ten, mkAsk('The value is 10.', { numbers: [] }, { toolResults: [{ name: 'read_range', text: readResult({}) }] })), 'fail');
  });

  it('gives report.numbers no exemption: an echoed figure of the reporting line must still trace', () => {
    assert.equal(verdict(within10, mkAsk('Within 10 days the value is 25.', { numbers: [25, 10] }, cell(25))), 'fail');
    const ten = asked('Within 10 days, what is the value?', 10);
    assert.equal(verdict(ten, mkAsk('The value is 10.', { numbers: [10] }, { toolResults: [{ name: 'read_range', text: readResult({}) }] })), 'fail', 'X1 shape');
    assert.equal(verdict(ten, mkAsk('The value is 10.', { numbers: [10] }, cell(10))), 'pass', 'the control: the read returns it');
  });

  it('is not an echo when the unit or marker differs from the one in the question', () => {
    assert.equal(verdict(within10, mkAsk('Within 10k days the value is 25.', { numbers: [25] }, cell(25))), 'fail', '10k against a bare 10');
    assert.equal(verdict(within10, mkAsk('Within 10% of days the value is 25.', { numbers: [25] }, cell(25))), 'fail', '10% against a bare 10');
    const marked = asked('Within 10k days, what is the value?', 25, 'Trong 10k ngày, giá trị là bao nhiêu?');
    assert.equal(verdict(marked, mkAsk('Within 10k days the value is 25.', { numbers: [25] }, cell(25))), 'pass', 'the same marker is an echo');
    assert.equal(verdict(marked, mkAsk('Within 10 days the value is 25.', { numbers: [25] }, cell(25))), 'fail', 'a bare 10 against 10k');
  });
});

describe('item 10 (round i, R21-1): the heading-level label digit is no count', () => {
  const headings = { blocks: [{ index: 0, style: 'Heading2', preview: 'Alpha' }, { index: 1, style: 'Heading2', preview: 'Beta' }, { index: 2, style: 'Heading2', preview: 'Gamma' }] };
  const h2 = (value) => countCaseOf({ id: 'HO-DOCX-994', format: 'docx', anchor: 'heading_level_2', value, numericName: 'heading2Count', tool: 'get_document_context', op: 'read_document' });
  const dAsk = (text, report, result = headings) => readAsk('get_document_context', 'docs', result, text, report);
  const h2Item = (value) => ({ kind: 'count', anchor: 'heading_level_2', value });

  it('keeps the correct answer, the label digit of its own wording included', () => {
    assert.equal(verdict(h2(3), dAsk('There are 3 level 2 headings.', { numbers: [3], items: [h2Item(3)] })), 'pass');
    assert.equal(verdict(h2(3), dAsk('There are 3 headings level 2.', { numbers: [3], items: [h2Item(3)] })), 'pass');
    assert.equal(verdict(h2(3), dAsk('Counted.', { items: [h2Item(3)] })), 'pass', 'items only');
    assert.equal(verdict(h2(3), dAsk('Có 3 mục 2.', { numbers: [3], items: [h2Item(3)] })), 'pass', 'a bare "mục 2" is a label when the item names the level');
    assert.equal(verdict(h2(3), dAsk('Có 3 mục 2.', { numbers: [3], items: [{ kind: 'count', anchor: 'Meeting notes', value: 3 }] })), 'fail', 'but not when nothing names the level');
  });

  it('fails the level digit claimed as the count: 2 against three level 2 headings (C02, C03)', () => {
    assert.equal(verdict(h2(2), dAsk('Counted.', { numbers: [2], items: [h2Item(2)] })), 'fail');
    assert.equal(verdict(h2(2), dAsk('Counted.', { items: [h2Item(2)] })), 'fail', 'the items-only fill never takes a label digit');
  });

  it('fails a level digit for a kind the read does not hold (C27)', () => {
    assert.equal(verdict(h2(2), dAsk('Budget 2.', { numbers: [2], items: [h2Item(2)] }, { blocks: [{ index: 0, style: 'Normal', preview: 'Body' }] })), 'fail');
  });

  it('never credits the label digit as a report.numbers value or a stray prose figure', () => {
    const four = { blocks: [1, 2, 3, 4].map((i) => ({ index: i, style: 'Heading2', preview: `Head ${'ABCD'[i - 1]}` })) };
    assert.equal(verdict(h2(4), dAsk('There are 4 level 2 headings.', { numbers: [4], items: [h2Item(4)] }, four)), 'pass');
    assert.equal(verdict(h2(4), dAsk('There are 4 level 2 headings.', { numbers: [4, 2], items: [h2Item(4)] }, four)), 'fail', 'numbers 4 and 2');
    assert.equal(verdict(h2(4), dAsk('There are 4 level 2 headings. Budget 2.', { numbers: [4], items: [h2Item(4)] }, four)), 'fail', 'a stray 2 in the prose');
  });
});

describe('item 11 (round i, R21-2): a kind is named only by a closed phrase beside the figure', () => {
  const slides = { slideCount: 3, slides: [{ index: 1, texts: ['alpha'] }, { index: 2, texts: ['beta'] }, { index: 3, texts: ['gamma'] }] };
  const lookup = (tool, op, format, result, text, over = {}) => {
    const c = mkCase({
      id: 'HO-PPTX-995',
      format,
      category: 'lookup',
      tools: { allowed: [op], required: [op] },
      expected: { numeric: [{ name: 'v', value: 3, tolerance: 0, rounding: 'none', unit: 'VND' }], structural: [], writes: 0, mustNotContain: [] },
      referenceAnswer: { numeric: { v: 3 }, structural: [], writes: 0, text: 'x' },
    });
    return verdict(c, readAsk(tool, format === 'pptx' ? 'slides' : 'docs', result, text, { numbers: [3] }, over));
  };
  const doc = { paragraphCount: 3, blocks: [{ preview: 'Alpha' }, { preview: 'Beta' }, { preview: 'Gamma' }] };

  it('does not slide onto an unrelated word after the figure (C07)', () => {
    assert.equal(lookup('read_slide', 'read_slide', 'pptx', slides, 'Budget 3 while reviewing slides.'), 'fail');
    assert.equal(lookup('read_slide', 'read_slide', 'pptx', slides, 'The budget is 3 and the slides are done.'), 'fail');
  });

  it('names nothing for a modified kind, before or after the figure (C08)', () => {
    assert.equal(lookup('get_document_context', 'read_document', 'docx', doc, 'There are 3 changed paragraphs.'), 'fail');
    assert.equal(lookup('get_document_context', 'read_document', 'docx', doc, 'The number of changed paragraphs is 3.'), 'fail');
  });

  it('keeps the closed phrases: "3 slides", "slides: 3", "number of sheets is 3"', () => {
    assert.equal(lookup('read_slide', 'read_slide', 'pptx', slides, 'There are 3 slides.'), 'pass');
    assert.equal(lookup('read_slide', 'read_slide', 'pptx', slides, 'Slides: 3.'), 'pass');
    assert.equal(lookup('read_slide', 'read_slide', 'pptx', slides, 'The number of slides is 3.'), 'pass');
    assert.equal(lookup('get_document_context', 'read_document', 'docx', doc, 'There are 3 paragraphs in the document.'), 'pass');
  });
});

describe('item 12 (round i, R21-3): a count mark belongs to its item, and a percent claim never takes the count-only path', () => {
  const four = { paragraphCount: 5, blocks: [{ style: 'Heading2', preview: 'A' }, { style: 'Heading2', preview: 'B' }, { style: 'Heading2', preview: 'C' }, { style: 'Normal', preview: 'x' }, { style: 'Normal', preview: 'y' }] };
  it('does not let a wrong heading count borrow the true count of another named kind (C04)', () => {
    const c = countCaseOf({ id: 'HO-DOCX-996', format: 'docx', anchor: 'heading_level_2', value: 5, numericName: 'heading2Count', tool: 'get_document_context', op: 'read_document' });
    const items = [{ kind: 'count', anchor: 'heading_level_2', value: 5 }, { kind: 'count', anchor: 'paragraphs', value: 5 }];
    assert.equal(verdict(c, readAsk('get_document_context', 'docs', four, 'Counted.', { numbers: [5], items })), 'fail');
    const paragraphs = countCaseOf({ id: 'HO-DOCX-997', format: 'docx', anchor: 'paragraphs', value: 5, numericName: 'paragraphCount', tool: 'get_document_context', op: 'read_document' });
    assert.equal(verdict(paragraphs, readAsk('get_document_context', 'docs', four, 'Counted.', { numbers: [5], items: [items[1]] })), 'pass', 'the control: the item is backed');
  });
  it('keeps a same-valued percent leaf traceable beside a count item (C29)', () => {
    const slideCase = countCaseOf({ id: 'HO-PPTX-998', format: 'pptx', anchor: 'slides', value: 3, numericName: 'slideCount', tool: 'read_slide', op: 'read_slide' });
    const result = { slideCount: 3, slides: [{ texts: ['Rate 3%'] }, { texts: ['Beta'] }, { texts: ['Gamma'] }] };
    assert.equal(verdict(slideCase, readAsk('read_slide', 'slides', result, 'There are 3 slides. Rate 3%.', { numbers: [3], items: [{ kind: 'count', anchor: 'slides', value: 3 }] })), 'pass');
  });
});

describe('item 13 (round i, R21-4): markdown fences close by mark and run length, comments and inline code hold no heading', () => {
  const mdCase = countCaseOf({ id: 'HO-MD-990', format: 'md', anchor: 'heading_level_2', value: 1, numericName: 'heading2Count', tool: 'get_document_context', op: 'read_document' });
  const mdAsk = (lines, module = 'markdown', tool = 'get_document_context') => readAsk(tool, module, { lines }, 'Counted.', { numbers: [1], items: [{ kind: 'count', anchor: 'heading_level_2', value: 1 }] });
  it('fails a heading inside a fence that a different mark or a shorter run did not close (C13, C14)', () => {
    assert.equal(verdict(mdCase, mdAsk(['```text', '~~~', '## Alpha', '```'])), 'fail');
    assert.equal(verdict(mdCase, mdAsk(['````text', '```', '## Alpha', '````'])), 'fail');
  });
  it('fails a heading tag inside inline code or an HTML comment (C15, C16)', () => {
    assert.equal(verdict(mdCase, mdAsk(['Literal `<h2>Alpha</h2>` example.'])), 'fail');
    const htmlCase = countCaseOf({ id: 'HO-HTML-990', format: 'html', anchor: 'heading_level_2', value: 1, numericName: 'heading2Count', tool: 'read_source', op: 'read_document' });
    assert.equal(verdict(htmlCase, readAsk('read_source', 'html', { lines: ['<!-- <h2>Alpha</h2> -->'] }, 'Counted.', { numbers: [1], items: [{ kind: 'count', anchor: 'heading_level_2', value: 1 }] })), 'fail');
    assert.equal(verdict(htmlCase, readAsk('read_source', 'html', { lines: ['<!--', '<h2>Alpha</h2>', '-->'] }, 'Counted.', { numbers: [1], items: [{ kind: 'count', anchor: 'heading_level_2', value: 1 }] })), 'fail', 'a multi-line comment');
  });
  it('keeps real headings and the two fence controls (C11, C12)', () => {
    assert.equal(verdict(mdCase, mdAsk(['## Alpha'])), 'pass');
    assert.equal(verdict(mdCase, mdAsk(['```', '## Alpha', '```'])), 'fail', 'an ordinary fence');
    assert.equal(verdict(mdCase, mdAsk(['~~~~', '## Alpha', '~~~~~', '## Beta'])), 'pass', 'a longer run closes, the heading after it counts');
    const htmlCase = countCaseOf({ id: 'HO-HTML-991', format: 'html', anchor: 'heading_level_2', value: 1, numericName: 'heading2Count', tool: 'read_source', op: 'read_document' });
    assert.equal(verdict(htmlCase, readAsk('read_source', 'html', { lines: ['<h2>Alpha</h2>'] }, 'Counted.', { numbers: [1], items: [{ kind: 'count', anchor: 'heading_level_2', value: 1 }] })), 'pass');
  });
});

describe('item 14 (round i, R21-5): the percent-leaf exception reaches read leaves and compute results only', () => {
  const edit = mkCase({
    category: 'edit',
    tools: { allowed: ['read_sheet_list', 'read_range', 'write_range'], required: ['write_range'] },
    expected: { numeric: [{ name: 'v', value: 25, tolerance: 0, rounding: 'none', unit: '%' }], structural: [], writes: 1, mustNotContain: [] },
    referenceAnswer: { numeric: { v: 25 }, structural: [], writes: 1, text: 'x' },
  });
  const wrote = (value) => mkAsk('Done.', { numbers: [25] }, {
    calls: [{ name: 'propose_operations' }],
    writes: 1,
    writeLog: [{ name: 'propose_operations', applied: true, args: { operations: [{ range: 'SheetZ!A1', value }] } }],
    toolResults: [],
  });
  it('fails a plain report 25 against an applied write "25%" (H15), and passes it against a plain write', () => {
    assert.equal(verdict(edit, wrote('25%')), 'fail');
    assert.equal(verdict(edit, wrote(25)), 'pass');
  });
  it('keeps the read leaf and the compute result (H01, H16)', () => {
    const pctCase = mkCase({
      tools: { allowed: ['read_sheet_list', 'read_range'], required: ['read_range'] },
      expected: { numeric: [{ name: 'v', value: 25, tolerance: 0, rounding: 'none', unit: '%' }], structural: [], writes: 0, mustNotContain: [] },
      referenceAnswer: { numeric: { v: 25 }, structural: [], writes: 0, text: 'x' },
    });
    assert.equal(verdict(pctCase, mkAsk('Done.', { numbers: [25] }, { toolResults: [{ name: 'read_range', text: readResult({ A1: '25%' }) }] })), 'pass');
    const compute = mkCase({
      expected: { numeric: [{ name: 'v', value: 25, tolerance: 0, rounding: 'none', unit: '%' }], structural: [], writes: 0, mustNotContain: [] },
      referenceAnswer: { numeric: { v: 25 }, structural: [], writes: 0, text: 'x' },
    });
    const withCompute = mkAsk('Done.', { numbers: [25] }, {
      calls: [{ name: 'read_range' }, { name: 'aggregate_range' }],
      toolResults: [{ name: 'read_range', text: readResult({}) }, { name: 'aggregate_range', text: JSON.stringify({ sum: '25%' }) }],
    });
    assert.equal(verdict(compute, withCompute), 'pass');
  });
});
