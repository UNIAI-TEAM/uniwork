package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	voiceCallSummaryMinDuration = 30
	voiceCallSummaryMsgLimit    = 100
)

// VoiceCallSummaryActionItem is one suggested follow-up on a posted call summary.
type VoiceCallSummaryActionItem struct {
	Title           string `json:"title"`
	Owner           string `json:"owner,omitempty"`
	Due             string `json:"due,omitempty"`
	SourceMessageID string `json:"source_message_id,omitempty"`
}

// VoiceCallSummaryInfo is metadata on a chat message posted after a voice call.
type VoiceCallSummaryInfo struct {
	CallID           string
	CallLogMessageID string
	Summary          string
	Highlights       []string
	ActionItems      []VoiceCallSummaryActionItem
}

func (s *ChatService) SetAIGateway(gw *ai.Gateway) { s.ai = gw }

func (s *ChatService) emitVoiceCallCompleted(ctx context.Context, room db.ChatRoom, payload map[string]string) error {
	if s.ai == nil || !s.ai.Enabled() {
		return nil
	}
	orgID := roomOrganizationID(room)
	anchorWS := roomAnchorWorkspaceID(room)
	return auditRecorder.Emit(ctx, s.q, audit.System("chat"), audit.Event{
		Topic: "chat.voice.call.completed", Version: 1,
		OrganizationID: orgID, WorkspaceID: anchorWS,
		Payload: payload,
	})
}

// HandleVoiceCallCompleted generates and posts an AI call summary (C-13.8).
func (s *ChatService) HandleVoiceCallCompleted(ctx context.Context, payload map[string]string) error {
	if s.ai == nil || !s.ai.Enabled() {
		return nil
	}
	roomID := strings.TrimSpace(payload["room_id"])
	callID := strings.TrimSpace(payload["call_id"])
	callLogID := strings.TrimSpace(payload["call_log_message_id"])
	callerID := strings.TrimSpace(payload["caller_id"])
	orgID := strings.TrimSpace(payload["organization_id"])
	wsID := strings.TrimSpace(payload["workspace_id"])
	if roomID == "" || callID == "" || callLogID == "" || callerID == "" || orgID == "" || wsID == "" {
		return nil
	}
	if summaryMessageIDFromCallLog(ctx, s.q, callLogID) != "" {
		return nil
	}
	startAt, err := time.Parse(time.RFC3339, strings.TrimSpace(payload["started_at"]))
	if err != nil {
		startAt = time.Time{}
	}
	endAt, err := time.Parse(time.RFC3339, strings.TrimSpace(payload["ended_at"]))
	if err != nil {
		endAt = time.Now().UTC()
	}
	locale := strings.TrimSpace(payload["locale"])
	if locale == "" {
		locale = "en"
	}
	durationLabel := strings.TrimSpace(payload["duration_label"])
	participants := strings.TrimSpace(payload["participants"])

	room, err := s.q.GetChatRoomByID(ctx, roomID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}

	rows, err := s.q.ListChatMessagesInRoomBetween(ctx, db.ListChatMessagesInRoomBetweenParams{
		RoomID: roomID, WorkspaceID: wsID,
		StartAt:  pgtype.Timestamptz{Time: startAt, Valid: !startAt.IsZero()},
		EndAt:    pgtype.Timestamptz{Time: endAt, Valid: true},
		MsgLimit: int32(voiceCallSummaryMsgLimit),
	})
	if err != nil {
		return err
	}

	base, err := s.chatPathBase(ctx, wsID)
	if err != nil {
		return err
	}
	sources := make([]ai.Source, 0, len(rows)+1)
	idByHref := map[string]string{}
	for _, row := range rows {
		if row.ID == callLogID {
			continue
		}
		excerpt := strings.TrimSpace(row.Body)
		if excerpt == "" {
			excerpt = callSummaryExcerptForKind(row.Kind)
		}
		if excerpt == "" {
			continue
		}
		href := base + "/chat?room=" + roomID + "&msg=" + row.ID
		title := fmt.Sprintf("%s · %s", row.SenderDisplayName, row.CreatedAt.Time.UTC().Format("15:04"))
		sources = append(sources, ai.Source{Kind: "chat", Title: title, Href: href, Excerpt: excerpt})
		idByHref[href] = row.ID
	}
	if durationLabel != "" || participants != "" {
		meta := "Cuộc gọi thoại"
		if durationLabel != "" {
			meta += " · " + durationLabel
		}
		if participants != "" {
			meta += " · " + participants
		}
		sources = append([]ai.Source{{
			Kind: "chat", Title: "Cuộc gọi", Href: base + "/chat?room=" + roomID + "&msg=" + callLogID, Excerpt: meta,
		}}, sources...)
		idByHref[base+"/chat?room="+roomID+"&msg="+callLogID] = callLogID
	}

	pack, truncated := ai.BuildContext(sources)
	resp, err := s.ai.Complete(ctx, ai.Request{
		Actor: Human(callerID), OrganizationID: orgID, WorkspaceID: wsID,
		Capability: ai.CapChatCallSummary, PromptID: ai.PromptChatCallSummary,
		Vars: map[string]any{
			"locale": locale, "today": time.Now().UTC().Format("2006-01-02"),
			"duration": durationLabel, "participants": participants,
			"sources": ai.RenderSources(pack),
		},
		Sources: pack, Truncated: truncated,
	})
	if err != nil {
		return err
	}
	parsed, err := ai.ParseCatchUpJSON(resp.Text, pack)
	if err != nil {
		return err
	}

	items := make([]VoiceCallSummaryActionItem, 0, len(parsed.ActionItems))
	for _, a := range parsed.ActionItems {
		msgID := ""
		if a.SourceID != "" {
			for _, src := range pack {
				if src.ID == a.SourceID {
					msgID = idByHref[src.Href]
					break
				}
			}
		}
		items = append(items, VoiceCallSummaryActionItem{
			Title: a.Title, Owner: a.Owner, Due: a.Due, SourceMessageID: msgID,
		})
	}

	summaryMsgID, err := s.postVoiceCallSummaryMessage(ctx, room, callerID, wsID, callID, callLogID, parsed.Summary, parsed.Highlights, items)
	if err != nil {
		return err
	}
	return patchCallLogSummaryMessageID(ctx, s.q, callLogID, roomID, wsID, summaryMsgID)
}

