package sdo

// WorkspaceChatRoomSDO is the workspace native chat room.
type WorkspaceChatRoomSDO struct {
	RoomID      string `json:"room_id,omitempty" description:"Chat room id when provisioned; omitted until the first message" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	WorkspaceID string `json:"workspace_id" description:"UniWork workspace id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Enabled     bool   `json:"enabled" description:"true when native chat is available" example:"true"`
}

// VoiceCallParticipantDTO is one person on a voice call log.
type VoiceCallParticipantDTO struct {
	UserID      string `json:"user_id" description:"Participant user id" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	DisplayName string `json:"display_name" description:"Display name at call end" example:"Tran Hoang Long"`
}

// VoiceCallSummaryActionItemDTO is one suggested follow-up on a call summary message.
type VoiceCallSummaryActionItemDTO struct {
	Title           string `json:"title" description:"Suggested task title" example:"Gửi báo cáo sprint"`
	Owner           string `json:"owner,omitempty" description:"Suggested owner display name" example:"Nguyen Van A"`
	Due             string `json:"due,omitempty" description:"Suggested due date as spoken" example:"Thứ Sáu"`
	SourceMessageID string `json:"source_message_id,omitempty" description:"Chat message id that motivated the item" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
}

// VoiceCallSummaryDTO is AI summary metadata on a text message after a voice call.
type VoiceCallSummaryDTO struct {
	CallID           string                          `json:"call_id" description:"Voice call id" example:"550e8400-e29b-41d4-a716-446655440000"`
	CallLogMessageID string                          `json:"call_log_message_id" description:"Call log message id" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	Summary          string                          `json:"summary,omitempty" description:"AI summary text" example:"Đã chốt ship vào thứ Sáu."`
	Highlights       []string                        `json:"highlights,omitempty" description:"Key points from the call"`
	ActionItems      []VoiceCallSummaryActionItemDTO `json:"action_items,omitempty" description:"Suggested follow-ups"`
}

// VoiceCallLogDTO is metadata for a voice call log message.
type VoiceCallLogDTO struct {
	Outcome         string                    `json:"outcome" description:"completed, unanswered, or declined" example:"completed"`
	DurationSeconds int                       `json:"duration_seconds,omitempty" description:"Call length in seconds when completed" example:"125"`
	CallerID        string                    `json:"caller_id" description:"User id of the caller" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	Video           bool                      `json:"video,omitempty" description:"True when the call was started with the camera on" example:"true"`
	Participants    []VoiceCallParticipantDTO `json:"participants,omitempty" description:"People involved in the call"`
	RecordingID     string                    `json:"recording_id,omitempty" description:"Chat voice recording id when present" example:"01J8X4REC0N1P2Q3R4S5T6U7V8"`
	RecordingStatus string                    `json:"recording_status,omitempty" description:"ACTIVE, PROCESSING, COMPLETE, or FAILED" example:"COMPLETE"`
	RecordingURL    string                    `json:"recording_url,omitempty" description:"Playback URL when recording is complete" example:"https://s3.example/chat-voice/rec.mp4"`
}

