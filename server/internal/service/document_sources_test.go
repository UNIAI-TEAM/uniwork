package service

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-1305 item C: every source query restates its domain's read gate. Each
// test below seeds one row the viewer may read and the rows the domain would
// refuse, then runs the query as the people around it: a workspace member
// without access, the owner of another organization (with that
// organization's own tenant pair, which is all the service ever passes), and
// the rows that must stay out (archived, deleted, staged, not ready).

type sourceScene struct {
	t     *testing.T
	ctx   context.Context
	f     *docPermFixture
	tn    docTenant
	other docTenant
}

func newSourceScene(t *testing.T) *sourceScene {
	t.Helper()
	f := newDocPermFixture(t)
	suffix := strings.ToLower(util.NewID()[20:])
	return &sourceScene{
		t: t, ctx: context.Background(), f: f,
		tn:    f.tenant(t, "src"+suffix),
		other: f.tenant(t, "srx"+suffix),
	}
}

func (s *sourceScene) exec(sql string, args ...any) {
	s.t.Helper()
	if _, err := s.f.pool.Exec(s.ctx, sql, args...); err != nil {
		s.t.Fatalf("seed: %v\n%s", err, sql)
	}
}

// readyFile seeds a ready FileService row of the tenant.
func (s *sourceScene) readyFile(orgID, name, mime string) string {
	s.t.Helper()
	id := util.NewID()
	s.exec(`INSERT INTO files (id, organization_id, storage, object_key, original_filename, status, content_type, size_bytes, ready_at)
		VALUES ($1, $2, 'local', $3, $4, 'ready', $5, 42, now())`, id, orgID, "src/"+strings.ToLower(id), name, mime)
	return id
}

func (s *sourceScene) room(orgID, wsID, kind, visibility, memberSet string, archived bool) string {
	s.t.Helper()
	id := util.NewID()
	var set any
	if memberSet != "" {
		set = memberSet
	}
	s.exec(`INSERT INTO chat_rooms (id, kind, workspace_id, organization_id, name, livekit_room_name, created_by, visibility, member_set_key, archived_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'seed', $7, $8, CASE WHEN $9 THEN now() END)`,
		id, kind, wsID, orgID, "Room "+id[20:], "lk-"+id, visibility, set, archived)
	return id
}

func (s *sourceScene) roomMember(orgID, wsID, roomID, userID, status string) {
	s.t.Helper()
	s.exec(`INSERT INTO chat_room_members (id, room_id, workspace_id, organization_id, user_id, status)
		VALUES ($1, $2, $3, $4, $5, $6)`, util.NewID(), roomID, wsID, orgID, userID, status)
}

func (s *sourceScene) fileMessage(orgID, wsID, roomID, senderID, name string, deleted bool) string {
	s.t.Helper()
	fileID := s.readyFile(orgID, name, "application/pdf")
	id := util.NewID()
	// A 'file' row breaks the kind check an older down migration re-adds;
	// the rows go with the test, like backfill's cohort fixtures.
	s.t.Cleanup(func() {
		_, _ = s.f.pool.Exec(context.Background(), `DELETE FROM chat_messages WHERE id = $1`, id)
	})
	s.exec(`INSERT INTO chat_messages (id, room_id, workspace_id, organization_id, sender_id, sender_kind, kind, body, metadata, file_id, deleted_at)
		VALUES ($1, $2, $3, $4, $5, 'human', 'file', '', jsonb_build_object('file_id', $6::text, 'filename', $7::text), $6, CASE WHEN $8 THEN now() END)`,
		id, roomID, wsID, orgID, senderID, fileID, name, deleted)
	return id
}

func (s *sourceScene) chatIDs(tn docTenant, wsID string, viewer db.User) map[string]bool {
	s.t.Helper()
	rows, err := s.f.q.ListDocumentSourceChatFiles(s.ctx, db.ListDocumentSourceChatFilesParams{
		TypeExts: []string{}, RowLimit: 100, ViewerID: viewer.ID, OrganizationID: tn.orgID, WorkspaceID: wsID,
	})
	if err != nil {
		s.t.Fatal(err)
	}
	out := map[string]bool{}
	for _, r := range rows {
		out[r.RowID] = true
	}
	return out
}

