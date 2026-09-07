package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func mustPollRoom(t *testing.T, s *ChatService, ctx context.Context, userID, workspaceID string) string {
	t.Helper()
	room, err := s.EnsureWorkspaceRoom(ctx, userID, workspaceID)
	if err != nil {
		t.Fatalf("ensure workspace room: %v", err)
	}
	return room.RoomID
}

func mustSendPoll(t *testing.T, s *ChatService, ctx context.Context, userID, workspaceID, roomID string, in SendPollMessageInput) ChatMessageRow {
	t.Helper()
	row, err := s.SendPollMessage(ctx, userID, workspaceID, roomID, in)
	if err != nil {
		t.Fatalf("send poll: %v", err)
	}
	return row
}

func pollStrPtr(s string) *string { return &s }

func requireValidationError(t *testing.T, err error, what string) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: expected validation error, got nil", what)
	}
	var ve ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("%s: expected ValidationError, got %T (%v)", what, err, err)
	}
}

func TestChatPollSendValidation(t *testing.T) {
	s, _, q, ua, _, w := chatFixture(t)
	ctx := context.Background()
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)
	_ = q

	future := time.Now().Add(time.Hour).Format(time.RFC3339)
	past := time.Now().Add(-time.Hour).Format(time.RFC3339)

	cases := []struct {
		name string
		in   SendPollMessageInput
	}{
		{"blank question", SendPollMessageInput{Question: "   ", Options: []string{"A", "B"}}},
		{"empty question", SendPollMessageInput{Question: "", Options: []string{"A", "B"}}},
		{"single option", SendPollMessageInput{Question: "Q?", Options: []string{"Only"}}},
		{"no options", SendPollMessageInput{Question: "Q?", Options: nil}},
		{"blank labels only", SendPollMessageInput{Question: "Q?", Options: []string{"  ", "", "A"}}},
		{"question too long", SendPollMessageInput{Question: strings.Repeat("a", 201), Options: []string{"A", "B"}}},
		{"bad deadline", SendPollMessageInput{Question: "Q?", Options: []string{"A", "B"}, Settings: ChatPollSettings{DeadlineAt: pollStrPtr("not-a-date")}}},
		{"past deadline", SendPollMessageInput{Question: "Q?", Options: []string{"A", "B"}, Settings: ChatPollSettings{DeadlineAt: pollStrPtr(past)}}},
	}
	for _, tc := range cases {
		_, err := s.SendPollMessage(ctx, ua.ID, w.ID, roomID, tc.in)
		requireValidationError(t, err, tc.name)
	}

	_ = future
}

func TestChatPollSendSuccess(t *testing.T) {
	s, pub, _, ua, _, w := chatFixture(t)
	ctx := context.Background()
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)

	row := mustSendPoll(t, s, ctx, ua.ID, w.ID, roomID, SendPollMessageInput{
		Question: "  Ăn gì trưa nay?  ",
		Options:  []string{"Cơm", "Phở"},
	})
	if row.Kind != chatMessageKindPoll {
		t.Fatalf("kind: got %q want poll", row.Kind)
	}
	if row.Body != "Ăn gì trưa nay?" {
		t.Fatalf("body not trimmed: %q", row.Body)
	}
	if row.Poll == nil {
		t.Fatal("expected poll payload in row")
	}
	if row.Poll.Question != "Ăn gì trưa nay?" {
		t.Fatalf("poll question: %q", row.Poll.Question)
	}
	if len(row.Poll.Options) != 2 {
		t.Fatalf("poll options: %+v", row.Poll.Options)
	}
	for _, opt := range row.Poll.Options {
		if opt.ID == "" || opt.Votes != 0 {
			t.Fatalf("option not zeroed: %+v", opt)
		}
	}
	if row.Poll.Options[0].ID == row.Poll.Options[1].ID {
		t.Fatal("option IDs must be unique")
	}
	if len(row.Poll.ViewerOptionIDs) != 0 {
		t.Fatalf("sender should not have voted: %+v", row.Poll.ViewerOptionIDs)
	}
	if len(pub.events) == 0 || pub.events[len(pub.events)-1].Type != "chat.message.created" {
		t.Fatalf("publish: %+v", pub.events)
	}
}

