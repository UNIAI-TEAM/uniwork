package service

// FileService-path tests for task attachments (UNI-744). Every test wires
// filesfake into a service built on the real test database, so the row, the
// transaction and the file state machine are all real — only the object store
// is in memory. Release itself is a flag the collector reads, and the fake
// does not model the collector: what these tests pin is that the module
// records claims/releases inside the right transaction, which is observable
// through CancelUpload (claimed files refuse it) and Open (canceled sessions
// refuse it).

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// fsPNG sniffs as image/png — http.DetectContentType reads the magic bytes
// only, which is also all the fake's detector sees.
var fsPNG = append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 32)...)

// taskFixtureWithFiles is taskFixtureWithStorage with filesfake wired in. It
// keeps the pool because the holds-provider test needs raw SQL the query
// surface does not have (expiring a staging window by hand).
func taskFixtureWithFiles(t *testing.T) (*TaskService, *filesfake.Fake, *pgxpool.Pool, db.User, db.User, db.Workspace) {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	ctx := context.Background()
	ua := registerVerified(t, q, as, "a@example.com", "A")
	ub := registerVerified(t, q, as, "b@example.com", "B")
	org, _ := orgs.Create(ctx, ua.ID, "Org", "org-alpha")
	v, _ := ws.CreateInOrg(ctx, ua.ID, org.ID, "Alpha", "alpha")
	s := NewTaskService(pool, q, ws, newMemStorage())
	fake := filesfake.New(filesfake.Options{})
	s.SetFiles(fake)
	return s, fake, pool, ua, ub, v.Workspace
}

func newTask(t *testing.T, s *TaskService, ua db.User, w db.Workspace) db.Task {
	t.Helper()
	task, err := s.Create(context.Background(), Human(ua.ID), w.ID, CreateTaskInput{Title: "Tệp FS"})
	if err != nil {
		t.Fatal(err)
	}
	return task
}

func fileErrCode(t *testing.T, err error, want string) {
	t.Helper()
	var fe *files.Error
	if !errors.As(err, &fe) || fe.Code != want {
		t.Fatalf("err = %v, want files code %s", err, want)
	}
}

func TestFSUploadTaskAttachmentStoresFileIDAndStreams(t *testing.T) {
	s, fake, _, ua, _, w := taskFixtureWithFiles(t)
	ctx := context.Background()
	task := newTask(t, s, ua, w)

	body := []byte("nội dung đính kèm\n")
	att, err := s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, "", "note.txt", "text/plain", int64(len(body)), bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if !att.FileID.Valid || att.FileID.String == "" {
		t.Fatalf("file_id = %+v, want set", att.FileID)
	}
	if att.ObjectKey.Valid {
		t.Fatalf("object_key = %q, want NULL on the FS path", att.ObjectKey.String)
	}
	if att.Purpose.String != string(files.TaskAttachment) {
		t.Fatalf("purpose = %q, want task_attachment", att.Purpose.String)
	}

	meta, r, err := s.OpenAttachmentContent(ctx, Human(ua.ID), att.ID)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(r)
	_ = r.Close()
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("content = %q (%v)", got, err)
	}
	if meta.ID != att.ID {
		t.Fatalf("open meta = %+v", meta)
	}

	// A task-bound upload is claimed in the insert transaction: a cancel
	// attempt on it must be refused as already_claimed.
	err = fake.CancelUpload(ctx, files.CancelInput{
		Actor:  Human(ua.ID),
		Scope:  files.Scope{OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID},
		FileID: files.FileID(att.FileID.String),
	})
	fileErrCode(t, err, files.CodeAlreadyClaimed)
}

