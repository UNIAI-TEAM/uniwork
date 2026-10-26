package metrics_test

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/metrics"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

// metrics reads the X-Client-* headers itself (it stays a leaf package): the names
// must be the ones middleware.ClientMetadata and the apps use.
func TestClientHeadersMatchMiddleware(t *testing.T) {
	got := metrics.ClientHeaderNames()
	want := [3]string{middleware.HeaderClientPlatform, middleware.HeaderClientVersion, middleware.HeaderClientUpdateID}
	if got != want {
		t.Fatalf("metrics reads %v, middleware names %v", got, want)
	}
}
