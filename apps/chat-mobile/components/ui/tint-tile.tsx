// A tile of the redesign's tint set: a pale wash with the icon in the tint's
// ink (card headers, the attach sheet, the reminder sheet).
import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { THEME } from "@/lib/theme";
import type { Tint } from "@/lib/tint";
import { useColorScheme } from "@/lib/use-color-scheme";
import { cn } from "@/lib/utils";

/** Spelled out so Tailwind sees every class; `ink` is the THEME key for icons. */
export const TINTS = {
  blue: { bg: "bg-tint-blue", text: "text-tint-blue-foreground", ink: "tintBlueForeground" },
  yellow: { bg: "bg-tint-yellow", text: "text-tint-yellow-foreground", ink: "tintYellowForeground" },
  orange: { bg: "bg-tint-orange", text: "text-tint-orange-foreground", ink: "tintOrangeForeground" },
  teal: { bg: "bg-tint-teal", text: "text-tint-teal-foreground", ink: "tintTealForeground" },
  green: { bg: "bg-tint-green", text: "text-tint-green-foreground", ink: "tintGreenForeground" },
  red: { bg: "bg-tint-red", text: "text-tint-red-foreground", ink: "tintRedForeground" },
} as const satisfies Record<Tint, { bg: string; text: string; ink: keyof (typeof THEME)["light"] }>;

export function TintTile({
  tint,
  icon,
  size,
  iconSize,
  className,
}: {
  tint: Tint;
  icon: keyof typeof Ionicons.glyphMap;
  size: number;
  iconSize: number;
  /** The corner radius (rounded-md by default). */
  className?: string;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View className={cn("items-center justify-center rounded-md", TINTS[tint].bg, className)} style={{ width: size, height: size }}>
      <Ionicons name={icon} size={iconSize} color={THEME[colorScheme][TINTS[tint].ink]} />
    </View>
  );
}
