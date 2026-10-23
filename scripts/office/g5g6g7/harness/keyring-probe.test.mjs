/* global process */
// The headless-keyring spike's pieces (UNI-1376, g7-qa). The Electron + keyring
// half only runs on a VM with a Secret Service (keyring.spec.txt); what is
// pinned here is everything around it: the argument and environment rules, the
// result decision against the fork's real credential store (when OFFICE_FORK_DIR
// names a checkout), and that no spec line can carry the throwaway password.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CREDENTIALS_MODULE, electronArgs, parseArgs, parseResultLine, probeEnv, resolveForkDir, verdictFor } from "./keyring-probe.mjs";
import { probeCredential, runProbe } from "./keyring-probe-core.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("parseArgs: defaults, every flag, and the refusals", () => {
  const defaults = parseArgs([], {});
  assert.deepEqual({ ...defaults }, { label: "KEYRING_PROBE", forkDir: "", expect: "", xdgCurrentDesktop: "GNOME", passwordStore: "", timeoutMs: 60_000 });
  const all = parseArgs(["--label", "X", "--fork-dir", "/f", "--expect", "ready", "--xdg-current-desktop", "none", "--password-store", "gnome-libsecret", "--timeout-ms", "5000"], {});
  assert.equal(all.label, "X");
  assert.equal(all.forkDir, "/f");
  assert.equal(all.xdgCurrentDesktop, "none");
  assert.equal(all.passwordStore, "gnome-libsecret");
  assert.equal(all.timeoutMs, 5000);
  assert.equal(parseArgs([], { OFFICE_FORK_DIR: "/env", KEYRING_PROBE_XDG_CURRENT_DESKTOP: "KDE" }).forkDir, "/env");
  assert.equal(parseArgs([], { KEYRING_PROBE_XDG_CURRENT_DESKTOP: "KDE" }).xdgCurrentDesktop, "KDE");
  assert.throws(() => parseArgs(["--expect", "maybe"]), /--expect must be one of/);
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument/);
  assert.throws(() => parseArgs(["--label"]), /needs a value/);
  assert.throws(() => parseArgs(["--timeout-ms", "5"]), /--timeout-ms/);
});

test("resolveForkDir: the flag wins, else the harness cache entry for the pinned SHA", () => {
  assert.equal(resolveForkDir("/explicit", {}), "/explicit");
  assert.equal(resolveForkDir("", { OFFICE_FORK_CACHE: "/c", OFFICE_FORK_SHA: "abc1234" }), "/c/uniwork-office-abc1234");
  assert.match(resolveForkDir("", {}), /uniwork-office-0d03b18$/);
});

test("electronArgs adds --password-store only when asked, and always the entry last", () => {
  const plain = electronArgs({ mainPath: "/m.mjs" });
  assert.deepEqual(plain, ["--no-sandbox", "--disable-gpu", "/m.mjs"]);
  const forced = electronArgs({ passwordStore: "gnome-libsecret", mainPath: "/m.mjs" });
  assert.deepEqual(forced, ["--no-sandbox", "--disable-gpu", "--password-store=gnome-libsecret", "/m.mjs"]);
});

test("probeEnv is the app's allow-listed environment: the session bus passes, server secrets do not", () => {
  const source = {
    PATH: "/bin",
    HOME: "/h",
    DISPLAY: ":99",
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/bus",
    XDG_RUNTIME_DIR: "/run/x",
    XDG_CURRENT_DESKTOP: "from-the-vm",
    DATABASE_URL: "postgres://secret",
    JWT_SECRET: "s",
  };
  const withDesktop = probeEnv({ source, userDataDir: "/u", bundleUrl: "file:///b.mjs", xdgCurrentDesktop: "GNOME" });
  assert.equal(withDesktop.DBUS_SESSION_BUS_ADDRESS, "unix:path=/bus");
  assert.equal(withDesktop.XDG_RUNTIME_DIR, "/run/x");
  assert.equal(withDesktop.XDG_CURRENT_DESKTOP, "GNOME");
  assert.equal(withDesktop.GENOFFICE_USER_DATA, "/u");
  assert.equal(withDesktop.PROBE_BUNDLE_URL, "file:///b.mjs");
  assert.equal(withDesktop.DATABASE_URL, undefined);
  assert.equal(withDesktop.JWT_SECRET, undefined);
  // "none" is the app's own situation today: the allow-list drops XDG_CURRENT_DESKTOP, so it is absent
  const without = probeEnv({ source, userDataDir: "/u", bundleUrl: "file:///b.mjs", xdgCurrentDesktop: "none" });
  assert.equal(Object.hasOwn(without, "XDG_CURRENT_DESKTOP"), false);
});

