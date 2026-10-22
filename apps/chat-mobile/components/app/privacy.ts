// The app lock and screen security wired to the phone (lib/app-lock.ts says
// what they mean, data/privacy-settings.ts keeps them): the Keychain holds the
// choices with the theme and the language (data/device-preferences.ts),
// expo-screen-capture blocks capture (Android FLAG_SECURE, which also blanks
// the recents thumbnail; iOS secure capture) and, on iOS, blurs the app
// switcher's snapshot; expo-local-authentication asks for Face ID, a
// fingerprint or the phone's passcode. Boot loads the choices once
// (app/_layout.tsx); the privacy guard and Settings read the store.
import * as LocalAuthentication from "expo-local-authentication";
import * as ScreenCapture from "expo-screen-capture";
import { Platform } from "react-native";
import { useStore } from "zustand";
import { readDevicePreference, writeDevicePreference } from "@/data/device-preferences";
import { createPrivacySettings, type PrivacyState } from "@/data/privacy-settings";
import { coversWhenAway, type PrivacySettings } from "@/lib/app-lock";
import { whileOwnerPrompt } from "@/data/stores/app-lock-store";

/** expo-screen-capture counts holders by key: this one is the setting's. */
const CAPTURE_KEY = "unichat-screen-security";

async function applyToPlatform(settings: PrivacySettings): Promise<void> {
  if (settings.screenSecurity) await ScreenCapture.preventScreenCaptureAsync(CAPTURE_KEY);
  else await ScreenCapture.allowScreenCaptureAsync(CAPTURE_KEY);
  if (Platform.OS !== "ios") return;
  if (coversWhenAway(settings)) await ScreenCapture.enableAppSwitcherProtectionAsync();
  else await ScreenCapture.disableAppSwitcherProtectionAsync();
}

const privacy = createPrivacySettings({
  read: () => readDevicePreference("privacy"),
  write: (value) => writeDevicePreference("privacy", value),
  apply: applyToPlatform,
});

/** Boot: the saved choices, once. */
export const loadPrivacySettings = privacy.load;

/** Settings: a choice, applied and saved at once. */
export const updatePrivacySettings = privacy.update;

/** Whether the person lets UniChat send its anonymous usage counters (data/analytics.ts reads it at each event). */
export const usageStatsEnabled = (): boolean => privacy.store.getState().settings.usageStats;

export function usePrivacySettings(): PrivacyState {
  return useStore(privacy.store);
}

/** Whether this phone can lock UniChat: a passcode, a fingerprint or a face is set up. */
export async function deviceCanLock(): Promise<boolean> {
  try {
    return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

/** Face ID, a fingerprint or the passcode; true once the person proved they own the phone. Marked open while it
 *  runs (data/stores/app-lock-store.ts), so the guard does not count the prompt's own activity as leaving the app. */
export function authenticateOwner(prompt: string, cancelLabel: string): Promise<boolean> {
  return whileOwnerPrompt(async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, cancelLabel, disableDeviceFallback: false });
      return result.success;
    } catch {
      return false;
    }
  });
}
