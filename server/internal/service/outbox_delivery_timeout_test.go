package service

import (
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/outbox"
)

// The dispatcher cuts every consumer off at a short default deadline. The
// consumers whose work is known to run long must ask for more, or each
// delivery times out, retries and dead-letters.
func TestSlowConsumersAskForALongerDeliveryDeadline(t *testing.T) {
	for name, tc := range map[string]struct {
		c   outbox.Consumer
		min time.Duration
	}{
		"audit export":       {&AuditExportConsumer{}, 120 * time.Second},
		"chat voice summary": {&ChatVoiceSummaryConsumer{}, 90 * time.Second},
	} {
		dt, ok := tc.c.(outbox.DeliveryTimeouter)
		if !ok {
			t.Fatalf("%s: does not implement outbox.DeliveryTimeouter", name)
		}
		if got := dt.DeliveryTimeout(); got < tc.min {
			t.Fatalf("%s: DeliveryTimeout() = %v, want at least %v", name, got, tc.min)
		}
	}
}
