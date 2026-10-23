// UNI-667 node:test suite for the xlsx persisted-output oracle. Self-contained:
// reads the real immutable fixture and builds small synthetic xlsx packages in
// memory (ZIP + OOXML XML) to drive every read and negative path.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assessXlsxBytes, verifyXlsxOutput, XlsxOracleError, readZipParts, sha256 } from "./xlsx-output-oracle.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = (process.env.OFFICE_G0_FIXTURES_DIR ?? "").trim() || path.resolve(here, "..", "..", "lab", "fixtures");
const FIXTURE_PATH = path.join(fixturesDir, "g0-compatibility-edit.xlsx");
const FIXTURE_SHA = "a61f92875fcbec548d6e5ef48a731e709a738cf31985dbe071db6572d1992f85";
const SHEET_PART = "xl/worksheets/sheet1.xml";
const WS = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>';
const SS = '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>';
// Stored-only ZIP writer (method 0). The oracle never validates the CRC, so the
// field stays zero; this keeps the fixture builder small and deterministic.
function buildZip(entries) {
  const chunks = [], central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const raw = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(raw.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, raw);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(20, 6);
    head.writeUInt32LE(raw.length, 20); head.writeUInt32LE(raw.length, 24); head.writeUInt16LE(nameBuf.length, 28); head.writeUInt32LE(offset, 42);
    central.push(head, nameBuf);
    offset += 30 + nameBuf.length + raw.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}
const pkg = ({ sheetXml, sharedXml = null, sheetName = "Data" }) => [
  ["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
  ["xl/workbook.xml", '<?xml version="1.0"?><workbook><sheets><sheet name="' + sheetName + '" sheetId="1" r:id="rId1"/></sheets></workbook>'],
  ["xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships>' + (sharedXml ? WS + SS : WS) + "</Relationships>"],
  [SHEET_PART, sheetXml],
].concat(sharedXml ? [["xl/sharedStrings.xml", sharedXml]] : []);
const sheetWith = (cell) => '<?xml version="1.0"?><worksheet><sheetData><row r="1">' + cell + "</row></sheetData></worksheet>";
const fixtureBytes = () => fs.readFileSync(FIXTURE_PATH);
// Replace only A1 in the real fixture and repack, so structure/fingerprint paths
// run against genuine G0 bytes.
function editedFixture(replacement) {
  const bytes = fixtureBytes();
  const parts = readZipParts(bytes);
  const sheetXml = parts.get(SHEET_PART).toString("utf8");
  const entries = [...parts].map(([name, value]) => [name, name === SHEET_PART ? sheetXml.replace(/<c r="A1"[^>]*>[\s\S]*?<\/c>/, replacement) : value]);
  return { fixtureBytes: bytes, savedBytes: buildZip(entries) };
}
const edited = () => editedFixture('<c r="A1" t="inlineStr"><is><t>EDITED-UNI-667</t></is></c>');
const run = (pair, expected, extra = {}) => assessXlsxBytes({ fixtureBytes: pair.fixtureBytes, savedBytes: pair.savedBytes, expected, ...extra });
// Write a real temp file so verifyXlsxOutput's fs reads exercise real bytes.
function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "xlsx-oracle-")); }
function writeTemp(dir, name, bytes) { const file = path.join(dir, name); fs.writeFileSync(file, bytes); return file; }

test("resolves the real fixture sheet through workbook relationships and reads A1", () => {
  const report = run(edited(), { marker: "EDITED-UNI-667", sheetName: "Data", cell: "A1", fixtureSha256: FIXTURE_SHA });
  assert.equal(report.ok, true);
  assert.deepEqual(report.workbook, { sheetNames: ["Data"], sheetCount: 1, resolvedSheetPart: SHEET_PART });
  assert.equal(report.target.text, "EDITED-UNI-667");
  assert.equal(report.target.encoding, "inlineString");
  assert.equal(report.gates.nonTargetStructurePreserved, true);
});

