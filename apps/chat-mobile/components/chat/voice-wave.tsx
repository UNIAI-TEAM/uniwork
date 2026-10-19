// The bars beside a recording's clock (canvas MobStates, "Ghi âm"): they rise
// and fall while the microphone is open, and stand still for someone who asked
// for less motion. Decorative: the pill's label says it is recording.
import { useEffect, useState } from "react";
import { AccessibilityInfo, View } from "react-native";

const BARS = 22;
const TICK_MS = 140;

export function VoiceWave() {
  const [tick, setTick] = useState(0);
  const [still, setStill] = useState(true);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => live && setStill(on));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [still]);
  return (
    <View className="h-6 flex-1 flex-row items-center gap-[2px] overflow-hidden" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: BARS }, (_, i) => {
        const level = 0.35 + 0.65 * Math.abs(Math.sin((i + tick) * 0.7) * Math.cos((i - tick) * 0.31));
        return <View key={i} className="w-[3px] rounded-full bg-destructive-solid/70" style={{ height: Math.max(4, Math.round(22 * level)) }} />;
      })}
    </View>
  );
}
