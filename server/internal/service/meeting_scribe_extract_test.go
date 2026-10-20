package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// liveFixture: a scribe run ACTIVE in a meeting in progress, a gateway on a
// fake provider that answers `answer`, and a way to add agent segments.
func liveFixture(t *testing.T, answer string) (*MeetingService, *provider.Fake, db.User, db.Meeting, meetings.AgentClaims, func(texts ...string)) {
	t.Helper()
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	c := claimsOf(t, s, fake)
	if err := s.AgentStarted(ctx, c, "PA_agent1"); err != nil {
		t.Fatal(err)
	}
	llm := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: answer, InputTokens: 10, OutputTokens: 5}
	}}
	s.AI = ai.NewGateway(s.q, llm, NewAIQuota(s.ent), nil, ai.Options{})
	p, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(ua.ID)})
	if err != nil {
		t.Fatal(err)
	}
	identity := meetings.IdentityForParticipant(p.ID)
	n := 0
	add := func(texts ...string) {
		t.Helper()
		batch := make([]AgentSegmentInput, 0, len(texts))
		for _, text := range texts {
			n++
			g := agentSeg("TR-"+strings.Repeat("x", n), identity, m.ActualStartAt.Time.Add(time.Duration(n)*time.Second), 1000)
			g.Text = text
			batch = append(batch, g)
		}
		if _, _, err := s.AppendAgentSegments(ctx, c, batch); err != nil {
			t.Fatal(err)
		}
	}
	return s, llm, ua, m, c, add
}

func liveItems(t *testing.T, s *MeetingService, m db.Meeting) []db.MeetingActionItem {
	t.Helper()
	rows, err := s.q.ListMeetingActionItems(context.Background(), db.ListMeetingActionItemsParams{OrganizationID: m.OrganizationID, MeetingID: m.ID})
	if err != nil {
		t.Fatal(err)
	}
	var out []db.MeetingActionItem
	for _, r := range rows {
		if r.MeetingActionItem.Source == ActionItemSourceLive {
			out = append(out, r.MeetingActionItem)
		}
	}
	return out
}

