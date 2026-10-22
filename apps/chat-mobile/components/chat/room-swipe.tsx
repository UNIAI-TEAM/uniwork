// The inbox row's swipe actions (lib/room-swipe.ts holds the numbers), as in
// Mail, WhatsApp and Telegram: a swipe to the right marks the room read when
// let go past the threshold; a swipe to the left reveals Pin and Mute, which
// stay open for a tap. A tick is felt as the drag crosses the point where
// letting go acts. Only one row is open at a time (the list closes the last
// one, and closes it on a scroll), a tap on an open row closes it, and a
// recycled cell drawing another room starts closed.
//
// Screen readers do not swipe: the row offers the same commands as named
// actions (room-row.tsx), so the revealed buttons are hidden from them. Kept
// small for a recycled list (as swipe-to-reply.tsx is): one pan, two shared
// values and one style per cell; the panes behind the row mount only while it
// is dragged or open.
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { haptics } from "@/components/ui/haptics";
import { Text } from "@/components/ui/text";
import { ROOM_SWIPE_BUTTON, roomSwipeArmed, roomSwipeOffset, roomSwipeRelease } from "@/lib/room-swipe";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/components/ui/use-color-scheme";
import { cn } from "@/lib/utils";
import { useReduceMotion } from "@/components/ui/a11y";

/** A drag starts past this many points sideways; a vertical move past FAIL_Y is the list's scroll. */
const ACTIVE_X = 14;
const FAIL_Y = 10;
const SETTLE_MS = 180;

export interface RoomSwipeButton {
  key: string;
  label: string;
  icon: ComponentProps<typeof Ionicons>["name"];
  tone: "orange" | "gray";
  onPress: () => void;
}

interface Props {
  /** The room the cell draws now: a recycled cell drawing another one starts closed. */
  rowKey: string;
  /** The leading swipe's command (mark read); none when there is nothing unread. */
  onRead?: () => void;
  readLabel: string;
  /** The buttons the trailing swipe reveals, right to left from the row's edge. */
  buttons: readonly RoomSwipeButton[];
  /** This row opened: `close` shuts it again (the list keeps one open at a time). */
  onOpen: (close: () => void) => void;
  children: ReactNode;
}

const TONE = {
  orange: "bg-tint-orange-solid",
  gray: "bg-tint-gray-solid",
} as const;

export function RoomSwipe({ rowKey, onRead, readLabel, buttons, onOpen, children }: Props) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const reduceMotion = useReduceMotion();
  const offset = useSharedValue(0);
  const start = useSharedValue(0);
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState(false);
  const sides = useMemo(() => ({ leading: Boolean(onRead), trailing: buttons.length }), [onRead, buttons.length]);
  const settleMs = reduceMotion ? 0 : SETTLE_MS;

  // The newest commands, read when a drag lets go: the gesture is built once per shape of the row.
  const latest = useRef({ onRead, onOpen });
  useEffect(() => {
    latest.current = { onRead, onOpen };
  }, [onRead, onOpen]);

  const close = useCallback(() => {
    offset.value = withTiming(0, { duration: settleMs }, () => scheduleOnRN(setShown, false));
    setOpen(false);
  }, [offset, settleMs]);
  const opened = useCallback(() => {
    setOpen(true);
    latest.current.onOpen(close);
  }, [close]);
  const read = useCallback(() => latest.current.onRead?.(), []);

  // A recycled cell drawing another room starts at rest.
  useEffect(() => {
    offset.value = 0;
    setOpen(false);
    setShown(false);
  }, [rowKey, offset]);

  useAnimatedReaction(
    () => roomSwipeArmed(offset.value, sides),
    (armed, was) => {
      if (armed && was === false) scheduleOnRN(haptics.threshold);
    },
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .withTestId("room-swipe")
        .activeOffsetX([-ACTIVE_X, ACTIVE_X])
        .failOffsetY([-FAIL_Y, FAIL_Y])
        .onStart(() => {
          start.value = offset.value;
          scheduleOnRN(setShown, true);
        })
        .onUpdate((e) => {
          offset.value = roomSwipeOffset(start.value, e.translationX, sides);
        })
        .onEnd((e) => {
          const release = roomSwipeRelease(offset.value, e.velocityX, sides);
          if (release === "open") {
            offset.value = withTiming(-sides.trailing * ROOM_SWIPE_BUTTON, { duration: settleMs });
            scheduleOnRN(opened);
            return;
          }
          if (release === "read") scheduleOnRN(read);
          scheduleOnRN(close);
        }),
    [offset, start, sides, settleMs, opened, read, close],
  );
  const follow = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  if (!sides.leading && sides.trailing === 0) return <>{children}</>;
  return (
    <GestureDetector gesture={pan}>
      <View>
        {shown || open ? (
          <View
            style={StyleSheet.absoluteFill}
            className="flex-row"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID="room-swipe-actions"
          >
            {onRead ? (
              <View className="flex-1 flex-row items-center gap-2 bg-primary pl-6">
                <Ionicons name="checkmark-done" size={22} color={theme.primaryForeground} />
                <Text className="text-subhead font-semibold text-primary-foreground">{readLabel}</Text>
              </View>
            ) : (
              <View className="flex-1" />
            )}
            {buttons.map((button) => (
              <Pressable
                key={button.key}
                // Hidden with the panes: a screen reader runs the row's own actions instead.
                accessibilityRole="button"
                accessibilityLabel={button.label}
                onPress={() => {
                  close();
                  button.onPress();
                }}
                testID={`room-swipe-${button.key}`}
                className={cn("items-center justify-center gap-1 px-1", TONE[button.tone])}
                style={{ width: ROOM_SWIPE_BUTTON }}
              >
                <Ionicons name={button.icon} size={22} color={theme.onSolid} />
                <Text className="text-caption font-semibold text-on-solid" numberOfLines={1}>
                  {button.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Animated.View style={follow} className="bg-background">
          {children}
          {/* An open row's tap closes it rather than opening the room behind the buttons. */}
          {open ? (
            <Pressable
              style={StyleSheet.absoluteFill}
              accessibilityRole="button"
              onPress={close}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              testID="room-swipe-close"
            />
          ) : null}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
