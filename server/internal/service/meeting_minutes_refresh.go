package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/document"
)

// A facts-only refresh of draft minutes (UNI-1995 benchmark #22): tasks
// assigned, a roll finalized or a vote closed after the minutes were made
// reach the page, while what the clerk wrote stays. Only the sections whose
// whole content comes from tables are rewritten: the roll (or the invited
// list), the votes and the assigned tasks. The header lines, the narrative
// and the footer are left as they are.

func errMinutesFinalized() error {
	return coded(http.StatusConflict, "minutes_finalized", "biên bản đã chốt; mở lại để cập nhật")
}

// minutesPage is the page content of minutes Markdown.
func minutesPage(md string) ([]byte, error) {
	content, err := document.MarkdownToPage(md, nil)
	if err != nil {
		return nil, documentServiceError(err)
	}
	return content, nil
}

// RefreshMinutesFacts rewrites the fact sections of draft minutes from the
// tables, as the clerk's own page edit (the document's audit row and events,
// its revision and edit-lock checks). Nothing changed: nothing is written.
func (s *MeetingService) RefreshMinutesFacts(ctx context.Context, userID, meetingID string) (*MeetingMinutes, error) {
	m, err := s.requireMeetingClerk(ctx, userID, meetingID)
	if err != nil {
		return nil, err
	}
	if s.Docs == nil {
		return nil, errMinutesUnavailable()
	}
	if !m.MinutesDocumentID.Valid {
		return nil, errMinutesMissing()
	}
	if m.MinutesFinalizedAt.Valid {
		return nil, errMinutesFinalized()
	}
	view, err := s.Docs.GetDocument(ctx, Human(userID), m.MinutesDocumentID.String)
	switch {
	case errors.Is(err, ErrNotFound):
		return nil, errMinutesMissing()
	case err != nil:
		return nil, err
	}
	doc := view.Document
	if doc.OrganizationID != m.OrganizationID || doc.WorkspaceID != m.WorkspaceID || doc.ArchivedAt.Valid {
		return nil, errMinutesMissing()
	}
	facts, _, _, err := s.minutesInputs(ctx, m, userID)
	if err != nil {
		return nil, err
	}
	content, changed, err := spliceMinutesFacts(doc.Content, facts, minutesLayoutOf(doc.Content))
	if err != nil {
		return nil, err
	}
	if changed {
		_, err := s.Docs.UpdateDocument(ctx, Human(userID), doc.ID, UpdateDocumentInput{Revision: doc.Revision, Content: content})
		switch {
		case errors.Is(err, ErrForbidden):
			return nil, errMinutesEditRequired()
		case err != nil:
			return nil, err
		}
	}
	return s.minutesAfter(ctx, userID, m.ID)
}

// pmBlock is the part of a top-level page node a refresh reads.
type pmBlock struct {
	Type  string `json:"type"`
	Attrs struct {
		Level int `json:"level"`
	} `json:"attrs"`
	Content []struct {
		Text string `json:"text"`
	} `json:"content"`
}

func (b pmBlock) text() string {
	var s strings.Builder
	for _, c := range b.Content {
		s.WriteString(c.Text)
	}
	return strings.TrimSpace(s.String())
}

// minutesLayoutOf is the layout a page was made in: the one whose content
// heading it carries, Vietnamese otherwise.
func minutesLayoutOf(content []byte) minutesLayout {
	nodes, _, err := pageBlocks(content)
	if err == nil {
		for _, lang := range []string{"vi", "en"} {
			l := minutesLayouts[lang]
			if headingAt(nodes, []string{l.Content}) >= 0 {
				return l
			}
		}
	}
	return minutesLayouts["vi"]
}

// pageBlocks splits page content into its top-level nodes and the rest of
// the doc object.
func pageBlocks(content []byte) ([]json.RawMessage, map[string]json.RawMessage, error) {
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(content, &doc); err != nil {
		return nil, nil, Invalid("trang biên bản không đọc được")
	}
	var nodes []json.RawMessage
	if raw, ok := doc["content"]; ok {
		if err := json.Unmarshal(raw, &nodes); err != nil {
			return nil, nil, Invalid("trang biên bản không đọc được")
		}
	}
	return nodes, doc, nil
}

