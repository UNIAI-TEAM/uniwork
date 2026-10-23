package sdo

// MeetingFeedCursorsDTO rides on every in-room feed page (chat, transcript).
type MeetingFeedCursorsDTO struct {
	OlderCursor  string `json:"older_cursor,omitempty" description:"Truyền làm before để đọc trang cũ hơn; vắng khi không còn gì cũ hơn hoặc khi đây là trang after" example:"1791200000000000.01J8X4MSG0000000000000000"`
	AfterCursor  string `json:"after_cursor,omitempty" description:"Truyền làm after để chỉ đọc những dòng đến sau; vắng khi chưa có dòng nào" example:"1791200000000000.01J8X4MSG0000000000000000"`
	HasMoreAfter bool   `json:"has_more_after" description:"Trang after đã đầy: có thể còn dòng phía sau, client tải lại trang mới nhất"`
}

type TranscriptListSDO struct {
	Segments []TranscriptSegmentDTO `json:"segments"`
	MeetingFeedCursorsDTO
}

type MeetingChatListSDO struct {
	Messages []MeetingChatMessageDTO `json:"messages"`
	MeetingFeedCursorsDTO
}
