// Fixture-backed tool backend for the G7-12 holdout runner (UNI-1384).
//
// The façade only relays the tools the caller offers; the frame executes them against the open document. This module
// is the frame's stand-in for the eval: it offers EVERY genoffice tool of the modules of the case's fixtures, the same
// list for every case of a module whatever the case expects (names verified against docs/office/g5g6g7/genoffice-tools.md
// by holdout-run.test.mjs; the case allowlist is only a grading oracle, never a filter), answers their calls from the
// synthetic fixtures read at runtime, applies the case setup (overlay, removeCells, revokeAfterTool, serverVersionAhead,
// viewer role) and counts the writes it let through. Nothing here names a case: every question, answer and marker stays
// under docs/office/g5g6g7/holdout/.
//
// Multi-document cases (several fixtures) open every fixture; a tool name that two modules share goes to the first
// fixture's module. Known v1 limits, listed in the G7-12 report: a write is counted but not applied to the view, number
// formats of xlsx cells are not read (read_formats reports the cell type only), and docs/slides/pdf/markdown/html have no
// compute tool, so the runner's adapter treats `compute` there as "the reply reported a figure".

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOCS_TOOL_SCHEMAS, SHEETS_TOOL_SCHEMAS } from '../devset-run.mjs';
import { parseMechanicalTable } from '../instruction-pack-tools.mjs';
import { readStyleFormatKinds, readWorkbook, unzip } from './holdout-xlsx-truth.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const FIXTURES_DIR = path.join(repoRoot, 'docs/office/g5g6g7/fixtures');
export const WRITE_OPERATIONS = new Set(['write_range', 'edit_paragraph']);

// genoffice tool (per module) -> the abstract operation(s) of the holdout cases. A tool that is not listed here is
// never offered, and a call to it is reported to the scorer under its own name, so it counts as outside the allowlist.
export const TOOL_OPS = {
  sheets: {
    get_workbook_context: ['read_sheet_list'],
    read_range: ['read_range'],
    read_cells: ['read_range'],
    read_formats: ['read_range'],
    read_sheet_features: ['read_range'],
    find_cells: ['read_range'],
    trace_precedents: ['read_range'],
    aggregate_range: ['compute'],
    summarize_range: ['compute'],
    ask_clarification: ['ask_clarification'],
    propose_operations: ['write_range'],
  },
  docs: {
    get_document_context: ['read_document'],
    read_blocks: ['read_document', 'read_table'],
    replace_selection: ['edit_paragraph'],
    replace_blocks: ['edit_paragraph'],
    apply_ops: ['edit_paragraph'],
    ask_clarification: ['ask_clarification'],
  },
  slides: { read_slide: ['read_slide'], apply_ops: ['edit_paragraph'], ask_clarification: ['ask_clarification'] },
  pdf: {
    read_pages: ['read_page'],
    search_text: ['read_page'],
    get_outline: ['read_page'],
    edit_text: ['edit_paragraph'],
    edit_block: ['edit_paragraph'],
    ask_clarification: ['ask_clarification'],
  },
  markdown: {
    get_document_context: ['read_document', 'read_table'],
    read_blocks: ['read_document', 'read_table'],
    read_frontmatter: ['read_document'],
    apply_ops: ['edit_paragraph'],
    ask_clarification: ['ask_clarification'],
  },
  html: {
    get_outline: ['read_document', 'read_table'],
    read_source: ['read_document', 'read_table'],
    apply_ops: ['edit_paragraph'],
    ask_clarification: ['ask_clarification'],
  },
};

const MODULE_OF_FORMAT = { xlsx: 'sheets', docx: 'docs', pptx: 'slides', pdf: 'pdf', md: 'markdown', html: 'html' };
const FIXTURE_FORMAT = (id) => /^fx-([a-z]+)-/.exec(id)?.[1] ?? '';

/** The genoffice module of every fixture of a case, in order and without repeats (the first is the open document). */
export function modulesOfCase(caseDoc) {
  const modules = caseDoc.fixtures.map((f) => MODULE_OF_FORMAT[FIXTURE_FORMAT(f.id)] ?? 'docs');
  return [...new Set(modules)];
}
export const moduleOfCase = (caseDoc) => modulesOfCase(caseDoc)[0];

const loose = (name, description) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties: {}, additionalProperties: true } },
});

