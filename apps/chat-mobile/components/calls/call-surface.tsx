// The pieces every call screen shares (canvas MobileCall / MobCallStates): the
// dark surface's colours, the caller block (a 132 pt avatar, pulse rings while
// it rings, the name, one status line) and the round, labelled control.
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const D = THEME.dark;
// THEME values are `hsl(h s l)`; RN parses the CSS4 `hsla(h s l / a)` form.
const fade = (color: string, a: number) => color.replace(/^hsl\((.+)\)$/, `hsla($1 / ${a})`);

/** The call is dark in both app themes, so it takes the dark theme's tokens directly. */
export const CALL = {
  surface: D.background,
  text: D.foreground,
  soft: fade(D.foreground, 0.8),
  label: fade(D.foreground, 0.9),
  fill: fade(D.foreground, 0.18),
  onFill: D.background,
  scrim: fade(D.background, 0.6),
  live: D.tintGreenForeground,
  ringIncoming: D.tintTealForeground,
  ringOutgoing: D.brand,
};

// Keeps labels and the status readable where they sit over the other side's video.
export const SHADOW = { textShadowColor: CALL.scrim, textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } };

const HANG_UP = { transform: [{ rotate: "135deg" }] };

/** One round control: a 64 pt disc with its label underneath, its state in accessibilityState for VoiceOver/TalkBack. */
export function CallButton(props: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: "default" | "danger" | "accept";
  active?: boolean;
  testID?: string;
}) {
  const { tone = "default", active } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={active === undefined ? undefined : { selected: active }}
      testID={props.testID}
      onPress={props.onPress}
      className="items-center gap-2.5 active:opacity-70"
    >
      <View
        className={cn("h-16 w-16 items-center justify-center rounded-full", tone === "danger" && "bg-destructive-solid", tone === "accept" && "bg-success-solid")}
        style={tone === "default" ? { backgroundColor: active ? CALL.text : CALL.fill } : undefined}
      >
        {/* Danger is always hang up or decline: the receiver put down, as the canvas draws it. */}
        <Ionicons name={props.icon} size={28} color={tone === "default" && active ? CALL.onFill : CALL.text} style={tone === "danger" ? HANG_UP : undefined} />
      </View>
      <Text className="text-sm font-semibold" style={[{ color: CALL.label }, SHADOW]} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  );
}

// Starts still, so nobody who asked for less motion sees a frame of it.
function useReduceMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(
      (on) => {
        if (live) setReduced(on);
      },
      () => undefined,
    );
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

const RING = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 74, borderWidth: 3 } as const;

/** Two rings swelling out of the avatar half a beat apart; one still ring under reduced motion. */
function PulseRings({ color }: { color: string }) {
  const reduced = useReduceMotion();
  const pulses = useRef([new Animated.Value(0), new Animated.Value(0)]).current;
  useEffect(() => {
    if (reduced) return;
    const loops = pulses.map((p) => Animated.loop(Animated.timing(p, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true })));
    const all = Animated.stagger(900, loops);
    all.start();
    return () => all.stop();
  }, [pulses, reduced]);

  if (reduced) return <View pointerEvents="none" style={[RING, { borderColor: color, opacity: 0.25 }]} />;
  return pulses.map((p, i) => (
    <Animated.View
      key={i}
      pointerEvents="none"
      style={[
        RING,
        {
          borderColor: color,
          opacity: p.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
          transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
        },
      ]}
    />
  ));
}

/** The caller in the middle of the screen: avatar, name, what is happening. `ended` marks the avatar with a put-down receiver. */
export function CallerHero({ name, line, rings, ended = false }: { name: string; line: string; rings?: string; ended?: boolean }) {
  return (
    <View className="flex-1 items-center justify-center gap-2 px-6 pb-10 pt-11">
      <View className="items-center justify-center" style={{ width: 148, height: 148 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {rings ? <PulseRings color={rings} /> : null}
        <View className="items-center justify-center rounded-full" style={{ width: 132, height: 132, backgroundColor: D.tintTeal }}>
          <Text className="font-extrabold" style={{ fontSize: 52, color: D.tintTealForeground }}>
            {name.trim().charAt(0).toUpperCase() || "?"}
          </Text>
        </View>
        {ended ? (
          <View
            className="absolute bottom-2 right-2 h-10 w-10 items-center justify-center rounded-full border-4 bg-destructive-solid"
            style={{ borderColor: CALL.surface }}
          >
            <Ionicons name="call" size={17} color={CALL.text} style={HANG_UP} />
          </View>
        ) : null}
      </View>
      <Text className="mt-4 text-center text-[28px] font-bold leading-[34px]" style={{ color: CALL.text }} numberOfLines={2}>
        {name}
      </Text>
      <Text className="text-center text-base" style={{ color: CALL.soft, fontVariant: ["tabular-nums"] }}>
        {line}
      </Text>
    </View>
  );
}
