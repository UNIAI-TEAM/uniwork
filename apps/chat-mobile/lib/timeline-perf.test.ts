// What a change to a long conversation costs on the JS thread (audit P2 Perf:
// a reader scrolled back 40 pages holds 2,000 messages, and every frame,
// receipt or reaction rebuilds the rows). Two guards: a count of the readers'
// calls, deterministic, that keeps an update to O(rows changed) work; and a
// coarse time budget for the whole rebuild, generous enough for a loaded CI
// runner, that catches a rebuild turned quadratic.
import { ChatMessageSchema } from "@uniwork/core/api/endpoints/chat-schemas";
import { describe, expect, it } from "vitest";
import { albumsOf } from "./album";
import { continuedRunKeys } from "./conversation-display";
import { buildMessageRowModels, type MessageRowModel, type MessageRowModelInput } from "./message-row-model";
import { buildTimelineRows, toTimelineMessage, type TimelineMessage } from "./timeline-display";

const T0 = new Date(2026, 9, 1, 8, 0).getTime();
const id = (n: number) => `m${String(n).padStart(5, "0")}`;

/** `count` messages from four people, 90 s apart (runs and day changes), every tenth one quoting a message above. */
function conversation(count: number, from = 0): TimelineMessage[] {
  return Array.from({ length: count }, (_, i) => {
    const n = from + i;
    return toTimelineMessage(
      ChatMessageSchema.parse({
        id: id(n),
        room_id: "r1",
        workspace_id: "w1",
        sender_id: `u${n % 4}`,
        sender_display_name: `Người ${n % 4}`,
        kind: "text",
        body: `tin ${n}`,
        created_at: new Date(T0 + n * 90_000).toISOString(),
        ...(n % 10 === 9 ? { reply_to_message_id: id(n - 3) } : {}),
      }),
    );
  });
}

interface Counted {
  readers: Pick<MessageRowModelInput, "senderName" | "quoteText" | "receiptOf">;
  calls: { senderName: number; quoteText: number };
}

function countedReaders(): Counted {
  const calls = { senderName: 0, quoteText: 0 };
  return {
    calls,
    readers: {
      senderName: (message) => {
        calls.senderName += 1;
        return message.sender.toUpperCase();
      },
      quoteText: (message) => {
        calls.quoteText += 1;
        return message.body;
      },
      receiptOf: (_message, own) => (own ? "sent" : null),
    },
  };
}

/** The conversation screen's rebuild (components/chat/conversation.tsx) over `messages`. */
function rebuild(messages: TimelineMessage[], readers: Counted["readers"], previous?: ReadonlyMap<string, MessageRowModel>) {
  const rows = buildTimelineRows(messages);
  const models = buildMessageRowModels(
    {
      rows,
      messages,
      userId: "u0",
      isGroup: true,
      continued: continuedRunKeys(rows),
      albums: albumsOf(messages),
      unknownQuoteSender: "Trả lời",
      highlightedId: null,
      taskIdsByMessage: new Map(),
      ...readers,
    },
    previous,
  );
  return { rows, models };
}

describe("a 2,000-message conversation", () => {
  const loaded = conversation(2000);

  it("reads a name and a quote only for the rows a new message changes, not for every loaded row", () => {
    const { readers, calls } = countedReaders();
    const first = rebuild(loaded, readers).models;
    expect(calls.senderName).toBeGreaterThanOrEqual(2000);

    calls.senderName = 0;
    calls.quoteText = 0;
    const next = rebuild([...loaded, ...conversation(1, 2000)], readers, first).models;
    // The new row, and the row whose run it may continue.
    expect(calls.senderName).toBeLessThanOrEqual(2);
    expect(calls.quoteText).toBe(0);
    expect(next.get(id(1000))).toBe(first.get(id(1000)));
  });

  it("reads every row again when what names a sender changed (a nickname, the room's people)", () => {
    const first = countedReaders();
    const before = rebuild(loaded, first.readers).models;
    const renamed = countedReaders();
    rebuild(loaded, renamed.readers, before);
    expect(renamed.calls.senderName).toBeGreaterThanOrEqual(2000);
  });

  it("rebuilds in well under a frame of a fast machine's budget (a coarse guard against quadratic work)", () => {
    const { readers } = countedReaders();
    let previous = rebuild(loaded, readers).models;
    const times: number[] = [];
    for (let n = 0; n < 15; n += 1) {
      const started = performance.now();
      previous = rebuild([...loaded, ...conversation(1, 2000 + n)], readers, previous).models;
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    // Measured about 1 ms on a 2023 laptop; Hermes on a low-end phone is one to two orders slower.
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(25);
  });
});
