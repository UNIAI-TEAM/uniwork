"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMeetingCapabilities, useMeetingChat, useNotes, useTranscript } from "@uniwork/core/meetings";
import { useMeetingMotions } from "@uniwork/core/meetings/motions";
import { useCreateMeetingSummary, useMeetingSummary, useMeetingSummaryRun } from "@uniwork/core/meetings/summary";
import { useAnnouncement } from "./summary-generate-controls";
import { summaryErrorRetryable, summaryErrorText } from "./summary-error-copy";
import { hasSummarySource, type SummarySourceTimes } from "./summary-sources";

/**
 * Everything both summary screens (the meeting detail panel and the in-room
 * Copilot) share about the summary itself: whether AI is on, what the model
 * would read (transcript, notes, chat and closed votes, the server's own
 * test), and the generate flow: confirm before replacing a summary people
 * may have read, a polite announcement while the model works (up to a
 * minute), and an actionable error that stays on the card until the next run.
 */
export function useSummaryGeneration({
  workspaceId,
  meetingId,
  canClerk,
}: {
  workspaceId?: string;
  meetingId: string;
  /** Host, secretary or workspace admin: whoever runs the meeting's follow-up. */
  canClerk: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data: caps } = useMeetingCapabilities(workspaceId ?? "");
  const summaryQuery = useMeetingSummary(meetingId);
  const transcriptQuery = useTranscript(meetingId);
  const notesQuery = useNotes(meetingId);
  const chatQuery = useMeetingChat(meetingId);
  const { data: motions } = useMeetingMotions(meetingId);
  const generate = useCreateMeetingSummary(meetingId);
  // The server's own run (the automatic summary, or another clerk's): every viewer sees it.
  const serverRunning = (useMeetingSummaryRun(meetingId).data?.status ?? "idle") !== "idle";
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [announcement, announce] = useAnnouncement();
  // The last run's failure, said in place: a quota or plan refusal must not fade with a toast.
  // It belongs to the summary on screen then: one that lands since (the auto summary) answers it.
  const [failure, setFailure] = useState<{ text: string; retryable: boolean; summaryId?: string } | null>(null);

  // Recorded results, not AI: summarisable whether or not a summary exists.
  const voted = useMemo(() => (motions ?? []).filter((m) => m.status === "CLOSED"), [motions]);
  const transcript = transcriptQuery.data;
  const notes = notesQuery.data;
  const chat = chatQuery.data;
  const sourceTimes = useMemo<SummarySourceTimes>(
    () => ({
      transcript: (transcript ?? []).map((s) => s.spoken_at),
      notes: (notes ?? []).map((n) => n.created_at),
      chat: (chat ?? []).map((c) => c.sent_at),
      votes: voted.map((m) => m.closed_at),
    }),
    [transcript, notes, chat, voted],
  );
  const hasSource = hasSummarySource({
    transcript: transcript?.length ?? 0,
    notes: notes?.length ?? 0,
    chat: chat?.length ?? 0,
    votes: voted.length,
  });

  const summary = summaryQuery.data ?? null;
  const summaryId = summary?.id;
  const aiOn = caps?.ai_summary === true;
  const capsLoaded = caps !== undefined;
  const showGenerate = canClerk && aiOn;
  const generating = generate.isPending || serverRunning;
  /** Why the generate button cannot be pressed now, said on the button itself. */
  const blockedReason = generating
    ? t("meetings.summaryAi.generatingReason")
    : !hasSource
      ? t("meetings.summaryNeedsSource")
      : null;

  // A run this screen did not start is said here; this screen's own says it in `run` below.
  const ownRun = useRef(false);
  const watchedRun = useRef<{ running: boolean; summaryId?: string }>({ running: false });
  useEffect(() => {
    const was = watchedRun.current;
    watchedRun.current = { running: serverRunning, summaryId: serverRunning ? summaryId : was.summaryId };
    if (serverRunning && !was.running && !ownRun.current) announce(t("meetings.summaryAi.generatingStatus"));
    if (!serverRunning && was.running && !ownRun.current && summaryId && summaryId !== was.summaryId) {
      announce(t("meetings.summaryAi.generatedStatus"));
    }
    if (!serverRunning && !generate.isPending) ownRun.current = false;
  }, [announce, generate.isPending, serverRunning, summaryId, t]);

  const run = useCallback(() => {
    ownRun.current = true;
    setConfirmOpen(false);
    setFailure(null);
    announce(t("meetings.summaryAi.generatingStatus"));
    generate.mutate(i18n.language.startsWith("en") ? "en" : "vi", {
      onSuccess: () => announce(t("meetings.summaryAi.generatedStatus")),
      onError: (err) => {
        // One channel: the live region says it, the card shows it; no toast on top.
        const text = summaryErrorText(err, t, "generate");
        setFailure({ text, retryable: summaryErrorRetryable(err), summaryId });
        announce(text);
      },
    });
  }, [announce, generate, i18n.language, summaryId, t]);

  /** Generate now, or ask first when it would replace an existing summary. */
  const requestGenerate = useCallback(() => {
    if (blockedReason) return;
    if (summary) setConfirmOpen(true);
    else run();
  }, [blockedReason, summary, run]);

  return {
    summary,
    summaryQuery,
    transcriptQuery,
    notesQuery,
    chatQuery,
    voted,
    sourceTimes,
    hasSource,
    caps,
    aiOn,
    capsLoaded,
    showGenerate,
    generating,
    /** The server is making a summary nobody on this screen asked for just now. */
    serverRunning: serverRunning && !generate.isPending,
    blockedReason,
    requestGenerate,
    confirmOpen,
    setConfirmOpen,
    confirmGenerate: run,
    failure: failure?.summaryId === summaryId ? failure : null,
    announcement: announcement.text,
    announcementSeq: announcement.seq,
  };
}

export type SummaryGeneration = ReturnType<typeof useSummaryGeneration>;
