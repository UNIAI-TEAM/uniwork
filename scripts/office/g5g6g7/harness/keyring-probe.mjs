/* global process */
// Headless-keyring probe driver (UNI-1376, g7-qa spike). Prints ONE JSON line:
//   { label, backend, roundTrip: "ok"|"fail", status: "ready"|"keyring_unavailable"|…, … }
// from the fork's own Electron running the fork's own credential store
// (apps/shell/src/main/uniwork-auth/credentials.ts, bundled with the fork's
// esbuild into a scratch dir; the fork checkout is never written to).
//
// Run it under the session the keyring lives in, e.g. through keyring-session.sh
// (see README › Headless keyring (Linux)):
//   xvfb-run -a node scripts/office/g5g6g7/harness/keyring-probe.mjs --label SAFESTORAGE --expect ready
//
// Electron gets the harness's own allow-listed environment (lib.mjs `appEnv`),
// i.e. what the fork app started by start.sh sees, plus XDG_CURRENT_DESKTOP when
// asked: Chromium picks the Linux password store from it. No secret is printed:
// the result holds booleans, a coarse error code and a byte count.
//
// Exit: 0 the probe ran (and, with --expect, the status matched), 1 it ran and
// the status was not the expected one or no result came back, 77 BLOCKED (no
// fork checkout / no Electron binary / no esbuild: nothing was proven).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BLOCKED_EXIT, DEFAULT_FORK_SHA, appEnv, forkCacheDir, isMainModule } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN_ENTRY = join(HERE, "keyring-probe-main.mjs");
/** The module the probe exercises, relative to the fork checkout. */
export const CREDENTIALS_MODULE = "apps/shell/src/main/uniwork-auth/credentials.ts";
const DEFAULT_TIMEOUT_MS = 60_000;
const EXPECTED = new Set(["ready", "keyring_unavailable"]);

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 */
export function parseArgs(argv, env = process.env) {
  const out = {
    label: "KEYRING_PROBE",
    forkDir: env.OFFICE_FORK_DIR ?? "",
    expect: "",
    // GNOME is what a real GNOME session exports; "none" leaves the variable out, as appEnv does for the app
    xdgCurrentDesktop: env.KEYRING_PROBE_XDG_CURRENT_DESKTOP ?? "GNOME",
    passwordStore: env.KEYRING_PROBE_PASSWORD_STORE ?? "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  const names = { "--label": "label", "--fork-dir": "forkDir", "--expect": "expect", "--xdg-current-desktop": "xdgCurrentDesktop", "--password-store": "passwordStore" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = names[argv[i]];
    if (key) {
      if (i + 1 >= argv.length) throw new Error(`${argv[i]} needs a value`);
      out[key] = argv[(i += 1)];
    } else if (argv[i] === "--timeout-ms") {
      const value = Number(argv[(i += 1)]);
      if (!Number.isInteger(value) || value < 1000) throw new Error("--timeout-ms needs an integer of at least 1000");
      out.timeoutMs = value;
    } else {
      throw new Error(`unknown argument ${argv[i]}`);
    }
  }
  if (out.expect && !EXPECTED.has(out.expect)) throw new Error(`--expect must be one of ${[...EXPECTED].join(", ")}`);
  return out;
}

/** The fork checkout the probe reads: --fork-dir, OFFICE_FORK_DIR, else the harness cache entry for OFFICE_FORK_SHA. */
export function resolveForkDir(forkDir, env = process.env) {
  if (forkDir) return forkDir;
  const cache = env.OFFICE_FORK_CACHE || join(homedir(), ".cache", "uniwork-office-harness");
  return forkCacheDir(cache, env.OFFICE_FORK_SHA || DEFAULT_FORK_SHA);
}

/** Electron's argv: the flags the harness starts the app with, the optional password-store switch, the entry. */
export function electronArgs({ passwordStore = "", mainPath = MAIN_ENTRY } = {}) {
  return ["--no-sandbox", "--disable-gpu", ...(passwordStore ? [`--password-store=${passwordStore}`] : []), mainPath];
}

/** The probe's environment: the app's allow-listed one, plus the desktop name when one is wanted. */
export function probeEnv({ source = process.env, userDataDir, bundleUrl, xdgCurrentDesktop = "GNOME" }) {
  const wantDesktop = xdgCurrentDesktop !== "" && xdgCurrentDesktop !== "none";
  return appEnv({
    source,
    apiOrigin: "http://127.0.0.1:9",
    userDataDir,
    extra: { PROBE_BUNDLE_URL: bundleUrl, ...(wantDesktop ? { XDG_CURRENT_DESKTOP: xdgCurrentDesktop } : {}) },
  });
}

