package sdo

import "encoding/json"

// SessionSDO is the body of register, login and refresh.
type SessionSDO struct {
	User        UserDTO           `json:"user"`
	AccessToken string            `json:"access_token" description:"JWT access token, gửi kèm Authorization Bearer" example:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.example"`
	Matrix      *MatrixSessionSDO `json:"matrix,omitempty" description:"Matrix session when Synapse is configured"`
}

// UserSDO wraps the current user.
type UserSDO struct {
	User UserDTO `json:"user"`
}

type UserDTO struct {
	ID                      string          `json:"id" description:"ULID người dùng" example:"01J8X4K2M0N1P2Q3R4S5T6U7V8"`
	Email                   string          `json:"email" format:"email" example:"an@acme.vn"`
	DisplayName             string          `json:"display_name" example:"Nguyễn Văn An"`
	AvatarURL               string          `json:"avatar_url,omitempty" description:"URL avatar công khai khi đã tải lên" example:"https://cdn.example.com/avatars/an.png"`
	OnboardedAt             *string         `json:"onboarded_at" description:"Thời điểm hoàn thành onboarding (RFC3339); null nếu chưa xong" example:"2026-08-01T09:00:00Z"`
	EmailVerifiedAt         *string         `json:"email_verified_at" description:"Thời điểm xác nhận email (RFC3339); null nếu chưa xác nhận" example:"2026-08-01T09:00:00Z"`
	OnboardingQuestionnaire json.RawMessage `json:"onboarding_questionnaire" description:"JSON câu hỏi onboarding đã lưu" example:"{\"role\":\"lead\"}"`
}

// AuthProvidersSDO is GET /api/v1/auth/providers.
type AuthProvidersSDO struct {
	Google bool `json:"google" description:"true khi Google sign-in được cấu hình trên server" example:"true"`
}