// Where each offered schema came from (file | devset | name-only), kept beside the schema, never inside it.
const TOOL_ORIGIN = new WeakMap();
// Names a --tool-schemas file carries for a module that the harness does not map (so it can never offer them), per catalogue.
const TOOL_DROPPED = new WeakMap();
const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

/**
 * Tool schemas per module. sheets/docs reuse the dev set's schemas (the ones the frame sends); the other modules get
 * name-only schemas until the real ones are supplied with --tool-schemas (a real run needs them, see the report).
 * Each tool remembers where its schema came from (file | devset | name-only) so the run can say which surface it used.
 */
export function toolCatalogue(overrides = null) {
  const out = {};
  const dropped = {};
  for (const [module, ops] of Object.entries(TOOL_OPS)) {
    const base = module === 'sheets' ? SHEETS_TOOL_SCHEMAS : module === 'docs' ? DOCS_TOOL_SCHEMAS : [];
    const fromDevset = new Map(base.map((t) => [t.function.name, t]));
    const fromFile = new Map((overrides?.[module] ?? []).map((t) => [t.function.name, t]));
    dropped[module] = [...fromFile.keys()].filter((name) => !(name in ops)).sort();
    out[module] = Object.keys(ops).map((name) => {
      const tool = fromFile.get(name) ?? fromDevset.get(name);
      if (tool) {
        TOOL_ORIGIN.set(tool, fromFile.has(name) ? 'file' : 'devset');
        return tool;
      }
      const hollow = loose(name, `Tool ${name} of the ${module} module of the open document.`);
      TOOL_ORIGIN.set(hollow, 'name-only');
      return hollow;
    });
  }
  TOOL_DROPPED.set(out, dropped);
  return out;
}

/** Tools per module of the release's frame, read at runtime from the extracted table (docs/office/g5g6g7/genoffice-tools.md); null if unreadable. */
export function frameToolCounts(file = path.join(repoRoot, 'docs/office/g5g6g7/genoffice-tools.md')) {
  try {
    const { byModule } = parseMechanicalTable(fs.readFileSync(file, 'utf8'));
    return Object.fromEntries([...byModule].map(([module, tools]) => [module, tools.size]));
  } catch {
    return null;
  }
}

/**
 * What the model is offered per module and where the schemas came from: source is `file:<sha256 of the --tool-schemas
 * file>` when any tool comes from it, `name-only` when any tool has only a name (the strictest wins), else `devset`.
 * `offered` of `frameTotal` says how much of the module's tool table the model could ever call (the harness maps only a
 * subset, G712-20) and `droppedFromFile` lists tools a --tool-schemas file describes that the harness cannot offer: a file
 * can only describe the mapped tools, it never widens the surface.
 */
export function toolSurface(catalogue, { fileSha256 = null, frameTotals = frameToolCounts() } = {}) {
  const out = {};
  const dropped = TOOL_DROPPED.get(catalogue) ?? {};
  for (const [module, tools] of Object.entries(catalogue)) {
    const origins = tools.map((t) => TOOL_ORIGIN.get(t) ?? 'devset');
    const source = origins.includes('name-only') ? 'name-only' : origins.includes('file') ? `file:${fileSha256 ?? 'unknown'}` : 'devset';
    const names = tools.map((t) => t.function.name).sort();
    const byName = [...tools].sort((a, b) => a.function.name.localeCompare(b.function.name));
    out[module] = {
      source, tools: names, offered: names.length, frameTotal: frameTotals?.[module] ?? null, droppedFromFile: dropped[module] ?? [],
      schemasSha256: sha256Hex(JSON.stringify(byName)),
    };
  }
  return out;
}

/**
 * Tools offered for a case: every tool of each fixture module's catalogue (first module wins a name), the same list for
 * every case of a module. The case's allowlist, refusal and write ceiling never shape it (G712-1): they only grade
 * what the model did with the tools. A viewer gets the write tools too; the backend refuses them, as the frame would.
 */
export function offeredTools(caseDoc, catalogue = toolCatalogue()) {
  const seen = new Set();
  const out = [];
  for (const module of modulesOfCase(caseDoc)) {
    for (const tool of catalogue[module]) {
      const name = tool.function.name;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(tool);
    }
  }
  return out;
}