func TestChatPollSendBlankDeadlineNormalized(t *testing.T) {
	s, _, _, ua, _, w := chatFixture(t)
	ctx := context.Background()
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)

	row := mustSendPoll(t, s, ctx, ua.ID, w.ID, roomID, SendPollMessageInput{
		Question: "Deadline trống?",
		Options:  []string{"A", "B"},
		Settings: ChatPollSettings{DeadlineAt: pollStrPtr("   ")},
	})
	if row.Poll == nil {
		t.Fatal("expected poll payload")
	}
	if row.Poll.Settings.DeadlineAt != nil {
		t.Fatalf("blank deadline should normalize to nil: %+v", row.Poll.Settings.DeadlineAt)
	}
}

func TestChatPollSendFutureDeadlineKept(t *testing.T) {
	s, _, _, ua, _, w := chatFixture(t)
	ctx := context.Background()
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)

	future := time.Now().Add(2 * time.Hour).Format(time.RFC3339)
	row := mustSendPoll(t, s, ctx, ua.ID, w.ID, roomID, SendPollMessageInput{
		Question: "Có deadline?",
		Options:  []string{"A", "B"},
		Settings: ChatPollSettings{DeadlineAt: pollStrPtr(future), PinToTop: true, AllowAddOptions: true},
	})
	if row.Poll == nil || row.Poll.Settings.DeadlineAt == nil {
		t.Fatalf("future deadline should be kept: %+v", row.Poll)
	}
	if pollIsExpired(row.Poll.Settings, time.Now()) {
		t.Fatal("future poll should not be expired")
	}
}

func TestChatPollVoteValidation(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)

	poll := mustSendPoll(t, s, ctx, ua.ID, w.ID, roomID, SendPollMessageInput{
		Question: "Vote validation?", Options: []string{"A", "B"},
	})
	optA := poll.Poll.Options[0].ID

	if _, err := s.VoteChatPollMessage(ctx, ua.ID, w.ID, roomID, poll.ID, "   "); err == nil {
		t.Fatal("blank option should fail")
	} else {
		requireValidationError(t, err, "blank option")
	}

	if _, err := s.VoteChatPollMessage(ctx, ua.ID, w.ID, roomID, "no-such-message", optA); err != ErrNotFound {
		t.Fatalf("unknown message: want ErrNotFound, got %v", err)
	}

	sent, err := s.SendWorkspaceMessage(ctx, ua.ID, w.ID, SendChatMessageInput{Body: "plain"})
	if err != nil {
		t.Fatalf("send plain: %v", err)
	}
	if _, err := s.VoteChatPollMessage(ctx, ua.ID, w.ID, sent.RoomID, sent.ID, optA); err == nil {
		t.Fatal("non-poll message should fail")
	} else {
		requireValidationError(t, err, "non-poll")
	}

	if _, err := s.VoteChatPollMessage(ctx, ua.ID, w.ID, roomID, poll.ID, "bogus-option"); err == nil {
		t.Fatal("unknown option should fail")
	} else {
		requireValidationError(t, err, "unknown option")
	}

	expirePoll(t, s, q, ctx, w.ID, roomID, poll.ID, time.Now().Add(-time.Hour))
	if _, err := s.VoteChatPollMessage(ctx, ua.ID, w.ID, roomID, poll.ID, optA); err == nil {
		t.Fatal("expired poll should fail")
	} else {
		requireValidationError(t, err, "expired")
	}
	_ = ub
}

func expirePoll(t *testing.T, s *ChatService, q *db.Queries, ctx context.Context, workspaceID, roomID, messageID string, deadline time.Time) {
	t.Helper()
	msg, err := q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
		ID: messageID, RoomID: roomID, WorkspaceID: workspaceID,
	})
	if err != nil {
		t.Fatalf("get message: %v", err)
	}
	meta := decodeChatMessageMetadata(msg.Metadata)
	if meta.Poll == nil {
		t.Fatal("message has no poll payload")
	}
	past := deadline.Format(time.RFC3339)
	meta.Poll.Settings.DeadlineAt = &past
	raw, err := json.Marshal(meta)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if _, err := q.UpdateChatMessageMetadata(ctx, db.UpdateChatMessageMetadataParams{
		ID: messageID, RoomID: roomID, WorkspaceID: workspaceID, Metadata: raw,
	}); err != nil {
		t.Fatalf("expire poll: %v", err)
	}
	_ = s
}