test("reads shared-string, string, numeric and inline forms and decodes entities", () => {
  const cases = [
    ['<c r="A1" t="s"><v>0</v></c>', "sharedString", "a&b"],
    ['<c r="A1" t="str"><v>x&#45;y</v></c>', "formulaString", "x-y"],
    ['<c r="A1"><v>42</v></c>', "number", "42"],
    ['<c r="A1" t="inlineStr"><is><t>a</t><t>&#7871;b</t></is></c>', "inlineString", "a\u1ebfb"],
  ];
  for (const [cell, encoding, text] of cases) {
    const sharedXml = encoding === "sharedString" ? '<?xml version="1.0"?><sst count="1" uniqueCount="1"><si><t>a&amp;b</t></si></sst>' : null;
    const bytes = buildZip(pkg({ sheetXml: sheetWith(cell), sharedXml }));
    const report = assessXlsxBytes({ fixtureBytes: bytes, savedBytes: bytes, expected: { marker: text, sheetName: "Data", cell: "A1", fixtureSha256: sha256(bytes) } });
    assert.equal(report.target.text, text, encoding);
    assert.equal(report.target.encoding, encoding);
    assert.equal(report.gates.targetMarkerMatches, true);
  }
});

test("rejects unsupported cell encodings instead of guessing", () => {
  const bytes = buildZip(pkg({ sheetXml: sheetWith('<c r="A1" t="d"><v>2026-09-18</v></c>') }));
  assert.throws(() => assessXlsxBytes({ fixtureBytes: bytes, savedBytes: bytes, expected: { marker: "2026-09-18" } }), (e) => e instanceof XlsxOracleError && e.code === "unsupported_cell_type");
});

test("fails malformed, empty, truncated and ambiguous packages", () => {
  assert.throws(() => readZipParts(Buffer.alloc(0)), (e) => e instanceof XlsxOracleError && e.code === "empty_input");
  assert.throws(() => readZipParts(Buffer.from("not a zip")), (e) => e instanceof XlsxOracleError && e.code === "missing_eocd");
  assert.throws(() => readZipParts(fixtureBytes().subarray(0, 1200)), (e) => e instanceof XlsxOracleError);
  const sheetXml = sheetWith("");
  assert.throws(() => readZipParts(buildZip(pkg({ sheetXml }).concat([[SHEET_PART, sheetXml]]))), (e) => e instanceof XlsxOracleError && e.code === "ambiguous_zip_part");
});

test("negative: wrong sheet, wrong cell, stale bytes, lost marker and unstable reopen fail", () => {
  assert.equal(run(edited(), { marker: "EDITED-UNI-667", sheetName: "Missing", cell: "A1" }).ok, false);
  assert.equal(run(edited(), { marker: "EDITED-UNI-667", sheetName: "Data", cell: "Z9" }).gates.targetCellFound, false);
  const same = fixtureBytes();
  assert.equal(assessXlsxBytes({ fixtureBytes: same, savedBytes: same, expected: { marker: "Hello" } }).gates.savedDiffersFromFixture, false);
  assert.equal(run(editedFixture('<c r="A1" t="inlineStr"><is><t>SomethingElse</t></is></c>'), { marker: "EDITED-UNI-667" }).gates.targetMarkerMatches, false);
  const pair = edited();
  assert.equal(run(pair, { marker: "EDITED-UNI-667" }, { readSavedBytes: () => Buffer.concat([pair.savedBytes, Buffer.from("drift")]) }).gates.savedStableAfterFreshReopen, false);
});

test("verifyXlsxOutput: throws on a stale/wrong fixture pin and on unproven gates", async () => {
  const dir = tempDir();
  const pair = edited();
  const other = buildZip(pkg({ sheetXml: sheetWith('<c r="A1" t="inlineStr"><is><t>X</t></is></c>') }));
  const fixturePath = writeTemp(dir, "fixture.xlsx", other);
  const savedPath = writeTemp(dir, "saved.xlsx", pair.savedBytes);
  const reopenedPath = writeTemp(dir, "reopened.xlsx", pair.savedBytes);
  await assert.rejects(verifyXlsxOutput({ fixturePath, savedPath, reopenedPath, expectedMarker: "EDITED-UNI-667", target: { sheetName: "Data", cell: "A1" } }), (e) => e instanceof XlsxOracleError);
});

