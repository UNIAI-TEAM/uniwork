"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { chatErrorMessage } from "./chat-error-message";

type TFunction = ReturnType<typeof useTranslation>["t"];

function recordingErrorMessage(err: unknown, t: TFunction): string {
  if (err instanceof ApiError) {
    if (err.code === "recording_not_configured") return t("chat.voice_call_record_not_configured");
    if (err.code === "recording_failed") return t("chat.voice_call_record_egress_unavailable");
  }
  return chatErrorMessage(err, t, t("chat.voice_call_record_failed"));
}

export type VoiceCallRecordingState = ReturnType<typeof useVoiceCallRecording>;

/**
 * Whether this call is being recorded, owned by the call itself rather than
 * by the record button: the button unmounts when the panel is minimised, the
 * consent signal (REC badge, "someone started recording") must not.
 */
export function useVoiceCallRecording({
  workspaceId,
  roomId,
  callId,
}: {
  workspaceId: string;
  roomId: string;
  callId: string;
}) {
  const { t } = useTranslation();
  const ws = useOptionalWS()?.client ?? null;
  const currentUserId = useAuthStore((s) => (s.status === "authed" && s.user ? s.user.id : ""));
  const { data: caps } = useMeetingCapabilities(workspaceId);
  const invalidateRecordings = useInvalidateChatVoiceRecordings();
  const recordingEnabled = caps?.recording === true;
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const tRef = useRef(t);
  tRef.current = t;

  const announce = useCallback((text: string) => {
    toast.warning(text);
    setAnnouncement(text);
  }, []);

  // The in-panel copy of the announcement is transient, like the toast.
  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(""), 8_000);
    return () => clearTimeout(timer);
  }, [announcement]);

  // Joining a call that is already being recorded: ask on mount, before the
  // room has published our microphone, and say so the moment we know.
  useEffect(() => {
    let cancelled = false;
    void getActiveChatVoiceRecording(workspaceId, roomId, callId)
      .then((rec) => {
        if (cancelled || rec?.status !== "ACTIVE") return;
        setRecording(true);
        announce(tRef.current("chat.voice_call_recording_in_progress"));
      })
      .catch(() => {
        /* optional sync — the realtime frame still flips the badge */
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, roomId, callId, announce]);

  useEffect(() => {
    if (!ws) return;
    const offStarted = ws.on("chat.voice.recording.started", (payload) => {
      const data = payload as { room_id?: string; call_id?: string; user_id?: string };
      if (data.room_id !== roomId || data.call_id !== callId) return;
      setRecording(true);
      const by = data.user_id?.trim();
      // Everyone in the call is told, not only the person who pressed record.
      if (by && by !== currentUserId) announce(tRef.current("chat.voice_call_record_peer_started"));
    });
    const offStopped = ws.on("chat.voice.recording.stopped", (payload) => {
      const data = payload as { room_id?: string; call_id?: string };
      if (data.room_id === roomId && data.call_id === callId) setRecording(false);
    });
    return () => {
      offStarted();
      offStopped();
    };
  }, [ws, roomId, callId, currentUserId, announce]);

  const start = useCallback(async () => {
    setPending(true);
    try {
      const rec = await startChatVoiceRecording(workspaceId, roomId, callId);
      if (!rec) {
        toast.error(t("chat.voice_call_record_failed"));
        return false;
      }
      setRecording(true);
      invalidateRecordings(workspaceId, roomId);
      toast.success(
        rec.started_by && currentUserId && rec.started_by !== currentUserId
          ? t("chat.voice_call_record_already_active")
          : t("chat.voice_call_record_started"),
      );
      return true;
    } catch (err) {
      toast.error(recordingErrorMessage(err, t));
      return false;
    } finally {
      setPending(false);
    }
  }, [workspaceId, roomId, callId, t, currentUserId, invalidateRecordings]);

  const stop = useCallback(async () => {
    setPending(true);
    try {
      const rec = await stopChatVoiceRecording(workspaceId, roomId, callId);
      if (!rec) {
        toast.error(t("chat.voice_call_record_failed"));
        return;
      }
      setRecording(false);
      invalidateRecordings(workspaceId, roomId);
      toast.success(t("chat.voice_call_record_stopped"));
    } catch (err) {
      toast.error(recordingErrorMessage(err, t));
    } finally {
      setPending(false);
    }
  }, [workspaceId, roomId, callId, t, invalidateRecordings]);

  return { recording, recordingEnabled, pending, start, stop, announcement };
}
