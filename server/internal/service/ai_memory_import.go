package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/redis/go-redis/v9"
	"golang.org/x/text/unicode/norm"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Import from another AI (P4 R15): the person pastes what ChatGPT, Claude or
// Gemini knows about them, one model call splits it into candidates (nothing
// is stored), and a second command saves the entries the person ticked. The
// paste and the candidates are untrusted: neither is ever logged or audited.

var (
	errAiMemoryImportRateLimited = CodedError{Code: "ai_memory_import_rate_limited", Status: http.StatusTooManyRequests}
	errAiMemoryImportFailed      = CodedError{Code: "ai_memory_import_failed", Status: http.StatusBadGateway}
)

// aiMemoryInjectionPattern marks a candidate instruction_like whatever the
// model said: a link, or a phrase prompt injection is known for.
var aiMemoryInjectionPattern = regexp.MustCompile(`(?i)https?://|www\.|ignore (all )?(previous|prior)|system prompt|developer mode|you are now|bỏ qua (mọi |tất cả )?(hướng dẫn|chỉ dẫn)`)

// The skip reasons memory_import@1 may give; anything else is not_about_user.
var aiMemorySkipReasons = map[string]bool{"personal": true, "other_person": true, "secret": true, "not_about_user": true}

// AiMemoryImportSplit is what UNI split out of a paste; nothing is stored.
type AiMemoryImportSplit struct {
	Candidates []AiMemoryCandidate
	Skipped    []AiMemorySkipped
}

// AiMemoryCandidate is one entry to tick. InstructionLike and Duplicate ones
// are not ticked in advance.
type AiMemoryCandidate struct {
	Text, Kind                 string
	InstructionLike, Duplicate bool
}

// AiMemorySkipped is a line UNI left out, shown but never saved.
type AiMemorySkipped struct{ Text, Reason string }

// AiMemoryInput is one entry the person ticked to save.
type AiMemoryInput struct{ Kind, Text string }

// SetImport gives the service the gateway that splits a paste and the Redis
// that counts splits; without Redis the count is per process.
func (s *AiMemoryService) SetImport(gw *ai.Gateway, rdb *redis.Client) { s.gw, s.rdb = gw, rdb }

// SplitImport splits text pasted from another AI into candidate entries. The
// person's own switch does not refuse it: like adding by hand, it is their
// action, and the switch governs UNI's use of memory.
func (s *AiMemoryService) SplitImport(ctx context.Context, userID, orgID, text string) (AiMemoryImportSplit, error) {
	if err := s.gate(ctx, userID, orgID); err != nil {
		return AiMemoryImportSplit{}, err
	}
	text = strings.ReplaceAll(text, "\r\n", "\n")
	if utf8.RuneCountInString(text) > aiMemoryImportMaxRunes || strings.TrimSpace(text) == "" {
		return AiMemoryImportSplit{}, Invalid("text must be 1 to 20000 characters")
	}
	if !s.gw.Enabled() {
		return AiMemoryImportSplit{}, ai.ErrDisabled
	}
	if n, ok := s.splitCount(ctx, userID); ok && n > aiMemoryImportPerHour {
		return AiMemoryImportSplit{}, errAiMemoryImportRateLimited
	}
	existing, err := s.q.AiListMemories(ctx, db.AiListMemoriesParams{OrganizationID: orgID, UserID: userID})
	if err != nil {
		return AiMemoryImportSplit{}, err
	}
	entries, err := s.splitCall(ctx, userID, orgID, text)
	if err != nil {
		return AiMemoryImportSplit{}, err
	}
	s.observe("import_split")
	return importCandidates(entries, existing), nil
}

// splitCount counts one split of userID's in its hour; ok is false when Redis
// did not answer in time, which lets the split through (ruling P22).
func (s *AiMemoryService) splitCount(ctx context.Context, userID string) (n int64, ok bool) {
	if s.rdb == nil {
		return memIncrement(&s.splitMem, userID, s.now(), time.Hour), true
	}
	ctx, cancel := context.WithTimeout(ctx, uniworkLeaseTimeout)
	defer cancel()
	n, err := askCountScript.Run(ctx, s.rdb, []string{"uw:ai:memory:split:" + userID}, time.Hour.Milliseconds()).Int64()
	return n, err == nil
}

type aiMemoryImportEntry struct {
	Text            string `json:"text"`
	Kind            string `json:"kind"`
	InstructionLike bool   `json:"instruction_like"`
	SkipReason      string `json:"skip_reason"`
}

// splitCall asks memory_import@1 for the entries. An answer that is not the
// schema's JSON, or one cut at the token ceiling (ErrOutputInvalid from the
// gateway), is asked once more; every attempt is its own usage row.
func (s *AiMemoryService) splitCall(ctx context.Context, userID, orgID, text string) ([]aiMemoryImportEntry, error) {
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := s.gw.Complete(ctx, ai.Request{
			Actor: Human(userID), OrganizationID: orgID,
			Capability: ai.CapAskUniMemoryImport, PromptID: ai.PromptMemoryImport,
			Vars: map[string]any{"text": text},
		})
		if errors.Is(err, ai.ErrOutputInvalid) {
			continue
		}
		if err != nil {
			return nil, err
		}
		raw := resp.Text
		if i, j := strings.Index(raw, "{"), strings.LastIndex(raw, "}"); i >= 0 && j > i {
			raw = raw[i : j+1] // a model that fences its JSON
		}
		var out struct {
			Entries *[]aiMemoryImportEntry `json:"entries"`
		}
		if json.Unmarshal([]byte(raw), &out) == nil && out.Entries != nil {
			return *out.Entries, nil
		}
	}
	return nil, errAiMemoryImportFailed
}

