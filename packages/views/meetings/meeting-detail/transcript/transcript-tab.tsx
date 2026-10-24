"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Ellipsis, Info, Trash2, Upload, UserPen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeetingCapabilities, useParticipants, useRecordings } from "@uniwork/core/meetings";
import { useMeetingActionItems } from "@uniwork/core/meetings/action-items";
import { useSpeakerLabels } from "@uniwork/core/meetings/speaker-labels";
import { useMeetingSummary } from "@uniwork/core/meetings/summary";
import { useFullTranscript } from "@uniwork/core/meetings/transcript";
import { useMeetingTranscriptions } from "@uniwork/core/meetings/transcriptions";
import type { Meeting } from "@uniwork/core/types";
import type { MeetingTranscriptSegment } from "@uniwork/core/types/meeting";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalNavigation } from "../../../navigation";
import { MeetingFeedLoadOlder } from "../../meeting-feed-load-older";
import { MeetingRecordingDialog } from "../../meeting-recording-dialog";
import { MeetingRecordingUploadDialog, MeetingTranscriptionStatus } from "../../meeting-recording-upload";
import { MeetingTextSkeleton } from "../../meeting-section-state";
import { MeetingSpeakerLabelsDialog } from "../../meeting-speaker-labels-dialog";
import { scrollSectionIntoView } from "../../use-meeting-section-deep-link";
import { useMemberIndex } from "../../use-member-index";
import { TranscriptChangeDialog, type TranscriptChange } from "../../transcript/transcript-change-dialog";
import { transcriptLineMatches, transcriptPhraseSearch } from "../../transcript/transcript-search";
import { transcriptSpeaker } from "../../transcript/transcript-speaker";
import { useTranscriptReader } from "../../transcript/use-transcript-reader";
import { meetingAvatarTint } from "../avatar-tint";
import { useDetail } from "../detail-context";
import { clock } from "../format";
import { kitButton } from "../ui/kit-buttons";
import { NoticeLine } from "../ui/notice-line";
import { TextButton } from "../ui/text-button";
import { ChapterBar, useTranscriptChapters } from "./chapter-bar";
import { TranscriptFind } from "./transcript-find";
import { chapterAnchor, TranscriptList } from "./transcript-list";
import { chapterIndexAt, citeAnchor, citedLines, speakerCounts, type Citation } from "./transcript-model";
import { TranscriptPlayer } from "./transcript-player";

/** Anchors other screens land focus on (deep link, "record as held"). */
const TRANSCRIPT_HEADING_ID = "transcript-heading";
const TRANSCRIPT_UPLOAD_ID = "meeting-transcript-upload";

/**
 * Where focus goes once the transcript changes under a dialog (the meeting
 * recorded as held, a recording queued): the transcript's upload control,
 * else its heading, else — on Tổng quan, where the tab is not mounted — the
 * page's title.
 */
export function transcriptFocusTarget(): HTMLElement | null {
  const upload = document.getElementById(TRANSCRIPT_UPLOAD_ID);
  if (upload) return upload;
  const heading =
    document.getElementById(TRANSCRIPT_HEADING_ID) ?? document.querySelector<HTMLElement>("[data-testid='meeting-detail-content'] h1");
  // A heading takes programmatic focus only with a tabindex.
  heading?.setAttribute("tabindex", "-1");
  return heading;
}

/**
 * Scrolls to an overview section the tab switch is about to mount and puts
 * focus on its heading: looked up each frame for up to a second.
 */
