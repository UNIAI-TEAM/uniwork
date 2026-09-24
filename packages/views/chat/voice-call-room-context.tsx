"use client";

import { createContext, useContext } from "react";
import type { VoiceCallDeviceError } from "./voice-call-overlay-types";
import type { VoiceCallParticipantTile } from "./voice-call-room-types";

/**
 * connecting: first join. reconnecting: LiveKit is healing a dropped link
 * on its own. lost: the link is gone and needs the viewer (retry or leave).
 */
export type VoiceCallConnectionState = "connecting" | "connected" | "reconnecting" | "lost";

/** Call state the controls and the status line read. Changes rarely. */
type VoiceCallStatusValue = {
  connectionState: VoiceCallConnectionState;
  /** Joined the room at least once and not lost since. */
  connected: boolean;
  remoteParticipantCount: number;
  needsAudioUnlock: boolean;
  muted: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  deviceError: VoiceCallDeviceError | null;
};

/**
 * Tiles and video bindings. Changes on every active-speaker update, so only
 * the stage reads it — the control row does not re-render when someone talks.
 */
type VoiceCallMediaValue = {
  participantTiles: VoiceCallParticipantTile[];
  remoteCameraEnabled: boolean;
  remoteScreenShareEnabled: boolean;
  bindLocalVideo: (el: HTMLVideoElement | null) => void;
  bindRemoteVideo: (el: HTMLVideoElement | null) => void;
  bindLocalScreenShare: (el: HTMLVideoElement | null) => void;
  bindRemoteScreenShare: (el: HTMLVideoElement | null) => void;
  bindParticipantVideo: (identity: string, el: HTMLVideoElement | null) => void;
  bindParticipantScreenShare: (identity: string, el: HTMLVideoElement | null) => void;
};

/** Stable callbacks. */
type VoiceCallActionsValue = {
  toggleMute: () => Promise<boolean>;
  toggleCamera: () => Promise<boolean>;
  toggleScreenShare: () => Promise<boolean>;
  unlockAudio: () => Promise<boolean>;
  retryConnection: () => void;
};

const noopAsync = async () => false;

export const VoiceCallStatusContext = createContext<VoiceCallStatusValue>({
  connectionState: "connecting",
  connected: false,
  remoteParticipantCount: 0,
  needsAudioUnlock: false,
  muted: false,
  cameraEnabled: false,
  screenShareEnabled: false,
  deviceError: null,
});

export const VoiceCallMediaContext = createContext<VoiceCallMediaValue>({
  participantTiles: [],
  remoteCameraEnabled: false,
  remoteScreenShareEnabled: false,
  bindLocalVideo: () => undefined,
  bindRemoteVideo: () => undefined,
  bindLocalScreenShare: () => undefined,
  bindRemoteScreenShare: () => undefined,
  bindParticipantVideo: () => undefined,
  bindParticipantScreenShare: () => undefined,
});

export const VoiceCallActionsContext = createContext<VoiceCallActionsValue>({
  toggleMute: noopAsync,
  toggleCamera: noopAsync,
  toggleScreenShare: noopAsync,
  unlockAudio: noopAsync,
  retryConnection: () => undefined,
});

export function useVoiceCallStatus() {
  return useContext(VoiceCallStatusContext);
}

export function useVoiceCallMedia() {
  return useContext(VoiceCallMediaContext);
}

export function useVoiceCallActions() {
  return useContext(VoiceCallActionsContext);
}