func TestFSStagedUploadIsClaimedByTaskCreate(t *testing.T) {
	s, fake, _, ua, _, w := taskFixtureWithFiles(t)
	ctx := context.Background()

	body := []byte("draft body\n")
	att, err := s.UploadWorkspaceAttachment(ctx, Human(ua.ID), w.ID, "", "draft.txt", "text/plain", int64(len(body)), bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if att.TaskID.Valid || !att.ExpiresAt.Valid {
		t.Fatalf("staged row = task %v expires %v", att.TaskID, att.ExpiresAt)
	}
	if !att.FileID.Valid {
		t.Fatal("staged row has no file_id")
	}
	scope := files.Scope{OrganizationID: w.OrganizationID, WorkspaceID: w.ID}
	fileID := files.FileID(att.FileID.String)

	// The staged file is not claimed yet, so a cancel still works.
	if err := fake.CancelUpload(ctx, files.CancelInput{Actor: Human(ua.ID), Scope: scope, FileID: fileID}); err != nil {
		t.Fatalf("canceling a staged file: %v", err)
	}

	// Re-stage a fresh one — the canceled session can no longer be claimed.
	att, err = s.UploadWorkspaceAttachment(ctx, Human(ua.ID), w.ID, "", "draft.txt", "text/plain", int64(len(body)), bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	fileID = files.FileID(att.FileID.String)

	task, err := s.CreateTaskSuite(ctx, Human(ua.ID), w.ID, CreateTaskInput{
		Title: "Mang tệp", AttachmentIDs: []string{att.ID},
	}, "fs-stage-claim")
	if err != nil {
		t.Fatal(err)
	}
	listed, err := s.ListTaskAttachments(ctx, Human(ua.ID), task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != att.ID || listed[0].TaskID.String != task.ID {
		t.Fatalf("bound = %+v", listed)
	}
	err = fake.CancelUpload(ctx, files.CancelInput{Actor: Human(ua.ID), Scope: scope, FileID: fileID})
	fileErrCode(t, err, files.CodeAlreadyClaimed)
}

func TestFSTaskCreateRollsBackWhenClaimRefuses(t *testing.T) {
	s, fake, _, ua, _, w := taskFixtureWithFiles(t)
	ctx := context.Background()

	body := []byte("draft\n")
	att, err := s.UploadWorkspaceAttachment(ctx, Human(ua.ID), w.ID, "", "draft.txt", "text/plain", int64(len(body)), bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	scope := files.Scope{OrganizationID: w.OrganizationID, WorkspaceID: w.ID}
	if err := fake.CancelUpload(ctx, files.CancelInput{Actor: Human(ua.ID), Scope: scope, FileID: files.FileID(att.FileID.String)}); err != nil {
		t.Fatal(err)
	}

	_, err = s.CreateTaskSuite(ctx, Human(ua.ID), w.ID, CreateTaskInput{
		Title: "Vẫn còn lỗi", AttachmentIDs: []string{att.ID},
	}, "fs-claim-refused")
	var coded CodedError
	if !errors.As(err, &coded) || coded.Status != http.StatusUnprocessableEntity {
		t.Fatalf("create = %v, want 422 attachment_not_available", err)
	}

	// The whole transaction rolled back: no task, and the row is still a
	// staged upload the uploader owns (not silently bound to a dead task).
	got, err := s.GetAttachment(ctx, Human(ua.ID), att.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.TaskID.Valid {
		t.Fatalf("attachment bound to a rolled-back task: %s", got.TaskID.String)
	}
}

func TestFSClaimWindowExpiryRefusesCreate(t *testing.T) {
	s, fake, _, ua, _, w := taskFixtureWithFiles(t)
	ctx := context.Background()

	body := []byte("old draft\n")
	att, err := s.UploadWorkspaceAttachment(ctx, Human(ua.ID), w.ID, "", "old.txt", "text/plain", int64(len(body)), bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	fake.Advance(files.ClaimTTL + time.Minute)

	_, err = s.CreateTaskSuite(ctx, Human(ua.ID), w.ID, CreateTaskInput{
		Title: "Quá hạn", AttachmentIDs: []string{att.ID},
	}, "fs-claim-expired")
	var coded CodedError
	if !errors.As(err, &coded) || coded.Status != http.StatusUnprocessableEntity {
		t.Fatalf("create = %v, want 422 attachment_not_available", err)
	}
}

func TestFSDeleteBoundAttachmentKeepsBytesForCollector(t *testing.T) {
	s, fake, _, ua, _, w := taskFixtureWithFiles(t)
	ctx := context.Background()
	task := newTask(t, s, ua, w)

	att, err := s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, "", "keep.txt", "text/plain", 5, strings.NewReader("keep\n"))
	if err != nil {
		t.Fatal(err)
	}
	fileID := files.FileID(att.FileID.String)
	if err := s.DeleteAttachment(ctx, Human(ua.ID), att.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetAttachment(ctx, Human(ua.ID), att.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after delete: %v", err)
	}
	// The unlink is a release, not a delete: bytes stay readable until the
	// collector re-checks every provider (filesfake.SimulateGC).
	r, err := fake.Open(ctx, files.OpenInput{
		Scope: files.Scope{OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID}, FileID: fileID,
	})
	if err != nil {
		t.Fatalf("released file must still open until collected: %v", err)
	}
	_ = r.Close()
}

func TestFSDeleteStagedAttachmentCancelsTheSession(t *testing.T) {
	s, fake, _, ua, _, w := taskFixtureWithFiles(t)
	ctx := context.Background()

	att, err := s.UploadWorkspaceAttachment(ctx, Human(ua.ID), w.ID, "", "scratch.txt", "text/plain", 8, strings.NewReader("scratch\n"))
	if err != nil {
		t.Fatal(err)
	}
	fileID := files.FileID(att.FileID.String)
	if err := s.DeleteAttachment(ctx, Human(ua.ID), att.ID); err != nil {
		t.Fatal(err)
	}
	// A staged row the uploader dropped never claimed its file; the service
	// cancels the session so nothing waits out the 24h window.
	_, err = fake.Open(ctx, files.OpenInput{
		Scope: files.Scope{OrganizationID: w.OrganizationID, WorkspaceID: w.ID}, FileID: fileID,
	})
	fileErrCode(t, err, files.CodeUploadCanceled)
}

func TestFSDeleteTaskReleasesItsAttachments(t *testing.T) {
	s, fake, _, ua, _, w := taskFixtureWithFiles(t)
	ctx := context.Background()
	task := newTask(t, s, ua, w)

	att, err := s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, "", "a.txt", "text/plain", 2, strings.NewReader("a\n"))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, ua.ID, task.ID); err != nil {
		t.Fatal(err)
	}
	listed, err := s.ListTaskAttachments(ctx, Human(ua.ID), task.ID)
	if err == nil {
		t.Fatalf("deleted task still lists attachments: %+v", listed)
	}
	// Released, not deleted: the fake never collects on its own, so the bytes
	// outliving the row is the expected intermediate state.
	r, err := fake.Open(ctx, files.OpenInput{
		Scope:  files.Scope{OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID},
		FileID: files.FileID(att.FileID.String),
	})
	if err != nil {
		t.Fatalf("file of a deleted task must survive until collection: %v", err)
	}
	_ = r.Close()
}

func TestFSPurposeValidationAndCommentPurpose(t *testing.T) {
	s, fake, _, ua, _, w := taskFixtureWithFiles(t)
	ctx := context.Background()
	task := newTask(t, s, ua, w)

	_, err := s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, "bogus_purpose", "n.txt", "text/plain", 2, strings.NewReader("x\n"))
	var coded CodedError
	if !errors.As(err, &coded) || coded.Status != http.StatusBadRequest {
		t.Fatalf("unknown purpose = %v, want 400", err)
	}

	att, err := s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, "task_comment_attachment", "c.txt", "text/plain", 2, strings.NewReader("c\n"))
	if err != nil {
		t.Fatal(err)
	}
	if att.Purpose.String != string(files.TaskCommentAttachment) {
		t.Fatalf("purpose = %q, want task_comment_attachment", att.Purpose.String)
	}
	err = fake.CancelUpload(ctx, files.CancelInput{
		Actor:  Human(ua.ID),
		Scope:  files.Scope{OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID},
		FileID: files.FileID(att.FileID.String),
	})
	fileErrCode(t, err, files.CodeAlreadyClaimed)
}

func TestFSUploadRejectsOversizeAndBadMIMEThroughRegistry(t *testing.T) {
	s, _, _, ua, _, w := taskFixtureWithFiles(t)
	ctx := context.Background()
	task := newTask(t, s, ua, w)

	// The FS path caps the stream at the purpose cap, whatever the client
	// declared: a declared-small body that is actually huge answers 413.
	huge := io.LimitReader(&infiniteZero{}, MaxAttachmentBytes+1)
	_, err := s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, "", "big.bin", "application/pdf", 4, huge)
	var coded CodedError
	if !errors.As(err, &coded) || coded.Status != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize = %v, want 413", err)
	}

	_, err = s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, "", "evil.exe", "application/x-msdownload", 4, strings.NewReader("MZ\x00\x00"))
	if !errors.As(err, &coded) || coded.Status != http.StatusBadRequest {
		t.Fatalf("bad mime = %v, want 400 attachment_mime_rejected", err)
	}
}

