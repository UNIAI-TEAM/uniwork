package service

import (
	"context"
	"encoding/json"
	"strings"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const chatMessageKindPollVote = "poll_vote"

// ChatPollVoteActivityPayload is stored on a poll_vote timeline row.
type ChatPollVoteActivityPayload struct {
	PollMessageID string `json:"poll_message_id"`
	Question      string `json:"question"`
}

func pollVoteFromMetadata(kind string, meta chatMessageMetadata) *ChatPollVoteActivityPayload {
	if kind != chatMessageKindPollVote || meta.PollVote == nil {
		return nil
	}
	id := strings.TrimSpace(meta.PollVote.PollMessageID)
	q := strings.TrimSpace(meta.PollVote.Question)
	if id == "" || q == "" {
		return nil
	}
	return &ChatPollVoteActivityPayload{PollMessageID: id, Question: q}
}

func encodePollVoteActivityMetadata(activity ChatPollVoteActivityPayload) ([]byte, error) {
	return json.Marshal(chatMessageMetadata{PollVote: &activity})
}

func voteSelectionEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	counts := map[string]int{}
	for _, id := range a {
		counts[id]++
	}
	for _, id := range b {
		if counts[id] == 0 {
			return false
		}
		counts[id]--
	}
	return true
}

func (s *ChatService) sendPollVoteActivityMessage(
	ctx context.Context, voterID string, room db.ChatRoom, activity ChatPollVoteActivityPayload,
) error {
	meta, err := encodePollVoteActivityMetadata(activity)
	if err != nil {
		return err
	}
	_, err = s.sendKindMessage(ctx, voterID, room, chatMessageKindPollVote, activity.Question, meta, "", nil)
	return err
}
