package ai

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The store tests of G6-03a W-B (design §9, §10): the transcript lives in
// ai_uniwork_conversations / ai_uniwork_turns, sealed with secretbox, and A9's
// cleanup triggers are the store's own methods. The DB-backed half skips
// where TEST_DATABASE_URL is not set (the cloud round owns those rows).

const (
	testKeyMaterial  = "uniwork-conversation-test-key-32"
	otherKeyMaterial = "uniwork-conversation-other-key-3"
)

func testConversationBox(t *testing.T) *secretbox.Box {
	t.Helper()
	box, err := secretbox.New([]byte(testKeyMaterial))
	if err != nil {
		t.Fatal(err)
	}
	return box
}

func otherConversationBox(t *testing.T) *secretbox.Box {
	t.Helper()
	box, err := secretbox.New([]byte(otherKeyMaterial))
	if err != nil {
		t.Fatal(err)
	}
	return box
}

// conversationStoreFixture is the DB-backed store the cloud round runs. The
// two tables are not in testutil.DB's TRUNCATE list (the rows are the test's
// own), so the fixture clears them.
func conversationStoreFixture(t *testing.T) (*ConversationStorePG, *pgxpool.Pool) {
	t.Helper()
	pool := testutil.DB(t)
	store := NewConversationStore(pool, db.New(pool), testConversationBox(t))
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, "DELETE FROM ai_uniwork_turns")
		_, _ = pool.Exec(ctx, "DELETE FROM ai_uniwork_conversations")
	})
	return store, pool
}

