package metrics

import (
	"fmt"
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestMobileEventsKeepTheirLabelsClosed(t *testing.T) {
	m := NewMobileEvents()
	ms := func(v float64) *float64 { return &v }
	if !m.Observe("first_screen", "ok", "ios", "0.3.0", ms(1800)) {
		t.Fatal("first_screen ok is an event")
	}
	if m.Observe("first_screen", "slow", "ios", "0.3.0", nil) || m.Observe("room_opened", "ok", "ios", "0.3.0", nil) {
		t.Fatal("unknown results and events are dropped")
	}
	m.Observe("app_open", "warm", "windows", "0.3.0-beta", ms(5))
	if got := testutil.ToFloat64(m.Events.WithLabelValues("app_open", "warm", "other", "other")); got != 1 {
		t.Fatalf("an unknown OS and a malformed version are other: %v", got)
	}
	// app_open is not timed; a duration past ten minutes or below zero is not a step.
	m.Observe("message_send", "sent", "android", "0.3.0", ms(-1))
	m.Observe("message_send", "sent", "android", "0.3.0", ms(601_000))
	if n := testutil.CollectAndCount(m.Durations, "uniwork_mobile_event_duration_seconds"); n != 1 {
		t.Fatalf("duration series = %d, want only first_screen's", n)
	}
	for i := 0; i < maxClientVersions+3; i++ {
		m.Observe("app_open", "cold", "android", fmt.Sprintf("2.0.%d", i), nil)
	}
	if got := testutil.ToFloat64(m.Events.WithLabelValues("app_open", "cold", "android", "other")); got != 4 {
		t.Fatalf("versions past the budget share other: %v", got)
	}
	var nilEvents *MobileEvents
	if nilEvents.Observe("app_open", "cold", "ios", "0.3.0", nil) {
		t.Fatal("a nil collector records nothing")
	}
}
