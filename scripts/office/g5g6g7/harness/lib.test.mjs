// Pure-helper tests for the G7-01 app harness (UNI-1376, item C). The stack
// itself only runs on the cloud VM; what is cheap and worth pinning here is the
// part that decides where a run points: fresh ports and the environment handed
// to the server, the web and the app.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BLOCKED_EXIT, DEFAULT_FORK_SHA, DEV_CLIENT_ID, HARNESS_DEPLOYMENT_ID, SERVER_ENV_LOOKUPS, buildServerEnv, documentStepOutcome, evidenceLine, forkCacheDir, freePorts, harnessPaths, isMainModule, officeDeepLink, origin, parseWaitSignin, activeDesktopDevice, readStartStatus, serverCwd, serverDotEnv, startGate, ticketFromLaunchUrl, workingCopyDir, writeRunEnv } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, "lib.mjs");
const START_SH = join(HERE, "start.sh");

test("freePorts hands out distinct ports the kernel just released", async () => {
  const ports = await freePorts(3);
  assert.equal(ports.length, 3);
  assert.equal(new Set(ports).size, 3);
  for (const port of ports) {
    assert.ok(Number.isInteger(port) && port > 0 && port < 65536, `${port} is not a port`);
  }
});

test("freePorts refuses a non-positive count", async () => {
  await assert.rejects(() => freePorts(0), /positive count/);
});

test("BLOCKED is 77 so a missing precondition is never mistaken for a pass", () => {
  assert.equal(BLOCKED_EXIT, 77);
});

test("the default fork revision is the pinned base", () => {
  assert.equal(DEFAULT_FORK_SHA, "0d03b18");
});

test("buildServerEnv puts every port-derived origin on the command line", () => {
  const env = buildServerEnv({
    apiPort: 18080,
    webPort: 13000,
    metricsPort: 19090,
    previewPort: 13001,
    databaseUrl: "postgres://u:p@localhost:5432/db?sslmode=disable",
    redisUrl: "redis://localhost:6379",
    uploadDir: "/tmp/harness-uploads",
  });
  assert.equal(env.PORT, "18080");
  assert.equal(env.FRONTEND_ORIGIN, "http://127.0.0.1:13000");
  assert.equal(env.API_PUBLIC_URL, "http://127.0.0.1:18080");
  assert.equal(env.NEXT_PUBLIC_API_URL, "http://127.0.0.1:18080");
  assert.equal(env.NEXT_PUBLIC_WS_URL, "ws://127.0.0.1:18080");
  assert.equal(env.E2E_BASE_URL, "http://127.0.0.1:13000");
  // METRICS_ADDR is the listen address, not an origin (metrics/config.go:14).
  assert.equal(env.METRICS_ADDR, "127.0.0.1:19090");
  // The server refuses a PREVIEW_ORIGIN equal to FRONTEND_ORIGIN.
  assert.equal(env.PREVIEW_ORIGIN, "http://127.0.0.1:13001");
  assert.notEqual(env.PREVIEW_ORIGIN, env.FRONTEND_ORIGIN);
  assert.equal(env.STORAGE_BACKEND, "local");
  assert.equal(env.DATABASE_URL, "postgres://u:p@localhost:5432/db?sslmode=disable");
  // A stale .env LIVEKIT_URL must not reach the harness server (main.go:203).
  assert.equal(env.LIVEKIT_URL, "");
  assert.equal(env.LIVEKIT_API_KEY, "");
  assert.equal(env.LIVEKIT_API_SECRET, "");
});

test("buildServerEnv keeps the API origin identical everywhere it is inlined", () => {
  const env = buildServerEnv({ apiPort: 12345, webPort: 12300, metricsPort: 12400, previewPort: 12301, databaseUrl: "postgres://x", redisUrl: "redis://y", uploadDir: "/tmp/u" });
  assert.equal(env.API_PUBLIC_URL, env.NEXT_PUBLIC_API_URL);
  assert.equal(env.API_PUBLIC_URL, env.LOCAL_UPLOAD_BASE_URL);
});

test("the launch deep link is the dev scheme both ends agree on", () => {
  // server/internal/handler/office_launch.go:50 builds `<client_id>://open?ticket=`;
  // the fork's parseOfficeDeepLink reads the same host and query, and only the
  // dev channel registers `uniwork-office-dev` (deployment.ts:31-33).
  assert.equal(DEV_CLIENT_ID, "uniwork-office-dev");
  assert.equal(officeDeepLink(DEV_CLIENT_ID, "ticket_abc"), "uniwork-office-dev://open?ticket=ticket_abc");
  // the server percent-encodes the ticket, so a reserved character survives
  assert.equal(officeDeepLink(DEV_CLIENT_ID, "ticket_a+b/c="), "uniwork-office-dev://open?ticket=ticket_a%2Bb%2Fc%3D");
  const url = new URL(officeDeepLink(DEV_CLIENT_ID, "ticket_x"));
  assert.equal(url.protocol, "uniwork-office-dev:");
  assert.equal(url.hostname, "open");
  assert.equal(url.searchParams.get("ticket"), "ticket_x");
});

test("the working-copy dir is the fork's own layout", () => {
  // fork binding-store.ts:14-19,165-167
  assert.equal(HARNESS_DEPLOYMENT_ID, "default");
  // The app builds its profile from UNIWORK_API_ORIGIN with no UNIWORK_DEPLOYMENT_ID,
  // so it claims deployment "default" (deployment.ts:161-167). A launch session and
  // a desktop session must name the same deployment or the exchange refuses
  // (office_launch.go exchange: device.DeploymentID != in.DeploymentID -> 403).
  assert.equal(buildServerEnv({ apiPort: 1, webPort: 2, metricsPort: 3, previewPort: 4, databaseUrl: "postgres://x", redisUrl: "redis://y", uploadDir: "/tmp/u" }).DESKTOP_AUTH_DEPLOYMENT_IDS, "default");
  assert.equal(
    workingCopyDir("/run/userdata", "default", "user_1", "doc_1"),
    join("/run/userdata", "uniwork-documents", "default", "user_1", "doc_1"),
  );
});

test("ticketFromLaunchUrl reads the ticket out of the server's link, or null", () => {
  assert.equal(ticketFromLaunchUrl("uniwork-office-dev://open?ticket=ticket_abc"), "ticket_abc");
  assert.equal(ticketFromLaunchUrl("uniwork-office-dev://open"), null);
  assert.equal(ticketFromLaunchUrl("not a url"), null);
  assert.equal(ticketFromLaunchUrl(null), null);
});

test("documentStepOutcome decides from the app's own working copy", () => {
  const base = { launchUrl: "uniwork-office-dev://open?ticket=ticket_abc", ticket: "ticket_abc", documentId: "doc_1", signedIn: true };
  // the working copy names the fixture document: the app opened it
  assert.equal(documentStepOutcome({ ...base, workingCopyDocumentId: "doc_1" }).result, "PASS");
  // a ticket but no working copy, with a session: the app was handed the link and did not open it
  const failed = documentStepOutcome({ ...base, workingCopyDocumentId: null });
  assert.equal(failed.result, "FAIL");
  assert.equal(failed.blocker, null);
  // a working copy for ANOTHER document is not this document opened
  assert.equal(documentStepOutcome({ ...base, workingCopyDocumentId: "doc_2" }).result, "FAIL");
  // no desktop session: the app had nothing to redeem with — BLOCKED, not FAIL
  const blocked = documentStepOutcome({ ...base, workingCopyDocumentId: null, signedIn: false });
  assert.equal(blocked.result, "BLOCKED");
  assert.match(blocked.blocker, /keyring|session/i);
  // the server refused the session (no ticket): a FAIL, the claim did not hold
  assert.equal(documentStepOutcome({ ...base, launchUrl: "", ticket: null, workingCopyDocumentId: null }).result, "FAIL");
});

test("origin builds a loopback origin for a port", () => {
  assert.equal(origin(8080), "http://127.0.0.1:8080");
  assert.equal(origin(8080, "ws"), "ws://127.0.0.1:8080");
});

