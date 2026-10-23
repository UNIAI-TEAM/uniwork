/* global fetch, AbortSignal, URL */
// Web host: D web (the harness's WEB_ORIGIN) with the installed frame bundle.
// Seeds one account through the D API (seed.mjs), signs in through the login
// form, opens each fixture's document page and captures the module frame region
// (`[data-office-docs-frame]`, the host's wrapper around the same-origin iframe)
// once it is settled.
import { join } from "node:path";
import { offerableFrameVersion } from "../../../../../apps/web/platform/office-frame/frame-install.mjs";
import { readPins } from "../../../../../apps/web/platform/office-frame/frame-headers.mjs";
import { blocked, failed, ok, pngSize } from "./meta.mjs";
import { COLOR_SCHEME, DEVICE_SCALE_FACTOR, LOCALE, MIN_FRAME_WIDTH, OPEN_TIMEOUT_MS, SETTLE, TIMEZONE, VIEWPORTS } from "./constants.mjs";
import { notSettledReason, pageIsBusy, realSleep, settle } from "./settle.mjs";
import { collectRenderedText, frameSubtree } from "./text.mjs";
import { REPO_ROOT } from "./playwright.mjs";
import { cleanupSeed, seedWorkspace } from "./seed.mjs";
import { signIn } from "./signin.mjs";

const FRAME_ROOT = join(REPO_ROOT, "apps", "web", "public", "office-frame");
/** Chromium flags that make glyph rasterisation the same on every VM. */
const CHROMIUM_ARGS = ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text"];

/** The pinned frame of every module and whether the installed bundle verifies (the check the web build itself makes). */
export function frameInstallState(pins = readPins(), root = FRAME_ROOT) {
  return Object.fromEntries(
    Object.entries(pins).map(([module, pin]) => [module, { version: pin?.version ?? "", gitSha: pin?.gitSha ?? "", installed: Boolean(pin) && offerableFrameVersion(pin, join(root, module)) !== "" }]),
  );
}

/** The AI grant of a frame-token answer (`ai.ai`, `ai.uniwork_ai`); an absent or drifted field reads as off, as the host reads it. */
export function frameGrantFromToken(body) {
  const grant = body && typeof body === "object" ? body.ai : null;
  return { ai: grant?.ai === true, uniworkAi: grant?.uniwork_ai === true };
}

