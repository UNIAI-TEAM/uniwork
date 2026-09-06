package metrics

import (
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"

	"github.com/unicomhub/uniwork/server/internal/realtime"
)

type RegistryOptions struct {
	Pool     *pgxpool.Pool
	Realtime *realtime.Metrics
	Version  string
	Commit   string
}

type Registry struct {
	Gatherer      prometheus.Gatherer
	HTTP          *HTTPMetrics
	Emails        *prometheus.CounterVec
	Meetings      *Meetings
	Outbox        *Outbox
	Notifications *Notifications
}

func NewRegistry(opts RegistryOptions) *Registry {
	reg := prometheus.NewRegistry()
	reg.MustRegister(collectors.NewGoCollector())
	reg.MustRegister(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))

	buildInfo := prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "uniwork_build_info",
		Help: "Build information for the UniWork server binary.",
	}, []string{"version", "commit"})
	buildInfo.WithLabelValues(defaultLabel(opts.Version, "dev"), defaultLabel(opts.Commit, "unknown")).Set(1)
	reg.MustRegister(buildInfo)

	httpMetrics := NewHTTPMetrics()
	reg.MustRegister(httpMetrics.Collectors()...)

	if opts.Pool != nil {
		reg.MustRegister(NewDBCollector(opts.Pool))
		reg.MustRegister(NewMeetingLagCollector(opts.Pool))
		reg.MustRegister(NewOutboxLagCollector(opts.Pool))
	}
	if opts.Realtime != nil {
		reg.MustRegister(NewRealtimeCollector(opts.Realtime))
	}

	emails := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "uniwork_emails_total",
		Help: "Outbox delivery outcomes by kind.",
	}, []string{"kind", "result"})
	reg.MustRegister(emails)

	meetingMetrics := NewMeetings()
	reg.MustRegister(meetingMetrics.Collectors()...)

	outboxMetrics := NewOutbox()
	reg.MustRegister(outboxMetrics.Collectors()...)

	notificationMetrics := NewNotifications()
	reg.MustRegister(notificationMetrics.Collectors()...)

	return &Registry{
		Gatherer:      reg,
		HTTP:          httpMetrics,
		Emails:        emails,
		Meetings:      meetingMetrics,
		Outbox:        outboxMetrics,
		Notifications: notificationMetrics,
	}
}

func defaultLabel(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}