// ChatCallLogDTO is one call of the UniChat calls tab: a voice call log
// message with the room it was posted in. Recording fields stay on the
// message (ChatMessageDTO.voice_call); this list does not carry them.
type ChatCallLogDTO struct {
	MessageID       string                    `json:"message_id" description:"Id tin call-log, để mở phòng tại đúng tin" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	RoomID          string                    `json:"room_id" description:"Phòng chứa cuộc gọi" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	RoomKind        string                    `json:"room_kind" description:"dm, group hoặc channel" example:"dm"`
	RoomName        string                    `json:"room_name" description:"Tên phòng; với DM là tên hiển thị của người kia" example:"Trần Hoàng Long"`
	PeerUserID      string                    `json:"peer_user_id,omitempty" description:"Người kia của DM; bỏ trống với phòng khác" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	CallID          string                    `json:"call_id" description:"Id cuộc gọi" example:"550e8400-e29b-41d4-a716-446655440000"`
	Outcome         string                    `json:"outcome" description:"completed, unanswered hoặc declined; rỗng khi metadata hỏng" example:"completed"`
	Video           bool                      `json:"video" description:"true khi cuộc gọi bắt đầu với camera bật" example:"false"`
	CallerID        string                    `json:"caller_id" description:"Người gọi" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	CallerName      string                    `json:"caller_name" description:"Tên hiển thị hiện tại của người gọi" example:"Nguyễn Văn An"`
	DurationSeconds int                       `json:"duration_seconds" description:"Thời lượng nói chuyện, giây; 0 khi không ai nghe" example:"125"`
	StartedAt       string                    `json:"started_at" description:"Lúc bắt đầu nói chuyện (RFC3339); cuộc không ai nghe thì bằng ended_at" example:"2026-10-17T08:58:00Z"`
	EndedAt         string                    `json:"ended_at" description:"Lúc gác máy (RFC3339)" example:"2026-10-17T09:00:05Z"`
	Participants    []VoiceCallParticipantDTO `json:"participants" description:"Những người có mặt trong cuộc gọi"`
}

// ChatCallLogListSDO is GET /workspaces/{workspaceID}/chat/call-logs.
type ChatCallLogListSDO struct {
	CallLogs   []ChatCallLogDTO `json:"call_logs" description:"Mới nhất trước"`
	NextCursor *string          `json:"next_cursor" description:"Con trỏ trang kế; null ở trang cuối" example:"1774519200123456.01J8X4MSG0N1P2Q3R4S5T6U7V8"`
}

// ChatVoiceRecordingDTO is a LiveKit egress row for a chat voice call.
type ChatVoiceRecordingDTO struct {
	ID        string `json:"id" example:"01J8X4REC0N1P2Q3R4S5T6U7V8"`
	RoomID    string `json:"room_id" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	CallID    string `json:"call_id" example:"550e8400-e29b-41d4-a716-446655440000"`
	Status    string `json:"status" example:"ACTIVE"`
	FileURL   string `json:"file_url,omitempty"`
	StartedBy string `json:"started_by" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	StartedAt string `json:"started_at" example:"2026-09-14T10:00:00Z"`
	EndedAt   string `json:"ended_at,omitempty"`
}

// ChatVoiceRecordingSDO wraps a chat voice recording.
type ChatVoiceRecordingSDO struct {
	Recording ChatVoiceRecordingDTO `json:"recording"`
}

// ChatVoiceRecordingListSDO lists call recordings in a chat room.
type ChatVoiceRecordingListSDO struct {
	Recordings []ChatVoiceRecordingDTO `json:"recordings"`
}

// ChatVoiceRecordingPlaybackSDO is a short-lived direct playback URL (S3 presigned).
type ChatVoiceRecordingPlaybackSDO struct {
	PlaybackURL string `json:"playback_url" description:"Presigned URL for inline MP4 playback" example:"https://s3.example/chat-voice/rec.mp4?X-Amz-Signature=…"`
	ExpiresAt   string `json:"expires_at" description:"RFC3339 expiry of playback_url" example:"2026-09-15T11:00:00Z"`
}

// VoiceMessageDTO is metadata for private voice-message content.
type VoiceMessageDTO struct {
	DurationMS   int    `json:"duration_ms" description:"Recording duration in milliseconds" example:"12500"`
	ContentType  string `json:"content_type" description:"Sniffed audio MIME type" example:"audio/webm"`
	SizeBytes    int64  `json:"size_bytes" description:"Stored audio size in bytes" example:"184320"`
	URL          string `json:"url,omitempty" description:"URL presign ngắn hạn để phát trực tiếp từ object storage; trống khi không ký được" example:"https://storage.example.com/uniwork/chat/voice/01J8X4FILE?X-Amz-Signature=abc"`
	URLExpiresAt string `json:"url_expires_at,omitempty" description:"Thời điểm URL hết hạn (RFC3339); tải lại tin nhắn để có URL mới" example:"2026-03-26T22:00:00Z"`
}

