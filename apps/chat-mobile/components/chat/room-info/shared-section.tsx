// What a conversation has shared (GET …/shared-summary): a tab per kind with
// its count, and the newest photos as a three-column grid whose last tile says
// how many more there are. A tap on a photo opens the room at its message.
import { Image } from "expo-image";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { Text } from "@/components/ui/text";
import type { ChatSharedSummary } from "@/data/chat-api-schemas";
import { chatMediaSource, IMAGE_CACHE_POLICY } from "@/lib/media-source";
import { cn } from "@/lib/utils";

/** Photo tiles in the shared grid; the last one says how many more there are. */
const PHOTO_TILES = 6;

type SharedTab = "photo" | "file" | "link" | "voice";

export function SharedSection({ shared, onOpenMessage }: { shared: ChatSharedSummary; onOpenMessage: (messageId: string) => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SharedTab>("photo");
  // Three tiles to a row across the 20 pt margins, 4 pt apart.
  const tile = Math.floor((useWindowDimensions().width - 40 - 8) / 3);
  const counts: Record<SharedTab, number> = {
    photo: shared.counts.photo + shared.counts.gif + shared.counts.video,
    file: shared.counts.file,
    link: shared.counts.link,
    voice: shared.counts.voice,
  };
  const tabs: { key: SharedTab; label: string }[] = [
    { key: "photo", label: t("chat.mobile.tab_photos", { count: counts.photo }) },
    { key: "file", label: t("chat.mobile.tab_files", { count: counts.file }) },
    { key: "link", label: t("chat.mobile.tab_links", { count: counts.link }) },
    { key: "voice", label: t("chat.mobile.tab_voice", { count: counts.voice }) },
  ];
  const photos = shared.recent_photos.slice(0, PHOTO_TILES);
  const more = counts.photo - (photos.length - 1);
  return (
    <View className="pb-3.5 pt-3.5" accessibilityLabel={t("chat.mobile.shared_title")}>
      <Text className="mb-2 px-5 text-footnote font-semibold text-muted-foreground" accessibilityRole="header">
        {t("chat.mobile.shared_title")}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="grow-0" contentContainerClassName="gap-1.5 px-5 pb-2.5" accessibilityRole="tablist" accessibilityLabel={t("chat.mobile.shared_kinds_aria")}>
        {tabs.map((item) => {
          const active = item.key === tab;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(item.key)}
              className={cn("min-h-8 justify-center rounded-full px-3 py-1", active ? "bg-tint-blue" : "active:bg-secondary")}
            >
              <Text className={cn("text-footnote font-semibold", active ? "text-primary" : "text-muted-foreground")} style={{ fontVariant: ["tabular-nums"] }}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {tab === "photo" && photos.length > 0 ? (
        <View className="flex-row flex-wrap gap-1 px-5">
          {photos.map((photo, index) => {
            const last = index === photos.length - 1 && counts.photo > photos.length;
            const thumb = photo.thumb_url || photo.url;
            return (
              <Pressable
                key={photo.message_id}
                accessibilityRole="imagebutton"
                accessibilityLabel={last ? t("chat.mobile.shared_more_photos", { count: counts.photo }) : photo.title || t("chat.media_image")}
                onPress={() => onOpenMessage(photo.message_id)}
                className="overflow-hidden rounded-[10px] bg-muted"
                style={{ width: tile, height: tile }}
              >
                {thumb ? (
                  <Image source={chatMediaSource(thumb, photo.message_id, "thumb")} cachePolicy={IMAGE_CACHE_POLICY} contentFit="cover" style={{ width: "100%", height: "100%" }} />
                ) : null}
                {last ? (
                  <View className="absolute inset-0 items-center justify-center bg-black/45">
                    <Text className="text-title3 font-display font-bold text-on-solid">+{more}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text className="px-5 py-2 text-callout text-muted-foreground">{t("chat.mobile.shared_tab_hint", { count: counts[tab] })}</Text>
      )}
    </View>
  );
}
