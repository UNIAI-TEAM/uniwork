package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// SetConference wires LiveKit (or fake) media for chat voice recording.
func (s *ChatService) SetConference(p meetings.ConferenceProvider) {
	s.conference = p
}

func (s *ChatService) VoiceRecordingEnabled(ctx context.Context) bool {
	return s.conference != nil && s.conference.Capabilities(ctx).Recording
}

// StartVoiceRecording begins LiveKit room-composite egress for an accepted call.
func (s *ChatService) StartVoiceRecording(
	ctx context.Context, userID, workspaceID, roomID, callID string,
) (db.ChatVoiceRecording, error) {
	callID = strings.TrimSpace(callID)
	if callID == "" {
		return db.ChatVoiceRecording{}, Invalid("call_id is required")
	}
	room, err := s.authorizeVoiceSignalRoom(ctx, userID, workspaceID, roomID, true)
	if err != nil {
		return db.ChatVoiceRecording{}, err
	}
	if err := s.requireVoiceCallActor(ctx, room, userID, true); err != nil {
		return db.ChatVoiceRecording{}, err
	}
	if !s.VoiceRecordingEnabled(ctx) {
		return db.ChatVoiceRecording{}, coded(http.StatusServiceUnavailable, "recording_not_configured",
			"ghi âm cuộc gọi chưa được cấu hình trên server")
	}
	if err := s.requireAcceptedVoiceCall(roomID, callID); err != nil {
		return db.ChatVoiceRecording{}, err
	}
	if active, err := s.q.GetActiveChatVoiceRecording(ctx, db.GetActiveChatVoiceRecordingParams{
		RoomID: room.ID, CallID: callID,
	}); err == nil {
		// One egress per call — another participant already started; join the same session.
		return active, nil
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return db.ChatVoiceRecording{}, err
	}
	liveKitRoom, err := liveKitRoomForActiveVoiceCall(room, callID)
	if err != nil {
		return db.ChatVoiceRecording{}, err
	}
	orgID := roomOrganizationID(room)
	wsID := roomAnchorWorkspaceID(room)
	ref, err := s.conference.StartRecording(ctx, meetings.StartRecordingRequest{
		RoomName:   liveKitRoom,
		FilePrefix: "chat-voice/" + orgID + "/" + room.ID + "/" + callID,
		// grid keeps cameras equal-sized; LiveKit switches to speaker when
		// someone starts screen share during the recording.
		Layout: "grid",
	})
	if err != nil {
		return db.ChatVoiceRecording{}, coded(http.StatusBadGateway, "recording_failed",
			"không bắt đầu ghi âm được: "+err.Error())
	}
	rec, err := s.q.InsertChatVoiceRecording(ctx, db.InsertChatVoiceRecordingParams{
		ID:             util.NewID(),
		OrganizationID: orgID,
		WorkspaceID:    wsID,
		RoomID:         room.ID,
		CallID:         callID,
		EgressID:       ref.RecordingID,
		StartedBy:      userID,
	})
	if err != nil {
		_ = s.conference.StopRecording(ctx, meetings.StopRecordingRequest(ref))
		return db.ChatVoiceRecording{}, err
	}
	_ = s.publishVoiceRoomSignal(ctx, room, userID, Event{
		Type: "chat.voice.recording.started",
		Payload: map[string]string{
			"room_id": room.ID, "call_id": callID, "user_id": userID,
		},
	})
	return rec, nil
}

// StopVoiceRecording stops the active egress; the webhook finishes with the file URL.
func (s *ChatService) StopVoiceRecording(
	ctx context.Context, userID, workspaceID, roomID, callID string,
) (db.ChatVoiceRecording, error) {
	callID = strings.TrimSpace(callID)
	if callID == "" {
		return db.ChatVoiceRecording{}, Invalid("call_id is required")
	}
	room, err := s.authorizeVoiceSignalRoom(ctx, userID, workspaceID, roomID, true)
	if err != nil {
		return db.ChatVoiceRecording{}, err
	}
	if err := s.requireVoiceCallActor(ctx, room, userID, false); err != nil {
		return db.ChatVoiceRecording{}, err
	}
	rec, err := s.stopActiveVoiceRecording(ctx, room, callID, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.ChatVoiceRecording{}, coded(http.StatusConflict, "recording_not_active",
			"không có bản ghi nào đang chạy")
	}
	return rec, err
}