test("harnessPaths keeps every run artifact inside the run dir", () => {
  const paths = harnessPaths("/tmp/run");
  for (const value of Object.values(paths)) assert.ok(value.startsWith("/tmp/run"), value);
  assert.equal(paths.envFile, "/tmp/run/ports.env");
  assert.equal(paths.pidFile, "/tmp/run/pids");
  assert.equal(paths.evidenceFile, "/tmp/run/evidence.jsonl");
});

test("forkCacheDir is keyed by the revision so two SHAs never share a checkout", () => {
  assert.equal(forkCacheDir("/cache", "0d03b18"), "/cache/uniwork-office-0d03b18");
  assert.notEqual(forkCacheDir("/cache", "aaaaaaa"), forkCacheDir("/cache", "bbbbbbb"));
});

test("evidenceLine carries every field the runner contract checks, empty when unknown", () => {
  const line = evidenceLine({ requirementId: "G7-A05", result: "PASS", exitCode: 0, dSha: "abc", fSha: "0d03b18" });
  for (const key of ["evidenceId", "requirementId", "dSha", "fSha", "pin", "platform", "build", "fixtureId", "fixtureSha256", "command", "argv", "exitCode", "result", "artifact", "checker", "blocker", "startedAt", "finishedAt"]) {
    assert.ok(key in line, `missing ${key}`);
  }
  assert.equal(line.result, "PASS");
  assert.equal(line.exitCode, 0);
  assert.equal(line.pin, "");
});

test("evidenceLine defaults argv to the command that ran, never an empty vector", () => {
  // The runner's verify reports an empty argv as an empty required field
  // (reviewer_be r2 N1), so a harness-written line must carry the real vector.
  const line = evidenceLine({ requirementId: "G7-A05", result: "BLOCKED", exitCode: 77 });
  assert.ok(Array.isArray(line.argv) && line.argv.length > 0, "argv must not be empty");
  assert.deepEqual(line.argv, [...process.argv]);
  // an explicit argv is kept as given
  assert.deepEqual(evidenceLine({ argv: ["node", "x.mjs"] }).argv, ["node", "x.mjs"]);
});

test("evidenceLine defaults to BLOCKED, never to PASS", () => {
  assert.equal(evidenceLine({}).result, "BLOCKED");
  assert.equal(evidenceLine({}).exitCode, -1);
});

test("evidenceLine keeps a fixture hash and a blocker out of a PASS", () => {
  // The runner's verify refuses a PASS that carries a blocker or a non-zero exit;
  // the writer here must not produce one in the first place.
  const blocked = evidenceLine({ result: "BLOCKED", blocker: "no D server on http://127.0.0.1:1", exitCode: 77 });
  assert.equal(blocked.result, "BLOCKED");
  assert.ok(blocked.blocker.length > 0);
  assert.notEqual(blocked.exitCode, 0);
});

test("writeRunEnv writes a ports file and a server env bash can source", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "harness-lib-"));
  const previous = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL };
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db?sslmode=disable";
  process.env.REDIS_URL = "redis://localhost:6379/0";
  try {
    const ports = await writeRunEnv(runDir, { forkSha: "0d03b18", dSha: "deadbeef" });
    assert.ok(ports.apiPort > 0 && ports.webPort > 0 && ports.metricsPort > 0 && ports.previewPort > 0);
    assert.equal(new Set([ports.apiPort, ports.webPort, ports.metricsPort, ports.previewPort]).size, 4);

    const portsFile = readFileSync(join(runDir, "ports.env"), "utf8");
    assert.match(portsFile, new RegExp(`API_ORIGIN=${ports.apiOrigin.replace(/\./g, "\\.")}`));
    assert.match(portsFile, /OFFICE_FORK_SHA=0d03b18/);
    assert.match(portsFile, /D_SHA=deadbeef/);

    // The env file is sourced by start.sh, so prove bash agrees with it — a URL
    // with a query string is the case that breaks an unquoted writer.
    const sourced = execFileSync("bash", ["-c", `. "${join(runDir, "server.env")}"; printf '%s|%s|%s' "$PORT" "$NEXT_PUBLIC_API_URL" "$DATABASE_URL"`], { encoding: "utf8" });
    assert.equal(sourced, `${ports.apiPort}|${ports.apiOrigin}|postgres://u:p@localhost:5432/db?sslmode=disable`);
  } finally {
    if (previous.DATABASE_URL === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.DATABASE_URL;
    if (previous.REDIS_URL === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previous.REDIS_URL;
  }
});

// ---- the CLI entry guard and the exact start.sh call path ---------------------
// The r1 cloud round (g7-qa, 2026-10-12) died on start.sh line 236, which read
// the fork cache dir with `node -e 'import(argv[1])...' lib.mjs ...`. Under
// `node -e` the first positional argument lands in argv[1], so the old
// `import.meta.url === pathToFileURL(argv[1]).href` guard fired the `--write`
// CLI inside an import, printed "usage: lib.mjs --write <runDir>" and exited 2;
// `set -e` then took the whole harness down. These tests run the real files.

test("isMainModule is false when node was started with an eval flag", () => {
  const argv1 = "/repo/scripts/office/g5g6g7/harness/lib.mjs";
  const moduleUrl = pathToFileURL(argv1).href;
  // The shape that broke r1: `node -e '<script>' lib.mjs` leaves lib.mjs in argv[1].
  assert.equal(isMainModule({ argv1, execArgv: ["-e", "import(process.argv[1])"], moduleUrl }), false);
  assert.equal(isMainModule({ argv1, execArgv: ["--eval", "x"], moduleUrl }), false);
  assert.equal(isMainModule({ argv1, execArgv: ["--print=x"], moduleUrl }), false);
  // A plain `node lib.mjs ...` has no eval flag and is main.
  assert.equal(isMainModule({ argv1, execArgv: [], moduleUrl }), true);
  assert.equal(isMainModule({ argv1: undefined, execArgv: [], moduleUrl }), false);
  assert.equal(isMainModule({ argv1: "/other.mjs", execArgv: [], moduleUrl }), false);
});

test("importing lib.mjs from node -e does not run the CLI", () => {
  // The exact r1 shape, end to end: no usage line, no exit 2, just the value.
  const script = "import(process.argv[1]).then((m) => process.stdout.write(m.forkCacheDir(process.argv[2], process.argv[3])))";
  const result = spawnSync(process.execPath, ["-e", script, LIB, "/cache", "0d03b18"], { encoding: "utf8" });
  assert.equal(result.status, 0, `node -e import exited ${result.status}: ${result.stderr}`);
  assert.equal(result.stdout, join("/cache", "uniwork-office-0d03b18"));
  assert.equal(result.stderr, "");
});

test("the lib.mjs CLI modes answer and name the mode on a bad call", () => {
  const forkDir = spawnSync(process.execPath, [LIB, "--fork-dir", "/cache", "0d03b18"], { encoding: "utf8" });
  assert.equal(forkDir.status, 0, forkDir.stderr);
  assert.equal(forkDir.stdout.trim(), join("/cache", "uniwork-office-0d03b18"));

  const missing = spawnSync(process.execPath, [LIB, "--fork-dir", "/cache"], { encoding: "utf8" });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--fork-dir needs a cache root and a fork SHA/);

  const unknown = spawnSync(process.execPath, [LIB, "--nope"], { encoding: "utf8" });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown argument --nope/);
  assert.match(unknown.stderr, /usage: lib\.mjs --write <runDir>/);
});

/**
 * A stand-in for the D server's boot that keeps its two real behaviours: the
 * .env loader (server/cmd/server/envfile.go — the same four lookups, and a key
 * is skipped only when its value is already NON-EMPTY, so an empty key is
 * refilled) and the DESKTOP_AUTH check (config.go:306-311). It records its cwd
 * and the pair it ended up with, and answers /healthz (a file) only once it
 * booted; a config error is printed the way the server prints it, exit 1.
 */