const FRAME_TOKEN_URL = /\/documents\/([^/?#]+)\/office\/frame-token(?:[?#]|$)/;

/**
 * Listens for the frame-token mints the host page makes (POST .../documents/<id>/office/frame-token)
 * and keeps the AI grant of the latest mint per document. `settled()` waits for the answers still
 * being read and returns the map. A mint whose body cannot be read records nothing (the job then
 * fails that shot: no grant proven).
 * @param {{ on: (event: string, handler: (response: any) => void) => void }} page
 */
export function trackFrameGrants(page) {
  /** @type {Map<string, { ai: boolean, uniworkAi: boolean }>} */
  const grants = new Map();
  const pending = [];
  page.on("response", (response) => {
    const match = FRAME_TOKEN_URL.exec(response.url());
    if (!match || response.request().method() !== "POST") return;
    pending.push(
      Promise.resolve()
        .then(() => response.json())
        .then((body) => grants.set(match[1], frameGrantFromToken(body)))
        .catch(() => {}),
    );
  });
  return {
    settled: async () => {
      await Promise.all(pending);
      return grants;
    },
  };
}

/** An ok shot stamped with the grant its document's token carried; any other result, or a document with no mint seen, is returned as it is. */
export function withFrameGrant(result, grants, documentId) {
  const grant = grants.get(documentId);
  return result.status === "ok" && grant ? { ...result, ...grant } : result;
}

/** What the document page shows for `module`: the frame host's state or a notice. Runs in the page. */
export function readFrameState(module) {
  const host = document.querySelector(`[data-office-docs-frame][data-office-module="${module}"]`);
  if (!host) {
    const main = document.querySelector("main") ?? document.body;
    return { state: "none", detail: (main?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 160) };
  }
  const notice = host.querySelector('[data-testid="office-docs-frame-failed"]');
  if (notice) return { state: "failed", kind: notice.getAttribute("data-failure-kind") ?? "", detail: notice.innerText.replace(/\s+/g, " ").trim().slice(0, 160) };
  return { state: host.getAttribute("data-state") ?? "", detail: "" };
}

/** Waits for the host to be ready (or to show its failure notice). Resolves the last state read. */
export async function waitForFrame(page, module, { timeoutMs = OPEN_TIMEOUT_MS, sleep = realSleep, now = Date.now } = {}) {
  const deadline = now() + timeoutMs;
  let last = { state: "none", detail: "" };
  for (;;) {
    last = await page.evaluate(readFrameState, module);
    if (last.state === "ready" || last.state === "failed") return last;
    if (now() >= deadline) return last;
    await sleep(500);
  }
}

/**
 * Hides the Next dev overlay and carets of the host page. Not injected into the
 * module iframe on purpose: Playwright's own `caret: "hide"` already covers every
 * frame at screenshot time, and a style tag added to the markdown frame made its
 * editor toggle a 9 px cursor bar between every two shots (never settling).
 */
async function hideHostChrome(page) {
  // the Next dev overlay badge is fixed-position UI of the dev server; it must not land in a shot
  await page.addStyleTag({ content: "*{caret-color:transparent!important}nextjs-portal{display:none!important}" }).catch(() => {});
}

/**
 * Screenshot and text of the open frame region of one document page. The
 * outcome is `ok` (with png and text), `blocked` or `failed` with a reason.
 */
export async function captureOpenFrame(page, module, { settleOptions = SETTLE, sleep = realSleep, now = Date.now, timeoutMs = OPEN_TIMEOUT_MS, minFrameWidth = MIN_FRAME_WIDTH } = {}) {
  const state = await waitForFrame(page, module, { timeoutMs, sleep, now });
  if (state.state === "failed") return { ...failed(`frame_failed:${state.kind || "unknown"}: ${state.detail}`) };
  if (state.state !== "ready") {
    const hint = state.state === "none" ? `no ${module} frame host on the page (the web build may not offer it: restart web after frame-install); page says: ${state.detail}` : `frame state stayed ${state.state}`;
    return failed(`frame_not_ready: ${hint}`);
  }
  await hideHostChrome(page);
  const host = page.locator(`[data-office-docs-frame][data-office-module="${module}"]`);
  const result = await settle({
    grab: () => host.screenshot({ animations: "disabled", caret: "hide" }),
    isBusy: () => pageIsBusy(page),
    sleep,
    now,
    ...settleOptions,
  });
  if (result.status !== "settled") return failed(notSettledReason(result));
  // a frame the shell squeezed narrower than the desktop view cuts the document (round 1: column G of the xlsx at 1176 px): never a golden
  const size = pngSize(result.frame);
  if (!size || size.w < minFrameWidth) return failed(`frame_too_small: the module frame region is ${size ? `${size.w}x${size.h}` : "unreadable"} px, under the ${minFrameWidth} px width the web viewport ${VIEWPORTS.web.w}x${VIEWPORTS.web.h} is meant to give it`);
  // `.txt` is the module frame's own text (and the frames inside it): the host page around it
  // always has words (sidebar, breadcrumb, the file name), so counting it would let a blank
  // frame pass the job's no_rendered_text. The host text goes to `.host.txt` for the brand check.
  const iframe = host.locator("iframe").first();
  const moduleFrame = (await host.locator("iframe").count()) > 0 ? await (await iframe.elementHandle()).contentFrame() : null;
  const moduleFrames = moduleFrame ? frameSubtree(page, moduleFrame) : [];
  const hostFrames = page.frames().filter((frame) => !moduleFrames.includes(frame));
  const { text, canvasOnly } = await collectRenderedText(page, moduleFrames);
  const { text: hostText } = await collectRenderedText(page, hostFrames);
  return ok({ png: result.frame, text, hostText, canvasOnly });
}

/** Everything blocked/failed the same way: the result map for a host that cannot start. */
const allFixtures = (fixtures, outcome) => Object.fromEntries(fixtures.map((fixture) => [fixture.id, outcome]));

/**
 * Captures every fixture on the web host. Returns `{results, pinVersion,
 * forkSha, notes}`; `results[id]` is `ok` (with png/text) | blocked | failed.
 */
export async function captureWeb({ ports, fixtures, playwright, log = () => {}, fetchImpl = fetch }) {
  const pins = readPins();
  const installs = frameInstallState(pins);
  const pinVersion = installs.docs?.version ?? "";
  const forkSha = installs.docs?.gitSha ?? "";
  const base = { pinVersion, forkSha, notes: [] };
  const webOrigin = ports.WEB_ORIGIN;
  const apiOrigin = ports.API_ORIGIN;
  if (!webOrigin || !apiOrigin) return { ...base, results: allFixtures(fixtures, blocked("ports.env has no WEB_ORIGIN/API_ORIGIN (start.sh did not bring the stack up)")) };
  for (const [label, url] of [["D server", `${apiOrigin}/healthz`], ["D web", `${webOrigin}/login`]]) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return { ...base, results: allFixtures(fixtures, blocked(`the ${label} answered ${res.status} on ${url}`)) };
    } catch {
      return { ...base, results: allFixtures(fixtures, blocked(`no ${label} on ${url} (start.sh must have brought the stack up and it must have stayed up)`)) };
    }
  }

  // A fixture whose module bundle is not installed cannot be opened: blocked, named.
  const results = {};
  const openable = [];
  for (const fixture of fixtures) {
    const install = installs[fixture.module];
    if (!fixture.module) results[fixture.id] = failed(`no module for format ${fixture.format}`);
    else if (!install?.installed) results[fixture.id] = blocked(`frame_not_installed:${fixture.module} (run apps/web/scripts/office-frame-sync.mjs --ensure; pin ${install?.version || "missing"})`);
    else openable.push(fixture);
  }
  if (openable.length === 0) return { ...base, results };

  let seed = null;
  let browser = null;
  try {
    try {
      seed = await seedWorkspace({ apiOrigin, fixtures: openable, fetchImpl });
    } catch (error) {
      for (const fixture of openable) results[fixture.id] = failed(`seed_failed: ${error.message}`);
      return { ...base, results };
    }
    try {
      browser = await playwright.chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    } catch (error) {
      const reason = `chromium could not be launched: ${String(error.message).split("\n")[0]}`;
      for (const fixture of openable) results[fixture.id] = blocked(reason);
      return { ...base, results };
    }
    const context = await browser.newContext({
      viewport: { width: VIEWPORTS.web.w, height: VIEWPORTS.web.h },
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
      locale: LOCALE,
      timezoneId: TIMEZONE,
      colorScheme: COLOR_SCHEME,
      reducedMotion: "reduce",
    });
    // the product shows English until the locale cookie says otherwise (e2e/locale-state.ts)
    await context.addCookies([{ name: "uniwork-locale", value: "vi", url: webOrigin }]);
    const page = await context.newPage();
    const frameGrants = trackFrameGrants(page);
    try {
      await signIn(page, webOrigin, seed);
    } catch (error) {
      for (const fixture of openable) results[fixture.id] = failed(`sign_in_failed: ${String(error.message).split("\n")[0]}`);
      return { ...base, results };
    }
    for (const fixture of openable) {
      const url = `${webOrigin}/${seed.organization.slug}/${seed.workspace.slug}/documents/${seed.documents[fixture.id]}`;
      log(`web: ${fixture.id} -> ${new URL(url).pathname.replace(/[0-9A-HJKMNP-TV-Z]{26}/g, "<id>")}`);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded" });
        const shot = await captureOpenFrame(page, fixture.module);
        results[fixture.id] = withFrameGrant(shot, await frameGrants.settled(), seed.documents[fixture.id]);
      } catch (error) {
        results[fixture.id] = failed(`capture_error: ${String(error.message).split("\n")[0]}`);
      }
    }
    return { ...base, results };
  } finally {
    await browser?.close().catch(() => {});
    if (seed) {
      const cleaned = await cleanupSeed({ apiOrigin, seed, fetchImpl });
      base.notes.push(`cleanup ${cleaned.ok ? "done" : "INCOMPLETE"}: ${cleaned.leftover}`);
      log(`web: cleanup ${cleaned.ok ? "done" : "INCOMPLETE"}: ${cleaned.leftover}`);
    }
  }
}
