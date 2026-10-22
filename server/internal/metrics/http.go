package metrics

import (
	"context"
	"net/http"
	"regexp"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
)

type HTTPMetrics struct {
	requests *prometheus.CounterVec
	duration *prometheus.HistogramVec
	inFlight prometheus.Gauge
	// clients counts the answers given to first-party app builds, by the
	// build (store version and OTA update) and the class of the status: a
	// release that breaks a server contract shows up as its own series
	// (deploy/alerts.yml › UniChatMobileServerErrors).
	clients  *prometheus.CounterVec
	versions *labelBudget
	updates  *labelBudget
}

// The X-Client-* headers (middleware.HeaderClient*; metrics stays a leaf
// package, TestClientHeadersMatchMiddleware holds the names together).
const (
	headerClientPlatform = "X-Client-Platform"
	headerClientVersion  = "X-Client-Version"
	headerClientUpdateID = "X-Client-Update-Id"
)

// The client headers are the caller's to set: only the app platforms are
// counted, a version must be MAJOR.MINOR.PATCH and an update id a UUID (or
// "embedded"), only a request the server authenticated (MarkAuthenticated)
// may put a value into a label, and each label keeps at most a few distinct
// values per process — anything past that is "other", so no caller can grow
// the series. A value nobody has sent for clientLabelIdle gives its slot (and
// its series) to the next one, so a long-lived pod keeps naming new builds.
const (
	maxClientVersions = 16
	maxClientUpdates  = 24
	clientLabelIdle   = 24 * time.Hour
)

var (
	clientVersionRe = regexp.MustCompile(`^\d{1,4}\.\d{1,4}\.\d{1,4}$`)
	clientUpdateRe  = regexp.MustCompile(`^(embedded|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$`)
)

// countedPlatforms are the X-Client-Platform values with a release train
// worth a series; the web ships with the server and has one version.
var countedPlatforms = map[string]bool{"mobile": true, "desktop": true}

// labelBudget admits at most max distinct values of a label and maps every
// later one to "other". When it is full, the value least recently seen gives
// up its slot if nobody sent it for idle; evict then drops that value's series,
// so the exported series stay bounded too.
type labelBudget struct {
	mu    sync.Mutex
	max   int
	idle  time.Duration
	now   func() time.Time
	seen  map[string]time.Time
	evict func(value string)
}

func newLabelBudget(max int, evict func(string)) *labelBudget {
	return &labelBudget{max: max, idle: clientLabelIdle, now: time.Now, seen: map[string]time.Time{}, evict: evict}
}

func (b *labelBudget) admit(v string) string {
	b.mu.Lock()
	defer b.mu.Unlock()
	now := b.now()
	if _, ok := b.seen[v]; ok {
		b.seen[v] = now
		return v
	}
	if len(b.seen) >= b.max {
		oldest, at := "", now
		for value, seen := range b.seen {
			if seen.Before(at) {
				oldest, at = value, seen
			}
		}
		if oldest == "" || now.Sub(at) < b.idle {
			return "other"
		}
		delete(b.seen, oldest)
		if b.evict != nil {
			b.evict(oldest)
		}
	}
	b.seen[v] = now
	return v
}

// authMark is set by the auth middleware, inside the metrics middleware, once
// the request carries a verified user (middleware.WithUserID).
type authMark struct{ ok atomic.Bool }

type authMarkKey struct{}

// MarkAuthenticated records that the request's caller was authenticated, so
// its client headers may name a label value. A context without the metrics
// middleware above it is left as is.
func MarkAuthenticated(ctx context.Context) {
	if mark, ok := ctx.Value(authMarkKey{}).(*authMark); ok {
		mark.ok.Store(true)
	}
}

// statusClass is "2xx".."5xx".
func statusClass(status int) string {
	return strconv.Itoa(status/100) + "xx"
}

