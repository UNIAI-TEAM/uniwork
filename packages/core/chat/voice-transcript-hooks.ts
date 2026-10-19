"use client";
import { useQuery } from "@tanstack/react-query";
import { errorCode } from "../api/http";
import { transcribeChatVoiceMessage } from "../api/endpoints/chat-voice-transcript";
import { chatKeys } from "./chat-keys";

/** How long a reader waits on someone else's transcription before giving up. */
const PENDING_LIMIT_MS = 2 * 60_000;

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Asks for the transcript; while another reader's transcription runs the
 * server answers chat_transcript_pending, and this asks again with backoff
 * (1 s, 2 s, 4 s, then every 8 s) for up to two minutes. The last pending
 * answer is then the error.
 */
async function transcribeWhenReady(workspaceId: string, messageId: string, signal: AbortSignal) {
  const started = Date.now();
  for (let wait = 1000; ; wait = Math.min(wait * 2, 8000)) {
    try {
      return await transcribeChatVoiceMessage(workspaceId, messageId);
    } catch (err) {
      if (errorCode(err) !== "chat_transcript_pending" || Date.now() - started + wait > PENDING_LIMIT_MS) throw err;
    }
    await pause(wait, signal);
  }
}

/**
 * The transcript of one voice message, fetched only once `enabled` (the reader
 * asked for it). The first ask may charge the organization's AI credits, so
 * the query never refetches or retries on its own: the text does not change
 * once made, and a failed ask is retried by the reader.
 */
export function useChatVoiceTranscript(workspaceId: string, messageId: string, enabled: boolean) {
  return useQuery({
    queryKey: chatKeys.voiceTranscript(workspaceId, messageId),
    queryFn: ({ signal }) => transcribeWhenReady(workspaceId, messageId, signal),
    enabled: enabled && !!workspaceId && !!messageId,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}
