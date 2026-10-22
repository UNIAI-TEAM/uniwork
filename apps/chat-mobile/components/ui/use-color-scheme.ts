// Ported from usf apps/mobile/lib/use-color-scheme.ts. NativeWind's scheme
// plus the Settings choice (light | dark | system), which survives a relaunch
// in the device preferences (data/device-preferences.ts). The choice is read once at boot (app/_layout.tsx ›
// loadThemePreference, data/theme-preference.ts), not by each of the
// components that draw a colour; until that read answers NativeWind follows
// the OS, so the splash waits for it (useThemeReady): secure-store has no
// synchronous read, and a person who picked dark on a light OS must not see a
// light first frame.
import { colorScheme as nativewindScheme, useColorScheme as useNativewindColorScheme } from "nativewind";
import { useStore } from "zustand";
import { readDevicePreference, writeDevicePreference } from "@/data/device-preferences";
import { createThemePreference, type ThemePreference } from "@/data/theme-preference";

export type { ThemePreference };

const theme = createThemePreference({
  read: () => readDevicePreference("theme"),
  write: (value) => writeDevicePreference("theme", value),
  apply: (value) => nativewindScheme.set(value),
});

/** Boot: the saved choice, once. */
export const loadThemePreference = theme.load;

/** True once the saved choice is known (or could not be read): the splash waits for it. */
export function useThemeReady(): boolean {
  return useStore(theme.store, (s) => s.ready);
}

export function useColorScheme() {
  const { colorScheme } = useNativewindColorScheme();
  const preference = useStore(theme.store, (s) => s.preference);
  return {
    colorScheme: colorScheme ?? "light",
    preference,
    setPreference: theme.set,
    isDarkColorScheme: colorScheme === "dark",
  };
}
