package handler

import "net/http"

// health is liveness: 200 whenever the process answers. Readiness is /readyz.
func (h *handlers) health(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ready runs the dependency checks; 503 with the per-check report when any
// fails, so a rollout or a load balancer stops routing to this node.
func (h *handlers) ready(w http.ResponseWriter, r *http.Request) {
	rep := h.Readiness.Check(r.Context())
	status := http.StatusOK
	if !rep.Ready {
		status = http.StatusServiceUnavailable
	}
	respondJSON(w, status, rep)
}
