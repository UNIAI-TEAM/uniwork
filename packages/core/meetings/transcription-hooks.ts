"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/meeting-transcriptions";
import { startChunkedUpload } from "../documents/chunked-upload";
import { createSafeId } from "../utils";
import { meetingKeys } from "./hooks";

// Meetings held without a room (UNI-2001): "record as held", and an uploaded
// recording transcribed in batch. Both await the server (they navigate state
// across screens and are not locally predictable).

export function useMeetingTranscriptions(meetingId: string, enabled = true) {
  return useQuery({
    queryKey: meetingKeys.transcriptions(meetingId),
    queryFn: () => api.listMeetingTranscriptions(meetingId),
    enabled: enabled && Boolean(meetingId),
  });
}

export function useRecordMeetingHeld(workspaceId: string, meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { started_at: string; ended_at: string }) => api.recordMeetingHeld(meetingId, v),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
    },
  });
}

interface UploadRecordingInput {
  file: File;
  language: "vi" | "en";
  consent: boolean;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
}

/** Sends the file through the shared upload session, then queues it. */
export function useUploadMeetingRecording(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: UploadRecordingInput) => {
      const upload = startChunkedUpload({
        file: v.file,
        filename: v.file.name,
        target: { kind: "meeting_audio", meetingId },
        idempotencyKey: createSafeId(),
        onProgress: (p) => v.onProgress?.(p.sentBytes, p.totalBytes),
      });
      const done = await upload.result;
      if (done.kind !== "upload") throw new Error("upload answered a document");
      return api.requestMeetingTranscription(meetingId, {
        upload_id: done.upload.upload_id,
        language: v.language,
        consent: v.consent,
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.transcriptions(meetingId) });
    },
  });
}
