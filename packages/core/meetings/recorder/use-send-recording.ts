"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { listMeetingTranscriptions } from "../../api/endpoints/meeting-transcriptions";
import { getMeeting } from "../../api/endpoints/meetings";
import { ApiError, errorCode } from "../../api/http";
import type { Meeting } from "../../types/meeting";
import { meetingKeys } from "../hooks";
import { useRecordMeetingHeld, useUploadMeetingRecording } from "../transcription-hooks";
import { TIMESLICE_MS } from "./recorder";
import { isLivePart, type RecordingPart, type RecordingStore } from "./store";
import { defaultStore, useScreenWakeLock } from "./use-meeting-recorder";

export type SendPhase = "idle" | "holding" | "uploading" | "waiting" | "failed" | "done";

/** A part left open by a closed tab ends at its last saved chunk. */
const endOf = (p: RecordingPart): number => p.endedAt ?? p.lastChunkAt;
/**
 * The audio in a part ends one timeslice after its last chunk at most: a part
 * ended at unlock after an iOS lock holds no sound for the locked minutes, which
 * must not reach the estimate, the quota or the length shown. The meeting went
 * on meanwhile, so the held length still runs to `endOf`.
 */
const audioSeconds = (p: RecordingPart): number => secondsBetween(p.startedAt, Math.min(endOf(p), p.lastChunkAt + TIMESLICE_MS));
const secondsBetween = (from: number, to: number): number => Math.round((to - from) / 1000);
/** While waiting, send again after 10 s, then 30 s, then every 60 s (the `online` event may never come). */
const WAIT_RETRY_MS = [10_000, 30_000, 60_000];

/** The part's file name: unique per part, so the server's transcription of it carries the name back. */
function partName(part: RecordingPart): string {
  const type = part.mimeType || "audio/webm";
  return `ghi-am-${part.id}.${type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm"}`;
}

/** Name and lastModified come from the part, so the File rebuilt after a reload has the same upload key. */
function partFile(part: RecordingPart, blob: Blob): File {
  return new File([blob], partName(part), { type: part.mimeType || "audio/webm", lastModified: part.startedAt });
}

/** fetch rejects with a TypeError when the network drops; an answer from the server never reads as one. */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (!(err instanceof ApiError) && typeof navigator !== "undefined" && navigator.onLine === false);
}

/**
 * Sends the in-app recording of a meeting from this device: records the meeting
 * held by its length and how long ago it ended (the server's clock decides the
 * times) unless it already ended, then uploads each part with its offset and deletes it from the device
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
  useScreenWakeLock(phase === "holding" || phase === "uploading");

  const recordHeld = async (durationSeconds: number, endedSecondsAgo: number) => {
    try {
      await held.mutateAsync({ duration_seconds: durationSeconds, ended_seconds_ago: endedSecondsAgo });
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
      // Never a part another tab is still writing: it would be cut short and deleted under that tab.
      const now = Date.now();
      const settled = (await store.listParts(userId, meeting.id)).filter((p) => !isLivePart(p, now));
      // A part the recorder opened but never wrote to (it failed to start) has nothing to send, and an
      // empty file would be refused (415) ahead of every later part.
      await Promise.all(settled.filter((p) => p.bytes === 0).map((p) => store.deletePart(p.id)));
      const parts = settled.filter((p) => p.bytes > 0);
      setTotals({
        doneBytes: sent.current.bytes,
        totalBytes: sent.current.bytes + parts.reduce((sum, p) => sum + p.bytes, 0),
        seconds: sent.current.seconds + parts.reduce((sum, p) => sum + audioSeconds(p), 0),
        currentBytes: 0,
      });
      if (parts.length > 0 && meeting.status === "SCHEDULED") {
        setPhase("holding");
        const end = endOf(parts[parts.length - 1]!);
        // The recording's own base, which every offset counts from (a dropped empty part may have fixed it).
        const base = parts[0]!.startedAt - parts[0]!.offsetSeconds * 1000;
        // Both lengths on this device's clock, so a send hours later keeps the meeting's own time on the server.
        await recordHeld(secondsBetween(base, end), Math.max(0, secondsBetween(end, Date.now())));
      }
      // A part queued before its answer was lost and the page reloaded: a new upload would get a new file id the
      // server cannot match, so only the name says it is there already. A failed transcription is sent again.
      const queuedNames = new Set(
        parts.length === 0
          ? []
          : (
              await qc.fetchQuery({
                queryKey: meetingKeys.transcriptions(meeting.id),
                queryFn: () => listMeetingTranscriptions(meeting.id),
                staleTime: 0,
              })
            )
              .filter((t) => t.status !== "FAILED")
              .map((t) => t.filename),
      );
      const markSent = async (part: RecordingPart) => {
        await store.deletePart(part.id);
        sent.current = { bytes: sent.current.bytes + part.bytes, seconds: sent.current.seconds + audioSeconds(part) };
        setTotals((t) => ({ ...t, doneBytes: sent.current.bytes, currentBytes: 0 }));
        void qc.invalidateQueries({ queryKey: ["meeting-recordings-local", userId] });
      };
      // Largest first: a summary queued when the first part completes then covers most of the meeting.
      // shortcut: after an offline pause that follows the largest part, the summary may miss the small fragments; redo it on the last part when that matters.
      for (const part of [...parts].sort((a, b) => b.bytes - a.bytes)) {
        if (stopped.current) break;
        if (queuedNames.has(partName(part))) {
          await markSent(part);
          continue;
        }
        setPhase("uploading");
        const file = inFlight.current?.id === part.id ? inFlight.current.file : partFile(part, await store.readPart(part.id));
        inFlight.current = { id: part.id, file };
        const seconds = audioSeconds(part);
        setTotals((t) => ({ ...t, currentBytes: part.bytes }));
        const queue = (offsetSeconds?: number) =>
          upload.mutateAsync({ file, language: part.language, consent: true, durationSeconds: seconds, offsetSeconds });
        try {
          try {
            await queue(part.offsetSeconds);
          } catch (err) {
            // Another device ended the meeting first, shorter than this offset: the server chains the part after the others.
            if (errorCode(err) !== "invalid_offset") throw err;
            await queue();
          }
        } catch (err) {
          // The queue request reached the server but its answer was lost: a fresh upload's file can only collide with itself.
          if (errorCode(err) !== "transcription_in_progress") throw err;
        }
        await markSent(part);
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
