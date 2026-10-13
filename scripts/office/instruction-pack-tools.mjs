// Contract helpers for the G6-14 Office instruction pack (UNI-1369).
//
// The pack shipped as server/internal/ai/testdata/office_uniwork_ai_v1_*.golden
// may only name tools that the mechanical block of
// docs/office/g5g6g7/genoffice-tools.md lists for the section's module, and the
// common section may only name tools all six modules have. A tool name is any
// snake_case token `[a-z][a-z0-9]*(_[a-z0-9]+)+` in the pack, so mentioning a
// tool means writing its name and nothing else matches by accident. The parser
// and the audits are pure so the negative cases can drive them with fixture
// strings; the sibling test wires the real doc and the real goldens.

export const PACK_MODULES = ["sheets", "docs", "slides", "pdf", "markdown", "html"];
export const TOOLS_DOC = "docs/office/g5g6g7/genoffice-tools.md";

const TOOL_TOKEN_SOURCE = String.raw`\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b`;
const SNAKE_CASE_TOOL = new RegExp(`^${TOOL_TOKEN_SOURCE}$`);
const SCHEMA_SHA256 = /^[0-9a-f]{64}$/;
const MODULE_NAME = /^[a-z][a-z0-9-]*$/;
const HEADER = ["module", "tool", "input_schema_sha256", "editor_write", "source"];
const PROVENANCE_COMMENT = /^<!-- genoffice-tools-extract [^>]*-->$/;

/** Every distinct snake_case token in `text`, in order of first appearance. */
export function snakeCaseTokens(text) {
  return [...new Set(text.match(new RegExp(TOOL_TOKEN_SOURCE, "g")) ?? [])];
}

/**
 * The mechanical block of `genoffice-tools.md` as `Map<module, Set<tool>>`,
 * with the number of tool rows. Throws loudly when the doc layout changed:
 * missing markers, another header, a line that is neither a table row, a
 * blank line nor the extractor's provenance comment (a wrapped row), a row
 * that is not five machine-shaped cells, or a repeated (module, tool) pair.
 */
export function parseMechanicalTable(markdown) {
  // The markers also appear inside §1's AC-2 recipe (`sed -e '1,/^<!-- extract:begin -->$/d'`),
  // so only a marker alone on its line opens the block; `\r?` keeps a CRLF
  // checkout of the doc parsing (BE14-4).
  const marker = (name) => new RegExp(`^<!-- extract:${name} -->\r?$`, "m").exec(markdown);
  const begin = marker("begin");
  const end = marker("end");
  if (!begin || !end || end.index < begin.index) {
    throw new Error(`${TOOLS_DOC}: the mechanical block markers (<!-- extract:begin --> / <!-- extract:end -->), each alone on its line, were not found`);
  }
  const lines = [];
  for (const raw of markdown.slice(begin.index + begin[0].length, end.index).split("\n")) {
    const line = raw.replace(/\r$/, "");
    // The block is the extractor's output (§3): the table, its provenance
    // comment and blank lines. Anything else is a wrapped row or stray text
    // and must throw instead of being filtered out of the table (BE14-5).
    if (line.trim() === "" || PROVENANCE_COMMENT.test(line)) continue;
    if (!line.startsWith("|")) {
      throw new Error(`${TOOLS_DOC}: the mechanical block has a line that is neither a table row, a blank line nor the extractor provenance comment (a wrapped table row?): ${JSON.stringify(line)}`);
    }
    lines.push(line);
  }
  if (lines.length < HEADER.length + 3) {
    throw new Error(`${TOOLS_DOC}: the mechanical block has ${lines.length} table lines; expected a header, a separator and the tool rows`);
  }
  const cells = (line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  const header = cells(lines[0]);
  if (header.length !== HEADER.length || header.some((cell, index) => cell !== HEADER[index])) {
    throw new Error(`${TOOLS_DOC}: the mechanical table header is "${header.join(" | ")}"; expected "| ${HEADER.join(" | ")} |"`);
  }
  const separator = cells(lines[1]);
  if (separator.length !== HEADER.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    throw new Error(`${TOOLS_DOC}: the mechanical table has no column separator after the header`);
  }
  const byModule = new Map();
  let rowCount = 0;
  for (const line of lines.slice(2)) {
    const row = cells(line);
    if (row.length !== HEADER.length) {
      throw new Error(`${TOOLS_DOC}: mechanical row has ${row.length} columns, expected ${HEADER.length}: ${line}`);
    }
    const [module, tool, schemaSha256, editorWrite, source] = row;
    if (!MODULE_NAME.test(module)) throw new Error(`${TOOLS_DOC}: mechanical row names module "${module}": ${line}`);
    if (!SNAKE_CASE_TOOL.test(tool)) throw new Error(`${TOOLS_DOC}: mechanical row names tool "${tool}", which is not a snake_case tool name: ${line}`);
    if (!SCHEMA_SHA256.test(schemaSha256)) throw new Error(`${TOOLS_DOC}: mechanical row for ${module} ${tool} has no 64-hex input schema hash: ${line}`);
    if (editorWrite !== "yes" && editorWrite !== "no") throw new Error(`${TOOLS_DOC}: mechanical row for ${module} ${tool} has editor_write "${editorWrite}", expected yes | no: ${line}`);
    if (source.length === 0) throw new Error(`${TOOLS_DOC}: mechanical row for ${module} ${tool} has no source: ${line}`);
    if (!byModule.has(module)) byModule.set(module, new Set());
    const tools = byModule.get(module);
    if (tools.has(tool)) throw new Error(`${TOOLS_DOC}: the mechanical block repeats ${module} ${tool}`);
    tools.add(tool);
    rowCount += 1;
  }
  return { byModule, rowCount };
}

/**
 * Every snake_case token of one pack section must be a tool of that module.
 * Returns findings (`token`, `section`, `file`, `message`); an empty array
 * means clean. Never throws.
 */
export function auditSection({ section, file, text, tools }) {
  const findings = [];
  for (const token of snakeCaseTokens(text)) {
    if (!tools.has(token)) {
      findings.push({
        token,
        section,
        file,
        message: `tool "${token}" in section "${section}" (${file}) is not in the "${section}" column of ${TOOLS_DOC} §3`,
      });
    }
  }
  return findings;
}

/**
 * Every snake_case token of the common section must be a tool all six modules
 * have. Returns findings; `missingModules` names the columns the token is not
 * in. Never throws.
 */
export function auditCommon({ file, text, byModule }) {
  const modules = [...byModule.keys()];
  const findings = [];
  for (const token of snakeCaseTokens(text)) {
    const missing = modules.filter((module) => !byModule.get(module).has(token));
    if (missing.length > 0) {
      findings.push({
        token,
        section: "common",
        file,
        missingModules: missing,
        message: `tool "${token}" in the common section (${file}) is missing from the ${missing.join(", ")} column(s) of ${TOOLS_DOC} §3; the common section may only name tools all six modules have`,
      });
    }
  }
  return findings;
}
