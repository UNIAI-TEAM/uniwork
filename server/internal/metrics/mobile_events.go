package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

// MobileEvents turns UniChat mobile's product events (POST
// /api/v1/mobile/events) into counters and one duration histogram: how often
// the app is opened, messages go out or fail, pushes are opened and calls
// connect, and how long the first screen, a send and a call connect take, per
// OS and store version. Aggregates only: no person, organization, room or
// message is a label or stored anywhere (store/listing.md › Quyền riêng tư).
type MobileEvents struct {
	Events    *prometheus.CounterVec
	Durations *prometheus.HistogramVec
	versions  *labelBudget
}

// mobileEventResults is the closed set of events and their results; anything
// else is dropped, so the client cannot mint series.
var mobileEventResults = map[string]map[string]bool{
	"app_open":     {"cold": true, "warm": true},
	"first_screen": {"ok": true},
	"message_send": {"sent": true, "failed": true},
	"push_open":    {"chat": true, "call": true, "other": true},
	"call_connect": {"connected": true, "failed": true},
}

// mobileEventTimed are the events whose duration is observed.
var mobileEventTimed = map[string]bool{"first_screen": true, "message_send": true, "call_connect": true}

// maxMobileEventSeconds drops a duration no real step takes (a clock jump, a
// phone asleep mid-send) instead of stretching the histogram.
const maxMobileEventSeconds = 600

func NewMobileEvents() *MobileEvents {
	return &MobileEvents{
		Events: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_mobile_events_total",
			Help: "UniChat mobile product events (opens, sends, push opens, call connects), by result, OS and store version.",
		}, []string{"event", "result", "os", "client_version"}),
		Durations: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "uniwork_mobile_event_duration_seconds",
			Help:    "How long UniChat mobile took to draw its first screen, send a message or connect a call, by OS.",
			Buckets: []float64{0.1, 0.25, 0.5, 1, 1.5, 2, 3, 5, 8, 13, 21, 34, 60},
		}, []string{"event", "os"}),
		versions: newLabelBudget(maxClientVersions),
	}
}

func (m *MobileEvents) Collectors() []prometheus.Collector {
	return []prometheus.Collector{m.Events, m.Durations}
}

// Observe records one event; false (and nothing recorded) for an unknown
// event or result. durationMs is only read for a timed event.
func (m *MobileEvents) Observe(event, result, os, version string, durationMs *float64) bool {
	if m == nil || !mobileEventResults[event][result] {
		return false
	}
	if os != "ios" && os != "android" {
		os = "other"
	}
	label := "other"
	if clientVersionRe.MatchString(version) {
		label = m.versions.admit(version)
	}
	m.Events.WithLabelValues(event, result, os, label).Inc()
	if durationMs != nil && mobileEventTimed[event] {
		if seconds := *durationMs / 1000; seconds >= 0 && seconds <= maxMobileEventSeconds {
			m.Durations.WithLabelValues(event, os).Observe(seconds)
		}
	}
	return true
}