func pmBlockOf(raw json.RawMessage) pmBlock {
	var b pmBlock
	_ = json.Unmarshal(raw, &b)
	return b
}

// headingAt is the index of the first level-2 heading named one of titles, -1 if none.
func headingAt(nodes []json.RawMessage, titles []string) int {
	for i, n := range nodes {
		if b := pmBlockOf(n); b.Type == "heading" && b.Attrs.Level == 2 {
			for _, t := range titles {
				if b.text() == t {
					return i
				}
			}
		}
	}
	return -1
}

// footerAt is the index of the "Người lập: …" line, -1 if none.
func footerAt(nodes []json.RawMessage, l minutesLayout) int {
	for i, n := range nodes {
		if b := pmBlockOf(n); b.Type == "paragraph" && strings.HasPrefix(b.text(), l.AuthorLabel+": ") {
			return i
		}
	}
	return -1
}

// sectionRange is the nodes of the section headed by one of titles: from
// its heading to the next heading of level 2 or above, or the footer.
func sectionRange(nodes []json.RawMessage, titles []string, l minutesLayout) (int, int, bool) {
	start := headingAt(nodes, titles)
	if start < 0 {
		return 0, 0, false
	}
	end := start + 1
	for ; end < len(nodes); end++ {
		b := pmBlockOf(nodes[end])
		if (b.Type == "heading" && b.Attrs.Level <= 2) || (b.Type == "paragraph" && strings.HasPrefix(b.text(), l.AuthorLabel+": ")) {
			break
		}
	}
	return start, end, true
}

// spliceMinutesFacts puts the fact sections of f into the page content, each
// in place of its old one or, when it was not there, where renderMinutes
// would put it. changed is false when the page already says the same.
func spliceMinutesFacts(content []byte, f minutesFacts, l minutesLayout) ([]byte, bool, error) {
	nodes, doc, err := pageBlocks(content)
	if err != nil {
		return nil, false, err
	}
	fresh, err := minutesPage(renderMinutes(f, minutesNarrative{}, l))
	if err != nil {
		return nil, false, err
	}
	freshNodes, _, err := pageBlocks(fresh)
	if err != nil {
		return nil, false, err
	}
	// Each slot: its headings, and where it goes when the page lacks it.
	slots := []struct {
		titles []string
		anchor func([]json.RawMessage) int
	}{
		{[]string{l.Attendance, l.Invited}, func(n []json.RawMessage) int { return firstOf(n, headingAt(n, []string{l.Content}), firstHeading(n)) }},
		{[]string{l.Votes}, func(n []json.RawMessage) int { return firstOf(n, headingAt(n, []string{l.Assigned}), footerAt(n, l)) }},
		{[]string{l.Assigned}, func(n []json.RawMessage) int { return firstOf(n, footerAt(n, l)) }},
	}
	out := slices.Clone(nodes)
	for _, slot := range slots {
		var section []json.RawMessage
		if s, e, ok := sectionRange(freshNodes, slot.titles, l); ok {
			section = freshNodes[s:e]
		}
		if s, e, ok := sectionRange(out, slot.titles, l); ok {
			out = append(append(slices.Clone(out[:s]), section...), out[e:]...)
		} else if len(section) > 0 {
			at := slot.anchor(out)
			out = append(append(slices.Clone(out[:at]), section...), out[at:]...)
		}
	}
	rawOut, err := json.Marshal(out)
	if err != nil {
		return nil, false, err
	}
	doc["content"] = rawOut
	next, err := json.Marshal(doc)
	if err != nil {
		return nil, false, err
	}
	was, _, errWas := document.Sanitize(content)
	now, _, errNow := document.Sanitize(next)
	if errNow != nil {
		return nil, false, documentServiceError(errNow)
	}
	return next, errWas != nil || !bytes.Equal(was, now), nil
}

// firstOf is the first index of idx that is not -1, the end of n otherwise.
func firstOf(n []json.RawMessage, idx ...int) int {
	for _, i := range idx {
		if i >= 0 {
			return i
		}
	}
	return len(n)
}

func firstHeading(nodes []json.RawMessage) int {
	for i, n := range nodes {
		if pmBlockOf(n).Type == "heading" {
			return i
		}
	}
	return -1
}
