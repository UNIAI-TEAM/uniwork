// Messages arriving at the bottom of an open conversation. arrivedSince and
// countNewSince are copied from packages/views/chat/native-chat-live-region.tsx
// and native-chat-message-timeline.ts (same cases in arrivals.test.ts): only
// what someone else sent below the old bottom is new — never history loading
// above, a room's first page, my own sends, or a window a jump replaced.
// createArrivalAnnouncer is the phone's addition: a screen reader
// hears the first arrival at once, then at most one line per quiet window, so a
// busy group reads "5 new messages" instead of five interruptions.
import type { TimelineMessage } from "./timeline-display";

export interface BottomMark {
  roomId: string;
  lastId: string | null;
}

/** Others' messages below the bottom the conversation had last time; empty when nothing new arrived. */
export function arrivedSince(
  messages: readonly TimelineMessage[],
  previous: BottomMark | null,
  roomId: string,
  currentUserId: string,
): TimelineMessage[] {
  const lastId = messages.at(-1)?.id ?? null;
  if (!previous || previous.roomId !== roomId || !previous.lastId || !lastId || previous.lastId === lastId) return [];
  const previousIndex = messages.findIndex((message) => message.id === previous.lastId);
  if (previousIndex < 0) return [];
  return messages.slice(previousIndex + 1).filter((message) => message.sender !== currentUserId && !message.pending);
}

/** How many messages from others came after `sinceId` (the newest one when the reader scrolled away). */
export function countNewSince(messages: readonly TimelineMessage[], sinceId: string | null, currentUserId: string): number {
  const since = sinceId ? messages.findIndex((message) => message.id === sinceId) : -1;
  if (since < 0) return 0;
  return messages.slice(since + 1).filter((message) => message.sender !== currentUserId).length;
}

export interface Arrival {
  sender: string;
  preview: string;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Bình: Mai họp nhé" for one message, "3 tin nhắn mới" for several; null for none. */
export function arrivalAnnouncement(arrivals: readonly Arrival[], t: Translate): string | null {
  const [first] = arrivals;
  if (!first) return null;
  if (arrivals.length === 1) return t("chat.message_list.live_new_message", { sender: first.sender, preview: first.preview });
  return t("mobile.a11y.new_messages", { count: arrivals.length });
}

export interface ArrivalAnnouncer {
  push(arrivals: readonly Arrival[]): void;
  dispose(): void;
}

/** Speaks arrivals at most once per `quietMs`: the first at once, a burst after it gathered into one line. */
export function createArrivalAnnouncer({ quietMs, speak }: { quietMs: number; speak: (arrivals: Arrival[]) => void }): ArrivalAnnouncer {
  let waiting: Arrival[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    timer = setTimeout(() => {
      timer = null;
      if (waiting.length === 0) return;
      const batch = waiting;
      waiting = [];
      speak(batch);
      open();
    }, quietMs);
  };

  return {
    push(arrivals) {
      if (arrivals.length === 0) return;
      if (timer) {
        waiting.push(...arrivals);
        return;
      }
      speak([...arrivals]);
      open();
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      waiting = [];
    },
  };
}
