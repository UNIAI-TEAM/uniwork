package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// uploadAskFile uploads body as the asker's next file and returns its id.
func uploadAskFile(t *testing.T, s *AskUNIService, userID, workspaceID, name string, body []byte) string {
	t.Helper()
	up, err := s.UploadAttachment(context.Background(), userID, workspaceID, name, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	return up.FileID
}

// titleCall is the call that names a new conversation after its first answer.
func titleCall(req provider.CompletionRequest) bool {
	return strings.Contains(req.System, "Name this conversation")
}

// scriptRounds makes the fake search in its first rounds replies, then answer;
// every reply reports usage. Every request of the run is kept; the title call
// is answered apart.
func scriptRounds(fake *provider.Fake, rounds int, answer string, usage provider.CompletionResponse) *[]provider.CompletionRequest {
	seen := &[]provider.CompletionRequest{}
	fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		if titleCall(req) {
			return provider.CompletionResponse{Text: "Tiêu đề", UsagePresent: true, StopReason: "end_turn"}
		}
		*seen = append(*seen, req)
		r := usage
		r.UsagePresent = true
		if len(*seen) <= rounds {
			r.ToolCalls, r.StopReason = []provider.ToolCall{searchCall("call-1")}, "tool_use"
			return r
		}
		r.Text, r.StopReason = answer, "end_turn"
		return r
	}
	return seen
}

// fileParts is the MIME types of the media parts a request sent, and how many
// messages carried them; each is required to be a user message.
func fileParts(t *testing.T, req provider.CompletionRequest) (mimes []string, carriers int) {
	t.Helper()
	for _, m := range req.Messages {
		if len(m.Parts) == 0 {
			continue
		}
		if m.Role != "user" {
			t.Fatalf("a %s message carries %d parts, want parts on the user message only", m.Role, len(m.Parts))
		}
		carriers++
		for _, p := range m.Parts {
			mimes = append(mimes, p.MIME)
		}
	}
	return mimes, carriers
}

// requireOnePDF fails unless every request sent the one PDF, on one message.
func requireOnePDF(t *testing.T, reqs []provider.CompletionRequest) {
	t.Helper()
	for i, req := range reqs {
		if mimes, n := fileParts(t, req); n != 1 || !slices.Equal(mimes, []string{"application/pdf"}) {
			t.Fatalf("request %d sent parts %v on %d messages, want one PDF on one message", i, mimes, n)
		}
	}
}

func TestAskAgentSendsFilesOnEveryRound(t *testing.T) {
	s, fake, _, ua, _, w := attachAgentFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	f := uploadAskFile(t, s, ua.ID, w.ID, "bao-cao.pdf", pdfOfPages(3))
	reqs := scriptRounds(fake, 2, "Xong [S1]", provider.CompletionResponse{InputTokens: 10, OutputTokens: 5})
	if _, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "Tóm tắt file", Locale: "vi", Dock: true, AttachmentIDs: []string{f}}); err != nil {
		t.Fatal(err)
	}
	if len(*reqs) != 3 {
		t.Fatalf("provider calls %d, want 3 (two tool rounds and the answer)", len(*reqs))
	}
	requireOnePDF(t, *reqs)
}

// The one retry after a malformed reply is a continuation, which the gateway
// refuses to give attachments: the files ride the replayed question instead.
func TestAskAgentRetryWithFilesStillSendsThem(t *testing.T) {
	s, fake, _, ua, _, w := attachAgentFixture(t)
	f := uploadAskFile(t, s, ua.ID, w.ID, "bao-cao.pdf", pdfOfPages(2))
	var reqs []provider.CompletionRequest
	fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		if titleCall(req) {
			return provider.CompletionResponse{Text: "Tiêu đề", UsagePresent: true, StopReason: "end_turn"}
		}
		reqs = append(reqs, req)
		if len(reqs) == 1 {
			return provider.CompletionResponse{Text: " ", StopReason: "end_turn", UsagePresent: true, InputTokens: 10}
		}
		return provider.CompletionResponse{Text: "File có 2 trang.", StopReason: "end_turn", UsagePresent: true, InputTokens: 10}
	}
	res, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "File mấy trang?", Locale: "vi", Dock: true, AttachmentIDs: []string{f}})
	if err != nil {
		t.Fatal(err)
	}
	if len(reqs) != 2 || res.Message.Content != "File có 2 trang." || res.Message.Notice.String != "" {
		t.Fatalf("calls %d, stored %+v; want the retry answered", len(reqs), res.Message)
	}
	if last := reqs[1].Messages[len(reqs[1].Messages)-1]; last.Content != agentReminder {
		t.Fatalf("the retry ends with %q, want the reminder", last.Content)
	}
	requireOnePDF(t, reqs)
}

