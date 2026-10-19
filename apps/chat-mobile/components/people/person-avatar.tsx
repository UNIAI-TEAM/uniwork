// A person's round avatar (or a room's, squircle): the photo when there is one,
// else the initials on the person's own colour, as the web draws faces
// (packages/views/chat/chat-person-card.tsx › chatPersonFaceClass: the solid
// identity tint, two letters), with the online dot (bg-success-solid) in the
// corner when `online` is set. Decorative: the row around it carries the name
// and the presence in its accessibility label.
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { Image, View } from "react-native";
import { Text } from "@/components/ui/text";
import { identityTint, SOLID_TINT_BG } from "@/lib/identity-tint";
import { initialsOf, roomInitialsOf } from "@/lib/initials";
import { continuousCorners } from "@/lib/radius";

/** The letters' size and a line to match: Text's base class carries a 24 pt line that would clip larger letters. */
export function letterStyle(size: number, ratio: number) {
  const fontSize = Math.round(size * ratio);
  return { fontSize, lineHeight: Math.round(fontSize * 1.2) };
}

interface Props {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  online?: boolean;
  /** a room rather than a person: rounded square, as the canvas lists draw rooms */
  squircle?: boolean;
  /** What the colour is hashed from: the user id (or room id), the name when absent. */
  seed?: string;
}

export function PersonAvatar({ name, avatarUrl, size = 40, online = false, squircle = false, seed }: Props) {
  // RN's <Image> cannot load a server-relative path.
  const uri = avatarUrl ? (avatarUrl.startsWith("/") ? `${runtimeConfig().apiUrl}${avatarUrl}` : avatarUrl) : null;
  const dot = Math.max(10, Math.round(size / 4));
  const borderRadius = squircle ? Math.round(size / 3) : size / 2;
  const letters = squircle ? roomInitialsOf(name) : initialsOf(name);
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {uri ? (
        <Image source={{ uri }} resizeMode="cover" style={{ width: size, height: size, borderRadius }} />
      ) : (
        <View className={`items-center justify-center ${SOLID_TINT_BG[identityTint(seed || name || "")]}`} style={[squircle && continuousCorners, { width: size, height: size, borderRadius }]}>
          <Text className="font-display font-bold text-on-solid" style={letterStyle(size, letters.length > 1 ? 0.33 : 0.42)}>
            {letters}
          </Text>
        </View>
      )}
      {online ? (
        <View
          className="absolute bottom-0 right-0 bg-success-solid border-2 border-background"
          style={{ width: dot, height: dot, borderRadius: dot / 2 }}
        />
      ) : null}
    </View>
  );
}
