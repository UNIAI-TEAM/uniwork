"use client";
import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Info, RotateCcw, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api/http";
import { useMeetingMinutes } from "@uniwork/core/meetings/minutes";
import { useMeetingSummaryRun } from "@uniwork/core/meetings/summary";
import { useFullTranscript } from "@uniwork/core/meetings/transcript";
import { ScribeMark, type ScribeMarkState } from "@uniwork/ui/brand/scribe-mark";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { meetingLocale, splitIsoLocal } from "../../meeting-datetime";
import { MeetingSectionError, MeetingTextSkeleton } from "../../meeting-section-state";
import { summaryErrorRetryable } from "../../meeting-summary/summary-error-copy";
import { SummaryLiveRegion, SummaryRegenerateConfirm } from "../../meeting-summary/summary-generate-controls";
import { summarySourceFacts, type SummarySourceTimes } from "../../meeting-summary/summary-sources";
import { useSummaryGeneration } from "../../meeting-summary/use-summary-generation";
import { useDetail } from "../detail-context";
import { clock } from "../format";
import { kitButton } from "../ui/kit-buttons";
import { Byline, Section } from "../ui/section";
import { TextButton } from "../ui/text-button";
import { TEXT_BUTTON_HIT } from "./overview-recap";
import { sourceCounts, sourceWords } from "./summary-words";
import { ScribeSign } from "../../scribe-sign";

/** A text button inside a line of text: no 44px line on a coarse pointer, the hit area grown around it instead (kit `.board .text-btn::before`). */
const INLINE_TEXT_BUTTON = "relative ml-1 py-0 align-baseline before:absolute before:-inset-x-2 before:-inset-y-3.5 pointer-coarse:min-h-0";

/** What the Tóm tắt section shows; "off" = the scribe was off and nothing was summarised (no section). */
type SummaryState = "loading" | "error" | "ready" | "running" | "failed" | "none" | "off";

/**
 * Everything the overview reads about its summary, once: the shared generate
 * flow, the server's run, the full transcript (the byline counts its lines)
 * and whether the minutes are final (the prose turns from muted to foreground).
 */
export function useOverviewSummary() {
  const { workspaceId, meeting, isClerk, aiReadable, sections } = useDetail();
  const gen = useSummaryGeneration({ workspaceId, meetingId: meeting.id, canClerk: isClerk });
  const run = useMeetingSummaryRun(meeting.id).data;
  const transcript = useFullTranscript(meeting.id, aiReadable);
  const finalized = useMeetingMinutes(meeting.id, sections.minutes).data?.finalized === true;
  const times = useMemo<SummarySourceTimes>(
    () => ({
      transcript: (transcript.data ?? []).map((s) => s.spoken_at),
      notes: (gen.notesQuery.data ?? []).map((n) => n.created_at),
      chat: (gen.chatQuery.data ?? []).map((c) => c.sent_at),
      votes: gen.voted.map((m) => m.closed_at),
    }),
    [transcript.data, gen.notesQuery.data, gen.chatQuery.data, gen.voted],
  );
  const { summary, summaryQuery } = gen;
  const failure = gen.failure ?? (run?.failure ? { text: "", retryable: summaryErrorRetryable(new ApiError("", run.failure.code, 0)) } : null);
  const state: SummaryState = summary
    ? "ready"
    : summaryQuery.isPending
      ? "loading"
      : summaryQuery.isError
        ? "error"
        : meeting.scribe_enabled === false
          ? "off"
          : gen.generating
            ? "running"
            : failure
              ? "failed"
              : "none";
  return { gen, state, failure, attempts: run?.attempts ?? 0, finalized, times, transcriptReady: !transcript.isPending };
}

export type OverviewSummaryModel = ReturnType<typeof useOverviewSummary>;

