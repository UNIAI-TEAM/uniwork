// harness/web.mjs (G8-19, UNI-1414): the Inbox URL rule, the login form, and
// how a document page reading becomes ok / no-access / not-found / error.
import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyDocumentPage, classifyWebSave, documentUrl, openDocument, webFrameEval, webFrameSelectors, webLogin, webSave } from "./web.mjs";

test("documentUrl mirrors resource-href.ts: comment rides as ?comment=, kind=discussion only with a comment", () => {
  const base = { webOrigin: "http://127.0.0.1:3000", org: "acme", ws: "w2", documentId: "D1" };
  assert.equal(documentUrl(base), "http://127.0.0.1:3000/acme/w2/documents/D1");
  assert.equal(documentUrl({ ...base, comment: "C1" }), "http://127.0.0.1:3000/acme/w2/documents/D1?comment=C1");
  assert.equal(documentUrl({ ...base, comment: "C1", kind: "discussion" }), "http://127.0.0.1:3000/acme/w2/documents/D1?comment=C1&kind=discussion");
  assert.equal(documentUrl({ ...base, kind: "discussion" }), "http://127.0.0.1:3000/acme/w2/documents/D1");
  assert.throws(() => documentUrl({ ...base, ws: "" }), /ws is required/);
});

test("classifyDocumentPage: S15 states, the panel with the named thread highlighted, and not-yet-settled", () => {
  assert.deepEqual(classifyDocumentPage({ state: "no_access", panes: 0 }), { status: "no-access", panelCount: 0, focusedCommentId: null });
  assert.deepEqual(classifyDocumentPage({ state: "gone", panes: 0 }), { status: "not-found", panelCount: 0, focusedCommentId: null });
  assert.deepEqual(classifyDocumentPage({ state: null, panes: 1, focusedCommentId: "C1", loading: false }, { comment: "C1" }), { status: "ok", panelCount: 1, focusedCommentId: "C1" });
  assert.equal(classifyDocumentPage({ state: null, panes: 1, focusedCommentId: null, loading: false }, { comment: "C1" }), null);
  assert.equal(classifyDocumentPage({ state: null, panes: 1, loading: true }), null);
  assert.equal(classifyDocumentPage(null), null);
});

function fakePage(readings) {
  const visited = [];
  return {
    visited,
    async goto(url) {
      visited.push(url);
    },
    async evaluate() {
      return readings.length > 1 ? readings.shift() : readings[0];
    },
  };
}

test("openDocument goes to the Inbox URL and waits for a settled reading; a page that never settles is an error with the reason", async () => {
  const page = fakePage([{ panes: 0, loading: true }, { panes: 1, focusedCommentId: "C1", loading: false }]);
  const opened = await openDocument(page, { webOrigin: "http://w", org: "o", ws: "w", documentId: "D", comment: "C1", pollMs: 1 });
  assert.deepEqual(opened, { url: "http://w/o/w/documents/D?comment=C1", status: "ok", panelCount: 1, focusedCommentId: "C1" });
  const framed = await openDocument(fakePage([{ panes: 0, frame: true }]), { webOrigin: "http://w", org: "o", ws: "w", documentId: "D", timeoutMs: 20, pollMs: 1 });
  assert.equal(framed.status, "error");
  assert.match(framed.reason, /Office frame is shown without a D comment panel/);
});

/**
 * A scripted /login page. `onClick(n, page)` runs on the n-th click of the submit button (1-based) and may call
 * `page.answer(status, code)` (the API answers) and `page.navigate(path)`. `hydrated` is what the hydration probe reads.
 */
const loginRequest = { method: () => "POST", url: () => "http://api.test/api/v1/auth/login" };

