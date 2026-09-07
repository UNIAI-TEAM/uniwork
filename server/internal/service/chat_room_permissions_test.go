package service

import "testing"

func TestMemberPermissionsFromRawDefaults(t *testing.T) {
	perms := memberPermissionsFromRaw(nil)
	if !perms.AllowSendMessages || !perms.AllowPinContent {
		t.Fatalf("expected defaults: %+v", perms)
	}
}

func TestMemberPermissionsFromRawPartialJSON(t *testing.T) {
	raw := []byte(`{"allow_send_messages":false}`)
	perms := memberPermissionsFromRaw(raw)
	if perms.AllowSendMessages {
		t.Fatalf("expected send disabled: %+v", perms)
	}
}
