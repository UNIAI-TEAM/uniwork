// New messages read out to VoiceOver and TalkBack (audit U2): what someone
// else sent below the bottom of the open conversation (lib/arrivals.ts),
// "Bình: Mai họp nhé" for one, "3 tin nhắn mới" for a burst, at most one line
// per ARRIVAL_QUIET_MS so a busy group does not talk over the person. Nothing
// runs while no screen reader is on.
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo } from "react-native";
import { useScreenReaderEnabled } from "@/components/ui/a11y";
import { arrivalAnnouncement, arrivedSince, createArrivalAnnouncer, type Arrival, type BottomMark } from "@/lib/arrivals";
import type { TimelineMessage } from "@/lib/timeline-display";

export const ARRIVAL_QUIET_MS = 4_000;

export function useArrivalAnnouncements(roomId: string, messages: readonly TimelineMessage[], userId: string, describe: (message: TimelineMessage) => Arrival): void {
  const { t } = useTranslation();
  const enabled = useScreenReaderEnabled();
  const mark = useRef<BottomMark | null>(null);
  const latest = useRef({ t, describe });
  latest.current = { t, describe };
  const announcer = useMemo(
    () =>
      createArrivalAnnouncer({
        quietMs: ARRIVAL_QUIET_MS,
        speak: (arrivals) => {
          const line = arrivalAnnouncement(arrivals, latest.current.t);
          if (line) AccessibilityInfo.announceForAccessibility(line);
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
}
