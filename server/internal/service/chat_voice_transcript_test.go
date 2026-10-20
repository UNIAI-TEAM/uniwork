package service

import (
	"bytes"
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// countingTranscriber is a vendor that counts how often it was paid. With
// hold set, each call reports on started and waits for release, so a test can
// act while a transcription is in flight; fail makes the call fail.
type countingTranscriber struct {
	calls   atomic.Int32
	fail    atomic.Bool
	hold    bool
	started chan struct{}
	release chan struct{}
}

func (c *countingTranscriber) Name() string  { return "fake" }
func (c *countingTranscriber) Model() string { return "fake-transcribe" }

func (c *countingTranscriber) Transcribe(context.Context, provider.TranscribeRequest) (provider.TranscribeResponse, error) {
	c.calls.Add(1)
	if c.hold {
		c.started <- struct{}{}
		<-c.release
	}
	if c.fail.Load() {
		return provider.TranscribeResponse{}, errors.New("vendor down")
	}
	return provider.TranscribeResponse{Text: " Lan chỉnh giúp màu nút CTA nhé. ", Seconds: 4, Language: "vietnamese"}, nil
}

// withTranscriber wires what a transcription needs onto s: FileService for the
// audio and a gateway whose cloud transcriber is tr (nil: none configured).
func withTranscriber(s *ChatService, pool *pgxpool.Pool, q *db.Queries, tr provider.Transcriber) {
	s.SetFiles(filesfake.New(filesfake.Options{}))
	s.SetAIGateway(ai.NewGateway(q, &provider.Fake{Reply: ai.FakeReply}, NewAIQuota(NewEntitlementService(pool, q)), nil,
		ai.Options{Cloud: ai.CloudTools{Transcriber: tr}}))
}

type transcriptFixture struct {
	s        *ChatService
	pool     *pgxpool.Pool
	q        *db.Queries
	ua, ub   db.User
	w        db.Workspace
	dmID     string
	voiceID  string
	textID   string
	outsider db.User
	vendor   *countingTranscriber
}

func newTranscriptFixture(t *testing.T) transcriptFixture {
	t.Helper()
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	outsider := registerVerified(t, q, as, "chat-c@example.com", "C")
	addOrgMember(t, q, w.OrganizationID, outsider.ID)
	addWorkspaceMember(t, q, w.ID, outsider.ID)
	vendor := &countingTranscriber{started: make(chan struct{}, 1), release: make(chan struct{})}
	withTranscriber(s, pool, q, vendor)
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	voice, err := s.SendVoiceMessage(ctx, ua.ID, w.ID, dm.ID, SendVoiceMessageInput{DurationMS: 4000, Body: bytes.NewReader(tinyFSVoiceBytes)})
	if err != nil {
		t.Fatalf("send voice: %v", err)
	}
	text, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "chữ"})
	if err != nil {
		t.Fatal(err)
	}
	return transcriptFixture{s: s, pool: pool, q: q, ua: ua, ub: ub, w: w, dmID: dm.ID, voiceID: voice.ID, textID: text.ID, outsider: outsider, vendor: vendor}
}