func TestAskAgentFollowUpCarriesEarlierFiles(t *testing.T) {
	s, fake, _, ua, _, w := attachAgentFixture(t)
	ctx := context.Background()
	f := uploadAskFile(t, s, ua.ID, w.ID, "bao-cao.pdf", pdfOfPages(2))
	scriptRounds(fake, 0, "Đã đọc.", provider.CompletionResponse{InputTokens: 10})
	first, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "Đọc file này", Locale: "vi", Dock: true, AttachmentIDs: []string{f}})
	if err != nil {
		t.Fatal(err)
	}
	reqs := scriptRounds(fake, 1, "Xong.", provider.CompletionResponse{InputTokens: 10})
	if _, err := s.Ask(ctx, ua.ID, w.ID, AskInput{ConversationID: first.ConversationID, Question: "Trang 2 nói gì?", Locale: "vi", Dock: true}); err != nil {
		t.Fatal(err)
	}
	requireOnePDF(t, *reqs)
	// The file rides the current question, not the old one (spec §10.6).
	first2 := (*reqs)[0].Messages
	if q := first2[len(first2)-1]; q.Role != "user" || len(q.Parts) != 1 || !strings.Contains(q.Content, "Trang 2 nói gì?") {
		t.Fatalf("the current question carries %d parts:\n%s", len(q.Parts), q.Content)
	}
}

func TestAskAgentRegenerateRereadsTheFiles(t *testing.T) {
	s, fake, _, ua, _, w := attachAgentFixture(t)
	ctx := context.Background()
	f := uploadAskFile(t, s, ua.ID, w.ID, "bao-cao.pdf", pdfOfPages(2))
	scriptRounds(fake, 0, "Câu trả lời cũ.", provider.CompletionResponse{InputTokens: 10})
	first, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "Đọc file này", Locale: "vi", Dock: true, AttachmentIDs: []string{f}})
	if err != nil {
		t.Fatal(err)
	}
	reqs := scriptRounds(fake, 0, "Câu trả lời mới.", provider.CompletionResponse{InputTokens: 10})
	res, err := s.Ask(ctx, ua.ID, w.ID, AskInput{ConversationID: first.ConversationID, Regenerate: first.Message.ID, Locale: "vi", Dock: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.Message.Content != "Câu trả lời mới." {
		t.Fatalf("stored %+v", res.Message)
	}
	requireOnePDF(t, *reqs)
}

// A turn with files reads them again on every round from the cache; a cache
// read counts a tenth against the input budget, so the files do not use up
// the rounds. Without files the count is today's.
func TestAskAgentCountsCachedFileReadsAtATenth(t *testing.T) {
	usage := provider.CompletionResponse{InputTokens: 10, OutputTokens: 5, CacheReadTokens: 70_000}
	s, fake, _, ua, _, w := attachAgentFixture(t)
	agentTask(t, s, ua, w, "Banner Tết")
	for _, withFile := range []bool{true, false} {
		in := AskInput{Question: "Banner?", Locale: "vi", Dock: true}
		if withFile {
			in.AttachmentIDs = []string{uploadAskFile(t, s, ua.ID, w.ID, "bao-cao.pdf", pdfOfPages(2))}
		}
		reqs := scriptRounds(fake, 2, "Xong [S1]", usage)
		if _, err := s.Ask(context.Background(), ua.ID, w.ID, in); err != nil {
			t.Fatal(err)
		}
		// Under budget the third call answers after both tool rounds; over it,
		// the second call is already the answer round.
		got := *reqs
		switch {
		case withFile && (len(got) != 3 || strings.Contains(lastToolOf(got[2]), "Tool budget reached")):
			t.Fatalf("with a file: %d calls, want both tool rounds and an answer under budget", len(got))
		case !withFile && (len(got) < 2 || !strings.HasSuffix(lastToolOf(got[1]), agentBudgetNote)):
			t.Fatalf("without a file: %d calls, want the budget to make the second call the answer round", len(got))
		}
	}
}

func TestAskAgentUsesPromptV5OnlyWithFiles(t *testing.T) {
	s, fake, _, ua, _, w := attachAgentFixture(t)
	ctx := context.Background()
	f := uploadAskFile(t, s, ua.ID, w.ID, "ke-hoach.txt", []byte("Mục tiêu quý 4: ra mắt app.\nNgân sách: 200 triệu."))
	for _, tc := range []struct {
		files  []string
		prompt string
	}{
		{[]string{f}, "copilot_answer@5"},
		{nil, "copilot_answer@4"},
	} {
		reqs := scriptRounds(fake, 0, "Xong.", provider.CompletionResponse{InputTokens: 10})
		res, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "Mục tiêu là gì?", Locale: "vi", Dock: true, AttachmentIDs: tc.files})
		if err != nil {
			t.Fatal(err)
		}
		p, ok := ai.LookupPrompt(tc.prompt)
		first := (*reqs)[0]
		user := first.Messages[len(first.Messages)-1].Content
		if !ok || first.System != p.System {
			t.Fatalf("files %v: system is not %s (registered %v)", tc.files, tc.prompt, ok)
		}
		if hasFile := strings.Contains(user, "ke-hoach.txt") && strings.Contains(user, "Ngân sách: 200 triệu."); hasFile != (len(tc.files) > 0) {
			t.Fatalf("files %v: the user turn shows the file %v:\n%s", tc.files, hasFile, user)
		}
		u, err := s.q.AiGetUsageEvent(ctx, res.Message.UsageEventID.String)
		if err != nil || u.PromptID != tc.prompt {
			t.Fatalf("files %v: usage prompt %q %v, want %s", tc.files, u.PromptID, err, tc.prompt)
		}
	}
}

