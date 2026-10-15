// harness/app.mjs (G8-19, UNI-1414) against a fake CDP browser whose pages run
// the evaluated functions on a fake `window`: the bounded step and its timeout
// record, editor page selection by URL, the comment/discussion bridges calling
// only the fork's preload names, the sign-in through desktop consent with the
// org-choice reading, the deep-link open, focus and selection.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, test } from "node:test";

import {
  COMMENTS_API_NAMES,
  DISCUSSION_API_NAMES,
  SHELL_API_NAMES,
  connectApp,
  countOrgScopedRequests,
  editorKindOfFormat,
  editorKindOfUrl,
  sanitizeAccountStatus,
} from "./app.mjs";

// ---- fake browser -----------------------------------------------------------

function fakePage(url, win, { hang = false } = {}) {
  const calls = [];
  return {
    calls,
    url: () => url,
    async evaluate(fn, arg) {
      calls.push(arg);
      if (hang) return new Promise(() => {});
      const saved = globalThis.window;
      globalThis.window = win;
      try {
        return await fn(arg);
      } finally {
        if (saved === undefined) delete globalThis.window;
        else globalThis.window = saved;
      }
    },
  };
}
function fakeBrowser(pages) {
  let closed = 0;
  return {
    contexts: () => [{ pages: () => pages }],
    close: async () => {
      closed += 1;
    },
    get closed() {
      return closed;
    },
  };
}

let runDir;
let userData;
let portsEnv;
beforeEach(() => {
  runDir = mkdtempSync(join(tmpdir(), "g819-app-"));
  userData = join(runDir, "userdata");
  mkdirSync(join(userData, "uniwork-auth"), { recursive: true });
  mkdirSync(join(runDir, "logs"), { recursive: true });
  portsEnv = { UNIWORK_USER_DATA: userData, ELECTRON_BIN: "/bin/true", SHELL_APP_DIR: "/x", APP_CDP_PORT: "19222", HARNESS_APP_STEP_TIMEOUT_MS: "2000" };
});
afterEach(() => rmSync(runDir, { recursive: true, force: true }));

function shellWindow(overrides = {}) {
  const log = [];
  const win = {
    log,
    aiOffice: {
      accountStatus: async () => ({ state: "signed-out", loggedIn: false }),
      accountLogout: async () => log.push("logout"),
      uniworkSave: async (p) => ({ path: p, state: "saved" }),
      uniworkActiveDocStatus: async () => null,
      ...overrides.aiOffice,
    },
    aiOfficeTabs: {
      list: async () => ({ tabs: [{ id: "t1", filePath: "/wc/a.xlsx", kind: "sheets" }] }),
      activate: async (id) => log.push(`activate ${id}`),
    },
    uniworkDiscussion: Object.fromEntries(DISCUSSION_API_NAMES.map((n) => [n, async (i) => ({ ok: true, value: { n, i } })])),
  };
  return win;
}
function editorWindow(kind, log) {
  return {
    uniworkComments: Object.fromEntries(COMMENTS_API_NAMES.map((n) => [n, async (i) => ({ ok: true, value: { kind, n, i } })])),
    __genofficeControl: (req) => ({ status: "ok", cmd: req.cmd, selection: `${kind}!B7` }),
    dispatchEvent: (ev) => log.push(`${kind} ${ev.type}`),
  };
}

const connect = (pages, extra = {}) => connectApp({ portsEnv, runDir, apiOrigin: "http://127.0.0.1:1", cdpConnector: async () => fakeBrowser(pages), ...extra });

test("editorKindOfUrl / editorKindOfFormat follow the fork renderer scheme and UniworkDocFormat", () => {
  assert.equal(editorKindOfUrl("genoffice-app://sheets/index.html"), "sheets");
  assert.equal(editorKindOfUrl("genoffice-app://docs/index.html?mode=tab"), "docs");
  assert.equal(editorKindOfUrl("genoffice-app://shell/index.html"), null);
  assert.equal(editorKindOfUrl("http://localhost:5173/sheets/index.html"), null);
  assert.deepEqual(["docx", "xlsx", "pptx", "pdf", "md"].map(editorKindOfFormat), ["docs", "sheets", "slides", "pdf", null]);
});

