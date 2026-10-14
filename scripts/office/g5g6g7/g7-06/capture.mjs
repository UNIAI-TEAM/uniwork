/* global process, console */
// G7-06 capture provider (contract section 3): deterministic screenshots and
// rendered text of the six G7-01 fixtures on the desktop host (the harness fork
// app) and the web host (D web + the installed frame bundle).
//
//   node scripts/office/g5g6g7/g7-06/capture.mjs --host desktop|web --out <captures> [--fixtures a,b] [--run-dir <dir>]
//
// Writes <captures>/<host>/<fixture>.{png,txt} for each ok fixture (txt = the
// module's rendered text only), <fixture>.host.txt (web: the page around the
// module frame) or <fixture>.shell.txt (desktop: the shell window's title and
// text, the tab strip), and <captures>/<host>/meta.json. Exit 0 every fixture ok, 1 any failed, 77 a
// precondition is missing (harness not up, no display, Playwright or a browser
// not installed, no sign-in). BLOCKED is for a precondition that is really
// absent; a render that is wrong or never settles is a failed fixture.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { EXIT_BLOCKED, EXIT_FAILED, EXIT_USAGE, HOSTS } from "./capture/constants.mjs";
import { readFixtures, selectFixtures } from "./capture/fixtures.mjs";
import { blocked, buildMeta, clearCapture, exitCodeFor, metaEntry, writeCapture, writeMeta } from "./capture/meta.mjs";
import { loadPlaywright } from "./capture/playwright.mjs";
import { defaultRunDir, readRun } from "./capture/run-dir.mjs";
import { captureDesktop } from "./capture/desktop.mjs";
import { captureWeb } from "./capture/web.mjs";
import { visibleChars } from "./capture/text.mjs";

export function parseArgs(argv, env = process.env) {
  const args = { host: "", out: "", fixtures: null, runDir: defaultRunDir(env), errors: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args.errors.push(`${flag} needs a value`);
        return "";
      }
      i += 1;
      return next;
    };
    if (flag === "--host") args.host = value();
    else if (flag === "--out") args.out = value();
    else if (flag === "--fixtures") args.fixtures = value().split(",").map((id) => id.trim()).filter(Boolean);
    else if (flag === "--run-dir") args.runDir = value();
    else args.errors.push(`unknown argument ${flag}`);
  }
  if (!HOSTS.includes(args.host)) args.errors.push(`--host must be one of ${HOSTS.join("|")}`);
  if (!args.out) args.errors.push("--out <captures dir> is required");
  return args;
}

/** Runs one host; returns `{exitCode, meta}` after writing the files. */
export async function runCapture({ host, out, fixtures, runDir, env = process.env, log = () => {}, playwright = loadPlaywright(env) }) {
  const chosen = fixtures;
  const finish = ({ results, forkSha = "", pinVersion = "", notes = [] }) => {
    const entries = {};
    for (const fixture of chosen) {
      const result = results[fixture.id] ?? blocked("not attempted");
      if (result.status === "ok") {
        writeCapture(out, host, fixture.id, { png: result.png, text: result.text, hostText: result.hostText, shellText: result.shellText });
        const chars = visibleChars(result.text);
        const reason = chars === 0 ? "rendered text is empty (the brand check will fail it as no_rendered_text)" : "";
        entries[fixture.id] = { ...metaEntry(result), reason };
      } else {
        clearCapture(out, host, fixture.id);
        entries[fixture.id] = metaEntry(result);
      }
    }
    const meta = buildMeta({ host, forkSha, pinVersion, fixtures: entries });
    writeMeta(out, meta);
    for (const note of notes) log(note);
    return { exitCode: exitCodeFor(entries), meta };
  };
  const blockAll = (reason) => finish({ results: Object.fromEntries(chosen.map((fixture) => [fixture.id, blocked(reason)])) });

  const run = readRun(runDir);
  if (run.gate === "fail") {
    // start.sh itself failed: a harness bug, the shots are FAILED, not blocked
    const results = Object.fromEntries(chosen.map((fixture) => [fixture.id, { status: "failed", reason: run.reason }]));
    return finish({ results });
  }
  if (run.gate === "blocked") return blockAll(run.reason);
  if (!playwright) return blockAll("Playwright is not installed (@playwright/test of the e2e workspace); run pnpm install and `npx playwright install chromium`");
  const captured = host === "desktop"
    ? await captureDesktop({ ports: run.ports, fixtures: chosen, playwright, log })
    : await captureWeb({ ports: run.ports, fixtures: chosen, playwright, log });
  return finish(captured);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.errors.length > 0) {
    for (const error of args.errors) console.error(`capture: ${error}`);
    console.error("usage: capture.mjs --host desktop|web --out <captures dir> [--fixtures a,b] [--run-dir <dir>]");
    return EXIT_USAGE;
  }
  let all;
  try {
    all = readFixtures();
  } catch (error) {
    console.error(`capture: ${error.message}`);
    return EXIT_BLOCKED;
  }
  const { chosen, unknown } = selectFixtures(all, args.fixtures);
  if (unknown.length > 0) {
    console.error(`capture: unknown fixture ids ${unknown.join(", ")}; the manifest has ${all.map((fixture) => fixture.id).join(", ")}`);
    return EXIT_USAGE;
  }
  const log = (line) => console.log(line);
  try {
    const { exitCode, meta } = await runCapture({ host: args.host, out: resolve(args.out), fixtures: chosen, runDir: resolve(args.runDir), log });
    for (const [id, entry] of Object.entries(meta.fixtures)) console.log(`  ${entry.status.padEnd(7)} ${args.host}/${id}${entry.reason ? ` - ${entry.reason}` : ""}`);
    console.log(`capture ${args.host}: ${exitCode === 0 ? "ok" : exitCode === EXIT_BLOCKED ? "BLOCKED" : "FAILED"} (exit ${exitCode}), meta at ${resolve(args.out, args.host, "meta.json")}`);
    return exitCode;
  } catch (error) {
    console.error(`capture: unexpected error: ${error.stack ?? error.message}`);
    return EXIT_FAILED;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
