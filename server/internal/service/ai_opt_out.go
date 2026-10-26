package service

import (
	"context"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// aiOptOuts answers "did this person decline AI processing?" for the senders
// of a batch of messages (Apple 5.1.2(i), users.ai_opt_out_at): what they
// wrote never reaches the AI provider, whoever asks for the summary or the
// answer, so every path that hands chat to the gateway drops their messages
// (catch-up, Ask UNI's chat sources and tools, the call summary).
type aiOptOuts map[string]bool

// loadAIOptOuts reads the decliners among senderIDs in one query.
func loadAIOptOuts(ctx context.Context, q *db.Queries, senderIDs []string) (aiOptOuts, error) {
	ids := uniqueNonEmpty(senderIDs)
	if len(ids) == 0 {
		return aiOptOuts{}, nil
	}
	rows, err := q.ListAIOptedOutUserIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make(aiOptOuts, len(rows))
	for _, id := range rows {
		out[id] = true
	}
	return out, nil
}

// excludes reports whether a message by senderID must stay out of an AI request.
func (o aiOptOuts) excludes(senderID string) bool {
	return o[senderID]
}

// chatSenderIDs lists who wrote a batch of messages.
func chatSenderIDs(msgs []ChatMessageRow) []string {
	ids := make([]string, 0, len(msgs))
	for _, m := range msgs {
		ids = append(ids, m.SenderID)
	}
	return ids
}

func uniqueNonEmpty(values []string) []string {
	seen := make(map[string]bool, len(values))
	out := make([]string, 0, len(values))
	for _, v := range values {
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}