func TestDocumentSourceChatFollowsTheRoomGate(t *testing.T) {
	s := newSourceScene(t)
	tn := s.tn
	public := s.room(tn.orgID, tn.wsA, "channel", "public", "", false)
	publicMsg := s.fileMessage(tn.orgID, tn.wsA, public, tn.owner.ID, "public.pdf", false)
	deletedMsg := s.fileMessage(tn.orgID, tn.wsA, public, tn.owner.ID, "deleted.pdf", true)

	private := s.room(tn.orgID, tn.wsA, "channel", "private", "", false)
	s.roomMember(tn.orgID, tn.wsA, private, tn.owner.ID, "active")
	s.roomMember(tn.orgID, tn.wsA, private, tn.creator.ID, "invited")
	privateMsg := s.fileMessage(tn.orgID, tn.wsA, private, tn.owner.ID, "private.pdf", false)

	archived := s.room(tn.orgID, tn.wsA, "channel", "public", "", true)
	archivedMsg := s.fileMessage(tn.orgID, tn.wsA, archived, tn.owner.ID, "archived.pdf", false)

	dm := s.room(tn.orgID, tn.wsA, "dm", "private", tn.owner.ID+"|"+tn.aclOwner.ID, false)
	s.roomMember(tn.orgID, tn.wsA, dm, tn.owner.ID, "active")
	s.roomMember(tn.orgID, tn.wsA, dm, tn.aclOwner.ID, "active")
	// A stray member row outside the DM's member set is not a way in.
	s.roomMember(tn.orgID, tn.wsA, dm, tn.wsAdmin.ID, "active")
	dmMsg := s.fileMessage(tn.orgID, tn.wsA, dm, tn.owner.ID, "dm.pdf", false)

	group := s.room(tn.orgID, tn.wsA, "group", "private", "", false)
	s.roomMember(tn.orgID, tn.wsA, group, tn.member.ID, "active")
	s.roomMember(tn.orgID, tn.wsA, group, tn.creator.ID, "left")
	groupMsg := s.fileMessage(tn.orgID, tn.wsA, group, tn.member.ID, "group.pdf", false)

	cases := []struct {
		who  string
		as   db.User
		ws   string
		want map[string]bool
	}{
		{"owner", tn.owner, tn.wsA, map[string]bool{publicMsg: true, privateMsg: true, dmMsg: true}},
		{"invited channel member", tn.creator, tn.wsA, map[string]bool{publicMsg: true, privateMsg: true}},
		{"dm peer", tn.aclOwner, tn.wsA, map[string]bool{publicMsg: true, dmMsg: true}},
		{"member row outside the dm set", tn.wsAdmin, tn.wsA, map[string]bool{publicMsg: true}},
		{"group member", tn.member, tn.wsA, map[string]bool{publicMsg: true, groupMsg: true}},
		// The channel belongs to workspace A: from workspace B only the
		// organization-wide rooms the viewer is in remain.
		{"owner from workspace B", tn.owner, tn.wsB, map[string]bool{dmMsg: true}},
	}
	for _, c := range cases {
		got := s.chatIDs(tn, c.ws, c.as)
		for id := range got {
			if !c.want[id] {
				t.Errorf("%s sees chat file %s it may not read", c.who, id)
			}
		}
		for id := range c.want {
			if !got[id] {
				t.Errorf("%s does not see chat file %s", c.who, id)
			}
		}
		if got[deletedMsg] || got[archivedMsg] {
			t.Errorf("%s sees a deleted message or an archived room's file", c.who)
		}
	}
	if got := s.chatIDs(s.other, s.other.wsA, s.other.owner); len(got) != 0 {
		t.Fatalf("another organization's owner sees %d chat files", len(got))
	}
}

func (s *sourceScene) task(tn docTenant, wsID string) string {
	s.t.Helper()
	id := util.NewID()
	s.exec(`INSERT INTO tasks (id, workspace_id, organization_id, number, title, description, created_by, creator_type, creator_id, last_activity_at)
		VALUES ($1, $2, $3, (SELECT COALESCE(max(number), 0) + 1 FROM tasks WHERE workspace_id = $2), 'Task '||$1, '', $4, 'member', $4, now())`,
		id, wsID, tn.orgID, tn.owner.ID)
	return id
}

