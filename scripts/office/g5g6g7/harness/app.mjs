// G8-19 (UNI-1414) app driver: CDP on the Electron shell and its editor pages.
// Contract: g8-contract.md §7. Every app-side name it evaluates is a preload
// API of fork 7d665a54, cited where it is listed below; the driver never calls
// anything a person could not reach through those bridges.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { session as apiSession } from "./api.mjs";
import {
  buildSanitizedAppSignInRecord,
  deliverDeepLink,
  loadPlaywrightChromium,
  readAppProcessRecord,
  resolveAppStepTimeoutMs,
  runBoundedAppStep,
  runDesktopConsentSignIn,
  sleep,
} from "./app-steps.mjs";
import { harnessPaths } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(HERE, "../../../..");

/**
 * `window.uniworkComments.*` calls (fork packages/electron-utils/src/comments-bridge.ts:34-44,72;
 * channels comments-ipc.ts:25-48), installed by every editor preload (apps/docs/src/preload/index.ts:283,
 * apps/sheets/src/preload/index.ts:787, apps/slides/src/preload/index.ts:516, apps/pdf/src/preload/index.ts:163).
 * `reveal`/`revealPending`/`saved` are push channels, not calls.
 */
export const COMMENTS_API_NAMES = Object.freeze([
  "list",
  "create",
  "update",
  "remove",
  "resolve",
  "reopen",
  "revisions",
  "anchors",
  "searchMentions",
  "context",
]);

/**
 * `window.uniworkDiscussion.*` calls on the shell page (fork packages/electron-utils/src/discussion-bridge.ts:20-28;
 * channels comments-ipc.ts:346-365; installed by apps/shell/src/preload/index.ts:1329). `onReveal`/`setPanel` are not request calls.
 */
export const DISCUSSION_API_NAMES = Object.freeze([
  "list",
  "create",
  "update",
  "remove",
  "resolve",
  "reopen",
  "revisions",
  "searchMentions",
]);

/** `window.aiOffice.*` calls a row module may make (fork apps/shell/src/preload/index.ts:549-1065, exposed at :1115). */
export const SHELL_API_NAMES = Object.freeze([
  "accountStatus",
  "accountLogin",
  "accountLogout",
  "accountSelectOrg",
  "uniworkCloudStatus",
  "uniworkListWorkspaces",
  "uniworkListDocuments",
  "uniworkListSharedWithMe",
  "uniworkDocumentProperties",
  "uniworkCreateDocument",
  "uniworkRenameDocument",
  "uniworkArchiveDocument",
  "uniworkRestoreDocument",
  "uniworkOpenDocument",
  "uniworkDocStatus",
  "uniworkActiveDocStatus",
  "uniworkSave",
]);

const EDITOR_KINDS = ["docs", "sheets", "slides", "pdf"];
/** UniworkDocFormat (fork apps/shell/src/shared/home-api.ts:121) -> the editor that opens it */
const KIND_OF_FORMAT = { docx: "docs", xlsx: "sheets", pptx: "slides", pdf: "pdf" };

/**
 * The editor kind a page URL belongs to, or null. Editors load
 * `genoffice-app://<host>/index.html` (fork packages/electron-utils/src/renderer-scheme.ts:41-50).
 */
export function editorKindOfUrl(url) {
  const scheme = /^genoffice-app:\/\/([a-z]+)\//.exec(String(url ?? ""));
  return scheme && EDITOR_KINDS.includes(scheme[1]) ? scheme[1] : null;
}

/** The editor kind of a UniworkDocFormat (`xlsx` -> `sheets`), or null. */
export function editorKindOfFormat(format) {
  return KIND_OF_FORMAT[format] ?? null;
}

/** An account status safe for an artifact: no email, no profile email. */
export function sanitizeAccountStatus(status) {
  if (!status || typeof status !== "object") return status ?? null;
  const { email: _email, profile, ...rest } = status;
  void _email;
  if (!profile || typeof profile !== "object") return rest;
  const { email: _profileEmail, ...safeProfile } = profile;
  void _profileEmail;
  return { ...rest, profile: safeProfile };
}

