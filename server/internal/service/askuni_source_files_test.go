package service

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// attachWorld is the agent world with the document sources wired: task files
// live in a memory store, chat and email rows are seeded by hand.
type attachWorld struct {
	x     *mcpToolWorld
	s     *AskUNIService
	tc    ai.ToolContext
	tasks *TaskService
}

func newAttachWorld(t *testing.T) *attachWorld {
	t.Helper()
	x, s, tc := newAgentWorld(t)
	return wireSources(t, x, s, tc)
}

// wireSources gives an agent world the document sources, over a memory store for task files.
func wireSources(t *testing.T, x *mcpToolWorld, s *AskUNIService, tc ai.ToolContext) *attachWorld {
	t.Helper()
	docs := x.docs(t)
	s.chat.SetFiles(x.files)
	tasks := NewTaskService(x.tools.ask.pool, x.tools.q, x.tools.ws, newMemStorage())
	s.SetDocumentSources(NewDocumentSourceService(DocumentSourceDeps{Documents: docs, Chat: s.chat, Tasks: tasks, EmailHub: NewEmailHubService(x.tools.q, x.tools.ws, nil)}))
	return &attachWorld{x: x, s: s, tc: tc, tasks: tasks}
}

func (w *attachWorld) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := w.x.tools.ask.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("seed: %v\n%s", err, sql)
	}
}

func (w *attachWorld) run(t *testing.T, tc ai.ToolContext, name, args string) []agentItem {
	t.Helper()
	return runAgentTool(t, w.s, tc, name, args)
}