func mustCount(t *testing.T, pool *pgxpool.Pool, query string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// A turn round-trips as the provider.Message the model saw, a wrong or rotated
// key cannot open it, tampering fails the GCM tag, and a store without
// AI_CONVERSATION_KEY fails closed instead of storing plaintext.
func TestAIUniworkTurnSealRoundTrip(t *testing.T) {
	store := NewConversationStore(nil, nil, testConversationBox(t))
	msg := provider.Message{
		Role: "assistant", Content: "Ô A1 bằng 42.",
		ToolCalls: []provider.ToolCall{{ID: "call_1", Name: "set_cell", Input: []byte(`{"cell":"A1","value":42}`)}},
	}
	sealed, err := store.sealTurn(msg)
	if err != nil {
		t.Fatal(err)
	}
	if string(sealed) == msg.Content {
		t.Fatal("the transcript was not sealed")
	}
	back, err := store.openTurn(sealed)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := mustJSON(t, back), mustJSON(t, msg); got != want {
		t.Fatalf("turn did not round-trip:\n%s\n%s", got, want)
	}
	if _, err := NewConversationStore(nil, nil, otherConversationBox(t)).openTurn(sealed); err == nil {
		t.Fatal("another key opened the transcript")
	}
	tampered := append([]byte(nil), sealed...)
	tampered[len(tampered)-1] ^= 0xff
	if _, err := store.openTurn(tampered); err == nil {
		t.Fatal("a tampered turn was accepted")
	}

	disabled := NewConversationStore(nil, nil, nil)
	if _, err := disabled.sealTurn(msg); !errors.Is(err, ErrConversationStoreDisabled) {
		t.Fatalf("seal without a key = %v, want ErrConversationStoreDisabled", err)
	}
	if _, err := disabled.Resume(context.Background(), ConversationKey{OrganizationID: "o", UserID: "u"}, ""); !errors.Is(err, ErrConversationStoreDisabled) {
		t.Fatalf("resume without a key = %v, want ErrConversationStoreDisabled", err)
	}
}

// fakeConversations records what the consumer and the TTL worker asked for; it
// implements ConversationStore plus the worker's ConversationMaintenance.
type fakeConversations struct {
	sweptCount     int64
	sweepErr       error
	organizations  []string
	orgsErr        error
	live           int64
	deleted        []string
	deletedDocs    [][2]string
	deletedUsers   [][2]string
	deletedUsersIn []string
	deletedOrgs    []string
}

func (*fakeConversations) Resume(context.Context, ConversationKey, string) (Conversation, error) {
	return Conversation{}, ErrConversationExpired
}
func (*fakeConversations) Create(context.Context, ConversationKey) (Conversation, error) {
	return Conversation{ID: "conv-1"}, nil
}
func (*fakeConversations) Append(context.Context, string, []Turn) error { return nil }
func (*fakeConversations) Rollback(context.Context, string, int) error  { return nil }
func (f *fakeConversations) Delete(_ context.Context, id string) error {
	f.deleted = append(f.deleted, id)
	return nil
}
func (f *fakeConversations) DeleteByDocument(_ context.Context, organizationID, documentID string) error {
	f.deletedDocs = append(f.deletedDocs, [2]string{organizationID, documentID})
	return nil
}
func (f *fakeConversations) DeleteByUserDocument(context.Context, string, string, string) error {
	return nil
}
func (f *fakeConversations) DeleteByUser(_ context.Context, organizationID, userID string) error {
	f.deletedUsers = append(f.deletedUsers, [2]string{organizationID, userID})
	return nil
}
func (f *fakeConversations) DeleteByUserAllOrgs(_ context.Context, userID string) error {
	f.deletedUsersIn = append(f.deletedUsersIn, userID)
	return nil
}
func (f *fakeConversations) DeleteByOrganization(_ context.Context, organizationID string) error {
	f.deletedOrgs = append(f.deletedOrgs, organizationID)
	return nil
}
func (f *fakeConversations) Sweep(context.Context, time.Time) (int64, error) {
	return f.sweptCount, f.sweepErr
}
func (f *fakeConversations) Organizations(context.Context) ([]string, error) {
	return f.organizations, f.orgsErr
}
func (f *fakeConversations) LiveConversations(context.Context, time.Time) (int64, error) {
	return f.live, nil
}
func (f *fakeConversations) DeleteOrganizationConversations(_ context.Context, organizationID string) (int64, error) {
	f.deletedOrgs = append(f.deletedOrgs, organizationID)
	return 1, nil
}

// The cleanup consumer wears the five topics of A9 and calls the store with
// the ids the outbox row carries: the document for document.deleted, the
// organization from the payload (or the row) for the member events, and every
// organization holding one for the user a session.revoked ends.
func TestAIUniworkConversationCleanupConsumer(t *testing.T) {
	ctx := context.Background()
	store := &fakeConversations{}
	c := NewConversationCleanupConsumer(store)
	if got := c.Topics(); len(got) != 5 {
		t.Fatalf("topics = %v, want document.deleted, member.removed, member.left, member.deactivated, session.revoked", got)
	}
	rows := []outbox.Row{
		{ID: "e1", Topic: "document.deleted", Payload: `{"document_id":"doc-1","workspace_id":"ws-1"}`,
			OrganizationID: pgtype.Text{String: "org-1", Valid: true}},
		{ID: "e2", Topic: "member.removed", Payload: `{"organization_id":"org-1","user_id":"u-2","workspace_id":"ws-1"}`},
		{ID: "e3", Topic: "member.left", Payload: `{"organization_id":"org-1","user_id":"u-3"}`},
		{ID: "e4", Topic: "member.deactivated", Payload: `{"organization_id":"org-1","user_id":"u-4"}`},
		{ID: "e5", Topic: "session.revoked", Payload: `{"user_id":"u-5","session_id":"s-1"}`,
			OrganizationID: pgtype.Text{String: "org-1", Valid: true}},
	}
	for _, row := range rows {
		if err := c.Handle(ctx, row); err != nil {
			t.Fatalf("%s: %v", row.Topic, err)
		}
	}
	if len(store.deletedDocs) != 1 || store.deletedDocs[0] != [2]string{"org-1", "doc-1"} {
		t.Fatalf("document cleanup = %v", store.deletedDocs)
	}
	wantUsers := [][2]string{{"org-1", "u-2"}, {"org-1", "u-3"}, {"org-1", "u-4"}}
	if len(store.deletedUsers) != len(wantUsers) {
		t.Fatalf("user cleanup = %v, want %v", store.deletedUsers, wantUsers)
	}
	for i, want := range wantUsers {
		if store.deletedUsers[i] != want {
			t.Fatalf("user cleanup[%d] = %v, want %v", i, store.deletedUsers[i], want)
		}
	}
	// A sign-out names only the user: the delete spans the organizations, not
	// the row's organization_id.
	if len(store.deletedUsersIn) != 1 || store.deletedUsersIn[0] != "u-5" {
		t.Fatalf("sign-out cleanup = %v, want u-5 across every organization", store.deletedUsersIn)
	}
	// A row that carries no id is a no-op, not a failure: the TTL still ends it.
	if err := c.Handle(ctx, outbox.Row{ID: "e6", Topic: "document.deleted", Payload: `{}`,
		OrganizationID: pgtype.Text{String: "org-1", Valid: true}}); err != nil {
		t.Fatalf("empty payload: %v", err)
	}
	if err := c.Handle(ctx, outbox.Row{ID: "e7", Topic: "member.left", Payload: `{"organization_id":"org-1"}`}); err != nil {
		t.Fatalf("member row without user: %v", err)
	}
	if err := c.Handle(ctx, outbox.Row{ID: "e8", Topic: "session.revoked", Payload: `{}`}); err != nil {
		t.Fatalf("sign-out row without user: %v", err)
	}
	if len(store.deletedDocs) != 1 || len(store.deletedUsers) != len(wantUsers) || len(store.deletedUsersIn) != 1 {
		t.Fatal("a row without ids reached the store")
	}
	// A payload that does not parse is the row's own problem: keep it for retry.
	if err := c.Handle(ctx, outbox.Row{ID: "e9", Topic: "member.left", Payload: `not json`}); err == nil {
		t.Fatal("malformed payload accepted")
	}
}

type recordingConversationMetrics struct {
	swept []struct {
		reason string
		n      int64
	}
	live int64
}

func (m *recordingConversationMetrics) IncUniworkConversationsSwept(reason string, n int64) {
	m.swept = append(m.swept, struct {
		reason string
		n      int64
	}{reason, n})
}

func (m *recordingConversationMetrics) SetUniworkConversationsLive(n int64) { m.live = n }

// One pass sweeps the expired conversations, then visits the organizations
// holding a transcript and deletes the ones whose kill switch is off; the
// metrics carry both reasons and the live gauge.
func TestAIUniworkTTLWorkerSweep(t *testing.T) {
	now := time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC)
	store := &fakeConversations{sweptCount: 3, organizations: []string{"org-off", "org-on"}, live: 7}
	w := NewConversationTTLWorker(store, func(_ context.Context, organizationID string) (bool, error) {
		return organizationID == "org-off", nil
	}, time.Minute, nil)
	w.SetClock(func() time.Time { return now })
	metrics := &recordingConversationMetrics{}
	w.SetMetrics(metrics)

	res, err := w.SweepOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Expired != 3 || res.Disabled != 1 || res.Live != 7 {
		t.Fatalf("result %+v", res)
	}
	if len(store.deletedOrgs) != 1 || store.deletedOrgs[0] != "org-off" {
		t.Fatalf("kill switch cleanup = %v, want org-off only", store.deletedOrgs)
	}
	if len(metrics.swept) != 2 || metrics.swept[0].reason != UniworkSweepReasonExpired || metrics.swept[0].n != 3 ||
		metrics.swept[1].reason != UniworkSweepReasonKillSwitch || metrics.swept[1].n != 1 {
		t.Fatalf("swept metric %+v", metrics.swept)
	}
	if metrics.live != 7 {
		t.Fatalf("live gauge = %d, want 7", metrics.live)
	}
	// A store error is reported, not swallowed: the next tick retries.
	store.sweepErr = errors.New("db down")
	if _, err := w.SweepOnce(context.Background()); err == nil {
		t.Fatal("sweep error swallowed")
	}
}

