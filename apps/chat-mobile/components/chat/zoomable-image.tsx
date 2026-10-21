// One photo of the viewer that zooms (audit P2 UX): pinch to zoom around the
// fingers (1–4x), drag a zoomed photo within its edges, double-tap to zoom in
// towards the tap or back out, and, at 1x, drag up or down to close the
// viewer, the page fading with the drag. Horizontal swipes at 1x stay with
// the viewer's pager; while zoomed the pager is held (onZoomChange) so a drag
// moves the photo, not the page. The maths is lib/zoom.ts; the gestures run
// on the UI thread (react-native-gesture-handler + Reanimated).
import { Image, type ImageSource } from "expo-image";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { IMAGE_CACHE_POLICY } from "@/lib/media-source";
import { clampScale, clampTranslate, doubleTapTarget, focalTranslate, shouldDismiss } from "@/lib/zoom";

interface Props {
  source: ImageSource;
  label: string;
  width: number;
  height: number;
  /** Drag distance of a closing drag, shared with the viewer so its backdrop fades. */
  dismissY: SharedValue<number>;
  onDismiss: () => void;
  onZoomChange: (zoomed: boolean) => void;
}

const SPRING = { damping: 20, stiffness: 220 };

export function ZoomableImage({ source, label, width, height, dismissY, onDismiss, onZoomChange }: Props) {
  const { t } = useTranslation();
  const [zoomed, setZoomed] = useState(false);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const start = useSharedValue({ scale: 1, x: 0, y: 0, focalX: 0, focalY: 0 });

  const report = (next: boolean) => {
    setZoomed(next);
    onZoomChange(next);
  };

  const gesture = useMemo(() => {
    const settle = (toScale: number, x: number, y: number) => {
      "worklet";
      scale.value = withTiming(toScale);
      tx.value = withTiming(clampTranslate(x, toScale, width));
      ty.value = withTiming(clampTranslate(y, toScale, height));
      scheduleOnRN(report, toScale > 1);
    };
    const pinch = Gesture.Pinch()
      .withTestId("zoom-pinch")
      .onStart((e) => {
        start.value = { scale: scale.value, x: tx.value, y: ty.value, focalX: e.focalX - width / 2, focalY: e.focalY - height / 2 };
      })
      .onUpdate((e) => {
        const from = start.value;
        const to = clampScale(from.scale * e.scale);
        scale.value = to;
        tx.value = focalTranslate(from.focalX, from.x, from.scale, to);
        ty.value = focalTranslate(from.focalY, from.y, from.scale, to);
      })
      .onEnd(() => {
        settle(scale.value <= 1.02 ? 1 : scale.value, tx.value, ty.value);
      });
    // At 1x only a vertical drag is ours (closing); a horizontal one pages. Zoomed, any drag moves the photo.
    const pan = (zoomed ? Gesture.Pan().minDistance(4) : Gesture.Pan().activeOffsetY([-14, 14]).failOffsetX([-14, 14]))
      .withTestId("zoom-pan")
      .onStart(() => {
        start.value = { ...start.value, x: tx.value, y: ty.value };
      })
      .onUpdate((e) => {
        if (scale.value > 1) {
          tx.value = clampTranslate(start.value.x + e.translationX, scale.value, width);
          ty.value = clampTranslate(start.value.y + e.translationY, scale.value, height);
        } else {
          dismissY.value = e.translationY;
        }
      })
      .onEnd((e) => {
        if (scale.value > 1) return;
        if (shouldDismiss(e.translationY, e.velocityY)) scheduleOnRN(onDismiss);
        else dismissY.value = withSpring(0, SPRING);
      });
    const doubleTap = Gesture.Tap()
      .withTestId("zoom-double-tap")
      .numberOfTaps(2)
      .onEnd((e) => {
        const target = doubleTapTarget(scale.value, { x: e.x, y: e.y }, { width, height });
        settle(target.scale, target.x, target.y);
      });
    return Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));
    // report closes over setters that never change; the shared values are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomed, width, height, onDismiss]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value + dismissY.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[{ width, height }, style]}>
        <Image
          source={source}
          cachePolicy={IMAGE_CACHE_POLICY}
          contentFit="contain"
          style={StyleSheet.absoluteFill}
          accessible
          accessibilityRole="image"
          accessibilityLabel={label}
          accessibilityHint={t("mobile.a11y.image_viewer_hint")}
          accessibilityValue={zoomed ? { text: t("mobile.a11y.image_zoomed") } : undefined}
          // VoiceOver's two-finger scrub closes the viewer, as the drag does.
          accessibilityActions={[{ name: "escape" }]}
          onAccessibilityAction={onDismiss}
        />
      </Animated.View>
    </GestureDetector>
  );
}
