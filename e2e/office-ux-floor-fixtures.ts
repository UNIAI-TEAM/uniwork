import { expect, test, type APIRequestContext, type Frame, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { basename, resolve } from "node:path";
import { e2eApiUrl } from "./api-url";
import { readPinnedFrame, type SeededDocx } from "./office-docs-web-fixtures";
import { signInAs } from "./office-module-web-fixtures";

/**
 * Helpers for the G7-09 UX acceptance spec (office-ux-floor.spec.ts): reach the
 * web-frame surfaces of EXPERIENCE.md (S5 conflict dialog, S6 new-version bar,
 * S7 picker, S9 result line) on a D web page hosting the pinned Docs frame, and
 * read them inside the same-origin iframe. The selectors are the fork's own
 * (web/modules/shared/frame-dialog.ts, remote-bar.ts, packages/ui AiModelPicker)
 * at the pinned frame version, so a renamed class fails loudly here.
 */
const repoRoot = basename(process.cwd()).toLowerCase() === "e2e" ? resolve(process.cwd(), "..") : process.cwd();
const DOCX_FIXTURE = resolve(repoRoot, "docs/office/g0/fixtures/files/docs/docx-simple.docx");
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const FRAME_SELECTOR = 'iframe[src*="/office-frame/docs/"]';
export const EDITOR = '.ProseMirror[contenteditable="true"]';
/**
 * S5: the conflict dialog's backdrop carries the marker, the card is the alertdialog. The Docs frame stamps its dialogs
 * with `data-docs-web` (web/docs/bridge/notice.ts MARKER_ATTR, passed as `markerAttr` through `conflictFrame()`); the
 * other modules use the default `data-office-web`. r1 used the default and never found the Docs dialog. Both are
 * accepted, so a later pin that moves the Docs frame onto the shared marker still finds S5.
 */
export const S5_MASK = ':is([data-docs-web="conflict"], [data-office-web="conflict"])';
export const S5_CARD = `${S5_MASK} .ow-dlg`;
export const S6_BAR = ".uw-remote-bar";
export const PICKER_POP = ".ai-model-pop";
export const COMPOSER = ".ai-composer textarea, .ai-composer [contenteditable='true']";

export type Mode = "light" | "dark";
export type Locale = "vi" | "en";

/** Whether the web build under test serves the pinned Docs bundle. */
export async function docsFrameInstalled(request: APIRequestContext, baseUrl: string): Promise<boolean> {
  try {
    return (await request.get(`${baseUrl}/office-frame/docs/${readPinnedFrame().version}/manifest.json`)).ok();
  } catch {
    return false;
  }
}

/** The pinned frame version, for the evidence annotations. */
export function pinnedVersion(): string {
  return readPinnedFrame().version;
}

/**
 * Colour scheme (next-themes runs on "system", so the host and the frame follow
 * it) and the locale cookie, both before the first navigation.
 */
export async function prepare(page: Page, baseUrl: string, mode: Mode, locale: Locale): Promise<void> {
  await page.emulateMedia({ colorScheme: mode });
  await page.context().addCookies([{ name: "uniwork-locale", value: locale, domain: new URL(baseUrl).hostname, path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" }]);
}

/** The Docs iframe as a Playwright Frame (same origin: evaluate reaches its document). */
async function docsFrame(page: Page): Promise<Frame> {
  const handle = await page.locator(FRAME_SELECTOR).elementHandle({ timeout: 60_000 });
  const frame = await handle?.contentFrame();
  expect(frame, "the Docs iframe has no content frame").toBeTruthy();
  return frame!;
}

/** Signs in, opens the document and waits for an editable editor in the frame. */
export async function openDocs(page: Page, seeded: SeededDocx): Promise<Frame> {
  await signInAs(page, seeded.account.email);
  await page.goto(seeded.documentUrl);
  await expect(page.frameLocator(FRAME_SELECTOR).locator(EDITOR).first()).toBeVisible({ timeout: 60_000 });
  return docsFrame(page);
}

/** Types into the editor so the open copy is dirty. */
export async function makeDirty(page: Page, marker: string): Promise<void> {
  const editor = page.frameLocator(FRAME_SELECTOR).locator(EDITOR).first();
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(` ${marker}`);
  await expect(editor).toContainText(marker);
}

/**
 * A second writer commits a new version through the API (uploads + versions/commit
 * on the current head), as another member saving elsewhere would.
 */
export async function commitElsewhere(request: APIRequestContext, seeded: SeededDocx): Promise<void> {
  const auth = { authorization: `Bearer ${seeded.account.token}` };
  const got = await request.get(`${e2eApiUrl}/api/v1/documents/${seeded.documentId}`, { headers: auth });
  expect(got.ok(), `read head: HTTP ${got.status()}`).toBeTruthy();
  const revision = ((await got.json()) as { document: { revision: string } }).document.revision;
  const key = `ux-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const up = await request.post(`${e2eApiUrl}/api/v1/documents/${seeded.documentId}/uploads`, {
    headers: { ...auth, "Idempotency-Key": `up-${key}` },
    multipart: { file: { name: "docs-web.docx", mimeType: DOCX_MIME, buffer: readFileSync(DOCX_FIXTURE) } },
  });
  expect(up.ok(), `stage upload: HTTP ${up.status()} ${await up.text()}`).toBeTruthy();
  const { upload_id } = (await up.json()) as { upload_id: string };
  const commit = await request.post(`${e2eApiUrl}/api/v1/documents/${seeded.documentId}/versions/commit`, {
    headers: { ...auth, "Idempotency-Key": `commit-${key}`, "content-type": "application/json" },
    data: { upload_id, base_revision: revision },
  });
  expect(commit.ok(), `commit elsewhere: HTTP ${commit.status()} ${await commit.text()}`).toBeTruthy();
}

/** Waits for the S6 bar of a tone ("info" is the bar without a tone modifier). */
export async function waitForBar(frame: Frame, tone: "info" | "warn"): Promise<void> {
  const selector = tone === "warn" ? `${S6_BAR}.uw-remote-bar--warn` : `${S6_BAR}:not(.uw-remote-bar--warn):not(.uw-remote-bar--error)`;
  await frame.locator(selector).first().waitFor({ state: "visible", timeout: 60_000 });
}

/**
 * S5 on the web: open, dirty, another writer commits, the frame's own Save gets
 * 409 and opens the conflict dialog. Returns the frame with S5 on screen.
 */
export async function reachConflict(page: Page, request: APIRequestContext, seeded: SeededDocx): Promise<Frame> {
  const frame = await openDocs(page, seeded);
  await makeDirty(page, `uw-ux-${Date.now().toString(36)}`);
  await commitElsewhere(request, seeded);
  // The dirty copy hears the new head first (S6 warn bar); the save then meets the 409.
  await waitForBar(frame, "warn").catch(() => undefined);
  await page.frameLocator(FRAME_SELECTOR).locator(EDITOR).first().click();
  await page.keyboard.press("Control+s");
  await frame.locator(S5_CARD).waitFor({ state: "visible", timeout: 60_000 });
  return frame;
}

/** Opens the AI panel of the Docs frame (expands the rail when it is collapsed). */
async function openAiPanel(frame: Frame): Promise<void> {
  const chip = frame.locator(".ai-model-chip").first();
  if (!(await chip.isVisible().catch(() => false))) {
    const expand = frame.getByRole("button", { name: /Mở rộng ngăn chỉnh sửa AI|Expand .*AI/i }).first();
    if (await expand.isVisible().catch(() => false)) await expand.click();
  }
  await chip.waitFor({ state: "visible", timeout: 30_000 });
}

/**
 * The UniWork AI row of the open picker: the option inside the group headed "UniWork AI" (fork main labels the row
 * with the served model, e.g. "fake", and only the group head says UniWork AI), or an option that says it itself.
 */
export function uniworkOption(frame: Frame): Locator {
  const group = frame.locator(`${PICKER_POP} .ai-model-group`, { has: frame.locator(".ai-model-group-head", { hasText: "UniWork AI" }) });
  return group.locator('[role="option"]').or(frame.locator(`${PICKER_POP} [role="option"]`, { hasText: "UniWork AI" })).first();
}

/**
 * Opens the picker popup and returns once the UniWork AI option is listed. The group's beforeAll has already proven
 * the frame token grants `uniwork_ai`, so a picker without the row is a failure of the pinned frame, never a skip:
 * the frame lists a provider with an empty model list since fork 7888df06c (in the pin since 0.1.0-fa22cd9; current pin 0.1.0-cc35602).
 */
export async function openPicker(frame: Frame): Promise<void> {
  await openAiPanel(frame);
  await frame.locator(".ai-model-chip").first().click();
  await frame.locator(PICKER_POP).waitFor({ state: "visible", timeout: 15_000 });
  await uniworkOption(frame).waitFor({ state: "visible", timeout: 15_000 });
}

/** Selects UniWork AI in the picker (it closes) and reopens it, so the selected option is UniWork AI. */
export async function selectUniworkAi(frame: Frame): Promise<void> {
  await openPicker(frame);
  await uniworkOption(frame).click();
  await expect(frame.locator(PICKER_POP)).toHaveCount(0, { timeout: 10_000 });
}

/** The dialog's choices in DOM order (data-choice), whether the close X is the card's last control, and each choice's top-left. */
export async function s5Choices(frame: Frame): Promise<{ ids: string[]; closeLast: boolean; pos: { x: number; y: number }[] }> {
  return frame.locator(S5_CARD).evaluate((card) => {
    const buttons = [...card.querySelectorAll<HTMLElement>("button")];
    const choices = buttons.filter((b) => b.dataset.choice);
    const close = card.querySelector(".ow-dlg-close");
    return {
      ids: choices.map((b) => b.dataset.choice!),
      closeLast: close !== null && buttons[buttons.length - 1] === close,
      pos: choices.map((b) => { const r = b.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; }),
    };
  });
}

/** Reading order of the choices (top to bottom, then left to right) as indices into DOM order: [0, 1, 2, ...] when visual = DOM. */
export function visualOrder(pos: { x: number; y: number }[]): number[] {
  return pos.map((p, i) => ({ p, i })).sort((a, b) => a.p.y - b.p.y || a.p.x - b.p.x).map((o) => o.i);
}

/** Polls the frame's focused element (a focus move may land in a later task, so one read is not enough). */
export async function expectFocus(frame: Frame, id: string, message: string): Promise<void> {
  await expect.poll(async () => (await focusedIn(frame)).id, { message, timeout: 5_000 }).toBe(id);
}

/**
 * Starts recording, from now on, every animationstart / transitionrun inside `scope` whose computed duration is
 * perceptible (> 1 ms; the usual reduced-motion idiom is 0.01 ms). Install BEFORE the surface appears: a finished
 * CSS animation is no longer in document.getAnimations().
 */
export async function recordMotion(frame: Frame, scope: string): Promise<void> {
  await frame.evaluate((sel) => {
    const w = window as unknown as { __uwMotion: string[] };
    w.__uwMotion = [];
    const longest = (list: string) => Math.max(0, ...list.split(",").map((s) => parseFloat(s) * (s.trim().endsWith("ms") ? 0.001 : 1) || 0));
    for (const type of ["animationstart", "transitionrun"] as const) {
      document.addEventListener(type, (e) => {
        const t = e.target as Element;
        if (!t.closest?.(sel)) return;
        const cs = getComputedStyle(t);
        const seconds = longest(type === "animationstart" ? cs.animationDuration : cs.transitionDuration);
        if (seconds > 0.001) w.__uwMotion.push(`${type} ${t.className || t.tagName} ${seconds}s`);
      }, true);
    }
  }, scope);
}

/**
 * The recorded motion plus the computed durations of the surfaces themselves (the elements that would slide or
 * fade): a perceptible animation, or a transition on a slide/fade property, is motion under reduced motion.
 */
export async function motionSeen(frame: Frame, surfaces: readonly string[]): Promise<{ missing: string[]; moving: string[] }> {
  return frame.evaluate((sels) => {
    const w = window as unknown as { __uwMotion: string[] };
    const longest = (list: string) => Math.max(0, ...list.split(",").map((s) => parseFloat(s) * (s.trim().endsWith("ms") ? 0.001 : 1) || 0));
    const missing: string[] = [];
    const moving = [...w.__uwMotion];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) { missing.push(sel); continue; }
      const cs = getComputedStyle(el);
      if (cs.animationName !== "none" && longest(cs.animationDuration) > 0.001) moving.push(`${sel} animation ${cs.animationName} ${cs.animationDuration}`);
      if (longest(cs.transitionDuration) > 0.001 && /all|opacity|transform|translate|top|bottom|left|right|height/.test(cs.transitionProperty)) moving.push(`${sel} transition ${cs.transitionProperty} ${cs.transitionDuration}`);
    }
    return { missing, moving };
  }, surfaces);
}

/**
 * Starts recording every write into a window live node (.uw-live): one entry per record that adds text, so the
 * same sentence written twice (or cleared and rewritten) is two entries. Clearing a node adds no text.
 */
export async function recordLiveWrites(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const w = window as unknown as { __uwLive: string[] };
    w.__uwLive = [];
    new MutationObserver((records) => {
      for (const r of records) {
        const el = (r.target.nodeType === Node.TEXT_NODE ? r.target.parentElement : r.target) as HTMLElement | null;
        const live = el?.closest?.(".uw-live");
        const text = r.type === "characterData" ? (r.target as CharacterData).data : [...r.addedNodes].map((n) => n.textContent ?? "").join("");
        if (live && text) w.__uwLive.push(`${live.getAttribute("role")}:${text}`);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}

/** Every `status:` write recorded since recordLiveWrites that contains `sentence`. */
export async function liveReadsOf(frame: Frame, sentence: string): Promise<string[]> {
  const writes = await frame.evaluate(() => (window as unknown as { __uwLive: string[] }).__uwLive);
  return writes.filter((w) => w.startsWith("status:") && w.includes(sentence));
}

/** Labels of own-text elements in the bar/card cut by `nowrap` (and, with `vertical`, by a hidden-overflow box too short for its text). */
export async function clippedLabels(frame: Frame, vertical: boolean): Promise<string[]> {
  return frame.evaluate(([bar, card, v]) => [...document.querySelectorAll<HTMLElement>(`${bar} *, ${card} *`)].filter((el) => {
    const cs = getComputedStyle(el);
    const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim());
    if (!own) return false;
    const wide = cs.whiteSpace.includes("nowrap") && cs.overflow !== "visible" && el.scrollWidth > el.clientWidth + 1;
    const tall = v === "1" && ["hidden", "clip"].includes(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
    return wide || tall;
  }).map((el) => (el.textContent ?? "").slice(0, 40)), [S6_BAR, S5_CARD, vertical ? "1" : "0"] as const);
}

/** Every S5 control can be scrolled into view and is the topmost element at its centre. */
export async function reachable(frame: Frame): Promise<void> {
  const blocked = await frame.locator(S5_CARD).evaluate((card) => [...card.querySelectorAll<HTMLElement>("button")].filter((b) => {
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.width === 0 || r.height === 0 || !(hit === b || b.contains(hit));
  }).map((b) => b.dataset.choice ?? b.className));
  expect(blocked, "S5 controls not reachable").toEqual([]);
}

/** Visible S5/S6 buttons smaller than 24x24 CSS px (hidden, collapsed or display:none buttons are not targets). */
export async function smallTargets(frame: Frame): Promise<{ name: string; w: number; h: number }[]> {
  return frame.evaluate(([bar, card]) => [...document.querySelectorAll<HTMLElement>(`${bar} button, ${card} button`)].filter((b) => {
    const r = b.getBoundingClientRect();
    return b.getClientRects().length > 0 && getComputedStyle(b).visibility !== "hidden" && (r.width > 0 || r.height > 0);
  }).map((b) => {
    const r = b.getBoundingClientRect();
    return { name: (b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 30), w: r.width, h: r.height };
  }).filter((b) => b.w < 24 || b.h < 24), [S6_BAR, S5_CARD] as const);
}

/** The identity of the frame's focused element: its data-choice, a class, or the tag. */
export async function focusedIn(frame: Frame): Promise<{ id: string; inCard: boolean }> {
  return frame.evaluate((card) => {
    const el = document.activeElement as HTMLElement | null;
    const id = el?.dataset.choice ?? (el?.classList.contains("ow-dlg-close") ? "close" : el?.classList.contains("ow-dlg-title") ? "title" : el?.tagName.toLowerCase() ?? "none");
    return { id, inCard: !!el && !!document.querySelector(card)?.contains(el) };
  }, S5_CARD);
}

/**
 * Marks the rest of the test as expected to fail for a known BLOCKING finding,
 * once the state is reached (a failure before this call is a real failure).
 */
export function finding(id: string, rule: string): void {
  test.info().annotations.push({ type: "finding", description: `${id}: ${rule}` });
  test.fail(true, `${id} (BLOCKING, G7-09): ${rule}`);
}

/** Pins the iframe element to a CSS size, so the frame's own viewport is exactly that. */
export async function sizeFrame(page: Page, width: number, height?: number): Promise<void> {
  await page.locator(FRAME_SELECTOR).evaluate((el, [w, h]) => {
    const s = (el as HTMLElement).style;
    s.setProperty("width", `${w}px`, "important");
    s.setProperty("max-width", `${w}px`, "important");
    s.setProperty("min-width", `${w}px`, "important");
    s.setProperty("flex", "none", "important");
    if (h) {
      s.setProperty("height", `${h}px`, "important");
      s.setProperty("max-height", `${h}px`, "important");
      s.setProperty("min-height", `${h}px`, "important");
    }
  }, [width, height ?? 0] as const);
  const frame = await docsFrame(page);
  await expect.poll(() => frame.evaluate(() => window.innerWidth), { timeout: 10_000 }).toBe(width);
  if (height) await expect.poll(() => frame.evaluate(() => window.innerHeight), { timeout: 10_000 }).toBe(height);
}

/** WCAG relative-luminance contrast of two CSS colours, resolved by the frame's own canvas. */
export async function contrastIn(frame: Frame, a: string, b: string): Promise<number> {
  return frame.evaluate(([x, y]) => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    const px = (c: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const lum = (c: number[]) => c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }).reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    const [l1, l2] = [lum(px(x)), lum(px(y))];
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }, [a, b] as const);
}

/** The luminance-ish check that the frame really is in the mode under test (the card surface). */
export async function surfaceIsMode(frame: Frame, selector: string, mode: Mode): Promise<boolean> {
  const ratioToWhite = await frame.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const c = await contrastIn(frame, ratioToWhite, "#ffffff");
  return mode === "light" ? c < 1.5 : c > 8;
}

/**
 * Writes organization overrides for every flag in one connection, then polls `/config` once until all of them show.
 * The server caches override rows for featureflags.CacheTTL (30 s, db_provider.go:28/61) and a direct DB write sends no
 * invalidation, so the wait is one TTL for the whole set; one setFlag per flag paid it per flag (cloud r1: the hook ran
 * out of its budget while polling the third). Same row ids as setFlag, so the two never fight.
 */
async function setOrgFlags(organizationId: string, flags: Record<string, boolean>): Promise<void> {
  const client = new Client({ connectionString: process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://uniwork:uniwork@localhost:5432/uniwork?sslmode=disable" });
  await client.connect();
  try {
    for (const [flag, enabled] of Object.entries(flags)) {
      await client.query(
        `INSERT INTO feature_flag_overrides (id, flag_key, scope_type, scope_id, enabled, note, created_by, created_by_kind)
         VALUES ($1, $2, 'organization', $3, $4, 'e2e: ux floor', 'e2e', 'system')
         ON CONFLICT (flag_key, scope_type, scope_id) DO UPDATE SET enabled = $4`,
        [`e2e-${flag}-${organizationId}`, flag, organizationId, enabled],
      );
    }
  } finally {
    await client.end();
  }
  await expect.poll(async () => {
    const response = await fetch(`${e2eApiUrl}/api/v1/config?organization_id=${encodeURIComponent(organizationId)}`);
    if (!response.ok) return null;
    const shown = ((await response.json()) as { flags?: Record<string, boolean> }).flags ?? {};
    return Object.keys(flags).map((k) => `${k}=${shown[k]}`).join(",");
  }, { timeout: 100_000, intervals: [1_000], message: `${Object.keys(flags).join(", ")} never reached /config` }).toBe(Object.entries(flags).map(([k, v]) => `${k}=${v}`).join(","));
}

/**
 * The `ai` grant the host would hand the frame for this document: the same session mint the D host calls
 * (POST /documents/{id}/office/frame-token, handler office_frame.go mintOfficeFrameToken -> officeFrameAIGrant).
 */
async function frameAIGrant(request: APIRequestContext, seeded: SeededDocx): Promise<Record<string, unknown>> {
  const minted = await request.post(`${e2eApiUrl}/api/v1/documents/${seeded.documentId}/office/frame-token`, { headers: { authorization: `Bearer ${seeded.account.token}` } });
  expect(minted.ok(), `mint frame token: HTTP ${minted.status()} ${await minted.text()}`).toBeTruthy();
  return ((await minted.json()) as { ai?: Record<string, unknown> }).ai ?? {};
}

/**
 * The UniWork AI flags for a group of tests, in the group's own beforeAll: when the AI setup fails only that group
 * fails, and the S5/S6 tests still run. Call inside the test.describe of the group. It then proves the server side
 * of S7: the minted frame token grants `uniwork_ai` (member, office.ai_cloud on the default Starter plan,
 * AI_PROVIDER=fake resolving a model for office_uniwork_ai, office_ai_uniwork + office_ai_uniwork_docx), so a picker
 * without the row afterwards is the frame's own limit (openPicker), never a missing grant.
 */
export function aiFlagsBeforeAll(doc: () => SeededDocx): void {
  test.beforeAll(async ({ request }) => {
    await setOrgFlags(doc().organizationId, { office_ai_uniwork: true, office_ai_uniwork_docx: true });
    const grant = await frameAIGrant(request, doc());
    test.info().annotations.push({ type: "measured", description: `frame-token ai grant: ${JSON.stringify(grant)}` });
    expect(grant.uniwork_ai, "the frame token does not grant uniwork_ai: the server setup (AI_PROVIDER=fake, plan, flags) is wrong").toBe(true);
  });
}
