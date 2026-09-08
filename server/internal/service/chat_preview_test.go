package service

import "testing"

func TestChatSidebarPreviewBody(t *testing.T) {
	t.Parallel()
	body := "[@tran hoang long](mention://member/USER1) check in"
	got := chatSidebarPreviewBody(body, "text")
	want := "@tran hoang long check in"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
	if chatSidebarPreviewBody("hello", "voice_call_log") != "" {
		t.Fatal("voice call log preview should be empty")
	}
}