func TestAgentExtractStoresLiveItems(t *testing.T) {
	s, llm, ua, m, c, add := liveFixture(t, `{"action_items":[
		{"title":"Gửi báo giá cho khách","owner":"Bình","due":"thứ Sáu","evidence":["S1","S9"]},
		{"title":"gửi  BÁO CÁO quý","owner":"","due":"","evidence":[]},
		{"title":"Gửi báo giá cho khách","owner":"","due":"","evidence":[]}]}`)
	ctx := context.Background()
	if _, err := s.AddActionItem(ctx, ua.ID, m.ID, AddActionItemInput{Title: "Gửi báo cáo quý"}); err != nil {
		t.Fatal(err)
	}
	add("Bình gửi báo giá cho khách trước thứ Sáu nhé", "Ok anh")
	res, err := s.AgentExtract(ctx, c)
	if err != nil || res.Created != 1 || res.Skipped != "" {
		t.Fatalf("extract = %+v, %v", res, err)
	}
	if llm.Last.System == "" || !strings.Contains(lastPrompt(llm.Last), "[S1]") || !strings.Contains(lastPrompt(llm.Last), "- Gửi báo cáo quý") {
		t.Fatalf("prompt lacks the labelled transcript or the existing items:\n%s", lastPrompt(llm.Last))
	}
	items := liveItems(t, s, m)
	if len(items) != 1 {
		t.Fatalf("live items = %+v", items)
	}
	it := items[0]
	segs, _ := s.q.ListSegmentsAfterExtractCursor(ctx, db.ListSegmentsAfterExtractCursorParams{MeetingID: m.ID, RowLimit: 10})
	if it.Title != "Gửi báo giá cho khách" || it.OwnerText != "Bình" || it.DueText != "thứ Sáu" ||
		it.CreatedBy != "meeting_scribe" || it.CreatedByKind != "system" || it.SummaryID.Valid ||
		!strings.Contains(it.Evidence, segs[0].ID) || strings.Contains(it.Evidence, segs[1].ID) {
		t.Fatalf("stored item %+v", it)
	}
	if n := countSummaryRows(t, s, `SELECT count(*) FROM audit_events WHERE action = 'meeting.action_item_created'
		AND resource_id = $1 AND actor_kind = 'system' AND actor_id = 'meeting_scribe'`, it.ID); n != 1 {
		t.Fatalf("audit rows = %d", n)
	}
	if n := countSummaryRows(t, s, `SELECT count(*) FROM outbox_events WHERE topic = 'action_item.created' AND payload::jsonb->>'action_item_id' = $1`, it.ID); n != 1 {
		t.Fatalf("outbox rows = %d", n)
	}
	if n := countSummaryRows(t, s, `SELECT count(*) FROM ai_usage_events WHERE capability = 'meeting_live_items' AND actor_kind = 'system'`); n != 1 {
		t.Fatalf("usage rows = %d", n)
	}
	r := latestRun(t, s, m.ID)
	if r.Extracts != 1 || r.ExtractCursorSegmentID != segs[1].ID || !r.LastExtractAt.Valid {
		t.Fatalf("run after extract %+v", r)
	}

	// Nothing new: no model call.
	calls := llm.Calls
	if res, err := s.AgentExtract(ctx, c); err != nil || res.Created != 0 || llm.Calls != calls {
		t.Fatalf("empty extract = %+v, %v, calls %d→%d", res, err, calls, llm.Calls)
	}
	// Only the lines after the cursor reach the model.
	add("Chốt lịch demo")
	if _, err := s.AgentExtract(ctx, c); err != nil {
		t.Fatal(err)
	}
	if p := lastPrompt(llm.Last); strings.Contains(p, "Bình gửi báo giá") || !strings.Contains(p, "[S1] ") || !strings.Contains(p, "Chốt lịch demo") {
		t.Fatalf("second prompt re-read old lines:\n%s", p)
	}
	if n := len(liveItems(t, s, m)); n != 1 {
		t.Fatalf("a repeated title was stored again: %d live items", n)
	}

	// Of two extractions that read the same cursor, the later one stores nothing.
	if got, err := s.storeLiveItems(ctx, m, r, segs[1].ID, []ai.ActionItem{{Title: "Việc khác"}}, newSummaryLabels()); err != nil || got != -1 {
		t.Fatalf("stale run stored %d, %v", got, err)
	}
}

