package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func captionSegs(texts ...string) []CaptionSegmentInput {
	out := make([]CaptionSegmentInput, len(texts))
	for i, t := range texts {
		out[i] = CaptionSegmentInput{SegmentID: "AJ_1-TR_a-" + string(rune('1'+i)), Text: t}
	}
	return out
}

// §5.3 B9: the agent's finals come back in the target language under their
// own segment ids, through the gateway as the system's caption_translate.
func TestAgentTranslate(t *testing.T) {
	s, llm, _, m, c, _ := liveFixture(t, `{"translations":[{"id":"T1","text":"Send the quote before Friday"},{"id":"T9","text":"made up"},{"id":"T1","text":"again"}]}`)
	ctx := context.Background()
	res, err := s.AgentTranslate(ctx, c, CaptionLangEN, captionSegs("Gửi báo giá trước thứ Sáu", "Ok anh"))
	if err != nil || res.Skipped != "" {
		t.Fatalf("translate = %+v, %v", res, err)
	}
	if len(res.Translations) != 1 || res.Translations[0] != (CaptionTranslation{SegmentID: "AJ_1-TR_a-1", Text: "Send the quote before Friday"}) {
		t.Fatalf("translations = %+v, want T1 once; an unknown label never reaches a caption", res.Translations)
	}
	p := lastPrompt(llm.Last)
	if !strings.Contains(p, "Target language: English") || !strings.Contains(p, "[T1] Gửi báo giá trước thứ Sáu") || !strings.Contains(p, "- "+m.Title) {
		t.Fatalf("prompt lacks the target, the labelled captions or the meeting's glossary:\n%s", p)
	}
	if n := countSummaryRows(t, s, `SELECT count(*) FROM ai_usage_events WHERE capability = 'caption_translate' AND actor_kind = 'system' AND actor_id = 'meeting_scribe'`); n != 1 {
		t.Fatalf("usage rows = %d", n)
	}
	// Translations are not stored: no transcript row, no audit row.
	if n := countSummaryRows(t, s, `SELECT count(*) FROM meeting_transcript_segments WHERE meeting_id = $1`, m.ID); n != 0 {
		t.Fatalf("transcript rows = %d", n)
	}

	// One call a second per meeting and language.
	calls := llm.Calls
	if res, err := s.AgentTranslate(ctx, c, CaptionLangEN, captionSegs("Một")); err != nil || res.Skipped != CaptionSkipCapped || llm.Calls != calls {
		t.Fatalf("second call inside the second = %+v, %v, calls %d→%d", res, err, calls, llm.Calls)
	}
	if res, err := s.AgentTranslate(ctx, c, CaptionLangVI, captionSegs("Send it")); err != nil || res.Skipped != "" || llm.Calls != calls+1 {
		t.Fatalf("other language = %+v, %v, calls %d→%d", res, err, calls, llm.Calls)
	}
	s.captions.last[m.ID+":"+CaptionLangEN] = time.Now().Add(-time.Second)
	if res, err := s.AgentTranslate(ctx, c, CaptionLangEN, captionSegs("Một")); err != nil || res.Skipped != "" {
		t.Fatalf("a second later = %+v, %v", res, err)
	}
}

func TestAgentTranslateSkipsAndRefusals(t *testing.T) {
	answer := `{"translations":[{"id":"T1","text":"One"}]}`
	ctx := context.Background()

	t.Run("bad input", func(t *testing.T) {
		s, _, _, _, c, _ := liveFixture(t, answer)
		many := make([]string, captionTranslateMaxSegments+1)
		for i := range many {
			many[i] = "x"
		}
		for name, in := range map[string]struct {
			target string
			segs   []CaptionSegmentInput
		}{
			"unknown target": {"fr", captionSegs("Một")},
			"no segments":    {CaptionLangEN, nil},
			"too many":       {CaptionLangEN, captionSegs(many...)},
			"empty text":     {CaptionLangEN, captionSegs("  ")},
			"too long":       {CaptionLangEN, captionSegs(strings.Repeat("ẹ", captionTranslateMaxRunes+1))},
		} {
			if _, err := s.AgentTranslate(ctx, c, in.target, in.segs); !isValidation(err) {
				t.Errorf("%s: err = %v, want invalid input", name, err)
			}
		}
	})
	t.Run("flag off", func(t *testing.T) {
		s, llm, _, _, c, _ := liveFixture(t, answer)
		s.SetFlags(mcpFlagsExcept{off: captionTranslateFlag})
		if res, err := s.AgentTranslate(ctx, c, CaptionLangEN, captionSegs("Một")); err != nil || res.Skipped != CaptionSkipFeature || llm.Calls != 0 {
			t.Fatalf("flag-off translate = %+v, %v, calls %d", res, err, llm.Calls)
		}
	})
	t.Run("no model", func(t *testing.T) {
		s, _, _, _, c, _ := liveFixture(t, answer)
		s.AI = nil
		if res, err := s.AgentTranslate(ctx, c, CaptionLangEN, captionSegs("Một")); err != nil || res.Skipped != CaptionSkipFeature {
			t.Fatalf("no-model translate = %+v, %v", res, err)
		}
	})
	t.Run("AI credit exhausted", func(t *testing.T) {
		s, _, _, m, c, _ := liveFixture(t, answer)
		if _, err := s.pool.Exec(ctx,
			`UPDATE subscriptions SET overrides = COALESCE(overrides, '{}'::jsonb) || jsonb_build_object('ai.tokens', 0) WHERE organization_id = $1`,
			m.OrganizationID); err != nil {
			t.Fatal(err)
		}
		if res, err := s.AgentTranslate(ctx, c, CaptionLangEN, captionSegs("Một")); err != nil || res.Skipped != CaptionSkipQuota {
			t.Fatalf("quota translate = %+v, %v", res, err)
		}
	})
	t.Run("scribe switched off", func(t *testing.T) {
		s, llm, _, m, c, _ := liveFixture(t, answer)
		if _, err := s.q.SetMeetingScribeOff(ctx, db.SetMeetingScribeOffParams{ID: m.ID, Off: true, By: "x"}); err != nil {
			t.Fatal(err)
		}
		if res, err := s.AgentTranslate(ctx, c, CaptionLangEN, captionSegs("Một")); err != nil || res.Skipped != CaptionSkipClosed || llm.Calls != 0 {
			t.Fatalf("switched-off translate = %+v, %v, calls %d", res, err, llm.Calls)
		}
	})
	t.Run("answer that does not parse", func(t *testing.T) {
		s, _, _, _, c, _ := liveFixture(t, "không phải JSON")
		if res, err := s.AgentTranslate(ctx, c, CaptionLangEN, captionSegs("Một")); err != nil || len(res.Translations) != 0 || res.Skipped != "" {
			t.Fatalf("bad answer = %+v, %v", res, err)
		}
	})
}

