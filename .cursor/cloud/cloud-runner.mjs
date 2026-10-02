#!/usr/bin/env node
// Drives one Cursor cloud agent per git worktree as a test runner, through the
// Cloud Agents API v1. The worktree pushes its branch; this script asks the
// runner to check out that exact commit, run the listed commands, publish the
// logs to refs/test-results/<lane>/<sha> and answer with one JSON block, then
// writes a Markdown report and pulls the logs back.
//
//   node cloud-runner.mjs ensure  [--branch b] [--model m]
//   node cloud-runner.mjs test    --spec file [--lane slug] [--shard name] [--out report.md] [--timeout s]
//   node cloud-runner.mjs suite   --specs a.txt,b.txt,... [--lane slug] [--out-dir dir] [--timeout s]
//   node cloud-runner.mjs status
//   node cloud-runner.mjs close   [--lane slug] [--shard name | --all yes]
//
// Run it from inside the worktree. State lives in that worktree's git dir
// (cloud-runner.json, or cloud-runner.<shard>.json for a shard), so it
// disappears with the worktree. A shard is a separate agent (its own VM) of the
// same worktree and publishes to refs/test-results/<lane>-<shard>/<sha>; suite
// runs one shard per spec file in parallel and exits with the worst result. API saved
// environments do not apply to API-launched agents, so a fresh VM provisions
// itself from test/cursor-cloud-env on its first run (about 3 minutes); later
// runs are follow-ups on the same warm VM. A round is one command (run-tests.sh)
// because every agent step re-reads the whole conversation.
//
// Exit codes: 0 pass, 1 tests failed, 2 blocked or runner error.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const API = "https://api.cursor.com/v1";
const REPO_URL = "https://github.com/UNIAI-TEAM/uniwork";
const ENV_BRANCH = "test/cursor-cloud-env";
// User 2026-10-02: runners use Grok 4.6 at high effort. --model takes
// "<id>[:param=value,...]", e.g. "composer-2.5" or "grok-4.6:effort=medium".
const DEFAULT_MODEL = "grok-4.6:effort=high,fast=false";

function modelSpec(text) {
  const [id, params = ""] = text.split(":");
  const list = params.split(",").filter(Boolean).map((p) => {
    const [pid, value] = p.split("=");
    return { id: pid, value };
  });
  return list.length ? { id, params: list } : { id };
}
const POLL_MS = 20_000;

// Refreshes the runner scripts from the environment branch, then hands the
// whole round to run-tests.sh, so the agent makes one tool call per round.
const REFRESH = [
  "mkdir -p ~/.uniwork-cloud",
  `git fetch -q origin ${ENV_BRANCH}`,
  "git archive FETCH_HEAD .cursor/cloud | tar -x -C ~/.uniwork-cloud",
].join(" && ");

