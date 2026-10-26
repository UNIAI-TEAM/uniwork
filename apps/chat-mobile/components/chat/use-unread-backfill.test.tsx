// A busy room opened with more unread messages than its newest page holds
// (use-unread-backfill.ts): older pages load, a few at most, until the reader's
// pointer is on screen and the unread line can be drawn, then stop; nothing is
// asked while a fetch runs, past the bound, or when the history ends.
import { act } from "@testing-library/react-native";
import { useState } from "react";
import { firstUnreadMessageId, UNREAD_BACKFILL_PAGES } from "@/lib/unread-divider";
import type { TimelineMessage } from "@/lib/timeline-display";
import { render } from "@/test/render";
import { useUnreadBackfill } from "./use-unread-backfill";

const T = Date.UTC(2026, 9, 22, 2, 0);
const PAGE = 50;
const since = new Date(T).toISOString();
/** A room of `read` read messages then `unread` new ones from someone else, oldest first, one a second. */
const room = (read: number, unread: number): TimelineMessage[] =>
  Array.from({ length: read + unread }, (_, n) => ({ id: `m${n}`, sender: "u2", body: "", ts: T + (n - read + 1) * 1000 }));

let line: string | null = null;
let fetches = 0;

/** The room screen's paging: the newest page first, one older page per loadOlder, after a fetch settles. */
function Room({ all, busy = false, since: pointer = since }: { all: TimelineMessage[]; busy?: boolean; since?: string | null }) {
  const [pages, setPages] = useState(1);
  const messages = all.slice(Math.max(0, all.length - pages * PAGE));
  const complete = messages.length === all.length;
  line = firstUnreadMessageId(messages, "me", pointer, complete);
  useUnreadBackfill({
    messages,
    userId: "me",
    since: pointer,
    complete,
    canLoadOlder: !busy && !complete,
    loadOlder: () => {
      fetches += 1;
      setPages((n) => n + 1);
    },
  });
  return null;
}

beforeEach(() => {
  line = null;
  fetches = 0;
});

describe("useUnreadBackfill", () => {
  it("loads older pages until 120 unread messages have their line, then stops", async () => {
    await render(<Room all={room(500, 120)} />);
    await act(async () => undefined);
    expect(line).toBe("m500");
    // 50 newest, then 100, then 150: the third page holds the pointer.
    expect(fetches).toBe(2);
  });

  it("gives up after a few pages: a room far behind opens at the newest message with no line", async () => {
    await render(<Room all={room(10, 1000)} />);
    await act(async () => undefined);
    expect(fetches).toBe(UNREAD_BACKFILL_PAGES);
    expect(line).toBeNull();
  });

  it("asks nothing while a fetch runs, when the pointer is already loaded, or with no pointer", async () => {
    await render(<Room all={room(500, 120)} busy />);
    await render(<Room all={room(500, 10)} />);
    await render(<Room all={room(500, 120)} since={null} />);
    await act(async () => undefined);
    expect(fetches).toBe(0);
  });

  it("stops where the history ends", async () => {
    await render(<Room all={room(0, 120)} />);
    await act(async () => undefined);
    expect(fetches).toBe(2);
    expect(line).toBe("m0");
  });
});
