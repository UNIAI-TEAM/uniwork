import { expect, test, type APIRequestContext, type Frame, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
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
/** S5: the conflict dialog's backdrop carries the marker, the card is the alertdialog. */
export const S5_MASK = '[data-office-web="conflict"]';
export const S5_CARD = `${S5_MASK} .ow-dlg`;
export const S6_BAR = ".uw-remote-bar";
export const PICKER_POP = ".ai-model-pop";

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

/** Opens the picker popup and returns once the UniWork AI option is listed. */
export async function openPicker(frame: Frame): Promise<void> {
  await openAiPanel(frame);
  await frame.locator(".ai-model-chip").first().click();
  await frame.locator(PICKER_POP).waitFor({ state: "visible", timeout: 15_000 });
  await expect(frame.locator(`${PICKER_POP} [role="option"]`, { hasText: "UniWork AI" }).first(), "S7: no UniWork AI option (grant uniwork_ai off?)").toBeVisible({ timeout: 15_000 });
}

/** Selects UniWork AI in the picker (it closes) and reopens it, so the selected option is UniWork AI. */
export async function selectUniworkAi(frame: Frame): Promise<void> {
  await openPicker(frame);
  await frame.locator(`${PICKER_POP} [role="option"]`, { hasText: "UniWork AI" }).first().click();
  await expect(frame.locator(PICKER_POP)).toHaveCount(0, { timeout: 10_000 });
}

/** The dialog's choices in DOM order (data-choice), then whether the close X is the card's last control. */
export async function s5Choices(frame: Frame): Promise<{ ids: string[]; closeLast: boolean; ys: number[] }> {
  return frame.locator(S5_CARD).evaluate((card) => {
    const buttons = [...card.querySelectorAll<HTMLElement>("button")];
    const ids = buttons.filter((b) => b.dataset.choice).map((b) => b.dataset.choice!);
    const close = card.querySelector(".ow-dlg-close");
    return {
      ids,
      closeLast: close !== null && buttons[buttons.length - 1] === close,
      ys: buttons.filter((b) => b.dataset.choice).map((b) => b.getBoundingClientRect().top),
    };
  });
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
