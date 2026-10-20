// The phone's use-call-ringtone: the web's tones (lib/call-ringtone.ts, as WAV
// loops) while a call rings, and a buzz on the same beat for an incoming one.
import { createAudioPlayer } from "expo-audio";
import { useEffect } from "react";
import { Vibration } from "react-native";
import incoming from "@/assets/sounds/ring-incoming.wav";
import outgoing from "@/assets/sounds/ring-outgoing.wav";
import { INCOMING_VIBRATION, type CallRingtoneKind } from "@/lib/call-ringtone";

const SOUNDS: Record<CallRingtoneKind, number> = { incoming, outgoing };

export function useCallRingtone(kind: CallRingtoneKind | null) {
  useEffect(() => {
    if (!kind) return;
    const player = createAudioPlayer(SOUNDS[kind]);
    player.loop = true;
    player.play();
    if (kind === "incoming") Vibration.vibrate(INCOMING_VIBRATION, true);
    return () => {
      player.remove();
      Vibration.cancel();
    };
  }, [kind]);
}