// clientLabels are the client series' labels for a request, or nil when it
// is not from a counted app build. Only an authenticated request is admitted
// into the budgets: public routes (config, plans, sign-in) answer anyone, and
// an anonymous caller must not use up the label values the next bad build needs.
func (m *HTTPMetrics) clientLabels(r *http.Request, signedIn bool, status int) prometheus.Labels {
	platform := r.Header.Get(headerClientPlatform)
	if !countedPlatforms[platform] {
		return nil
	}
	version, update := "other", "other"
	if v := r.Header.Get(headerClientVersion); signedIn && clientVersionRe.MatchString(v) {
		version = m.versions.admit(v)
	}
	if u := r.Header.Get(headerClientUpdateID); signedIn && clientUpdateRe.MatchString(u) {
		update = m.updates.admit(u)
	}
	return prometheus.Labels{"platform": platform, "client_version": version, "client_update": update, "status_class": statusClass(status)}
}

func NewHTTPMetrics() *HTTPMetrics {
	clients := prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "uniwork",
		Subsystem: "http",
		Name:      "client_requests_total",
		Help:      "HTTP answers to first-party app builds (mobile, desktop), by store version, OTA update and status class.",
	}, []string{"platform", "client_version", "client_update", "status_class"})
	return &HTTPMetrics{
		requests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Namespace: "uniwork",
			Subsystem: "http",
			Name:      "requests_total",
			Help:      "Total HTTP requests served by the API server.",
		}, []string{"method", "route", "status"}),
		duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Namespace: "uniwork",
			Subsystem: "http",
			Name:      "request_duration_seconds",
			Help:      "HTTP request duration observed by the API server.",
			Buckets:   []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
		}, []string{"method", "route", "status"}),
		inFlight: prometheus.NewGauge(prometheus.GaugeOpts{
			Namespace: "uniwork",
			Subsystem: "http",
			Name:      "in_flight_requests",
			Help:      "Current number of in-flight HTTP requests served by the API server.",
		}),
		clients:  clients,
		versions: newLabelBudget(maxClientVersions, func(v string) { clients.DeletePartialMatch(prometheus.Labels{"client_version": v}) }),
		updates:  newLabelBudget(maxClientUpdates, func(u string) { clients.DeletePartialMatch(prometheus.Labels{"client_update": u}) }),
	}
}

func (m *HTTPMetrics) Collectors() []prometheus.Collector {
	return []prometheus.Collector{m.requests, m.duration, m.inFlight, m.clients}
}

func (m *HTTPMetrics) Middleware(next http.Handler) http.Handler {
	if m == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isHealthProbePath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}

		m.inFlight.Inc()
		defer m.inFlight.Dec()

		start := time.Now()
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
		mark := &authMark{}
		next.ServeHTTP(ww, r.WithContext(context.WithValue(r.Context(), authMarkKey{}, mark)))

		status := ww.Status()
		if status == 0 {
			status = http.StatusOK
		}
		route := routePattern(r)
		statusLabel := strconv.Itoa(status)
		labels := prometheus.Labels{
			"method": r.Method,
			"route":  route,
			"status": statusLabel,
		}
		m.requests.With(labels).Inc()
		m.duration.With(labels).Observe(time.Since(start).Seconds())
		if client := m.clientLabels(r, mark.ok.Load(), status); client != nil {
			m.clients.With(client).Inc()
		}
	})
}

func routePattern(r *http.Request) string {
	if rctx := chi.RouteContext(r.Context()); rctx != nil {
		if pattern := rctx.RoutePattern(); pattern != "" {
			return pattern
		}
	}
	return "unmatched"
}

func isHealthProbePath(path string) bool {
	switch path {
	case "/health", "/healthz", "/readyz":
		return true
	default:
		return false
	}
}

// ClientHeaderNames are the platform, version and update headers the client
// series read, for the test that holds them to middleware's.
func ClientHeaderNames() [3]string {
	return [3]string{headerClientPlatform, headerClientVersion, headerClientUpdateID}
}
