package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: onboarding — workspace-scoped onboarding side effects. Requires Bearer.
// Questionnaire save/complete live under tag me (/me/onboarding).
//
//	POST /api/v1/workspaces/{workspaceID}/welcome-task
func registerOnboarding(r api, h Routes) {
	r.Post("/workspaces/{workspaceID}/welcome-task", h.SeedWelcomeTask, apiOp{
		summary:     "Seed welcome task",
		description: "Tạo công việc chào mừng onboarding nếu chưa có.",
		tags:        []string{"onboarding"},
		sdo:         sdo.TaskSDO{},
		auth:        true,
	})
}