function usage(msg) {
  if (msg) console.error(`cloud-runner: ${msg}`);
  console.error("usage: cloud-runner.mjs ensure|test|suite|status|close [--branch b] [--spec f] [--specs a,b] [--lane s] [--shard n] [--out f] [--out-dir d] [--model m] [--timeout s] [--all yes]");
  process.exit(2);
}

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (!a.startsWith("--")) usage(`unexpected argument ${a}`);
    opts[a.slice(2)] = rest[i + 1];
    i += 1;
  }
  return { cmd, opts };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function apiKey() {
  if (process.env.CURSOR_API_KEY) return process.env.CURSOR_API_KEY;
  if (process.platform === "win32") {
    for (const scope of ["User", "Machine"]) {
      const r = spawnSync("powershell.exe", ["-NoProfile", "-Command",
        `[Environment]::GetEnvironmentVariable('CURSOR_API_KEY','${scope}')`], { encoding: "utf8" });
      const v = (r.stdout || "").trim();
      if (v) return v;
    }
  }
  usage("CURSOR_API_KEY is not set");
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey()}:`).toString("base64")}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shardName(shard) {
  if (shard && !/^[A-Za-z0-9._-]{1,30}$/.test(shard)) usage(`bad shard name ${shard}`);
  return shard || "";
}

function statePath(shard) {
  const name = shardName(shard) ? `cloud-runner.${shard}.json` : "cloud-runner.json";
  return join(resolve(git("rev-parse", "--git-dir")), name);
}

function loadState(shard) {
  const p = statePath(shard);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

function saveState(s, shard) {
  writeFileSync(statePath(shard), `${JSON.stringify(s, null, 2)}\n`);
}

// Every runner state file of this worktree as [shard ("" = default runner), path].
function allStates() {
  const dir = resolve(git("rev-parse", "--git-dir"));
  return readdirSync(dir)
    .map((f) => /^cloud-runner(?:\.([A-Za-z0-9._-]+))?\.json$/.exec(f))
    .filter(Boolean)
    .map((m) => [m[1] || "", join(dir, m[0])]);
}

function laneSlug(opts, branch) {
  const base = opts.lane || branch.replace(/^[a-z]+\//, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
  return opts.shard ? `${base}-${opts.shard}` : base;
}

async function waitRun(agentId, runId, timeoutS) {
  const deadline = Date.now() + timeoutS * 1000;
  for (;;) {
    const run = await api("GET", `/agents/${agentId}/runs/${runId}`);
    if (["FINISHED", "ERROR", "CANCELLED", "EXPIRED"].includes(run.status)) return run;
    if (Date.now() > deadline) {
      await api("POST", `/agents/${agentId}/runs/${runId}/cancel`).catch(() => {});
      return { ...run, status: "TIMEOUT" };
    }
    await sleep(POLL_MS);
  }
}

async function agentAlive(state) {
  if (!state?.agentId) return false;
  try {
    const a = await api("GET", `/agents/${state.agentId}`);
    return a.status !== "ARCHIVED";
  } catch (e) {
    if (e.status === 404) return false;
    throw e;
  }
}

async function createAgent(branch, model, prompt) {
  const r = await api("POST", "/agents", {
    name: `runner ${branch}`.slice(0, 80),
    prompt: { text: prompt },
    model: modelSpec(model),
    repos: [{ url: REPO_URL, startingRef: branch }],
    env: { type: "cloud" },
    autoCreatePR: false,
  });
  return { agentId: r.agent.id, runId: r.run.id };
}

async function sendRun(agentId, prompt) {
  for (;;) {
    try {
      const r = await api("POST", `/agents/${agentId}/runs`, { prompt: { text: prompt } });
      return (r.run ?? r).id;
    } catch (e) {
      if (e.status !== 409) throw e;
      await sleep(POLL_MS); // agent_busy: one run at a time
    }
  }
}

function oneCommandPrompt(args) {
  return `You are a test runner. Run exactly one command, from the repository root,
and wait for it to finish (up to 30 minutes on a new VM). Do not run anything
else, do not edit, commit or push any file, do not open a PR, and do not look
into failures:

    ${REFRESH} && bash ~/.uniwork-cloud/.cursor/cloud/run-tests.sh ${args}

The last line it prints is a JSON object. Reply with only that object, unchanged,
inside one \`\`\`json fence. If it printed no JSON, reply inside the fence with
{"stage_outcome": "failed", "test_verdict": "blocked", "notes": "<its last 3 output lines>"}.`;
}

function ensurePrompt(branch) {
  return oneCommandPrompt(`--branch ${branch} --provision-only`);
}

// Publishes the spec as refs/test-specs/<lane>/<sha> (a one-file commit) so the
// agent passes a short ref and a hash instead of retyping a long base64 string,
// which a model can corrupt. Returns { ref, sha256 }.
function publishSpec(lane, sha, commands) {
  const text = `${commands.join("\n")}\n`;
  const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { input: text, encoding: "utf8" }).trim();
  const tree = execFileSync("git", ["mktree"], { input: `100644 blob ${blob}\tspec.txt\n`, encoding: "utf8" }).trim();
  const commit = execFileSync("git", ["commit-tree", tree, "-m", `spec ${lane} ${sha}`],
    { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "runner", GIT_AUTHOR_EMAIL: "runner@local",
      GIT_COMMITTER_NAME: "runner", GIT_COMMITTER_EMAIL: "runner@local" } }).trim();
  const ref = `refs/test-specs/${lane}/${sha}`;
  git("push", "-q", "-f", "origin", `${commit}:${ref}`);
  return { ref, sha256: createHash("sha256").update(text).digest("hex") };
}