function loginPage({ onClick = () => {}, hydrated = true, alerts = "" } = {}) {
  const handlers = { request: [], response: [] };
  const log = [];
  let url = "about:blank";
  let clicks = 0;
  const page = {
    log,
    on: (event, fn) => handlers[event].push(fn),
    url: () => url,
    goto: async (to) => {
      log.push(["goto", to]);
      url = to;
    },
    reload: async () => log.push(["reload"]),
    locator: (sel) => ({
      first: () => ({
        waitFor: async () => {},
        fill: async (v) => log.push([sel.includes("email") ? "email" : "password", v]),
        click: async () => {
          clicks += 1;
          log.push(["click"]);
          await onClick(clicks, page);
        },
      }),
    }),
    evaluate: async (fn) => {
      if (fn.name === "loginFormHydrated") return hydrated;
      if (fn.name === "readLoginAlerts") return alerts;
      throw new Error(`unexpected evaluate ${fn.name}`);
    },
    waitForURL: async () => {
      throw new Error("page.waitForURL: Timeout 30000ms exceeded.");
    },
    navigate: (path) => {
      url = `http://web.test${path}`;
    },
    send: () => {
      for (const fn of handlers.request) fn(loginRequest);
    },
    answer: (status, code = null) => {
      const request = loginRequest;
      for (const fn of handlers.request) fn(request);
      for (const fn of handlers.response) fn({ request: () => request, url: () => request.url(), status: () => status, json: async () => (code ? { error: { code } } : {}) });
    },
  };
  return page;
}

function loginBrowser(page, cookies = [], closed = []) {
  return { newContext: async () => ({ addCookies: async (c) => cookies.push(...c), newPage: async () => page, close: async () => closed.push(true) }) };
}

const LOGIN_USER = { key: "B", email: "b@x.test", password: "pw-secret-123" };
const FAST = { webOrigin: "http://web.test", timeoutMs: 200, attemptMs: 30, hydrateMs: 10, pollMs: 2 };

test("webLogin fills the /login form with the user's credentials and sets the locale cookie per context", async () => {
  const cookies = [];
  const page = loginPage({ onClick: (_n, p) => { p.answer(200); p.navigate("/o/w"); } });
  const web = await webLogin(loginBrowser(page, cookies), LOGIN_USER, { ...FAST, webOrigin: "http://127.0.0.1:3000", locale: "vi" });
  assert.deepEqual(page.log, [["goto", "http://127.0.0.1:3000/login"], ["email", "b@x.test"], ["password", "pw-secret-123"], ["click"]]);
  assert.deepEqual(cookies[0], { name: "uniwork-locale", value: "vi", domain: "127.0.0.1", path: "/" });
  await web.setLocale("en");
  assert.equal(web.locale, "en");
  assert.equal(cookies[1].value, "en");
  await assert.rejects(webLogin(loginBrowser(page), { key: "Z" }, { webOrigin: "http://x" }), /no credentials/);
});

test("webLogin never ends in a bare waitForURL timeout: a 429 from the harness's own login volume is named as a harness failure", async () => {
  const closed = [];
  const page = loginPage({ onClick: (_n, p) => p.answer(429, "rate_limited"), alerts: "Too many attempts, wait a minute" });
  const err = await webLogin(loginBrowser(page, [], closed), LOGIN_USER, FAST).catch((e) => e);
  assert.ok(err instanceof Error, "rejects");
  assert.match(err.message, /web login as B: POST \/auth\/login answered 429 rate_limited/);
  assert.match(err.message, /harness/);
  assert.match(err.message, /Too many attempts, wait a minute/);
  assert.doesNotMatch(err.message, /waitForURL/);
  assert.equal(page.log.filter(([k]) => k === "click").length, 1, "an answered refusal is not retried");
  assert.deepEqual(closed, [true], "the failed login closes its context");
});

test("webLogin: a 401 names its code and the visible error text is redacted (no email, no password)", async () => {
  const page = loginPage({
    onClick: (_n, p) => p.answer(401, "invalid_credentials"),
    alerts: `Wrong password pw-secret-123 for b@x.test token ${"a".repeat(40)}`,
  });
  const err = await webLogin(loginBrowser(page), LOGIN_USER, FAST).catch((e) => e);
  assert.match(err.message, /answered 401 invalid_credentials/);
  assert.doesNotMatch(err.message, /harness failure/);
  assert.doesNotMatch(err.message, /pw-secret-123|b@x\.test|a{40}/);
  assert.match(err.message, /<password>.*<email>/);
});

