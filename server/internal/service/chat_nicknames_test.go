package service

import (
	"context"
	"testing"
)

func TestChatNicknamesSetListAndClear(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	empty, err := s.ListChatNicknames(ctx, ua.ID, w.ID)
	if err != nil || len(empty) != 0 {
		t.Fatalf("initial list: err=%v nicknames=%v", err, empty)
	}

	if err := s.SetChatNickname(ctx, ua.ID, w.ID, ub.ID, "  Bạn thân  "); err != nil {
		t.Fatalf("set nickname: %v", err)
	}

	got, err := s.ListChatNicknames(ctx, ua.ID, w.ID)
	if err != nil || got[ub.ID] != "Bạn thân" {
		t.Fatalf("list after set: err=%v nicknames=%v", err, got)
	}

	peerView, err := s.ListChatNicknames(ctx, ub.ID, w.ID)
	if err != nil || len(peerView) != 0 {
		t.Fatalf("peer should not see caller nickname: err=%v nicknames=%v", err, peerView)
	}

	if err := s.SetChatNickname(ctx, ua.ID, w.ID, ub.ID, "   "); err != nil {
		t.Fatalf("clear nickname: %v", err)
	}
	got, err = s.ListChatNicknames(ctx, ua.ID, w.ID)
	if err != nil || len(got) != 0 {
		t.Fatalf("list after clear: err=%v nicknames=%v", err, got)
	}
}

func TestChatNicknamesSelfAlias(t *testing.T) {
	s, _, q, ua, _, w := chatFixture(t)
	ctx := context.Background()

	if err := s.SetChatNickname(ctx, ua.ID, w.ID, ua.ID, "Tôi"); err != nil {
		t.Fatalf("set self nickname: %v", err)
	}
	got, err := s.ListChatNicknames(ctx, ua.ID, w.ID)
	if err != nil || got[ua.ID] != "Tôi" {
		t.Fatalf("list self nickname: err=%v nicknames=%v", err, got)
	}
	_ = q
}