/** "[mark] Soạn 09:31 22/10 theo yêu cầu của Lan Phạm · từ 119 câu thoại và 2 ghi chú · Soạn lại": the mark names Thư ký UNI. */
function SummaryByline({ model }: { model: OverviewSummaryModel }) {
  const { t, i18n } = useTranslation();
  const { memberIndex } = useDetail();
  const { gen, finalized, times, transcriptReady } = model;
  const summary = gen.summary!;
  const locale = meetingLocale(i18n.language);
  const at = summary.created_at;
  const [, month, day] = at ? splitIsoLocal(at).date.split("-") : [];
  // "09:31 22/10": the clock, then the day of month.
  const when = at && Number.isFinite(Date.parse(at)) ? `${clock(at)} ${day}/${month}` : "";
  const name = memberIndex.memberOf(summary.created_by)?.display_name;
  const made = !when
    ? null
    : summary.created_by_kind === "system"
      ? t("meetings.detail.overview.madeAuto", { when })
      : name
        ? t("meetings.detail.overview.madeFor", { when, name })
        : t("meetings.detail.overview.made", { when });
  const sources = transcriptReady ? sourceWords(sourceCounts(times, at), t, locale) : "";
  const parts = [made, sources ? t("meetings.detail.overview.from", { sources }) : null].filter(Boolean);
  const redo = gen.showGenerate && !finalized;
  return (
    <Byline>
      <ScribeSign />
      {/* The model is provenance for whoever asks, not a word to read on every visit. */}
      <span data-testid="ai-attribution" title={summary.model || undefined}>
        {parts.join(" · ")}
        {redo ? " ·" : null}
      </span>
      {redo ? (
        <TextButton
          className={INLINE_TEXT_BUTTON}
          aria-disabled={gen.blockedReason !== null || undefined}
          title={gen.blockedReason ?? undefined}
          onClick={gen.requestGenerate}
        >
          {t("meetings.detail.overview.redo")}
        </TextButton>
      ) : null}
    </Byline>
  );
}

/** The summary prose: muted until the minutes are final; four lines and "Đọc tiếp" on a phone. */
function SummaryProse({ text, finalized, spaced }: { text: string; finalized: boolean; spaced: boolean }) {
  const { t } = useTranslation();
  const { isPhone } = useDetail();
  const id = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    setClamped(Boolean(isPhone && el && el.scrollHeight > el.clientHeight + 1));
  }, [isPhone, text]);
  const clamp = isPhone && !open;
  return (
    <>
      <p
        id={id}
        ref={ref}
        className={cn(
          "max-w-160 text-body-lg whitespace-pre-line text-pretty",
          spaced && "mt-3",
          finalized ? "text-foreground" : "text-muted-foreground",
          clamp && "line-clamp-4",
        )}
      >
        {text}
      </p>
      {isPhone && (clamped || open) ? (
        <TextButton className={cn("mt-2", TEXT_BUTTON_HIT)} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
          {t(open ? "meetings.detail.overview.readLess" : "meetings.detail.overview.readMore")}
        </TextButton>
      ) : null}
    </>
  );
}

/**
 * Why there is no summary to read, as one calm card: Thư ký UNI's mark in the
 * state it is in, the sentence, what still reads, and the one thing to do.
 */
