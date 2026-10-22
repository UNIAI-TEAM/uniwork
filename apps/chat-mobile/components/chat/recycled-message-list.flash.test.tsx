// The recycled message list on the real FlashList 2 (laid out in Jest by
// test/jest-setup.ts: a 400 × 900 window, 100 pt cells): a long history mounts
// about a screenful of recycled cells, not all of it, oldest first above the
// newest. Its own logic is recycled-message-list.test.tsx's.
import { screen } from "@testing-library/react-native";
import { Text } from "react-native";
import type { TimelineMessage, TimelineRow } from "@/lib/timeline-display";
import { layoutTimeline } from "@/lib/timeline-layout";
import { render } from "@/test/render";
import { RecycledMessageList } from "./recycled-message-list";

const T0 = new Date(2026, 9, 21, 9, 0).getTime();
const messages = (count: number): TimelineMessage[] =>
  Array.from({ length: count }, (_, n) => ({ id: `m${n}`, sender: n % 2 ? "U1" : "U2", body: `tin ${n}`, ts: T0 + n * 60_000 }));
const renderMessage = (row: Extract<TimelineRow, { type: "message" }>) => <Text>{row.message.body}</Text>;

describe("RecycledMessageList on FlashList", () => {
  it("mounts a screenful of a long history, not all of it, in reading order", async () => {
    await render(<RecycledMessageList rows={layoutTimeline(messages(500)).rows} renderMessage={renderMessage} loadingOlder={false} onAtLatestChange={jest.fn()} />);
    const shown = screen.getAllByText(/^tin \d+$/).map((node) => Number(String(node.props.children).slice(4)));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(60);
    expect(shown).toEqual([...shown].sort((a, b) => a - b));
  });
});