/** Abstract operations of one tool across the modules of a case, or null when no module maps it (reported by its own name). */
export function opsOfTool(modules, name) {
  for (const module of [].concat(modules)) if (TOOL_OPS[module]?.[name]) return TOOL_OPS[module][name];
  return null;
}

/** Operations no offered tool can serve (the adapter handles `refuse` and, outside sheets, `compute`). */
export function unobtainableOps(caseDoc, tools) {
  const modules = modulesOfCase(caseDoc);
  const served = new Set(tools.flatMap((t) => opsOfTool(modules, t.function.name) ?? []));
  return caseDoc.tools.required.filter((op) => !served.has(op) && op !== 'refuse' && op !== 'compute');
}

// ---- fixture views ----

const unesc = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const textOf = (xml, tag) =>
  unesc([...xml.matchAll(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'gs'))].map((m) => m[1]).join(''));

function docxBlocks(file) {
  const xml = unzip(fs.readFileSync(file)).get('word/document.xml').toString('utf8');
  const blocks = [];
  for (const m of xml.matchAll(/<w:tbl>.*?<\/w:tbl>|<w:p[ >].*?<\/w:p>/gs)) {
    if (m[0].startsWith('<w:tbl>')) {
      const rows = [...m[0].matchAll(/<w:tr>.*?<\/w:tr>/gs)].map((r) =>
        [...r[0].matchAll(/<w:tc>.*?<\/w:tc>/gs)].map((c) => textOf(c[0], 'w:t')),
      );
      blocks.push({ index: blocks.length, style: 'Table', rows });
    } else {
      const style = /<w:pStyle w:val="([^"]+)"/.exec(m[0])?.[1] ?? 'Normal';
      blocks.push({ index: blocks.length, style, text: textOf(m[0], 'w:t') });
    }
  }
  return blocks;
}

function pptxSlides(file) {
  const zip = unzip(fs.readFileSync(file));
  const names = [...zip.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  names.sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
  return names.map((name, i) => {
    const xml = zip.get(name).toString('utf8');
    const texts = [...xml.matchAll(/<a:p>.*?<\/a:p>/gs)].map((p) => textOf(p[0], 'a:t')).filter(Boolean);
    return { index: i + 1, texts };
  });
}

/** Loads one fixture as a plain view; every read tool answers from it. */
export function loadView(fixtureId, dir = FIXTURES_DIR) {
  const base = path.join(dir, fixtureId);
  const format = FIXTURE_FORMAT(fixtureId);
  const oracle = JSON.parse(fs.readFileSync(`${base}.oracle.json`, 'utf8'));
  if (format === 'xlsx') return { format, workbook: { sheets: readWorkbook(`${base}.xlsx`), formatKinds: readStyleFormatKinds(`${base}.xlsx`) } };
  if (format === 'docx') return { format, blocks: docxBlocks(`${base}.docx`) };
  if (format === 'pptx') return { format, slides: pptxSlides(`${base}.pptx`), titles: oracle.slides };
  if (format === 'pdf') return { format, pages: [{ page: 1, lines: [...(oracle.textLines ?? [])] }], pageCount: oracle.pageCount };
  const ext = format === 'md' ? 'md' : 'html';
  return { format, lines: fs.readFileSync(`${base}.${ext}`, 'utf8').split('\n') };
}

const colNum = (letters) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const colName = (n) => {
  let s = '';
  for (let v = n; v > 0; v = Math.floor((v - 1) / 26)) s = String.fromCharCode(65 + ((v - 1) % 26)) + s;
  return s;
};
const splitCell = (ref) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m ? { col: colNum(m[1]), row: Number(m[2]) } : null;
};
const parseRange = (range) => {
  const part = String(range ?? '').split('!').pop().replace(/\$/g, '').toUpperCase();
  const [a, b = a] = part.split(':');
  const s = splitCell(a);
  const e = splitCell(b);
  return s && e ? { c1: Math.min(s.col, e.col), c2: Math.max(s.col, e.col), r1: Math.min(s.row, e.row), r2: Math.max(s.row, e.row) } : null;
};

