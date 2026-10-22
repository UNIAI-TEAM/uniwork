// The message list on its own (audit P2/P3 Perf): a window of a few screens of
// a long history, a jump that animates only when the target is near, and a
// target the list has not measured reached by estimate then by index a few
// times, never animated and never forever.
import { act, fireEvent, screen } from "@testing-library/react-native";
import { FlatList, Text } from "react-native";
import type { TimelineMessage, TimelineRow } from "@/lib/timeline-display";
import { layoutTimeline } from "@/lib/timeline-layout";
import { render } from "@/test/render";
import { MessageList } from "./message-list";

const T0 = new Date(2026, 9, 21, 9, 0).getTime();
const messages = (count: number): TimelineMessage[] =>
  Array.from({ length: count }, (_, n) => ({ id: `m${n}`, sender: n % 2 ? "U1" : "U2", body: `tin ${n}`, ts: T0 + n * 60_000 }));
const newestFirst = (list: TimelineMessage[]) => layoutTimeline(list).rows;
const renderMessage = (row: Extract<TimelineRow, { type: "message" }>) => <Text>{row.message.body}</Text>;

let scrollToIndex: jest.SpyInstance;
let scrollToOffset: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  scrollToIndex = jest.spyOn(FlatList.prototype, "scrollToIndex").mockImplementation(() => undefined);
  scrollToOffset = jest.spyOn(FlatList.prototype, "scrollToOffset").mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function list(rows: TimelineRow[], extra: Partial<Parameters<typeof MessageList>[0]> = {}) {
  return <MessageList rows={rows} renderMessage={renderMessage} loadingOlder={false} onAtLatestChange={jest.fn()} {...extra} />;
}

const advance = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

describe("MessageList", () => {
  it("mounts a screenful of a long history, newest first, not all of it", async () => {
    await render(list(newestFirst(messages(500))));
    expect(screen.getByText("tin 499")).toBeOnTheScreen();
    expect(screen.queryByText("tin 0")).toBeNull();
    const flat = screen.getByTestId("message-list").props as { windowSize: number; initialNumToRender: number; maxToRenderPerBatch: number };
    expect(flat).toMatchObject({ windowSize: 7, initialNumToRender: 15, maxToRenderPerBatch: 10 });
  });

  it("animates a jump to a near message, and jumps far without animation", async () => {
    const rows = newestFirst(messages(100));
    const { rerender } = await render(list(rows, { jumpTo: { id: "m95", seq: 1 } }));
    await advance(50);
    expect(scrollToIndex).toHaveBeenLastCalledWith(expect.objectContaining({ viewPosition: 0.5, animated: true }));
    await rerender(list(rows, { jumpTo: { id: "m10", seq: 2 } }));
    await advance(50);
    expect(scrollToIndex).toHaveBeenLastCalledWith(expect.objectContaining({ animated: false }));
    // The same request again does not scroll again; a message not loaded is not this list's to find.
    scrollToIndex.mockClear();
    await rerender(list(rows, { jumpTo: { id: "m10", seq: 2 } }));
    await rerender(list(rows, { jumpTo: { id: "gone", seq: 3 } }));
    await advance(50);
    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it("reaches a target it has not measured by estimate, then retries its index a few times, unanimated", async () => {
    await render(list(newestFirst(messages(100))));
    const failed = (screen.getByTestId("message-list").props as { onScrollToIndexFailed: (info: { index: number; averageItemLength: number }) => void }).onScrollToIndexFailed;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await act(async () => failed({ index: 80, averageItemLength: 50 }));
      await advance(60);
    }
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 4000, animated: false });
    expect(scrollToIndex).toHaveBeenCalledTimes(3);
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 80, viewPosition: 0.5, animated: false });
  });

  it("drops a pending retry when it unmounts", async () => {
    const { unmount } = await render(list(newestFirst(messages(10))));
    const failed = (screen.getByTestId("message-list").props as { onScrollToIndexFailed: (info: { index: number; averageItemLength: number }) => void }).onScrollToIndexFailed;
    await act(async () => failed({ index: 8, averageItemLength: 50 }));
    await act(async () => failed({ index: 8, averageItemLength: 50 }));
    await unmount();
    jest.advanceTimersByTime(60);
    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it("says when the reader leaves and comes back to the newest message, and scrolls down on a new signal", async () => {
    const onAtLatestChange = jest.fn();
    const rows = newestFirst(messages(30));
    const { rerender } = await render(list(rows, { onAtLatestChange }));
    const scroll = (y: number) => fireEvent.scroll(screen.getByTestId("message-list"), { nativeEvent: { contentOffset: { x: 0, y }, contentSize: { width: 390, height: 3000 }, layoutMeasurement: { width: 390, height: 700 } } });
    await scroll(500);
    await scroll(600);
    await scroll(0);
    expect(onAtLatestChange.mock.calls).toEqual([[false], [true]]);
    await rerender(list(rows, { onAtLatestChange, latestSignal: 1 }));
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
  });

  it("says its empty line on an empty wall, and shows older pages loading", async () => {
    const { rerender } = await render(list([], { empty: "Chưa có tin nhắn" }));
    expect(screen.getByText("Chưa có tin nhắn")).toBeOnTheScreen();
    await rerender(list(newestFirst(messages(3)), { loadingOlder: true }));
    expect(screen.getByText("tin 2")).toBeOnTheScreen();
  });

  describe("the unread line", () => {
    const unreadIndex = (rows: TimelineRow[]) => rows.findIndex((row) => row.type === "message" && row.message.id === "m40");

    it("sits right above the first unread message and opens the room on it when that is past the first screen", async () => {
      const rows = newestFirst(messages(100));
      await render(list(rows, { unread: { id: "m40", label: "60 tin chưa đọc" } }));
      await advance(50);
      // Newest first: the line is the row after its message, so it draws above it.
      expect(scrollToIndex.mock.calls).toEqual([[{ index: unreadIndex(rows) + 1, viewPosition: 0.9, animated: false }]]);
      await advance(50);
      expect(scrollToIndex).toHaveBeenCalledTimes(1);
    });

    it("does not scroll when the line is on the first screen, nor when a link names a message", async () => {
      const rows = newestFirst(messages(10));
      await render(list(rows, { unread: { id: "m8", label: "2 tin chưa đọc" } }));
      await advance(50);
      expect(scrollToIndex).not.toHaveBeenCalled();
      // Read top to bottom (the inverted list renders newest first): the older message, the line, then the unread ones.
      const texts = screen.getAllByText(/^tin [789]$|tin chưa đọc/).map((node) => node.props.children as string);
      expect(texts).toEqual(["tin 9", "tin 8", "2 tin chưa đọc", "tin 7"]);
      const long = newestFirst(messages(100));
      await render(list(long, { unread: { id: "m40", label: "60 tin chưa đọc" }, jumpTo: { id: "m90", seq: 1 } }));
      await advance(50);
      expect(scrollToIndex).toHaveBeenCalledTimes(1);
      expect(scrollToIndex).toHaveBeenLastCalledWith(expect.objectContaining({ viewPosition: 0.5 }));
    });

    it("draws nothing for a message not in the list", async () => {
      await render(list(newestFirst(messages(10)), { unread: { id: "gone", label: "1 tin chưa đọc" } }));
      expect(screen.queryByTestId("unread-divider")).toBeNull();
    });
  });
});