function LOADER_SERVER(root, readyFile) {
  return [
    "#!/usr/bin/env node",
    'const fs = require("fs");',
    `const LOOKUPS = ${JSON.stringify(SERVER_ENV_LOOKUPS)};`,
    "for (const path of LOOKUPS) {",
    "  let text;",
    '  try { text = fs.readFileSync(path, "utf8"); } catch { continue; }',
    '  for (const raw of text.split("\\n")) {',
    "    const line = raw.trim();",
    '    if (!line || line.startsWith("#")) continue;',
    '    const at = line.indexOf("=");',
    "    if (at < 0) continue;",
    "    const key = line.slice(0, at).trim();",
    "    if (!key || process.env[key]) continue;",
    "    process.env[key] = line.slice(at + 1).trim();",
    "  }",
    "}",
    `fs.writeFileSync(${JSON.stringify(join(root, "server-boot.json"))}, JSON.stringify({ cwd: process.cwd(), clients: process.env.DESKTOP_AUTH_CLIENTS ?? "", id: process.env.DESKTOP_AUTH_CLIENT_ID ?? "", uris: process.env.DESKTOP_AUTH_REDIRECT_URIS ?? "", livekit: process.env.LIVEKIT_URL ?? "", previewTtl: process.env.PREVIEW_ASSET_TTL ?? "" }));`,
    'if ((process.env.DESKTOP_AUTH_CLIENTS ?? "").trim() && (process.env.DESKTOP_AUTH_CLIENT_ID || process.env.DESKTOP_AUTH_REDIRECT_URIS)) {',
    "  console.error('ERR config component=server err=\"set either DESKTOP_AUTH_CLIENTS or DESKTOP_AUTH_CLIENT_ID/DESKTOP_AUTH_REDIRECT_URIS, not both\"');",
    "  process.exit(1);",
    "}",
    `fs.writeFileSync(${JSON.stringify(readyFile)}, "ok");`,
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n");
}

/**
 * A fake checkout for the bash-level tests: the real start.sh and lib.mjs, a
 * `node_modules` marker so the precondition passes, a `.env`, and stub tools on
 * PATH (`go`, `pnpm`, `curl`, `git`, `ldconfig`, `xvfb-run`) so the whole script
 * runs to "up" without a database, a network or a real fork build. The stubs
 * follow start.sh's contract (curl answers every probe, `go build` leaves a file
 * on the path start.sh execs, pnpm/electron sleep) — this is the "dry-run with a
 * fake server/web" the fix asks for, not a stand-in for the real stack.
 */
function mkFakeStack({ lib, forkTree = "installed", npmExit = 0, network = true, libsSigpipe = false, loaderServer = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "harness-start-"));
  const bin = join(root, "bin");
  const harness = join(root, "scripts", "office", "g5g6g7", "harness");
  const runDir = join(root, "run");
  const cacheDir = join(root, "cache");
  const forkDir = join(cacheDir, "uniwork-office-0d03b18");
  const shellDir = join(forkDir, "apps", "shell");
  const electronDir = join(shellDir, "node_modules", "electron");
  for (const dir of [bin, harness, join(root, "node_modules"), join(root, "server", "cmd", "server"), join(root, "server", "cmd", "migrate"), join(forkDir, ".git"), join(forkDir, "node_modules", ".bin"), join(forkDir, "node_modules", "electron", "dist"), join(shellDir, "out", "main"), electronDir]) {
    mkdirSync(dir, { recursive: true });
  }
  copyFileSync(START_SH, join(harness, "start.sh"));
  if (lib) writeFileSync(join(harness, "lib.mjs"), lib);
  else copyFileSync(LIB, join(harness, "lib.mjs"));

  const shim = (name, body) => {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  };
  // `loaderServer` swaps the empty stub server for one that runs the real
  // server's boot order: the .env loader (envfile.go), then the DESKTOP_AUTH
  // check (config.go) — see LOADER_SERVER below. Its /healthz answers only once
  // it got through that, so a server that dies at boot is seen as dead.
  const readyFile = join(root, "server-ready");
  const serverSource = join(root, "fake-server.cjs");
  if (loaderServer) writeFileSync(serverSource, LOADER_SERVER(root, readyFile));
  shim("go", `#!/usr/bin/env bash\nif [ "$1" = build ]; then mkdir -p bin && ${loaderServer ? `cp ${JSON.stringify(serverSource)} bin/harness-server` : ": > bin/harness-server"} && chmod +x bin/harness-server; exit 0; fi\nexit 0\n`);
  // The harness puts nvm's Node 22 first on PATH; the fake nvm hands it this
  // bin dir, so the stubs below keep winning and the test never depends on the
  // host's nvm. `node` here is the real Node (the harness must keep running).
  shim("node", `#!/usr/bin/env bash\nexec ${process.execPath} "$@"\n`);
  shim("pnpm", "#!/usr/bin/env bash\nsleep 600\n");
  // The network probe is `curl ... <fork>/info/refs`; the app's own probes are
  // `curl -sf -o /dev/null <url>`. `network:false` fails only the former.
  shim("curl", network
    ? (loaderServer
      ? `#!/usr/bin/env bash\nfor a in "$@"; do case "$a" in */healthz) [ -f ${JSON.stringify(readyFile)} ] || exit 7 ;; esac; done\nexit 0\n`
      : "#!/usr/bin/env bash\nexit 0\n")
    : "#!/usr/bin/env bash\nfor a in \"$@\"; do case \"$a\" in */info/refs*) exit 7 ;; esac; done\nexit 0\n");
  // The default stub lists the five libraries at once. `libsSigpipe` mimics the
  // real `ldconfig -p` (hundreds of lines): it names the five first and then
  // writes far more than a pipe buffer, so a reader that exits at the first
  // match (`grep -q`) leaves it writing into a closed pipe and it dies of
  // SIGPIPE (141). start.sh must not read ldconfig that way (reviewer_be r2 N3).
  if (libsSigpipe) {
    shim("ldconfig", [
      "#!/usr/bin/env bash",
      "printf 'libnss3.so\\nlibatk-1.0.so.0\\nlibgbm.so.1\\nlibasound.so.2\\nlibcups.so.2\\n'",
      "# an external writer: it dies of SIGPIPE when the reader exits early, the",
      "# way the real ldconfig does (a bash builtin would swallow EPIPE instead)",
      "seq 1 100000",
      "",
    ].join("\n"));
  } else {
    shim("ldconfig", "#!/usr/bin/env bash\nprintf 'libnss3.so\\nlibatk-1.0.so.0\\nlibgbm.so.1\nlibasound.so.2\nlibcups.so.2\n'\n");
  }
  shim("git", "#!/usr/bin/env bash\ncase \"$1\" in rev-parse) echo 1111111111111111111111111111111111111111; exit 0 ;; esac\nexit 0\n");
  shim("xvfb-run", "#!/usr/bin/env bash\nwhile [ \"$#\" -gt 0 ]; do case \"$1\" in --*) shift ;; --*=*) shift ;; *) break ;; esac; done\nexport DISPLAY=:99\nexec \"$@\"\n");
  shim("fake-electron", "#!/usr/bin/env bash\nsleep 600\n");
  // Records its argv (the install strategy is asserted from it) and answers with
  // npmExit, so a failing install is exercised without a real npm. `ci
  // --ignore-scripts` on a clean tree leaves the two things start.sh then probes
  // (electron's install.js and a working esbuild), which is what a real run does.
  shim("npm", [
    "#!/usr/bin/env bash",
    `printf '%s\\n' "$*" >> "${join(root, "npm-argv")}"`,
    "echo \"npm stub: $*\"",
    `if [ "${npmExit}" = 0 ] && [ "$1" = ci ]; then`,
    `  mkdir -p "${join(forkDir, "node_modules", "electron", "dist")}" "${join(forkDir, "node_modules", ".bin")}"`,
    `  : > "${join(forkDir, "node_modules", "electron", "install.js")}"`,
    `  printf 'electron\\n' > "${join(forkDir, "node_modules", "electron", "path.txt")}"`,
    `  : > "${join(forkDir, "node_modules", "electron", "dist", "electron")}"`,
    `  chmod +x "${join(forkDir, "node_modules", "electron", "dist", "electron")}"`,
    `  printf '#!/usr/bin/env bash\\necho 0.25.12\\n' > "${join(forkDir, "node_modules", ".bin", "esbuild")}"`,
    `  chmod +x "${join(forkDir, "node_modules", ".bin", "esbuild")}"`,
    "fi",
    `exit ${npmExit}`,
    "",
  ].join("\n"));

  // The fork looks built, so the slow build:all never runs.
  writeFileSync(join(forkDir, ".harness-built"), "0d03b18\n");
  writeFileSync(join(shellDir, "out", "main", "index.js"), "// built\n");
  writeFileSync(join(electronDir, "package.json"), '{"name":"electron","version":"0.0.0","main":"index.js"}\n');
  writeFileSync(join(electronDir, "index.js"), `module.exports = ${JSON.stringify(join(bin, "fake-electron"))};\n`);

  if (forkTree === "installed") {
    // What `npm ci --ignore-scripts` + the binary fetch leave behind, as
    // start.sh's fork_tree_ready / binary probes see it.
    writeFileSync(join(forkDir, "node_modules", "electron", "install.js"), "// electron install.js\n");
    writeFileSync(join(forkDir, "node_modules", "electron", "path.txt"), "electron\n");
    mkdirSync(join(forkDir, "node_modules", "electron", "dist"), { recursive: true });
    writeFileSync(join(forkDir, "node_modules", "electron", "dist", "electron"), "");
    chmodSync(join(forkDir, "node_modules", "electron", "dist", "electron"), 0o755);
    writeFileSync(join(forkDir, "node_modules", ".bin", "esbuild"), "#!/usr/bin/env bash\necho 0.25.12\n");
    chmodSync(join(forkDir, "node_modules", ".bin", "esbuild"), 0o755);
  }
  // The app resolves electron from apps/shell/node_modules; its binary is what
  // `require("electron")` prints, so it exists whenever the app may start.
  if (forkTree === "installed" || npmExit === 0) {
    writeFileSync(join(electronDir, "path.txt"), "electron\n");
    mkdirSync(join(electronDir, "dist"), { recursive: true });
    writeFileSync(join(electronDir, "dist", "electron"), "");
    chmodSync(join(electronDir, "dist", "electron"), 0o755);
  }

  const envFile = join(root, "env");
  // The VM's .env, as the cloud runner writes it from .env.example: the
  // single-client pair, a LiveKit URL, and a setting the server REQUIRES and the
  // run does not set (PREVIEW_ASSET_TTL). The harness sources it (ENV_FILE) and
  // the real server reads the same file from the checkout root.
  const dotenv = "DATABASE_URL=postgres://u:p@localhost:5432/db?sslmode=disable\nREDIS_URL=redis://localhost:6379/0\nDESKTOP_AUTH_CLIENT_ID=uniwork-office\nDESKTOP_AUTH_REDIRECT_URIS=uniwork-office://auth/callback\nLIVEKIT_URL=ws://localhost:7880\nPREVIEW_ASSET_TTL=10m\n";
  writeFileSync(envFile, dotenv);
  writeFileSync(join(root, ".env"), dotenv);
  // A fake nvm: `nvm which 22` names the stub bin dir, so start.sh's nvm branch
  // is exercised and the stubs stay in front of PATH.
  const nvmDir = join(root, "nvm");
  mkdirSync(nvmDir, { recursive: true });
  writeFileSync(join(nvmDir, "nvm.sh"), `nvm() { case "$1" in which) echo "${bin}/node" ;; *) return 1 ;; esac; }\n`);
  return { root, bin, harness, runDir, cacheDir, envFile, nvmDir, npmArgv: join(root, "npm-argv") };
}

