// In-memory stand-ins for the G8-19 harness (UNI-1414): world, api, web and
// app with the signatures of scripts/office/g5g6g7/harness/g8-contract.md, so
// a row module's decision and flow can be tested with no server, browser or
// Electron. Every call is recorded; every answer can be scripted per test.
// Contract §10 describes the scripting keys and the unscripted defaults.
import { G8_API_CALLS, apiPath, assertBodyKeys } from "../harness/api-contract.mjs";
import { COMMENTS_API_NAMES, DISCUSSION_API_NAMES, SHELL_API_NAMES } from "../harness/app.mjs";
import { documentUrl, webFrameSelectors } from "../harness/web.mjs";
import { SQL_MEMBERSHIP_BLOCKER, SQL_MEMBERSHIP_REASON } from "../harness/world.mjs";

/** As an answer: the call times out (api resolves status 0, app/web reject). */
export const FAKE_TIMEOUT = Symbol("fake-timeout");

const NETWORK_ERROR = Symbol("fake-network-error");

/** As an api answer: the request fails before any status, with this message. */
export function fakeNetworkError(message = "fetch failed") {
  return { [NETWORK_ERROR]: true, message };
}

const DEFAULT_ORGS = { X: { workspaces: ["W1", "W2"], ownerKey: "A" }, Y: { workspaces: ["WY"], ownerKey: "M" } };
const DEFAULT_USERS = ["A", "B", "C", "M"];

function createScript() {
  const standing = new Map();
  const queued = new Map();
  return {
    respond(key, answer) {
      standing.set(key, answer);
      return this;
    },
    queue(key, answer) {
      if (!queued.has(key)) queued.set(key, []);
      queued.get(key).push(answer);
      return this;
    },
    /** whether `key` has an answer, and the answer (a function is called with the call record) */
    take(key, call) {
      const list = queued.get(key);
      let answer;
      if (list && list.length > 0) answer = list.shift();
      else if (standing.has(key)) answer = standing.get(key);
      else return { scripted: false };
      return { scripted: true, answer: typeof answer === "function" ? answer(call) : answer };
    },
    pending(key) {
      return queued.get(key)?.length ?? 0;
    },
  };
}

function timeoutError(call) {
  const err = new Error(`${call} did not settle within 0.001 s`);
  err.isAppStepTimeout = true;
  err.appStepTimeout = { call, timeoutMs: 1, elapsedMs: 1, reason: err.message, appLogTail: [] };
  return err;
}

/**
 * A fake world (contract §10).
 * @param {{ sqlMembership?: boolean, users?: string[], orgs?: object }} [opts]
 */
