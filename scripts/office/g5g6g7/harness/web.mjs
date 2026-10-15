// G8-19 (UNI-1414) web driver: one Playwright context per user on the D web.
// Contract: g8-contract.md §6. The page is read through the markers the D
// views render (cited below), never through internal state.

const LOGIN_TIMEOUT_MS = 30_000;
const DEFAULT_OPEN_TIMEOUT_MS = 60_000;

/**
 * The D document URL the web Inbox builds (packages/views/notifications/resource-href.ts:33-42):
 * `/{org}/{ws}/documents/{id}`, plus `?comment=<id>` and `&kind=discussion` for a discussion.
 */
export function documentUrl({ webOrigin, org, ws, documentId, comment = null, kind = null }) {
  for (const [name, value] of Object.entries({ webOrigin, org, ws, documentId })) {
    if (typeof value !== "string" || value === "") throw new Error(`documentUrl: ${name} is required`);
  }
  const url = new URL(`/${encodeURIComponent(org)}/${encodeURIComponent(ws)}/documents/${encodeURIComponent(documentId)}`, webOrigin);
  if (comment) url.searchParams.set("comment", comment);
  if (comment && kind === "discussion") url.searchParams.set("kind", "discussion");
  return url.toString();
}

// The login API call the /login form ends in (server/internal/handler/router: POST /api/v1/auth/login).
const LOGIN_API_PATH = /\/auth\/login$/;
const LOGIN_ATTEMPT_MS = 10_000;
const LOGIN_ATTEMPTS = 3;
const HYDRATE_WAIT_MS = 5_000;

function isLoginCall(message) {
  try {
    return message.method() === "POST" && LOGIN_API_PATH.test(new URL(message.url()).pathname);
  } catch {
    return false;
  }
}

/** In the page: has React attached to the login form (a click before that is lost)? */
export function loginFormHydrated() {
  const input = document.querySelector('input[type="email"], input[name="email"]');
  return input !== null && Object.keys(input).some((key) => key.startsWith("__reactProps$") || key.startsWith("__reactFiber$"));
}

/** In the page: the text of the visible alerts (the login form's error), nothing else. */
export function readLoginAlerts() {
  return [...document.querySelectorAll('[role="alert"], [aria-live="assertive"], [data-slot="alert"], .text-destructive')]
    .map((el) => (el.textContent ?? "").trim())
    .filter(Boolean)
    .join(" | ");
}

/** Visible page text for a failure reason: the user's own credentials and anything token-shaped dropped, short. */
export function redactLoginText(text, user) {
  let out = String(text ?? "");
  for (const [secret, label] of [[user?.password, "<password>"], [user?.email, "<email>"]]) {
    if (secret) out = out.split(secret).join(label);
  }
  return out.replace(/[A-Za-z0-9_.-]{32,}/g, "<redacted>").replace(/\s+/g, " ").trim().slice(0, 160);
}

/**
 * Why a login did not end on a page other than /login (pure, for the tests). `answers` are the login API
 * answers seen (`{ status, code }`), `requests` the login requests that left the page, `path` the page path
 * without a query (a native form submit puts the credentials there), `alerts` the redacted visible error.
 */