function SummaryStateCard({
  mark,
  title,
  caption,
  captionId,
  action,
  role,
}: {
  mark: ScribeMarkState;
  title: ReactNode;
  caption?: ReactNode;
  captionId?: string;
  action?: ReactNode;
  role?: "alert";
}) {
  return (
    <div role={role} className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-4 max-sm:flex-wrap">
      <ScribeMark size={32} state={mark} />
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-foreground">{title}</p>
        {caption ? (
          <p id={captionId} className="mt-0.5 text-caption text-pretty text-muted-foreground">
            {caption}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0 max-sm:basis-full max-sm:pl-11">{action}</div> : null}
    </div>
  );
}

/** Tóm tắt (brief §2.6 + AfterAIStates c1–c3): the AI's prose with its byline, or why there is none yet. */
export function OverviewSummary({ model }: { model: OverviewSummaryModel }) {
  const { t, i18n } = useTranslation();
  const { gen, state, failure, attempts, finalized, times, transcriptReady } = model;
  const reasonId = useId();
  if (state === "off") return null;
  const locale = meetingLocale(i18n.language);
  const now = transcriptReady ? sourceWords(sourceCounts(times), t, locale) : "";
  const summary = gen.summary;
  const facts = summary ? summarySourceFacts(summary.created_at, times) : null;
  const retry = gen.showGenerate && (failure?.retryable ?? false);

  const failed = failure ? (
    <SummaryStateCard
      mark="failed"
      role="alert"
      title={failure.text || (attempts > 1 ? t("meetings.detail.overview.failedTimes", { count: attempts }) : t("meetings.detail.overview.failed"))}
      caption={now ? t("meetings.detail.overview.failedKeep", { sources: sourceWords(sourceCounts(times), t, locale, { lead: true }) }) : undefined}
      action={
        retry ? (
          <Button type="button" variant="outline" className={cn(kitButton.sm, kitButton.outline)} onClick={gen.requestGenerate}>
            <RotateCcw aria-hidden />
            {t("common.retry")}
          </Button>
        ) : undefined
      }
    />
  ) : null;

  const running = (
    <Byline>
      <ScribeSign state="composing" />
      {now ? t("meetings.detail.overview.runningFrom", { sources: now }) : t("meetings.detail.overview.running")}
    </Byline>
  );
  const byline =
    state === "ready" && summary ? (
      <>
        {gen.serverRunning ? running : <SummaryByline model={model} />}
        {summary.transcript_changed_at ? <Byline icon={Info}>{t("meetings.summaryTranscriptChanged")}</Byline> : null}
        {facts?.stale ? <Byline icon={Info}>{t("meetings.summaryStale")}</Byline> : null}
        {summary.partial ? <Byline>{t("meetings.summaryPartial")}</Byline> : null}
      </>
    ) : state === "running" ? (
      running
    ) : null;
  const body =
    state === "ready" && summary ? (
      <>
        {failed}
        <SummaryProse text={summary.summary} finalized={finalized} spaced={failed !== null} />
      </>
    ) : state === "loading" ? (
      <MeetingTextSkeleton />
    ) : state === "error" ? (
      <MeetingSectionError message={t("meetings.summaryLoadFailed")} onRetry={() => void gen.summaryQuery.refetch()} />
    ) : state === "failed" ? (
      failed
    ) : state === "none" ? (
      <SummaryStateCard
        mark={gen.aiOn || !gen.capsLoaded ? "idle" : "off"}
        title={gen.aiOn || !gen.capsLoaded ? t("meetings.detail.overview.none") : t("meetings.aiUnavailable")}
        captionId={reasonId}
        caption={
          gen.showGenerate ? (gen.hasSource && now ? t("meetings.detail.overview.noneFrom", { sources: now }) : t("meetings.summaryNeedsSource")) : undefined
        }
        action={
          gen.showGenerate ? (
            <Button
              type="button"
              variant="outline"
              className={cn(kitButton.sm, kitButton.outline)}
              aria-disabled={gen.blockedReason !== null || undefined}
              aria-describedby={gen.hasSource ? undefined : reasonId}
              onClick={gen.requestGenerate}
            >
              <Sparkles aria-hidden />
              {t("meetings.detail.overview.generate")}
            </Button>
          ) : undefined
        }
      />
    ) : undefined;

  return (
    // `contents`: the test id spans the section without becoming a box between it and the column.
    <div className="contents" data-testid="meeting-summary-panel">
      <Section id="summary" title={t("meetings.summaryTitle")} byline={byline} className="@max-[37.5rem]/meeting:mt-6!">
        {body}
      </Section>
      <SummaryLiveRegion message={gen.announcement} seq={gen.announcementSeq} />
      <SummaryRegenerateConfirm gen={gen} />
    </div>
  );
}