func (s *sourceScene) attachment(tn docTenant, wsID, taskID, commentID, name string) string {
	s.t.Helper()
	id := util.NewID()
	var task, comment any
	if taskID != "" {
		task = taskID
	}
	if commentID != "" {
		comment = commentID
	}
	var expires any
	if taskID == "" && commentID == "" {
		expires = time.Now().Add(time.Hour)
	}
	s.exec(`INSERT INTO attachments (id, organization_id, workspace_id, task_id, comment_id, uploader_type, uploader_id, object_key, filename, content_type, size_bytes, expires_at)
		VALUES ($1, $2, $3, $4, $5, 'member', $6, $7, $8, 'application/pdf', 10, $9)`,
		id, tn.orgID, wsID, task, comment, tn.owner.ID, "workspaces/"+wsID+"/attachments/"+id+"/"+name, name, expires)
	return id
}

func (s *sourceScene) taskIDs(tn docTenant, wsID string) map[string]db.ListDocumentSourceTaskFilesRow {
	s.t.Helper()
	rows, err := s.f.q.ListDocumentSourceTaskFiles(s.ctx, db.ListDocumentSourceTaskFilesParams{
		TypeExts: []string{}, RowLimit: 100, OrganizationID: tn.orgID, WorkspaceID: wsID,
	})
	if err != nil {
		s.t.Fatal(err)
	}
	out := map[string]db.ListDocumentSourceTaskFilesRow{}
	for _, r := range rows {
		out[r.RowID] = r
	}
	return out
}

func TestDocumentSourceTaskFollowsTheWorkspaceGate(t *testing.T) {
	s := newSourceScene(t)
	tn := s.tn
	taskA := s.task(tn, tn.wsA)
	onTask := s.attachment(tn, tn.wsA, taskA, "", "on-task.pdf")
	commentID := util.NewID()
	s.exec(`INSERT INTO task_comments (id, organization_id, workspace_id, task_id, author_id, body, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'c', now())`, commentID, tn.orgID, tn.wsA, taskA, tn.owner.ID)
	onComment := s.attachment(tn, tn.wsA, "", commentID, "on-comment.pdf")
	staged := s.attachment(tn, tn.wsA, "", "", "staged.pdf")
	goneComment := s.attachment(tn, tn.wsA, "", util.NewID(), "gone-comment.pdf")
	taskB := s.task(tn, tn.wsB)
	inB := s.attachment(tn, tn.wsB, taskB, "", "in-b.pdf")

	got := s.taskIDs(tn, tn.wsA)
	if _, ok := got[onTask]; !ok {
		t.Fatal("a task attachment is missing")
	}
	row, ok := got[onComment]
	if !ok {
		t.Fatal("a comment attachment is missing")
	}
	if row.ParentKind != "task_comment" || row.ParentRef != taskA {
		t.Fatalf("comment attachment parent = %s/%s, want task_comment on %s", row.ParentKind, row.ParentRef, taskA)
	}
	for _, id := range []string{staged, goneComment, inB} {
		if _, ok := got[id]; ok {
			t.Fatalf("workspace A lists %s (staged, orphaned or workspace B)", id)
		}
	}
	if got := s.taskIDs(s.other, s.other.wsA); len(got) != 0 {
		t.Fatalf("another organization sees %d task files", len(got))
	}
}