// FileMessageDTO is a chat file: its metadata plus presigned read URLs for
// the viewer (UNI-1633); the storage key itself stays server-side.
type FileMessageDTO struct {
	Filename     string `json:"filename" description:"Original filename" example:"sprint.pdf"`
	ContentType  string `json:"content_type" description:"Sniffed MIME type" example:"application/pdf"`
	SizeBytes    int64  `json:"size_bytes" description:"Stored file size in bytes" example:"204800"`
	URL          string `json:"url,omitempty" description:"URL presign ngắn hạn để xem tệp trực tiếp từ object storage (inline); trống khi không ký được" example:"https://storage.example.com/uniwork/chat/files/01J8X4FILE?X-Amz-Signature=abc"`
	DownloadURL  string `json:"download_url,omitempty" description:"URL presign tải tệp xuống với tên gốc (Content-Disposition: attachment)" example:"https://storage.example.com/uniwork/chat/files/01J8X4FILE?response-content-disposition=attachment&X-Amz-Signature=abc"`
	ThumbURL     string `json:"thumb_url,omitempty" description:"URL presign ảnh thu nhỏ (cạnh dài tối đa 640px); bằng url khi ảnh chưa có bản thu nhỏ" example:"https://storage.example.com/uniwork/chat/files/01J8X4THUMB?X-Amz-Signature=abc"`
	URLExpiresAt string `json:"url_expires_at,omitempty" description:"Thời điểm URL sớm nhất hết hạn (RFC3339); tải lại tin nhắn để có URL mới" example:"2026-03-26T22:00:00Z"`
}

// ChatPollOptionDTO is one poll choice with vote count.
type ChatPollOptionDTO struct {
	ID    string `json:"id" description:"Option id" example:"01J8X4OPT0N1P2Q3R4S5T6U7V8"`
	Label string `json:"label" description:"Option label" example:"Canteen"`
	Votes int    `json:"votes" description:"Vote count" example:"3"`
}

// ChatPollSettingsDTO configures poll behavior. The flags always go out:
// the client defaults a missing allow_multiple to true.
type ChatPollSettingsDTO struct {
	DeadlineAt           *string `json:"deadline_at,omitempty" description:"RFC3339 deadline" example:"2026-09-05T12:00:00Z"`
	PinToTop             bool    `json:"pin_to_top" description:"Pin poll to top" example:"false"`
	AllowMultiple        bool    `json:"allow_multiple" description:"Allow multiple selections" example:"true"`
	AllowAddOptions      bool    `json:"allow_add_options" description:"Members may add options" example:"true"`
	HideResultsUntilVote bool    `json:"hide_results_until_vote" description:"Hide results until voted" example:"false"`
	HideVoters           bool    `json:"hide_voters" description:"Hide voters" example:"false"`
}

// ChatPollDTO is poll metadata attached to a poll message.
type ChatPollDTO struct {
	Question        string              `json:"question" description:"Poll question" example:"Ăn trưa ở đâu?"`
	Options         []ChatPollOptionDTO `json:"options" description:"Poll options"`
	Settings        ChatPollSettingsDTO `json:"settings" description:"Poll settings"`
	ViewerOptionIDs []string            `json:"viewer_option_ids,omitempty" description:"Option ids selected by the caller" example:"[\"01J8X4OPT0N1P2Q3R4S5T6U7V8\"]"`
	VotesByUser     map[string][]string `json:"votes_by_user,omitempty" description:"User id to selected option ids when voter list is visible"`
}

// ChatReminderDTO is reminder metadata attached to a reminder message.
type ChatReminderDTO struct {
	Body     string `json:"body" description:"Reminder content" example:"Họp sprint lúc 9h"`
	RemindAt string `json:"remind_at" description:"RFC3339 reminder time" example:"2026-09-05T09:00:00Z"`
	Repeat   string `json:"repeat" description:"none, daily, weekly, or monthly" example:"none"`
}

// ChatNoteDTO is note metadata attached to a note message.
type ChatNoteDTO struct {
	Body     string `json:"body" description:"Note content" example:"Link tài liệu sprint"`
	PinToTop bool   `json:"pin_to_top" description:"Whether the note is pinned to top" example:"false"`
}

