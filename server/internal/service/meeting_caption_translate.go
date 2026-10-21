package service

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/meetings"
)

// Live caption translation (UNI-2028, scribe spec §5.3 B9, D11): a viewer
// picks a caption language through the server, which sets uw.caption_lang on
// their LiveKit participant; the scribe agent sends the finals someone needs
// in another language and publishes the answer on uw.caption.<lang>. Nothing
// is stored.

const (
	captionTranslateFlag = "meeting_caption_translate"
	// One call reads at most this many segments and runes: a second of finals.
	captionTranslateMaxSegments = 20
	captionTranslateMaxRunes    = 4000
	// The server's backstop for the agent's one call a second per language;
	// the slack absorbs network jitter between two calls the agent spaced a
	// second apart.
	captionTranslateSpacing = 900 * time.Millisecond
)

// The caption languages a viewer may pick; "" is the original.
const (
	CaptionLangVI = "vi"
	CaptionLangEN = "en"
)

// Why a translation call answered nothing without failing (the SDO's skipped).
const (
	CaptionSkipFeature = "unavailable" // flag off, no meeting.ai_summary, AI not configured
	CaptionSkipCapped  = "capped"
	CaptionSkipQuota   = "ai_quota_exceeded"
	CaptionSkipClosed  = "closed" // the meeting is not under way, the run is not ACTIVE, or the scribe is off
)

// CaptionSegmentInput is one final caption the agent wants translated.
type CaptionSegmentInput struct {
	SegmentID string
	Text      string
}

// CaptionTranslation is one translated caption.
type CaptionTranslation struct {
	SegmentID string
	Text      string
}

// CaptionTranslateResult answers POST /agent/translate.
type CaptionTranslateResult struct {
	Translations []CaptionTranslation
	Skipped      string
}

// captionSpacing remembers each meeting and language's last translation call.
type captionSpacing struct {
	mu   sync.Mutex
	last map[string]time.Time
}

// shortcut: per process, so N server nodes let up to N calls a second
// through; the agent's own cap is the real one. Move to Redis if that matters.
func (c *captionSpacing) allow(key string, now time.Time) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if now.Sub(c.last[key]) < captionTranslateSpacing {
		return false
	}
	if c.last == nil {
		c.last = map[string]time.Time{}
	}
	for k, t := range c.last {
		if now.Sub(t) > time.Minute {
			delete(c.last, k)
		}
	}
	c.last[key] = now
	return true
}

func errCaptionTranslateOff() error {
	return coded(http.StatusNotFound, "feature_disabled", "phụ đề dịch chưa bật cho tổ chức này")
}

// captionTranslateGate: the plan first (ErrEntitlementRequired and the like,
// as every plan gate answers), then the flag and a configured model.
func (s *MeetingService) captionTranslateGate(ctx context.Context, orgID string) error {
	if err := s.ent.Can(ctx, orgID, FeatureMeetingAISummary); err != nil {
		return err
	}
	if !s.orgFlagOn(ctx, orgID, captionTranslateFlag) || s.AI == nil || !s.AI.Enabled() {
		return errCaptionTranslateOff()
	}
	return nil
}

func validCaptionLang(lang string) bool { return lang == CaptionLangVI || lang == CaptionLangEN }

// SetCaptionLanguage is a viewer's caption language (§7.2): anyone in the
// room, guests included. The server writes uw.caption_lang on their own
// participant; a room token never lets a participant write attributes (D11).
// "" goes back to the original captions and is always allowed.
func (s *MeetingService) SetCaptionLanguage(ctx context.Context, userID, guestID, meetingID, lang string) error {
	m, err := s.authorizeActiveParticipant(ctx, userID, guestID, meetingID)
	if err != nil {
		return err
	}
	if lang != "" && !validCaptionLang(lang) {
		return Invalid("lang phải là vi, en hoặc rỗng (phụ đề gốc)")
	}
	if m.Status != MeetingInProgress {
		return errInvalidState()
	}
	if lang != "" {
		if err := s.captionTranslateGate(ctx, m.OrganizationID); err != nil {
			return err
		}
	}
	pid := s.activeParticipantID(ctx, userID, guestID, meetingID)
	if pid == "" {
		return coded(http.StatusConflict, "not_in_room", "chưa tham gia phòng họp")
	}
	if s.provider == nil {
		return coded(http.StatusServiceUnavailable, "provider_unavailable", "không đổi được ngôn ngữ phụ đề")
	}
	cctx, cancel := context.WithTimeout(ctx, scribeCallTimeout)
	defer cancel()
	if err := s.provider.SetParticipantAttributes(cctx, meetings.SetParticipantAttributesRequest{
		RoomName: meetings.RoomNameForMeeting(m.ID), Identity: meetings.IdentityForParticipant(pid),
		Attributes: map[string]string{meetings.AttrCaptionLang: lang},
	}); err != nil {
		slog.Warn("meeting caption language: attribute not set", "meeting", m.ID, "participant", pid, "err", err)
		return coded(http.StatusServiceUnavailable, "provider_unavailable", "không đổi được ngôn ngữ phụ đề")
	}
	return nil
}

