"use client";

import { RotateCcwClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingCatchUp } from "@uniwork/core/meetings/summary";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { meetingLocale } from "../meeting-datetime";

/** A member who joins this late (scribe spec §5.1) is offered the brief. */
const LATE_AFTER_MINUTES = 10;

/**
 * Minutes between the meeting's actual start and this viewer joining the
 * room, when they are late enough to be offered the brief; null otherwise.
 */
export function lateJoinMinutes(actualStartAt: string | undefined, joinedAt: number): number | null {
  const start = actualStartAt ? Date.parse(actualStartAt) : Number.NaN;
  if (Number.isNaN(start)) return null;
  const minutes = Math.floor((joinedAt - start) / 60_000);
  return minutes >= LATE_AFTER_MINUTES ? minutes : null;
}

/**
 * B7: "you joined N minutes in". The brief is made only on click, never on
 * mount, so opening the room costs nothing; it is the caller's alone.
 */
export function MeetingCatchUpCard({ meetingId, lateMinutes }: { meetingId: string; lateMinutes: number }) {
  const { t, i18n } = useTranslation();
  const catchUp = useMeetingCatchUp(meetingId);
  const brief = catchUp.data;
  const clock = (iso?: string) =>
    iso
      ? new Date(iso).toLocaleTimeString(meetingLocale(i18n.language), { hour: "2-digit", minute: "2-digit", hour12: false })
      : t("meetings.catchUpFromNotes");
  const failed = catchUp.isError || (catchUp.isSuccess && !brief);

  return (
    <section
      aria-label={t("meetings.catchUpTitle")}
      className="space-y-2 rounded-xl border border-brand/30 bg-brand-subtle/40 p-3"
      data-testid="meeting-catch-up-card"
    >
      {brief ? (
        <>
          <h3 className="text-label font-semibold text-foreground">{t("meetings.catchUpTitle")}</h3>
          <p className="text-body text-foreground">{brief.summary}</p>
          {brief.highlights.length > 0 ? (
            <ul className="space-y-1.5">
              {brief.highlights.map((h, i) => (
                <li key={`${h.segment_id ?? "note"}-${i}`} className="flex gap-2 text-body text-foreground">
                  <time dateTime={h.spoken_at} className="shrink-0 font-mono text-caption text-muted-foreground">
                    {clock(h.spoken_at)}
                  </time>
                  <span className="min-w-0">{h.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {brief.action_items.length > 0 ? (
            <>
              <h4 className="text-caption font-medium text-foreground">{t("meetings.catchUpActions")}</h4>
              <ul className="space-y-1.5">
                {brief.action_items.map((a, i) => (
                  <li key={`${a.segment_id ?? "note"}-${i}`} className="flex gap-2 text-body text-foreground">
                    <time dateTime={a.spoken_at} className="shrink-0 font-mono text-caption text-muted-foreground">
                      {clock(a.spoken_at)}
                    </time>
                    <span className="min-w-0">
                      {a.title}
                      {a.owner ? ` · ${a.owner}` : ""}
                      {a.due ? ` · ${a.due}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {brief.partial ? <p className="text-caption text-muted-foreground">{t("meetings.catchUpPartial")}</p> : null}
          <p className="text-caption text-muted-foreground">{t("meetings.catchUpPrivate")}</p>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-auto w-full justify-start whitespace-normal text-left"
          disabled={catchUp.isPending}
          onClick={() => catchUp.mutate(i18n.language)}
        >
          {catchUp.isPending ? <Spinner /> : <RotateCcwClock aria-hidden className="size-4 shrink-0" />}
          {catchUp.isPending ? t("meetings.catchUpWorking") : t("meetings.catchUpLate", { count: lateMinutes })}
        </Button>
      )}
      {failed ? (
        <p role="alert" className="text-label text-destructive">
          {t("meetings.catchUpFailed")}
        </p>
      ) : null}
    </section>
  );
}
