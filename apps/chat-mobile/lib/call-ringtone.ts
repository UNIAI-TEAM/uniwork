// The ringtones of packages/views/chat/use-call-ringtone.ts: the same tones,
// gaps and loop lengths (keep in parity), rendered once into the WAV files in
// assets/sounds/ because React Native has no Web Audio to synthesise them live.
// call-ringtone.test.ts fails when the files and these patterns drift; rewrite
// them with UPDATE_RINGTONES=1 pnpm exec vitest run lib/call-ringtone.test.ts.
export type CallRingtoneKind = "incoming" | "outgoing";

interface Tone {
  frequency: number;
  ms: number;
  atMs: number;
}

export const RINGTONES: Record<CallRingtoneKind, { tones: Tone[]; loopMs: number }> = {
  incoming: {
    tones: [
      { frequency: 440, ms: 180, atMs: 0 },
      { frequency: 480, ms: 180, atMs: 220 },
    ],
    loopMs: 2200,
  },
  outgoing: {
    tones: [
      { frequency: 400, ms: 320, atMs: 0 },
      { frequency: 350, ms: 320, atMs: 380 },
    ],
    loopMs: 1800,
  },
};

/** The incoming ring buzzes on the same beat: [wait, buzz, wait, buzz, …] (Android; iOS has its own). */
export const INCOMING_VIBRATION = [0, 180, 40, 180, 1800];

const SAMPLE_RATE = 8000;
// The web's GainNode level.
const GAIN = 0.12;

/** One loop of a ringtone as a 16-bit mono PCM WAV file. */
export function ringtoneWav(kind: CallRingtoneKind): Uint8Array {
  const { tones, loopMs } = RINGTONES[kind];
  const samples = Math.round((loopMs / 1000) * SAMPLE_RATE);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  for (const tone of tones) {
    const start = Math.round((tone.atMs / 1000) * SAMPLE_RATE);
    const length = Math.round((tone.ms / 1000) * SAMPLE_RATE);
    for (let i = 0; i < length; i++) {
      const value = Math.round(Math.sin((2 * Math.PI * tone.frequency * i) / SAMPLE_RATE) * GAIN * 32767);
      view.setInt16(44 + (start + i) * 2, value, true);
    }
  }
  return bytes;
}

/** Which ringtone a call state plays: the callee hears one, the caller another, nobody else any. */
export function ringtoneFor(status: string): CallRingtoneKind | null {
  if (status === "incoming") return "incoming";
  if (status === "ringing") return "outgoing";
  return null;
}
