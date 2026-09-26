package backfill

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func insertRoom(t *testing.T, pool *pgxpool.Pool, id, org, ws string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO chat_rooms (id, kind, workspace_id, organization_id, livekit_room_name, created_by)
		 VALUES ($1,'group',$2,$3,$4,'user-1')`, id, nilIfEmpty(ws), nilIfEmpty(org), "lk-"+id); err != nil {
		t.Fatalf("seed room %s: %v", id, err)
	}
}

func insertChatMessage(t *testing.T, pool *pgxpool.Pool, id, room, ws, kind, metadata string, deleted bool) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO chat_messages (id, room_id, workspace_id, sender_id, sender_kind, kind, metadata, body)
		 VALUES ($1,$2,$3,'user-1','human',$4,$5::jsonb,'')`, id, room, ws, kind, metadata); err != nil {
		t.Fatalf("seed message %s: %v", id, err)
	}
	if deleted {
		if _, err := pool.Exec(context.Background(), `UPDATE chat_messages SET deleted_at = now() WHERE id = $1`, id); err != nil {
			t.Fatal(err)
		}
	}
}

func planCohort(t *testing.T, q *db.Queries, resolver *Resolver, cohort string) *Report {
	t.Helper()
	rep, err := New(q, resolver).Plan(context.Background(), Options{Cohorts: []string{cohort}, IncludeItems: true})
	if err != nil {
		t.Fatalf("plan %s: %v", cohort, err)
	}
	if len(rep.Cohorts) != 1 {
		t.Fatalf("cohorts = %d, want 1", len(rep.Cohorts))
	}
	return rep
}

// M8/M9: ours → verified on the identity scope; external → foreign; an
// avatar URL under another user's key segment → held.
func TestPlanAvatars(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	insertUser(t, pool, "user-1")
	insertUser(t, pool, "user-2")
	insertUser(t, pool, "user-3")
	insertUser(t, pool, "user-4")

	ctx := context.Background()
	upd := func(id, url string, fid *string) {
		if _, err := pool.Exec(ctx, `UPDATE users SET avatar_url = $2, avatar_file_id = $3 WHERE id = $1`, id, url, fid); err != nil {
			t.Fatalf("avatar %s: %v", id, err)
		}
	}
	upd("user-1", "/uploads/avatars/user-1/a.png", nil)               // local, verifies
	upd("user-2", "https://lh3.googleusercontent.com/abc/x.png", nil) // foreign
	upd("user-3", "/uploads/avatars/user-9/x.png", nil)               // wrong user segment
	fid := "fil_existing_av"
	upd("user-4", "/uploads/avatars/user-4/b.png", &fid) // already migrated

	rep := planCohort(t, q, baseResolver(), CohortAvatars)
	cr := rep.Cohorts[0]

	if got := itemByID(cr, "user-1"); got.Class != ClassVerified || got.ObjectKey != "avatars/user-1/a.png" || got.UserID != "user-1" {
		t.Fatalf("user-1 = %+v", got)
	}
	if got := itemByID(cr, "user-2"); got.Class != ClassForeign || got.Reason != "external_url" {
		t.Fatalf("user-2 = %+v", got)
	}
	if got := itemByID(cr, "user-3"); got.Class != ClassHeld || got.Reason != "avatar_user_mismatch" {
		t.Fatalf("user-3 = %+v", got)
	}
	if got := itemByID(cr, "user-4"); got.Class != ClassAlreadyApplied {
		t.Fatalf("user-4 = %+v", got)
	}
}

