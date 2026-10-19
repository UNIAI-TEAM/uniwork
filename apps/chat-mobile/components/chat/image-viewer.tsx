// A picture full screen, on black (canvas MobStates, "Xem ảnh"): the close
// button, who sent it and when, "i / n" with the page dots, and a share
// button; a swipe pages through the conversation's photos. The opened photo
// shows the fresh URL its tap fetched; the others resolve their own.
import { Ionicons } from "@expo/vector-icons";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Modal, Pressable, Share, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { formatMessageDay, formatMessageTime } from "@/lib/timeline-display";
import { cn } from "@/lib/utils";
import { useChatMediaSrc } from "./use-chat-media";

export interface ViewerPhoto {
  id: string;
  record?: ChatMessageRecord;
  sender?: string;
  ts?: number;
}

/** Page dots stop being readable past this many photos; the counter stays. */
const MAX_DOTS = 10;
const WHITE = THEME.dark.foreground;

function Page({ photo, wsId, roomId, width, openedUrl, onSrc }: { photo: ViewerPhoto; wsId: string; roomId: string; width: number; openedUrl: string | null; onSrc: (id: string, url: string) => void }) {
  const file = photo.record?.file;
  const src = useChatMediaSrc(wsId, roomId, photo.id, openedUrl ?? file?.url, openedUrl ? undefined : file?.url_expires_at);
  const uri = openedUrl ?? src;
  useEffect(() => {
    if (uri) onSrc(photo.id, uri);
  }, [uri, photo.id, onSrc]);
  return (
    <View style={{ width, flex: 1 }}>
      {uri ? <Image source={{ uri }} contentFit="contain" style={{ flex: 1 }} accessibilityLabel={file?.filename ?? ""} /> : null}
    </View>
  );
}

export function ImageViewer({
  wsId,
  roomId,
  photos,
  opened,
  onClose,
}: {
  wsId: string;
  roomId: string;
  photos: readonly ViewerPhoto[];
  /** The photo a tap opened, with the URL it fetched; null when closed. */
  opened: { id: string; url: string; name: string } | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { width } = useWindowDimensions();
  const urls = useRef(new Map<string, string>());
  const remember = useCallback((id: string, url: string) => urls.current.set(id, url), []);
  // A photo outside the list (still sending, or from a search) is shown alone.
  const pages = useMemo(() => (opened && !photos.some((p) => p.id === opened.id) ? [{ id: opened.id }] : photos), [opened, photos]);
  const startIndex = Math.max(0, pages.findIndex((p) => p.id === opened?.id));
  const [index, setIndex] = useState(startIndex);
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (opened && shownFor !== opened.id) {
    setShownFor(opened.id);
    setIndex(startIndex);
  }
  const current = pages[index] ?? pages[0];
  const when =
    current?.ts !== undefined
      ? t("chat.image_viewer_sent_at", {
          day: formatMessageDay(current.ts, i18n.language, { today: t("chat.day_today"), yesterday: t("chat.sidebar_yesterday") }),
          time: formatMessageTime(current.ts, i18n.language),
        })
      : null;
  const share = () => {
    const url = current ? urls.current.get(current.id) : undefined;
    if (url) void Share.share({ url, message: url }).catch(() => undefined);
  };

  return (
    <Modal visible={opened !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* A modal measures its own insets: without its provider the top bar can slide under the clock. */}
      <SafeAreaProvider>
      <View className="flex-1 bg-black">
        <StatusBar style="light" />
        <SafeAreaView edges={["top"]}>
          <View className="flex-row items-center gap-2.5 px-3 pb-2.5 pt-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("chat.message_list.image_preview_close")}
              onPress={onClose}
              className="h-11 w-11 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
            >
              {/* The viewer is black in both schemes, so the dark scheme's ink is its white. */}
              <Ionicons name="close" size={24} color={WHITE} />
            </Pressable>
            <View className="flex-1">
              <Text className="text-[15px] font-semibold text-white" numberOfLines={1}>
                {current?.sender || opened?.name}
              </Text>
              {when ? <Text className="text-[13px] text-white/70">{when}</Text> : null}
            </View>
            {pages.length > 1 ? (
              <Text className="text-[13px] font-semibold text-white/80" style={{ fontVariant: ["tabular-nums"] }}>
                {t("chat.image_viewer_position", { current: index + 1, total: pages.length })}
              </Text>
            ) : null}
          </View>
        </SafeAreaView>
        {opened ? (
          <FlatList
            data={pages}
            keyExtractor={(p) => p.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={startIndex}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => (
              <Page photo={item} wsId={wsId} roomId={roomId} width={width} openedUrl={item.id === opened.id ? opened.url : null} onSrc={remember} />
            )}
          />
        ) : null}
        <SafeAreaView edges={["bottom"]}>
          <View className="flex-row items-center justify-between px-4 pb-2 pt-3">
            <View className="flex-1 flex-row gap-1.5">
              {pages.length > 1 && pages.length <= MAX_DOTS
                ? pages.map((p, i) => <View key={p.id} className={cn("h-1.5 rounded-full", i === index ? "w-4 bg-white" : "w-1.5 bg-white/40")} />)
                : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t("chat.mobile.image_share")} onPress={share} className="h-11 flex-row items-center gap-2 rounded-full bg-white/15 px-4 active:bg-white/25">
              <Ionicons name="share-outline" size={20} color={WHITE} />
              <Text className="text-sm font-semibold text-white">{t("chat.mobile.image_share")}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
      </SafeAreaProvider>
    </Modal>
  );
}
