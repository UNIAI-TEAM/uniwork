"use client";

import { Phone, PhoneIncoming, PhoneMissed, PhoneOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { formatMessageTime } from "./chat-message-time";
import { formatVoiceCallDuration } from "./voice-call-duration";
import { formatVoiceCallParticipantLabels } from "./voice-call-participant-labels";
import { VoiceCallRecordingDialog } from "./voice-call-recording-dialog";

function voiceCallLogLabel(
  message: ChatMessage,
  currentUserId: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const call = message.voiceCall;
  if (!call) return t("chat.voice_call_log_unknown");

  const isCaller = call.caller_id === currentUserId;
  switch (call.outcome) {
    case "completed":
      return t("chat.voice_call_log_completed", {
        duration: formatVoiceCallDuration(call.duration_seconds ?? 0),
      });
    case "declined":
      return isCaller
        ? t("chat.voice_call_log_declined_outgoing")
        : t("chat.voice_call_log_declined_incoming");
    case "unanswered":
      return isCaller
        ? t("chat.voice_call_log_cancelled")
        : t("chat.voice_call_log_missed");
    default:
      return t("chat.voice_call_log_unknown");
  }
}

function voiceCallLogIcon(outcome: string | undefined) {
  switch (outcome) {
    case "completed":
      return Phone;
    case "declined":
      return PhoneOff;
    case "unanswered":
      return PhoneMissed;
    default:
      return PhoneIncoming;
  }
}

export function VoiceCallLogRow({
  workspaceId,
  roomId,
  message,
  currentUserId,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  currentUserId: string;
}) {
  const { t, i18n } = useTranslation();
  const [recordingOpen, setRecordingOpen] = useState(false);
  // Only a call that rang for me and went unanswered is "missed" — the one
  // outcome that asks something of the reader, so the one in a signal colour.
  const missed =
    message.voiceCall?.outcome === "unanswered" && message.voiceCall.caller_id !== currentUserId;
  const summary = voiceCallLogLabel(message, currentUserId, t);
  const participantLabels = formatVoiceCallParticipantLabels(message, currentUserId, t("chat.you"));
  const label = participantLabels ? t("chat.voice_call_log_with_participants", {
    summary,
    participants: participantLabels,
  }) : summary;
  const Icon = voiceCallLogIcon(message.voiceCall?.outcome);
  const recordingId = message.voiceCall?.recording_id?.trim();
  const recordingReady =
    message.voiceCall?.recording_status === "COMPLETE" && Boolean(recordingId);

  return (
    <>
      <div className="flex justify-center py-1.5">
        <div
          className={cn(
            "inline-flex max-w-[90%] flex-wrap items-center justify-center gap-1.5 rounded-full px-3 py-1 text-caption",
            missed ? "bg-destructive-soft text-destructive-soft-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          <Icon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate font-medium">{label}</span>
          <time dateTime={new Date(message.ts).toISOString()} className="shrink-0 tabular-nums">
            · {formatMessageTime(message.ts, i18n.language)}
          </time>
          {recordingReady ? (
            <Button
              type="button"
              variant="link"
              size="xs"
              className="shrink-0 px-1 pointer-coarse:min-h-9"
              onClick={() => setRecordingOpen(true)}
            >
              {t("chat.voice_call_log_recording")}
            </Button>
          ) : message.voiceCall?.recording_status === "PROCESSING" ||
            message.voiceCall?.recording_status === "ACTIVE" ? (
            <span className="shrink-0">{t("chat.voice_call_log_recording_processing")}</span>
          ) : null}
        </div>
      </div>
      {recordingReady && recordingId ? (
        <VoiceCallRecordingDialog
          open={recordingOpen}
          onOpenChange={setRecordingOpen}
          workspaceId={workspaceId}
          roomId={roomId}
          recordingId={recordingId}
        />
      ) : null}
    </>
  );
}
