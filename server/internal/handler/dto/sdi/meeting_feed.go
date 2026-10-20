package sdi

// MeetingFeedSDI documents the query of GET /api/v1/meetings/{meetingID}/chat
// and /transcript. No cursor returns the newest page, oldest first.
type MeetingFeedSDI struct {
	Before string `query:"before" description:"Cursor older_cursor của trang trước: trả trang cũ hơn. Không dùng cùng after" example:"1791200000000000.01J8X4MSG0000000000000000"`
	After  string `query:"after" description:"Cursor after_cursor đã nhận: chỉ trả các dòng mới đến từ đó (có chồng lấn vài giây, client gộp theo id). Không dùng cùng before" example:"1791200000000000.01J8X4MSG0000000000000000"`
	Limit  int32  `query:"limit" description:"Kích thước trang (mặc định 200, tối đa 500)" example:"200"`
}

// MeetingEvidenceSDI documents the query of GET /api/v1/meetings/{meetingID}/evidence.
type MeetingEvidenceSDI struct {
	Refs string `query:"refs" description:"Căn cứ cần đọc: các cặp kind:id cách nhau bởi dấu phẩy, kind là segment, note hoặc chat; tối đa 20" example:"segment:01J8X4SEG0000000000000000,note:01J8X4NOTE000000000000000"`
}