function revealWhenMounted(id: string, frames = 60): void {
  const section = document.getElementById(id);
  if (!section) {
    if (frames > 0) requestAnimationFrame(() => revealWhenMounted(id, frames - 1));
    return;
  }
  scrollSectionIntoView(section);
  const heading = document.getElementById(`${id}-heading`) ?? section;
  if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

/** The Lời thoại tab of the meeting detail page, from the page's context. */
export function TranscriptTab() {
  const { workspaceId, meeting, isClerk, tabs } = useDetail();
  const set = tabs.set;
  return <TranscriptView workspaceId={workspaceId} meeting={meeting} canClerk={isClerk} onOpenOverview={() => set("overview")} />;
}

/**
 * "Lời thoại" (AfterTranscript): the find row, the recordings, the chapter
 * bar, then every line under its chapter. An ended meeting reads its whole
 * transcript (counts, hits and chapters are of all of it); a live one its
 * newest page as it arrives, with earlier lines on demand. `?segment=` opens
 * on a cited line and marks it.
 */
export function TranscriptView({
  workspaceId,
  meeting,
  canClerk,
  onOpenOverview,
}: {
  workspaceId: string;
  meeting: Meeting;
  canClerk: boolean;
  onOpenOverview?: () => void;
}) {
  const { t } = useTranslation();
  const meetingId = meeting.id;
  const ended = meeting.status === "ENDED";
  const full = useFullTranscript(meetingId, ended);
  const live = useTranscriptReader(ended ? "" : meetingId, false, "");
  const rows = useMemo(() => (ended ? (full.data ?? []) : live.rows), [ended, full.data, live.rows]);
  const isPending = ended ? full.isPending : live.isPending;
  const isError = ended ? full.isError : live.isError;
  const refetch = ended ? () => void full.refetch() : live.refetch;

  const recordings = useRecordings(meetingId).data ?? [];
  const caps = useMeetingCapabilities(workspaceId);
  const canUpload = canClerk && ended && caps.data?.transcription === true;
  const transcriptions = useMeetingTranscriptions(meetingId).data ?? [];
  // A failed upload already says what did not happen and carries the retry.
  const uploadFailed = transcriptions[0]?.status === "FAILED";
  const labels = useSpeakerLabels(canClerk ? meetingId : "");
  const summary = useMeetingSummary(meetingId).data;
  const items = useMeetingActionItems(meetingId).data?.items;
  const participants = useParticipants(meetingId).data;
  const { members } = useMemberIndex(workspaceId);
  const chapters = useTranscriptChapters(meeting);

  const [query, setQuery] = useState("");
  const [step, setStep] = useState(0);
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [citedOnly, setCitedOnly] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState(-1);
  const [jump, setJump] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"upload" | "speakers" | null>(null);
  const [playAt, setPlayAt] = useState<{ recordingId: string; seconds?: number } | null>(null);
  const [change, setChange] = useState<TranscriptChange | null>(null);

  // The cited line a deep link names (?segment=); it stays marked after the link leaves the URL.
  const linked = useOptionalNavigation()?.searchParams.get("segment") ?? "";
  const [target, setTarget] = useState(linked);
  if (linked && linked !== target) setTarget(linked);

  const speakerOf = useCallback((s: MeetingTranscriptSegment) => transcriptSpeaker(s, t), [t]);
  const cited = useMemo(
    () => citedLines({ decisions: summary?.decisions ?? [], questions: summary?.open_questions ?? [], items }),
    [summary, items],
  );
  const speakers = useMemo(() => speakerCounts(rows, speakerOf), [rows, speakerOf]);
  const userOf = useMemo(() => new Map((participants ?? []).map((p) => [p.id, p.user_id])), [participants]);
  const filtered = useMemo(
    () => rows.filter((s) => (speaker === null || speakerOf(s) === speaker) && (!citedOnly || cited.has(s.id))),
    [rows, speaker, speakerOf, citedOnly, cited],
  );
  const searching = query.trim() !== "";
  const phrase = useMemo(() => searching && transcriptPhraseSearch(filtered.map((s) => s.text), query), [filtered, query, searching]);
  const hitList = useMemo(
    () => (searching ? filtered.flatMap((s, i) => (transcriptLineMatches(s.text, query, phrase) ? [i] : [])) : []),
    [filtered, query, searching, phrase],
  );
  const activeHit = hitList.length > 0 ? Math.min(step, hitList.length - 1) : 0;
  const active = hitList[activeHit] ?? -1;
  const activeId = filtered[active]?.id ?? "";
  const current = active >= 0 && chapters.length > 0 ? chapterIndexAt(chapters, filtered[active]!.spoken_at) : picked;

  const search = (q: string) => {
    setQuery(q);
    setStep(0);
    setExpanded(new Set());
  };
  const filter = (apply: () => void) => {
    apply();
    setStep(0);
    setExpanded(new Set());
  };

  // The active hit (and a cited line once loaded) comes into view; a cited line also takes focus.
  useEffect(() => {
    if (!activeId) return;
    document.querySelector(`[data-segment-id="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: "center" });
  }, [activeId]);
  // Once per target: rows change with every live caption, and the reader may be typing elsewhere by then.
  const landed = useRef("");
  useEffect(() => {
    if (!target || landed.current === target) return;
    const line = document.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(target)}"]`);
    if (!line) return;
    line.scrollIntoView({ block: "center" });
    line.focus({ preventScroll: true });
    landed.current = target;
  }, [target, rows]);
  // A chapter the search hid is drawn once the search is cleared, then scrolled to.
  useEffect(() => {
    if (!jump) return;
    document.getElementById(jump)?.scrollIntoView({ block: "start" });
    setJump(null);
  }, [jump]);

  const pickChapter = (i: number) => {
    setPicked(i);
    const key = chapters[i]?.key;
    if (!key) return;
    if (!document.getElementById(chapterAnchor(key))) search("");
    setJump(chapterAnchor(key));
  };
  const cite = (c: Citation) => {
    onOpenOverview?.();
    revealWhenMounted(citeAnchor(c.kind));
  };
  const tintOf = useCallback(
    (s: { participantId?: string }) => meetingAvatarTint(s.participantId ? userOf.get(s.participantId) : undefined, members),
    [userOf, members],
  );

  const targetMissing = target !== "" && !isPending && rows.length > 0 && !rows.some((s) => s.id === target);
  const empty = canUpload ? t("meetings.transcriptEmptyUpload") : ended ? t("meetings.transcriptEmptyEnded") : t("meetings.transcriptEmpty");
  const uploadInMenu = canUpload && !uploadFailed && rows.length > 0;
  // The "⋯" menu (not on the board) is drawn only for a meeting with recordings or uploads to manage;
  // a captions-only transcript is still trimmed line by line ("Xóa từ câu này…").
  const actions =
    (recordings.length > 0 || transcriptions.length > 0) &&
    (uploadInMenu || (canClerk && (labels.data?.length ?? 0) > 0) || (canClerk && rows.length > 0)) ? (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              id={uploadInMenu ? TRANSCRIPT_UPLOAD_ID : undefined}
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("meetings.transcriptMoreActions")}
              className={cn(kitButton.icon, "shrink-0")}
            />
          }
        >
          <Ellipsis aria-hidden className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-50">
          {uploadInMenu ? (
            <DropdownMenuItem onClick={() => setDialog("upload")}>
              <Upload aria-hidden className="size-4" />
              {t("meetings.transcription.uploadButton")}
            </DropdownMenuItem>
          ) : null}
          {canClerk && (labels.data?.length ?? 0) > 0 ? (
            <DropdownMenuItem onClick={() => setDialog("speakers")}>
              <UserPen aria-hidden className="size-4" />
              {t("meetings.scribe.speakersButton")}
            </DropdownMenuItem>
          ) : null}
          {canClerk && rows.length > 0 ? (
            <DropdownMenuItem variant="destructive" onClick={() => setChange({ kind: "all" })}>
              <Trash2 aria-hidden className="size-4" />
              {t("meetings.transcriptDeleteAll")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return (
    <section aria-labelledby={TRANSCRIPT_HEADING_ID} className="relative mt-6 flex flex-col gap-4" data-testid="meeting-transcript-panel">
      <h2 id={TRANSCRIPT_HEADING_ID} className="sr-only">
        {rows.length > 0 ? t("meetings.detail.transcript.heading", { count: rows.length }) : t("meetings.transcriptTitle")}
      </h2>
      <MeetingTranscriptionStatus meetingId={meetingId} onRetry={canUpload ? () => setDialog("upload") : undefined} canDelete={canClerk} />
      {isPending ? (
        <MeetingTextSkeleton />
      ) : isError && rows.length === 0 ? (
        <NoticeLine tone="destructive" icon={CircleAlert} role="alert">
          {t("meetings.detail.transcript.loadFailed")}
          <TextButton className="ml-1 py-0 align-baseline text-body" onClick={refetch}>
            {t("meetings.detail.transcript.retry")}
          </TextButton>
        </NoticeLine>
      ) : rows.length === 0 && !live.hasOlder ? (
        uploadFailed ? null : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-body text-muted-foreground">{target ? t("meetings.transcriptJumpMissing") : empty}</p>
            {canUpload ? (
              <Button id={TRANSCRIPT_UPLOAD_ID} type="button" variant="outline" size="lg" className={cn(kitButton.base, kitButton.outline)} onClick={() => setDialog("upload")}>
                <Upload aria-hidden />
                {t("meetings.transcription.uploadButton")}
              </Button>
            ) : null}
          </div>
        )
      ) : (
        <>
          <TranscriptFind
            query={query}
            onQuery={search}
            hitCount={hitList.length}
            activeHit={activeHit}
            onStep={(d) => setStep((activeHit + d + hitList.length) % hitList.length)}
            speakers={speakers}
            speaker={speaker}
            onSpeaker={(name) => filter(() => setSpeaker(name))}
            tintOf={tintOf}
            citedOnly={citedOnly}
            onCitedOnly={(on) => filter(() => setCitedOnly(on))}
            hasCited={cited.size > 0}
            end={actions}
          />
          <TranscriptPlayer meetingId={meetingId} onPlay={setPlayAt} />
          {chapters.length > 0 ? <ChapterBar chapters={chapters} current={current} onPick={pickChapter} /> : null}
          {targetMissing ? (
            <NoticeLine tone="muted" icon={Info} role="status">
              {t("meetings.transcriptJumpMissing")}
            </NoticeLine>
          ) : null}
          <TranscriptList
            rows={filtered}
            allRows={rows}
            chapters={chapters}
            hits={new Set(hitList)}
            active={active}
            query={query}
            phrase={phrase}
            expanded={expanded}
            onExpand={(key) => setExpanded((prev) => new Set(prev).add(key))}
            speakerOf={speakerOf}
            target={target}
            cited={cited}
            onCite={cite}
            recordings={recordings}
            canClerk={canClerk}
            onPlay={setPlayAt}
            onChange={setChange}
            head={
              live.hasOlder ? (
                <MeetingFeedLoadOlder label={t("meetings.transcriptLoadOlder")} loading={live.isLoadingOlder} onLoad={live.loadOlder} />
              ) : null
            }
          />
        </>
      )}
      {dialog === "upload" ? (
        <MeetingRecordingUploadDialog
          meetingId={meetingId}
          onOpenChange={(open) => setDialog(open ? "upload" : null)}
          focusAfterUpload={transcriptFocusTarget}
          replacesLive={rows.some((s) => s.source !== "TRANSCRIPTION")}
        />
      ) : null}
      {dialog === "speakers" ? (
        <MeetingSpeakerLabelsDialog meetingId={meetingId} workspaceId={workspaceId} open onOpenChange={(open) => setDialog(open ? "speakers" : null)} />
      ) : null}
      {playAt ? (
        <MeetingRecordingDialog
          open
          onOpenChange={(open) => (open ? undefined : setPlayAt(null))}
          meetingId={meetingId}
          recordingId={playAt.recordingId}
          startAt={playAt.seconds}
        />
      ) : null}
      {change ? (
        <TranscriptChangeDialog meetingId={meetingId} change={change} speakerOf={speakerOf} clock={clock} onClose={() => setChange(null)} />
      ) : null}
    </section>
  );
}