function runStart(stack, extraEnv = {}) {
  return spawnSync("bash", [join(stack.harness, "start.sh")], {
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...process.env,
      PATH: `${stack.bin}:${process.env.PATH}`,
      ENV_FILE: stack.envFile,
      HARNESS_RUN_DIR: stack.runDir,
      OFFICE_FORK_CACHE: stack.cacheDir,
      NVM_DIR: stack.nvmDir,
      ...extraEnv,
    },
  });
}

/** Kill the process groups a run recorded, so a test leaves no sleeping stubs. */
function stopFakeStack(stack) {
  const pidFile = join(stack.runDir, "pids");
  if (!existsSync(pidFile)) return;
  for (const line of readFileSync(pidFile, "utf8").split("\n")) {
    const pid = Number(line.trim().split(/\s+/)[1]);
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ }
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    }
  }
}

test("start.sh reaches up through the real lib.mjs fork-dir call (fake stack)", () => {
  const stack = mkFakeStack();
  try {
    const result = runStart(stack);
    assert.equal(result.status, 0, `start.sh exited ${result.status}\n${result.stdout}\n${result.stderr}`);
    // The r1 crash was here: the fork dir is resolved and the app starts.
    assert.match(result.stdout, /harness: up/);
    const forkDir = join(stack.cacheDir, "uniwork-office-0d03b18");
    assert.match(result.stdout, new RegExp(`fork\\s+${forkDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} @ 0d03b18`));
    assert.doesNotMatch(result.stderr, /usage: lib\.mjs/);

    // Every component logs under the run dir, so a cloud round can read the
    // failure from the logs alone.
    for (const name of ["server-build.log", "migrate.log", "server.log", "web.log", "app.log"]) {
      assert.ok(existsSync(join(stack.runDir, "logs", name)), `missing ${name}`);
    }

    // The document step needs the app's launch inputs in ports.env, not a
    // screenshot: the Electron binary, the app dir, the userData and the
    // deployment the server and the app must agree on.
    const ports = readFileSync(join(stack.runDir, "ports.env"), "utf8");
    for (const key of ["UNIWORK_USER_DATA", "ELECTRON_BIN", "SHELL_APP_DIR", "OFFICE_FORK_DIR", "HARNESS_DEPLOYMENT_ID"]) {
      assert.match(ports, new RegExp(`^${key}=`, "m"), `ports.env is missing ${key}`);
    }
    assert.match(ports, /^HARNESS_DEPLOYMENT_ID=default$/m);
  } finally {
    stopFakeStack(stack);
  }
});

test("the D server boots with exactly DESKTOP_AUTH_CLIENTS although the checkout's .env carries the single-client pair", () => {
  // Cloud round 4: start.sh exited 1, "set either DESKTOP_AUTH_CLIENTS or
  // DESKTOP_AUTH_CLIENT_ID/DESKTOP_AUTH_REDIRECT_URIS, not both". server.env
  // cleared the pair to "", but the server's own .env loader treats an empty
  // key as unset and refilled it from the checkout's .env. The fake server
  // below runs that loader (same lookups, same non-empty test) and the real
  // config check, so this fails on the old start.sh (cwd = the checkout).
  const stack = mkFakeStack({ loaderServer: true });
  try {
    const result = runStart(stack);
    assert.equal(result.status, 0, `start.sh exited ${result.status}\n${result.stdout}\n${result.stderr}`);
    const boot = JSON.parse(readFileSync(join(stack.root, "server-boot.json"), "utf8"));
    assert.match(boot.clients, new RegExp(`${DEV_CLIENT_ID}=${DEV_CLIENT_ID}://auth/callback`));
    assert.equal(boot.id, "", "the single-client id must still be empty after the .env loader ran");
    assert.equal(boot.uris, "", "the single-client redirect list must still be empty after the .env loader ran");
    assert.equal(boot.livekit, "", "the cleared LiveKit setting must not come back from the .env");
    assert.equal(boot.previewTtl, "10m", "a VM setting the run does not own must still reach the server");
    // it ran where no .env lookup reaches the checkout
    assert.equal(realpathSync(boot.cwd), realpathSync(harnessPaths(stack.runDir).serverCwd));
    assert.deepEqual(readStartStatus(stack.runDir), { state: "up", reason: "" });
  } finally {
    stopFakeStack(stack);
  }
});

