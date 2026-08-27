package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: me — current user. Requires Bearer.
//
//	GET   /api/v1/me
//	PATCH /api/v1/me
//	POST  /api/v1/me/avatar
//	PATCH /api/v1/me/onboarding
//	POST  /api/v1/me/onboarding/complete
//	GET   /api/v1/me/invitations
func registerMe(r api, h Routes) {
	r.Get("/me", h.Me, apiOp{
		summary:     "Current user",
		description: "Trả người dùng đang đăng nhập, gồm trạng thái onboarding.",
		tags:        []string{"me"},
		sdo:         sdo.UserSDO{},
		auth:        true,
	})
	r.Patch("/me", h.PatchMe, apiOp{
		summary:     "Update profile",
		description: "Đổi tên hiển thị của người dùng đang đăng nhập.",
		tags:        []string{"me"},
		sdi:         sdi.PatchMeSDI{},
		sdo:         sdo.UserSDO{},
		auth:        true,
	})
	r.Post("/me/avatar", h.UploadAvatar, apiOp{
		summary:     "Upload avatar",
		description: "Thay avatar. Tên field multipart là file. PNG, JPEG, GIF hoặc WebP, tối đa 2 MiB.",
		tags:        []string{"me"},
		sdi:         sdi.UploadAvatarSDI{},
		sdo:         sdo.UserSDO{},
		auth:        true,
	})
	r.Patch("/me/onboarding", h.PatchOnboarding, apiOp{
		summary:     "Save onboarding questionnaire",
		description: "Lưu câu trả lời onboarding, chưa đánh dấu hoàn thành.",
		tags:        []string{"me"},
		sdi:         sdi.PatchOnboardingSDI{},
		sdo:         sdo.UserSDO{},
		auth:        true,
	})
	r.Post("/me/onboarding/complete", h.CompleteOnboarding, apiOp{
		summary:     "Complete onboarding",
		description: "Ghi onboarded_at. Bắt buộc trước khi vào workspace.",
		tags:        []string{"me"},
		sdi:         sdi.CompleteOnboardingSDI{},
		sdo:         sdo.UserSDO{},
		auth:        true,
	})
	r.Get("/me/invitations", h.MyInvitations, apiOp{
		summary:     "List pending invitations",
		description: "Lời mời gửi tới email hiện tại và vẫn còn hiệu lực.",
		tags:        []string{"me"},
		sdo:         sdo.PendingInvitationListSDO{},
		auth:        true,
	})
}