// importCandidates re-checks the model's entries (R15): invisible format
// characters are dropped (tag characters also make the entry
// instruction_like), control characters become one space, empty entries go,
// an entry that is still not a valid memory line is skipped as
// not_about_user, a link or injection phrase makes it instruction_like, and an
// entry equal to memory or to an earlier candidate is a duplicate. At most 100
// candidates and 100 skipped lines.
func importCandidates(entries []aiMemoryImportEntry, existing []db.AiMemory) AiMemoryImportSplit {
	seen := map[string]bool{}
	for _, m := range existing {
		seen[aiMemoryKey(m.Body)] = true
	}
	out := AiMemoryImportSplit{Candidates: []AiMemoryCandidate{}, Skipped: []AiMemorySkipped{}}
	for _, e := range entries {
		hidden := false
		text := strings.Map(func(r rune) rune {
			if invisibleFormat(r) {
				hidden = hidden || isTagChar(r)
				return -1
			}
			return r
		}, e.Text)
		text = strings.Join(strings.FieldsFunc(text, func(r rune) bool {
			return unicode.IsControl(r) || unicode.Is(unicode.Zl, r) || unicode.Is(unicode.Zp, r)
		}), " ")
		if strings.TrimSpace(text) == "" {
			continue
		}
		valid, err := validMemoryText(text)
		if e.Kind == AiMemoryKindPreference || e.Kind == AiMemoryKindFact {
			if err == nil {
				if len(out.Candidates) < aiMemoryImportMaxCandidates {
					key := aiMemoryKey(valid)
					out.Candidates = append(out.Candidates, AiMemoryCandidate{
						Text: valid, Kind: e.Kind, Duplicate: seen[key],
						InstructionLike: e.InstructionLike || hidden || aiMemoryInjectionPattern.MatchString(injectionForm(valid)),
					})
					seen[key] = true
				}
				continue
			}
			e.SkipReason = "not_about_user"
		}
		if !aiMemorySkipReasons[e.SkipReason] {
			e.SkipReason = "not_about_user"
		}
		if len(out.Skipped) < aiMemoryImportMaxCandidates {
			out.Skipped = append(out.Skipped, AiMemorySkipped{Text: strings.TrimSpace(text), Reason: e.SkipReason})
		}
	}
	return out
}

// injectionForm is the text aiMemoryInjectionPattern is matched against, so
// spacing tricks do not slip past it: format characters (zero-width spaces)
// dropped, NFC, every run of whitespace one space.
func injectionForm(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, s)
	return strings.Join(strings.Fields(norm.NFC.String(s)), " ")
}

// ImportMemories saves the entries the person ticked, all or none: an invalid
// entry is a 400 and an overflow ai_memory_full before anything is kept. An
// entry equal to memory or to an earlier one of the save is skipped and
// counted in SkippedDuplicates. Like SplitImport, the switch does not refuse it.
func (s *AiMemoryService) ImportMemories(ctx context.Context, userID, orgID string, entries []AiMemoryInput) (AiMemoryList, error) {
	if err := s.gate(ctx, userID, orgID); err != nil {
		return AiMemoryList{}, err
	}
	if len(entries) == 0 || len(entries) > aiMemoryMaxEntries {
		return AiMemoryList{}, Invalid("entries must hold 1 to 50 entries")
	}
	entries = slices.Clone(entries)
	for i, e := range entries {
		if err := validMemoryKind(e.Kind); err != nil {
			return AiMemoryList{}, err
		}
		text, err := validMemoryText(e.Text)
		if err != nil {
			return AiMemoryList{}, err
		}
		entries[i].Text = text
	}
	var out AiMemoryList
	skipped := 0
	err := s.inTx(ctx, func(q *db.Queries) error {
		if err := q.AiLockMemoryOwner(ctx, db.AiLockMemoryOwnerParams{OrganizationID: orgID, UserID: userID}); err != nil {
			return err
		}
		rows, err := q.AiListMemories(ctx, db.AiListMemoriesParams{OrganizationID: orgID, UserID: userID})
		if err != nil {
			return err
		}
		seen := map[string]bool{}
		for _, r := range rows {
			seen[aiMemoryKey(r.Body)] = true
		}
		for _, e := range entries {
			key := aiMemoryKey(e.Text)
			if seen[key] {
				skipped++
				continue
			}
			seen[key] = true
			// createQ refuses the entry that would pass the cap, and the
			// rollback then keeps none of the save.
			if _, err := s.createQ(ctx, q, orgID, userID, e.Kind, e.Text, aiMemorySourceImport, ""); err != nil {
				return err
			}
		}
		// Read back inside the transaction: once it commits there is no read
		// left to fail and answer 500 for a save that happened.
		out, err = s.listOf(ctx, q, userID, orgID)
		return err
	})
	if err != nil {
		return AiMemoryList{}, err
	}
	s.observe("import_saved")
	out.SkippedDuplicates = skipped
	return out, nil
}
