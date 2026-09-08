package handler

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// workManagementCapabilityStub answers every catalogue disposition:stubbed
// route with capability_unavailable — no fake DB rows or file writes.
func (h *handlers) workManagementCapabilityStub(w http.ResponseWriter, r *http.Request) {
	pattern := ""
	if rc := chi.RouteContext(r.Context()); rc != nil {
		pattern = rc.RoutePattern()
	}
	reason, msg := stubReason(r.Method, pattern)
	h.mapServiceError(w, service.CapabilityUnavailable(reason, msg))
}

func stubReason(method, pattern string) (reason, msg string) {
	p := strings.ToLower(pattern)
	switch {
	case strings.Contains(p, "/vcs/"):
		return "vcs_not_ready", "VCS connections chưa khả dụng"
	case strings.Contains(p, "/pull-requests"):
		return "pull_requests_not_ready", "pull requests chưa khả dụng"
	case strings.Contains(p, "/task-runs"), strings.Contains(p, "/active-task"),
		strings.Contains(p, "/messages"), strings.HasSuffix(p, "/cancel"),
		strings.HasSuffix(p, "/rerun"), strings.Contains(p, "/retry-source-context"),
		strings.Contains(p, "/quick-actions"), strings.HasSuffix(p, "/usage"):
		return "agent_runtime_not_ready", "agent runtime chưa khả dụng"
	case strings.Contains(p, "/assignee-frequency"):
		return "assignee_frequency_not_ready", "assignee frequency chưa khả dụng"
	case strings.Contains(p, "/limit-usage"):
		return "limit_usage_not_ready", "limit usage chưa khả dụng"
	case strings.HasSuffix(p, "/tasks/search"):
		return "task_search_not_ready", "task search chưa khả dụng"
	case strings.HasSuffix(p, "/move"):
		return "task_move_not_ready", "task move chưa khả dụng"
	case strings.Contains(p, "/preview-trigger"):
		return "preview_trigger_not_ready", "preview trigger chưa khả dụng"
	case strings.Contains(p, "/quick-create"):
		return "quick_create_not_ready", "quick create chưa khả dụng"
	default:
		_ = method
		return "not_ported", "capability chưa khả dụng"
	}
}