test("webLogin: a click that sent no request (form not hydrated yet) is retried on a fresh /login and then succeeds", async () => {
  const page = loginPage({
    hydrated: false,
    onClick: (n, p) => {
      if (n < 2) return;
      p.answer(200);
      p.navigate("/o/w");
    },
  });
  await webLogin(loginBrowser(page), LOGIN_USER, FAST);
  assert.equal(page.log.filter(([k]) => k === "click").length, 2);
  assert.equal(page.log.filter(([k]) => k === "goto").length, 2, "the retry loads a clean /login (a native submit can leave credentials in the query)");
});

test("webLogin: no login request in every attempt fails with the attempts, the hydration state and the path only", async () => {
  const closed = [];
  const page = loginPage({ hydrated: false });
  const err = await webLogin(loginBrowser(page, [], closed), LOGIN_USER, { ...FAST, attempts: 3 }).catch((e) => e);
  assert.match(err.message, /web login as B: no POST \/auth\/login was sent in 3 submit attempts/);
  assert.match(err.message, /form hydrated: no/);
  assert.match(err.message, /page \/login/);
  assert.doesNotMatch(err.message, /waitForURL|\?/);
  assert.deepEqual(closed, [true]);
});

test("webLogin: a 200 answer that leaves the page on /login is named, not left to a URL timeout", async () => {
  const page = loginPage({ onClick: (_n, p) => p.answer(200) });
  const err = await webLogin(loginBrowser(page), LOGIN_USER, FAST).catch((e) => e);
  assert.match(err.message, /answered 200 but the page stayed on \/login/);
  assert.doesNotMatch(err.message, /waitForURL/);
});

test("webLogin: a login request that is never answered is named as such", async () => {
  const page = loginPage({ onClick: (_n, p) => p.send() });
  const err = await webLogin(loginBrowser(page), LOGIN_USER, FAST).catch((e) => e);
  assert.match(err.message, /POST \/auth\/login was sent but not answered/);
  assert.equal(page.log.filter(([k]) => k === "click").length, 1, "a request that left is never re-sent");
});

// ---- webSave (contract §13, additive) ----------------------------------------------------

function fakeFramePage({ ready = true, dirty = true, commit = { status: 200, body: { revision: "2", file: { version_id: "V2", version: 2 } } }, saveState = "saved" } = {}) {
  const log = [];
  return {
    log,
    async waitForSelector(sel, opts) {
      log.push(["waitForSelector", sel, opts?.timeout]);
      if (!ready) throw new Error("Timeout exceeded");
      return {};
    },
    async evaluate(fn, arg) {
      log.push(["evaluate", arg]);
      if (arg?.read) return { dirty, saveState };
      return true;
    },
    async waitForResponse(pred, opts) {
      log.push(["waitForResponse", opts?.timeout]);
      if (!commit) throw new Error("Timeout exceeded");
      const res = {
        url: () => "http://w/api/v1/office-frame/documents/D1/versions/commit",
        request: () => ({ method: () => "POST" }),
        status: () => commit.status,
        json: async () => commit.body,
      };
      assert.equal(pred(res), true, "the predicate accepts the frame commit");
      assert.equal(pred({ ...res, url: () => "http://w/api/v1/office-frame/documents/D1/uploads" }), false);
      assert.equal(pred({ ...res, request: () => ({ method: () => "GET" }) }), false);
      return res;
    },
    keyboard: { press: async (key) => log.push(["press", key]) },
  };
}

test("webFrameSelectors names the module frame host, its ready state and its iframe (office-module-frame.tsx:309-333)", () => {
  assert.deepEqual(webFrameSelectors("sheets"), {
    host: '[data-office-docs-frame][data-office-module="sheets"]',
    ready: '[data-office-docs-frame][data-office-module="sheets"][data-state="ready"]',
    iframe: '[data-office-docs-frame][data-office-module="sheets"] iframe[data-testid="office-docs-frame-iframe"]',
  });
  assert.throws(() => webFrameSelectors("markdown"), /kind must be one of docs, sheets, slides, pdf/);
});

