// What each platform expects of a control (audit UX P2 "android-platform-conventions"):
// Android's back is an arrow, iOS's a chevron; a touch target is at least
// 44 pt on iOS (Human Interface Guidelines) and 48 dp on Android (Material);
// Android answers a touch with a ripple in the content's ink. Pure: the
// platform is passed in, so the node tests hold every branch.

/** The smallest touch target each platform asks for, in points / dp. */
export const MIN_TOUCH_TARGET = { ios: 44, android: 48 } as const;

/** The back button's glyph (Ionicons). */
export function backIcon(platform: string): "arrow-back" | "chevron-back" {
  return platform === "android" ? "arrow-back" : "chevron-back";
}

/** The minimum touch target on this platform (iOS's on anything else). */
export function minTouchTarget(platform: string): number {
  return platform === "android" ? MIN_TOUCH_TARGET.android : MIN_TOUCH_TARGET.ios;
}

/** The hit slop that grows a control drawn `visual` pt tall (or wide) to the platform's minimum target. */
export function hitSlopFor(visual: number, platform: string): number {
  return Math.max(0, Math.ceil((minTouchTarget(platform) - visual) / 2));
}

/** An `hsl(h s% l%)` token at `alpha`, in the comma form React Native's colour parser reads. */
export function withAlpha(token: string, alpha: number): string {
  const match = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(token);
  if (!match) throw new Error(`not an hsl() token: ${token}`);
  return `hsla(${match[1]}, ${match[2]}%, ${match[3]}%, ${alpha})`;
}