// A file read in part is noted on the answer, in the unit the asker knows it
// by; the question and an answer without files carry no note.
func TestAskAgentStoresFileNotes(t *testing.T) {
	s, fake, _, ua, _, w := attachAgentFixture(t)
	ctx := context.Background()
	f := uploadAskFile(t, s, ua.ID, w.ID, "bao-cao.pdf", pdfOfPages(80))
	reqs := scriptRounds(fake, 0, "Đã đọc 15 trang đầu.", provider.CompletionResponse{InputTokens: 10})
	res, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "Tóm tắt", Locale: "vi", Dock: true, AttachmentIDs: []string{f}})
	if err != nil {
		t.Fatal(err)
	}
	want := []askFileNote{{Name: "bao-cao.pdf", Unit: "page", Read: 15, Total: 80}}
	var got []askFileNote
	if err := json.Unmarshal([]byte(res.Message.FileNotes), &got); err != nil || !slices.Equal(got, want) {
		t.Fatalf("file_notes %q (%v), want %+v", res.Message.FileNotes, err, want)
	}
	if !strings.Contains(res.Message.FileNotes, `"unit":"page"`) {
		t.Fatalf("file_notes %q, want the API's lower-case keys", res.Message.FileNotes)
	}
	// The model is told how much was read.
	first := (*reqs)[0]
	if user := first.Messages[len(first.Messages)-1].Content; !strings.Contains(user, "pages 1 to 15 of 80") {
		t.Fatalf("the user turn does not note the part read:\n%s", user)
	}
	msgs, err := s.Messages(ctx, ua.ID, res.ConversationID)
	if err != nil || len(msgs) != 2 || msgs[0].FileNotes != "[]" || msgs[1].FileNotes != res.Message.FileNotes {
		t.Fatalf("messages %d (%v): question notes %q, answer notes %q", len(msgs), err, msgs[0].FileNotes, msgs[1].FileNotes)
	}
	scriptRounds(fake, 0, "Không có file.", provider.CompletionResponse{InputTokens: 10})
	plain, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "Có gì mới?", Locale: "vi", Dock: true})
	if err != nil || plain.Message.FileNotes != "[]" {
		t.Fatalf("an answer without files: notes %q (%v), want []", plain.Message.FileNotes, err)
	}
}

// A file the reader cannot open refuses the question before any model call,
// and nothing of it is stored.
func TestAskAgentRefusesAnUnreadableFile(t *testing.T) {
	s, fake, _, ua, _, w := attachAgentFixture(t)
	f := uploadAskFile(t, s, ua.ID, w.ID, "hong.pdf", pdfBody("broken"))
	scriptRounds(fake, 0, "Xong.", provider.CompletionResponse{InputTokens: 10})
	_, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "Tóm tắt", Locale: "vi", Dock: true, AttachmentIDs: []string{f}})
	var e *ai.Error
	if !errors.Is(err, ai.ErrAttachmentUnreadable) || !errors.As(err, &e) || !strings.Contains(e.Msg, "hong.pdf") {
		t.Fatalf("a broken PDF: %v, want ai_attachment_unreadable naming the file", err)
	}
	if fake.Calls != 0 {
		t.Fatalf("provider calls %d, want none", fake.Calls)
	}
	requireNoQuestionStored(t, s, f)
}

