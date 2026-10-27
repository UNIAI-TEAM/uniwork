"use client";

import { useState } from "react";
import { ChevronDown, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { sessionStorageAdapter } from "@uniwork/core/platform";
import { useMeetingCatchUp } from "@uniwork/core/meetings/summary";
import type { Meeting } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { meetingLocale } from "../meeting-datetime";
import { AiBadge } from "../meeting-summary/ai-badge";
import { summarySourceList, type SummarySource } from "../meeting-summary/summary-sources";

/** A member who joins this late (scribe spec §5.1) is offered the brief. */
const LATE_AFTER_MINUTES = 10;

const FIRST_JOIN_KEY = "uw.meeting.firstJoinedAt.";

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
 * How late this viewer is for the catch-up card, or null when it is not
 * theirs: guests never get one, nor does the host (who started the meeting,
 * so coming back is never coming late), nor a meeting that is not running.
 */
export function catchUpLateMinutes({
  meeting,
  joinedAt,
  viewerId,
  guest = false,
}: {
  meeting?: Pick<Meeting, "status" | "actual_start_at" | "host_user_id">;
  joinedAt: number;
  viewerId?: string;
  guest?: boolean;
}): number | null {
  if (guest || !meeting || meeting.status !== "IN_PROGRESS") return null;
  if (viewerId && meeting.host_user_id === viewerId) return null;
  return lateJoinMinutes(meeting.actual_start_at, joinedAt);
}

/**
 * When this tab first entered the meeting's room. Lateness counts from the
 * first entry, not the latest mount: someone who was there at the start and
 * comes back after a reload or a dropped connection is not late.
 */
export function firstJoinedAt(meetingId: string, now = Date.now()): number {
  const key = FIRST_JOIN_KEY + meetingId;
  try {
    const kept = Number(sessionStorageAdapter.getItem(key));
    if (kept > 0 && kept <= now) return kept;
    sessionStorageAdapter.setItem(key, String(now));
  } catch {
    // Storage blocked (a private window): this entry is the first one we know of.
  }
  return now;
}

function clock(iso: string, locale: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

/** "16:27 · ": when a point was said, in the viewer's clock; a point from the notes has none. */
function SaidAt({ iso, locale }: { iso?: string; locale: string }) {
  const text = iso ? clock(iso, locale) : "";
  if (!iso || !text) return null;
  return (
    <>
      <time dateTime={iso} className="text-muted-foreground tabular-nums">
        {text}
      </time>
      <span aria-hidden className="text-muted-foreground">
        {" · "}
      </span>
    </>
  );
}

/** AI output says it is AI, what it read and when (PRODUCT.md, Agent Principles). */
function CatchUpAttribution({ time, sources }: { time: string; sources: string | null }) {
  const { t } = useTranslation();
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground" data-testid="meeting-summary-attribution">
      <AiBadge />
      <span className="min-w-0">
        {sources ? t("meetings.summaryAttributionFrom", { time, sources }) : t("meetings.summaryAttribution", { time })}
      </span>
    </p>
  );
}

/**
 * B7: "you joined N minutes in". The brief is made only on click, never on
 * mount, so opening the room costs nothing; it is the caller's alone. Once
 * made it folds away, and the viewer can dismiss the card for the meeting.
 */
export function MeetingCatchUpCard({
  meetingId,
  lateMinutes,
  onDismiss,
}: {
  meetingId: string;
  lateMinutes: number;
  onDismiss?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = meetingLocale(i18n.language);
  const catchUp = useMeetingCatchUp(meetingId);
  const [open, setOpen] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const brief = catchUp.data;
  const failed = catchUp.isError || (catchUp.isSuccess && !brief);
  if (dismissed) return null;

  const points = brief ? [...brief.highlights, ...brief.action_items] : [];
  const sources: SummarySource[] = [
    ...(points.some((p) => p.spoken_at) ? (["transcript"] as const) : []),
    ...(points.some((p) => !p.spoken_at) ? (["notes"] as const) : []),
  ];
  const generatedAt = brief?.generated_at ? clock(brief.generated_at, locale) : "";
  const icon = <Sparkles aria-hidden className="size-4 shrink-0 text-muted-foreground" />;

  return (
    <section
      aria-label={t("meetings.catchUpTitle")}
      className="space-y-2 rounded-xl border border-border bg-surface p-3"
      data-testid="meeting-catch-up-card"
    >
      <div className="flex items-center gap-1">
        <h3 className="min-w-0 flex-1 text-label font-semibold text-foreground">
          {brief ? (
            // A disclosure in the heading: the brief folds away and stays one click from coming back.
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 rounded-md text-left pointer-coarse:min-h-11"
            >
              {icon}
              <span className="min-w-0 flex-1">{t("meetings.catchUpTitle")}</span>
              <ChevronDown
                aria-hidden
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform duration-fast motion-reduce:transition-none",
                  !open && "-rotate-90",
                )}
              />
            </button>
          ) : (
            <span className="flex items-center gap-1.5">
              {icon}
              {t("meetings.catchUpTitle")}
            </span>
          )}
        </h3>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="shrink-0"
          aria-label={t("meetings.catchUpDismiss")}
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
          }}
        >
          <X aria-hidden />
        </Button>
      </div>

      {brief && open ? (
        <>
          {generatedAt ? (
            <CatchUpAttribution time={generatedAt} sources={summarySourceList(sources, t, locale)} />
          ) : null}
          <p className="text-body text-foreground">{brief.summary}</p>
          {brief.highlights.length > 0 ? (
            <ul className="space-y-1.5">
              {brief.highlights.map((h, i) => (
                <li key={`${h.segment_id ?? "note"}-${i}`} className="text-body text-foreground">
                  <SaidAt iso={h.spoken_at} locale={locale} />
                  {h.text}
                </li>
              ))}
            </ul>
          ) : null}
          {brief.action_items.length > 0 ? (
            <>
              <h4 className="text-caption font-medium text-foreground">{t("meetings.catchUpActions")}</h4>
              <ul className="space-y-1.5">
                {brief.action_items.map((a, i) => (
                  <li key={`${a.segment_id ?? "note"}-${i}`} className="text-body text-foreground">
                    <SaidAt iso={a.spoken_at} locale={locale} />
                    {a.title}
                    {a.owner ? ` · ${a.owner}` : ""}
                    {a.due ? ` · ${a.due}` : ""}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {brief.partial ? <p className="text-caption text-muted-foreground">{t("meetings.catchUpPartial")}</p> : null}
          <p className="text-caption text-muted-foreground">{t("meetings.catchUpPrivate")}</p>
        </>
      ) : null}

      {brief ? null : (
        <>
          <p className="text-label text-muted-foreground">{t("meetings.catchUpLate", { count: lateMinutes })}</p>
          <Button
            type="button"
            variant="outline"
            aria-disabled={catchUp.isPending}
            onClick={() => catchUp.mutate(i18n.language)}
          >
            {catchUp.isPending ? <Spinner /> : <Sparkles aria-hidden />}
            {catchUp.isPending ? t("meetings.catchUpWorking") : failed ? t("common.retry") : t("meetings.catchUpView")}
          </Button>
        </>
      )}
      {failed ? (
        <p role="alert" className="text-label text-destructive">
          {t("meetings.catchUpFailed")}
        </p>
      ) : null}
    </section>
  );
}
