/* global process, console, Buffer, URL */
// node --test for the G7-06 capture provider. What needs no display runs
// always: the settle loop, text assembly, argument parsing, exit codes, the
// run-dir gate, the seed call sequence against a fake API, the desktop
// preconditions and environment. What needs a browser (text collection and the
// frame-region capture on static HTML) runs when Playwright and a Chromium are
// reachable and otherwise prints why it was skipped; it never passes silently.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs, runCapture } from "./capture.mjs";
import { HOSTS, MIN_FRAME_WIDTH, SETTLE, STREAMING_TIMEOUT_MS, VIEWPORTS } from "./capture/constants.mjs";
import { ELECTRON_ARGS, captureDesktop, captureWithRetry, collectShellText, desktopEnv, desktopPrecondition, isRetryableTimeout, watchConsole } from "./capture/desktop.mjs";
import { readFixtures, selectFixtures } from "./capture/fixtures.mjs";
import { blocked, buildMeta, clearCapture, exitCodeFor, failed, metaEntry, ok, pngSize, writeCapture } from "./capture/meta.mjs";
import { loadPlaywright } from "./capture/playwright.mjs";
import { readRun } from "./capture/run-dir.mjs";
import { cleanupSeed, seedWorkspace } from "./capture/seed.mjs";
import { PROGRESS_TEXT, frameHash, isStreamingStatus, notSettledReason, pageIsBusy, settle } from "./capture/settle.mjs";
import { appPlaces, clip } from "./capture/scrub.mjs";
import { collectRenderedText, frameBlock, joinBlocks, visibleChars } from "./capture/text.mjs";
import { redactUrl, signIn } from "./capture/signin.mjs";
import { loadPngjs } from "./job-lib.mjs";
import { frameGrantFromToken, frameInstallState, captureOpenFrame, readFrameState, trackFrameGrants, withFrameGrant } from "./capture/web.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE = join(HERE, "capture.mjs");
const scratchDirs = [];
function scratch(prefix = "g706-capture-test-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

// ---- settle -----------------------------------------------------------------
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

describe("settle", () => {
  test("settles after two identical consecutive frames", async () => {
    const clock = fakeClock();
    const frames = [Buffer.from("a"), Buffer.from("b"), Buffer.from("b")];
    let i = 0;
    const r = await settle({ grab: async () => frames[Math.min(i++, frames.length - 1)], isBusy: async () => false, ...clock });
    assert.equal(r.status, "settled");
    assert.equal(r.frames, 3);
    assert.equal(r.frame.toString(), "b");
  });

  test("a busy poll restarts the count: a frame taken under a spinner never counts", async () => {
    const clock = fakeClock();
    const busy = [false, true, false, false];
    let p = 0;
    let grabs = 0;
    const r = await settle({ grab: async () => { grabs += 1; return Buffer.from("same"); }, isBusy: async () => busy[Math.min(p++, busy.length - 1)], ...clock });
    assert.equal(r.status, "settled");
    // poll 1 grabs (streak 1), poll 2 is busy (reset), polls 3 and 4 grab: settled on the 3rd grab, not the 2nd
    assert.equal(grabs, 3);
  });

  test("times out as still_busy when the spinner never goes", async () => {
    const clock = fakeClock();
    const r = await settle({ grab: async () => Buffer.from("x"), isBusy: async () => true, timeoutMs: 1_000, ...clock });
    assert.equal(r.status, "timeout");
    assert.equal(r.reason, "still_busy");
    assert.equal(r.frames, 0);
  });

  test("times out as frames_differ when every frame is new (a ticking clock)", async () => {
    const clock = fakeClock();
    let n = 0;
    const r = await settle({ grab: async () => Buffer.from(`frame-${n++}`), isBusy: async () => false, timeoutMs: 2_000, ...clock });
    assert.equal(r.status, "timeout");
    assert.equal(r.reason, "frames_differ");
    assert.ok(r.frames >= 2);
  });

  test("identical frames only settle once they have been identical for quietMs (a pause is not a settled screen)", async () => {
    const clock = fakeClock();
    const r = await settle({ grab: async () => Buffer.from("same"), isBusy: async () => false, quietMs: 1_000, intervalMs: 300, ...clock });
    assert.equal(r.status, "settled");
    assert.ok(r.waitedMs >= 1_000, `settled after ${r.waitedMs}ms`);
    // a change inside the window restarts it
    const changing = fakeClock();
    let n = 0;
    const frames = ["a", "a", "a", "b", "b", "b", "b", "b"];
    const late = await settle({ grab: async () => Buffer.from(frames[Math.min(n++, frames.length - 1)]), isBusy: async () => false, quietMs: 1_000, intervalMs: 300, ...changing });
    assert.equal(late.status, "settled");
    assert.equal(late.frame.toString(), "b");
  });

  test("a timeout names what was still busy", async () => {
    const clock = fakeClock();
    const r = await settle({ grab: async () => Buffer.from("x"), isBusy: async () => 'notification "Đã tải"', timeoutMs: 1_000, ...clock });
    assert.equal(r.reason, "still_busy");
    assert.equal(r.busyWhy, 'notification "Đã tải"');
    assert.match(notSettledReason(r), /^not_settled:still_busy \(notification "Đã tải"\) after \d+ms \(0 frames\)$/);
  });

  const STREAMING = 'status "Đang tải theo luồng fx-xlsx-revenue-xyz.xlsx: 9 hàng khả dụng."';

  test("a streaming load gets the 90 s budget: still loading at 60 s is waited out, and the shot is the settled one (cloud round 2: not_settled after 45 s)", async () => {
    const clock = fakeClock();
    const r = await settle({ grab: async () => Buffer.from("loaded"), isBusy: async () => (clock.now() < 60_000 ? STREAMING : false), timeoutMs: 45_000, quietMs: 2_500, ...clock });
    assert.equal(r.status, "settled");
    assert.ok(r.waitedMs >= 60_000 && r.waitedMs < 90_000, `settled after ${r.waitedMs}ms`);
  });

  test("a streaming load that is still going after 90 s is a FAIL not_settled, never a mask", async () => {
    const clock = fakeClock();
    const r = await settle({ grab: async () => Buffer.from("x"), isBusy: async () => STREAMING, timeoutMs: 45_000, ...clock });
    assert.equal(r.status, "timeout");
    assert.equal(r.reason, "still_busy");
    assert.ok(r.waitedMs >= STREAMING_TIMEOUT_MS && r.waitedMs < STREAMING_TIMEOUT_MS + 1_000, `gave up after ${r.waitedMs}ms`);
    assert.match(notSettledReason(r), /^not_settled:still_busy \(status "Đang tải theo luồng .*9 hàng khả dụng\."\) after 90\d{3}ms/);
  });

  test("anything that is not a streaming load keeps the 45 s budget (spinner, toast, a plain in-progress status)", async () => {
    for (const why of ["spinner progressbar", 'notification "Đã tải"', 'status "Đang lưu tài liệu..."']) {
      const clock = fakeClock();
      const r = await settle({ grab: async () => Buffer.from("x"), isBusy: async () => why, timeoutMs: 45_000, ...clock });
      assert.equal(r.status, "timeout", why);
      assert.ok(r.waitedMs >= 45_000 && r.waitedMs < 46_000, `${why}: gave up after ${r.waitedMs}ms`);
    }
  });

  test("the extended budget is only for a status that reports a streaming load", () => {
    assert.equal(isStreamingStatus(STREAMING), true);
    assert.equal(isStreamingStatus('status "Streaming a.xlsx: 9 rows available."'), true);
    assert.equal(isStreamingStatus('status "Đang lưu tài liệu..."'), false);
    assert.equal(isStreamingStatus('notification "Đang tải theo luồng a.xlsx"'), false);
    assert.equal(isStreamingStatus(""), false);
    assert.equal(isStreamingStatus(false), false);
    assert.equal(isStreamingStatus(undefined), false);
  });

  test("refuses a single-frame 'settle'", async () => {
    await assert.rejects(settle({ grab: async () => Buffer.alloc(0), isBusy: async () => false, sleep: async () => {}, identicalFrames: 1 }), /identicalFrames >= 2/);
  });

  test("frameHash is content-addressed", () => {
    assert.equal(frameHash(Buffer.from("a")), frameHash(Buffer.from("a")));
    assert.notEqual(frameHash(Buffer.from("a")), frameHash(Buffer.from("b")));
  });
});

// ---- text assembly (pure) ---------------------------------------------------
describe("text assembly", () => {
  test("title, trimmed non-empty body lines, then distinct attribute values; no URL anywhere", () => {
    const block = frameBlock({ title: " Báo cáo ", body: "Dòng 1\n\n  Dòng 2  \n", attrs: ["Dòng 1", "Lưu", "Lưu"] });
    assert.equal(block, "Báo cáo\nDòng 1\nDòng 2\nLưu");
  });

  test("empty blocks are dropped and the result ends with a newline", () => {
    const text = joinBlocks([{ title: "", body: "", attrs: [] }, { title: "A", body: "b", attrs: [] }]);
    assert.equal(text, "A\nb\n");
  });

  test("visibleChars ignores whitespace", () => {
    assert.equal(visibleChars(" a b\n\tc "), 3);
    assert.equal(visibleChars("\n\n"), 0);
  });
});

// ---- args, exit codes, meta -------------------------------------------------
describe("arguments and exit codes", () => {
  test("parses host, out, fixtures and run dir", () => {
    const a = parseArgs(["--host", "web", "--out", "x", "--fixtures", "a, b", "--run-dir", "r"], {});
    assert.deepEqual([a.host, a.out, a.fixtures, a.runDir, a.errors], ["web", "x", ["a", "b"], "r", []]);
  });

  test("rejects a missing host/out, an unknown host, an unknown flag, a valueless flag", () => {
    assert.ok(parseArgs([], {}).errors.length >= 2);
    assert.match(parseArgs(["--host", "tv", "--out", "x"], {}).errors.join(), /--host must be one of/);
    assert.match(parseArgs(["--host", "web", "--out", "x", "--bogus"], {}).errors.join(), /unknown argument --bogus/);
    assert.match(parseArgs(["--host", "web", "--out"], {}).errors.join(), /--out needs a value/);
  });

  test("the run dir defaults to HARNESS_RUN_DIR", () => {
    assert.equal(parseArgs(["--host", "web", "--out", "x"], { HARNESS_RUN_DIR: "/r" }).runDir, "/r");
  });

  test("exit: 0 all ok, 1 any failed (even beside blocked), 77 blocked or nothing", () => {
    assert.equal(exitCodeFor({ a: ok(), b: ok() }), 0);
    assert.equal(exitCodeFor({ a: ok(), b: blocked("x") }), 77);
    assert.equal(exitCodeFor({ a: failed("x"), b: blocked("y"), c: ok() }), 1);
    assert.equal(exitCodeFor({}), 77);
  });

  test("meta carries the contract fields and the fixed shot settings", () => {
    const meta = buildMeta({ host: "web", forkSha: "cb76dde", pinVersion: "0.1.0-cb76dde", fixtures: { f: { status: "ok", reason: "", png: Buffer.alloc(1) } }, now: new Date("2026-10-12T18:00:00Z") });
    assert.deepEqual(Object.keys(meta).slice(0, 7), ["host", "forkSha", "pinVersion", "viewport", "deviceScaleFactor", "capturedAt", "fixtures"]);
    assert.deepEqual(meta.viewport, { w: 1720, h: 980 });
    assert.equal(meta.deviceScaleFactor, 1);
    assert.deepEqual(meta.fixtures.f, { status: "ok", reason: "" });
    assert.equal(meta.settings.locale, "vi-VN");
    assert.equal(meta.settings.timezone, "Asia/Ho_Chi_Minh");
    assert.equal(meta.settings.colorScheme, "light");
    assert.equal(meta.capturedAt, "2026-10-12T18:00:00.000Z");
  });

  test("a fixture that is not ok leaves no stale png/txt", () => {
    const out = scratch();
    writeCapture(out, "web", "fx", { png: Buffer.from("p"), text: "t" });
    assert.ok(existsSync(join(out, "web", "fx.png")));
    clearCapture(out, "web", "fx");
    assert.ok(!existsSync(join(out, "web", "fx.png")));
    assert.ok(!existsSync(join(out, "web", "fx.txt")));
    clearCapture(out, "web", "fx"); // idempotent
  });

  test("the web host's text around the frame goes to <id>.host.txt, the desktop shell's to <id>.shell.txt, and a failed fixture clears both", () => {
    const out = scratch();
    writeCapture(out, "web", "fx", { png: Buffer.from("p"), text: "module", hostText: "host page" });
    writeCapture(out, "desktop", "fx", { png: Buffer.from("p"), text: "module", shellText: "shell window" });
    assert.equal(readFileSync(join(out, "web", "fx.txt"), "utf8"), "module");
    assert.equal(readFileSync(join(out, "web", "fx.host.txt"), "utf8"), "host page");
    assert.ok(!existsSync(join(out, "web", "fx.shell.txt")));
    assert.equal(readFileSync(join(out, "desktop", "fx.shell.txt"), "utf8"), "shell window");
    clearCapture(out, "web", "fx");
    clearCapture(out, "desktop", "fx");
    for (const host of ["web", "desktop"]) for (const ext of ["png", "txt", "host.txt", "shell.txt"]) assert.ok(!existsSync(join(out, host, `fx.${ext}`)), `${host}/fx.${ext}`);
  });

  test("meta records each shot's real size and whether its frame is canvas only", () => {
    const png = Buffer.alloc(33);
    png.write("\x89PNG\r\n\x1a\n", 0, "latin1");
    png.writeUInt32BE(1440, 16);
    png.writeUInt32BE(861, 20);
    assert.deepEqual(pngSize(png), { w: 1440, h: 861 });
    assert.equal(pngSize(Buffer.from("not a png at all, really, no")), null);
    const meta = buildMeta({ host: "desktop", forkSha: "x", pinVersion: "y", fixtures: { a: { status: "ok", reason: "", size: { w: 1440, h: 861 }, canvasOnly: true }, b: { status: "failed", reason: "r" } } });
    assert.deepEqual(meta.fixtures.a, { status: "ok", reason: "", size: { w: 1440, h: 861 }, canvasOnly: true });
    assert.deepEqual(meta.fixtures.b, { status: "failed", reason: "r" });
  });

  test("the viewport is per host (Amendment 4): desktop 1440x900, web 1720x980 so the module frame is as wide as the desktop view", () => {
    assert.deepEqual(VIEWPORTS, { desktop: { w: 1440, h: 900 }, web: { w: 1720, h: 980 } });
    for (const host of HOSTS) {
      const meta = buildMeta({ host, forkSha: "x", pinVersion: "y", fixtures: {} });
      assert.deepEqual(meta.viewport, VIEWPORTS[host], host);
      assert.notEqual(meta.viewport, VIEWPORTS[host], "meta carries a copy, not the shared constant");
    }
    assert.equal(MIN_FRAME_WIDTH, 1400);
  });

  test("the SETTLE budget needs two identical frames, defaults to 45 s and allows 90 s for a streaming load", () => {
    assert.ok(SETTLE.identicalFrames >= 2);
    assert.equal(SETTLE.timeoutMs, 45_000);
    assert.equal(SETTLE.streamingTimeoutMs, 90_000);
    assert.equal(STREAMING_TIMEOUT_MS, 90_000);
  });
});

// ---- fixtures ---------------------------------------------------------------
describe("fixtures", () => {
  test("the manifest's six fixtures, each with a module and an existing file", () => {
    const fixtures = readFixtures();
    assert.equal(fixtures.length, 6);
    assert.deepEqual(fixtures.map((f) => f.module).sort(), ["docs", "html", "markdown", "pdf", "sheets", "slides"]);
    for (const f of fixtures) assert.ok(existsSync(f.absPath), `${f.id} missing at ${f.absPath}`);
  });

  test("--fixtures picks in manifest order and names unknown ids", () => {
    const all = readFixtures();
    const { chosen, unknown } = selectFixtures(all, ["fx-md-notes-vi", "nope", "fx-docx-report-vi"]);
    assert.deepEqual(unknown, ["nope"]);
    assert.deepEqual(chosen.map((f) => f.id), all.map((f) => f.id).filter((id) => id === "fx-docx-report-vi" || id === "fx-md-notes-vi"));
  });
});

// ---- the run-dir gate and the CLI without a stack ---------------------------
function runDirWith(files) {
  const dir = scratch("g706-run-");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe("run gate", () => {
  test("no ports.env = blocked; start.sh failed = fail; start.sh blocked = blocked; up = proceed", () => {
    assert.equal(readRun(scratch("g706-run-")).gate, "blocked");
    const ports = "API_ORIGIN=http://127.0.0.1:1\nWEB_ORIGIN=http://127.0.0.1:2\n";
    assert.equal(readRun(runDirWith({ "ports.env": ports, "start-status.json": '{"state":"failed","reason":"x"}' })).gate, "fail");
    assert.equal(readRun(runDirWith({ "ports.env": ports, "start-status.json": '{"state":"starting"}' })).gate, "fail");
    assert.equal(readRun(runDirWith({ "ports.env": ports, "start-status.json": '{"state":"blocked","reason":"no db"}' })).gate, "blocked");
    const up = readRun(runDirWith({ "ports.env": ports, "start-status.json": '{"state":"up"}' }));
    assert.equal(up.gate, "proceed");
    assert.equal(up.ports.WEB_ORIGIN, "http://127.0.0.1:2");
  });

  test("CLI, no harness run: exit 77, meta.json lists every fixture as blocked, no png", () => {
    const out = scratch();
    const run = spawnSync(process.execPath, [CAPTURE, "--host", "desktop", "--out", out, "--run-dir", scratch("g706-run-")], { encoding: "utf8" });
    assert.equal(run.status, 77, run.stdout + run.stderr);
    const meta = JSON.parse(readFileSync(join(out, "desktop", "meta.json"), "utf8"));
    assert.equal(Object.keys(meta.fixtures).length, 6);
    assert.ok(Object.values(meta.fixtures).every((f) => f.status === "blocked" && /start\.sh/.test(f.reason)));
    assert.equal(meta.host, "desktop");
  });

  test("CLI, start.sh failed: exit 1 (a harness bug is not a missing precondition)", () => {
    const run = runDirWith({ "ports.env": "API_ORIGIN=http://127.0.0.1:1\n", "start-status.json": '{"state":"failed","reason":"server died"}' });
    const out = scratch();
    const r = spawnSync(process.execPath, [CAPTURE, "--host", "web", "--out", out, "--run-dir", run, "--fixtures", "fx-md-notes-vi"], { encoding: "utf8" });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const meta = JSON.parse(readFileSync(join(out, "web", "meta.json"), "utf8"));
    assert.deepEqual(Object.keys(meta.fixtures), ["fx-md-notes-vi"]);
    assert.equal(meta.fixtures["fx-md-notes-vi"].status, "failed");
  });

  test("CLI usage errors exit 2 and write nothing", () => {
    const out = scratch();
    const r = spawnSync(process.execPath, [CAPTURE, "--host", "web", "--out", out, "--fixtures", "nope"], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unknown fixture ids nope/);
    assert.equal(spawnSync(process.execPath, [CAPTURE], { encoding: "utf8" }).status, 2);
    assert.ok(!existsSync(join(out, "web")));
  });

  test("Playwright not installed is BLOCKED, named", async () => {
    const run = runDirWith({ "ports.env": "API_ORIGIN=http://127.0.0.1:1\nWEB_ORIGIN=http://127.0.0.1:2\n", "start-status.json": '{"state":"up"}' });
    const out = scratch();
    const { exitCode, meta } = await runCapture({ host: "web", out, fixtures: readFixtures().slice(0, 1), runDir: run, playwright: null });
    assert.equal(exitCode, 77);
    assert.match(Object.values(meta.fixtures)[0].reason, /Playwright is not installed/);
  });
});

// ---- desktop preconditions and environment ----------------------------------
describe("desktop host", () => {
  test("a run without the fork app, a display or a binary is blocked with the reason", () => {
    assert.match(desktopPrecondition({ API_ORIGIN: "http://x" }), /ELECTRON_BIN, SHELL_APP_DIR/);
    assert.match(desktopPrecondition({ API_ORIGIN: "http://x", ELECTRON_BIN: "/nonexistent/electron", SHELL_APP_DIR: "/" }), /ELECTRON_BIN .* does not exist/);
    const bin = join(scratch(), "electron");
    writeFileSync(bin, "");
    assert.match(desktopPrecondition({ API_ORIGIN: "http://x", ELECTRON_BIN: bin, SHELL_APP_DIR: "/" }), /no DISPLAY/);
    assert.equal(desktopPrecondition({ API_ORIGIN: "http://x", ELECTRON_BIN: bin, SHELL_APP_DIR: "/", DISPLAY: ":99" }), "");
  });

  test("the instance env is the harness allow-list plus fixed locale, zone and the run's display and X auth; no server secret", () => {
    const env = desktopEnv(
      { API_ORIGIN: "http://127.0.0.1:9", DISPLAY: ":99", XAUTHORITY: "/run/x" },
      "/ud",
      { PATH: "/bin", HOME: "/h", DATABASE_URL: "postgres://secret", JWT_SECRET: "s", OPENAI_API_KEY: "k", DISPLAY: ":0" },
    );
    assert.equal(env.DISPLAY, ":99");
    assert.equal(env.XAUTHORITY, "/run/x");
    assert.equal(env.TZ, "Asia/Ho_Chi_Minh");
    assert.equal(env.GENOFFICE_LANG, "vi");
    assert.equal(env.UNIWORK_API_ORIGIN, "http://127.0.0.1:9");
    assert.equal(env.GENOFFICE_USER_DATA, "/ud");
    for (const key of ["DATABASE_URL", "JWT_SECRET", "OPENAI_API_KEY"]) assert.ok(!(key in env), `${key} leaked`);
  });

  test("the desktop instance pins the device scale factor instead of trusting the display's DPI", () => {
    assert.ok(ELECTRON_ARGS.includes("--force-device-scale-factor=1"));
  });

  test("the shell text is every window title plus the text of every shell page, never the module view", async () => {
    const pageOf = (title, body, attrs = []) => ({ frames: () => [{ evaluate: async () => ({ title: "", body, attrs, canvasRatio: 0 }) }], _t: title });
    const moduleView = pageOf("m", "module text");
    const app = {
      evaluate: async () => ["UniWork Office — Báo cáo", "UniWork Office"],
      windows: () => [pageOf("s", "Tab: Báo cáo.docx", ["Đóng tab"]), moduleView],
    };
    const text = await collectShellText(app, moduleView);
    assert.match(text, /UniWork Office — Báo cáo/);
    assert.match(text, /Tab: Báo cáo\.docx/);
    assert.ok(!text.includes("module text"));
    const noTitles = await collectShellText({ evaluate: async () => { throw new Error("no electron"); }, windows: () => [pageOf("s", "Menu")] }, moduleView);
    assert.match(noTitles, /Menu/);
  });

  describe("desktop retry of a busy streaming status (item 6)", () => {
    const STREAMING = 'status "Đang tải theo luồng a.xlsx: 9 hàng khả dụng."';
    const timeout = (busyWhy, reason = "still_busy") => ({ status: "timeout", reason, busyWhy, frames: 3, waitedMs: 90_000 });
    const busyResult = (busyWhy = STREAMING) => failed(notSettledReason(timeout(busyWhy)), { retryable: isRetryableTimeout(timeout(busyWhy)), diagnostics: { status: busyWhy, console: [] } });

    test("only a still_busy timeout with a streaming status is retryable", () => {
      assert.equal(isRetryableTimeout(timeout(STREAMING)), true);
      assert.equal(isRetryableTimeout(timeout('spinner progressbar')), false);
      assert.equal(isRetryableTimeout(timeout('notification "Đã lưu"')), false);
      assert.equal(isRetryableTimeout(timeout("", "still_busy")), false);
      assert.equal(isRetryableTimeout(timeout(STREAMING, "frames_differ")), false);
    });

    test("a first attempt busy on a streaming status is run once more, and the retry is recorded", async () => {
      const calls = [];
      const answers = [busyResult(), ok({ png: Buffer.alloc(1), text: "t" })];
      const result = await captureWithRetry(async () => { calls.push(1); return answers.shift(); });
      assert.equal(calls.length, 2);
      assert.equal(result.status, "ok");
      assert.equal(result.retries.length, 1);
      assert.match(result.retries[0].reason, /^not_settled:still_busy \(status "Đang tải theo luồng/);
      assert.match(result.retries[0].diagnostics.status, /Đang tải theo luồng/);
    });

    test("two busy results in a row fail not_settled; there is no third attempt", async () => {
      let calls = 0;
      const result = await captureWithRetry(async () => { calls += 1; return busyResult(); });
      assert.equal(calls, 2);
      assert.equal(result.status, "failed");
      assert.match(result.reason, /^not_settled:still_busy/);
      assert.equal(result.retries.length, 1);
    });

    test("a busy result that is not a streaming status, or any other failure, is not retried", async () => {
      for (const first of [busyResult("spinner progressbar"), failed("electron_launch_failed: x"), blocked("shell_requires_sign_in")]) {
        let calls = 0;
        const result = await captureWithRetry(async () => { calls += 1; return first; });
        assert.equal(calls, 1, first.reason);
        assert.equal(result.retries, undefined);
      }
    });

    test("meta.json records the retries and the diagnostics of the fixture", () => {
      const entry = metaEntry({ status: "ok", reason: "", png: Buffer.alloc(1), retries: [{ reason: "not_settled:still_busy (x)", diagnostics: { status: "s", console: ["log: a"] } }] });
      assert.deepEqual(entry.retries, [{ reason: "not_settled:still_busy (x)", diagnostics: { status: "s", console: ["log: a"] } }]);
      const meta = buildMeta({ host: "desktop", forkSha: "x", pinVersion: "y", fixtures: { a: entry, b: metaEntry(failed("not_settled:still_busy (x)", { diagnostics: { status: "s", console: [] } })) } });
      assert.equal(meta.fixtures.a.retries.length, 1);
      assert.deepEqual(meta.fixtures.b.diagnostics, { status: "s", console: [] });
      assert.equal(meta.fixtures.b.status, "failed");
    });
  });

  test("with no reusable app every fixture is blocked and nothing is launched", async () => {
    const run = runDirWith({ "ports.env": "API_ORIGIN=http://127.0.0.1:1\n", "start-status.json": '{"state":"up"}' });
    const out = scratch();
    const fake = { _electron: { launch: () => { throw new Error("must not launch"); } }, chromium: {} };
    const { exitCode, meta } = await runCapture({ host: "desktop", out, fixtures: readFixtures(), runDir: run, playwright: fake });
    assert.equal(exitCode, 77);
    assert.ok(Object.values(meta.fixtures).every((f) => f.status === "blocked" && /ELECTRON_BIN/.test(f.reason)));
  });
});

// ---- diagnostics scrubber (N-8) ----------------------------------------------
describe("diagnostics scrubber", () => {
  const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl";
  const leaks = (input, secret) => assert.ok(!clip(input, 400).includes(secret), `"${secret}" survived in: ${clip(input, 400)}`);

  test("snake_case, camelCase and quoted keys lose their value", () => {
    leaks("access_token=abc123xyz", "abc123xyz");
    leaks('{"refresh_token":"zzz999"}', "zzz999");
    leaks("accessToken: abcSECRET1", "abcSECRET1");
    leaks("idToken=qq77", "qq77");
    leaks("x-api-key: k-4455", "k-4455");
    leaks("apiKey=AK9988&other=1", "AK9988");
    leaks("api_key=AK1122", "AK1122");
    leaks("password=hunter2", "hunter2");
    leaks('{"passwd": "p4ss"}', "p4ss");
    leaks("client_secret=s3cr3t", "s3cr3t");
    leaks("sessionId=S-8812", "S-8812");
    leaks("session=S-9912", "S-9912");
    leaks('{"password":"two words here"}', "words");
    assert.match(clip("access_token=abc123 and then more", 400), /and then more/);
  });

  test("the value after an Authorization scheme is gone, not only the word Bearer", () => {
    leaks("Authorization: Bearer tok_ABCdef123456", "tok_ABCdef123456");
    leaks('{"authorization":"Bearer tok_ZZ998877"}', "tok_ZZ998877");
    leaks("authorization=Bearer tok_QQ112233", "tok_QQ112233");
    leaks("sent header bearer tok_WW445566 to server", "tok_WW445566");
  });

  test("Basic credentials are gone", () => {
    leaks("Authorization: Basic dXNlcjpwYXNzd29yZA==", "dXNlcjpwYXNzd29yZA");
    leaks("Authorization: basic dXNlcjpwYXNz", "dXNlcjpwYXNz");
    leaks("replay with Basic dXNlcjpwYXNzd29yZA== now", "dXNlcjpwYXNzd29yZA");
  });

  test("cookie headers lose every pair", () => {
    const line = clip("Cookie: sid=abc111; theme=dark; csrf=xyz222", 400);
    for (const secret of ["abc111", "xyz222", "dark"]) assert.ok(!line.includes(secret), line);
    leaks("Set-Cookie: sid=abc333; Path=/; HttpOnly", "abc333");
    leaks("cookie=sid=abc444", "abc444");
  });

  test("a query token is scrubbed and the rest of the URL kept", () => {
    const line = clip("GET /api/v1/files?token=qtok123&page=2 failed", 400);
    assert.ok(!line.includes("qtok123"), line);
    assert.match(line, /\/api\/v1\/files\?/);
    assert.match(line, /page=2 failed/);
    leaks("https://x/y?access_token=zz1&refresh_token=zz2", "zz2");
  });

  test("JWT-shaped strings are removed wherever they are", () => {
    leaks(`error ${JWT} while saving`, JWT);
    leaks(`data:${JWT}`, "eyJzdWIi");
    leaks(`id=${JWT}`, "c2lnbmF0dXJl");
    leaks("eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.", "eyJzdWIiOiJ4In0");
    assert.match(clip(`error ${JWT} while saving`, 400), /^error .* while saving$/);
  });

  test("ordinary status text is kept unchanged", () => {
    for (const text of [
      "Đang tải theo luồng… 1.234 hàng",
      "Đã lưu báo-cáo_quý-3.xlsx (12 trang, 3.402 ô)",
      "Loading 1,200 rows of 5,000",
      "notification: Đã lưu | progressbar: 45%",
      "Basic formatting applied to 12 cells",
      "Session expired soon? no — 3 sheets open",
      "Mã phiên bản 0.1.0-cb76dde đã sẵn sàng",
      "log: font fallback to Be Vietnam Pro for 4 runs",
    ]) {
      assert.equal(clip(text, 400), text);
    }
  });

  test("the length cap and whitespace folding still apply", () => {
    assert.equal(clip("a   b\n c", 400), "a b c");
    assert.equal(clip("x".repeat(500), 10), "x".repeat(10));
  });
});

// ---- diagnostics paths (N-9) -------------------------------------------------
describe("diagnostics paths", () => {
  const places = { home: "/home/tester", run: "/var/run-scratch", app: ["/opt/uniwork/app", "/opt/uniwork/electron"] };

  test("the home dir, the run dirs and the app dir become placeholders, file URLs included", () => {
    assert.equal(clip("error at file:///home/tester/work/x.js:12", 400, places), "error at file://<home>/work/x.js:12");
    assert.equal(clip("ENOENT /var/run-scratch/g7-06-desktop-ab12/f1/doc.docx", 400, places), "ENOENT <run>/g7-06-desktop-ab12/f1/doc.docx");
    assert.equal(clip("Uncaught at file:///opt/uniwork/app/main.js:3", 400, places), "Uncaught at file://<app>/main.js:3");
    assert.equal(clip("spawn /opt/uniwork/electron/electron ENOENT", 400, places), "spawn <app>/electron ENOENT");
    assert.equal(clip("a /home/tester and b /home/tester/c", 400, places), "a <home> and b <home>/c");
  });

  test("the app dir wins when it sits inside the home dir", () => {
    const nested = { home: "/home/tester", run: "/tmp", app: ["/home/tester/uniwork/app"] };
    assert.equal(clip("at /home/tester/uniwork/app/x.js and /home/tester/other.js", 400, nested), "at <app>/x.js and <home>/other.js");
  });

  test("only whole path segments match, and ordinary paths and text are untouched", () => {
    assert.equal(clip("/home/testers/x /srv/home/tester/y /home/tester.bak/z", 400, places), "/home/testers/x /srv/home/tester/y /home/tester.bak/z");
    assert.equal(clip("GET /api/v1/files?page=2 → Đã lưu báo-cáo_quý-3.xlsx", 400, places), "GET /api/v1/files?page=2 → Đã lưu báo-cáo_quý-3.xlsx");
  });

  test("with no places given the real home and tmpdir are scrubbed", () => {
    const out = clip(`at file://${homedir()}/x.js and ${tmpdir()}/g7/y`, 400);
    assert.ok(!out.includes(homedir()) || homedir() === "/", out);
    assert.match(out, /<run>\/g7\/y/);
  });

  test("the app places come from SHELL_APP_DIR and the Electron binary's dir", () => {
    assert.deepEqual(appPlaces({ SHELL_APP_DIR: "/opt/a/app", ELECTRON_BIN: "/opt/e/dist/electron" }), ["/opt/a/app", "/opt/e/dist"]);
    assert.deepEqual(appPlaces({}), []);
  });

  test("URL userinfo (user and password) is scrubbed for any scheme, the rest of the URL kept (N-10)", () => {
    assert.ok(!clip("GET https://user:hunter2@host.example/x", 400).includes("hunter2"));
    assert.ok(!clip("GET https://user:hunter2@host.example/x", 400).includes("user:"));
    assert.equal(clip("GET https://user:hunter2@host.example/x", 400), "GET https://<redacted>@host.example/x");
    assert.equal(clip("connect postgres://u:p4ssw0rd@db:5432/x failed", 400), "connect postgres://<redacted>@db:5432/x failed");
    assert.equal(clip("redis://:onlypass@cache:6379 and ssh+git://deploy@git.example/r.git", 400), "redis://<redacted>@cache:6379 and ssh+git://<redacted>@git.example/r.git");
    assert.equal(clip("see https://host.example/a@b and mail me@example.com", 400), "see https://host.example/a@b and mail me@example.com");
  });

  describe("failure reasons are scrubbed like the diagnostics (N-11)", () => {
    const appDir = scratch();
    const bin = join(appDir, "electron");
    writeFileSync(bin, "");
    const ports = { API_ORIGIN: "http://x", ELECTRON_BIN: bin, SHELL_APP_DIR: appDir, DISPLAY: ":99" };
    const dirty = `ENOENT ${homedir()}/work/x token=abc111 https://u:pw9@h.example/p run ${tmpdir()}/g7/y app ${appDir}/main.js`;
    const fixture = readFixtures().find((f) => f.module);
    const reasonOf = async (playwright, now) => (await captureDesktop({ ports, fixtures: [fixture], playwright, now })).results[fixture.id];
    const assertClean = (reason) => {
      for (const secret of ["abc111", "pw9", homedir(), tmpdir(), appDir]) assert.ok(!reason.includes(secret), `"${secret}" survived in: ${reason}`);
      for (const placeholder of ["<home>", "<run>", "<app>"]) assert.ok(reason.includes(placeholder), `${placeholder} missing in: ${reason}`);
    };

    test("electron_launch_failed", async () => {
      const result = await reasonOf({ _electron: { launch: async () => { throw new Error(dirty); } } });
      assert.match(result.reason, /^electron_launch_failed: /);
      assertClean(result.reason);
    });

    test("module_view_not_found and shell_requires_sign_in show the shell text scrubbed", async () => {
      let tick = 0;
      const now = () => (tick += 100_000);
      const app = (screen) => ({
        windows: () => [],
        waitForEvent: async () => {},
        firstWindow: async () => ({ evaluate: async () => screen }),
        process: () => ({ exitCode: 0, signalCode: null }),
        evaluate: async () => {},
        close: async () => {},
      });
      const missing = await reasonOf({ _electron: { launch: async () => app(dirty) } }, now);
      assert.match(missing.reason, /^module_view_not_found: /);
      assertClean(missing.reason);
      const signIn = await reasonOf({ _electron: { launch: async () => app(`Sign in ${dirty}`) } }, now);
      assert.match(signIn.reason, /^shell_requires_sign_in: /);
      assertClean(signIn.reason);
    });
  });

  test("the console watcher scrubs paths and secrets with the app dir it was given", () => {
    const handlers = {};
    const watch = watchConsole({ on: (event, fn) => { handlers[event] = fn; } }, ["/opt/uniwork/app"]);
    handlers.console({ type: () => "error", text: () => "load failed file:///opt/uniwork/app/x.js:12 access_token=abc123" });
    assert.deepEqual(watch.lines, ["error: load failed file://<app>/x.js:12 access_token=<redacted>"]);
  });
});

// ---- web host: seeding against a fake API -----------------------------------
function fakeApi() {
  const calls = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      calls.push({ method: req.method, path: req.url, auth: req.headers.authorization ?? "", type: req.headers["content-type"] ?? "", body: body.toString("latin1") });
      const json = (value, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
      if (req.url === "/api/v1/auth/register") return json({ access_token: "tok", user: { id: "u1" } });
      if (req.url === "/api/v1/me/email/verify") return json({});
      if (req.url === "/api/v1/orgs") return json({ organization: { id: "org1", slug: "o-x" } });
      if (req.url === "/api/v1/orgs/org1/workspaces") return json({ workspace: { id: "ws1", slug: "w-x" } });
      if (req.url === "/api/v1/me/onboarding/complete") return json({});
      if (req.url === "/api/v1/workspaces/ws1/documents/files") return json({ document: { id: `doc${calls.length}` } });
      if (/^\/api\/v1\/documents\/doc\d+\/archive$/.test(req.url)) return json({}, 200);
      if (req.url === "/api/v1/orgs/org1/privacy/deletion") return json({}, 202);
      return json({ error: "nope" }, 404);
    });
  });
  return new Promise((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen({ server, calls, origin: `http://127.0.0.1:${server.address().port}` })));
}

describe("web seeding", () => {
  test("register -> verify -> org -> workspace(org id) -> onboarding -> one upload per fixture, token on every authed call", async () => {
    const api = await fakeApi();
    try {
      const fixtures = readFixtures().slice(0, 2);
      const seed = await seedWorkspace({ apiOrigin: api.origin, fixtures, now: 1_700_000_000_000 });
      assert.deepEqual(api.calls.map((c) => `${c.method} ${c.path}`), [
        "POST /api/v1/auth/register",
        "POST /api/v1/me/email/verify",
        "POST /api/v1/orgs",
        "POST /api/v1/orgs/org1/workspaces",
        "POST /api/v1/me/onboarding/complete",
        "POST /api/v1/workspaces/ws1/documents/files",
        "POST /api/v1/workspaces/ws1/documents/files",
      ]);
      assert.equal(api.calls[0].auth, "");
      assert.ok(api.calls.slice(1).every((c) => c.auth === "Bearer tok"));
      assert.deepEqual(JSON.parse(api.calls[4].body), { completion_path: "full", workspace_id: "ws1" });
      assert.match(api.calls[5].type, /^multipart\/form-data/);
      assert.ok(api.calls[5].body.includes(fixtures[0].path.split("/").pop()));
      assert.deepEqual(Object.keys(seed.documents), fixtures.map((f) => f.id));
      const before = api.calls.length;
      const cleaned = await cleanupSeed({ apiOrigin: api.origin, seed });
      assert.equal(cleaned.ok, true);
      // every seeded document is archived through the API, then the organization goes into the erasure queue
      assert.deepEqual(api.calls.slice(before).map((c) => `${c.method} ${c.path}`), [
        ...Object.values(seed.documents).map((id) => `POST /api/v1/documents/${id}/archive`),
        "POST /api/v1/orgs/org1/privacy/deletion",
      ]);
      assert.ok(api.calls.slice(before).every((c) => c.auth === "Bearer tok"));
      assert.deepEqual(JSON.parse(api.calls.at(-1).body), { confirm_slug: "o-x" });
      assert.deepEqual(cleaned.archived, fixtures.map((f) => f.id));
      // what stays is spelled out: the trash, the organization, the account
      assert.match(cleaned.leftover, /^stays: 2 document\(s\) archived into the trash/);
      assert.match(cleaned.leftover, /organization org1 \(erasure queued, runs in 5 days; its workspace ws1 stays until then\)/);
      assert.match(cleaned.leftover, /owner account g7-06-capture-1700000000000@example\.com \(it cannot be deleted while it owns an organization\)/);
    } finally {
      api.server.close();
    }
  });

  test("a refused call surfaces as an error naming the request, and a failed cleanup does not throw", async () => {
    const api = await fakeApi();
    try {
      await assert.rejects(seedWorkspace({ apiOrigin: `${api.origin}/wrong`, fixtures: [] }), /-> 404/);
      const cleaned = await cleanupSeed({ apiOrigin: api.origin, seed: { organization: { id: "other", slug: "s" }, token: "t", email: "e@x", documents: { fx: "nope" } } });
      assert.equal(cleaned.ok, false);
      assert.deepEqual(cleaned.notArchived.length, 1);
      assert.match(cleaned.leftover, /NOT archived: fx \(/);
      assert.match(cleaned.leftover, /deletion request FAILED/);
    } finally {
      api.server.close();
    }
  });
});

describe("web frame AI grant (RFE5-202)", () => {
  test("the grant is the token answer's ai.ai and ai.uniwork_ai; an absent or drifted field reads as off", () => {
    assert.deepEqual(frameGrantFromToken({ token: "t", ai: { ai: true, web_search: false, uniwork_ai: false } }), { ai: true, uniworkAi: false });
    assert.deepEqual(frameGrantFromToken({ ai: { ai: false, uniwork_ai: true } }), { ai: false, uniworkAi: true });
    assert.deepEqual(frameGrantFromToken({ ai: { ai: "yes", uniwork_ai: 1 } }), { ai: false, uniworkAi: false });
    assert.deepEqual(frameGrantFromToken({ token: "t" }), { ai: false, uniworkAi: false });
    assert.deepEqual(frameGrantFromToken(null), { ai: false, uniworkAi: false });
  });

  test("withFrameGrant stamps an ok shot with the grant its document's token carried; others are left alone", () => {
    const grants = new Map([["doc1", { ai: true, uniworkAi: false }]]);
    assert.deepEqual(withFrameGrant(ok({ png: Buffer.alloc(1) }), grants, "doc1"), { ...ok({ png: Buffer.alloc(1) }), ai: true, uniworkAi: false });
    // no token seen for the document: the shot proves no grant, so none is written (the job fails it)
    const unseen = withFrameGrant(ok(), grants, "doc2");
    assert.equal("ai" in unseen, false);
    assert.equal("uniworkAi" in unseen, false);
    assert.deepEqual(withFrameGrant(failed("x"), grants, "doc1"), failed("x"));
    assert.deepEqual(withFrameGrant(blocked("x"), grants, "doc1"), blocked("x"));
  });

  test("trackFrameGrants reads only the frame-token mints, per document, the latest mint winning", async () => {
    const handlers = [];
    const page = { on: (event, handler) => handlers.push([event, handler]) };
    const track = trackFrameGrants(page);
    assert.deepEqual(handlers.map(([event]) => event), ["response"]);
    const response = (url, method, body) => ({ url: () => url, request: () => ({ method: () => method }), json: async () => body });
    const emit = (r) => handlers[0][1](r);
    emit(response("http://localhost:1/api/v1/documents/DOC1/office/frame-token", "POST", { ai: { ai: false, uniwork_ai: false } }));
    emit(response("http://localhost:1/api/v1/documents/DOC1/office/frame-token", "POST", { ai: { ai: true, uniwork_ai: false } }));
    emit(response("http://localhost:1/api/v1/documents/DOC2/office/frame-token", "POST", { ai: { ai: false, uniwork_ai: true } }));
    emit(response("http://localhost:1/api/v1/documents/DOC3/office/frame-token", "GET", { ai: { ai: true } }));
    emit(response("http://localhost:1/api/v1/documents/DOC4/office/sessions", "POST", { ai: { ai: true } }));
    emit({ url: () => "http://localhost:1/api/v1/documents/DOC5/office/frame-token", request: () => ({ method: () => "POST" }), json: async () => { throw new Error("body is gone"); } });
    const grants = await track.settled();
    assert.deepEqual([...grants].sort(), [["DOC1", { ai: true, uniworkAi: false }], ["DOC2", { ai: false, uniworkAi: true }]]);
  });

  test("meta records the grant of a shot that carries one, and nothing for a shot that does not", () => {
    assert.deepEqual(metaEntry(ok({ png: Buffer.alloc(1), ai: true, uniworkAi: false })), { status: "ok", reason: "", size: undefined, canvasOnly: false, ai: true, uniworkAi: false });
    assert.equal("ai" in metaEntry(ok({ png: Buffer.alloc(1) })), false);
    const meta = buildMeta({ host: "web", forkSha: "x", pinVersion: "y", fixtures: { a: { status: "ok", reason: "", ai: false, uniworkAi: true }, b: { status: "ok", reason: "" }, c: { status: "failed", reason: "r" } } });
    assert.deepEqual(meta.fixtures.a, { status: "ok", reason: "", ai: false, uniworkAi: true });
    assert.deepEqual(meta.fixtures.b, { status: "ok", reason: "" });
    assert.deepEqual(meta.fixtures.c, { status: "failed", reason: "r" });
  });
});

describe("web frame install state", () => {
  test("a module is installed only when its pinned bundle verifies on disk", () => {
    const state = frameInstallState({ docs: { version: "0.1.0-x", gitSha: "x" }, pdf: null }, scratch("g706-frames-"));
    assert.deepEqual(state.docs, { version: "0.1.0-x", gitSha: "x", installed: false });
    assert.deepEqual(state.pdf, { version: "", gitSha: "", installed: false });
  });

  test("the real pins of this checkout all carry a version and the docs pin names the fork sha", () => {
    const state = frameInstallState(undefined, scratch("g706-frames-"));
    assert.equal(Object.keys(state).length, 6);
    for (const [module, entry] of Object.entries(state)) assert.match(entry.version, /^\d+\.\d+\.\d+-[0-9a-f]+$/, module);
    assert.match(state.docs.gitSha, /^[0-9a-f]{7,40}$/);
  });
});

// ---- browser-backed tests ---------------------------------------------------
/** Why the tests that decode PNGs cannot run (pngjs is a devDependency of packages/office-engine), or "" when they can. */
function pngjsSkipReason(load = loadPngjs) {
  try {
    load();
    return "";
  } catch (error) {
    return `pngjs is not installed (run pnpm install; or point NODE_PATH at a node_modules that has it): ${String(error.message).split("\n")[0]}`;
  }
}
const pngjsSkip = pngjsSkipReason();
if (pngjsSkip) console.log(`# SKIPPED the shot-comparing browser tests: ${pngjsSkip}`);

const playwright = loadPlaywright();
let browser = null;
let browserSkip = playwright ? "" : "Playwright is not resolvable from the e2e workspace (set G7_06_PLAYWRIGHT_FROM to a dir whose node_modules has it)";
if (playwright) {
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (error) {
    browserSkip = `Chromium cannot be launched here: ${String(error.message).split("\n")[0]}`;
  }
}
if (browserSkip) console.log(`# SKIPPED browser-backed capture tests: ${browserSkip}`);
else console.log(`# browser-backed capture tests run with ${playwright.from} ${playwright.version}`);
after(async () => { await browser?.close(); });

const STATIC_PAGE = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Báo cáo quý</title>
<style>body{font-family:sans-serif} .gone{display:none}</style></head><body>
<h1>Tiêu đề chính</h1><p>Đoạn văn tiếng Việt có dấu.</p>
<button aria-label="Lưu tài liệu">S</button><img alt="Biểu đồ doanh thu" width="10" height="10" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
<input placeholder="Tìm kiếm" title="Ô tìm">
<div class="gone" aria-label="ẩn nhãn">ẩn văn bản</div>
<span style="visibility:hidden" title="vô hình">vô hình</span>
<iframe title="khung" srcdoc="<!doctype html><title>Khung con</title><p>Văn bản trong khung</p><button aria-label='Nút trong khung'>x</button>"></iframe>
</body></html>`;

describe("browser-backed capture", { skip: browserSkip || false }, () => {
  async function withPage(html, fn, viewport = { width: 1720, height: 980 }) {
    const context = await browser.newContext({ viewport, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh", colorScheme: "light", reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.waitForFunction(() => document.querySelector("iframe") === null || document.querySelector("iframe").contentDocument?.readyState === "complete");
      return await fn(page);
    } finally {
      await context.close();
    }
  }

  test("collects title, body, visible attribute values and the iframe's text; leaves hidden things out", async () => {
    const { collectRenderedText } = await import("./capture/text.mjs");
    const { text, frames, skipped } = await withPage(STATIC_PAGE, collectRenderedText);
    assert.equal(skipped, 0);
    assert.equal(frames, 2);
    for (const wanted of ["Báo cáo quý", "Tiêu đề chính", "Đoạn văn tiếng Việt có dấu.", "Lưu tài liệu", "Biểu đồ doanh thu", "Tìm kiếm", "Ô tìm", "Khung con", "Văn bản trong khung", "Nút trong khung", "khung"]) {
      assert.ok(text.includes(wanted), `missing ${wanted} in ${JSON.stringify(text)}`);
    }
    for (const hidden of ["ẩn nhãn", "ẩn văn bản", "vô hình"]) assert.ok(!text.includes(hidden), `${hidden} should be left out`);
    assert.ok(!/about:srcdoc|http/.test(text), "no frame URL in the text");
  });

  test("a blank page yields (almost) no visible characters", async () => {
    const { collectRenderedText } = await import("./capture/text.mjs");
    const { text } = await withPage("<!doctype html><html><body></body></html>", collectRenderedText);
    assert.ok(visibleChars(text) < 20);
  });

  const FRAME_HOST = (state, extra = "") => `<!doctype html><html><body><main>
<section data-office-docs-frame data-office-module="docs" data-state="${state}">${extra}
<iframe title="Khung tài liệu" srcdoc="<!doctype html><title>Tài liệu</title><h1>Báo cáo quý I</h1><p>Doanh thu tăng trưởng ổn định.</p>"></iframe></section></main></body></html>`;

  test("captureOpenFrame: a ready frame region is captured, settled, with its text", async () => {
    const r = await withPage(FRAME_HOST("ready"), (page) => captureOpenFrame(page, "docs", { timeoutMs: 5_000, settleOptions: { intervalMs: 100, identicalFrames: 2, timeoutMs: 10_000 } }));
    assert.equal(r.status, "ok", r.reason);
    assert.equal(r.png.subarray(1, 4).toString(), "PNG");
    assert.match(r.text, /Báo cáo quý I/);
  });

  test("captureOpenFrame: a frame narrower than 1400 px fails frame_too_small (web at 1176 px cut the xlsx sheet's column G), never a shot", async () => {
    const narrow = await withPage(FRAME_HOST("ready"), (page) => captureOpenFrame(page, "docs", { timeoutMs: 5_000, settleOptions: QUICK }), { width: 1200, height: 800 });
    assert.equal(narrow.status, "failed");
    assert.match(narrow.reason, /^frame_too_small: .*1[0-9]{3}x[0-9]+ px.*1400/);
    assert.equal(narrow.png, undefined);
    const wide = await withPage(FRAME_HOST("ready"), (page) => captureOpenFrame(page, "docs", { timeoutMs: 5_000, settleOptions: QUICK }));
    assert.equal(wide.status, "ok", wide.reason);
    assert.ok(pngSize(wide.png).w >= MIN_FRAME_WIDTH, JSON.stringify(pngSize(wide.png)));
  });

  test("captureOpenFrame: the same page twice gives byte-identical shots (determinism of the settle + clip path)", async () => {
    const shoot = () => withPage(FRAME_HOST("ready"), (page) => captureOpenFrame(page, "docs", { timeoutMs: 5_000, settleOptions: { intervalMs: 100, identicalFrames: 2, timeoutMs: 10_000 } }));
    const [a, b] = [await shoot(), await shoot()];
    assert.equal(frameHash(a.png), frameHash(b.png));
  });

  test("captureOpenFrame: a failure notice is a FAILED fixture with its kind, not a shot of the notice", async () => {
    const notice = '<div data-testid="office-docs-frame-failed" data-failure-kind="load">Không tải được tài liệu</div>';
    const r = await withPage(`<main><section data-office-docs-frame data-office-module="docs" data-state="failed">${notice}</section></main>`, (page) => captureOpenFrame(page, "docs", { timeoutMs: 2_000 }));
    assert.equal(r.status, "failed");
    assert.match(r.reason, /frame_failed:load: Không tải được tài liệu/);
    assert.equal(r.png, undefined);
  });

  test("captureOpenFrame: no frame host at all is failed with the page's own words; booting forever is not_ready", async () => {
    const none = await withPage("<main><p>Trình soạn thảo web chưa được cài</p></main>", (page) => captureOpenFrame(page, "docs", { timeoutMs: 1_000 }));
    assert.equal(none.status, "failed");
    assert.match(none.reason, /no docs frame host.*Trình soạn thảo web chưa được cài/);
    const booting = await withPage(FRAME_HOST("booting"), (page) => captureOpenFrame(page, "docs", { timeoutMs: 1_000 }));
    assert.equal(booting.status, "failed");
    assert.match(booting.reason, /frame state stayed booting/);
  });

  test("captureOpenFrame: a spinner that never leaves is not_settled:still_busy, never a shot", async () => {
    const spinner = '<div role="progressbar" style="width:20px;height:20px">...</div>';
    const r = await withPage(FRAME_HOST("ready", spinner), (page) => captureOpenFrame(page, "docs", { timeoutMs: 2_000, settleOptions: { intervalMs: 50, identicalFrames: 2, timeoutMs: 600 } }));
    assert.equal(r.status, "failed");
    assert.match(r.reason, /not_settled:still_busy/);
  });

  const QUICK = { intervalMs: 100, identicalFrames: 2, quietMs: 300, timeoutMs: 10_000 };
  const timed = (extra, script) => `<!doctype html><html><body><main>
<section data-office-docs-frame data-office-module="docs" data-state="ready">${extra}
<iframe title="Khung tài liệu" srcdoc="<!doctype html><title>Tài liệu</title><h1>Báo cáo quý I</h1><p>Doanh thu tăng trưởng ổn định.</p>"></iframe></section></main><script>${script}</script></body></html>`;

  test("captureOpenFrame: waits out an in-progress status message and shoots the finished one (round 1: 5177 px apart)", async () => {
    const page = timed(
      '<span class="status-msg" role="status">Đang tải theo luồng a.xlsx: 9 hàng khả dụng.</span>',
      'setTimeout(function () { document.querySelector(".status-msg").textContent = "Đã tải đầy đủ sổ làm việc."; }, 1200);',
    );
    const r = await withPage(page, (p) => captureOpenFrame(p, "docs", { timeoutMs: 5_000, settleOptions: QUICK }));
    assert.equal(r.status, "ok", r.reason);
    assert.match(r.hostText, /Đã tải đầy đủ sổ làm việc\./);
    assert.ok(!/Đang tải theo luồng/.test(r.hostText), r.hostText);
  });

  test("captureOpenFrame: a toast that fades is waited out, not masked: the shot is the one without it", { skip: pngjsSkip || false }, async () => {
    const page = timed('<div class="toast" style="position:absolute;top:0;right:0">Đã mở tài liệu</div>', 'setTimeout(function () { document.querySelector(".toast").remove(); }, 1200);');
    const clean = await withPage(timed("", ""), (p) => captureOpenFrame(p, "docs", { timeoutMs: 5_000, settleOptions: QUICK }));
    const r = await withPage(page, (p) => captureOpenFrame(p, "docs", { timeoutMs: 5_000, settleOptions: QUICK }));
    assert.equal(r.status, "ok", r.reason);
    assert.ok(!r.hostText.includes("Đã mở tài liệu"), r.hostText);
    // two page loads can differ by a few anti-aliased glyph pixels (the job's golden tolerance exists for that); a toast would be a block
    const { PNG } = loadPngjs();
    const [x, y] = [PNG.sync.read(r.png), PNG.sync.read(clean.png)];
    assert.deepEqual([x.width, x.height], [y.width, y.height]);
    let changed = 0;
    for (let i = 0; i < x.data.length; i += 4) if (Math.abs(x.data[i] - y.data[i]) > 16 || Math.abs(x.data[i + 1] - y.data[i + 1]) > 16 || Math.abs(x.data[i + 2] - y.data[i + 2]) > 16) changed += 1;
    assert.ok(changed / (x.width * x.height) < 0.001, `the shot taken after the toast went differs from a page that never had one by ${changed} px`);
  });

  test("captureOpenFrame: a notification that never goes fails the fixture and says which", async () => {
    const page = timed('<div role="alert">Không lưu được</div>', "");
    const r = await withPage(page, (p) => captureOpenFrame(p, "docs", { timeoutMs: 2_000, settleOptions: { ...QUICK, timeoutMs: 800 } }));
    assert.equal(r.status, "failed");
    assert.match(r.reason, /not_settled:still_busy \(notification "Không lưu được"\)/);
  });

  test("captureOpenFrame: a finished status message and an ordinary live region do not hold the shot", async () => {
    const page = timed('<span role="status">Đã tải đầy đủ sổ làm việc.</span><div aria-live="polite">Tổng cộng 12 hàng</div>', "");
    const r = await withPage(page, (p) => captureOpenFrame(p, "docs", { timeoutMs: 2_000, settleOptions: QUICK }));
    assert.equal(r.status, "ok", r.reason);
  });

  test("PROGRESS_TEXT reads Vietnamese and English in-progress messages, not finished ones", () => {
    for (const busy of ["Đang tải theo luồng a.xlsx: 9 hàng khả dụng.", "Đang mở sổ làm việc", "Loading workbook", "Đang lập chỉ mục a: 3 hàng đã sẵn sàng.", "Saving…"]) assert.ok(PROGRESS_TEXT.test(busy), busy);
    for (const done of ["Đã tải đầy đủ sổ làm việc — công thức tính toán trực tiếp.", "Sẵn sàng", "Đã lưu", "Tổng cộng 12 hàng"]) assert.ok(!PROGRESS_TEXT.test(done), done);
  });

  test("web: the .txt is the module frame's text only; a blank frame under a busy host page has no rendered text (FS-1)", async () => {
    const shell = '<nav>Thư viện tài liệu</nav><h2>Báo cáo quý I.docx</h2><p>Trang chủ / Tài liệu / Báo cáo quý I</p>';
    const blankFrame = `<!doctype html><html><body><main>${shell}
<section data-office-docs-frame data-office-module="docs" data-state="ready"><iframe title="Khung tài liệu" srcdoc="<!doctype html><html><body></body></html>"></iframe></section></main></body></html>`;
    const blank = await withPage(blankFrame, (page) => captureOpenFrame(page, "docs", { timeoutMs: 5_000, settleOptions: QUICK }));
    assert.equal(blank.status, "ok", blank.reason);
    assert.ok(visibleChars(blank.text) < 20, `a blank frame must read as blank, got ${JSON.stringify(blank.text)}`);
    assert.match(blank.hostText, /Thư viện tài liệu/);
    assert.match(blank.hostText, /Báo cáo quý I\.docx/);
    const full = await withPage(FRAME_HOST("ready"), (page) => captureOpenFrame(page, "docs", { timeoutMs: 5_000, settleOptions: QUICK }));
    assert.match(full.text, /Báo cáo quý I/);
    const fullWithShell = await withPage(`${shell}${FRAME_HOST("ready")}`, (page) => captureOpenFrame(page, "docs", { timeoutMs: 5_000, settleOptions: QUICK }));
    assert.ok(!fullWithShell.text.includes("Thư viện tài liệu"), "host text must not be in the module .txt");
    assert.ok(fullWithShell.hostText.includes("Thư viện tài liệu"));
  });

  const EXOTIC = `<!doctype html><html><head><meta charset="utf-8"><style>
.tag::before{content:"Trước-"} .tag::after{content:" -sau"} .art::before{content:attr(data-x) "Chữ giả "}
</style></head><body>
<p class="tag">giữa</p>
<div id="host"></div>
<input value="Giá trị ô nhập" aria-label="ô"><input type="password" value="matkhau-bi-mat"><textarea>Nội dung vùng văn bản</textarea>
<select><option>Một</option><option selected>Lựa chọn hai</option></select>
<svg width="200" height="40"><text x="5" y="20">Nhãn SVG</text></svg>
<script>
const root = document.getElementById("host").attachShadow({ mode: "open" });
root.innerHTML = '<p>Chữ trong shadow</p><button aria-label="Nút shadow">x</button><div id="inner"></div>';
root.getElementById("inner").attachShadow({ mode: "open" }).innerHTML = "<span>Shadow lồng</span>";
</script></body></html>`;

  test("collects open shadow roots (nested too), ::before / ::after content, input / textarea / select values and SVG text; never a password (FS-4)", async () => {
    const { text } = await withPage(EXOTIC, collectRenderedText);
    for (const wanted of ["Trước-", "-sau", "Giá trị ô nhập", "Nội dung vùng văn bản", "Lựa chọn hai", "Nhãn SVG", "Chữ trong shadow", "Nút shadow", "Shadow lồng", "giữa"]) {
      assert.ok(text.includes(wanted), `missing ${wanted} in ${JSON.stringify(text)}`);
    }
    assert.ok(!text.includes("matkhau-bi-mat"), "a password value must never be recorded");
  });

  test("brand text that only exists in a shadow root, a pseudo-element or an input value reaches the text (what the brand check reads)", async () => {
    const page = `<!doctype html><style>.p::after{content:"GenOffice"}</style><p class="p">a</p><input value="GenSpark"><div id="h"></div><script>document.getElementById("h").attachShadow({mode:"open"}).innerHTML="<b>Gen Office</b>"</script>`;
    const { text } = await withPage(page, collectRenderedText);
    for (const brand of ["GenOffice", "GenSpark", "Gen Office"]) assert.ok(text.includes(brand), brand);
  });

  test("a frame that paints mainly into a canvas says so (canvasOnly); an ordinary page does not (FS-9)", async () => {
    const canvasPage = '<!doctype html><body style="margin:0"><canvas width="780" height="500" style="display:block"></canvas></body>';
    const SMALL = { width: 800, height: 600 };
    const canvas = await withPage(canvasPage, collectRenderedText, SMALL);
    assert.equal(canvas.canvasOnly, true);
    assert.ok(canvas.canvasRatio >= 0.5);
    const plain = await withPage(STATIC_PAGE, collectRenderedText, SMALL);
    assert.equal(plain.canvasOnly, false);
    const small = await withPage('<!doctype html><p>chữ</p><canvas width="40" height="40"></canvas>', collectRenderedText, SMALL);
    assert.equal(small.canvasOnly, false);
  });

  test("the Next dev overlay (a toast-like badge in a nextjs-portal shadow root) neither holds the shot nor lands in the text", async () => {
    const page = '<!doctype html><p>chữ</p><nextjs-portal></nextjs-portal><script>document.querySelector("nextjs-portal").attachShadow({mode:"open"}).innerHTML=\'<div class="nextjs-toast" style="width:36px;height:36px">[data-next-badge-root]{--x:1}</div>\'</script>';
    assert.equal(await withPage(page, (p) => pageIsBusy(p)), false);
    const { text } = await withPage(page, collectRenderedText);
    assert.ok(!text.includes("data-next-badge-root"), text);
  });

  test("a spinner inside a shadow root counts as busy (FS-6)", async () => {
    const page = '<!doctype html><div id="h"></div><script>document.getElementById("h").attachShadow({mode:"open"}).innerHTML=\'<div role="progressbar" style="width:20px;height:20px">...</div>\'</script>';
    const busy = await withPage(page, (p) => pageIsBusy(p));
    assert.match(String(busy), /spinner progressbar/);
    assert.equal(await withPage("<!doctype html><p>xong</p>", (p) => pageIsBusy(p)), false);
  });

  test("readFrameState reports the module's own host only", async () => {
    const state = await withPage(FRAME_HOST("ready"), (page) => page.evaluate(readFrameState, "sheets"));
    assert.equal(state.state, "none");
  });
});

// ---- web sign-in (round 1: every web fixture failed on waitForURL) -----------
/**
 * A login page like D's: server-rendered inputs, a submit handler that exists
 * only once the page "hydrates" (React marks the input with __reactProps$...).
 * Before that a click is a native GET submit, which is what the unhydrated
 * `next dev` page did in the cloud round.
 */
function fakeLoginSite({ hydrateAfterMs, handler = "home" }) {
  const wire = hydrateAfterMs === null ? "" : `setTimeout(function () {
    document.getElementById("e").__reactProps$x = {};
    ${handler === "native" ? "" : `document.getElementById("f").addEventListener("submit", function (ev) {
      ev.preventDefault();
      ${handler === "reject" ? 'document.getElementById("msg").textContent = "Email hoặc mật khẩu không đúng";' : 'location.href = "/home";'}
    });`}
  }, ${hydrateAfterMs});`;
  const login = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Đăng nhập</title></head><body><main><h1>Đăng nhập UniWork</h1>
<form id="f" method="get" action="/login"><label for="e">Email</label><input id="e" name="email" type="email">
<label for="p">Mật khẩu</label><input id="p" name="password" type="password"><button type="submit">Đăng nhập</button></form>
<div id="msg" role="alert"></div></main><script>${wire}</script></body></html>`;
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(req.url.startsWith("/home") ? "<!doctype html><title>Trang chủ</title><h1>Trang chủ</h1>" : login);
  });
  return new Promise((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

describe("web sign-in", () => {
  test("redactUrl keeps the path and the names of the query fields, never their values", () => {
    assert.equal(redactUrl("http://x/login?email=a%40b.c&password=hunter2"), "/login?email=…&password=…");
    assert.equal(redactUrl("http://x/vi/ws"), "/vi/ws");
    assert.equal(redactUrl("not a url"), "(unreadable url)");
  });
});

describe("web sign-in in a browser", { skip: browserSkip || false }, () => {
  const seed = { email: "g7-06-capture@example.com", password: "hunter2-secret" };
  async function withLogin(options, fn) {
    const site = await fakeLoginSite(options);
    const context = await browser.newContext({ locale: "vi-VN" });
    try {
      return await fn(await context.newPage(), site.origin);
    } finally {
      await context.close();
      site.server.close();
    }
  }

  test("waits for the form to hydrate before it fills and clicks (a click before it is a native GET, the round 1 failure)", async () => {
    await withLogin({ hydrateAfterMs: 1_500 }, async (page, origin) => {
      await signIn(page, origin, seed, { hydrateTimeoutMs: 10_000, loginTimeoutMs: 5_000 });
      assert.equal(new URL(page.url()).pathname, "/home");
    });
  });

  test("a page that never hydrates fails fast, names why, and the message carries the URL and heading", async () => {
    await withLogin({ hydrateAfterMs: null }, async (page, origin) => {
      await assert.rejects(signIn(page, origin, seed, { hydrateTimeoutMs: 600, loginTimeoutMs: 600 }), (error) => {
        assert.match(error.message, /did not hydrate within 0\.6s/);
        assert.match(error.message, /127\.0\.0\.1.*localhost/);
        assert.match(error.message, /url \/login,/);
        assert.match(error.message, /heading "Đăng nhập UniWork"/);
        assert.ok(!error.message.includes("\n"), "one line, the reason of a meta.json entry");
        return true;
      });
    });
  });

  test("a form that hydrated but still submits natively reports the URL reached with the query values hidden", async () => {
    await withLogin({ hydrateAfterMs: 0, handler: "native" }, async (page, origin) => {
      await assert.rejects(signIn(page, origin, seed, { hydrateTimeoutMs: 5_000, loginTimeoutMs: 800 }), (error) => {
        assert.match(error.message, /url \/login\?email=…&password=…,/);
        assert.ok(!error.message.includes(seed.password), "the password must not leak into a reason");
        assert.ok(!error.message.includes(encodeURIComponent(seed.email)), "nor the email");
        return true;
      });
    });
  });

  test("a rejected login reports the alert text the page shows", async () => {
    await withLogin({ hydrateAfterMs: 0, handler: "reject" }, async (page, origin) => {
      await assert.rejects(signIn(page, origin, seed, { hydrateTimeoutMs: 5_000, loginTimeoutMs: 800 }), /url \/login, heading "Đăng nhập UniWork", notice "Email hoặc mật khẩu không đúng"/);
    });
  });
});

// ---- sign-in diagnostics without a browser ---------------------------------
describe("sign-in failure message", () => {
  test("the password is redacted every time it occurs in the error line, not only the first (N-4)", async () => {
    const seed = { email: "g7-06-capture@example.com", password: "hunter2-secret" };
    const field = { fill: async () => { throw new Error(`locator.fill: bad value ${seed.password} while typing ${seed.password}\n  call log`); } };
    const page = {
      goto: async () => {},
      waitForFunction: async () => {},
      getByLabel: () => field,
      evaluate: async () => ({ title: "", heading: "Đăng nhập", notices: [] }),
      url: () => "http://x/login",
    };
    await assert.rejects(signIn(page, "http://x", seed), (error) => {
      assert.ok(!error.message.includes(seed.password), error.message);
      assert.equal(error.message.split("<password>").length - 1, 2, error.message);
      return true;
    });
  });
});

// ---- the browser suite's own prerequisites ---------------------------------
describe("browser suite prerequisites", () => {
  test("a missing pngjs gives a printed skip reason, not a failing test (N-6)", () => {
    const reason = pngjsSkipReason(() => { throw new Error("Cannot find module 'pngjs'"); });
    assert.match(reason, /pngjs is not installed.*Cannot find module/);
    assert.equal(pngjsSkipReason(() => ({})), "");
  });
});
