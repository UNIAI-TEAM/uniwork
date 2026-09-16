"use client";

import { createContext, useContext } from "react";
import type { Room } from "livekit-client";
import type { VoiceCallParticipantTile } from "./voice-call-room-types";

export type { VoiceCallParticipantTile } from "./voice-call-room-types";
export { participantScreenShareKey } from "./voice-call-room-types";

type VoiceCallRoomContextValue = {
  room: Room | null;
  connected: boolean;
  remoteParticipantCount: number;
  participantTiles: VoiceCallParticipantTile[];
  needsAudioUnlock: boolean;
  muted: boolean;
  cameraEnabled: boolean;
  remoteCameraEnabled: boolean;
  screenShareEnabled: boolean;
  remoteScreenShareEnabled: boolean;
  toggleMute: () => void;
  toggleCamera: () => Promise<boolean>;
  toggleScreenShare: () => Promise<boolean>;
  unlockAudio: () => Promise<boolean>;
  bindLocalVideo: (el: HTMLVideoElement | null) => void;
  bindRemoteVideo: (el: HTMLVideoElement | null) => void;
  bindLocalScreenShare: (el: HTMLVideoElement | null) => void;
  bindRemoteScreenShare: (el: HTMLVideoElement | null) => void;
  bindParticipantVideo: (identity: string, el: HTMLVideoElement | null) => void;
  bindParticipantScreenShare: (identity: string, el: HTMLVideoElement | null) => void;
};

export const VoiceCallRoomContext = createContext<VoiceCallRoomContextValue>({
  room: null,
  connected: false,
  remoteParticipantCount: 0,
  needsAudioUnlock: false,
  muted: false,
  cameraEnabled: false,
  remoteCameraEnabled: false,
  screenShareEnabled: false,
  remoteScreenShareEnabled: false,
  toggleMute: () => undefined,
  toggleCamera: async () => false,
  toggleScreenShare: async () => false,
  unlockAudio: async () => false,
  bindLocalVideo: () => undefined,
  bindRemoteVideo: () => undefined,
  bindLocalScreenShare: () => undefined,
  bindRemoteScreenShare: () => undefined,
  bindParticipantVideo: () => undefined,
  bindParticipantScreenShare: () => undefined,
  participantTiles: [],
});

export function useVoiceCallRoom() {
  return useContext(VoiceCallRoomContext);
}
