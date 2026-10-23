package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	chatVoiceTranscriptResource = "chat_voice_transcript"
	chatVoiceTranscriptDone     = "done"
	// A pending claim older than this is taken over. It outlasts the longest
	// vendor call the gateway allows (4 min), so a live call is never doubled.
	chatVoiceTranscriptClaimTTL = 5 * time.Minute
)

// ChatVoiceTranscript is the stored text of one voice message.
type ChatVoiceTranscript struct {
	Text string
	// Language is what the vendor detected, in its own words; "" when unknown.
	Language string
}

func errChatMessageNotVoice() error {
	return coded(http.StatusUnprocessableEntity, "chat_message_not_voice", "chỉ chép được tin nhắn thoại")
}

func errChatVoiceAudioUnavailable() error {
	return coded(http.StatusUnprocessableEntity, "chat_voice_audio_unavailable", "không đọc được âm thanh của tin nhắn thoại này")
}

// errChatTranscriptPending: another reader's transcription is running; the
// client asks again shortly and gets the stored text.
func errChatTranscriptPending() error {
	return coded(http.StatusConflict, "chat_transcript_pending", "tin nhắn thoại đang được chép, thử lại sau giây lát")
}

// TranscribeVoiceMessage returns the transcript of a voice message the caller
// may read (UNI-1908 F2). The first reader pays: they claim the message's row
// ('pending'), call the gateway's cloud transcriber (metered on the
// organization's AI credits) holding no database connection, then store the
// text and audit it in one short transaction. Readers who arrive meanwhile get
// chat_transcript_pending; everyone after gets the stored text for free.
func (s *ChatService) TranscribeVoiceMessage(ctx context.Context, userID, workspaceID, messageID string) (ChatVoiceTranscript, error) {
	room, msg, err := s.loadMessageForLink(ctx, userID, workspaceID, messageID)
	if err != nil {
		return ChatVoiceTranscript{}, err
	}
	if msg.Kind != "voice" {
		return ChatVoiceTranscript{}, errChatMessageNotVoice()
	}
	key := db.GetChatVoiceTranscriptParams{OrganizationID: room.OrganizationID, MessageID: msg.ID}
	staleBefore := time.Now().Add(-chatVoiceTranscriptClaimTTL)
	if out, done, err := s.storedVoiceTranscript(ctx, key, staleBefore); done || err != nil {
		return out, err
	}
	// The same switch the call summary reads: no gateway, no AI.
	if s.ai == nil || !s.ai.Enabled() {
		return ChatVoiceTranscript{}, ai.ErrDisabled
	}
	if !s.ai.CloudAvailability().Transcribe {
		return ChatVoiceTranscript{}, ai.ErrCloudUnavailable
	}
	audio, err := s.voiceMessageAudio(ctx, userID, workspaceID, room.ID, msg.ID)
	if err != nil {
		return ChatVoiceTranscript{}, err
	}
	claim, err := s.q.ClaimChatVoiceTranscript(ctx, db.ClaimChatVoiceTranscriptParams{
		ID: util.NewID(), OrganizationID: room.OrganizationID, WorkspaceID: msg.WorkspaceID, MessageID: msg.ID,
		CreatedBy: userID, CreatedByKind: string(audit.KindHuman),
		StaleBefore: pgtype.Timestamptz{Time: staleBefore, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Lost the race: the winner is transcribing, or has just finished.
		out, done, err := s.storedVoiceTranscript(ctx, key, staleBefore)
		if done || err != nil {
			return out, err
		}
		return ChatVoiceTranscript{}, errChatTranscriptPending()
	}
	if err != nil {
		return ChatVoiceTranscript{}, err
	}

	// Only the claim's holder reaches the gateway, so the message is paid once.
	res, err := s.ai.CloudTranscribe(ctx, ai.CloudCall{Actor: Human(userID), OrganizationID: room.OrganizationID},
		provider.TranscribeRequest{Audio: audio})
	// From here the outcome is stored even if the client hangs up.
	wctx := context.WithoutCancel(ctx)
	if err != nil {
		// Free the claim so the next reader can try again (a claim left behind
		// goes stale and is retaken anyway).
		_ = s.q.ReleaseChatVoiceTranscriptClaim(wctx, db.ReleaseChatVoiceTranscriptClaimParams{
			ID: claim.ID, OrganizationID: room.OrganizationID,
		})
		return ChatVoiceTranscript{}, err
	}
	out := ChatVoiceTranscript{Text: strings.TrimSpace(res.Text), Language: strings.TrimSpace(res.Language)}
	tx, err := s.pool.Begin(wctx)
	if err != nil {
		return ChatVoiceTranscript{}, err
	}
	defer func() { _ = tx.Rollback(wctx) }()
	q := s.q.WithTx(tx)
	row, err := q.FinishChatVoiceTranscript(wctx, db.FinishChatVoiceTranscriptParams{
		ID: claim.ID, OrganizationID: room.OrganizationID, Text: out.Text, Language: out.Language,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// The claim went stale and was retaken mid-call: this reader still
		// gets what it paid for; the new holder stores its own.
		return out, nil
	}
	if err != nil {
		return ChatVoiceTranscript{}, err
	}
	if err := auditRecorder.Record(wctx, q, audit.Entry{
		OrganizationID: room.OrganizationID, WorkspaceID: msg.WorkspaceID,
		Actor: Human(userID), Action: audit.ActionChatVoiceTranscribed,
		ResourceType: chatVoiceTranscriptResource, ResourceID: row.ID,
		Metadata: map[string]any{"message_id": msg.ID, "room_id": room.ID},
	}); err != nil {
		return ChatVoiceTranscript{}, err
	}
	if err := tx.Commit(wctx); err != nil {
		return ChatVoiceTranscript{}, err
	}
	return out, nil
}

// storedVoiceTranscript reads the message's row: done=true with the text when
// it is finished, chat_transcript_pending while a live claim holds it, and
// neither when there is no row or only a stale claim to take over.
func (s *ChatService) storedVoiceTranscript(ctx context.Context, key db.GetChatVoiceTranscriptParams, staleBefore time.Time) (ChatVoiceTranscript, bool, error) {
	row, err := s.q.GetChatVoiceTranscript(ctx, key)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return ChatVoiceTranscript{}, false, nil
	case err != nil:
		return ChatVoiceTranscript{}, false, err
	case row.Status == chatVoiceTranscriptDone:
		return ChatVoiceTranscript{Text: row.Text, Language: row.Language}, true, nil
	case row.ClaimedAt.Time.After(staleBefore):
		return ChatVoiceTranscript{}, false, errChatTranscriptPending()
	}
	return ChatVoiceTranscript{}, false, nil
}

// voiceMessageAudio reads the voice note's bytes through FileService. A row
// from before the FileService move has no file to read and is refused.
func (s *ChatService) voiceMessageAudio(ctx context.Context, userID, workspaceID, roomID, messageID string) (provider.Part, error) {
	_, rd, err := s.OpenChatVoiceMessage(ctx, userID, workspaceID, roomID, messageID)
	if err != nil {
		return provider.Part{}, err
	}
	defer rd.Close()
	if rd.Body == nil {
		return provider.Part{}, errChatVoiceAudioUnavailable()
	}
	data, err := io.ReadAll(io.LimitReader(rd.Body, MaxChatVoiceMessageBytes+1))
	if err != nil {
		return provider.Part{}, err
	}
	if len(data) == 0 || len(data) > MaxChatVoiceMessageBytes {
		return provider.Part{}, errChatVoiceAudioUnavailable()
	}
	return provider.Part{MIME: canonicalMIME(rd.File.ContentType), Data: data}, nil
}
