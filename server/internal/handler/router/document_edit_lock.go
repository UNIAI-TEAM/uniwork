package router

import (
	"net/http"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// registerDocumentEditLock is the document edit lock (UNI-1645, addendum
// 2026-10-15 §3.1): one human editor per document at a time, R1-R10. d is
// the documents group behind the `documents` flag. Every route runs the
// document read gate first, so a document the caller cannot read is 404
// before any lock or request is looked up; a lock or request id is looked up
// under the document, so another document's or organization's id is 404 too.
// editRequestLimit is R8's per-person budget (Redis, fail-open); the service
// adds a database cap that holds without Redis.
func registerDocumentEditLock(d api, h Routes, editRequestLimit func(http.Handler) http.Handler) {
	const lockErrs = " 401 không phiên; 404 không đọc được tài liệu (không lộ tồn tại); 403 member_deactivated / organization_suspended."
	d.Get("/documents/{documentID}/edit-lock", h.GetDocumentEditLock, apiOp{
		summary: "Get the document edit lock state",
		description: "Ai đang sửa tài liệu (lock: null khi không ai giữ), yêu cầu đang chờ của người gọi, yêu cầu gửi người giữ (chỉ khi người gọi giữ), can_take_over, can_request. Cần quyền xem. " +
			"Chỉ đọc: nhiệm kỳ quá hạn đọc ra null nhưng không bị kết thúc ở đây, không ghi audit/outbox. lock.lock_id chỉ có khi người gọi có quyền manage và không phải người giữ." + lockErrs,
		tags: []string{"documents"}, sdo: sdo.DocumentEditLockStateSDO{}, auth: true,
	})
	d.Post("/documents/{documentID}/edit-lock", h.AcquireDocumentEditLock, apiOp{
		summary: "Acquire the document edit lock",
		description: "Lấy khóa sửa cho một editor (editor_id do client sinh). 201 nhiệm kỳ mới; 200 khi người gọi đã giữ với cùng editor_id (idempotent) hoặc nhận khóa được nhường. " +
			"Người khác giữ (kể cả cùng editor_id khác người) hoặc cùng người ở editor khác -> 423 document_locked (fields: holder_id, holder_name, since, expires_at, offline_hold_until?, held_by_me, current_revision; không có lock_id). " +
			"move_from_self=true khi chính người gọi giữ ở tab/thiết bị khác: chuyển khóa về editor này (granted_via=move_here). Dưới quyền sửa -> 403 forbidden; agent -> 404." + lockErrs,
		tags: []string{"documents"}, sdi: sdi.AcquireDocumentEditLockSDI{}, sdo: sdo.DocumentEditLockSDO{}, status: http.StatusCreated, auth: true,
	})
	d.Post("/documents/{documentID}/edit-lock/take-over", h.TakeOverDocumentEditLock, apiOp{
		summary: "Take over the document edit lock",
		description: "Người có quyền manage kết thúc nhiệm kỳ đang sống (kể cả khi người giữ đang giữ offline) và giữ khóa: 201. " +
			"expected_lock_id khác nhiệm kỳ sống -> 409 edit_lock_changed (đọc lại GET .../edit-lock); không ai giữ -> 409 edit_lock_free; chính người gọi giữ -> 409 edit_lock_held_by_me; dưới manage -> 403 forbidden; agent -> 404." + lockErrs,
		tags: []string{"documents"}, sdi: sdi.TakeOverDocumentEditLockSDI{}, sdo: sdo.DocumentEditLockSDO{}, status: http.StatusCreated, auth: true,
	})
	d.Post("/documents/{documentID}/edit-lock/{lockID}/heartbeat", h.HeartbeatDocumentEditLock, apiOp{
		summary: "Heartbeat the document edit lock",
		description: "Gia hạn nhiệm kỳ của người gọi thêm TTL tính từ giờ server; quyền sửa được tính lại mỗi lần (mất quyền -> nhiệm kỳ kết thúc và trả lỗi của cổng). " +
			"Nhiệm kỳ đã kết thúc hoặc của người khác -> 409 edit_lock_lost (fields.reason; by_id/by_name khi taken_over/handed_over); heartbeat muộn không hồi sinh khóa. lockID không thuộc tài liệu -> 404." + lockErrs,
		tags: []string{"documents"}, sdo: sdo.DocumentEditHeartbeatSDO{}, auth: true,
	})
	d.Delete("/documents/{documentID}/edit-lock/{lockID}", h.ReleaseDocumentEditLock, apiOp{
		summary:     "Release the document edit lock",
		description: "Nhả nhiệm kỳ của người gọi: 204, idempotent (đã kết thúc cũng 204). lockID không thuộc tài liệu hoặc không phải của người gọi -> 404 (không phân biệt). Cần quyền xem." + lockErrs,
		tags:        []string{"documents"}, status: http.StatusNoContent, auth: true,
	})
	d.Put("/documents/{documentID}/edit-lock/{lockID}/offline-hold", h.PutDocumentEditHold, apiOp{
		summary: "Start or renew an offline edit hold",
		description: "Giữ quyền sửa khi offline cho nhiệm kỳ của người gọi, từ phiên thiết bị desktop (phiên bearer): hạn = min(now + DOCUMENT_EDIT_HOLD_MAX, đầu chuỗi + DOCUMENT_EDIT_HOLD_CHAIN_MAX, hạn phiên thiết bị). " +
			"Phiên trình duyệt hoặc thiết bị không còn sống -> 403 edit_hold_device_required; hết trần chuỗi hoặc không gia hạn thêm được -> 409 edit_hold_cap_reached; nhiệm kỳ đã kết thúc -> 409 edit_lock_lost; lockID không phải của người gọi -> 404; agent -> 404." + lockErrs,
		tags: []string{"documents"}, sdi: sdi.PutDocumentEditHoldSDI{}, sdo: sdo.DocumentEditLockSDO{}, auth: true,
	})
	d.Delete("/documents/{documentID}/edit-lock/{lockID}/offline-hold", h.ClearDocumentEditHold, apiOp{
		summary:     "End an offline edit hold",
		description: "Bỏ giữ offline, nhiệm kỳ quay về TTL heartbeat: 200, idempotent (không có hold cũng 200). Nhiệm kỳ đã kết thúc -> 409 edit_lock_lost; lockID không phải của người gọi -> 404; agent -> 404." + lockErrs,
		tags:        []string{"documents"}, sdo: sdo.DocumentEditLockSDO{}, auth: true,
	})
	d.With(editRequestLimit).Post("/documents/{documentID}/edit-requests", h.CreateDocumentEditRequest, apiOp{
		summary: "Request the document edit lock",
		description: "Yêu cầu người đang giữ nhường quyền sửa: 201; đã có yêu cầu đang chờ còn hạn -> 200 (trả yêu cầu cũ). Không ai giữ -> 409 edit_lock_free; người gọi đang giữ -> 409 edit_request_to_self. " +
			"Quá 20 lần/phút mỗi người hoặc DOCUMENT_EDIT_REQUEST_MAX_PER_HOUR mỗi tài liệu mỗi giờ -> 429 edit_request_rate_limited (fields.retry_after_s). Dưới quyền sửa -> 403 forbidden; agent -> 404." + lockErrs,
		tags: []string{"documents"}, sdi: sdi.CreateDocumentEditRequestSDI{}, sdo: sdo.DocumentEditRequestSDO{}, status: http.StatusCreated, auth: true,
	})
	d.Post("/documents/{documentID}/edit-requests/{requestID}/answer", h.AnswerDocumentEditRequest, apiOp{
		summary: "Answer a document edit request",
		description: "Người giữ chấp nhận (nhường: tạo nhiệm kỳ dự trữ cho người yêu cầu, họ nhận bằng POST .../edit-lock) hoặc từ chối: 200. Thứ tự: requestID không thuộc tài liệu hoặc không gửi người gọi -> 404; " +
			"lock_id khác nhiệm kỳ của yêu cầu -> 409 edit_lock_changed; đã trả lời/hủy/thay thế -> 409 edit_request_closed; hết hạn -> 410 edit_request_expired; người gọi không còn giữ -> 409 edit_lock_lost. Agent -> 404." + lockErrs,
		tags: []string{"documents"}, sdi: sdi.AnswerDocumentEditRequestSDI{}, sdo: sdo.DocumentEditRequestSDO{}, auth: true,
	})
	d.Delete("/documents/{documentID}/edit-requests/{requestID}", h.CancelDocumentEditRequest, apiOp{
		summary:     "Cancel my document edit request",
		description: "Người yêu cầu hủy yêu cầu của mình: 204, idempotent (cả khi đã trả lời/hết hạn). requestID không thuộc tài liệu hoặc không phải của người gọi -> 404. Cần quyền xem." + lockErrs,
		tags:        []string{"documents"}, status: http.StatusNoContent, auth: true,
	})
}
