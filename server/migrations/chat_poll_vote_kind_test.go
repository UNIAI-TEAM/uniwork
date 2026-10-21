package migrations

import (
	"strings"
	"testing"
)

func TestChatPollVoteKindMigration(t *testing.T) {
	const (
		up   = "9991792410000000_chat_messages_poll_vote_kind.up.sql"
		down = "9991792410000000_chat_messages_poll_vote_kind.down.sql"
	)
	usql := stripSQLComments(readMigration(t, up))
	drop := strings.Index(usql, "DROP CONSTRAINT chat_messages_kind_check")
	add := strings.Index(usql, "ADD CONSTRAINT chat_messages_kind_check")
	if drop < 0 || add < 0 {
		t.Fatalf("%s must drop the CHECK and add it back", up)
	}
	if drop > add {
		t.Fatalf("%s: the drop must precede the add", up)
	}
	if !strings.Contains(usql, "'poll_vote'") {
		t.Errorf("%s is missing kind poll_vote", up)
	}
	for _, kind := range []string{"'document'", "'document_version'", "'poll'"} {
		if !strings.Contains(usql, kind) {
			t.Errorf("%s dropped kind %s from the document-kinds list", up, kind)
		}
	}

	dsql := stripSQLComments(readMigration(t, down))
	if strings.Index(dsql, "DROP CONSTRAINT chat_messages_kind_check") > strings.Index(dsql, "ADD CONSTRAINT chat_messages_kind_check") {
		t.Fatalf("%s: the drop must precede the add", down)
	}
	if strings.Contains(dsql, "'poll_vote'") {
		t.Errorf("%s still carries poll_vote; it must restore the document-kinds list", down)
	}
	if !strings.Contains(dsql, "'document'") {
		t.Errorf("%s is missing document from the restored list", down)
	}
}
