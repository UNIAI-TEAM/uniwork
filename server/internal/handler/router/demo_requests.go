package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"net/http"
)

func registerDemoRequests(r api, h Routes, limit func(http.Handler) http.Handler) {
	r.With(limit).Post("/demo-requests", h.CreateDemoRequest, apiOp{summary: "Request a demo", description: "Lưu yêu cầu demo từ khách truy cập. Idempotency-Key bắt buộc; chỉ trả biên nhận, không trả thông tin cá nhân.", tags: []string{"demo-requests"}, sdi: sdi.CreateDemoRequestSDI{}, sdo: sdo.DemoRequestReceiptSDO{}, status: http.StatusCreated})
}