test("connectApp classifies an app that cannot be driven: not started / no CDP -> BLOCKED, CDP refused -> FAIL, no shell window -> FAIL", async () => {
  await assert.rejects(connectApp({ portsEnv: {}, runDir }), (err) => err.appUnavailable.status === "BLOCKED");
  await assert.rejects(connectApp({ portsEnv: { ...portsEnv, APP_CDP_PORT: "" }, runDir, chromium: null }), (err) => {
    assert.equal(err.appUnavailable.status, "BLOCKED");
    assert.match(err.appUnavailable.reason, /APP_CDP_PORT/);
    return true;
  });
  await assert.rejects(connectApp({ portsEnv, runDir, cdpConnector: async () => {
    throw new Error("ECONNREFUSED");
  } }), (err) => err.appUnavailable.status === "FAIL" && /ECONNREFUSED/.test(err.appUnavailable.reason));
  await assert.rejects(connect([fakePage("genoffice-app://sheets/index.html", {})]), (err) => err.appUnavailable.status === "FAIL" && /no shell renderer window/.test(err.appUnavailable.reason));
});

test("evalBounded: a hung evaluate throws the bounded-step error carrying {call, elapsedMs}", async () => {
  const shell = fakePage("genoffice-app://shell/index.html", shellWindow());
  const stuck = fakePage("genoffice-app://docs/index.html", {}, { hang: true });
  const ctrl = await connect([shell, stuck], { timeoutMs: 40 });
  await assert.rejects(ctrl.evalBounded(stuck, () => 1, undefined, "uniworkComments.list"), (err) => {
    assert.equal(err.isAppStepTimeout, true);
    assert.equal(err.appStepTimeout.call, "uniworkComments.list");
    assert.ok(err.appStepTimeout.elapsedMs >= 40);
    return true;
  });
});

test("editorPage picks the page by URL kind and waits for it; an unknown kind is refused", async () => {
  const shell = fakePage("genoffice-app://shell/index.html", shellWindow());
  const docs = fakePage("genoffice-app://docs/index.html?mode=tab", {});
  const pages = [shell, docs];
  const ctrl = await connect(pages, { timeoutMs: 1_000 });
  assert.equal(await ctrl.editorPage("docs"), docs);
  const sheets = fakePage("genoffice-app://sheets/index.html", {});
  setTimeout(() => pages.push(sheets), 50);
  assert.equal(await ctrl.editorPage("sheets"), sheets);
  await assert.rejects(ctrl.editorPage("paint"), /no paint editor page/);
});

test("comments(page) calls window.uniworkComments.<name> with the input and returns the envelope unchanged; discussion() uses the shell page", async () => {
  const log = [];
  const shell = fakePage("genoffice-app://shell/index.html", shellWindow());
  const sheets = fakePage("genoffice-app://sheets/index.html", editorWindow("sheets", log));
  const ctrl = await connect([shell, sheets]);
  const api = ctrl.comments(sheets);
  assert.deepEqual(Object.keys(api), [...COMMENTS_API_NAMES]);
  const input = { path: "/wc/a.xlsx", kind: "comment", body: "x", anchor: { format: "xlsx", v: 1, sheet: "sheet-2", range: "B7" }, baseVersionId: "v1" };
  assert.deepEqual(await api.create(input), { ok: true, value: { kind: "sheets", n: "create", i: input } });
  assert.deepEqual(sheets.calls.at(-1), ["uniworkComments", "create", input]);
  const d = ctrl.discussion();
  assert.deepEqual(Object.keys(d), [...DISCUSSION_API_NAMES]);
  assert.deepEqual(await d.list({ path: "/wc/a.xlsx" }), { ok: true, value: { n: "list", i: { path: "/wc/a.xlsx" } } });
});

