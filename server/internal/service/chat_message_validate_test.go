package service

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateChatMessageBody(t *testing.T) {
	if err := validateChatMessageBody("  hello  "); err != nil {
		t.Fatalf("valid body: %v", err)
	}
	if err := validateChatMessageBody("   "); err == nil {
		t.Fatal("expected empty body error")
	}
	longBody := strings.Repeat("a", maxChatMessageBodyLen+1)
	err := validateChatMessageBody(longBody)
	var ve ValidationError
	if !errors.As(err, &ve) || ve.Msg != "tin nhắn quá dài" {
		t.Fatalf("expected long body error, got %v", err)
	}
}

func TestValidateClientMsgID(t *testing.T) {
	if err := validateClientMsgID(""); err != nil {
		t.Fatalf("empty optional id: %v", err)
	}
	if err := validateClientMsgID("550e8400-e29b-41d4-a716-446655440000"); err != nil {
		t.Fatalf("uuid id: %v", err)
	}
	if err := validateClientMsgID("short"); err == nil {
		t.Fatal("expected short id error")
	}
	if err := validateClientMsgID("bad id!"); err == nil {
		t.Fatal("expected invalid chars error")
	}
}
