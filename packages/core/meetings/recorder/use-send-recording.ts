"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getMeeting } from "../../api/endpoints/meetings";
import { ApiError, errorCode } from "../../api/http";
import type { Meeting } from "../../types/meeting";
import { meetingKeys } from "../hooks";
import { useRecordMeetingHeld, useUploadMeetingRecording } from "../transcription-hooks";
import type { RecordingPart, RecordingStore } from "./store";
import { defaultStore } from "./use-meeting-recorder";

export type SendPhase = "idle" | "holding" | "uploading" | "waiting" | "failed" | "done";

/** A part left open by a closed tab ends at its last saved chunk. */
const endOf = (p: RecordingPart): number => p.endedAt ?? p.lastChunkAt;
const secondsBetween = (from: number, to: number): number => Math.round((to - from) / 1000);
/** While waiting, send again after 10 s, then 30 s, then every 60 s (the `online` event may never come). */
const WAIT_RETRY_MS = [10_000, 30_000, 60_000];

/** Name and lastModified come from the part, so the File rebuilt after a reload has the same upload key. */
function partFile(part: RecordingPart, blob: Blob): File {
  const type = part.mimeType || "audio/webm";
  const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
  return new File([blob], `ghi-am-${part.id}.${ext}`, { type, lastModified: part.startedAt });
}

/** fetch rejects with a TypeError when the network drops; an answer from the server never reads as one. */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (!(err instanceof ApiError) && typeof navigator !== "undefined" && navigator.onLine === false);
}

/**
 * Sends the in-app recording of a meeting from this device: records the meeting
 * held by its length (the server's clock decides the times) unless it already
 * ended, then uploads each part with its offset and deletes it from the device
 * only once the server queued it. A lost connection waits and sends again on
 * the `online` event; any other failure keeps the parts and leaves `error` for
 * the caller to word (the upload dialog's `uploadFailure`).
 */
export function useSendRecording(opts: { workspaceId: string; meeting: Meeting; userId: string; store?: RecordingStore }): {
  phase: SendPhase;
  percent: number;
  sentBytes: number;
  totalBytes: number;
  seconds: number;
  error: unknown;
  send(): Promise<void>;
  retry(): void;
  stop(): Promise<void>;
} {
  const { workspaceId, meeting, userId } = opts;
  const store = opts.store ?? defaultStore();
  const qc = useQueryClient();
  const held = useRecordMeetingHeld(workspaceId, meeting.id);
  const upload = useUploadMeetingRecording(meeting.id);
  const [phase, setPhase] = useState<SendPhase>("idle");
  const [error, setError] = useState<unknown>(null);
  // Failed attempts in a row while waiting: picks the retry delay, and re-arms the timer after each one.
  const [waits, setWaits] = useState(0);
  const [totals, setTotals] = useState({ doneBytes: 0, totalBytes: 0, seconds: 0, currentBytes: 0 });
  const running = useRef(false);
  const stopped = useRef(false);
  // Parts already sent by this hook, so a resume keeps counting from where it was.
  const sent = useRef({ bytes: 0, seconds: 0 });
  // The part in flight: a retry hands the same File back, so a staged upload is queued without resending a byte.
  const inFlight = useRef<{ id: string; file: File } | null>(null);

  const recordHeld = async (durationSeconds: number) => {
    try {
      await held.mutateAsync({ duration_seconds: durationSeconds });
    } catch (err) {
      if (errorCode(err) !== "invalid_meeting_state") throw err;
      // Another device recorded it first: what matters is that it has ended.
      const fresh = await qc.fetchQuery({
        queryKey: meetingKeys.detail(meeting.id),
        queryFn: () => getMeeting(meeting.id),
        staleTime: 0,
      });
      if (fresh?.status !== "ENDED") throw err;
    }
  };

  const send = async () => {
    if (running.current) return;
    running.current = true;
    stopped.current = false;
    setError(null);
    try {
      const parts = await store.listParts(userId, meeting.id);
      setTotals({
        doneBytes: sent.current.bytes,
        totalBytes: sent.current.bytes + parts.reduce((sum, p) => sum + p.bytes, 0),
        seconds: sent.current.seconds + parts.reduce((sum, p) => sum + secondsBetween(p.startedAt, endOf(p)), 0),
        currentBytes: 0,
      });
      if (parts.length > 0 && meeting.status === "SCHEDULED") {
        setPhase("holding");
        await recordHeld(secondsBetween(parts[0]!.startedAt, endOf(parts[parts.length - 1]!)));
      }
      for (const part of parts) {
        if (stopped.current) break;
        setPhase("uploading");
        const file = inFlight.current?.id === part.id ? inFlight.current.file : partFile(part, await store.readPart(part.id));
        inFlight.current = { id: part.id, file };
        const seconds = secondsBetween(part.startedAt, endOf(part));
        setTotals((t) => ({ ...t, currentBytes: part.bytes }));
        try {
          await upload.mutateAsync({ file, language: part.language, consent: true, durationSeconds: seconds, offsetSeconds: part.offsetSeconds });
        } catch (err) {
          // The queue request reached the server but its answer was lost: a fresh upload's file can only collide with itself.
          if (errorCode(err) !== "transcription_in_progress") throw err;
        }
        await store.deletePart(part.id);
        sent.current = { bytes: sent.current.bytes + part.bytes, seconds: sent.current.seconds + seconds };
        setTotals((t) => ({ ...t, doneBytes: sent.current.bytes, currentBytes: 0 }));
        void qc.invalidateQueries({ queryKey: ["meeting-recordings-local", userId] });
      }
      setPhase(stopped.current ? "idle" : "done");
      setWaits(0);
    } catch (err) {
      if (stopped.current) {
        setPhase("idle");
      } else if (isNetworkError(err)) {
        setError(err);
        setPhase("waiting");
        setWaits((n) => n + 1);
      } else {
        setError(err);
        setPhase("failed");
        setWaits(0);
      }
    } finally {
      running.current = false;
    }
  };

  const latestSend = useRef(send);
  latestSend.current = send;
  useEffect(() => {
    if (phase !== "waiting") return;
    const resume = () => void latestSend.current();
    const timer = setTimeout(resume, WAIT_RETRY_MS[Math.min(waits, WAIT_RETRY_MS.length) - 1]);
    window.addEventListener("online", resume);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", resume);
    };
  }, [phase, waits]);

  const stop = async () => {
    stopped.current = true;
    setPhase("idle");
    setWaits(0);
    await upload.cancel();
  };

  const sentBytes = Math.min(totals.totalBytes, Math.round(totals.doneBytes + (upload.percent / 100) * totals.currentBytes));
  const percent = phase === "done" ? 100 : totals.totalBytes > 0 ? Math.floor((sentBytes / totals.totalBytes) * 100) : 0;
  return {
    phase,
    percent,
    sentBytes,
    totalBytes: totals.totalBytes,
    seconds: totals.seconds,
    error,
    send,
    retry: () => void send(),
    stop,
  };
}
