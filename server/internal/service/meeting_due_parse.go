package service

import (
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// parseMeetingDueSpoken turns the due text an AI summary carried over from
// the meeting into a calendar date (YYYY-MM-DD), or nil when it cannot be read
// with confidence. Relative phrases count from anchor's calendar day in
// anchor's own location (see meetingDueAnchor), so a meeting that ends at
// 06:30 Vietnam time has "ngày mai" fall on the next Vietnam day.
//
// Understood, in this order:
//   - an explicit date: YYYY-MM-DD, DD/MM/YYYY, or DD/MM (this year's). A date
//     before the anchor day is refused: a task cannot be due in the past of
//     the meeting that created it. The one exception is the year boundary: a
//     DD/MM in January or February said at a December meeting is next year's.
//   - a weekday ("thứ Sáu", "thứ 6", "T6", "chủ nhật", "Friday"). On its own it
//     is the next such day after the anchor day, so the anchor's own weekday
//     means a week later. With "tuần sau" / "tuần tới" / "next week" it is that
//     day of the following Monday-based week; with "tuần này" / "this week" it
//     is that day of the anchor's week, and nil if already past.
//   - "cuối tuần" / "weekend" / "end of (this) week": the coming Saturday (the
//     anchor day itself on a Saturday, six days on from a Sunday), or the
//     Saturday of the following Monday-based week with "tuần sau" / "end of
//     next week".
//     Saturday is the last day many Vietnamese teams still work.
//   - "cuối tháng" / "end of month": the last day of the anchor's month, or of
//     the next month with "tháng sau".
//   - "ngày mai" / "tomorrow"; "ngày kia" / "ngày mốt" / "day after tomorrow";
//     "hôm nay" / "today".
//   - "tuần sau" / "next week" alone: seven days after the anchor day.
//
// Refused (nil) before any of the week rules: a past week ("tuần trước",
// "tuần rồi", "last week"), and a week phrase with a qualifier the rules do
// not model ("đầu/giữa/hết tuần sau", "tuần sau nữa", "early/mid/late next
// week", "beginning/middle of next week").
//
// Weekdays and phrases are matched on whole words, so "thủ tục" is not "thứ
// tư" and "thứ 20" is not "thứ 2".
func parseMeetingDueSpoken(spoken string, anchor time.Time) *string {
	spoken = strings.TrimSpace(spoken)
	if spoken == "" {
		return nil
	}
	if anchor.IsZero() {
		anchor = time.Now().In(meetingLocation(""))
	}
	day := civilDay(anchor)

	if d, ok := parseExplicitDate(strings.ToLower(spoken), day); ok {
		if d == nil || d.Before(day) {
			return nil
		}
		return formatDatePtr(*d)
	}

	tokens := strings.Fields(normalizePersonName(spoken))
	nextWeek := hasPhrase(tokens, "tuan sau") || hasPhrase(tokens, "tuan toi") || hasPhrase(tokens, "next week")
	thisWeek := hasPhrase(tokens, "tuan nay") || hasPhrase(tokens, "this week")
	if namesPastWeek(tokens) || hasUnmodelledWeekQualifier(tokens) {
		return nil
	}

	if wd, ok := findWeekday(tokens); ok {
		switch {
		case nextWeek:
			return formatDatePtr(weekdayOfWeek(mondayOf(day).AddDate(0, 0, 7), wd))
		case thisWeek:
			d := weekdayOfWeek(mondayOf(day), wd)
			if d.Before(day) {
				return nil
			}
			return formatDatePtr(d)
		default:
			return formatDatePtr(nextWeekdayAfter(day, wd))
		}
	}
	if hasPhrase(tokens, "cuoi tuan") || hasPhrase(tokens, "weekend") || hasPhrase(tokens, "end of week") ||
		hasPhrase(tokens, "end of the week") || hasPhrase(tokens, "end of this week") ||
		hasPhrase(tokens, "end of next week") || hasPhrase(tokens, "end of the next week") {
		if nextWeek {
			return formatDatePtr(weekdayOfWeek(mondayOf(day).AddDate(0, 0, 7), time.Saturday))
		}
		return formatDatePtr(nextWeekdayOnOrAfter(day, time.Saturday))
	}
	if hasPhrase(tokens, "cuoi thang") || hasPhrase(tokens, "end of month") || hasPhrase(tokens, "end of the month") {
		months := 0
		if hasPhrase(tokens, "thang sau") || hasPhrase(tokens, "thang toi") || hasPhrase(tokens, "next month") {
			months = 1
		}
		first := time.Date(day.Year(), day.Month()+time.Month(months), 1, 0, 0, 0, 0, day.Location())
		return formatDatePtr(first.AddDate(0, 1, -1))
	}
	if hasPhrase(tokens, "ngay kia") || hasPhrase(tokens, "ngay mot") || hasPhrase(tokens, "day after tomorrow") {
		return formatDatePtr(day.AddDate(0, 0, 2))
	}
	if hasPhrase(tokens, "ngay mai") || hasPhrase(tokens, "tomorrow") || isTomorrowShort(tokens) {
		return formatDatePtr(day.AddDate(0, 0, 1))
	}
	if hasPhrase(tokens, "hom nay") || hasPhrase(tokens, "today") || hasPhrase(tokens, "trong ngay") {
		return formatDatePtr(day)
	}
	if nextWeek {
		return formatDatePtr(day.AddDate(0, 0, 7))
	}
	return nil
}

var (
	isoDateRe   = regexp.MustCompile(`(?:^|[^0-9])(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[^0-9])`)
	slashDateRe = regexp.MustCompile(`(?:^|[^0-9/])(\d{1,2})/(\d{1,2})(?:/(\d{4}))?(?:$|[^0-9/])`)
)

// parseExplicitDate finds a written date in s. ok reports that s contains
// one; d is nil when that date does not exist (31/02).
func parseExplicitDate(s string, day time.Time) (d *time.Time, ok bool) {
	if m := isoDateRe.FindStringSubmatch(s); m != nil {
		return civilDate(atoi(m[1]), atoi(m[2]), atoi(m[3]), day.Location()), true
	}
	if m := slashDateRe.FindStringSubmatch(s); m != nil {
		dd, mm := atoi(m[1]), atoi(m[2])
		if m[3] != "" {
			return civilDate(atoi(m[3]), mm, dd, day.Location()), true
		}
		// No year: this year's date when it is on or after the anchor day.
		// One before it is refused like a full date in the past (a meeting
		// that ran past midnight saying "hạn 15/10" must not get next year's
		// 15/10), except across the year boundary: at a December meeting a
		// January or February date is next year's. A 29/02 the chosen year
		// lacks stays nil.
		if c := civilDate(day.Year(), mm, dd, day.Location()); c != nil && !c.Before(day) {
			return c, true
		}
		if day.Month() == time.December && (mm == 1 || mm == 2) {
			return civilDate(day.Year()+1, mm, dd, day.Location()), true
		}
		return nil, true
	}
	return nil, false
}

func atoi(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		return -1
	}
	return n
}

