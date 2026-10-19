// A conversation's mark (MobileList board): a person is a circle with the
// presence dot (PersonAvatar), a room a squircle in the room's own tint with
// its kind's glyph — the web's ChatRoomMark (chat-sidebar-unified-row.tsx):
// the workspace room is blue, a channel or group takes identityTint(room id).
import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Text } from "@/components/ui/text";
import { identityTint, type IdentityTint } from "@/lib/identity-tint";
import type { RoomMark } from "@/lib/room-list";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

const ICONS = {
  workspace: "home",
  group: "people",
  "private-channel": "lock-closed",
} as const;

// Whole class names, so NativeWind finds them.
const TINT_BOX: Record<IdentityTint, string> = {
  blue: "bg-tint-blue",
  orange: "bg-tint-orange",
  green: "bg-tint-green",
  yellow: "bg-tint-yellow",
  teal: "bg-tint-teal",
};
const TINT_TEXT: Record<IdentityTint, string> = {
  blue: "text-tint-blue-foreground",
  orange: "text-tint-orange-foreground",
  green: "text-tint-green-foreground",
  yellow: "text-tint-yellow-foreground",
  teal: "text-tint-teal-foreground",
};
const TINT_INK = {
  blue: "tintBlueForeground",
  orange: "tintOrangeForeground",
  green: "tintGreenForeground",
  yellow: "tintYellowForeground",
  teal: "tintTealForeground",
} as const satisfies Record<IdentityTint, keyof (typeof THEME)["light"]>;

/** `seed` is the room id the tint is hashed from. */
export function RoomAvatar({ mark, size = 54, seed = "" }: { mark: RoomMark; size?: number; seed?: string }) {
  const { colorScheme } = useColorScheme();
  if (mark.kind === "dm") return <PersonAvatar name={mark.label} size={size} online={mark.online} />;
  const tint: IdentityTint = mark.kind === "workspace" ? "blue" : identityTint(seed);
  const glyph = Math.round(size * 0.44);
  return (
    <View
      className={`items-center justify-center ${TINT_BOX[tint]}`}
      style={{ width: size, height: size, borderRadius: Math.round(size / 3) }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Ionicons has no hash glyph; a public channel is drawn as the "#" its name carries. */}
      {mark.kind === "channel" ? (
        <Text className={`font-bold ${TINT_TEXT[tint]}`} style={{ fontSize: glyph }}>
          #
        </Text>
      ) : (
        <Ionicons name={ICONS[mark.kind]} size={glyph} color={THEME[colorScheme][TINT_INK[tint]]} />
      )}
    </View>
  );
}
