// "Đang nhập" as the MobileChat board draws it: an incoming bubble holding three
// dots that pulse in turn (still, at a steady 60 %, when the person asked for
// less motion), the typist's avatar beside it in a group. The names stay in the
// accessibility label, as the old text line read them out.
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, View } from "react-native";
import { useAnnounce, useReduceMotion } from "@/components/ui/a11y";
import { bubbleCorners } from "@/lib/conversation-display";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";

function Dot({ delay, reduced, color }: { delay: number; reduced: boolean; color: string }) {
  const opacity = useRef(new Animated.Value(0.25)).current;
  useEffect(() => {
    if (reduced) {
      opacity.setValue(0.6);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(opacity, { toValue: 1, duration: 360, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.25, duration: 360, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.delay(480 - delay),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [delay, opacity, reduced]);
  return <Animated.View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: color, opacity }} />;
}

export function TypingBubble({ label, avatar }: { label: string; avatar?: ReactNode }) {
  const reduced = useReduceMotion();
  const { colorScheme } = useColorScheme();
  // TalkBack reads the live region; VoiceOver hears who started typing.
  useAnnounce(label);
  return (
    <View className="flex-row items-end gap-1.5 px-2.5 pt-2" accessible accessibilityLabel={label} accessibilityLiveRegion="polite">
      {avatar}
      <View className="h-9 flex-row items-center gap-1 bg-chat-bubble-other px-3.5" style={bubbleCorners(false, true, true)}>
        {[0, 150, 300].map((delay) => (
          <Dot key={delay} delay={delay} reduced={reduced} color={THEME[colorScheme].mutedForeground} />
        ))}
      </View>
    </View>
  );
}
