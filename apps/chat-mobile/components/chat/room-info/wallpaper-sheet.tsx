// A room's shared background: one of the presets. A custom photo stays on the
// web; the phone applies the preset everyone in the room already sees.
import { CHAT_WALLPAPER_PRESET_IDS, type ChatWallpaperPresetId } from "@uniwork/core/chat/chat-wallpaper";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Text } from "@/components/ui/text";
import { useSetRoomWallpaper } from "@/data/mutations/rooms";
import { toast } from "@/data/stores/toast-store";
import { wallpaperColor } from "@/lib/wallpaper-fill";
import { cn } from "@/lib/utils";

export function WallpaperSheet({
  wsId,
  roomId,
  visible,
  current,
  onClose,
}: {
  wsId: string;
  roomId: string;
  visible: boolean;
  current: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const setWallpaper = useSetRoomWallpaper(wsId);
  const pick = (preset: ChatWallpaperPresetId) => {
    void setWallpaper
      .mutateAsync({ roomId, preset })
      .then(onClose)
      .catch(() => toast.error(t("settings.preferences.chatWallpaper_save_failed")));
  };
  return (
    <BottomSheet visible={visible} onClose={onClose} className="px-4">
      <Text className="mb-1 text-title3 font-display font-bold text-foreground" accessibilityRole="header">
        {t("chat.settings_wallpaper")}
      </Text>
      <Text className="mb-3 text-footnote text-muted-foreground">{t("settings.preferences.chatWallpaperSharedHint")}</Text>
      <View className="mb-3 flex-row flex-wrap gap-2">
        {CHAT_WALLPAPER_PRESET_IDS.map((id) => {
          const selected = (current || "default") === id;
          const color = wallpaperColor(id);
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={t(`settings.preferences.chatWallpaperPresets.${id}`)}
              accessibilityState={{ selected }}
              onPress={() => pick(id)}
              className={cn("h-14 w-14 overflow-hidden rounded-xl border-2", selected ? "border-primary" : "border-border", !color && "bg-chat-wall")}
              style={color ? { backgroundColor: color } : undefined}
            />
          );
        })}
      </View>
    </BottomSheet>
  );
}
