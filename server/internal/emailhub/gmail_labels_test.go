package emailhub

import "testing"

func TestUserVisibleImapLabels(t *testing.T) {
	t.Parallel()
	got := UserVisibleImapLabels([]string{"Inbox", "Work", "Sent", "Work", "Category_Promotions"})
	if len(got) != 1 || got[0] != "Work" {
		t.Fatalf("filtered: %v", got)
	}
}
