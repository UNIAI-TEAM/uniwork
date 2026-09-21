package service

import (
	"encoding/json"
	"testing"
	"time"
)

func TestParseEmailHubSyncState(t *testing.T) {
	t.Parallel()
	raw, err := json.Marshal(emailHubSyncState{
		emailHubFolderInbox: {UIDValidity: 42, LastUID: 100, LastSyncAt: "2026-09-18T04:00:00Z"},
	})
	if err != nil {
		t.Fatal(err)
	}
	state := parseEmailHubSyncState(raw)
	inbox := state.folder(emailHubFolderInbox)
	if inbox.UIDValidity != 42 || inbox.LastUID != 100 {
		t.Fatalf("unexpected inbox cursor: %+v", inbox)
	}
	at := lastSyncFromState(raw)
	if at == nil || !at.Equal(time.Date(2026, 9, 18, 4, 0, 0, 0, time.UTC)) {
		t.Fatalf("unexpected last sync: %v", at)
	}
}

func TestParseEmailHubSyncStateEmptyAndInvalid(t *testing.T) {
	t.Parallel()
	if len(parseEmailHubSyncState(nil)) != 0 {
		t.Fatal("expected empty state for nil raw")
	}
	if len(parseEmailHubSyncState([]byte("{not-json"))) != 0 {
		t.Fatal("expected empty state for invalid json")
	}
	if lastSyncFromState(nil) != nil {
		t.Fatal("expected nil last sync for empty state")
	}
	state := emailHubSyncState{}.withFolder(emailHubFolderSent, emailHubFolderSync{LastUID: 7})
	sent := state.folder(emailHubFolderSent)
	if sent.LastUID != 7 {
		t.Fatalf("withFolder: %+v", sent)
	}
}
