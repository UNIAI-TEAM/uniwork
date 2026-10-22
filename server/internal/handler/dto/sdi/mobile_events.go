package sdi

// MobileEventsSDI is POST /api/v1/mobile/events: a batch of UniChat mobile's
// anonymous product events, counted and dropped (metrics.MobileEvents).
type MobileEventsSDI struct {
	Events []MobileEventSDI `json:"events" maxItems:"20" description:"Tối đa 20 sự kiện; phần dư bị bỏ qua"`
}

// MobileEventSDI is one product event: a name and a result from a closed set,
// and for the timed ones how long the step took.
type MobileEventSDI struct {
	Name       string   `json:"name" enum:"app_open,first_screen,message_send,push_open,call_connect,call_push" description:"Sự kiện: mở app, màn đầu vẽ xong, gửi tin, mở từ push, nối cuộc gọi, push cuộc gọi tới máy" example:"message_send"`
	Result     string   `json:"result" description:"Kết quả: app_open cold|warm, first_screen ok, message_send sent|failed, push_open chat|call|other, call_connect connected (phòng media đã nối) | failed (bỏ cuộc trước khi media nối), call_push shown|fallback|in_app|ignored|cleared|lost" example:"sent"`
	DurationMs *float64 `json:"duration_ms,omitempty" description:"Mili giây của bước (first_screen; message_send; call_connect từ lúc bắt đầu nối tới lúc phòng media nối); bỏ qua với sự kiện khác" example:"420"`
}
