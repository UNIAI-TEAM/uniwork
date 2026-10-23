package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// The meeting scope admits whoever may read the room's data from that
// workspace socket, and nobody else (G8).
func TestAuthorizeMeetingScope(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Scoped room")
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.ws.CreateInOrg(ctx, ua.ID, w.OrganizationID, "Beta", "beta-scope")
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name                     string
		userID, workspaceID, mID string
		want                     bool
	}{
		{"host on the meeting's workspace", ua.ID, w.ID, m.ID, true},
		{"outsider", ub.ID, w.ID, m.ID, false},
		{"member socket of another workspace", ua.ID, other.Workspace.ID, m.ID, false},
		{"unknown meeting", ua.ID, w.ID, util.NewID(), false},
	}
	for _, c := range cases {
		got, err := s.AuthorizeMeetingScope(ctx, c.userID, c.workspaceID, c.mID)
		if err != nil {
			t.Fatalf("%s: unexpected error %v", c.name, err)
		}
		if got != c.want {
			t.Errorf("%s: AuthorizeMeetingScope = %v, want %v", c.name, got, c.want)
		}
	}

	// A member who is not on the roster may still hold the meeting open:
	// the detail page and the lobby wait both listen before any admission.
	addMember(t, s, w.ID, ub.ID)
	if ok, err := s.AuthorizeMeetingScope(ctx, ub.ID, w.ID, m.ID); err != nil || !ok {
		t.Fatalf("workspace member = %v, %v; want true", ok, err)
	}
}
