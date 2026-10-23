// The phone's own call during a UniChat call (review P2, in-call-ergonomics; Android 12+, modules/unichat-calls ›
// CallInterruptions.kt). Without Telecom, Android neither holds nor mutes a VoIP call when a cellular call is
// answered, so both would fight over the same output: while the phone's call has the line, the UniChat call is held
// here — our microphone off (the other side hears silence, not our phone call) and every other participant at zero
// volume (RemoteParticipant.setVolume, which a track subscribed meanwhile keeps), someone who joins meanwhile too.
// The line given back, the others are heard again and the microphone comes back only if it was on. The call screen
// says so (call-room.tsx).
import { ConnectionState, RoomEvent, type RemoteParticipant, type Room } from "livekit-client";
import { useEffect, useState } from "react";
import { nativeCalls } from "@/data/calls/native-calls";
import { bestEffort } from "@/data/report";

/** Whether the phone's own call has the line now; false where nothing watches it (iOS, before Android 12). */
function useCallHeld(): boolean {
  const [held, setHeld] = useState(() => nativeCalls.isCallHeld());
  useEffect(() => {
    return nativeCalls.onCallHeld(setHeld);
  }, []);
  return held;
}

function silence(room: Room, volume: number): void {
  for (const participant of room.remoteParticipants.values()) participant.setVolume(volume);
}

/** Holds the call while the phone's own call has the line; returns whether it is held. */
export function useCellularHold(room: Room, connected: boolean): boolean {
  const held = useCallHeld();
  useEffect(() => {
    if (!held || !connected) return;
    const local = room.localParticipant;
    const micWasOn = local.isMicrophoneEnabled;
    if (micWasOn) void local.setMicrophoneEnabled(false).catch(bestEffort("calls", "microphone not muted for a phone call", "report"));
    silence(room, 0);
    const onJoined = (participant: RemoteParticipant) => participant.setVolume(0);
    room.on(RoomEvent.ParticipantConnected, onJoined);
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoined);
      silence(room, 1);
      if (micWasOn && room.state === ConnectionState.Connected) {
        void local.setMicrophoneEnabled(true).catch(bestEffort("calls", "microphone not restored after a phone call", "report"));
      }
    };
  }, [held, connected, room]);
  return held;
}
