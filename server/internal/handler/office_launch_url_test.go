package handler

import "testing"

func TestOfficeLaunchURLFollowsTheClientScheme(t *testing.T) {
	cases := map[string]string{
		"uniwork-office":     "uniwork-office://open?ticket=ticket_abc-_9",
		"uniwork-office-dev": "uniwork-office-dev://open?ticket=ticket_abc-_9",
	}
	for client, want := range cases {
		if got := officeLaunchURL(client, "ticket_abc-_9"); got != want {
			t.Errorf("officeLaunchURL(%q) = %q, want %q", client, got, want)
		}
	}
}
