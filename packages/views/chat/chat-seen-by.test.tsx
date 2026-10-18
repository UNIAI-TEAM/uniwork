import { renderHook, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatRoomMemberRecord } from "@uniwork/core/api/endpoints/chat";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatMessageHoverActions } from "./chat-message-hover-actions";
import type { ChatMessage } from "./chat-messages";
import { ChatSeenByProvider, useChatSeenBy } from "./chat-seen-by";

beforeAll(() => {
  initI18n();
});

const SENT = Date.parse("2026-10-18T09:00:00Z");

const member = (user_id: string, display_name: string, last_read_at?: string): ChatRoomMemberRecord => ({
  user_id,
  display_name,
  email: `${user_id}@x.vn`,
  role: "member",
  send_restricted: false,
  is_creator: false,
  last_read_at,
});

const members = [
  member("me", "Tôi", "2026-10-18T10:00:00Z"),
  member("ha", "Thu Hà", "2026-10-18T09:00:00Z"),
  member("lan", "Hoàng Lan", "2026-10-18T09:30:00.5Z"),
  member("minh", "Võ Minh", "2026-10-18T08:59:59Z"),
  member("khoa", "Khoa"),
];
const nameContext = [{ user_id: "lan", display_name: "Lan (biệt danh)" }];

const message = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m1",
  sender: "me",
  body: "Chốt kịch bản nhé",
  ts: SENT,
  reactions: {},
  ...over,
});

function renderMenu(row: ChatMessage, isOwn: boolean, withSeenBy = true) {
  const bar = <ChatMessageHoverActions message={row} isOwn={isOwn} onReply={vi.fn()} onReact={vi.fn()} />;
  return render(wrap(<ChatSeenByProvider value={withSeenBy ? { members, nameContext } : null}>{bar}</ChatSeenByProvider>));
}

async function openMore() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Thêm" }));
  await screen.findByRole("menu");
  return user;
}

describe("seen-by in the ⋯ menu", () => {
  it("counts the others who read my message, and lists them by name", async () => {
    renderMenu(message(), true);
    const user = await openMore();
    const row = screen.getByRole("menuitem", { name: "2 người đã xem" });
    await user.click(row);
    expect(await screen.findByRole("menuitem", { name: /Thu Hà/ })).toBeInTheDocument();
    // A nickname from the room's name context wins over the roster's name.
    expect(screen.getByRole("menuitem", { name: /Lan \(biệt danh\)/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Võ Minh/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Khoa/ })).not.toBeInTheDocument();
  });

  it("is absent where seen-by is off (a DM, the default channel), on others' messages and in threads", async () => {
    for (const [row, isOwn, withSeenBy] of [
      [message(), true, false],
      [message({ sender: "ha" }), false, true],
      [message({ threadRootId: "root" }), true, true],
    ] as const) {
      const { unmount } = renderMenu(row, isOwn, withSeenBy);
      await openMore();
      expect(screen.queryByRole("menuitem", { name: /người đã xem/ })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("is absent while nobody has read it yet", async () => {
    renderMenu(message({ ts: Date.parse("2026-10-18T11:00:00Z") }), true);
    await openMore();
    expect(screen.queryByRole("menuitem", { name: /người đã xem/ })).not.toBeInTheDocument();
  });
});

describe("useChatSeenBy", () => {
  const run = (room: Parameters<typeof useChatSeenBy>[0]) =>
    renderHook(() => useChatSeenBy(room, members, nameContext, "me")).result.current;

  it("is on in a group and a channel, with the furthest pointer among the others", () => {
    for (const room of [{ kind: "group" as const }, { kind: "channel" as const, is_default: false }]) {
      const seenBy = run(room);
      expect(seenBy.value?.members).toBe(members);
      expect(seenBy.lastReadAt).toBe("2026-10-18T09:30:00.5Z");
    }
  });

  it("is off in a DM, the workspace room and the default channel", () => {
    for (const room of [
      { kind: "dm" as const },
      { kind: "workspace" as const },
      { kind: "channel" as const, is_default: true },
      undefined,
    ]) {
      expect(run(room)).toEqual({ value: null, lastReadAt: null });
    }
  });
});
