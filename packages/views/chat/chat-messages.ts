export interface ChatMessage {
  id: string;
  sender: string;
  body: string;
  kind?: string;
  ts: number;
  /** Server history cursor; passed back verbatim to page older messages. */
  cursor?: string;
  replyToEventId?: string;
  threadRootId?: string;
  replyCount?: number;
  lastReplyAt?: number;
  threadUnread?: boolean;
  editedAt?: number;
  pinned?: boolean;
  mentionedUserIds?: string[];
  reactions: Record<string, number>;
  /** Emojis I reacted with (server `my_reactions`). */
  myReactions?: string[];
  voiceCall?: {
    outcome: string;
    duration_seconds?: number;
    caller_id: string;
    participants?: { user_id: string; display_name: string }[];
    recording_id?: string;
    recording_status?: string;
    recording_url?: string;
    video?: boolean;
  };
  voiceCallSummary?: {
    call_id: string;
    call_log_message_id: string;
    summary: string;
    highlights: string[];
    action_items: {
      title: string;
      owner: string;
      due: string;
      source_message_id: string;
    }[];
  };
  /** url* are signed storage URLs (UNI-1633), empty when unsigned, dead after url_expires_at. */
  voice?: {
    duration_ms: number;
    content_type: string;
    size_bytes: number;
    url?: string;
    url_expires_at?: string;
  };
  file?: {
    filename: string;
    content_type: string;
    size_bytes: number;
    url?: string;
    download_url?: string;
    thumb_url?: string;
    url_expires_at?: string;
  };
  /** UNI-1966 (contract §5): the viewer-resolved card data on kind "document"
   *  and "document_version". Everything but document_id may be absent — the
   *  no-access block carries nothing — so readers degrade, never throw. */
  document?: {
    document_id: string;
    viewer_has_access?: boolean;
    viewer_level?: "view" | "comment" | "edit" | "manage" | "";
    viewer_can_manage?: boolean;
    viewer_can_upload_version?: boolean;
    title?: string;
    format?: string;
    version_number?: number;
    revision?: string;
    can_open_in_app?: boolean;
    /** Sender only: the card prints "Đã chia sẻ với N người". */
    recipient_count?: number;
  };
  /** UNI-1966 (L6): the sender of a document-kind file message may convert
   *  it — the server decided (allowlisted type, live, unlinked). */
  canShareAsDocument?: boolean;
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
  post?: {
    title: string;
    body: string;
    pinToTop: boolean;
  };
  priority?: "important" | "urgent";
  clientMsgId?: string;
  deliveryStatus?: "sending" | "queued";
}
export const CHAT_MESSAGE_INITIAL = 80;
