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
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs, runCapture } from "./capture.mjs";
import { SETTLE } from "./capture/constants.mjs";
import { desktopEnv, desktopPrecondition } from "./capture/desktop.mjs";
import { readFixtures, selectFixtures } from "./capture/fixtures.mjs";
import { blocked, buildMeta, clearCapture, exitCodeFor, failed, ok, writeCapture } from "./capture/meta.mjs";
import { loadPlaywright } from "./capture/playwright.mjs";
import { readRun } from "./capture/run-dir.mjs";
import { cleanupSeed, seedWorkspace } from "./capture/seed.mjs";
import { frameHash, settle } from "./capture/settle.mjs";
import { frameBlock, joinBlocks, visibleChars } from "./capture/text.mjs";
import { redactUrl, signIn } from "./capture/signin.mjs";
import { frameInstallState, captureOpenFrame, readFrameState } from "./capture/web.mjs";

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
    assert.deepEqual(meta.viewport, { w: 1440, h: 900 });
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

  test("the SETTLE budget needs two identical frames", () => {
    assert.ok(SETTLE.identicalFrames >= 2);
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

  test("with no reusable app every fixture is blocked and nothing is launched", async () => {
    const run = runDirWith({ "ports.env": "API_ORIGIN=http://127.0.0.1:1\n", "start-status.json": '{"state":"up"}' });
    const out = scratch();
    const fake = { _electron: { launch: () => { throw new Error("must not launch"); } }, chromium: {} };
    const { exitCode, meta } = await runCapture({ host: "desktop", out, fixtures: readFixtures(), runDir: run, playwright: fake });
    assert.equal(exitCode, 77);
    assert.ok(Object.values(meta.fixtures).every((f) => f.status === "blocked" && /ELECTRON_BIN/.test(f.reason)));
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
      const cleaned = await cleanupSeed({ apiOrigin: api.origin, seed });
      assert.equal(cleaned.ok, true);
      assert.deepEqual(JSON.parse(api.calls.at(-1).body), { confirm_slug: "o-x" });
    } finally {
      api.server.close();
    }
  });

  test("a refused call surfaces as an error naming the request, and a failed cleanup does not throw", async () => {
    const api = await fakeApi();
    try {
      await assert.rejects(seedWorkspace({ apiOrigin: `${api.origin}/wrong`, fixtures: [] }), /-> 404/);
      const cleaned = await cleanupSeed({ apiOrigin: api.origin, seed: { organization: { id: "other", slug: "s" }, token: "t", email: "e@x" } });
      assert.equal(cleaned.ok, false);
    } finally {
      api.server.close();
    }
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
  async function withPage(html, fn) {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 }, locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh", colorScheme: "light", reducedMotion: "reduce" });
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
