package service

import (
	"context"
	"reflect"
	"testing"
)

// The pure half of the AI opt-out (no database): who wrote a batch, each once,
// and which of them a request must leave out.
func TestAIOptOutsExcludeOnlyTheDecliners(t *testing.T) {
	msgs := []ChatMessageRow{{SenderID: "a"}, {SenderID: ""}, {SenderID: "b"}, {SenderID: "a"}}
	if got := uniqueNonEmpty(chatSenderIDs(msgs)); !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Fatalf("senders: %v", got)
	}
	o := aiOptOuts{"b": true}
	if o.excludes("a") || !o.excludes("b") || o.excludes("") {
		t.Fatalf("excludes: %v", o)
	}
	// No sender to ask about: no query at all (a nil *db.Queries would panic).
	if got, err := loadAIOptOuts(context.Background(), nil, []string{"", ""}); err != nil || len(got) != 0 {
		t.Fatalf("no senders: %v %v", got, err)
	}
}