/** Applies the setup entries that name this fixture to the (freshly loaded) view; the fixture on disk is never touched. */
function applySetup(view, fixtureId, setup = {}) {
  const mine = (setup.overlay ?? []).filter((entry) => entry.fixtureId === fixtureId);
  if (view.format === 'xlsx') {
    for (const entry of mine) {
      const sheet = view.workbook.sheets[entry.sheet];
      if (!sheet || !entry.cell) continue;
      if (entry.op === 'set_cell') sheet.cells[entry.cell] = { v: entry.value, f: null, t: 'str' };
      else if (entry.op === 'clear_cell') delete sheet.cells[entry.cell];
    }
    for (const ref of setup.removeCells ?? []) {
      const [sheetName, cell] = ref.split('!');
      delete view.workbook.sheets[sheetName]?.cells[cell];
    }
    return;
  }
  for (const entry of mine) {
    if (entry.op !== 'insert_after') continue;
    const head = String(entry.anchor).split('/')[0];
    if (view.blocks) {
      const at = view.blocks.findIndex((b) => b.text?.startsWith(head));
      view.blocks.splice(at < 0 ? view.blocks.length : at + 1, 0, { index: 0, style: 'Normal', text: entry.value });
      view.blocks.forEach((b, i) => { b.index = i; });
    } else if (view.slides) {
      const slide = view.slides[Math.max(0, (Number(/slide (\d+)/.exec(entry.anchor)?.[1]) || 1) - 1)];
      slide.texts.push(entry.value);
    } else if (view.pages) view.pages[0].lines.push(entry.value);
    else view.lines.push(entry.value);
  }
}

/** Every text of an opened document (cells, blocks, table cells, slide shapes, page lines): what an edit can be compared with. */
function viewText(view) {
  const parts = [];
  if (view.workbook) {
    for (const [name, sheet] of Object.entries(view.workbook.sheets)) {
      parts.push(name);
      for (const cell of Object.values(sheet.cells)) if (cell.v !== null && cell.v !== undefined) parts.push(String(cell.v));
    }
  }
  for (const block of view.blocks ?? []) parts.push(block.text ?? '', ...(block.rows ?? []).flat());
  for (const slide of view.slides ?? []) parts.push(...slide.texts);
  parts.push(...(view.titles ?? []).filter((t) => typeof t === 'string'));
  for (const page of view.pages ?? []) parts.push(...page.lines);
  parts.push(...(view.lines ?? []));
  return parts.join('\n');
}

const cellText = (cell) => {
  if (!cell) return null;
  const shown = cell.v === null ? '' : String(cell.v);
  return cell.f ? `${shown} [formula =${cell.f}]` : shown;
};

function sheetRows(sheet, rect) {
  const rows = new Map();
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const at = splitCell(ref);
    if (!at || at.row < rect.r1 || at.row > rect.r2 || at.col < rect.c1 || at.col > rect.c2) continue;
    if (!rows.has(at.row)) rows.set(at.row, { row: at.row, hidden: sheet.hiddenRows.has(at.row), cells: {} });
    rows.get(at.row).cells[ref] = cellText(cell);
  }
  return [...rows.values()].sort((a, b) => a.row - b.row);
}

const usedRect = (sheet) => {
  const rect = { c1: 1, c2: 1, r1: 1, r2: 1 };
  for (const ref of Object.keys(sheet.cells)) {
    const at = splitCell(ref);
    if (at) { rect.c2 = Math.max(rect.c2, at.col); rect.r2 = Math.max(rect.r2, at.row); }
  }
  return rect;
};

/** Number-format kind of a cell (percent|number|text|currency|date), as the #numberFormat probe of the cases names it. */
function numberFormatOf(doc, cell) {
  if (!cell) return null;
  if (cell.formatKind) return cell.formatKind;
  if (cell.t === 's' || cell.t === 'str') return 'text';
  return doc.workbook.formatKinds?.[cell.s ?? 0] ?? 'number';
}

/** A tool argument the real tool would refuse; the backend answers `invalid_arguments` and the runner marks the ask. */
class InvalidArguments extends Error {}

const asNumber = (cell) => (cell && typeof cell.v === 'number' ? cell.v : null);

function stats(values) {
  if (values.length === 0) return { count: 0, sum: 0, average: null, min: null, max: null };
  const sum = values.reduce((a, b) => a + b, 0);
  return { count: values.length, sum, average: sum / values.length, min: Math.min(...values), max: Math.max(...values) };
}