// civilDate builds a calendar day, refusing one that time.Date would roll
// over (31/02 -> 03/03).
func civilDate(year, month, dayOfMonth int, loc *time.Location) *time.Time {
	if month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31 {
		return nil
	}
	t := time.Date(year, time.Month(month), dayOfMonth, 0, 0, 0, 0, loc)
	if t.Year() != year || int(t.Month()) != month || t.Day() != dayOfMonth {
		return nil
	}
	return &t
}

// civilDay is midnight of t's calendar day in t's own location.
func civilDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

// mondayOf is the Monday that starts day's week.
func mondayOf(day time.Time) time.Time {
	offset := (int(day.Weekday()) + 6) % 7 // Monday = 0 ... Sunday = 6
	return day.AddDate(0, 0, -offset)
}

// weekdayOfWeek is wd within the Monday-based week starting at monday.
func weekdayOfWeek(monday time.Time, wd time.Weekday) time.Time {
	return monday.AddDate(0, 0, (int(wd)+6)%7)
}

// nextWeekdayOnOrAfter is the first wd on or after day.
func nextWeekdayOnOrAfter(day time.Time, wd time.Weekday) time.Time {
	return day.AddDate(0, 0, (int(wd)-int(day.Weekday())+7)%7)
}

// nextWeekdayAfter is the first wd strictly after day.
func nextWeekdayAfter(day time.Time, wd time.Weekday) time.Time {
	diff := (int(wd) - int(day.Weekday()) + 7) % 7
	if diff == 0 {
		diff = 7
	}
	return day.AddDate(0, 0, diff)
}

