package main

import (
	"testing"
	"time"
)

func TestParseMetricsSumsFamiliesOverLabels(t *testing.T) {
	s := parseMetrics(`# HELP x
uniwork_db_query_duration_seconds_count{query_name="A"} 3
uniwork_db_query_duration_seconds_count{query_name="B"} 4
uniwork_db_query_duration_seconds_sum{query_name="A"} 9
uniwork_db_pool_empty_acquire_count 2
process_cpu_seconds_total 1.5
process_resident_memory_bytes 1.048576e+06
`, time.Time{})
	if s.stmts != 7 || s.waits != 2 || s.cpu != 1.5 || s.rss != 1<<20 {
		t.Fatalf("parsed %+v", s)
	}
}

func TestPercentileIsNearestRank(t *testing.T) {
	v := []float64{5, 1, 4, 2, 3}
	if p := percentile(v, .5); p != 3 {
		t.Fatalf("p50 = %v", p)
	}
	if p := percentile(v, 1); p != 5 {
		t.Fatalf("max = %v", p)
	}
	if p := percentile(nil, .95); p != 0 {
		t.Fatalf("empty = %v", p)
	}
}

func TestOlderThanPrefersTheOpaqueCursor(t *testing.T) {
	m := pagedMessage{CreatedAt: "2026-10-09T17:15:09+07:00", Cursor: "a+b/="}
	if got := m.olderThan(); got != "&cursor=a%2Bb%2F%3D" {
		t.Fatalf("with cursor = %s", got)
	}
	m.Cursor = ""
	if got := m.olderThan(); got != "&before=2026-10-09T10:15:09.000Z" {
		t.Fatalf("without cursor = %s", got)
	}
}

func TestClientCursorMatchesDateToISOString(t *testing.T) {
	if got := clientCursor("2026-10-09T17:15:09.123456+07:00"); got != "2026-10-09T10:15:09.123Z" {
		t.Fatalf("cursor = %s", got)
	}
	if got := clientCursor("2026-10-09T17:15:09+07:00"); got != "2026-10-09T10:15:09.000Z" {
		t.Fatalf("cursor = %s", got)
	}
}

// A duplicate on one socket must not hide a miss on another.
func TestArrivalsCountMissedPairsNotTotals(t *testing.T) {
	msgs := []sent{{id: "m1", start: time.Now()}, {id: "m2", start: time.Now()}}
	a := &arrivals{}
	a.add(0, "m1")
	a.add(0, "m2")
	a.add(1, "m1")
	a.add(1, "m1") // socket 1 sees m1 twice and never m2
	a.add(1, "other")
	lat, missed, dups := a.latency(msgs, 2)
	if missed != 1 || dups != 1 || len(lat.ms) != 3 {
		t.Fatalf("missed=%d dups=%d samples=%d, want 1 1 3", missed, dups, len(lat.ms))
	}
}

// A setup failure becomes a failed check on that scenario, not an exit.
func TestRunScenarioRecordsFatalAsFailedCheck(t *testing.T) {
	r := &result{Name: "x"}
	runScenario(func(*env, *result) { fatal("no %s", "channel") }, nil, r)
	if len(r.Checks) != 1 || r.Checks[0].OK || r.Checks[0].Name != "setup: no channel" {
		t.Fatalf("checks = %+v", r.Checks)
	}
}