func TestDocumentSourceMeetingListsOnlyServableRecordings(t *testing.T) {
	s := newSourceScene(t)
	tn := s.tn
	meeting := func(wsID string) string {
		id := util.NewID()
		s.exec(`INSERT INTO meetings (id, workspace_id, organization_id, title, starts_at, ends_at, room_name, created_by, host_user_id)
			VALUES ($1, $2, $3, 'Meeting '||$1, now(), now() + interval '1 hour', $4, $5, $5)`, id, wsID, tn.orgID, "lk-m-"+id, tn.owner.ID)
		return id
	}
	recording := func(meetingID, status string, withFile bool) string {
		id := util.NewID()
		var fileID, fileURL any
		if withFile {
			fileID = s.readyFile(tn.orgID, "rec-"+id[20:]+".mp4", "video/mp4")
		} else {
			fileURL = "http://localhost:9000/uniwork/meetings/x/" + id + ".mp4"
		}
		s.exec(`INSERT INTO meeting_recordings (id, meeting_id, organization_id, egress_id, status, file_url, file_id, started_by, ended_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`, id, meetingID, tn.orgID, "egress-"+id, status, fileURL, fileID, tn.owner.ID)
		return id
	}
	mA := meeting(tn.wsA)
	done := recording(mA, RecordingComplete, true)
	running := recording(mA, "ACTIVE", true)
	legacy := recording(mA, RecordingComplete, false)
	inB := recording(meeting(tn.wsB), RecordingComplete, true)

	rows, err := s.f.q.ListDocumentSourceMeetingFiles(s.ctx, db.ListDocumentSourceMeetingFilesParams{
		TypeExts: []string{}, RowLimit: 100, OrganizationID: tn.orgID, WorkspaceID: tn.wsA,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].RowID != done {
		t.Fatalf("workspace A meeting files = %+v, want only %s (not %s, %s, %s)", rows, done, running, legacy, inB)
	}
	other, err := s.f.q.ListDocumentSourceMeetingFiles(s.ctx, db.ListDocumentSourceMeetingFilesParams{
		TypeExts: []string{}, RowLimit: 100, OrganizationID: s.other.orgID, WorkspaceID: s.other.wsA,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(other) != 0 {
		t.Fatalf("another organization sees %d meeting files", len(other))
	}
}

func TestDocumentSourceEmailIsTheMailboxOwnersAlone(t *testing.T) {
	s := newSourceScene(t)
	tn := s.tn
	mailbox := func(owner db.User, disconnected bool) (string, string) {
		acc, err := s.f.q.CreateEmailHubAccount(s.ctx, db.CreateEmailHubAccountParams{
			ID: util.NewID(), UserID: owner.ID, OrganizationID: tn.orgID, EmailAddress: strings.ToLower(util.NewID()) + "@example.com",
			Provider: "gmail", ImapHost: "imap.example.com", ImapPort: 993, ImapSecurity: "tls",
			SmtpHost: "smtp.example.com", SmtpPort: 465, SmtpSecurity: "starttls", AuthKind: "password", PasswordEnc: "x",
		})
		if err != nil {
			t.Fatal(err)
		}
		if disconnected {
			s.exec(`UPDATE email_hub_accounts SET disconnected_at = now() WHERE id = $1`, acc.ID)
		}
		th, err := s.f.q.UpsertEmailHubThread(s.ctx, db.UpsertEmailHubThreadParams{
			ID: util.NewID(), AccountID: acc.ID, OrganizationID: tn.orgID, Folder: "INBOX", ImapUid: 1,
			Subject: "Mail", FromAddr: "sender@example.com", ToAddrs: []string{acc.EmailAddress},
			SentAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}, HasAttachments: true,
			ImapLabels: []string{}, ConversationKey: "conv-" + acc.ID,
		})
		if err != nil {
			t.Fatal(err)
		}
		return acc.ID, th.ID
	}
	attach := func(accountID, threadID, part string) string {
		att, err := s.f.q.CreateEmailHubAttachment(s.ctx, db.CreateEmailHubAttachmentParams{
			ID: util.NewID(), ThreadID: threadID, AccountID: accountID, OrganizationID: tn.orgID,
			Filename: "mail.pdf", MimeType: "application/pdf", SizeBytes: 4, PartID: part,
		})
		if err != nil {
			t.Fatal(err)
		}
		return att.ID
	}
	acc, th := mailbox(tn.member, false)
	mine := attach(acc, th, "2")
	sent := attach(acc, th, "sent:0")
	offAcc, offTh := mailbox(tn.member, true)
	off := attach(offAcc, offTh, "2")

	list := func(orgID string, viewer db.User) map[string]bool {
		rows, err := s.f.q.ListDocumentSourceEmailFiles(s.ctx, db.ListDocumentSourceEmailFilesParams{
			TypeExts: []string{}, RowLimit: 100, ViewerID: viewer.ID, OrganizationID: orgID,
		})
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]bool{}
		for _, r := range rows {
			out[r.RowID] = true
		}
		return out
	}
	got := list(tn.orgID, tn.member)
	if !got[mine] || got[sent] || got[off] || len(got) != 1 {
		t.Fatalf("mailbox owner sees %v, want only %s", got, mine)
	}
	if got := list(tn.orgID, tn.owner); len(got) != 0 {
		t.Fatalf("the organization owner sees %d files of a member's mailbox", len(got))
	}
	if got := list(s.other.orgID, s.other.owner); len(got) != 0 {
		t.Fatalf("another organization sees %d email files", len(got))
	}
}

// sourceService wires the composition with Tasks (legacy storage) and Chat on
// the documents fake FileService; Meetings and Email Hub stay unwired, which
// also proves an unwired source is left out instead of failing the list.
func sourceService(t *testing.T, env *docStorageEnv) (*DocumentSourceService, *memStorage) {
	t.Helper()
	store := newMemStorage()
	tasks := NewTaskService(env.f.pool, env.f.q, env.svc.ws, store)
	chat := NewChatService(env.f.pool, env.f.q, env.svc.ws, NopPublisher{})
	chat.SetFiles(env.fs)
	return NewDocumentSourceService(DocumentSourceDeps{Documents: env.svc, Tasks: tasks, Chat: chat}), store
}

func TestDocumentSourceListPagesAcrossSources(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	s := &sourceScene{t: t, ctx: context.Background(), f: env.f, tn: env.tn}
	svc, _ := sourceService(t, env)
	tn := env.tn
	taskA := s.task(tn, tn.wsA)
	public := s.room(tn.orgID, tn.wsA, "channel", "public", "", false)
	want := map[string]bool{}
	for i := 0; i < 3; i++ {
		want["task:"+s.attachment(tn, tn.wsA, taskA, "", "file.pdf")] = true
		want["chat:"+s.fileMessage(tn.orgID, tn.wsA, public, tn.owner.ID, "file.pdf", false)] = true
	}
	seen := map[string]bool{}
	cursor := ""
	var last *DocumentSourceItem
	for pages := 0; pages < 10; pages++ {
		page, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Cursor: cursor, Limit: 4})
		if err != nil {
			t.Fatal(err)
		}
		for i := range page.Items {
			it := page.Items[i]
			if seen[it.ID] {
				t.Fatalf("%s listed twice", it.ID)
			}
			if last != nil && !documentSourceBefore(*last, it) {
				t.Fatalf("%s listed after %s out of order", it.ID, last.ID)
			}
			seen[it.ID] = true
			last = &it
		}
		if page.NextCursor == "" {
			break
		}
		cursor = page.NextCursor
	}
	if len(seen) != len(want) {
		t.Fatalf("paged %d files, want %d", len(seen), len(want))
	}
	for id := range want {
		if !seen[id] {
			t.Fatalf("%s never listed", id)
		}
	}
	page, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Source: DocumentSourceTask, Type: "pdf"})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 3 {
		t.Fatalf("source=task type=pdf = %d files, want 3", len(page.Items))
	}
	if _, err := svc.List(s.ctx, human(tn.outsider), tn.wsA, DocumentSourceFilter{}); err == nil {
		t.Fatal("an organization member outside the workspace listed its sources")
	}
	if _, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Source: "drive"}); err == nil {
		t.Fatal("an unknown source was accepted")
	}
}

