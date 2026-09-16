"use client";

import { useCallback, useEffect, useState } from "react";
import { Circle, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getActiveChatVoiceRecording,
  startChatVoiceRecording,
  stopChatVoiceRecording,
} from "@uniwork/core/api/endpoints/chat-voice";
import { ApiError } from "@uniwork/core/api/http";
import { useAuthStore } from "@uniwork/core/auth";
import { useInvalidateChatVoiceRecordings } from "@uniwork/core/chat";
import { useMeetingCapabilities } from "@uniwork/core/meetings";
import { useOptionalWS } from "@uniwork/core/realtime";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

function recordingErrorMessage(err: unknown, t: (key: string) => string): string {
  if (err instanceof ApiError) {
    if (err.code === "recording_not_configured") return t("chat.voice_call_record_not_configured");
    if (err.code === "recording_failed") return t("chat.voice_call_record_egress_unavailable");
    if (err.message.trim()) return err.message;
  }
  return t("chat.voice_call_record_failed");
}

export function VoiceCallRecordControl({
  workspaceId,
  roomId,
  callId,
  disabled,
}: {
  workspaceId: string;
  roomId: string;
  callId: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const ws = useOptionalWS()?.client ?? null;
  const currentUserId = useAuthStore((s) => (s.status === "authed" && s.user ? s.user.id : ""));
  const { data: caps } = useMeetingCapabilities(workspaceId);
  const invalidateRecordings = useInvalidateChatVoiceRecordings();
  const recordingEnabled = caps?.recording === true;
  const [recording, setRecording] = useState(false);
  const [startedBy, setStartedBy] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const syncActive = useCallback(() => {
    if (!recordingEnabled || disabled) return;
    void getActiveChatVoiceRecording(workspaceId, roomId, callId)
      .then((rec) => {
        if (rec?.status === "ACTIVE") {
          setRecording(true);
          if (rec.started_by) setStartedBy(rec.started_by);
        }
      })
      .catch(() => {
        /* ignore — optional sync */
      });
  }, [recordingEnabled, disabled, workspaceId, roomId, callId]);

  useEffect(() => {
    syncActive();
  }, [syncActive]);

  useEffect(() => {
    if (!ws) return;
    const offStarted = ws.on("chat.voice.recording.started", (payload) => {
      const data = payload as { room_id?: string; call_id?: string; user_id?: string };
      if (data.room_id !== roomId || data.call_id !== callId) return;
      setRecording(true);
      if (data.user_id?.trim()) setStartedBy(data.user_id.trim());
    });
    const offStopped = ws.on("chat.voice.recording.stopped", (payload) => {
      const data = payload as { room_id?: string; call_id?: string };
      if (data.room_id === roomId && data.call_id === callId) {
        setRecording(false);
        setStartedBy(null);
      }
    });
    return () => {
      offStarted();
      offStopped();
    };
  }, [ws, roomId, callId]);

  const startRecording = useCallback(() => {
    setPending(true);
    void startChatVoiceRecording(workspaceId, roomId, callId)
      .then((rec) => {
        if (!rec) {
          toast.error(t("chat.voice_call_record_failed"));
          return;
        }
        setRecording(true);
        if (rec.started_by) setStartedBy(rec.started_by);
        else if (currentUserId) setStartedBy(currentUserId);
        invalidateRecordings(workspaceId, roomId);
        toast.success(
          rec.started_by && currentUserId && rec.started_by !== currentUserId
            ? t("chat.voice_call_record_already_active")
            : t("chat.voice_call_record_started"),
        );
      })
      .catch((err: unknown) => {
        toast.error(recordingErrorMessage(err, t));
      })
      .finally(() => {
        setPending(false);
        setConfirmOpen(false);
      });
  }, [workspaceId, roomId, callId, t, currentUserId, invalidateRecordings]);

  const toggle = () => {
    if (!recordingEnabled) {
      toast.error(t("chat.voice_call_record_not_configured"));
      return;
    }
    if (recording) {
      setPending(true);
      void stopChatVoiceRecording(workspaceId, roomId, callId)
        .then((rec) => {
          if (!rec) {
            toast.error(t("chat.voice_call_record_failed"));
            return;
          }
          setRecording(false);
          setStartedBy(null);
          invalidateRecordings(workspaceId, roomId);
          toast.success(t("chat.voice_call_record_stopped"));
        })
        .catch((err: unknown) => {
          toast.error(recordingErrorMessage(err, t));
        })
        .finally(() => setPending(false));
      return;
    }
    setConfirmOpen(true);
  };

  const peerIsRecording =
    recording && startedBy != null && currentUserId !== "" && startedBy !== currentUserId;

  return (
    <>
      <div className="flex flex-col items-center gap-0.5">
        <Button
          type="button"
          variant={recording ? "default" : "outline"}
          size="icon-lg"
          className={cn(
            "size-11 rounded-full",
            !recording && "border-border bg-background",
            recording && "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            !recordingEnabled && "opacity-60",
          )}
          aria-label={
            recording ? t("chat.voice_call_record_stop") : t("chat.voice_call_record_start")
          }
          aria-pressed={recording}
          disabled={disabled || pending}
          onClick={toggle}
        >
          {recording ? (
            <Square aria-hidden className="size-3.5 fill-current" />
          ) : (
            <Circle
              aria-hidden
              className={cn(
                "size-4",
                recordingEnabled ? "fill-destructive text-destructive" : "text-muted-foreground",
              )}
            />
          )}
        </Button>
        {peerIsRecording ? (
          <span className="max-w-[4.5rem] truncate text-[10px] leading-tight text-muted-foreground">
            {t("chat.voice_call_record_peer_active")}
          </span>
        ) : null}
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chat.voice_call_record_confirm_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("chat.voice_call_record_confirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.back")}</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={startRecording}>
              {t("chat.voice_call_record_confirm_action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
