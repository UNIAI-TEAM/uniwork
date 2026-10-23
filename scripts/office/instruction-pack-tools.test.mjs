// Contract test for the G6-14 Office instruction pack (UNI-1369, plan card
// G6-14): the packs shipped as server/internal/ai/testdata/office_uniwork_ai_v{1,2,3}_*
// may only name tools the mechanical block of
// docs/office/g5g6g7/genoffice-tools.md lists for the section's module, and
// the common section may only name tools all six modules have. The parser and
// the audits live in ./instruction-pack-tools.mjs, so the negative cases below
// drive them with fixture strings and hold even when the goldens are not in
// the tree yet; this file wires the real doc and the real goldens. Historical
// v1/v2 checks stay; v3 is the current pack (UNI-1875 PACK3 B2).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PACK_MODULES, TOOLS_DOC, auditCommon, auditSection, parseMechanicalTable } from "./instruction-pack-tools.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const toolsDoc = fs.readFileSync(path.join(repoRoot, TOOLS_DOC), "utf8");
const PACK_VERSIONS = [1, 2, 3];
const goldenFile = (section, version = 1) => `server/internal/ai/testdata/office_uniwork_ai_v${version}_${section}.golden`;

/** The goldens for `sections` at `version`, or one failure naming every file that is missing. */
function readGoldens(sections, version = 1) {
  const missing = sections.filter((section) => !fs.existsSync(path.join(repoRoot, goldenFile(section, version))));
  if (missing.length > 0) assert.fail(missing.map((section) => `golden missing: ${goldenFile(section, version)}`).join("\n"));
  return new Map(sections.map((section) => [section, fs.readFileSync(path.join(repoRoot, goldenFile(section, version)), "utf8")]));
}

function assertClean(findings) {
  assert.deepEqual(findings.map((finding) => finding.message), [], `${findings.length} instruction-pack tool-name violation(s)`);
}

test("the mechanical table parses into the six pack modules with a plausible tool count", () => {
  const { byModule, rowCount } = parseMechanicalTable(toolsDoc);
  assert.deepEqual([...byModule.keys()].sort(), [...PACK_MODULES].sort(), "the mechanical table must cover exactly the six pack modules");
  assert.ok(rowCount >= 100, `the mechanical table parsed ${rowCount} tool rows; the doc layout probably changed`);
  for (const module of PACK_MODULES) {
    assert.ok(byModule.get(module).size >= 5, `module "${module}" parsed ${byModule.get(module).size} tools; a live module has more`);
  }
});

