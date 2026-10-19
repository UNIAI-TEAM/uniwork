"use client";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useMeetingCapabilities, useMeetingChat, useNotes, useTranscript } from "@uniwork/core/meetings";
import { useMeetingMotions } from "@uniwork/core/meetings/motions";
import { useCreateMeetingSummary, useMeetingSummary } from "@uniwork/core/meetings/summary";
import { summaryErrorText } from "./summary-error-copy";
import { hasSummarySource, type SummarySourceTimes } from "./summary-sources";

/**
 * Everything both summary screens (the meeting detail panel and the in-room
 * Copilot) share about the summary itself: whether AI is on, what the model
 * would read (transcript, notes, chat and closed votes, the server's own
 * test), and the generate flow: confirm before replacing a summary people
 * may have read, a polite announcement while the model works (up to a
 * minute), and an actionable error.
 */
export function useSummaryGeneration({
  workspaceId,
  meetingId,
  canHost,
}: {
  workspaceId?: string;
  meetingId: string;
  canHost: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { data: caps } = useMeetingCapabilities(workspaceId ?? "");
  const summaryQuery = useMeetingSummary(meetingId);
  const transcriptQuery = useTranscript(meetingId);
  const notesQuery = useNotes(meetingId);
  const chatQuery = useMeetingChat(meetingId);
  const { data: motions } = useMeetingMotions(meetingId);
  const generate = useCreateMeetingSummary(meetingId);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");

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
  const aiOn = caps?.ai_summary === true;
  const capsLoaded = caps !== undefined;
  const showGenerate = canHost && aiOn;
  const generating = generate.isPending;
  /** Why the generate button cannot be pressed now, said on the button itself. */
  const blockedReason = generating
    ? t("meetings.summaryAi.generatingReason")
    : !hasSource
      ? t("meetings.summaryNeedsSource")
      : null;

  const run = useCallback(() => {
    setConfirmOpen(false);
    setAnnouncement(t("meetings.summaryAi.generatingStatus"));
    generate.mutate(i18n.language.startsWith("en") ? "en" : "vi", {
      onSuccess: () => setAnnouncement(t("meetings.summaryAi.generatedStatus")),
      onError: (err) => {
        const text = summaryErrorText(err, t, "generate");
        setAnnouncement(text);
        toast.error(text);
      },
    });
  }, [generate, i18n.language, t]);

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
    blockedReason,
    requestGenerate,
    confirmOpen,
    setConfirmOpen,
    confirmGenerate: run,
    announcement,
    announce: setAnnouncement,
  };
}

export type SummaryGeneration = ReturnType<typeof useSummaryGeneration>;
