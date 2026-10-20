// G7-08 (UNI-1385) AI matrix per format — row table and run expansion (proposal §2).
// Sources of truth:
//   - Design spec: docs/superpowers/specs/2026-10-02-office-g5-g6-g7-design.md §6.5
//   - Tool crosswalk: docs/office/g5g6g7/genoffice-tools.md §8 / §8.1
//   - Acceptance matrix: docs/office/g5g6g7/acceptance.md G6-A03..A06
//   - Fixture manifest: docs/office/g5g6g7/fixtures/manifest.json

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, loadVerifiedFixture } from '../harness/fixture-files.mjs';
import { BOUND_DOCUMENT_FORBIDDEN_TOOLS, PDF_FILE_LEVEL_PAGE_TOOLS } from './tools.mjs';

export { BOUND_DOCUMENT_FORBIDDEN_TOOLS, PDF_FILE_LEVEL_PAGE_TOOLS };

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = resolve(HERE, '../../../..');
export const ACCEPTANCE_REL = 'docs/office/g5g6g7/acceptance.md';

export const PROVIDERS = Object.freeze(['uniwork', 'byok']);
export const HOSTS = Object.freeze(['web', 'desktop']);
export const FORMATS = Object.freeze(['xlsx', 'docx', 'pptx', 'pdf', 'md', 'html']);
export const ROW_EXIT = Object.freeze({ PASS: 0, FAIL: 1, BLOCKED: 77 });

export const FORMAT_FEATURE_FLAGS = Object.freeze({
  xlsx: 'office_ai_uniwork_xlsx',
  docx: 'office_ai_uniwork_docx',
  pptx: 'office_ai_uniwork_pptx',
  pdf: 'office_ai_uniwork_pdf',
  md: 'office_ai_uniwork_markdown',
  html: 'office_ai_uniwork_html',
});

export const SERVER_FORMAT_TOKENS = Object.freeze({
  xlsx: 'xlsx',
  docx: 'docx',
  pptx: 'pptx',
  pdf: 'pdf',
  md: 'markdown',
  html: 'html',
});

export const EXPECTED_FIXTURE_SHAS = Object.freeze({
  'fx-xlsx-revenue-xyz': 'a93cd768ca51347a1225e15fa002a2969a46f8dc465d189b7478cdd5a948b446',
  'fx-docx-report-vi': '5e93b1dd7aefa0f8d816ccb7d5648b8bba4aa23eb5e95dbeddb3f045657c828c',
  'fx-pptx-deck-vi': '958a8086fb3b1927319f88c12259e2f3c67b78a3f956ee0323f1c7631b2e2b20',
  'fx-pdf-invoice-vi': '17603fe876d45bfbd936cb03b9930a988e7842ab2c4d143763d76ae8ab253cdd',
  'fx-md-notes-vi': 'e09e98a5e41d78549054e53d29effc882547629076776f4c93a08f5331856def',
  'fx-html-page-vi': 'e50b42f33ca5c560263d64f8c50022325abc067da525f26c18742065a7ebc884',
});

const TOOLS_MD = 'docs/office/g5g6g7/genoffice-tools.md';
const bothHostsGap = (...items) => ({ web: items, desktop: items });
const noMissing = () => ({ web: [], desktop: [] });