type infiniteZero struct{}

func (infiniteZero) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	return len(p), nil
}

func TestTaskAttachmentProviderHolds(t *testing.T) {
	s, _, pool, ua, _, w := taskFixtureWithFiles(t)
	ctx := context.Background()
	q := s.q

	task := newTask(t, s, ua, w)
	bound, err := s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, "", "b.txt", "text/plain", 2, strings.NewReader("b\n"))
	if err != nil {
		t.Fatal(err)
	}
	staged, err := s.UploadWorkspaceAttachment(ctx, Human(ua.ID), w.ID, "", "s.txt", "text/plain", 2, strings.NewReader("s\n"))
	if err != nil {
		t.Fatal(err)
	}
	// A row a live task description still references holds its file even when
	// nothing else binds it: close its staging window so the description is
	// the only hold left.
	embedded, err := s.UploadWorkspaceAttachment(ctx, Human(ua.ID), w.ID, "", "e.txt", "text/plain", 2, strings.NewReader("e\n"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := q.UpdateTask(ctx, db.UpdateTaskParams{
		ID: task.ID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Description: pgtype.Text{String: "xem /api/v1/attachments/" + embedded.ID + "/content", Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE attachments SET expires_at = now() - interval '1 hour' WHERE id = $1", embedded.ID); err != nil {
		t.Fatal(err)
	}

	provider := NewTaskAttachmentProvider()
	ids := []files.FileID{
		files.FileID(bound.FileID.String), files.FileID(staged.FileID.String),
		files.FileID(embedded.FileID.String), "01J8ZQ0K7V9W1Y2X3Z4A5B6C7Z",
	}
	held, err := provider.HeldBy(ctx, q, ids)
	if err != nil {
		t.Fatal(err)
	}
	for _, att := range []db.Attachment{bound, staged, embedded} {
		if _, ok := held[files.FileID(att.FileID.String)]; !ok {
			t.Fatalf("attachment %s (file %s) is not held", att.ID, att.FileID.String)
		}
	}
	if _, ok := held["01J8ZQ0K7V9W1Y2X3Z4A5B6C7Z"]; ok {
		t.Fatal("a file id with no row answered held")
	}
}

// AuthService avatar path (UNI-744): purpose user_avatar, scope {UserID} only,
// atomic swap in one transaction, presigned URL at emission.

func authFixtureWithFiles(t *testing.T) (*AuthService, *filesfake.Fake, *db.Queries, db.User) {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	fake := filesfake.New(filesfake.Options{})
	as.SetFiles(fake)
	u := registerVerified(t, q, as, "ava-fs@example.com", "Ava")
	return as, fake, q, u
}

func TestFSUploadAvatarClaimsAndPresigns(t *testing.T) {
	as, fake, q, u := authFixtureWithFiles(t)
	ctx := context.Background()

	got, err := as.UploadAvatar(ctx, u.ID, "me.png", bytes.NewReader(fsPNG))
	if err != nil {
		t.Fatal(err)
	}
	if !got.AvatarFileID.Valid || got.AvatarFileID.String == "" {
		t.Fatalf("avatar_file_id = %+v, want set", got.AvatarFileID)
	}
	if !strings.HasPrefix(got.AvatarUrl.String, "fake://presign/") {
		t.Fatalf("avatar_url = %q, want a presigned URL", got.AvatarUrl.String)
	}
	// The column is persisted, not just decorated on the return value.
	row, err := q.GetUserByID(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.AvatarFileID.String != got.AvatarFileID.String {
		t.Fatalf("stored avatar_file_id = %q, want %q", row.AvatarFileID.String, got.AvatarFileID.String)
	}
	err = fake.CancelUpload(ctx, files.CancelInput{
		Actor:  Human(u.ID),
		Scope:  files.Scope{UserID: u.ID},
		FileID: files.FileID(got.AvatarFileID.String),
	})
	fileErrCode(t, err, files.CodeAlreadyClaimed)
}

func TestFSUploadAvatarRejectsNonImageAndOversize(t *testing.T) {
	as, _, _, u := authFixtureWithFiles(t)
	ctx := context.Background()

	_, err := as.UploadAvatar(ctx, u.ID, "evil.png", bytes.NewReader([]byte("hello, not a picture")))
	var coded CodedError
	if !errors.As(err, &coded) || coded.Status != http.StatusUnsupportedMediaType {
		t.Fatalf("non-image = %v, want 415", err)
	}

	big := bytes.NewReader(append(fsPNG, make([]byte, 2<<20)...))
	_, err = as.UploadAvatar(ctx, u.ID, "big.png", big)
	if !errors.As(err, &coded) || coded.Status != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize = %v, want 413", err)
	}
}

func TestFSAvatarReplaceReleasesPreviousInOneSwap(t *testing.T) {
	as, fake, q, u := authFixtureWithFiles(t)
	ctx := context.Background()

	first, err := as.UploadAvatar(ctx, u.ID, "one.png", bytes.NewReader(fsPNG))
	if err != nil {
		t.Fatal(err)
	}
	second, err := as.UploadAvatar(ctx, u.ID, "two.png", bytes.NewReader(fsPNG))
	if err != nil {
		t.Fatal(err)
	}
	if second.AvatarFileID.String == first.AvatarFileID.String {
		t.Fatal("replace kept the old file id")
	}
	if !strings.HasPrefix(second.AvatarUrl.String, "fake://presign/") {
		t.Fatalf("avatar_url = %q, want presigned", second.AvatarUrl.String)
	}
	// The replaced file is released, not deleted: still resolvable until the
	// collector's provider sweep says otherwise.
	resolved, err := fake.ResolveMany(ctx, files.ResolveInput{
		Scope: files.Scope{UserID: u.ID}, Mode: files.ReadPresign,
		Disposition: files.DispositionInline, FileIDs: []files.FileID{files.FileID(first.AvatarFileID.String)},
	})
	if err != nil || len(resolved) != 1 || resolved[0].Err != nil {
		t.Fatalf("replaced avatar must still resolve until collected: %v %+v", err, resolved)
	}

	// Provider view: only the current file is held.
	held, err := NewUserAvatarProvider().HeldBy(ctx, q, []files.FileID{
		files.FileID(first.AvatarFileID.String), files.FileID(second.AvatarFileID.String),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := held[files.FileID(first.AvatarFileID.String)]; ok {
		t.Fatal("released avatar file is still held")
	}
	if _, ok := held[files.FileID(second.AvatarFileID.String)]; !ok {
		t.Fatal("current avatar file is not held")
	}
}

func TestFSAvatarURLResolvesOnMemberSurfaces(t *testing.T) {
	as, fake, q, u := authFixtureWithFiles(t)
	ctx := context.Background()

	if _, err := as.UploadAvatar(ctx, u.ID, "me.png", bytes.NewReader(fsPNG)); err != nil {
		t.Fatal(err)
	}

	// ActorService is the batch surface every human actor render goes
	// through: with files wired it must presign instead of leaving the file
	// id invisible.
	actors := NewActorService(q)
	actors.SetFiles(fake)
	infos, err := actors.Resolve(ctx, []ActorRef{{Kind: audit.KindHuman, ID: u.ID}})
	if err != nil {
		t.Fatal(err)
	}
	info := infos[ActorRef{Kind: audit.KindHuman, ID: u.ID}]
	if !strings.HasPrefix(info.AvatarURL, "fake://presign/") {
		t.Fatalf("actor avatar = %q, want presigned", info.AvatarURL)
	}
}

// releaseRecorder wraps the fake so a test can see the unlink reach
// FileService: the fake keeps a release internally but exposes no reader for
// it, and column/held assertions alone cannot tell a forgotten release apart
// from a run one.
type releaseRecorder struct {
	files.Service
	released []files.FileID
}

func (r *releaseRecorder) ReleaseInTx(ctx context.Context, q *db.Queries, ids []files.FileID) error {
	r.released = append(r.released, ids...)
	return r.Service.ReleaseInTx(ctx, q, ids)
}

// Account deletion anonymises the row and releases the file-backed avatar in
// the same transaction (checklist invariant 5): the column clears, the
// provider stops holding the file, and the unlink actually reaches
// FileService — not just the SQL half.
func TestFSDeleteAccountReleasesAvatar(t *testing.T) {
	as, fake, q, u := authFixtureWithFiles(t)
	rec := &releaseRecorder{Service: fake}
	as.SetFiles(rec)
	ctx := context.Background()

	got, err := as.UploadAvatar(ctx, u.ID, "me.png", bytes.NewReader(fsPNG))
	if err != nil {
		t.Fatal(err)
	}
	avatarFile := files.FileID(got.AvatarFileID.String)

	if err := as.DeleteAccount(ctx, u.ID, DeleteAccountInput{Password: "password123"}); err != nil {
		t.Fatal(err)
	}

	found := false
	for _, id := range rec.released {
		if id == avatarFile {
			found = true
		}
	}
	if !found {
		t.Fatalf("avatar file %q was never released: released=%v", avatarFile, rec.released)
	}

	row, err := q.GetUserByID(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.AvatarFileID.Valid && row.AvatarFileID.String != "" {
		t.Fatalf("avatar_file_id = %q, want cleared", row.AvatarFileID.String)
	}
	held, err := NewUserAvatarProvider().HeldBy(ctx, q, []files.FileID{avatarFile})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := held[avatarFile]; ok {
		t.Fatal("a deleted account still holds its avatar file")
	}
}