test("parseResultLine takes the probe's last JSON line out of Chromium's noise", () => {
  const noise = ["[1:1:ERROR:dbus] failed", '{"not":"ours"}', '{"probe":"keyring","status":"ready","n":1}', "libEGL warning", '{"probe":"keyring","status":"ready","n":2}'].join("\n");
  assert.equal(parseResultLine(noise).n, 2);
  assert.equal(parseResultLine('{"probe":"keyring","status"'), null);
  assert.equal(parseResultLine(""), null);
});

test("verdictFor: the expected status passes, anything else (or no result) fails", () => {
  assert.equal(verdictFor({ status: "ready" }, "ready"), "PASS");
  assert.equal(verdictFor({ status: "keyring_unavailable" }, "ready"), "FAIL");
  assert.equal(verdictFor({ status: "keyring_unavailable" }, "keyring_unavailable"), "PASS");
  assert.equal(verdictFor({ status: "keyring_unavailable" }, ""), "PASS");
  assert.equal(verdictFor(null, ""), "FAIL");
});

// A reversible stand-in for Electron's safeStorage (never leaves the plaintext readable).
function fakeSafeStorage(overrides = {}) {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: (text) => Buffer.from(Buffer.from(text).toString("base64").split("").reverse().join("")),
    decryptString: (buf) => Buffer.from(buf.toString().split("").reverse().join(""), "base64").toString(),
    ...overrides,
  };
}

/** A store with createCredentialStore's contract; `mode` picks how it misbehaves. */
function fakeCreateStore(mode, seen) {
  return ({ userDataDir }) => ({
    canStore: () => mode !== "unavailable",
    save(credential) {
      seen.token = credential.refreshToken;
      if (mode === "unavailable") throw Object.assign(new Error("credential store: keyring_unavailable"), { code: "keyring_unavailable" });
      if (mode === "weird") throw new Error("boom with a path /home/x/secret");
      mkdirSync(join(userDataDir, "uniwork-auth"), { recursive: true });
      // the "plaintext" mode is the bug the probe must catch: the token readable in the file
      writeFileSync(join(userDataDir, "uniwork-auth", "session.bin"), mode === "plaintext" ? credential.refreshToken : "ciphertext-bytes");
      seen.saved = credential;
    },
    load: () => (mode === "lossy" ? { refreshToken: "other" } : seen.saved ?? null),
    clear: () => {
      seen.cleared = true;
    },
  });
}

