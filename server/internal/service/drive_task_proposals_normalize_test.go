package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

func TestNormalizeDriveProposalItems(t *testing.T) {
	strPtr := func(s string) *string { return &s }

	members := map[string]bool{
		"mem-lan":  true,
		"mem-minh": true,
	}
	labels := map[string]bool{
		"lbl-prod": true,
		"lbl-beta": true,
	}

	longQuote := strings.Repeat("Đoạn trích tiếng Việt ", 20) // > 300 runes
	if utf8.RuneCountInString(longQuote) <= 300 {
		t.Fatalf("expected longQuote > 300 runes, got %d", utf8.RuneCountInString(longQuote))
	}
	wantQuote300 := string([]rune(strings.TrimSpace(longQuote))[:300])

	twelveSteps := []string{
		"Bước 1", "Bước 2", "Bước 3", "Bước 4", "Bước 5",
		"Bước 6", "Bước 7", "Bước 8", "Bước 9", "Bước 10",
		"Bước 11", "Bước 12",
	}

	tests := []struct {
		name  string
		raw   []driveProposalRawItem
		check func(t *testing.T, got []DriveTaskProposalItem)
	}{
		{
			name: "valid fields kept and normalized",
			raw: []driveProposalRawItem{
				{
					Title:            "  Chốt phạm vi beta  ",
					AssigneeMemberID: "mem-lan",
					AssigneeBasis:    `Mục 2: "Lan phụ trách"`,
					Priority:         "HIGH",
					PriorityBasis:    "Cần hoàn thành trước mốc beta",
					StartDate:        "2026-10-28",
					StartBasis:       "Sau họp mở màn",
					DueDate:          "2026-11-05",
					DueBasis:         `Mục 2: "trước 05/11"`,
					LabelIDs:         []string{"lbl-prod", "lbl-beta"},
					LabelBasis:       "Nhóm sản phẩm",
					Goal:             "  Chốt danh sách tính năng beta. ",
					Checklist:        []string{" Liệt kê tính năng ", "Họp chốt"},
					Excerpt: driveProposalRawExcerpt{
						Section: " Mục 2 ",
						Quote:   " Nhóm sản phẩm chốt phạm vi beta trước ngày 05/11. ",
					},
					BlockedByIndexes: nil,
				},
			},
			check: func(t *testing.T, got []DriveTaskProposalItem) {
				if len(got) != 1 {
					t.Fatalf("len(got) = %d, want 1", len(got))
				}
				it := got[0]
				if it.Index != 0 || it.Title != "Chốt phạm vi beta" {
					t.Fatalf("unexpected index/title: %+v", it)
				}
				if it.AssigneeMemberID == nil || *it.AssigneeMemberID != "mem-lan" || it.AssigneeBasis != `Mục 2: "Lan phụ trách"` {
					t.Fatalf("unexpected assignee: id=%v basis=%q", it.AssigneeMemberID, it.AssigneeBasis)
				}
				if it.Priority != "high" || it.PriorityBasis != "Cần hoàn thành trước mốc beta" {
					t.Fatalf("unexpected priority: %q basis=%q", it.Priority, it.PriorityBasis)
				}
				if it.StartDate == nil || *it.StartDate != "2026-10-28" || it.StartBasis != "Sau họp mở màn" {
					t.Fatalf("unexpected start_date: %v basis=%q", it.StartDate, it.StartBasis)
				}
				if it.DueDate == nil || *it.DueDate != "2026-11-05" || it.DueBasis != `Mục 2: "trước 05/11"` {
					t.Fatalf("unexpected due_date: %v basis=%q", it.DueDate, it.DueBasis)
				}
				if !reflect.DeepEqual(it.LabelIDs, []string{"lbl-prod", "lbl-beta"}) || it.LabelBasis != "Nhóm sản phẩm" {
					t.Fatalf("unexpected labels: %v basis=%q", it.LabelIDs, it.LabelBasis)
				}
				if it.BlockedByIndexes == nil || len(it.BlockedByIndexes) != 0 {
					t.Fatalf("expected non-nil empty BlockedByIndexes, got %#v", it.BlockedByIndexes)
				}
			},
		},
		{
			name: "unknown member and label ids dropped and basis cleared",
			raw: []driveProposalRawItem{
				{
					Title:            "Soạn tài liệu hướng dẫn",
					AssigneeMemberID: "mem-stranger",
					AssigneeBasis:    "Tài liệu nhắc tên người ngoài workspace",
					LabelIDs:         []string{"lbl-unknown-1", "lbl-unknown-2"},
					LabelBasis:       "Nhãn không tồn tại",
				},
				{
					Title:            "Kiểm thử tích hợp",
					AssigneeMemberID: "",
					AssigneeBasis:    "Căn cứ dư thừa khi không có người phụ trách",
					LabelIDs:         []string{"lbl-unknown", "lbl-prod", "lbl-prod"},
					LabelBasis:       "Giữ căn cứ vì còn 1 nhãn hợp lệ",
				},
			},
			check: func(t *testing.T, got []DriveTaskProposalItem) {
				if len(got) != 2 {
					t.Fatalf("len(got) = %d, want 2", len(got))
				}
				if got[0].AssigneeMemberID != nil || got[0].AssigneeBasis != "" {
					t.Errorf("item 0 assignee should be dropped and basis cleared: id=%v basis=%q", got[0].AssigneeMemberID, got[0].AssigneeBasis)
				}
				if len(got[0].LabelIDs) != 0 || got[0].LabelIDs == nil || got[0].LabelBasis != "" {
					t.Errorf("item 0 labels should be empty slice and basis cleared: ids=%#v basis=%q", got[0].LabelIDs, got[0].LabelBasis)
				}
				if got[1].AssigneeMemberID != nil || got[1].AssigneeBasis != "" {
					t.Errorf("item 1 empty assignee must clear basis: id=%v basis=%q", got[1].AssigneeMemberID, got[1].AssigneeBasis)
				}
				if !reflect.DeepEqual(got[1].LabelIDs, []string{"lbl-prod"}) || got[1].LabelBasis != "Giữ căn cứ vì còn 1 nhãn hợp lệ" {
					t.Errorf("item 1 labels = %v (basis %q), want [lbl-prod] with basis", got[1].LabelIDs, got[1].LabelBasis)
				}
			},
		},
		{
			name: "missing, invalid, or past start_date filled with today and default basis; today or future start kept with model basis; due_date < start_date dropped and due_date == start_date kept; priority without basis or invalid dropped",
			raw: []driveProposalRawItem{
				{
					Title:         "Việc có ngày và độ ưu tiên sai định dạng",
					Priority:      "critical",
					PriorityBasis: "Độ ưu tiên ngoài tập cho phép",
					StartDate:     "27/10/2026",
					StartBasis:    "Sai định dạng ngày bắt đầu",
					DueDate:       "2026-02-30",
					DueBasis:      "Ngày không tồn tại trên lịch",
				},
				{
					Title:         "Việc không có ngày bắt đầu và hạn trước hôm nay",
					Priority:      "medium",
					PriorityBasis: "   ",
					StartDate:     "",
					StartBasis:    "",
					DueDate:       "2026-10-20",
					DueBasis:      "Hạn cũ trong tài liệu",
				},
				{
					Title:         "Việc có ngày bắt đầu trong quá khứ và hạn bằng hôm nay",
					Priority:      "urgent",
					PriorityBasis: `Tài liệu ghi "gấp"`,
					StartDate:     "2026-09-07",
					StartBasis:    "Cột ngày bắt đầu ghi 07/09",
					DueDate:       "2026-10-27",
					DueBasis:      "Chốt trong hôm nay 27/10",
				},
				{
					Title:      "Việc bắt đầu trong tương lai nhưng hạn trước ngày bắt đầu",
					StartDate:  "2026-11-10",
					StartBasis: "Bắt đầu ngày 10/11",
					DueDate:    "2026-11-05",
					DueBasis:   "Hạn 05/11 trước ngày bắt đầu",
				},
				{
					Title:      "Việc bắt đầu đúng hôm nay giữ nguyên căn cứ từ tài liệu",
					StartDate:  "2026-10-27",
					StartBasis: `Mục 1: "Khởi động ngay hôm nay 27/10"`,
					DueDate:    "2026-10-30",
					DueBasis:   "Hoàn tất trước 30/10",
				},
			},
			check: func(t *testing.T, got []DriveTaskProposalItem) {
				if len(got) != 5 {
					t.Fatalf("len(got) = %d, want 5", len(got))
				}
				wantBasis := "Không thấy ngày bắt đầu trong tài liệu, đặt hôm nay"
				// Item 0: invalid priority -> empty; invalid start_date -> today + default basis; invalid due_date -> nil.
				it0 := got[0]
				if it0.Priority != "" || it0.PriorityBasis != "" {
					t.Errorf("invalid priority must clear priority and basis: %q / %q", it0.Priority, it0.PriorityBasis)
				}
				if it0.StartDate == nil || *it0.StartDate != "2026-10-27" || it0.StartBasis != wantBasis {
					t.Errorf("invalid start_date must fill today and default basis: %v / %q", it0.StartDate, it0.StartBasis)
				}
				if it0.DueDate != nil || it0.DueBasis != "" {
					t.Errorf("invalid due_date must clear date and basis: %v / %q", it0.DueDate, it0.DueBasis)
				}
				// Item 1: priority without basis -> dropped; missing start_date -> today + default basis; due_date < start_date (after fill) -> dropped + basis cleared.
				it1 := got[1]
				if it1.Priority != "" || it1.PriorityBasis != "" {
					t.Errorf("priority without basis must be dropped: %q / %q", it1.Priority, it1.PriorityBasis)
				}
				if it1.StartDate == nil || *it1.StartDate != "2026-10-27" || it1.StartBasis != wantBasis {
					t.Errorf("missing start_date must fill today and default basis: %v / %q", it1.StartDate, it1.StartBasis)
				}
				if it1.DueDate != nil || it1.DueBasis != "" {
					t.Errorf("due_date before filled start_date must be dropped and basis cleared: %v / %q", it1.DueDate, it1.DueBasis)
				}
				// Item 2: priority with basis -> kept; past start_date -> today + default basis; due_date == start_date -> kept with basis.
				it2 := got[2]
				if it2.Priority != "urgent" || it2.PriorityBasis != `Tài liệu ghi "gấp"` {
					t.Errorf("priority with basis = %q / %q, want urgent with basis", it2.Priority, it2.PriorityBasis)
				}
				if it2.StartDate == nil || *it2.StartDate != "2026-10-27" || it2.StartBasis != wantBasis {
					t.Errorf("past start_date must fill today and default basis: %v / %q", it2.StartDate, it2.StartBasis)
				}
				if it2.DueDate == nil || *it2.DueDate != "2026-10-27" || it2.DueBasis != "Chốt trong hôm nay 27/10" {
					t.Errorf("due_date == start_date must be kept: %v / %q", it2.DueDate, it2.DueBasis)
				}
				// Item 3: future start_date -> kept with model basis; due_date < future start_date -> dropped + basis cleared.
				it3 := got[3]
				if it3.StartDate == nil || *it3.StartDate != "2026-11-10" || it3.StartBasis != "Bắt đầu ngày 10/11" {
					t.Errorf("future start_date = %v / %q, want 2026-11-10 with model basis", it3.StartDate, it3.StartBasis)
				}
				if it3.DueDate != nil || it3.DueBasis != "" {
					t.Errorf("due_date < future start_date must be dropped: %v / %q", it3.DueDate, it3.DueBasis)
				}
				// Item 4: start_date == today -> kept with the model's start_basis (not DriveProposalDefaultStartBasis).
				it4 := got[4]
				if it4.StartDate == nil || *it4.StartDate != "2026-10-27" || it4.StartBasis != `Mục 1: "Khởi động ngay hôm nay 27/10"` {
					t.Errorf("start_date == today = %v / %q, want 2026-10-27 with model start_basis", it4.StartDate, it4.StartBasis)
				}
				if it4.DueDate == nil || *it4.DueDate != "2026-10-30" || it4.DueBasis != "Hoàn tất trước 30/10" {
					t.Errorf("item 4 due_date = %v / %q, want 2026-10-30 with basis", it4.DueDate, it4.DueBasis)
				}
			},
		},
		{
			name: "empty title items dropped before assigning dense 0-based indexes and translating blocked_by_indexes",
			raw: []driveProposalRawItem{
				{Title: "   "},
				{Title: "Việc đầu tiên", AssigneeMemberID: "mem-minh", AssigneeBasis: "Minh"},
				{Title: ""},
				{Title: "Việc thứ hai", BlockedByIndexes: []int{1}},
			},
			check: func(t *testing.T, got []DriveTaskProposalItem) {
				if len(got) != 2 {
					t.Fatalf("len(got) = %d, want 2", len(got))
				}
				if got[0].Index != 0 || got[0].Title != "Việc đầu tiên" || !reflect.DeepEqual(got[0].AssigneeMemberID, strPtr("mem-minh")) {
					t.Errorf("got[0] = %+v", got[0])
				}
				if got[1].Index != 1 || got[1].Title != "Việc thứ hai" || !reflect.DeepEqual(got[1].BlockedByIndexes, []int{0}) {
					t.Errorf("got[1] = %+v, want Index=1 Title=%q BlockedByIndexes=[0]", got[1], "Việc thứ hai")
				}
			},
		},
		{
			name: "reference to dropped blank item disappears and shifted targets remap accurately",
			raw: []driveProposalRawItem{
				{Title: "  "},
				{Title: "Task A"},
				{Title: "Task B", BlockedByIndexes: []int{1}},
			},
			check: func(t *testing.T, got []DriveTaskProposalItem) {
				if len(got) != 2 {
					t.Fatalf("len(got) = %d, want 2", len(got))
				}
				if got[0].Index != 0 || got[0].Title != "Task A" || !reflect.DeepEqual(got[0].BlockedByIndexes, []int{}) {
					t.Errorf("Task A = %+v, want Index=0 BlockedByIndexes=[]", got[0])
				}
				if got[1].Index != 1 || got[1].Title != "Task B" || !reflect.DeepEqual(got[1].BlockedByIndexes, []int{0}) {
					t.Errorf("Task B = %+v, want Index=1 BlockedByIndexes=[0] (raw 1 -> dense 0)", got[1])
				}

				// Subcase 2: [A(blocked by raw 1), blank, B] -> A must have [] (raw 1 was dropped, not B)
				got2 := normalizeDriveProposalItems([]driveProposalRawItem{
					{Title: "Task A", BlockedByIndexes: []int{1}},
					{Title: ""},
					{Title: "Task B"},
				}, members, labels, "2026-10-27")
				if len(got2) != 2 || got2[0].Title != "Task A" || !reflect.DeepEqual(got2[0].BlockedByIndexes, []int{}) {
					t.Errorf("subcase 2: Task A = %+v, want BlockedByIndexes=[] (target raw 1 was dropped)", got2)
				}

				// Subcase 3: [blank, A, B, C(blocked by raw 1)] -> C must point to [0] (Task A), not [1] (Task B)
				got3 := normalizeDriveProposalItems([]driveProposalRawItem{
					{Title: " "},
					{Title: "Task A"},
					{Title: "Task B"},
					{Title: "Task C", BlockedByIndexes: []int{1}},
				}, members, labels, "2026-10-27")
				if len(got3) != 3 || got3[2].Title != "Task C" || !reflect.DeepEqual(got3[2].BlockedByIndexes, []int{0}) {
					t.Errorf("subcase 3: Task C = %+v, want BlockedByIndexes=[0] (Task A)", got3)
				}
			},
		},
		{
			name: "caps at 20 kept items with interspersed blanks and drops dependencies on discarded items",
			raw: func() []driveProposalRawItem {
				var items []driveProposalRawItem
				// Raw 0: blank
				items = append(items, driveProposalRawItem{Title: "   "})
				// Add 22 non-empty tasks with another blank after the 5th task.
				for k := 1; k <= 22; k++ {
					if k == 6 {
						items = append(items, driveProposalRawItem{Title: ""})
					}
					var deps []int
					switch k {
					case 2:
						// Depends on raw 1 (Task 1 -> dense 0) and raw 0 (blank -> dropped)
						deps = []int{0, 1}
					case 20:
						// Depends on raw 6 (blank -> dropped), raw 7 (Task 6 -> dense 5),
						// and raw 22 (Task 21, capped out -> dropped)
						deps = []int{6, 7, 22, 23}
					}
					items = append(items, driveProposalRawItem{
						Title:            fmt.Sprintf("Task %d", k),
						BlockedByIndexes: deps,
					})
				}
				return items
			}(),
			check: func(t *testing.T, got []DriveTaskProposalItem) {
				if len(got) != 20 {
					t.Fatalf("len(got) = %d, want 20", len(got))
				}
				for i, it := range got {
					wantTitle := fmt.Sprintf("Task %d", i+1)
					if it.Index != i || it.Title != wantTitle {
						t.Fatalf("got[%d] = {Index:%d Title:%q}, want {Index:%d Title:%q}", i, it.Index, it.Title, i, wantTitle)
					}
					for _, dep := range it.BlockedByIndexes {
						if dep < 0 || dep >= 20 {
							t.Fatalf("got[%d] has out-of-bounds dependency %d", i, dep)
						}
					}
				}
				if !reflect.DeepEqual(got[1].BlockedByIndexes, []int{0}) {
					t.Errorf("got[1].BlockedByIndexes = %v, want [0]", got[1].BlockedByIndexes)
				}
				if !reflect.DeepEqual(got[19].BlockedByIndexes, []int{5}) {
					t.Errorf("got[19].BlockedByIndexes = %v, want [5] (dependencies on blank and past-cap items dropped)", got[19].BlockedByIndexes)
				}
			},
		},
		{
			name: "blocked_by_indexes removes out of range, self, duplicates, and cycles",
			raw: []driveProposalRawItem{
				{
					Title:            "Việc 0",
					BlockedByIndexes: []int{-1, 0, 99, 1, 1}, // -1 and 99 out of range, 0 self, duplicate 1 -> [1]
				},
				{
					Title:            "Việc 1",
					BlockedByIndexes: []int{0, 2}, // 0 closes 0->1->0 cycle (removed), 2 kept -> [2]
				},
				{
					Title:            "Việc 2",
					BlockedByIndexes: []int{0, 1, 2}, // 0 closes 0->1->2->0 cycle, 1 closes 1->2->1 cycle, 2 is self -> []
				},
				{
					Title:            "Việc 3",
					BlockedByIndexes: []int{1, 2}, // diamond DAG to 2: both valid -> [1, 2]
				},
			},
			check: func(t *testing.T, got []DriveTaskProposalItem) {
				if len(got) != 4 {
					t.Fatalf("len(got) = %d, want 4", len(got))
				}
				want := [][]int{
					{1},
					{2},
					{},
					{1, 2},
				}
				for i := range want {
					if !reflect.DeepEqual(got[i].BlockedByIndexes, want[i]) {
						t.Errorf("item %d BlockedByIndexes = %v, want %v", i, got[i].BlockedByIndexes, want[i])
					}
				}
			},
		},
		{
			name: "quote truncated to 300 runes and checklist capped at 10 items",
			raw: []driveProposalRawItem{
				{
					Title:     "Kiểm tra giới hạn trích đoạn và checklist",
					Checklist: twelveSteps,
					Excerpt: driveProposalRawExcerpt{
						Section: "Mục 4",
						Quote:   longQuote,
					},
				},
			},
			check: func(t *testing.T, got []DriveTaskProposalItem) {
				if len(got) != 1 {
					t.Fatalf("len(got) = %d, want 1", len(got))
				}
				it := got[0]
				if len(it.Checklist) != 10 || !reflect.DeepEqual(it.Checklist, twelveSteps[:10]) {
					t.Errorf("checklist len = %d (%v), want first 10 items", len(it.Checklist), it.Checklist)
				}
				if utf8.RuneCountInString(it.Excerpt.Quote) != 300 || it.Excerpt.Quote != wantQuote300 {
					t.Errorf("quote rune count = %d, want 300", utf8.RuneCountInString(it.Excerpt.Quote))
				}
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := normalizeDriveProposalItems(tc.raw, members, labels, "2026-10-27")
			tc.check(t, got)
		})
	}
}

