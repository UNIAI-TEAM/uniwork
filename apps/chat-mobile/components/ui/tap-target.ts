// A hand-built control's touch answer:
// the hit slop that grows it to the platform's minimum target (44 pt on iOS,
// 48 dp on Android: lib/platform-ui.ts) from the size it is drawn at, and
// Android's ripple (ripple.ts). Spread it on a Pressable before its own props,
// so a control that needs a narrower slop (chips side by side) can still say so.
import { useMemo } from "react";
import { Platform, type PressableAndroidRippleConfig } from "react-native";
import { hitSlopFor } from "@/lib/platform-ui";
import { useRipple } from "./ripple";

export interface TapTarget {
  hitSlop: number;
  android_ripple: PressableAndroidRippleConfig;
}

/** `drawn`: the control's smaller side in points; `round`: a round icon button, whose ripple spreads past the glyph. */
export function useTapTarget(drawn: number, round = false): TapTarget {
  const android_ripple = useRipple(round);
  const hitSlop = hitSlopFor(drawn, Platform.OS);
  return useMemo(() => ({ hitSlop, android_ripple }), [hitSlop, android_ripple]);
}
