/**
 * Mobile WorkspaceAvatar. Ported from usf apps/mobile/components/workspace/workspace-avatar.tsx
 *
 * A workspace icon URL renders as a rounded-square logo image, an emoji as
 * text, otherwise the workspace's initial letter sits in a muted tile. A
 * server-relative icon path is made absolute against the API origin inline;
 * RN's <Image> cannot load a relative URL.
 */
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { Image, View } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  iconUrl?: string | null;
  iconEmoji?: string | null;
  size?: number;
  className?: string;
}

function absoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith("/") ? `${runtimeConfig().apiUrl}${url}` : url;
}

export function WorkspaceAvatar({ name, iconUrl, iconEmoji, size = 24, className }: Props) {
  const resolved = absoluteUrl(iconUrl);
  const borderRadius = Math.round(size / 4);
  const box = { width: size, height: size, borderRadius };

  if (resolved) {
    return (
      <View className={cn("overflow-hidden border border-border", className)} style={box}>
        <Image source={{ uri: resolved }} resizeMode="cover" accessibilityLabel={name} style={{ width: "100%", height: "100%" }} />
      </View>
    );
  }

  return (
    <View className={cn("items-center justify-center bg-muted border border-border", className)} style={box}>
      <Text className="font-semibold text-muted-foreground" style={{ fontSize: Math.round(size * 0.48) }}>
        {iconEmoji || name.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}
