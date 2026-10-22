package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ctxWorld is the agent world with a second member ub, and one object of each
// kind Ask UNI can take as context, all in the world's workspace.
type ctxWorld struct {
	x                *mcpToolWorld
	s                *AskUNIService
	fake             *provider.Fake
	task, doc, room  string
	project, meeting string
}

func newCtxWorld(t *testing.T) *ctxWorld {
	t.Helper()
	x, s, _ := newAgentWorld(t)
	ctx := context.Background()
	docs, doc := x.withDocs(t, "Quy trình nghỉ phép", mcpTestPage)
	_ = docs
	x.member(t)
	pr, err := s.tasks.CreateProject(ctx, Human(x.ua.ID), x.w.ID, CreateProjectInput{Title: "Website mới"})
	if err != nil {
		t.Fatal(err)
	}
	room, err := s.chat.CreateChannel(ctx, x.ua.ID, x.w.ID, CreateChannelInput{Name: "chung", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.chat.SendRoomMessage(ctx, x.ua.ID, x.w.ID, room.ID, SendChatMessageInput{Body: "Chốt báo giá hôm nay"}); err != nil {
		t.Fatal(err)
	}
	m := x.meeting(t, x.ua.ID, x.w.ID, "Họp tuần", "")
	s.SetFlags(agentFlagFake{org: x.w.OrganizationID})
	fake := &provider.Fake{Reply: ai.FakeReply}
	s.gw = ai.NewGateway(s.q, fake, NewAIQuota(s.meetings.ent), nil, ai.Options{})
	return &ctxWorld{x: x, s: s, fake: fake, task: x.taskID, doc: doc.Document.ID, room: room.ID, project: pr.ID, meeting: m.ID}
}

// agentOff makes the same turn run as P0.
func (c *ctxWorld) agentOff() { c.s.SetFlags(agentFlagFake{org: "none"}) }

// focusPrompt is the last user turn of the first request the fake saw.
func focusPrompt(reqs []provider.CompletionRequest) string {
	m := reqs[0].Messages
	return m[len(m)-1].Content
}

// block is the text of one numbered source in a rendered prompt.
func block(prompt, id string) string {
	_, rest, ok := strings.Cut(prompt, `<untrusted source="`+id+`">`)
	if !ok {
		return ""
	}
	body, _, _ := strings.Cut(rest, "</untrusted>")
	return body
}

func TestAskContextMentionsBecomeNumberedSources(t *testing.T) {
	c := newCtxWorld(t)
	reqs := scriptAgent(c.fake, "x", "Xong [S1]")
	_, err := c.s.Ask(context.Background(), c.x.ua.ID, c.x.w.ID, AskInput{
		Question: "Tóm tắt giúp", Locale: "vi", Focus: &ai.Focus{Kind: "task", ID: c.task},
		Mentions: []ai.Focus{{Kind: "document", ID: c.doc}, {Kind: "member", ID: c.x.ub.ID}},
	})
	if err != nil {
		t.Fatal(err)
	}
	p := focusPrompt(*reqs)
	if !strings.Contains(block(p, "S1"), "Chuẩn bị báo cáo quý") || !strings.Contains(block(p, "S2"), "Quy trình nghỉ phép") {
		t.Fatalf("focus block:\n%s", p)
	}
	m := block(p, "S3")
	if !strings.Contains(m, c.x.ub.DisplayName) || !strings.Contains(strings.ToLower(m), "member") || strings.Contains(m, "@") || strings.Contains(m, c.x.ub.Email) {
		t.Fatalf("member source %q", m)
	}
}

func TestAskContextRefusesAnUnreadableMention(t *testing.T) {
	c := newCtxWorld(t)
	ctx := context.Background()
	_, ws2 := c.x.org(t, c.x.ua.ID, "Beta", "beta")
	foreign := c.x.task(t, c.x.ua.ID, ws2.ID, "Việc workspace khác")
	secret, err := c.x.docs(t).CreatePage(ctx, Human(c.x.ua.ID), c.x.w.ID, CreatePageInput{Title: "Riêng tư", Visibility: documentVisibilityRestricted, Content: json.RawMessage(mcpTestPage)})
	if err != nil {
		t.Fatal(err)
	}
	private, err := c.s.chat.CreateChannel(ctx, c.x.ua.ID, c.x.w.ID, CreateChannelInput{Name: "kin", Visibility: "private"})
	if err != nil {
		t.Fatal(err)
	}
	// A member of no workspace of ours is not a member to mention.
	stranger := db.User{ID: "01STRANGER00000000000000000"}
	cases := map[string]ai.Focus{
		"task of another workspace": {Kind: "task", ID: foreign.ID},
		"restricted document":       {Kind: "document", ID: secret.Document.ID},
		"room the asker is not in":  {Kind: "room", ID: private.ID},
		"unknown member":            {Kind: "member", ID: stranger.ID},
	}
	for _, flagOn := range []bool{true, false} {
		if !flagOn {
			c.agentOff()
		}
		first, err := c.s.Ask(ctx, c.x.ub.ID, c.x.w.ID, AskInput{Question: "chào", Locale: "vi"})
		if err != nil {
			t.Fatal(err)
		}
		for name, m := range cases {
			for as, in := range map[string]AskInput{
				"mention": {ConversationID: first.ConversationID, Question: "?", Locale: "vi", Mentions: []ai.Focus{m}},
				"focus":   {ConversationID: first.ConversationID, Question: "?", Locale: "vi", Focus: &m},
			} {
				if as == "focus" && m.Kind == "member" || as == "mention" && m.Kind == "room" {
					continue // a member is only a mention, a room only a focus
				}
				before, calls := messageCount(t, c.s, first.ConversationID), c.fake.Calls
				var events []AskEvent
				_, err := c.s.AskStream(ctx, c.x.ub.ID, c.x.w.ID, in, collectEvents(&events))
				if !errors.Is(err, ai.ErrContextForbidden) || len(events) != 0 || messageCount(t, c.s, first.ConversationID) != before || c.fake.Calls != calls {
					t.Errorf("agent=%v %s as %s: err %v, events %v, calls %d", flagOn, name, as, err, eventNames(events), c.fake.Calls-calls)
				}
			}
		}
	}
}

func TestAskContextFocusKindsDocumentProjectRoom(t *testing.T) {
	c := newCtxWorld(t)
	for kind, want := range map[string]struct{ id, title string }{
		"document": {c.doc, "Quy trình nghỉ phép"},
		"project":  {c.project, "Website mới"},
		"room":     {c.room, "Chat: chung"},
		"meeting":  {c.meeting, "Họp tuần"},
	} {
		reqs := scriptAgent(c.fake, "x", "Xong [S1]")
		if _, err := c.s.Ask(context.Background(), c.x.ua.ID, c.x.w.ID, AskInput{Question: "Cái này là gì?", Locale: "vi", Focus: &ai.Focus{Kind: kind, ID: want.id}}); err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		if b := block(focusPrompt(*reqs), "S1"); !strings.Contains(b, want.title) {
			t.Errorf("%s focus block %q lacks %q", kind, b, want.title)
		}
	}
}

func TestAskContextRejectsBadMentions(t *testing.T) {
	c := newCtxWorld(t)
	ctx := context.Background()
	task := ai.Focus{Kind: "task", ID: c.task}
	six := []ai.Focus{task, {Kind: "document", ID: c.doc}, {Kind: "project", ID: c.project}, {Kind: "meeting", ID: c.meeting}, {Kind: "member", ID: c.x.ub.ID}, {Kind: "member", ID: c.x.ua.ID}}
	for name, ms := range map[string][]ai.Focus{
		"six":          six,
		"email thread": {{Kind: "email_thread", ID: "t1"}},
		"room":         {{Kind: "room", ID: c.room}},
		"empty id":     {{Kind: "task", ID: ""}},
	} {
		var ve ValidationError
		if _, err := c.s.Ask(ctx, c.x.ua.ID, c.x.w.ID, AskInput{Question: "?", Mentions: ms}); !errors.As(err, &ve) {
			t.Errorf("%s: err %v, want Invalid", name, err)
		}
	}
	// Five is the limit; the same object twice, or the focus again, is one source.
	reqs := scriptAgent(c.fake, "x", "Xong")
	_, err := c.s.Ask(ctx, c.x.ua.ID, c.x.w.ID, AskInput{Question: "?", Locale: "vi", Focus: &task, Mentions: []ai.Focus{task, {Kind: "document", ID: c.doc}, {Kind: "document", ID: c.doc}}})
	if err != nil {
		t.Fatal(err)
	}
	p := focusPrompt(*reqs)
	if block(p, "S1") == "" || block(p, "S2") == "" || strings.Contains(p, `source="S3"`) {
		t.Fatalf("duplicates must collapse to two sources:\n%s", p)
	}
}

func TestMentionedMemberLinksThePersonPage(t *testing.T) {
	c := newCtxWorld(t)
	tc := ai.ToolContext{ActorID: c.x.ua.ID, OrganizationID: c.x.w.OrganizationID, WorkspaceID: c.x.w.ID}
	items, err := c.s.mentionedMember(context.Background(), tc, c.x.ub.ID)
	if err != nil || len(items) != 1 {
		t.Fatalf("mentionedMember = %+v, %v", items, err)
	}
	if it := items[0]; !strings.HasSuffix(it.Href, "/people/"+c.x.ub.ID) || strings.Contains(it.Href, "/members") || it.ID != c.x.ub.ID || it.Text != "ID: "+c.x.ub.ID+"\nRole: member" {
		t.Errorf("item = %+v", it)
	}
}