// ChatPostDTO is announcement metadata attached to a post message.
type ChatPostDTO struct {
	Title    string `json:"title" description:"Post title" example:"Lịch nghỉ lễ 2/9"`
	Body     string `json:"body" description:"Post body" example:"Đăng ký nghỉ trước 20/8."`
	PinToTop bool   `json:"pin_to_top" description:"Whether the post is pinned to top" example:"false"`
}

// ChatMessageDTO is a stored chat message.
type ChatMessageDTO struct {
	ID                string               `json:"id" description:"Message id" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	RoomID            string               `json:"room_id" description:"Chat room id" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	WorkspaceID       string               `json:"workspace_id" description:"Workspace id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	SenderID          string               `json:"sender_id" description:"Author user id" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	SenderDisplayName string               `json:"sender_display_name" description:"Author display name" example:"Nguyen Van A"`
	Kind              string               `json:"kind,omitempty" description:"text or voice_call_log" example:"text"`
	Body              string               `json:"body" description:"Message text" example:"Xin chào team!"`
	ReplyToMessageID  *string              `json:"reply_to_message_id,omitempty" description:"Replied message id" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	ThreadRootID      *string              `json:"thread_root_id,omitempty" description:"Thread root message id when this is a reply" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	ReplyCount        int                  `json:"reply_count,omitempty" description:"Reply count on a thread root" example:"3"`
	LastReplyAt       string               `json:"last_reply_at,omitempty" description:"RFC3339 of latest reply on a thread root"`
	ThreadUnread      bool                 `json:"thread_unread,omitempty" description:"Caller has unread replies in this thread"`
	ThreadFollowing   bool                 `json:"thread_following,omitempty" description:"Caller follows this thread and has not muted it (set on the root in a thread listing)"`
	CreatedAt         string               `json:"created_at" description:"RFC3339 timestamp" example:"2026-03-26T10:00:00Z"`
	Cursor            string               `json:"cursor,omitempty" description:"Opaque history position; pass it back verbatim as ?cursor= to list older messages" example:"1774519200123456.01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	EditedAt          string               `json:"edited_at,omitempty" description:"RFC3339 timestamp when the message was last edited" example:"2026-03-26T10:05:00Z"`
	Pinned            bool                 `json:"pinned,omitempty" description:"true when pinned in the room" example:"true"`
	MentionedUserIDs  []string             `json:"mentioned_user_ids,omitempty" description:"User ids notified by @mention in this message" example:"[\"01J8X4USR0N1P2Q3R4S5T6U7V8\"]"`
	Reactions         map[string]int       `json:"reactions,omitempty" description:"Emoji reaction counts keyed by emoji" example:"{\"👍\":2}"`
	MyReactions       []string             `json:"my_reactions,omitempty" description:"Emojis the caller reacted with" example:"[\"👍\"]"`
	VoiceCall         *VoiceCallLogDTO     `json:"voice_call,omitempty" description:"Voice call log metadata when kind is voice_call_log"`
	VoiceCallSummary  *VoiceCallSummaryDTO `json:"voice_call_summary,omitempty" description:"AI call summary metadata when kind is text"`
	Voice             *VoiceMessageDTO     `json:"voice,omitempty" description:"Voice recording metadata when kind is voice"`
	File              *FileMessageDTO      `json:"file,omitempty" description:"File attachment metadata when kind is file"`
	Poll              *ChatPollDTO         `json:"poll,omitempty" description:"Poll payload when kind is poll"`
	Reminder          *ChatReminderDTO     `json:"reminder,omitempty" description:"Reminder payload when kind is reminder"`
	Note              *ChatNoteDTO         `json:"note,omitempty" description:"Note payload when kind is note"`
	Post              *ChatPostDTO         `json:"post,omitempty" description:"Post payload when kind is post"`
	Priority          string               `json:"priority,omitempty" description:"important or urgent message flag" example:"important"`
	ClientMsgID       string               `json:"client_msg_id,omitempty" description:"Idempotency key the sender supplied, so a client can drop its own queued copy" example:"550e8400-e29b-41d4-a716-446655440000"`
}

// ChatRoomDTO is a dm, group, or channel chat room.
type ChatRoomDTO struct {
	ID                     string                        `json:"id" description:"Chat room id" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	Kind                   string                        `json:"kind" description:"dm, group, or channel" example:"channel"`
	Name                   string                        `json:"name" description:"Room display name" example:"marketing"`
	WorkspaceID            string                        `json:"workspace_id" description:"Workspace id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	MemberUserIDs          []string                      `json:"member_user_ids" description:"Other member user ids (dm and group; empty for a channel)" example:"[\"01J8X4USR0N1P2Q3R4S5T6U7V8\"]"`
	MemberCount            int                           `json:"member_count,omitempty" description:"Channel members, the caller included (channels only)" example:"42"`
	MentionUnreadCount     int                           `json:"mention_unread_count" description:"Unread messages that mention the caller" example:"1"`
	UnreadCount            int                           `json:"unread_count" description:"Unread messages for the caller" example:"3"`
	PeerUserID             string                        `json:"peer_user_id,omitempty" description:"DM peer user id" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	PeerEmail              string                        `json:"peer_email,omitempty" description:"DM peer email" example:"peer@example.com"`
	PeerDisplayName        string                        `json:"peer_display_name,omitempty" description:"DM peer display name" example:"Nguyen Van A"`
	PeerLastReadAt         string                        `json:"peer_last_read_at,omitempty" description:"RFC3339 DM peer read cursor" example:"2026-03-26T10:00:00Z"`
	LastReadAt             string                        `json:"last_read_at,omitempty" description:"RFC3339 (sub-second) read cursor of the caller; absent if never read" example:"2026-03-26T10:00:00.123456Z"`
	LastMessageBody        string                        `json:"last_message_body,omitempty" description:"Plain-text preview of the latest message" example:"@Binh check this"`
	LastMessageKind        string                        `json:"last_message_kind,omitempty" description:"Kind of the latest message" example:"text"`
	LastMessageSenderID    string                        `json:"last_message_sender_id,omitempty" description:"Author of the latest message" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	LastMessageSenderName  string                        `json:"last_message_sender_name,omitempty" description:"Display name of the latest message author" example:"Nguyen Van A"`
	LastMessageCallOutcome string                        `json:"last_message_call_outcome,omitempty" description:"Outcome of the latest message when it is a call log: completed, declined or unanswered" example:"unanswered"`
	LastMessageDurationMS  int                           `json:"last_message_duration_ms,omitempty" description:"Length in milliseconds of the latest message when it is a voice note" example:"42000"`
	LastMessageAt          string                        `json:"last_message_at,omitempty" description:"RFC3339 timestamp of the latest message" example:"2026-03-26T10:00:00Z"`
	MemberPermissions      *ChatRoomMemberPermissionsDTO `json:"member_permissions,omitempty" description:"Permissions for regular members in group/channel rooms"`
	Visibility             string                        `json:"visibility,omitempty" description:"public or private (channels)" example:"public"`
	ProjectID              string                        `json:"project_id,omitempty" description:"Linked project id when set"`
	Topic                  string                        `json:"topic,omitempty" description:"Channel topic"`
	IsDefault              bool                          `json:"is_default,omitempty" description:"Default workspace channel"`
	NotificationsMuted     bool                          `json:"notifications_muted" description:"The caller muted this room's chat notifications on every device" example:"false"`
	AvatarURL              string                        `json:"avatar_url,omitempty" description:"Signed URL of a group's uploaded avatar; absent when the group shows its members" example:"https://storage.example.com/chat/avatars/01J8X4FILE?sig=abc"`
}

// ChatChannelListSDO is GET .../chat/channels.
type ChatChannelListSDO struct {
	Rooms []ChatRoomDTO `json:"rooms"`
}

// ChatThreadDTO is one followed thread summary.
type ChatThreadDTO struct {
	ThreadRootID string `json:"thread_root_id" description:"Root message id" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	RoomID       string `json:"room_id" description:"Chat room id"`
	WorkspaceID  string `json:"workspace_id" description:"Workspace id"`
	RootBody     string `json:"root_body" description:"Root message body preview"`
	RootSenderID string `json:"root_sender_id" description:"Root author user id"`
	ReplyCount   int    `json:"reply_count" description:"Number of replies" example:"3"`
	LastReplyAt  string `json:"last_reply_at,omitempty" description:"RFC3339 of latest reply"`
	RootCreated  string `json:"root_created_at" description:"RFC3339 of root message"`
	Unread       bool   `json:"unread" description:"Caller has unread replies"`
	Reason       string `json:"reason,omitempty" description:"Why the caller follows: author|replied|mentioned|manual"`
}

