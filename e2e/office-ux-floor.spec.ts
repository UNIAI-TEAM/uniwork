import { expect, test, type Frame } from "@playwright/test";
import { e2eBaseUrl } from "./api-url";
import { auditText } from "./contrast";
import { seedDocx, setFlag, type SeededDocx } from "./office-docs-web-fixtures";
import {
  EDITOR, FRAME_SELECTOR, PICKER_POP, S5_CARD, S5_MASK, S6_BAR, commitElsewhere, contrastIn, docsFrameInstalled,
  finding, focusedIn, makeDirty, openDocs, openPicker, pinnedVersion, prepare, reachConflict, s5Choices, selectUniworkAi,
  sizeFrame, surfaceIsMode, waitForBar, type Locale, type Mode,
} from "./office-ux-floor-fixtures";

/**
 * G7-09 (UNI-1383): the deterministic part of the UX acceptance checklist
 * (docs/office/g5g6g7/ux/g7-09-checklist.md), measured on the rendered D web page
 * that hosts the pinned Docs frame, inside the same-origin iframe. The rules are
 * EXPERIENCE.md › Accessibility Floor, State Patterns › Conflict dialog (S5),
 * Responsive & Platform and DESIGN.md › Colors; this file only checks them.
 *
 * States: S5 = dirty copy + a version committed through the API by a second
 * request + the frame's own Ctrl+S (409); S6 = a version committed while the
 * document is open (clean: info bar, dirty: warn bar); S7/S9 = UniWork AI with
 * AI_PROVIDER=fake on the server and office_ai_uniwork + office_ai_uniwork_docx
 * on for the organization (the frame token's `uniwork_ai` grant).
 *
 * A rule the pinned frame is known to break is a BLOCKING finding: the test
 * reaches the state, then `finding()` marks the rest expected-to-fail with the
 * finding id (a failure before that is a real failure; an unexpected pass means
 * the product was fixed and the marker goes).
 *
 * Run with OFFICE_UX_FLOOR_E2E=1 (server with AI_PROVIDER=fake for S7/S9).
 */
test.describe.configure({ timeout: 240_000 });
test.skip(process.env.OFFICE_UX_FLOOR_E2E !== "1", "Set OFFICE_UX_FLOOR_E2E=1 to run the G7-09 UX floor checks.");

const baseUrl = e2eBaseUrl;
const MODES: Mode[] = ["light", "dark"];
const LOCALES: Locale[] = ["vi", "en"];
/** The Floor/State Patterns order of S5 step 1 with edit access (save-copy and diff where the pin has them). */
const S5_ORDER = ["diff", "reload", "save-copy", "overwrite", "cancel"];

let seeded: SeededDocx;

test.beforeAll(async ({ browser, request }) => {
  test.skip(!(await docsFrameInstalled(request, baseUrl)), "the pinned Docs bundle is not installed in this web build");
  const context = await browser.newContext({ baseURL: baseUrl });
  try {
    seeded = await seedDocx(await context.newPage(), baseUrl, `ux-floor-${Date.now().toString(36)}`);
  } finally {
    await context.close();
  }
  await setFlag("office_engine", seeded.organizationId, true);
  await setFlag("office_ai_uniwork", seeded.organizationId, true);
  await setFlag("office_ai_uniwork_docx", seeded.organizationId, true);
  test.info().annotations.push({ type: "frame", description: pinnedVersion() });
});

async function audit(frame: Frame, root: string, label: string, mode: Mode): Promise<void> {
  const result = await auditText(frame, root);
  expect(result.colorLevel4, "canvas without CSS Color 4: the measurement would be silently wrong").toBe(true);
  expect(result.checked, `${label}: no text node measured — the selector slipped`).toBeGreaterThan(0);
  expect(result.fails, `${label} (${mode}): ${result.fails.join(" | ")}`).toEqual([]);
  test.info().annotations.push({ type: "contrast", description: `${label} ${mode}: ${result.checked} nodes, 0 below AA` });
}

async function shot(frame: Frame, name: string): Promise<void> {
  await frame.page().screenshot({ path: test.info().outputPath(`${name}.png`) });
}