func (s *ChatService) stopActiveVoiceRecording(
	ctx context.Context, room db.ChatRoom, callID, actorID string,
) (db.ChatVoiceRecording, error) {
	active, err := s.q.GetActiveChatVoiceRecording(ctx, db.GetActiveChatVoiceRecordingParams{
		RoomID: room.ID, CallID: callID,
	})
	if err != nil {
		return db.ChatVoiceRecording{}, err
	}
	if s.conference != nil {
		if stopErr := s.conference.StopRecording(ctx, meetings.StopRecordingRequest{
			RecordingID: active.EgressID,
		}); stopErr != nil {
			return db.ChatVoiceRecording{}, coded(http.StatusBadGateway, "recording_failed",
				"không dừng ghi âm được: "+stopErr.Error())
		}
	}
	rec, err := s.q.FinishChatVoiceRecording(ctx, db.FinishChatVoiceRecordingParams{
		ID:     active.ID,
		Status: RecordingProcessing,
	})
	if err != nil {
		return db.ChatVoiceRecording{}, err
	}
	_ = s.publishVoiceRoomSignal(ctx, room, actorID, Event{
		Type: "chat.voice.recording.stopped",
		Payload: map[string]string{
			"room_id": room.ID, "call_id": callID, "user_id": actorID,
		},
	})
	return rec, nil
}

// FinishVoiceRecordingByEgress is called from the LiveKit webhook path when
// meeting_recordings has no matching egress (chat call recording).
func (s *ChatService) FinishVoiceRecordingByEgress(ctx context.Context, ev ProviderNeutralEvent) {
	status := RecordingComplete
	if ev.RecordingFailed {
		status = RecordingFailed
	}
	rec, err := s.q.FinishChatVoiceRecordingByEgress(ctx, db.FinishChatVoiceRecordingByEgressParams{
		EgressID: ev.RecordingID,
		Status:   status,
		FileUrl:  strText(storage.NormalizeObjectURL(ev.RecordingURL)),
	})
	if err != nil {
		return
	}
	s.patchVoiceCallLogRecording(ctx, rec)
}

func (s *ChatService) requireAcceptedVoiceCall(roomID, callID string) error {
	raw, ok := voiceCallSessions.Load(voiceCallSessionKey(roomID, callID))
	if !ok {
		return ErrForbidden
	}
	sess := raw.(voiceCallSession)
	if sess.acceptedAt == nil {
		return coded(http.StatusConflict, "call_not_connected", "chỉ ghi âm sau khi cuộc gọi đã kết nối")
	}
	return nil
}

func (s *ChatService) stopVoiceRecordingOnHangup(ctx context.Context, room db.ChatRoom, callID, actorID string) {
	if _, err := s.q.GetActiveChatVoiceRecording(ctx, db.GetActiveChatVoiceRecordingParams{
		RoomID: room.ID, CallID: callID,
	}); errors.Is(err, pgx.ErrNoRows) {
		return
	} else if err != nil {
		return
	}
	_, _ = s.stopActiveVoiceRecording(ctx, room, callID, actorID)
}

func (s *ChatService) attachVoiceRecordingToCallLog(
	ctx context.Context, room db.ChatRoom, callID, messageID string, meta map[string]any,
) map[string]any {
	rec, err := s.q.AttachChatVoiceRecordingCallLog(ctx, db.AttachChatVoiceRecordingCallLogParams{
		RoomID:           room.ID,
		CallLogMessageID: strText(messageID),
		CallID:           callID,
	})
	if err != nil {
		rows, listErr := s.q.ListChatVoiceRecordingsForCall(ctx, db.ListChatVoiceRecordingsForCallParams{
			RoomID: room.ID, CallID: callID,
		})
		if listErr != nil || len(rows) == 0 {
			return meta
		}
		rec = rows[0]
	}
	meta["recording_id"] = rec.ID
	meta["recording_status"] = rec.Status
	if rec.FileUrl.Valid && rec.FileUrl.String != "" {
		meta["recording_url"] = rec.FileUrl.String
	}
	return meta
}