// Run sweeps once at start and stops with its context, so main.go's shutdown
// sequence can await it.
func TestAIUniworkTTLWorkerRunStopsOnCancel(t *testing.T) {
	store := &fakeConversations{live: 1}
	w := NewConversationTTLWorker(store, nil, 10*time.Millisecond, nil)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { w.Run(ctx); close(done) }()
	time.Sleep(30 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not stop with its context")
	}
}

// A conversation is live until expires_at; a request that resumes a past-TTL
// conversation answers conversation_expired, and the sweep removes the rows
// and their turns - idle (30 min since last_used_at) and absolute (24 h since
// created_at) both land in the same clock.
func TestAIUniworkConversationSweepTTL(t *testing.T) {
	store, pool := conversationStoreFixture(t)
	ctx := context.Background()
	base := time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC)
	store.SetClock(func() time.Time { return base })

	live, err := store.Create(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-live", DocumentID: "doc-live", Module: "sheets"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(ctx, live.ID, []Turn{{RunID: "run-1", Message: provider.Message{Role: "user", Content: "còn sống"}}}); err != nil {
		t.Fatal(err)
	}
	stale, err := store.Create(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-idle", DocumentID: "doc-idle", Module: "sheets"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(ctx, stale.ID, []Turn{{RunID: "run-2", Message: provider.Message{Role: "user", Content: "nhàn rỗi"}}}); err != nil {
		t.Fatal(err)
	}
	old, err := store.Create(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-old", DocumentID: "doc-old", Module: "sheets"})
	if err != nil {
		t.Fatal(err)
	}
	// The idle conversation expired a second before the sweep; the old one
	// was last touched a minute ago but was created 25 hours ago, so only the
	// absolute horizon can retire it.
	if _, err := pool.Exec(ctx, `UPDATE ai_uniwork_conversations
		SET last_used_at = $2, expires_at = $2 WHERE id = $1`, stale.ID, base.Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE ai_uniwork_conversations
		SET created_at = $2::timestamptz, last_used_at = $3, expires_at = $2::timestamptz + interval '24 hours' WHERE id = $1`,
		old.ID, base.Add(-25*time.Hour), base.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}

	// The lazy check answers before any sweep runs.
	if _, err := store.Resume(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-idle", DocumentID: "doc-idle", Module: "sheets"}, stale.ID); !errors.Is(err, ErrConversationExpired) {
		t.Fatalf("resume of an expired conversation = %v, want ErrConversationExpired", err)
	}

	// The sweep is deployment-wide and this database is shared with the other
	// packages' rows, so neither the count it reports nor a whole-table count
	// is this test's to assert. The assertions are about this test's own rows:
	// the two past-TTL conversations go with their turns and the live one
	// stays, so they still fail if the sweep stops deleting expired rows.
	if _, err := store.Sweep(ctx, base); err != nil {
		t.Fatal(err)
	}
	for name, id := range map[string]string{"idle": stale.ID, "absolute": old.ID} {
		if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations WHERE id = $1`, id); got != 0 {
			t.Fatalf("the %s-expired conversation survived the sweep: %d rows", name, got)
		}
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_turns WHERE conversation_id = $1`, stale.ID); got != 0 {
		t.Fatalf("the expired conversation kept %d turns", got)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations WHERE id = $1`, live.ID); got != 1 {
		t.Fatalf("the live conversation was swept: %d rows", got)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_turns WHERE conversation_id = $1`, live.ID); got != 1 {
		t.Fatalf("the live conversation lost turns: %d", got)
	}
	if _, err := store.Sweep(ctx, base); err != nil {
		t.Fatal(err)
	}
}

func TestAIUniworkNewConversationReplacesOld(t *testing.T) {
	store, pool := conversationStoreFixture(t)
	ctx := context.Background()
	store.SetClock(func() time.Time { return time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC) })
	key := ConversationKey{OrganizationID: "org-a", UserID: "u-1", DocumentID: "doc-1", Module: "sheets"}

	first, err := store.Create(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(ctx, first.ID, []Turn{{RunID: "run-1", Message: provider.Message{Role: "user", Content: "lượt cũ"}}}); err != nil {
		t.Fatal(err)
	}
	second, err := store.Create(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID {
		t.Fatal("the second conversation reused the first id")
	}
	if _, err := store.Resume(ctx, key, first.ID); !errors.Is(err, ErrConversationExpired) {
		t.Fatalf("the replaced conversation = %v, want ErrConversationExpired", err)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations WHERE id = $1`, first.ID); got != 0 {
		t.Fatalf("the replaced conversation kept %d rows", got)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_turns WHERE conversation_id = $1`, first.ID); got != 0 {
		t.Fatalf("the replaced conversation kept %d turns", got)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations`); got != 1 {
		t.Fatalf("%d live conversations, want 1", got)
	}
	// The resume with an empty id finds the newest live conversation of the key.
	got, err := store.Resume(ctx, key, "")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != second.ID {
		t.Fatalf("resume without an id = %s, want %s", got.ID, second.ID)
	}
}

