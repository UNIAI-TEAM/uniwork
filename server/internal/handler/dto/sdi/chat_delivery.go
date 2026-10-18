package sdi

// AckChatDeliveredSDI is POST /workspaces/{workspaceID}/chat/delivered.
type AckChatDeliveredSDI struct {
	Rooms []ChatDeliveredRoomSDI `json:"rooms" description:"Các phòng thiết bị đã nhận tin (tối đa 50)"`
}

// ChatDeliveredRoomSDI is one room of a delivery ack.
type ChatDeliveredRoomSDI struct {
	RoomID string `json:"room_id" description:"Phòng chat" example:"01J8X4ROOM0N1P2Q3R4S5T6U7V8"`
	UpTo   string `json:"up_to" description:"RFC3339: thiết bị đã có các tin tới mốc này; máy chủ không cho vượt quá hiện tại" example:"2026-03-26T10:00:00.123456Z"`
}
