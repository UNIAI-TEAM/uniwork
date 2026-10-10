package service

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// chatCrowd adds n members to the workspace channel and returns a service whose
// publisher is safe to call from many goroutines.
func chatCrowd(t *testing.T, n int) (*ChatService, *db.Queries, db.User, db.Workspace, string, []db.User) {
	t.Helper()
	s, _, q, ua, _, w := chatFixture(t)
	ctx := context.Background()
	users := make([]db.User, 0, n)
	for i := 0; i < n; i++ {
		u, err := q.CreateUser(ctx, db.CreateUserParams{
			ID: util.NewID(), Email: fmt.Sprintf("crowd-%d@example.com", i),
			DisplayName: fmt.Sprintf("Crowd %d", i), Locale: "vi",
		})
		if err != nil {
			t.Fatal(err)
		}
		addOrgMember(t, q, w.OrganizationID, u.ID)
		addWorkspaceMember(t, q, w.ID, u.ID)
		users = append(users, u)
	}
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)
	safe := NewChatService(s.pool, q, s.ws, NopPublisher{})
	return safe, q, ua, w, roomID, users
}

func runConcurrently(t *testing.T, users []db.User, fn func(db.User) error) {
	t.Helper()
	var wg sync.WaitGroup
	errs := make(chan error, len(users))
	for _, u := range users {
		wg.Add(1)
		go func(u db.User) {
			defer wg.Done()
			if err := fn(u); err != nil {
				errs <- err
			}
		}(u)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
}

func TestChatConcurrentPollVotesAreNotLost(t *testing.T) {
	s, _, ua, w, roomID, users := chatCrowd(t, 50)
	ctx := context.Background()
	poll := mustSendPoll(t, s, ctx, ua.ID, w.ID, roomID, SendPollMessageInput{
		Question: "Q?", Options: []string{"A", "B"},
	})
	optionID := poll.Poll.Options[0].ID
	runConcurrently(t, users, func(u db.User) error {
		_, err := s.VoteChatPollMessage(ctx, u.ID, w.ID, roomID, poll.ID, optionID)
		return err
	})
	got, err := s.GetRoomMessage(ctx, ua.ID, w.ID, roomID, poll.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Poll.Options[0].Votes != len(users) || len(got.Poll.VotesByUser) != len(users) {
		t.Fatalf("votes=%d voters=%d, want %d", got.Poll.Options[0].Votes, len(got.Poll.VotesByUser), len(users))
	}
}

func TestChatConcurrentReactionsAndPinAreNotLost(t *testing.T) {
	s, _, ua, w, roomID, users := chatCrowd(t, 50)
	ctx := context.Background()
	msg, err := s.SendRoomMessage(ctx, ua.ID, w.ID, roomID, SendChatMessageInput{Body: "react"})
	if err != nil {
		t.Fatal(err)
	}
	pinner := db.User{ID: ua.ID}
	runConcurrently(t, append([]db.User{pinner}, users...), func(u db.User) error {
		if u.ID == ua.ID {
			_, err := s.ToggleChatMessagePin(ctx, u.ID, w.ID, roomID, msg.ID)
			return err
		}
		_, err := s.ToggleChatMessageReaction(ctx, u.ID, w.ID, roomID, msg.ID, "👍")
		return err
	})
	got, err := s.GetRoomMessage(ctx, ua.ID, w.ID, roomID, msg.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Reactions["👍"] != len(users) || !got.Pinned {
		t.Fatalf("reactions=%d pinned=%v, want %d and pinned", got.Reactions["👍"], got.Pinned, len(users))
	}
}

// An edit rewrites the mention flags under the same row lock as reactions, so
// reacting while the author edits keeps every reaction.
func TestChatConcurrentReactionsAndEditAreNotLost(t *testing.T) {
	s, _, ua, w, roomID, users := chatCrowd(t, 50)
	ctx := context.Background()
	msg, err := s.SendRoomMessage(ctx, ua.ID, w.ID, roomID, SendChatMessageInput{Body: "react"})
	if err != nil {
		t.Fatal(err)
	}
	editor := db.User{ID: ua.ID}
	edited := "[@C](mention://member/" + users[0].ID + ") đã sửa"
	runConcurrently(t, append([]db.User{editor}, users...), func(u db.User) error {
		if u.ID == ua.ID {
			_, err := s.EditChatMessage(ctx, u.ID, w.ID, roomID, msg.ID, edited)
			return err
		}
		_, err := s.ToggleChatMessageReaction(ctx, u.ID, w.ID, roomID, msg.ID, "👍")
		return err
	})
	got, err := s.GetRoomMessage(ctx, ua.ID, w.ID, roomID, msg.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Reactions["👍"] != len(users) || got.Body != edited {
		t.Fatalf("reactions=%d body=%q, want %d and the edit", got.Reactions["👍"], got.Body, len(users))
	}
}
