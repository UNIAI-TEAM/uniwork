// The G8-19 cloud spec (UNI-1414 T4): the file the cloud runner executes, one
// command per line (shape of cloud-g710-8.txt). It lives outside the repo
// (the newest ~/office-g5g6g7/reports/g7-qa/specs/cloud-g819-<n>.txt by default, or the path
// in G819_SPEC), so this test reads it from there and is a visible skip where
// the file does not exist (the cloud VM itself). It pins what a round has to
// hold: one evidence.mjs run per (row, fixture) the matrix declares for
// G8-A01..G8-A10, a G819_*_EXIT marker after each, the markers' meaning in the
// last line's verdict awk, and no secret in the text.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../..");
// the newest round's spec (cloud-g819-<n>.txt, highest n) unless G819_SPEC names one
function newestSpec() {
  const dir = join(homedir(), "office-g5g6g7/reports/g7-qa/specs");
  const rounds = existsSync(dir) ? readdirSync(dir).map((f) => /^cloud-g819-(\d+)\.txt$/.exec(f)).filter(Boolean) : [];
  rounds.sort((a, b) => Number(b[1]) - Number(a[1]));
  return join(dir, rounds[0]?.[0] ?? "cloud-g819-1.txt");
}
const DEFAULT_SPEC = newestSpec();
const SPEC_PATH = process.env.G819_SPEC || DEFAULT_SPEC;
const MISSING = !existsSync(SPEC_PATH);
// an explicit G819_SPEC that does not exist is a failure, only the default path may be absent
const OPTS = MISSING && !process.env.G819_SPEC ? { skip: `no cloud spec at ${SPEC_PATH} (it lives outside the repo; set G819_SPEC to check one)` } : {};

const ROWS = ["G8-A01", "G8-A02", "G8-A03", "G8-A04", "G8-A05", "G8-A06", "G8-A07", "G8-A08", "G8-A09", "G8-A10"];
const matrix = JSON.parse(readFileSync(join(REPO, "docs/office/g5g6g7/acceptance-rows.json"), "utf8"));
const declared = matrix.rows.filter((r) => ROWS.includes(r.id)).flatMap((r) => r.fixtures.map((f) => ({ row: r.id, fixture: f.id })));

/** harness module per row (breakdown section 4) and whether the row also runs its Go/node checks first */
const MODULE_OF = { "G8-A01": "comments", "G8-A02": "anchors", "G8-A04": "comments", "G8-A05": "inbox", "G8-A06": "inbox", "G8-A07": "deeplink", "G8-A09": "account" };
const SERVER_ROWS = ["G8-A03", "G8-A05", "G8-A06", "G8-A08"];

const text = () => readFileSync(SPEC_PATH, "utf8");
const lines = () => text().split("\n").filter((l, i, all) => !(i === all.length - 1 && l === ""));
const EVIDENCE_RUN = /evidence\.mjs run --req (G8-A\d\d) --fixture (fx-[a-z0-9-]+)([^;]*)/g;
const evidenceRuns = () => [...text().matchAll(EVIDENCE_RUN)].map((m) => ({ row: m[1], fixture: m[2], rest: m[3] }));

