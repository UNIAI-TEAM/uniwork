// A swipe to the right on a bubble quotes it in the composer (bảng Ngôn ngữ:
// past 56 pt), the way WhatsApp and Telegram answer. The reply arrow grows in
// with the drag and a tick is felt the moment the drag crosses the threshold
// (and again if it comes back and crosses once more), so the hand knows that
// letting go will reply. The long-press menu keeps "Trả lời" for anyone who
// cannot swipe.
import { Ionicons } from "@expo/vector-icons";
import { useRef, type ReactNode } from "react";
import { View } from "react-native";
import ReanimatedSwipeable, { type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, { interpolate, useAnimatedReaction, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/components/ui/haptics";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";

export const REPLY_SWIPE = 56;

/** The arrow behind the bubble: it grows in with the drag, and the threshold is felt once per crossing. */
export function ReplyAction({ translation }: { translation: SharedValue<number> }) {
  const { colorScheme } = useColorScheme();
  useAnimatedReaction(
    () => translation.value >= REPLY_SWIPE,
    (past, was) => {
      if (past && was === false) scheduleOnRN(haptics.threshold);
    },
  );
  const grow = useAnimatedStyle(() => {
    const t = interpolate(translation.value, [0, REPLY_SWIPE], [0.4, 1], "clamp");
    return { opacity: t, transform: [{ scale: t }] };
  });
  return (
    <View className="w-14 items-center justify-center">
      <Animated.View className="h-8 w-8 items-center justify-center rounded-full bg-chat-chip" style={grow}>
        <Ionicons name="arrow-undo" size={18} color={THEME[colorScheme].primary} />
      </Animated.View>
    </View>
  );
}

export function SwipeToReply({ enabled, onReply, children }: { enabled: boolean; onReply: () => void; children: ReactNode }) {
  const ref = useRef<SwipeableMethods>(null);
  if (!enabled) return <>{children}</>;
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      leftThreshold={REPLY_SWIPE}
      overshootLeft={false}
      dragOffsetFromLeftEdge={12}
      renderLeftActions={(_progress, translation) => <ReplyAction translation={translation} />}
      onSwipeableWillOpen={() => {
        onReply();
        ref.current?.close();
      }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}
