// The `extractor` check (contract 2.2, Amendment 2): run the G6-01 extractor
// against the pin revision and compare its columns with the committed block
// between the extract:begin/extract:end markers of docs/office/g5g6g7/
// genoffice-tools.md. Only the three mechanical columns are compared; the
// manual columns are never read.
//
// The extractor defaults to the fork checkout's own
// scripts/genoffice-tools-extract.mjs; --extractor (G706_EXTRACTOR) points at
// the fixed script while it still lives on a fork branch. Its git blob sha is
// recorded either way (Amendment 2), so the artifact says which script ran.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOOLS_DOC, relativeToOut, runGit, tail } from "./job-lib.mjs";

const BEGIN = "<!-- extract:begin -->";
const END = "<!-- extract:end -->";
const ROW = /^\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/;
const REV = /rev=([0-9a-f]{6,64})/;

/**
 * The block between the two markers: exactly the lines the doc's own `sed`
 * pair prints (both marker lines excluded). The extractor's stdout is that
 * block already, without the markers, so this runs on the doc only.
 * @param {string} text
 * @returns {string[] | null}
 */
export function committedBlockLines(text) {
  const lines = text.split(/\r?\n/);
  const begin = lines.indexOf(BEGIN);
  const end = begin === -1 ? -1 : lines.slice(begin + 1).indexOf(END);
  if (begin === -1 || end === -1) return null;
  return lines.slice(begin + 1, begin + 1 + end);
}

/**
 * The rev comment line and the mechanical rows of an extract block (the doc's
 * block or the extractor's stdout — same lines, markers already stripped).
 * @param {string | string[]} text
 * @returns {{ rev: string | null, rows: { module: string, tool: string, hash: string, write: string, source: string }[], duplicateKeys: number }}
 */
export function parseExtractBlock(text) {
  const block = Array.isArray(text) ? text : String(text).split(/\r?\n/);
  const rev = REV.exec(block[0] ?? "")?.[1] ?? null;
  const rows = [];
  const seen = new Set();
  let duplicateKeys = 0;
  for (const line of block) {
    const match = ROW.exec(line);
    if (!match) continue;
    const [, module, tool, hash, write, source] = match;
    if (module === "module" || /^-+$/.test(module)) continue;
    const key = `${module}|${tool}`;
    if (seen.has(key)) duplicateKeys += 1;
    seen.add(key);
    rows.push({ module, tool, hash, write, source });
  }
  return { rev, rows, duplicateKeys };
}

/** The columns a row compares, in the order the diff table lists them. */
const COLUMNS = [
  ["input_schema_sha256", "hash"],
  ["editor_write", "write"],
  ["source", "source"],
];

/**
 * Row-level differences only. The `rev=` comment line is reported by the
 * caller as `rev_differs` and is not one of these (Amendment 2).
 * @param {{ rows: { module: string, tool: string }[] }} committed
 * @param {{ rows: { module: string, tool: string }[] }} atPin
 */
export function diffRows(committed, atPin) {
  /** @type {Map<string, Record<string, string>>} */
  const left = new Map(committed.rows.map((row) => [`${row.module}|${row.tool}`, row]));
  const right = new Map(atPin.rows.map((row) => [`${row.module}|${row.tool}`, row]));
  const changed = [];
  for (const [key, row] of right) {
    const before = left.get(key);
    if (!before) {
      changed.push({ key, module: row.module, tool: row.tool, column: "row", committed: "(absent)", atPin: "added", what: "row added" });
      continue;
    }
    for (const [column, field] of COLUMNS) {
      if (before[field] !== row[field]) {
        changed.push({ key, module: row.module, tool: row.tool, column, committed: before[field], atPin: row[field], what: `${column} ${before[field]} -> ${row[field]}` });
      }
    }
  }
  for (const [key, row] of left) {
    if (!right.has(key)) {
      changed.push({ key, module: row.module, tool: row.tool, column: "row", committed: "removed", atPin: "(absent)", what: "row removed" });
    }
  }
  changed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.column < b.column ? -1 : 1));
  return changed;
}

/**
 * The diff artifact: the table the packet reads, then one manual review row
 * per changed tool (contract 2.2).
 * @param {{ forkSha: string, extractor: { path: string, blobSha: string | null }, rev: { committed: string | null, atPin: string | null, differs: boolean }, counts: { committed: number, atPin: number }, changed: ReturnType<typeof diffRows> }} report
 */
export function diffMarkdown(report) {
  const out = [];
  out.push(`# G7-06 extractor diff — fork ${report.forkSha}`);
  out.push("");
  out.push(`extractor: ${report.extractor.path}${report.extractor.blobSha ? ` (git blob ${report.extractor.blobSha})` : ""}`);
  out.push(
    `rev=: committed ${report.rev.committed ?? "(none)"} vs at pin ${report.rev.atPin ?? "(none)"} — ` +
      (report.rev.differs ? "rev_differs (comment line only; not a row difference)" : "rev matches"),
  );
  out.push(`rows: committed ${report.counts.committed}, at pin ${report.counts.atPin}`);
  out.push("");
  out.push("## Rows");
  out.push("");
  if (report.changed.length === 0) {
    out.push("no row differences.");
  } else {
    out.push("| module | tool | column | committed | at pin |");
    out.push("| --- | --- | --- | --- | --- |");
    for (const row of report.changed) {
      out.push(`| ${row.module} | ${row.tool} | ${row.column} | ${row.committed} | ${row.atPin} |`);
    }
  }
  if (report.changed.length > 0) {
    out.push("");
    out.push("## Manual review (owner F + Product)");
    out.push("");
    out.push("| tool | owner | status | run | what changed |");
    out.push("| --- | --- | --- | --- | --- |");
    const tools = new Map();
    for (const row of report.changed) {
      const entry = tools.get(row.key) ?? { key: row.key, whats: [] };
      entry.whats.push(row.what);
      tools.set(row.key, entry);
    }
    for (const [key, entry] of [...tools].sort(([a], [b]) => (a < b ? -1 : 1))) {
      out.push(`| ${key.replace("|", "/")} | owner F + Product | open | G7-06 ${report.forkSha} | ${entry.whats.join("; ")} |`);
    }
  }
  out.push("");
  return out.join("\n");
}