func TestChatPollVoteSingleChoiceToggle(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)

	poll := mustSendPoll(t, s, ctx, ua.ID, w.ID, roomID, SendPollMessageInput{
		Question: "Single?", Options: []string{"A", "B"},
	})
	optA := poll.Poll.Options[0].ID
	optB := poll.Poll.Options[1].ID

	voted, err := s.VoteChatPollMessage(ctx, ub.ID, w.ID, roomID, poll.ID, optA)
	if err != nil {
		t.Fatalf("vote A: %v", err)
	}
	if len(voted.Poll.ViewerOptionIDs) != 1 || voted.Poll.ViewerOptionIDs[0] != optA {
		t.Fatalf("viewer options after vote A: %+v", voted.Poll.ViewerOptionIDs)
	}
	if got := optionVotes(voted, optA); got != 1 {
		t.Fatalf("votes for A: got %d want 1", got)
	}

	toggled, err := s.VoteChatPollMessage(ctx, ub.ID, w.ID, roomID, poll.ID, optA)
	if err != nil {
		t.Fatalf("re-vote A (toggle off): %v", err)
	}
	if len(toggled.Poll.ViewerOptionIDs) != 0 {
		t.Fatalf("toggle off should clear viewer options: %+v", toggled.Poll.ViewerOptionIDs)
	}
	if got := optionVotes(toggled, optA); got != 0 {
		t.Fatalf("votes for A after toggle off: got %d want 0", got)
	}

	moved, err := s.VoteChatPollMessage(ctx, ub.ID, w.ID, roomID, poll.ID, optB)
	if err != nil {
		t.Fatalf("vote B: %v", err)
	}
	if len(moved.Poll.ViewerOptionIDs) != 1 || moved.Poll.ViewerOptionIDs[0] != optB {
		t.Fatalf("viewer options after vote B: %+v", moved.Poll.ViewerOptionIDs)
	}
	if got := optionVotes(moved, optB); got != 1 {
		t.Fatalf("votes for B: got %d want 1", got)
	}
	if got := optionVotes(moved, optA); got != 0 {
		t.Fatalf("votes for A after switch: got %d want 0", got)
	}
}

func optionVotes(row ChatMessageRow, optionID string) int {
	if row.Poll == nil {
		return -1
	}
	for _, opt := range row.Poll.Options {
		if opt.ID == optionID {
			return opt.Votes
		}
	}
	return -1
}

func TestChatPollVoteMultiChoice(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)

	poll := mustSendPoll(t, s, ctx, ua.ID, w.ID, roomID, SendPollMessageInput{
		Question: "Multi?", Options: []string{"A", "B", "C"},
		Settings: ChatPollSettings{AllowMultiple: true},
	})
	optA := poll.Poll.Options[0].ID
	optB := poll.Poll.Options[1].ID

	if _, err := s.VoteChatPollMessage(ctx, ub.ID, w.ID, roomID, poll.ID, optA); err != nil {
		t.Fatalf("vote A: %v", err)
	}
	both, err := s.VoteChatPollMessage(ctx, ub.ID, w.ID, roomID, poll.ID, optB)
	if err != nil {
		t.Fatalf("vote B: %v", err)
	}
	if len(both.Poll.ViewerOptionIDs) != 2 {
		t.Fatalf("multi viewer options: %+v", both.Poll.ViewerOptionIDs)
	}
	if got := optionVotes(both, optA); got != 1 {
		t.Fatalf("votes A: got %d want 1", got)
	}
	if got := optionVotes(both, optB); got != 1 {
		t.Fatalf("votes B: got %d want 1", got)
	}

	removed, err := s.VoteChatPollMessage(ctx, ub.ID, w.ID, roomID, poll.ID, optA)
	if err != nil {
		t.Fatalf("remove A: %v", err)
	}
	if len(removed.Poll.ViewerOptionIDs) != 1 || removed.Poll.ViewerOptionIDs[0] != optB {
		t.Fatalf("after remove A: %+v", removed.Poll.ViewerOptionIDs)
	}
	if got := optionVotes(removed, optA); got != 0 {
		t.Fatalf("votes A after remove: got %d want 0", got)
	}
	if got := optionVotes(removed, optB); got != 1 {
		t.Fatalf("votes B after remove A: got %d want 1", got)
	}
}

