// UNI-667 xlsx persisted-file output oracle, scoped to lab/fixtures/
// g0-compatibility-edit.xlsx. Resolves the sheet via workbook.xml + its
// relationship (never ZIP order), reads real bytes, and fails malformed/empty/
// truncated/ambiguous packages rather than inventing a pass. verifyXlsxOutput is
// the wave2 wrapper Main's browser worker awaits after a genuine reopen.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { inflateRawSync } from "node:zlib";
export const ORACLE_ID = "office-g0-xlsx-oracle-r1";
export const ORACLE_VERSION = 2;
// Hardcoded immutable authored fixture pin; never trust a caller-provided hash.
export const PINNED_FIXTURE_SHA256 = "a61f92875fcbec548d6e5ef48a731e709a738cf31985dbe071db6572d1992f85";
// options.expected / verifyXlsxOutput input contract: sheetName, cell, marker.
export const DEFAULT_EXPECTED = { sheetName: "Data", cell: "A1", marker: "Hello", fixtureSha256: PINNED_FIXTURE_SHA256, editedRefs: null, editExpectations: null };
export class XlsxOracleError extends Error {
  constructor(code, detail) { super("[xlsx-output-oracle] " + code + ": " + detail); this.name = "XlsxOracleError"; this.code = code; this.detail = detail; }
}
const fail = (code, detail) => { throw new XlsxOracleError(code, detail); };
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Bounded ZIP reader (stored/deflated). Encryption, truncation, Zip64 and
// duplicate part names fail by name rather than being mistaken for a pass.
export function readZipParts(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) fail("empty_input", "package bytes are empty");
  let eocd = -1;
  for (let i = Math.max(0, bytes.length - 22 - 0xffff); i <= bytes.length - 22; i += 1) if (bytes.readUInt32LE(i) === 0x06054b50) eocd = i;
  if (eocd < 0) fail("missing_eocd", "no end-of-central-directory record");
  const count = bytes.readUInt16LE(eocd + 10), cdSize = bytes.readUInt32LE(eocd + 12), cdOffset = bytes.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) fail("zip64_unsupported", "Zip64 inspection is unsupported");
  if (cdOffset + cdSize > bytes.length) fail("truncated_central_directory", "central directory past buffer");
  const parts = new Map();
  let cursor = cdOffset;
  for (let entry = 0; entry < count; entry += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) fail("bad_central_entry", "entry " + entry);
    if (bytes.readUInt16LE(cursor + 8) & 0x1) fail("encrypted_entry", "entry " + entry);
    const method = bytes.readUInt16LE(cursor + 10), cSize = bytes.readUInt32LE(cursor + 20), uSize = bytes.readUInt32LE(cursor + 24);
    const nameLen = bytes.readUInt16LE(cursor + 28), extraLen = bytes.readUInt16LE(cursor + 30), commentLen = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    if (parts.has(name)) fail("ambiguous_zip_part", name);
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) fail("bad_local_header", name);
    const dataOffset = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    if (dataOffset + cSize > bytes.length) fail("truncated_part", name);
    const compressed = bytes.subarray(dataOffset, dataOffset + cSize);
    const value = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (value === null) fail("unsupported_zip_method", method + " for " + name);
    if (value.length !== uSize) fail("part_size_mismatch", name);
    parts.set(name, value);
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return parts;
}
export function requiredPart(parts, name) {
  const value = parts.get(name);
  if (!value) fail("missing_package_part", name);
  return value;
}
const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
// Strict entity decode: unknown named or out-of-range numeric references throw,
// so no heuristic includes() can fake a marker match.
export function decodeXmlText(raw) {
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
    if (body[0] !== "#") {
      if (!(body in XML_ENTITIES)) fail("unsupported_xml_entity", match);
      return XML_ENTITIES[body];
    }
    const hex = body[1] === "x" || body[1] === "X";
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) fail("unsupported_xml_entity", match);
    return String.fromCodePoint(code);
  });
}
function attrsOf(tag) {
  const attrs = {};
  const re = /([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = re.exec(tag))) {
    const key = match[1].includes(":") ? match[1].split(":").pop() : match[1];
    if (attrs[key] !== undefined && attrs[key] !== match[2]) fail("ambiguous_xml_attribute", key);
    attrs[key] = decodeXmlText(match[2]);
  }
  return attrs;
}
// tags() returns {attrs, inner} for both self-closing and paired elements.
function tags(xml, tag) {
  const out = [];
  const re = new RegExp("<" + tag + "\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)</" + tag + ">)", "g");
  let match;
  while ((match = re.exec(xml))) out.push({ attrs: attrsOf(match[1]), inner: match[2] ?? "" });
  return out;
}
function resolveTarget(target) {
  if (/^[a-zA-Z]+:/.test(target)) fail("external_relationship_target", target);
  const segments = [];
  for (const part of (target.startsWith("/") ? target.slice(1) : "xl/" + target).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (!segments.length) fail("relationship_target_escapes_package", target); segments.pop(); continue; }
    segments.push(part);
  }
  return segments.join("/");
}
// Workbook model: every sheet resolved through workbook.xml + its relationship.
// Bounded well-formedness gate: element-only stack scan; comments, CDATA, PIs
// and the XML declaration are skipped. Nesting capped.
// XML declaration, comments, CDATA and PIs are lexical containers, not element
// content: a well-formed document MAY hold '<' inside them (a comment can wrap a
// whole <c r="A1">). tags() must never see such markup. Capture the container BODY
// (not the delimiters) and reject element-like markup there - fail closed - for
// every part the oracle parses. Testing only the body is what lets a normal
// '<?xml ...?>' declaration, a plain comment, and markup-free CDATA/PI load.
const LEXICAL = /<!--([\s\S]*?)-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?([\s\S]*?)\?>/g;
const MARKUP_IN_LEXICAL = /<[A-Za-z_!?/]/;
function lexicalKind(container) {
  if (container.startsWith("<!--")) return "comment";
  if (container.startsWith("<![CDATA[")) return "cdata";
  return "processing_instruction";
}
export function assertWellFormedXml(xml, partName) {
  if (typeof xml !== "string" || xml.length === 0) fail("malformed_xml", partName + ": empty");
  LEXICAL.lastIndex = 0;
  let lexical;
  while ((lexical = LEXICAL.exec(xml))) {
    const body = lexical[1] ?? lexical[2] ?? lexical[3] ?? "";
    if (MARKUP_IN_LEXICAL.test(body)) {
      const kind = lexicalKind(lexical[0]);
      fail("xml_markup_in_" + kind, partName + ": markup inside " + kind + " is not XML content");
    }
  }
  const stack = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)(?:\s[^<>]*?)?(\/?)>/g;
  let match;
  while ((match = re.exec(xml))) {
    if (match[1]) {
      const open = stack.pop();
      if (open !== match[1]) fail("malformed_xml", partName + ": </" + match[1] + "> closes <" + (open ?? "nothing") + ">");
    } else if (match[2] && match[3] !== "/") {
      if (stack.length > 512) fail("malformed_xml", partName + ": nesting too deep");
      stack.push(match[2]);
    }
  }
  if (stack.length) fail("malformed_xml", partName + ": unclosed <" + stack[stack.length - 1] + ">");
  const residue = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w.:-]*(?:\s[^<>]*?)?\/?>/g, "").replace(/[^<]/g, "");
  if (residue.length) fail("malformed_xml", partName + ": stray <");
}
// Read a package part and validate it before any regex parse.
function xmlPart(parts, name) {
  const xml = requiredPart(parts, name).toString("utf8");
  assertWellFormedXml(xml, name);
  return xml;
}
// Authored defined-name model. xl/workbook.xml is byte-exempt because a save
// reserialises it, so its authored names are compared semantically instead: every
// parsed attribute (prefix-stripped by attrsOf, key-sorted here) plus the trimmed
// target text. Attribute order / surrounding whitespace are harmless; deletion or
// retarget appears as a model mismatch. Nameless or duplicate (name+localSheetId)
// entries fail closed by name. tags("definedName") does not match <definedNames>
// because \b fails before the "s".
function canonicalDefinedNames(workbookXml) {
  const seen = new Set();
  const entries = tags(workbookXml, "definedName").map(({ attrs, inner }) => {
    const attributes = {};
    for (const key of Object.keys(attrs).sort()) attributes[key] = attrs[key];
    const name = attributes.name ?? "";
    if (!name) fail("defined_name_missing_name", JSON.stringify(attrs));
    const scope = name + "|" + (attributes.localSheetId ?? "");
    if (seen.has(scope)) fail("ambiguous_defined_name", name);
    seen.add(scope);
    const value = decodeXmlText(inner).trim();
    return { attributes, value, sortKey: JSON.stringify(attributes) + "|" + value };
  });
  return entries.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0)).map(({ attributes, value }) => ({ attributes, value }));
}
export function inspectWorkbook(parts) {
  const relationships = new Map();
  for (const { attrs } of tags(xmlPart(parts, "xl/_rels/workbook.xml.rels"), "Relationship")) {
    if (!attrs.Id || !attrs.Target) fail("relationship_missing_fields", JSON.stringify(attrs));
    if (relationships.has(attrs.Id)) fail("ambiguous_relationship_id", attrs.Id);
    relationships.set(attrs.Id, { target: attrs.Target, type: attrs.Type ?? "" });
  }
  const workbookXml = xmlPart(parts, "xl/workbook.xml");
  const sheets = [];
  for (const { attrs } of tags(workbookXml, "sheet")) {
    if (!attrs.name || !attrs.id) fail("sheet_missing_relationship", JSON.stringify(attrs));
    if (sheets.some((s) => s.name === attrs.name || s.relId === attrs.id)) fail("ambiguous_sheet", attrs.name);
    const relationship = relationships.get(attrs.id);
    if (!relationship) fail("missing_sheet_relationship", attrs.id);
    if (!/\/worksheet$/.test(relationship.type)) fail("relationship_is_not_worksheet", attrs.id);
    const partName = resolveTarget(relationship.target);
    requiredPart(parts, partName);
    sheets.push({ name: attrs.name, relId: attrs.id, partName });
  }
  if (!sheets.length) fail("workbook_has_no_sheets", "xl/workbook.xml");
  return { sheets, names: sheets.map((s) => s.name), definedNames: canonicalDefinedNames(workbookXml) };
}
export function readSheet(parts, partName) {
  const xml = xmlPart(parts, partName);
  if (!/<sheetData\b/.test(xml)) fail("worksheet_missing_sheetData", partName);
  const seen = new Set();
  return tags(xml, "c").map(({ attrs, inner }) => {
    if (!attrs.r) fail("cell_missing_ref", JSON.stringify(attrs));
    if (seen.has(attrs.r)) fail("duplicate_cell_ref", attrs.r);
    seen.add(attrs.r);
    return { ref: attrs.r, type: attrs.t ?? "", inner };
  });
}
// Supported encodings only: s (shared), inlineStr, str (formula), n/b/absent.
export function readCellValue(cell, shared) {
  const raw = tags(cell.inner, "v").map(({ inner }) => decodeXmlText(inner))[0] ?? null;
  if (cell.type === "s") {
    if (raw === null) fail("cell_missing_value", cell.ref);
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index >= shared.length) fail("shared_string_index_out_of_range", cell.ref);
    return { text: shared[index], encoding: "sharedString" };
  }
  if (cell.type === "inlineStr") {
    const inline = tags(cell.inner, "is")[0];
    if (!inline) fail("cell_missing_inline_string", cell.ref);
    return { text: tags(inline.inner, "t").map(({ inner }) => decodeXmlText(inner)).join(""), encoding: "inlineString" };
  }
  if (cell.type === "str" || cell.type === "n" || cell.type === "b" || cell.type === "") {
    if (raw === null && cell.type === "str") fail("cell_missing_value", cell.ref);
    const encoding = cell.type === "str" ? "formulaString" : cell.type === "b" ? "boolean" : "number";
    return { text: raw ?? "", encoding };
  }
  fail("unsupported_cell_type", cell.ref + " t=" + cell.type);
}
function sharedStrings(parts) {
  if (!parts.has("xl/sharedStrings.xml")) return [];
  return tags(xmlPart(parts, "xl/sharedStrings.xml"), "si").map(({ inner }) => tags(inner, "t").map((t) => decodeXmlText(t.inner)).join(""));
}
// Scoped fingerprint: every other package part hashed byte-for-byte, plus the
// target sheet's non-target cell refs/types/formula markers. The whole sheet is
// not hashed because a save re-serialises it.
function isByteExemptPart(name) {
  if (name.endsWith("/")) return true;
  if (name === "[Content_Types].xml" || name === "_rels/.rels") return true;
  if (name === "xl/workbook.xml") return true;
  return false;
}
// Every ref the caller declared as EDITED is excluded from the non-target model. A single-cell
// save excludes exactly its own ref; a save that also refreshes a dependent formula cell declares
// both, so the recalculated cached value is compared by expectation instead of being treated as
// authored content that must not change.
export function editedRefsOf(expected) {
  if (Array.isArray(expected.editedRefs) && expected.editedRefs.length > 0) return expected.editedRefs.slice();
  return [expected.cell];
}
function canonicalCells(parts, cells, excludedRefs) {
  const shared = sharedStrings(parts);
  const skip = excludedRefs instanceof Set ? excludedRefs : new Set(excludedRefs);
  return cells.filter((c) => !skip.has(c.ref)).map((c) => ({
    ref: c.ref, type: c.type, value: readCellValue(c, shared).text,
    formula: tags(c.inner, "f").map(({ inner }) => decodeXmlText(inner)).join(""),
  })).sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
}
// Non-worksheet, non-exempt parts are hashed once as a package-level set (no
// worksheet raw bytes), and each worksheet's sha256 covers only its own canonical
// non-target model plus the workbook sheet list. A save may reserialise a
// worksheet, so its bytes are never hashed; its authored model is compared instead.
function fingerprint(parts, sheetPart, cells, excludedRefs, workbookModel) {
  const sheetParts = new Set(workbookModel.sheets.map((s) => s.partName));
  const otherParts = [...parts.keys()].filter((n) => !sheetParts.has(n) && !isByteExemptPart(n)).sort().map((n) => n + ":" + sha256(parts.get(n)));
  const cellsModel = canonicalCells(parts, cells, excludedRefs ?? []);
  const workbook = { names: workbookModel.names.slice(), count: workbookModel.names.length, definedNames: workbookModel.definedNames };
  return { otherParts, canonicalCells: cellsModel, workbook, sha256: sha256(Buffer.from(JSON.stringify({ cellsModel, workbook }))) };
}
// Byte-level oracle. Reads the real fixture and saved bytes, resolves the target
// sheet via workbook.xml + relationships, reads the target cell, and re-reads the
// saved bytes once more (fresh reopen) for stability. Malformed input throws.
export function assessXlsxBytes(options) {
  const expected = Object.assign({}, DEFAULT_EXPECTED, options.expected ?? {});
  const { fixtureBytes, savedBytes } = options;
  const readSaved = options.readSavedBytes ?? (() => savedBytes);
  const readFixture = options.readFixtureBytes ?? (() => fixtureBytes);
  const fixtureParts = readZipParts(fixtureBytes);
  const savedParts = readZipParts(savedBytes);
  requiredPart(fixtureParts, "[Content_Types].xml");
  requiredPart(savedParts, "[Content_Types].xml");
  const fixtureModel = inspectWorkbook(fixtureParts);
  const savedModel = inspectWorkbook(savedParts);
  const fixtureSha = sha256(fixtureBytes), savedSha = sha256(savedBytes);
  const reopenedSha = sha256(readSaved()), fixtureAfter = sha256(readFixture());
  const sheet = savedModel.sheets.find((entry) => entry.name === expected.sheetName) ?? null;
  const cells = sheet ? readSheet(savedParts, sheet.partName) : null;
  const cell = cells ? cells.find((entry) => entry.ref === expected.cell) ?? null : null;
  const target = cell ? readCellValue(cell, sharedStrings(savedParts)) : null;
  const fixtureSheet = fixtureModel.sheets.find((entry) => entry.name === expected.sheetName) ?? null;
  const fixtureCells = fixtureSheet ? readSheet(fixtureParts, fixtureSheet.partName) : null;
  // The fixture's own decoded target value is the semantic baseline: a save must
  // CHANGE it. Caller marker "Hello" (the helper default) can no longer pass an
  // A1-unchanged package whose only delta is metadata or an exempt part.
  const fixtureTargetCell = fixtureCells ? fixtureCells.find((entry) => entry.ref === expected.cell) ?? null : null;
  const fixtureTarget = fixtureTargetCell ? readCellValue(fixtureTargetCell, sharedStrings(fixtureParts)) : null;
  // Refs this save is allowed to change: the caller's edited set (the target cell, plus any
  // dependent formula cell a recalc refreshed). Both fingerprints exclude the SAME set, so the
  // comparison stays symmetric and an authored non-edited cell still has to survive untouched.
  const editedRefs = new Set(editedRefsOf(expected));
  const scoped = cells ? fingerprint(savedParts, sheet.partName, cells, editedRefs, savedModel) : null;
  const fixtureScoped = fixtureCells && fixtureSheet ? fingerprint(fixtureParts, fixtureSheet.partName, fixtureCells, editedRefs, fixtureModel) : null;
  // Every workbook sheet, not just the target one: other worksheets are authored
  // non-target content. Only the target sheet excludes the declared edited refs.
  const sheetFingerprints = savedModel.sheets.map((entry) => fingerprint(savedParts, entry.partName, readSheet(savedParts, entry.partName), entry.name === expected.sheetName ? editedRefs : null, savedModel));
  const fixtureSheetFingerprints = fixtureModel.sheets.map((entry) => fingerprint(fixtureParts, entry.partName, readSheet(fixtureParts, entry.partName), entry.name === expected.sheetName ? editedRefs : null, fixtureModel));
  // Declared post-save expectations: the decoded value (and, when given, the formula text) of a
  // named cell in the SAVED package. This is how a recalculated dependent cell is verified: the
  // engine must have refreshed its cached <v> while keeping its <f>. A ref that is missing, or a
  // value/formula that does not match, fails by name. No expectations declared means the gate is
  // vacuously true, so callers that only edit one cell are unaffected.
  const savedShared = sharedStrings(savedParts);
  const savedCellByRef = new Map((cells ?? []).map((entry) => [entry.ref, entry]));
  const expectations = expected.editExpectations;
  const checkedEdits = [];
  if (expectations !== null && expectations !== undefined) {
    if (typeof expectations !== "object" || Array.isArray(expectations)) {
      fail("bad_input_api", "expected.editExpectations must be a { ref: { value, formula? } } object");
    }
    for (const ref of Object.keys(expectations)) {
      const want = expectations[ref] ?? {};
      const found = savedCellByRef.get(ref) ?? null;
      const decoded = found ? readCellValue(found, savedShared) : null;
      const formula = found ? tags(found.inner, "f").map(({ inner }) => decodeXmlText(inner)).join("") : null;
      checkedEdits.push({
        ref, present: found !== null, value: decoded ? decoded.text : null, formula,
        wantsValue: want.value === undefined ? null : String(want.value),
        wantsFormula: want.formula === undefined ? null : String(want.formula),
      });
    }
  }
  const editExpectationsMet = checkedEdits.every((entry) => entry.present
    && (entry.wantsValue === null || entry.value === entry.wantsValue)
    && (entry.wantsFormula === null || entry.formula === entry.wantsFormula));
  const gates = {
    fixtureShaMatchesExpected: expected.fixtureSha256 ? fixtureSha === expected.fixtureSha256 : null,
    savedDiffersFromFixture: !savedBytes.equals(fixtureBytes),
    savedStableAfterFreshReopen: reopenedSha === savedSha,
    fixtureUnchangedAfterRun: fixtureAfter === fixtureSha,
    expectedSheetPresent: sheet !== null,
    targetCellFound: cell !== null,
    targetMarkerMatches: target ? target.text === expected.marker : false,
    targetEditedFromFixture: Boolean(target && fixtureTarget && target.text !== fixtureTarget.text),
    editExpectationsMet,
    structureComplete: Boolean(sheet && /<sheets\b/.test(requiredPart(savedParts, "xl/workbook.xml").toString("utf8"))),
    nonTargetStructurePreserved: Boolean(scoped && fixtureScoped && scoped.sha256 === fixtureScoped.sha256 && JSON.stringify(scoped.otherParts) === JSON.stringify(fixtureScoped.otherParts) && sheetFingerprints.length === fixtureSheetFingerprints.length && fixtureSheetFingerprints.every((entry, index) => sheetFingerprints[index].sha256 === entry.sha256 && JSON.stringify(sheetFingerprints[index].workbook) === JSON.stringify(entry.workbook))),
  };
  return {
    oracle: ORACLE_ID, version: ORACLE_VERSION, ok: Object.values(gates).every((v) => v === true), gates,
    expected: {
      sheetName: expected.sheetName, cell: expected.cell, marker: expected.marker,
      fixtureSha256: expected.fixtureSha256 ?? null,
      editedRefs: [...editedRefs],
      editExpectations: expectations ?? null,
    },
    edits: { checked: checkedEdits, met: editExpectationsMet },
    workbook: { sheetNames: savedModel.names, sheetCount: savedModel.names.length, resolvedSheetPart: sheet ? sheet.partName : null },
    fixture: { bytes: fixtureBytes.length, sha256: fixtureSha, sha256AfterRun: fixtureAfter },
    saved: { bytes: savedBytes.length, sha256: savedSha, sha256AfterFreshReopen: reopenedSha, differsFromFixture: gates.savedDiffersFromFixture, stableAfterFreshReopen: gates.savedStableAfterFreshReopen },
    target: { sheetName: expected.sheetName, cell: expected.cell, found: cell !== null, text: target ? target.text : null, encoding: target ? target.encoding : null },
    fingerprint: { scoped, fixture: fixtureScoped, preserved: gates.nonTargetStructurePreserved },
  };
}
// File-level API. Reads both files, then re-reads the saved file to model a
// fresh reopen. Callers passing a browser-observed reopenedPath use verifyXlsxOutput.
export function assessXlsxFile({ fixturePath, savedPath, expected }) {
  if (typeof fixturePath !== "string" || typeof savedPath !== "string") fail("bad_input_api", "fixturePath and savedPath must be strings");
  return assessXlsxBytes({ fixtureBytes: fs.readFileSync(fixturePath), savedBytes: fs.readFileSync(savedPath), expected,
    readSavedBytes: () => fs.readFileSync(savedPath), readFixtureBytes: () => fs.readFileSync(fixturePath) });
}
/**
 * Wave2 browser/oracle wrapper. input = { fixturePath, savedPath, reopenedPath,
 * expectedMarker, target: { sheetName, cell } }. reopenedPath is the actual file
 * a fresh browser context session-open observed; the wrapper re-reads it from
 * disk so a stale or fabricated hash cannot pass. The authored fixture hash is
 * pinned above, not trusted from the caller. Resolves to JSON-serializable
 * evidence (fixtureSha256/savedSha256/reopenedSha256) and throws on any unproven
 * required property.
 */
