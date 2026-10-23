// A conversation's messages on FlashList 2 (audit timeline-flatlist): the same
// contract as message-list.tsx — newest at the bottom, older pages loading above
// without moving what is read, the typing line under the newest message, jumps
// to a quote or a link, the unread line — on a list that recycles its cells
// instead of mounting and unmounting them, keeps each cell's measured height,
// and lands scrollToIndex on rows it has not measured yet in one pass.
//
// FlashList 2 has no inverted mode: it lays chat out bottom-up
// (maintainVisibleContentPosition.startRenderingFromBottom, onStartReached for
// older pages), so the rows run oldest first here, reversed once per change of
// the timeline (lib/timeline-layout.ts builds them newest first for the inverted
// FlatList). Cells are typed by what they draw (a day chip, the unread line, a
// message by its view: text, image, file, poll…), so a recycled cell is reused
// for the same kind of bubble.
//
// Behind the unichat_mobile_timeline_recycled switch (timeline-list.tsx), off by
// default: whether it keeps the inverted list's anchor under the keyboard and
// its scroll feel is a device question, answered by an A/B on the nightly's
// frame numbers and Sentry's slow and frozen frames (runbook › Đo hiệu năng).
import { FlashList, type FlashListRef, type ListRenderItem } from "@shopify/flash-list";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { messageView } from "@/lib/message-display";
import { OlderPagesFooter } from "./conversation-states";
import {
  AT_LATEST_PX,
  DayRow,
  FAR_JUMP_ROWS,
  keyOf,
  TimelineEmpty,
  UNREAD_IN_VIEW_ROWS,
  UnreadRow,
  withUnreadRow,
  type ListRow,
  type MessageListProps,
} from "./message-list";

/** Within this share of a screen from the bottom, a new message scrolls into view (FlashList's own measure). */
const AUTOSCROLL_SHARE = 0.2;

/**
 * After its first layout FlashList 2.0 applies its initial scroll (the bottom, from startRenderingFromBottom, or
 * initialScrollIndex) and repeats it on every commit for 100 ms; a scroll issued before then is undone. The list's own
 * jumps wait this long after its first layout with rows.
 */
export const SETTLE_MS = 150;

/** A cell's recycling pool: one per kind of row, and one per kind of bubble. */
export function timelineItemType(row: ListRow): string {
  if (row.type !== "message") return row.type;
  return row.message.record ? `message:${messageView(row.message.record)}` : "message:pending";
}

/** Distance from the bottom of the content, from a scroll event. */
function fromBottom({ contentOffset, contentSize, layoutMeasurement }: NativeScrollEvent): number {
  return contentSize.height - layoutMeasurement.height - contentOffset.y;
}

export function RecycledMessageList({
  rows,
  renderMessage,
  onLoadOlder,
  loadingOlder,
  onRetryOlder,
  bottom,
  jumpTo,
  onAtLatestChange,
  empty,
  latestSignal = 0,
  unread,
}: MessageListProps) {
  const list = useRef<FlashListRef<ListRow>>(null);
  // Oldest first: the inverted order of message-list.tsx, reversed once per change of the rows.
  const data = useMemo(() => [...withUnreadRow(rows, unread)].reverse(), [rows, unread]);
  const atLatest = useRef(true);
  const renderItem: ListRenderItem<ListRow> = useCallback(
    ({ item }) =>
      item.type === "day" ? <DayRow ts={item.ts} /> : item.type === "unread" ? <UnreadRow label={item.label} /> : <>{renderMessage(item)}</>,
    [renderMessage],
  );

  // Where the room opens instead of the bottom: the message a link names, else an unread line past the first screen.
  const landing = useMemo(() => {
    if (jumpTo) {
      const index = data.findIndex((row) => row.type === "message" && row.message.id === jumpTo.id);
      return index < 0 ? undefined : index;
    }
    const index = unread ? data.findIndex((row) => row.type === "unread") : -1;
    return index < 0 || data.length - 1 - index < UNREAD_IN_VIEW_ROWS ? undefined : index;
  }, [data, jumpTo, unread]);

  // FlashList's own initial scroll owns the list until it settles (SETTLE_MS): until then the landing is its
  // initialScrollIndex (the row at the top, no jump from the bottom); after it, the jumps below place it exactly.
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const onLoad = useCallback(() => setLoaded(true), []);
  const hasRows = data.length > 0;
  useEffect(() => {
    if (!loaded || !hasRows || ready) return;
    const timer = setTimeout(() => setReady(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [loaded, hasRows, ready]);

  const jumped = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || !jumpTo || jumped.current === jumpTo.seq) return;
    const index = data.findIndex((row) => row.type === "message" && row.message.id === jumpTo.id);
    if (index < 0) return;
    jumped.current = jumpTo.seq;
    // FlashList measures its way to an unmeasured target itself; a far one goes without animation.
    void list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: data.length - 1 - index <= FAR_JUMP_ROWS });
  }, [ready, data, jumpTo]);

  // Opened with unread messages past the first screen: open on their line, near the top (a link to a message wins).
  const landedOn = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !unread || jumpTo || landedOn.current === unread.id) return;
    const index = data.findIndex((row) => row.type === "unread");
    if (index < 0) return;
    landedOn.current = unread.id;
    if (data.length - 1 - index < UNREAD_IN_VIEW_ROWS) return;
    void list.current?.scrollToIndex({ index, viewPosition: 0.1, animated: false });
  }, [ready, data, unread, jumpTo]);

  const scrolledFor = useRef(latestSignal);
  useEffect(() => {
    if (scrolledFor.current === latestSignal) return;
    scrolledFor.current = latestSignal;
    list.current?.scrollToEnd({ animated: true });
  }, [latestSignal]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = fromBottom(event.nativeEvent) < AT_LATEST_PX;
      if (next === atLatest.current) return;
      atLatest.current = next;
      onAtLatestChange(next);
    },
    [onAtLatestChange],
  );

  if (rows.length === 0 && empty) return <TimelineEmpty text={empty} bottom={bottom} />;

  return (
    <FlashList
      ref={list}
      testID="message-list"
      data={data}
      keyExtractor={keyOf}
      getItemType={timelineItemType}
      renderItem={renderItem}
      initialScrollIndex={ready ? undefined : landing}
      onLoad={onLoad}
      maintainVisibleContentPosition={{ startRenderingFromBottom: true, autoscrollToBottomThreshold: AUTOSCROLL_SHARE }}
      onStartReached={onLoadOlder}
      onStartReachedThreshold={0.5}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<OlderPagesFooter loading={loadingOlder} onRetry={onRetryOlder} />}
      ListFooterComponent={<View className="pb-2">{bottom}</View>}
      scrollEventThrottle={100}
      onScroll={onScroll}
    />
  );
}
