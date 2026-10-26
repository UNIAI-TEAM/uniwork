package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
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
	ctx := context.Background()
	uc, err := s.q.CreateUser(ctx, db.CreateUserParams{ID: util.NewID(), Email: "chat-other-c@example.com", DisplayName: "C", Locale: "vi"})
	if err != nil {
		t.Fatal(err)
	}
	addOrgMember(t, s.q, x.w.OrganizationID, uc.ID)
	addWorkspaceMember(t, s.q, x.w.ID, uc.ID)
	others, err := s.chat.ResolveDM(ctx, x.ub.ID, x.w.ID, uc.ID)
	if err != nil {
		t.Fatal(err)
	}
	v2, err := x.tools.ws.CreateInOrg(ctx, x.ua.ID, x.w.OrganizationID, "Beta", "beta-chat")
	if err != nil {
		t.Fatal(err)
	}
	elsewhere, err := s.chat.CreateChannel(ctx, x.ua.ID, v2.Workspace.ID, CreateChannelInput{Name: "kenh-khac", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	gone, err := s.chat.CreateChannel(ctx, x.ua.ID, x.w.ID, CreateChannelInput{Name: "kenh-cu", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.chat.ArchiveChannel(ctx, x.ua.ID, x.w.ID, gone.ID); err != nil {
		t.Fatal(err)
	}
	count := func() (n int) {
		if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM chat_messages`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	before := count()
	for name, room := range map[string]string{
		"a private channel": secret, "no such room": "no-such-room", "a dm of two others": others.ID,
		"a room of another workspace": elsewhere.ID, "an archived room": gone.ID,
	} {
		_, err := writeToolNamed(t, s, "send_chat_message").prepare(ctx, tc, json.RawMessage(fmt.Sprintf(`{"room_id":%q,"body":"x"}`, room)), nil)
		if code, ok := agentError(err); !ok || code != "not_found" {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	if count() != before {
		t.Error("a message was created")
	}
}

// The body is trimmed once, so the card, the stored args and the sent message
// agree; a body that names a member lists who is told.
func TestAskWriteChatPreviewIsWhatIsSent(t *testing.T) {
	x, s, dm, _, _ := askChatWorld(t)
	tc := askChatTC(x)
	body := fmt.Sprintf("Chào [@B](mention://member/%s)", x.ub.ID)
	args := fmt.Sprintf(`{"room_id":%q,"body":%q}`, dm, "  \n"+body+"\n ")
	row := askPrepare(t, s, tc, "send_chat_message", args)
	if row.Preview.Body != body || !strings.Contains(string(row.Args), `"body":"`+strings.ReplaceAll(body, "\"", `\"`)+`"`) {
		t.Errorf("body %q, args %s", row.Preview.Body, row.Args)
	}
	// A DM resolves no mentions; the list stays empty rather than guessing.
	if n := row.Preview.Audience.Notifies; n == nil || len(n) != 0 {
		t.Errorf("dm notifies = %+v", n)
	}
	group, err := s.chat.CreateChannel(context.Background(), x.ua.ID, x.w.ID, CreateChannelInput{Name: "kenh-chung", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.chat.JoinChannel(context.Background(), x.ub.ID, x.w.ID, group.ID); err != nil {
		t.Fatal(err)
	}
	row = askPrepare(t, s, tc, "send_chat_message", fmt.Sprintf(`{"room_id":%q,"body":%q}`, group.ID, body))
	if n := row.Preview.Audience.Notifies; len(n) != 1 || n[0].ID != x.ub.ID || row.Preview.Audience.NotifiesMore {
		t.Errorf("channel notifies = %+v", n)
	}
	if _, err := s.chat.SendRoomMessage(context.Background(), x.ua.ID, x.w.ID, dm, SendChatMessageInput{Body: "  \n" + body + "\n "}); err != nil {
		t.Fatal(err)
	}
	var sent string
	if err := s.pool.QueryRow(context.Background(), `SELECT body FROM chat_messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT 1`, dm).Scan(&sent); err != nil || sent != body {
		t.Errorf("sent %q, %v", sent, err)
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