func (s *ChatService) chatPathBase(ctx context.Context, workspaceID string) (string, error) {
	w, err := s.q.GetWorkspaceWithOrg(ctx, workspaceID)
	if err != nil {
		return "", err
	}
	return "/" + w.OrganizationSlug + "/" + w.Slug, nil
}

func (s *ChatService) postVoiceCallSummaryMessage(
	ctx context.Context, room db.ChatRoom, callerID, workspaceID, callID, callLogID, summary string,
	highlights []string, items []VoiceCallSummaryActionItem,
) (string, error) {
	body := formatVoiceCallSummaryBody(summary, highlights, items)
	metaMap := map[string]any{
		"voice_call_summary": map[string]any{
			"call_id":             callID,
			"call_log_message_id": callLogID,
			"summary":             summary,
			"highlights":          highlights,
			"action_items":        items,
		},
	}
	rawMeta, err := json.Marshal(metaMap)
	if err != nil {
		return "", err
	}
	msgID := util.NewID()
	msg, err := s.q.CreateChatMessage(ctx, db.CreateChatMessageParams{
		ID: msgID, RoomID: room.ID, WorkspaceID: workspaceID,
		SenderID: callerID, SenderKind: string(audit.KindHuman), Body: body,
	})
	if err != nil {
		return "", err
	}
	if _, err := s.q.UpdateChatMessageMetadata(ctx, db.UpdateChatMessageMetadataParams{
		ID: msgID, RoomID: room.ID, WorkspaceID: workspaceID, Metadata: rawMeta,
	}); err != nil {
		return "", err
	}
	_ = s.q.TouchChatRoomUpdatedAt(ctx, room.ID)
	s.publishCreatedChatMessage(ctx, room, msg.ID)
	return msg.ID, nil
}

