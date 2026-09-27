package metrics

import "github.com/prometheus/client_golang/prometheus"

// Documents counts what the document service cannot report any other way
// (C-01 §3.6): an access-log row it failed to write after the read it
// belongs to already succeeded. It satisfies service.DocumentAccessMetrics.
type Documents struct {
	AccessLogFailed prometheus.Counter
}

func NewDocuments() *Documents {
	return &Documents{
		AccessLogFailed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "uniwork_document_access_log_failed_total",
			Help: "Document access-log rows that could not be written; the read itself succeeded.",
		}),
	}
}

func (d *Documents) Collectors() []prometheus.Collector {
	return []prometheus.Collector{d.AccessLogFailed}
}

func (d *Documents) IncDocumentAccessLogFailed() { d.AccessLogFailed.Inc() }