export const MATRIX_ROWS = Object.freeze([
  {
    id: 'X-R1',
    format: 'xlsx',
    module: 'sheets',
    operation: 'read',
    mode: 'automated',
    fixtureId: 'fx-xlsx-revenue-xyz',
    fixtureSha256: EXPECTED_FIXTURE_SHAS['fx-xlsx-revenue-xyz'],
    prompt:
      'Trên sheet "Doanh thu Q1", tính tổng doanh thu, số đơn hàng và trung bình doanh thu cột G (phạm vi A2:G7), nhóm theo Khu vực (cột B). Nêu rõ số dòng xử lý, dòng ẩn Q1-005 (dòng 6) và hai dòng tổng ở dòng 8–9.',
    expectedTools: ['aggregate_range', 'summarize_range', 'read_range', 'get_workbook_context'],
    primaryTools: ['aggregate_range', 'summarize_range'],
    forbiddenTools: ['create_document'],
    missingByHost: noMissing(),
    toolsSource: `${TOOLS_MD}:729-730`,
    acs: ['G6-A03', 'G6-A06'],
  },
  {
    id: 'X-R2',
    format: 'xlsx',
    module: 'sheets',
    operation: 'read',
    mode: 'automated',
    fixtureId: 'fx-xlsx-revenue-xyz',
    fixtureSha256: EXPECTED_FIXTURE_SHAS['fx-xlsx-revenue-xyz'],
    prompt:
      'Kiểm tra dữ liệu trên "Doanh thu Q1" và "Doanh thu Q2": phân biệt ô giảm giá Z nhập số 10 (F4) với 10% (F2) và ô trống (F5), nêu cách xử lý dòng ẩn (dòng 6), hai dòng tổng (SUM dòng 8 và SUBTOTAL dòng 9), đồng thời liệt kê các ô lỗi (#DIV/0!, #N/A, #REF!) trong workbook.',
    expectedTools: ['read_range', 'read_cells', 'read_formats', 'read_sheet_features', 'find_cells', 'summarize_range', 'aggregate_range'],
    primaryTools: ['read_range', 'read_cells', 'read_formats', 'read_sheet_features', 'find_cells', 'summarize_range'],
    forbiddenTools: ['create_document'],
    missingByHost: bothHostsGap({
      gap: 'missing: thống kê ngoại lai/kiểu không đồng nhất trong cột',
      source: `${TOOLS_MD}:733`,
    }),
    toolsSource: `${TOOLS_MD}:733-741`,
    acs: ['G6-A03', 'G6-A06'],
  },
  {
    id: 'X-E1',
    format: 'xlsx',
    module: 'sheets',
    operation: 'edit',
    mode: 'automated',
    fixtureId: 'fx-xlsx-revenue-xyz',
    fixtureSha256: EXPECTED_FIXTURE_SHAS['fx-xlsx-revenue-xyz'],
    target: { sheet: 'Doanh thu Q1', range: 'AA2:AA7' },
    prompt:
      'Trên sheet "Doanh thu Q1", ghi công thức tính doanh thu X * Y * (1 - Z) với quy tắc IF(F>1, F/100, F) vào đúng vùng AA2:AA7 (từ AA2 đến AA7); giữ nguyên các cột A..G và các sheet khác.',
    expectedTools: ['get_workbook_context', 'read_range', 'propose_operations'],
    primaryTools: ['propose_operations'],
    forbiddenTools: [...BOUND_DOCUMENT_FORBIDDEN_TOOLS],
    missingByHost: noMissing(),
    toolsSource: `${TOOLS_MD}:734,742`,
    acs: ['G6-A03', 'G6-A04', 'G6-A06'],
  },
  {
    id: 'D-R1',
    format: 'docx',
    module: 'docs',
    operation: 'read',
    mode: 'automated',
    fixtureId: 'fx-docx-report-vi',
    fixtureSha256: EXPECTED_FIXTURE_SHAS['fx-docx-report-vi'],
    prompt:
      'Tóm tắt nội dung báo cáo và trích dẫn nguyên văn kèm chỉ số block (anchor) cho đoạn dưới mục "1. Tóm tắt điều hành" và đoạn dưới mục "2.1. Ghi chú về dữ liệu".',
    expectedTools: ['get_document_context', 'read_blocks'],
    primaryTools: ['get_document_context', 'read_blocks'],
    forbiddenTools: ['create_document'],
    missingByHost: bothHostsGap({
      gap: 'missing: công cụ so sánh hai tài liệu',
      source: `${TOOLS_MD}:719`,
    }),
    toolsSource: `${TOOLS_MD}:719`,
    acs: ['G6-A03', 'G6-A06'],
  },
  {
    id: 'D-E1',
    format: 'docx',
    module: 'docs',
    operation: 'edit',
    mode: 'automated',
    fixtureId: 'fx-docx-report-vi',
    fixtureSha256: EXPECTED_FIXTURE_SHAS['fx-docx-report-vi'],
    target: {
      paragraphIndex: 2,
      heading: '1. Tóm tắt điều hành',
      requiredTokens: ['22.060.000', '9.060.000'],
    },
    prompt:
      'Chỉ viết lại đoạn văn thứ 3 (block ngay dưới tiêu đề "1. Tóm tắt điều hành") thành một câu ngắn gọn nêu tổng doanh thu quý 1 đạt 22.060.000 đồng và khu vực Bắc đạt 9.060.000 đồng; giữ nguyên bảng doanh thu và mọi đoạn văn khác.',
    expectedTools: ['get_document_context', 'read_blocks', 'replace_selection', 'replace_blocks', 'apply_ops'],
    primaryTools: ['replace_selection', 'replace_blocks', 'apply_ops'],
    forbiddenTools: [...BOUND_DOCUMENT_FORBIDDEN_TOOLS],
    missingByHost: bothHostsGap(
      { gap: 'missing: rào code giới hạn sửa trong vùng chọn', source: `${TOOLS_MD}:719` },
      { gap: 'missing: tôn trọng bảo vệ Word', source: `${TOOLS_MD}:719` },
    ),
    toolsSource: `${TOOLS_MD}:719`,
    acs: ['G6-A03', 'G6-A04', 'G6-A05', 'G6-A06'],
  },
  {
    id: 'D-W1',
    format: 'docx',
    module: 'docs',
    operation: 'edit',
    mode: 'hitl',
    fixtureId: 'fx-docx-report-vi',
    fixtureSha256: EXPECTED_FIXTURE_SHAS['fx-docx-report-vi'],
    target: { paragraphIndex: 2, heading: '1. Tóm tắt điều hành', manualCheck: 'open-in-word' },
    prompt:
      'Mở tệp DOCX của phiên bản mới đã Lưu sau lượt sửa D-E1 trong Microsoft Word để xác nhận tệp mở sạch, không báo lỗi OOXML và giữ nguyên bảng doanh thu.',
    expectedTools: [],
    primaryTools: [],
    forbiddenTools: [...BOUND_DOCUMENT_FORBIDDEN_TOOLS],
    missingByHost: noMissing(),
    toolsSource: 'docs/office/g5g6g7/acceptance.md:76',
    acs: ['G6-A05'],
  },
  {
    id: 'P-R1',
    format: 'pptx',
    module: 'slides',
    operation: 'read',
    mode: 'automated',
    fixtureId: 'fx-pptx-deck-vi',
    fixtureSha256: EXPECTED_FIXTURE_SHAS['fx-pptx-deck-vi'],
    prompt:
      'Đọc cả 3 slide của bài thuyết trình và liệt kê chỉ số từng slide kèm nội dung nguyên văn của mọi text shape và bảng trên từng slide.',
    expectedTools: ['read_slide'],
    primaryTools: ['read_slide'],
    forbiddenTools: [...BOUND_DOCUMENT_FORBIDDEN_TOOLS],
    missingByHost: noMissing(),
    toolsSource: `${TOOLS_MD}:744`,
    acs: ['G6-A03', 'G6-A06'],
  },
  {
    id: 'P-E1',
    format: 'pptx',
    module: 'slides',
    operation: 'edit',
    mode: 'automated',
    fixtureId: 'fx-pptx-deck-vi',
    fixtureSha256: EXPECTED_FIXTURE_SHAS['fx-pptx-deck-vi'],
    target: {
      slideIndex: 1,
      shapeId: 3,
      shapeName: 'Nội dung 2',
      expectedText: 'Báo cáo tổng hợp doanh thu quý 1 năm 2026',
    },
    prompt:
      'Trên slide 1, chỉ sửa văn bản của text shape phụ đề "Nội dung 2" (shape id 3: "Bản trình bày tổng hợp từ dữ liệu mẫu") thành "Báo cáo tổng hợp doanh thu quý 1 năm 2026"; giữ nguyên tiêu đề slide 1 và toàn bộ slide 2, slide 3.',
    expectedTools: ['read_slide', 'apply_ops', 'execute_slide_script'],
    primaryTools: ['apply_ops', 'execute_slide_script'],
    forbiddenTools: [...BOUND_DOCUMENT_FORBIDDEN_TOOLS],
    missingByHost: noMissing(),
    toolsSource: `${TOOLS_MD}:745`,
    acs: ['G6-A03', 'G6-A04', 'G6-A06'],
  },
  {
    id: 'F-R1',
    format: 'pdf',
    module: 'pdf',
    operation: 'read',
    mode: 'automated',
    fixtureId: 'fx-pdf-invoice-vi',
    fixtureSha256: EXPECTED_FIXTURE_SHAS['fx-pdf-invoice-vi'],
    prompt:
      'Đọc trang 1 của hóa đơn PDF và trích xuất kèm chỉ số trang (page anchor): số hóa đơn, ngày lập, đơn vị bán, người mua, từng dòng hàng hóa và tổng thanh toán.',
    expectedTools: ['read_pages', 'search_text', 'goto_page', 'get_outline'],
    primaryTools: ['read_pages', 'search_text'],
    forbiddenTools: [...BOUND_DOCUMENT_FORBIDDEN_TOOLS],
    missingByHost: noMissing(),
    toolsSource: `${TOOLS_MD}:746`,
    acs: ['G6-A03', 'G6-A06'],
  },
  {
    id: 'F-E1',
    format: 'pdf',
    module: 'pdf',
    operation: 'edit',
    mode: 'automated',
    fixtureId: 'fx-pdf-invoice-vi',
    fixtureSha256: EXPECTED_FIXTURE_SHAS['fx-pdf-invoice-vi'],
    target: {
      page: 1,
      targetText: 'Số hóa đơn: HD-2026-0001',
      expectedPatchText: 'Số hóa đơn: HD-2026-0001-AI',
    },
    prompt:
      'Trên trang 1 của hóa đơn PDF, chỉ sửa dòng văn bản "Số hóa đơn: HD-2026-0001" thành "Số hóa đơn: HD-2026-0001-AI"; giữ nguyên mọi dòng văn bản và bảng khác trên trang.',
    expectedTools: ['read_pages', 'edit_text', 'edit_block', 'move_text_block', 'insert_text'],
    primaryTools: ['edit_text', 'insert_text'],
    forbiddenTools: [...BOUND_DOCUMENT_FORBIDDEN_TOOLS],
    missingByHost: {
      web: [
        {
          gap: 'missing: ẩn công cụ sửa text khi pdfium không có',
          source: `${TOOLS_MD}:747`,
          owner: 'G6-05/G6-03a',
        },
      ],
      desktop: [],
    },
    toolsSource: `${TOOLS_MD}:747`,
    acs: ['G6-A03', 'G6-A04', 'G6-A06'],
  },
  {
    id: 'M-R1',
    format: 'md',
    module: 'markdown',
    operation: 'read',
    mode: 'automated',
    fixtureId: 'fx-md-notes-vi',
    fixtureSha256: EXPECTED_FIXTURE_SHAS['fx-md-notes-vi'],
    prompt:
      'Đọc tài liệu Markdown theo từng heading, trích dẫn nội dung dưới mục "## Tóm tắt" và hai mục trong "## Việc cần làm" kèm chỉ số block.',
    expectedTools: ['get_document_context', 'read_blocks', 'read_frontmatter'],
    primaryTools: ['get_document_context', 'read_blocks'],
    forbiddenTools: [...BOUND_DOCUMENT_FORBIDDEN_TOOLS],
    missingByHost: bothHostsGap({
      gap: 'missing: tra theo tên heading hoặc theo khoảng ký tự nguồn',
      source: `${TOOLS_MD}:722`,
    }),
    toolsSource: `${TOOLS_MD}:722`,
    acs: ['G6-A03', 'G6-A06'],
  },
  {
    id: 'M-E1',
    format: 'md',
    module: 'markdown',
    operation: 'edit',
    mode: 'automated',
    fixtureId: 'fx-md-notes-vi',
    fixtureSha256: EXPECTED_FIXTURE_SHAS['fx-md-notes-vi'],
    target: { heading: '## Tóm tắt', lineIndex: 6 },
    prompt:
      'Chỉ sửa đoạn văn ngay dưới tiêu đề "## Tóm tắt" (dòng "Tổng doanh thu quý 1 là 22.060.000 đồng, tính cả các dòng bị ẩn.") thành "Tổng doanh thu quý 1 đạt 22.060.000 đồng (đã gồm đơn hàng ẩn)."; giữ nguyên mọi tiêu đề, bảng, khối code và danh sách Việc cần làm.',
    expectedTools: ['get_document_context', 'read_blocks', 'apply_ops', 'write_document'],
    primaryTools: ['apply_ops'],
    forbiddenTools: [...BOUND_DOCUMENT_FORBIDDEN_TOOLS],
    missingByHost: noMissing(),
    toolsSource: `${TOOLS_MD}:722`,
    acs: ['G6-A03', 'G6-A04', 'G6-A06'],
  },
  {
    id: 'H-R1',
    format: 'html',
    module: 'html',
    operation: 'read',
    mode: 'automated',
    fixtureId: 'fx-html-page-vi',
    fixtureSha256: EXPECTED_FIXTURE_SHAS['fx-html-page-vi'],
    prompt:
      'Đọc cấu trúc outline và mã nguồn trang HTML, tóm tắt tiêu đề <h1>, bảng doanh thu quý 1 và đoạn ghi chú dưới <h2>.',
    expectedTools: ['get_outline', 'read_source'],
    primaryTools: ['get_outline', 'read_source'],
    forbiddenTools: [...BOUND_DOCUMENT_FORBIDDEN_TOOLS],
    missingByHost: bothHostsGap({
      gap: 'missing: trích văn bản thuần',
      source: `${TOOLS_MD}:723`,
    }),
    toolsSource: `${TOOLS_MD}:723`,
    acs: ['G6-A03', 'G6-A06'],
  },
  {
    id: 'H-E1',
    format: 'html',
    module: 'html',
    operation: 'edit',
    mode: 'automated',
    fixtureId: 'fx-html-page-vi',
    fixtureSha256: EXPECTED_FIXTURE_SHAS['fx-html-page-vi'],
    target: { selector: 'main > p', tag: 'p' },
    prompt:
      'Chỉ sửa nội dung văn bản của phần tử <p> ngay dưới tiêu đề <h2>Ghi chú</h2> thành "Dữ liệu mẫu kiểm thử đã xác nhận, bao gồm các đơn hàng ẩn."; giữ nguyên <h1>, bảng <table> và các thẻ khác.',
    expectedTools: ['get_outline', 'read_source', 'apply_ops'],
    primaryTools: ['apply_ops'],
    forbiddenTools: [...BOUND_DOCUMENT_FORBIDDEN_TOOLS, 'plan_page', 'write_document'],
    missingByHost: bothHostsGap({
      gap: 'missing: làm sạch HTML do AI viết',
      source: `${TOOLS_MD}:723`,
    }),
    toolsSource: `${TOOLS_MD}:723`,
    acs: ['G6-A03', 'G6-A04', 'G6-A06'],
  },
]);

