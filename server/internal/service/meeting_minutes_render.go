package service

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// The minutes of a meeting as Markdown (UNI-2003, spec meeting follow-through
// §7.6, §10). Facts come from tables and never pass through a model; the
// narrative is the latest summary's. renderMinutes is pure: one layout per
// language today, and a meeting type later brings its own layout (section
// order, headings, a national header) through the same function.

// minutesFacts is what the minutes state as fact.
type minutesFacts struct {
	Title string
	// Date is the meeting's day, Start and End its actual times (scheduled
	// when it never started), in the meeting's timezone; Zone names that
	// timezone's offset ("GMT+7").
	Date, Start, End, Zone string
	Host                   string
	Secretaries            []string
	// Attendance is set once the roll is finalized; Invited lists the
	// participants otherwise.
	Attendance *ai.AttendanceFacts
	Invited    []string
	// Motions are the closed votes, counts only.
	Motions  []ai.MotionFact
	Assigned []minutesTask
	Author   string
	// CreatedOn is the day the minutes were made.
	CreatedOn string
}

// minutesTask is one action item that became a task.
type minutesTask struct{ Title, Assignee, Due string }

// minutesNarrative is what the summary wrote. Summary empty: no summary yet.
type minutesNarrative struct {
	Summary   string
	Decisions []minutesDecision
}

// minutesDecision is a decision and the clock times (HH:MM, the meeting's
// timezone) of the transcript lines it rests on.
type minutesDecision struct {
	Text string
	At   []string
}

// minutesLayout is the wording and order of one kind of minutes.
type minutesLayout struct {
	TitlePrefix, TimeLabel, HostLabel, SecretaryLabel        string
	Attendance, Invited, Content, Decisions, Votes, Assigned string
	NoSummary, EvidenceAt                                    string
	PresentRatio                                             string // members present, total, percent
	QuorumMet, QuorumNotMet                                  string // quorum percent
	StatusNames                                              map[string]string
	VoteHeader                                               [5]string
	AssignedHeader                                           [3]string
	Passed, Failed, Secret                                   string
	AuthorLabel, CreatedLabel                                string
}

var minutesLayouts = map[string]minutesLayout{
	"vi": {
		TitlePrefix: "Biên bản", TimeLabel: "Thời gian", HostLabel: "Chủ trì", SecretaryLabel: "Thư ký",
		Attendance: "Thành phần", Invited: "Người được mời", Content: "Nội dung", Decisions: "Kết luận",
		Votes: "Kết quả biểu quyết", Assigned: "Việc đã giao",
		NoSummary: "Chưa có tóm tắt.", EvidenceAt: "lúc",
		PresentRatio: "Có mặt %d/%d thành viên (%d%%).",
		QuorumMet:    "Đủ tỉ lệ có mặt tối thiểu %d%%.", QuorumNotMet: "Chưa đủ tỉ lệ có mặt tối thiểu %d%%.",
		StatusNames: map[string]string{
			AttendancePresent: "Có mặt", AttendanceLate: "Đến muộn", AttendanceExcused: "Vắng có phép", AttendanceAbsent: "Vắng",
		},
		VoteHeader:     [5]string{"Nội dung", "Tán thành", "Không tán thành", "Không ý kiến", "Kết quả"},
		AssignedHeader: [3]string{"Việc", "Người phụ trách", "Hạn"},
		Passed:         "Thông qua", Failed: "Không thông qua", Secret: "phiếu kín",
		AuthorLabel: "Người lập", CreatedLabel: "Ngày lập",
	},
	"en": {
		TitlePrefix: "Minutes", TimeLabel: "Time", HostLabel: "Chair", SecretaryLabel: "Secretary",
		Attendance: "Attendance", Invited: "Invited", Content: "Discussion", Decisions: "Decisions",
		Votes: "Votes", Assigned: "Assigned tasks",
		NoSummary: "No summary yet.", EvidenceAt: "at",
		PresentRatio: "%d of %d members present (%d%%).",
		QuorumMet:    "Quorum of %d%% met.", QuorumNotMet: "Quorum of %d%% not met.",
		StatusNames: map[string]string{
			AttendancePresent: "Present", AttendanceLate: "Late", AttendanceExcused: "Excused", AttendanceAbsent: "Absent",
		},
		VoteHeader:     [5]string{"Motion", "Yes", "No", "Abstain", "Outcome"},
		AssignedHeader: [3]string{"Task", "Owner", "Due"},
		Passed:         "Passed", Failed: "Not passed", Secret: "secret ballot",
		AuthorLabel: "Prepared by", CreatedLabel: "Date prepared",
	},
}

// minutesLayoutFor is the layout of a locale; anything else reads Vietnamese.
func minutesLayoutFor(locale string) minutesLayout {
	if l, ok := minutesLayouts[locale]; ok {
		return l
	}
	return minutesLayouts["vi"]
}