// failingOpen is a file store whose reads fail, as an outage would.
type failingOpen struct{ files.Service }

func (failingOpen) Open(context.Context, files.OpenInput) (files.Reader, error) {
	return files.Reader{}, files.StorageUnavailable(errors.New("store down"))
}

// A file the store cannot serve fails the turn like any storage failure; it is
// not the asker's file that is unreadable.
func TestAskAgentStorageFailureIsNotUnreadable(t *testing.T) {
	s, fake, _, ua, _, w := attachAgentFixture(t)
	ctx := context.Background()
	f := uploadAskFile(t, s, ua.ID, w.ID, "bao-cao.pdf", pdfOfPages(2))
	scriptRounds(fake, 0, "Đã đọc.", provider.CompletionResponse{InputTokens: 10})
	first, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "Đọc file này", Locale: "vi", Dock: true, AttachmentIDs: []string{f}})
	if err != nil {
		t.Fatal(err)
	}
	calls := fake.Calls
	s.SetFiles(failingOpen{s.files})
	_, err = s.Ask(ctx, ua.ID, w.ID, AskInput{ConversationID: first.ConversationID, Question: "Trang 2?", Locale: "vi", Dock: true})
	if err == nil || errors.Is(err, ai.ErrAttachmentUnreadable) {
		t.Fatalf("a store outage: %v, want a plain failure", err)
	}
	var ce CodedError
	if errors.As(err, &ce) {
		t.Fatalf("a store outage: coded %s, want an internal error", ce.Code)
	}
	rows, err := s.q.AiListMessages(ctx, first.ConversationID)
	if fake.Calls != calls || err != nil || len(rows) != 2 {
		t.Fatalf("calls %d → %d, messages %d (%v); want no call and nothing stored", calls, fake.Calls, len(rows), err)
	}
}

// holdSlots takes every slot of sem until the test ends.
func holdSlots(t *testing.T, sem chan struct{}) {
	t.Helper()
	for range cap(sem) {
		sem <- struct{}{}
	}
	t.Cleanup(func() {
		for range cap(sem) {
			<-sem
		}
	})
}

// At most askFileTurns turns run with files at once. A turn waiting for one
// gives up with its context, before any model call.
func TestAskAgentWaitsForAFileTurnWithinItsContext(t *testing.T) {
	s, fake, _, ua, _, w := attachAgentFixture(t)
	f := uploadAskFile(t, s, ua.ID, w.ID, "bao-cao.pdf", pdfOfPages(2))
	scriptRounds(fake, 0, "Xong.", provider.CompletionResponse{InputTokens: 10})
	holdSlots(t, s.fileTurns)
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "Tóm tắt", Locale: "vi", Dock: true, AttachmentIDs: []string{f}})
	if !errors.Is(err, context.DeadlineExceeded) || fake.Calls != 0 {
		t.Fatalf("file turns held: %v after %d calls, want the context's deadline and no call", err, fake.Calls)
	}
	if took := time.Since(started); took > 5*time.Second {
		t.Fatalf("the turn waited %s past its context", took)
	}
	requireNoQuestionStored(t, s, f)
}

// One turn reads and fits its files at a time. A turn waiting for that gives
// up with its context, before any model call, and gives its file turn back.
func TestAskAgentWaitsForTheFileReadWithinItsContext(t *testing.T) {
	s, fake, _, ua, _, w := attachAgentFixture(t)
	f := uploadAskFile(t, s, ua.ID, w.ID, "bao-cao.pdf", pdfOfPages(2))
	scriptRounds(fake, 0, "Xong.", provider.CompletionResponse{InputTokens: 10})
	holdSlots(t, s.fileReads)
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	_, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "Tóm tắt", Locale: "vi", Dock: true, AttachmentIDs: []string{f}})
	if !errors.Is(err, context.DeadlineExceeded) || fake.Calls != 0 {
		t.Fatalf("file read held: %v after %d calls, want the context's deadline and no call", err, fake.Calls)
	}
	if n := len(s.fileTurns); n != 0 {
		t.Fatalf("%d file turns still held after the turn gave up", n)
	}
	requireNoQuestionStored(t, s, f)
}

