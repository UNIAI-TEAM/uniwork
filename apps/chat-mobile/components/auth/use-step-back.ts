// Back inside a screen that has steps of its own (the choice screen's address and code): Android's back button goes
// back one step instead of leaving the screen, as the header's back button does. iOS's edge swipe cannot be made to
// do that (native-stack pops the screen before JavaScript hears of it), so it is off while a step is open, and the
// header's back button is the way back. A screen that holds back while something runs (the password screen's save)
// passes a back that does nothing.
import { useNavigation } from "expo-router";
import { useEffect, useRef } from "react";
import { BackHandler } from "react-native";

export function useStepBack(active: boolean, back: () => void): void {
  const navigation = useNavigation();
  const latest = useRef(back);
  useEffect(() => {
    latest.current = back;
  });
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !active });
  }, [active, navigation]);
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      latest.current();
      return true;
    });
    return () => sub.remove();
  }, [active]);
}