// M3/M4: file and voice messages verify against chat/files|voice/<org>/<room>/;
// the room supplies the tenant; a deleted message still verifies (the hold is
// live until the row is gone).
func TestPlanChatFilesAndVoice(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	insertUser(t, pool, "user-1")
	insertOrg(t, pool, "org-1", "ws-1", "user-1")
	insertRoom(t, pool, "room-1", "org-1", "ws-1")
	insertRoom(t, pool, "room-orphan", "", "")

	insertChatMessage(t, pool, "msg-file", "room-1", "ws-1", "file",
		`{"object_key":"chat/files/org-1/room-1/x.pdf","filename":"x.pdf","size_bytes":42}`, false)
	insertChatMessage(t, pool, "msg-voice", "room-1", "ws-1", "voice",
		`{"object_key":"chat/voice/org-1/room-1/v.webm","content_type":"audio/webm","size_bytes":7}`, false)
	insertChatMessage(t, pool, "msg-badorg", "room-1", "ws-1", "file",
		`{"object_key":"chat/files/org-2/room-1/y.pdf"}`, false)
	insertChatMessage(t, pool, "msg-nokey", "room-1", "ws-1", "file", `{}`, false)
	insertChatMessage(t, pool, "msg-deleted", "room-1", "ws-1", "file",
		`{"object_key":"chat/files/org-1/room-1/d.pdf"}`, true)
	insertChatMessage(t, pool, "msg-noroom", "room-orphan", "ws-1", "file",
		`{"object_key":"chat/files/org-1/room-orphan/z.pdf"}`, false)

	files := planCohort(t, q, nil, CohortChatFiles).Cohorts[0]
	if got := itemByID(files, "msg-file"); got.Class != ClassVerified || got.Purpose != "chat_attachment" {
		t.Fatalf("msg-file = %+v", got)
	}
	if got := itemByID(files, "msg-badorg"); got.Class != ClassHeld || got.Reason != "organization_mismatch" {
		t.Fatalf("msg-badorg = %+v", got)
	}
	if got := itemByID(files, "msg-nokey"); got.Class != ClassUnresolved {
		t.Fatalf("msg-nokey = %+v", got)
	}
	if got := itemByID(files, "msg-deleted"); got.Class != ClassVerified {
		t.Fatalf("msg-deleted = %+v, want verified (hold lives while the row does)", got)
	}
	if got := itemByID(files, "msg-noroom"); got.Class != ClassUnresolved || got.Reason != "room_tenant_missing" {
		t.Fatalf("msg-noroom = %+v", got)
	}

	voice := planCohort(t, q, nil, CohortChatVoice).Cohorts[0]
	if got := itemByID(voice, "msg-voice"); got.Class != ClassVerified || got.Purpose != "chat_voice" {
		t.Fatalf("msg-voice = %+v", got)
	}
	if voice.Verified != 1 {
		t.Fatalf("voice counts = %+v", voice)
	}
}

// M5/M6/M7: recording file_urls resolve through the configured MinIO
// authority; the voice_call_log item dedupes onto the recording's file.
func TestPlanRecordings(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	insertUser(t, pool, "user-1")
	insertOrg(t, pool, "org-1", "ws-1", "user-1")
	insertRoom(t, pool, "room-1", "org-1", "ws-1")

	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO meetings (id, workspace_id, title, starts_at, ends_at, room_name, created_by, host_user_id)
		VALUES ('meeting-1','ws-1','M', now(), now()+interval '1 hour','lk-m1','user-1','user-1')`); err != nil {
		t.Fatalf("meeting: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO meeting_recordings (id, meeting_id, status, file_url, started_by)
		VALUES ('rec-1','meeting-1','ENDED','http://localhost:9000/uniwork/recordings/m1.mp4','user-1')`); err != nil {
		t.Fatalf("rec-1: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO meeting_recordings (id, meeting_id, status, file_url, started_by)
		VALUES ('rec-orphan','meeting-gone','ENDED','http://localhost:9000/uniwork/recordings/x.mp4','user-1')`); err != nil {
		t.Fatalf("rec-orphan: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO chat_voice_recordings
		(id, organization_id, workspace_id, room_id, call_id, status, file_url, call_log_message_id, started_by)
		VALUES ('cvr-1','org-1','ws-1','room-1','call-1','ENDED','http://localhost:9000/uniwork/recordings/c1.mp4','msg-log','user-1')`); err != nil {
		t.Fatalf("cvr-1: %v", err)
	}
	// M7: the call-log message references the same recording object.
	insertChatMessage(t, pool, "msg-log", "room-1", "ws-1", "voice_call_log",
		`{"call_id":"call-1","outcome":"ended","recording_url":"http://localhost:9000/uniwork/recordings/c1.mp4"}`, false)
	insertChatMessage(t, pool, "msg-foreign", "room-1", "ws-1", "voice_call_log",
		`{"call_id":"call-9","outcome":"ended","recording_url":"https://evil.example.com/x.mp4"}`, false)

	res := baseResolver()
	res.rules = append(res.rules,
		prefixRule{backend: "minio", bucket: "uniwork", prefix: "http://localhost:9000/uniwork/"})

	mr := planCohort(t, q, res, CohortMeetingRecordings).Cohorts[0]
	if got := itemByID(mr, "rec-1"); got.Class != ClassVerified || got.Storage != "minio" || got.ObjectKey != "recordings/m1.mp4" {
		t.Fatalf("rec-1 = %+v", got)
	}
	if got := itemByID(mr, "rec-orphan"); got.Class != ClassUnresolved || got.Reason != "tenant_missing" {
		t.Fatalf("rec-orphan = %+v", got)
	}

	call := planCohort(t, q, res, CohortCallRecordings).Cohorts[0]
	recItem := itemByID(call, "cvr-1")
	logItem := itemByID(call, "msg-log")
	if recItem.Class != ClassVerified || logItem.Class != ClassVerified {
		t.Fatalf("rec=%+v log=%+v", recItem, logItem)
	}
	// Same locator + same scope → shared, deduped to one object, zero held.
	if !recItem.SharedLocator || !logItem.SharedLocator || call.DuplicateRefs != 1 || call.DistinctObjects != 1 || call.Held != 0 {
		t.Fatalf("dedup counts = %+v", call)
	}
	if got := itemByID(call, "msg-foreign"); got.Class != ClassForeign {
		t.Fatalf("msg-foreign = %+v", got)
	}
}