/** The read tools of one open document: (name, args) -> result. */
function readTools(caseDoc, doc) {
  function sheetOf(args) {
    const names = Object.keys(doc.workbook.sheets);
    const wanted = String(args.sheetId ?? caseDoc.setup?.activeSheet ?? names[0]);
    const byIndex = /^sheet-(\d+)$/.exec(wanted);
    const name = names.includes(wanted) ? wanted : names[byIndex ? Number(byIndex[1]) - 1 : 0] ?? names[0];
    return { name, sheet: doc.workbook.sheets[name] };
  }

  function xlsx(name, args) {
    if (name === 'get_workbook_context') {
      return {
        activeSheetName: caseDoc.setup?.activeSheet ?? Object.keys(doc.workbook.sheets)[0],
        selection: caseDoc.setup?.selection ?? null,
        sheets: Object.entries(doc.workbook.sheets).map(([sheetName, sheet], i) => {
          const rect = usedRect(sheet);
          return { id: `sheet-${i + 1}`, name: sheetName, dataRange: `A1:${colName(rect.c2)}${rect.r2}`, hiddenRows: [...sheet.hiddenRows] };
        }),
      };
    }
    const target = sheetOf(args);
    const rect = parseRange(args.range) ?? usedRect(target.sheet);
    if (name === 'read_formats') {
      const rows = sheetRows(target.sheet, rect).map((row) => ({
        ...row,
        formats: Object.fromEntries(Object.keys(row.cells).map((ref) => [ref, numberFormatOf(doc, target.sheet.cells[ref])])),
      }));
      return { sheetName: target.name, range: args.range ?? null, hiddenRows: [...target.sheet.hiddenRows], rows };
    }
    if (name === 'read_range' || name === 'read_sheet_features') {
      return { sheetName: target.name, range: args.range ?? null, hiddenRows: [...target.sheet.hiddenRows], rows: sheetRows(target.sheet, rect) };
    }
    if (name === 'read_cells') {
      if (!Array.isArray(args.addresses)) throw new InvalidArguments('addresses must be an array of cell references');
      const cells = {};
      for (const ref of args.addresses) cells[ref] = cellText(target.sheet.cells[String(ref).toUpperCase()]);
      return { sheetName: target.name, cells };
    }
    if (name === 'find_cells') {
      const query = String(args.query ?? '').toLowerCase();
      const hits = Object.entries(target.sheet.cells)
        .filter(([, cell]) => (args.errors_only ? /^#/.test(String(cell.v)) : query && String(cell.v).toLowerCase().includes(query)))
        .map(([ref, cell]) => ({ ref, value: cellText(cell) }));
      return { sheetName: target.name, hits };
    }
    if (name === 'trace_precedents') {
      const cell = target.sheet.cells[String(args.address ?? '').toUpperCase()];
      return { sheetName: target.name, address: args.address, formula: cell?.f ?? null, value: cell?.v ?? null };
    }
    if (name === 'aggregate_range' || name === 'summarize_range') {
      const values = [];
      const groups = new Map();
      const valueCol = args.valueColumn ? colNum(String(args.valueColumn).toUpperCase()) : null;
      const groupCol = args.groupByColumn ? colNum(String(args.groupByColumn).toUpperCase()) : null;
      for (const [ref, cell] of Object.entries(target.sheet.cells)) {
        const at = splitCell(ref);
        if (!at || at.row < rect.r1 || at.row > rect.r2 || at.col < rect.c1 || at.col > rect.c2) continue;
        if (args.skipHiddenRows && target.sheet.hiddenRows.has(at.row)) continue;
        const n = asNumber(cell);
        if (n === null || (valueCol && at.col !== valueCol)) continue;
        values.push(n);
        if (groupCol) {
          const key = String(target.sheet.cells[`${colName(groupCol)}${at.row}`]?.v ?? '');
          groups.set(key, [...(groups.get(key) ?? []), n]);
        }
      }
      const out = { sheetName: target.name, range: args.range ?? null, skipHiddenRows: Boolean(args.skipHiddenRows), ...stats(values) };
      if (groupCol) out.groups = Object.fromEntries([...groups].map(([key, v]) => [key, stats(v)]));
      return out;
    }
    return { error: `unsupported tool ${name}` };
  }

  function text(name, args) {
    if (doc.format === 'docx') {
      if (name === 'get_document_context') return { paragraphCount: doc.blocks.length, blocks: doc.blocks.map((b) => ({ index: b.index, style: b.style, preview: b.text ?? '[table]' })) };
      if (name === 'read_blocks') {
        const start = Math.max(0, Number(args.startBlockIndex ?? 0));
        const end = Math.min(doc.blocks.length - 1, Number(args.endBlockIndex ?? doc.blocks.length - 1));
        return { startBlockIndex: start, endBlockIndex: end, blocks: doc.blocks.slice(start, end + 1) };
      }
    }
    if (doc.format === 'pptx' && name === 'read_slide') {
      const wanted = args.slideIndex ?? args.index ?? args.slide;
      const slides = wanted ? doc.slides.filter((s) => s.index === Number(wanted)) : doc.slides;
      return { slideCount: doc.slides.length, slides: slides.length ? slides : doc.slides };
    }
    if (doc.format === 'pdf') {
      if (name === 'search_text') {
        const query = String(args.query ?? args.text ?? '').toLowerCase();
        return { pageCount: doc.pageCount, hits: doc.pages.flatMap((p) => p.lines.filter((l) => query && l.toLowerCase().includes(query)).map((line) => ({ page: p.page, line }))) };
      }
      return { pageCount: doc.pageCount, pages: doc.pages };
    }
    if (doc.format === 'md' || doc.format === 'html') {
      if (name === 'read_frontmatter') return { frontmatter: doc.lines[0] === '---' ? doc.lines.slice(1, doc.lines.indexOf('---', 1)) : [] };
      const from = Number(args.startBlockIndex ?? 0);
      return { lineCount: doc.lines.length, lines: doc.lines.slice(from), text: doc.lines.slice(from).join('\n') };
    }
    return { error: `unsupported tool ${name}` };
  }

  return doc.format === 'xlsx' ? xlsx : text;
}

/** Reads the JSON arguments of a tool call: an object, or an empty string for none; anything else is invalid. */
function parseArguments(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    if (raw.trim() === '') return { ok: true, args: {} };
    try { value = JSON.parse(raw); } catch { return { ok: false, reason: 'arguments are not valid JSON' }; }
  }
  if (value === undefined || value === null) return { ok: true, args: {} };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'arguments must be a JSON object' };
  return { ok: true, args: value };
}

