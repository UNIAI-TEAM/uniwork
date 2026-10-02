#!/usr/bin/env node
// Drives one Cursor cloud agent per git worktree as a test runner, through the
// Cloud Agents API v1. The worktree pushes its branch; this script asks the
// runner to check out that exact commit, run the listed commands, publish the
// logs to refs/test-results/<lane>/<sha> and answer with one JSON block, then
// writes a Markdown report and pulls the logs back.
//
//   node cloud-runner.mjs ensure  [--branch b] [--model m]
//   node cloud-runner.mjs test    --spec file [--lane slug] [--out report.md] [--timeout s]
//   node cloud-runner.mjs status
//   node cloud-runner.mjs close   [--lane slug]
//
// Run it from inside the worktree. State lives in that worktree's git dir
// (cloud-runner.json), so it disappears with the worktree. API saved
// environments do not apply to API-launched agents, so a fresh VM provisions
// itself from test/cursor-cloud-env on its first run (about 3 minutes); later
// runs are follow-ups on the same warm VM. A round is one command (run-tests.sh)
// because every agent step re-reads the whole conversation.
//
// Exit codes: 0 pass, 1 tests failed, 2 blocked or runner error.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const API = "https://api.cursor.com/v1";
const REPO_URL = "https://github.com/UNIAI-TEAM/uniwork";
const ENV_BRANCH = "test/cursor-cloud-env";
const DEFAULT_MODEL = "composer-2.5";
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
  console.error("usage: cloud-runner.mjs ensure|test|status|close [--branch b] [--spec f] [--lane s] [--out f] [--model m] [--timeout s]");
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

function statePath() {
  return join(resolve(git("rev-parse", "--git-dir")), "cloud-runner.json");
}

function loadState() {
  const p = statePath();
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

function saveState(s) {
  writeFileSync(statePath(), `${JSON.stringify(s, null, 2)}\n`);
}

function laneSlug(opts, branch) {
  return opts.lane || branch.replace(/^[a-z]+\//, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
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
    model: { id: model },
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

function testPrompt({ branch, sha, lane, commands }) {
  const specB64 = Buffer.from(`${commands.join("\n")}\n`).toString("base64");
  return oneCommandPrompt(`--branch ${branch} --sha ${sha} --lane ${lane} --spec-b64 ${specB64}`);
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
    git("fetch", "-q", "origin", `${ref}:${ref}`);
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
  let state = loadState();
  if (await agentAlive(state)) {
    console.log(`runner ready: ${state.agentId} (${state.branch})`);
    return 0;
  }
  const model = opts.model || DEFAULT_MODEL;
  const { agentId, runId } = await createAgent(branch, model, ensurePrompt(branch));
  state = { agentId, branch, model, lane: laneSlug(opts, branch), createdAt: new Date().toISOString() };
  saveState(state);
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
  let state = loadState();
  const lane = laneSlug(opts, branch);
  const prompt = testPrompt({ branch, sha, lane, commands });
  const before = (await agentAlive(state)) ? await costCents(state.agentId) : 0;
  let agentId;
  let runId;
  if (await agentAlive(state)) {
    agentId = state.agentId;
    runId = await sendRun(agentId, prompt);
  } else {
    ({ agentId, runId } = await createAgent(branch, opts.model || DEFAULT_MODEL, prompt));
    state = { agentId, branch, model: opts.model || DEFAULT_MODEL, lane, createdAt: new Date().toISOString() };
    saveState(state);
  }
  console.log(`run ${runId} on ${agentId} for ${sha}`);
  const run = await waitRun(agentId, runId, Number(opts.timeout || 3600));
  const rep = extractReport(run.result);
  const after = await costCents(agentId);
  const out = resolve(opts.out || join("reports", lane, `cloud-test-${sha}.md`));
  let logsDir = null;
  if (rep?.log_ref) logsDir = fetchLogs(rep.log_ref, out.replace(/\.md$/, ".logs"));
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
  const state = loadState();
  if (!state) {
    console.log("no runner for this worktree");
    return 0;
  }
  const a = await api("GET", `/agents/${state.agentId}`).catch((e) => ({ status: `gone (${e.status})` }));
  console.log(JSON.stringify({ ...state, status: a.status, latestRunId: a.latestRunId,
    costCents: await costCents(state.agentId) }, null, 2));
  return 0;
}

async function cmdClose(opts) {
  const state = loadState();
  if (state?.agentId) {
    await api("DELETE", `/agents/${state.agentId}`).catch((e) => { if (e.status !== 404) throw e; });
    console.log(`deleted ${state.agentId}`);
  }
  const lane = opts.lane || state?.lane;
  if (lane) {
    const refs = git("ls-remote", "origin", `refs/test-results/${lane}/*`)
      .split("\n").map((l) => l.split(/\s+/)[1]).filter(Boolean);
    if (refs.length) git("push", "-q", "origin", ...refs.map((r) => `:${r}`));
    console.log(`deleted ${refs.length} results refs for ${lane}`);
  }
  if (existsSync(statePath())) rmSync(statePath());
  return 0;
}

const { cmd, opts } = parseArgs(process.argv.slice(2));
const handlers = { ensure: cmdEnsure, test: cmdTest, status: cmdStatus, close: cmdClose };
if (!handlers[cmd]) usage(cmd ? `unknown command ${cmd}` : undefined);
handlers[cmd](opts).then((code) => process.exit(code), (e) => {
  console.error(`cloud-runner: ${e.message}`);
  process.exit(2);
});
