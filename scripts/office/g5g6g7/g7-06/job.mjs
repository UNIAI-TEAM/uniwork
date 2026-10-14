#!/usr/bin/env node
// The G7-06 regression job (UNI-1378, contract section 1): for a fork SHA / pin,
// recompute the protocol digests, re-run the G6-01 extractor, compare the
// untouched regions of the six fixtures against the committed goldens and scan
// the rendered text for the old brand names. One check = one evidence-ledger
// line through scripts/office/g5g6g7/evidence.mjs; the job never touches the
// ledger itself.
//
// Exit codes: 0 every requested check PASS, 1 any FAIL, 77 no FAIL and at
// least one BLOCKED or NOTE (a missing precondition is never a PASS, and a
// NOTE — a comparison that never ran — is not one either; amendment 3).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runBrandCheck } from "./brand-check.mjs";
import { runExtractorCheck } from "./extractor-check.mjs";
import { runGoldenCheck, updateGoldens } from "./golden-check.mjs";
import { runProtocolCheck } from "./protocol-check.mjs";
import {
  CHECK_NAMES,
  DEFAULT_GOLDENS_DIR,
  DEFAULT_OUT,
  DEFAULT_PIN_DIR,
  HOSTS,
  exitCodeFor,
  fixtureIds,
  resolveFromCwd,
} from "./job-lib.mjs";
import { readPins } from "./protocol-check.mjs";

const USAGE = `usage: node scripts/office/g5g6g7/g7-06/job.mjs [options]

  --fork-dir <dir>    G706_FORK_DIR    a git checkout of the fork with the pin SHA's objects
  --fork-sha <sha>    G706_FORK_SHA    default: gitSha of docs.pin.json (all six pins must agree)
  --installed <dir>   G706_INSTALLED   the installed frame bundle root (<root>/<pin.version>/manifest.json)
  --captures <dir>    G706_CAPTURES    the capture provider's output (contract section 3)
  --extractor <file>  G706_EXTRACTOR   extractor to run; default <fork-dir>/scripts/genoffice-tools-extract.mjs
  --pin-dir <dir>     G706_PIN_DIR     the six *.pin.json to read (default: apps/web/platform/office-frame, the live pin)
  --out <dir>         G706_OUT         artifact dir (default ${DEFAULT_OUT}, gitignored)
  --checks a,b                         protocol,extractor,golden,brand (default all four)
  --update-goldens                     copy captures into the goldens dir and rewrite goldens/manifest.json (runs alone)
`;

/** @param {string[]} argv */
export function parseArgs(argv) {
  const args = { checks: null, updateGoldens: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--fork-dir") args.forkDir = argv[++i];
    else if (flag === "--fork-sha") args.forkSha = argv[++i];
    else if (flag === "--installed") args.installedRoot = argv[++i];
    else if (flag === "--captures") args.capturesDir = argv[++i];
    else if (flag === "--extractor") args.extractor = argv[++i];
    else if (flag === "--pin-dir") args.pinDir = argv[++i];
    else if (flag === "--out") args.out = argv[++i];
    else if (flag === "--checks") {
      const names = String(argv[++i] ?? "").split(",").filter(Boolean);
      const unknown = names.filter((name) => !CHECK_NAMES.includes(name));
      if (names.length === 0 || unknown.length > 0) {
        throw new Error(`--checks takes a comma-separated subset of ${CHECK_NAMES.join(",")}; got ${JSON.stringify(argv[i])}`);
      }
      args.checks = names;
    } else if (flag === "--update-goldens") args.updateGoldens = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else throw new Error(`unknown argument ${flag}`);
  }
  // F-02: the flag is an explicit bootstrap step, never a side effect of a
  // check run — `--update-goldens --checks protocol` used to rewrite the
  // committed goldens and never run the requested check.
  if (args.updateGoldens && args.checks) {
    throw new Error("--update-goldens is a bootstrap step: it runs alone, never together with --checks");
  }
  return args;
}

/**
 * The job the CLI wraps, as a function: every directory is an option, so a
 * test can run the four checks against a fake fork, fake captures and a fake
 * installed bundle without touching the checkout.
 * @param {{ forkDir?: string | null, forkSha?: string | null, installedRoot?: string | null, capturesDir?: string | null, extractor?: string | null, outDir: string, checks?: string[], updateGoldens?: boolean, pinDir?: string, goldensDir?: string, fixtures?: string[], hosts?: string[] }} options
 */