func validateCaptionSegments(target string, segs []CaptionSegmentInput) error {
	if !validCaptionLang(target) {
		return Invalid("target phải là vi hoặc en")
	}
	if len(segs) == 0 || len(segs) > captionTranslateMaxSegments {
		return Invalid("cần từ 1 đến 20 đoạn")
	}
	runes := 0
	for i := range segs {
		g := &segs[i]
		g.SegmentID, g.Text = strings.TrimSpace(g.SegmentID), strings.TrimSpace(g.Text)
		runes += utf8.RuneCountInString(g.Text)
		if g.SegmentID == "" || len(g.SegmentID) > agentSegmentIDMax || g.Text == "" {
			return Invalid("mỗi đoạn cần segment_id và text")
		}
	}
	if runes > captionTranslateMaxRunes {
		return Invalid("tổng text tối đa 4000 ký tự")
	}
	return nil
}

// AgentTranslate translates a second's worth of final captions into target
// (§5.3) through the gateway (caption_translate, system actor
// meeting_scribe). What the organization may not use, a call inside the
// spacing, or no AI credit left answers an empty skip, so the agent shows the
// original; an answer that does not parse translates nothing.
func (s *MeetingService) AgentTranslate(ctx context.Context, c meetings.AgentClaims, target string, segs []CaptionSegmentInput) (CaptionTranslateResult, error) {
	m, run, err := s.agentRun(ctx, c)
	if err != nil {
		return CaptionTranslateResult{}, err
	}
	if err := validateCaptionSegments(target, segs); err != nil {
		return CaptionTranslateResult{}, err
	}
	if m.Status != MeetingInProgress || run.Status != ScribeActive || m.ScribeOffAt.Valid {
		s.count("caption_translate_closed")
		return CaptionTranslateResult{Skipped: CaptionSkipClosed}, nil
	}
	if err := s.captionTranslateGate(ctx, m.OrganizationID); err != nil {
		var ce CodedError
		if !errors.Is(err, ErrEntitlementRequired) && !errors.Is(err, ErrSubscriptionInactive) && !errors.As(err, &ce) {
			return CaptionTranslateResult{}, err
		}
		s.count("caption_translate_unavailable")
		return CaptionTranslateResult{Skipped: CaptionSkipFeature}, nil
	}
	if !s.captions.allow(m.ID+":"+target, time.Now()) {
		s.count("caption_translate_capped")
		return CaptionTranslateResult{Skipped: CaptionSkipCapped}, nil
	}
	sc, err := s.scribeContext(ctx, m)
	if err != nil {
		return CaptionTranslateResult{}, err
	}
	glossary := uniqueTerms(append([]string{sc.MeetingTitle, sc.WorkspaceName, sc.ProjectName}, sc.ParticipantNames...))
	lines := make([]ai.CaptionLine, len(segs))
	byLabel := make(map[string]string, len(segs))
	for i, g := range segs {
		label := "T" + strconv.Itoa(i+1)
		lines[i] = ai.CaptionLine{Label: label, Text: g.Text}
		byLabel[label] = g.SegmentID
	}
	resp, err := s.AI.Complete(ctx, ai.Request{
		Actor: scribeActor, OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID,
		Capability: ai.CapCaptionTranslate, PromptID: ai.PromptCaptionTranslate,
		Vars: map[string]any{"target": target, "glossary": glossary, "captions": lines},
	})
	if errors.Is(err, ai.ErrQuotaExceeded) {
		s.count("caption_translate_quota")
		return CaptionTranslateResult{Skipped: CaptionSkipQuota}, nil
	}
	var got []ai.CaptionTranslation
	if err == nil {
		got, err = ai.ParseCaptionTranslateJSON(resp.Text)
	}
	switch {
	case errors.Is(err, ai.ErrOutputInvalid) || errors.Is(err, ai.ErrRefused):
		s.count("caption_translate_failed")
		slog.Warn("meeting captions: translation answer unusable", "meeting_id", m.ID, "usage_event_id", resp.UsageEventID, "err", err)
	case err != nil:
		s.count("caption_translate_failed")
		return CaptionTranslateResult{}, err
	}
	out := CaptionTranslateResult{Translations: make([]CaptionTranslation, 0, len(got))}
	for _, t := range got {
		// Only labels of this call, once each, and no longer than a caption may be.
		if id, ok := byLabel[t.ID]; ok && utf8.RuneCountInString(t.Text) <= agentSegmentRunes {
			out.Translations = append(out.Translations, CaptionTranslation{SegmentID: id, Text: t.Text})
			delete(byLabel, t.ID)
		}
	}
	s.count("caption_translate_ok")
	return out, nil
}

// uniqueTerms drops empty and repeated terms, keeping the order.
func uniqueTerms(terms []string) []string {
	seen := make(map[string]bool, len(terms))
	out := terms[:0]
	for _, t := range terms {
		if t = strings.TrimSpace(t); t != "" && !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	return out
}
