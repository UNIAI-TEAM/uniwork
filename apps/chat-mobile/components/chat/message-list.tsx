// A conversation's messages, newest at the bottom: an inverted FlatList (no
// FlashList dependency) that keeps what the reader is looking at in place
// while older pages load above and new messages arrive below
// (maintainVisibleContentPosition), with day separators, the typing line at
// the bottom, and a scroll to the message a deep link or a quote points at.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, View } from "react-native";
import { Text } from "@/components/ui/text";
import { formatMessageDay, type TimelineRow } from "@/lib/timeline-display";

/** How close to the newest message still counts as "at the latest" (read marking). */
const AT_LATEST_PX = 120;

interface Props {
  rows: TimelineRow[];
  renderMessage: (row: Extract<TimelineRow, { type: "message" }>) => ReactNode;
  onLoadOlder?: () => void;
  loadingOlder: boolean;
  /** Under the newest message: who is typing. */
  bottom?: ReactNode;
  /** Scroll this message into view once it is in the list; a new `seq` asks again. */
  jumpTo?: { id: string; seq: number } | null;
  onAtLatestChange: (atLatest: boolean) => void;
}

function DayRow({ ts }: { ts: number }) {
  const { t, i18n } = useTranslation();
  const label = formatMessageDay(ts, i18n.language, { today: t("chat.day_today"), yesterday: t("chat.sidebar_yesterday") });
  return (
    <View className="items-center py-3" accessibilityRole="header">
      <Text className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">{label}</Text>
    </View>
  );
}

export function MessageList({ rows, renderMessage, onLoadOlder, loadingOlder, bottom, jumpTo, onAtLatestChange }: Props) {
  const list = useRef<FlatList<TimelineRow>>(null);
  const data = useMemo(() => [...rows].reverse(), [rows]);
  const jumped = useRef<number | null>(null);
  const atLatest = useRef(true);

  useEffect(() => {
    if (!jumpTo || jumped.current === jumpTo.seq) return;
    const index = data.findIndex((row) => row.type === "message" && row.message.id === jumpTo.id);
    if (index < 0) return;
    // After the first layout pass, or the list does not know the rows' heights yet.
    const timer = setTimeout(() => {
      jumped.current = jumpTo.seq;
      list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
    }, 50);
    return () => clearTimeout(timer);
  }, [data, jumpTo]);

  return (
    <FlatList
      ref={list}
      data={data}
      inverted
      keyExtractor={(row) => row.key}
      renderItem={({ item }) => (item.type === "day" ? <DayRow ts={item.ts} /> : <>{renderMessage(item)}</>)}
      maintainVisibleContentPosition={{ minIndexForVisible: 1, autoscrollToTopThreshold: AT_LATEST_PX }}
      onEndReached={onLoadOlder}
      onEndReachedThreshold={0.5}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View className="pb-2">{bottom}</View>}
      ListFooterComponent={loadingOlder ? <ActivityIndicator className="py-4" /> : null}
      scrollEventThrottle={100}
      onScroll={(event) => {
        const next = event.nativeEvent.contentOffset.y < AT_LATEST_PX;
        if (next === atLatest.current) return;
        atLatest.current = next;
        onAtLatestChange(next);
      }}
      onScrollToIndexFailed={(info) => {
        list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        setTimeout(() => list.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true }), 100);
      }}
    />
  );
}
