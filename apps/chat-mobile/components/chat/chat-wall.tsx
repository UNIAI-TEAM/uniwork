// The conversation's wall: the dotted default, a preset's colour, or a custom
// image the room shares. The web paints CSS; here a preset is its mid colour
// (lib/wallpaper-fill.ts).
import wallDotsDark from "@/assets/chat-wall-dots-dark.png";
import wallDotsLight from "@/assets/chat-wall-dots-light.png";
import { chatWallpaperFromRoom, type ChatRoomWallpaperRecord } from "@uniwork/core/chat/chat-wallpaper-from-room";
import type { ReactNode } from "react";
import { ImageBackground, View } from "react-native";
import { wallpaperColor } from "@/lib/wallpaper-fill";

const WALL_DOTS = { light: wallDotsLight, dark: wallDotsDark } as const;

export function ChatWall({
  room,
  scheme,
  children,
}: {
  room: { wallpaper?: ChatRoomWallpaperRecord | null } | null;
  scheme: "light" | "dark";
  children: ReactNode;
}) {
  const wall = chatWallpaperFromRoom(room ?? undefined);
  if (wall.type === "custom") {
    return (
      <ImageBackground source={{ uri: wall.dataUrl }} resizeMode="cover" style={{ flex: 1 }}>
        {children}
      </ImageBackground>
    );
  }
  if (wall.type === "preset") {
    return <View style={{ flex: 1, backgroundColor: wallpaperColor(wall.id) ?? undefined }}>{children}</View>;
  }
  return (
    <ImageBackground source={WALL_DOTS[scheme]} resizeMode="repeat" style={{ flex: 1 }}>
      {children}
    </ImageBackground>
  );
}