const UNSUPPORTED_SHEET_OP_RE = /(?:print_?area|freeze_?(?:rows|cols|columns|panes)|page_?setup)/i;

/** Returns true when a propose_operations argument asks for page-setup or freeze-pane operations that the tool does not support. */
export function hasUnsupportedSheetOp(node) {
  if (Array.isArray(node)) return node.some(hasUnsupportedSheetOp);
  if (!node || typeof node !== 'object') return false;
  for (const [k, v] of Object.entries(node)) {
    if (UNSUPPORTED_SHEET_OP_RE.test(k)) return true;
    if (/^(?:type|op|operation|kind|action)$/i.test(k) && typeof v === 'string' && UNSUPPORTED_SHEET_OP_RE.test(v)) return true;
    if (v && typeof v === 'object' && hasUnsupportedSheetOp(v)) return true;
  }
  return false;
}

function recalcSheet(sheet) {
  for (let pass = 0; pass < 2; pass += 1) {
    for (const cell of Object.values(sheet.cells)) {
      if (!cell || typeof cell.f !== 'string') continue;
      const expr = cell.f.replace(/\$/g, '').trim();
      const sumMatch = /^SUM\(([A-Z]+\d+:[A-Z]+\d+)\)$/i.exec(expr);
      if (sumMatch) {
        const rect = parseRange(sumMatch[1]);
        if (!rect) continue;
        let sum = 0;
        for (let r = rect.r1; r <= rect.r2; r += 1) {
          for (let c = rect.c1; c <= rect.c2; c += 1) {
            const v = sheet.cells[`${colName(c)}${r}`]?.v;
            if (typeof v === 'number' && Number.isFinite(v)) sum += v;
          }
        }
        cell.v = sum;
        continue;
      }
      if (/^[A-Z0-9+\-*/().\s]+$/i.test(expr) && /[A-Z]+\d+/i.test(expr)) {
        let ok = true;
        const substituted = expr.replace(/[A-Z]+\d+/gi, (ref) => {
          const v = sheet.cells[ref.toUpperCase()]?.v;
          if (typeof v !== 'number' || !Number.isFinite(v)) { ok = false; return '0'; }
          return String(v);
        });
        if (ok && /^[0-9+\-*/().\s]+$/.test(substituted)) {
          try {
            const val = Function(`"use strict"; return (${substituted});`)();
            if (typeof val === 'number' && Number.isFinite(val)) cell.v = val;
          } catch { /* ignore */ }
        }
      }
    }
  }
}