// upload attaches real bytes to the world's task as ua; it returns the source file id.
func (w *attachWorld) upload(t *testing.T, name, mime string, body []byte) string {
	t.Helper()
	att, err := w.tasks.UploadTaskAttachment(context.Background(), Human(w.x.ua.ID), w.x.taskID, "", name, mime, int64(len(body)), bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	return "task:" + att.ID
}

// rawAttachment seeds a task attachment row whose bytes are not in any store.
func (w *attachWorld) rawAttachment(t *testing.T, orgID, wsID, taskID, uploaderID, name string, size int64) string {
	t.Helper()
	id := util.NewID()
	w.exec(t, `INSERT INTO attachments (id, organization_id, workspace_id, task_id, uploader_type, uploader_id, object_key, filename, content_type, size_bytes)
		VALUES ($1, $2, $3, $4, 'member', $5, $6, $7, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', $8)`,
		id, orgID, wsID, taskID, uploaderID, "workspaces/"+wsID+"/attachments/"+id+"/"+name, name, size)
	return "task:" + id
}

// chatFile seeds a room and a file message by senderID in it. A member of the
// room is listed when members is set; a room with members is private.
func (w *attachWorld) chatFile(t *testing.T, senderID, name string, members ...string) (roomID, sourceID string) {
	t.Helper()
	org, ws := w.x.w.OrganizationID, w.x.w.ID
	roomID = util.NewID()
	kind, visibility := "channel", "public"
	if len(members) > 0 {
		kind, visibility = "group", "private"
	}
	w.exec(t, `INSERT INTO chat_rooms (id, kind, workspace_id, organization_id, name, livekit_room_name, created_by, visibility)
		VALUES ($1, $2, $3, $4, $5, $6, 'seed', $7)`, roomID, kind, ws, org, "Room "+roomID[20:], "lk-"+roomID, visibility)
	for _, m := range members {
		w.exec(t, `INSERT INTO chat_room_members (id, room_id, workspace_id, organization_id, user_id, status) VALUES ($1, $2, $3, $4, $5, 'active')`, util.NewID(), roomID, ws, org, m)
	}
	fileID, msgID := util.NewID(), util.NewID()
	w.exec(t, `INSERT INTO files (id, organization_id, storage, object_key, original_filename, status, content_type, size_bytes, ready_at)
		VALUES ($1, $2, 'local', $3, $4, 'ready', 'application/pdf', 42, now())`, fileID, org, "src/"+strings.ToLower(fileID), name)
	t.Cleanup(func() {
		_, _ = w.x.tools.ask.pool.Exec(context.Background(), `DELETE FROM chat_messages WHERE id = $1`, msgID)
	})
	w.exec(t, `INSERT INTO chat_messages (id, room_id, workspace_id, organization_id, sender_id, sender_kind, kind, body, metadata, file_id)
		VALUES ($1, $2, $3, $4, $5, 'human', 'file', '', jsonb_build_object('file_id', $6::text, 'filename', $7::text), $6)`,
		msgID, roomID, ws, org, senderID, fileID, name)
	return roomID, "chat:" + msgID
}

func wordFile(t *testing.T, text string) []byte {
	t.Helper()
	return officeFile(t, map[string]string{"word/document.xml": `<w:document ` + textIndexW + `><w:body><w:p><w:r><w:t>` + text + `</w:t></w:r></w:p></w:body></w:document>`})
}

const docxMIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

func TestAskListsAttachmentsOfATask(t *testing.T) {
	w := newAttachWorld(t)
	w.upload(t, "bao-gia.docx", docxMIME, wordFile(t, "Báo giá"))
	items := w.run(t, w.tc, "list_attachments", `{"source":"","parent_id":"`+w.x.taskID+`","query":"","type":"","cursor":""}`)
	if len(items) != 1 || items[0].Title != "bao-gia.docx" || items[0].Kind != "document" || !items[0].Foreign ||
		!strings.HasSuffix(items[0].Href, "/tasks/"+w.x.taskID) || items[0].Key != items[0].Href+"#"+items[0].ID ||
		!strings.HasPrefix(items[0].Text, "ID: "+items[0].ID+"\nIn: task ") {
		t.Fatalf("list = %+v", items)
	}
	// A filter that matches nothing lists nothing.
	if items := w.run(t, w.tc, "list_attachments", `{"source":"","parent_id":"`+w.x.taskID+`","query":"","type":"pdf","cursor":""}`); len(items) != 0 {
		t.Fatalf("pdf filter lists %+v", items)
	}
}

func TestAskReadsATaskAttachment(t *testing.T) {
	w := newAttachWorld(t)
	docx := w.upload(t, "don-hang.docx", docxMIME, wordFile(t, "Đơn hàng tháng 10"))
	items := w.run(t, w.tc, "get_attachment", `{"attachment_id":"`+docx+`"}`)
	if len(items) != 1 || !strings.Contains(items[0].Body, "Đơn hàng tháng 10") || !items[0].Foreign || items[0].ID != docx ||
		!strings.Contains(items[0].Text, "File: don-hang.docx") {
		t.Fatalf("docx = %+v", items)
	}
	fake := &fakePDFText{text: "Trang một"}
	w.x.tools.SetPDFText(fake)
	pdf := w.upload(t, "bao-cao.pdf", "application/pdf", []byte(testPDFBytes))
	items = w.run(t, w.tc, "get_attachment", `{"attachment_id":"`+pdf+`"}`)
	if len(items) != 1 || !strings.Contains(items[0].Body, "[page 1]") || !items[0].Foreign {
		t.Fatalf("pdf = %+v", items)
	}
	if len(fake.calls) != 1 || fake.calls[0].DocumentID != pdf || fake.calls[0].ActorID != w.x.ua.ID {
		t.Fatalf("engine calls = %+v, want one for %s", fake.calls, pdf)
	}
	if len(w.s.fileReads) != 0 {
		t.Error("the file read slot was not given back")
	}
}

func TestAskAttachmentRefusals(t *testing.T) {
	w := newAttachWorld(t)
	ctx := context.Background()
	member := w.x.member(t)
	own := w.upload(t, "cua-toi.docx", docxMIME, wordFile(t, "x"))
	get := func(id string) []agentItem {
		return w.run(t, w.tc, "get_attachment", `{"attachment_id":"`+id+`"}`)
	}
	if items := get(own); len(items) != 1 || items[0].Title != "cua-toi.docx" {
		t.Fatalf("control: own file = %+v", items)
	}

	// A private room the asker is not in, and a mailbox that is not the asker's.
	_, inPrivate := w.chatFile(t, member.UserID, "mat.pdf", member.UserID)
	acc, err := w.x.tools.q.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: member.UserID, OrganizationID: w.x.w.OrganizationID, EmailAddress: strings.ToLower(util.NewID()) + "@example.com",
		Provider: "gmail", ImapHost: "imap.example.com", ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: "smtp.example.com", SmtpPort: 465, SmtpSecurity: "starttls", AuthKind: "password", PasswordEnc: "x",
	})
	if err != nil {
		t.Fatal(err)
	}
	th, err := w.x.tools.q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: w.x.w.OrganizationID, Folder: "INBOX", ImapUid: 1,
		Subject: "Thư", FromAddr: "a@example.com", ToAddrs: []string{acc.EmailAddress},
		SentAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}, HasAttachments: true, ImapLabels: []string{}, ConversationKey: "conv-" + acc.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	att, err := w.x.tools.q.CreateEmailHubAttachment(ctx, db.CreateEmailHubAttachmentParams{
		ID: util.NewID(), ThreadID: th.ID, AccountID: acc.ID, OrganizationID: w.x.w.OrganizationID,
		Filename: "thu.pdf", MimeType: "application/pdf", SizeBytes: 4, PartID: "2",
	})
	if err != nil {
		t.Fatal(err)
	}

	// The same workspace's other organization member, another workspace and another organization.
	v2, err := w.x.tools.ws.CreateInOrg(ctx, w.x.ua.ID, w.x.w.OrganizationID, "Beta", "beta-att")
	if err != nil {
		t.Fatal(err)
	}
	task2 := w.x.task(t, w.x.ua.ID, v2.Workspace.ID, "Việc workspace hai")
	org2, ws2 := w.x.org(t, w.x.ub.ID, "Org B", "org-b-att")
	taskB := w.x.task(t, w.x.ub.ID, ws2.ID, "Việc tổ chức B")
	cases := map[string]string{
		"a private room":        inPrivate,
		"another person's mail": "email:" + att.ID,
		"workspace two":         w.rawAttachment(t, w.x.w.OrganizationID, v2.Workspace.ID, task2.ID, w.x.ua.ID, "hai.docx", 10),
		"organization B":        w.rawAttachment(t, org2.ID, ws2.ID, taskB.ID, w.x.ub.ID, "b.docx", 10),
		"nobody's":              "task:" + util.NewID(),
		"a library document id": w.x.taskID,
		"no prefix":             util.NewID(),
	}
	for name, id := range cases {
		if items := get(id); !isError(items, "not_found") {
			t.Errorf("get_attachment of %s = %+v; want error: not_found", name, items)
		}
	}
	// A source file is no document: get_document does not open it.
	if items := w.run(t, w.tc, "get_document", `{"document_id":"`+own+`"}`); !isError(items, "not_found") {
		t.Errorf("get_document of a source id = %+v", items)
	}
	// The mail is not listed to the asker either.
	for _, it := range w.run(t, w.tc, "list_attachments", `{"source":"email","parent_id":"","query":"","type":"","cursor":""}`) {
		t.Errorf("list_attachments shows another person's mail: %+v", it)
	}

	w.x.flags.byOrg = map[string]bool{w.x.w.OrganizationID: false}
	if items := get(own); !isError(items, "documents_unavailable") {
		t.Errorf("documents off, get = %+v", items)
	}
	if items := w.run(t, w.tc, "list_attachments", `{"source":"","parent_id":"","query":"","type":"","cursor":""}`); !isError(items, "documents_unavailable") {
		t.Errorf("documents off, list = %+v", items)
	}
}