function probe(mode, safeStorage = fakeSafeStorage()) {
  const userDataDir = mkdtempSync(join(tmpdir(), "kp-test-"));
  const seen = {};
  try {
    const result = runProbe({ createCredentialStore: fakeCreateStore(mode, seen), safeStorage, userDataDir });
    return { result, seen };
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

test("runProbe: a working store is ready with a round trip, and the token never appears in the result", () => {
  const { result, seen } = probe("ok");
  assert.equal(result.status, "ready");
  assert.equal(result.roundTrip, "ok");
  assert.equal(result.backend, "gnome_libsecret");
  assert.equal(result.encryptionAvailable, true);
  assert.equal(result.canStore, true);
  assert.equal(result.plaintextInFile, false);
  assert.equal(result.sessionFileBytes, "ciphertext-bytes".length);
  assert.ok(seen.cleared, "the probe clears its own session file");
  assert.ok(seen.token.length >= 32);
  assert.equal(JSON.stringify(result).includes(seen.token), false, "no secret value in the result");
});

test("runProbe: the store's keyring_unavailable is the status; an unknown error is a coarse 'error' with no message", () => {
  const unavailable = probe("unavailable", fakeSafeStorage({ isEncryptionAvailable: () => false, getSelectedStorageBackend: () => "basic_text" })).result;
  assert.equal(unavailable.status, "keyring_unavailable");
  assert.equal(unavailable.roundTrip, "fail");
  assert.equal(unavailable.backend, "basic_text");
  assert.equal(unavailable.canStore, false);
  const weird = probe("weird").result;
  assert.equal(weird.status, "error");
  assert.equal(JSON.stringify(weird).includes("/home/x"), false, "an error message (it may hold a path) is never reported");
});

test("runProbe fails a round trip that loses the token, and a file that holds the token in the clear", () => {
  assert.equal(probe("lossy").result.roundTrip, "fail");
  const clear = probe("plaintext").result;
  assert.equal(clear.roundTrip, "fail");
  assert.equal(clear.plaintextInFile, true);
});

test("runProbe survives a safeStorage that throws on every probe call", () => {
  const throwing = { isEncryptionAvailable: () => { throw new Error("x"); }, getSelectedStorageBackend: () => { throw new Error("y"); } };
  const { result } = probe("unavailable", throwing);
  assert.equal(result.backend, "unsupported");
  assert.equal(result.encryptionAvailable, false);
  assert.equal(result.status, "keyring_unavailable");
});

test("probeCredential has every field credentials.ts isStoredCredential requires", () => {
  const c = probeCredential("tok");
  for (const key of ["deploymentId", "apiOrigin", "clientId", "accountId", "deviceSessionId", "sessionId", "refreshToken"]) {
    assert.equal(typeof c[key], "string");
    assert.ok(c[key].length > 0, key);
  }
  assert.ok(Number.isFinite(c.refreshExpiresAt));
});

// The real module: only where a fork checkout with its esbuild is at hand (OFFICE_FORK_DIR).
const FORK_DIR = process.env.OFFICE_FORK_DIR ?? "";
const forkReady = FORK_DIR !== "" && existsSync(join(FORK_DIR, CREDENTIALS_MODULE)) && existsSync(join(FORK_DIR, "node_modules", ".bin", "esbuild"));

test("the fork's real createCredentialStore: ready on a fake safeStorage, keyring_unavailable on basic_text", { skip: !forkReady && "OFFICE_FORK_DIR has no fork checkout with esbuild" }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "kp-real-"));
  try {
    const bundle = join(scratch, "credentials.mjs");
    const built = spawnSync(join(FORK_DIR, "node_modules", ".bin", "esbuild"), [join(FORK_DIR, CREDENTIALS_MODULE), "--bundle", "--platform=node", "--format=esm", `--outfile=${bundle}`, "--log-level=error"], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    const { createCredentialStore } = await import(pathToFileURL(bundle).href);
    const ready = runProbe({ createCredentialStore, safeStorage: fakeSafeStorage(), userDataDir: join(scratch, "a") });
    assert.equal(ready.status, "ready");
    assert.equal(ready.roundTrip, "ok");
    assert.equal(ready.plaintextInFile, false);
    const refused = runProbe({ createCredentialStore, safeStorage: fakeSafeStorage({ getSelectedStorageBackend: () => "basic_text" }), userDataDir: join(scratch, "b") });
    assert.equal(refused.status, "keyring_unavailable");
    assert.equal(refused.roundTrip, "fail");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---- the shell pieces and the spec ------------------------------------------------
const specLines = readFileSync(join(HERE, "keyring.spec.txt"), "utf8")
  .split("\n")
  .filter((line) => line !== "" && !line.startsWith("#"));

test("the shell scripts and every spec line parse (bash -n)", () => {
  for (const file of ["keyring-fork.sh", "keyring-session.sh"]) {
    const run = spawnSync("bash", ["-n", join(HERE, file)], { encoding: "utf8" });
    assert.equal(run.status, 0, `${file}: ${run.stderr}`);
  }
  for (const line of specLines) {
    const run = spawnSync("bash", ["-n"], { input: line, encoding: "utf8" });
    assert.equal(run.status, 0, `spec line fails bash -n: ${line.slice(0, 60)}: ${run.stderr}`);
  }
});

test("the spec: one marker per line, '; true' on all but the last, the last one carries the exit", () => {
  assert.ok(specLines.length >= 4, "apt, fork, session and the negative control");
  for (const [index, line] of specLines.entries()) {
    assert.match(line, /_EXIT=\$/, `line ${index + 1} has no exit marker`);
    if (index < specLines.length - 1) assert.ok(line.endsWith("; true"), `line ${index + 1} must end with '; true'`);
    else assert.match(line, /exit \$rc$/, "the last line exits with the probe's code");
  }
  const joined = specLines.join("\n");
  for (const marker of ["KEYRING_APT_EXIT", "KEYRING_FORK_EXIT", "KEYRING_SESSION_EXIT", "NO_KEYRING_EXIT"]) assert.ok(joined.includes(marker), marker);
  assert.match(joined, /gnome-keyring dbus-x11 xvfb libsecret-tools/);
  assert.match(joined, /dbus-run-session -- bash scripts\/office\/g5g6g7\/harness\/keyring-session\.sh/);
});

test("the throwaway password is never in a spec line or echoed by the session script", () => {
  const session = readFileSync(join(HERE, "keyring-session.sh"), "utf8");
  // generated from /dev/urandom into a variable, piped to the daemon, then unset
  assert.match(session, /KEYRING_PASSWORD="\$\(head -c \d+ \/dev\/urandom/);
  assert.match(session, /printf '%s' "\$KEYRING_PASSWORD" \| gnome-keyring-daemon/);
  assert.match(session, /unset KEYRING_PASSWORD/);
  assert.ok(!/echo[^\n]*\$\{?KEYRING_PASSWORD/.test(session), "the password is echoed");
  assert.ok(!/set -[a-z]*x/.test(session), "xtrace would print the password");
  assert.ok(!specLines.join("\n").includes("KEYRING_PASSWORD"));
  for (const file of ["keyring-fork.sh", "keyring-probe.mjs", "keyring-probe-main.mjs", "keyring-probe-core.mjs"]) {
    assert.ok(existsSync(join(HERE, file)), `${file} is missing`);
  }
});

test("keyring-session.sh --exec: refuses unknown flags and empty --exec (exit 2), and exits 77 BLOCKED when a tool is missing", () => {
  const sessionScript = join(HERE, "keyring-session.sh");
  const badFlag = spawnSync("bash", [sessionScript, "--unknown-flag"], { encoding: "utf8" });
  assert.equal(badFlag.status, 2, badFlag.stderr);
  assert.match(badFlag.stderr, /keyring-session:/);

  const emptyExec = spawnSync("bash", [sessionScript, "--exec"], { encoding: "utf8" });
  assert.equal(emptyExec.status, 2, emptyExec.stderr);
  assert.match(emptyExec.stderr, /--exec/);

  const scratch = mkdtempSync(join(tmpdir(), "ks-missing-"));
  try {
    for (const name of ["bash", "dirname", "pwd"]) {
      const target = spawnSync("bash", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();
      if (target) writeFileSync(join(scratch, name), `#!/bin/sh\nexec "${target}" "$@"\n`, { mode: 0o755 });
    }
    const missingTool = spawnSync("/bin/bash", [sessionScript, "--exec", "true"], {
      encoding: "utf8",
      env: { PATH: scratch, HOME: scratch },
    });
    assert.equal(missingTool.status, 77, `${missingTool.stdout}\n${missingTool.stderr}`);
    assert.match(missingTool.stderr, /BLOCKED: keyring-session needs/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("keyring-session.sh --exec: runs command inside dbus-run-session with unlocked keyring, passes exit code through, stops daemon by PID and removes scratch dir", () => {
  const sessionScript = join(HERE, "keyring-session.sh");
  const scratch = mkdtempSync(join(tmpdir(), "ks-exec-"));
  const binDir = join(scratch, "bin");
  mkdirSync(binDir, { recursive: true });

  try {
    // Stub dbus-run-session, gnome-keyring-daemon, and dbus-send so the wrapper's
    // lifecycle, password pipe, PID stop, and scratch cleanup are tested deterministically.
    const stateDir = join(scratch, "state");
    mkdirSync(stateDir, { recursive: true });

    writeFileSync(
      join(binDir, "dbus-run-session"),
      [
        "#!/usr/bin/env bash",
        'if [ "${1:-}" = "--" ]; then shift; fi',
        'export DBUS_SESSION_BUS_ADDRESS="unix:path=/tmp/fake-bus-$$"',
        'exec "$@"',
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    writeFileSync(
      join(binDir, "gnome-keyring-daemon"),
      [
        "#!/usr/bin/env bash",
        "IFS= read -r pw || true",
        `printf '%s' "\${#pw}" > "${stateDir}/pw-len"`,
        `printf '%s\\n' "$*" > "${stateDir}/gkd-args"`,
        `printf '%s' "$$" > "${stateDir}/gkd-pid"`,
        "trap 'exit 0' TERM INT",
        "while :; do sleep 0.2; done",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    writeFileSync(
      join(binDir, "dbus-send"),
      [
        "#!/usr/bin/env bash",
        'case "$*" in',
        "  *NameHasOwner*org.freedesktop.secrets*)",
        '    echo "   boolean true"',
        "    ;;",
        "  *org.freedesktop.Secret.Collection*string:Locked*)",
        '    if [ "${FAKE_KEYRING_LOCKED:-0}" = "1" ]; then',
        '      echo "   variant       boolean true"',
        "    else",
        '      echo "   variant       boolean false"',
        "    fi",
        "    ;;",
        "esac",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    const env = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      DBUS_SESSION_BUS_ADDRESS: "",
    };

    const probeFile = join(scratch, "cmd-seen.json");
    const runOk = spawnSync(
      "bash",
      [
        sessionScript,
        "--exec",
        "node",
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(probeFile)}, JSON.stringify({ dbus: process.env.DBUS_SESSION_BUS_ADDRESS, xdgData: process.env.XDG_DATA_HOME, xdgRun: process.env.XDG_RUNTIME_DIR, pw: process.env.KEYRING_PASSWORD ?? null }));`,
      ],
      { encoding: "utf8", env },
    );
    assert.equal(runOk.status, 0, `${runOk.stdout}\n${runOk.stderr}`);
    assert.match(runOk.stdout, /KEYRING_DAEMON secrets=yes unlocked=yes/);

    const seen = JSON.parse(readFileSync(probeFile, "utf8"));
    assert.match(seen.dbus, /^unix:path=\/tmp\/fake-bus-/);
    assert.equal(seen.pw, null, "KEYRING_PASSWORD must be unset before the wrapped command runs");
    assert.ok(seen.xdgData && seen.xdgRun, "XDG_DATA_HOME and XDG_RUNTIME_DIR are exported to the wrapped command");

    // Scratch dir must be removed on exit
    const workDir = dirname(seen.xdgData);
    assert.equal(existsSync(workDir), false, `scratch dir ${workDir} must be removed on exit`);

    // Password was piped to gnome-keyring-daemon (non-empty) and never on its argv
    const pwLen = Number(readFileSync(join(stateDir, "pw-len"), "utf8"));
    assert.ok(pwLen >= 24, `expected random password length >= 24, got ${pwLen}`);
    const gkdArgs = readFileSync(join(stateDir, "gkd-args"), "utf8").trim();
    assert.equal(gkdArgs, "--foreground --unlock --components=secrets");

    // Daemon PID must be stopped on exit
    const gkdPid = Number(readFileSync(join(stateDir, "gkd-pid"), "utf8"));
    assert.ok(Number.isInteger(gkdPid) && gkdPid > 0);
    let alive = true;
    try {
      process.kill(gkdPid, 0);
    } catch {
      alive = false;
    }
    assert.equal(alive, false, `daemon PID ${gkdPid} should have been stopped on exit`);

    // Non-zero exit code from the wrapped command is passed through unchanged
    const runExit42 = spawnSync("bash", [sessionScript, "--exec", "bash", "-c", "exit 42"], { encoding: "utf8", env });
    assert.equal(runExit42.status, 42, `${runExit42.stdout}\n${runExit42.stderr}`);

    // If the daemon fails to unlock, --exec exits 1 without running the wrapped command
    const markerLocked = join(scratch, "ran-when-locked");
    const runLocked = spawnSync("bash", [sessionScript, "--exec", "bash", "-c", `touch ${JSON.stringify(markerLocked)}`], {
      encoding: "utf8",
      env: { ...env, FAKE_KEYRING_LOCKED: "1" },
    });
    assert.equal(runLocked.status, 1, `${runLocked.stdout}\n${runLocked.stderr}`);
    assert.equal(existsSync(markerLocked), false, "wrapped command must not run when the keyring fails to unlock");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