test("the mechanical table parses a CRLF copy of the doc", () => {
  const helperSrc = fs.readFileSync(new URL("./instruction-pack-tools.mjs", import.meta.url), "utf8");
  const markerExpr = helperSrc.match(/const marker = \(name\) => new RegExp\(`([^`]+)`, "([^"]+)"\)/);
  assert.ok(markerExpr, "instruction-pack-tools.mjs must define the extract marker RegExp");
  for (const name of ["begin", "end"]) {
    const markerRe = new RegExp(markerExpr[1].replace("${name}", name), markerExpr[2]);
    const crlfSample = `prose\r\n<!-- extract:${name} -->\r\n| row |\r\n`;
    assert.equal(
      markerRe.exec(crlfSample)?.[0],
      `<!-- extract:${name} -->\r`,
      `marker("${name}") must consume the trailing CR on a CRLF marker line`,
    );
  }
  const lf = parseMechanicalTable(toolsDoc);
  const crlfDoc = toolsDoc.replace(/\r?\n/g, "\r\n");
  assert.ok(crlfDoc.includes("\r\n") && !/[^\r]\n/.test(crlfDoc), "the fixture must use CRLF line ends and no bare LF");
  const crlf = parseMechanicalTable(crlfDoc);
  assert.equal(crlf.rowCount, lf.rowCount, "the CRLF copy parsed a different number of tool rows");
  assert.deepEqual([...crlf.byModule.keys()], [...lf.byModule.keys()]);
  for (const module of PACK_MODULES) {
    assert.deepEqual([...crlf.byModule.get(module)], [...lf.byModule.get(module)], `the "${module}" column changed under CRLF`);
  }
});

test("a wrapped row inside the mechanical block fails the parse loudly", () => {
  const header = "| module | tool | input_schema_sha256 | editor_write | source |";
  const separator = "| --- | --- | --- | --- | --- |";
  const row = (tool) => `| docs | ${tool} | ${"a".repeat(64)} | yes | apps/docs/x.ts |`;
  const block = (middle) =>
    [
      "<!-- extract:begin -->",
      "<!-- genoffice-tools-extract v1 rev=deadbeef -->",
      header,
      separator,
      row("accept_changes"),
      row("add_comment"),
      middle,
      row("apply_ops"),
      row("edit_chart"),
      row("insert_image"),
      row("write_document"),
      "",
      "<!-- extract:end -->",
    ].join("\n");
  // Control: a blank line and the extractor's own provenance comment are not
  // table rows and must not fail the parse.
  assert.equal(parseMechanicalTable(block("")).rowCount, 6);
  // A row the author wrapped: the continuation line is neither a table row, a
  // blank line nor the provenance comment, so it must fail loudly instead of
  // being filtered out of the table.
  let error;
  assert.throws(() => parseMechanicalTable(block("  apps/docs/x.ts |")), (thrown) => {
    error = thrown;
    return true;
  });
  assert.ok(error instanceof Error, `expected an Error, got ${error}`);
  assert.ok(error.message.includes(TOOLS_DOC), error.message);
  assert.match(error.message, /neither a table row/, error.message);
  assert.ok(error.message.includes("apps/docs/x.ts |"), error.message);
});

test("a mechanical row whose schema cell is the documented unresolved:<reason> form parses; any other non-hash cell throws", () => {
  const header = "| module | tool | input_schema_sha256 | editor_write | source |";
  const separator = "| --- | --- | --- | --- | --- |";
  const row = (tool, cell) => `| docs | ${tool} | ${cell} | yes | apps/docs/x.ts |`;
  const block = (lastCell) =>
    [
      "<!-- extract:begin -->",
      "<!-- genoffice-tools-extract v1 rev=deadbeef -->",
      header,
      separator,
      row("accept_changes", "a".repeat(64)),
      row("add_comment", "b".repeat(64)),
      row("apply_ops", "c".repeat(64)),
      row("edit_chart", "d".repeat(64)),
      row("insert_image", "e".repeat(64)),
      row("generate_mindmap", lastCell),
      "",
      "<!-- extract:end -->",
    ].join("\n");
  // The block header's own contract: the extractor writes `unresolved:<reason>`
  // for a schema it cannot resolve statically, and the row keeps its tool name.
  const parsed = parseMechanicalTable(block("unresolved:identifier:depth"));
  assert.equal(parsed.rowCount, 6);
  assert.ok(parsed.byModule.get("docs").has("generate_mindmap"), "an unresolved row still names its tool");
  // Every other shape of a non-hex cell still fails loudly, so the accepted
  // form stays exactly `unresolved:` plus a lowercase reason.
  for (const cell of [
    "unresolved",
    "unresolved:",
    "unresolved:Identifier",
    "unresolved:depth!",
    "Unresolved:depth",
    "unresolved :depth",
    "deadbeef",
    "a".repeat(63),
    "a".repeat(65),
    `${"a".repeat(63)}g`,
  ]) {
    assert.throws(() => parseMechanicalTable(block(cell)), new RegExp(`${TOOLS_DOC}.*input schema`), `cell ${JSON.stringify(cell)} must not parse`);
  }
});

test("every tool name in a module section is in that module's column", () => {
  const { byModule } = parseMechanicalTable(toolsDoc);
  const findings = [];
  for (const version of PACK_VERSIONS) {
    const goldens = readGoldens(PACK_MODULES, version);
    for (const module of PACK_MODULES) {
      findings.push(...auditSection({ section: module, file: goldenFile(module, version), text: goldens.get(module), tools: byModule.get(module) }));
    }
  }
  assertClean(findings);
});

test("every tool name in the common section is in all six module columns", () => {
  const { byModule } = parseMechanicalTable(toolsDoc);
  const findings = [];
  for (const version of PACK_VERSIONS) {
    const goldens = readGoldens(["common"], version);
    findings.push(...auditCommon({ file: goldenFile("common", version), text: goldens.get("common"), byModule }));
  }
  assertClean(findings);
});

test("a section that names an unknown tool fails, naming token, section and file", () => {
  const { byModule } = parseMechanicalTable(toolsDoc);
  const file = "fixture/sheets-section.txt";
  const findings = auditSection({ section: "sheets", file, text: "Count the column with do_the_thing.", tools: byModule.get("sheets") });
  assert.equal(findings.length, 1, findings.map((finding) => finding.message).join("\n"));
  assert.equal(findings[0].token, "do_the_thing");
  assert.ok(findings[0].message.includes("do_the_thing"), findings[0].message);
  assert.ok(findings[0].message.includes('section "sheets"'), findings[0].message);
  assert.ok(findings[0].message.includes(file), findings[0].message);
});

test("a section that names another module's tool fails", () => {
  const { byModule } = parseMechanicalTable(toolsDoc);
  const foreign = [...byModule.get("sheets")].find((tool) => !byModule.get("docs").has(tool));
  assert.ok(foreign, "the fixture needs a sheets tool the docs column does not have");
  const file = "fixture/docs-section.txt";
  const findings = auditSection({ section: "docs", file, text: `Do it with ${foreign}.`, tools: byModule.get("docs") });
  assert.equal(findings.length, 1, findings.map((finding) => finding.message).join("\n"));
  assert.equal(findings[0].token, foreign);
  assert.ok(findings[0].message.includes(`section "docs"`), findings[0].message);
  assert.ok(findings[0].message.includes(file), findings[0].message);
});

test("a common-section tool missing in one module fails", () => {
  const { byModule } = parseMechanicalTable(toolsDoc);
  const oneModuleShort = new Map([...byModule].map(([module, tools]) => [module, new Set(tools)]));
  assert.ok(oneModuleShort.get("html").has("ask_clarification"), "the fixture needs ask_clarification in the html column");
  oneModuleShort.get("html").delete("ask_clarification");
  const file = "fixture/common-section.txt";
  const text = "Ask with ask_clarification when the request is ambiguous.";
  const findings = auditCommon({ file, text, byModule: oneModuleShort });
  assert.equal(findings.length, 1, findings.map((finding) => finding.message).join("\n"));
  assert.equal(findings[0].token, "ask_clarification");
  assert.deepEqual(findings[0].missingModules, ["html"]);
  assert.ok(findings[0].message.includes(file), findings[0].message);
  // Control: the same text is clean against the real table, so the fixture
  // trips on the removed tool and nothing else.
  assert.deepEqual(auditCommon({ file, text, byModule }), []);
});
