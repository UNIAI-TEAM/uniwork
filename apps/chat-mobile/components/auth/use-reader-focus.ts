// Moves VoiceOver's and TalkBack's focus to what just changed (spec §4.3: the "Tiếp tục" after a link, the field a
// refusal is about), once `when` turns true: the reader lands where the next action is instead of where it was.
import { useEffect, useRef } from "react";
import { AccessibilityInfo, type View } from "react-native";

export function useReaderFocus(when: boolean) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (when && ref.current) AccessibilityInfo.sendAccessibilityEvent(ref.current, "focus");
  }, [when]);
  return ref;
}
