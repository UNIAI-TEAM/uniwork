"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiCapabilities } from "@uniwork/core/ai";
import { errorCode } from "@uniwork/core/api";
import { useChatVoiceTranscript } from "@uniwork/core/chat";
import { cycleChatVoicePlaybackRate, useChatVoicePlaybackStore } from "@uniwork/core/chat/voice-playback-store";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";

const PILL = "inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full px-2 text-caption";

/**
 * The reader's own view of a voice message's transcript (UNI-1908 F2): asked
 * for on demand, kept in the query cache once made. Hidden while AI is off,
 * read from the capability the call summary hint reads.
 */
export function useVoiceTranscript(workspaceId: string, messageId: string, allowed: boolean) {
  const available = Boolean(useAiCapabilities(workspaceId).data?.enabled) && allowed;
  const [open, setOpen] = useState(false);
  const query = useChatVoiceTranscript(workspaceId, messageId, available && open);
  return { available, open, query, messageId, toggle: () => setOpen((value) => !value) };
}

type VoiceTranscriptState = ReturnType<typeof useVoiceTranscript>;

const blockId = (messageId: string) => `chat-voice-transcript-${messageId}`;

/** The speed pill: 1× → 1,5× → 2×, one speed for every voice message this session. */
export function VoiceSpeedPill({ isOwn }: { isOwn: boolean }) {
  const { t, i18n } = useTranslation();
  const rate = useChatVoicePlaybackStore((s) => s.rate);
  const label = new Intl.NumberFormat(i18n.language).format(rate);
  return (
    <button
      type="button"
      aria-label={t("chat.voice_speed_label", { rate: label })}
      onClick={cycleChatVoicePlaybackRate}
      className={cn(
        PILL,
        "font-bold tabular-nums",
        isOwn ? "bg-chat-bubble-own-foreground/15 text-chat-bubble-own-foreground" : "bg-foreground/8 text-chat-chip-foreground",
      )}
    >
      {t("chat.voice_speed", { rate: label })}
    </button>
  );
}

/** "Xem bản chép" under the waveform; it opens and closes the transcript. */
export function VoiceTranscriptChip({ transcript, isOwn }: { transcript: VoiceTranscriptState; isOwn: boolean }) {
  const { t } = useTranslation();
  if (!transcript.available) return null;
  const loading = transcript.open && transcript.query.isFetching;
  return (
    <button
      type="button"
      aria-expanded={transcript.open}
      aria-controls={blockId(transcript.messageId)}
      aria-busy={loading || undefined}
      onClick={transcript.toggle}
      className={cn(
        PILL,
        "font-semibold",
        isOwn ? "bg-chat-bubble-own-foreground/15 text-chat-bubble-own-foreground" : "bg-brand-subtle text-brand-subtle-foreground",
      )}
    >
      {loading ? <Spinner className="size-3" /> : <FileText className="size-3" aria-hidden />}
      {loading
        ? t("chat.voice_transcript_loading")
        : transcript.open
          ? t("chat.voice_transcript_hide")
          : t("chat.voice_transcript_show")}
    </button>
  );
}

function failureKey(error: unknown): string {
  switch (errorCode(error)) {
    case "ai_quota_exceeded":
    case "credits_exhausted":
      return "chat.voice_transcript_quota";
    case "cloud_unavailable":
      return "chat.voice_transcript_unavailable";
    case "ai_disabled":
      return "chat.voice_transcript_disabled";
    case "chat_transcript_pending":
      return "chat.voice_transcript_pending";
    default:
      return "chat.voice_transcript_failed";
  }
}

/** The transcript text, or why there is none yet, below the player. */
export function VoiceTranscriptBlock({ transcript, isOwn }: { transcript: VoiceTranscriptState; isOwn: boolean }) {
  const { t } = useTranslation();
  const { query } = transcript;
  if (!transcript.available || !transcript.open || query.isFetching) return null;
  if (query.isError) {
    return (
      <p
        id={blockId(transcript.messageId)}
        role="alert"
        className={cn("flex flex-wrap items-center gap-x-2 text-caption", isOwn ? "text-chat-bubble-own-meta" : "text-destructive")}
      >
        {t(failureKey(query.error))}
        <button
          type="button"
          onClick={() => void query.refetch()}
          className={cn("font-semibold underline-offset-2 hover:underline", isOwn ? "text-chat-bubble-own-foreground" : "text-brand")}
        >
          {t("chat.voice_transcript_retry")}
        </button>
      </p>
    );
  }
  if (!query.data) return null;
  const text = query.data.text.trim();
  return (
    <p
      id={blockId(transcript.messageId)}
      className={cn(
        "border-t pt-2 text-body whitespace-pre-wrap",
        isOwn ? "border-chat-bubble-own-foreground/25" : "border-border",
        !text && (isOwn ? "text-chat-bubble-own-meta" : "text-muted-foreground"),
      )}
    >
      {text || t("chat.voice_transcript_empty")}
    </p>
  );
}
