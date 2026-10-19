package migrations

import (
	"strings"
	"testing"
)

// UNI-1966 CHAT-DOC-SHARE: a chat message may carry a Document or one version
// of it. The kind CHECK is widened in one file and the down file restores the
// 181 list, so a rollback leaves the schema exactly as 181_chat_messages_post_kind
// left it.
func TestChatDocumentKindsMigration(t *testing.T) {
	const (
		up   = "9991792407200000_chat_messages_document_kinds.up.sql"
		down = "9991792407200000_chat_messages_document_kinds.down.sql"
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
	for _, kind := range []string{"'document'", "'document_version'"} {
		if !strings.Contains(usql, kind) {
			t.Errorf("%s is missing kind %s", up, kind)
		}
	}
	// The 181 list stays: the two new kinds join it, they do not replace it.
	for _, kind := range []string{"'text'", "'system'", "'voice_call_log'", "'poll'", "'reminder'", "'note'", "'voice'", "'file'", "'post'"} {
		if !strings.Contains(usql, kind) {
			t.Errorf("%s dropped kind %s that 181_chat_messages_post_kind had", up, kind)
		}
	}

	dsql := stripSQLComments(readMigration(t, down))
	if strings.Index(dsql, "DROP CONSTRAINT chat_messages_kind_check") > strings.Index(dsql, "ADD CONSTRAINT chat_messages_kind_check") {
		t.Fatalf("%s: the drop must precede the add", down)
	}
	for _, kind := range []string{"'document'", "'document_version'"} {
		if strings.Contains(dsql, kind) {
			t.Errorf("%s still carries kind %s; it must restore the 181 list", down, kind)
		}
	}
	for _, kind := range []string{"'post'", "'file'", "'note'"} {
		if !strings.Contains(dsql, kind) {
			t.Errorf("%s is missing the 181 kind %s", down, kind)
		}
	}
}
