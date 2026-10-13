package notification

import (
	"os"
	"regexp"
	"testing"
)

// The client mirror (packages/core/types/notification.ts) and this package
// are two halves of one list: the inbox renders it, the preference matrix
// iterates it, and the tone and icon tables key off it. This test fails when
// the lists drift in content or order (contract-collab section 8.3, BE-11).
func TestKindsMatchClientList(t *testing.T) {
	raw, err := os.ReadFile("../../../packages/core/types/notification.ts")
	if err != nil {
		t.Fatal(err)
	}
	list := regexp.MustCompile(`(?s)NOTIFICATION_KINDS = \[(.*?)\] as const`).FindSubmatch(raw)
	if list == nil {
		t.Fatal("NOTIFICATION_KINDS not found in packages/core/types/notification.ts")
	}
	client := regexp.MustCompile(`"([a-z_]+)"`).FindAllStringSubmatch(string(list[1]), -1)
	if len(client) != len(Kinds) {
		t.Fatalf("client lists %d kinds, server lists %d", len(client), len(Kinds))
	}
	for i, m := range client {
		if m[1] != Kinds[i] {
			t.Fatalf("kind %d: client %q, server %q", i, m[1], Kinds[i])
		}
	}
}
