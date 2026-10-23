package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: signatures — the caller's own saved signature images (UNI-925 B6).
//
//	GET    /api/v1/orgs/{orgID}/signatures
//	POST   /api/v1/orgs/{orgID}/signatures
//	DELETE /api/v1/orgs/{orgID}/signatures/{signatureID}
//
// Personal rows inside one organization: the list answers only the caller's
// signatures, and a non-member gets 404 - the same answer as an organization
// that does not exist.
func registerSignatures(r api, h Routes) {
	r.Get("/orgs/{orgID}/signatures", h.ListSavedSignatures, apiOp{
		summary:     "List my saved signatures",
		description: "Chữ ký đã lưu của người gọi trong một tổ chức, mới nhất trước. Người ngoài tổ chức nhận 404.",
		tags:        []string{"signatures"},
		sdo:         sdo.SavedSignatureListSDO{},
		auth:        true,
	})
	r.Post("/orgs/{orgID}/signatures", h.CreateSavedSignature, apiOp{
		summary:     "Save a signature",
		description: "Lưu một ảnh chữ ký (PNG hoặc JPEG, base64, tối đa 512 KiB sau giải mã) cho người gọi trong tổ chức.",
		tags:        []string{"signatures"},
		sdi:         sdi.CreateSavedSignatureSDI{},
		sdo:         sdo.SavedSignatureSDO{},
		status:      http.StatusCreated,
		auth:        true,
	})
	r.Delete("/orgs/{orgID}/signatures/{signatureID}", h.DeleteSavedSignature, apiOp{
		summary:     "Delete a saved signature",
		description: "Xoá một chữ ký đã lưu của người gọi. Chữ ký của người khác hoặc tổ chức khác trả 404.",
		tags:        []string{"signatures"},
		sdo:         sdo.StatusSDO{},
		auth:        true,
	})
}
