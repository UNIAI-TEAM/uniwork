"use client";

import { VoiceCallRoom } from "./voice-call-room";
import { ActiveVoiceCallContent } from "./voice-call-active-content";
import type { VoiceCallKind } from "./voice-call-overlay-types";
import type { VoiceCallPanelMode } from "./voice-call-floating-panel";

export function ActiveVoiceCallSession({
  workspaceId,
  roomId,
  callId,
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
  onDisconnected,
  onEndForAll,
  onConnected,
  onConnectFailed,
}: {
  workspaceId: string;
  roomId: string;
  callId: string;
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
  onDisconnected: () => void;
  onEndForAll: () => void;
  onConnected: () => void;
  onConnectFailed: () => void;
}) {
  return (
    <VoiceCallRoom
      url={url}
      token={token}
      initialCameraEnabled={initialCameraEnabled}
      onDisconnected={onDisconnected}
      onConnectFailed={onConnectFailed}
    >
      <ActiveVoiceCallContent
        workspaceId={workspaceId}
        roomId={roomId}
        callId={callId}
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
