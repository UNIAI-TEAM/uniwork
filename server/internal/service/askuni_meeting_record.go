package service

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// How Ask UNI and the MCP connector read a meeting's record (UNI-1995
// benchmark #14, #17): its action items as the meeting holds them now, not
// the model's raw proposal, and its summary as searchable text.

// meetingSearchExcerptRunes caps the summary a meeting search hit quotes.
const meetingSearchExcerptRunes = 400

// meetingRecordExcerpt is a meeting's latest summary (paragraph, topics,
// decisions, open questions) and its action items as they stand: pending and
// converted only, a converted one as its task is now (status, assignee, due),
// never a dismissed one nor the raw proposal stored with the summary (a
// clerk dismisses or rewords what the model proposed; live and manual items
// are not in it). "" when the meeting has neither.
func (s *AskUNIService) meetingRecordExcerpt(ctx context.Context, tc ai.ToolContext, meetingID string, sum *db.MeetingSummary) (string, error) {
	var b strings.Builder
	if sum != nil {
		b.WriteString("Tóm tắt: " + sum.Summary)
		var topics []string
		for _, t := range DecodeSummaryTopics(sum.Topics) {
			topics = append(topics, t.Title)
		}
		if len(topics) > 0 {
			b.WriteString("\nChủ đề: " + strings.Join(topics, "; "))
		}
		b.WriteString("\nQuyết định: " + summaryDecisionTexts(sum.Decisions))
		if qs := DecodeSummaryDecisions(sum.OpenQuestions); len(qs) > 0 {
			b.WriteString("\nCâu hỏi còn mở: " + summaryDecisionTexts(sum.OpenQuestions))
		}
	}
	items, err := s.meetings.ActionItems(ctx, tc.ActorID, meetingID)
	if err != nil {
		return "", err
	}
	var names, statuses map[string]string
	var lines []string
	for _, it := range items.Items {
		switch it.Status {
		case ActionItemPending:
			line := "- " + it.Item.Title + " · chưa giao"
			if o := strings.TrimSpace(it.Item.OwnerText); o != "" {
				line += " · người được nêu: " + o
			}
			if d := strings.TrimSpace(it.Item.DueText); d != "" {
				line += " · hạn được nêu: " + d
			}
			lines = append(lines, line)
		case ActionItemConverted:
			if it.Task == nil {
				continue
			}
			if statuses == nil {
				statuses = s.taskStatusLabels(ctx, tc)
			}
			line := "- " + it.Task.Title + " · đã giao thành task · trạng thái: " + statusLabel(statuses, it.Task.Status)
			if it.Task.AssigneeID != nil {
				if names == nil {
					names = s.memberNames(ctx, tc)
				}
				if n := names[*it.Task.AssigneeID]; n != "" {
					line += " · người nhận: " + n
				}
			}
			if it.Task.DueDate != nil {
				line += " · hạn: " + *it.Task.DueDate
			}
			if it.Task.Overdue {
				line += " · quá hạn"
			}
			lines = append(lines, line)
		}
	}
	if len(lines) > 0 {
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		b.WriteString("Việc cần làm:\n" + strings.Join(lines, "\n"))
	}
	return b.String(), nil
}

// meetingSearchText is what a meeting said, for a search to score: its
// latest summary, its decisions and topics, and its open action items' titles.
type meetingSearchText struct {
	content, summary string
}

// meetingSearchTexts reads it for the meetings found, keyed by meeting id.
// The meetings are the asker's own list (already behind the workspace gate).
// The summary, decisions and topics count only for a meeting whose AI content
// the asker may read (aiContentReader); item titles stay workspace-visible.
func (s *AskUNIService) meetingSearchTexts(ctx context.Context, userID string, meetings []db.Meeting) (map[string]meetingSearchText, error) {
	out := map[string]meetingSearchText{}
	if len(meetings) == 0 {
		return out, nil
	}
	ids := make([]string, len(meetings))
	byID := make(map[string]db.Meeting, len(meetings))
	for i, m := range meetings {
		ids[i] = m.ID
		byID[m.ID] = m
	}
	mem, err := s.ws.RequireMember(ctx, meetings[0].WorkspaceID, userID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListWorkspaceMeetingSearchTexts(ctx, db.ListWorkspaceMeetingSearchTextsParams{
		OrganizationID: meetings[0].OrganizationID, WorkspaceID: meetings[0].WorkspaceID, MeetingIds: ids,
	})
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		parts := []string{r.ItemTitles}
		summary := ""
		if r.Summary != "" {
			// shortcut: one participant read per summarised meeting; batch it if
			// a workspace's meeting list grows past a few hundred.
			ok, err := s.meetings.aiContentReader(ctx, byID[r.MeetingID], mem, userID)
			if err != nil {
				return nil, err
			}
			if ok {
				parts = append(parts, r.Summary)
				var decisions []string
				_ = json.Unmarshal([]byte(summaryDecisionTexts(r.Decisions)), &decisions)
				parts = append(parts, decisions...)
				for _, t := range DecodeSummaryTopics(r.Topics) {
					parts = append(parts, t.Title)
					for _, p := range t.Points {
						parts = append(parts, p.Text)
					}
				}
				summary = capRunes(r.Summary, meetingSearchExcerptRunes, "…")
			}
		}
		out[r.MeetingID] = meetingSearchText{content: strings.Join(parts, "\n"), summary: summary}
	}
	return out, nil
}
