// How the message long-press menu (components/chat/message-actions.tsx) fits
// the screen it opens on. The column (reactions, the lifted bubble, the menu
// card) is centred over the dimmed chat; its menu can hold a dozen rows, which
// on a 360 × 640 dp Android phone at the default text size is already taller
// than the window. WhatsApp, Telegram and iMessage keep every action
// reachable the same way: the preview shrinks first, then the menu scrolls
// inside the height that is left. Pure, so the node tests hold the numbers.

import { isLargeText } from "./type-scale";

/** The reaction bar: 44 pt buttons in a 6 pt padded pill. */
export const REACTION_BAR_HEIGHT = 56;
/** The gap between the column's pieces (gap-2.5). */
export const MENU_GAP = 10;
/** Room kept above and below the column, so it never touches the status bar or the home indicator. */
export const MENU_EDGE = 12;
/** The card's width at the default text size (the canvas's 256 pt); it grows with the text, to 1.5×. */
export const MENU_WIDTH = 256;
const MENU_WIDTH_MAX_SCALE = 1.5;
/** The column's side padding (px-4) and the indent past a group sender's face (ml-9). */
const SIDE_PADDING = 16;
const AVATAR_INDENT = 36;
/** A window shorter than this (a 640 dp phone, an iPhone SE) lifts three lines of the message, not six. */
export const COMPACT_WINDOW_HEIGHT = 700;
/** Below this many rows the menu would read as cut off rather than scrollable; half a row peeks to say "more". */
const MIN_VISIBLE_ROWS = 2.5;

export interface MenuLayoutInput {
  windowWidth: number;
  windowHeight: number;
  /** The system text size (useWindowDimensions().fontScale). */
  fontScale: number;
  insetTop: number;
  insetBottom: number;
  /** A sent message has the reaction bar; a local one (retry / delete) does not. */
  reactions: boolean;
  /** Someone else's message in a group prints their name over the lifted bubble. */
  senderName: boolean;
  /** Their face beside the bubble indents the card. */
  avatar: boolean;
}

export interface MenuLayout {
  /** Lines of the message the lifted bubble shows. */
  previewLines: number;
  /** The menu card's height cap: past it the rows scroll. */
  menuMaxHeight: number;
  menuWidth: number;
}

/** A menu row's height: 48 dp, or the subhead line and its padding once the text outgrows that. */
export function menuRowHeight(fontScale: number): number {
  return Math.max(48, Math.round(20 * fontScale + 24));
}

/** The lifted bubble's height for `lines` lines of body text (24 pt each), its time line and its padding. */
export function previewHeight(lines: number, fontScale: number, senderName: boolean): number {
  const text = lines * 24 + 16 + (senderName ? 18 : 0);
  return Math.round(text * Math.max(1, fontScale) + 12);
}

export function actionMenuLayout(input: MenuLayoutInput): MenuLayout {
  const { fontScale } = input;
  const available = input.windowHeight - input.insetTop - input.insetBottom - 2 * MENU_EDGE;
  const fixed = input.reactions ? REACTION_BAR_HEIGHT + MENU_GAP : 0;
  const minMenu = Math.round(menuRowHeight(fontScale) * MIN_VISIBLE_ROWS);
  const preferred = isLargeText(fontScale) ? 2 : input.windowHeight < COMPACT_WINDOW_HEIGHT ? 3 : 6;
  const menuFor = (lines: number) => available - fixed - previewHeight(lines, fontScale, input.senderName) - MENU_GAP;
  const previewLines = [preferred, 2, 1].find((lines) => lines <= preferred && menuFor(lines) >= minMenu) ?? 1;
  const indent = input.avatar ? AVATAR_INDENT : 0;
  const widest = input.windowWidth - 2 * SIDE_PADDING - indent;
  const grown = Math.round(MENU_WIDTH * Math.min(Math.max(fontScale, 1), MENU_WIDTH_MAX_SCALE));
  return {
    previewLines,
    // Never below the rows that say "scroll for more", even on a window too short for everything.
    menuMaxHeight: Math.max(minMenu, menuFor(previewLines)),
    menuWidth: Math.max(0, Math.min(widest, grown)),
  };
}