// A turn with files holds its file turn through every model call of the run
// and gives it back when the run ends, answered or refused.
func TestAskAgentHoldsAFileTurnForTheWholeRun(t *testing.T) {
	s, fake, _, ua, _, w := attachAgentFixture(t)
	scriptRounds(fake, 1, "Xong.", provider.CompletionResponse{InputTokens: 10})
	script := fake.Reply
	var held []int // file turns held during each call of the run
	fake.Reply = func(req provider.CompletionRequest) provider.CompletionResponse {
		if !titleCall(req) {
			held = append(held, len(s.fileTurns))
		}
		return script(req)
	}
	f := uploadAskFile(t, s, ua.ID, w.ID, "bao-cao.pdf", pdfOfPages(2))
	res, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "Tóm tắt", Locale: "vi", Dock: true, AttachmentIDs: []string{f}})
	if err != nil || res.Message.Content != "Xong." {
		t.Fatalf("Ask: %v, %+v", err, res.Message)
	}
	if len(held) != 2 || held[0] != 1 || held[1] != 1 {
		t.Fatalf("file turns held per call %v, want one through both rounds", held)
	}
	if n := len(s.fileTurns); n != 0 {
		t.Fatalf("%d file turns held after the run", n)
	}
	// A file the reader cannot open ends the turn before any call; the slot comes back.
	bad := uploadAskFile(t, s, ua.ID, w.ID, "hong.pdf", pdfBody("broken"))
	if _, err := s.Ask(context.Background(), ua.ID, w.ID, AskInput{Question: "Đọc giúp", Locale: "vi", Dock: true, AttachmentIDs: []string{bad}}); !errors.Is(err, ai.ErrAttachmentUnreadable) {
		t.Fatalf("damaged file: %v, want ai_attachment_unreadable", err)
	}
	if n := len(s.fileTurns); n != 0 {
		t.Fatalf("%d file turns held after a refused turn", n)
	}
}

