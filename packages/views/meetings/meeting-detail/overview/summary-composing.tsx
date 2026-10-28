"use client";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMeetingActionItems } from "@uniwork/core/meetings/action-items";
import { useFullTranscript } from "@uniwork/core/meetings/transcript";
import type { MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import { ScribeMark } from "@uniwork/ui/brand/scribe-mark";
import { NumberFlow } from "@uniwork/ui/components/ui/number-flow";
import { UI_EASE_OUT } from "@uniwork/ui/lib/motion";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingPersonAvatar } from "../../meeting-person";
import { meetingAvatarTint } from "../avatar-tint";
import { useDetail } from "../detail-context";
import { clock } from "../format";

const SHOWN = 5;
/** One pass of the beam over the lines, and the gap between two cited lines lighting up (clip F). */
const SWEEP_S = 2.4;
// A line is 28px tall with a 2px gap; the beam is 30px and starts above the list.
const ROW_PX = 30;

/** When the beam's edge crosses line `i` of `n` on its first pass (seconds). */
export const beamPassAt = (i: number, n: number) => (SWEEP_S * (i * ROW_PX + 14)) / (n * ROW_PX + 42);

/**
 * The lines the card reads: the latest ones Thư ký UNI cited live first (they
 * are the ones it marks), then the latest of the rest, in the order spoken.
 */
function composingLines(
  segments: readonly MeetingTranscriptSegment[],
  cited: ReadonlySet<string>,
): MeetingTranscriptSegment[] {
  const keep = new Set(segments.filter((s) => cited.has(s.id)).slice(-SHOWN).map((s) => s.id));
  for (let i = segments.length - 1; i >= 0 && keep.size < SHOWN; i--) keep.add(segments[i]!.id);
  return segments.filter((s) => keep.has(s.id));
}

/**
 * Tóm tắt while Thư ký UNI writes it (clip F): its mark at work, the transcript
 * count rolling up, and a violet beam sweeping the last lines; a line the scribe
 * cited during the meeting is marked as the beam crosses it, and every line comes
 * up to full colour as the beam first passes. Under reduced motion nothing
 * loops and every mark is drawn at once.
 */
export function SummaryComposing() {
  const { t } = useTranslation();
  const { meeting, aiReadable, memberIndex } = useDetail();
  const reduced = useReducedMotion() ?? false;
  const transcript = useFullTranscript(meeting.id, aiReadable).data;
  const items = useMeetingActionItems(meeting.id).data?.items;
  const cited = useMemo(
    () =>
      new Set(
        (items ?? [])
          .filter((item) => item.source === "LIVE")
          .flatMap((item) => item.evidence.filter((ref) => ref.kind === "segment").map((ref) => ref.id)),
      ),
    [items],
  );
  const lines = useMemo(() => composingLines(transcript ?? [], cited), [transcript, cited]);
  const total = transcript?.length ?? 0;
  // The count rolls from zero once the card is up; reduced motion shows the total straight away.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(total));
    return () => cancelAnimationFrame(id);
  }, [total]);
  // Every line comes up to full colour as the beam first crosses it (CSS delay per line); reduced motion starts there.
  const [swept, setSwept] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setSwept(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const read = reduced || swept;
  const members = memberIndex.members;

  return (
    <div
      data-testid="summary-composing"
      className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-[0_0_0_3px_color-mix(in_oklab,var(--tint-violet-solid)_7%,transparent)]"
    >
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2.5">
        <ScribeMark size={28} state="composing" className="shrink-0" />
        <span className={cn("text-body font-medium", !reduced && "ai-shimmer")} data-motion-loop={reduced ? undefined : ""}>
          {t("meetings.detail.overview.running")}
        </span>
        <span className="ml-auto inline-flex items-baseline text-caption text-muted-foreground tabular-nums">
          <span aria-hidden className="inline-flex items-baseline">
            <NumberFlow value={reduced ? total : shown} format={{ minimumIntegerDigits: String(total).length, useGrouping: false }} />
            {t("meetings.motion.summary.outOf", { count: total })}
          </span>
          <span className="sr-only">{t("meetings.detail.evidence.moreLines", { count: total })}</span>
        </span>
      </div>
      <ol aria-hidden className="relative grid gap-0.5 px-3.5 pb-3">
        {lines.map((line, i) => {
          const isCited = cited.has(line.id);
          const delay = beamPassAt(i, lines.length);
          const name = line.speaker_name || "?";
          return (
            <li
              key={line.id}
              data-read={read ? "" : undefined}
              style={{ transitionDelay: `${delay}s` }}
              className={cn(
                "grid grid-cols-[40px_22px_minmax(0,1fr)] items-center gap-2 rounded-md px-1.5 py-1 text-caption transition-[color,opacity] duration-standard ease-out-quart motion-reduce:transition-none",
                read ? "text-foreground" : "text-muted-foreground opacity-55",
              )}
            >
              <time dateTime={line.spoken_at} className="font-mono text-micro text-muted-foreground tabular-nums">
                {clock(line.spoken_at)}
              </time>
              <MeetingPersonAvatar
                name={name}
                size={20}
                tint={meetingAvatarTint(members.find((m) => m.display_name === line.speaker_name)?.user_id, members)}
              />
              <p className="truncate">
                {isCited ? (
                  <motion.span
                    data-line-text
                    data-cited
                    className="rounded-xs bg-linear-to-r from-tint-violet-solid/22 to-tint-violet-solid/22 bg-position-[0_70%] bg-no-repeat px-px"
                    initial={reduced ? false : { backgroundSize: "0% 78%" }}
                    animate={{ backgroundSize: "100% 78%" }}
                    transition={{ duration: 0.45, delay, ease: UI_EASE_OUT }}
                  >
                    {line.text}
                  </motion.span>
                ) : (
                  <span data-line-text>{line.text}</span>
                )}
              </p>
            </li>
          );
        })}
        {reduced ? null : (
          <motion.span
            data-beam
            data-motion-loop
            aria-hidden
            className="pointer-events-none absolute inset-x-0 h-7.5 border-b border-tint-violet-solid/35 bg-linear-to-b from-transparent via-tint-violet-solid/13 to-transparent"
            initial={{ top: "-30px" }}
            animate={{ top: "100%" }}
            transition={{ duration: SWEEP_S, ease: "linear", repeat: Infinity }}
          />
        )}
      </ol>
    </div>
  );
}