// ChatThreadReadSDO is POST .../chat/threads/{messageID}/read.
type ChatThreadReadSDO struct {
	OK             bool   `json:"ok" description:"true when the read pointer moved" example:"true"`
	PreviousReadAt string `json:"previous_read_at" description:"Con trỏ đã đọc trước lần đánh dấu này (RFC3339; thời điểm tin gốc nếu chưa từng đọc), dùng làm since cho tóm tắt" example:"2026-09-05T00:00:00.123456Z"`
}

// ChatThreadListSDO is GET .../chat/threads.
type ChatThreadListSDO struct {
	Threads []ChatThreadDTO `json:"threads"`
}

// ChatRoomMemberPermissionsDTO configures what non-admin members may do.
type ChatRoomMemberPermissionsDTO struct {
	AllowChangeProfile bool `json:"allow_change_profile" description:"Members may change group name and avatar" example:"true"`
	AllowPinContent    bool `json:"allow_pin_content" description:"Members may pin messages, notes, and polls" example:"true"`
	AllowCreateNotes   bool `json:"allow_create_notes" description:"Members may create notes and reminders" example:"true"`
	AllowCreatePolls   bool `json:"allow_create_polls" description:"Members may create polls" example:"true"`
	AllowSendMessages  bool `json:"allow_send_messages" description:"Members may send chat messages" example:"true"`
}