export async function verifyXlsxOutput(input) {
  if (!input || typeof input !== "object") fail("bad_input_api", "input must be an object");
  const { fixturePath, savedPath, reopenedPath, expectedMarker, target, editedRefs, editExpectations } = input;
  if (typeof fixturePath !== "string" || typeof savedPath !== "string" || typeof reopenedPath !== "string") fail("bad_input_api", "fixturePath, savedPath and reopenedPath must be strings");
  if (typeof expectedMarker !== "string" || expectedMarker.length === 0) fail("bad_input_api", "expectedMarker must be a non-empty string");
  if (!target || typeof target !== "object" || typeof target.sheetName !== "string" || typeof target.cell !== "string") fail("bad_input_api", "target.sheetName and target.cell must be strings");
  // Read the real bytes twice: once now and once as the reopen proof.
  const fixtureBytes = fs.readFileSync(fixturePath);
  const savedBytes = fs.readFileSync(savedPath);
  const reopenedBytes = fs.readFileSync(reopenedPath);
  const evidence = assessXlsxBytes({
    fixtureBytes, savedBytes,
    expected: {
      sheetName: target.sheetName, cell: target.cell, marker: expectedMarker, fixtureSha256: PINNED_FIXTURE_SHA256,
      ...(editedRefs === undefined ? {} : { editedRefs }),
      ...(editExpectations === undefined ? {} : { editExpectations }),
    },
    readSavedBytes: () => fs.readFileSync(reopenedPath),
    readFixtureBytes: () => fs.readFileSync(fixturePath),
  });
  const reopenedSha256 = sha256(reopenedBytes);
  const result = {
    oracle: ORACLE_ID, version: ORACLE_VERSION, ok: evidence.ok,
    fixturePath, savedPath, reopenedPath,
    fixtureSha256: evidence.fixture.sha256,
    savedSha256: evidence.saved.sha256,
    reopenedSha256,
    target: evidence.target, workbook: evidence.workbook, gates: evidence.gates,
    fingerprint: evidence.fingerprint, expected: evidence.expected, edits: evidence.edits,
  };
  if (!evidence.ok) {
    const unmet = Object.entries(evidence.gates).filter(([, value]) => value !== true).map(([key]) => key);
    fail("unproven_output", "unmet gates: " + unmet.join(", "));
  }
  return result;
}