func (f transcriptFixture) charges(t *testing.T) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM ai_usage_events WHERE organization_id = $1 AND capability = $2 AND status = 'succeeded'`,
		f.w.OrganizationID, string(ai.CapCloudTranscribe)).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// The first reader pays once and stores the text; the next reader, the
// sender, gets the stored text with no second vendor call or charge.
func TestTranscribeVoiceMessageStoresOnceAndServesTheStoredText(t *testing.T) {
	f := newTranscriptFixture(t)
	ctx := context.Background()

	got, err := f.s.TranscribeVoiceMessage(ctx, f.ub.ID, f.w.ID, f.voiceID)
	if err != nil {
		t.Fatalf("first transcription: %v", err)
	}
	if got.Text != "Lan chỉnh giúp màu nút CTA nhé." || got.Language != "vietnamese" {
		t.Fatalf("transcript = %+v", got)
	}
	row, err := f.q.GetChatVoiceTranscript(ctx, db.GetChatVoiceTranscriptParams{OrganizationID: f.w.OrganizationID, MessageID: f.voiceID})
	if err != nil {
		t.Fatalf("stored row: %v", err)
	}
	if row.CreatedBy != f.ub.ID || row.CreatedByKind != "human" || row.WorkspaceID != f.w.ID {
		t.Fatalf("stored row = %+v", row)
	}

	again, err := f.s.TranscribeVoiceMessage(ctx, f.ua.ID, f.w.ID, f.voiceID)
	if err != nil || again != got {
		t.Fatalf("second transcription = %+v, %v; want the stored %+v", again, err, got)
	}
	if n := f.vendor.calls.Load(); n != 1 {
		t.Fatalf("vendor called %d times, want 1", n)
	}
	if n := f.charges(t); n != 1 {
		t.Fatalf("%d charged usage rows, want 1", n)
	}
}

// A reader who asks while the first transcription is in flight is told it is
// pending, without a second vendor call; once it lands they get the text.
func TestTranscribeVoiceMessageSecondReaderWaitsForTheFirst(t *testing.T) {
	f := newTranscriptFixture(t)
	f.vendor.hold = true
	ctx := context.Background()
	var first ChatVoiceTranscript
	var firstErr error
	done := make(chan struct{})
	go func() {
		defer close(done)
		first, firstErr = f.s.TranscribeVoiceMessage(ctx, f.ub.ID, f.w.ID, f.voiceID)
	}()
	<-f.vendor.started
	if _, err := f.s.TranscribeVoiceMessage(ctx, f.ua.ID, f.w.ID, f.voiceID); !codedIs(err, "chat_transcript_pending") {
		t.Fatalf("second reader during the call: err = %v, want chat_transcript_pending", err)
	}
	close(f.vendor.release)
	<-done
	if firstErr != nil {
		t.Fatalf("first reader: %v", firstErr)
	}
	second, err := f.s.TranscribeVoiceMessage(ctx, f.ua.ID, f.w.ID, f.voiceID)
	if err != nil || second != first {
		t.Fatalf("second reader after = %+v, %v; want %+v", second, err, first)
	}
	if n := f.vendor.calls.Load(); n != 1 {
		t.Fatalf("vendor called %d times, want 1", n)
	}
	if n := f.charges(t); n != 1 {
		t.Fatalf("%d charged usage rows, want 1", n)
	}
}

// Two first requests at once: exactly one wins the claim and pays.
func TestTranscribeVoiceMessageConcurrentFirstRequestsPayOnce(t *testing.T) {
	f := newTranscriptFixture(t)
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, user := range []string{f.ua.ID, f.ub.ID} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = f.s.TranscribeVoiceMessage(context.Background(), user, f.w.ID, f.voiceID)
		}()
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil && !codedIs(err, "chat_transcript_pending") {
			t.Fatalf("request %d: %v", i, err)
		}
	}
	if n := f.vendor.calls.Load(); n != 1 {
		t.Fatalf("vendor called %d times, want 1", n)
	}
	if n := f.charges(t); n != 1 {
		t.Fatalf("%d charged usage rows, want 1", n)
	}
}

// A claim whose holder died mid-call is taken over once it is stale.
func TestTranscribeVoiceMessageRetakesAStaleClaim(t *testing.T) {
	f := newTranscriptFixture(t)
	ctx := context.Background()
	if _, err := f.pool.Exec(ctx, `INSERT INTO chat_voice_transcripts
		(id, organization_id, workspace_id, message_id, status, claimed_at, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, 'pending', now() - interval '10 minutes', $5, 'human')`,
		"stale-claim", f.w.OrganizationID, f.w.ID, f.voiceID, f.ua.ID); err != nil {
		t.Fatal(err)
	}
	got, err := f.s.TranscribeVoiceMessage(ctx, f.ub.ID, f.w.ID, f.voiceID)
	if err != nil || got.Text == "" {
		t.Fatalf("retake = %+v, %v", got, err)
	}
	row, err := f.q.GetChatVoiceTranscript(ctx, db.GetChatVoiceTranscriptParams{OrganizationID: f.w.OrganizationID, MessageID: f.voiceID})
	if err != nil || row.Status != chatVoiceTranscriptDone || row.ID == "stale-claim" || row.CreatedBy != f.ub.ID {
		t.Fatalf("row after retake = %+v, %v", row, err)
	}
	if n := f.vendor.calls.Load(); n != 1 {
		t.Fatalf("vendor called %d times, want 1", n)
	}
}

// A vendor failure frees the claim: the next reader claims again and succeeds.
func TestTranscribeVoiceMessageFailureFreesTheClaim(t *testing.T) {
	f := newTranscriptFixture(t)
	ctx := context.Background()
	f.vendor.fail.Store(true)
	if _, err := f.s.TranscribeVoiceMessage(ctx, f.ub.ID, f.w.ID, f.voiceID); !errors.Is(err, ai.ErrProviderError) {
		t.Fatalf("vendor down: err = %v, want ai_provider_error", err)
	}
	if _, err := f.q.GetChatVoiceTranscript(ctx, db.GetChatVoiceTranscriptParams{OrganizationID: f.w.OrganizationID, MessageID: f.voiceID}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("claim after failure: err = %v, want no row", err)
	}
	f.vendor.fail.Store(false)
	if got, err := f.s.TranscribeVoiceMessage(ctx, f.ub.ID, f.w.ID, f.voiceID); err != nil || got.Text == "" {
		t.Fatalf("retry = %+v, %v", got, err)
	}
	if n := f.vendor.calls.Load(); n != 2 {
		t.Fatalf("vendor called %d times, want 2", n)
	}
	if n := f.charges(t); n != 1 {
		t.Fatalf("%d charged usage rows, want 1 (the failed call is not charged)", n)
	}
}

func TestTranscribeVoiceMessageRefusals(t *testing.T) {
	f := newTranscriptFixture(t)
	ctx := context.Background()

	// A workspace member outside the DM cannot read it: not found, no charge.
	if _, err := f.s.TranscribeVoiceMessage(ctx, f.outsider.ID, f.w.ID, f.voiceID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member: err = %v, want ErrNotFound", err)
	}
	if _, err := f.s.TranscribeVoiceMessage(ctx, f.ua.ID, f.w.ID, f.textID); !codedIs(err, "chat_message_not_voice") {
		t.Fatalf("text message: err = %v, want chat_message_not_voice", err)
	}

	// The server has a gateway but no transcriber: an explicit refusal.
	withTranscriber(f.s, f.pool, f.q, nil)
	if _, err := f.s.TranscribeVoiceMessage(ctx, f.ua.ID, f.w.ID, f.voiceID); !errors.Is(err, ai.ErrCloudUnavailable) {
		t.Fatalf("no transcriber: err = %v, want cloud_unavailable", err)
	}
	// AI off (no provider), the switch the call summary reads.
	f.s.SetAIGateway(nil)
	if _, err := f.s.TranscribeVoiceMessage(ctx, f.ua.ID, f.w.ID, f.voiceID); !errors.Is(err, ai.ErrDisabled) {
		t.Fatalf("AI disabled: err = %v, want ai_disabled", err)
	}
	if n := f.vendor.calls.Load(); n != 0 {
		t.Fatalf("vendor called %d times on refusals, want 0", n)
	}
	if n := f.charges(t); n != 0 {
		t.Fatalf("%d charged usage rows on refusals, want 0", n)
	}
}
