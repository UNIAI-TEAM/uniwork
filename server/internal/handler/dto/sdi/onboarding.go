package sdi

import "encoding/json"

// PatchOnboardingSDI is PATCH /api/v1/me/onboarding.
type PatchOnboardingSDI struct {
	Questionnaire json.RawMessage `json:"questionnaire" description:"Câu trả lời onboarding dạng object JSON" example:"{\"role\":\"lead\"}"`
}

// CompleteOnboardingSDI is POST /api/v1/me/onboarding/complete.
type CompleteOnboardingSDI struct {
	CompletionPath string `json:"completion_path" description:"Cách người dùng hoàn thành onboarding" example:"create_workspace"`
	WorkspaceID    string `json:"workspace_id" description:"Workspace vào sau khi onboarding" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
}
