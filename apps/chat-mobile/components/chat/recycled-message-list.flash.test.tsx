// The recycled message list on the real FlashList 2 (laid out in Jest by
// test/jest-setup.ts: a 400 × 900 window, 100 pt cells): a long history mounts
// about a screenful of recycled cells, not all of it, oldest first above the
// newest; a room opened on an unread line or a link to an old message lands
// there, not on the bottom FlashList's own initial scroll would keep it on.
// Its own logic is recycled-message-list.test.tsx's.
import { act, screen } from "@testing-library/react-native";
import { ScrollView, Text } from "react-native";
import type { TimelineMessage, TimelineRow } from "@/lib/timeline-display";
import { layoutTimeline } from "@/lib/timeline-layout";
import { render } from "@/test/render";
import { RecycledMessageList } from "./recycled-message-list";

const T0 = new Date(2026, 9, 21, 9, 0).getTime();
const messages = (count: number): TimelineMessage[] =>
  Array.from({ length: count }, (_, n) => ({ id: `m${n}`, sender: n % 2 ? "U1" : "U2", body: `tin ${n}`, ts: T0 + n * 60_000 }));
const renderMessage = (row: Extract<TimelineRow, { type: "message" }>) => <Text>{row.message.body}</Text>;
const shownBodies = () => screen.getAllByText(/^tin \d+$/).map((node) => Number(String(node.props.children).slice(4)));
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 400)));
// Jest's ScrollView does not scroll: every offset FlashList asks the native view for lands on this shared mock, so the
// last one is where the list rests once FlashList's own initial scroll to the bottom has stopped repeating.
const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock<void, [{ y: number }]>;
const restingY = () => scrollTo.mock.calls.at(-1)?.[0].y ?? 0;
/** A row's top in the stand-in layout: 100 pt cells under the older-pages header. */
const CELL = 100;

beforeEach(() => scrollTo.mockClear());

describe("RecycledMessageList on FlashList", () => {
  it("mounts a screenful of a long history, not all of it, in reading order", async () => {
    await render(<RecycledMessageList rows={layoutTimeline(messages(500)).rows} renderMessage={renderMessage} loadingOlder={false} onAtLatestChange={jest.fn()} />);
    const shown = shownBodies();
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(60);
    expect(shown).toEqual([...shown].sort((a, b) => a - b));
    expect(shown).toContain(499);
  });

  it("opens on an unread line far above the bottom, after its first layout", async () => {
    const rows = layoutTimeline(messages(500)).rows;
    await render(
      <RecycledMessageList rows={rows} renderMessage={renderMessage} loadingOlder={false} onAtLatestChange={jest.fn()} unread={{ id: "m100", label: "400 tin chưa đọc" }} />,
    );
    await settle();
    expect(screen.getByText("400 tin chưa đọc")).toBeOnTheScreen();
    expect(shownBodies()).toContain(100);
    // The line near the top of the window (viewPosition 0.1), not the bottom FlashList scrolls to first.
    expect(restingY()).toBeGreaterThan(90 * CELL);
    expect(restingY()).toBeLessThan(110 * CELL);
  });

  it("opens on the message a link names, far above the bottom", async () => {
    const rows = layoutTimeline(messages(500)).rows;
    await render(
      <RecycledMessageList rows={rows} renderMessage={renderMessage} loadingOlder={false} onAtLatestChange={jest.fn()} jumpTo={{ id: "m50", seq: 1 }} />,
    );
    await settle();
    expect(shownBodies()).toContain(50);
    // The message in the middle of the window (viewPosition 0.5), not the bottom.
    expect(restingY()).toBeGreaterThan(40 * CELL);
    expect(restingY()).toBeLessThan(55 * CELL);
  });
});