// ActiveVoiceRecording returns the in-progress egress for a call, if any.
func (s *ChatService) ActiveVoiceRecording(
	ctx context.Context, userID, workspaceID, roomID, callID string,
) (db.ChatVoiceRecording, error) {
	callID = strings.TrimSpace(callID)
	if callID == "" {
		return db.ChatVoiceRecording{}, Invalid("call_id is required")
	}
	room, err := s.authorizeVoiceSignalRoom(ctx, userID, workspaceID, roomID, true)
	if err != nil {
		return db.ChatVoiceRecording{}, err
	}
	rec, err := s.q.GetActiveChatVoiceRecording(ctx, db.GetActiveChatVoiceRecordingParams{
		RoomID: room.ID, CallID: callID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.ChatVoiceRecording{}, ErrNotFound
	}
	return rec, err
}

// ListVoiceRecordings returns recent call recordings for a chat room.
func (s *ChatService) ListVoiceRecordings(
	ctx context.Context, userID, workspaceID, roomID string, limit int32,
) ([]db.ChatVoiceRecording, error) {
	if _, err := s.authorizeVoiceSignalRoom(ctx, userID, workspaceID, roomID, false); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.q.ListChatVoiceRecordingsForRoom(ctx, db.ListChatVoiceRecordingsForRoomParams{
		WorkspaceID: workspaceID,
		RoomID:      roomID,
		Limit:       limit,
	})
}

// GetVoiceRecordingForPlayback returns a completed recording the caller may stream.
func (s *ChatService) GetVoiceRecordingForPlayback(
	ctx context.Context, userID, workspaceID, roomID, recordingID string,
) (db.ChatVoiceRecording, error) {
	recordingID = strings.TrimSpace(recordingID)
	if recordingID == "" {
		return db.ChatVoiceRecording{}, Invalid("recording_id is required")
	}
	if _, err := s.authorizeVoiceSignalRoom(ctx, userID, workspaceID, roomID, false); err != nil {
		return db.ChatVoiceRecording{}, err
	}
	rec, err := s.q.GetChatVoiceRecordingByID(ctx, db.GetChatVoiceRecordingByIDParams{
		ID: recordingID, WorkspaceID: workspaceID, RoomID: roomID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.ChatVoiceRecording{}, ErrNotFound
		}
		return db.ChatVoiceRecording{}, err
	}
	if rec.Status != RecordingComplete {
		return db.ChatVoiceRecording{}, coded(http.StatusConflict, "recording_not_ready",
			"bản ghi chưa sẵn sàng")
	}
	if !rec.FileUrl.Valid || strings.TrimSpace(rec.FileUrl.String) == "" {
		return db.ChatVoiceRecording{}, ErrNotFound
	}
	return rec, nil
}

func (s *ChatService) patchVoiceCallLogRecording(ctx context.Context, rec db.ChatVoiceRecording) {
	if !rec.CallLogMessageID.Valid || rec.CallLogMessageID.String == "" {
		return
	}
	msg, err := s.q.GetChatMessageByID(ctx, rec.CallLogMessageID.String)
	if err != nil {
		return
	}
	var meta map[string]any
	if len(msg.Metadata) > 0 {
		_ = json.Unmarshal(msg.Metadata, &meta)
	}
	if meta == nil {
		meta = map[string]any{}
	}
	meta["recording_id"] = rec.ID
	meta["recording_status"] = rec.Status
	if rec.FileUrl.Valid && rec.FileUrl.String != "" {
		meta["recording_url"] = rec.FileUrl.String
	}
	raw, err := json.Marshal(meta)
	if err != nil {
		return
	}
	updated, err := s.q.UpdateChatMessageMetadata(ctx, db.UpdateChatMessageMetadataParams{
		ID: msg.ID, RoomID: msg.RoomID, WorkspaceID: msg.WorkspaceID, Metadata: raw,
	})
	if err != nil {
		return
	}
	room, err := s.q.GetChatRoomByID(ctx, updated.RoomID)
	if err != nil {
		return
	}
	s.publishChatMessageUpdated(ctx, room, updated.ID)
}
