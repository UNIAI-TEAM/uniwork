// A picture full screen, on black (canvas MobStates, "Xem ảnh"): the close
// button, who sent it and when, "i / n" with the page dots, and a share
// button; a swipe pages through the conversation's photos. The opened photo
// shows the fresh URL its tap fetched; the others resolve their own. S6: each
// photo pinches, double-taps and drags to zoom, and a drag up or down closes
// the viewer (components/chat/zoomable-image.tsx); the pager holds while a
// photo is zoomed.
import { Ionicons } from "@expo/vector-icons";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, Share, useWindowDimensions, View, type LayoutChangeEvent } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { CallAwareModal } from "@/components/ui/call-aware-modal";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { THEME } from "@/lib/theme";
import { formatMessageDay, formatMessageTime } from "@/lib/timeline-display";
import { cn } from "@/lib/utils";
import { useChatMediaSrc } from "./use-chat-media";
import { chatMediaSource } from "@/lib/media-source";
import { DISMISS_DISTANCE } from "@/lib/zoom";
import { ZoomableImage } from "./zoomable-image";

export interface ViewerPhoto {
  id: string;
  record?: ChatMessageRecord;
  sender?: string;
  ts?: number;
}

/** Page dots stop being readable past this many photos; the counter stays. */
const MAX_DOTS = 10;
const WHITE = THEME.dark.foreground;

interface PageProps {
  photo: ViewerPhoto;
  wsId: string;
  roomId: string;
  width: number;
  height: number;
  openedUrl: string | null;
  dismissY: SharedValue<number>;
  onSrc: (id: string, url: string) => void;
  onDismiss: () => void;
  onZoomChange: (zoomed: boolean) => void;
}

function Page({ photo, wsId, roomId, width, height, openedUrl, dismissY, onSrc, onDismiss, onZoomChange }: PageProps) {
  const file = photo.record?.file;
  const src = useChatMediaSrc(wsId, roomId, photo.id, openedUrl ?? file?.url, openedUrl ? undefined : file?.url_expires_at);
  const uri = openedUrl ?? src;
  useEffect(() => {
    if (uri) onSrc(photo.id, uri);
  }, [uri, photo.id, onSrc]);
  return (
    <View style={{ width, flex: 1 }}>
      {uri && height > 0 ? (
        <ZoomableImage
          source={chatMediaSource(uri, photo.id, "full")}
          label={file?.filename ?? ""}
          width={width}
          height={height}
          dismissY={dismissY}
          onDismiss={onDismiss}
          onZoomChange={onZoomChange}
        />
      ) : null}
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
  // The pager's height (the photo's frame), the closing drag that fades the page, and whether a photo is zoomed.
  const [pageHeight, setPageHeight] = useState(0);
  const dismissY = useSharedValue(0);
  const [zoomed, setZoomed] = useState(false);
  const close = useCallback(() => {
    setZoomed(false);
    onClose();
  }, [onClose]);
  useEffect(() => {
    if (opened) dismissY.value = 0;
  }, [opened, dismissY]);
  const backdrop = useAnimatedStyle(() => ({ opacity: interpolate(Math.abs(dismissY.value), [0, DISMISS_DISTANCE * 2], [1, 0.35], "clamp") }));
  const share = () => {
    const url = current ? urls.current.get(current.id) : undefined;
    if (url) void Share.share({ url, message: url }).catch(() => undefined);
  };

  return (
    <CallAwareModal visible={opened !== null} animationType="fade" onRequestClose={close} statusBarTranslucent transparent>
      {/* A modal measures its own insets: without its provider the top bar can slide under the clock. A modal is
          its own window on Android, so the zoom gestures need their own root there too. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
      <Animated.View className="absolute inset-0 bg-black" style={backdrop} />
      <View className="flex-1">
        <StatusBar style="light" />
        <SafeAreaView edges={["top"]}>
          <View className="flex-row items-center gap-2.5 px-3 pb-2.5 pt-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("chat.message_list.image_preview_close")}
              onPress={close}
              className="h-11 w-11 items-center justify-center rounded-full bg-white/15 active:bg-white/25"
            >
              {/* The viewer is black in both schemes, so the dark scheme's ink is its white. */}
              <Ionicons name="close" size={24} color={WHITE} />
            </Pressable>
            <View className="flex-1">
              <Text className="text-subhead font-semibold text-white" numberOfLines={1}>
                {current?.sender || opened?.name}
              </Text>
              {when ? <Text className="text-footnote text-white/70">{when}</Text> : null}
            </View>
            {pages.length > 1 ? (
              <Text className="text-footnote font-semibold text-white/80" style={{ fontVariant: ["tabular-nums"] }}>
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
            // A zoomed photo takes the drags; the pager waits until it is back to fit.
            scrollEnabled={!zoomed}
            style={{ flex: 1 }}
            onLayout={(event: LayoutChangeEvent) => setPageHeight(event.nativeEvent.layout.height)}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={startIndex}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => (
              <Page
                photo={item}
                wsId={wsId}
                roomId={roomId}
                width={width}
                height={pageHeight}
                openedUrl={item.id === opened.id ? opened.url : null}
                dismissY={dismissY}
                onSrc={remember}
                onDismiss={close}
                onZoomChange={setZoomed}
              />
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
            <Pressable accessibilityRole="button" accessibilityLabel={t("chat.mobile.image_share")} onPress={share} className="min-h-11 flex-row items-center gap-2 rounded-full bg-white/15 px-4 py-2.5 active:bg-white/25">
              <Ionicons name="share-outline" size={20} color={WHITE} />
              <Text className="text-callout font-semibold text-white">{t("chat.mobile.image_share")}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
      </SafeAreaProvider>
      </GestureHandlerRootView>
    </CallAwareModal>
  );
}