function testPrompt({ branch, sha, lane, spec }) {
  return oneCommandPrompt(`--branch ${branch} --sha ${sha} --lane ${lane} --spec-ref ${spec.ref} --spec-sha256 ${spec.sha256}`);
}

function extractReport(result) {
  const blocks = [...String(result ?? "").matchAll(/```json\s*([\s\S]*?)```/g)];
  if (blocks.length === 0) return null;
  try {
    return JSON.parse(blocks[blocks.length - 1][1]);
  } catch {
    return null;
  }
}

async function costCents(agentId) {
  try {
    const u = await api("GET", `/agents/${agentId}/usage`);
    return u.cost?.chargedCents ?? null;
  } catch {
    return null;
  }
}

function writeReport(out, meta, rep, rawResult) {
  const rows = (rep?.ran ?? []).map((r) => `| \`${r.cmd}\` | ${r.result} | ${r.duration_s} |`).join("\n");
  const fails = (rep?.failures ?? []).map((f) => `- \`${f.test}\` ${f.file ?? ""}: ${f.msg}`).join("\n");
  const md = `# Cloud test report: ${meta.lane} @ ${meta.sha}

- stage_outcome: **${rep?.stage_outcome ?? "failed"}**
- test_verdict: **${rep?.test_verdict ?? "blocked"}**
- branch: \`${meta.branch}\`; agent \`${meta.agentId}\`; run \`${meta.runId}\` (${meta.runStatus}, ${Math.round((meta.durationMs ?? 0) / 1000)} s)
- provisioned this run: ${rep?.provisioned ?? "?"}; start_seconds: ${rep?.start_seconds ?? "?"}
- cost of this run: ${meta.costCents == null ? "unknown" : `${meta.costCents.toFixed(2)} cents`}
- logs: ${meta.logsDir ?? "not fetched"} (ref \`${rep?.log_ref ?? "none"}\`)

## Ran

| command | result | seconds |
| --- | --- | --- |
${rows || "| (none) | | |"}

## Failures

${fails || "None reported."}

## Not run

${(rep?.not_run ?? []).map((n) => `- ${n}`).join("\n") || "Nothing."}

## Notes

${rep?.notes || "None."}

## Raw report

\`\`\`json
${rep ? JSON.stringify(rep, null, 2) : String(rawResult ?? "").slice(0, 4000)}
\`\`\`
`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md);
}

// Writes each file of the results commit with `git show`, so it needs no tar
// (Windows' bsdtar does not read stdin by default).
function fetchLogs(ref, dir) {
  try {
    // Shards of one suite fetch from the same repository at once; retry a
    // fetch that lost a lock race.
    for (let attempt = 1; ; attempt += 1) {
      try {
        git("fetch", "-q", "origin", `${ref}:${ref}`);
        break;
      } catch (e) {
        if (attempt >= 4) throw e;
        execFileSync(process.execPath, ["-e", `setTimeout(() => {}, ${attempt * 3000})`]);
      }
    }
    for (const name of git("ls-tree", "-r", "--name-only", ref).split("\n").filter(Boolean)) {
      const file = join(dir, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, execFileSync("git", ["show", `${ref}:${name}`], { maxBuffer: 1 << 30 }));
    }
    git("update-ref", "-d", ref);
    return dir;
  } catch (e) {
    console.error(`cloud-runner: could not fetch logs from ${ref}: ${e.message}`);
    return null;
  }
}

