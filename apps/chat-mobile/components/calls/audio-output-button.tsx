// The call's audio button (audit P2 Calls). Android: the phone alone toggles
// speaker and earpiece as before; with a wired or Bluetooth headset there a
// tap lists every output (LiveKit's AudioSession) and marks the one in use.
// iOS: the system's own route picker (speaker, receiver, AirPods, CarPlay).
import { AudioSession } from "@livekit/react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { ActionSheet } from "@/components/ui/action-sheet";
import { toast } from "@/data/stores/toast-store";
import { AUDIO_OUTPUT_ICONS, AUDIO_OUTPUT_LABEL_KEYS, audioOutputOptions, automaticOutput, isSpeakerToggle, type AudioOutput } from "@/lib/audio-outputs";
import { CallButton } from "./call-surface";

async function reportedOutputs(): Promise<string[]> {
  return AudioSession.getAudioOutputs().catch(() => []);
}

export function AudioOutputButton({ video, connected }: { video: boolean; connected: boolean }) {
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