function applyWriteToDoc(doc, name, args, caseDoc) {
  if (!doc || !args || typeof args !== 'object') return;
  if (doc.format === 'xlsx' && doc.workbook?.sheets) {
    const names = Object.keys(doc.workbook.sheets);
    const defaultSheet = caseDoc.setup?.activeSheet ?? names[0];
    const resolveSheet = (hint) => {
      if (!hint) return doc.workbook.sheets[defaultSheet];
      const clean = String(hint).trim().replace(/^'(.*)'$/, '$1');
      if (doc.workbook.sheets[clean]) return doc.workbook.sheets[clean];
      const byIndex = /^sheet-(\d+)$/i.exec(clean);
      if (byIndex) return doc.workbook.sheets[names[Number(byIndex[1]) - 1]];
      const found = names.find((n) => n.toLowerCase() === clean.toLowerCase());
      return doc.workbook.sheets[found ?? defaultSheet];
    };
    const visit = (node, inheritedSheet = null) => {
      if (Array.isArray(node)) { node.forEach((el) => visit(el, inheritedSheet)); return; }
      if (!node || typeof node !== 'object') return;
      const ownSheet = node.sheet ?? node.sheetId ?? node.sheetName ?? node.sheet_name ?? node.sheet_id ?? inheritedSheet;
      const addrRaw = node.address ?? node.range ?? node.cell ?? node.anchor ?? node.target;
      if (typeof addrRaw === 'string') {
        const bang = addrRaw.lastIndexOf('!');
        const addrSheet = bang >= 0 ? addrRaw.slice(0, bang) : ownSheet;
        const rect = parseRange(bang >= 0 ? addrRaw.slice(bang + 1) : addrRaw);
        const sheet = resolveSheet(addrSheet);
        if (sheet && rect) {
          const fmtStr = String(node.numberFormat ?? node.format ?? '');
          const isPctFmt = /%|percent/i.test(fmtStr);
          for (let r = rect.r1; r <= rect.r2; r += 1) {
            for (let c = rect.c1; c <= rect.c2; c += 1) {
              const ref = `${colName(c)}${r}`;
              const prev = sheet.cells[ref] ?? { v: null, f: null, t: 'n' };
              const next = { ...prev };
              const rawVal = Array.isArray(node.values)
                ? (Array.isArray(node.values[r - rect.r1]) ? node.values[r - rect.r1][c - rect.c1] : node.values[(r - rect.r1) * (rect.c2 - rect.c1 + 1) + (c - rect.c1)])
                : node.value;
              const rawFormula = typeof node.formula === 'string' ? node.formula : (typeof rawVal === 'string' && rawVal.trim().startsWith('=') ? rawVal : null);
              if (rawFormula !== null) {
                next.f = rawFormula.trim().replace(/^=+/, '');
              } else if (rawVal !== undefined && (typeof rawVal === 'number' || typeof rawVal === 'string' || typeof rawVal === 'boolean')) {
                if (typeof rawVal === 'string' && rawVal.trim().endsWith('%') && Number.isFinite(Number(rawVal.trim().slice(0, -1)))) {
                  next.v = Number(rawVal.trim().slice(0, -1)) / 100;
                  next.t = 'n';
                  next.formatKind = 'percent';
                } else {
                  next.v = rawVal;
                  next.t = typeof rawVal === 'number' ? 'n' : 'str';
                }
              }
              if (isPctFmt) next.formatKind = 'percent';
              sheet.cells[ref] = next;
            }
          }
          recalcSheet(sheet);
        }
      }
      for (const [k, v] of Object.entries(node)) {
        if (v && typeof v === 'object' && k !== 'values') visit(v, ownSheet);
      }
    };
    visit(args);
    return;
  }
  if (doc.format === 'docx' && Array.isArray(doc.blocks)) {
    const replacement = args.text ?? args.html ?? args.newText ?? args.content;
    if (typeof replacement === 'string') {
      const idx = Number(args.blockIndex ?? args.startBlockIndex ?? args.index ?? 0);
      if (idx >= 0 && idx < doc.blocks.length && doc.blocks[idx].text !== undefined) {
        doc.blocks[idx] = { ...doc.blocks[idx], text: replacement.replace(/<[^>]*>/g, '').trim() || replacement };
      }
    }
  }
}

