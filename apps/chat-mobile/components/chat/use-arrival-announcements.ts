// New messages read out to VoiceOver and TalkBack: what someone
// else sent below the bottom of the open conversation (lib/arrivals.ts),
// "Bình: Mai họp nhé" for one, "3 tin nhắn mới" for a burst, at most one line
// per ARRIVAL_QUIET_MS so a busy group does not talk over the person. Nothing
// runs while no screen reader is on.
//
// iOS queues the line behind whatever VoiceOver is saying
// (announceForAccessibilityWithOptions › queue), so it neither cuts the
// person's own navigation off nor is cut off by it. Android gets the line back
// for a polite live region (components/ui/live-region.tsx): TalkBack reads it
// when the reader is idle, and Android 16 deprecates the announcement API this
// used to call.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, Platform } from "react-native";
import { useScreenReaderEnabled } from "@/components/ui/a11y";
import { arrivalAnnouncement, arrivedSince, createArrivalAnnouncer, type Arrival, type BottomMark } from "@/lib/arrivals";
import type { TimelineMessage } from "@/lib/timeline-display";

export const ARRIVAL_QUIET_MS = 4_000;

/** A line the same as the last one must still change the region's text, or TalkBack stays silent. */
const REPEAT_MARK = "​";

/** Returns the latest line for Android's live region (null until one was said); iOS hears it queued. */
export function useArrivalAnnouncements(
  roomId: string,
  messages: readonly TimelineMessage[],
  userId: string,
  describe: (message: TimelineMessage) => Arrival,
): string | null {
  const { t } = useTranslation();
  const enabled = useScreenReaderEnabled();
  const mark = useRef<BottomMark | null>(null);
  const latest = useRef({ t, describe });
  latest.current = { t, describe };
  const [line, setLine] = useState<string | null>(null);
  const announcer = useMemo(
    () =>
      createArrivalAnnouncer({
        quietMs: ARRIVAL_QUIET_MS,
        speak: (arrivals) => {
          const said = arrivalAnnouncement(arrivals, latest.current.t);
          if (said && Platform.OS === "ios") AccessibilityInfo.announceForAccessibilityWithOptions(said, { queue: true });
          else if (said) setLine((previous) => (previous === said ? `${said}${REPEAT_MARK}` : said));
        },
      }),
    [],
  );
  useEffect(() => () => announcer.dispose(), [announcer]);

  useEffect(() => {
    const previous = mark.current;
    mark.current = { roomId, lastId: messages.at(-1)?.id ?? null };
    if (!enabled) return;
    announcer.push(arrivedSince(messages, previous, roomId, userId).map((message) => latest.current.describe(message)));
  }, [announcer, enabled, messages, roomId, userId]);

  return line;
}