// vietnameseWeekdays maps the word after "thứ" to its day.
var vietnameseWeekdays = map[string]time.Weekday{
	"hai": time.Monday, "2": time.Monday,
	"ba": time.Tuesday, "3": time.Tuesday,
	"tu": time.Wednesday, "4": time.Wednesday,
	"nam": time.Thursday, "5": time.Thursday,
	"sau": time.Friday, "6": time.Friday,
	"bay": time.Saturday, "7": time.Saturday,
}

// singleWordWeekdays are weekdays written as one word.
var singleWordWeekdays = map[string]time.Weekday{
	"t2": time.Monday, "t3": time.Tuesday, "t4": time.Wednesday,
	"t5": time.Thursday, "t6": time.Friday, "t7": time.Saturday, "cn": time.Sunday,
	"monday": time.Monday, "tuesday": time.Tuesday, "wednesday": time.Wednesday,
	"thursday": time.Thursday, "friday": time.Friday, "saturday": time.Saturday,
	"sunday": time.Sunday,
}

// findWeekday returns the first weekday named in tokens.
func findWeekday(tokens []string) (time.Weekday, bool) {
	for i, tok := range tokens {
		if tok == "thu" && i+1 < len(tokens) {
			if wd, ok := vietnameseWeekdays[tokens[i+1]]; ok {
				return wd, true
			}
		}
		if tok == "chu" && i+1 < len(tokens) && tokens[i+1] == "nhat" {
			return time.Sunday, true
		}
		if wd, ok := singleWordWeekdays[tok]; ok {
			return wd, true
		}
	}
	return 0, false
}

// namesPastWeek reports a phrase naming a week already gone ("tuần trước",
// "cuối tuần rồi", "last week"): no due date can be read from it.
func namesPastWeek(tokens []string) bool {
	for _, p := range []string{"tuan truoc", "tuan roi", "last week", "previous week", "past week"} {
		if hasPhrase(tokens, p) {
			return true
		}
	}
	return false
}

// weekPhrases name a week relative to the anchor.
var weekPhrases = []string{"tuan sau", "tuan toi", "tuan nay", "next week", "this week"}

// weekQualifiersBefore shift a week phrase they precede ("đầu tuần sau",
// "middle of next week") to a part of the week the parser does not model.
var weekQualifiersBefore = map[string]struct{}{
	"dau": {}, "giua": {}, "het": {},
	"early": {}, "late": {}, "mid": {}, "middle": {}, "beginning": {}, "start": {},
}

// hasUnmodelledWeekQualifier reports a week phrase with a qualifier the
// parser does not model: one of weekQualifiersBefore before it (skipping an
// English "of" / "of the"), or "nữa" after it ("tuần sau nữa", the week after
// next). Such text is refused rather than read as the plain week. "cuối tuần
// sau" and "end of next week" are modelled and handled by the weekend rule.
func hasUnmodelledWeekQualifier(tokens []string) bool {
	for i := 0; i+1 < len(tokens); i++ {
		if !slices.Contains(weekPhrases, tokens[i]+" "+tokens[i+1]) {
			continue
		}
		if i+2 < len(tokens) && tokens[i+2] == "nua" {
			return true
		}
		j := i - 1
		if j >= 0 && tokens[j] == "the" {
			j--
		}
		if j >= 0 && tokens[j] == "of" {
			j--
		}
		if j >= 0 {
			if _, ok := weekQualifiersBefore[tokens[j]]; ok {
				return true
			}
		}
	}
	return false
}

// isTomorrowShort accepts "mai" said alone or after a part of the day
// ("sáng mai", "chiều mai"), where it can only mean tomorrow.
func isTomorrowShort(tokens []string) bool {
	if len(tokens) == 1 && tokens[0] == "mai" {
		return true
	}
	for _, part := range []string{"sang", "trua", "chieu", "toi"} {
		if hasPhrase(tokens, part+" mai") {
			return true
		}
	}
	return false
}

// hasPhrase reports whether the words of phrase appear consecutively in
// tokens.
func hasPhrase(tokens []string, phrase string) bool {
	words := strings.Fields(phrase)
	if len(words) == 0 || len(words) > len(tokens) {
		return false
	}
	for i := 0; i+len(words) <= len(tokens); i++ {
		match := true
		for j, w := range words {
			if tokens[i+j] != w {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

func formatDatePtr(t time.Time) *string {
	s := t.Format("2006-01-02")
	return &s
}
