// The call's audio button (audit P2 Calls). Android: the phone alone toggles
// speaker and earpiece as before; with a wired or Bluetooth headset there a
// tap lists every output (LiveKit's AudioSession) and marks the one in use.
// iOS: the system's own route picker (speaker, receiver, AirPods, CarPlay).
// A connected voice call on the earpiece turns the screen off at the ear
// (Android; lib/audio-outputs.ts › proximityScreenOff), released when it moves
// off the earpiece, the call shrinks to a pill (`onScreen`), the app goes to
// the background, or the call screen goes.
import { AudioSession } from "@livekit/react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppState, Platform } from "react-native";
import { ActionSheet } from "@/components/ui/action-sheet";
import { nativeCalls } from "@/data/calls/native-calls";
import { bestEffort } from "@/data/report";
import { toast } from "@/data/stores/toast-store";
import {
  AUDIO_OUTPUT_ICONS,
  AUDIO_OUTPUT_LABEL_KEYS,
  audioOutputOptions,
  automaticOutput,
  isSpeakerToggle,
  proximityScreenOff,
  type AudioOutput,
} from "@/lib/audio-outputs";
import { CallButton } from "./call-surface";

/** The outputs LiveKit reports; none when it cannot say (the speaker toggle stands in). */
async function reportedOutputs(): Promise<string[]> {
  return (await AudioSession.getAudioOutputs().catch(bestEffort("calls", "audio outputs not listed", "breadcrumb"))) ?? [];
}

/** Whether the app is in front: the proximity wake lock acts on the whole system, not on this app alone. */
function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => sub.remove();
  }, []);
  return active;
}

/** `onScreen`: the call's full screen is shown (not shrunk to a pill). */
export function AudioOutputButton({ video, connected, onScreen }: { video: boolean; connected: boolean; onScreen: boolean }) {
  const { t } = useTranslation();
  const ios = Platform.OS === "ios";
  const [current, setCurrent] = useState<AudioOutput>(video ? "speaker" : "earpiece");
  const [options, setOptions] = useState<AudioOutput[] | null>(null);

  // Once the room is up LiveKit has routed the call by itself (call-room.tsx › preferredOutputs): show where.
  useEffect(() => {
    if (ios || !connected) return;
    let cancelled = false;
    void reportedOutputs().then((reported) => {
      if (!cancelled) setCurrent(automaticOutput(video, reported));
    });
    return () => {
      cancelled = true;
    };
  }, [connected, ios, video]);

  // The no-op module stands in on iOS, so no platform branch here.
  const appActive = useAppActive();
  const atTheEar = proximityScreenOff({ connected, video, output: current, onScreen: onScreen && appActive });
  useEffect(() => {
    if (!atTheEar) return;
    nativeCalls.setProximityScreenOff(true);
    return () => nativeCalls.setProximityScreenOff(false);
  }, [atTheEar]);

  const choose = (output: AudioOutput) => {
    setOptions(null);
    const previous = current;
    setCurrent(output);
    AudioSession.selectAudioOutput(output).catch(() => {
      setCurrent(previous);
      toast.error(t("mobile.call_audio.failed"));
    });
  };

  const onPress = async () => {
    if (ios) {
      await AudioSession.showAudioRoutePicker().catch(() => toast.error(t("mobile.call_audio.failed")));
      return;
    }
    const outputs = audioOutputOptions(await reportedOutputs());
    if (isSpeakerToggle(outputs)) choose(current === "speaker" ? "earpiece" : "speaker");
    else setOptions(outputs);
  };

  return (
    <>
      <CallButton
        icon={ios ? "volume-high" : AUDIO_OUTPUT_ICONS[current]}
        label={ios ? t("mobile.call_audio.title") : t(AUDIO_OUTPUT_LABEL_KEYS[current])}
        active={!ios && current !== "earpiece"}
        testID="call-speaker"
        onPress={() => void onPress()}
      />
      <ActionSheet
        visible={options !== null}
        onClose={() => setOptions(null)}
        title={t("mobile.call_audio.title")}
        actions={(options ?? []).map((output) => {
          const label = t(AUDIO_OUTPUT_LABEL_KEYS[output]);
          return {
            key: output,
            label: output === current ? t("mobile.call_audio.in_use", { output: label }) : label,
            icon: AUDIO_OUTPUT_ICONS[output],
            onPress: () => choose(output),
          };
        })}
      />
    </>
  );
}