test("verifyXlsxOutput: passes on the pinned fixture with a real reopen and returns the three hashes", async () => {
  const dir = tempDir();
  const pair = edited();
  const savedPath = writeTemp(dir, "saved.xlsx", pair.savedBytes);
  const reopenedPath = writeTemp(dir, "reopened.xlsx", pair.savedBytes);
  const evidence = await verifyXlsxOutput({ fixturePath: FIXTURE_PATH, savedPath, reopenedPath, expectedMarker: "EDITED-UNI-667", target: { sheetName: "Data", cell: "A1" } });
  assert.equal(evidence.ok, true);
  assert.equal(evidence.fixtureSha256, FIXTURE_SHA);
  assert.equal(evidence.savedSha256, evidence.reopenedSha256);
  assert.equal(evidence.target.text, "EDITED-UNI-667");
  assert.equal(JSON.parse(JSON.stringify(evidence)).ok, true);
});

test("verifyXlsxOutput: rejects bad input shapes before reading bytes", async () => {
  await assert.rejects(verifyXlsxOutput(null), (e) => e instanceof XlsxOracleError && e.code === "bad_input_api");
  await assert.rejects(verifyXlsxOutput({ fixturePath: "a", savedPath: "b", reopenedPath: "c", expectedMarker: "", target: { sheetName: "Data", cell: "A1" } }), (e) => e instanceof XlsxOracleError && e.code === "bad_input_api");
  await assert.rejects(verifyXlsxOutput({ fixturePath: "a", savedPath: "b", reopenedPath: "c", expectedMarker: "m", target: {} }), (e) => e instanceof XlsxOracleError && e.code === "bad_input_api");
});

test("negative: duplicate cell ref is rejected, not find()-selected", () => {
  const dup = buildZip(pkg({ sheetXml: sheetWith('<c r="A1" t="inlineStr"><is><t>EDITED-UNI-667</t></is></c><c r="A1" t="inlineStr"><is><t>EDITED-UNI-667</t></is></c>') }));
  assert.throws(() => assessXlsxBytes({ fixtureBytes: dup, savedBytes: dup, expected: { marker: "EDITED-UNI-667", sheetName: "Data", cell: "A1", fixtureSha256: sha256(dup) } }), (e) => e instanceof XlsxOracleError && e.code === "duplicate_cell_ref");
  const dupB1 = buildZip(pkg({ sheetXml: sheetWith('<c r="A1" t="inlineStr"><is><t>EDITED-UNI-667</t></is></c><c r="B1"><v>1</v></c><c r="B1"><v>2</v></c>') }));
  assert.throws(() => assessXlsxBytes({ fixtureBytes: dupB1, savedBytes: dupB1, expected: { marker: "EDITED-UNI-667", sheetName: "Data", cell: "A1", fixtureSha256: sha256(dupB1) } }), (e) => e instanceof XlsxOracleError && e.code === "duplicate_cell_ref");
});

