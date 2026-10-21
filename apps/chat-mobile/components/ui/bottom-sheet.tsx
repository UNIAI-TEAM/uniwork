// Every bottom sheet of the app (audit UX P2 "sheets-not-draggable"): a
// CallAwareModal (an incoming call still closes it) over a dimmed screen,
// with a panel that follows a downward drag and closes when let go far enough
// or flicked (lib/sheet-drag.ts), springing back otherwise — what the grabber
// at its top promises, as on a UISheetPresentationController or a Material
// bottom sheet. VoiceOver's two-finger scrub ("escape") closes it, Android's
// back button closes it (onRequestClose), and someone who asked for less
// motion gets a fade (CallAwareModal) and no spring.
//
// A sheet whose body scrolls drags from its top strip only (`dragFrom="handle"`):
// a drag on a list scrolls the list. The others drag from anywhere.
import { useEffect, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { KeyboardAvoidingView, Platform, Pressable, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { sheetOffset, shouldCloseSheet } from "@/lib/sheet-drag";
import { continuousCorners } from "@/lib/radius";
import { cn } from "@/lib/utils";
import { useReduceMotion } from "./a11y";
import { CallAwareModal } from "./call-aware-modal";

const SPRING = { damping: 22, stiffness: 260 };

export interface BottomSheetProps {
  visible: boolean;
  /** Every way out: the backdrop, the drag, the escape gesture, Android's back, an incoming call. */
  onClose: () => void;
  /** iOS: the sheet finished closing (action-sheet.tsx › useAfterDismiss). */
  onDismiss?: () => void;
  /** The call this sheet belongs to: it stays while that call rings (call-aware-modal.tsx). */
  keepOpenForCall?: string;
  /** A tap on the dimmed screen closes the sheet (true); a question that needs an answer passes false. */
  backdropCloses?: boolean;
  /** Lifted over the dimmed screen above the sheet, such as the room a list row's menu acts on. */
  above?: ReactNode;
  /** Where a drag starts: anywhere on the panel, or only its top strip when the body scrolls. */
  dragFrom?: "panel" | "handle";
  /** iOS lifts the sheet over the keyboard (a sheet with a text field). */
  avoidKeyboard?: boolean;
  /** The panel's own classes: padding, a test of its own. */
  className?: string;
  /** The panel's height, as a share of the screen: a cap (max-h-[80%]) or a fixed share (h-[70%], with fill). */
  sizeClassName?: string;
  /** The panel fills a fixed `sizeClassName` height (its body is a list that takes the rest). */
  fill?: boolean;
  /** The keyboard wrapper's classes (its height cap) when avoidKeyboard is set. */
  keyboardClassName?: string;
  accessibilityLabel?: string;
  testID?: string;
  children: ReactNode;
}

/** The grabber: the strip a drag starts from on a sheet that scrolls, decorative to a screen reader. */
function Grabber() {
  return (
    <View className="w-full items-center pb-3 pt-2" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="sheet-grabber">
      <View className="h-[5px] w-9 rounded-full bg-muted-foreground/30" />
    </View>
  );
}

export function BottomSheet(props: BottomSheetProps) {
  const { visible, onClose, dragFrom = "panel", backdropCloses = true, avoidKeyboard = false } = props;
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const offset = useSharedValue(0);
  const height = useSharedValue(0);

  // Each opening starts at rest, wherever the last drag left the panel.
  useEffect(() => {
    if (visible) offset.value = 0;
  }, [visible, offset]);

  const drag = useMemo(
    () =>
      Gesture.Pan()
        .withTestId("sheet-drag")
        // Downward only: an upward drag is never the sheet's, so a list inside it keeps scrolling up.
        .activeOffsetY(8)
        .failOffsetX([-24, 24])
        .onUpdate((e) => {
          offset.value = sheetOffset(e.translationY);
        })
        .onEnd((e) => {
          if (shouldCloseSheet(e.translationY, e.velocityY, height.value)) scheduleOnRN(onClose);
          else offset.value = reduceMotion ? withTiming(0, { duration: 0 }) : withSpring(0, SPRING);
        }),
    [offset, height, onClose, reduceMotion],
  );
  const follow = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  const measure = (event: LayoutChangeEvent) => {
    height.value = event.nativeEvent.layout.height;
  };

  const panel = (
    // Shrinkable down the chain, so a body taller than the cap scrolls instead of running off the screen.
    <Animated.View className={cn("shrink", props.sizeClassName)} style={follow} onLayout={measure} testID="sheet-panel">
      <SafeAreaView
        edges={["bottom"]}
        className={cn("shrink rounded-t-[24px] bg-card", props.fill && "flex-1", props.className)}
        style={continuousCorners}
        accessibilityViewIsModal
        accessibilityLabel={props.accessibilityLabel}
        // VoiceOver's two-finger scrub closes the sheet, as the drag does.
        onAccessibilityEscape={onClose}
        testID={props.testID}
      >
        {dragFrom === "handle" ? (
          <GestureDetector gesture={drag}>
            <View>
              <Grabber />
            </View>
          </GestureDetector>
        ) : (
          <Grabber />
        )}
        {props.children}
      </SafeAreaView>
    </Animated.View>
  );
  const draggable = dragFrom === "panel" ? <GestureDetector gesture={drag}>{panel}</GestureDetector> : panel;

  return (
    <CallAwareModal visible={visible} transparent animationType="slide" onRequestClose={onClose} onDismiss={props.onDismiss} keepOpenForCall={props.keepOpenForCall}>
      {/* A modal is its own window on Android: the drag needs its own gesture root there. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        {backdropCloses ? (
          <Pressable className="flex-1 justify-end bg-black/40 pb-4" onPress={onClose} accessibilityRole="button" accessibilityLabel={t("common.close")}>
            {props.above}
          </Pressable>
        ) : (
          <View className="flex-1 bg-black/40" />
        )}
        {avoidKeyboard ? (
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className={props.keyboardClassName}>
            {draggable}
          </KeyboardAvoidingView>
        ) : (
          draggable
        )}
      </GestureHandlerRootView>
    </CallAwareModal>
  );
}
