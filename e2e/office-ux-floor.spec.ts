import { expect, test, type Frame } from "@playwright/test";
import { e2eBaseUrl } from "./api-url";
import { auditText } from "./contrast";
import { seedDocx, setFlag, type SeededDocx } from "./office-docs-web-fixtures";
import {
  COMPOSER, EDITOR, FRAME_SELECTOR, PICKER_POP, S5_CARD, S5_MASK, S6_BAR, aiFlagsBeforeAll, clippedLabels, commitElsewhere, contrastIn, docsFrameInstalled,
  expectFocus, finding, focusedIn, liveReadsOf, makeDirty, motionSeen, openDocs, openPicker, pinnedVersion, prepare, reachable,
  reachConflict, recordLiveWrites, recordMotion, s5Choices, selectUniworkAi, sizeFrame, smallTargets, surfaceIsMode, visualOrder,
  uniworkOption, waitForBar, type Locale, type Mode,
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
 * document is open (clean: info bar, dirty: warn bar); S7/S8/S9 = UniWork AI with
 * AI_PROVIDER=fake on the server and office_ai_uniwork + office_ai_uniwork_docx on
 * for the organization (the frame token's `uniwork_ai` grant), set in that group's
 * own beforeAll so an AI setup failure never takes the S5/S6 tests with it.
 * The Docs frame's own dialog marker is `data-docs-web`; S5_MASK accepts it and `data-office-web`, so a re-pin
 * (REPIN-1) runs this file unchanged: the pin is read from docs.pin.json, never written here.
 *
 * A rule the pinned frame is known to break is a BLOCKING finding: the test
 * reaches the state, then `finding()` marks the rest expected-to-fail with the
 * finding id (a failure before that is a real failure; an unexpected pass means
 * the product was fixed and the marker goes).
 *
 * Reading an expected-fail: `test.fail` also absorbs a timeout or a throw after the state was reached, so read
 * each expected-fail's error against the rule in its `finding` annotation; an error that is not about that rule
 * (a timeout, a selector that slipped) is a real failure. (`expect.soft` under test.fail would absorb the same.)
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
  test.info().annotations.push({ type: "frame", description: pinnedVersion() });
});

async function audit(frame: Frame, root: string, label: string, mode: Mode): Promise<void> {
  const result = await auditText(frame, root);
  expect(result.colorLevel4, "canvas without CSS Color 4: the measurement would be silently wrong").toBe(true);
  expect(result.checked, `${label}: no text node measured — the selector slipped`).toBeGreaterThan(0);
  expect(result.fails, `${label} (${mode}): ${result.fails.join(" | ")}`).toEqual([]);
  const min = result.min ? `min ${result.min.ratio}:1 (needs ${result.min.need}) at "${result.min.text}"` : "no min";
  test.info().annotations.push({ type: "contrast", description: `${label} ${mode}: ${result.checked} nodes, 0 below AA, ${min}` });
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
        await expectFocus(frame, "back", "Overwrite confirm: default focus Back");
        await frame.locator(`${S5_CARD} [data-choice="back"]`).click();
        await expectFocus(frame, "overwrite", "Back returns the focus to the button that opened the step");
        // S5 step 2, web Reload confirm, then Back.
        await frame.locator(`${S5_CARD} [data-choice="reload"]`).click();
        await frame.locator(`${S5_CARD} [data-choice="back"]`).waitFor();
        await audit(frame, S5_CARD, "S5 reload confirm (web)", mode);
        await shot(frame, `s5-reload-${mode}-${locale}`);
        await expectFocus(frame, "back", "web Reload confirm: default focus Back");
        await frame.locator(`${S5_CARD} [data-choice="back"]`).click();
        await expectFocus(frame, "reload", "Back returns the focus to Reload");
        await frame.locator(`${S5_CARD} [data-choice="cancel"]`).click();
        await expect(frame.locator(S5_MASK)).toHaveCount(0);
      });
    }
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
    const { ids, closeLast, pos } = await s5Choices(frame);
    const canonical = S5_ORDER.filter((id) => ids.includes(id));
    expect(ids, "S5 step 1 choices in DOM order").toEqual(canonical);
    expect(ids, "edit access: Reload, Overwrite, Cancel present").toEqual(expect.arrayContaining(["reload", "overwrite", "cancel"]));
    expect(closeLast, "the close X is the card's last control").toBe(true);
    expect(visualOrder(pos), "visual reading order (top to bottom, then left to right) = DOM order").toEqual(ids.map((_, i) => i));
    await expectFocus(frame, "cancel", "default focus");
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
    const frameInert = await frame.evaluate((mask) => [...document.body.children].filter((el) => !el.matches(mask) && !el.matches(".uw-live") /* UXF-04's own test */ && !el.closest("[inert]")).map((el) => el.className || el.tagName), S5_MASK);
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
    finding("UXF-02", "State Patterns › S5: 'Lưu thành bản sao…' (uwConflictSaveCopy, OQ-UX6) between Reload and Overwrite when the user can edit (pin: absent; owner: UXF-FIX (UNI-1824), lane g5-fork_main)");
    const { ids } = await s5Choices(frame);
    expect(ids, "save-copy, reload and overwrite present").toEqual(expect.arrayContaining(["reload", "save-copy", "overwrite"]));
    // Relative order only: UXF-03 (diff first) is its own test, so fixing it must not change this verdict.
    expect(ids.indexOf("reload"), "Reload before Save copy").toBeLessThan(ids.indexOf("save-copy"));
    expect(ids.indexOf("save-copy"), "Save copy before Overwrite").toBeLessThan(ids.indexOf("overwrite"));
  });

  test("Docs shows 'Xem khác biệt' before Reload", async ({ page, request }) => {
    await prepare(page, baseUrl, "light", "vi");
    const frame = await reachConflict(page, request, seeded);
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
    expect(live.length, "the frame has a window live node once a bar was announced").toBeGreaterThanOrEqual(1);
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
    await recordLiveWrites(frame);
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
      };
    }, S6_BAR);
    test.info().annotations.push({ type: "measured", description: JSON.stringify(result) });
    expect(result.role, "S6 bar is a region").toBe("region");
    expect(result.label ?? "", "the region has its label (uwRemoteRegion)").not.toBe("");
    expect(result.liveInBar, "the bar carries no role=status|alert / aria-live").toBe(false);
    expect(result.text.trim(), "the bar has its sentence").not.toBe("");
    // One entry per write that adds text (no Set): a double write or a clear + rewrite of the sentence is two entries.
    expect(await liveReadsOf(frame, result.text.trim()), "the new-version sentence reaches the polite window node exactly once").toHaveLength(1);
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
      for (const b of got) {
        expect(b.color, `${b.id}: text`).toBe(b.gray);
        expect(b.border, `${b.id}: border`).toBe(b.gray);
      }
    } finally {
      await page.context().setOffline(false);
    }
  });

});

