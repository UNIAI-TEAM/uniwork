package service

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// accessFixture: owner A and member B share workspace W of organization O;
// outsider C owns organization O2 with workspace W2. Each user has one live
// auth session.
type accessFixture struct {
	h          *fileHarness
	access     *FileAccessService
	ws         *WorkspaceService
	q          *db.Queries
	a, b, c    db.User
	org, org2  db.Organization
	w, w2      db.Workspace
	sa, sb, sc string
}

var accessSecret = []byte("0123456789abcdef0123456789abcdef-t4")

func newAccessFixture(t *testing.T, registry *files.Registry) *accessFixture {
	t.Helper()
	h := newFileHarness(t, localFileBackend(), registry)
	ctx := context.Background()
	q := db.New(h.pool)
	as := NewAuthService(h.pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(h.pool, q)
	ws := NewWorkspaceService(h.pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	f := &accessFixture{h: h, ws: ws, q: q}
	f.a = registerVerified(t, q, as, "files-a@example.com", "A")
	f.b = registerVerified(t, q, as, "files-b@example.com", "B")
	f.c = registerVerified(t, q, as, "files-c@example.com", "C")
	var err error
	if f.org, err = orgs.Create(ctx, f.a.ID, "Org", "org-files"); err != nil {
		t.Fatal(err)
	}
	v, err := ws.CreateInOrg(ctx, f.a.ID, f.org.ID, "Alpha", "alpha")
	if err != nil {
		t.Fatal(err)
	}
	f.w = v.Workspace
	if err := q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: f.org.ID, UserID: f.b.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if err := q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: f.w.ID, UserID: f.b.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if f.org2, err = orgs.Create(ctx, f.c.ID, "Org2", "org-files-2"); err != nil {
		t.Fatal(err)
	}
	v2, err := ws.CreateInOrg(ctx, f.c.ID, f.org2.ID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	f.w2 = v2.Workspace
	f.sa = f.session(t, f.a.ID, "sess-a", 30*24*time.Hour)
	f.sb = f.session(t, f.b.ID, "sess-b", 30*24*time.Hour)
	f.sc = f.session(t, f.c.ID, "sess-c", 30*24*time.Hour)
	if f.access, err = NewFileAccessService(FileAccessOptions{Files: h.svc, Workspaces: ws, Secret: accessSecret}); err != nil {
		t.Fatal(err)
	}
	return f
}

// session writes a live refresh token for a session id, expiring ttl after
// the service clock.
func (f *accessFixture) session(t *testing.T, userID, sid string, ttl time.Duration) string {
	t.Helper()
	if _, err := f.q.CreateRefreshToken(context.Background(), db.CreateRefreshTokenParams{
		ID: sid + "-rt", UserID: userID, TokenHash: sid + "-hash", ExpiresAt: fileTime(f.h.clock.Now().Add(ttl)), SessionID: sid,
	}); err != nil {
		t.Fatalf("refresh token: %v", err)
	}
	return sid
}

func (f *accessFixture) upload(t *testing.T, user string, purpose files.UploadPurpose, w db.Workspace, key string) files.Upload {
	t.Helper()
	up, err := f.h.svc.Upload(context.Background(), files.UploadInput{
		Actor: audit.User(user), Purpose: purpose, Scope: files.Scope{OrganizationID: w.OrganizationID, WorkspaceID: w.ID},
		IdempotencyKey: key, Filename: "bao cáo.png", Body: bytes.NewReader(t3PNG),
	})
	if err != nil {
		t.Fatalf("upload %s: %v", key, err)
	}
	return up
}

func (f *accessFixture) resolve(t *testing.T, user, sid string, w db.Workspace, ids ...files.FileID) []FileAccessItem {
	t.Helper()
	in := FileAccessRequest{UserID: user, SessionID: sid, WorkspaceID: w.ID}
	for _, id := range ids {
		in.FileIDs = append(in.FileIDs, string(id))
	}
	items, err := f.access.ResolveUploads(context.Background(), in)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	return items
}

func itemCode(t *testing.T, item FileAccessItem, code string) {
	t.Helper()
	var ce CodedError
	if !errors.As(item.Err, &ce) || ce.Code != code {
		t.Fatalf("item %s error = %v, want %s", item.FileID, item.Err, code)
	}
	if item.File != nil || item.URL != "" || !item.URLExpiresAt.IsZero() {
		t.Fatalf("refused item %s still carries a view or URL", item.FileID)
	}
}

func ticketOf(t *testing.T, item FileAccessItem) string {
	t.Helper()
	u, err := url.Parse(item.URL)
	if err != nil {
		t.Fatalf("proxy URL: %v", err)
	}
	return u.Query().Get("ticket")
}

func TestNewFileAccessServiceRefusesBadWiring(t *testing.T) {
	for _, opts := range []FileAccessOptions{
		{},
		{Files: &FileService{}},
		{Files: &FileService{}, Workspaces: &WorkspaceService{}, Secret: []byte("short")},
	} {
		if _, err := NewFileAccessService(opts); err == nil {
			t.Errorf("accepted %+v", opts)
		}
	}
}

func TestResolveUploadsIsTheCallersStagedFilesOnly(t *testing.T) {
	f := newAccessFixture(t, nil)
	mine := f.upload(t, f.a.ID, files.TaskAttachment, f.w, "acc-mine")
	theirs := f.upload(t, f.b.ID, files.TaskAttachment, f.w, "acc-theirs")
	claimed := f.upload(t, f.a.ID, files.TaskAttachment, f.w, "acc-claimed")
	if err := f.h.inTx(t, func(q *db.Queries) error {
		_, err := f.h.svc.ClaimInTx(context.Background(), q, files.ClaimInput{
			Actor: audit.User(f.a.ID), Purpose: files.TaskAttachment,
			Scope: files.Scope{OrganizationID: f.org.ID, WorkspaceID: f.w.ID}, FileIDs: []files.FileID{claimed.File.ID},
		})
		return err
	}); err != nil {
		t.Fatalf("claim: %v", err)
	}
	now := f.h.clock.Now()

	items := f.resolve(t, f.a.ID, f.sa, f.w, mine.File.ID, theirs.File.ID, claimed.File.ID, "01J8ZQMISSING0000000000000")
	if len(items) != 4 || items[0].FileID != string(mine.File.ID) {
		t.Fatalf("items = %+v", items)
	}
	got := items[0]
	if got.Err != nil || got.Access != FileAccessProxy || got.File == nil || got.File.Filename != "bao cáo.png" {
		t.Fatalf("own staged file = %+v", got)
	}
	if !strings.HasPrefix(got.URL, "/api/v1/files/"+string(mine.File.ID)+"/content?ticket=") {
		t.Fatalf("proxy URL = %q; it must be the API route, never a storage locator", got.URL)
	}
	if strings.Contains(got.URL, "v1/orgs/") || strings.Contains(got.URL, "tasks/attachments") {
		t.Fatalf("proxy URL leaks the object key: %q", got.URL)
	}
	if !got.URLExpiresAt.Equal(now.Add(files.MaxResolveURLTTL)) {
		t.Fatalf("ticket expires %v, want 12h", got.URLExpiresAt)
	}
	// Another member's staged upload and a claimed file (read through its
	// module) are not reachable through the upload session.
	itemCode(t, items[1], files.CodeNotFound)
	itemCode(t, items[2], files.CodeNotFound)
	itemCode(t, items[3], files.CodeNotFound)
}

func TestResolveUploadsGateAndValidation(t *testing.T) {
	f := newAccessFixture(t, nil)
	up := f.upload(t, f.a.ID, files.TaskAttachment, f.w, "gate")
	ctx := context.Background()

	// The outsider from another organization, guessing the workspace and id.
	if _, err := f.access.ResolveUploads(ctx, FileAccessRequest{UserID: f.c.ID, SessionID: f.sc, WorkspaceID: f.w.ID, FileIDs: []string{string(up.File.ID)}}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider = %v, want ErrForbidden", err)
	}
	// The uploader asking from the other organization's workspace id finds nothing.
	if _, err := f.access.ResolveUploads(ctx, FileAccessRequest{UserID: f.a.ID, SessionID: f.sa, WorkspaceID: f.w2.ID, FileIDs: []string{string(up.File.ID)}}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("foreign workspace = %v, want ErrForbidden", err)
	}
	var ve ValidationError
	for name, in := range map[string]FileAccessRequest{
		"no ids":          {UserID: f.a.ID, SessionID: f.sa, WorkspaceID: f.w.ID},
		"too many ids":    {UserID: f.a.ID, SessionID: f.sa, WorkspaceID: f.w.ID, FileIDs: make([]string, MaxFileAccessBatch+1)},
		"bad disposition": {UserID: f.a.ID, SessionID: f.sa, WorkspaceID: f.w.ID, FileIDs: []string{string(up.File.ID)}, Disposition: "download"},
	} {
		if _, err := f.access.ResolveUploads(ctx, in); !errors.As(err, &ve) {
			t.Errorf("%s: %v, want a validation error", name, err)
		}
	}
	// A token without a live session cannot mint a proxy ticket.
	if _, err := f.access.ResolveUploads(ctx, FileAccessRequest{UserID: f.a.ID, WorkspaceID: f.w.ID, FileIDs: []string{string(up.File.ID)}}); err == nil {
		t.Fatal("a proxy ticket was minted without an auth session")
	}
}

func TestProxyTicketIsCappedByClaimWindowAndAuthSession(t *testing.T) {
	f := newAccessFixture(t, nil)
	up := f.upload(t, f.a.ID, files.TaskAttachment, f.w, "cap")
	short := f.session(t, f.a.ID, "sess-a-short", 3*time.Hour)

	item := f.resolve(t, f.a.ID, short, f.w, up.File.ID)[0]
	if want := f.h.clock.Now().Add(3 * time.Hour); !item.URLExpiresAt.Equal(want) {
		t.Fatalf("ticket expires %v, want the auth session end %v", item.URLExpiresAt, want)
	}
	f.h.clock.Advance(20 * time.Hour)
	item = f.resolve(t, f.a.ID, f.sa, f.w, up.File.ID)[0]
	if !item.URLExpiresAt.Equal(up.ClaimExpiresAt) {
		t.Fatalf("ticket expires %v, want the claim window %v", item.URLExpiresAt, up.ClaimExpiresAt)
	}
}

func TestResolveUploadsPresignPurposeNamesStorage(t *testing.T) {
	f := newAccessFixture(t, presignRegistry(t))
	up := f.upload(t, f.a.ID, files.TaskDescriptionImage, f.w, "presign")
	item := f.resolve(t, f.a.ID, f.sa, f.w, up.File.ID)[0]
	if item.Err != nil || item.Access != FileAccessPresign || !strings.HasPrefix(item.URL, "http://local.test/read/") {
		t.Fatalf("presign item = %+v", item)
	}
}

func TestResolveUploadsReportsRevokedAndDeletingFiles(t *testing.T) {
	f := newAccessFixture(t, nil)
	ctx := context.Background()
	canceled := f.upload(t, f.a.ID, files.TaskAttachment, f.w, "rev-canceled")
	if err := f.h.svc.CancelUpload(ctx, files.CancelInput{Actor: audit.User(f.a.ID), Scope: files.Scope{OrganizationID: f.org.ID, WorkspaceID: f.w.ID}, FileID: canceled.File.ID}); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	deleting := f.upload(t, f.a.ID, files.TaskAttachment, f.w, "rev-deleting")
	f.h.contract().SimulateGC(t, deleting.File.ID)
	ok := f.upload(t, f.a.ID, files.TaskAttachment, f.w, "rev-ok")

	items := f.resolve(t, f.a.ID, f.sa, f.w, canceled.File.ID, deleting.File.ID, ok.File.ID)
	itemCode(t, items[0], files.CodeUploadCanceled)
	itemCode(t, items[1], files.CodeDeleting)
	if items[2].Err != nil || items[2].URL == "" {
		t.Fatalf("the healthy file stopped resolving: %+v", items[2])
	}
	f.h.clock.Advance(files.ClaimTTL)
	itemCode(t, f.resolve(t, f.a.ID, f.sa, f.w, ok.File.ID)[0], files.CodeClaimExpired)
}

func TestAuthorizeContentChecksEveryRequest(t *testing.T) {
	f := newAccessFixture(t, nil)
	ctx := context.Background()
	up := f.upload(t, f.a.ID, files.TaskAttachment, f.w, "content")
	other := f.upload(t, f.a.ID, files.TaskAttachment, f.w, "content-other")
	item := f.resolve(t, f.a.ID, f.sa, f.w, up.File.ID)[0]
	ticket := ticketOf(t, item)

	content, err := f.access.AuthorizeContent(ctx, string(up.File.ID), ticket)
	if err != nil {
		t.Fatalf("authorize: %v", err)
	}
	if content.SizeBytes != int64(len(t3PNG)) || content.ContentType != "image/png" {
		t.Fatalf("content = %+v", content)
	}
	if !strings.HasPrefix(content.ContentDisposition, `inline; filename="bao c`) || !strings.Contains(content.ContentDisposition, "filename*=UTF-8''bao%20c%C3%A1o.png") {
		t.Fatalf("disposition = %q, want the shared filename", content.ContentDisposition)
	}
	body, err := content.Open(ctx, 1, 3)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	b, _ := io.ReadAll(body)
	_ = body.Close()
	if string(b) != string(t3PNG[1:4]) {
		t.Fatalf("window = %q", b)
	}

	refused := map[string]func() (string, string){
		"ticket for another file": func() (string, string) { return string(other.File.ID), ticket },
		"tampered ticket":         func() (string, string) { return string(up.File.ID), ticket[:len(ticket)-2] + "AA" },
		"no ticket":               func() (string, string) { return string(up.File.ID), "" },
		"garbage":                 func() (string, string) { return string(up.File.ID), "not.a.ticket" },
	}
	for name, args := range refused {
		id, tk := args()
		if _, err := f.access.AuthorizeContent(ctx, id, tk); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s: %v, want ErrNotFound", name, err)
		}
	}
	// A ticket signed with another key is refused.
	otherKey, _ := NewFileAccessService(FileAccessOptions{Files: f.h.svc, Workspaces: f.ws, Secret: []byte("another-secret-another-secret-00")})
	forged := otherKey.signTicket(accessTicket{UserID: f.a.ID, SessionID: f.sa, WorkspaceID: f.w.ID, FileID: string(up.File.ID), Disposition: files.DispositionInline, ExpiresAt: f.h.clock.Now().Add(time.Hour)})
	if _, err := f.access.AuthorizeContent(ctx, string(up.File.ID), forged); !errors.Is(err, ErrNotFound) {
		t.Fatalf("forged ticket: %v", err)
	}
}

func TestAuthorizeContentFollowsSessionAndMembership(t *testing.T) {
	f := newAccessFixture(t, nil)
	ctx := context.Background()
	up := f.upload(t, f.b.ID, files.TaskAttachment, f.w, "live")
	ticket := ticketOf(t, f.resolve(t, f.b.ID, f.sb, f.w, up.File.ID)[0])
	if _, err := f.access.AuthorizeContent(ctx, string(up.File.ID), ticket); err != nil {
		t.Fatalf("authorize: %v", err)
	}

	// Removed from the workspace: the same ticket stops at the gate.
	if err := f.ws.RemoveMember(ctx, f.a.ID, f.w.ID, f.b.ID); err != nil {
		t.Fatalf("remove member: %v", err)
	}
	if _, err := f.access.AuthorizeContent(ctx, string(up.File.ID), ticket); !errors.Is(err, ErrForbidden) {
		t.Fatalf("after removal: %v, want ErrForbidden", err)
	}
	if err := f.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: f.w.ID, UserID: f.b.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}

	// Revoking the auth session (logout) closes the route at once.
	if _, err := f.q.RevokeSessionForUser(ctx, db.RevokeSessionForUserParams{UserID: f.b.ID, SessionID: f.sb}); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := f.access.AuthorizeContent(ctx, string(up.File.ID), ticket); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after session revoke: %v, want ErrNotFound", err)
	}
}

