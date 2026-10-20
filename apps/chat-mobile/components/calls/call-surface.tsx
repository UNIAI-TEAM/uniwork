// The pieces every call screen shares (canvas MobileCall / MobCallStates): the
// dark surface's colours, the caller block (a 132 pt avatar, pulse rings while
// it rings, the name, one status line) and the round, labelled control.
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, View } from "react-native";
import { Text } from "@/components/ui/text";
import { identityTint, SOLID_TINT_BG } from "@/lib/identity-tint";
import { initialsOf, roomInitialsOf } from "@/lib/initials";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const D = THEME.dark;
// THEME values are `hsl(h s l)`; RN parses the CSS4 `hsla(h s l / a)` form.
const fade = (color: string, a: number) => color.replace(/^hsl\((.+)\)$/, `hsla($1 / ${a})`);

/** The call is dark in both app themes, so it takes the dark theme's tokens directly. */
export const CALL = {
  surface: D.callSurface,
  text: D.foreground,
  soft: fade(D.foreground, 0.8),
  label: fade(D.foreground, 0.9),
  fill: fade(D.foreground, 0.18),
  onFill: D.callSurface,
  scrim: fade(D.callSurface, 0.6),
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
  /** Rings pulsing out of the disc (MobCallStates: the incoming call's "Nghe máy"). */
  ring?: string;
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
      <View className="h-16 w-16">
        {props.ring ? <PulseRings color={props.ring} size={64} /> : null}
        <View
          className={cn("h-16 w-16 items-center justify-center rounded-full", tone === "danger" && "bg-destructive-solid", tone === "accept" && "bg-success-solid")}
          style={tone === "default" ? { backgroundColor: active ? CALL.text : CALL.fill } : undefined}
        >
          {/* Danger is always hang up or decline: the receiver put down, as the canvas draws it. */}
          <Ionicons name={props.icon} size={28} color={tone === "default" && active ? CALL.onFill : CALL.text} style={tone === "danger" ? HANG_UP : undefined} />
        </View>
      </View>
      <Text className="text-[13px]" style={[{ color: CALL.label }, SHADOW]} numberOfLines={1}>
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

const RING = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderWidth: 3 } as const;

/** Rings swelling out of a disc of `size` half a beat apart (one when the call is outgoing); one still ring under reduced motion. */
function PulseRings({ color, size = 148, count = 2 }: { color: string; size?: number; count?: 1 | 2 }) {
  const reduced = useReduceMotion();
  const pulses = useRef([new Animated.Value(0), new Animated.Value(0)].slice(0, count)).current;
  useEffect(() => {
    if (reduced) return;
    const loops = pulses.map((p) => Animated.loop(Animated.timing(p, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true })));
    const all = Animated.stagger(900, loops);
    all.start();
    return () => all.stop();
  }, [pulses, reduced]);

  if (reduced) return <View pointerEvents="none" style={[RING, { borderRadius: size / 2, borderColor: color, opacity: 0.25 }]} />;
  return pulses.map((p, i) => (
    <Animated.View
      key={i}
      pointerEvents="none"
      style={[
        RING,
        {
          borderRadius: size / 2,
          borderColor: color,
          opacity: p.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
          transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
        },
      ]}
    />
  ));
}

/** The caller in the middle of the screen: avatar, name, what is happening. `ended` marks the avatar with a put-down receiver. */
export function CallerHero({
  name,
  line,
  rings,
  ringCount = 2,
  ended = false,
  live = false,
  seed,
  room = false,
}: {
  name: string;
  line: string;
  rings?: string;
  ringCount?: 1 | 2;
  ended?: boolean;
  /** The line is a running clock: read out politely as it changes. */
  live?: boolean;
  /** The person or room the face's colour is hashed from. */
  seed?: string;
  /** A group or channel call: the room's letters ("RM"), not a person's. */
  room?: boolean;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-2 px-6 pb-10 pt-11">
      <View className="items-center justify-center" style={{ width: 148, height: 148 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {rings ? <PulseRings color={rings} count={ringCount} /> : null}
        {/* The face on the person's own colour, two letters (MobileCall board). */}
        <View className={`items-center justify-center rounded-full ${SOLID_TINT_BG[identityTint(seed || name || "")]}`} style={{ width: 132, height: 132 }}>
          <Text className="font-display font-bold text-on-solid" style={{ fontSize: 44, lineHeight: 54 }}>
            {room ? roomInitialsOf(name) : initialsOf(name)}
          </Text>
        </View>
        {ended ? (
          <View
            className="absolute bottom-2 right-2 h-10 w-10 items-center justify-center rounded-full border-4 bg-destructive-solid"
            style={{ borderColor: CALL.surface }}
          >
            <MaterialCommunityIcons name="phone-off" size={18} color={CALL.text} />
          </View>
        ) : null}
      </View>
      <Text className="mt-4 text-center text-[28px] font-display font-bold leading-[34px]" style={{ color: CALL.text }} numberOfLines={2}>
        {name}
      </Text>
      <Text
        className="text-center text-base"
        style={{ color: CALL.soft, fontVariant: ["tabular-nums"] }}
        accessibilityRole={live ? "timer" : undefined}
        accessibilityLiveRegion={live ? "polite" : undefined}
      >
        {line}
      </Text>
    </View>
  );
}
