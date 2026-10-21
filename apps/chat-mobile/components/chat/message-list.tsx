// A conversation's messages, newest at the bottom: an inverted FlatList (no
// FlashList dependency) that keeps what the reader is looking at in place
// while older pages load above and new messages arrive below
// (maintainVisibleContentPosition), with day separators as chips on the chat
// wall, the typing line at the bottom, and a scroll to the message a deep link
// or a quote points at. The cell callback keeps its identity while the rows'
// renderer does (audit H1): the list re-renders cells only when a row changed.
// A new `latestSignal` scrolls to the newest message (the jump-to-latest
// button, and every send of one's own: it lands at the bottom, in view).
import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, View, type ListRenderItem } from "react-native";
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
  /** Said in the middle of the wall while the conversation has no message yet. */
  empty?: string | null;
  /** A new value scrolls to the newest message. */
  latestSignal?: number;
}

const keyOf = (row: TimelineRow) => row.key;

const DayRow = memo(function DayRow({ ts }: { ts: number }) {
  const { t, i18n } = useTranslation();
  const label = formatMessageDay(ts, i18n.language, { today: t("chat.day_today"), yesterday: t("chat.sidebar_yesterday") });
  return (
    <View className="items-center py-2.5" accessibilityRole="header">
      <View className="rounded-full bg-chat-chip px-3 py-[3px]">
        <Text className="text-footnote font-semibold text-chat-chip-foreground">{label}</Text>
      </View>
    </View>
  );
});

export function MessageList({ rows, renderMessage, onLoadOlder, loadingOlder, bottom, jumpTo, onAtLatestChange, empty, latestSignal = 0 }: Props) {
  const list = useRef<FlatList<TimelineRow>>(null);
  const data = useMemo(() => [...rows].reverse(), [rows]);
  const jumped = useRef<number | null>(null);
  const atLatest = useRef(true);
  const renderItem: ListRenderItem<TimelineRow> = useCallback(
    ({ item }) => (item.type === "day" ? <DayRow ts={item.ts} /> : <>{renderMessage(item)}</>),
    [renderMessage],
  );

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

  // The inverted list's offset 0 is its newest message.
  const scrolledFor = useRef(latestSignal);
  useEffect(() => {
    if (scrolledFor.current === latestSignal) return;
    scrolledFor.current = latestSignal;
    list.current?.scrollToOffset({ offset: 0, animated: true });
  }, [latestSignal]);

  if (rows.length === 0 && empty) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <View className="rounded-2xl bg-chat-chip px-4 py-2.5">
          <Text className="text-center text-callout text-chat-chip-foreground">{empty}</Text>
        </View>
        {bottom}
      </View>
    );
  }

  return (
    <FlatList
      ref={list}
      testID="message-list"
      data={data}
      inverted
      keyExtractor={keyOf}
      renderItem={renderItem}
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