// ChatUserLookupSDO is a UniWork user resolved by email for cross-workspace DM.
type ChatUserLookupSDO struct {
	UserID      string `json:"user_id" description:"UniWork user id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Email       string `json:"email" description:"Account email" example:"colleague@example.com"`
	DisplayName string `json:"display_name" description:"Display name" example:"Nguyen Van A"`
}

// ChatBlockStatusSDO is the block relationship between caller and a peer.
type ChatBlockStatusSDO struct {
	BlockedByMe bool `json:"blocked_by_me" description:"Caller blocked the peer" example:"true"`
	BlockedMe   bool `json:"blocked_me" description:"Peer blocked the caller" example:"false"`
}

// ChatNicknameMapSDO is GET .../chat/nicknames.
type ChatNicknameMapSDO struct {
	Nicknames map[string]string `json:"nicknames" description:"Target user id to personal nickname"`
}

// ChatGifItemSDO is one GIF result for chat composer search.
type ChatGifItemSDO struct {
	ID         string `json:"id" description:"Provider gif id" example:"12345"`
	Label      string `json:"label" description:"Human-readable label" example:"thumbs up"`
	URL        string `json:"url" description:"Full gif url" example:"https://media.tenor.com/example.gif"`
	PreviewURL string `json:"preview_url" description:"Small preview url" example:"https://media.tenor.com/example-preview.gif"`
}

// ChatGifListSDO is GET .../chat/gifs/search or .../chat/gifs/trending.
type ChatGifListSDO struct {
	Items []ChatGifItemSDO `json:"items"`
}

// ChatMediaStatusSDO is GET .../chat/media/status.
type ChatMediaStatusSDO struct {
	TenorEnabled bool `json:"tenor_enabled" example:"true" description:"Tenor API key configured on server"`
}

// PendingVoiceInviteSDO is a ring invite waiting for the callee.
type PendingVoiceInviteSDO struct {
	RoomID     string `json:"room_id" description:"Chat room id" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	CallID     string `json:"call_id" description:"Active voice call id" example:"550e8400-e29b-41d4-a716-446655440000"`
	CallerID   string `json:"caller_id" description:"Caller user id" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	CallerName string `json:"caller_name" description:"Caller display name" example:"Nguyen Van A"`
	CallKind   string `json:"call_kind" description:"dm or group" example:"dm"`
	RoomName   string `json:"room_name,omitempty" description:"Group room name when call_kind is group" example:"Team Alpha"`
	InvitedAt  string `json:"invited_at" description:"RFC3339 timestamp when the invite was sent" example:"2026-03-26T10:00:00Z"`
}

// ChatRoomMemberDTO is a member row for chat room moderation.
type ChatRoomMemberDTO struct {
	UserID         string `json:"user_id" description:"Member user id" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	Role           string `json:"role" description:"Chat room role: admin or member" example:"admin"`
	SendRestricted bool   `json:"send_restricted" description:"Read-only when true" example:"false"`
	Email          string `json:"email" description:"Account email" example:"member@example.com"`
	DisplayName    string `json:"display_name" description:"Display name" example:"Nguyen Van A"`
	IsCreator      bool   `json:"is_creator" description:"True for the member who created the room" example:"false"`
	LastReadAt     string `json:"last_read_at,omitempty" description:"RFC3339 (sub-second) main-timeline read cursor of the member; absent if never read" example:"2026-03-26T10:00:00.123456Z"`
}

