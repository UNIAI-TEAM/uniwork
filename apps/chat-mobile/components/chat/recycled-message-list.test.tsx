// The recycled message list's own logic (recycled-message-list.tsx), on a
// stand-in FlashList that draws every row and records what it is asked: rows
// oldest first, cells pooled by kind, the jumps, the unread landing, "at the
// latest" from the bottom, and older pages from the top. The stand-in says it
// has loaded after its first commit, as FlashList's onLoad does after its first
// layout. The real FlashList draws it in recycled-message-list.flash.test.tsx.
import { ChatMessageSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { act, fireEvent, screen } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { Text } from "react-native";
import type { TimelineMessage, TimelineRow } from "@/lib/timeline-display";
import { layoutTimeline } from "@/lib/timeline-layout";
import { render } from "@/test/render";
import { RecycledMessageList, SETTLE_MS, timelineItemType } from "./recycled-message-list";
import type { ListRow } from "./message-list";

const mockFlash = {
  scrollToIndex: jest.fn(async () => undefined),
  scrollToEnd: jest.fn(),
  props: null as null | Record<string, unknown>,
};

interface MockStandInProps {
  data: ListRow[];
  keyExtractor: (row: ListRow) => string;
  renderItem: (info: { item: ListRow }) => ReactElement;
  ListHeaderComponent: ReactNode;
  ListFooterComponent: ReactNode;
  testID: string;
  onScroll: () => void;
  onLoad: () => void;
}

jest.mock("@shopify/flash-list", () => {
  const { forwardRef, useEffect, useImperativeHandle } = jest.requireActual<typeof import("react")>("react");
  const { ScrollView, View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    FlashList: forwardRef(function StandIn(props: MockStandInProps, ref) {
      mockFlash.props = props as unknown as Record<string, unknown>;
      useImperativeHandle(ref, () => ({ scrollToIndex: mockFlash.scrollToIndex, scrollToEnd: mockFlash.scrollToEnd }));
      const { onLoad } = props;
      useEffect(() => onLoad(), [onLoad]);
      return (
        <ScrollView testID={props.testID} onScroll={props.onScroll}>
          {props.ListHeaderComponent}
          {props.data.map((item) => (
            <View key={props.keyExtractor(item)}>{props.renderItem({ item })}</View>
          ))}
          {props.ListFooterComponent}
        </ScrollView>
      );
    }),
  };
});

const T0 = new Date(2026, 9, 21, 9, 0).getTime();
const messages = (count: number): TimelineMessage[] =>
  Array.from({ length: count }, (_, n) => ({ id: `m${n}`, sender: n % 2 ? "U1" : "U2", body: `tin ${n}`, ts: T0 + n * 60_000 }));
const newestFirst = (list: TimelineMessage[]) => layoutTimeline(list).rows;
const renderMessage = (row: Extract<TimelineRow, { type: "message" }>) => <Text>{row.message.body}</Text>;

function list(rows: TimelineRow[], extra: Partial<Parameters<typeof RecycledMessageList>[0]> = {}) {
  return <RecycledMessageList rows={rows} renderMessage={renderMessage} loadingOlder={false} onAtLatestChange={jest.fn()} {...extra} />;
}

/** Past FlashList's own initial scroll: the list's jumps are issued from here on. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, SETTLE_MS + 10)));

beforeEach(() => {
  mockFlash.scrollToIndex.mockClear();
  mockFlash.scrollToEnd.mockClear();
  mockFlash.props = null;
});

describe("RecycledMessageList", () => {
  it("lays the rows out oldest first from the bottom, loads older pages from the top, and pools cells by kind", async () => {
    const onLoadOlder = jest.fn();
    await render(list(newestFirst(messages(3)), { onLoadOlder, bottom: <Text>đang gõ</Text> }));
    const texts = screen.getAllByText(/^tin \d$|đang gõ/).map((node) => node.props.children as string);
    expect(texts).toEqual(["tin 0", "tin 1", "tin 2", "đang gõ"]);
    expect(mockFlash.props).toMatchObject({
      maintainVisibleContentPosition: { startRenderingFromBottom: true, autoscrollToBottomThreshold: 0.2 },
      onStartReached: onLoadOlder,
      getItemType: timelineItemType,
    });
  });

  it("names a cell's pool by its row, and a message's by what its bubble draws", () => {
    const [day, message] = [...newestFirst(messages(1))].reverse() as [ListRow, ListRow];
    expect(timelineItemType(day)).toBe("day");
    expect(timelineItemType({ type: "unread", key: "unread", label: "1" })).toBe("unread");
    expect(timelineItemType(message)).toBe("message:pending");
    if (message.type !== "message") throw new Error("a message row");
    const record = ChatMessageSchema.parse({ id: "m0", room_id: "r1", workspace_id: "w1", sender_id: "U2", sender_display_name: "Bình", kind: "text", body: "x", created_at: "2026-10-21T02:00:00Z" });
    expect(timelineItemType({ ...message, message: { ...message.message, record } })).toBe("message:text");
  });

  it("jumps to a message by its index from the top, animated only when near the newest", async () => {
    const rows = newestFirst(messages(100));
    const { rerender } = await render(list(rows, { jumpTo: { id: "m95", seq: 1 } }));
    await settle();
    const indexOf = (id: string) => (mockFlash.props?.data as ListRow[]).findIndex((row) => row.type === "message" && row.message.id === id);
    expect(mockFlash.scrollToIndex).toHaveBeenLastCalledWith({ index: indexOf("m95"), viewPosition: 0.5, animated: true });
    await rerender(list(rows, { jumpTo: { id: "m10", seq: 2 } }));
    expect(mockFlash.scrollToIndex).toHaveBeenLastCalledWith({ index: indexOf("m10"), viewPosition: 0.5, animated: false });
    mockFlash.scrollToIndex.mockClear();
    await rerender(list(rows, { jumpTo: { id: "m10", seq: 2 } }));
    await rerender(list(rows, { jumpTo: { id: "gone", seq: 3 } }));
    expect(mockFlash.scrollToIndex).not.toHaveBeenCalled();
  });

  it("opens on the unread line near the top when it is past the first screen, and not when it is on it", async () => {
    await render(list(newestFirst(messages(100)), { unread: { id: "m40", label: "60 tin chưa đọc" } }));
    await settle();
    const line = (mockFlash.props?.data as ListRow[]).findIndex((row) => row.type === "unread");
    expect(mockFlash.scrollToIndex.mock.calls).toEqual([[{ index: line, viewPosition: 0.1, animated: false }]]);
    mockFlash.scrollToIndex.mockClear();
    await render(list(newestFirst(messages(10)), { unread: { id: "m8", label: "2 tin chưa đọc" } }));
    await settle();
    expect(mockFlash.scrollToIndex).not.toHaveBeenCalled();
    // A link to a message wins over the line; a line for a message not loaded draws nothing.
    await render(list(newestFirst(messages(100)), { unread: { id: "m40", label: "60" }, jumpTo: { id: "m90", seq: 1 } }));
    await settle();
    expect(mockFlash.scrollToIndex).toHaveBeenCalledTimes(1);
    expect(mockFlash.scrollToIndex).toHaveBeenLastCalledWith(expect.objectContaining({ viewPosition: 0.5 }));
    mockFlash.scrollToIndex.mockClear();
    await render(list(newestFirst(messages(10)), { unread: { id: "gone", label: "1" } }));
    await settle();
    expect(screen.queryByTestId("unread-divider")).toBeNull();
    expect(mockFlash.scrollToIndex).not.toHaveBeenCalled();
  });

  it("leaves the landing to FlashList's initial scroll until it settles, then places it itself", async () => {
    const rows = newestFirst(messages(100));
    const { rerender } = await render(list(rows, { unread: { id: "m40", label: "60" } }));
    const data = () => mockFlash.props?.data as ListRow[];
    const line = data().findIndex((row) => row.type === "unread");
    // Before it settles: no jump of the list's own (FlashList would undo it), the line is the initial row instead.
    expect(mockFlash.scrollToIndex).not.toHaveBeenCalled();
    expect(mockFlash.props?.initialScrollIndex).toBe(line);
    await rerender(list(rows, { jumpTo: { id: "m10", seq: 1 } }));
    const target = data().findIndex((row) => row.type === "message" && row.message.id === "m10");
    expect(mockFlash.props?.initialScrollIndex).toBe(target);
    await rerender(list(rows, { jumpTo: { id: "gone", seq: 2 } }));
    expect(mockFlash.props?.initialScrollIndex).toBeUndefined();
    await settle();
    expect(mockFlash.scrollToIndex).not.toHaveBeenCalled();
    await rerender(list(rows, { jumpTo: { id: "m10", seq: 3 } }));
    expect(mockFlash.scrollToIndex).toHaveBeenCalledWith({ index: target, viewPosition: 0.5, animated: false });
    // Settled, the bottom is FlashList's again (its initial scroll has run and does not come back).
    expect(mockFlash.props?.initialScrollIndex).toBeUndefined();
  });

  it("waits for rows before it counts its initial scroll as settled", async () => {
    const { rerender } = await render(list([]));
    await settle();
    const rows = newestFirst(messages(100));
    await rerender(list(rows, { unread: { id: "m40", label: "60" } }));
    expect(mockFlash.scrollToIndex).not.toHaveBeenCalled();
    await settle();
    expect(mockFlash.scrollToIndex).toHaveBeenCalledTimes(1);
  });

  it("says when the reader leaves and comes back to the bottom, and scrolls to the end on a new signal", async () => {
    const onAtLatestChange = jest.fn();
    const rows = newestFirst(messages(30));
    const { rerender } = await render(list(rows, { onAtLatestChange }));
    const scroll = (y: number) =>
      fireEvent.scroll(screen.getByTestId("message-list"), {
        nativeEvent: { contentOffset: { x: 0, y }, contentSize: { width: 390, height: 3000 }, layoutMeasurement: { width: 390, height: 700 } },
      });
    await scroll(1500);
    await scroll(1400);
    await scroll(2250);
    expect(onAtLatestChange.mock.calls).toEqual([[false], [true]]);
    await rerender(list(rows, { onAtLatestChange, latestSignal: 1 }));
    expect(mockFlash.scrollToEnd).toHaveBeenCalledWith({ animated: true });
    await rerender(list(rows, { onAtLatestChange, latestSignal: 1 }));
    expect(mockFlash.scrollToEnd).toHaveBeenCalledTimes(1);
  });

  it("says its empty line on an empty wall", async () => {
    await render(list([], { empty: "Chưa có tin nhắn" }));
    expect(screen.getByText("Chưa có tin nhắn")).toBeOnTheScreen();
  });
});
