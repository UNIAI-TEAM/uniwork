import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// An alert without a runbook is a pager that says "something is wrong" at
// 3am and nothing else; a runbook without an alert is prose nobody will ever
// open under pressure. Both directions fail here.

const SECTIONS = ["## Triệu chứng", "## Kiểm tra", "## Khắc phục", "## Leo thang"];
const RUNBOOK_DIR = "docs/runbooks";

/** `{alert, runbook_url}` pairs from deploy/alerts.yml. */
// ponytail: line scanner, not a YAML parser — rules are flat `- alert:` blocks;
// promtool (in CI's docker image) is what validates the YAML itself.
function rules() {
  const out = [];
  for (const line of read("deploy/alerts.yml").split("\n")) {
    const alert = line.match(/^\s*- alert:\s*(\S+)/);
    if (alert) out.push({ alert: alert[1] });
    const url = line.match(/^\s*runbook_url:\s*(\S+)/);
    if (url) out.at(-1).runbook_url = url[1];
  }
  return out;
}

const runbookFiles = () =>
  fs.readdirSync(path.join(root, RUNBOOK_DIR)).filter((f) => f.endsWith(".md") && f !== "README.md");

test("every alert has a runbook_url whose file exists and is named after the alert", () => {
  const all = rules();
  assert.equal(all.length, 8, "spec §6.5 lists eight alerts");
  for (const r of all) {
    assert.ok(r.runbook_url, `${r.alert} has no runbook_url`);
    assert.equal(path.basename(r.runbook_url), `${r.alert}.md`, `${r.alert}: runbook_url must end in <AlertName>.md`);
    assert.ok(fs.existsSync(path.join(root, RUNBOOK_DIR, `${r.alert}.md`)), `${RUNBOOK_DIR}/${r.alert}.md missing`);
  }
});

test("every runbook has the four sections in order and a status line", () => {
  for (const f of runbookFiles()) {
    const src = read(`${RUNBOOK_DIR}/${f}`);
    assert.match(src.split("\n")[2] ?? "", /^> \*\*Trạng thái:\*\* shipped/, `${f}: line 3 must be the status line`);
    const h2 = src.split("\n").filter((l) => l.startsWith("## "));
    assert.deepEqual(h2, SECTIONS, `${f}: H2 sections must be exactly ${SECTIONS.join(" / ")}`);
  }
});

test("every runbook is referenced by an alert", () => {
  const referenced = new Set(rules().map((r) => `${r.alert}.md`));
  const orphans = runbookFiles().filter((f) => !referenced.has(f));
  assert.deepEqual(orphans, [], `runbooks without an alert: ${orphans.join(", ")}`);
});

test("runbook index lists every alert", () => {
  const index = read(`${RUNBOOK_DIR}/README.md`);
  for (const r of rules()) assert.ok(index.includes(`${r.alert}.md`), `README.md does not link ${r.alert}.md`);
});
