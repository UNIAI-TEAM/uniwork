// The system's own mute button on a call (CallKit's in-call screen on iPhone, docs/adr/0038): it mutes and unmutes
// the call's microphone as the call screen's button does. Android's call notification has no mute button, so nothing
// arrives there.
import type { Room } from "livekit-client";
import { useEffect } from "react";
import { nativeCallSession } from "@/data/calls/native-call-session";
import { bestEffort } from "@/data/report";

export function useSystemMute(room: Room, connected: boolean): void {
  useEffect(() => {
    if (!connected) return;
    return nativeCallSession.subscribe((event) => {
      if (event.type !== "muted") return;
      void room.localParticipant.setMicrophoneEnabled(!event.muted).catch(bestEffort("calls", "microphone not set from the system's mute", "report"));
    });
  }, [room, connected]);
}
