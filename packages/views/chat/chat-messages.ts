export interface ChatMessage {
  id: string;
  sender: string;
  body: string;
  kind?: string;
  ts: number;
  replyToEventId?: string;
  editedAt?: number;
  pinned?: boolean;
  mentionedUserIds?: string[];
  reactions: Record<string, number>;
  voiceCall?: {
    outcome: string;
    duration_seconds?: number;
    caller_id: string;
  };
  voice?: {
    duration_ms: number;
    content_type: string;
    size_bytes: number;
  };
  poll?: {
    question: string;
    options: { id: string; label: string; votes: number }[];
    settings: {
      deadline_at: string | null;
      pin_to_top: boolean;
      allow_multiple: boolean;
      allow_add_options: boolean;
      hide_results_until_vote: boolean;
      hide_voters: boolean;
    };
    viewer_option_ids?: string[];
    votes_by_user?: Record<string, string[]>;
  };
  reminder?: {
    body: string;
    remindAt: string;
    repeat: "none" | "daily" | "weekly" | "monthly";
  };
  note?: {
    body: string;
    pinToTop: boolean;
  };
  priority?: "important" | "urgent";
  clientMsgId?: string;
  deliveryStatus?: "sending" | "queued";
}
export const CHAT_MESSAGE_INITIAL = 80;
export const CHAT_MESSAGE_PAGE_SIZE = 50;
/** Max messages kept in panel memory when scrolling history. */
export const CHAT_MESSAGE_MAX_IN_MEMORY = 1000;