// §12.1: caption-language sets the attribute through the (fake) adapter, for
// a member or a guest in the room; the original is always allowed.
func TestSetCaptionLanguage(t *testing.T) {
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	s.AI = ai.NewGateway(s.q, &provider.Fake{}, NewAIQuota(s.ent), nil, ai.Options{})
	p, err := s.q.GetActiveUserParticipant(ctx, db.GetActiveUserParticipantParams{MeetingID: m.ID, UserID: strText(ua.ID)})
	if err != nil {
		t.Fatal(err)
	}
	last := func() meetings.SetParticipantAttributesRequest {
		calls := fake.AttributeCalls()
		if len(calls) == 0 {
			t.Fatal("no attribute write")
		}
		return calls[len(calls)-1]
	}
	if err := s.SetCaptionLanguage(ctx, ua.ID, "", m.ID, CaptionLangEN); err != nil {
		t.Fatal(err)
	}
	if got := last(); got.RoomName != meetings.RoomNameForMeeting(m.ID) || got.Identity != meetings.IdentityForParticipant(p.ID) ||
		len(got.Attributes) != 1 || got.Attributes[meetings.AttrCaptionLang] != "en" {
		t.Fatalf("attribute write = %+v", got)
	}
	g := newGuestParticipant(t, s, m.ID)
	if err := s.SetCaptionLanguage(ctx, "", g.GuestID.String, m.ID, CaptionLangVI); err != nil {
		t.Fatal(err)
	}
	if got := last(); got.Identity != meetings.IdentityForParticipant(g.ID) || got.Attributes[meetings.AttrCaptionLang] != "vi" {
		t.Fatalf("guest attribute write = %+v", got)
	}

	if err := s.SetCaptionLanguage(ctx, ua.ID, "", m.ID, "fr"); !isValidation(err) {
		t.Fatalf("fr: %v", err)
	}
	if err := s.SetCaptionLanguage(ctx, "", "not-in-the-room", m.ID, CaptionLangEN); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a stranger: %v", err)
	}
	// A workspace member who never joined the room: a state, not a malformed request.
	ub, err := s.q.GetUserByEmail(ctx, "b@example.com")
	if err != nil {
		t.Fatal(err)
	}
	addMember(t, s, m.WorkspaceID, ub.ID)
	if err := s.SetCaptionLanguage(ctx, ub.ID, "", m.ID, CaptionLangEN); err == nil {
		t.Fatal("a member outside the room set a caption language")
	} else if code, status := codedOf(err); code != "not_in_room" || status != http.StatusConflict {
		t.Fatalf("member outside the room: %v", err)
	}
	// Flag off: a language is refused, the original still goes through.
	s.SetFlags(mcpFlagsExcept{off: captionTranslateFlag})
	writes := len(fake.AttributeCalls())
	if err := s.SetCaptionLanguage(ctx, ua.ID, "", m.ID, CaptionLangEN); err == nil {
		t.Fatal("a language with the flag off was accepted")
	} else if code, status := codedOf(err); code != "feature_disabled" || status != http.StatusNotFound {
		t.Fatalf("flag off: %v", err)
	}
	if err := s.SetCaptionLanguage(ctx, ua.ID, "", m.ID, ""); err != nil {
		t.Fatal(err)
	}
	if got := last(); len(fake.AttributeCalls()) != writes+1 || got.Attributes[meetings.AttrCaptionLang] != "" {
		t.Fatalf("back to the original = %+v", got)
	}
	// Only while the meeting is under way.
	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.SetCaptionLanguage(ctx, ua.ID, "", m.ID, ""); err == nil {
		t.Fatal("an ended meeting took a caption language")
	} else if code, _ := codedOf(err); code != "invalid_meeting_state" {
		t.Fatalf("ended: %v", err)
	}
}
