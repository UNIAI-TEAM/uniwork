"use client";

const SAMPLE_RATE = 22050;
/** C5 → E5 → G5: rising, short, unmistakably a test and not a call chime. */
const NOTES: ReadonlyArray<{ frequency: number; start: number; duration: number }> = [
  { frequency: 523.25, start: 0, duration: 0.22 },
  { frequency: 659.25, start: 0.2, duration: 0.22 },
  { frequency: 783.99, start: 0.4, duration: 0.42 },
];
const LENGTH_S = 0.9;
const PEAK = 0.28;
/** Fade in/out per note, so the notes do not click. */
const FADE_S = 0.02;

/**
 * A 16-bit mono WAV of the test arpeggio. Built in memory (no asset) so an
 * `<audio>` element can play it: unlike Web Audio, an element takes
 * `setSinkId`, which is what sends the sound to the chosen speaker.
 */
export function speakerTestWav(): Uint8Array<ArrayBuffer> {
  const frames = Math.round(SAMPLE_RATE * LENGTH_S);
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
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
  view.setUint32(40, frames * 2, true);

  for (let i = 0; i < frames; i++) {
    const t = i / SAMPLE_RATE;
    let sample = 0;
    for (const note of NOTES) {
      const local = t - note.start;
      if (local < 0 || local > note.duration) continue;
      const envelope = Math.min(1, local / FADE_S, (note.duration - local) / FADE_S);
      sample += Math.sin(2 * Math.PI * note.frequency * local) * envelope;
    }
    const clamped = Math.max(-1, Math.min(1, sample * PEAK));
    view.setInt16(44 + i * 2, Math.round(clamped * 0x7fff), true);
  }
  return bytes;
}

type SinkableAudio = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };

/**
 * Plays the test sound on `deviceId` (or the system default when the browser
 * cannot pick an output) and resolves when it has finished. Rejects when the
 * browser refuses to play or to route to that device.
 */
export async function playSpeakerTest(deviceId?: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([speakerTestWav()], { type: "audio/wav" }));
  const audio = new Audio(url) as SinkableAudio;
  try {
    if (deviceId && typeof audio.setSinkId === "function") await audio.setSinkId(deviceId);
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("speaker test failed"));
      audio.play().catch(reject);
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
