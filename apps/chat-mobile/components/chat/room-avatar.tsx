// A conversation's mark: a person's initial with a presence dot for a DM, an
// icon for the workspace room, a channel (# or lock) or a group — the web's
// ChatRoomMark / ChatPresenceAvatar in the list.
import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import type { RoomMark } from "@/lib/room-list";
import { THEME } from "@/lib/theme";
import { useColorScheme } from "@/lib/use-color-scheme";

const ICONS = {
  workspace: "home-outline",
  group: "people-outline",
  "private-channel": "lock-closed-outline",
} as const;

export function RoomAvatar({ mark, size = 48 }: { mark: RoomMark; size?: number }) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (mark.kind !== "dm") {
    return (
      <View className="items-center justify-center bg-secondary" style={box} accessible={false}>
        {/* Ionicons has no hash glyph; a public channel is drawn as the "#" its name carries. */}
        {mark.kind === "channel" ? (
          <Text className="font-semibold text-muted-foreground" style={{ fontSize: Math.round(size * 0.45) }}>
            #
          </Text>
        ) : (
          <Ionicons name={ICONS[mark.kind]} size={Math.round(size * 0.45)} color={theme.mutedForeground} />
        )}
      </View>
    );
  }
  const dot = Math.max(10, Math.round(size / 4));
  return (
    <View style={box} accessible={false}>
      <View className="items-center justify-center bg-primary" style={box}>
        <Text className="font-semibold text-primary-foreground" style={{ fontSize: Math.round(size * 0.4) }}>
          {mark.label.trim().charAt(0).toUpperCase() || "?"}
        </Text>
      </View>
      {mark.online ? (
        <View
          className="absolute bottom-0 right-0 border-2 border-background"
          // tokens.css --success-solid, the same in light and dark; the mobile theme carries no success slot yet.
          style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: "#16824b" }}
        />
      ) : null}
    </View>
  );
}