/**
 * The reason a failed run gives: the last lines of its stderr, without the
 * node version banner an uncaught error ends with.
 * @param {string} stderr
 */
function failureTail(stderr) {
  const lines = String(stderr ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "" && !/^Node\.js v\d/.test(line));
  return lines.slice(-3).join(" / ");
}

/**
 * Run the check and write <out>/extractor.json and <out>/g6-01-diff.md.
 *
 * BLOCKED when nothing could run (no fork checkout, no revision, no extractor
 * file): a missing precondition is never a row difference. A run that exits
 * non-zero is `extractor_failed` and its stdout is not compared — a crashed
 * extractor prints no rows, and "every row removed" would bury the real reason.
 * @param {{ forkDir?: string | null, forkSha?: string | null, extractor?: string | null, toolsDoc?: string, outDir: string }} options
 */
export function runExtractorCheck({ forkDir = null, forkSha = null, extractor = null, toolsDoc = TOOLS_DOC, outDir }) {
  const blocked = [];
  if (!forkDir) blocked.push("fork_dir_missing");
  if (!forkSha) blocked.push("fork_sha_unresolved");
  const extractorPath = extractor ?? (forkDir ? join(forkDir, "scripts/genoffice-tools-extract.mjs") : null);
  if (extractorPath && !existsSync(extractorPath)) blocked.push(`extractor_missing (${extractorPath})`);
  const jsonPath = join(outDir, "extractor.json");
  mkdirSync(outDir, { recursive: true });
  if (blocked.length > 0) {
    writeFileSync(jsonPath, `${JSON.stringify({ forkSha, extractor: { path: extractorPath, blobSha: null }, verdict: { status: "BLOCKED", reasons: blocked } }, null, 2)}\n`);
    return { status: "BLOCKED", reasons: blocked, artifacts: [relativeToOut(outDir, jsonPath)] };
  }

  const hash = runGit(["hash-object", extractorPath], { cwd: forkDir, encoding: "utf8" });
  const blobSha = hash.status === 0 ? hash.stdout.trim() : null;

  const argv = [process.execPath, extractorPath, "--repo", forkDir, "--rev", forkSha];
  const run = spawnSync(argv[0], argv.slice(1), { cwd: forkDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const exitCode = run.status ?? (run.signal ? 128 : 127);
  const stderrTail = tail(run.stderr ?? "", 40);
  const fail = [];
  const ran = exitCode === 0;
  if (!ran) fail.push(`extractor_failed (exit ${exitCode}): ${failureTail(run.stderr || run.error?.message || "")}`);

  const committedLines = committedBlockLines(readFileSync(toolsDoc, "utf8"));
  const committed = committedLines ? parseExtractBlock(committedLines) : null;
  const atPin = ran ? parseExtractBlock(run.stdout ?? "") : null;
  if (!committed) fail.push(`committed_block_missing (${BEGIN}/${END} not found in ${toolsDoc})`);
  // A clean exit whose stdout carries no parseable extract block compared
  // nothing, so it can never be a PASS (F-01): both the `rev=` header of the
  // block and at least one tool row must be there.
  if (atPin && (!atPin.rev || atPin.rows.length === 0)) fail.push("extractor_failed (no extract block on stdout)");

  const rev = { committed: committed?.rev ?? null, atPin: atPin?.rev ?? null, differs: Boolean(committed && atPin && committed.rev !== atPin.rev) };
  const changed = committed && atPin && atPin.rows.length > 0 ? diffRows(committed, atPin) : [];
  if (changed.length > 0) fail.push("mechanical_column_changed");

  const report = {
    forkSha,
    extractor: { path: extractorPath, blobSha },
    rev,
    counts: { committed: committed?.rows.length ?? 0, atPin: atPin?.rows.length ?? 0 },
    changed,
  };
  const diffPath = join(outDir, "g6-01-diff.md");
  writeFileSync(diffPath, diffMarkdown(report));
  writeFileSync(
    jsonPath,
    `${JSON.stringify({ ...report, argv, exitCode, stderrTail, duplicateKeys: { committed: committed?.duplicateKeys ?? 0, atPin: atPin?.duplicateKeys ?? 0 }, verdict: { status: fail.length ? "FAIL" : "PASS", reasons: fail } }, null, 2)}\n`,
  );

  return { status: fail.length > 0 ? "FAIL" : "PASS", reasons: fail, artifacts: [relativeToOut(outDir, diffPath), relativeToOut(outDir, jsonPath)] };
}