// A turn reads the current question's files, then those of the questions in
// the history window, newest first, five at most: of a question that does not
// fit whole, the files attached later win.
func TestTurnAttachmentsPreferTheNewest(t *testing.T) {
	s, fake, _, ua, _, w := attachAgentFixture(t)
	ctx := context.Background()
	scriptRounds(fake, 0, "Đã đọc.", provider.CompletionResponse{InputTokens: 10})
	upload := func(names ...string) []string {
		ids := make([]string, len(names))
		for i, n := range names {
			ids[i] = uploadAskFile(t, s, ua.ID, w.ID, n, []byte("nội dung "+n))
		}
		return ids
	}
	first, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "một", Locale: "vi", Dock: true, AttachmentIDs: upload("a1.txt", "a2.txt", "a3.txt")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Ask(ctx, ua.ID, w.ID, AskInput{ConversationID: first.ConversationID, Question: "hai", Locale: "vi", Dock: true, AttachmentIDs: upload("b1.txt", "b2.txt")}); err != nil {
		t.Fatal(err)
	}
	rows, err := s.q.AiListMessages(ctx, first.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	current, err := s.askAttachments(ctx, ua.ID, db.GetWorkspaceWithOrgRow{ID: w.ID, OrganizationID: w.OrganizationID}, upload("c1.txt"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.turnAttachments(ctx, w.OrganizationID, historyWindow(rows), current)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range got {
		names = append(names, f.Name)
	}
	if want := []string{"c1.txt", "b1.txt", "b2.txt", "a2.txt", "a3.txt"}; !slices.Equal(names, want) {
		t.Fatalf("turn files %v, want %v", names, want)
	}
}

// A turn with no file never takes a file turn or the file read: with every
// slot held it still answers at once.
func TestAskAgentWithoutFilesSkipsTheFileCaps(t *testing.T) {
	s, fake, _, ua, _, w := attachAgentFixture(t)
	scriptRounds(fake, 0, "Xong.", provider.CompletionResponse{InputTokens: 10})
	holdSlots(t, s.fileTurns)
	holdSlots(t, s.fileReads)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	started := time.Now()
	res, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "Có gì mới?", Locale: "vi", Dock: true})
	if err != nil || res.Message.Content != "Xong." {
		t.Fatalf("file slots held, no file: %v, stored %+v; want the answer", err, res.Message)
	}
	if took := time.Since(started); took > 10*time.Second {
		t.Fatalf("a turn without files waited %s", took)
	}
}

// A turn's files stay within 20 MB in all, since every round resends them:
// the current question's come first, then the newest earlier file that fits,
// and an older one that would pass the cap is left out.
func TestAskAgentKeepsATurnsFilesWithin20MB(t *testing.T) {
	s, fake, _, ua, _, w := attachAgentFixture(t)
	ctx := context.Background()
	const big = 11 << 20
	older, newer := pdfOfSize(1, big), pdfOfSize(2, big)
	scriptRounds(fake, 0, "Đã đọc.", provider.CompletionResponse{InputTokens: 10})
	first, err := s.Ask(ctx, ua.ID, w.ID, AskInput{Question: "một", Locale: "vi", Dock: true, AttachmentIDs: []string{uploadAskFile(t, s, ua.ID, w.ID, "cu.pdf", older)}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Ask(ctx, ua.ID, w.ID, AskInput{ConversationID: first.ConversationID, Question: "hai", Locale: "vi", Dock: true, AttachmentIDs: []string{uploadAskFile(t, s, ua.ID, w.ID, "moi.pdf", newer)}}); err != nil {
		t.Fatal(err)
	}
	reqs := scriptRounds(fake, 0, "Xong.", provider.CompletionResponse{InputTokens: 10})
	note := uploadAskFile(t, s, ua.ID, w.ID, "ghi-chu.txt", []byte("Hạn chót thứ Sáu."))
	if _, err := s.Ask(ctx, ua.ID, w.ID, AskInput{ConversationID: first.ConversationID, Question: "ba", Locale: "vi", Dock: true, AttachmentIDs: []string{note}}); err != nil {
		t.Fatal(err)
	}
	q := (*reqs)[0].Messages[len((*reqs)[0].Messages)-1]
	if len(q.Parts) != 1 || !bytes.Equal(q.Parts[0].Data, newer) {
		t.Fatalf("the turn sent %d parts, want only the newer earlier PDF", len(q.Parts))
	}
	if !strings.Contains(q.Content, "ghi-chu.txt") || !strings.Contains(q.Content, "moi.pdf") || strings.Contains(q.Content, "cu.pdf") {
		t.Fatalf("the files section lists the wrong files:\n%s", q.Content)
	}
}

// endlessOpen is a store that serves a body with no end.
type endlessOpen struct{ files.Service }

func (endlessOpen) Open(context.Context, files.OpenInput) (files.Reader, error) {
	return files.Reader{Body: io.NopCloser(endless{})}, nil
}

type endless struct{}

func (endless) Read(p []byte) (int, error) { return len(p), nil }

// A body past the 20 MB an upload may have is the store's fault: an internal
// error, read no further than one byte past the cap.
func TestReadTurnFilesRefusesABodyOverTheCap(t *testing.T) {
	s := &AskUNIService{files: endlessOpen{}}
	_, err := s.readTurnFiles(context.Background(), files.Scope{}, []AskAttachment{{FileID: "f1"}})
	var ce CodedError
	if err == nil || errors.Is(err, ai.ErrAttachmentUnreadable) || errors.As(err, &ce) {
		t.Fatalf("an endless body: %v, want an uncoded internal error", err)
	}
}

// openPanics is a file store whose reads panic, as a bug deep in a reader might.
type openPanics struct{ files.Service }

func (openPanics) Open(context.Context, files.OpenInput) (files.Reader, error) {
	panic("store bug")
}

// A panic while a turn reads its files still gives its file turn back: the
// slot is the process's, and a lost one is lost until restart.
func TestTurnFilePlanGivesTheFileTurnBackOnAPanic(t *testing.T) {
	s, _, _, ua, _, w := attachAgentFixture(t)
	ctx := context.Background()
	ws := db.GetWorkspaceWithOrgRow{ID: w.ID, OrganizationID: w.OrganizationID}
	current, err := s.askAttachments(ctx, ua.ID, ws, []string{uploadAskFile(t, s, ua.ID, w.ID, "a.txt", []byte("nội dung"))})
	if err != nil {
		t.Fatal(err)
	}
	s.files = openPanics{s.files}
	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("the store's panic did not reach the caller")
			}
		}()
		_, _, _ = s.turnFilePlan(ctx, files.Scope{OrganizationID: w.OrganizationID, WorkspaceID: w.ID}, nil, current)
	}()
	if n := len(s.fileTurns); n != 0 {
		t.Fatalf("%d file turns held after a panic", n)
	}
}
