// The pinned-messages bar (pinned-bar.tsx): hidden with nothing pinned; the
// newest pin first, its place among them read out; a tap jumps to it and moves
// on to the next older one, wrapping round; a new set of pins starts over.
import { ChatMessageSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { fireEvent, screen } from "@testing-library/react-native";
import type { TimelineMessage } from "@/lib/timeline-display";
import { render, viText } from "@/test/render";
import { PinnedBar } from "./pinned-bar";

function msg(id: string, body: string, pinnedAt?: string): TimelineMessage {
  const record = ChatMessageSchema.parse({
    id,
    room_id: "r1",
    workspace_id: "w1",
    sender_id: "u2",
    sender_display_name: "Bình",
    body,
    created_at: "2026-10-22T02:00:00Z",
    pinned: pinnedAt !== undefined,
    pinned_at: pinnedAt,
  });
  return { id, sender: "u2", body, ts: 0, record };
}

const label = (index: number, total: number, preview: string) => `${viText("chat.mobile.pinned_bar", { index, total })}. ${preview}`;

describe("PinnedBar", () => {
  it("is not there when nothing is pinned", async () => {
    await render(<PinnedBar messages={[msg("a", "hi"), { id: "local", sender: "u1", body: "sending", ts: 0 }]} onJump={jest.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the newest pin first, jumps on a tap and walks to the older ones, wrapping round", async () => {
    const onJump = jest.fn();
    const messages = [msg("old", "Older pin", "2026-10-20T00:00:00Z"), msg("new", "Newer pin", "2026-10-21T00:00:00Z"), msg("x", "not pinned")];
    await render(<PinnedBar messages={messages} onJump={onJump} />);
    await fireEvent.press(screen.getByRole("button", { name: label(1, 2, "Newer pin") }));
    expect(onJump).toHaveBeenLastCalledWith("new");
    await fireEvent.press(screen.getByRole("button", { name: label(2, 2, "Older pin") }));
    expect(onJump).toHaveBeenLastCalledWith("old");
    expect(screen.getByRole("button", { name: label(1, 2, "Newer pin") })).toBeOnTheScreen();
  });

  it("starts over at the newest when the pins change", async () => {
    const onJump = jest.fn();
    const first = [msg("a", "A", "2026-10-20T00:00:00Z"), msg("b", "B", "2026-10-21T00:00:00Z")];
    const { rerender } = await render(<PinnedBar messages={first} onJump={onJump} />);
    await fireEvent.press(screen.getByRole("button", { name: label(1, 2, "B") }));
    await rerender(<PinnedBar messages={[...first, msg("c", "C", "2026-10-22T00:00:00Z")]} onJump={onJump} />);
    expect(screen.getByRole("button", { name: label(1, 3, "C") })).toBeOnTheScreen();
  });
});
