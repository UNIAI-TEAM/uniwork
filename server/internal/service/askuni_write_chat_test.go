package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

func askChatTC(x *mcpToolWorld) ai.ToolContext {
	return ai.ToolContext{ActorID: x.ua.ID, OrganizationID: x.w.OrganizationID, WorkspaceID: x.w.ID}
}

// askChatWorld is the write world with a DM between the asker (ua) and ub, and a
// private channel ub made that the asker is not in.
func askChatWorld(t *testing.T) (x *mcpToolWorld, s *AskUNIService, dmID, secretID string, run func(string) (AskProposalResult, *askInverse, error)) {
	t.Helper()
	x, s, tc := askWriteWorld(t)
	ctx := context.Background()
	dm, err := s.chat.ResolveDM(ctx, x.ua.ID, x.w.ID, x.ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	secret, err := s.chat.CreateChannel(ctx, x.ub.ID, x.w.ID, CreateChannelInput{Name: "kenh-rieng", Visibility: "private"})
	if err != nil {
		t.Fatal(err)
	}
	p := principalOf(tc)
	run = func(args string) (AskProposalResult, *askInverse, error) {
		return writeToolNamed(t, s, "send_chat_message").apply(ctx, p, askPrepare(t, s, tc, "send_chat_message", args))
	}
	return x, s, dm.ID, secret.ID, run
}

func TestAskWriteChatIsAlwaysLevelTwo(t *testing.T) {
	x, s, dm, _, _ := askChatWorld(t)
	tc := askChatTC(x)
	body := "Chào ca\nsáng " + strings.Repeat("x", 600) + " **không** render"
	row := askPrepare(t, s, tc, "send_chat_message", fmt.Sprintf(`{"room_id":%q,"body":%q}`, dm, body))
	if row.Level != askLevel2 || row.Preview.Body != body || row.TargetKind != "room" || row.TargetID != dm || row.TargetRevision != nil {
		t.Errorf("row = %+v", row)
	}
	a := row.Preview.Audience
	if a.Visibility != "room" || a.RoomMembers != 2 || len(row.Preview.Refs) != 0 || row.Preview.Fields == nil {
		t.Errorf("audience = %+v, preview = %+v", a, row.Preview)
	}
	for name, args := range map[string]string{
		"empty":     fmt.Sprintf(`{"room_id":%q,"body":"  "}`, dm),
		"too long":  fmt.Sprintf(`{"room_id":%q,"body":%q}`, dm, strings.Repeat("a", maxChatMessageBodyLen+1)),
		"a row ref": `{"room_id":"{{row:1.id}}","body":"x"}`,
		"no room":   `{"body":"x"}`,
		"odd field": fmt.Sprintf(`{"room_id":%q,"body":"x","priority":"high"}`, dm),
	} {
		_, err := writeToolNamed(t, s, "send_chat_message").prepare(context.Background(), tc, json.RawMessage(args), []askDraftRow{{Tool: "create_task"}})
		if code, _ := agentError(err); !strings.HasPrefix(code, "invalid_args") {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestAskWriteChatRoomMustBeTheAskers(t *testing.T) {
	x, s, _, secret, _ := askChatWorld(t)
	tc := askChatTC(x)
	for _, room := range []string{secret, "no-such-room"} {
		_, err := writeToolNamed(t, s, "send_chat_message").prepare(context.Background(), tc, json.RawMessage(fmt.Sprintf(`{"room_id":%q,"body":"x"}`, room)), nil)
		if code, ok := agentError(err); !ok || code != "not_found" {
			t.Errorf("room %s: err = %v", room, err)
		}
	}
}

func TestAskWriteChatApplyAndUndo(t *testing.T) {
	x, s, dm, _, run := askChatWorld(t)
	ctx := context.Background()
	res, inv, err := run(fmt.Sprintf(`{"room_id":%q,"body":"Họp lúc 9h"}`, dm))
	if err != nil || res.ObjectID == "" || inv == nil || inv.Op != "delete_chat_message" || res.Note != "" {
		t.Fatalf("apply: %+v %+v %v", res, inv, err)
	}
	var kind, sender string
	var deleted bool
	row := func() {
		t.Helper()
		if err := s.pool.QueryRow(ctx, `SELECT sender_kind, sender_id, deleted_at IS NOT NULL FROM chat_messages WHERE id = $1`, res.ObjectID).Scan(&kind, &sender, &deleted); err != nil {
			t.Fatal(err)
		}
	}
	row()
	if kind != "human" || sender != x.ua.ID || deleted {
		t.Fatalf("message: %s %s deleted=%v", kind, sender, deleted)
	}
	p := principalOf(askChatTC(x))
	if err := askInverses[inv.Op](ctx, s, p, inv.Args); err != nil {
		t.Fatal(err)
	}
	if row(); !deleted {
		t.Error("undo did not delete the message")
	}
	// Gone already: the undo reads as unavailable, not as a fault.
	assertUndoUnavailable(t, askInverses[inv.Op](ctx, s, p, inv.Args))
}