test.describe("zoom, narrow frames and motion (Floor, Responsive & Platform)", () => {
  test("zoom 200 % and WCAG 1.4.12 text spacing: no status label clipped, S5 fully reachable", async ({ page, request }) => {
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
    expect(await clippedLabels(frame, false), "labels cut by nowrap at 200 %").toEqual([]);
    await reachable(frame);
    await shot(frame, "zoom-200");
    // WCAG 1.4.12 text spacing (Floor › Phóng to 200% / text spacing): line height 1.5, paragraph spacing 2, letter 0.12, word 0.16 (em).
    await frame.addStyleTag({ content: "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }" });
    expect(await clippedLabels(frame, true), "labels cut or hidden with the 1.4.12 spacing overrides").toEqual([]);
    await reachable(frame);
    await shot(frame, "text-spacing");
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
      expect(new Set(box.ys.map(Math.round)).size, "stacked: every button on its own row").toBe(box.ys.length);
      expect([...box.ys].sort((a, b) => a - b), "stacked top-to-bottom = DOM order").toEqual(box.ys);
      expect(Math.abs(box.left - 16), "16px left margin").toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - (box.inner - 32)), "full width minus 2x16px").toBeLessThanOrEqual(1);
    });
  }

  test("reduced motion: no slide/fade on S6 or S5", async ({ page, request }) => {
    await prepare(page, baseUrl, "light", "vi");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const frame = await openDocs(page, seeded);
    // The recorder goes in BEFORE the surfaces appear: a finished animation/transition is gone from getAnimations().
    await recordMotion(frame, `${S6_BAR}, ${S5_MASK}`);
    await commitElsewhere(request, seeded);
    await waitForBar(frame, "info");
    await makeDirty(page, `uw-ux-m-${Date.now().toString(36)}`);
    await commitElsewhere(request, seeded);
    await waitForBar(frame, "warn");
    await page.frameLocator(FRAME_SELECTOR).locator(EDITOR).first().click();
    await page.keyboard.press("Control+s");
    await frame.locator(S5_CARD).waitFor({ state: "visible", timeout: 60_000 });
    await page.waitForTimeout(1_000);
    const motion = await motionSeen(frame, [S6_BAR, S5_MASK, S5_CARD]);
    test.info().annotations.push({ type: "measured", description: JSON.stringify(motion) });
    expect(motion.missing, "surfaces not found: the measurement would be vacuous").toEqual([]);
    expect(motion.moving, "slide/fade under prefers-reduced-motion").toEqual([]);
  });

  test("target sizes: every S5 and S6 control >= 24x24 CSS px (fine pointer)", async ({ page, request }) => {
    await prepare(page, baseUrl, "light", "vi");
    const frame = await reachConflict(page, request, seeded);
    const small = await smallTargets(frame);
    expect(small).toEqual([]);
  });
});

