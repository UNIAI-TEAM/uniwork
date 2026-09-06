package metrics

import (
	"regexp"

	"github.com/prometheus/client_golang/prometheus"
)

// WebVitals turns RUM samples from POST /api/v1/rum into one histogram per
// metric and route pattern (F-11 §2.8). lcp, inp and ttfb are seconds; cls
// is unitless and shares the histogram, so read its buckets as a score.
type WebVitals struct {
	Seconds *prometheus.HistogramVec
}

func NewWebVitals() *WebVitals {
	return &WebVitals{Seconds: prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "uniwork_web_vitals_seconds",
		Help:    "Web-vitals reported by the web client, by metric and route pattern.",
		Buckets: []float64{0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8, 1, 1.5, 2.5, 4, 6, 10},
	}, []string{"metric", "route_pattern"})}
}

func (w *WebVitals) Collectors() []prometheus.Collector { return []prometheus.Collector{w.Seconds} }

// Observe records one sample; unknown metric names are dropped.
func (w *WebVitals) Observe(metric, routePattern string, value float64) bool {
	if w == nil || !IsWebVital(metric) || value < 0 {
		return false
	}
	w.Seconds.WithLabelValues(metric, NormalizeRoute(routePattern)).Observe(value)
	return true
}

// IsWebVital: the four metrics the client reports.
func IsWebVital(name string) bool {
	switch name {
	case "lcp", "inp", "cls", "ttfb":
		return true
	}
	return false
}

var (
	ulidSegment = regexp.MustCompile(`/[0-9A-HJKMNP-TV-Z]{26}(/|$)`)
	routeChars  = regexp.MustCompile(`[^A-Za-z0-9/_:\-\[\].]`)
)

// NormalizeRoute keeps label cardinality bounded: ULID segments become :id,
// anything outside a small charset is dropped, and the result is capped. The
// client already sends its route pattern ([orgSlug]/[workspaceSlug]/tasks),
// so this only guards against a raw path slipping through.
func NormalizeRoute(p string) string {
	p = ulidSegment.ReplaceAllString(p, "/:id$1")
	p = routeChars.ReplaceAllString(p, "")
	if len(p) > 100 {
		p = p[:100]
	}
	if p == "" {
		return "unknown"
	}
	return p
}
