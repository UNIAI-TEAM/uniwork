// Screen-reader helpers (audit U1). React Native's live regions are Android
// only: TalkBack reads a `polite` region when its text changes, VoiceOver never
// hears it. useAnnounce gives iOS the same moment through
// announceForAccessibility; on Android the view's live region speaks, so the
// line is not read twice.
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