test.describe("UniWork AI surfaces: S7 picker, S8 disclosure, S9 result (own beforeAll for the AI flags)", () => {
  aiFlagsBeforeAll(() => seeded);
  for (const mode of MODES) {
    for (const locale of LOCALES) {
      test(`S7 picker with UniWork AI and the S9 result line — ${mode} ${locale}`, async ({ page }) => {
        await prepare(page, baseUrl, mode, locale);
        const frame = await openDocs(page, seeded);
        await openPicker(frame);
        await audit(frame, PICKER_POP, "S7 picker", mode);
        await shot(frame, `s7-picker-${mode}-${locale}`);
        await uniworkOption(frame).click();
        // S9: one UniWork AI turn (disclosure acknowledged first) against the fake provider; the finished reply is detected by its action toolbar (or the error line) and measured.
        const composer = frame.locator(COMPOSER).first();
        await composer.click();
        await page.keyboard.type("Tóm tắt tài liệu này trong một câu.");
        // The first UniWork AI turn shows the S8 disclosure and Send stays aria-disabled until it is acknowledged; Enter would never send.
        const disclosure = frame.getByRole("region", { name: /Nội dung gửi tới UniWork AI|What UniWork AI receives/i });
        await expect(disclosure).toBeVisible({ timeout: 10_000 });
        await frame.getByRole("button", { name: /Đã hiểu|Got it/i }).first().click();
        const sendBtn = frame.locator(".ai-send-btn:not(.ai-stop-btn)").first();
        await expect(sendBtn, "S9: Send is enabled after the disclosure acknowledgement").not.toHaveAttribute("aria-disabled", "true");
        await sendBtn.click();
        await frame.locator(".ai-chat .ai-msg-toolbar, .ai-chat .ai-msg-actions, .ai-chat .ai-msg-error").first().waitFor({ state: "visible", timeout: 90_000 });
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
      expect(ring.style).not.toBe("none");
      expect(ring.width).toBeGreaterThanOrEqual(2);
      expect(await contrastIn(frame, ring.color, ring.bg)).toBeGreaterThanOrEqual(3);
    });
  }

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
    expect(sel.width).toBeGreaterThanOrEqual(2);
    expect(sel.color).toBe(sel.hl);
  });

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
    expect(roles).toEqual({ pop: "group", list: "listbox", manageInList: false });
  });

  test("S8 disclosure region shows on the first UniWork AI turn and gates Send", async ({ page }) => {
    await prepare(page, baseUrl, "light", "vi");
    const frame = await openDocs(page, seeded);
    await selectUniworkAi(frame);
    const send = frame.locator(".ai-send-btn:not(.ai-stop-btn)").first();
    await expect(send, "S8: the composer has its Send button").toBeVisible({ timeout: 15_000 });
    // RFE-202: a non-empty composer, so an empty-composer `disabled` can never pass for the disclosure gate.
    await frame.locator(COMPOSER).first().click();
    await page.keyboard.type("Tóm tắt tài liệu này.");
    const region = frame.getByRole("region", { name: /Nội dung gửi tới UniWork AI|What UniWork AI receives/i });
    await expect(region).toBeVisible({ timeout: 10_000 });
    await expect(send, "Send is aria-disabled before the acknowledgement").toHaveAttribute("aria-disabled", "true");
    const reason = await send.evaluate((b) => b.getAttribute("aria-describedby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").join(" ") ?? "");
    // aiUniworkSendNeedsAck (vi/en) — the disclosure is the reason, not an empty composer.
    expect(reason, "Send's aria-describedby names the disclosure reason").toMatch(/xác nhận lời công bố|confirm the notice/i);
    await audit(frame, ".ai-composer", "S8 disclosure", "light");
    await frame.getByRole("button", { name: /Đã hiểu|Got it/i }).first().click();
    await expect(send, "Send is enabled after 'Đã hiểu'").not.toHaveAttribute("aria-disabled", "true");
    await expect(send, "Send is enabled after 'Đã hiểu' (the composer is not empty)").toBeEnabled();
  });
});
