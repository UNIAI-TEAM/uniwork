"use client";
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/meeting-transcriptions";
import { ChunkedUploadError } from "../documents/chunked-upload";
import { useChunkedDocumentUpload } from "../documents/use-chunked-document-upload";
import { DocumentNotVerifiableError, type DocumentUpload } from "../types/document";
import { meetingKeys } from "./hooks";

// Meetings held without a room (UNI-2001): "record as held", and an uploaded
// recording transcribed in batch. Both await the server (they navigate state
// across screens and are not locally predictable).

const TRANSCRIPTION_POLL_MS = 15_000;
const OPEN = new Set(["QUEUED", "RUNNING"]);

export function useMeetingTranscriptions(meetingId: string, enabled = true) {
  return useQuery({
    queryKey: meetingKeys.transcriptions(meetingId),
    queryFn: () => api.listMeetingTranscriptions(meetingId),
    enabled: enabled && Boolean(meetingId),
    // Poll while any part is still being transcribed: an in-person recording sends several (UNI-2247).
    refetchInterval: (q) => (q.state.data?.some((t) => OPEN.has(t.status)) ? TRANSCRIPTION_POLL_MS : false),
  });
}

export function useRecordMeetingHeld(workspaceId: string, meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Parameters<typeof api.recordMeetingHeld>[1]) => api.recordMeetingHeld(meetingId, v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
      // Awaited: the caller then moves focus into the ended meeting's panels, which this refetch mounts.
      return qc.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
    },
  });
}

interface UploadRecordingInput {
  file: File;
  language: "vi" | "en";
  consent: boolean;
  /** The length the browser read from the file; undefined when it could not. */
  durationSeconds?: number;
  /** Seconds from the meeting's actual start; an in-app recording always sends it. */
  offsetSeconds?: number;
}

/**
 * Sends the file through the shared upload session, then queues it. The
 * session is remembered per file (StorageAdapter), so sending the same file
 * again after a failure resumes it; `cancel` drops it (the attempt then
 * rejects with `upload_canceled`); leaving the screen pauses it, so nothing
 * is queued without the dialog that asked for it, even when the server
 * finishes verifying the file after that. Once the queue request is sent it
 * cannot be taken back.
 */
export function useUploadMeetingRecording(meetingId: string) {
  const qc = useQueryClient();
  const chunked = useChunkedDocumentUpload({ kind: "meeting_audio", meetingId });
  // The file already staged: a retry after the queue step failed sends no byte again.
  const staged = useRef<{ file: File; upload: DocumentUpload } | null>(null);
  // Stop, or leaving the screen: the server may still be verifying the file (a
  // pause cannot stop that step), and what it finishes must not be queued.
  const stopped = useRef(false);
  useEffect(() => {
    stopped.current = false;
    return () => {
      stopped.current = true;
    };
  }, []);
  const mutation = useMutation({
    mutationFn: async (v: UploadRecordingInput) => {
      stopped.current = false;
      const kept = staged.current;
      let upload: DocumentUpload;
      if (kept?.file === v.file && Date.parse(kept.upload.claim_expires_at) > Date.now()) {
        upload = kept.upload;
      } else {
        const done = await chunked.start({
          file: v.file,
          target: { kind: "meeting_audio", meetingId, durationSeconds: v.durationSeconds },
        });
        // A meeting_audio session completes into a staged upload, never a document.
        if (done.kind !== "upload") throw new DocumentNotVerifiableError();
        upload = done.upload;
        staged.current = { file: v.file, upload };
      }
      if (stopped.current) throw new ChunkedUploadError("upload_canceled", "Upload was stopped");
      return api.requestMeetingTranscription(meetingId, {
        upload_id: upload.upload_id,
        language: v.language,
        consent: v.consent,
        ...(v.durationSeconds ? { duration_seconds: v.durationSeconds } : {}),
        ...(v.offsetSeconds !== undefined ? { offset_seconds: v.offsetSeconds } : {}),
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.transcriptions(meetingId) });
    },
  });
  const cancel = () => {
    stopped.current = true;
    return chunked.cancel();
  };
  return { ...mutation, phase: chunked.phase, percent: chunked.percentage ?? 0, cancel };
}
