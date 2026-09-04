package meetings

import (
	"testing"
	"time"
)

func TestRoomEmptyTimeoutSeconds(t *testing.T) {
	if got := roomEmptyTimeoutSeconds(0, 0); got != controlPlaneEmptyTimeoutSeconds {
		t.Fatalf("zero config = %d want %d", got, controlPlaneEmptyTimeoutSeconds)
	}
	if got := roomEmptyTimeoutSeconds(10*time.Minute, 0); got != 600 {
		t.Fatalf("request override = %d", got)
	}
}