func TestAskAttachmentHonoursAIOptOut(t *testing.T) {
	w := newAttachWorld(t)
	member := w.x.member(t)
	_, declined := w.chatFile(t, member.UserID, "tu-choi.pdf")
	_, shared := w.chatFile(t, w.x.ua.ID, "dong-y.pdf")
	list := func() []agentItem {
		return w.run(t, w.tc, "list_attachments", `{"source":"chat","parent_id":"","query":"","type":"","cursor":""}`)
	}
	get := func(id string) string {
		items := w.run(t, w.tc, "get_attachment", `{"attachment_id":"`+id+`"}`)
		if len(items) != 1 {
			t.Fatalf("get_attachment(%s) = %+v", id, items)
		}
		return items[0].Text
	}
	// Control: before the sender opts out both are listed, and the bytes are
	// tried (a seeded file has none, so the answer is "try again later").
	if len(list()) != 2 || !strings.Contains(get(declined), mcpFileBusyNote) {
		t.Fatalf("control: list %+v", list())
	}
	w.exec(t, `UPDATE users SET ai_consent_version = 'v1', ai_consent_at = now(), ai_opt_out_at = now() WHERE id = $1`, member.UserID)
	if items := list(); len(items) != 1 || items[0].ID != shared {
		t.Fatalf("list after opt-out = %+v; want only %s", items, shared)
	}
	if text := get(declined); !strings.Contains(text, "Note: "+askAttachmentOptOutNote) || strings.Contains(text, mcpFileBusyNote) {
		t.Fatalf("opted-out file = %q; want the opt-out note and no read", text)
	}
}

