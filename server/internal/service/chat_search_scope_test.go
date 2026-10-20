package service

import (
	"context"
	"errors"
	"sort"
	"testing"
)

// The sidebar's search (UniChat ⌘K): one query over every room the reader is
// in, within one scope — Tin nhắn (the organization's DMs and groups) or a
// workspace (its room and channels) — and never a room they are not in.
func TestSearchMessagesAcrossMyRooms(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	inDM, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "Kịch bản ra mắt Q4"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID); err != nil {
		t.Fatal(err)
	}
	inRoom, err := s.SendWorkspaceMessage(ctx, ua.ID, w.ID, SendChatMessageInput{Body: "Lịch ra mắt đã lên"})
	if err != nil {
		t.Fatal(err)
	}
	secret, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{Name: "bi-mat", Visibility: "private"})
	if err != nil {
		t.Fatal(err)
	}
	inSecret, err := s.SendRoomMessage(ctx, ua.ID, w.ID, secret.ID, SendChatMessageInput{Body: "Ra mắt bí mật"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "Không liên quan"}); err != nil {
		t.Fatal(err)
	}

	ids := func(userID, scope string) []string {
		t.Helper()
		hits, err := s.SearchMessages(ctx, userID, w.ID, scope, SearchChatMessagesInput{Query: "ra mat"})
		if err != nil {
			t.Fatalf("%s/%s: %v", userID, scope, err)
		}
		out := make([]string, 0, len(hits))
		for _, hit := range hits {
			out = append(out, hit.ID)
		}
		sort.Strings(out)
		return out
	}
	sorted := func(values ...string) []string {
		sort.Strings(values)
		return values
	}
	same := func(got, want []string) bool {
		if len(got) != len(want) {
			return false
		}
		for i := range got {
			if got[i] != want[i] {
				return false
			}
		}
		return true
	}

	if got := ids(ua.ID, "messages"); !same(got, sorted(inDM.ID)) {
		t.Fatalf("A in Tin nhắn: got %v, want only the DM's message", got)
	}
	if got := ids(ua.ID, "workspace"); !same(got, sorted(inRoom.ID, inSecret.ID)) {
		t.Fatalf("A in the workspace: got %v, want the room's and the private channel's", got)
	}
	// B shares the DM and the workspace room, not the private channel.
	if got := ids(ub.ID, "messages"); !same(got, sorted(inDM.ID)) {
		t.Fatalf("B in Tin nhắn: got %v", got)
	}
	if got := ids(ub.ID, "workspace"); !same(got, sorted(inRoom.ID)) {
		t.Fatalf("B in the workspace: got %v, want the room's only", got)
	}

	if _, err := s.SearchMessages(ctx, ua.ID, w.ID, "messages", SearchChatMessagesInput{Query: "r"}); err == nil {
		t.Fatal("a one-letter query: want an error")
	}
	var invalid ValidationError
	if _, err := s.SearchMessages(ctx, ua.ID, w.ID, "everything", SearchChatMessagesInput{Query: "ra mat"}); !errors.As(err, &invalid) {
		t.Fatalf("an unknown scope: err=%v, want invalid", err)
	}
}
