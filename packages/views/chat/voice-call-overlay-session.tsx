"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Users, Video, VideoOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@uniwork/ui/components/ui/avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { useCallDuration } from "./use-call-duration";
import { formatVoiceCallDuration } from "./voice-call-duration";
import {
  VoiceCallControlRow,
  VoiceCallFloatingPanel,
  VoiceCallFloatingScrim,
  type VoiceCallPanelMode,
  voiceCallInitialOf,
} from "./voice-call-floating-panel";
import type { VoiceCallKind } from "./voice-call-overlay-types";
import { VoiceCallRoom, useVoiceCallRoom } from "./voice-call-room";

const GROUP_ALONE_TIMEOUT_MS = 60_000;

function VoiceCallRoundControl({
  ariaLabel,
  onClick,
  disabled,
  active,
  destructive,
  children,
}: {
  ariaLabel: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : destructive ? "destructive" : "outline"}
      size="icon-lg"
      className={cn("size-11 rounded-full", !active && !destructive && "border-border bg-background")}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function VoiceCallVideoStage({
  peerName,
  size = "compact",
}: {
  peerName: string;
  size?: "compact" | "fullscreen";
}) {
  const {
    cameraEnabled,
    remoteCameraEnabled,
    bindLocalVideo,
    bindRemoteVideo,
  } = useVoiceCallRoom();

  if (!cameraEnabled && !remoteCameraEnabled) {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <Avatar className={cn("text-title", size === "fullscreen" ? "size-32" : "size-20")}>
          <AvatarFallback className="bg-primary/10 text-primary">
            {voiceCallInitialOf(peerName)}
          </AvatarFallback>
        </Avatar>
        {size === "fullscreen" ? (
          <p className="truncate text-title font-medium text-foreground">{peerName}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-xl bg-muted ring-1 ring-border/60",
        size === "fullscreen"
          ? "aspect-video max-h-[min(70vh,720px)]"
          : "aspect-video max-h-36",
      )}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- LiveKit realtime video has no caption track */}
      <video
        ref={bindRemoteVideo}
        autoPlay
        playsInline
        className={cn("size-full object-cover", !remoteCameraEnabled && "hidden")}
      />
      {!remoteCameraEnabled && cameraEnabled ? (
        <div className="flex size-full items-center justify-center bg-muted">
          <Avatar className="size-16 text-title">
            <AvatarFallback className="bg-primary/10 text-primary">
              {voiceCallInitialOf(peerName)}
            </AvatarFallback>
          </Avatar>
        </div>
      ) : null}
      {cameraEnabled ? (
        <video
          ref={bindLocalVideo}
          autoPlay
          playsInline
          muted
          className={cn(
            "object-cover",
            remoteCameraEnabled
              ? size === "fullscreen"
                ? "absolute bottom-4 right-4 h-28 w-40 scale-x-[-1] rounded-xl border border-border shadow-[var(--menu-shadow)] sm:h-36 sm:w-52"
                : "absolute bottom-2 right-2 h-16 w-24 scale-x-[-1] rounded-lg border border-border shadow-[var(--menu-shadow)]"
              : "size-full scale-x-[-1]",
          )}
        />
      ) : null}
    </div>
  );
}

