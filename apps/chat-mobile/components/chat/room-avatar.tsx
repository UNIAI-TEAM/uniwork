// A conversation's mark (MobileList board): a person is a circle with the
// presence dot (PersonAvatar), a room a squircle on the room's own colour —
// the web's ChatRoomMark (chat-sidebar-unified-row.tsx): the workspace room is
// blue with a house, a channel shows "#" (a lock when private), a group its
// two initials, each on identityTint(room id) under white.
import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { letterStyle, PersonAvatar } from "@/components/people/person-avatar";
import { Text } from "@/components/ui/text";
import { identityTint, SOLID_TINT_BG, type IdentityTint } from "@/lib/identity-tint";
import { roomInitialsOf } from "@/lib/initials";
import { continuousCorners } from "@/lib/radius";
import type { RoomMark } from "@/lib/room-list";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

/** `seed` is the room id the colour is hashed from. */
export function RoomAvatar({ mark, size = 54, seed = "" }: { mark: RoomMark; size?: number; seed?: string }) {
  const { colorScheme } = useColorScheme();
  if (mark.kind === "dm") return <PersonAvatar name={mark.label} size={size} online={mark.online} seed={mark.userId} />;
  const tint: IdentityTint = mark.kind === "workspace" ? "blue" : identityTint(seed);
  const glyph = Math.round(size * 0.44);
  const ink = THEME[colorScheme].onSolid;
  const letters = mark.kind === "group" && mark.label ? roomInitialsOf(mark.label) : null;
  return (
    <View
      className={`items-center justify-center ${SOLID_TINT_BG[tint]}`}
      style={[continuousCorners, { width: size, height: size, borderRadius: Math.round(size / 3) }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Ionicons has no hash glyph; a public channel is drawn as the "#" its name carries. */}
      {mark.kind === "channel" ? (
        <Text className="font-display font-bold text-on-solid" style={letterStyle(size, 0.44)}>
          #
        </Text>
      ) : letters ? (
        <Text className="font-display font-bold text-on-solid" style={letterStyle(size, letters.length > 1 ? 0.31 : 0.4)}>
          {letters}
        </Text>
      ) : (
        <Ionicons name={mark.kind === "workspace" ? "home" : mark.kind === "private-channel" ? "lock-closed" : "people"} size={glyph} color={ink} />
      )}
    </View>
  );
}
