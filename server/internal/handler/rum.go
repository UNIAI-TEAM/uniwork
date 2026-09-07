package handler

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/metrics"
)

// maxRUMBody: a web-vitals sample is a few dozen bytes; 1 KiB is the cap
// spec F-11 §2.8 sets so an anonymous endpoint cannot be used as a sink.
const maxRUMBody = 1024

// rum is POST /api/v1/rum: no auth, rate-limited by IP, sampled by the client.
// Always 204 — the client must never retry or surface a RUM failure. When
// metrics are off or the rum_sampling flag is off nothing is recorded.
func (h *handlers) rum(w http.ResponseWriter, r *http.Request) {
	var in sdi.RUMSampleSDI
	if !decode(w, r, &in, maxRUMBody) {
		return
	}
	if h.WebVitals == nil || !metrics.IsWebVital(in.Metric) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if !featureflags.EvaluateFrontendPublicFlags(r.Context(), h.FeatureFlags)["rum_sampling"] {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	value := in.Value
	if in.Metric != "cls" {
		value = in.Value / 1000 // web-vitals reports milliseconds
	}
	h.WebVitals.Observe(in.Metric, in.Route, value)
	w.WriteHeader(http.StatusNoContent)
}
