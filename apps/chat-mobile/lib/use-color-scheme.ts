// Ported from usf apps/mobile/lib/use-color-scheme.ts. Wraps NativeWind's
// useColorScheme with persistence in expo-secure-store so the Settings choice
// (light | dark | system) survives a relaunch. The saved preference is read
// async on first mount; until then NativeWind follows the OS, so a user who
// picked dark on a light OS may see one light frame — secure-store has no
// synchronous read.
import { useColorScheme as useNativewindColorScheme } from "nativewind";
import { useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "theme-preference";

export type ThemePreference = "light" | "dark" | "system";

export function useColorScheme() {
  const { colorScheme, setColorScheme: applyScheme } = useNativewindColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    let cancelled = false;
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((saved) => {
        if (cancelled) return;
        if (saved === "light" || saved === "dark" || saved === "system") {
          setPreferenceState(saved);
          applyScheme(saved);
        }
      })
      .catch(() => {
        // A failed read is not fatal; the default "system" stands.
      });
    return () => {
      cancelled = true;
    };
  }, [applyScheme]);

  const setPreference = (p: ThemePreference) => {
    setPreferenceState(p);
    applyScheme(p);
    void SecureStore.setItemAsync(STORAGE_KEY, p);
  };

  return {
    colorScheme: colorScheme ?? "light",
    preference,
    setPreference,
    isDarkColorScheme: colorScheme === "dark",
  };
}
