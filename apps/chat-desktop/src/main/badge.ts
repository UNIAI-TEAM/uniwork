import { app, nativeImage, type NativeImage } from "electron";

/** Anything larger is noise on a dock icon; the web app shows the real number. */
export const MAX_BADGE_COUNT = 999;

// 16x16 red dot, generated once; Windows has no numeric badge API, so an
// overlay icon says "something unread" without needing a shipped asset.
const RED_DOT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAZ0lEQVR42mN4amnKQAnGJigHxJ1AfBmIf0HxZaiYHCEDUqAa/uPAv6BqsBqQgkcjOk5BN0COgM3YXCKHbEAnCZphuBPZgMtkGHAZ2YBfZBjwi6oGUOwFigOR4mikOCFRJSlTJTORjAFByO0kq+vooAAAAABJRU5ErkJggg==";

export interface BadgeWindow {
  setOverlayIcon(overlay: NativeImage | null, description: string): void;
}

export function clampBadgeCount(count: number): number {
  return Math.min(Math.max(0, Math.floor(count) || 0), MAX_BADGE_COUNT);
}

/** macOS/Linux: the launcher count. Windows: a red dot overlay on the taskbar icon. */
export function applyBadge(count: number, win: BadgeWindow | null, platform: NodeJS.Platform = process.platform): void {
  const n = clampBadgeCount(count);
  if (platform !== "win32") {
    app.setBadgeCount(n);
    return;
  }
  win?.setOverlayIcon(n > 0 ? nativeImage.createFromDataURL(RED_DOT_PNG) : null, n > 0 ? `${n} unread` : "");
}
