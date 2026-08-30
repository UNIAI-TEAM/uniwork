package meetings

import (
	"strings"
	"testing"
)

func TestLiveKitRoomFromMatrixID(t *testing.T) {
	in := "!PDBezmTDyDMTsEIAGl:localhost"
	got := LiveKitRoomFromMatrixID(in)
	if !strings.HasPrefix(got, "uw-voice-") {
		t.Fatalf("prefix: got %q", got)
	}
	if strings.ContainsAny(got, "!:") {
		t.Fatalf("unsafe chars remain: %q", got)
	}
	if LiveKitRoomFromMatrixID(in) != got {
		t.Fatal("not stable")
	}
}
