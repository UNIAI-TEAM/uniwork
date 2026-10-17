// A person's (or a room's) round avatar: the photo when there is one, else the
// initial on a muted disc, with the web's online dot (bg-success-solid) in the
// corner when `online` is set. Decorative: the row around it carries the name
// and the presence in its accessibility label.
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { Image, View } from "react-native";
import { Text } from "@/components/ui/text";

interface Props {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  online?: boolean;
}

export function PersonAvatar({ name, avatarUrl, size = 40, online = false }: Props) {
  // RN's <Image> cannot load a server-relative path.
  const uri = avatarUrl ? (avatarUrl.startsWith("/") ? `${runtimeConfig().apiUrl}${avatarUrl}` : avatarUrl) : null;
  const dot = Math.max(10, Math.round(size / 4));
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {uri ? (
        <Image source={{ uri }} resizeMode="cover" style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <View className="items-center justify-center bg-muted" style={{ width: size, height: size, borderRadius: size / 2 }}>
          <Text className="font-semibold text-muted-foreground" style={{ fontSize: Math.round(size * 0.42) }}>
            {name.trim().charAt(0).toUpperCase() || "?"}
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