test("the same server, started from the checkout the old way, dies of the round-4 config error", () => {
  // The negative control for the test above: this is what start.sh did before.
  const stack = mkFakeStack({ loaderServer: true });
  try {
    const bin = join(stack.root, "server", "bin");
    mkdirSync(bin, { recursive: true });
    copyFileSync(join(stack.root, "fake-server.cjs"), join(bin, "harness-server"));
    chmodSync(join(bin, "harness-server"), 0o755);
    const serverEnv = buildServerEnv({ apiPort: 1, webPort: 2, metricsPort: 3, previewPort: 4, databaseUrl: "postgres://x", redisUrl: "redis://y", uploadDir: "/tmp/u" });
    const old = spawnSync(join(bin, "harness-server"), [], { cwd: stack.root, env: { ...process.env, PATH: `${stack.bin}:${process.env.PATH}`, ...serverEnv }, encoding: "utf8", timeout: 20_000 });
    assert.equal(old.status, 1);
    assert.match(old.stderr, /not both/);
  } finally {
    stopFakeStack(stack);
  }
});

test("the server's cwd is three directories deep, so none of its .env lookups leaves the run dir", () => {
  const runDir = "/x/run";
  const cwd = serverCwd(runDir);
  assert.equal(harnessPaths(runDir).serverCwd, cwd);
  for (const lookup of SERVER_ENV_LOOKUPS) {
    const target = join(cwd, lookup);
    assert.ok(target.startsWith(`${runDir}/server-cwd/`) || target === `${runDir}/server-cwd/.env`, `${lookup} resolves to ${target}`);
  }
});

test("serverDotEnv drops the lines of the keys the run owns and keeps the rest", () => {
  const text = "# vm\nPORT=8080\nDESKTOP_AUTH_CLIENT_ID=uniwork-office\n DESKTOP_AUTH_REDIRECT_URIS = x\nPREVIEW_ASSET_TTL=10m\nbad line\n";
  assert.equal(serverDotEnv(text, ["PORT", "DESKTOP_AUTH_CLIENT_ID", "DESKTOP_AUTH_REDIRECT_URIS"]), "# vm\nPREVIEW_ASSET_TTL=10m\nbad line\n");
});

test("writeRunEnv leaves the server a .env without any key it owns, in a cwd of its own", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "harness-dotenv-"));
  const source = join(runDir, "vm.env");
  writeFileSync(source, "DESKTOP_AUTH_CLIENT_ID=uniwork-office\nLIVEKIT_URL=ws://x\nPORT=1\nPREVIEW_ASSET_TTL=10m\n");
  const previous = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL };
  process.env.DATABASE_URL = "postgres://x";
  process.env.REDIS_URL = "redis://y";
  try {
    await writeRunEnv(runDir, { dotenvPath: source });
    assert.equal(readFileSync(join(serverCwd(runDir), ".env"), "utf8"), "PREVIEW_ASSET_TTL=10m\n");
    for (const key of Object.keys(buildServerEnv({ apiPort: 1, webPort: 2, metricsPort: 3, previewPort: 4, databaseUrl: "d", redisUrl: "r", uploadDir: "/u" }))) {
      assert.doesNotMatch(readFileSync(join(serverCwd(runDir), ".env"), "utf8"), new RegExp(`^${key}=`, "m"));
    }
  } finally {
    if (previous.DATABASE_URL === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.DATABASE_URL;
    if (previous.REDIS_URL === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previous.REDIS_URL;
  }
});

test("a failed start is recorded as failed, a missing precondition as blocked", () => {
  const failing = mkFakeStack({ forkTree: "absent", npmExit: 7 });
  try {
    assert.equal(runStart(failing).status, 1);
    const status = readStartStatus(failing.runDir);
    assert.equal(status.state, "failed");
    assert.match(status.reason, /npm ci --ignore-scripts failed in the fork/);
  } finally {
    stopFakeStack(failing);
  }
  const noNetwork = mkFakeStack({ forkTree: "absent", network: false });
  try {
    assert.equal(runStart(noNetwork).status, 77);
    const status = readStartStatus(noNetwork.runDir);
    assert.equal(status.state, "blocked");
    assert.match(status.reason, /no network to /);
  } finally {
    stopFakeStack(noNetwork);
  }
});

test("a server that dies at boot leaves a failed start with its log tail, not an up one", () => {
  const stack = mkFakeStack({ loaderServer: true });
  try {
    // an env file that re-adds the pair AND a cwd that finds it: force the
    // conflict by making the fake server see the checkout's .env, which only
    // happens if the server is started from the run's own cwd with a .env in it
    mkdirSync(join(stack.runDir, "server-cwd", "a", "b", "c"), { recursive: true });
    writeFileSync(join(stack.runDir, "server-cwd", ".env"), "DESKTOP_AUTH_CLIENT_ID=planted\n");
    const result = runStart(stack);
    assert.equal(result.status, 1, `expected FAILED (1), got ${result.status}\n${result.stderr}`);
    assert.match(result.stderr, /FAILED: the D server died while starting/);
    assert.match(result.stderr, /not both/);
    const status = readStartStatus(stack.runDir);
    assert.equal(status.state, "failed");
  } finally {
    stopFakeStack(stack);
  }
});

test("startGate: only a start that reported BLOCKED may block a later step", () => {
  assert.equal(startGate(null).gate, "proceed");
  assert.equal(startGate({ state: "up" }).gate, "proceed");
  assert.equal(startGate({ state: "failed", reason: "x" }).gate, "fail");
  assert.match(startGate({ state: "failed", reason: "the D server died while starting" }).reason, /the D server died while starting/);
  assert.equal(startGate({ state: "starting" }).gate, "fail");
  assert.equal(startGate({ state: "blocked", reason: "no network" }).gate, "blocked");
  assert.equal(startGate({ state: "something-new" }).gate, "fail");
});

test("readStartStatus reads the file, and a torn one reads as failed", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-status-"));
  assert.equal(readStartStatus(dir), null);
  writeFileSync(harnessPaths(dir).startStatus, '{"state":"up","reason":""}\n');
  assert.equal(readStartStatus(dir).state, "up");
  writeFileSync(harnessPaths(dir).startStatus, '{"state":');
  assert.equal(readStartStatus(dir).state, "failed");
});