async function cmdEnsure(opts) {
  const branch = opts.branch || git("rev-parse", "--abbrev-ref", "HEAD");
  let state = loadState(opts.shard);
  if (await agentAlive(state)) {
    console.log(`runner ready: ${state.agentId} (${state.branch})`);
    return 0;
  }
  const model = opts.model || DEFAULT_MODEL;
  const { agentId, runId } = await createAgent(branch, model, ensurePrompt(branch));
  state = { agentId, branch, model, lane: laneSlug(opts, branch), shard: shardName(opts.shard), createdAt: new Date().toISOString() };
  saveState(state, opts.shard);
  console.log(`runner created: ${agentId}; provisioning (about 10 min)`);
  const run = await waitRun(agentId, runId, Number(opts.timeout || 1800));
  const rep = extractReport(run.result);
  console.log(`provision: ${run.status} ${rep?.stage_outcome ?? "no report"} ${rep?.notes ?? ""}`);
  return run.status === "FINISHED" && rep?.stage_outcome === "succeeded" ? 0 : 2;
}

async function cmdTest(opts) {
  if (!opts.spec) usage("test needs --spec");
  const commands = readFileSync(opts.spec === "-" ? 0 : opts.spec, "utf8")
    .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (commands.length === 0) usage("spec has no commands");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const sha = git("rev-parse", "--short=8", "HEAD");
  const remote = git("ls-remote", "origin", `refs/heads/${branch}`).split(/\s+/)[0] ?? "";
  if (!remote.startsWith(git("rev-parse", "HEAD").slice(0, 12))) {
    usage(`origin/${branch} is not at HEAD ${sha}; push the branch first`);
  }
  let state = loadState(opts.shard);
  const lane = laneSlug(opts, branch);
  const spec = publishSpec(lane, sha, commands);
  const prompt = testPrompt({ branch, sha, lane, spec });
  const before = (await agentAlive(state)) ? await costCents(state.agentId) : 0;
  let agentId;
  let runId;
  if (await agentAlive(state)) {
    agentId = state.agentId;
    runId = await sendRun(agentId, prompt);
  } else {
    ({ agentId, runId } = await createAgent(branch, opts.model || DEFAULT_MODEL, prompt));
    state = { agentId, branch, model: opts.model || DEFAULT_MODEL, lane, shard: shardName(opts.shard), createdAt: new Date().toISOString() };
    saveState(state, opts.shard);
  }
  console.log(`run ${runId} on ${agentId} for ${sha}`);
  const run = await waitRun(agentId, runId, Number(opts.timeout || 3600));
  const rep = extractReport(run.result);
  const after = await costCents(agentId);
  const out = resolve(opts.out || join("reports", lane, `cloud-test-${sha}.md`));
  let logsDir = null;
  if (rep?.log_ref) logsDir = fetchLogs(rep.log_ref, out.replace(/\.md$/, ".logs"));
  try { git("push", "-q", "origin", `:${spec.ref}`); } catch { /* best effort */ }
  const valid = rep && String(rep.sha ?? "").slice(0, 7) === sha.slice(0, 7);
  writeReport(out, {
    lane, sha, branch, agentId, runId, runStatus: run.status, durationMs: run.durationMs,
    costCents: after == null || before == null ? null : after - before, logsDir,
  }, valid ? rep : { ...(rep ?? {}), stage_outcome: "failed", test_verdict: "blocked",
    notes: `${rep ? `sha mismatch (${rep.sha})` : "no JSON report"}; run ${run.status}. ${rep?.notes ?? ""}` }, run.result);
  console.log(`report: ${out}`);
  if (!valid || run.status !== "FINISHED" || rep.stage_outcome !== "succeeded") return 2;
  return rep.test_verdict === "pass" ? 0 : rep.test_verdict === "fail" ? 1 : 2;
}

async function cmdStatus() {
  const states = allStates();
  if (states.length === 0) {
    console.log("no runner for this worktree");
    return 0;
  }
  for (const [, p] of states) {
    const state = JSON.parse(readFileSync(p, "utf8"));
    const a = await api("GET", `/agents/${state.agentId}`).catch((e) => ({ status: `gone (${e.status})` }));
    console.log(JSON.stringify({ ...state, status: a.status, latestRunId: a.latestRunId,
      costCents: await costCents(state.agentId) }, null, 2));
  }
  return 0;
}

