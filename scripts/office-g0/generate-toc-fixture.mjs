// DOC-002 (UNI-666) - table-of-contents fixture, produced by the pinned engine.
//
// The fixture exists because F-DOCX-TOC was withheld: a TOC fixture is only
// honest if the field it ships does not bake in this script's guess about
// pagination. The pinned engine's own generateTocFieldXml emits a dirty TOC
// field whose result text is the heading text and whose page numbers are
// optional; this generator passes no page numbers, so the stored result carries
// none and the numbers stay a measurement for task 3.
//
//   node scripts/office-g0/generate-toc-fixture.mjs \
//     --engine <docx-engine.cjs> --record <build.json> --out <owned-directory>
//
// Inputs live in toc-fixture-inputs.json beside this file. Output is
// deterministic: fixed savedAt, canonical ZIP order and timestamps only.
// Fixture-level checks stay at engine level (structure + parse). The editor
// open/save/reopen identity and the measured page numbers are DOC-003 3.3/3.5.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const upstreamCommit = '09485f884dc845cf3bf27fb7edfe489f9d457aad';
export const lockSha256 = 'DE782E49A1006FAC7287A41C748C696EFD9FB3C3038EAE893EF82DFCA57F9FE5';
export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
export const FIXTURE_NAME = 'docx-toc.docx';
export const inputs = JSON.parse(fs.readFileSync(new URL('./toc-fixture-inputs.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));

const paragraph = (text, options = {}) => ({ kind: 'generated', block: { type: 'paragraph', runs: [{ text }], ...options } });

/** Normalize ZIP order/timestamps only; engine-written part contents stay intact. */
export async function canonicalZip(bytes, JSZip) {
  const source = await JSZip.loadAsync(bytes);
  const output = new JSZip();
  for (const name of Object.keys(source.files).sort()) {
    if (source.files[name].dir) continue;
    output.file(name, await source.files[name].async('uint8array'), { date: new Date(inputs.savedAt), createFolders: false });
  }
  return output.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'DOS' });
}

/** The declared document, in document order: TOC field first, then headings + bodies. */
export function documentBlocks(engine) {
  const entries = tocEntries();
  const tocXml = engine.generateTocFieldXml(entries);
  if (tocXml.length !== entries.length) throw new Error('generateTocFieldXml returned ' + tocXml.length + ' lines for ' + entries.length + ' entries');
  const blocks = [paragraph(inputs.firstParagraph)];
  for (const xml of tocXml) blocks.push({ kind: 'xml', xml });
  for (const h of inputs.headings) {
    blocks.push(paragraph(h.text, { type: 'heading', level: h.level }));
    blocks.push(paragraph(h.body));
  }
  blocks.push(paragraph(inputs.sentinel));
  return blocks;
}

export function tocEntries() {
  return inputs.headings.map((h) => ({ text: h.text, level: h.level }));
}

async function documentXmlOf(bytes, JSZip) {
  const zip = await JSZip.loadAsync(bytes);
  const part = zip.file('word/document.xml');
  if (!part) throw new Error('fixture has no word/document.xml');
  return part.async('string');
}

const W_T_RE = /<w:t(?=[\s>])[^>]*>([\s\S]*?)<\/w:t>/g;
const textsOf = (xml) => Array.from(xml.matchAll(W_T_RE), (m) => m[1]).join('');

/** Structural facts the fixture oracle checks, computed from the produced bytes. */
export function inspectTocDocument(xml) {
  const instr = Array.from(xml.matchAll(/<w:instrText[^>]*>([\s\S]*?)<\/w:instrText>/g), (m) => m[1]);
  const tocInstr = instr.filter((value) => /\bTOC\b/.test(value));
  const tocParagraphs = Array.from(xml.matchAll(/<w:p>(?:(?!<\/w:p>)[\s\S])*?w:val="TOC[1-9]"(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g), (m) => m[0]);
  const entries = tocParagraphs.map((p) => {
    const style = /<w:pStyle w:val="(TOC[1-9])"/.exec(p)[1];
    // The field result of an entry is text + a tab + (page number). Page numbers
    // would sit after the tab; the fixture must not ship any.
    const afterTab = p.split('<w:tab/>').slice(1).join('<w:tab/>');
    const pageNumberDigits = (afterTab.match(/>[0-9]+</g) ?? []).map((d) => d.slice(1, -1));
    return { style, text: textsOf(p), pageNumberDigits };
  });
  const headings = Array.from(xml.matchAll(/<w:p>(?:(?!<\/w:p>)[\s\S])*?<w:pStyle w:val="Heading([1-9])"(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g), (m) => m[0])
    .map((p) => ({ level: Number(/<w:pStyle w:val="Heading([1-9])"/.exec(p)[1]), text: textsOf(p) }));
  return { tocInstructions: tocInstr, entryCount: entries.length, entries, headings };
}

function structuralFailures(inspection) {
  const failures = [];
  if (inspection.tocInstructions.length !== 1) failures.push('expected exactly one TOC instruction, found ' + inspection.tocInstructions.length);
  const instr = inspection.tocInstructions[0] || '';
  for (const token of ['TOC', '\\h', '\\z', '\\u']) if (!instr.includes(token)) failures.push('TOC instruction is missing ' + token);
  if (inspection.entries.length !== inputs.headings.length) failures.push('expected ' + inputs.headings.length + ' TOC entries, found ' + inspection.entries.length);
  inputs.headings.forEach((heading, index) => {
    const entry = inspection.entries[index];
    if (!entry) return;
    if (entry.text !== heading.text) failures.push('TOC entry ' + index + ' text is ' + JSON.stringify(entry.text) + ', expected ' + JSON.stringify(heading.text));
    if (entry.style !== 'TOC' + heading.level) failures.push('TOC entry ' + index + ' style is ' + entry.style + ', expected TOC' + heading.level);
    if (entry.pageNumberDigits.length) failures.push('TOC entry ' + index + ' ships a page number ' + entry.pageNumberDigits.join(',') + '; page numbers must stay a measurement');
  });
  if (inspection.headings.length !== inputs.headings.length) failures.push('expected ' + inputs.headings.length + ' heading paragraphs, found ' + inspection.headings.length);
  return failures;
}

/** What the pinned parser sees in the fixture: the TOC field lines and their page slots. */
export function parseChecks(parsed) {
  const failures = [];
  const lines = (parsed.blocks || []).filter((b) => b.fieldDisplay && b.fieldDisplay.kind === 'tocLine');
  if (lines.length !== inputs.headings.length) failures.push('parseDocx found ' + lines.length + ' TOC lines, expected ' + inputs.headings.length);
  inputs.headings.forEach((heading, index) => {
    const line = lines[index];
    if (!line) return;
    const field = line.fieldDisplay;
    if (field.left !== heading.text) failures.push('parsed TOC line ' + index + ' left is ' + JSON.stringify(field.left) + ', expected ' + JSON.stringify(heading.text));
    if (field.level !== heading.level) failures.push('parsed TOC line ' + index + ' level is ' + field.level + ', expected ' + heading.level);
    if (field.right !== '') failures.push('parsed TOC line ' + index + ' already carries page text ' + JSON.stringify(field.right) + '; the fixture must ship no page numbers');
  });
  const headings = (parsed.blocks || []).filter((b) => b.type === 'heading');
  if (headings.length !== inputs.headings.length) failures.push('parseDocx found ' + headings.length + ' headings, expected ' + inputs.headings.length);
  inputs.headings.forEach((heading, index) => {
    const block = headings[index];
    if (!block) return;
    if (block.level !== heading.level) failures.push('parsed heading ' + index + ' level is ' + block.level + ', expected ' + heading.level);
    const text = (block.runs || []).map((r) => r.text || '').join('');
    if (text !== heading.text) failures.push('parsed heading ' + index + ' text is ' + JSON.stringify(text) + ', expected ' + JSON.stringify(heading.text));
  });
  return failures;
}

export async function generate(engine) {
  const { buildBlankDocx, parseDocx, saveDocx, JSZip } = engine;
  const build = async () => {
    const blank = await parseDocx(await buildBlankDocx());
    const raw = await saveDocx(blank, documentBlocks(engine), { savedAt: inputs.savedAt });
    return Buffer.from(await canonicalZip(raw, JSZip));
  };
  const first = await build();
  const second = await build();
  if (!first.equals(second)) throw new Error('fixture generation is not deterministic: two runs produced different bytes');

  const inspection = inspectTocDocument(await documentXmlOf(first, JSZip));
  const failures = structuralFailures(inspection);
  const parsedChecks = parseChecks(await parseDocx(first));
  if (failures.length || parsedChecks.length) {
    throw new Error('generated fixture failed its own TOC checks:\n' + failures.concat(parsedChecks).join('\n'));
  }
  return { bytes: first, inspection };
}

export function loadEngine(engineFile, recordFile) {
  const build = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  const required = ['generate.ts', 'parse.ts', 'patch.ts', 'blank.ts'];
  if (build.pin !== upstreamCommit || build.bundleSha256 !== sha256(fs.readFileSync(engineFile)) ||
      build.lockSha256 !== lockSha256 ||
      !Array.isArray(build.inputs) || required.some((name) => !build.inputs.some((item) => item.path === 'packages/docx-engine/src/' + name)) ||
      build.inputs.some((item) => !item.path.startsWith('node_modules/') && item.pinnedSha256 !== item.sha256)) {
    throw new Error('Engine bundle does not match the pinned build record');
  }
  return createRequire(import.meta.url)(path.resolve(engineFile));
}

export async function main(argv) {
  const names = ['--engine', '--record', '--out'];
  if (argv.length !== 6 || new Set([argv[0], argv[2], argv[4]]).size !== 3 ||
      [argv[0], argv[2], argv[4]].some((arg) => !names.includes(arg))) throw new Error('Usage: --engine <bundle> --record <build.json> --out <owned-directory>');
  const args = Object.fromEntries([[argv[0], argv[1]], [argv[2], argv[3]], [argv[4], argv[5]]]);
  const engine = loadEngine(args['--engine'], args['--record']);
  const output = path.resolve(args['--out']);
  const { bytes, inspection } = await generate(engine);
  const target = path.join(output, FIXTURE_NAME);
  if (fs.existsSync(target) && sha256(fs.readFileSync(target)) !== sha256(bytes)) throw new Error('Refusing to overwrite different fixture bytes: ' + target);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(target, bytes);
  const written = [{ name: FIXTURE_NAME, bytes: bytes.length, sha256: sha256(bytes), upstreamCommit }];
  const receiptPath = path.join(output, 'docx-toc.receipt.json');
  fs.writeFileSync(receiptPath, JSON.stringify({
    fixture: FIXTURE_NAME,
    upstreamCommit,
    engineApi: 'generateTocFieldXml',
    pageNumbers: 'not encoded in the fixture; measured by the reader (DOC-003)',
    entries: inspection.entries.map((entry, index) => ({ text: entry.text, level: Number(entry.style.slice(3)), style: entry.style, pageNumberDigits: entry.pageNumberDigits })),
    headings: inspection.headings,
    tocInstruction: inspection.tocInstructions[0],
    generator: 'scripts/office-g0/generate-toc-fixture.mjs',
    inputsSha256: sha256(fs.readFileSync(new URL('./toc-fixture-inputs.json', import.meta.url))),
    written,
  }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ written, receipt: receiptPath, entries: inspection.entries.length, headings: inspection.headings.length }, null, 2) + '\n');
  return written;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));