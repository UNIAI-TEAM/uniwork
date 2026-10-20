"use client";

import { CircleAlert, Phone, PhoneIncoming, PhoneMissed, PhoneOff, Play, Video, VideoOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import type { ChatMessage } from "./chat-messages";
import { formatMessageTime } from "./chat-message-time";
import { formatVoiceCallDuration } from "./voice-call-duration";
import { formatVoiceCallParticipantLabels } from "./voice-call-participant-labels";
import { VoiceCallRecordingDialog } from "./voice-call-recording-dialog";
import { useChatVoiceRecordings } from "@uniwork/core/chat";
import { describeVoiceRecording } from "./chat-voice-recordings-sheet";
import type { NameContextEntry } from "./native-chat-message-mapping";

function voiceCallLogLabel(
  message: ChatMessage,
  currentUserId: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const call = message.voiceCall;
  if (!call) return t("chat.voice_call_log_unknown");

  const isCaller = call.caller_id === currentUserId;
  const kind = call.video ? "video_call_log" : "voice_call_log";
  switch (call.outcome) {
    case "completed":
      return t(`chat.${kind}_completed`, {
        duration: formatVoiceCallDuration(call.duration_seconds ?? 0),
      });
    case "declined":
      return isCaller ? t(`chat.${kind}_declined_outgoing`) : t(`chat.${kind}_declined_incoming`);
    case "unanswered":
      return isCaller ? t(`chat.${kind}_cancelled`) : t(`chat.${kind}_missed`);
    default:
      return t(`chat.${kind}_unknown`);
  }
}

function voiceCallLogIcon(outcome: string | undefined, video: boolean) {
  if (video) return outcome === "completed" ? Video : VideoOff;
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
  nameContext = [],
  onViewSummary,
}: {
  workspaceId: string;
  roomId: string;
  message: ChatMessage;
  currentUserId: string;
  /** Names who started the recording in its player's description. */
  nameContext?: NameContextEntry[];
  /** UNI summarised this call: "Xem tóm tắt" jumps to that summary. */
  onViewSummary?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [recordingOpen, setRecordingOpen] = useState(false);
  // Only a call that rang for me and went unanswered is "missed" — the one
  // outcome that asks something of the reader, so the one in a signal colour.
  const missed =
    message.voiceCall?.outcome === "unanswered" && message.voiceCall.caller_id !== currentUserId;
  const summary = voiceCallLogLabel(message, currentUserId, t);
  // A group call says how many joined; who they were is one hover away (canvas).
  const participantLabels = formatVoiceCallParticipantLabels(message, currentUserId, t("chat.you"));
  const people = message.voiceCall?.participants?.length ?? 0;
  const label =
    people > 2
      ? t("chat.voice_call_log_with_participants", {
          summary,
          participants: t("chat.voice_call_log_people", { count: people }),
        })
      : summary;
  const Icon = voiceCallLogIcon(message.voiceCall?.outcome, message.voiceCall?.video === true);
  const recordingId = message.voiceCall?.recording_id?.trim();
  const recordingReady =
    message.voiceCall?.recording_status === "COMPLETE" && Boolean(recordingId);
  // The player says which recording it is, as the recordings list does; the list loads when it opens.
  const { data: recordings } = useChatVoiceRecordings(workspaceId, roomId, recordingOpen);
  const recordingItem = recordingOpen ? recordings?.find((item) => item.id === recordingId) : undefined;
  const described = recordingItem
    ? describeVoiceRecording(recordingItem, { locale: i18n.language, t, currentUserId, nameContext, youLabel: t("chat.you") })
    : null;
  const recordingDescription = described ? `${described.when} · ${described.whoLine}` : undefined;

  return (
    <>
      {/* A call is an event on the wall, not anyone's message: a centred chip. */}
      <div className="flex justify-center py-1.5">
        <div
          className={cn(
            "inline-flex min-h-8 max-w-[90%] flex-wrap items-center justify-center gap-1.5 rounded-xl py-1 pl-3 text-label",
            recordingReady || onViewSummary ? "pr-1" : "pr-3",
            missed ? "bg-destructive-soft text-destructive-soft-foreground" : "bg-chat-chip text-chat-chip-foreground",
          )}
        >
          <Icon aria-hidden className={cn("shrink-0", message.voiceCall?.video ? "size-4" : "size-3.75")} />
          {/* A long participant list truncates; the full line stays one hover away. */}
          <span
            className={cn("truncate tabular-nums", missed ? "font-semibold" : "font-medium")}
            title={participantLabels || label}
          >
            {label}
          </span>
          <time
            dateTime={new Date(message.ts).toISOString()}
            className={cn("shrink-0 tabular-nums", !missed && "text-muted-foreground")}
          >
            · {formatMessageTime(message.ts, i18n.language)}
          </time>
          {recordingReady ? (
            <Button
              type="button"
              variant="brandSubtle"
              size="xs"
              className="shrink-0 rounded-full px-2.5 font-semibold"
              onClick={() => setRecordingOpen(true)}
            >
              <Play aria-hidden className="size-3 fill-current" />
              {t("chat.voice_call_log_recording")}
            </Button>
          ) : message.voiceCall?.recording_status === "PROCESSING" ||
            message.voiceCall?.recording_status === "ACTIVE" ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
              <Spinner className="size-3.5" />
              {t("chat.voice_call_log_recording_processing")}
            </span>
          ) : message.voiceCall?.recording_status === "FAILED" ? (
            <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-destructive">
              <CircleAlert aria-hidden className="size-3.25" />
              {t("chat.voice_call_log_recording_failed")}
            </span>
          ) : null}
          {onViewSummary ? (
            <Button
              type="button"
              variant="brandSubtle"
              size="xs"
              className="h-6 shrink-0 rounded-lg px-2.5 text-label font-semibold"
              onClick={onViewSummary}
            >
              {t("chat.voice_call_log_view_summary")}
            </Button>
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
          description={recordingDescription}
        />
      ) : null}
    </>
  );
}
