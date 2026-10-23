"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { pendingBallot, useMeetingMotions } from "@uniwork/core/meetings/motions";
import type { MeetingMotion } from "@uniwork/core/types/meeting";

/** How long "Vote recorded" stays on the stage before the card goes away. */
const RECORDED_VISIBLE_MS = 4000;

/**
 * Drives the stage's vote prompt: the open item this person is on the roll
 * for and has not voted on yet, unless they hid it. After a ballot the card
 * shows its confirmation for a few seconds, then leaves for good (the item is
 * remembered as handled even if the refetch is slow).
 *
 * It also announces results to everyone in the room: an item this hook saw
 * OPEN that comes back CLOSED raises one toast. Items that were already
 * closed when the room loaded stay quiet.
 */
export function useMeetingVotePrompt(meetingId: string): {
  motion: MeetingMotion | null;
  recorded: boolean;
  dismiss: () => void;
  markRecorded: () => void;
} {
  const { t } = useTranslation();
  const { data: motions } = useMeetingMotions(meetingId, Boolean(meetingId));
  const [handled, setHandled] = useState<readonly string[]>([]);
  const [recordedMotion, setRecordedMotion] = useState<MeetingMotion | null>(null);

  const pending = pendingBallot(motions);
  const visible = pending && !handled.includes(pending.id) ? pending : null;
  const visibleId = visible?.id;

  // The ballot reports success after the render that showed the card; keep
  // what was on screen so the confirmation names the right item.
  const shownRef = useRef<MeetingMotion | null>(null);
  useEffect(() => {
    if (visible) shownRef.current = visible;
  }, [visible]);

  const dismiss = useCallback(() => {
    setRecordedMotion(null);
    if (visibleId) setHandled((ids) => (ids.includes(visibleId) ? ids : [...ids, visibleId]));
  }, [visibleId]);

  const markRecorded = useCallback(() => {
    const shown = shownRef.current;
    if (!shown) return;
    setHandled((ids) => (ids.includes(shown.id) ? ids : [...ids, shown.id]));
    setRecordedMotion(shown);
  }, []);

  useEffect(() => {
    if (!recordedMotion) return;
    const id = setTimeout(() => setRecordedMotion(null), RECORDED_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [recordedMotion]);

  const statusesRef = useRef<ReadonlyMap<string, string> | null>(null);
  useEffect(() => {
    if (!motions) return;
    const before = statusesRef.current;
    statusesRef.current = new Map(motions.map((m) => [m.id, m.status]));
    if (!before) return;
    for (const m of motions) {
      if (before.get(m.id) !== "OPEN" || m.status !== "CLOSED" || !m.result) continue;
      toast.info(
        t("meetings.governance.motionResultToast", {
          title: m.title,
          outcome: t(`meetings.governance.outcome_${m.result.outcome}`),
        }),
      );
    }
  }, [motions, t]);

  if (recordedMotion) return { motion: recordedMotion, recorded: true, dismiss, markRecorded };
  return { motion: visible, recorded: false, dismiss, markRecorded };
}
