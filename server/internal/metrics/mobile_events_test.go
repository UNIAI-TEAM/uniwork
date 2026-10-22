package metrics

import (
	"fmt"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestMobileEventsKeepTheirLabelsClosed(t *testing.T) {
	m := NewMobileEvents()
	ms := func(v float64) *float64 { return &v }
	if !m.Observe("first_screen", "ok", "ios", "0.3.0", "embedded", ms(1800)) {
		t.Fatal("first_screen ok is an event")
	}
	if m.Observe("first_screen", "slow", "ios", "0.3.0", "embedded", nil) || m.Observe("room_opened", "ok", "ios", "0.3.0", "embedded", nil) {
		t.Fatal("unknown results and events are dropped")
	}
	if !m.Observe("ota_launch", "emergency", "android", "0.3.0", "embedded", nil) || !m.Observe("app_crash", "last_run", "ios", "0.3.0", "embedded", nil) {
		t.Fatal("a failed OTA launch and a crashed last run are events")
	}
	if m.Observe("ota_launch", "ok", "android", "0.3.0", "embedded", nil) || m.Observe("app_crash", "now", "ios", "0.3.0", "embedded", nil) {
		t.Fatal("their results are closed too")
	}
	m.Observe("app_open", "warm", "windows", "0.3.0-beta", "not-an-update", ms(5))
	if got := testutil.ToFloat64(m.Events.WithLabelValues("app_open", "warm", "other", "other", "other")); got != 1 {
		t.Fatalf("an unknown OS, a malformed version and a malformed update are other: %v", got)
	}
	// app_open is not timed; a duration past ten minutes or below zero is not a step.
	m.Observe("message_send", "sent", "android", "0.3.0", "", ms(-1))
	m.Observe("message_send", "sent", "android", "0.3.0", "", ms(601_000))
	if n := testutil.CollectAndCount(m.Durations, "uniwork_mobile_event_duration_seconds"); n != 1 {
		t.Fatalf("duration series = %d, want only first_screen's", n)
	}
	for i := 0; i < maxClientVersions+3; i++ {
		m.Observe("app_open", "cold", "android", fmt.Sprintf("2.0.%d", i), "", nil)
	}
	if got := testutil.ToFloat64(m.Events.WithLabelValues("app_open", "cold", "android", "other", "other")); got != 4 {
		t.Fatalf("versions past the budget share other: %v", got)
	}
	var nilEvents *MobileEvents
	if nilEvents.Observe("app_open", "cold", "ios", "0.3.0", "embedded", nil) {
		t.Fatal("a nil collector records nothing")
	}
}

// Engagement is split per OTA too, so a rollout is judged per update; an update
// nobody sent for a day gives its slot and its series to the next one.
func TestMobileEventsCountEachOTAAndRecycleIdleOnes(t *testing.T) {
	m := NewMobileEvents()
	clock := time.Date(2026, 10, 22, 9, 0, 0, 0, time.UTC)
	m.updates.now = func() time.Time { return clock }
	update := func(i int) string { return fmt.Sprintf("%08x-0000-4000-8000-000000000000", i) }
	for i := 0; i < maxClientUpdates; i++ {
		m.Observe("app_open", "cold", "ios", "0.3.0", update(i), nil)
	}
	if got := testutil.ToFloat64(m.Events.WithLabelValues("app_open", "cold", "ios", "0.3.0", update(3))); got != 1 {
		t.Fatalf("an update is its own series: %v", got)
	}
	m.Observe("app_open", "cold", "ios", "0.3.0", update(99), nil)
	if got := testutil.ToFloat64(m.Events.WithLabelValues("app_open", "cold", "ios", "0.3.0", "other")); got != 1 {
		t.Fatalf("a full budget of recent updates sends a new one to other: %v", got)
	}
	clock = clock.Add(clientLabelIdle)
	for i := 1; i < maxClientUpdates; i++ {
		m.Observe("app_open", "warm", "ios", "0.3.0", update(i), nil)
	}
	m.Observe("app_open", "cold", "ios", "0.3.0", update(99), nil)
	if got := testutil.ToFloat64(m.Events.WithLabelValues("app_open", "cold", "ios", "0.3.0", update(99))); got != 1 {
		t.Fatalf("the idle update's slot goes to the new one: %v", got)
	}
	n := testutil.CollectAndCount(m.Events, "uniwork_mobile_events_total")
	// 24 cold + 1 other + 23 warm + the new one's cold, minus the evicted update's cold series.
	if want := maxClientUpdates + 1 + (maxClientUpdates - 1) + 1 - 1; n != want {
		t.Fatalf("series = %d, want %d (the evicted update's series is dropped)", n, want)
	}
}
