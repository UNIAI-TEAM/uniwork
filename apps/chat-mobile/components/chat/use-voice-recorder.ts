// Recording a voice message on the phone, the web's use-chat-voice-recorder.ts
// on expo-audio: AAC in MPEG-4 (.m4a, which the server takes as audio/mp4), at
// most two minutes (the clip goes when the cap is reached), and the clock the
// composer shows while it runs.
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";

/** The server's cap (chat_voice_message.go) and the web recorder's. */
export const VOICE_MAX_MS = 120_000;

export interface VoiceClip {
  uri: string;
  durationMs: number;
}

export function useVoiceRecorder(onClip: (clip: VoiceClip) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [active, setActive] = useState(false);
  const onClipRef = useRef(onClip);
  onClipRef.current = onClip;

  /** Resolves false when the person refused the microphone. */
  const start = useCallback(async () => {
    if (!(await requestRecordingPermissionsAsync()).granted) return false;
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setActive(true);
    return true;
  }, [recorder]);

  const finish = useCallback(
    async (send: boolean) => {
      const durationMs = recorder.getStatus().durationMillis;
      setActive(false);
      await recorder.stop();
      // Back to playback routing: on iOS a recording session plays through the earpiece.
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (send && recorder.uri && durationMs > 0) onClipRef.current({ uri: recorder.uri, durationMs });
    },
    [recorder],
  );

  useEffect(() => {
    if (active && state.durationMillis >= VOICE_MAX_MS) void finish(true);
  }, [active, state.durationMillis, finish]);

  return { active, elapsedMs: state.durationMillis, start, send: () => finish(true), cancel: () => finish(false) };
}
