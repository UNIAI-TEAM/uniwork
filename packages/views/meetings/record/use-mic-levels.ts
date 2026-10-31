"use client";
import { useEffect, useState } from "react";
import { rmsLevel } from "../../chat/use-chat-voice-recorder";
import { audioContextCtor } from "../meeting-room-mic-check";

/**
 * The last `bars` input levels of `stream` (0..1, oldest first), one every
 * 150 ms, for a scrolling wave. All zeros without a stream or where the browser
 * has no Web Audio; a disabled (paused) track reads as silence.
 */
export function useMicLevels(stream: MediaStream | null, bars: number): number[] {
  const [levels, setLevels] = useState<number[]>([]);

  useEffect(() => {
    const Ctor = audioContextCtor();
    if (!stream || !Ctor) return;
    const ctx = new Ctor();
    // Opened without a user gesture the context starts suspended and reads only silence.
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      const level = rmsLevel(samples);
      setLevels((prev) => [...prev.slice(-(bars - 1)), level]);
    }, 150);
    return () => {
      clearInterval(timer);
      void ctx.close();
      setLevels([]);
    };
  }, [stream, bars]);

  return Array.from({ length: bars }, (_, i) => levels[levels.length - bars + i] ?? 0);
}