func TestAgentExtractSkips(t *testing.T) {
	answer := `{"action_items":[{"title":"Gửi báo giá","owner":"","due":"","evidence":[]}]}`
	ctx := context.Background()

	t.Run("cap of 20 an hour", func(t *testing.T) {
		s, llm, _, m, c, add := liveFixture(t, answer)
		add("Một")
		r := latestRun(t, s, m.ID)
		if _, err := s.pool.Exec(ctx, `UPDATE meeting_scribe_runs SET extracts = 20 WHERE id = $1`, r.ID); err != nil {
			t.Fatal(err)
		}
		if res, err := s.AgentExtract(ctx, c); err != nil || res.Skipped != LiveItemsSkipCapped || llm.Calls != 0 {
			t.Fatalf("capped extract = %+v, %v, calls %d", res, err, llm.Calls)
		}
		ageRun(t, s, r.ID, "created_at", 2*time.Hour) // two hours: the DB clock may lag the host
		if res, err := s.AgentExtract(ctx, c); err != nil || res.Created != 1 {
			t.Fatalf("second hour extract = %+v, %v", res, err)
		}
	})

	t.Run("AI credit exhausted", func(t *testing.T) {
		s, _, _, m, c, add := liveFixture(t, answer)
		add("Một")
		if _, err := s.pool.Exec(ctx,
			`UPDATE subscriptions SET overrides = COALESCE(overrides, '{}'::jsonb) || jsonb_build_object('ai.tokens', 0) WHERE organization_id = $1`,
			m.OrganizationID); err != nil {
			t.Fatal(err)
		}
		res, err := s.AgentExtract(ctx, c)
		if err != nil || res.Skipped != LiveItemsSkipQuota || len(liveItems(t, s, m)) != 0 {
			t.Fatalf("quota extract = %+v, %v", res, err)
		}
		if r := latestRun(t, s, m.ID); r.Extracts != 0 || r.ExtractCursorSegmentID != "" {
			t.Fatalf("cursor moved without an answer: %+v", r)
		}
	})

	t.Run("flag off", func(t *testing.T) {
		s, llm, _, _, c, add := liveFixture(t, answer)
		add("Một")
		s.SetFlags(mcpFlagsExcept{off: scribeFlag})
		if res, err := s.AgentExtract(ctx, c); err != nil || res.Skipped != LiveItemsSkipFeature || llm.Calls != 0 {
			t.Fatalf("flag-off extract = %+v, %v, calls %d", res, err, llm.Calls)
		}
	})

	t.Run("output that does not parse moves the cursor", func(t *testing.T) {
		s, _, _, m, c, add := liveFixture(t, "không phải JSON")
		add("Một")
		if res, err := s.AgentExtract(ctx, c); err != nil || res.Created != 0 {
			t.Fatalf("bad output extract = %+v, %v", res, err)
		}
		if r := latestRun(t, s, m.ID); r.Extracts != 1 || r.ExtractCursorSegmentID == "" {
			t.Fatalf("cursor did not move past a billed answer: %+v", r)
		}
	})
}

// Parent spec D6: a regenerated summary replaces only the pending AI items.
func TestLiveItemsSurviveSummaryRegeneration(t *testing.T) {
	s, _, ua, m, c, add := liveFixture(t, `{"action_items":[{"title":"Gửi báo giá","owner":"","due":"","evidence":[]}]}`)
	ctx := context.Background()
	add("Gửi báo giá nhé")
	if _, err := s.AgentExtract(ctx, c); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := s.storeSummary(ctx, m, ua.ID, ai.MeetingSummary{
			Summary: "Đã chốt.", Decisions: []ai.Decision{}, ActionItems: []ai.ActionItem{{Title: "Gửi báo giá"}, {Title: "Đặt phòng"}},
		}, ai.Response{Model: "fake"}, newSummaryLabels(), false); err != nil {
			t.Fatal(err)
		}
	}
	if n := len(liveItems(t, s, m)); n != 1 {
		t.Fatalf("live items after two summaries = %d", n)
	}
	if n := countSummaryRows(t, s, `SELECT count(*) FROM meeting_action_items WHERE meeting_id = $1 AND source = 'AI'`, m.ID); n != 1 {
		t.Fatalf("AI items = %d, want only the one the live item does not repeat", n)
	}
}

// Fix round 1: a shared-mic line reaches the model under its speaker's
// assigned name, not the room participant's.
func TestAgentExtractNamesSharedMicSpeakers(t *testing.T) {
	s, llm, ua, m, c, _ := liveFixture(t, `{"action_items":[]}`)
	ctx := context.Background()
	p, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(ua.ID)})
	if err != nil {
		t.Fatal(err)
	}
	identity := meetings.IdentityForParticipant(p.ID)
	g := agentSeg("TR-room-1", identity, m.ActualStartAt.Time.Add(time.Second), 1000)
	g.Text, g.SpeakerLabel = "Lan gửi báo giá trước thứ Sáu", identity+":1:A"
	if _, _, err := s.AppendAgentSegments(ctx, c, []AgentSegmentInput{g}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE meeting_speaker_labels SET name = 'Chị Lan' WHERE meeting_id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AgentExtract(ctx, c); err != nil {
		t.Fatal(err)
	}
	if p := lastPrompt(llm.Last); !strings.Contains(p, "Chị Lan: Lan gửi báo giá") {
		t.Fatalf("shared-mic line not under its speaker's name:\n%s", p)
	}
}

