// Screen-reader and motion helpers (audit U1, UX P3). React Native's live
// regions are Android only: TalkBack reads a `polite` region when its text
// changes, VoiceOver never hears it. useAnnounce gives iOS the same moment
// through announceForAccessibility; on Android the view's live region speaks,
// so the line is not read twice. useReduceMotion is the one reading of the
// system's "reduce motion" switch every animation follows.
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/** Says `message` to VoiceOver when it appears or changes (iOS); the caller keeps its live region for TalkBack. */
export function useAnnounce(message: string | null | undefined): void {
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (!message) {
      said.current = null;
      return;
    }
    if (message === said.current) return;
    said.current = message;
    if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}

/** Whether VoiceOver or TalkBack is running, following the switch while the screen is open. */
export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((value) => live && setEnabled(value));
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", setEnabled);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return enabled;
}

/**
 * Whether the person asked the system for less motion (iOS Reduce Motion, Android "Remove animations"),
 * following the switch while the screen is open. Starts true, so nobody who asked sees a frame of motion
 * before the answer comes; a platform that cannot tell keeps it still.
 */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (on) => {
        if (live) setReduced(on);
      },
      () => undefined,
    );
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