const ORG_SCOPED_PATH = /(?:"path":"|\bpath=)\/api\/v1\/(?:orgs\/[^"\s/?]+|workspaces\/[^"\s/?]+)/;

/** Org- or workspace-scoped requests the server logged after `offset` bytes of logs/server.log; null when there is no log. */
export function countOrgScopedRequests(serverLogPath, offset) {
  if (!serverLogPath || !existsSync(serverLogPath)) return null;
  const text = readFileSync(serverLogPath).subarray(offset).toString("utf8");
  return text.split("\n").filter((line) => ORG_SCOPED_PATH.test(line)).length;
}

/** An Error a row module can classify: `appUnavailable = {status: "BLOCKED"|"FAIL", reason}`, plus the sanitized sign-in record. */
function unavailableError(appSignIn) {
  const err = new Error(appSignIn.decisionResult.reason);
  err.appUnavailable = { status: appSignIn.decisionResult.status, reason: appSignIn.decisionResult.reason };
  err.appSignIn = appSignIn;
  return err;
}

/**
 * Connects to the running app over CDP (`APP_CDP_PORT` from ports.env) and
 * finds the shell page (the one exposing `window.aiOffice`). Contract §7.
 * Rejects with `err.appUnavailable` when the app cannot be driven (not started,
 * no CDP port or Playwright, CDP refused, no shell window).
 */
export async function connectApp({
  portsEnv,
  runDir,
  apiOrigin = portsEnv?.API_ORIGIN,
  fetchImpl = fetch,
  repoRoot = DEFAULT_REPO_ROOT,
  timeoutMs = null,
  cdpConnector = null,
  deepLinkDeliverer = deliverDeepLink,
  chromium = undefined,
}) {
  const appProcess = readAppProcessRecord(runDir);
  const processFields = { appPid: appProcess.appPid, appProcessAlive: appProcess.appProcessAlive };
  if (!portsEnv?.UNIWORK_USER_DATA || !portsEnv?.ELECTRON_BIN || !portsEnv?.SHELL_APP_DIR) {
    throw unavailableError(buildSanitizedAppSignInRecord({ ...processFields, appStarted: false, accountState: "not-started" }));
  }
  const cdpPort = Number(portsEnv.APP_CDP_PORT || 0);
  const pw = cdpConnector ? null : chromium === undefined ? loadPlaywrightChromium(repoRoot) : chromium;
  if (!cdpPort || (!cdpConnector && !pw)) {
    throw unavailableError(
      buildSanitizedAppSignInRecord({
        ...processFields,
        appStarted: true,
        cdpAttempted: false,
        cdpConnected: false,
        accountState: "no-cdp",
        blockerReason: "the app cannot be driven headlessly in this run (no APP_CDP_PORT in ports.env or Playwright is not loadable)",
      }),
    );
  }
  const stepOpts = { timeoutMs, portsEnv, runDir };
  const bounded = (call, fn) => runBoundedAppStep(call, fn, stepOpts);

  let browser;
  try {
    browser = await bounded("connect", () =>
      cdpConnector ? cdpConnector(cdpPort) : pw.connectOverCDP(`http://127.0.0.1:${cdpPort}`, { timeout: resolveAppStepTimeoutMs(timeoutMs, portsEnv) }),
    );
  } catch (err) {
    if (err?.isAppStepTimeout) throw err;
    throw unavailableError(
      buildSanitizedAppSignInRecord({
        ...processFields,
        appStarted: true,
        cdpAttempted: true,
        cdpConnected: false,
        accountState: "cdp-unreachable",
        blockerReason: `could not connect to the running Electron app over CDP port ${cdpPort}: ${err?.message ?? err}`,
      }),
    );
  }

  const allPages = () => browser.contexts().flatMap((ctx) => ctx.pages());
  const findShellPage = async () => {
    for (const p of allPages()) {
      const has = await bounded("window.aiOffice", () => p.evaluate(() => typeof window.aiOffice === "object")).catch((err) => {
        if (err?.isAppStepTimeout) throw err;
        return false;
      });
      if (has) return p;
    }
    return null;
  };
  let shellPage = await findShellPage();
  for (let i = 0; i < 20 && !shellPage; i += 1) {
    await sleep(250);
    shellPage = await findShellPage();
  }
  if (!shellPage) {
    await Promise.race([Promise.resolve().then(() => browser.close()).catch(() => {}), sleep(1_000)]);
    throw unavailableError(
      buildSanitizedAppSignInRecord({ ...processFields, appStarted: true, cdpAttempted: true, cdpConnected: true, shellWindowFound: false, accountState: "no-shell-window" }),
    );
  }

  const evalBounded = (page, fn, arg, call) => bounded(call, () => page.evaluate(fn, arg));
  const aiOffice = (name, ...args) => {
    if (!SHELL_API_NAMES.includes(name)) return Promise.reject(new Error(`aiOffice.${name} is not in SHELL_API_NAMES`));
    return evalBounded(shellPage, ([n, a]) => window.aiOffice[n](...a), [name, args], `aiOffice.${name}`);
  };
  const bridge = (page, globalName, names) =>
    Object.fromEntries(
      names.map((name) => [
        name,
        (input) => evalBounded(page, ([g, n, i]) => window[g][n](i), [globalName, name, input], `${globalName}.${name}`),
      ]),
    );
  /**
   * The editor page of `kind`. Without options: the first one (several documents of
   * one kind each have their own page, fork apps/shell/src/main/tab-manager.ts:565-650).
   * `{ path }` picks the page that SHOWS that working copy: its comments bridge answers
   * `context({path})` only for the document the sender shows (fork
   * apps/shell/src/main/uniwork-docs/comments-wiring.ts:226-247, `shownPath(event.sender)`);
   * `documentId` also requires that context to name that document; `url` picks the page
   * with exactly that URL. Two matches, or none within the step bound, throw.
   */
  const editorPage = async (kind, opts = {}) => {
    if (!EDITOR_KINDS.includes(kind)) throw new Error(`no ${kind} editor page`);
    const { path = null, documentId = null, url = null } = opts ?? {};
    if (documentId && !path) throw new Error(`editorPage(${kind}) needs the path to pick the page of document ${documentId}`);
    const deadline = Date.now() + resolveAppStepTimeoutMs(timeoutMs, portsEnv);
    let misses = [];
    for (;;) {
      const pages = allPages().filter((p) => editorKindOfUrl(p.url()) === kind && (!url || p.url() === url));
      if (!path && !url) {
        if (pages[0]) return pages[0];
      } else if (!path) {
        if (pages.length > 1) throw new Error(`${pages.length} ${kind} editor pages have the URL ${url}`);
        if (pages.length === 1) return pages[0];
      } else {
        const matched = [];
        misses = [];
        for (const p of pages) {
          const reply = await evalBounded(p, (i) => window.uniworkComments?.context?.(i) ?? null, { path }, "uniworkComments.context").catch((err) => ({ ok: false, error: { code: err?.isAppStepTimeout ? "timeout" : "error" } }));
          const shows = reply?.ok === true && (!documentId || reply.value?.documentId === documentId);
          if (shows) matched.push(p);
          else misses.push(reply?.ok === true ? `document ${reply.value?.documentId ?? "none"}` : reply?.error?.code ?? "no bridge");
        }
        if (matched.length > 1) throw new Error(`${matched.length} ${kind} editor pages show ${path}${documentId ? ` as document ${documentId}` : ""}`);
        if (matched.length === 1) return matched[0];
      }
      if (Date.now() >= deadline) {
        const what = path ? ` shows ${path}${documentId ? ` as document ${documentId}` : ""}` : url ? ` has the URL ${url}` : "";
        throw new Error(`no ${kind} editor page${what}${misses.length ? ` (${misses.length} asked: ${misses.join(", ")})` : ""}`);
      }
      await sleep(250);
    }
  };
  const sessionBinPath = join(portsEnv.UNIWORK_USER_DATA, "uniwork-auth", "session.bin");
  const serverLog = join(harnessPaths(runDir).logDir, "server.log");

  return {
    browser,
    shellPage,
    evalBounded,
    aiOffice,
    editorPage,
    comments: (page) => bridge(page, "uniworkComments", COMMENTS_API_NAMES),
    discussion: () => bridge(shellPage, "uniworkDiscussion", DISCUSSION_API_NAMES),

    /** sign the app in as `user` through the desktop consent flow (contract §7) */
    async signIn(user, { expectOrgChoice = false } = {}) {
      let status = await aiOffice("accountStatus");
      if (status?.state === "signed-in") {
        // The product's own sign-out call, confirmation included. The fork asks the shell
        // renderer before it signs out a session whose working copy still holds unsent work
        // (uniwork-docs/wiring.ts:875-889 -> account-boundary.ts:198-214) and only that
        // renderer's answer resolves the question, so a BARE `accountLogout()` with such a
        // session never settles: cloud D2/D3's 4th row (a warm app still holding the previous
        // row's dirty edit) hung `app-open` to the 90 s step bound with
        // "aiOffice.accountLogout did not settle within 90 s" (D3-03; the same hang is
        // documented for the fault rows at fault/app-session.mjs:169-181). The confirmed
        // form is what the product's own account UI sends
        // (`accountLogout({ confirmed: true })`, renderer/src/account-model.ts:443) and what
        // cross-host.mjs's `signOutPreviousSession` already sends; the bridge stays bounded.
        await aiOffice("accountLogout", { confirmed: true });
      } else if (status?.state === "signing-in") await evalBounded(shellPage, () => window.aiOffice.accountCancelLogin?.(), undefined, "aiOffice.accountCancelLogin");
      const logOffset = existsSync(serverLog) ? statSync(serverLog).size : 0;
      const userSession = apiSession(user, { apiOrigin, fetchImpl });
      const callApi = async (name, { query, body } = {}) => {
        const res = await userSession.call(name, {}, body, { query });
        if (!res.ok) throw new Error(`${name} answered ${res.status}${res.error ? ` (${res.error})` : ""}`);
        return { data: res.body };
      };
      status = await runDesktopConsentSignIn({
        page: shellPage,
        runAppCdp: (call, fn) => bounded(call, fn),
        callApi,
        deepLinkDeliverer,
        portsEnv,
        sessionBinPath,
        status,
      });
      const orgChoiceShown = Boolean(status?.needsOrgChoice);
      return {
        status: sanitizeAccountStatus(status),
        orgChoiceShown,
        expectOrgChoice,
        sessionBinExists: existsSync(sessionBinPath),
        orgApiCallsBeforeChoice: orgChoiceShown ? countOrgScopedRequests(serverLog, logOffset) : null,
      };
    },
    selectOrg: async (orgId) => sanitizeAccountStatus(await aiOffice("accountSelectOrg", orgId)),
    async signOut() {
      // The same confirmation `signIn` sends, for the same reason (D3-03): a session that
      // still holds unsent work would otherwise leave a bare `accountLogout()` unanswered.
      await aiOffice("accountLogout", { confirmed: true });
      return sanitizeAccountStatus(await aiOffice("accountStatus"));
    },

    /** deliver `uniwork-office-dev://open?ticket=...` and wait for the active document (optionally `documentId`) */
    async openByTicket(launchUrl, { documentId = null } = {}) {
      const handoff = deepLinkDeliverer(portsEnv, launchUrl);
      if (handoff?.error || (typeof handoff?.status === "number" && handoff.status !== 0)) {
        throw new Error(`deep-link handoff failed (exit ${handoff?.status ?? "err"})`);
      }
      const deadline = Date.now() + resolveAppStepTimeoutMs(timeoutMs, portsEnv);
      for (;;) {
        const active = await aiOffice("uniworkActiveDocStatus").catch((err) => {
          if (err?.isAppStepTimeout) throw err;
          return null;
        });
        if (active?.path && (!documentId || active.documentId === documentId)) {
          return { path: active.path, documentId: active.documentId ?? null, kind: editorKindOfFormat(active.format) };
        }
        if (Date.now() >= deadline) throw new Error(`the app opened no document${documentId ? ` ${documentId}` : ""} after the deep link`);
        await sleep(300);
      }
    },
    save: (path) => aiOffice("uniworkSave", path),

    /** bring the tab of `path` to the front and fire a window focus on every editor page (forces the desktop comment poll) */
    async focus(path) {
      const activated = await evalBounded(
        shellPage,
        async (targetPath) => {
          if (!window.aiOfficeTabs?.list || !window.aiOfficeTabs?.activate) return false;
          const list = await window.aiOfficeTabs.list();
          const tabs = Array.isArray(list?.tabs) ? list.tabs : Array.isArray(list) ? list : [];
          const tab = tabs.find((t) => t && t.filePath === targetPath && t.id);
          if (!tab) return false;
          await window.aiOfficeTabs.activate(tab.id);
          return true;
        },
        path,
        "aiOfficeTabs.activate",
      );
      let pages = 0;
      for (const page of allPages().filter((p) => editorKindOfUrl(p.url()))) {
        await evalBounded(page, () => window.dispatchEvent(new Event("focus")), undefined, "window.focus");
        pages += 1;
      }
      return { activated, pages };
    },
    selection: async (kind) => evalBounded(await editorPage(kind), () => window.__genofficeControl?.({ cmd: "selection" }) ?? null, undefined, "__genofficeControl.selection"),
    async close() {
      await Promise.race([Promise.resolve().then(() => browser.close()).catch(() => {}), sleep(1_000)]);
    },
  };
}