test.describe("contrast on the rendered frame (DESIGN.md › Colors)", () => {
  for (const mode of MODES) {
    for (const locale of LOCALES) {
      test(`S6 clean + dirty bars and every reachable S5 step — ${mode} ${locale}`, async ({ page, request }) => {
        await prepare(page, baseUrl, mode, locale);
        const frame = await openDocs(page, seeded);
        // S6 clean: a version lands while the copy is clean -> info bar, document reloaded.
        await commitElsewhere(request, seeded);
        await waitForBar(frame, "info");
        await audit(frame, S6_BAR, "S6 clean", mode);
        await shot(frame, `s6-clean-${mode}-${locale}`);
        // S6 dirty: edit, another version lands -> warn bar.
        await makeDirty(page, `uw-ux-c-${Date.now().toString(36)}`);
        await commitElsewhere(request, seeded);
        await waitForBar(frame, "warn");
        await audit(frame, `${S6_BAR}.uw-remote-bar--warn`, "S6 dirty", mode);
        await shot(frame, `s6-dirty-${mode}-${locale}`);
        // S5 step 1: the save meets the 409.
        await page.frameLocator(FRAME_SELECTOR).locator(EDITOR).first().click();
        await page.keyboard.press("Control+s");
        await frame.locator(S5_CARD).waitFor({ state: "visible", timeout: 60_000 });
        expect(await surfaceIsMode(frame, S5_CARD, mode), `the frame is not in ${mode} mode`).toBe(true);
        await audit(frame, S5_CARD, "S5 step 1", mode);
        await shot(frame, `s5-step1-${mode}-${locale}`);
        // S5 step 2, Overwrite confirm, then Back.
        await frame.locator(`${S5_CARD} [data-choice="overwrite"]`).click();
        await frame.locator(`${S5_CARD} [data-choice="back"]`).waitFor();
        await audit(frame, S5_CARD, "S5 overwrite confirm", mode);
        await shot(frame, `s5-overwrite-${mode}-${locale}`);
        expect((await focusedIn(frame)).id, "Overwrite confirm: default focus Back").toBe("back");
        await frame.locator(`${S5_CARD} [data-choice="back"]`).click();
        expect((await focusedIn(frame)).id, "Back returns the focus to the button that opened the step").toBe("overwrite");
        // S5 step 2, web Reload confirm, then Back.
        await frame.locator(`${S5_CARD} [data-choice="reload"]`).click();
        await frame.locator(`${S5_CARD} [data-choice="back"]`).waitFor();
        await audit(frame, S5_CARD, "S5 reload confirm (web)", mode);
        await shot(frame, `s5-reload-${mode}-${locale}`);
        expect((await focusedIn(frame)).id, "web Reload confirm: default focus Back").toBe("back");
        await frame.locator(`${S5_CARD} [data-choice="back"]`).click();
        expect((await focusedIn(frame)).id).toBe("reload");
        await frame.locator(`${S5_CARD} [data-choice="cancel"]`).click();
        await expect(frame.locator(S5_MASK)).toHaveCount(0);
      });

      test(`S7 picker with UniWork AI and the S9 result line — ${mode} ${locale}`, async ({ page }) => {
        await prepare(page, baseUrl, mode, locale);
        const frame = await openDocs(page, seeded);
        await openPicker(frame);
        await audit(frame, PICKER_POP, "S7 picker", mode);
        await shot(frame, `s7-picker-${mode}-${locale}`);
        await frame.locator(`${PICKER_POP} [role="option"]`, { hasText: "UniWork AI" }).first().click();
        // S9: one UniWork AI turn against the fake provider; the answer (or its error line) is measured.
        const composer = frame.locator(".ai-composer textarea, .ai-composer [contenteditable='true']").first();
        await composer.click();
        await page.keyboard.type("Tóm tắt tài liệu này trong một câu.");
        await page.keyboard.press("Enter");
        await frame.locator(".ai-chat .ai-msg-actions, .ai-chat .ai-msg-error").first().waitFor({ state: "visible", timeout: 90_000 });
        await audit(frame, ".ai-chat", "S9 result/error", mode);
        await shot(frame, `s9-result-${mode}-${locale}`);
      });
    }

    test(`S7 the selected option's focus ring is >= 3:1 against accent-soft — ${mode}`, async ({ page }) => {
      await prepare(page, baseUrl, mode, "vi");
      const frame = await openDocs(page, seeded);
      await selectUniworkAi(frame);
      // Keyboard open, so :focus-visible applies: the chip, Enter, the list enters at the selected option.
      await frame.locator(".ai-model-chip").first().focus();
      await page.keyboard.press("Enter");
      await frame.locator(PICKER_POP).waitFor();
      const selected = frame.locator(".ai-model-item.selected").first();
      await selected.focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowUp");
      await selected.focus();
      const ring = await selected.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), color: cs.outlineColor, bg: cs.backgroundColor, focusVisible: el.matches(":focus-visible") };
      });
      test.info().annotations.push({ type: "measured", description: JSON.stringify(ring) });
      expect(ring.focusVisible, "the selected option is not :focus-visible").toBe(true);
      finding("UXF-01", "Floor › Focus ring: .ai-model-item.selected:focus-visible has outline 2px var(--accent) at >= 3:1 against accent-soft (pin: outline none)");
      expect(ring.style).not.toBe("none");
      expect(ring.width).toBeGreaterThanOrEqual(2);
      expect(await contrastIn(frame, ring.color, ring.bg)).toBeGreaterThanOrEqual(3);
    });
  }
});