// M12: audit-exports/<org>/<id>.<fmt> verifies against the row tenant.
func TestPlanAuditExports(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	insertUser(t, pool, "user-1")
	insertOrg(t, pool, "org-1", "ws-1", "user-1")

	ctx := context.Background()
	ins := func(id, org, key string) {
		if _, err := pool.Exec(ctx, `INSERT INTO audit_exports
			(id, organization_id, requested_by, requested_by_kind, format, from_at, to_at, object_key)
			VALUES ($1,$2,'user-1','human','json',now(),now(),$3)`, id, org, key); err != nil {
			t.Fatalf("export %s: %v", id, err)
		}
	}
	ins("exp-ok", "org-1", "audit-exports/org-1/exp-ok.json")
	ins("exp-shape", "org-1", "random/key.bin")
	ins("exp-org", "org-1", "audit-exports/org-9/exp-org.json")

	rep := planCohort(t, q, nil, CohortAuditExports)
	cr := rep.Cohorts[0]
	if got := itemByID(cr, "exp-ok"); got.Class != ClassVerified || got.Purpose != "audit_export" || got.WorkspaceID != "" {
		t.Fatalf("exp-ok = %+v", got)
	}
	if got := itemByID(cr, "exp-shape"); got.Class != ClassHeld || got.Reason != "unrecognized_key_shape" {
		t.Fatalf("exp-shape = %+v", got)
	}
	if got := itemByID(cr, "exp-org"); got.Class != ClassHeld || got.Reason != "organization_mismatch" {
		t.Fatalf("exp-org = %+v", got)
	}
}

// M11: embedded attachment URLs produce reference items that resolve or
// dangle; they never create objects.
func TestPlanContentRefs(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	insertUser(t, pool, "user-1")
	insertOrg(t, pool, "org-1", "ws-1", "user-1")
	insertAttachment(t, pool, "att-ok", "org-1", "ws-1", "task-1", attKey("ws-1", "att-ok"), false, false)

	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO tasks (id, workspace_id, organization_id, number, title, description, created_by, creator_type, creator_id, last_activity_at)
		VALUES ('task-1','ws-1','org-1',1,'T','see ![d](/api/v1/attachments/att-ok/content) and /api/v1/attachments/att-gone/download','user-1','member','user-1',now())`); err != nil {
		t.Fatalf("task: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO task_comments (id, organization_id, workspace_id, task_id, author_id, body, updated_at)
		VALUES ('cmt-1','org-1','ws-1','task-1','user-1','open /api/v1/attachments/att-ok/content',now())`); err != nil {
		t.Fatalf("comment: %v", err)
	}

	rep := planCohort(t, q, nil, CohortContentRefs)
	cr := rep.Cohorts[0]
	var taskRef, cmtRef, dangling *Item
	for i := range cr.Items {
		it := &cr.Items[i]
		switch it.SourceID {
		case "task-1#att-ok":
			taskRef = it
		case "cmt-1#att-ok":
			cmtRef = it
		case "task-1#att-gone":
			dangling = it
		}
	}
	if taskRef == nil || taskRef.Class != ClassVerified || taskRef.ObjectKey == "" {
		t.Fatalf("taskRef = %+v", taskRef)
	}
	if cmtRef == nil || cmtRef.Class != ClassVerified {
		t.Fatalf("cmtRef = %+v", cmtRef)
	}
	if dangling == nil || dangling.Class != ClassUnresolved || dangling.Reason != "dangling_attachment_ref" {
		t.Fatalf("dangling = %+v", dangling)
	}
	if cr.DistinctObjects != 0 || cr.DuplicateRefs != 0 {
		t.Fatalf("content refs must never claim objects: %+v", cr)
	}
}