export const CAPABILITY_ROWS = Object.freeze(MATRIX_ROWS.filter((row) => row.mode === 'automated'));
export const HITL_ROWS = Object.freeze(MATRIX_ROWS.filter((row) => row.mode === 'hitl'));

export function verifyRowFixtures({ rows = MATRIX_ROWS, repoRoot = DEFAULT_REPO_ROOT } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('rows must be a non-empty array');
  }
  const manifest = loadManifest(repoRoot);
  const byId = new Map(manifest.fixtures.map((f) => [f.id, f]));
  const acceptanceText = readFileSync(join(repoRoot, ACCEPTANCE_REL), 'utf8');

  for (const row of rows) {
    if (!row || typeof row.id !== 'string') {
      throw new Error('row is missing an id');
    }
    const entry = byId.get(row.fixtureId);
    if (!entry) {
      throw new Error(`row ${row.id}: fixture "${row.fixtureId}" is not in manifest.json`);
    }
    if (row.fixtureSha256 !== entry.sha256) {
      throw new Error(
        `row ${row.id}: fixture ${row.fixtureId} sha256 mismatch vs manifest: expected ${entry.sha256}, got ${row.fixtureSha256}`,
      );
    }
    const acceptanceToken = `${row.fixtureId} (${row.fixtureSha256})`;
    if (!acceptanceText.includes(acceptanceToken)) {
      throw new Error(`row ${row.id}: "${acceptanceToken}" not found in ${ACCEPTANCE_REL}`);
    }
    loadVerifiedFixture(row.fixtureId, repoRoot);
  }
  return true;
}

