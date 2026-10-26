package service

import (
	"context"
	"fmt"
	"log/slog"
	"maps"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/sync/errgroup"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The long-meeting side of a summary (UNI-1995 benchmark #6, #8, #22 j): a
// transcript longer than one call's budget is read in parts and the parts'
// records are combined (map → reduce) instead of dropping its middle; the
// record's size grows with the transcript; an answer cut at max_tokens is
// asked again once in brief mode; and the system's own runs speak the
// meeting's language.

const (
	// summaryMaxParts bounds the calls of the map step: past this many
	// budgets of transcript the middle is dropped again, and the summary is
	// partial.
	summaryMaxParts = 4
	// summaryPartConcurrency is the parts asked at once: a run holds at most
	// this many model calls, on top of the four auto-summary claimers a node
	// runs.
	summaryPartConcurrency = 2
)

// summaryLineRunes is the size of a transcript line in the prompt.
func summaryLineRunes(l ai.TranscriptLine) int {
	return utf8.RuneCountInString(l.Speaker) + utf8.RuneCountInString(l.Text) + 3
}

// splitSummaryTranscript returns the transcript as one chunk when it fits the
// budget, otherwise as at most maxParts consecutive chunks of at most budget
// runes each. Only a transcript longer than maxParts chunks can carry loses
// lines, with summaryWindow's head-and-tail cut and its marker; cut reports
// it. Never empty: a meeting without a transcript is one empty chunk.
func splitSummaryTranscript(lines []ai.TranscriptLine, budget, maxParts int) ([][]ai.TranscriptLine, bool) {
	total, longest := 0, 0
	for _, l := range lines {
		n := summaryLineRunes(l)
		total, longest = total+n, max(longest, n)
	}
	if total <= budget || maxParts <= 1 {
		out, cut := windowSummaryLines(lines, budget, summaryLineRunes,
			func(n int) ai.TranscriptLine { return ai.TranscriptLine{Speaker: "…", Text: summaryOmitted(n)} })
		return [][]ai.TranscriptLine{out}, cut
	}
	// A chunk closes when the next line would not fit, so every chunk but
	// the last holds more than budget-longest runes: a window of
	// maxParts*(budget-longest) runes makes at most maxParts chunks.
	window := maxParts * max(budget-longest-summaryMarkerRunes, budget/2)
	lines, cut := windowSummaryLines(lines, window, summaryLineRunes,
		func(n int) ai.TranscriptLine { return ai.TranscriptLine{Speaker: "…", Text: summaryOmitted(n)} })
	var chunks [][]ai.TranscriptLine
	var cur []ai.TranscriptLine
	used := 0
	for _, l := range lines {
		n := summaryLineRunes(l)
		if len(cur) > 0 && used+n > budget {
			chunks, cur, used = append(chunks, cur), nil, 0
		}
		cur, used = append(cur, l), used+n
	}
	return append(chunks, cur), cut
}

// summaryMarkerRunes is room for the "(n lines omitted)" line.
const summaryMarkerRunes = 32

// summarySizeFor scales the record to the input it summarizes (benchmark
// #8): about one TL;DR sentence more per 8k runes (~10 minutes of speech),
// one topic more per 5k runes and one point more per 15k, from a
// stand-up's 2 sentences and 2 topics to a long meeting's 8 sentences, 12
// topics and 6 points each. They are ceilings the prompt lets the model stay
// under, so they leave room for every subject a meeting of that length has.
func summarySizeFor(runes int) ai.SummarySize {
	clamp := func(v, lo, hi int) int { return min(max(v, lo), hi) }
	return ai.SummarySize{
		Sentences: clamp(2+runes/8000, 2, 8),
		Topics:    clamp(2+runes/5000, 2, 12),
		Points:    clamp(2+runes/15000, 2, 6),
	}
}

// summarizeParts is the map step: each chunk's record, asked
// summaryPartConcurrency at a time with the same actor and capability as the
// summary, so each part is metered like it. One failed part fails the run.
func (s *MeetingService) summarizeParts(ctx context.Context, req ai.Request, chunks [][]ai.TranscriptLine) ([]ai.MeetingSummary, error) {
	parts := make([]ai.MeetingSummary, len(chunks))
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(summaryPartConcurrency)
	for i, chunk := range chunks {
		g.Go(func() error {
			part := req
			part.PromptID = ai.PromptMeetingSummaryPart
			runes := 0
			for _, l := range chunk {
				runes += summaryLineRunes(l)
			}
			part.Vars = map[string]any{
				"title": req.Vars["title"], "agenda": req.Vars["agenda"], "locale": req.Vars["locale"],
				"part": fmt.Sprintf("part %d of %d", i+1, len(chunks)), "size": summarySizeFor(runes),
				"transcript": chunk,
			}
			_, res, err := s.completeSummary(gctx, part)
			parts[i] = res
			return err
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	s.count("summary_parts")
	return parts, nil
}

// completeSummary asks the gateway for a record and parses it. An answer cut
// at max_tokens (billed) is asked once more in brief mode (benchmark #6):
// titles, owners and dues without descriptions, fewer points. A failure after
// the gateway answered is a summaryStepError, labelled for summaryFailure.
func (s *MeetingService) completeSummary(ctx context.Context, req ai.Request) (ai.Response, ai.MeetingSummary, error) {
	resp, err := s.AI.Complete(ctx, req)
	if ai.IsTruncated(err) {
		s.count("summary_truncated")
		slog.Info("meetings: summary answer cut at max_tokens, asking once more in brief mode",
			"prompt_id", req.PromptID, "usage_event_id", summaryUsageID("", err))
		brief := maps.Clone(req.Vars)
		brief["brief"] = true
		req.Vars = brief
		resp, err = s.AI.Complete(ctx, req)
	}
	if err != nil {
		return resp, ai.MeetingSummary{}, err
	}
	if strings.TrimSpace(resp.Text) == "" {
		return resp, ai.MeetingSummary{}, summaryStepError{reason: summaryReasonEmpty, err: errSummaryEmptyOutput}
	}
	// ParseSummaryJSON also refuses an object with no summary, decisions,
	// topics or action items, so that answer counts as parse; empty is blank
	// text only.
	res, err := ai.ParseSummaryJSON(resp.Text)
	if err != nil {
		return resp, ai.MeetingSummary{}, summaryStepError{reason: summaryReasonParse, err: err}
	}
	return resp, res, nil
}

// meetingLanguage is the language the system's own summary and live items
// are written in (benchmark #22 j): the language the speech recognizer
// tagged most lines with, else the language of what was said and written,
// else Vietnamese, the product's default. No organization locale exists yet.
func meetingLanguage(segs []db.MeetingTranscriptSegment, notes []db.ListMeetingNotesRow, chat []db.MeetingChatMessage) string {
	tagged := map[string]int{}
	for _, sg := range segs {
		if l := normalizeLanguage(sg.Language); l != "" {
			tagged[l]++
		}
	}
	if tagged["vi"]+tagged["en"] > len(segs)/2 {
		if tagged["en"] > tagged["vi"] {
			return "en"
		}
		return "vi"
	}
	texts := make([]string, 0, len(segs)+len(notes)+len(chat))
	for _, sg := range segs {
		texts = append(texts, sg.Text)
	}
	for _, n := range notes {
		texts = append(texts, n.Body)
	}
	for _, c := range chat {
		texts = append(texts, c.Message)
	}
	return textLanguage(texts)
}

// normalizeLanguage maps an STT language tag ("vi", "vi-VN", "en-US") onto
// the two languages a summary is written in; "" for anything else.
func normalizeLanguage(tag string) string {
	switch l := strings.ToLower(strings.TrimSpace(tag)); {
	case strings.HasPrefix(l, "vi"):
		return "vi"
	case strings.HasPrefix(l, "en"):
		return "en"
	}
	return ""
}

// textLanguageSample bounds the words textLanguage reads.
const textLanguageSample = 4000

// textLanguage tells Vietnamese from English by its letters: Vietnamese
// marks almost every other word (ă â đ ê ô ơ ư and the tone marks), English
// none. Text with fewer than 20 words, or with marks on at least one word
// in twenty, reads Vietnamese.
func textLanguage(texts []string) string {
	words, marked := 0, 0
	for _, t := range texts {
		for _, w := range strings.FieldsFunc(t, func(r rune) bool { return !unicode.IsLetter(r) }) {
			words++
			if strings.IndexFunc(w, vietnameseLetter) >= 0 {
				marked++
			}
			if words >= textLanguageSample {
				break
			}
		}
		if words >= textLanguageSample {
			break
		}
	}
	if words >= 20 && marked*20 < words {
		return "en"
	}
	return "vi"
}

// vietnameseLetter is a letter Vietnamese writes and English does not.
func vietnameseLetter(r rune) bool {
	r = unicode.ToLower(r)
	return strings.ContainsRune("ăâđêôơưàáảãạèéẻẽẹìíỉĩịòóỏõọùúủũụỳýỷỹỵ", r) || (r >= 0x1EA0 && r <= 0x1EF9)
}
