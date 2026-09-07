package service

import "strings"

const maxChatMessageBodyLen = 4000

const (
	minClientMsgIDLen = 8
	maxClientMsgIDLen = 64
)

func validateChatMessageBody(body string) error {
	body = strings.TrimSpace(body)
	if body == "" {
		return Invalid("nội dung tin nhắn không được để trống")
	}
	if len(body) > maxChatMessageBodyLen {
		return Invalid("tin nhắn quá dài")
	}
	return nil
}

func validateClientMsgID(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil
	}
	if len(id) < minClientMsgIDLen || len(id) > maxClientMsgIDLen {
		return Invalid("client_msg_id không hợp lệ")
	}
	for _, r := range id {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' {
			continue
		}
		return Invalid("client_msg_id không hợp lệ")
	}
	return nil
}
