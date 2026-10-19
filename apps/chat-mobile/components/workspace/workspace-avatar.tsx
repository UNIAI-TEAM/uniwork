/**
 * Mobile WorkspaceAvatar. Ported from usf apps/mobile/components/workspace/workspace-avatar.tsx
 *
 * A workspace icon URL renders as a squircle logo image, an emoji as
 * text, otherwise the workspace's initial letter sits in a muted tile. A
 * server-relative icon path is made absolute against the API origin inline;
 * RN's <Image> cannot load a relative URL.
 */
import { runtimeConfig } from "@uniwork/core/runtime-config";
import { Image, View } from "react-native";
import { letterStyle } from "@/components/people/person-avatar";
import { Text } from "@/components/ui/text";
import { identityTint, SOLID_TINT_BG } from "@/lib/identity-tint";
import { roomInitialsOf } from "@/lib/initials";
import { continuousCorners } from "@/lib/radius";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  iconUrl?: string | null;
  iconEmoji?: string | null;
  size?: number;
  className?: string;
  /** What the colour is hashed from (the workspace id), the name when absent. */
  seed?: string;
}

function absoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith("/") ? `${runtimeConfig().apiUrl}${url}` : url;
}

export function WorkspaceAvatar({ name, iconUrl, iconEmoji, size = 24, className, seed }: Props) {
  const resolved = absoluteUrl(iconUrl);
  // The canvas squircle: 15 on a 48 tile, 12 on 40, 7 on 24.
  const borderRadius = Math.round(size * 0.31);
  const box = [continuousCorners, { width: size, height: size, borderRadius }];

  if (resolved) {
    return (
      <View className={cn("overflow-hidden border border-border", className)} style={box}>
        <Image source={{ uri: resolved }} resizeMode="cover" accessibilityLabel={name} style={{ width: "100%", height: "100%" }} />
      </View>
    );
  }

  if (iconEmoji) {
    return (
      <View className={cn("items-center justify-center bg-muted border border-border", className)} style={box}>
        <Text style={{ fontSize: Math.round(size * 0.48) }}>{iconEmoji}</Text>
      </View>
    );
  }
  // No icon: the workspace's letters on its own colour, as the canvas draws "TT", "KD".
  const letters = roomInitialsOf(name);
  return (
    <View className={cn("items-center justify-center", SOLID_TINT_BG[identityTint(seed || name || "")], className)} style={box}>
      <Text className="font-display font-bold text-on-solid" style={letterStyle(size, letters.length > 1 ? 0.34 : 0.44)}>
        {letters}
      </Text>
    </View>
  );
}