test("a present library is not reported missing when ldconfig writes past a pipe buffer", () => {
  // reviewer_be r2 N3: `ldconfig -p 2>/dev/null | grep -q "$lib"` under
  // `set -o pipefail` reports a PRESENT library as missing — grep -q exits at
  // the first match, ldconfig takes SIGPIPE (141), and 141 is the pipeline's
  // status, so start.sh went BLOCKED (77) on a host where the libraries are
  // there. The stub writes the five names first and then far more than a pipe
  // buffer, so a first-match reader is guaranteed to leave it writing.
  const stack = mkFakeStack({ libsSigpipe: true });
  try {
    const result = runStart(stack);
    assert.equal(result.status, 0, `start.sh exited ${result.status} (expected 0; a present library must not read as missing)\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /harness: up/);
    // The "libraries are missing" notice is start.sh's own stdout line; on the
    // old pipeline it appeared even though the stub lists all five libraries.
    assert.doesNotMatch(result.stdout, /the Electron runtime libraries are missing/);
  } finally {
    stopFakeStack(stack);
  }
});

// ---- the fork install (r3): the runner's way, and FAIL vs BLOCKED -------------
// The r2 cloud round died inside `npm ci`: the fork's root `postinstall:
// install-electron` downloaded a 123 MiB GitHub release during the install and a
// 504 from the release host took the whole `npm ci` down, reported as BLOCKED.
// The fix installs the way the runner does (install-office.sh:15 + run-tests.sh)
// — no scripts during `npm ci`, the Electron binary fetched by its own install.js
// afterwards — and a step that fails while the VM is fine is a FAIL, not BLOCKED.

function npmArgv(stack) {
  return existsSync(stack.npmArgv) ? readFileSync(stack.npmArgv, "utf8").trim().split("\n").filter(Boolean) : [];
}

test("start.sh installs the fork with npm ci --ignore-scripts, never a bare npm ci", () => {
  const stack = mkFakeStack({ forkTree: "absent" });
  try {
    const result = runStart(stack);
    assert.equal(result.status, 0, `start.sh exited ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /harness: up/);
    const installs = npmArgv(stack).filter((line) => line.startsWith("ci"));
    assert.equal(installs.length, 1, `expected exactly one npm ci, saw ${JSON.stringify(npmArgv(stack))}`);
    // No lifecycle script may run during `npm ci`: electron 43 ignores the
    // ELECTRON_SKIP_BINARY_DOWNLOAD flag that made the postinstall harmless
    // through 42.x, so the flag alone no longer keeps the 123 MiB download out
    // of the install (and out of its failure path).
    assert.match(installs[0], /--ignore-scripts/);
  } finally {
    stopFakeStack(stack);
  }
});

test("start.sh does not install a fork whose tree is already complete", () => {
  const stack = mkFakeStack();
  try {
    const result = runStart(stack);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(npmArgv(stack).length, 0, `npm was called: ${JSON.stringify(npmArgv(stack))}`);
  } finally {
    stopFakeStack(stack);
  }
});

test("a failing fork install is a FAIL with the log tail, not BLOCKED", () => {
  const stack = mkFakeStack({ forkTree: "absent", npmExit: 7 });
  try {
    const result = runStart(stack);
    assert.equal(result.status, 1, `expected FAILED (1), got ${result.status}\n${result.stderr}`);
    assert.match(result.stderr, /FAILED: npm ci --ignore-scripts failed in the fork/);
    assert.match(result.stderr, /last 60 lines of the fork install/);
    assert.doesNotMatch(result.stderr, /BLOCKED:/);
  } finally {
    stopFakeStack(stack);
  }
});

test("a missing network for the fork is BLOCKED, not FAILED", () => {
  const stack = mkFakeStack({ forkTree: "absent", network: false });
  try {
    const result = runStart(stack);
    assert.equal(result.status, 77, `expected BLOCKED (77), got ${result.status}\n${result.stderr}`);
    assert.match(result.stderr, /BLOCKED: no network to /);
    assert.equal(npmArgv(stack).length, 0, "the install must not be attempted without network");
  } finally {
    stopFakeStack(stack);
  }
});

test("start.sh names the failing step and its args when lib.mjs errors", () => {
  // A lib.mjs that answers --write and fails only on --fork-dir: the step after
  // the web, exactly where r1 died, so the reporting is exercised where it matters.
  const stub = [
    'import { writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    "const args = process.argv.slice(2);",
    'if (args[0] === "--write") {',
    "  writeFileSync(join(args[1], \"ports.env\"), \"API_PORT=1\\nWEB_PORT=2\\nMETRICS_PORT=3\\nPREVIEW_PORT=4\\nAPI_ORIGIN=http://127.0.0.1:1\\nWEB_ORIGIN=http://127.0.0.1:2\\n\");",
    "  writeFileSync(join(args[1], \"server.env\"), \"\");",
    '  process.stdout.write("{}\\n");',
    "  process.exit(0);",
    "}",
    'if (args[0] === "--fork-dir") { console.error("stub: fork dir lookup exploded"); process.exit(3); }',
    "process.exit(2);",
    "",
  ].join("\n");
  const stack = mkFakeStack({ lib: stub });
  try {
    const result = runStart(stack);
    assert.equal(result.status, 1, `expected a FAILED exit, got ${result.status}\n${result.stderr}`);
    assert.match(result.stderr, /step 'resolve the fork cache dir' failed \(exit 3\)/);
    assert.match(result.stderr, /command: node .*lib\.mjs --fork-dir .* 0d03b18/);
    assert.match(result.stderr, /stub: fork dir lookup exploded/);
    assert.match(result.stderr, /FAILED: could not resolve the fork cache dir for 0d03b18/);
    // And the component logs are dumped, so the round has something to read.
    assert.match(result.stderr, /component log tails/);
    assert.match(result.stderr, /---- tail -\d+ server\.log ----/);
  } finally {
    stopFakeStack(stack);
  }
});

// ---- the document step (priority 2): the app opens a fixture document --------
// A fake D server (the seven endpoints the step seeds through) and a fake
// Electron that records the deep link it was handed and leaves the working copy
// the step reads. The real document-step.mjs runs against them, so its seeding,
// its deep-link delivery and its decision from binding.json are all exercised
// without a stack.

/** A fake D server for the document step; resolves with its origin and a stop(). */
function mkFakeDocumentServer({ mintLink = true, devices = [], devicesAfterPolls = 0, loginPassword = "" } = {}) {
  return new Promise((resolveServer) => {
    const calls = [];
    let devicePolls = 0;
    const server = createHttpServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const send = (code, body) => {
          res.writeHead(code, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        const url = new URL(req.url, "http://127.0.0.1");
        calls.push(url.pathname);
        if (url.pathname === "/healthz") return send(200, { status: "ok" });
        if (url.pathname === "/api/v1/auth/login") {
          const sent = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
          return sent.password === loginPassword ? send(200, { access_token: "tok", user: { id: "u1" } }) : send(401, { error: "invalid_credentials" });
        }
        if (url.pathname === "/api/v1/auth/desktop/devices") {
          devicePolls += 1;
          return send(200, { devices: devicePolls > devicesAfterPolls ? devices : [], next_cursor: null });
        }
        if (url.pathname === "/api/v1/auth/register") return send(201, { access_token: "tok", user: { id: "u1" } });
        if (url.pathname === "/api/v1/me/email/verify") return send(200, { user: { id: "u1" } });
        if (url.pathname === "/api/v1/orgs") return send(201, { organization: { id: "o1", slug: "o1" } });
        if (/^\/api\/v1\/orgs\/[^/]+\/workspaces$/.test(url.pathname)) return send(201, { workspace: { id: "w1" } });
        if (/^\/api\/v1\/workspaces\/[^/]+\/documents\/files$/.test(url.pathname)) return send(201, { document: { id: "doc_fixture" } });
        if (/^\/api\/v1\/documents\/[^/]+\/office\/sessions$/.test(url.pathname)) {
          if (!mintLink) return send(500, { error: "no_launch" });
          return send(201, { launch_ticket: "ticket_abc", launch_url: "uniwork-office-dev://open?ticket=ticket_abc", document_id: "doc_fixture" });
        }
        return send(404, { error: "not_found" });
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolveServer({ origin: `http://127.0.0.1:${port}`, calls, stop: () => new Promise((r) => server.close(r)) });
    });
  });
}

/**
 * A run dir with a ports.env the document step reads, and a fake Electron binary
 * that writes the app's working copy when it is handed the deep link. `recordLink`
 * receives the URL; `openDocumentId` is what the binding will name.
 */
function mkDocumentRun({ origin, electronBody, session = false }) {
  const runDir = mkdtempSync(join(tmpdir(), "harness-doc-"));
  const userData = join(runDir, "userdata");
  mkdirSync(join(userData, "uniwork-auth"), { recursive: true });
  // the app's own record of a desktop session; no file = no session (the
  // precondition that decides BLOCKED vs FAIL in documentStepOutcome)
  if (session) writeFileSync(join(userData, "uniwork-auth", "session.bin"), "encrypted");
  const bin = join(runDir, "electron-bin");
  writeFileSync(bin, electronBody);
  chmodSync(bin, 0o755);
  writeFileSync(
    join(runDir, "ports.env"),
    [
      `API_ORIGIN=${origin}`,
      `WEB_ORIGIN=${origin}`,
      `OFFICE_FORK_SHA=0d03b18`,
      `DISPLAY=:99`,
      `UNIWORK_USER_DATA=${userData}`,
      `ELECTRON_BIN=${bin}`,
      `SHELL_APP_DIR=/fake/shell`,
      `OFFICE_FORK_DIR=/fake/fork`,
      `HARNESS_DEPLOYMENT_ID=default`,
      "",
    ].join("\n"),
  );
  return { runDir, userData, bin };
}

/** A fake Electron that writes a working copy naming `documentId` when handed a link. */
function electronWriting(documentId, linkFile) {
  return [
    "#!/usr/bin/env bash",
    "# last arg is the deep link; record it and leave the app's working copy",
    `url="\${!#}"`,
    `printf '%s\\n' "$url" >> ${JSON.stringify(linkFile)}`,
    `dir="$GENOFFICE_USER_DATA/uniwork-documents/default/u1/${documentId}"`,
    'mkdir -p "$dir"',
    `printf '{"schema":1,"documentId":"${documentId}","workspaceId":"w1","orgId":"o1","title":"t","filename":"f.md","format":"md","access":"edit","baseRevision":"1","baseVersion":1,"baseChecksum":"","state":"ready"}\\n' > "$dir/binding.json"`,
    "exit 0",
    "",
  ].join("\n");
}

const DOC_STEP = join(HERE, "document-step.mjs");

/**
 * Runs document-step as a child and waits for it WITHOUT blocking this process's
 * event loop — the fake server above lives in this process, so `spawnSync` (which
 * blocks the loop) would deadlock the child's request against an unanswered
 * server.
 */
function runDocumentStep(args, extraEnv = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [DOC_STEP, ...args], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolveRun({ status, stdout, stderr });
    });
  });
}

