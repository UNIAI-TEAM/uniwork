// Where a call's audio goes (the speaker button used to only toggle
// speaker/earpiece; a Bluetooth headset could not be picked). Android lists
// the outputs LiveKit can route to (AudioSession.getAudioOutputs); iOS shows
// its own route picker instead. A voice call starts on the earpiece, a video
// call on the speaker, a headset or Bluetooth device before either.

export type AudioOutput = "bluetooth" | "headset" | "earpiece" | "speaker";

const ORDER: readonly AudioOutput[] = ["bluetooth", "headset", "earpiece", "speaker"];

/** LiveKit's preferredOutputList for a new call. */
export function preferredOutputs(video: boolean): AudioOutput[] {
  return video ? ["bluetooth", "headset", "speaker", "earpiece"] : [...ORDER];
}

/** Where LiveKit routed a new call by itself: the first preferred output that is there. */
export function automaticOutput(video: boolean, reported: readonly string[]): AudioOutput {
  return preferredOutputs(video).find((output) => reported.includes(output)) ?? (video ? "speaker" : "earpiece");
}

/** The outputs Android reported, known ones only, in a stable order. */
export function audioOutputOptions(reported: readonly string[]): AudioOutput[] {
  return ORDER.filter((output) => reported.includes(output));
}

/**
 * The screen goes off near the ear (Android's proximity wake lock, modules/unichat-calls › CallProximity): only for a
 * voice call that is connected and plays on the earpiece, while its full screen is in front of the person (`onScreen`:
 * not shrunk to a pill, the app not in the background). On the speaker, a headset or in a video call the person looks
 * at the screen; with the call shrunk they read a chat, and in the background another app — the wake lock acts on the
 * whole system — so a hand over the sensor must not blank it.
 */
export function proximityScreenOff(call: { connected: boolean; video: boolean; output: AudioOutput; onScreen: boolean }): boolean {
  return call.connected && !call.video && call.output === "earpiece" && call.onScreen;
}

/** Only the phone's own two: a tap toggles between them, no list to choose from. */
export function isSpeakerToggle(options: readonly AudioOutput[]): boolean {
  return options.every((output) => output === "speaker" || output === "earpiece");
}

export const AUDIO_OUTPUT_LABEL_KEYS: Record<AudioOutput, string> = {
  bluetooth: "mobile.call_audio.bluetooth",
  headset: "mobile.call_audio.headset",
  earpiece: "mobile.call_audio.earpiece",
  speaker: "chat.mobile.call_speaker",
};

export const AUDIO_OUTPUT_ICONS = {
  bluetooth: "bluetooth",
  headset: "headset",
  earpiece: "call",
  speaker: "volume-high",
} as const satisfies Record<AudioOutput, string>;
