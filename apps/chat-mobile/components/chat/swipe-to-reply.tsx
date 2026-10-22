// A swipe to the right on a bubble quotes it in the composer (the design
// language board: past 56 pt), the way WhatsApp and Telegram answer. The reply arrow grows in
// with the drag and a tick is felt the moment the drag crosses the threshold
// (and again if it comes back and crosses once more), so the hand knows that
// letting go will reply. The long-press menu keeps "Trả lời" for anyone who
// cannot swipe.
//
// Every message cell has one, so it is kept small (audit
// per-cell-gesture-and-entering-animations): one pan, one shared value and one
// animated style per cell, where the ReanimatedSwipeable it replaced mounted
// two action panes, a tap and a pan, and a handful of shared values and
// styles in every cell of the list. The arrow mounts only while a drag is
// under way. A vertical move fails the pan, so the list keeps its scroll.
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/components/ui/haptics";
import { REPLY_SWIPE, replyOffset, shouldReply } from "@/lib/reply-swipe";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";

export { REPLY_SWIPE };

/** A drag starts past this many points to the right; a vertical move past FAIL_Y is the list's scroll. */
const ACTIVE_X = 12;
const FAIL_Y = 10;
const SETTLE_MS = 160;

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

function ReplySwipe({ onReply, children }: { onReply: () => void; children: ReactNode }) {
  const offset = useSharedValue(0);
  const [dragging, setDragging] = useState(false);
  // The cell's newest handler, read when the drag lets go: the gesture is built once per cell.
  const latest = useRef(onReply);
  useEffect(() => {
    latest.current = onReply;
  }, [onReply]);
  const reply = useCallback(() => latest.current(), []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .withTestId("reply-swipe")
        .activeOffsetX(ACTIVE_X)
        .failOffsetY([-FAIL_Y, FAIL_Y])
        .onStart(() => {
          scheduleOnRN(setDragging, true);
        })
        .onUpdate((e) => {
          offset.value = replyOffset(e.translationX);
        })
        .onEnd(() => {
          if (shouldReply(offset.value)) scheduleOnRN(reply);
        })
        .onFinalize(() => {
          offset.value = withTiming(0, { duration: SETTLE_MS }, () => scheduleOnRN(setDragging, false));
        }),
    [offset, reply],
  );
  const follow = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <GestureDetector gesture={pan}>
      <View>
        {dragging ? (
          <View style={StyleSheet.absoluteFill} className="justify-center" pointerEvents="none" testID="reply-arrow">
            <ReplyAction translation={offset} />
          </View>
        ) : null}
        <Animated.View style={follow}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

export function SwipeToReply({ enabled, onReply, children }: { enabled: boolean; onReply: () => void; children: ReactNode }) {
  if (!enabled) return <>{children}</>;
  return <ReplySwipe onReply={onReply}>{children}</ReplySwipe>;
}