test("document-step PASSes when the app leaves a working copy for the fixture document", async () => {
  const server = await mkFakeDocumentServer();
  const linkFile = join(mkdtempSync(join(tmpdir(), "harness-link-")), "links");
  const run = mkDocumentRun({ origin: server.origin, electronBody: electronWriting("doc_fixture", linkFile), session: true });
  try {
    const result = await runDocumentStep(["--run-dir", run.runDir, "--req", "G7-A01", "--fixture", "fx-docx-report-vi"]);
    assert.equal(result.status, 0, `document-step exited ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /document step: PASS/);
    // the deep link the app was handed is the dev-channel one the server minted
    assert.equal(readFileSync(linkFile, "utf8").trim(), "uniwork-office-dev://open?ticket=ticket_abc");
    // and the ledger line it wrote carries a real argv, never an empty one
    const lines = readFileSync(join(run.runDir, "evidence.jsonl"), "utf8").trim().split("\n");
    const line = JSON.parse(lines.at(-1));
    assert.equal(line.result, "PASS");
    assert.equal(line.requirementId, "G7-A01");
    assert.equal(line.fixtureId, "fx-docx-report-vi");
    assert.ok(Array.isArray(line.argv) && line.argv.length > 0, "argv must not be empty");
    assert.ok(existsSync(join(run.runDir, "document-step.json")));
  } finally {
    await server.stop();
  }
});

test("document-step is BLOCKED when the app has no desktop session and left no working copy", async () => {
  const server = await mkFakeDocumentServer();
  const linkFile = join(mkdtempSync(join(tmpdir(), "harness-link-")), "links");
  // an Electron that records the link but writes nothing: no session, no copy
  const run = mkDocumentRun({ origin: server.origin, electronBody: `#!/usr/bin/env bash\nprintf '%s\\n' "\${!#}" >> ${JSON.stringify(linkFile)}\nexit 0\n` });
  try {
    // no session.bin: the app had nothing to redeem with
    rmSync(join(run.userData, "uniwork-auth", "session.bin"), { force: true });
    const result = await runDocumentStep(["--run-dir", run.runDir, "--req", "G7-A01", "--fixture", "fx-docx-report-vi"]);
    assert.equal(result.status, 77, `expected BLOCKED (77), got ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /document step: BLOCKED/);
  } finally {
    await server.stop();
  }
});

test("document-step FAILs when a signed-in app is handed the link and does not open it", async () => {
  const server = await mkFakeDocumentServer();
  const linkFile = join(mkdtempSync(join(tmpdir(), "harness-link-")), "links");
  const run = mkDocumentRun({ origin: server.origin, electronBody: `#!/usr/bin/env bash\nprintf '%s\\n' "\${!#}" >> ${JSON.stringify(linkFile)}\nexit 0\n`, session: true });
  try {
    // a session exists (the step's precondition), yet no working copy appears
    const result = await runDocumentStep(["--run-dir", run.runDir, "--req", "G7-A01", "--fixture", "fx-docx-report-vi"], { HARNESS_DOC_WAIT_MS: "2000" });
    assert.equal(result.status, 1, `expected FAIL (1), got ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /document step: FAIL/);
  } finally {
    await server.stop();
  }
});

// ---- a failed start fails the steps after it (cloud round 4) ------------------
// start.sh exited 1 and both later steps recorded BLOCKED ("command reported
// skip"), which reads as "the VM cannot do it". Only a start that itself
// reported a missing precondition may block them.

const SAMPLE_AC = join(HERE, "sample-ac.mjs");

function stepAfterStart(script, state, reason) {
  const run = mkDocumentRun({ origin: "http://127.0.0.1:1", electronBody: "#!/usr/bin/env bash\nexit 0\n", session: true });
  writeFileSync(harnessPaths(run.runDir).startStatus, `${JSON.stringify({ state, reason })}\n`);
  const result = spawnSync(process.execPath, [script, "--run-dir", run.runDir], { encoding: "utf8", timeout: 60_000, env: { ...process.env, OFFICE_EVIDENCE_ID: "" } });
  const ledger = join(run.runDir, "evidence.jsonl");
  const line = existsSync(ledger) ? JSON.parse(readFileSync(ledger, "utf8").trim().split("\n").at(-1)) : null;
  return { result, line };
}

for (const [name, script] of [["sample-ac", SAMPLE_AC], ["document-step", DOC_STEP]]) {
  test(`${name} FAILs (exit 1), not BLOCKED, after a start that failed`, () => {
    const { result, line } = stepAfterStart(script, "failed", "the D server died while starting");
    assert.equal(result.status, 1, `expected FAIL (1), got ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /FAILED: start\.sh failed: the D server died while starting/);
    assert.doesNotMatch(result.stderr, /BLOCKED/);
    assert.equal(line.result, "FAIL");
    assert.equal(line.exitCode, 1);
    assert.equal(line.blocker, "");
  });

  test(`${name} FAILs when start.sh never finished`, () => {
    const { result, line } = stepAfterStart(script, "starting", "");
    assert.equal(result.status, 1);
    assert.equal(line.result, "FAIL");
  });

  test(`${name} is BLOCKED only with the reason start.sh recorded`, () => {
    const { result, line } = stepAfterStart(script, "blocked", "no network to the fork");
    assert.equal(result.status, 77);
    assert.match(result.stderr, /BLOCKED: start\.sh reported BLOCKED: no network to the fork/);
    assert.equal(line.result, "BLOCKED");
    assert.match(line.blocker, /no network to the fork/);
  });
}

// ---- desktop mode: reuse an account, wait for its sign-in ---------------------

const LIVE_DEVICE = { id: "d1", client_id: DEV_CLIENT_ID, deployment_id: "default", expires_at: "2999-01-01T00:00:00Z", revoked_at: null };
const REUSED = { HARNESS_DOC_EMAIL: "advisor@example.com", HARNESS_DOC_PASSWORD: "s3cret-Pass-Word" };

/** Everything a run left that could carry a secret: stdout, stderr, the report and the ledger. */
function everythingWritten(run, result) {
  const files = ["document-step.json", "evidence.jsonl"].map((name) => (existsSync(join(run.runDir, name)) ? readFileSync(join(run.runDir, name), "utf8") : ""));
  return [result.stdout, result.stderr, ...files].join("\n");
}

test("parseWaitSignin reads the flag, with or without a number", () => {
  assert.equal(parseWaitSignin(["node", "x"]), null);
  assert.equal(parseWaitSignin(["--wait-signin"]), 300);
  assert.equal(parseWaitSignin(["--wait-signin", "45", "--run-dir", "r"]), 45);
  assert.equal(parseWaitSignin(["--wait-signin", "--run-dir", "r"]), 300);
  assert.equal(parseWaitSignin(["--wait-signin", "0"]), 300);
});

test("activeDesktopDevice wants the dev client, this deployment, not revoked, not expired", () => {
  const ask = { clientId: DEV_CLIENT_ID, deploymentId: "default", now: Date.parse("2026-10-12T00:00:00Z") };
  assert.equal(activeDesktopDevice([LIVE_DEVICE], ask)?.id, "d1");
  assert.equal(activeDesktopDevice([{ ...LIVE_DEVICE, client_id: "uniwork-office" }], ask), null);
  assert.equal(activeDesktopDevice([{ ...LIVE_DEVICE, deployment_id: "other" }], ask), null);
  assert.equal(activeDesktopDevice([{ ...LIVE_DEVICE, revoked_at: "2026-10-11T00:00:00Z" }], ask), null);
  assert.equal(activeDesktopDevice([{ ...LIVE_DEVICE, expires_at: "2026-10-01T00:00:00Z" }], ask), null);
  assert.equal(activeDesktopDevice(undefined, ask), null);
});

test("document-step reuses an account from the environment and writes no secret anywhere", async () => {
  const server = await mkFakeDocumentServer({ devices: [LIVE_DEVICE], loginPassword: REUSED.HARNESS_DOC_PASSWORD });
  const linkFile = join(mkdtempSync(join(tmpdir(), "harness-link-")), "links");
  const run = mkDocumentRun({ origin: server.origin, electronBody: electronWriting("doc_fixture", linkFile), session: true });
  try {
    const result = await runDocumentStep(["--run-dir", run.runDir, "--req", "G7-A01", "--fixture", "fx-docx-report-vi"], REUSED);
    assert.equal(result.status, 0, `document-step exited ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert.ok(server.calls.includes("/api/v1/auth/login"));
    assert.ok(!server.calls.includes("/api/v1/auth/register"), "a reused account must not be seeded");
    const written = everythingWritten(run, result);
    for (const secret of [REUSED.HARNESS_DOC_PASSWORD, "ticket_abc"]) assert.ok(!written.includes(secret), `${secret} leaked into the output or the evidence`);
    assert.ok(!/"tok"|bearer/i.test(written), "no token in the output or the evidence");
  } finally {
    await server.stop();
  }
});

test("document-step is BLOCKED, and delivers nothing, when the reused account has no desktop session", async () => {
  const server = await mkFakeDocumentServer({ devices: [], loginPassword: REUSED.HARNESS_DOC_PASSWORD });
  const linkFile = join(mkdtempSync(join(tmpdir(), "harness-link-")), "links");
  const run = mkDocumentRun({ origin: server.origin, electronBody: electronWriting("doc_fixture", linkFile), session: true });
  try {
    const result = await runDocumentStep(["--run-dir", run.runDir, "--req", "G7-A01", "--fixture", "fx-docx-report-vi"], REUSED);
    assert.equal(result.status, 77, `expected BLOCKED (77), got ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /no live uniwork-office-dev desktop session for advisor@example\.com/);
    assert.match(result.stderr, /--wait-signin/);
    assert.ok(!existsSync(linkFile), "no link may be delivered to an app that is not signed in as the account");
    assert.ok(!server.calls.some((path) => path.endsWith("/office/sessions")), "no ticket may be minted");
    assert.ok(!everythingWritten(run, result).includes(REUSED.HARNESS_DOC_PASSWORD));
  } finally {
    await server.stop();
  }
});

test("--wait-signin prints the steps, waits for the sign-in, then opens the document", async () => {
  // the account is signed out for the first two polls, then the app signs in
  const server = await mkFakeDocumentServer({ devices: [LIVE_DEVICE], devicesAfterPolls: 2, loginPassword: REUSED.HARNESS_DOC_PASSWORD });
  const linkFile = join(mkdtempSync(join(tmpdir(), "harness-link-")), "links");
  const run = mkDocumentRun({ origin: server.origin, electronBody: electronWriting("doc_fixture", linkFile), session: true });
  try {
    const result = await runDocumentStep(["--run-dir", run.runDir, "--req", "G7-A01", "--fixture", "fx-docx-report-vi", "--wait-signin", "30"], REUSED);
    assert.equal(result.status, 0, `document-step exited ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /waiting up to 30s for a desktop sign-in as advisor@example\.com/);
    assert.match(result.stdout, /Sign in/);
    assert.match(result.stdout, /document step: PASS/);
    assert.ok(!everythingWritten(run, result).includes(REUSED.HARNESS_DOC_PASSWORD));
  } finally {
    await server.stop();
  }
});

test("--wait-signin that never sees a sign-in is BLOCKED with the wait in the reason", async () => {
  const server = await mkFakeDocumentServer({ devices: [], loginPassword: REUSED.HARNESS_DOC_PASSWORD });
  const run = mkDocumentRun({ origin: server.origin, electronBody: "#!/usr/bin/env bash\nexit 0\n", session: true });
  try {
    const result = await runDocumentStep(["--run-dir", run.runDir, "--wait-signin", "2"], REUSED);
    assert.equal(result.status, 77);
    assert.match(result.stderr, /within 2s/);
  } finally {
    await server.stop();
  }
});

test("--wait-signin with a seeded account keeps its random password in a 0600 file, never in the output", async () => {
  const server = await mkFakeDocumentServer({ devices: [LIVE_DEVICE] });
  const linkFile = join(mkdtempSync(join(tmpdir(), "harness-link-")), "links");
  const run = mkDocumentRun({ origin: server.origin, electronBody: electronWriting("doc_fixture", linkFile), session: true });
  try {
    const result = await runDocumentStep(["--run-dir", run.runDir, "--wait-signin", "20"]);
    assert.equal(result.status, 0, `document-step exited ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert.ok(server.calls.includes("/api/v1/auth/register"), "no account given: one is seeded");
    const file = harnessPaths(run.runDir).docUser;
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const { email, password } = JSON.parse(readFileSync(file, "utf8"));
    assert.match(email, /^g7-01-harness-\d+@example\.com$/);
    assert.ok(password.length >= 16 && password !== "password123", "a waited sign-in gets its own random password");
    assert.match(result.stdout, new RegExp(`as ${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.ok(result.stdout.includes(file), "the output points at the credentials file");
    assert.ok(!everythingWritten(run, result).includes(password), "the seeded password stays out of the output and the evidence");
  } finally {
    await server.stop();
  }
});

test("the unattended cloud run seeds with no sign-in check and no credentials file", async () => {
  const server = await mkFakeDocumentServer();
  const linkFile = join(mkdtempSync(join(tmpdir(), "harness-link-")), "links");
  const run = mkDocumentRun({ origin: server.origin, electronBody: `#!/usr/bin/env bash\nprintf '%s\\n' "\${!#}" >> ${JSON.stringify(linkFile)}\nexit 0\n` });
  try {
    rmSync(join(run.userData, "uniwork-auth", "session.bin"), { force: true });
    const result = await runDocumentStep(["--run-dir", run.runDir]);
    assert.equal(result.status, 77);
    assert.ok(!server.calls.includes("/api/v1/auth/desktop/devices"), "the cloud run does not poll for a sign-in");
    assert.ok(!existsSync(harnessPaths(run.runDir).docUser));
  } finally {
    await server.stop();
  }
});

test("an email without a password (or the reverse) is a usage error, not a guess", async () => {
  const run = mkDocumentRun({ origin: "http://127.0.0.1:1", electronBody: "#!/usr/bin/env bash\nexit 0\n" });
  const result = await runDocumentStep(["--run-dir", run.runDir], { HARNESS_DOC_EMAIL: "a@example.com", HARNESS_DOC_PASSWORD: "" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /go together/);
});

test("a wrong password for a reused account is a FAIL", async () => {
  const server = await mkFakeDocumentServer({ devices: [LIVE_DEVICE], loginPassword: "something-else" });
  const run = mkDocumentRun({ origin: server.origin, electronBody: "#!/usr/bin/env bash\nexit 0\n", session: true });
  try {
    const result = await runDocumentStep(["--run-dir", run.runDir], { ...REUSED, HARNESS_DOC_WAIT_MS: "500" });
    assert.equal(result.status, 1, `expected FAIL (1), got ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert.ok(!everythingWritten(run, result).includes(REUSED.HARNESS_DOC_PASSWORD));
  } finally {
    await server.stop();
  }
});
