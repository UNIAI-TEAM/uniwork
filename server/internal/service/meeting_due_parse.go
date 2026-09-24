package service

import (
	"strings"
	"time"
)

func parseMeetingDueSpoken(spoken string, anchor time.Time) *string {
	spoken = strings.TrimSpace(spoken)
	if spoken == "" {
		return nil
	}
	if t, err := time.Parse("2006-01-02", spoken); err == nil {
		s := t.Format("2006-01-02")
		return &s
	}
	if t, err := time.Parse("02/01/2006", spoken); err == nil {
		s := t.Format("2006-01-02")
		return &s
	}
	if anchor.IsZero() {
		anchor = time.Now().UTC()
	} else {
		anchor = anchor.UTC()
	}
	lower := normalizePersonName(spoken)

	if containsPhrase(lower, "ngay mai", "tomorrow") {
		return formatDatePtr(anchor.AddDate(0, 0, 1))
	}
	if containsPhrase(lower, "hom nay", "today") {
		return formatDatePtr(anchor)
	}
	if containsPhrase(lower, "tuan sau", "next week") {
		return formatDatePtr(anchor.AddDate(0, 0, 7))
	}
	if wd := parseWeekdayDue(lower, anchor); wd != nil {
		return wd
	}
	return nil
}

func containsPhrase(lower string, phrases ...string) bool {
	for _, p := range phrases {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}

func formatDatePtr(t time.Time) *string {
	s := t.Format("2006-01-02")
	return &s
}

func parseWeekdayDue(lower string, anchor time.Time) *string {
	type wdPhrase struct {
		phrase string
		day    time.Weekday
	}
	phrases := []wdPhrase{
		{"thu hai", time.Monday}, {"thu 2", time.Monday}, {"monday", time.Monday},
		{"thu ba", time.Tuesday}, {"thu 3", time.Tuesday}, {"tuesday", time.Tuesday},
		{"thu tu", time.Wednesday}, {"thu 4", time.Wednesday}, {"wednesday", time.Wednesday},
		{"thu nam", time.Thursday}, {"thu 5", time.Thursday}, {"thursday", time.Thursday},
		{"thu sau", time.Friday}, {"thu 6", time.Friday}, {"thu bay", time.Friday}, {"friday", time.Friday},
		{"chu nhat", time.Sunday}, {"cn", time.Sunday}, {"sunday", time.Sunday},
	}
	for _, p := range phrases {
		if strings.Contains(lower, p.phrase) {
			return nextWeekdayOnOrAfter(anchor, p.day)
		}
	}
	return nil
}

func nextWeekdayOnOrAfter(from time.Time, target time.Weekday) *string {
	d := time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.UTC)
	for i := 0; i < 7; i++ {
		candidate := d.AddDate(0, 0, i)
		if candidate.Weekday() == target {
			return formatDatePtr(candidate)
		}
	}
	return nil
}
