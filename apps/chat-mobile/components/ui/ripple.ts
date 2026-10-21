// Android's touch answer (audit UX P2 "android-platform-conventions"): a ripple
// in the content's ink, light on a light screen and dark on a dark one, as
// Material components draw it; iOS ignores android_ripple and keeps its
// highlight (the `active:` classes). Borderless for a round icon button, so
// the ripple spreads as a circle past the glyph.
import { useMemo } from "react";
import type { PressableAndroidRippleConfig } from "react-native";
import { THEME } from "@/lib/theme";
import { withAlpha } from "@/lib/platform-ui";
import { useColorScheme } from "./use-color-scheme";

export function useRipple(borderless = false): PressableAndroidRippleConfig {
  const { colorScheme } = useColorScheme();
  return useMemo(() => ({ color: withAlpha(THEME[colorScheme].foreground, colorScheme === "dark" ? 0.16 : 0.12), borderless, foreground: false }), [colorScheme, borderless]);
}