func TestChatPollHideResultsUntilVote(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)

	row := mustSendPoll(t, s, ctx, ua.ID, w.ID, roomID, SendPollMessageInput{
		Question: "Hidden?",
		Options:  []string{"A", "B"},
		Settings: ChatPollSettings{HideResultsUntilVote: true},
	})
	if row.Poll.VotesByUser != nil {
		t.Fatalf("votes should be hidden before vote: %+v", row.Poll.VotesByUser)
	}

	optA := row.Poll.Options[0].ID
	voted, err := s.VoteChatPollMessage(ctx, ua.ID, w.ID, roomID, row.ID, optA)
	if err != nil {
		t.Fatalf("vote: %v", err)
	}
	if voted.Poll.VotesByUser == nil {
		t.Fatal("votes should be visible to voter after voting")
	}

	msgs, err := s.ListWorkspaceMessages(ctx, ub.ID, w.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatalf("list as non-voter: %v", err)
	}
	var found *ChatMessageRow
	for i := range msgs {
		if msgs[i].ID == row.ID {
			found = &msgs[i]
			break
		}
	}
	if found == nil {
		t.Fatal("poll message not found in list")
	}
	if found.Poll == nil {
		t.Fatal("expected poll in listed message")
	}
	if found.Poll.VotesByUser != nil {
		t.Fatalf("votes should stay hidden for non-voter: %+v", found.Poll.VotesByUser)
	}
	if len(found.Poll.ViewerOptionIDs) != 0 {
		t.Fatalf("non-voter viewer options: %+v", found.Poll.ViewerOptionIDs)
	}
}

func TestChatPollHideVoters(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)

	row := mustSendPoll(t, s, ctx, ua.ID, w.ID, roomID, SendPollMessageInput{
		Question: "Anonymous?",
		Options:  []string{"A", "B"},
		Settings: ChatPollSettings{HideVoters: true},
	})
	optA := row.Poll.Options[0].ID
	voted, err := s.VoteChatPollMessage(ctx, ub.ID, w.ID, roomID, row.ID, optA)
	if err != nil {
		t.Fatalf("vote: %v", err)
	}
	if voted.Poll.VotesByUser != nil {
		t.Fatalf("voters should stay hidden: %+v", voted.Poll.VotesByUser)
	}
	if len(voted.Poll.ViewerOptionIDs) != 1 || voted.Poll.ViewerOptionIDs[0] != optA {
		t.Fatalf("viewer should still see own vote: %+v", voted.Poll.ViewerOptionIDs)
	}
	if got := optionVotes(voted, optA); got != 1 {
		t.Fatalf("aggregate votes still counted: got %d want 1", got)
	}
}

