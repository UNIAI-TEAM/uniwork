"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRoomMediaShortcuts } from "../meetings/meeting-room-shortcuts";
import { useCallDuration } from "./use-call-duration";
import { useVoiceCallPanelDrag } from "./use-voice-call-panel-drag";
import { useVoiceCallRecording } from "./use-voice-call-recording";
import { useVoiceCallSessionLifecycle } from "./use-voice-call-session-lifecycle";
import {
  VoiceCallNotices,
  VoiceCallPresenceAnnouncer,
} from "./voice-call-call-notices";
import { ActiveVoiceControls } from "./voice-call-controls";
import { formatVoiceCallDuration } from "./voice-call-duration";
import {
  VoiceCallFloatingPanel,
  type VoiceCallPanelMode,
} from "./voice-call-floating-panel";
import { isMultiPartyVoiceCall } from "./voice-call-kind-utils";
import type {
  VoiceCallEndInit,
  VoiceCallKind,
} from "./voice-call-overlay-types";
import { VoiceCallRecIndicator } from "./voice-call-recording-controls";
import {
  useVoiceCallActions,
  useVoiceCallStatus,
} from "./voice-call-room-context";
import { VoiceCallVideoStage } from "./voice-call-video-stage";

export function ActiveVoiceCallContent({
  workspaceId,
  roomId,
  callId,
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
  workspaceId: string;
  roomId: string;
  callId: string;
  peerName: string;
  callKind: VoiceCallKind;
  isCaller: boolean;
  panelMode: VoiceCallPanelMode;
  onMinimize: () => void;
  onMaximize: () => void;
  onLeave: (init?: VoiceCallEndInit) => void;
  onEndForAll: (init?: VoiceCallEndInit) => void;
  onConnected: () => void;
}) {
  const { t } = useTranslation();
  const { connected, connectionState, remoteParticipantCount, deviceError } =
    useVoiceCallStatus();
  const { toggleMute, toggleCamera } = useVoiceCallActions();
  const multiParty = isMultiPartyVoiceCall(callKind);
  // Recording state belongs to the call, not to the record button: the REC
  // badge and the "someone started recording" notice live in every panel size.
  const recording = useVoiceCallRecording({ workspaceId, roomId, callId });
  const { live, startedAt } = useVoiceCallSessionLifecycle({
    callKind,
    isCaller,
    connectionState,
    remoteParticipantCount,
    onConnected,
    onLeave,
    onEndForAll,
  });

  useRoomMediaShortcuts({
    onToggleMic: () => {
      if (connected) void toggleMute();
    },
    onToggleCamera: () => {
      if (connected) void toggleCamera();
    },
  });

  // A lost connection or a dead device needs the viewer: bring the panel back
  // from the pill so its notice and retry are on screen.
  const needsAttention = connectionState === "lost" || deviceError != null;
  useEffect(() => {
    if (needsAttention && panelMode === "minimized") onMaximize();
  }, [needsAttention, panelMode, onMaximize]);

  const elapsed = useCallDuration(startedAt != null, startedAt);
  let statusLabel: string;
  if (connectionState === "lost")
    statusLabel = t("chat.voice_call_connection_lost");
  else if (connectionState === "reconnecting")
    statusLabel = t("chat.voice_call_reconnecting");
  else if (!connected) statusLabel = t("chat.voice_call_connecting");
  else if (!live) {
    statusLabel = multiParty
      ? t("chat.voice_call_waiting_participants")
      : t("chat.voice_call_waiting_for_peer", { name: peerName });
  } else statusLabel = t("chat.voice_call_connected");

  const endForAll = () => onEndForAll();
  const leave = () => onLeave();
  const leaveFromNotice =
    callKind === "dm" ||
    (multiParty && isCaller && remoteParticipantCount === 0)
      ? endForAll
      : leave;
  const leaveLabel = multiParty
    ? t("chat.voice_call_leave")
    : t("chat.voice_call_end");

  const dragEnabled = panelMode === "expanded" || panelMode === "minimized";
  const {
    panelRef,
    style: panelStyle,
    dragHandleProps,
  } = useVoiceCallPanelDrag(dragEnabled, panelMode);

  return (
    <VoiceCallFloatingPanel
      peerName={peerName}
      statusLabel={statusLabel}
      duration={
        startedAt != null ? formatVoiceCallDuration(elapsed) : undefined
      }
      indicator={recording.recording ? <VoiceCallRecIndicator /> : undefined}
      mode={panelMode}
      onMinimize={onMinimize}
      onMaximize={onMaximize}
      panelRef={panelRef}
      panelStyle={panelStyle}
      dragHandleProps={dragEnabled ? dragHandleProps : undefined}
      live={
        <>
          <VoiceCallPresenceAnnouncer />
          {/* Toasts sit outside the fullscreen dialog, where a screen reader
                cannot hear them; the recording notice is repeated in here. */}
          {panelMode === "fullscreen" ? (
            <p role="status" className="sr-only">
              {recording.announcement}
            </p>
          ) : null}
        </>
      }
      notice={
        panelMode === "minimized" ? undefined : (
          <VoiceCallNotices onLeave={leaveFromNotice} leaveLabel={leaveLabel} />
        )
      }
      footer={
        <ActiveVoiceControls
          callKind={callKind}
          isCaller={isCaller}
          recording={recording}
          onLeave={leave}
          onEndForAll={endForAll}
          compact={panelMode === "minimized"}
        />
      }
    >
      {panelMode !== "minimized" ? (
        <VoiceCallVideoStage
          peerName={peerName}
          callKind={callKind}
          size={panelMode === "fullscreen" ? "fullscreen" : "compact"}
        />
      ) : null}
    </VoiceCallFloatingPanel>
  );
}
