"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ChatVoiceRecorderState =
  | "idle"
  | "requesting"
  | "recording"
  | "ready"
  | "uploading";

export type ChatVoiceRecording = {
  blob: Blob;
  durationMs: number;
  url: string;
};

const MAX_DURATION_MS = 120_000;
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4",
] as const;

function supportedMimeType(): string {
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function useChatVoiceRecorder() {
  const [state, setState] = useState<ChatVoiceRecorderState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recording, setRecording] = useState<ChatVoiceRecording | null>(null);
  const [error, setError] = useState<unknown>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stopResolveRef = useRef<((value: ChatVoiceRecording | null) => void) | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const clearRecording = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setRecording(null);
  }, []);

  const cancel = useCallback(() => {
    requestIdRef.current += 1;
    stopResolveRef.current?.(null);
    stopResolveRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    stopTracks();
    clearRecording();
    setElapsedMs(0);
    setError(null);
    setState("idle");
  }, [clearRecording, stopTracks]);

  const stop = useCallback((): Promise<ChatVoiceRecording | null> => {
    if (recording) return Promise.resolve(recording);
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return Promise.resolve(null);
    return new Promise((resolve) => {
      stopResolveRef.current = resolve;
      recorder.stop();
    });
  }, [recording]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    const requestId = ++requestIdRef.current;
    setError(null);
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (requestId !== requestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = supportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const durationMs = Math.min(Date.now() - startedAtRef.current, MAX_DURATION_MS);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType });
        const result = blob.size > 0
          ? { blob, durationMs, url: URL.createObjectURL(blob) }
          : null;
        objectUrlRef.current = result?.url ?? null;
        recorderRef.current = null;
        stopTracks();
        setRecording(result);
        setElapsedMs(durationMs);
        setState(result ? "ready" : "idle");
        stopResolveRef.current?.(result);
        stopResolveRef.current = null;
      };
      recorder.start();
      setState("recording");
    } catch (cause) {
      stopTracks();
      setError(cause);
      setState("idle");
    }
  }, [state, stopTracks]);

  const upload = useCallback(
    async (send: (value: ChatVoiceRecording) => Promise<void>) => {
      const value = await stop();
      if (!value) return;
      setState("uploading");
      setError(null);
      try {
        await send(value);
        clearRecording();
        setElapsedMs(0);
        setState("idle");
      } catch (cause) {
        setError(cause);
        setState("ready");
      }
    },
    [clearRecording, stop],
  );

  useEffect(() => {
    if (state !== "recording") return;
    const timer = window.setInterval(() => {
      const next = Date.now() - startedAtRef.current;
      setElapsedMs(Math.min(next, MAX_DURATION_MS));
      if (next >= MAX_DURATION_MS) void stop();
    }, 200);
    return () => window.clearInterval(timer);
  }, [state, stop]);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      stopTracks();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [stopTracks],
  );

  return { state, elapsedMs, recording, error, start, stop, cancel, upload };
}
