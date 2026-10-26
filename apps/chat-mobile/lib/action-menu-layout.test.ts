// The long-press menu's fit (action-menu-layout.ts): on the phones the app is
// sold on, at the default and the largest text sizes, the column never runs
// past the window, so every row is reachable by a scroll.
import { describe, expect, it } from "vitest";
import {
  actionMenuLayout,
  COMPACT_WINDOW_HEIGHT,
  MENU_EDGE,
  MENU_GAP,
  MENU_WIDTH,
  menuRowHeight,
  previewHeight,
  REACTION_BAR_HEIGHT,
  type MenuLayoutInput,
} from "./action-menu-layout";

/** A common Vietnamese budget Android phone: 360 × 640 dp, a 24 dp status bar, a 48 dp navigation bar. */
const BUDGET_ANDROID: MenuLayoutInput = {
  windowWidth: 360,
  windowHeight: 640,
  fontScale: 1,
  insetTop: 24,
  insetBottom: 48,
  reactions: true,
  senderName: false,
  avatar: false,
};
const IPHONE_15: MenuLayoutInput = { ...BUDGET_ANDROID, windowWidth: 393, windowHeight: 852, insetTop: 59, insetBottom: 34 };

/** The column's height as laid out: reactions, the lifted bubble and the capped menu, with their gaps. */
function columnHeight(input: MenuLayoutInput): number {
  const layout = actionMenuLayout(input);
  const reactions = input.reactions ? REACTION_BAR_HEIGHT + MENU_GAP : 0;
  return reactions + previewHeight(layout.previewLines, input.fontScale, input.senderName) + MENU_GAP + layout.menuMaxHeight;
}
const usable = (input: MenuLayoutInput) => input.windowHeight - input.insetTop - input.insetBottom - 2 * MENU_EDGE;

describe("actionMenuLayout", () => {
  it("fits a budget Android phone at the default text size: three lines of the message, the menu scrolls under them", () => {
    const layout = actionMenuLayout(BUDGET_ANDROID);
    expect(layout.previewLines).toBe(3);
    // Nine rows of 48 dp (one's own text message) do not fit: the cap is below them, so the card scrolls.
    expect(layout.menuMaxHeight).toBeLessThan(9 * 48);
    expect(columnHeight(BUDGET_ANDROID)).toBeLessThanOrEqual(usable(BUDGET_ANDROID));
    expect(layout.menuWidth).toBe(MENU_WIDTH);
  });

  it("keeps six lines on a tall phone", () => {
    expect(IPHONE_15.windowHeight).toBeGreaterThanOrEqual(COMPACT_WINDOW_HEIGHT);
    expect(actionMenuLayout(IPHONE_15).previewLines).toBe(6);
    expect(columnHeight(IPHONE_15)).toBeLessThanOrEqual(usable(IPHONE_15));
  });

  it("lifts two lines at the accessibility sizes, widens the card, and still fits", () => {
    for (const base of [BUDGET_ANDROID, IPHONE_15]) {
      const input = { ...base, fontScale: 2 };
      const layout = actionMenuLayout(input);
      expect(layout.previewLines).toBe(2);
      expect(layout.menuWidth).toBeGreaterThan(MENU_WIDTH);
      expect(layout.menuWidth).toBeLessThanOrEqual(input.windowWidth - 32);
      expect(columnHeight(input)).toBeLessThanOrEqual(usable(input));
    }
  });

  it("drops to one line when two would leave the menu too short to read as a list", () => {
    const input = { ...BUDGET_ANDROID, windowHeight: 500, fontScale: 2, senderName: true };
    const layout = actionMenuLayout(input);
    expect(layout.previewLines).toBe(1);
    expect(layout.menuMaxHeight).toBeGreaterThanOrEqual(menuRowHeight(2) * 2.5);
  });

  it("never caps the menu below two and a half rows, even on a window too short for everything", () => {
    const layout = actionMenuLayout({ ...BUDGET_ANDROID, windowHeight: 300, fontScale: 3 });
    expect(layout.previewLines).toBe(1);
    expect(layout.menuMaxHeight).toBe(Math.round(menuRowHeight(3) * 2.5));
  });

  it("gives a local message's menu the reaction bar's room, and indents past a sender's face", () => {
    const local = actionMenuLayout({ ...BUDGET_ANDROID, reactions: false });
    expect(local.menuMaxHeight - actionMenuLayout(BUDGET_ANDROID).menuMaxHeight).toBe(REACTION_BAR_HEIGHT + MENU_GAP);
    expect(actionMenuLayout({ ...BUDGET_ANDROID, fontScale: 2, avatar: true }).menuWidth).toBe(360 - 32 - 36);
    expect(actionMenuLayout({ ...BUDGET_ANDROID, windowWidth: 0 }).menuWidth).toBe(0);
    // Text set smaller than the default keeps the canvas's card.
    expect(actionMenuLayout({ ...BUDGET_ANDROID, fontScale: 0.85 }).menuWidth).toBe(MENU_WIDTH);
  });

  it("grows a row with its text past 48 dp", () => {
    expect(menuRowHeight(1)).toBe(48);
    expect(menuRowHeight(2)).toBe(64);
    expect(previewHeight(1, 0.8, false)).toBe(previewHeight(1, 1, false));
  });
});
