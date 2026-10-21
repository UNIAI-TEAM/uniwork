package service

import (
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

var updateMinutes = flag.Bool("update-minutes", false, "rewrite the minutes snapshots")

func fullMinutesFacts() minutesFacts {
	met := true
	return minutesFacts{
		Title: "Giao ban *tuần* 42", Date: "20/10/2026", Start: "09:00", End: "10:15", Zone: "GMT+7",
		Host: "Nguyễn An", Secretaries: []string{"Trần Bình"},
		Attendance: &ai.AttendanceFacts{
			Members: 4, Present: 2, Late: 1, Excused: 1, QuorumPercent: 60, QuorumMet: &met, Finalized: true,
			NamesByStatus: map[string][]string{
				AttendancePresent: {"Nguyễn An", "Trần Bình"}, AttendanceLate: {"Lê Chi"}, AttendanceExcused: {"Phạm Dũng"},
			},
		},
		Invited: []string{"should not show"},
		Motions: []ai.MotionFact{
			{Title: "Duyệt ngân sách | quý 4", BallotMode: "SECRET", Yes: 3, No: 0, Abstain: 0, Outcome: OutcomePassed},
			{Title: "Đổi giờ họp", BallotMode: "PUBLIC", Yes: 1, No: 2, Abstain: 0, Outcome: OutcomeFailed},
		},
		Assigned: []minutesTask{
			{Title: "Gửi báo cáo", Assignee: "Lê Chi", Due: "24/10/2026"},
			{Title: "Đặt phòng"},
		},
		Author: "Trần Bình", CreatedOn: "20/10/2026",
	}
}

func fullMinutesNarrative() minutesNarrative {
	return minutesNarrative{
		Summary: "Nhóm rà tiến độ quý 4 và chốt ngân sách.",
		Decisions: []minutesDecision{
			{Text: "Chốt ngân sách quý 4", At: []string{"09:05", "10:01"}},
			{Text: "Họp lại\nthứ Sáu"},
		},
	}
}

// TestRenderMinutes snapshots the five cases of spec §13.1 đợt 7 (the
// "partial" summary case waits for the column of §7.8) and English.
func TestRenderMinutes(t *testing.T) {
	noRoll := fullMinutesFacts()
	noRoll.Attendance = nil
	noRoll.Invited = []string{"Nguyễn An", "Trần Bình", "Lê Chi"}
	noVotes := fullMinutesFacts()
	noVotes.Motions = nil
	bare := fullMinutesFacts()
	// Made on a later day: the footer then says when.
	bare.Secretaries, bare.Assigned, bare.End, bare.CreatedOn = nil, nil, "", "22/10/2026"
	cases := map[string]struct {
		facts minutesFacts
		narr  minutesNarrative
		lang  string
	}{
		"full":       {fullMinutesFacts(), fullMinutesNarrative(), "vi"},
		"no_roll":    {noRoll, fullMinutesNarrative(), "vi"},
		"no_votes":   {noVotes, fullMinutesNarrative(), "vi"},
		"no_summary": {bare, minutesNarrative{}, "vi"},
		"en":         {fullMinutesFacts(), fullMinutesNarrative(), "en"},
		// A summary cannot pose as a fact section: headings, table rows and
		// setext underlines become text; its emphasis and lists stay.
		"hostile_narrative": {bare, minutesNarrative{
			Summary:   "Mở đầu *gọn*.\n## Thành phần\n| Có mặt | 10/10 |\nĐủ số lượng\n---\n- một ý",
			Decisions: []minutesDecision{{Text: "# Kết quả biểu quyết"}},
		}, "vi"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			got := renderMinutes(c.facts, c.narr, minutesLayoutFor(c.lang))
			path := filepath.Join("testdata", "minutes_"+name+".golden.md")
			if *updateMinutes {
				if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			want, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("%v (run with -update-minutes)", err)
			}
			if got != string(want) {
				t.Errorf("minutes %s differ from %s:\n%s", name, path, got)
			}
		})
	}
}

func TestRenderMinutesStatesOnlyFacts(t *testing.T) {
	md := renderMinutes(fullMinutesFacts(), fullMinutesNarrative(), minutesLayoutFor("vi"))
	for _, absent := range []string{"Hình thức", "Địa điểm", "trực tuyến", "should not show"} {
		if strings.Contains(md, absent) {
			t.Errorf("minutes carry %q:\n%s", absent, md)
		}
	}
	// A secret ballot shows counts, never who voted.
	if !strings.Contains(md, "Duyệt ngân sách \\| quý 4 (phiếu kín) | 3 | 0 | 0 | Thông qua |") {
		t.Errorf("secret vote row missing:\n%s", md)
	}
	if got := minutesLayoutFor("fr").TitlePrefix; got != "Biên bản" {
		t.Errorf("unknown locale layout = %q", got)
	}
}

func TestGMTOffset(t *testing.T) {
	at := time.Date(2026, 10, 21, 9, 0, 0, 0, time.UTC)
	for zone, want := range map[*time.Location]string{
		time.FixedZone("ICT", 7*3600):           "GMT+7",
		time.FixedZone("IST", 5*3600+30*60):     "GMT+5:30",
		time.FixedZone("BRT", -3*3600):          "GMT-3",
		time.FixedZone("NDT", -(2*3600 + 1800)): "GMT-2:30",
		time.UTC:                                "GMT+0",
	} {
		if got := gmtOffset(at.In(zone)); got != want {
			t.Errorf("gmtOffset(%s) = %q, want %q", zone, got, want)
		}
	}
}

func TestMinutesTitleFitsTheDocumentTitleCap(t *testing.T) {
	f := fullMinutesFacts()
	f.Title = strings.Repeat("ạ", 600)
	got := []rune(minutesTitle(minutesLayoutFor("vi"), f))
	if len(got) != maxDocumentTitle {
		t.Fatalf("title has %d runes, want %d", len(got), maxDocumentTitle)
	}
	if !strings.HasPrefix(string(got), "Biên bản: ạạ") || !strings.HasSuffix(string(got), "ạ… (20/10/2026)") {
		t.Fatalf("title = %q…%q", string(got[:14]), string(got[len(got)-16:]))
	}
	if short := minutesTitle(minutesLayoutFor("en"), fullMinutesFacts()); short != "Minutes: Giao ban *tuần* 42 (20/10/2026)" {
		t.Fatalf("short title = %q", short)
	}
}
