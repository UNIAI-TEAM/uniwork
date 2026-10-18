// G7-03b (UNI-1382) fix4 CL1-5: app-keyring.sh control mode. The live test needs a Linux host with
// gnome-keyring, dbus-run-session and secret-tool (the cloud VM, WSL); elsewhere it is skipped with its reason.
// Run: node --test scripts/office/g5g6g7/fault/app-keyring.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "app-keyring.sh");
const have = (tool) => spawnSync("bash", ["-c", `command -v ${tool}`], { encoding: "utf8" }).status === 0;
const skipLive = process.platform === "win32" || !["bash", "gnome-keyring-daemon", "dbus-run-session", "dbus-send", "secret-tool"].every(have)
  ? "needs a Linux host with bash, gnome-keyring-daemon, dbus-run-session, dbus-send and secret-tool"
  : false;

test("app-keyring.sh parses", { skip: have("bash") ? false : "no bash" }, () => {
  const res = spawnSync("bash", ["-n", SCRIPT], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
});

const PROBE = String.raw`
ask() { printf '%s\n' "$1" > "$APP_KEYRING_CTL.in"; read -r reply < "$APP_KEYRING_CTL.out"; echo "$1 -> $reply"; }
printf 'the-secret' | secret-tool store --label=probe app fl09
ask lock; ask unlock
echo "lookup: $(secret-tool lookup app fl09)"
ask lock; ask unlock
echo "lookup: $(secret-tool lookup app fl09)"
`;

test("CL1-5: the keyring wrapper locks and unlocks twice over its control channel, and the stored secret survives", { skip: skipLive, timeout: 120_000 }, () => {
  const res = spawnSync("dbus-run-session", ["--", "bash", SCRIPT, "bash", "-c", PROBE], {
    encoding: "utf8", env: { ...process.env, APP_KEYRING_CONTROL: "1" }, timeout: 100_000,
  });
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.deepEqual(res.stdout.split("\n").filter((line) => /->|lookup/.test(line)), ["lock -> ok", "unlock -> ok", "lookup: the-secret", "lock -> ok", "unlock -> ok", "lookup: the-secret"]);
});
