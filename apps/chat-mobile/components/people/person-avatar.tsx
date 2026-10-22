// A person's round avatar (or a room's, squircle): the photo when there is one,
// else the initials on the person's own colour, as the web draws faces
// (packages/views/chat/chat-person-card.tsx › chatPersonFaceClass: the solid
// identity tint, two letters), with the online dot (bg-success-solid) in the
// corner when `online` is set. Decorative: the row around it carries the name
// and the presence in its accessibility label.
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { Image } from "expo-image";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { SOLID_TINT_BG } from "@/lib/identity-tint";
import { identityTint } from "@uniwork/core/chat/identity-tint";
import { initialsOf, roomInitialsOf } from "@uniwork/core/chat/initials";
import { continuousCorners } from "@/lib/radius";
import { useIsOnline } from "./use-is-online";
import { IMAGE_CACHE_POLICY, stableImageSource } from "@/lib/media-source";

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
  // An image cannot load a server-relative path.
  const uri = avatarUrl ? (avatarUrl.startsWith("/") ? `${runtimeConfig().apiUrl}${avatarUrl}` : avatarUrl) : null;
  const source = uri ? stableImageSource(uri) : null;
  const dot = Math.max(10, Math.round(size / 4));
  const borderRadius = squircle ? Math.round(size / 3) : size / 2;
  const letters = squircle ? roomInitialsOf(name) : initialsOf(name);
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {source ? (
        // recyclingKey: a list cell reused for another person (FlashList) clears the last face before the next draws.
        <Image
          source={source}
          recyclingKey={source.cacheKey}
          cachePolicy={IMAGE_CACHE_POLICY}
          contentFit="cover"
          style={{ width: size, height: size, borderRadius }}
        />
      ) : (
        <View
          className={`items-center justify-center ${SOLID_TINT_BG[identityTint(seed || name || "")]}`}
          style={[squircle && continuousCorners, { width: size, height: size, borderRadius }]}
        >
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

/** A person's avatar whose online dot it reads for that person alone: a list of them never re-renders as a whole on presence. */
export function LivePersonAvatar({ userId, ...props }: Omit<Props, "online" | "seed"> & { userId?: string }) {
  const online = useIsOnline(userId);
  return <PersonAvatar {...props} seed={userId} online={online} />;
}
