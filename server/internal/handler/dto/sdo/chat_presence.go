package sdo

// ChatPresenceSDO is POST .../chat/presence. A server that predates the
// online list answers StatusSDO; the client then keeps its own expiry.
type ChatPresenceSDO struct {
	Status        string   `json:"status" description:"Kết quả của yêu cầu" example:"ok"`
	OnlineUserIDs []string `json:"online_user_ids,omitempty" description:"Thành viên đang online trong workspace (gồm cả người gọi); chỉ có khi state=online và server đọc được trạng thái" example:"[\"01K4USER000000000000000001\"]"`
}
