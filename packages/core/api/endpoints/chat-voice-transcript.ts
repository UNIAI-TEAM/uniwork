import { z } from "zod";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import { enc } from "./chat-schemas";

const ChatVoiceTranscriptSchema = z.object({
  text: z.string().catch(""),
  language: z.string().catch(""),
});

type ChatVoiceTranscript = { text: string; language: string };

/**
 * POST …/chat/messages/{id}/transcript: the voice message's stored transcript,
 * made on the first ask and charged once to the organization's AI credits.
 * Refusals arrive as ApiError codes: chat_transcript_pending (409, another
 * reader's transcription is running: ask again shortly), ai_disabled,
 * cloud_unavailable, ai_quota_exceeded, ai_provider_error, chat_message_not_voice.
 */
export async function transcribeChatVoiceMessage(workspaceId: string, messageId: string): Promise<ChatVoiceTranscript> {
  const raw = await request(
    `/api/v1/workspaces/${enc(workspaceId)}/chat/messages/${enc(messageId)}/transcript`,
    { method: "POST" },
  );
  return parseWithFallback(raw, ChatVoiceTranscriptSchema, { text: "", language: "" }, {
    endpoint: "POST .../chat/messages/{id}/transcript",
  });
}