function ActiveVoiceControls({
  callKind,
  isCaller,
  onLeave,
  onEndForAll,
  compact,
}: {
  callKind: VoiceCallKind;
  isCaller: boolean;
  onLeave: () => void;
  onEndForAll: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { connected, muted, cameraEnabled, remoteParticipantCount, toggleMute, toggleCamera } =
    useVoiceCallRoom();

  const handleToggleCamera = () => {
    void toggleCamera().then((ok) => {
      if (!ok) toast.error(t("chat.voice_call_camera_failed"));
    });
  };

  const handleLeave = () => {
    if (callKind === "group" && isCaller && remoteParticipantCount === 0) {
      onEndForAll();
      return;
    }
    if (callKind === "dm") {
      onEndForAll();
      return;
    }
    onLeave();
  };

  const leaveLabel = callKind === "group" ? t("chat.voice_call_leave") : t("chat.voice_call_end");

  const leaveButton = (
    <Button
      type="button"
      variant="destructive"
      size="icon-sm"
      className="shrink-0 rounded-full"
      aria-label={leaveLabel}
      onClick={handleLeave}
    >
      <PhoneOff aria-hidden className="size-4" />
    </Button>
  );

  if (compact) {
    return leaveButton;
  }

  if (callKind === "group") {
    return (
      <VoiceCallControlRow>
        <VoiceCallRoundControl
          ariaLabel={muted ? t("chat.voice_call_unmute") : t("chat.voice_call_mute")}
          disabled={!connected}
          onClick={toggleMute}
        >
          {muted ? <MicOff aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />}
        </VoiceCallRoundControl>
        <VoiceCallRoundControl
          ariaLabel={cameraEnabled ? t("chat.voice_call_camera_off") : t("chat.voice_call_camera_on")}
          disabled={!connected}
          active={cameraEnabled}
          onClick={handleToggleCamera}
        >
          {cameraEnabled ? (
            <Video aria-hidden className="size-4" />
          ) : (
            <VideoOff aria-hidden className="size-4" />
          )}
        </VoiceCallRoundControl>
        <VoiceCallRoundControl ariaLabel={leaveLabel} destructive onClick={handleLeave}>
          <PhoneOff aria-hidden className="size-4" />
        </VoiceCallRoundControl>
        {isCaller ? (
          <VoiceCallRoundControl
            ariaLabel={t("chat.voice_call_end_for_all")}
            destructive
            onClick={onEndForAll}
          >
            <Users aria-hidden className="size-4" />
          </VoiceCallRoundControl>
        ) : null}
      </VoiceCallControlRow>
    );
  }

  return (
    <VoiceCallControlRow>
      <VoiceCallRoundControl
        ariaLabel={muted ? t("chat.voice_call_unmute") : t("chat.voice_call_mute")}
        disabled={!connected}
        onClick={toggleMute}
      >
        {muted ? <MicOff aria-hidden className="size-4" /> : <Mic aria-hidden className="size-4" />}
      </VoiceCallRoundControl>
      <VoiceCallRoundControl
        ariaLabel={cameraEnabled ? t("chat.voice_call_camera_off") : t("chat.voice_call_camera_on")}
        disabled={!connected}
        active={cameraEnabled}
        onClick={handleToggleCamera}
      >
        {cameraEnabled ? (
          <Video aria-hidden className="size-4" />
        ) : (
          <VideoOff aria-hidden className="size-4" />
        )}
      </VoiceCallRoundControl>
      <VoiceCallRoundControl ariaLabel={t("chat.voice_call_end")} destructive onClick={onEndForAll}>
        <PhoneOff aria-hidden className="size-4" />
      </VoiceCallRoundControl>
    </VoiceCallControlRow>
  );
}

function ActiveVoiceCallContent({
  peerName,
  callKind,
  isCaller,
  panelMode,
  onMinimize,
  onMaximize,
  onLeave,
  onEndForAll,
  onConnected,
}: {
  peerName: string;
  callKind: VoiceCallKind;
  isCaller: boolean;
  panelMode: VoiceCallPanelMode;
  onMinimize: () => void;
  onMaximize: () => void;
  onLeave: () => void;
  onEndForAll: () => void;
  onConnected: () => void;
}) {
  const { t } = useTranslation();
  const { connected, remoteParticipantCount, needsAudioUnlock, unlockAudio } = useVoiceCallRoom();
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const hadRemoteRef = useRef(false);
  const autoEndRef = useRef(false);
  const sessionLive =
    connected && (callKind === "dm" || remoteParticipantCount > 0);

  useEffect(() => {
    if (!connected) {
      hadRemoteRef.current = false;
      autoEndRef.current = false;
    }
  }, [connected]);

  useEffect(() => {
    if (sessionLive && startedAt == null) {
      setStartedAt(Date.now());
      onConnected();
    }
    if (!sessionLive) {
      setStartedAt(null);
    }
  }, [sessionLive, startedAt, onConnected]);

  useEffect(() => {
    if (!connected || autoEndRef.current) return;
    if (remoteParticipantCount > 0) {
      hadRemoteRef.current = true;
      return;
    }
    if (!hadRemoteRef.current) return;
    autoEndRef.current = true;
    if (callKind === "group") {
      if (isCaller) void onEndForAll();
      else onLeave();
      return;
    }
    void onEndForAll();
  }, [connected, remoteParticipantCount, callKind, isCaller, onEndForAll, onLeave]);

  useEffect(() => {
    if (autoEndRef.current || !connected || callKind !== "group" || !isCaller) return;
    if (remoteParticipantCount > 0 || hadRemoteRef.current) return;

    const timer = setTimeout(() => {
      if (autoEndRef.current) return;
      autoEndRef.current = true;
      void onEndForAll();
    }, GROUP_ALONE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [connected, callKind, isCaller, remoteParticipantCount, onEndForAll]);

  const elapsed = useCallDuration(sessionLive, startedAt);
  const statusLabel = !connected
    ? t("chat.voice_call_connecting")
    : callKind === "group" && remoteParticipantCount === 0
      ? t("chat.voice_call_waiting_for_others")
      : t("chat.voice_call_connected_duration", { duration: formatVoiceCallDuration(elapsed) });

  const panel = (
    <VoiceCallFloatingPanel
      peerName={peerName}
      statusLabel={statusLabel}
      mode={panelMode}
      onMinimize={onMinimize}
      onMaximize={onMaximize}
      footer={
        panelMode === "minimized" ? (
          <ActiveVoiceControls
            callKind={callKind}
            isCaller={isCaller}
            onLeave={onLeave}
            onEndForAll={onEndForAll}
            compact
          />
        ) : (
          <ActiveVoiceControls
            callKind={callKind}
            isCaller={isCaller}
            onLeave={onLeave}
            onEndForAll={onEndForAll}
          />
        )
      }
    >
      {needsAudioUnlock ? (
        <div className="flex flex-col items-center gap-2 pb-2">
          <p className="text-center text-caption text-muted-foreground">{t("chat.voice_call_enable_audio")}</p>
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
        </div>
      ) : null}
      {panelMode !== "minimized" ? (
        <VoiceCallVideoStage
          peerName={peerName}
          size={panelMode === "fullscreen" ? "fullscreen" : "compact"}
        />
      ) : null}
    </VoiceCallFloatingPanel>
  );

  if (panelMode === "minimized" || panelMode === "fullscreen") {
    return panel;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(calc(100vw-2rem),380px)] sm:bottom-6 sm:right-6">
      {panel}
    </div>
  );
}

export function ActiveVoiceCallSession({
  peerName,
  callKind,
  isCaller,
  url,
  token,
  initialCameraEnabled,
  panelMode,
  onMinimize,
  onMaximize,
  onLeave,
  onEndForAll,
  onConnected,
  onConnectFailed,
}: {
  peerName: string;
  callKind: VoiceCallKind;
  isCaller: boolean;
  url: string;
  token: string;
  initialCameraEnabled?: boolean;
  panelMode: VoiceCallPanelMode;
  onMinimize: () => void;
  onMaximize: () => void;
  onLeave: () => void;
  onEndForAll: () => void;
  onConnected: () => void;
  onConnectFailed: () => void;
}) {
  return (
    <VoiceCallRoom
      url={url}
      token={token}
      initialCameraEnabled={initialCameraEnabled}
      onDisconnected={onLeave}
      onConnectFailed={onConnectFailed}
    >
      <ActiveVoiceCallContent
        peerName={peerName}
        callKind={callKind}
        isCaller={isCaller}
        panelMode={panelMode}
        onMinimize={onMinimize}
        onMaximize={onMaximize}
        onLeave={onLeave}
        onEndForAll={onEndForAll}
        onConnected={onConnected}
      />
    </VoiceCallRoom>
  );
}

export function PreConnectFloatingCall({
  peerName,
  statusLabel,
  pulse,
  children,
}: {
  peerName: string;
  statusLabel: string;
  pulse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <VoiceCallFloatingScrim>
      <VoiceCallFloatingPanel
        peerName={peerName}
        statusLabel={statusLabel}
        mode="expanded"
        allowResize={false}
        pulse={pulse}
      >
        <VoiceCallControlRow>{children}</VoiceCallControlRow>
      </VoiceCallFloatingPanel>
    </VoiceCallFloatingScrim>
  );
}
