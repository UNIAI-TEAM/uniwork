// Package workcapability publishes the Work Management capability contract
// that GET /api/v1/config exposes to clients. Unavailable entries stay
// visible-disabled with a stable reason_code — never fake mutation success.
package workcapability

// Status is the public capability availability state.
type Status string

const (
	Available   Status = "available"
	Unavailable Status = "unavailable"
)

// Entry is one capability advertised to the frontend.
type Entry struct {
	Status         Status `json:"status"`
	ReasonCode     string `json:"reason_code,omitempty"`
	ExplanationKey string `json:"explanation_key,omitempty"`
}

// catalogue is the source of truth for the initial Work Management rollout.
// Available entries leave reason/explanation empty; unavailable entries carry
// a stable reason_code and a capabilities.* explanation key.
var catalogue = map[string]Entry{
	"tasks.core": {
		Status: Available,
	},
	"tasks.projects": {
		Status:         Unavailable,
		ReasonCode:     "surface_not_ready",
		ExplanationKey: "capabilities.surface_not_ready",
	},
	"tasks.attachments": {
		Status: Available,
	},
	"tasks.agent_runs": {
		Status:         Unavailable,
		ReasonCode:     "agent_runtime_missing",
		ExplanationKey: "capabilities.agent_runtime_missing",
	},
	"tasks.squads": {
		Status:         Unavailable,
		ReasonCode:     "squad_directory_missing",
		ExplanationKey: "capabilities.squad_directory_missing",
	},
	"tasks.vcs": {
		Status:         Unavailable,
		ReasonCode:     "vcs_provider_missing",
		ExplanationKey: "capabilities.vcs_provider_missing",
	},
	"tasks.local_workdir": {
		Status:         Unavailable,
		ReasonCode:     "local_daemon_missing",
		ExplanationKey: "capabilities.local_daemon_missing",
	},
	"desktop.host": {
		Status:         Unavailable,
		ReasonCode:     "host_not_built",
		ExplanationKey: "capabilities.host_not_built",
	},
	"mobile.host": {
		Status:         Unavailable,
		ReasonCode:     "host_not_built",
		ExplanationKey: "capabilities.host_not_built",
	},
}

// Catalogue returns a defensive copy of the capability map so callers cannot
// mutate the package-level source of truth.
func Catalogue() map[string]Entry {
	out := make(map[string]Entry, len(catalogue))
	for k, v := range catalogue {
		out[k] = v
	}
	return out
}