// Fix round 1: a refused answer is billed, so it moves the cursor like an
// answer that does not parse.
func TestAgentExtractRefusalMovesTheCursor(t *testing.T) {
	s, llm, _, m, c, add := liveFixture(t, `{"action_items":[]}`)
	ctx := context.Background()
	answering := s.AI
	s.AI = ai.NewGateway(s.q, &provider.Fake{Err: provider.ErrRefused}, NewAIQuota(s.ent), nil, ai.Options{})
	add("Một")
	if res, err := s.AgentExtract(ctx, c); err != nil || res.Created != 0 {
		t.Fatalf("refused extract = %+v, %v", res, err)
	}
	if r := latestRun(t, s, m.ID); r.Extracts != 1 || r.ExtractCursorSegmentID == "" {
		t.Fatalf("cursor did not move past a refusal: %+v", r)
	}
	s.AI = answering
	add("Hai")
	if _, err := s.AgentExtract(ctx, c); err != nil {
		t.Fatal(err)
	}
	if p := lastPrompt(llm.Last); strings.Contains(p, ": Một") || !strings.Contains(p, ": Hai") {
		t.Fatalf("next call re-read the refused lines:\n%s", p)
	}
}

// Fix round 1: only an ACTIVE run, or one FINISHED within the drain window,
// extracts; a meeting whose scribe was switched off does not; a plan
// without meeting.ai_summary is a silent skip.
func TestAgentExtractGates(t *testing.T) {
	answer := `{"action_items":[{"title":"Gửi báo giá","owner":"","due":"","evidence":[]}]}`
	ctx := context.Background()

	t.Run("finished run drains for 10 minutes", func(t *testing.T) {
		s, llm, _, m, c, add := liveFixture(t, answer)
		add("Một")
		if err := s.AgentFinished(ctx, c, 1000); err != nil {
			t.Fatal(err)
		}
		if res, err := s.AgentExtract(ctx, c); err != nil || res.Created != 1 {
			t.Fatalf("extract right after finish = %+v, %v", res, err)
		}
		expire := func() {
			if _, err := s.pool.Exec(ctx, `UPDATE meeting_scribe_runs SET finished_at = now() - interval '11 minutes' WHERE meeting_id = $1`, m.ID); err != nil {
				t.Fatal(err)
			}
		}
		expire()
		calls := llm.Calls
		if res, err := s.AgentExtract(ctx, c); err != nil || res.Skipped != LiveItemsSkipClosed || llm.Calls != calls {
			t.Fatalf("extract on a run finished long ago = %+v, %v", res, err)
		}
	})

	t.Run("scribe switched off", func(t *testing.T) {
		s, llm, _, m, c, add := liveFixture(t, answer)
		add("Một")
		if _, err := s.pool.Exec(ctx, `UPDATE meetings SET scribe_off_at = now() WHERE id = $1`, m.ID); err != nil {
			t.Fatal(err)
		}
		if res, err := s.AgentExtract(ctx, c); err != nil || res.Skipped != LiveItemsSkipClosed || llm.Calls != 0 {
			t.Fatalf("extract with the scribe off = %+v, %v", res, err)
		}
	})

	t.Run("plan without meeting.ai_summary", func(t *testing.T) {
		s, llm, _, m, c, add := liveFixture(t, answer)
		add("Một")
		if _, err := s.pool.Exec(ctx, `UPDATE subscriptions SET overrides = '{"meeting.ai_summary": false}'::jsonb WHERE organization_id = $1`, m.OrganizationID); err != nil {
			t.Fatal(err)
		}
		if res, err := s.AgentExtract(ctx, c); err != nil || res.Skipped != LiveItemsSkipFeature || llm.Calls != 0 {
			t.Fatalf("extract without the plan feature = %+v, %v", res, err)
		}
	})
}
