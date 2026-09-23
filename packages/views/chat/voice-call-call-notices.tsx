"use client";

import { useEffect, useRef, useState } from "react";
import { MicOff, RefreshCw, VideoOff, Volume2, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@uniwork/ui/components/ui/button";
import { Notice } from "../common/notice";
import { voiceCallDeviceMessage } from "./voice-call-copy";
import { useVoiceCallActions, useVoiceCallMedia, useVoiceCallStatus } from "./voice-call-room-context";

/**
 * The meeting room's connection strip, for a call: amber while LiveKit heals
 * the link itself, red once it is gone — and then the viewer decides (retry
 * or leave) instead of the call hanging up behind their back.
 */
function VoiceCallConnectionNotice({ onLeave, leaveLabel }: { onLeave: () => void; leaveLabel: string }) {
  const { t } = useTranslation();
  const { connectionState } = useVoiceCallStatus();
  const { retryConnection } = useVoiceCallActions();
  if (connectionState === "reconnecting") {
    return (
      // The panel's status line already announces the state; the strip is the visible half.
      <Notice tone="warning" icon={RefreshCw} live="off" layout="inline" className="mb-3">
        {t("chat.voice_call_reconnecting")}
      </Notice>
    );
  }
  if (connectionState !== "lost") return null;
  return (
    <Notice
      tone="destructive"
      icon={WifiOff}
      live="off"
      layout="inline"
      className="mb-3 flex-wrap"
      action={
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={retryConnection}>
            {t("chat.voice_call_reconnect")}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onLeave}>
            {leaveLabel}
          </Button>
        </div>
      }
    >
      {t("chat.voice_call_connection_lost")}
    </Notice>
  );
}

/** A microphone or camera that would not start: which one, why, and a retry. */
function VoiceCallDeviceNotice() {
  const { t } = useTranslation();
  const { deviceError, muted, cameraEnabled } = useVoiceCallStatus();
  const { toggleMute, toggleCamera } = useVoiceCallActions();
  const [pending, setPending] = useState(false);
  if (!deviceError) return null;
  const mic = deviceError.kind === "audioinput";
  const retry = async () => {
    setPending(true);
    try {
      if (mic && muted) await toggleMute();
      else if (!mic && !cameraEnabled) await toggleCamera();
    } finally {
      setPending(false);
    }
  };
  return (
    <Notice
      tone="warning"
      icon={mic ? MicOff : VideoOff}
      layout="inline"
      className="mb-3 flex-wrap"
      action={
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={() => void retry()}
        >
          {t(mic ? "meetings.deviceNoticeRetryMic" : "meetings.deviceNoticeRetryCamera")}
        </Button>
      }
    >
      {voiceCallDeviceMessage(deviceError, t)}{" "}
      {t(mic ? "chat.voice_call_device_in_call_mic" : "chat.voice_call_device_in_call_camera")}
      {deviceError.failure === "denied" ? (
        <span className="mt-0.5 block font-normal">{t("meetings.devicePreviewDeniedHint")}</span>
      ) : null}
    </Notice>
  );
}

function VoiceCallAudioUnlockNotice() {
  const { t } = useTranslation();
  const { needsAudioUnlock } = useVoiceCallStatus();
  const { unlockAudio } = useVoiceCallActions();
  if (!needsAudioUnlock) return null;
  return (
    <Notice
      tone="info"
      icon={Volume2}
      layout="inline"
      className="mb-3 flex-wrap"
      action={
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void unlockAudio().then((ok) => {
              if (!ok) toast.error(t("chat.voice_call_enable_audio_failed"));
            });
          }}
        >
          {t("chat.voice_call_enable_audio_action")}
        </Button>
      }
    >
      {t("chat.voice_call_enable_audio")}
    </Notice>
  );
}

export function VoiceCallNotices({ onLeave, leaveLabel }: { onLeave: () => void; leaveLabel: string }) {
  return (
    <>
      <VoiceCallConnectionNotice onLeave={onLeave} leaveLabel={leaveLabel} />
      <VoiceCallDeviceNotice />
      <VoiceCallAudioUnlockNotice />
    </>
  );
}

/** People already in the call when we join are not news; only later arrivals are. */
const PRESENCE_SETTLE_MS = 2000;
/** Arrivals and departures this close together are read out as one sentence. */
const PRESENCE_BATCH_MS = 1200;

/**
 * "X joined" / "X left", politely — the meeting room's presence announcer,
 * fed from the call's tiles. The first roster and a reconnect's re-sync are
 * skipped, and a burst becomes one count instead of a queue of names.
 */
export function VoiceCallPresenceAnnouncer() {
  const { t } = useTranslation();
  const { participantTiles } = useVoiceCallMedia();
  const { connectionState } = useVoiceCallStatus();
  const [text, setText] = useState("");
  const knownRef = useRef<Map<string, string> | null>(null);
  const readyAtRef = useRef(Infinity);
  const pendingRef = useRef<{ joined: string[]; left: string[] }>({ joined: [], left: [] });
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (connectionState === "connected") {
      readyAtRef.current = Date.now() + PRESENCE_SETTLE_MS;
      return;
    }
    readyAtRef.current = Infinity;
    clearTimeout(timerRef.current);
    pendingRef.current = { joined: [], left: [] };
  }, [connectionState]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  useEffect(() => {
    const remote = new Map(
      participantTiles.filter((tile) => !tile.isLocal).map((tile) => [tile.identity, tile.name || tile.identity]),
    );
    const previous = knownRef.current;
    knownRef.current = remote;
    if (!previous || Date.now() < readyAtRef.current) return;
    const joined = [...remote].filter(([id]) => !previous.has(id)).map(([, name]) => name);
    const left = [...previous].filter(([id]) => !remote.has(id)).map(([, name]) => name);
    if (joined.length === 0 && left.length === 0) return;
    pendingRef.current.joined.push(...joined);
    pendingRef.current.left.push(...left);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const batch = pendingRef.current;
      pendingRef.current = { joined: [], left: [] };
      const parts: string[] = [];
      if (batch.joined.length === 1) parts.push(t("chat.voice_call_participant_joined", { name: batch.joined[0] }));
      else if (batch.joined.length > 1)
        parts.push(t("chat.voice_call_participants_joined", { count: batch.joined.length }));
      if (batch.left.length === 1) parts.push(t("chat.voice_call_participant_left", { name: batch.left[0] }));
      else if (batch.left.length > 1) parts.push(t("chat.voice_call_participants_left", { count: batch.left.length }));
      if (parts.length > 0) setText(parts.join(". "));
    }, PRESENCE_BATCH_MS);
  }, [participantTiles, t]);

  return (
    <p role="status" aria-live="polite" className="sr-only" data-testid="voice-call-presence-announcer">
      {text}
    </p>
  );
}
