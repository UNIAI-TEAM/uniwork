export interface ChatMessage {
  id: string;
  sender: string;
  body: string;
  kind?: string;
  ts: number;
  replyToEventId?: string;
  reactions: Record<string, number>;
  voiceCall?: {
    outcome: string;
    duration_seconds?: number;
    caller_id: string;
  };
}
export const CHAT_MESSAGE_INITIAL = 80;
export const CHAT_MESSAGE_PAGE_SIZE = 50;
