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

/**
 * Signs `user` in on the D web in a fresh context of `browser` (a Playwright
 * chromium Browser), with the `uniwork-locale` cookie set to `locale`.
 * Resolves `{ context, page, user, locale, setLocale(locale), close() }`.
 */
export async function webLogin(browser, user, { webOrigin, locale = "en", timeoutMs = LOGIN_TIMEOUT_MS } = {}) {
  if (!webOrigin) throw new Error("webLogin: webOrigin is required");
  if (!user?.email || !user?.password) throw new Error(`webLogin: user ${user?.key ?? "?"} has no credentials`);
  const host = new URL(webOrigin).hostname;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const setCookie = (value) => context.addCookies([{ name: "uniwork-locale", value, domain: host, path: "/" }]);
  await setCookie(locale);
  const page = await context.newPage();
  // the same /login form the G7-10 tracer drives (scripts/office/g5g6g7/g7-10/tracer.mjs driveWebXlsxSave)
  await page.goto(`${webOrigin}/login`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  const email = page.locator('input[type="email"], input[name="email"]').first();
  await email.waitFor({ state: "visible", timeout: timeoutMs });
  await email.fill(user.email);
  await page.locator('input[type="password"], input[name="password"]').first().fill(user.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: timeoutMs });
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
