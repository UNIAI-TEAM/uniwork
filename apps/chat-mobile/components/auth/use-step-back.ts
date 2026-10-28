// Android's back button inside a screen that has steps of its own (the choice screen's address and code): it goes
// back one step instead of leaving the screen, as the header's back button does.
import { useEffect, useRef } from "react";
import { BackHandler } from "react-native";

export function useStepBack(active: boolean, back: () => void): void {
  const latest = useRef(back);
  useEffect(() => {
    latest.current = back;
  });
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      latest.current();
      return true;
    });
    return () => sub.remove();
  }, [active]);
}