export function getRowById(rowId) {
  return MATRIX_ROWS.find((row) => row.id === rowId) ?? null;
}

function buildRunEntry(row, provider, host, mode) {
  const runId = mode === 'hitl' ? `${row.id}:${provider}:${host}:hitl` : `${row.id}:${provider}:${host}`;
  return {
    runId,
    rowId: row.id,
    format: row.format,
    module: row.module,
    operation: row.operation,
    mode,
    provider,
    host,
    fixtureId: row.fixtureId,
    fixtureSha256: row.fixtureSha256,
    prompt: row.prompt,
    target: row.target ?? null,
    expectedTools: row.expectedTools,
    primaryTools: row.primaryTools,
    forbiddenTools: row.forbiddenTools,
    knownMissing: row.missingByHost?.[host] ?? [],
    acs: row.acs,
    featureFlag: FORMAT_FEATURE_FLAGS[row.format],
  };
}

let canonicalFixturesVerified = false;

export function expandMatrixRuns({ rows = MATRIX_ROWS, providers = PROVIDERS, hosts = HOSTS } = {}) {
  if (rows === MATRIX_ROWS && !canonicalFixturesVerified) {
    verifyRowFixtures({ rows: MATRIX_ROWS, repoRoot: DEFAULT_REPO_ROOT });
    canonicalFixturesVerified = true;
  }
  const capabilityRows = rows.filter((r) => r.mode === 'automated');
  const hitlRows = rows.filter((r) => r.mode === 'hitl');
  const orderedHosts = [...hosts].sort((a, b) => (a === 'web' ? -1 : b === 'web' ? 1 : a.localeCompare(b)));

  const automated = [];
  for (const host of orderedHosts) {
    for (const provider of providers) {
      for (const row of capabilityRows) {
        automated.push(buildRunEntry(row, provider, host, 'automated'));
      }
    }
  }
  const hitl = [];
  for (const provider of providers) {
    for (const row of hitlRows) {
      hitl.push(buildRunEntry(row, provider, 'web', 'hitl'));
    }
  }
  return [...automated, ...hitl];
}
