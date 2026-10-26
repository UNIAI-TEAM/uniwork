"use client";
import { ChevronRight, RotateCcwClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingCarriedOverItems } from "@uniwork/core/meetings/action-items";
import type { MeetingFeedKind } from "@uniwork/core/meetings/feed";
import { ScribeMark } from "@uniwork/ui/brand/scribe-mark";
import type { ScribeChipState } from "../meeting-scribe-chip";
import { FeedKindMark } from "./feed-filter-chips";

// The sample rows hint at what will appear; each bar is a different length so they read as text.
const SAMPLES: readonly { kind: MeetingFeedKind; label: string; bar: string }[] = [
  { kind: "decision", label: "meetings.panel.empty.decided", bar: "flex-1" },
  { kind: "task", label: "meetings.panel.empty.todo", bar: "w-[70%]" },
  { kind: "question", label: "meetings.panel.empty.asked", bar: "w-[55%]" },
];

/**
 * The UNI tab before the meeting has produced anything: the scribe's mark in its
 * halo, what will show up here, and the open items earlier meetings left, if any.
 */
export function UniEmptyState({
  meetingId,
  scribeState,
  onOpenCarried,
}: {
  meetingId: string;
  scribeState: ScribeChipState;
  onOpenCarried: () => void;
}) {
  const { t } = useTranslation();
  const total = useMeetingCarriedOverItems(meetingId).data?.total ?? 0;
  const off = scribeState === "off";
  const carried = t("meetings.panel.empty.carried", { count: total });
  const carriedFrom = t("meetings.panel.empty.carriedFrom");

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="flex size-28 items-center justify-center rounded-full bg-tint-violet/40">
          <div className="flex size-21 items-center justify-center rounded-full bg-tint-violet">
            <ScribeMark size={52} state={off ? "off" : "idle"} />
          </div>
        </div>
        <h2 className="mb-1.5 mt-4.5 font-display text-title-sm font-bold text-foreground">
          {off ? t("meetings.transcriptEmpty") : t("meetings.panel.empty.title")}
        </h2>
        <p className="max-w-70 text-label text-muted-foreground">{t("meetings.panel.empty.line")}</p>
        <ul aria-hidden className="mt-6 flex w-66 flex-col gap-2.5">
          {SAMPLES.map(({ kind, label, bar }) => (
            <li key={kind} className="flex items-center gap-2.5">
              <FeedKindMark kind={kind} size="sample" />
              <span className={`h-2 rounded-sm bg-surface-hover ${bar}`} />
              <span className="ml-auto w-8.5 shrink-0 text-right text-micro font-medium text-faint-foreground">{t(label)}</span>
            </li>
          ))}
        </ul>
      </div>
      {total > 0 ? (
        <button
          type="button"
          aria-label={`${carried}, ${carriedFrom}`}
          className="mb-3 flex w-full items-center gap-2.5 rounded-[14px] border border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
          onClick={onOpenCarried}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-surface-hover text-muted-foreground">
            <RotateCcwClock aria-hidden className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-label font-semibold text-foreground">{carried}</span>
            <span className="block text-caption text-muted-foreground">{carriedFrom}</span>
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-faint-foreground" />
        </button>
      ) : null}
    </div>
  );
}
