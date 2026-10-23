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

// TranscriptFeedSDI documents the query of GET /api/v1/meetings/{meetingID}/transcript:
// the feed cursors plus the forward reads of an ended meeting (UNI-1995 #9).
type TranscriptFeedSDI struct {
	MeetingFeedSDI
	Order  string `query:"order" enum:"asc,desc" description:"asc = đọc từ đầu cuộc họp (trang đầu, cũ nhất trước); mặc định desc = trang mới nhất" example:"asc"`
	From   string `query:"from" description:"Cursor newer_cursor của trang trước: trang kế tiếp, cũ nhất trước. Không dùng cùng before/after/around" example:"1791200000000000.01J8X4SEG0000000000000000"`
	Around string `query:"around" description:"ULID một dòng: trả trang chứa dòng đó (vài dòng trước nó rồi tiến tới), có older_cursor và newer_cursor. Dòng không đọc được thì trả trang đầu" example:"01K7SEG00000000000000000001"`
}

// EditTranscriptSegmentSDI is PATCH /api/v1/meetings/{meetingID}/transcript/{segmentID}.
type EditTranscriptSegmentSDI struct {
	Text string `json:"text" description:"Nội dung mới của dòng, ≤ 4.000 ký tự; không được trống. Nguyên văn đầu tiên vẫn được giữ" example:"Anh Hùng gửi báo cáo trước thứ Sáu"`
}

// DeleteTranscriptSDI documents the query of DELETE /api/v1/meetings/{meetingID}/transcript.
type DeleteTranscriptSDI struct {
	FromSegmentID string `query:"from_segment_id" description:"ULID dòng đầu của đoạn cần xoá (gồm). Cùng to_segment_id thì chỉ xoá các dòng từ dòng này tới dòng kia theo thứ tự đọc, mọi nguồn; không có cả hai thì xoá toàn bộ lời thoại" example:"01K7SEG00000000000000000001"`
	ToSegmentID   string `query:"to_segment_id" description:"ULID dòng cuối của đoạn (gồm), cùng dòng hoặc sau from_segment_id; dòng không có trong cuộc họp hoặc đứng trước thì 404" example:"01K7SEG00000000000000000009"`
}
