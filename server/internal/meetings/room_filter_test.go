package meetings

import "testing"

func TestIsUniWorkLiveKitRoom(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   string
		want bool
	}{
		{name: "meeting", in: "uw_mtg_01J8X4MTGN1P2Q3R4S5T6U7V", want: true},
		{name: "voice", in: "uw-voice-01JCHATROOMID", want: true},
		{name: "empty egress", in: "", want: true},
		{name: "lms main", in: "main-room", want: false},
		{name: "lms broadcast", in: "online-9001-g2-broadcast", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := IsUniWorkLiveKitRoom(tc.in); got != tc.want {
				t.Fatalf("IsUniWorkLiveKitRoom(%q)=%v want %v", tc.in, got, tc.want)
			}
		})
	}
}
