"use client";

import { Phone, PhoneIncoming, PhoneMissed, PhoneOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import type { ChatMessage } from "./chat-messages";
import { formatVoiceCallDuration } from "./voice-call-duration";
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
  const { t } = useTranslation();
  const [recordingOpen, setRecordingOpen] = useState(false);
  const label = voiceCallLogLabel(message, currentUserId, t);
  const Icon = voiceCallLogIcon(message.voiceCall?.outcome);
  const recordingId = message.voiceCall?.recording_id?.trim();
  const recordingReady =
    message.voiceCall?.recording_status === "COMPLETE" && Boolean(recordingId);

  return (
    <>
      <div className="flex justify-center py-1.5">
        <div className="inline-flex max-w-[90%] flex-wrap items-center justify-center gap-1.5 rounded-full bg-muted/70 px-3 py-1 text-caption text-muted-foreground">
          <Icon aria-hidden className="size-3.5 shrink-0 opacity-70" />
          <span className="truncate">{label}</span>
          {recordingReady ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto shrink-0 px-0 py-0 text-caption"
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