func TestPollFromMetadataBranches(t *testing.T) {
	mkPayload := func(question string, n int, settings ChatPollSettings, votes map[string][]string) []byte {
		opts := make([]ChatPollOption, 0, n)
		for i := 0; i < n; i++ {
			opts = append(opts, ChatPollOption{ID: "opt-" + string(rune('a'+i)), Label: "L", Votes: i})
		}
		raw, err := encodePollMetadata(ChatPollPayload{
			Question: question, Options: opts, Settings: settings, VotesByUser: votes,
		})
		if err != nil {
			t.Fatalf("encode: %v", err)
		}
		return raw
	}

	if got := pollFromMetadata("text", mkPayload("Q", 2, ChatPollSettings{}, nil), "u1"); got != nil {
		t.Fatalf("non-poll kind should be nil: %+v", got)
	}
	if got := pollFromMetadata(chatMessageKindPoll, nil, "u1"); got != nil {
		t.Fatalf("empty raw should be nil: %+v", got)
	}
	if got := pollFromMetadata(chatMessageKindPoll, []byte("{}"), "u1"); got != nil {
		t.Fatalf("missing poll should be nil: %+v", got)
	}
	if got := pollFromMetadata(chatMessageKindPoll, mkPayload("", 2, ChatPollSettings{}, nil), "u1"); got != nil {
		t.Fatalf("blank question should be nil: %+v", got)
	}
	if got := pollFromMetadata(chatMessageKindPoll, mkPayload("Q", 1, ChatPollSettings{}, nil), "u1"); got != nil {
		t.Fatalf("<2 options should be nil: %+v", got)
	}

	votes := map[string][]string{"U1": {"opt-a"}}
	raw := mkPayload("Q", 2, ChatPollSettings{}, votes)
	got := pollFromMetadata(chatMessageKindPoll, raw, "u1")
	if got == nil {
		t.Fatal("expected poll info")
	}
	if len(got.ViewerOptionIDs) != 1 || got.ViewerOptionIDs[0] != "opt-a" {
		t.Fatalf("viewer filter (case-insensitive): %+v", got.ViewerOptionIDs)
	}
	if got.VotesByUser == nil {
		t.Fatal("votes should be visible by default")
	}

	got = pollFromMetadata(chatMessageKindPoll, raw, "  ")
	if got == nil || len(got.ViewerOptionIDs) != 0 {
		t.Fatalf("blank viewer should have no options: %+v", got)
	}

	hidden := mkPayload("Q", 2, ChatPollSettings{HideResultsUntilVote: true}, votes)
	if got := pollFromMetadata(chatMessageKindPoll, hidden, "u2"); got == nil || got.VotesByUser != nil {
		t.Fatalf("non-voter should not see votes: %+v", got)
	}
	if got := pollFromMetadata(chatMessageKindPoll, hidden, "u1"); got == nil || got.VotesByUser == nil {
		t.Fatalf("voter should see votes: %+v", got)
	}

	anon := mkPayload("Q", 2, ChatPollSettings{HideVoters: true}, votes)
	if got := pollFromMetadata(chatMessageKindPoll, anon, "u1"); got == nil || got.VotesByUser != nil {
		t.Fatalf("HideVoters should suppress votes_by_user: %+v", got)
	}
	if got := pollFromMetadata(chatMessageKindPoll, anon, "u1"); got == nil || len(got.ViewerOptionIDs) != 1 {
		t.Fatalf("HideVoters should keep viewer options: %+v", got)
	}
}

func TestNormalizePollOptions(t *testing.T) {
	opts := normalizePollOptions([]string{"  A  ", "", "   ", "B", "A"})
	if len(opts) != 3 {
		t.Fatalf("blanks should be skipped: %+v", opts)
	}
	if opts[0].Label != "A" || opts[1].Label != "B" || opts[2].Label != "A" {
		t.Fatalf("labels should be trimmed: %+v", opts)
	}
	seen := map[string]bool{}
	for _, opt := range opts {
		if opt.ID == "" {
			t.Fatalf("IDs must be non-empty: %+v", opts)
		}
		if seen[opt.ID] {
			t.Fatalf("IDs must be unique: %+v", opts)
		}
		seen[opt.ID] = true
		if opt.Votes != 0 {
			t.Fatalf("votes must start at zero: %+v", opt)
		}
	}
	if got := normalizePollOptions(nil); len(got) != 0 {
		t.Fatalf("nil input: %+v", got)
	}
}

func TestPollIsExpired(t *testing.T) {
	now := time.Now()
	if pollIsExpired(ChatPollSettings{}, now) {
		t.Fatal("nil deadline should not be expired")
	}
	if pollIsExpired(ChatPollSettings{DeadlineAt: pollStrPtr("   ")}, now) {
		t.Fatal("blank deadline should not be expired")
	}
	if pollIsExpired(ChatPollSettings{DeadlineAt: pollStrPtr("not-a-date")}, now) {
		t.Fatal("bad date should not be expired")
	}
	future := now.Add(time.Hour).Format(time.RFC3339)
	if pollIsExpired(ChatPollSettings{DeadlineAt: pollStrPtr(future)}, now) {
		t.Fatal("future deadline should not be expired")
	}
	past := now.Add(-time.Hour).Format(time.RFC3339)
	if !pollIsExpired(ChatPollSettings{DeadlineAt: pollStrPtr(past)}, now) {
		t.Fatal("past deadline should be expired")
	}
}