test("COMMENTS_API_NAMES / DISCUSSION_API_NAMES are the call channels of fork 7d665a54 comments-ipc.ts (push channels excluded)", (t) => {
  const forkDir = process.env.OFFICE_FORK_DIR || join(homedir(), "projects", "uniwork-office");
  let source = "";
  try {
    source = execFileSync("git", ["-C", forkDir, "show", "7d665a54:packages/electron-utils/src/comments-ipc.ts"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    t.skip(`fork 7d665a54 is not readable at ${forkDir} (set OFFICE_FORK_DIR); the pinned lists below still hold`);
    return;
  }
  const keysOf = (constName) => {
    const block = new RegExp(`export const ${constName} = \\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1] ?? "";
    return [...block.matchAll(/^\s+(\w+):\s*'/gm)].map((m) => m[1]);
  };
  const push = new Set(["reveal", "revealPending", "revealRelease", "saved", "panel"]);
  assert.deepEqual(keysOf("COMMENTS_CHANNELS").filter((k) => !push.has(k)).sort(), [...COMMENTS_API_NAMES].sort());
  assert.deepEqual(keysOf("DISCUSSION_CHANNELS").filter((k) => !push.has(k)).sort(), [...DISCUSSION_API_NAMES].sort());
  assert.match(source, /COMMENTS_BRIDGE_KEY = 'uniworkComments'/);
  assert.match(source, /DISCUSSION_BRIDGE_KEY = 'uniworkDiscussion'/);
});

test("aiOffice(name) only calls SHELL_API_NAMES; save(path) is aiOffice.uniworkSave", async () => {
  const shell = fakePage("genoffice-app://shell/index.html", shellWindow());
  const ctrl = await connect([shell]);
  await assert.rejects(ctrl.aiOffice("setUpdateChannel", "beta"), /not in SHELL_API_NAMES/);
  assert.deepEqual(await ctrl.save("/wc/a.docx"), { path: "/wc/a.docx", state: "saved" });
  assert.ok(SHELL_API_NAMES.includes("accountSelectOrg"));
});

// ---- sign-in, through a stub consent API --------------------------------------

let server;
let apiOrigin;
const consentCalls = [];
before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      consentCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      res.writeHead(200, { "content-type": "application/json" });
      if (req.method === "GET") res.end(JSON.stringify({ csrf_token: "csrf-1" }));
      else res.end(JSON.stringify({ callback_url: "uniwork-office-dev://auth/callback?code=c1&state=s1" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiOrigin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

test("signIn: signs out first, approves the consent as the user, reports the org choice and the org-scoped calls logged before it, without the email", async () => {
  let state = "signed-in";
  const statuses = { "signed-in": { state: "signed-in", loggedIn: true, email: "a@x.test", profile: { id: "user-M", email: "m@x.test" }, needsOrgChoice: true, orgs: [{ id: "org-X" }, { id: "org-Y" }] } };
  const win = shellWindow({
    aiOffice: {
      accountStatus: async () => statuses[state] ?? { state, loggedIn: false },
      accountLogout: async () => {
        state = "signed-out";
        win.log.push("logout");
      },
      accountLogin: async () => {},
      onAccountLogin: (cb) => {
        setTimeout(() => cb({ phase: "url", url: "http://web/desktop/authorize?attempt_id=att-1" }), 5);
        return () => {};
      },
    },
  });
  const shell = fakePage("genoffice-app://shell/index.html", win);
  const serverLog = join(runDir, "logs", "server.log");
  writeFileSync(serverLog, '{"msg":"request","path":"/api/v1/orgs/org-old/members"}\n');
  const delivered = [];
  const ctrl = await connectApp({
    portsEnv,
    runDir,
    apiOrigin,
    cdpConnector: async () => fakeBrowser([shell]),
    deepLinkDeliverer: (_env, url) => {
      delivered.push(url);
      writeFileSync(join(userData, "uniwork-auth", "session.bin"), "x");
      appendFileSync(serverLog, '{"msg":"request","path":"/api/v1/me/organizations"}\n{"msg":"request","path":"/api/v1/workspaces/ws-1/documents"}\n');
      state = "signed-in";
      return { status: 0 };
    },
  });
  const out = await ctrl.signIn({ key: "M", id: "user-M", token: "TOKEN-M" }, { expectOrgChoice: true });
  assert.deepEqual(win.log, ["logout"]);
  assert.equal(delivered[0], "uniwork-office-dev://auth/callback?code=c1&state=s1");
  assert.deepEqual(consentCalls.map((c) => `${c.method} ${c.url.split("?")[0]}`), ["GET /api/v1/auth/desktop/authorize", "POST /api/v1/auth/desktop/authorize"]);
  assert.equal(consentCalls[0].auth, "Bearer TOKEN-M");
  assert.deepEqual(JSON.parse(consentCalls[1].body), { attempt_id: "att-1", csrf_token: "csrf-1", decision: "approve" });
  assert.equal(out.orgChoiceShown, true);
  assert.equal(out.expectOrgChoice, true);
  assert.equal(out.sessionBinExists, true);
  assert.equal(out.orgApiCallsBeforeChoice, 1, "only the workspace call logged after sign-in started counts");
  assert.equal(out.status.email, undefined);
  assert.equal(out.status.profile.email, undefined);
  assert.equal(out.status.profile.id, "user-M");
});

test("openByTicket delivers the deep link and waits for the active document; focus activates the tab and fires focus on editor pages; selection reads __genofficeControl", async () => {
  const log = [];
  let active = null;
  const win = shellWindow({ aiOffice: { uniworkActiveDocStatus: async () => active } });
  win.log = log;
  win.aiOfficeTabs.activate = async (id) => log.push(`activate ${id}`);
  const shell = fakePage("genoffice-app://shell/index.html", win);
  const sheets = fakePage("genoffice-app://sheets/index.html", editorWindow("sheets", log));
  const delivered = [];
  const ctrl = await connectApp({
    portsEnv,
    runDir,
    cdpConnector: async () => fakeBrowser([shell, sheets]),
    deepLinkDeliverer: (_env, url) => {
      delivered.push(url);
      setTimeout(() => {
        active = { path: "/wc/a.xlsx", documentId: "doc-1", format: "xlsx" };
      }, 30);
      return { status: 0 };
    },
  });
  assert.deepEqual(await ctrl.openByTicket("uniwork-office-dev://open?ticket=T", { documentId: "doc-1" }), { path: "/wc/a.xlsx", documentId: "doc-1", kind: "sheets" });
  assert.equal(delivered[0], "uniwork-office-dev://open?ticket=T");
  assert.deepEqual(await ctrl.focus("/wc/a.xlsx"), { activated: true, pages: 1 });
  assert.deepEqual(log, ["activate t1", "sheets focus"]);
  assert.deepEqual(await ctrl.selection("sheets"), { status: "ok", cmd: "selection", selection: "sheets!B7" });
  await assert.rejects(
    connectApp({ portsEnv, runDir, cdpConnector: async () => fakeBrowser([shell]), deepLinkDeliverer: () => ({ status: 1 }) }).then((c) => c.openByTicket("x")),
    /handoff failed/,
  );
});

test("sanitizeAccountStatus drops emails; countOrgScopedRequests counts org/workspace paths after an offset, null without a log", () => {
  assert.deepEqual(sanitizeAccountStatus({ state: "signed-in", email: "e", profile: { id: "u", email: "e" } }), { state: "signed-in", profile: { id: "u" } });
  assert.equal(sanitizeAccountStatus(null), null);
  const file = join(runDir, "logs", "s.log");
  writeFileSync(file, "path=/api/v1/orgs/x/members\n");
  const offset = Buffer.byteLength("path=/api/v1/orgs/x/members\n");
  appendFileSync(file, 'path=/api/v1/me\n{"path":"/api/v1/orgs/abc"}\npath=/api/v1/workspaces/w/documents\n');
  assert.equal(countOrgScopedRequests(file, 0), 3);
  assert.equal(countOrgScopedRequests(file, offset), 2);
  assert.equal(countOrgScopedRequests(join(runDir, "nope.log"), 0), null);
});

/** An editor page whose comments bridge answers context only for the path it shows (fork comments-wiring.ts:226-247). */
function showingWindow(shownPath, documentId) {
  return {
    uniworkComments: {
      context: async (input) =>
        input?.path === shownPath
          ? { ok: true, value: { documentId, versionId: "v1" } }
          : { ok: false, error: { code: "forbidden", message: "comments: the sender does not show this document", retryable: false } },
    },
  };
}

test("editorPage(kind, {path}) picks the page that shows that document among two of one kind; without the option the first page as before", async () => {
  const shell = fakePage("genoffice-app://shell/index.html", shellWindow());
  const first = fakePage("genoffice-app://sheets/index.html", showingWindow("/wc/a.xlsx", "doc-a"));
  const second = fakePage("genoffice-app://sheets/index.html", showingWindow("/wc/b.xlsx", "doc-b"));
  const ctrl = await connect([shell, first, second], { timeoutMs: 1_000 });
  assert.equal(await ctrl.editorPage("sheets"), first, "no option: today's behaviour");
  assert.equal(await ctrl.editorPage("sheets", { path: "/wc/b.xlsx" }), second);
  assert.equal(await ctrl.editorPage("sheets", { path: "/wc/a.xlsx", documentId: "doc-a" }), first);
  await assert.rejects(ctrl.editorPage("sheets", { path: "/wc/b.xlsx", documentId: "doc-a" }), /no sheets editor page shows \/wc\/b\.xlsx as document doc-a/);
});

test("editorPage(kind, {path}): two pages that claim the document or none within the bound -> a clear error, never a page", async () => {
  const shell = fakePage("genoffice-app://shell/index.html", shellWindow());
  const a = fakePage("genoffice-app://docs/index.html?mode=tab", showingWindow("/wc/r.docx", "d1"));
  const b = fakePage("genoffice-app://docs/index.html?mode=tab", showingWindow("/wc/r.docx", "d1"));
  const ctrl = await connect([shell, a, b], { timeoutMs: 1_000, portsEnv: { ...portsEnv, HARNESS_APP_STEP_TIMEOUT_MS: "300" } });
  await assert.rejects(ctrl.editorPage("docs", { path: "/wc/r.docx" }), /2 docs editor pages show \/wc\/r\.docx/);
  const started = Date.now();
  await assert.rejects(ctrl.editorPage("docs", { path: "/wc/none.docx" }), (err) => {
    assert.match(err.message, /no docs editor page shows \/wc\/none\.docx/);
    assert.match(err.message, /forbidden/, "the refusals are named");
    return true;
  });
  assert.ok(Date.now() - started < 5_000, "bounded");
  await assert.rejects(ctrl.editorPage("docs", { documentId: "d1" }), /needs the path/);
});

test("editorPage(kind, {url}) picks the one page with exactly that URL; two -> error", async () => {
  const shell = fakePage("genoffice-app://shell/index.html", shellWindow());
  const one = fakePage("genoffice-app://pdf/index.html?x=1", {});
  const two = fakePage("genoffice-app://pdf/index.html?x=2", {});
  const ctrl = await connect([shell, one, two], { timeoutMs: 1_000 });
  assert.equal(await ctrl.editorPage("pdf", { url: "genoffice-app://pdf/index.html?x=2" }), two);
  const dup = await connect([shell, one, fakePage("genoffice-app://pdf/index.html?x=1", {})], { timeoutMs: 1_000 });
  await assert.rejects(dup.editorPage("pdf", { url: "genoffice-app://pdf/index.html?x=1" }), /2 pdf editor pages/);
});