test("negative: malformed/unclosed outer XML throws before parsing", () => {
  const A1 = '<c r="A1" t="inlineStr"><is><t>EDITED-UNI-667</t></is></c>';
  const expected = { marker: "EDITED-UNI-667", sheetName: "Data", cell: "A1" };
  const malformed = (bytes) => assert.throws(() => assessXlsxBytes({ fixtureBytes: bytes, savedBytes: bytes, expected: { ...expected, fixtureSha256: sha256(bytes) } }), (e) => e instanceof XlsxOracleError && e.code === "malformed_xml");
  malformed(buildZip(pkg({ sheetXml: '<?xml version="1.0"?><worksheet><sheetData><row r="1">' + A1 + "</row></sheetData>" })));
  malformed(buildZip(pkg({ sheetXml: '<?xml version="1.0"?><worksheet><sheetData><row r="1">' + A1 + "</row></sheetData></sheet>" })));
  const TYPES = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>';
  malformed(buildZip([["[Content_Types].xml", TYPES], ["xl/workbook.xml", '<?xml version="1.0"?><workbook><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>'], ["xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships>' + WS + "</Relationships>"], [SHEET_PART, sheetWith(A1)]]));
});

test("negative: changed B1 value/formula or changed sheet list fails preserved structure", () => {
  const NEW = '<c r="A1" t="inlineStr"><is><t>EDITED-UNI-667</t></is></c>';
  const OLD = '<c r="A1" t="inlineStr"><is><t>Hello</t></is></c>';
  const ws = (a1, rest) => '<?xml version="1.0"?><worksheet><sheetData><row r="1">' + a1 + rest + "</row></sheetData></worksheet>";
  const expected = { marker: "EDITED-UNI-667", sheetName: "Data", cell: "A1" };
  const fixtureValue = buildZip(pkg({ sheetXml: ws(OLD, '<c r="B1"><v>41</v></c>') }));
  const savedValue = buildZip(pkg({ sheetXml: ws(NEW, '<c r="B1"><v>42</v></c>') }));
  const valueReport = assessXlsxBytes({ fixtureBytes: fixtureValue, savedBytes: savedValue, expected: { ...expected, fixtureSha256: sha256(fixtureValue) } });
  assert.equal(valueReport.gates.targetMarkerMatches, true);
  assert.equal(valueReport.gates.nonTargetStructurePreserved, false);
  assert.equal(valueReport.ok, false);
  const fixtureFormula = buildZip(pkg({ sheetXml: ws(OLD, '<c r="B1"><f>SUM(A2:A3)</f><v>41</v></c>') }));
  const savedFormula = buildZip(pkg({ sheetXml: ws(NEW, '<c r="B1"><f>SUM(A2:A4)</f><v>41</v></c>') }));
  assert.equal(assessXlsxBytes({ fixtureBytes: fixtureFormula, savedBytes: savedFormula, expected: { ...expected, fixtureSha256: sha256(fixtureFormula) } }).gates.nonTargetStructurePreserved, false);

});

const NEW_A1 = '<c r="A1" t="inlineStr"><is><t>EDITED-UNI-667</t></is></c>';
const SIMPLE_A1 = (text) => '<c r="A1" t="inlineStr"><is><t>' + text + '</t></is></c>';
// Repack an existing package's parts with one authored edit, preserving names/order.
function rezip(pair, tweak) {
  const parts = readZipParts(pair.savedBytes);
  return buildZip([...parts].map(([name, value]) => [name, tweak(name, value)]));
}
const changeStyles = (pair) => rezip(pair, (name, value) => (name === "xl/styles.xml" ? Buffer.concat([value, Buffer.from("<!--tampered-->")]) : value));
const deleteStyles = (pair) => buildZip([...readZipParts(pair.savedBytes)].filter(([name]) => name !== "xl/styles.xml"));
const changeCustomXml = (pair) => rezip(pair, (name, value) => (name === "customXml/item1.xml" ? Buffer.from('<compatibility-marker value="tampered"/>', "utf8") : value));
const changeChart = (pair) => rezip(pair, (name, value) => (name === "xl/charts/chart1.xml" ? Buffer.from('<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:title/></c:chartSpace>', "utf8") : value));
const deleteChart = (pair) => buildZip([...readZipParts(pair.savedBytes)].filter(([name]) => name !== "xl/charts/chart1.xml"));
// Serialization-only diff: strip whitespace before tags in the target sheet. No
// authored value changes, so preservation must still pass (named allowance).
const reserializeSheet = (pair) => rezip(pair, (name, value) => (name === SHEET_PART ? Buffer.from(value.toString("utf8").replace(/\s+</g, "<").trim(), "utf8") : value));
// Named blind spot: an exempt container can change without failing preservation.
const changeExemptTypes = (pair) => rezip(pair, (name, value) => (name === "[Content_Types].xml" ? Buffer.from(value.toString("utf8").replace("sheet.main+xml", "sheet.main+xmlTAMPERED"), "utf8") : value));

test("F1: markup inside comments/CDATA/PIs is rejected, never read as a cell, sheet or relationship", async () => {
  const expected = { marker: "EDITED-UNI-667", sheetName: "Data", cell: "A1" };
  const rejects = (bytes, code) => assert.throws(() => assessXlsxBytes({ fixtureBytes: bytes, savedBytes: bytes, expected: { ...expected, fixtureSha256: sha256(bytes) } }), (e) => e instanceof XlsxOracleError && e.code === code);
  rejects(buildZip(pkg({ sheetXml: '<?xml version="1.0"?><worksheet><sheetData><row r="1"><!--' + NEW_A1 + '--></row></sheetData></worksheet>' })), "xml_markup_in_comment");
  rejects(buildZip(pkg({ sheetXml: '<?xml version="1.0"?><worksheet><sheetData><row r="1">' + NEW_A1 + '</row></sheetData><ignored><![CDATA[' + NEW_A1 + ']]></ignored></worksheet>' })), "xml_markup_in_cdata");
  rejects(buildZip(pkg({ sheetXml: '<?xml version="1.0"?><worksheet><sheetData><row r="1">' + NEW_A1 + '</row></sheetData><?note ' + NEW_A1 + '?></worksheet>' })), "xml_markup_in_processing_instruction");
  const TYPES = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>';
  const WS_REL = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>';
  const realSheet = sheetWith(NEW_A1);
  rejects(buildZip([["[Content_Types].xml", TYPES], ["xl/workbook.xml", '<?xml version="1.0"?><workbook><sheets></sheets><!--<sheet name="Data" sheetId="1" r:id="rId1"/>--></workbook>'], ["xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships>' + WS_REL + "</Relationships>"], [SHEET_PART, realSheet]]), "xml_markup_in_comment");
  rejects(buildZip([["[Content_Types].xml", TYPES], ["xl/workbook.xml", '<?xml version="1.0"?><workbook><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>'], ["xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships><!--' + WS_REL + '--></Relationships>'], [SHEET_PART, realSheet]]), "xml_markup_in_comment");
  const dir = tempDir();
  const pair = editedFixture("<!--" + NEW_A1 + "-->");
  const savedPath = writeTemp(dir, "saved-comment.xlsx", pair.savedBytes);
  const reopenedPath = writeTemp(dir, "reopened-comment.xlsx", pair.savedBytes);
  await assert.rejects(verifyXlsxOutput({ fixturePath: FIXTURE_PATH, savedPath, reopenedPath, expectedMarker: "EDITED-UNI-667", target: { sheetName: "Data", cell: "A1" } }), (e) => e instanceof XlsxOracleError && e.code === "xml_markup_in_comment");
});
// NEW positive: a real XML declaration, a plain comment, and markup-free CDATA +
// PI must load. Under the r3 gate each container's own delimiter matched and every
// such package was wrongly rejected, so this is the fail-first case for A1.
test("F1p: normal declaration, plain comment and markup-free CDATA/PI are accepted", () => {
  const ws = (text, suffix) => '<?xml version="1.0"?><!-- plain note --><worksheet><sheetData><row r="1">' + SIMPLE_A1(text) + "</row></sheetData>" + suffix + "</worksheet>";
  const fixture = buildZip(pkg({ sheetXml: ws("Hello", "<![CDATA[plain]]><?note plain?>") }));
  const saved = buildZip(pkg({ sheetXml: ws("EDITED-UNI-667", "<![CDATA[plain, resaved]]><?note plain again?>") }));
  const report = assessXlsxBytes({ fixtureBytes: fixture, savedBytes: saved, expected: { marker: "EDITED-UNI-667", sheetName: "Data", cell: "A1", fixtureSha256: sha256(fixture) } });
  assert.equal(report.ok, true);
  assert.equal(report.target.text, "EDITED-UNI-667");
  assert.equal(report.gates.nonTargetStructurePreserved, true);
});

test("F2: changed or deleted non-target parts and other worksheets fail preservation", () => {
  const expected = { marker: "EDITED-UNI-667", sheetName: "Data", cell: "A1", fixtureSha256: FIXTURE_SHA };
  const preserved = (saved) => assessXlsxBytes({ fixtureBytes: edited().fixtureBytes, savedBytes: saved, expected }).gates.nonTargetStructurePreserved;
  // positive: only Data/A1 edited.
  assert.equal(preserved(edited().savedBytes), true);
  // allowed: legitimate reserialization of the target sheet (no authored change).
  assert.equal(preserved(reserializeSheet(edited())), true);
  // styles.xml changed / deleted, customXml changed, chart changed / deleted.
  assert.equal(preserved(changeStyles(edited())), false);
  assert.equal(preserved(deleteStyles(edited())), false);
  assert.equal(preserved(changeCustomXml(edited())), false);
  assert.equal(preserved(changeChart(edited())), false);
  assert.equal(preserved(deleteChart(edited())), false);
  // named blind spot: an exempt container may change without failing.
  assert.equal(preserved(changeExemptTypes(edited())), true);
});

test("F2-multi: only Data/A1 is edited; a changed other sheet fails", () => {
  const TYPES = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>';
  const WS_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet";
  const multi = (names, cellFor) => buildZip([["[Content_Types].xml", TYPES], ["xl/workbook.xml", '<?xml version="1.0"?><workbook><sheets>' + names.map((n, i) => '<sheet name="' + n + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join("") + "</sheets></workbook>"], ["xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships>' + names.map((n, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + WS_TYPE + '" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join("") + "</Relationships>"]].concat(names.map((n, i) => ["xl/worksheets/sheet" + (i + 1) + ".xml", '<?xml version="1.0"?><worksheet><sheetData><row r="1">' + cellFor(n) + "</row></sheetData></worksheet>"])));
  const expected = { marker: "EDITED-UNI-667", sheetName: "Data", cell: "A1" };
  const fixtureSheets = multi(["Data", "Extra"], () => SIMPLE_A1("Hello"));
  const gate = (saved) => assessXlsxBytes({ fixtureBytes: fixtureSheets, savedBytes: saved, expected: { ...expected, fixtureSha256: sha256(fixtureSheets) } }).gates;
  // positive: only Data/A1 changes; Extra is byte- and model-identical.
  const onlyData = multi(["Data", "Extra"], (name) => (name === "Data" ? NEW_A1 : SIMPLE_A1("Hello")));
  assert.equal(gate(onlyData).targetMarkerMatches, true);
  assert.equal(gate(onlyData).nonTargetStructurePreserved, true);
  assert.equal(assessXlsxBytes({ fixtureBytes: fixtureSheets, savedBytes: onlyData, expected: { ...expected, fixtureSha256: sha256(fixtureSheets) } }).ok, true);
  // negative: Extra/A1 value changes while Data/A1 is the edit.
  assert.equal(gate(multi(["Data", "Extra"], (name) => (name === "Data" ? NEW_A1 : SIMPLE_A1("Changed")))).nonTargetStructurePreserved, false);
  // negative: a column is added on Extra only.
  assert.equal(gate(multi(["Data", "Extra"], (name) => (name === "Data" ? NEW_A1 : SIMPLE_A1("Hello") + '<c r="Z1"><v>7</v></c>'))).nonTargetStructurePreserved, false);
  // negative: sheet order changes (Extra before Data).
  assert.equal(gate(multi(["Extra", "Data"], (name) => (name === "Data" ? NEW_A1 : SIMPLE_A1("Hello")))).nonTargetStructurePreserved, false);
  // negative: a sheet is added.
  assert.equal(gate(multi(["Data", "Extra", "More"], (name) => (name === "Data" ? NEW_A1 : SIMPLE_A1("Hello")))).nonTargetStructurePreserved, false);
});

// r5 G1 closes Cursor F1: the caller marker cannot already be the fixture's
// authored target text. An A1-unchanged save whose only deltas are exempt or
// metadata fails on the real pinned fixture; a genuine A1 edit passes through the
// real FS wrapper.
test("G1: marker echo without a real A1 change fails; a real edit passes", async () => {
  const dir = tempDir();
  const fixture = fixtureBytes();
  const expected = { marker: "Hello", sheetName: "Data", cell: "A1", fixtureSha256: FIXTURE_SHA };
  const variants = [
    ["metadata-only", rezip({ savedBytes: fixture }, (name, value) => (name === "[Content_Types].xml" ? Buffer.concat([value, Buffer.from("<!--reserialized-->")]) : value))],
    ["workbook-reserialize", rezip({ savedBytes: fixture }, (name, value) => (name === "xl/workbook.xml" ? Buffer.from(value.toString("utf8").replace("<sheets>", "<sheets >"), "utf8") : value))],
  ];
  for (const [label, saved] of variants) {
    const report = run({ fixtureBytes: fixture, savedBytes: saved }, expected);
    assert.equal(report.gates.targetMarkerMatches, true, label);
    assert.equal(report.gates.savedDiffersFromFixture, true, label);
    assert.equal(report.gates.nonTargetStructurePreserved, true, label);
    assert.equal(report.gates.targetEditedFromFixture, false, label);
    assert.equal(report.ok, false, label);
    const savedPath = writeTemp(dir, label + "-saved.xlsx", saved);
    const reopenedPath = writeTemp(dir, label + "-reopened.xlsx", saved);
    await assert.rejects(verifyXlsxOutput({ fixturePath: FIXTURE_PATH, savedPath, reopenedPath, expectedMarker: "Hello", target: { sheetName: "Data", cell: "A1" } }), (e) => e instanceof XlsxOracleError && e.code === "unproven_output" && /targetEditedFromFixture/.test(e.detail), label);
  }
  const pair = edited();
  const savedPath = writeTemp(dir, "edited-saved.xlsx", pair.savedBytes);
  const reopenedPath = writeTemp(dir, "edited-reopened.xlsx", pair.savedBytes);
  const evidence = await verifyXlsxOutput({ fixturePath: FIXTURE_PATH, savedPath, reopenedPath, expectedMarker: "EDITED-UNI-667", target: { sheetName: "Data", cell: "A1" } });
  assert.equal(evidence.ok, true);
  assert.equal(evidence.target.text, "EDITED-UNI-667");
  assert.equal(evidence.gates.targetEditedFromFixture, true);
});

// The recalc lane: a real edit of C1 (which Data!B3 = SUM(C1:C2) depends on) must be saved with a
// REFRESHED cached value on B3 while its formula is preserved. The oracle accepts the dependent ref
// only when the caller declares it AND states the expected value/formula; an undeclared change to a
// dependent cell still fails preservation, and a wrong expectation fails by name.
test("R4: a declared recalculated dependent cell is verified by value+formula, never assumed", () => {
  const fixture = fixtureBytes();
  const parts = readZipParts(fixture);
  const sheetXml = parts.get(SHEET_PART).toString("utf8");
  const withEdit = (c1, b3) => buildZip([...parts].map(([name, value]) => [name,
    name === SHEET_PART
      ? sheetXml.replace(/<c r="C1">[\s\S]*?<\/c>/, c1).replace(/<c r="B3">[\s\S]*?<\/c>/, b3)
      : value]));
  const editedC1 = '<c r="C1"><v>9</v></c>';
  const recalculatedB3 = '<c r="B3"><f>SUM(C1:C2)</f><v>9</v></c>';
  const saved = withEdit(editedC1, recalculatedB3);
  // The target cell IS C1 here (the cell the formula depends on), so its post-save marker is 9.
  const base = { marker: "9", sheetName: "Data", cell: "C1", fixtureSha256: FIXTURE_SHA };
  // Declared: both refs are edited content, and B3 must read 9 with its formula intact.
  const declared = run({ fixtureBytes: fixture, savedBytes: saved }, {
    ...base,
    editedRefs: ["C1", "B3"],
    editExpectations: { C1: { value: "9" }, B3: { value: "9", formula: "SUM(C1:C2)" } },
  });
  assert.equal(declared.gates.editExpectationsMet, true);
  assert.equal(declared.gates.nonTargetStructurePreserved, true);
  assert.equal(declared.ok, true);
  assert.deepEqual(declared.edits.checked.map((entry) => entry.ref), ["C1", "B3"]);
  // A stale cached dependent value fails the declared expectation by name.
  const stale = run({ fixtureBytes: fixture, savedBytes: withEdit(editedC1, '<c r="B3"><f>SUM(C1:C2)</f><v>5</v></c>') }, {
    ...base,
    editedRefs: ["C1", "B3"],
    editExpectations: { B3: { value: "9", formula: "SUM(C1:C2)" } },
  });
  assert.equal(stale.gates.editExpectationsMet, false);
  assert.equal(stale.ok, false);
  // A dropped formula (value written as a literal) fails the declared formula expectation.
  const flattened = run({ fixtureBytes: fixture, savedBytes: withEdit(editedC1, '<c r="B3"><v>9</v></c>') }, {
    ...base,
    editedRefs: ["C1", "B3"],
    editExpectations: { B3: { value: "9", formula: "SUM(C1:C2)" } },
  });
  assert.equal(flattened.gates.editExpectationsMet, false);
  assert.equal(flattened.ok, false);
  // A dependent ref that is NOT declared stays authored content: the same recalc fails preservation.
  const undeclared = run({ fixtureBytes: fixture, savedBytes: saved }, {
    ...base, editedRefs: ["C1"],
  });
  assert.equal(undeclared.gates.editExpectationsMet, true, 'no expectations declared is vacuously met');
  assert.equal(undeclared.gates.nonTargetStructurePreserved, false, 'an undeclared dependent change is still a preservation failure');
  assert.equal(undeclared.ok, false);
  // A declared ref that is missing from the saved sheet never passes.
  const missing = run({ fixtureBytes: fixture, savedBytes: saved }, {
    ...base, editedRefs: ["C1", "B3"], editExpectations: { Z9: { value: "1" } },
  });
  assert.equal(missing.gates.editExpectationsMet, false);
  assert.equal(missing.ok, false);
});

// r5 G2 closes Cursor F2: the fixture's authored definedName Total -> Data!$C$1
// rides inside the byte-exempt xl/workbook.xml and is now modelled semantically.
test("G2: authored defined names survive reserialization and reject deletion, retarget, duplicates", () => {
  const expected = { marker: "EDITED-UNI-667", sheetName: "Data", cell: "A1", fixtureSha256: FIXTURE_SHA };
  const preserved = (saved) => assessXlsxBytes({ fixtureBytes: edited().fixtureBytes, savedBytes: saved, expected }).gates.nonTargetStructurePreserved;
  // Function replacer keeps "$C$1"-style text out of replacement-pattern parsing.
  const rewriteWorkbook = (pair, from, to) => rezip(pair, (name, value) => (name === "xl/workbook.xml" ? Buffer.from(value.toString("utf8").replace(from, () => to), "utf8") : value));
  const DEFINED = '<definedName name="Total">Data!$C$1</definedName>';
  // positive: unchanged names, only Data/A1 edited.
  assert.equal(preserved(edited().savedBytes), true);
  // positive: harmless attribute order / whitespace serialization is tolerated.
  assert.equal(preserved(rewriteWorkbook(edited(), DEFINED, '<definedName   name="Total" >\n      Data!$C$1\n    </definedName>')), true);
  // negative: deletion of the authored defined name.
  assert.equal(preserved(rewriteWorkbook(edited(), "<definedNames>" + DEFINED + "</definedNames>", "<definedNames></definedNames>")), false);
  // negative: retarget of the authored defined name.
  assert.equal(preserved(rewriteWorkbook(edited(), "Data!$C$1", "Data!$C$2")), false);
  // negative: duplicate/ambiguous entry fails closed, never a silent pass.
  assert.throws(() => assessXlsxBytes({ fixtureBytes: edited().fixtureBytes, savedBytes: rewriteWorkbook(edited(), DEFINED, DEFINED + DEFINED), expected }), (e) => e instanceof XlsxOracleError && e.code === "ambiguous_defined_name");
});
