// harness/web.mjs (G8-19, UNI-1414): the Inbox URL rule, the login form, and
// how a document page reading becomes ok / no-access / not-found / error.
import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyDocumentPage, documentUrl, openDocument, webLogin } from "./web.mjs";

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

test("webLogin fills the /login form with the user's credentials and sets the locale cookie per context", async () => {
  const filled = [];
  const cookies = [];
  const page = {
    goto: async (url) => filled.push(["goto", url]),
    locator: (sel) => ({
      first: () => ({
        waitFor: async () => {},
        fill: async (v) => filled.push([sel.includes("email") ? "email" : "password", v]),
        click: async () => filled.push(["click"]),
      }),
    }),
    waitForURL: async () => {},
  };
  const browser = { newContext: async () => ({ addCookies: async (c) => cookies.push(...c), newPage: async () => page, close: async () => {} }) };
  const web = await webLogin(browser, { key: "B", email: "b@x.test", password: "pw" }, { webOrigin: "http://127.0.0.1:3000", locale: "vi" });
  assert.deepEqual(filled, [["goto", "http://127.0.0.1:3000/login"], ["email", "b@x.test"], ["password", "pw"], ["click"]]);
  assert.deepEqual(cookies[0], { name: "uniwork-locale", value: "vi", domain: "127.0.0.1", path: "/" });
  await web.setLocale("en");
  assert.equal(web.locale, "en");
  assert.equal(cookies[1].value, "en");
  await assert.rejects(webLogin(browser, { key: "Z" }, { webOrigin: "http://x" }), /no credentials/);
});