func TestParseDriveProposalRawItems(t *testing.T) {
	nominal := `{"items":[{"title":"Việc A","assignee_member_id":"mem-lan","assignee_basis":"Mục 1","priority":"high","priority_basis":"Gấp","start_date":"2026-10-28","start_basis":"Mục 1","due_date":"2026-11-05","due_basis":"Mục 1","label_ids":["lbl-prod"],"label_basis":"Sản phẩm","goal":"Hoàn thành việc A.","checklist":["Bước 1"],"excerpt":{"section":"Mục 1","quote":"Trích"},"blocked_by_indexes":[]}]}`
	items, err := parseDriveProposalRawItems(nominal)
	if err != nil || len(items) != 1 || items[0].Title != "Việc A" || items[0].Goal != "Hoàn thành việc A." {
		t.Fatalf("parseDriveProposalRawItems valid JSON: %+v %v", items, err)
	}
	for _, bad := range []string{"not json", `[]`, `{}`, `{"items":null}`, `{"items":"nope"}`, `{"items":[123]}`} {
		if _, err := parseDriveProposalRawItems(bad); !errors.Is(err, ai.ErrOutputInvalid) {
			t.Errorf("parseDriveProposalRawItems(%q) = %v, want ErrOutputInvalid", bad, err)
		}
	}

	t.Run("missing optional or nested fields degrade to empty and normalize cleanly", func(t *testing.T) {
		raw, err := parseDriveProposalRawItems(`{"items":[{"title":"Task without goal, checklist, excerpt, or dependencies"}]}`)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		got := normalizeDriveProposalItems(raw, nil, nil, "2026-10-27")
		if len(got) != 1 || got[0].Title != "Task without goal, checklist, excerpt, or dependencies" || got[0].Goal != "" || len(got[0].Checklist) != 0 || len(got[0].BlockedByIndexes) != 0 {
			t.Fatalf("unexpected normalized output: %+v", got)
		}
	})

	t.Run("null item in items array stays as empty placeholder and preserves dependency coordinates", func(t *testing.T) {
		raw, err := parseDriveProposalRawItems(`{"items":[null]}`)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(raw) != 1 || raw[0].Title != "" {
			t.Fatalf("expected 1 empty placeholder raw item, got %+v", raw)
		}
		got := normalizeDriveProposalItems(raw, nil, nil, "2026-10-27")
		if len(got) != 0 {
			t.Fatalf("expected 0 items, got %+v", got)
		}

		// Reviewer R1-1 case: [null, A, B(blocked_by_indexes=[1])] -> B depends on A (dense 0).
		rawShifted, err := parseDriveProposalRawItems(`{"items":[null,{"title":"Task A"},{"title":"Task B","blocked_by_indexes":[1]}]}`)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(rawShifted) != 3 {
			t.Fatalf("len(rawShifted) = %d, want 3 (null kept in raw array)", len(rawShifted))
		}
		gotShifted := normalizeDriveProposalItems(rawShifted, nil, nil, "2026-10-27")
		if len(gotShifted) != 2 {
			t.Fatalf("len(gotShifted) = %d, want 2: %+v", len(gotShifted), gotShifted)
		}
		if gotShifted[0].Index != 0 || gotShifted[0].Title != "Task A" || !reflect.DeepEqual(gotShifted[0].BlockedByIndexes, []int{}) {
			t.Fatalf("Task A = %+v, want Index=0 BlockedByIndexes=[]", gotShifted[0])
		}
		if gotShifted[1].Index != 1 || gotShifted[1].Title != "Task B" || !reflect.DeepEqual(gotShifted[1].BlockedByIndexes, []int{0}) {
			t.Fatalf("Task B = %+v, want Index=1 BlockedByIndexes=[0] (raw 1 -> dense 0)", gotShifted[1])
		}
	})

	t.Run("null fields degrade to empty and empty title item is dropped", func(t *testing.T) {
		raw, err := parseDriveProposalRawItems(`{"items":[{"title":null}]}`)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		got := normalizeDriveProposalItems(raw, nil, nil, "2026-10-27")
		if len(got) != 0 {
			t.Fatalf("expected 0 items, got %+v", got)
		}
	})

	t.Run("unknown properties are ignored", func(t *testing.T) {
		raw, err := parseDriveProposalRawItems(`{"items":[],"unexpected":"extra property"}`)
		if err != nil || len(raw) != 0 {
			t.Fatalf("expected empty items and nil error, got %+v %v", raw, err)
		}
	})
}

func TestDriveTaskProposalItemJSONShape(t *testing.T) {
	items := normalizeDriveProposalItems([]driveProposalRawItem{
		{
			Title:     "Chốt phạm vi tính năng beta",
			Goal:      "Chốt danh sách tính năng.",
			Checklist: []string{"Bước 1"},
			Excerpt:   driveProposalRawExcerpt{Section: "Mục 2", Quote: "Trích đoạn"},
		},
	}, nil, nil, "2026-10-27")
	b, err := json.Marshal(items[0])
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	for _, requiredKey := range []string{"index", "title", "start_date", "start_basis", "label_ids", "goal", "checklist", "excerpt", "blocked_by_indexes"} {
		if _, ok := m[requiredKey]; !ok {
			t.Errorf("marshaled JSON missing required key %q: %s", requiredKey, string(b))
		}
	}
	for _, omittedKey := range []string{"assignee_member_id", "assignee_basis", "priority", "priority_basis", "due_date", "due_basis", "label_basis", "possible_duplicate"} {
		if _, ok := m[omittedKey]; ok {
			t.Errorf("marshaled JSON should omit empty key %q: %s", omittedKey, string(b))
		}
	}
}