/**
 * One case's tool session. execute(name, args) answers a call; writes() is the number of writes let through;
 * denied() lists calls it refused (revoked access, viewer, stale version, unsupported op) so the runner can record them; writeLog()
 * keeps the arguments of every write attempt (applied or refused, a dry run is none) so an edit can be scored from what
 * was proposed; sourceText() is the text of the documents as opened;
 * invalid() lists calls whose arguments the real tool would refuse (answered `invalid_arguments`, never a crash).
 */
export function createBackend(caseDoc, { fixturesDir = FIXTURES_DIR, views = null } = {}) {
  const documents = caseDoc.fixtures.map((fixture, i) => {
    const doc = views?.[i] ?? loadView(fixture.id, fixturesDir);
    applySetup(doc, fixture.id, caseDoc.setup);
    return { doc, module: MODULE_OF_FORMAT[doc.format] ?? 'docs', role: fixture.role ?? caseDoc.role, read: readTools(caseDoc, doc), sheetNames: doc.workbook ? Object.keys(doc.workbook.sheets) : [], text: viewText(doc) };
  });
  const modules = documents.map((d) => d.module);
  const revokeAfter = caseDoc.setup?.revokeAfterTool ?? Infinity;
  let calls = 0;
  let writes = 0;
  const denied = [];
  const writeLog = [];
  const invalid = [];
  const refuseArguments = (name, reason) => {
    invalid.push({ name, reason: String(reason).slice(0, 160) });
    return { error: 'invalid_arguments', message: `The arguments of ${name} are not valid: ${String(reason).slice(0, 160)}` };
  };

  return {
    modules: [...new Set(modules)],
    writes: () => writes,
    denied: () => [...denied],
    writeLog: () => writeLog.map((entry) => ({ ...entry })),
    invalid: () => [...invalid],
    sheetNames: () => documents.find((d) => d.sheetNames.length > 0)?.sheetNames ?? [],
    /** The text of every open document as it was opened (setup applied): what a write may keep or introduce (G712-16). */
    sourceText: () => documents.map((d) => d.text).join('\n'),
    execute(name, rawArgs) {
      const target = documents.find((d) => TOOL_OPS[d.module][name]);
      if (!target) return { error: `unsupported tool ${name}` };
      const parsed = parseArguments(rawArgs);
      if (!parsed.ok) return refuseArguments(name, parsed.reason);
      const { args } = parsed;
      const ops = TOOL_OPS[target.module][name];
      calls += 1;
      if (calls > revokeAfter) {
        denied.push({ name, reason: 'access_revoked' });
        return { error: 'permission_denied', message: 'Your access to this document was revoked.' };
      }
      if (name === 'ask_clarification') return { status: 'clarification_requested', questions: Array.isArray(args.questions) ? args.questions : [] };
      // A call that asks for a dry run changes nothing in the editor, whatever the tool: it is not a write (G712-16).
      const dryRun = args.dryRun === true || args.dry_run === true;
      const isWrite = ops.some((op) => WRITE_OPERATIONS.has(op)) && !dryRun;
      if (isWrite) {
        if (target.role === 'viewer') { denied.push({ name, reason: 'viewer' }); writeLog.push({ name, applied: false, args }); return { error: 'permission_denied', message: 'This document is view-only.' }; }
        if (caseDoc.setup?.serverVersionAhead) { denied.push({ name, reason: 'version_conflict' }); writeLog.push({ name, applied: false, args }); return { error: 'version_conflict', message: 'The server holds a newer version than the copy that is open.' }; }
        if (name === 'propose_operations' && hasUnsupportedSheetOp(args)) {
          denied.push({ name, reason: 'unsupported_operation' });
          writeLog.push({ name, applied: false, args });
          return { error: 'unsupported_operation', message: 'Page setup and freeze-pane operations are not supported by propose_operations.' };
        }
        writes += 1;
        writeLog.push({ name, applied: true, args });
        applyWriteToDoc(target.doc, name, args, caseDoc);
        return { status: 'applied', note: 'Edit applied in the editor (not yet saved).' };
      }
      try {
        return target.read(name, args);
      } catch (err) {
        return refuseArguments(name, err?.message ?? err);
      }
    },
  };
}