func TestEncodePollMetadataRoundTrip(t *testing.T) {
	raw, err := encodePollMetadata(ChatPollPayload{
		Question: "Round trip?",
		Options:  []ChatPollOption{{ID: "a", Label: "A"}, {ID: "b", Label: "B"}},
	})
	if err != nil || len(raw) == 0 {
		t.Fatalf("encode: err=%v raw=%s", err, raw)
	}
	got := pollFromMetadata(chatMessageKindPoll, raw, "viewer")
	if got == nil || got.Question != "Round trip?" || len(got.Options) != 2 {
		t.Fatalf("round trip: %+v", got)
	}
}

func TestChatPollSendGroupRoom(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, q, as, "chat-poll-group@example.com", "G")
	addOrgMember(t, q, w.OrganizationID, uc.ID)
	addWorkspaceMember(t, q, w.ID, uc.ID)

	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{
		Name: "Poll group", MemberUserIDs: []string{ub.ID, uc.ID},
	})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	row := mustSendPoll(t, s, ctx, ua.ID, w.ID, group.ID, SendPollMessageInput{
		Question: "Group poll?", Options: []string{"A", "B"},
	})
	if row.Kind != chatMessageKindPoll || row.Poll == nil {
		t.Fatalf("group poll: %+v", row)
	}
	if _, err := s.VoteChatPollMessage(ctx, ub.ID, w.ID, group.ID, row.ID, row.Poll.Options[0].ID); err != nil {
		t.Fatalf("group vote: %v", err)
	}
}

func TestChatPollSendForbiddenPaths(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)
	in := SendPollMessageInput{Question: "Q?", Options: []string{"A", "B"}}

	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, q, as, "chat-poll-outsider@example.com", "Outsider")
	if _, err := s.SendPollMessage(ctx, uc.ID, w.ID, roomID, in); err == nil {
		t.Fatal("outsider send should fail")
	}

	if err := q.UpdateChatRoomMemberSendRestricted(ctx, db.UpdateChatRoomMemberSendRestrictedParams{
		RoomID: roomID, UserID: ub.ID, SendRestricted: true,
	}); err != nil {
		t.Fatalf("mute: %v", err)
	}
	if _, err := s.SendPollMessage(ctx, ub.ID, w.ID, roomID, in); err == nil {
		t.Fatal("muted member send should fail")
	}
	if err := q.UpdateChatRoomMemberSendRestricted(ctx, db.UpdateChatRoomMemberSendRestrictedParams{
		RoomID: roomID, UserID: ub.ID, SendRestricted: false,
	}); err != nil {
		t.Fatalf("unmute: %v", err)
	}

	disabled := defaultChatRoomMemberPermissions()
	disabled.AllowCreatePolls = false
	if _, err := s.UpdateChatRoomSettings(ctx, ua.ID, w.ID, roomID, UpdateChatRoomSettingsInput{
		MemberPermissions: &disabled,
	}); err != nil {
		t.Fatalf("disable polls: %v", err)
	}
	if _, err := s.SendPollMessage(ctx, ub.ID, w.ID, roomID, in); err != ErrForbidden {
		t.Fatalf("polls-disabled member send: want ErrForbidden, got %v", err)
	}
	if _, err := s.SendPollMessage(ctx, ua.ID, w.ID, roomID, in); err != nil {
		t.Fatalf("admin send with polls disabled: %v", err)
	}
}

func TestChatPollVoteForbiddenAndCorrupt(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)

	as := NewAuthService(q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, q, as, "chat-poll-vote-outsider@example.com", "Outsider")
	poll := mustSendPoll(t, s, ctx, ua.ID, w.ID, roomID, SendPollMessageInput{
		Question: "Q?", Options: []string{"A", "B"},
	})
	if _, err := s.VoteChatPollMessage(ctx, uc.ID, w.ID, roomID, poll.ID, poll.Poll.Options[0].ID); err == nil {
		t.Fatal("outsider vote should fail")
	}

	if _, err := q.UpdateChatMessageMetadata(ctx, db.UpdateChatMessageMetadataParams{
		ID: poll.ID, RoomID: roomID, WorkspaceID: w.ID, Metadata: []byte("{}"),
	}); err != nil {
		t.Fatalf("corrupt metadata: %v", err)
	}
	_, err := s.VoteChatPollMessage(ctx, ua.ID, w.ID, roomID, poll.ID, poll.Poll.Options[0].ID)
	requireValidationError(t, err, "corrupt poll data")
}