async function closeOne(shard, laneOpt) {
  const state = loadState(shard);
  if (state?.agentId) {
    await api("DELETE", `/agents/${state.agentId}`).catch((e) => { if (e.status !== 404) throw e; });
    console.log(`deleted ${state.agentId}${shard ? ` (shard ${shard})` : ""}`);
  }
  const lane = laneOpt ? (shard ? `${laneOpt}-${shard}` : laneOpt) : state?.lane;
  if (lane) {
    const refs = git("ls-remote", "origin", `refs/test-results/${lane}/*`, `refs/test-specs/${lane}/*`)
      .split("\n").map((l) => l.split(/\s+/)[1]).filter(Boolean);
    if (refs.length) git("push", "-q", "origin", ...refs.map((r) => `:${r}`));
    console.log(`deleted ${refs.length} results refs for ${lane}`);
  }
  if (existsSync(statePath(shard))) rmSync(statePath(shard));
}

async function cmdClose(opts) {
  const shards = opts.all ? allStates().map(([s]) => s) : [shardName(opts.shard)];
  if (shards.length === 0) shards.push("");
  for (const shard of shards) await closeOne(shard, opts.lane);
  return 0;
}

// Runs one shard per spec file in parallel, each on its own agent and VM, then
// writes a summary. The exit code is the worst shard's (2 over 1 over 0).
async function cmdSuite(opts) {
  if (!opts.specs) usage("suite needs --specs a.txt,b.txt");
  const specs = opts.specs.split(",").map((x) => x.trim()).filter(Boolean);
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const sha = git("rev-parse", "--short=8", "HEAD");
  const outDir = resolve(opts["out-dir"] || join("reports", laneSlug({ lane: opts.lane }, branch)));
  const shards = specs.map((spec) => ({
    spec,
    shard: basename(spec).replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 30),
  }));
  if (new Set(shards.map((x) => x.shard)).size !== shards.length) usage("spec file names must give distinct shard names");
  const names = ["pass", "fail", "blocked"];
  const results = await Promise.all(shards.map(({ spec, shard }) => new Promise((done) => {
    const out = join(outDir, `cloud-suite-${sha}-${shard}.md`);
    const args = [process.argv[1], "test", "--spec", spec, "--shard", shard, "--out", out];
    for (const k of ["lane", "timeout", "model"]) if (opts[k]) args.push(`--${k}`, opts[k]);
    const started = Date.now();
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => process.stdout.write(`[${shard}] ${d}`));
    child.stderr.on("data", (d) => process.stderr.write(`[${shard}] ${d}`));
    child.on("close", (code) => done({ shard, spec, out, code: code ?? 2, seconds: Math.round((Date.now() - started) / 1000) }));
  })));
  const worst = results.some((r) => r.code !== 0 && r.code !== 1) ? 2 : results.some((r) => r.code === 1) ? 1 : 0;
  const rows = results.map((r) =>
    `| ${r.shard} | \`${r.spec}\` | ${names[r.code] ?? "blocked"} (exit ${r.code}) | ${r.seconds} | [report](${basename(r.out)}) |`).join("\n");
  const summary = join(outDir, `cloud-suite-${sha}.md`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(summary, `# Cloud suite: ${branch} @ ${sha}

- suite_verdict: **${names[worst]}** (worst shard)
- shards: ${results.length}, run in parallel

| shard | spec | verdict | seconds | report |
| --- | --- | --- | --- | --- |
${rows}
`);
  console.log(`suite: ${names[worst]}; summary ${summary}`);
  return worst;
}

const { cmd, opts } = parseArgs(process.argv.slice(2));
const handlers = { ensure: cmdEnsure, test: cmdTest, suite: cmdSuite, status: cmdStatus, close: cmdClose };
if (!handlers[cmd]) usage(cmd ? `unknown command ${cmd}` : undefined);
handlers[cmd](opts).then((code) => process.exit(code), (e) => {
  console.error(`cloud-runner: ${e.message}`);
  process.exit(2);
});