func TestAskAttachmentTooLargeIsNotOpened(t *testing.T) {
	w := newAttachWorld(t)
	org, ws := w.x.w.OrganizationID, w.x.w.ID
	big := w.rawAttachment(t, org, ws, w.x.taskID, w.x.ua.ID, "lon.docx", 21<<20)
	gone := w.rawAttachment(t, org, ws, w.x.taskID, w.x.ua.ID, "mat-bytes.docx", 10)
	note := func(id string) string {
		items := w.run(t, w.tc, "get_attachment", `{"attachment_id":"`+id+`"}`)
		if len(items) != 1 || items[0].Body != "" {
			t.Fatalf("get_attachment(%s) = %+v", id, items)
		}
		if len(w.s.fileReads) != 0 {
			t.Fatal("the file read slot was not given back")
		}
		return items[0].Text
	}
	if text := note(big); !strings.Contains(text, "Note: "+mcpOfficeTooLargeNote) {
		t.Errorf("21 MiB file = %q", text)
	}
	if text := note(gone); !strings.Contains(text, "Note: "+mcpFileBusyNote) {
		t.Errorf("file whose bytes are gone = %q", text)
	}
}

func TestAskAttachmentToolsWriteNothing(t *testing.T) {
	w := newAttachWorld(t)
	id := w.upload(t, "ghi.docx", docxMIME, wordFile(t, "Nội dung"))
	count := func() (n [2]int) {
		for i, table := range []string{"audit_events", "outbox_events"} {
			if err := w.x.tools.ask.pool.QueryRow(context.Background(), `SELECT count(*) FROM `+table).Scan(&n[i]); err != nil {
				t.Fatal(err)
			}
		}
		return n
	}
	before := count()
	w.run(t, w.tc, "list_attachments", `{"source":"","parent_id":"","query":"","type":"","cursor":""}`)
	if items := w.run(t, w.tc, "get_attachment", `{"attachment_id":"`+id+`"}`); len(items) != 1 || !strings.Contains(items[0].Body, "Nội dung") {
		t.Fatalf("get = %+v", items)
	}
	if after := count(); after != before {
		t.Fatalf("audit and outbox rows %v -> %v", before, after)
	}
}

func TestAskAttachmentToolsNeedWiring(t *testing.T) {
	_, s, tc := newAgentWorld(t)
	for _, name := range []string{"list_attachments", "get_attachment"} {
		for _, tool := range s.agentTools() {
			if tool.Name != name {
				continue
			}
			items, err := tool.run(context.Background(), tc, []byte(`{"attachment_id":"","source":"","parent_id":"","query":"","type":"","cursor":""}`))
			if err != errAskSourcesNotWired || items != nil {
				t.Errorf("%s unwired = %+v, %v; want errAskSourcesNotWired", name, items, err)
			}
		}
	}
}