// UNI-1814: a chat file names the message it sits in, so "go to source" can
// open the room at that message; the other sources name none.
func TestDocumentSourceListNamesTheChatMessage(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	s := &sourceScene{t: t, ctx: context.Background(), f: env.f, tn: env.tn}
	svc, _ := sourceService(t, env)
	tn := env.tn
	taskA := s.task(tn, tn.wsA)
	onTask := s.attachment(tn, tn.wsA, taskA, "", "on-task.pdf")
	commentID := util.NewID()
	s.exec(`INSERT INTO task_comments (id, organization_id, workspace_id, task_id, author_id, body, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'c', now())`, commentID, tn.orgID, tn.wsA, taskA, tn.owner.ID)
	onComment := s.attachment(tn, tn.wsA, "", commentID, "on-comment.pdf")
	public := s.room(tn.orgID, tn.wsA, "channel", "public", "", false)
	msgID := s.fileMessage(tn.orgID, tn.wsA, public, tn.owner.ID, "in-chat.pdf", false)

	page, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, it := range page.Items {
		got[it.ID] = it.Parent.MessageID
	}
	if got["chat:"+msgID] != msgID {
		t.Errorf("chat file parent message id = %q, want the message %s", got["chat:"+msgID], msgID)
	}
	for _, id := range []string{"task:" + onTask, "task:" + onComment} {
		v, ok := got[id]
		if !ok {
			t.Fatalf("%s is not listed", id)
		}
		if v != "" {
			t.Errorf("%s parent message id = %q, want empty", id, v)
		}
	}
}

