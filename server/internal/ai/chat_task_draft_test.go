package ai

import "testing"

func TestParseChatTaskDraftJSON(t *testing.T) {
	got, err := ParseChatTaskDraftJSON(`{"title":"Gửi bản nháp","description":"An nhờ gửi trước thứ Sáu.","priority":"high","due_date":"2026-10-30"}`)
	if err != nil {
		t.Fatal(err)
	}
	if got.Title != "Gửi bản nháp" || got.Description != "An nhờ gửi trước thứ Sáu." || got.Priority != "high" || got.DueDate != "2026-10-30" {
		t.Fatalf("got %+v", got)
	}
	got, err = ParseChatTaskDraftJSON(`{"title":"X","description":"","priority":"weird","due_date":"not-a-date"}`)
	if err != nil {
		t.Fatal(err)
	}
	if got.Priority != "medium" || got.DueDate != "" {
		t.Fatalf("priority/due = %q/%q, want medium and empty due", got.Priority, got.DueDate)
	}
	if _, err := ParseChatTaskDraftJSON(`{"title":"","description":"x","priority":"low","due_date":""}`); err == nil {
		t.Fatal("empty title must fail")
	}
}
