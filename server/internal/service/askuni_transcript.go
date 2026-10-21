package service

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// get_meeting_transcript (scribe spec §5.2, B8): a stretch of one meeting's
// transcript, read as the asker through the meeting's own gate (authorize,
// RequireMember), under the parent spec's §7.3 source rule. It only reads.

const (
	askToolTranscript = "get_meeting_transcript"
	// askTranscriptMax is the most segments one call returns.
	askTranscriptMax = 200
	// askTranscriptP0Lines is what P0's focus keeps when no line matches the
	// question: the newest ones of the last askTranscriptP0Window, about one
	// excerpt's worth.
	askTranscriptP0Lines  = 30
	askTranscriptP0Window = 10 * time.Minute
)

var transcriptEnd = time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC)

type transcriptArgs struct {
	MeetingID string `json:"meeting_id"`
	From      string `json:"from"`
	To        string `json:"to"`
	Query     string `json:"query"`
}

const transcriptToolDesc = "One meeting's transcript (what people said, with times), oldest first, at most 200 lines a call. Narrow it with a time range or keywords; use it for what was said in a meeting, live or past."

func transcriptToolProps() map[string]agentProp {
	return map[string]agentProp{
		"meeting_id": strArg("The meeting's id."),
		"from":       strArg("ISO 8601 with offset; lines spoken at or after it. \"\" for the start."),
		"to":         strArg("ISO 8601 with offset; lines spoken before it. \"\" for now."),
		"query":      strArg("Keep only lines with these words; \"\" keeps all."),
	}
}

func parseTranscriptTime(name, v string, empty time.Time) (time.Time, error) {
	if strings.TrimSpace(v) == "" {
		return empty, nil
	}
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(v))
	if err != nil {
		return time.Time{}, McpInvalidArgs{Msg: name + " must be ISO 8601 with an offset, or \"\""}
	}
	return t, nil
}

// meetingTranscript reads the asked stretch; more reports lines past
// askTranscriptMax.
func (s *AskUNIService) meetingTranscript(ctx context.Context, tc ai.ToolContext, a transcriptArgs) (m db.Meeting, segs []db.MeetingTranscriptSegment, more bool, err error) {
	from, err := parseTranscriptTime("from", a.From, time.Time{})
	if err != nil {
		return m, nil, false, err
	}
	to, err := parseTranscriptTime("to", a.To, transcriptEnd)
	if err != nil {
		return m, nil, false, err
	}
	if m, err = s.meetings.Get(ctx, tc.ActorID, strings.TrimSpace(a.MeetingID)); err != nil {
		return m, nil, false, err
	}
	if m.WorkspaceID != tc.WorkspaceID {
		return db.Meeting{}, nil, false, ErrNotFound
	}
	src, err := s.q.TranscriptSources(ctx, m.ID)
	if err != nil {
		return m, nil, false, err
	}
	ts := searchTerms(a.Query)
	limit := askTranscriptMax + 1
	if len(ts) > 0 {
		limit = summaryTranscriptRows // a keyword scans this far, then filters
	}
	rows, err := s.q.ListTranscriptSegmentsBetween(ctx, db.ListTranscriptSegmentsBetweenParams{
		MeetingID: m.ID, FromAt: pgtype.Timestamptz{Time: from, Valid: true}, ToAt: pgtype.Timestamptz{Time: to, Valid: true},
		Rich: src.HasAgent || len(src.TranscriptionIds) > 0, TranscriptionIds: src.TranscriptionIds, RowLimit: int32(limit),
	})
	if err != nil {
		return m, nil, false, err
	}
	if _, err := s.meetings.nameSpeakers(ctx, m.ID, rows, "vi"); err != nil {
		return m, nil, false, err
	}
	if len(ts) > 0 {
		rows = slices.DeleteFunc(rows, func(g db.MeetingTranscriptSegment) bool { return score(g.SpeakerName+" "+g.Text, ts) == 0 })
	}
	if len(rows) > askTranscriptMax {
		return m, rows[:askTranscriptMax], true, nil
	}
	return m, rows, false, nil
}

// transcriptSource is the read as one source: "[15:04] Speaker: text" lines.
func (s *AskUNIService) transcriptSource(ctx context.Context, m db.Meeting, segs []db.MeetingTranscriptSegment) (ai.Source, error) {
	base, err := s.base(ctx, m.WorkspaceID)
	if err != nil {
		return ai.Source{}, err
	}
	clock := meetingClock(m)
	lines := make([]string, 0, len(segs))
	for _, g := range segs {
		lines = append(lines, "["+clock(g.SpokenAt.Time)+"] "+g.SpeakerName+": "+oneLine(g.Text))
	}
	return ai.Source{Kind: "transcript", Title: "Transcript: " + m.Title, Href: base + "/meetings/" + m.ID + "#transcript", Excerpt: strings.Join(lines, "\n")}, nil
}

// agentMeetingTranscript is the agent's tool.
func (s *AskUNIService) agentMeetingTranscript(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	var a transcriptArgs
	if err := agentArgs(raw, &a); err != nil {
		return nil, err
	}
	m, segs, more, err := s.meetingTranscript(ctx, tc, a)
	if err != nil || len(segs) == 0 {
		return nil, err
	}
	src, err := s.transcriptSource(ctx, m, segs)
	if err != nil {
		return nil, err
	}
	items := []agentItem{sourceItem(src)}
	if more {
		items = append(items, moreNote("More lines match: narrow from/to or the query."))
	}
	return items, nil
}

// transcriptTool is the P0 registry's entry beside get_meeting_context.
func (s *AskUNIService) transcriptTool() ai.Tool {
	return ai.Tool{
		Name: askToolTranscript, Description: transcriptToolDesc, Kind: ai.ToolRead, Risk: ai.RiskLow, Schema: agentSchema(transcriptToolProps()),
		Handle: func(ctx context.Context, tc ai.ToolContext, input json.RawMessage) (json.RawMessage, error) {
			var a transcriptArgs
			if err := json.Unmarshal(input, &a); err != nil {
				return nil, McpInvalidArgs{Msg: "arguments must match the tool's schema"}
			}
			m, segs, _, err := s.meetingTranscript(ctx, tc, a)
			if err != nil {
				return nil, err
			}
			if len(segs) == 0 {
				return json.Marshal([]ai.Source{})
			}
			src, err := s.transcriptSource(ctx, m, segs)
			if err != nil {
				return nil, err
			}
			return json.Marshal([]ai.Source{src})
		},
	}
}

// focusTranscript is P0's meeting focus beyond get_meeting_context: the lines
// that match the question, else the newest ones; nothing when there is no
// transcript.
func (s *AskUNIService) focusTranscript(ctx context.Context, tc ai.ToolContext, meetingID, question string) ([]ai.Source, error) {
	m, segs, _, err := s.meetingTranscript(ctx, tc, transcriptArgs{MeetingID: meetingID, Query: question})
	if err == nil && len(segs) == 0 {
		// shortcut: the window reads its oldest 201 lines; past ~20 lines a minute the newest are missed, then read newest-first.
		m, segs, _, err = s.meetingTranscript(ctx, tc, transcriptArgs{MeetingID: meetingID, From: s.now().Add(-askTranscriptP0Window).Format(time.RFC3339)})
		segs = segs[max(0, len(segs)-askTranscriptP0Lines):]
	}
	if err != nil || len(segs) == 0 {
		return nil, err
	}
	src, err := s.transcriptSource(ctx, m, segs)
	if err != nil {
		return nil, err
	}
	return []ai.Source{src}, nil
}
