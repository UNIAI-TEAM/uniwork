package service

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
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
				if as == "focus" && m.Kind == "member" {
					continue // a member is only a mention
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

func TestMentionARoomTheAskerIsIn(t *testing.T) {
	c := newCtxWorld(t)
	ctx := context.Background()
	reqs := scriptAgent(c.fake, "x", "Xong [S1]")
	if _, err := c.s.Ask(ctx, c.x.ua.ID, c.x.w.ID, AskInput{Question: "Chốt gì?", Locale: "vi", Mentions: []ai.Focus{{Kind: "room", ID: c.room}}}); err != nil {
		t.Fatal(err)
	}
	if b := block(focusPrompt(*reqs), "S1"); !strings.Contains(b, "Chốt báo giá hôm nay") {
		t.Fatalf("room mention block %q lacks the room's message", b)
	}
	// A room the asker is not in is refused as a mention exactly as a focus.
	private, err := c.s.chat.CreateChannel(ctx, c.x.ua.ID, c.x.w.ID, CreateChannelInput{Name: "kin", Visibility: "private"})
	if err != nil {
		t.Fatal(err)
	}
	calls := c.fake.Calls
	_, err = c.s.Ask(ctx, c.x.ub.ID, c.x.w.ID, AskInput{Question: "?", Locale: "vi", Mentions: []ai.Focus{{Kind: "room", ID: private.ID}}})
	if !errors.Is(err, ai.ErrContextForbidden) || c.fake.Calls != calls {
		t.Fatalf("err %v, calls %d; want ai_context_forbidden before any call", err, c.fake.Calls-calls)
	}
}

type fakeDriveContentReader struct {
	calls   []fakeDriveReadCall
	content DriveContent
	err     error
}

type fakeDriveReadCall struct {
	requesterID, workspaceID, driveFileID string
	purpose                               DriveContentPurpose
}

func (r *fakeDriveContentReader) ReadForAI(_ context.Context, requesterID, workspaceID, driveFileID string, purpose DriveContentPurpose) (DriveContent, error) {
	r.calls = append(r.calls, fakeDriveReadCall{requesterID: requesterID, workspaceID: workspaceID, driveFileID: driveFileID, purpose: purpose})
	return r.content, r.err
}

func TestValidateAndMergeTranscriptUnit(t *testing.T) {
	// Empty / whitespace turns dropped and not counted toward the 20-turn limit;
	// consecutive same-role turns merged joined by a blank line.
	var turns []AskTranscriptTurn
	turns = append(turns, AskTranscriptTurn{Role: "user", Text: "   "}, AskTranscriptTurn{Role: "assistant", Text: "\n\t "})
	for i := range 20 {
		role := "user"
		if i >= 18 {
			role = "assistant"
		}
		turns = append(turns, AskTranscriptTurn{Role: role, Text: "lượt " + string(rune('A'+i))})
	}
	hist, err := validateAndMergeTranscript(turns)
	if err != nil {
		t.Fatalf("20 non-empty turns with 2 empty turns failed: %v", err)
	}
	if len(hist) != 2 || hist[0].Role != "user" || hist[1].Role != "assistant" {
		t.Fatalf("merged hist = %+v, want 2 merged messages (user, assistant)", hist)
	}
	if !strings.Contains(hist[0].Content, "lượt A\n\nlượt B") || !strings.HasPrefix(hist[0].Content, `<untrusted source="question">`) {
		t.Fatalf("user merged content = %q", hist[0].Content)
	}
	if !strings.Contains(hist[1].Content, "lượt S\n\nlượt T") || !strings.HasPrefix(hist[1].Content, `<untrusted source="prior_answer">`) {
		t.Fatalf("assistant merged content = %q", hist[1].Content)
	}

	// >20 non-empty turns -> 400 ValidationError
	over20 := append(slices.Clone(turns), AskTranscriptTurn{Role: "user", Text: "thừa"})
	var ve ValidationError
	if _, err := validateAndMergeTranscript(over20); !errors.As(err, &ve) {
		t.Fatalf(">20 turns err = %v, want ValidationError", err)
	}

	// >32,000 Unicode code points -> 400; 32,000 multi-byte runes (96,000 UTF-8 bytes) passes.
	exact32k := []AskTranscriptTurn{
		{Role: "user", Text: strings.Repeat("ă", 16_000)},
		{Role: "assistant", Text: strings.Repeat("đ", 16_000)},
	}
	if _, err := validateAndMergeTranscript(exact32k); err != nil {
		t.Fatalf("exact 32,000 runes failed: %v", err)
	}
	over32k := append(slices.Clone(exact32k), AskTranscriptTurn{Role: "user", Text: "x"})
	if _, err := validateAndMergeTranscript(over32k); !errors.As(err, &ve) {
		t.Fatalf(">32,000 runes err = %v, want ValidationError", err)
	}

	// Invalid role -> 400
	if _, err := validateAndMergeTranscript([]AskTranscriptTurn{{Role: "system", Text: "hi"}}); !errors.As(err, &ve) {
		t.Fatalf("system role err = %v, want ValidationError", err)
	}
}

func TestAskUniTransientValidationBeforeDB(t *testing.T) {
	s := &AskUNIService{}
	ctx := context.Background()
	var twentyOne []AskTranscriptTurn
	for range 21 {
		twentyOne = append(twentyOne, AskTranscriptTurn{Role: "user", Text: "hi"})
	}
	cases := map[string]AskInput{
		"drive_file without transient": {
			Question: "Tóm tắt", Focus: &ai.Focus{Kind: "drive_file", ID: "01DRIVEFILE000000000000001"},
		},
		"transient with conversation_id": {
			Question: "Tóm tắt", Transient: true, ConversationID: "01CONV00000000000000000001",
		},
		"transient with regenerate_message_id": {
			Question: "Tóm tắt", Transient: true, Regenerate: "01MSG000000000000000000001", Dock: true,
		},
		"transient with attachment_ids": {
			Question: "Tóm tắt", Transient: true, AttachmentIDs: []string{"01FILE00000000000000000001"},
		},
		"transcript without transient": {
			Question: "Tóm tắt", Transcript: []AskTranscriptTurn{{Role: "user", Text: "trước đó"}},
		},
		"transcript over 20 turns": {
			Question: "Tóm tắt", Transient: true, Transcript: twentyOne,
		},
		"transcript over 32000 runes": {
			Question: "Tóm tắt", Transient: true, Transcript: []AskTranscriptTurn{{Role: "user", Text: strings.Repeat("a", 32_001)}},
		},
		"transcript bad role": {
			Question: "Tóm tắt", Transient: true, Transcript: []AskTranscriptTurn{{Role: "tool", Text: "x"}},
		},
	}
	for name, in := range cases {
		var events []AskEvent
		var ve ValidationError
		if _, err := s.AskStream(ctx, "u1", "w1", in, collectEvents(&events)); !errors.As(err, &ve) || len(events) != 0 {
			t.Errorf("%s: err = %v, events = %v; want ValidationError before any event", name, err, eventNames(events))
		}
	}
}

func TestDriveReadErrorNotesUnit(t *testing.T) {
	for _, err := range []error{
		ErrDriveAccessRequired, ErrDriveGrantRequired, ErrDriveFileNotAccessible,
		ErrDriveUnavailable, ErrDriveFormatUnsupported, ErrDriveExtractUnavailable,
	} {
		for _, locale := range []string{"vi", "en"} {
			note, ok := driveReadErrorNote(err, locale)
			if !ok || note == "" || !strings.Contains(note, err.Error()) {
				t.Errorf("err %v locale %s: ok=%v note=%q", err, locale, ok, note)
			}
		}
	}
	if _, ok := driveReadErrorNote(errors.New("boom"), "vi"); ok {
		t.Fatal("unknown error must not map to a note")
	}
	// ErrDriveFileNotFound maps to ai.ErrContextForbidden in askContextWithLocale.
	s := &AskUNIService{drive: &fakeDriveContentReader{err: ErrDriveFileNotFound}}
	tc := ai.ToolContext{ActorID: "u1", OrganizationID: "org1", WorkspaceID: "ws1"}
	if _, _, err := s.askContextWithLocale(context.Background(), tc, &ai.Focus{Kind: "drive_file", ID: "01DRIVEFILE000000000000001"}, nil, "vi"); !errors.Is(err, ai.ErrContextForbidden) {
		t.Fatalf("ErrDriveFileNotFound err = %v, want ai.ErrContextForbidden", err)
	}
	// Nil reader defaults to ErrDriveUnavailable note without panicking.
	sNil := &AskUNIService{}
	items, _, err := sNil.askContextWithLocale(context.Background(), tc, &ai.Focus{Kind: "drive_file", ID: "01DRIVEFILE000000000000001"}, nil, "vi")
	if err != nil || len(items) != 1 || !strings.Contains(items[0].Body, "drive_unavailable") {
		t.Fatalf("nil reader items=%+v err=%v", items, err)
	}
	// Truncated flag adds the 200,000-character note; PDF attachment attaches to refs.Drive.Attachments.
	pdfPart := provider.Part{MIME: "application/pdf", Data: []byte("%PDF-1.4")}
	sDoc := &AskUNIService{drive: &fakeDriveContentReader{
		content: DriveContent{
			DriveFileID: "01DRIVEFILE000000000000002", Name: "Spec.pdf", MimeType: "application/pdf",
			Truncated: true, Attachments: []provider.Part{pdfPart},
		},
	}}
	docItems, docRefs, err := sDoc.askContextWithLocale(context.Background(), tc, &ai.Focus{Kind: "drive_file", ID: "01DRIVEFILE000000000000002"}, nil, "vi")
	if err != nil || len(docItems) != 1 || !strings.Contains(docItems[0].Text, "200.000") || docRefs.Drive == nil || len(docRefs.Drive.Attachments) != 1 {
		t.Fatalf("truncated/pdf docItems=%+v docRefs=%+v err=%v", docItems, docRefs, err)
	}
}

func TestAskUniDriveFocusIsNotPersisted(t *testing.T) {
	c := newCtxWorld(t)
	ctx := context.Background()
	driveID := "01DRIVEFILE000000000000001"
	reader := &fakeDriveContentReader{
		content: DriveContent{
			DriveFileID: driveID, Name: "Kế hoạch ra mắt Q4", MimeType: "text/markdown",
			Text: "Mốc beta: 2026-11-01. Mốc chính thức: 2026-11-15.",
		},
	}
	c.s.SetDriveContentReader(reader)

	countRows := func(table string) int {
		return c.x.count(t, "SELECT count(*) FROM "+table+" WHERE organization_id = $1", c.x.w.OrganizationID)
	}
	convBefore := countRows("ai_conversations")
	msgBefore := countRows("ai_messages")
	propBefore := countRows("agent_action_proposals")
	memPropBefore := countRows("ai_memory_proposals")
	attBefore := countRows("ai_attachments")
	usageBefore := usageCount(t, c.s, c.x.w.OrganizationID)

	for _, agentOn := range []bool{false, true} {
		if agentOn {
			c.s.SetFlags(agentFlagFake{org: c.x.w.OrganizationID})
			scriptAgent(c.fake, "mốc", "Mốc beta 01/11 [S1]")
		} else {
			c.agentOff()
			c.fake.Reply = ai.FakeReply
		}
		callsBefore := len(reader.calls)
		r1, err := c.s.Ask(ctx, c.x.ua.ID, c.x.w.ID, AskInput{
			Question:  "Mốc nào trong tài liệu?",
			Locale:    "vi",
			Transient: true,
			Focus:     &ai.Focus{Kind: "drive_file", ID: driveID},
		})
		if err != nil {
			t.Fatalf("agent=%v q1: %v", agentOn, err)
		}
		if r1.ConversationID != "" || r1.Message.ID != "" || r1.Message.Content == "" {
			t.Fatalf("agent=%v q1 result: conv=%q msgID=%q content=%q", agentOn, r1.ConversationID, r1.Message.ID, r1.Message.Content)
		}
		if agentOn {
			scriptAgent(c.fake, "chính thức", "Mốc chính thức 15/11 [S1]")
		}
		r2, err := c.s.Ask(ctx, c.x.ua.ID, c.x.w.ID, AskInput{
			Question:  "Còn mốc chính thức?",
			Locale:    "vi",
			Transient: true,
			Focus:     &ai.Focus{Kind: "drive_file", ID: driveID},
			Transcript: []AskTranscriptTurn{
				{Role: "user", Text: "Mốc nào trong tài liệu?"},
				{Role: "assistant", Text: r1.Message.Content},
			},
		})
		if err != nil {
			t.Fatalf("agent=%v q2: %v", agentOn, err)
		}
		if r2.ConversationID != "" || r2.Message.ID != "" || r2.Message.Content == "" {
			t.Fatalf("agent=%v q2 result: conv=%q msgID=%q content=%q", agentOn, r2.ConversationID, r2.Message.ID, r2.Message.Content)
		}
		if got := len(reader.calls) - callsBefore; got != 2 {
			t.Fatalf("agent=%v reader calls = %d, want 2 (once per request)", agentOn, got)
		}
		for _, call := range reader.calls[callsBefore:] {
			if call.requesterID != c.x.ua.ID || call.workspaceID != c.x.w.ID || call.driveFileID != driveID || call.purpose != DriveContentPurposeAskUni {
				t.Fatalf("agent=%v reader call = %+v", agentOn, call)
			}
		}
	}

	if countRows("ai_conversations") != convBefore || countRows("ai_messages") != msgBefore ||
		countRows("agent_action_proposals") != propBefore || countRows("ai_memory_proposals") != memPropBefore ||
		countRows("ai_attachments") != attBefore {
		t.Fatalf("transient questions wrote conversation/message/proposal/attachment rows")
	}
	if usageCount(t, c.s, c.x.w.OrganizationID) <= usageBefore {
		t.Fatalf("expected ai_usage_events rows to be recorded")
	}
}

func TestAskUniDriveFocusAccessErrorsAndDefaultReader(t *testing.T) {
	c := newCtxWorld(t)
	ctx := context.Background()
	driveID := "01DRIVEFILE000000000000002"

	// Nil reader & default reader -> answers with Drive unavailable note, no panic.
	c.s.SetDriveContentReader(nil)
	for _, agentOn := range []bool{false, true} {
		if agentOn {
			c.s.SetFlags(agentFlagFake{org: c.x.w.OrganizationID})
			reqs := scriptAgent(c.fake, "x", "Không đọc được [S1]")
			res, err := c.s.Ask(ctx, c.x.ua.ID, c.x.w.ID, AskInput{
				Question: "Tóm tắt?", Locale: "vi", Transient: true, Focus: &ai.Focus{Kind: "drive_file", ID: driveID},
			})
			if err != nil || res.Message.Content == "" {
				t.Fatalf("nil reader agent=true: err=%v content=%q", err, res.Message.Content)
			}
			if p := focusPrompt(*reqs); !strings.Contains(p, "drive_unavailable") {
				t.Fatalf("nil reader agent=true prompt lacks drive_unavailable:\n%s", p)
			}
		} else {
			c.agentOff()
			c.fake.Reply = ai.FakeReply
			res, err := c.s.Ask(ctx, c.x.ua.ID, c.x.w.ID, AskInput{
				Question: "Tóm tắt?", Locale: "vi", Transient: true, Focus: &ai.Focus{Kind: "drive_file", ID: driveID},
			})
			if err != nil || res.Message.Content == "" {
				t.Fatalf("nil reader agent=false: err=%v content=%q", err, res.Message.Content)
			}
			if p := c.fake.Last.Messages[len(c.fake.Last.Messages)-1].Content; !strings.Contains(p, "drive_unavailable") {
				t.Fatalf("nil reader agent=false prompt lacks drive_unavailable:\n%s", p)
			}
		}
	}

	// Access errors -> 200 with note on both paths; ErrDriveFileNotFound -> ai.ErrContextForbidden.
	reader := &fakeDriveContentReader{content: DriveContent{DriveFileID: driveID, Name: "Báo cáo"}}
	c.s.SetDriveContentReader(reader)
	for _, tcErr := range []error{
		ErrDriveAccessRequired, ErrDriveGrantRequired, ErrDriveFileNotAccessible,
		ErrDriveUnavailable, ErrDriveFormatUnsupported, ErrDriveExtractUnavailable,
	} {
		reader.err = tcErr
		for _, agentOn := range []bool{false, true} {
			if agentOn {
				c.s.SetFlags(agentFlagFake{org: c.x.w.OrganizationID})
				reqs := scriptAgent(c.fake, "x", "Không đọc được [S1]")
				if _, err := c.s.Ask(ctx, c.x.ua.ID, c.x.w.ID, AskInput{
					Question: "Tóm tắt?", Locale: "vi", Transient: true, Focus: &ai.Focus{Kind: "drive_file", ID: driveID},
				}); err != nil {
					t.Fatalf("err=%v agent=true: %v", tcErr, err)
				}
				if p := focusPrompt(*reqs); !strings.Contains(p, tcErr.Error()) {
					t.Fatalf("err=%v agent=true prompt lacks code:\n%s", tcErr, p)
				}
			} else {
				c.agentOff()
				c.fake.Reply = ai.FakeReply
				if _, err := c.s.Ask(ctx, c.x.ua.ID, c.x.w.ID, AskInput{
					Question: "Tóm tắt?", Locale: "vi", Transient: true, Focus: &ai.Focus{Kind: "drive_file", ID: driveID},
				}); err != nil {
					t.Fatalf("err=%v agent=false: %v", tcErr, err)
				}
				if p := c.fake.Last.Messages[len(c.fake.Last.Messages)-1].Content; !strings.Contains(p, tcErr.Error()) {
					t.Fatalf("err=%v agent=false prompt lacks code:\n%s", tcErr, p)
				}
			}
		}
	}

	reader.err = ErrDriveFileNotFound
	if _, err := c.s.Ask(ctx, c.x.ua.ID, c.x.w.ID, AskInput{
		Question: "Tóm tắt?", Locale: "vi", Transient: true, Focus: &ai.Focus{Kind: "drive_file", ID: driveID},
	}); !errors.Is(err, ai.ErrContextForbidden) {
		t.Fatalf("ErrDriveFileNotFound: got %v, want ai.ErrContextForbidden", err)
	}
}

func TestAskUniDriveFocusTextAndPDFFirstCallOnly(t *testing.T) {
	c := newCtxWorld(t)
	ctx := context.Background()
	driveID := "01DRIVEFILE000000000000003"
	pdfPart := provider.Part{MIME: "application/pdf", Data: []byte("%PDF-1.4 fake")}
	reader := &fakeDriveContentReader{
		content: DriveContent{
			DriveFileID: driveID, Name: "Hợp đồng.pdf", MimeType: "application/pdf",
			Attachments: []provider.Part{pdfPart},
		},
	}
	c.s.SetDriveContentReader(reader)
	c.s.SetFlags(agentFlagFake{org: c.x.w.OrganizationID})
	reqs := scriptAgent(c.fake, "hợp đồng", "Tóm tắt hợp đồng [S1]")
	if _, err := c.s.Ask(ctx, c.x.ua.ID, c.x.w.ID, AskInput{
		Question: "Tóm tắt hợp đồng", Locale: "vi", Transient: true, Focus: &ai.Focus{Kind: "drive_file", ID: driveID},
	}); err != nil {
		t.Fatal(err)
	}
	if len(*reqs) != 2 {
		t.Fatalf("calls = %d, want 2 (tool round + answer round)", len(*reqs))
	}
	firstMsgs := (*reqs)[0].Messages
	if got := firstMsgs[len(firstMsgs)-1].Parts; len(got) != 1 || got[0].MIME != "application/pdf" {
		t.Fatalf("first call user message parts = %+v, want 1 PDF part", got)
	}
	for i, m := range (*reqs)[1].Messages {
		if len(m.Parts) != 0 {
			t.Fatalf("second call message %d (%s) carried %d parts, want 0 on tool-result turn", i, m.Role, len(m.Parts))
		}
	}
}

func TestAskUniStreamTransientRunFrameAndStopLeavesNoRow(t *testing.T) {
	c := newCtxWorld(t)
	ctx := context.Background()
	driveID := "01DRIVEFILE000000000000004"
	c.s.SetDriveContentReader(&fakeDriveContentReader{
		content: DriveContent{DriveFileID: driveID, Name: "Kế hoạch", MimeType: "text/plain", Text: "Nội dung kế hoạch"},
	})
	c.s.SetFlags(agentFlagFake{org: c.x.w.OrganizationID})
	c.fake.StreamChunk = 2
	c.fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: "Câu trả lời dài để cắt giữa chừng", UsagePresent: true, InputTokens: 10, OutputTokens: 10, StopReason: "end_turn"}
	}
	beforeMsg := c.x.count(t, `SELECT count(*) FROM ai_messages WHERE organization_id = $1`, c.x.w.OrganizationID)
	beforeConv := c.x.count(t, `SELECT count(*) FROM ai_conversations WHERE organization_id = $1`, c.x.w.OrganizationID)

	runCtx, cancel := context.WithCancel(ctx)
	var events []AskEvent
	_, _ = c.s.AskStream(runCtx, c.x.ua.ID, c.x.w.ID, AskInput{
		Question: "Kế hoạch gì?", Locale: "vi", Dock: true, Transient: true,
		Focus: &ai.Focus{Kind: "drive_file", ID: driveID},
	}, cancelOnDelta(&events, 1, cancel))

	if len(events) == 0 || events[0].Name != "run" || events[0].Run == nil || events[0].Run.ConversationID != "" {
		t.Fatalf("first event = %+v, want run with empty conversation_id", events)
	}
	if c.x.count(t, `SELECT count(*) FROM ai_messages WHERE organization_id = $1`, c.x.w.OrganizationID) != beforeMsg ||
		c.x.count(t, `SELECT count(*) FROM ai_conversations WHERE organization_id = $1`, c.x.w.OrganizationID) != beforeConv {
		t.Fatalf("stopped transient stream left rows in ai_conversations or ai_messages")
	}
}