// Create replaces exactly the rows Resume would find for the same key: the
// device part of the binding is honored on both paths, so a device-less
// request never takes a device-bound transcript.
func TestAIUniworkCreateKeepsDeviceBoundConversation(t *testing.T) {
	store, pool := conversationStoreFixture(t)
	ctx := context.Background()
	store.SetClock(func() time.Time { return time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC) })

	boundKey := ConversationKey{OrganizationID: "org-a", UserID: "u-1", Module: "sheets", DeviceID: "dev-1"}
	bound, err := store.Create(ctx, boundKey)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(ctx, bound.ID, []Turn{{Message: provider.Message{Role: "user", Content: "của thiết bị"}}}); err != nil {
		t.Fatal(err)
	}
	fresh, err := store.Create(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-1", Module: "sheets"})
	if err != nil {
		t.Fatal(err)
	}
	if fresh.ID == bound.ID {
		t.Fatal("the device-less create reused the device-bound conversation")
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations WHERE id = $1`, bound.ID); got != 1 {
		t.Fatalf("the device-less create removed the device-bound row: %d left", got)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_turns WHERE conversation_id = $1`, bound.ID); got != 1 {
		t.Fatalf("the device-less create removed the device-bound turns: %d left", got)
	}
	got, err := store.Resume(ctx, boundKey, "")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != bound.ID {
		t.Fatalf("the device-bound key resumed %s, want %s", got.ID, bound.ID)
	}
	other, err := store.Resume(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-1", Module: "sheets"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if other.ID != fresh.ID {
		t.Fatalf("the device-less key resumed %s, want %s", other.ID, fresh.ID)
	}
}

