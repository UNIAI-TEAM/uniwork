// Ported from usf apps/mobile/lib/use-color-scheme.ts. NativeWind's scheme
// plus the Settings choice (light | dark | system), which survives a relaunch
// in expo-secure-store. The choice is read once at boot (app/_layout.tsx ›
// loadThemePreference, data/theme-preference.ts), not by each of the
// components that draw a colour; until that read answers NativeWind follows
// the OS, so a person who picked dark on a light OS may see one light frame —
// secure-store has no synchronous read.
import * as SecureStore from "expo-secure-store";
import { colorScheme as nativewindScheme, useColorScheme as useNativewindColorScheme } from "nativewind";
import { useStore } from "zustand";
import { createThemePreference, type ThemePreference } from "@/data/theme-preference";

export type { ThemePreference };

const STORAGE_KEY = "theme-preference";

const theme = createThemePreference({
  read: () => SecureStore.getItemAsync(STORAGE_KEY),
  write: (value) => SecureStore.setItemAsync(STORAGE_KEY, value),
  apply: (value) => nativewindScheme.set(value),
});

/** Boot: the saved choice, once. */
export const loadThemePreference = theme.load;

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
