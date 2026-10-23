package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// tag: files — FileService read path (T4, spec 2026-09-22 section 8).
//
//	POST /api/v1/workspaces/{workspaceID}/files/resolve
func registerFiles(r api, h Routes) {
	r.Post("/workspaces/{workspaceID}/files/resolve", h.ResolveWorkspaceFiles, apiOp{
		summary: "Resolve my staged uploads",
		description: "Metadata và URL đọc cho các tệp người gọi vừa tải lên trong workspace, chưa được module nào gắn (phiên tải lên). " +
			"Mỗi file_id một mục theo đúng thứ tự; tệp bị từ chối có error riêng (file_not_found, file_deleting, file_claim_expired, file_upload_canceled...) và không có URL. " +
			"access=presign: URL ký lộ host/đường dẫn storage; access=proxy: URL API che vị trí lưu. url_expires_at tối đa 12 giờ, sớm hơn theo phiên tải lên hoặc phiên đăng nhập; client không tự làm mới URL khi hết hạn và không lưu URL vào nội dung.",
		tags: []string{"files"},
		sdi:  sdi.ResolveFilesSDI{},
		sdo:  sdo.ResolveFilesSDO{},
		auth: true,
	})
}

// registerFileContent mounts the ticketed proxy route outside RequireAuth:
// native img/audio/video cannot send a Bearer header, so the ticket in the
// query identifies the caller and the service re-checks the live session and
// permission on every request. HEAD is served by the same handler; the api
// wrapper has no Head method, so it is bound and catalogued here.
//
//	GET|HEAD /api/v1/files/{fileID}/content?ticket=...
func registerFileContent(r api, h Routes) {
	r.Get("/files/{fileID}/content", h.GetFileContent, apiOp{
		summary: "Stream a file through the proxy",
		description: "Stream bytes của tệp theo ticket trong URL do /files/resolve trả về (không cần Bearer). Mỗi request kiểm lại ticket, phiên đăng nhập còn sống, quyền workspace và trạng thái tệp; " +
			"ticket sai, hết hạn hoặc phiên đã thu hồi trả 404. Hỗ trợ HEAD, Range (206) và 416 kèm Content-Range: bytes */size. Cache-Control: private, no-store.",
		tags:     []string{"files"},
		produces: "application/octet-stream",
	})
	r.r.Head("/files/{fileID}/content", h.GetFileContent)
	r.cat.add(http.MethodHead, joinRoute(r.prefix, "/files/{fileID}/content"), apiOp{
		summary:     "Headers of a proxied file",
		description: "Như GET nhưng không có body: Content-Length, Content-Type, Accept-Ranges, Content-Range khi có Range. Kiểm quyền giống GET.",
		tags:        []string{"files"},
	})
}
