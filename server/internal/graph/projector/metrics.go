package projector

import "time"

// Metrics is implemented by internal/metrics.Graph; nil means no metrics.
// Labels never carry tenant or entity ids.
type Metrics interface {
	IncGraphMarked(topic, result string)
	IncGraphProjected(nodeType, result string)
	ObserveGraphLag(d time.Duration)
}
