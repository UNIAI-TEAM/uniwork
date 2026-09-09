package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// registerTasksSuiteStubs mounts every catalogue disposition:stubbed route
// inside the suite group. Handlers return capability_unavailable with
// fields.reason_code aligned to workcapability catalogue keys.
func registerTasksSuiteStubs(suite api, h Routes) {
	op := func(summary, description string) apiOp {
		return apiOp{
			summary:     summary,
			description: description,
			tags:        []string{"tasks"},
			sdo:         sdo.StatusSDO{},
			auth:        true,
		}
	}

	suite.Get("/tasks/{taskID}/active-task", h.WorkManagementCapabilityStub, op(
		"Active agent task (stub)",
		"Returns 422 capability_unavailable with reason_code agent_runtime_missing.",
	))
	suite.Get("/tasks/{taskID}/messages", h.WorkManagementCapabilityStub, op(
		"Agent task messages (stub)",
		"Returns 422 capability_unavailable with reason_code agent_runtime_missing.",
	))
	suite.Get("/tasks/{taskID}/pull-requests", h.WorkManagementCapabilityStub, op(
		"Task pull requests (stub)",
		"Returns 422 capability_unavailable with reason_code vcs_provider_missing.",
	))
	suite.Get("/tasks/{taskID}/task-runs", h.WorkManagementCapabilityStub, op(
		"Task runs (stub)",
		"Returns 422 capability_unavailable with reason_code agent_runtime_missing.",
	))
	suite.Get("/tasks/{taskID}/usage", h.WorkManagementCapabilityStub, op(
		"Task usage (stub)",
		"Returns 422 capability_unavailable with reason_code agent_runtime_missing.",
	))
	suite.Post("/tasks/{taskID}/cancel", h.WorkManagementCapabilityStub, op(
		"Cancel agent task (stub)",
		"Returns 422 capability_unavailable with reason_code agent_runtime_missing.",
	))
	suite.Post("/tasks/{taskID}/terminate", h.WorkManagementCapabilityStub, op(
		"Terminate agent task (stub)",
		"Alias of cancel. Returns 422 capability_unavailable with reason_code agent_runtime_missing.",
	))
	suite.Post("/tasks/{taskID}/rerun", h.WorkManagementCapabilityStub, op(
		"Rerun agent task (stub)",
		"Returns 422 capability_unavailable with reason_code agent_runtime_missing.",
	))
	suite.Post("/tasks/{taskID}/retry-source-context", h.WorkManagementCapabilityStub, op(
		"Retry source context (stub)",
		"Returns 422 capability_unavailable with reason_code agent_runtime_missing.",
	))
	suite.Post("/tasks/{taskID}/move", h.WorkManagementCapabilityStub, op(
		"Move task (stub)", "Board move stub.",
	))
	suite.Post("/tasks/{taskID}/quick-actions/{quickActionID}/render", h.WorkManagementCapabilityStub, op(
		"Render quick action (stub)",
		"Returns 422 capability_unavailable with reason_code agent_runtime_missing.",
	))
	suite.Post("/tasks/{taskID}/quick-actions/{quickActionID}/run", h.WorkManagementCapabilityStub, op(
		"Run quick action (stub)",
		"Returns 422 capability_unavailable with reason_code agent_runtime_missing.",
	))
	suite.Post("/tasks/{taskID}/tasks/{agentTaskID}/cancel", h.WorkManagementCapabilityStub, op(
		"Cancel nested agent task (stub)",
		"Returns 422 capability_unavailable with reason_code agent_runtime_missing.",
	))

	suite.Get("/workspaces/{workspaceID}/assignee-frequency", h.WorkManagementCapabilityStub, op(
		"Assignee frequency (stub)", "Assignee frequency stub.",
	))
	suite.Get("/workspaces/{workspaceID}/tasks/limit-usage", h.WorkManagementCapabilityStub, op(
		"Task limit usage (stub)", "Limit usage stub.",
	))
	suite.Get("/workspaces/{workspaceID}/tasks/search", h.WorkManagementCapabilityStub, op(
		"Search tasks (stub)", "Task search stub (use /tasks/query).",
	))
	suite.Post("/workspaces/{workspaceID}/tasks/preview-trigger", h.WorkManagementCapabilityStub, op(
		"Preview trigger (stub)", "Agent trigger stub.",
	))
	suite.Post("/workspaces/{workspaceID}/tasks/quick-create", h.WorkManagementCapabilityStub, op(
		"Quick create task (stub)", "Quick create stub.",
	))

	suite.Get("/workspaces/{workspaceID}/squads", h.WorkManagementCapabilityStub, op(
		"List squads (stub)",
		"Returns 422 capability_unavailable with reason_code squad_directory_missing.",
	))
	suite.Post("/workspaces/{workspaceID}/squads", h.WorkManagementCapabilityStub, op(
		"Create squad (stub)",
		"Returns 422 capability_unavailable with reason_code squad_directory_missing.",
	))
	suite.Get("/workspaces/{workspaceID}/workdir", h.WorkManagementCapabilityStub, op(
		"Workdir status (stub)",
		"Returns 422 capability_unavailable with reason_code local_daemon_missing.",
	))

	suite.Get("/workspaces/{workspaceID}/vcs/connections", h.WorkManagementCapabilityStub, op(
		"List VCS connections (stub)",
		"Returns 422 capability_unavailable with reason_code vcs_provider_missing.",
	))
	suite.Post("/workspaces/{workspaceID}/vcs/connections", h.WorkManagementCapabilityStub, op(
		"Create VCS connection (stub)",
		"Returns 422 capability_unavailable with reason_code vcs_provider_missing.",
	))
	suite.Delete("/workspaces/{workspaceID}/vcs/connections/{connectionID}", h.WorkManagementCapabilityStub, op(
		"Delete VCS connection (stub)",
		"Returns 422 capability_unavailable with reason_code vcs_provider_missing.",
	))
	suite.Post("/workspaces/{workspaceID}/vcs/connections/{connectionID}/rotate-webhook", h.WorkManagementCapabilityStub, op(
		"Rotate VCS webhook (stub)",
		"Returns 422 capability_unavailable with reason_code vcs_provider_missing.",
	))
}
