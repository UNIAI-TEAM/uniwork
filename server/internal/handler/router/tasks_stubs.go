package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// registerTasksSuiteStubs mounts every catalogue disposition:stubbed route
// inside the flag-gated suite group. Handlers return capability_unavailable.
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
		"Active agent task (stub)", "Agent runtime stub. Flag tasks_work_management_parity.",
	))
	suite.Get("/tasks/{taskID}/messages", h.WorkManagementCapabilityStub, op(
		"Agent task messages (stub)", "Agent runtime stub. Flag tasks_work_management_parity.",
	))
	suite.Get("/tasks/{taskID}/pull-requests", h.WorkManagementCapabilityStub, op(
		"Task pull requests (stub)", "PR integration stub. Flag tasks_work_management_parity.",
	))
	suite.Get("/tasks/{taskID}/task-runs", h.WorkManagementCapabilityStub, op(
		"Task runs (stub)", "Agent runtime stub. Flag tasks_work_management_parity.",
	))
	suite.Get("/tasks/{taskID}/usage", h.WorkManagementCapabilityStub, op(
		"Task usage (stub)", "Agent runtime stub. Flag tasks_work_management_parity.",
	))
	suite.Post("/tasks/{taskID}/cancel", h.WorkManagementCapabilityStub, op(
		"Cancel agent task (stub)", "Agent runtime stub. Flag tasks_work_management_parity.",
	))
	suite.Post("/tasks/{taskID}/rerun", h.WorkManagementCapabilityStub, op(
		"Rerun agent task (stub)", "Agent runtime stub. Flag tasks_work_management_parity.",
	))
	suite.Post("/tasks/{taskID}/retry-source-context", h.WorkManagementCapabilityStub, op(
		"Retry source context (stub)", "Agent runtime stub. Flag tasks_work_management_parity.",
	))
	suite.Post("/tasks/{taskID}/move", h.WorkManagementCapabilityStub, op(
		"Move task (stub)", "Board move stub. Flag tasks_work_management_parity.",
	))
	suite.Post("/tasks/{taskID}/quick-actions/{quickActionID}/render", h.WorkManagementCapabilityStub, op(
		"Render quick action (stub)", "Agent quick-action stub. Flag tasks_work_management_parity.",
	))
	suite.Post("/tasks/{taskID}/quick-actions/{quickActionID}/run", h.WorkManagementCapabilityStub, op(
		"Run quick action (stub)", "Agent quick-action stub. Flag tasks_work_management_parity.",
	))
	suite.Post("/tasks/{taskID}/tasks/{agentTaskID}/cancel", h.WorkManagementCapabilityStub, op(
		"Cancel nested agent task (stub)", "Agent runtime stub. Flag tasks_work_management_parity.",
	))

	suite.Get("/workspaces/{workspaceID}/assignee-frequency", h.WorkManagementCapabilityStub, op(
		"Assignee frequency (stub)", "Assignee frequency stub. Flag tasks_work_management_parity.",
	))
	suite.Get("/workspaces/{workspaceID}/tasks/limit-usage", h.WorkManagementCapabilityStub, op(
		"Task limit usage (stub)", "Limit usage stub. Flag tasks_work_management_parity.",
	))
	suite.Get("/workspaces/{workspaceID}/tasks/search", h.WorkManagementCapabilityStub, op(
		"Search tasks (stub)", "Task search stub (use /tasks/query). Flag tasks_work_management_parity.",
	))
	suite.Post("/workspaces/{workspaceID}/tasks/preview-trigger", h.WorkManagementCapabilityStub, op(
		"Preview trigger (stub)", "Agent trigger stub. Flag tasks_work_management_parity.",
	))
	suite.Post("/workspaces/{workspaceID}/tasks/quick-create", h.WorkManagementCapabilityStub, op(
		"Quick create task (stub)", "Quick create stub. Flag tasks_work_management_parity.",
	))

	suite.Get("/workspaces/{workspaceID}/vcs/connections", h.WorkManagementCapabilityStub, op(
		"List VCS connections (stub)", "VCS stub. Flag tasks_work_management_parity.",
	))
	suite.Post("/workspaces/{workspaceID}/vcs/connections", h.WorkManagementCapabilityStub, op(
		"Create VCS connection (stub)", "VCS stub. Flag tasks_work_management_parity.",
	))
	suite.Delete("/workspaces/{workspaceID}/vcs/connections/{connectionID}", h.WorkManagementCapabilityStub, op(
		"Delete VCS connection (stub)", "VCS stub. Flag tasks_work_management_parity.",
	))
	suite.Post("/workspaces/{workspaceID}/vcs/connections/{connectionID}/rotate-webhook", h.WorkManagementCapabilityStub, op(
		"Rotate VCS webhook (stub)", "VCS stub. Flag tasks_work_management_parity.",
	))
}