func TestAuthorizeContentExpiresAndFollowsTheFile(t *testing.T) {
	f := newAccessFixture(t, nil)
	ctx := context.Background()
	up := f.upload(t, f.a.ID, files.TaskAttachment, f.w, "expiry")
	item := f.resolve(t, f.a.ID, f.sa, f.w, up.File.ID)[0]
	ticket := ticketOf(t, item)

	// Deleting between two requests: the next one is refused with its code.
	gone := f.upload(t, f.a.ID, files.TaskAttachment, f.w, "expiry-gone")
	goneTicket := ticketOf(t, f.resolve(t, f.a.ID, f.sa, f.w, gone.File.ID)[0])
	f.h.contract().SimulateGC(t, gone.File.ID)
	if _, err := f.access.AuthorizeContent(ctx, string(gone.File.ID), goneTicket); !codedIs(err, files.CodeDeleting) {
		t.Fatalf("deleting file: %v", err)
	}

	// The ticket dies at its expiry, even with the session still live.
	f.h.clock.Advance(files.MaxResolveURLTTL)
	if _, err := f.access.AuthorizeContent(ctx, string(up.File.ID), ticket); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired ticket: %v, want ErrNotFound", err)
	}
}

func TestResolveUploadsQueriesDoNotGrowWithTheBatch(t *testing.T) {
	f := newAccessFixture(t, nil)
	var ids []files.FileID
	for i := 0; i < 8; i++ {
		ids = append(ids, f.upload(t, f.a.ID, files.TaskAttachment, f.w, "nq-"+string(rune('a'+i))).File.ID)
	}
	pool, counter := countingPool(t, f.h.pool)
	q := db.New(pool)
	f.h.svc.q = q
	f.access.q = q
	f.ws.q = q

	counter.n.Store(0)
	f.resolve(t, f.a.ID, f.sa, f.w, ids[:1]...)
	one := counter.n.Load()
	counter.n.Store(0)
	f.resolve(t, f.a.ID, f.sa, f.w, ids...)
	if many := counter.n.Load(); many != one {
		t.Fatalf("1 id took %d queries, 8 ids took %d; the batch must not grow per id", one, many)
	}
}