// minutesTitle is the page title: "Biên bản: {title} ({dd/MM/yyyy})". A
// meeting title too long for a document title is cut with an ellipsis, so
// the date stays.
func minutesTitle(l minutesLayout, f minutesFacts) string {
	head, tail := l.TitlePrefix+": ", " ("+f.Date+")"
	title := []rune(f.Title)
	if room := maxDocumentTitle - utf8.RuneCountInString(head+tail); len(title) > room {
		title = append(title[:room-1], '…')
	}
	return head + string(title) + tail
}

var attendanceOrder = []string{AttendancePresent, AttendanceLate, AttendanceExcused, AttendanceAbsent}

func renderMinutes(f minutesFacts, n minutesNarrative, l minutesLayout) string {
	var b strings.Builder
	line := func(s string) { b.WriteString(s + "\n") }
	section := func(title string) { line(""); line("## " + title); line("") }

	// The page title already reads "Biên bản: {title} ({date})": the body
	// opens on the facts and states the day once, beside the times.
	when := f.Start
	if f.End != "" {
		when += " – " + f.End
	}
	if f.Zone != "" {
		when += " (" + f.Zone + ")"
	}
	line("- " + l.TimeLabel + ": " + when + ", " + f.Date)
	line("- " + l.HostLabel + ": " + mdEscape(f.Host))
	if len(f.Secretaries) > 0 {
		line("- " + l.SecretaryLabel + ": " + mdEscape(strings.Join(f.Secretaries, ", ")))
	}

	if a := f.Attendance; a != nil {
		section(l.Attendance)
		present := a.Present + a.Late
		pct := 0
		if a.Members > 0 {
			pct = present * 100 / a.Members
		}
		ratio := fmt.Sprintf(l.PresentRatio, present, a.Members, pct)
		if a.QuorumMet != nil {
			q := l.QuorumNotMet
			if *a.QuorumMet {
				q = l.QuorumMet
			}
			ratio += " " + fmt.Sprintf(q, a.QuorumPercent)
		}
		line(ratio)
		line("")
		for _, status := range attendanceOrder {
			if names := a.NamesByStatus[status]; len(names) > 0 {
				line("- " + l.StatusNames[status] + ": " + mdEscape(strings.Join(names, ", ")))
			}
		}
	} else if len(f.Invited) > 0 {
		section(l.Invited)
		for _, name := range f.Invited {
			line("- " + mdEscape(name))
		}
	}

	section(l.Content)
	if s := strings.TrimSpace(n.Summary); s != "" {
		line(mdNarrative(s))
	} else {
		line(l.NoSummary)
	}

	if len(n.Decisions) > 0 {
		section(l.Decisions)
		for i, d := range n.Decisions {
			text := mdNarrative(oneLine(d.Text))
			if len(d.At) > 0 {
				text += " (" + l.EvidenceAt + " " + strings.Join(d.At, ", ") + ")"
			}
			line(fmt.Sprintf("%d. %s", i+1, text))
		}
	}

	if len(f.Motions) > 0 {
		section(l.Votes)
		h := l.VoteHeader
		line("| " + strings.Join(h[:], " | ") + " |")
		line("| --- | --- | --- | --- | --- |")
		for _, m := range f.Motions {
			title := mdCell(m.Title)
			if m.BallotMode == "SECRET" {
				title += " (" + l.Secret + ")"
			}
			outcome := l.Failed
			if m.Outcome == OutcomePassed {
				outcome = l.Passed
			}
			line(fmt.Sprintf("| %s | %d | %d | %d | %s |", title, m.Yes, m.No, m.Abstain, outcome))
		}
	}

	if len(f.Assigned) > 0 {
		section(l.Assigned)
		h := l.AssignedHeader
		line("| " + strings.Join(h[:], " | ") + " |")
		line("| --- | --- | --- |")
		for _, t := range f.Assigned {
			line("| " + mdCell(t.Title) + " | " + mdCell(t.Assignee) + " | " + mdCell(t.Due) + " |")
		}
	}

	line("")
	footer := l.AuthorLabel + ": " + mdEscape(f.Author)
	if f.CreatedOn != f.Date {
		footer += " · " + l.CreatedLabel + ": " + f.CreatedOn
	}
	line(footer)
	return b.String()
}

// mdEscape keeps a typed name or title literal: Markdown punctuation is
// escaped and line breaks fold into spaces.
func mdEscape(s string) string {
	var b strings.Builder
	for _, r := range oneLine(s) {
		if strings.ContainsRune("\\`*_[]()<>#|!~", r) {
			b.WriteRune('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// mdNarrative keeps the summary's own Markdown (emphasis, lists) but stops
// any line from posing as structure the facts own: a heading, a table row or
// a setext underline / rule is escaped into text.
func mdNarrative(s string) string {
	lines := strings.Split(s, "\n")
	for i, ln := range lines {
		t := strings.TrimLeft(ln, " \t")
		if t == "" {
			continue
		}
		setext := strings.Trim(t, "-= \t") == ""
		if t[0] == '#' || t[0] == '|' || setext {
			lines[i] = "\\" + t
		}
	}
	return strings.Join(lines, "\n")
}

// mdCell is mdEscape for a table cell; an empty one shows a dash.
func mdCell(s string) string {
	if strings.TrimSpace(s) == "" {
		return "—"
	}
	return mdEscape(s)
}