func formatVoiceCallSummaryBody(summary string, highlights []string, items []VoiceCallSummaryActionItem) string {
	var b strings.Builder
	b.WriteString("**Tóm tắt cuộc gọi**\n\n")
	b.WriteString(strings.TrimSpace(summary))
	if len(highlights) > 0 {
		b.WriteString("\n\n**Điểm chính**\n")
		for _, h := range highlights {
			b.WriteString("- ")
			b.WriteString(strings.TrimSpace(h))
			b.WriteByte('\n')
		}
	}
	if len(items) > 0 {
		b.WriteString("\n**Việc cần làm**\n")
		for _, it := range items {
			b.WriteString("- ")
			b.WriteString(strings.TrimSpace(it.Title))
			if it.Owner != "" || it.Due != "" {
				b.WriteString(" (")
				parts := []string{}
				if it.Owner != "" {
					parts = append(parts, it.Owner)
				}
				if it.Due != "" {
					parts = append(parts, it.Due)
				}
				b.WriteString(strings.Join(parts, " · "))
				b.WriteString(")")
			}
			b.WriteByte('\n')
		}
	}
	return strings.TrimSpace(b.String())
}

func callSummaryExcerptForKind(kind string) string {
	switch kind {
	case "voice":
		return "(tin nhắn thoại)"
	case "file":
		return "(tệp đính kèm)"
	case "poll":
		return "(bình chọn)"
	case "post":
		return "(bài đăng)"
	default:
		return ""
	}
}

func voiceCallSummaryFromMetadata(kind string, raw []byte) *VoiceCallSummaryInfo {
	if kind != "text" || len(raw) == 0 {
		return nil
	}
	var meta struct {
		Summary struct {
			CallID           string                       `json:"call_id"`
			CallLogMessageID string                       `json:"call_log_message_id"`
			Summary          string                       `json:"summary"`
			Highlights       []string                     `json:"highlights"`
			ActionItems      []VoiceCallSummaryActionItem `json:"action_items"`
		} `json:"voice_call_summary"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil || meta.Summary.CallID == "" {
		return nil
	}
	return &VoiceCallSummaryInfo{
		CallID:           meta.Summary.CallID,
		CallLogMessageID: meta.Summary.CallLogMessageID,
		Summary:          strings.TrimSpace(meta.Summary.Summary),
		Highlights:       meta.Summary.Highlights,
		ActionItems:      meta.Summary.ActionItems,
	}
}

func summaryMessageIDFromCallLog(ctx context.Context, q *db.Queries, callLogID string) string {
	msg, err := q.GetChatMessageByID(ctx, callLogID)
	if err != nil {
		return ""
	}
	var meta struct {
		SummaryMessageID string `json:"summary_message_id"`
	}
	if len(msg.Metadata) == 0 {
		return ""
	}
	if err := json.Unmarshal(msg.Metadata, &meta); err != nil {
		return ""
	}
	return strings.TrimSpace(meta.SummaryMessageID)
}

func patchCallLogSummaryMessageID(ctx context.Context, q *db.Queries, callLogID, roomID, wsID, summaryMsgID string) error {
	msg, err := q.GetChatMessageByID(ctx, callLogID)
	if err != nil {
		return err
	}
	var meta map[string]any
	if len(msg.Metadata) > 0 {
		_ = json.Unmarshal(msg.Metadata, &meta)
	}
	if meta == nil {
		meta = map[string]any{}
	}
	meta["summary_message_id"] = summaryMsgID
	raw, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	_, err = q.UpdateChatMessageMetadata(ctx, db.UpdateChatMessageMetadataParams{
		ID: callLogID, RoomID: roomID, WorkspaceID: wsID, Metadata: raw,
	})
	return err
}

func formatVoiceCallParticipantNames(participants []VoiceCallParticipant) string {
	names := make([]string, 0, len(participants))
	for _, p := range participants {
		name := strings.TrimSpace(p.DisplayName)
		if name == "" {
			name = p.UserID
		}
		names = append(names, name)
	}
	return strings.Join(names, ", ")
}

func formatVoiceCallDurationLabel(seconds int) string {
	if seconds <= 0 {
		return ""
	}
	m := seconds / 60
	s := seconds % 60
	if m >= 60 {
		h := m / 60
		m = m % 60
		return fmt.Sprintf("%d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%d:%02d", m, s)
}