test.describe("S5 order, focus, trap and inert (State Patterns › Conflict dialog (S5), Floor › S5)", () => {
  test("DOM order = visual order = the standard order, default focus Cancel, Tab stays in, the rest is inert", async ({ page, request }) => {
    await prepare(page, baseUrl, "light", "vi");
    const frame = await reachConflict(page, request, seeded);
    const aria = await frame.locator(S5_CARD).evaluate((card) => {
      const title = document.getElementById(card.getAttribute("aria-labelledby") ?? "");
      return { role: card.getAttribute("role"), modal: card.getAttribute("aria-modal"), title: title?.tagName, tabindex: title?.getAttribute("tabindex"), body: !!document.getElementById(card.getAttribute("aria-describedby") ?? "") };
    });
    expect(aria, "Floor › S5: alertdialog, aria-modal, h2[tabindex=-1] title, described").toEqual({ role: "alertdialog", modal: "true", title: "H2", tabindex: "-1", body: true });
    const { ids, closeLast, ys } = await s5Choices(frame);
    const canonical = S5_ORDER.filter((id) => ids.includes(id));
    expect(ids, "S5 step 1 choices in DOM order").toEqual(canonical);
    expect(ids, "edit access: Reload, Overwrite, Cancel present").toEqual(expect.arrayContaining(["reload", "overwrite", "cancel"]));
    expect(closeLast, "the close X is the card's last control").toBe(true);
    expect([...ys].sort((a, b) => a - b), "stacked buttons: visual top-to-bottom = DOM order").toEqual(ys);
    expect((await focusedIn(frame)).id, "default focus").toBe("cancel");
    // Tab cycles through every control of the card and wraps, never leaving it.
    const seen: string[] = [];
    for (let i = 0; i < ids.length + 3; i++) {
      await page.keyboard.press("Tab");
      const f = await focusedIn(frame);
      expect(f.inCard, `Tab ${i + 1} left the dialog (${f.id})`).toBe(true);
      seen.push(f.id);
    }
    expect(seen, "Tab reaches every choice and the X").toEqual(expect.arrayContaining([...ids, "close"]));
    // The rest of the frame is inert; the host page outside the iframe is inert while `modal` is on.
    const frameInert = await frame.evaluate((mask) => [...document.body.children].filter((el) => !el.matches(mask) && !el.closest("[inert]")).map((el) => el.className || el.tagName), S5_MASK);
    expect(frameInert, "frame body children outside the dialog without inert").toEqual([]);
    const hostOpen = await page.locator(FRAME_SELECTOR).evaluate((iframe) => {
      const loose: string[] = [];
      for (let n: HTMLElement | null = iframe as HTMLElement; n && n !== document.body; n = n.parentElement) {
        for (const sib of Array.from(n.parentElement?.children ?? [])) {
          if (sib === n || sib.tagName === "SCRIPT" || sib.closest("[inert]") || (sib as HTMLElement).hidden) continue;
          if (getComputedStyle(sib).display === "none") continue;
          loose.push(`${sib.tagName}.${(sib as HTMLElement).className}`.slice(0, 80));
        }
      }
      return loose;
    });
    expect(hostOpen, "host page parts outside the iframe without inert while S5 is open").toEqual([]);
    // Esc = Cancel: the dialog closes, the host drops its inert.
    await page.keyboard.press("Escape");
    await expect(frame.locator(S5_MASK)).toHaveCount(0);
    await expect.poll(() => page.locator("[data-office-frame-modal-dimmed]").count(), { timeout: 10_000 }).toBe(0);
  });

  test("aria-disabled choices (web offline) stay in the Tab loop with a reason", async ({ page, request }) => {
    await prepare(page, baseUrl, "light", "vi");
    const frame = await reachConflict(page, request, seeded);
    await page.context().setOffline(true);
    try {
      await expect(frame.locator(`${S5_CARD} [data-choice="reload"]`)).toHaveAttribute("aria-disabled", "true", { timeout: 10_000 });
      await expect(frame.locator(`${S5_CARD} [data-choice="overwrite"]`)).toHaveAttribute("aria-disabled", "true");
      const described = await frame.locator(`${S5_CARD} [data-choice="reload"]`).evaluate((b) => document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent ?? "");
      expect(described.trim(), "aria-describedby names the offline reason").not.toBe("");
      const seen = new Set<string>();
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        seen.add((await focusedIn(frame)).id);
      }
      expect([...seen]).toEqual(expect.arrayContaining(["reload", "overwrite", "cancel"]));
      await shot(frame, "s5-offline");
    } finally {
      await page.context().setOffline(false);
    }
  });

  test("Save copy sits between Reload and Overwrite with edit access", async ({ page, request }) => {
    await prepare(page, baseUrl, "light", "vi");
    const frame = await reachConflict(page, request, seeded);
    finding("UXF-02", "State Patterns › S5: 'Lưu thành bản sao…' (uwConflictSaveCopy, OQ-UX6) between Reload and Overwrite when the user can edit (pin: absent)");
    expect((await s5Choices(frame)).ids).toEqual(["reload", "save-copy", "overwrite", "cancel"]);
  });

  test("Docs shows 'Xem khác biệt' before Reload", async ({ page, request }) => {
    await prepare(page, baseUrl, "light", "vi");
    const frame = await reachConflict(page, request, seeded);
    finding("UXF-03", "State Patterns › S5: Docs/DOCX has 'Xem khác biệt' after the comparison table, before Reload (OQ-UX9) (pin: absent)");
    const before = await frame.locator(S5_CARD).evaluate((card) => {
      const reload = card.querySelector('[data-choice="reload"]');
      const diff = [...card.querySelectorAll("button, a")].find((b) => /Xem khác biệt|View differences/i.test(b.textContent ?? ""));
      return !!diff && !!reload && !!(diff.compareDocumentPosition(reload) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(before).toBe(true);
  });

  test("the window live nodes stay outside the inert tree while S5 is open", async ({ page, request }) => {
    await prepare(page, baseUrl, "light", "vi");
    const frame = await reachConflict(page, request, seeded);
    const live = await frame.evaluate(() => [...document.querySelectorAll(".uw-live")].map((el) => ({ role: el.getAttribute("role"), inert: !!el.closest("[inert]") })));
    test.info().annotations.push({ type: "measured", description: JSON.stringify(live) });
    expect(live.length, "the frame has window live nodes").toBeGreaterThanOrEqual(2);
    finding("UXF-04", "Floor › Vùng live: the window's live nodes are siblings of the inert part, never inside it (pin: frame-dialog inertSiblings inerts every body child, .uw-live included)");
    expect(live.filter((l) => l.inert)).toEqual([]);
  });
});

test.describe("live regions (Floor › Vùng live)", () => {
  test("the frame has its two fixed live nodes from load, before any bar", async ({ page }) => {
    await prepare(page, baseUrl, "light", "vi");
    const frame = await openDocs(page, seeded);
    const nodes = await frame.evaluate(() => ({
      status: document.querySelectorAll('.uw-live[role="status"]').length,
      alert: document.querySelectorAll('.uw-live[role="alert"]').length,
      alertText: document.querySelector('.uw-live[role="alert"]')?.textContent ?? null,
    }));
    test.info().annotations.push({ type: "measured", description: JSON.stringify(nodes) });
    expect(nodes.status, "one polite window node from load").toBe(1);
    expect(nodes.alert, "one assertive window node from load").toBe(1);
    expect(nodes.alertText ?? "", "the alert node starts empty").toBe("");
  });

  test("an S6 bar is read once, through the window node; the bar itself is not live", async ({ page, request }) => {
    await prepare(page, baseUrl, "light", "vi");
    const frame = await openDocs(page, seeded);
    await frame.evaluate(() => {
      const w = window as unknown as { __uwLive: string[] };
      w.__uwLive = [];
      new MutationObserver((records) => {
        for (const r of records) {
          const el = (r.target.nodeType === Node.TEXT_NODE ? r.target.parentElement : r.target) as HTMLElement | null;
          const live = el?.closest?.(".uw-live");
          if (live && live.textContent) w.__uwLive.push(`${live.getAttribute("role")}:${live.textContent}`);
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await commitElsewhere(request, seeded);
    await waitForBar(frame, "info");
    await page.waitForTimeout(2_000);
    const result = await frame.evaluate((bar) => {
      const el = document.querySelector(bar)!;
      const text = el.querySelector(".uw-remote-bar-text")?.textContent ?? "";
      return {
        text,
        liveInBar: el.matches('[role="status"],[role="alert"],[aria-live]') || !!el.querySelector('[role="status"],[role="alert"],[aria-live]'),
        role: el.getAttribute("role"),
        label: el.getAttribute("aria-label"),
        writes: (window as unknown as { __uwLive: string[] }).__uwLive,
      };
    }, S6_BAR);
    test.info().annotations.push({ type: "measured", description: JSON.stringify(result) });
    expect(result.role, "S6 bar is a region").toBe("region");
    expect(result.label ?? "", "the region has its label (uwRemoteRegion)").not.toBe("");
    expect(result.liveInBar, "the bar carries no role=status|alert / aria-live").toBe(false);
    const reads = new Set(result.writes.filter((w) => w.startsWith("status:") && w.includes(result.text.trim())));
    expect(reads.size, "the new-version sentence reaches the polite window node exactly once").toBe(1);
  });
});

test.describe("forced colors (DESIGN.md › Colors › Forced colors)", () => {
  test("S5 buttons keep a visible border, not colour alone", async ({ page, request }) => {
    await prepare(page, baseUrl, "light", "vi");
    await page.emulateMedia({ forcedColors: "active" });
    const frame = await reachConflict(page, request, seeded);
    const borders = await frame.locator(S5_CARD).evaluate((card) => [...card.querySelectorAll<HTMLElement>(".ow-dlg-btn")].map((b) => {
      const cs = getComputedStyle(b);
      return { id: b.dataset.choice, width: parseFloat(cs.borderTopWidth), style: cs.borderTopStyle, color: cs.borderTopColor };
    }));
    test.info().annotations.push({ type: "measured", description: JSON.stringify(borders) });
    await shot(frame, "s5-forced-colors");
    for (const b of borders) {
      expect(b.width, `${b.id}: border width`).toBeGreaterThanOrEqual(1);
      expect(b.style, `${b.id}: border style`).not.toBe("none");
      expect(b.color, `${b.id}: border is transparent in forced colors`).not.toMatch(/rgba\(\d+, \d+, \d+, 0\)|transparent/);
    }
  });

  test("S5 aria-disabled buttons use GrayText text and border", async ({ page, request }) => {
    await prepare(page, baseUrl, "light", "vi");
    await page.emulateMedia({ forcedColors: "active" });
    const frame = await reachConflict(page, request, seeded);
    await page.context().setOffline(true);
    try {
      await expect(frame.locator(`${S5_CARD} [data-choice="overwrite"]`)).toHaveAttribute("aria-disabled", "true", { timeout: 10_000 });
      const got = await frame.locator(S5_CARD).evaluate((card) => {
        const probe = document.createElement("span");
        probe.style.color = "GrayText";
        card.append(probe);
        const gray = getComputedStyle(probe).color;
        probe.remove();
        return [...card.querySelectorAll<HTMLElement>('.ow-dlg-btn[aria-disabled="true"]')].map((b) => ({ id: b.dataset.choice, color: getComputedStyle(b).color, border: getComputedStyle(b).borderTopColor, gray }));
      });
      test.info().annotations.push({ type: "measured", description: JSON.stringify(got) });
      expect(got.length).toBeGreaterThan(0);
      finding("UXF-05", "DESIGN › Forced colors: [aria-disabled=true] buttons use GrayText for text and border (pin: frame-dialog.css has no forced-colors rule, opacity only)");
      for (const b of got) {
        expect(b.color, `${b.id}: text`).toBe(b.gray);
        expect(b.border, `${b.id}: border`).toBe(b.gray);
      }
    } finally {
      await page.context().setOffline(false);
    }
  });

  test("S7 the selected picker option has a 2px Highlight border, not only a fill", async ({ page }) => {
    await prepare(page, baseUrl, "light", "vi");
    await page.emulateMedia({ forcedColors: "active" });
    const frame = await openDocs(page, seeded);
    await selectUniworkAi(frame);
    await openPicker(frame);
    const sel = await frame.locator(".ai-model-item.selected").first().evaluate((el) => {
      const probe = document.createElement("span");
      probe.style.color = "Highlight";
      el.append(probe);
      const hl = getComputedStyle(probe).color;
      probe.remove();
      const cs = getComputedStyle(el);
      return { width: parseFloat(cs.borderTopWidth), color: cs.borderTopColor, outline: cs.outlineStyle, hl };
    });
    test.info().annotations.push({ type: "measured", description: JSON.stringify(sel) });
    await shot(frame, "s7-forced-colors");
    finding("UXF-06", "DESIGN › Forced colors: .ai-model-item.selected has a 2px Highlight border (pin: background only)");
    expect(sel.width).toBeGreaterThanOrEqual(2);
    expect(sel.color).toBe(sel.hl);
  });
});

test.describe("zoom, narrow frames and motion (Floor, Responsive & Platform)", () => {
  test("zoom 200 %: no status label clipped by nowrap, S5 fully reachable", async ({ page, request }) => {
    // 200 % zoom = half the CSS viewport at twice the device pixels: 1280x800 -> 640x400.
    await prepare(page, baseUrl, "light", "vi");
    await page.setViewportSize({ width: 640, height: 400 });
    const frame = await openDocs(page, seeded);
    await makeDirty(page, `uw-ux-z-${Date.now().toString(36)}`);
    await commitElsewhere(request, seeded);
    await waitForBar(frame, "warn");
    await page.frameLocator(FRAME_SELECTOR).locator(EDITOR).first().click();
    await page.keyboard.press("Control+s");
    await frame.locator(S5_CARD).waitFor({ state: "visible", timeout: 60_000 });
    const clipped = await frame.evaluate(([bar, card]) => [...document.querySelectorAll<HTMLElement>(`${bar} *, ${card} *`)].filter((el) => {
      const cs = getComputedStyle(el);
      const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim());
      return own && cs.whiteSpace.includes("nowrap") && cs.overflow !== "visible" && el.scrollWidth > el.clientWidth + 1;
    }).map((el) => (el.textContent ?? "").slice(0, 40)), [S6_BAR, S5_CARD] as const);
    expect(clipped, "labels cut by nowrap at 200 %").toEqual([]);
    await reachable(frame);
    await shot(frame, "zoom-200");
  });

  test("S5 at 320x256 CSS px: the dialog scrolls, the title is not cut, every button is reachable", async ({ page, request }) => {
    await prepare(page, baseUrl, "light", "vi");
    const frame = await reachConflict(page, request, seeded);
    await sizeFrame(page, 320, 256);
    const title = await frame.locator(`${S5_CARD} .ow-dlg-title`).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height, cut: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1 };
    });
    expect(title.top, "the title starts inside the frame").toBeGreaterThanOrEqual(0);
    expect(title.height).toBeGreaterThan(0);
    expect(title.cut, "the title is clipped").toBe(false);
    const scroll = await frame.locator(S5_MASK).evaluate((m) => ({ sh: m.scrollHeight, ch: m.clientHeight, oy: getComputedStyle(m).overflowY }));
    if (scroll.sh > scroll.ch) expect(["auto", "scroll"], "taller than the frame and the backdrop does not scroll").toContain(scroll.oy);
    await reachable(frame);
    await shot(frame, "s5-320x256");
  });

  for (const width of [390, 600]) {
    test(`narrow web frame ${width}px: S5 full width minus 16px margins, buttons stacked`, async ({ page, request }) => {
      await prepare(page, baseUrl, "light", "vi");
      const frame = await reachConflict(page, request, seeded);
      await sizeFrame(page, width);
      const box = await frame.locator(S5_CARD).evaluate((card) => {
        const r = card.getBoundingClientRect();
        const btns = [...card.querySelectorAll<HTMLElement>(".ow-dlg-btn")].map((b) => b.getBoundingClientRect());
        return { left: r.left, width: r.width, inner: window.innerWidth, xs: btns.map((b) => Math.round(b.left)), ys: btns.map((b) => b.top) };
      });
      test.info().annotations.push({ type: "measured", description: JSON.stringify(box) });
      await shot(frame, `s5-narrow-${width}`);
      expect(new Set(box.xs).size, "buttons share one column").toBe(1);
      expect([...box.ys].sort((a, b) => a - b)).toEqual(box.ys);
      if (width > 448 + 32) finding("UXF-07", "Responsive › Web hẹp (< 768px): S5 takes the full width minus 16px margins (pin: .ow-dlg max-width 448px)");
      expect(Math.abs(box.left - 16), "16px left margin").toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - (box.inner - 32)), "full width minus 2x16px").toBeLessThanOrEqual(1);
    });
  }

  test("reduced motion: no slide/fade on S6 or S5", async ({ page, request }) => {
    await prepare(page, baseUrl, "light", "vi");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const frame = await reachConflict(page, request, seeded);
    const moving = await frame.evaluate(([bar, mask]) => document.getAnimations().filter((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
      const t = a.effect?.getTiming();
      return !!target?.closest(`${bar}, ${mask}`) && Number(t?.duration ?? 0) > 0;
    }).length, [S6_BAR, S5_MASK] as const);
    expect(moving).toBe(0);
  });

  test("target sizes: every S5 and S6 control >= 24x24 CSS px (fine pointer)", async ({ page, request }) => {
    await prepare(page, baseUrl, "light", "vi");
    const frame = await reachConflict(page, request, seeded);
    const small = await frame.evaluate(([bar, card]) => [...document.querySelectorAll<HTMLElement>(`${bar} button, ${card} button`)].map((b) => {
      const r = b.getBoundingClientRect();
      return { name: (b.textContent || b.getAttribute("aria-label") || "").trim().slice(0, 30), w: r.width, h: r.height };
    }).filter((b) => b.w < 24 || b.h < 24), [S6_BAR, S5_CARD] as const);
    expect(small).toEqual([]);
  });
});

test.describe("S7/S8 structure (Floor › S7, S8)", () => {
  test("S7 listbox sits on the list, Manage and the footer are siblings after it", async ({ page }) => {
    await prepare(page, baseUrl, "light", "vi");
    const frame = await openDocs(page, seeded);
    await openPicker(frame);
    const roles = await frame.locator(PICKER_POP).evaluate((pop) => ({
      pop: pop.getAttribute("role"),
      list: pop.querySelector(".ai-model-pop-list")?.getAttribute("role") ?? null,
      manageInList: !!pop.querySelector('[role="listbox"] .ai-model-manage'),
    }));
    test.info().annotations.push({ type: "measured", description: JSON.stringify(roles) });
    finding("UXF-08", "Floor › S7: role=listbox on .ai-model-pop-list, .ai-model-pop is a labelled group, Manage outside the listbox (pin: listbox on .ai-model-pop with Manage inside)");
    expect(roles).toEqual({ pop: "group", list: "listbox", manageInList: false });
  });

  test("S8 disclosure region shows on the first UniWork AI turn and gates Send", async ({ page }) => {
    await prepare(page, baseUrl, "light", "vi");
    const frame = await openDocs(page, seeded);
    await selectUniworkAi(frame);
    finding("UXF-09", "Floor › S8 / IA S8: a region labelled aiUniworkDisclosureLabel with 'Đã hiểu' before the first UniWork AI turn (pin: strings only, no component renders it)");
    const region = frame.getByRole("region", { name: /Nội dung gửi tới UniWork AI|sent to UniWork AI/i });
    await expect(region).toBeVisible({ timeout: 10_000 });
    await audit(frame, ".ai-composer", "S8 disclosure", "light");
  });
});

/** Every S5 control can be scrolled into view and is the topmost element at its centre. */
async function reachable(frame: Frame): Promise<void> {
  const blocked = await frame.locator(S5_CARD).evaluate((card) => [...card.querySelectorAll<HTMLElement>("button")].filter((b) => {
    b.scrollIntoView({ block: "center" });
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.width === 0 || r.height === 0 || !(hit === b || b.contains(hit));
  }).map((b) => b.dataset.choice ?? b.className));
  expect(blocked, "S5 controls not reachable").toEqual([]);
}