/** The last stdout line that is the probe's JSON result (Chromium may print its own lines around it). */
export function parseResultLine(stdout) {
  const lines = String(stdout).split(/\r?\n/).reverse();
  for (const line of lines) {
    if (!line.startsWith("{") || !line.includes('"probe":"keyring"')) continue;
    try {
      return JSON.parse(line);
    } catch {
      // a torn line is not a result
    }
  }
  return null;
}

/** PASS when the status is the expected one (or nothing was expected and a result came back). */
export function verdictFor(result, expect) {
  if (!result) return "FAIL";
  if (!expect) return "PASS";
  return result.status === expect ? "PASS" : "FAIL";
}

/** A line of Chromium's stderr, clipped: the tail goes into a failed result so a cloud round log can say why. */
function tailLines(text, count = 6) {
  return String(text)
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-count)
    .map((line) => line.slice(0, 200));
}

function blocked(args, reason) {
  console.log(JSON.stringify({ label: args.label, probe: "keyring", status: "blocked", roundTrip: "fail", reason, verdict: "BLOCKED" }));
  return BLOCKED_EXIT;
}

function runElectron(bin, args, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    // only this child's own PID is ever signalled
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}\n${error.code ?? "spawn_error"}`, code: null, signal: null, timedOut });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, signal, timedOut });
    });
  });
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const forkDir = resolveForkDir(args.forkDir);
  const source = join(forkDir, CREDENTIALS_MODULE);
  if (!existsSync(source)) return blocked(args, `the fork checkout has no ${CREDENTIALS_MODULE} (fork dir ${forkDir}; prepare it with keyring-fork.sh)`);
  const esbuild = join(forkDir, "node_modules", ".bin", "esbuild");
  if (!existsSync(esbuild)) return blocked(args, "the fork has no node_modules/.bin/esbuild (keyring-fork.sh installs it)");
  let electronBin;
  try {
    electronBin = createRequire(join(forkDir, "apps", "shell", "package.json"))("electron");
  } catch {
    return blocked(args, "the fork has no Electron package to resolve (keyring-fork.sh installs it)");
  }
  if (typeof electronBin !== "string" || !existsSync(electronBin)) return blocked(args, "the fork's Electron binary is not downloaded (keyring-fork.sh fetches it)");

  const scratch = mkdtempSync(join(tmpdir(), "keyring-probe-"));
  try {
    const bundle = join(scratch, "credentials.mjs");
    const built = spawnSync(esbuild, [source, "--bundle", "--platform=node", "--format=esm", "--target=node22", `--outfile=${bundle}`, "--log-level=error"], { encoding: "utf8" });
    if (built.status !== 0) {
      console.log(JSON.stringify({ label: args.label, probe: "keyring", status: "error", roundTrip: "fail", errorCode: "bundle_failed", stderrTail: tailLines(built.stderr), verdict: "FAIL" }));
      return 1;
    }
    const userDataDir = join(scratch, "userdata");
    const env = probeEnv({ userDataDir, bundleUrl: pathToFileURL(bundle).href, xdgCurrentDesktop: args.xdgCurrentDesktop });
    const run = await runElectron(electronBin, electronArgs({ passwordStore: args.passwordStore }), env, args.timeoutMs);
    const result = parseResultLine(run.stdout);
    const forkSha = spawnSync("git", ["-C", forkDir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout?.trim() || null;
    const verdict = verdictFor(result, args.expect);
    const line = {
      label: args.label,
      ...(result ?? { probe: "keyring", status: "error", roundTrip: "fail", errorCode: run.timedOut ? "timeout" : "no_result" }),
      module: CREDENTIALS_MODULE,
      forkSha,
      xdgCurrentDesktop: env.XDG_CURRENT_DESKTOP ?? null,
      passwordStoreFlag: args.passwordStore || null,
      dbusSessionBus: Boolean(env.DBUS_SESSION_BUS_ADDRESS),
      expected: args.expect || null,
      verdict,
      ...(result ? {} : { exitCode: run.code, signal: run.signal, stderrTail: tailLines(run.stderr) }),
    };
    console.log(JSON.stringify(line));
    return verdict === "PASS" ? 0 : 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (isMainModule({ moduleUrl: import.meta.url })) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`keyring-probe: ${error instanceof Error ? error.message : error}`);
      process.exit(2);
    },
  );
}

