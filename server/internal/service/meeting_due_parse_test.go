package service

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestParseMeetingDueSpoken(t *testing.T) {
	vn := meetingLocation("Asia/Ho_Chi_Minh")
	anchor := time.Date(2026, 9, 3, 10, 0, 0, 0, vn) // Thursday 03/09/2026

	cases := []struct {
		in   string
		want string // "" means nil
	}{
		// Explicit dates.
		{"2026-09-10", "2026-09-10"},
		{"2026-09-03", "2026-09-03"},
		{"2026-09-01", ""}, // before the meeting
		{"Hạn 2026-09-15", "2026-09-15"},
		{"10/09/2026", "2026-09-10"},
		{"01/09/2026", ""},
		{"31/02/2027", ""},
		{"05/09", "2026-09-05"},
		{"5/9", "2026-09-05"},
		{"trước 15/9", "2026-09-15"},
		{"02/09", "2027-09-02"}, // already past this year: next year's
		{"03/09", "2026-09-03"},
		// Today, tomorrow and the day after.
		{"hôm nay", "2026-09-03"},
		{"today", "2026-09-03"},
		{"ngày mai", "2026-09-04"},
		{"NGÀY MAI", "2026-09-04"},
		{"tomorrow", "2026-09-04"},
		{"sáng mai", "2026-09-04"},
		{"mai", "2026-09-04"},
		{"ngày kia", "2026-09-05"},
		{"ngày mốt", "2026-09-05"},
		// Weekdays.
		{"thứ Sáu", "2026-09-04"},
		{"THỨ SÁU", "2026-09-04"},
		{"thu sau", "2026-09-04"},
		{"thứ 6", "2026-09-04"},
		{"T6", "2026-09-04"},
		{"Friday", "2026-09-04"},
		{"thứ Bảy", "2026-09-05"},
		{"thứ 7", "2026-09-05"},
		{"Saturday", "2026-09-05"},
		{"thứ Ba", "2026-09-08"},
		{"chủ nhật", "2026-09-06"},
		{"CN", "2026-09-06"},
		{"thứ Hai", "2026-09-07"},
		{"thứ Năm", "2026-09-10"}, // the meeting's own weekday: a week later
		{"Thursday", "2026-09-10"},
		{"thứ Tư", "2026-09-09"},
		{"thứ Sáu tuần sau", "2026-09-11"},
		{"thứ Năm tuần sau", "2026-09-10"},
		{"thứ Hai tuần tới", "2026-09-07"},
		{"chủ nhật tuần sau", "2026-09-13"},
		{"next week Friday", "2026-09-11"},
		{"Friday next week", "2026-09-11"},
		{"thứ Sáu tuần này", "2026-09-04"},
		{"thứ Năm tuần này", "2026-09-03"},
		{"thứ Hai tuần này", ""}, // already past
		// Weekend and end of month.
		{"cuối tuần", "2026-09-05"},
		{"cuối tuần này", "2026-09-05"},
		{"cuối tuần sau", "2026-09-12"},
		{"weekend", "2026-09-05"},
		{"cuối tháng", "2026-09-30"},
		{"cuối tháng sau", "2026-10-31"},
		{"end of month", "2026-09-30"},
		// Next week alone.
		{"tuần sau", "2026-09-10"},
		{"next week", "2026-09-10"},
		// Words that only look like weekdays.
		{"thủ tục", ""},
		{"xong thủ tục", ""},
		{"thứ 20", ""},
		{"thu 20", ""},
		{"sau buổi họp", ""},
		{"sometime soon", ""},
		{"", ""},
	}
	for _, tc := range cases {
		got := parseMeetingDueSpoken(tc.in, anchor)
		switch {
		case tc.want == "" && got != nil:
			t.Errorf("%q: got %s, want nil", tc.in, *got)
		case tc.want != "" && (got == nil || *got != tc.want):
			t.Errorf("%q: got %v, want %s", tc.in, got, tc.want)
		}
	}
}

func TestParseMeetingDueSpokenUsesTheAnchorsCalendarDay(t *testing.T) {
	vn := meetingLocation("Asia/Ho_Chi_Minh")
	// 23:30 UTC on Thursday is 06:30 Friday in Vietnam.
	anchor := time.Date(2026, 9, 3, 23, 30, 0, 0, time.UTC).In(vn)
	cases := map[string]string{
		"ngày mai": "2026-09-05",
		"hôm nay":  "2026-09-04",
		"thứ Sáu":  "2026-09-11",
		"thứ Bảy":  "2026-09-05",
		"04/09":    "2026-09-04",
	}
	for in, want := range cases {
		if got := parseMeetingDueSpoken(in, anchor); got == nil || *got != want {
			t.Errorf("%q: got %v, want %s", in, got, want)
		}
	}
}

// TestSpokenDueFromAnEarlyMeeting: "ngày mai" said at a meeting that ended at
// 06:30 Vietnam time (23:30 UTC the day before) is the next Vietnam day, not
// the day after the meeting's UTC date.
func TestSpokenDueFromAnEarlyMeeting(t *testing.T) {
	end := time.Date(2026, 9, 3, 23, 30, 0, 0, time.UTC)
	anchor := meetingDueAnchor(db.Meeting{EndsAt: pgtype.Timestamptz{Time: end, Valid: true}, Timezone: "Asia/Ho_Chi_Minh"})
	if got := parseMeetingDueSpoken("ngày mai", anchor); got == nil || *got != "2026-09-05" {
		t.Fatalf("ngày mai after an early meeting: %v", got)
	}
}

func TestParseMeetingDueSpokenSaturdayWeekend(t *testing.T) {
	vn := meetingLocation("")
	saturday := time.Date(2026, 9, 5, 9, 0, 0, 0, vn)
	if got := parseMeetingDueSpoken("cuối tuần", saturday); got == nil || *got != "2026-09-05" {
		t.Fatalf("cuối tuần on a Saturday: %v", got)
	}
	sunday := time.Date(2026, 9, 6, 9, 0, 0, 0, vn)
	// Never yesterday's Saturday: the next one.
	if got := parseMeetingDueSpoken("cuối tuần", sunday); got == nil || *got != "2026-09-12" {
		t.Fatalf("cuối tuần on a Sunday: %v", got)
	}
}