// ChatRoomMemberListSDO is GET .../rooms/{roomID}/members.
type ChatRoomMemberListSDO struct {
	Members []ChatRoomMemberDTO `json:"members"`
}

// ChatMessageLinkDTO is one link from a chat message to another entity.
type ChatMessageLinkDTO struct {
	ID         string `json:"id" description:"Link id" example:"01J8X4LNK0N1P2Q3R4S5T6U7V8"`
	MessageID  string `json:"message_id" description:"Chat message id" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	TargetType string `json:"target_type" description:"task in this release" example:"task"`
	TargetID   string `json:"target_id" description:"Target entity id" example:"01J8X4TSK0N1P2Q3R4S5T6U7V8"`
	Relation   string `json:"relation" description:"created_from or mentions" example:"mentions"`
	CreatedBy  string `json:"created_by" description:"User who created the link" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	CreatedAt  string `json:"created_at" description:"RFC3339 timestamp" example:"2026-09-10T10:00:00Z"`
}

// ChatMessageLinkListSDO is GET .../chat/messages/{messageID}/links and
// GET .../chat/rooms/{roomID}/message-links.
type ChatMessageLinkListSDO struct {
	Links []ChatMessageLinkDTO `json:"links"`
}

// ChatRoomLinkedTaskDTO is one task a room's messages link to.
type ChatRoomLinkedTaskDTO struct {
	ID           string `json:"id" description:"Task id" example:"01J8X4TSK0N1P2Q3R4S5T6U7V8"`
	WorkspaceID  string `json:"workspace_id" description:"Workspace id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Number       int64  `json:"number" description:"Số thứ tự task trong workspace" example:"42"`
	Title        string `json:"title" description:"Tiêu đề task" example:"Chốt bộ icon cho bản 2.0"`
	Status       string `json:"status" description:"Trạng thái task" example:"in_progress"`
	Priority     string `json:"priority" description:"Độ ưu tiên" example:"high"`
	AssigneeID   string `json:"assignee_id,omitempty" description:"Người hoặc agent được giao" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
	AssigneeKind string `json:"assignee_kind,omitempty" description:"human hoặc agent; có khi có người được giao" example:"human"`
	AssigneeName string `json:"assignee_name,omitempty" description:"Tên hiển thị của người được giao" example:"Lan Phạm"`
	DueDate      string `json:"due_date,omitempty" description:"Hạn chót YYYY-MM-DD" example:"2026-10-23"`
	LinkedAt     string `json:"linked_at" description:"Lần gắn gần nhất từ phòng này (RFC3339)" example:"2026-10-18T09:30:00Z"`
}

// ChatRoomLinkedTaskListSDO is GET .../chat/rooms/{roomID}/linked-tasks.
type ChatRoomLinkedTaskListSDO struct {
	Tasks []ChatRoomLinkedTaskDTO `json:"tasks"`
	Total int                     `json:"total" description:"Tổng số task được gắn từ phòng này" example:"7"`
}