export function loginFailureReason({ requests, answers, attempts, path, alerts, hydrated }) {
  const refused = answers.find((a) => a.status < 200 || a.status >= 300);
  let why;
  if (refused) {
    why = `POST /auth/login answered ${refused.status}${refused.code ? ` ${refused.code}` : ""}`;
    if (refused.status === 429) why += " (the harness's own login volume hit the credential-route budget: a harness failure, not a product finding)";
  } else if (answers.length > 0) {
    why = `POST /auth/login answered ${answers[0].status} but the page stayed on ${path}`;
  } else if (requests > 0) {
    why = "POST /auth/login was sent but not answered within the bound";
  } else {
    why = `no POST /auth/login was sent in ${attempts} submit attempt${attempts === 1 ? "" : "s"} (the submit click did nothing; form hydrated: ${hydrated ? "yes" : "no"})`;
  }
  return `${why} | page ${path}${alerts ? ` | visible error: "${alerts}"` : ""}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Signs `user` in on the D web in a fresh context of `browser` (a Playwright
 * chromium Browser), with the `uniwork-locale` cookie set to `locale`.
 * Resolves `{ context, page, user, locale, setLocale(locale), close() }`.
 *
 * The submit is judged by what the page sends, not by a URL wait: it waits for the form to hydrate, submits,
 * and when the click sent no login request (a click ahead of hydration is lost) loads a clean /login and
 * submits again, at most `attempts` times; a request that left is never re-sent. A refusal, an answer that
 * leaves the page on /login and a silent form each reject with the login API status/code and the page's
 * visible error (redacted), and close the context.
 */
export async function webLogin(
  browser,
  user,
  { webOrigin, locale = "en", timeoutMs = LOGIN_TIMEOUT_MS, attemptMs = LOGIN_ATTEMPT_MS, attempts = LOGIN_ATTEMPTS, hydrateMs = HYDRATE_WAIT_MS, pollMs = 100 } = {},
) {
  if (!webOrigin) throw new Error("webLogin: webOrigin is required");
  if (!user?.email || !user?.password) throw new Error(`webLogin: user ${user?.key ?? "?"} has no credentials`);
  const host = new URL(webOrigin).hostname;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const setCookie = (value) => context.addCookies([{ name: "uniwork-locale", value, domain: host, path: "/" }]);
  try {
    await setCookie(locale);
    const page = await context.newPage();
    const seen = { requests: 0, answers: [], codes: [] };
    page.on("request", (req) => {
      if (isLoginCall(req)) seen.requests += 1;
    });
    page.on("response", (res) => {
      if (!isLoginCall(res.request())) return;
      const answer = { status: res.status(), code: null };
      seen.answers.push(answer);
      seen.codes.push(
        res
          .json()
          .then((body) => {
            answer.code = typeof body?.error?.code === "string" ? body.error.code : null;
          })
          .catch(() => {}),
      );
    });
    // about:blank (a page that has not loaded yet) is not a signed-in page
    const left = () => {
      const url = new URL(page.url());
      return url.protocol.startsWith("http") && !url.pathname.startsWith("/login");
    };
    const refused = () => seen.answers.some((a) => a.status < 200 || a.status >= 300);
    let hydrated = false;
    let attempted = 0;
    while (attempted < attempts && !left() && !refused()) {
      attempted += 1;
      // the same /login form the G7-10 tracer drives (scripts/office/g5g6g7/g7-10/tracer.mjs driveWebXlsxSave)
      await page.goto(`${webOrigin}/login`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      const emailInput = page.locator('input[type="email"], input[name="email"]').first();
      await emailInput.waitFor({ state: "visible", timeout: timeoutMs });
      const hydrateBy = Date.now() + hydrateMs;
      for (;;) {
        hydrated = await page.evaluate(loginFormHydrated).catch(() => false);
        if (hydrated || Date.now() >= hydrateBy) break;
        await sleep(pollMs);
      }
      const sent = seen.requests;
      await emailInput.fill(user.email);
      await page.locator('input[type="password"], input[name="password"]').first().fill(user.password);
      await page.locator('button[type="submit"]').first().click();
      // a request that left the page is waited for up to `timeoutMs`; a silent click only for one attempt window
      const clickedAt = Date.now();
      while (!left() && !refused()) {
        const waited = Date.now() - clickedAt;
        if (seen.requests === sent ? waited >= attemptMs : waited >= timeoutMs) break;
        await sleep(pollMs);
      }
      if (seen.requests > sent) break; // a request that left is never re-sent
    }
    if (!left()) {
      await Promise.all(seen.codes);
      const path = new URL(page.url()).pathname;
      const alerts = redactLoginText(await page.evaluate(readLoginAlerts).catch(() => ""), user);
      throw new Error(`web login as ${user.key ?? "?"}: ${loginFailureReason({ requests: seen.requests, answers: seen.answers, attempts: attempted, path, alerts, hydrated })}`);
    }
    const web = {
      context,
      page,
      user,
      locale,
      async setLocale(next) {
        await setCookie(next);
        web.locale = next;
      },
      async close() {
        await context.close().catch(() => {});
      },
    };
    return web;
  } catch (err) {
    await context.close().catch(() => {});
    throw err;
  }
}

/**
 * What the document page shows, read in the page: the S15 Inbox state
 * (`data-document-inbox-state`, packages/views/documents/document-inbox-state.tsx:31),
 * the comment panes (`document-comments-pane`, document-comments-panel.tsx:283), the
 * highlighted thread (`document-thread-<id>` + `data-highlighted`, document-comment-thread.tsx:161-163)
 * and the Office frame host (`data-office-docs-frame`, packages/views/office/frame/office-module-frame.tsx).
 */
function readDocumentPage() {
  const state = document.querySelector("[data-document-inbox-state]")?.getAttribute("data-document-inbox-state") ?? null;
  const panes = document.querySelectorAll('[data-testid="document-comments-pane"]').length;
  const focused = document.querySelector('[data-testid^="document-thread-"][data-highlighted]');
  const frame = document.querySelector("[data-office-docs-frame]") !== null;
  const loading = document.querySelector('[data-testid="document-comments-loading"]') !== null;
  return { state, panes, focusedCommentId: focused ? focused.getAttribute("data-testid").slice("document-thread-".length) : null, frame, loading };
}

/** The open result for one page reading (pure, for the tests). */
export function classifyDocumentPage(read, { comment = null } = {}) {
  if (!read) return null;
  if (read.state === "no_access") return { status: "no-access", panelCount: 0, focusedCommentId: null };
  if (read.state === "gone") return { status: "not-found", panelCount: 0, focusedCommentId: null };
  if (read.panes > 0 && !read.loading && (!comment || read.focusedCommentId)) {
    return { status: "ok", panelCount: read.panes, focusedCommentId: read.focusedCommentId };
  }
  return null;
}

/**
 * Opens a document as the page's user and waits until it shows a known state:
 * the S15 no-access / gone message, or the comment panel (with the `comment`
 * thread highlighted when one is named). Resolves `{ url, status, panelCount, focusedCommentId }`;
 * a page that never settles is `status: "error"` with the last reading.
 */
export async function openDocument(page, { webOrigin, org, ws, documentId, comment = null, kind = null, timeoutMs = DEFAULT_OPEN_TIMEOUT_MS, pollMs = 250 }) {
  const url = documentUrl({ webOrigin, org, ws, documentId, comment, kind });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    last = await page.evaluate(readDocumentPage).catch(() => null);
    const settled = classifyDocumentPage(last, { comment });
    if (settled) return { url, ...settled };
    if (Date.now() >= deadline) {
      return {
        url,
        status: "error",
        panelCount: last?.panes ?? 0,
        focusedCommentId: last?.focusedCommentId ?? null,
        reason: last?.frame && !last?.panes ? "the Office frame is shown without a D comment panel" : "the document page did not settle",
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

// ---- web frame Save (contract §13, additive) ----------------------------------------------

const WEB_FRAME_KINDS = Object.freeze(["docs", "sheets", "slides", "pdf"]);
const DEFAULT_SAVE_TIMEOUT_MS = 30_000;
// The frame's own Save (its button, Ctrl+S, the leave dialog) ends in this request
// (server/internal/handler/router/office_frame.go:29,79; packages/views/office/frame/use-docs-frame-session.ts:153-154).
const FRAME_COMMIT_PATH = /^\/api\/v1\/office-frame\/documents\/[^/]+\/versions\/commit$/;

function assertFrameKind(kind) {
  if (!WEB_FRAME_KINDS.includes(kind)) throw new Error(`web frame kind must be one of ${WEB_FRAME_KINDS.join(", ")}, got ${kind}`);
}

/**
 * The genoffice module frame on a D document page (packages/views/office/frame/office-module-frame.tsx:309-333):
 * the host (`data-office-docs-frame` + `data-office-module`), its ready state and its iframe.
 */
export function webFrameSelectors(kind) {
  assertFrameKind(kind);
  const host = `[data-office-docs-frame][data-office-module="${kind}"]`;
  return { host, ready: `${host}[data-state="ready"]`, iframe: `${host} iframe[data-testid="office-docs-frame-iframe"]` };
}

/** The webSave result for one commit answer, or for none (`httpStatus: null`) (pure, for the tests). */
export function classifyWebSave({ httpStatus, body = null, dirty = null, saveState = null }) {
  if (httpStatus === null || httpStatus === undefined) {
    const why = [dirty === false ? "the frame was not dirty" : null, saveState ? `save state ${saveState}` : null].filter(Boolean).join("; ");
    return { status: "timeout", reason: `no frame commit within the bound${why ? ` (${why})` : ""}` };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { status: "error", httpStatus, reason: `the frame commit answered ${httpStatus}${body?.error?.code ? ` ${body.error.code}` : ""}` };
  }
  const versionId = body?.file?.version_id;
  if (!versionId) return { status: "error", httpStatus, reason: `the frame commit answered ${httpStatus} with no version id` };
  return { status: "saved", versionId, revision: body.revision ?? null, version: body.file.version ?? null };
}

function bounded(promise, timeoutMs, what) {
  let timer;
  const stop = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([promise, stop]).finally(() => clearTimeout(timer));
}

/**
 * Runs `fn(arg)` inside the `kind` module frame's document (same origin), bounded by `timeoutMs`.
 * Row modules use it to drive the editor in the web frame the way they drive the desktop editor.
 */
export async function webFrameEval(page, kind, fn, arg, { timeoutMs = DEFAULT_SAVE_TIMEOUT_MS } = {}) {
  const { iframe } = webFrameSelectors(kind);
  const handle = await page.$(iframe);
  const frame = handle ? await handle.contentFrame() : null;
  if (!frame) throw new Error(`no ${kind} frame on the page`);
  return bounded(frame.evaluate(fn, arg), timeoutMs, `${kind} frame evaluate`);
}

/** In the page: focus the frame iframe (as the host's own focus does, office-module-frame.tsx:240-243), or read the host. */
function frameHostAction(arg) {
  if (arg.read) {
    const host = document.querySelector(arg.read);
    return { dirty: host ? host.hasAttribute("data-dirty") : null, saveState: host?.getAttribute("data-save-state") ?? null };
  }
  const iframe = document.querySelector(arg.focus);
  if (!iframe) return false;
  iframe.focus();
  try {
    iframe.contentWindow?.focus();
  } catch {
    // a frame that is not same-origin keeps the iframe focus
  }
  return true;
}

/**
 * Saves the document open in the page's `kind` module frame the way a user does: waits for the frame to be
 * ready, focuses it, presses Control+s (the G7-10 web save, g7-10/tracer.mjs driveWebXlsxSave) and reads the
 * office-frame commit answer. Resolves `{ status: "saved", versionId, revision, version }`, or
 * `{ status: "error" | "timeout", reason, httpStatus? }`; never throws for a Save that does not happen.
 */
export async function webSave(page, { kind, timeoutMs = DEFAULT_SAVE_TIMEOUT_MS } = {}) {
  const sel = webFrameSelectors(kind);
  try {
    await page.waitForSelector(sel.ready, { state: "visible", timeout: timeoutMs });
  } catch (err) {
    return { status: "error", reason: `the ${kind} frame did not become ready: ${err instanceof Error ? err.message : String(err)}` };
  }
  const before = await page.evaluate(frameHostAction, { read: sel.host }).catch(() => ({ dirty: null, saveState: null }));
  await page.evaluate(frameHostAction, { focus: sel.iframe });
  const commit = page
    .waitForResponse(
      (res) => {
        if (res.request().method() !== "POST") return false;
        try {
          return FRAME_COMMIT_PATH.test(new URL(res.url()).pathname);
        } catch {
          return false;
        }
      },
      { timeout: timeoutMs },
    )
    .catch(() => null);
  await page.keyboard.press("Control+s");
  const res = await commit;
  if (!res) {
    const after = await page.evaluate(frameHostAction, { read: sel.host }).catch(() => before);
    return classifyWebSave({ httpStatus: null, dirty: before?.dirty ?? null, saveState: after?.saveState ?? null });
  }
  const body = await res.json().catch(() => null);
  return classifyWebSave({ httpStatus: res.status(), body });
}
