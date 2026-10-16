package service

import (
	"context"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
)

func TestCreateChannelCapsInitialMembers(t *testing.T) {
	s, _, _, ua, _, w := chatFixture(t)
	ctx := context.Background()
	ids := make([]string, chatInviteMaxIDs+1)
	for i := range ids {
		ids[i] = util.NewID()
	}
	_, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "over-cap", Visibility: chatVisibilityPublic, MemberUserIDs: ids,
	})
	var ve ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("want ValidationError, got %v", err)
	}
	if ve.Msg == "" {
		t.Fatalf("validation message empty")
	}
}