test("classifyWebSave: a 2xx commit is saved with the new version id; anything else names why", () => {
  assert.deepEqual(classifyWebSave({ httpStatus: 200, body: { revision: "3", file: { version_id: "V3", version: 3 } } }), { status: "saved", versionId: "V3", revision: "3", version: 3 });
  assert.deepEqual(classifyWebSave({ httpStatus: 409, body: { error: { code: "document_version_conflict" } } }), { status: "error", httpStatus: 409, reason: "the frame commit answered 409 document_version_conflict" });
  assert.deepEqual(classifyWebSave({ httpStatus: 200, body: null }), { status: "error", httpStatus: 200, reason: "the frame commit answered 200 with no version id" });
  assert.deepEqual(classifyWebSave({ httpStatus: null, dirty: false, saveState: "ready" }), { status: "timeout", reason: "no frame commit within the bound (the frame was not dirty; save state ready)" });
  assert.deepEqual(classifyWebSave({ httpStatus: null, dirty: true, saveState: "error" }), { status: "timeout", reason: "no frame commit within the bound (save state error)" });
});

test("webSave waits for the ready frame, focuses its iframe, presses Control+s and reads the commit answer", async () => {
  const page = fakeFramePage();
  assert.deepEqual(await webSave(page, { kind: "docs", timeoutMs: 5_000 }), { status: "saved", versionId: "V2", revision: "2", version: 2 });
  assert.deepEqual(page.log[0], ["waitForSelector", webFrameSelectors("docs").ready, 5_000]);
  const pressed = page.log.findIndex((e) => e[0] === "press");
  assert.equal(page.log[pressed][1], "Control+s");
  assert.ok(page.log.findIndex((e) => e[0] === "waitForResponse") < pressed, "the response wait starts before the key press");
  assert.ok(page.log.some((e) => e[0] === "evaluate" && e[1]?.focus === webFrameSelectors("docs").iframe), "the iframe is focused first");
});

test("webSave: a frame that never gets ready, a commit that never comes and a refused commit are not saved", async () => {
  const notReady = await webSave(fakeFramePage({ ready: false }), { kind: "pdf", timeoutMs: 10 });
  assert.equal(notReady.status, "error");
  assert.match(notReady.reason, /pdf frame did not become ready/);
  const silent = await webSave(fakeFramePage({ commit: null, dirty: false, saveState: "ready" }), { kind: "slides", timeoutMs: 10 });
  assert.deepEqual(silent, { status: "timeout", reason: "no frame commit within the bound (the frame was not dirty; save state ready)" });
  const refused = await webSave(fakeFramePage({ commit: { status: 409, body: { error: { code: "document_version_conflict" } } } }), { kind: "sheets" });
  assert.equal(refused.status, "error");
  assert.equal(refused.httpStatus, 409);
  await assert.rejects(webSave(fakeFramePage(), { kind: "html" }), /kind must be one of/);
});

test("webFrameEval runs a function inside the module frame's document, bounded", async () => {
  const calls = [];
  const frame = { evaluate: async (fn, arg) => (calls.push(arg), fn(arg)) };
  const page = { $: async (sel) => (calls.push(sel), { contentFrame: async () => frame }) };
  assert.equal(await webFrameEval(page, "docs", (x) => x + 1, 41, { timeoutMs: 100 }), 42);
  assert.deepEqual(calls, [webFrameSelectors("docs").iframe, 41]);
  const stuck = { $: async () => ({ contentFrame: async () => ({ evaluate: () => new Promise(() => {}) }) }) };
  await assert.rejects(webFrameEval(stuck, "docs", () => 0, null, { timeoutMs: 20 }), /did not settle within 20 ms/);
  await assert.rejects(webFrameEval({ $: async () => null }, "sheets", () => 0), /no sheets frame on the page/);
});
