// Touch feedback for the moments that change something (audit P2 UX): a
// message sent, a long press that opens a message's actions, a reaction, a
// call answered or ended. iOS gets its impact/selection/notification feels;
// Android gets the system's own feedback constants (View.performHapticFeedback),
// which honour the person's "touch feedback" setting and need no vibrator
// access. A phone without haptics (an emulator, an old device) stays silent:
// feedback is never worth an error in a tap handler. The platform is passed in
// so this module stays importable by the node tests (components/ui/haptics.ts
// builds the app's instance).
import * as Haptics from "expo-haptics";
import { bestEffort } from "./report";

export type HapticMoment = "send" | "longPress" | "reaction" | "callAccept" | "callEnd";

type Feel = () => Promise<void>;

const IOS: Record<HapticMoment, Feel> = {
  send: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  longPress: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  reaction: () => Haptics.selectionAsync(),
  callAccept: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  callEnd: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
};

const ANDROID: Record<HapticMoment, Feel> = {
  send: () => Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm),
  longPress: () => Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press),
  reaction: () => Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click),
  callAccept: () => Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm),
  callEnd: () => Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject),
};

export type AppHaptics = Record<HapticMoment, () => void>;

function play(feel: Feel): void {
  try {
    void feel().catch(bestEffort("haptics", "haptic not played", "breadcrumb"));
  } catch {
    // The native module is missing or refused synchronously: no feedback, no error.
  }
}

export function createHaptics(platform: string): AppHaptics {
  const feels = platform === "ios" ? IOS : platform === "android" ? ANDROID : null;
  const moment = (name: HapticMoment) => () => {
    if (feels) play(feels[name]);
  };
  return { send: moment("send"), longPress: moment("longPress"), reaction: moment("reaction"), callAccept: moment("callAccept"), callEnd: moment("callEnd") };
}
