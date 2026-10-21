// A conversation's messages, newest at the bottom: an inverted FlatList (no
// FlashList dependency) that keeps what the reader is looking at in place
// while older pages load above and new messages arrive below
// (maintainVisibleContentPosition), with day separators as chips on the chat
// wall, the typing line at the bottom, and a scroll to the message a deep link
// or a quote points at. The cell callback keeps its identity while the rows'
// renderer does (audit H1): the list re-renders cells only when a row changed.
// A new `latestSignal` scrolls to the newest message (the jump-to-latest
// button, and every send of one's own: it lands at the bottom, in view).
//
// Why not FlashList like the room and contact lists: this list's whole feel is
// the inverted list's anchor (older pages arrive above without moving what is
// read, new messages arrive below the keyboard-tracking composer), and only a
// device can tell whether a new list keeps it; FlashList 2 lays chat out
// bottom-up a different way (startRenderingFromBottom, onStartReached). Until
// that is measured on hardware, the FlatList is tuned instead (audit P2 Perf):
// one screenful first, ten cells a batch and a window of 11 screens rather
// than 21, so a 2,000-message history keeps a few dozen bubbles mounted.
//
// A room opened with unread messages draws "N tin chưa đọc" above the first
// of them and, when that is past the first screen, opens on it (near the top,
// unanimated), as WhatsApp, Telegram and Slack do; the line stays while the
// room is open.
//
// A jump far up the loaded pages goes without animation (a long animated
// scroll over cells never measured overshoots, then corrects: a visible double
// scroll); a target never measured is reached by the average row height, then
// retried a few times at its index, never animated. A target outside the
// loaded pages is the room's to load (roomAroundOptions), not this list's.
import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, View, type ListRenderItem } from "react-native";
import { Text } from "@/components/ui/text";
import { formatMessageDay, type TimelineRow } from "@/lib/timeline-display";
import { OlderPagesFooter } from "./conversation-states";

/** How close to the newest message still counts as "at the latest" (read marking). */
const AT_LATEST_PX = 120;
/** Rows from the newest past which a jump is not animated. */
const FAR_JUMP_ROWS = 30;
/** Attempts at a jump target the list has not measured yet, after the first. */
const JUMP_RETRIES = 3;
const RETRY_MS = 60;
/** Rows from the newest within which the unread line is on the first screen already: no scroll to it. */
const UNREAD_IN_VIEW_ROWS = 8;

interface Props {
  /** Newest first, the inverted list's order (lib/timeline-layout.ts): never reversed here per change. */
  rows: TimelineRow[];
  renderMessage: (row: Extract<TimelineRow, { type: "message" }>) => ReactNode;
  onLoadOlder?: () => void;
  loadingOlder: boolean;
  /** The last older page failed: its retry, at the top of the list. */
  onRetryOlder?: () => void;
  /** Under the newest message: who is typing. */
  bottom?: ReactNode;
  /** Scroll this message into view once it is in the list; a new `seq` asks again. */
  jumpTo?: { id: string; seq: number } | null;
  onAtLatestChange: (atLatest: boolean) => void;
  /** Said in the middle of the wall while the conversation has no message yet. */
  empty?: string | null;
  /** A new value scrolls to the newest message. */
  latestSignal?: number;
  /** The first unread message when the room opened, and what its line says. */
  unread?: { id: string; label: string } | null;
}

type ListRow = TimelineRow | { type: "unread"; key: "unread"; label: string };

const keyOf = (row: ListRow) => row.key;

/** The rows with the unread line above the first unread message (the next index, in the inverted list's order). */
function withUnreadRow(rows: TimelineRow[], unread: { id: string; label: string } | null | undefined): ListRow[] {
  if (!unread) return rows;
  const index = rows.findIndex((row) => row.type === "message" && row.message.id === unread.id);
  if (index < 0) return rows;
  return [...rows.slice(0, index + 1), { type: "unread", key: "unread", label: unread.label }, ...rows.slice(index + 1)];
}

/** "N tin chưa đọc" between two hairlines, read as one line. */
const UnreadRow = memo(function UnreadRow({ label }: { label: string }) {
  return (
    <View className="flex-row items-center gap-2.5 px-4 pb-1.5 pt-3" accessible accessibilityLabel={label} testID="unread-divider">
      <View className="h-px flex-1 bg-primary/40" />
      <View className="rounded-full bg-chat-chip px-3 py-[3px]">
        <Text className="text-footnote font-semibold text-primary" style={{ fontVariant: ["tabular-nums"] }}>
          {label}
        </Text>
      </View>
      <View className="h-px flex-1 bg-primary/40" />
    </View>
  );
});

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

export function MessageList({ rows, renderMessage, onLoadOlder, loadingOlder, onRetryOlder, bottom, jumpTo, onAtLatestChange, empty, latestSignal = 0, unread }: Props) {
  const list = useRef<FlatList<ListRow>>(null);
  const data = useMemo(() => withUnreadRow(rows, unread), [rows, unread]);
  const jumped = useRef<number | null>(null);
  const atLatest = useRef(true);
  const renderItem: ListRenderItem<ListRow> = useCallback(
    ({ item }) => (item.type === "day" ? <DayRow ts={item.ts} /> : item.type === "unread" ? <UnreadRow label={item.label} /> : <>{renderMessage(item)}</>),
    [renderMessage],
  );

  const retries = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (retry.current) clearTimeout(retry.current);
    },
    [],
  );

  useEffect(() => {
    if (!jumpTo || jumped.current === jumpTo.seq) return;
    const index = data.findIndex((row) => row.type === "message" && row.message.id === jumpTo.id);
    if (index < 0) return;
    // After the first layout pass, or the list does not know the rows' heights yet.
    const timer = setTimeout(() => {
      jumped.current = jumpTo.seq;
      retries.current = 0;
      list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: index <= FAR_JUMP_ROWS });
    }, 50);
    return () => clearTimeout(timer);
  }, [data, jumpTo]);

  // Opened with unread messages past the first screen: open on their line (a link to a message wins).
  const landedOn = useRef<string | null>(null);
  useEffect(() => {
    if (!unread || jumpTo || landedOn.current === unread.id) return;
    const index = data.findIndex((row) => row.type === "unread");
    if (index < 0) return;
    if (index < UNREAD_IN_VIEW_ROWS) {
      landedOn.current = unread.id;
      return;
    }
    // After the first layout pass; viewPosition 0.9 is near the top of the inverted list, with the line in view.
    const timer = setTimeout(() => {
      landedOn.current = unread.id;
      retries.current = 0;
      list.current?.scrollToIndex({ index, viewPosition: 0.9, animated: false });
    }, 50);
    return () => clearTimeout(timer);
  }, [data, unread, jumpTo]);

  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    if (retries.current >= JUMP_RETRIES) return;
    retries.current += 1;
    if (retry.current) clearTimeout(retry.current);
    retry.current = setTimeout(() => list.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: false }), RETRY_MS);
  }, []);

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
      ListFooterComponent={<OlderPagesFooter loading={loadingOlder} onRetry={onRetryOlder} />}
      scrollEventThrottle={100}
      onScroll={(event) => {
        const next = event.nativeEvent.contentOffset.y < AT_LATEST_PX;
        if (next === atLatest.current) return;
        atLatest.current = next;
        onAtLatestChange(next);
      }}
      onScrollToIndexFailed={onScrollToIndexFailed}
      initialNumToRender={15}
      maxToRenderPerBatch={10}
      windowSize={11}
    />
  );
}
