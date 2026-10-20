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

// Back to playback routing: on iOS a recording session plays through the earpiece.
const playbackMode = () => setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });

export function useVoiceRecorder(onClip: (clip: VoiceClip) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [active, setActive] = useState(false);
  // Set while a clip records; finish() takes it, so the cap and a tap on send cannot both send it.
  const recording = useRef(false);
  const onClipRef = useRef(onClip);
  onClipRef.current = onClip;

  /** Resolves false when the person refused the microphone; rejects when the recorder would not start. */
  const start = useCallback(async () => {
    if (!(await requestRecordingPermissionsAsync()).granted) return false;
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (error) {
      await playbackMode();
      throw error;
    }
    recording.current = true;
    setActive(true);
    return true;
  }, [recorder]);

  const finish = useCallback(
    async (send: boolean) => {
      if (!recording.current) return;
      recording.current = false;
      const durationMs = recorder.getStatus().durationMillis;
      setActive(false);
      await recorder.stop();
      await playbackMode();
      if (send && recorder.uri && durationMs > 0) onClipRef.current({ uri: recorder.uri, durationMs });
    },
    [recorder],
  );

  useEffect(() => {
    if (active && state.durationMillis >= VOICE_MAX_MS) void finish(true);
  }, [active, state.durationMillis, finish]);

  // Leaving the conversation mid-clip drops it (expo-audio releases the
  // recorder as the screen goes) and gives the audio back to playback.
  useEffect(
    () => () => {
      if (!recording.current) return;
      recording.current = false;
      void playbackMode().catch(() => undefined);
    },
    [],
  );

  return { active, elapsedMs: state.durationMillis, start, send: () => finish(true), cancel: () => finish(false) };
}