export function createFakeWorld({ sqlMembership = true, users = DEFAULT_USERS, orgs = DEFAULT_ORGS } = {}) {
  const script = createScript();
  const calls = { all: [], api: [], web: [], app: [], world: [] };
  const record = (area, key, args, extra = {}) => {
    const entry = { area, key, args, ...extra };
    calls[area].push(entry);
    calls.all.push(entry);
    return entry;
  };

  // ---- world record --------------------------------------------------------
  const worldRecord = { apiOrigin: "http://127.0.0.1:1", seededAt: "1970-01-01T00:00:00.000Z", users: {}, orgs: {}, docs: {}, shares: {} };
  for (const key of users) {
    worldRecord.users[key] = {
      key,
      id: `user-${key}`,
      email: `fake-${key.toLowerCase()}@example.com`,
      password: `fake-password-${key}`,
      token: `fake-token-${key}`,
      displayName: `G8 ${key}`,
    };
  }
  for (const [orgKey, def] of Object.entries(orgs)) {
    const workspaces = {};
    for (const wsKey of def.workspaces) workspaces[wsKey] = { id: `ws-${wsKey}`, slug: `ws-${wsKey.toLowerCase()}` };
    worldRecord.orgs[orgKey] = { id: `org-${orgKey}`, slug: `org-${orgKey.toLowerCase()}`, ownerKey: def.ownerKey, workspaces };
  }
  if (worldRecord.users.M) {
    worldRecord.users.M.multiOrg = sqlMembership
      ? { status: "SEEDED", via: "sql", reason: SQL_MEMBERSHIP_REASON }
      : { status: "BLOCKED", blocker: SQL_MEMBERSHIP_BLOCKER };
  }
  let docSeq = 0;
  let shareSeq = 0;

  // ---- api -----------------------------------------------------------------
  function session(user) {
    if (!user || typeof user !== "object") throw new Error("session(user): user record required");
    return {
      user,
      userKey: user.key ?? null,
      async call(name, pathParams = {}, body = undefined, opts = {}) {
        if (!G8_API_CALLS[name]) throw new Error(`unknown API call ${name}`);
        const path = apiPath(name, pathParams, G8_API_CALLS);
        if (body !== undefined) assertBodyKeys(name, body, G8_API_CALLS);
        const entry = record("api", name, { pathParams, body, query: opts.query ?? {} }, { user: user.key ?? user.id, method: G8_API_CALLS[name].method, path });
        const { scripted, answer } = script.take(`api.${name}`, entry);
        if (!scripted) return { status: 501, ok: false, body: { error: "fake_unscripted", name } };
        if (answer === FAKE_TIMEOUT) return { status: 0, ok: false, body: null, error: "timeout" };
        if (answer?.[NETWORK_ERROR]) return { status: 0, ok: false, body: null, error: answer.message };
        if (answer instanceof Error) throw answer;
        const status = Number(answer?.status ?? 200);
        return { status, ok: status >= 200 && status < 300, body: answer?.body ?? null };
      },
    };
  }
  const api = { session };

  // ---- world methods ---------------------------------------------------------
  async function worldCall(method, args, run) {
    const entry = record("world", method, args);
    const { scripted, answer } = script.take(`world.${method}`, entry);
    if (scripted) {
      if (answer instanceof Error) throw answer;
      return answer;
    }
    return run();
  }
  const userOf = (key) => {
    const u = worldRecord.users[key];
    if (!u) throw new Error(`no user ${key} in the world`);
    return u;
  };
  const world = {
    record: worldRecord,
    users: worldRecord.users,
    orgs: worldRecord.orgs,
    docs: worldRecord.docs,
    shares: worldRecord.shares,
    user: userOf,
    org(key) {
      const o = worldRecord.orgs[key];
      if (!o) throw new Error(`no org ${key} in the world`);
      return o;
    },
    workspace(orgKey, wsKey) {
      const w = world.org(orgKey).workspaces[wsKey];
      if (!w) throw new Error(`no workspace ${wsKey} in org ${orgKey}`);
      return w;
    },
    session: (key) => session(userOf(key)),
    refreshTokens: () =>
      worldCall("refreshTokens", [], () => {
        for (const u of Object.values(worldRecord.users)) u.token = `${u.token.replace(/~\d+$/, "")}~${calls.world.length}`;
      }),
    upload: (userKey, wsKey, fixtureId, opts = {}) =>
      worldCall("upload", [userKey, wsKey, fixtureId, opts], () => {
        userOf(userKey);
        const orgKey = Object.keys(worldRecord.orgs).find((k) => wsKey in worldRecord.orgs[k].workspaces);
        if (!orgKey) throw new Error(`no workspace ${wsKey} in the world`);
        docSeq += 1;
        const doc = {
          documentId: `doc-${docSeq}`,
          versionId: `ver-${docSeq}`,
          workspaceKey: wsKey,
          orgKey,
          ownerKey: userKey,
          fixtureId,
          filename: opts.title ?? `${fixtureId}.bin`,
        };
        worldRecord.docs[doc.documentId] = doc;
        return { documentId: doc.documentId, versionId: doc.versionId, filename: doc.filename };
      }),
    share: (ownerKey, documentId, userId, level) =>
      worldCall("share", [ownerKey, documentId, userId, level], () => {
        shareSeq += 1;
        const shareId = `share-${shareSeq}`;
        worldRecord.shares[shareId] = { shareId, documentId, userId, level, revoked: false };
        return { shareId };
      }),
    revokeShare: (ownerKey, documentId, shareId) =>
      worldCall("revokeShare", [ownerKey, documentId, shareId], () => {
        if (worldRecord.shares[shareId]) worldRecord.shares[shareId].revoked = true;
        return { status: 204 };
      }),
    deactivate: (ownerKey, orgKey, userId) => worldCall("deactivate", [ownerKey, orgKey, userId], () => ({ status: 200 })),
    cleanup: () => worldCall("cleanup", [], () => ({ leftovers: [] })),
  };

  // ---- web -------------------------------------------------------------------
  const browser = { fake: "browser" };
  let webSaveSeq = 0;
  async function webAnswer(key, args, fallback) {
    const entry = record("web", key, args);
    const { scripted, answer } = script.take(`web.${key}`, entry);
    if (!scripted) return fallback();
    if (answer === FAKE_TIMEOUT) throw new Error(`web ${key} timed out`);
    if (answer instanceof Error) throw answer;
    return answer;
  }
  const web = {
    async webLogin(b, user, { locale = "en" } = {}) {
      return webAnswer("webLogin", [user?.key ?? user?.id, { locale }], () => {
        const page = { fake: "page", user: user?.key, url: () => "about:blank" };
        const session_ = {
          context: { fake: "context", user: user?.key },
          page,
          user,
          locale,
          async setLocale(next) {
            record("web", "setLocale", [user?.key, next]);
            session_.locale = next;
          },
          async close() {
            record("web", "close", [user?.key]);
          },
        };
        void b;
        return session_;
      });
    },
    async openDocument(page, opts) {
      return webAnswer("openDocument", [page?.user ?? null, opts], () => ({
        url: documentUrl({ webOrigin: "http://127.0.0.1:2", ...opts }),
        status: "ok",
        panelCount: 1,
        focusedCommentId: opts?.comment ?? null,
      }));
    },
    // §13: unscripted, every Save is a new version (ver-web-1, ver-web-2, ...)
    async webSave(page, opts = {}) {
      webFrameSelectors(opts.kind);
      return webAnswer("webSave", [page?.user ?? null, opts], () => {
        webSaveSeq += 1;
        return { status: "saved", versionId: `ver-web-${webSaveSeq}`, revision: String(webSaveSeq + 1), version: webSaveSeq + 1 };
      });
    },
    async webFrameEval(page, kind, fn, arg, opts = {}) {
      webFrameSelectors(kind);
      void fn;
      return webAnswer("webFrameEval", [page?.user ?? null, kind, arg, opts], () => undefined);
    },
  };

  // ---- app -------------------------------------------------------------------
  async function appAnswer(key, args, fallback) {
    const entry = record("app", key, args);
    const { scripted, answer } = script.take(`app.${key}`, entry);
    if (!scripted) return fallback();
    if (answer === FAKE_TIMEOUT) throw timeoutError(key);
    if (answer instanceof Error) throw answer;
    return answer;
  }
  const unscriptedReply = (name) => ({ ok: false, error: { code: "fake_unscripted", message: name } });
  function bridge(prefix, names, page) {
    const api_ = {};
    for (const name of names) {
      api_[name] = (input) => appAnswer(`${prefix}.${name}`, [input], () => unscriptedReply(`${prefix}.${name}`)).then((reply) => {
        void page;
        return reply;
      });
    }
    return api_;
  }
  const shellPage = { fake: "page", kind: "shell", url: () => "genoffice-app://shell/index.html" };
  const editorPages = new Map();
  const app = {
    async connectApp(opts = {}) {
      return appAnswer("connectApp", [opts], () => ({
        browser,
        shellPage,
        signIn: (user, o = {}) =>
          appAnswer("signIn", [user?.key ?? user?.id, o], () => ({
            status: { loggedIn: true, state: "signed-in" },
            orgChoiceShown: false,
            expectOrgChoice: Boolean(o.expectOrgChoice),
            sessionBinExists: true,
            orgApiCallsBeforeChoice: null,
          })),
        selectOrg: (orgId) => appAnswer("selectOrg", [orgId], () => ({ loggedIn: true, state: "signed-in" })),
        signOut: () => appAnswer("signOut", [], () => ({ loggedIn: false, state: "signed-out" })),
        openByTicket: (launchUrl, o = {}) =>
          appAnswer("openByTicket", [launchUrl, o], () => ({ path: "/fake/working-copy", documentId: o.documentId ?? null, kind: null })),
        async editorPage(kind) {
          record("app", "editorPage", [kind]);
          if (!["docs", "sheets", "slides", "pdf"].includes(kind)) throw new Error(`no ${kind} editor page`);
          if (!editorPages.has(kind)) editorPages.set(kind, { fake: "page", kind, url: () => `genoffice-app://${kind}/index.html` });
          return editorPages.get(kind);
        },
        comments: (page) => bridge("comments", COMMENTS_API_NAMES, page),
        discussion: () => bridge("discussion", DISCUSSION_API_NAMES, shellPage),
        aiOffice: (name, ...args) => {
          if (!SHELL_API_NAMES.includes(name)) return Promise.reject(new Error(`aiOffice.${name} is not in SHELL_API_NAMES`));
          return appAnswer(`aiOffice.${name}`, args, () => null);
        },
        save: (path) => appAnswer("save", [path], () => null),
        focus: (path) => appAnswer("focus", [path], () => ({ activated: true, pages: 1 })),
        selection: (kind) => appAnswer("selection", [kind], () => null),
        evalBounded: (page, fn, arg, call) => appAnswer("evalBounded", [page?.kind ?? null, arg, call], () => undefined),
        close: () => appAnswer("close", [], () => undefined),
      }));
    },
  };

  return { world, api, web, app, browser, calls, script };
}
