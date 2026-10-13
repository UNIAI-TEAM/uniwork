package sdi

// CreatePrivacyDeletionSDI confirms erasure by the organization's slug.
type CreatePrivacyDeletionSDI struct {
	ConfirmSlug string `json:"confirm_slug" description:"Định danh tổ chức, gõ lại để xác nhận xóa" example:"truong-tieu-hoc" required:"true"`
}
