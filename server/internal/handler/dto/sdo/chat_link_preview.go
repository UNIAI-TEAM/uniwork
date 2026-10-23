package sdo

// ChatLinkPreviewDTO is the card of the first link a message names (ADR 0035):
// read by the server when the message was sent, picture kept in UniWork
// storage, so showing it never contacts the linked site.
type ChatLinkPreviewDTO struct {
	MessageID         string `json:"message_id" description:"Tin nhắn có liên kết" example:"01J8X4MSG0N1P2Q3R4S5T6U7V8"`
	URL               string `json:"url" description:"Liên kết đầu tiên của tin (không có phần #)" example:"https://uniwork.vn/blog/ra-mat-q4"`
	Title             string `json:"title" description:"og:title, hoặc thẻ title của trang; có thể trống khi trang chỉ có mô tả" example:"UniWork Q4: làm việc cùng AI cho đội nhóm Việt"`
	Description       string `json:"description,omitempty" description:"og:description hoặc meta description, tối đa 500 ký tự" example:"Việc, cuộc họp, tài liệu và quy trình ở một nơi."`
	SiteName          string `json:"site_name,omitempty" description:"og:site_name, hoặc tên miền khi trang không khai" example:"uniwork.vn"`
	ImageURL          string `json:"image_url,omitempty" description:"URL presign ngắn hạn của ảnh đã lưu trong kho UniWork; trống khi trang không có ảnh hợp lệ" example:"https://storage.example.com/uniwork/chat/link-previews/01J8X4FILE?X-Amz-Signature=abc"`
	ImageURLExpiresAt string `json:"image_url_expires_at,omitempty" description:"Thời điểm image_url hết hạn (RFC3339)" example:"2026-10-18T22:00:00Z"`
}

// ChatLinkPreviewListSDO is GET .../chat/rooms/{roomID}/link-previews.
type ChatLinkPreviewListSDO struct {
	Previews []ChatLinkPreviewDTO `json:"previews" description:"Thẻ xem trước của các tin đã có; tin chưa có thẻ, tải lỗi hoặc bị chặn không có mục nào"`
}