export function runJob({
  forkDir = null,
  forkSha = null,
  installedRoot = null,
  capturesDir = null,
  extractor = null,
  outDir,
  checks = CHECK_NAMES,
  updateGoldens: update = false,
  pinDir = DEFAULT_PIN_DIR,
  goldensDir = DEFAULT_GOLDENS_DIR,
  fixtures = fixtureIds(),
  hosts = HOSTS,
}) {
  // Same guard as parseArgs, for callers that skip the CLI (F-02).
  if (update && checks !== CHECK_NAMES) {
    throw new Error("--update-goldens is a bootstrap step: it runs alone, never together with --checks");
  }
  mkdirSync(outDir, { recursive: true });
  const pins = readPins(pinDir);
  const docsPin = pins.find((pin) => pin.module === "docs") ?? null;
  const sha = forkSha ?? docsPin?.gitSha ?? null;
  /** @type {Record<string, { status: string, reasons: string[], artifacts: string[] }>} */
  const results = {};
  if (update) {
    results.golden = updateGoldens({ capturesDir, goldensDir, fixtures, hosts, pinVersion: docsPin?.version ?? null, forkSha: sha, outDir });
  } else {
    const identity = { forkSha: sha, pinVersion: docsPin?.version ?? null };
    for (const name of checks) {
      try {
        if (name === "protocol") results.protocol = runProtocolCheck({ forkDir, forkSha, installedRoot, pinDir, outDir });
        else if (name === "extractor") results.extractor = runExtractorCheck({ forkDir, forkSha: sha, extractor, outDir });
        else if (name === "golden") results.golden = runGoldenCheck({ capturesDir, goldensDir, fixtures, hosts, outDir, ...identity });
        else if (name === "brand") results.brand = runBrandCheck({ capturesDir, fixtures, hosts, outDir, ...identity });
      } catch (error) {
        // A check that throws still leaves a verdict — and result.json — behind
        // (F-07): a crash reads as BLOCKED, the ledger artifact is never missing.
        results[name] = { status: "BLOCKED", reasons: [`check_crashed (${error.message})`], artifacts: [] };
      }
    }
  }
  const result = { forkSha: sha, pinVersion: docsPin?.version ?? null, checks: results };
  writeFileSync(join(outDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

/** The one human summary the job prints: a line per check, then the verdict. */
export function summaryLines(result, outDir) {
  const lines = [`g7-06 job: fork ${result.forkSha ?? "(unknown)"}, pin ${result.pinVersion ?? "(unknown)"}`];
  for (const [name, check] of Object.entries(result.checks)) {
    const detail = check.reasons.length > 0 ? ` — ${check.reasons.join("; ")}` : "";
    lines.push(`  ${name.padEnd(9)} ${check.status}${detail}`);
  }
  const counts = { PASS: 0, FAIL: 0, BLOCKED: 0, NOTE: 0 };
  for (const check of Object.values(result.checks)) counts[check.status] += 1;
  // A NOTE is printed as its own count but reads as BLOCKED, matching the exit
  // code (amendment 3): the summary must not say PASS over a comparison that
  // never ran.
  const verdict = counts.FAIL > 0 ? "FAIL" : counts.BLOCKED + counts.NOTE > 0 ? "BLOCKED" : "PASS";
  lines.push(
    `g7-06 job: ${verdict} (${counts.FAIL} fail, ${counts.BLOCKED} blocked, ${counts.PASS} pass, ${counts.NOTE} note) — artifacts in ${outDir}`,
  );
  return lines;
}

/** The env form of each flag (contract section 1's table). */
export function optionsFromEnv(args, env = process.env) {
  const out = resolveFromCwd(args.out ?? env.G706_OUT ?? DEFAULT_OUT);
  return {
    forkDir: args.forkDir ?? env.G706_FORK_DIR ?? null,
    forkSha: args.forkSha ?? env.G706_FORK_SHA ?? null,
    installedRoot: args.installedRoot ?? env.G706_INSTALLED ?? null,
    capturesDir: args.capturesDir ?? env.G706_CAPTURES ?? null,
    extractor: args.extractor ?? env.G706_EXTRACTOR ?? null,
    pinDir: resolveFromCwd(args.pinDir ?? env.G706_PIN_DIR ?? DEFAULT_PIN_DIR),
    outDir: out,
    checks: args.checks ?? CHECK_NAMES,
    updateGoldens: args.updateGoldens,
  };
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`g7-06 job: ${error.message}\n${USAGE}`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  try {
    const options = optionsFromEnv(args);
    const result = runJob(options);
    for (const line of summaryLines(result, options.outDir)) process.stdout.write(`${line}\n`);
    return exitCodeFor(result.checks);
  } catch (error) {
    process.stderr.write(`g7-06 job: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}