// UNI-1814 review R1-1: the mapper on its own, every source kind, no DB. A
// chat file names the message it sits in (the row id behind
// "<source>:<row id>"), so "go to source" can open the room at it; a task,
// task-comment, meeting and email file name none.
func TestDocumentSourceItemNamesTheMessageOnlyForChat(t *testing.T) {
	const (
		messageID = "01J8X4MSG0N1P2Q3R4S5T6U7V8"
		parentID  = "01J8X4ROOM0N1P2Q3R4S5T6U7V8"
		taskID    = "01J8X4TSK0N1P2Q3R4S5T6U7V8"
	)
	row := func(src, rowID, parentKind, parentRef string) db.ListDocumentSourceChatFilesRow {
		return db.ListDocumentSourceChatFilesRow{
			SourceID: src + ":" + rowID, RowID: rowID,
			ParentKind: parentKind, ParentID: parentID, ParentTitle: "Kênh dự án", ParentRef: parentRef,
			Name: "file.pdf", MimeType: "application/pdf", SizeBytes: 42,
			OwnerID: "01J8X4USR0N1P2Q3R4S5T6U7V8", OwnerKind: "member", OwnerName: "An",
		}
	}
	cases := []struct {
		name string
		src  string
		row  db.ListDocumentSourceChatFilesRow
		want string
	}{
		{"chat channel file names its message", DocumentSourceChat, row(DocumentSourceChat, messageID, "channel", ""), messageID},
		{"chat dm file names its message", DocumentSourceChat, row(DocumentSourceChat, messageID, "dm", ""), messageID},
		{"task file names no message", DocumentSourceTask, row(DocumentSourceTask, "01J8X4ATT0N1P2Q3R4S5T6U7V8", "task", ""), ""},
		{"task comment file names no message", DocumentSourceTask, row(DocumentSourceTask, "01J8X4CMT0N1P2Q3R4S5T6U7V8", "task_comment", taskID), ""},
		{"meeting file names no message", DocumentSourceMeeting, row(DocumentSourceMeeting, "01J8X4REC0N1P2Q3R4S5T6U7V8", "meeting", ""), ""},
		{"email file names no message", DocumentSourceEmail, row(DocumentSourceEmail, "01J8X4EML0N1P2Q3R4S5T6U7V8", "email_thread", ""), ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			item := documentSourceItem(c.src, c.row)
			if item.Source != c.src || item.ID != c.src+":"+c.row.RowID {
				t.Fatalf("item = %s (%s), want source %s and id %s", item.ID, item.Source, c.src, c.src+":"+c.row.RowID)
			}
			if item.Parent.MessageID != c.want {
				t.Errorf("parent message id = %q, want %q", item.Parent.MessageID, c.want)
			}
		})
	}
}

