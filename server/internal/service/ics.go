package service

import (
	"fmt"
	"strings"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func icsTime(t time.Time) string { return t.UTC().Format("20060102T150405Z") }

func icsDate(t time.Time) string { return t.UTC().Format("20060102") }

// icsEscape follows RFC 5545 §3.3.11: backslash, semicolon, comma, newline.
func icsEscape(s string) string {
	r := strings.NewReplacer(`\`, `\\`, ";", `\;`, ",", `\,`, "\r\n", `\n`, "\n", `\n`)
	return r.Replace(s)
}

func renderICS(m db.Meeting, joinURL string, now time.Time) []byte {
	var b strings.Builder
	w := icsLineWriter(&b)
	writeICSCalendarHeader(w, "-//UniWork//Meetings//VI")
	writeMeetingVEVENT(w, m.ID+"@uniwork", m.Title, m.Description, m.Status, m.StartsAt.Time, m.EndsAt.Time, m.Version, joinURL, now)
	w("END:VCALENDAR")
	return []byte(b.String())
}

func renderWorkspaceICS(tasks []db.ListCalendarTasksInRangeRow, meetings []db.ListCalendarMeetingsInRangeRow, now time.Time) []byte {
	var b strings.Builder
	w := icsLineWriter(&b)
	writeICSCalendarHeader(w, "-//UniWork//Calendar//VI")
	for _, t := range tasks {
		writeAllDayTaskVEVENT(w, t, now)
	}
	for _, m := range meetings {
		writeWorkspaceMeetingVEVENT(w, m, now)
	}
	w("END:VCALENDAR")
	return []byte(b.String())
}

func icsLineWriter(b *strings.Builder) func(string) {
	return func(line string) {
		b.WriteString(line)
		b.WriteString("\r\n")
	}
}

func writeICSCalendarHeader(w func(string), prodid string) {
	w("BEGIN:VCALENDAR")
	w("VERSION:2.0")
	w("PRODID:" + prodid)
	w("METHOD:PUBLISH")
}

func writeAllDayTaskVEVENT(w func(string), t db.ListCalendarTasksInRangeRow, now time.Time) {
	start := t.DueDate.Time
	if t.StartDate.Valid {
		start = t.StartDate.Time
	}
	endExclusive := t.DueDate.Time.AddDate(0, 0, 1)
	w("BEGIN:VEVENT")
	w("UID:task-" + t.ID + "@uniwork")
	w("DTSTAMP:" + icsTime(now))
	w("DTSTART;VALUE=DATE:" + icsDate(start))
	w("DTEND;VALUE=DATE:" + icsDate(endExclusive))
	w("SUMMARY:" + icsEscape(t.Title))
	w("END:VEVENT")
}

func writeWorkspaceMeetingVEVENT(w func(string), m db.ListCalendarMeetingsInRangeRow, now time.Time) {
	w("BEGIN:VEVENT")
	w("UID:meeting-" + m.ID + "@uniwork")
	w("DTSTAMP:" + icsTime(now))
	w("DTSTART:" + icsTime(m.StartsAt.Time))
	w("DTEND:" + icsTime(m.EndsAt.Time))
	w("SUMMARY:" + icsEscape(m.Title))
	status := "CONFIRMED"
	if m.Status == MeetingCanceled {
		status = "CANCELLED"
	}
	w("STATUS:" + status)
	w("END:VEVENT")
}

func writeMeetingVEVENT(w func(string), uid, title, description, status string, starts, ends time.Time, version int32, joinURL string, now time.Time) {
	w("BEGIN:VEVENT")
	w("UID:" + uid)
	w("DTSTAMP:" + icsTime(now))
	w("DTSTART:" + icsTime(starts))
	w("DTEND:" + icsTime(ends))
	w("SUMMARY:" + icsEscape(title))
	desc := description
	if joinURL != "" {
		if desc != "" {
			desc += "\n\n"
		}
		desc += joinURL
		w("URL:" + joinURL)
	}
	if desc != "" {
		w("DESCRIPTION:" + icsEscape(desc))
	}
	icsStatus := "CONFIRMED"
	if status == MeetingCanceled {
		icsStatus = "CANCELLED"
	}
	w("STATUS:" + icsStatus)
	w(fmt.Sprintf("SEQUENCE:%d", version))
	w("END:VEVENT")
}