test("the spec is one command per line: a header, `; true` on every line but the last, the verdict last", OPTS, () => {
  const all = lines();
  assert.ok(all.length >= 8, `${all.length} lines`);
  assert.match(all[0], /^# G8-19 \(UNI-1414\)/, "line 1 is the header");
  assert.ok(all.every((l) => l.trim() !== ""), "no blank line");
  // the header is prose for the reader (cloud-g710-8.txt does the same), every command line before the verdict ends '; true'
  for (const l of all.slice(1, -1)) assert.match(l, /; true$/, `ends with '; true': ${l.slice(0, 80)}`);
  const last = all.at(-1);
  assert.doesNotMatch(last, /; true$/);
  assert.match(last, /awk '/);
  assert.match(last, /G819_ROUND_EXIT/);
  assert.match(last, /exit \$rc$/);
});

test("each attempt has its own run id: line 2 writes /tmp/g819-rN-rid, every later line reads it", OPTS, () => {
  const all = lines();
  assert.match(all[1], /^RID=g819-r\d+-\$\(date \+%s%N\); echo \$RID > \/tmp\/g819-r\d+-rid; M=\/tmp\/\$RID-markers\.txt;/);
  const n = /g819-r(\d+)-rid/.exec(all[1])[1];
  for (const l of all.slice(2)) assert.match(l, new RegExp(`RID=\\$\\(cat /tmp/g819-r${n}-rid\\)`), l.slice(0, 80));
  assert.match(all[1], /echo "G819_UNIT_EXIT \$\?" \| tee \$M/);
  assert.match(all[1], /node --test [^;]*g8-19\/\*\.test\.mjs/);
});

test("exports the fork SHA and the SQL-membership opt-in before the keyring session", OPTS, () => {
  const t = text();
  const session = t.indexOf("keyring-session.sh --exec");
  assert.ok(session > 0);
  const before = t.slice(0, session);
  assert.match(before, /export [^;]*OFFICE_FORK_SHA=7d665a54/);
  assert.match(before, /export [^;]*G819_ALLOW_SQL_MEMBERSHIP=1/);
  assert.match(before, /HARNESS_RUN_DIR=\$R/);
});

test("exactly one evidence.mjs run per (row, fixture) the matrix declares for G8-A01..A10, none else", OPTS, () => {
  const runs = evidenceRuns();
  const key = (x) => `${x.row} ${x.fixture}`;
  assert.deepEqual(runs.map(key).sort(), declared.map(key).sort());
  assert.equal(new Set(runs.map(key)).size, runs.length, "no duplicate (row, fixture)");
  assert.equal((text().match(/evidence\.mjs run/g) ?? []).length, declared.length, "no evidence.mjs run without --req and --fixture in the usual order");
});

test("every run is followed by its own G819_*_EXIT marker, appended to the markers file", OPTS, () => {
  const t = text();
  const seen = new Set();
  for (const { row, fixture } of declared) {
    const name = SERVER_ROWS.includes(row) && !MODULE_OF[row] ? `G819_SRV_${row}_${fixture}_EXIT` : `G819_${row}_${fixture}_EXIT`;
    assert.ok(!seen.has(name), `${name} is unique`);
    seen.add(name);
    const at = t.indexOf(`--req ${row} --fixture ${fixture}`);
    const marker = t.indexOf(`echo "${name} $?" | tee -a $M`, at);
    assert.ok(marker > at, `${name} follows its evidence run`);
    const next = t.indexOf("evidence.mjs run", at + 1);
    assert.ok(next === -1 || marker < next, `${name} comes before the next evidence run`);
  }
});

test("harness rows run their module with the same --row/--fixture and the run dir; the module is the breakdown's", OPTS, () => {
  for (const { row, fixture, rest } of evidenceRuns()) {
    const mod = MODULE_OF[row];
    if (!mod) continue;
    assert.match(rest, new RegExp(`node scripts/office/g5g6g7/g8-19/${mod}\\.mjs --row ${row} --fixture ${fixture} --run-dir "?\\$(?:HARNESS_RUN_DIR|R)"?`), `${row} ${fixture}: ${rest.trim()}`);
    assert.match(rest, new RegExp(`--checker [a-z+]*:?g8-19/${mod}\\.mjs|--checker harness:g8-19/${mod}\\.mjs`), `${row} ${fixture} checker`);
  }
});

test("every script the spec names exists in the repo (modules, server-row.sh, harness, evidence)", OPTS, () => {
  const named = new Set([...text().matchAll(/scripts\/office\/g5g6g7\/[A-Za-z0-9_./-]+\.(?:mjs|sh)\b/g)].map((m) => m[0]));
  assert.ok(named.size >= 8, `${named.size} scripts named`);
  for (const rel of named) assert.ok(existsSync(join(REPO, rel)), `${rel} does not exist`);
  for (const mod of new Set(Object.values(MODULE_OF))) {
    assert.ok(text().includes(`scripts/office/g5g6g7/g8-19/${mod}.mjs`), `the spec runs ${mod}.mjs`);
    assert.ok(existsSync(join(HERE, `${mod}.mjs`)), `${mod}.mjs exists`);
  }
});

test("A07 runs only through deeplink.mjs: revoke runs inside it, so no revoke line and no other module on an A07 line", OPTS, () => {
  assert.doesNotMatch(text(), /g8-19\/revoke\.mjs/);
  const a07 = evidenceRuns().filter((r) => r.row === "G8-A07");
  assert.deepEqual(a07.map((r) => r.fixture).sort(), declared.filter((d) => d.row === "G8-A07").map((d) => d.fixture).sort());
  for (const r of a07) {
    assert.match(r.rest, /-- node scripts\/office\/g5g6g7\/g8-19\/deeplink\.mjs --row G8-A07 /);
    assert.equal((r.rest.match(/g8-19\/[a-z-]+\.mjs/g) ?? []).filter((m) => m !== "g8-19/deeplink.mjs").length, 0, "only deeplink.mjs on an A07 line");
  }
  assert.equal((text().match(/--row G8-A07/g) ?? []).length, a07.length, "no A07 module run outside its evidence line");
});

test("server rows go through server-row.sh with their own row; A05 and A06 chain the inbox module after it, A03 and A08 do not", OPTS, () => {
  for (const { row, rest } of evidenceRuns()) {
    if (!SERVER_ROWS.includes(row)) {
      assert.doesNotMatch(rest, /server-row\.sh/, `${row} is not a server row`);
      continue;
    }
    assert.match(rest, new RegExp(`bash scripts/office/g5g6g7/g8-19/server-row\\.sh ${row}( |$)`), `${row}: ${rest.trim()}`);
    if (MODULE_OF[row]) assert.match(rest, new RegExp(`--then node scripts/office/g5g6g7/g8-19/${MODULE_OF[row]}\\.mjs --row ${row} `), `${row} chains its module`);
    else assert.doesNotMatch(rest, /--then/, `${row} has no harness module`);
  }
});

test("G8-A10 is an evidence BLOCKED line naming G8-18 part F, never a command that could pass", OPTS, () => {
  const a10 = evidenceRuns().find((r) => r.row === "G8-A10");
  assert.ok(a10);
  assert.match(a10.rest, /--checker blocked/);
  assert.match(a10.rest, /--blocker "G8-18 part F not on fork main 7d665a54"/);
  assert.match(a10.rest, /-- true\s*$/);
});

// ---- the verdict awk ---------------------------------------------------------

/** the whole awk command of the last line: its -v assignments (the expected marker list) and its program */
function verdictAwk() {
  const last = lines().at(-1);
  const m = /awk((?: -v [a-z]+="[^"]*")*) '([^']*)'/.exec(last);
  assert.ok(m, "an awk program in the last line");
  return { vars: [...m[1].matchAll(/ -v ([a-z]+="[^"]*")/g)].map((v) => v[1]), program: m[2] };
}
function verdict(markers) {
  const dir = mkdtempSync(join(tmpdir(), "g819-awk-"));
  try {
    const file = join(dir, "markers.txt");
    writeFileSync(file, `${markers.join("\n")}\n`);
    const { vars, program } = verdictAwk();
    return spawnSync("awk", [...vars.flatMap((v) => ["-v", v]), program, file], { encoding: "utf8" }).status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const markerOf = (row, fixture) => (SERVER_ROWS.includes(row) && !MODULE_OF[row] ? `G819_SRV_${row}_${fixture}_EXIT` : `G819_${row}_${fixture}_EXIT`);
const FIXED_MARKERS = ["G819_UNIT_EXIT", "G819_APT_EXIT", "G819_FRAMES_EXIT", "G819_START_EXIT", "G819_STOP_EXIT", "G819_VERIFY_EXIT", "G819_KEYRING_EXEC_EXIT"];
/** every marker a complete round leaves: the fixed gates, then one per (row, fixture) the matrix declares */
const EXPECTED = [...FIXED_MARKERS, ...declared.map(({ row, fixture }) => markerOf(row, fixture))];
const full = (overrides = {}) => EXPECTED.map((name) => `${name} ${overrides[name] ?? 0}`);

test("the verdict awk: UNIT, START, VERIFY, APT, FRAMES, STOP, KEYRING_EXEC and every SRV marker must be 0; rows may be 0 or 77", OPTS, () => {
  assert.equal(verdict(full()), 0);
  assert.equal(verdict(full({ "G819_G8-A02_fx-docx-report-vi_EXIT": 77, "G819_G8-A10_fx-docx-report-vi_EXIT": 77, "G819_G8-A09_fx-docx-report-vi_EXIT": 0 })), 0);
  const bad = { G819_UNIT_EXIT: [1], G819_START_EXIT: [1, 77], G819_VERIFY_EXIT: [1, 77], G819_APT_EXIT: [1, 77], G819_FRAMES_EXIT: [1, 77], G819_STOP_EXIT: [1, 77], G819_KEYRING_EXEC_EXIT: [1, 77], "G819_SRV_G8-A08_fx-docx-report-vi_EXIT": [1, 77], "G819_SRV_G8-A03_fx-md-notes-vi_EXIT": [1, 77], "G819_G8-A01_fx-docx-report-vi_EXIT": [1, 2], "G819_G8-A09_fx-docx-report-vi_EXIT": [124] };
  for (const [name, values] of Object.entries(bad)) for (const value of values) assert.equal(verdict(full({ [name]: value })), 1, `${name} ${value}`);
});

test("the verdict awk fails when a marker the round has to leave never appeared (a command died before its echo): the gates and every row", OPTS, () => {
  assert.equal(verdict(["G819_START_EXIT 0", "G819_VERIFY_EXIT 0"]), 1);
  assert.equal(verdict(["G819_UNIT_EXIT 0", "G819_VERIFY_EXIT 0"]), 1);
  assert.equal(verdict(["G819_UNIT_EXIT 0", "G819_START_EXIT 0"]), 1);
  assert.ok(EXPECTED.length >= FIXED_MARKERS.length + 19, `${EXPECTED.length} markers expected`);
  for (const gone of EXPECTED) assert.equal(verdict(full().filter((l) => l.split(" ")[0] !== gone)), 1, `${gone} absent`);
});

// ---- credential-bearing files stay out of the collect lines (G819-BE-3) and globs are guarded (G819-BE-4) ----

test("no collect line reads server.env, server-cwd or an .env file other than the redacted ports.env", OPTS, () => {
  const t = lines().slice(1).join("\n"); // the commands; the header is prose
  assert.doesNotMatch(t, /server\.env|server-cwd|\*\.env/, "the run dir's credential files are never named");
  // the only .env the spec names: ports.env (read through the key/secret/password/token filter), local-env.sh, and the VM .env sourced into a variable
  const names = [...t.replaceAll('"${ENV_FILE:-./.env}"', "").matchAll(/[A-Za-z0-9_./-]*\.env\b/g)].map((m) => m[0]);
  for (const name of names) assert.match(name, /ports\.env$|local-env\.sh/, `unexpected .env reference: ${name}`);
  for (const l of lines().filter((x) => /ports\.env/.test(x))) assert.match(l, /grep -v -i -E "key\|secret\|password\|token" "\$HARNESS_RUN_DIR\/ports\.env"/, "ports.env goes through the credential filter");
  // the VM .env is sourced for one variable, never printed
  assert.doesNotMatch(t, /\b(cat|head|tail|grep|sed|awk|less|more)\b[^;|]*(\$\{?ENV_FILE|\/\.env\b)/);
});

test("every glob loop of the spec guards its file with [ -f \"$f\" ] (a missing log is silent, not a grep error in the round log)", OPTS, () => {
  const loops = [...text().matchAll(/for (\w+) in ([^;]*\*[^;]*); do ([^;]*)/g)];
  assert.ok(loops.length >= 3, `${loops.length} glob loops`);
  for (const [whole, variable, , body] of loops) assert.ok(body.trimStart().startsWith(`[ -f "$${variable}" ]`), `unguarded glob loop: ${whole.slice(0, 100)}`);
});

// ---- no secret ---------------------------------------------------------------

test("no secret-looking literal, credential URL or model host in the spec", OPTS, () => {
  const t = text();
  const patterns = [
    [/\bsk-[A-Za-z0-9_-]{10,}/, "an sk- key"],
    [/\bghp_[A-Za-z0-9]{20,}/, "a GitHub token"],
    [/\bAKIA[0-9A-Z]{12,}/, "an AWS key id"],
    [/-----BEGIN [A-Z ]*PRIVATE KEY/, "a private key"],
    [/\b(?:api[_-]?key|secret|token|passw(?:or)?d)\s*[=:]\s*["']?[A-Za-z0-9/+_.-]{12,}/i, "a credential assignment"],
    [/\bbearer\s+[A-Za-z0-9._-]{12,}/i, "a bearer token"],
    [/https?:\/\/[^\s'"/]*:[^\s'"/@]*@/, "a URL with credentials"],
    [/\bbase_url\b|\bcustomlocal\b|\bmodel_providers?\b/i, "the upstream model provider config"],
    [/\b(?!127\.0\.0\.1\b|0\.0\.0\.0\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, "an IP address"],
  ];
  for (const [re, what] of patterns) assert.doesNotMatch(t, re, `the spec holds ${what}`);
});