func TestDocumentSourceSaveCopiesTheBytesIntoANewDocument(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	s := &sourceScene{t: t, ctx: context.Background(), f: env.f, tn: env.tn}
	svc, store := sourceService(t, env)
	tn := env.tn
	taskA := s.task(tn, tn.wsA)
	attID := s.attachment(tn, tn.wsA, taskA, "", "report.pdf")
	body := pdfBody("source-save")
	store.objects["workspaces/"+tn.wsA+"/attachments/"+attID+"/report.pdf"] = body

	f, err := svc.Open(s.ctx, human(tn.member), tn.wsA, "task:"+attID)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(f.Body)
	_ = f.Body.Close()
	if !bytes.Equal(got, body) {
		t.Fatal("download did not return the source bytes")
	}

	res, err := svc.Save(s.ctx, human(tn.member), tn.wsA, "task:"+attID, SaveSourceFileInput{IdempotencyKey: "save-1"})
	if err != nil {
		t.Fatal(err)
	}
	if res.Document.Kind != DocumentKindFile || res.Document.Title != "report.pdf" || res.Document.ParentID.Valid {
		t.Fatalf("saved document = %+v", res.Document)
	}
	if n := env.countAudit(t, "document.created", res.Document.ID); n != 1 {
		t.Fatalf("audit rows = %d, want 1", n)
	}
	if n := env.countOutbox(t, "document.created", res.Document.ID); n != 1 {
		t.Fatalf("outbox rows = %d, want 1", n)
	}
	var source string
	if err := env.f.pool.QueryRow(s.ctx, `SELECT changes::jsonb->'source_file_id'->>'to' FROM audit_events
		WHERE resource_id = $1 AND action = 'document.created'`, res.Document.ID).Scan(&source); err != nil {
		t.Fatal(err)
	}
	if source != "task:"+attID {
		t.Fatalf("audit provenance = %q", source)
	}
	if read := env.read(t, human(tn.member), res.Document.ID, 0, DocumentByteRange{}); !bytes.Equal(read, body) {
		t.Fatal("the new document does not hold a copy of the source bytes")
	}
	again, err := svc.Save(s.ctx, human(tn.member), tn.wsA, "task:"+attID, SaveSourceFileInput{IdempotencyKey: "save-1"})
	if err != nil {
		t.Fatal(err)
	}
	if again.Document.ID != res.Document.ID {
		t.Fatal("a replayed Idempotency-Key created a second document")
	}

	// Refusals read as not_found, the cross-tenant and the unknown alike.
	other := s.other
	if other.orgID == "" {
		other = env.f.tenant(t, "srcsave"+strings.ToLower(util.NewID()[20:]))
	}
	_, err = svc.Save(s.ctx, human(other.owner), other.wsA, "task:"+attID, SaveSourceFileInput{})
	wantNotFound(t, err)
	_, err = svc.Open(s.ctx, human(tn.member), tn.wsA, "chat:"+attID)
	wantNotFound(t, err)
	_, err = svc.Open(s.ctx, human(tn.bMember), tn.wsB, "task:"+attID)
	wantNotFound(t, err)
}

func TestDocumentSourceCursorAndFilters(t *testing.T) {
	at := time.Date(2026, 10, 12, 8, 0, 0, 123456000, time.UTC)
	raw := encodeDocumentSourceCursor(at, "chat:01J8X4MSG0N1P2Q3R4S5T6U7V8")
	gotAt, gotID, ok := decodeDocumentSourceCursor(raw)
	if !ok || !gotAt.Equal(at) || gotID != "chat:01J8X4MSG0N1P2Q3R4S5T6U7V8" {
		t.Fatalf("cursor round trip = %v %q %v", gotAt, gotID, ok)
	}
	for _, bad := range []string{"!!", "bm9waXBl", "eHw="} {
		if _, _, ok := decodeDocumentSourceCursor(bad); ok {
			t.Fatalf("cursor %q accepted", bad)
		}
	}
	if mode, exts, err := documentSourceTypeFilter("docx"); err != nil || mode != "ext" || len(exts) != 2 {
		t.Fatalf("docx filter = %s %v %v", mode, exts, err)
	}
	if mode, exts, err := documentSourceTypeFilter("other"); err != nil || mode != "other" || len(exts) == 0 {
		t.Fatalf("other filter = %s %v %v", mode, exts, err)
	}
	if _, _, err := documentSourceTypeFilter("exe"); err == nil {
		t.Fatal("an unknown type was accepted")
	}
	for name, want := range map[string]string{"A.DOCX": "docx", "noext": "", "trail.": "", "x.tar.gz": "gz", "x.d o": ""} {
		if got := documentSourceExtension(name); got != want {
			t.Fatalf("extension(%q) = %q, want %q", name, got, want)
		}
	}
	if got := escapeLikePattern(`50%_off\`); got != `50\%\_off\\` {
		t.Fatalf("escape = %q", got)
	}
	a := DocumentSourceItem{ID: "task:B", UpdatedAt: at}
	b := DocumentSourceItem{ID: "chat:Z", UpdatedAt: at}
	if !documentSourceBefore(a, b) {
		t.Fatal("equal times must order by id descending")
	}
}