// The cleanup triggers of A9: a deleted document takes its conversations and
// turns (through the outbox consumer), and losing membership takes the
// person's; other scopes are untouched.
func TestAIUniworkConversationSweptOnDocumentDelete(t *testing.T) {
	store, pool := conversationStoreFixture(t)
	ctx := context.Background()
	store.SetClock(func() time.Time { return time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC) })

	doomed, err := store.Create(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-1", DocumentID: "doc-1", Module: "sheets"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(ctx, doomed.ID, []Turn{{RunID: "run-1", Message: provider.Message{Role: "user", Content: "trong tài liệu bị xóa"}}}); err != nil {
		t.Fatal(err)
	}
	kept, err := store.Create(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-1", DocumentID: "doc-2", Module: "sheets"})
	if err != nil {
		t.Fatal(err)
	}
	other, err := store.Create(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-2", DocumentID: "doc-3", Module: "docs"})
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := store.Create(ctx, ConversationKey{OrganizationID: "org-b", UserID: "u-1", DocumentID: "doc-1", Module: "sheets"})
	if err != nil {
		t.Fatal(err)
	}

	c := NewConversationCleanupConsumer(store)
	if err := c.Handle(ctx, outbox.Row{ID: "e1", Topic: "document.deleted",
		Payload:        `{"document_id":"doc-1","workspace_id":"ws-1"}`,
		OrganizationID: pgtype.Text{String: "org-a", Valid: true}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Resume(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-1", DocumentID: "doc-1", Module: "sheets"}, doomed.ID); !errors.Is(err, ErrConversationExpired) {
		t.Fatalf("deleted document's conversation = %v, want ErrConversationExpired", err)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_turns WHERE conversation_id = $1`, doomed.ID); got != 0 {
		t.Fatalf("the deleted document's conversation kept %d turns", got)
	}
	for name, id := range map[string]string{"another document": kept.ID, "another user": other.ID, "another organization": foreign.ID} {
		if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations WHERE id = $1`, id); got != 1 {
			t.Fatalf("%s lost its conversation", name)
		}
	}

	if err := c.Handle(ctx, outbox.Row{ID: "e2", Topic: "member.deactivated",
		Payload: `{"organization_id":"org-a","user_id":"u-1"}`}); err != nil {
		t.Fatal(err)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations WHERE user_id = 'u-1' AND organization_id = 'org-a'`); got != 0 {
		t.Fatalf("a removed member kept %d conversations", got)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations WHERE id = $1`, other.ID); got != 1 {
		t.Fatal("another member's conversation was deleted")
	}
}

// A sign-out (session.revoked) names only the user, and their transcripts live
// in every organization they held one in: the consumer removes all of them,
// with their turns, and nobody else's.
func TestAIUniworkConversationSweptOnSignOut(t *testing.T) {
	store, pool := conversationStoreFixture(t)
	ctx := context.Background()
	store.SetClock(func() time.Time { return time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC) })

	orgA, err := store.Create(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-1", Module: "sheets"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(ctx, orgA.ID, []Turn{{Message: provider.Message{Role: "user", Content: "đăng xuất ở org-a"}}}); err != nil {
		t.Fatal(err)
	}
	orgB, err := store.Create(ctx, ConversationKey{OrganizationID: "org-b", UserID: "u-1", DocumentID: "doc-1", Module: "docs"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(ctx, orgB.ID, []Turn{{Message: provider.Message{Role: "user", Content: "đăng xuất ở org-b"}}}); err != nil {
		t.Fatal(err)
	}
	other, err := store.Create(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-2", Module: "sheets"})
	if err != nil {
		t.Fatal(err)
	}

	c := NewConversationCleanupConsumer(store)
	if err := c.Handle(ctx, outbox.Row{ID: "e1", Topic: "session.revoked",
		Payload:        `{"user_id":"u-1","session_id":"s-1"}`,
		OrganizationID: pgtype.Text{String: "org-a", Valid: true}}); err != nil {
		t.Fatal(err)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations WHERE user_id = 'u-1'`); got != 0 {
		t.Fatalf("the signed-out user kept %d conversations across their organizations", got)
	}
	for name, id := range map[string]string{"org-a": orgA.ID, "org-b": orgB.ID} {
		if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_turns WHERE conversation_id = $1`, id); got != 0 {
			t.Fatalf("the %s conversation kept %d turns", name, got)
		}
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations WHERE id = $1`, other.ID); got != 1 {
		t.Fatal("another user's conversation was deleted by the sign-out")
	}
}

// The kill switch hides the capability and its transcripts follow one sweep
// later: the organizations whose office_ai_uniwork is off lose every
// conversation, the ones still on keep theirs.
func TestAIUniworkKillSwitchSweepsConversations(t *testing.T) {
	store, pool := conversationStoreFixture(t)
	ctx := context.Background()
	base := time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC)
	store.SetClock(func() time.Time { return base })

	off, err := store.Create(ctx, ConversationKey{OrganizationID: "org-off", UserID: "u-1", Module: "sheets"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(ctx, off.ID, []Turn{{Message: provider.Message{Role: "user", Content: "tắt cờ"}}}); err != nil {
		t.Fatal(err)
	}
	on, err := store.Create(ctx, ConversationKey{OrganizationID: "org-on", UserID: "u-2", Module: "sheets"})
	if err != nil {
		t.Fatal(err)
	}

	w := NewConversationTTLWorker(store, func(_ context.Context, organizationID string) (bool, error) {
		return organizationID == "org-off", nil
	}, time.Minute, nil)
	w.SetClock(func() time.Time { return base })
	res, err := w.SweepOnce(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if res.Disabled != 1 || res.Expired != 0 {
		t.Fatalf("result %+v", res)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations WHERE organization_id = 'org-off'`); got != 0 {
		t.Fatalf("the killed organization kept %d conversations", got)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_turns WHERE conversation_id = $1`, off.ID); got != 0 {
		t.Fatal("the killed organization kept turns")
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations WHERE id = $1`, on.ID); got != 1 {
		t.Fatal("an organization with the flag on lost its conversation")
	}
	if res.Live != 1 {
		t.Fatalf("live gauge = %d, want 1", res.Live)
	}
}

// Append keeps at most 20 user turns, dropping the oldest whole block: a tool
// result never survives without the call it answers, and seq stays dense.
func TestAIUniworkAppendKeepsTwentyUserTurns(t *testing.T) {
	store, pool := conversationStoreFixture(t)
	ctx := context.Background()
	store.SetClock(func() time.Time { return time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC) })
	conv, err := store.Create(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-1", DocumentID: "doc-1", Module: "sheets"})
	if err != nil {
		t.Fatal(err)
	}
	block := func(n int) []Turn {
		return []Turn{
			{RunID: "run", Message: provider.Message{Role: "user", Content: "câu hỏi " + string(rune('a'+n))}},
			{RunID: "run", Message: provider.Message{Role: "assistant", ToolCalls: []provider.ToolCall{{ID: "call", Name: "get_cell", Input: []byte(`{}`)}}}},
			{RunID: "run", Message: provider.Message{Role: "tool", ToolCallID: "call", Content: `{"value":1}`}},
		}
	}
	for i := 0; i < UniworkMaxUserTurns+1; i++ {
		if err := store.Append(ctx, conv.ID, block(i)); err != nil {
			t.Fatal(err)
		}
	}
	got, err := store.Resume(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-1", DocumentID: "doc-1", Module: "sheets"}, conv.ID)
	if err != nil {
		t.Fatal(err)
	}
	users := 0
	for i, turn := range got.Turns {
		if turn.Seq != int32(i+1) {
			t.Fatalf("turn %d has seq %d: seq must stay dense for Rollback", i, turn.Seq)
		}
		if turn.Message.Role == "user" {
			users++
		}
		if turn.Message.Role == "tool" && i == 0 {
			t.Fatal("a tool result survived without the call it answers")
		}
	}
	if users != UniworkMaxUserTurns {
		t.Fatalf("kept %d user turns, want %d", users, UniworkMaxUserTurns)
	}
	if first := got.Turns[0].Message.Content; first != "câu hỏi b" {
		t.Fatalf("the oldest block was not the one dropped: first user turn is %q", first)
	}
	if want := (UniworkMaxUserTurns+1)*3 - 3; mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_turns WHERE conversation_id = $1`, conv.ID) != want {
		t.Fatalf("the trimmed conversation has %d turns, want %d", mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_turns WHERE conversation_id = $1`, conv.ID), want)
	}
}

// Rollback drops exactly the turns of the failed attempt: keep is the turn
// count before it, and seq is dense after every append.
func TestAIUniworkRollbackDropsFailedAttempt(t *testing.T) {
	store, pool := conversationStoreFixture(t)
	ctx := context.Background()
	store.SetClock(func() time.Time { return time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC) })
	conv, err := store.Create(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-1", Module: "docs"})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(ctx, conv.ID, []Turn{
		{RunID: "run-1", Message: provider.Message{Role: "user", Content: "câu hỏi"}},
		{RunID: "run-1", Message: provider.Message{Role: "assistant", Content: "câu trả lời"}},
		{RunID: "run-1", Message: provider.Message{Role: "user", Content: "hỏi tiếp"}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Append(ctx, conv.ID, []Turn{
		{RunID: "run-2", Message: provider.Message{Role: "user", Content: "lượt lỗi"}},
		{RunID: "run-2", Message: provider.Message{Role: "assistant", ToolCalls: []provider.ToolCall{{ID: "call", Name: "x"}}}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Rollback(ctx, conv.ID, 3); err != nil {
		t.Fatal(err)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_turns WHERE conversation_id = $1`, conv.ID); got != 3 {
		t.Fatalf("%d turns after the rollback, want 3", got)
	}
	got, err := store.Resume(ctx, ConversationKey{OrganizationID: "org-a", UserID: "u-1", Module: "docs"}, conv.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Turns) != 3 {
		t.Fatalf("resume returned %d turns, want 3", len(got.Turns))
	}
}

// A conversation belongs to one key: the client's id from another user,
// document, module or device is never resumed as if it were its own.
func TestAIUniworkConversationBoundToScope(t *testing.T) {
	store, _ := conversationStoreFixture(t)
	ctx := context.Background()
	store.SetClock(func() time.Time { return time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC) })
	key := ConversationKey{OrganizationID: "org-a", UserID: "u-1", DocumentID: "doc-1", Module: "sheets", DeviceID: "dev-1"}
	conv, err := store.Create(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Append(ctx, conv.ID, []Turn{{Message: provider.Message{Role: "user", Content: "bí mật"}}}); err != nil {
		t.Fatal(err)
	}
	for name, other := range map[string]ConversationKey{
		"another user":     {OrganizationID: "org-a", UserID: "u-2", DocumentID: "doc-1", Module: "sheets", DeviceID: "dev-1"},
		"another document": {OrganizationID: "org-a", UserID: "u-1", DocumentID: "doc-2", Module: "sheets", DeviceID: "dev-1"},
		"another module":   {OrganizationID: "org-a", UserID: "u-1", DocumentID: "doc-1", Module: "docs", DeviceID: "dev-1"},
		"another device":   {OrganizationID: "org-a", UserID: "u-1", DocumentID: "doc-1", Module: "sheets", DeviceID: "dev-2"},
		"another org":      {OrganizationID: "org-b", UserID: "u-1", DocumentID: "doc-1", Module: "sheets", DeviceID: "dev-1"},
	} {
		if _, err := store.Resume(ctx, other, conv.ID); !errors.Is(err, ErrConversationExpired) {
			t.Fatalf("%s resumed the conversation: %v", name, err)
		}
	}
	got, err := store.Resume(ctx, key, conv.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Turns) != 1 || got.Turns[0].Message.Content != "bí mật" {
		t.Fatalf("the owner could not resume their own transcript: %+v", got.Turns)
	}
}

// DeleteByUserDocument removes one user's transcripts for the document whose
// access was lost - the production caller's shape, a real document id - and
// nothing else: the same user's other documents, another user's and another
// organization's rows stay. An empty document id names no document and so
// removes nothing; the store's no-document transcripts are DeleteByUser's
// (design §9.4). DeleteByUser and DeleteByOrganization remove the rows they
// name, and the interface's Delete removes one conversation with its turns.
func TestAIUniworkConversationDeletesAreScoped(t *testing.T) {
	store, pool := conversationStoreFixture(t)
	ctx := context.Background()
	store.SetClock(func() time.Time { return time.Date(2026, 10, 13, 9, 0, 0, 0, time.UTC) })
	keys := []ConversationKey{
		{OrganizationID: "org-a", UserID: "u-1", DocumentID: "doc-1", Module: "sheets"},
		{OrganizationID: "org-a", UserID: "u-2", DocumentID: "doc-1", Module: "sheets"},
		{OrganizationID: "org-b", UserID: "u-1", DocumentID: "doc-1", Module: "sheets"},
		{OrganizationID: "org-a", UserID: "u-2", DocumentID: "doc-2", Module: "sheets"},
	}
	ids := make([]string, len(keys))
	for i, key := range keys {
		conv, err := store.Create(ctx, key)
		if err != nil {
			t.Fatal(err)
		}
		if err := store.Append(ctx, conv.ID, []Turn{{Message: provider.Message{Role: "user", Content: "x"}}}); err != nil {
			t.Fatal(err)
		}
		ids[i] = conv.ID
	}
	if err := store.DeleteByUserDocument(ctx, "org-a", "u-2", "doc-1"); err != nil {
		t.Fatal(err)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations WHERE id = $1`, ids[1]); got != 0 {
		t.Fatalf("DeleteByUserDocument kept %d rows", got)
	}
	for name, id := range map[string]string{"another user": ids[0], "another organization": ids[2], "another document": ids[3]} {
		if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations WHERE id = $1`, id); got != 1 {
			t.Fatalf("DeleteByUserDocument took %s's conversation", name)
		}
	}
	if err := store.DeleteByUser(ctx, "org-a", "u-1"); err != nil {
		t.Fatal(err)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations`); got != 2 {
		t.Fatalf("%d conversations left, want the other organization's and the other document's", got)
	}
	if err := store.Delete(ctx, ids[2]); err != nil {
		t.Fatal(err)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations`); got != 1 {
		t.Fatalf("%d conversations left after Delete", got)
	}
	if err := store.Delete(ctx, ids[3]); err != nil {
		t.Fatal(err)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_conversations`); got != 0 {
		t.Fatalf("%d conversations left after Delete", got)
	}
	if got := mustCount(t, pool, `SELECT count(*) FROM ai_uniwork_turns`); got != 0 {
		t.Fatalf("%d turns left behind", got)
	}
	if err := store.DeleteByOrganization(ctx, "org-a"); err != nil {
		t.Fatal(err)
	}
}