// ChatRoomSharedCountsDTO is how many of each kind a room's timeline shares.
type ChatRoomSharedCountsDTO struct {
	Photo int `json:"photo" description:"Ảnh (tệp ảnh và ảnh chọn từ bộ chọn), không tính GIF" example:"48"`
	GIF   int `json:"gif" description:"GIF (tệp image/gif và GIF từ bộ chọn)" example:"4"`
	Video int `json:"video" description:"Video" example:"0"`
	File  int `json:"file" description:"Tệp không phải ảnh, GIF hay video" example:"12"`
	Link  int `json:"link" description:"Số URL http(s) trong các tin nhắn văn bản (mỗi URL một lần)" example:"9"`
	Voice int `json:"voice" description:"Tin nhắn thoại" example:"6"`
}

// ChatSharedPhotoDTO is one of a room's newest photos.
type ChatSharedPhotoDTO struct {
	MessageID    string `json:"message_id" description:"Tin nhắn chứa ảnh" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	FileID       string `json:"file_id,omitempty" description:"Tệp đính kèm; trống với ảnh từ bộ chọn" example:"01J8X4FILE0N1P2Q3R4S5T6U7V"`
	Title        string `json:"title" description:"Tên tệp hoặc mô tả ảnh" example:"banner-3.png"`
	URL          string `json:"url,omitempty" description:"URL presign ngắn hạn (như khi tải tin nhắn); trống khi không ký được" example:"https://storage.example.com/uniwork/chat/files/01J8X4FILE?X-Amz-Signature=abc"`
	ThumbURL     string `json:"thumb_url,omitempty" description:"URL presign ảnh thu nhỏ; bằng url khi chưa có bản thu nhỏ" example:"https://storage.example.com/uniwork/chat/files/01J8X4THUMB?X-Amz-Signature=abc"`
	URLExpiresAt string `json:"url_expires_at,omitempty" description:"Thời điểm URL sớm nhất hết hạn (RFC3339)" example:"2026-10-18T22:00:00Z"`
	CreatedAt    string `json:"created_at" description:"Thời điểm gửi (RFC3339)" example:"2026-10-17T17:05:00Z"`
}

// ChatRoomSharedSummarySDO is GET .../chat/rooms/{roomID}/shared-summary.
type ChatRoomSharedSummarySDO struct {
	Counts       ChatRoomSharedCountsDTO `json:"counts"`
	RecentPhotos []ChatSharedPhotoDTO    `json:"recent_photos" description:"Tối đa 6 ảnh mới nhất, mới trước"`
}

// ChatUnreadTotalsDTO is what a set of rooms adds to a chat badge.
type ChatUnreadTotalsDTO struct {
	Unread   int `json:"unread" description:"Tin chưa đọc; phòng tắt thông báo chỉ góp số nhắc tên" example:"5"`
	Mentions int `json:"mentions" description:"Tin chưa đọc nhắc tên người gọi (tên hoặc @all)" example:"1"`
}

// ChatWorkspaceUnreadDTO is one workspace's channels.
type ChatWorkspaceUnreadDTO struct {
	WorkspaceID string `json:"workspace_id" description:"Workspace id" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Unread      int    `json:"unread" description:"Tin chưa đọc trong các kênh của workspace; phòng tắt thông báo chỉ góp số nhắc tên" example:"3"`
	Mentions    int    `json:"mentions" description:"Tin chưa đọc nhắc tên người gọi trong các kênh" example:"0"`
}

// ChatUnreadSummarySDO is GET /api/v1/me/chat/unread-summary.
type ChatUnreadSummarySDO struct {
	Direct     ChatUnreadTotalsDTO      `json:"direct" description:"DM và nhóm của tổ chức, đếm một lần (hiện ở mọi workspace)"`
	Workspaces []ChatWorkspaceUnreadDTO `json:"workspaces" description:"Mỗi workspace người gọi mở được; workspace bị chặn ở cổng thành viên không có mặt"`
}
