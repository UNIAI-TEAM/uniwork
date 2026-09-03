package meetings

import "testing"

func TestMediaPermissionsForRole(t *testing.T) {
	mod := MediaPermissionsForRole("MODERATOR")
	if !mod.CanPublish || !mod.CanSubscribe {
		t.Fatal("moderator should publish and subscribe")
	}
	att := MediaPermissionsForRole("ATTENDEE")
	if !att.CanPublish || !att.CanPublishData {
		t.Fatal("attendee should have full media in current product")
	}
}
