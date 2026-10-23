package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

// MobileEvents turns UniChat mobile's product events (POST
// /api/v1/mobile/events) into counters and one duration histogram: how often
// the app is opened, messages go out or fail, pushes are opened and calls
// connect, and how long the first screen, a send and a call connect take, per
// OS, store version and OTA update (so a rollout is judged per release and per
// update). Aggregates only: no person, organization, room or
// message is a label or stored anywhere (store/listing.md › Quyền riêng tư).
type MobileEvents struct {
	Events    *prometheus.CounterVec
	Durations *prometheus.HistogramVec
	versions  *labelBudget
	updates   *labelBudget
}

// mobileEventResults is the closed set of events and their results; anything
// else is dropped, so the client cannot mint series.
var mobileEventResults = map[string]map[string]bool{
	"app_open":     {"cold": true, "warm": true},
	"first_screen": {"ok": true},
	"message_send": {"sent": true, "failed": true},
	"push_open":    {"chat": true, "call": true, "other": true},
	"call_connect": {"connected": true, "failed": true},
	// What a call push did on an Android phone (apps/chat-mobile/data/calls/call-push.ts): the native ring shown
	// by the JavaScript task, the native ring posted by the FCM service before any JavaScript ran ("native",
	// modules/unichat-calls › NativeCallPush.kt, counted when the app next runs), a plain fallback, rung in the app
	// already, ignored (switch off, over, busy), an end that cleared a ring, or a ring lost (neither notification
	// could be posted). Ring delivery is judged by these, not by a device farm.
	"call_push": {"shown": true, "native": true, "fallback": true, "in_app": true, "ignored": true, "cleared": true, "lost": true},
	// How long after the server rang a call the phone rang it (from expires_at less the ring window, so the
	// Expo and FCM hops and the phone's clock skew are in it): natively, or by the JavaScript task ("app").
	// deploy/alerts.yml › UniChatCallRingSlow pages on its p95.
	"call_ring": {"native": true, "app": true},
	// A call's media link dropping (apps/chat-mobile/data/calls/call-link.ts): recovered, timed from the drop to
	// LiveKit having it back, or dropped for good (the room let go while reconnecting).
	"call_reconnect": {"recovered": true, "dropped": true},
	// How a launch went (apps/chat-mobile/data/release/launch-health.ts): an OTA update that could not launch (the
	// phone fell back to the binary's bundle, or skipped an update that failed to load), and a run that ended in a
	// crash, told by the next one. Counted against the build that tells it; the alerts page on them without waiting
	// for Sentry (deploy/alerts.yml › UniChatMobileUpdateLaunchFailures, UniChatMobileCrashes).
	"ota_launch": {"emergency": true, "failed_update": true},
	"app_crash":  {"last_run": true},
}

// mobileEventTimed are the events whose duration is observed.
var mobileEventTimed = map[string]bool{"first_screen": true, "message_send": true, "call_connect": true, "call_ring": true, "call_reconnect": true}

// maxMobileEventSeconds drops a duration no real step takes (a clock jump, a
// phone asleep mid-send) instead of stretching the histogram.
const maxMobileEventSeconds = 600

func NewMobileEvents() *MobileEvents {
	events := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "uniwork_mobile_events_total",
		Help: "UniChat mobile product events (opens, sends, push opens, call connects, call pushes), by result, OS, store version and OTA update.",
	}, []string{"event", "result", "os", "client_version", "client_update"})
	// Durations carry the store version but not the OTA: buckets times updates
	// would be the one label set that could grow past a few thousand series.
	durations := prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "uniwork_mobile_event_duration_seconds",
		Help:    "How long UniChat mobile took to draw its first screen, send a message, connect a call or ring one after the server did, by OS and store version.",
		Buckets: []float64{0.1, 0.25, 0.5, 1, 1.5, 2, 3, 5, 8, 13, 21, 34, 60},
	}, []string{"event", "os", "client_version"})
	return &MobileEvents{
		Events:    events,
		Durations: durations,
		versions: newLabelBudget(maxClientVersions, func(v string) {
			events.DeletePartialMatch(prometheus.Labels{"client_version": v})
			durations.DeletePartialMatch(prometheus.Labels{"client_version": v})
		}),
		updates: newLabelBudget(maxClientUpdates, func(u string) { events.DeletePartialMatch(prometheus.Labels{"client_update": u}) }),
	}
}

func (m *MobileEvents) Collectors() []prometheus.Collector {
	return []prometheus.Collector{m.Events, m.Durations}
}

// Observe records one event; false (and nothing recorded) for an unknown
// event or result. durationMs is only read for a timed event. The route is
// behind RequireAuth, so a version or update id here came with a session.
func (m *MobileEvents) Observe(event, result, os, version, update string, durationMs *float64) bool {
	if m == nil || !mobileEventResults[event][result] {
		return false
	}
	if os != "ios" && os != "android" {
		os = "other"
	}
	versionLabel, updateLabel := "other", "other"
	if clientVersionRe.MatchString(version) {
		versionLabel = m.versions.admit(version)
	}
	if clientUpdateRe.MatchString(update) {
		updateLabel = m.updates.admit(update)
	}
	m.Events.WithLabelValues(event, result, os, versionLabel, updateLabel).Inc()
	if durationMs != nil && mobileEventTimed[event] {
		if seconds := *durationMs / 1000; seconds >= 0 && seconds <= maxMobileEventSeconds {
			m.Durations.WithLabelValues(event, os, versionLabel).Observe(seconds)
		}
	}
	return true
}
