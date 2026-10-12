// Pure-helper tests for the G7-01 app harness (UNI-1376, item C). The stack
// itself only runs on the cloud VM; what is cheap and worth pinning here is the
// part that decides where a run points: fresh ports and the environment handed
// to the server, the web and the app.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BLOCKED_EXIT, DEFAULT_FORK_SHA, DEV_CLIENT_ID, HARNESS_DEPLOYMENT_ID, buildServerEnv, evidenceLine, forkCacheDir, freePorts, harnessPaths, isMainModule, officeDeepLink, origin, workingCopyDir, writeRunEnv } from "./lib.mjs";

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
 * A fake checkout for the bash-level tests: the real start.sh and lib.mjs, a
 * `node_modules` marker so the precondition passes, a `.env`, and stub tools on
 * PATH (`go`, `pnpm`, `curl`, `git`, `ldconfig`, `xvfb-run`) so the whole script
 * runs to "up" without a database, a network or a real fork build. The stubs
 * follow start.sh's contract (curl answers every probe, `go build` leaves a file
 * on the path start.sh execs, pnpm/electron sleep) — this is the "dry-run with a
 * fake server/web" the fix asks for, not a stand-in for the real stack.
 */
function mkFakeStack({ lib, forkTree = "installed", npmExit = 0, network = true } = {}) {
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
  shim("go", "#!/usr/bin/env bash\nif [ \"$1\" = build ]; then mkdir -p bin && : > bin/harness-server && chmod +x bin/harness-server; exit 0; fi\nexit 0\n");
  // The harness puts nvm's Node 22 first on PATH; the fake nvm hands it this
  // bin dir, so the stubs below keep winning and the test never depends on the
  // host's nvm. `node` here is the real Node (the harness must keep running).
  shim("node", `#!/usr/bin/env bash\nexec ${process.execPath} "$@"\n`);
  shim("pnpm", "#!/usr/bin/env bash\nsleep 600\n");
  // The network probe is `curl ... <fork>/info/refs`; the app's own probes are
  // `curl -sf -o /dev/null <url>`. `network:false` fails only the former.
  shim("curl", network
    ? "#!/usr/bin/env bash\nexit 0\n"
    : "#!/usr/bin/env bash\nfor a in \"$@\"; do case \"$a\" in */info/refs*) exit 7 ;; esac; done\nexit 0\n");
  shim("ldconfig", "#!/usr/bin/env bash\nprintf 'libnss3.so\\nlibatk-1.0.so.0\\nlibgbm.so.1\\nlibasound.so.2\\nlibcups.so.2\\n'\n");
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
  writeFileSync(envFile, "DATABASE_URL=postgres://u:p@localhost:5432/db?sslmode=disable\nREDIS_URL=redis://localhost:6379/0\n");
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
