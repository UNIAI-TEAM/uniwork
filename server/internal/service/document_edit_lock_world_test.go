package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// lockWorld is the edit lock tests' scene (UNI-1645): one tenant of the
// document fixtures (owner and aclOwner hold manage on a workspace page,
// member holds edit, outsider reads nothing unless shared) on the fake file
// backend, so file commits and restores run too.
type lockWorld struct {
	ctx context.Context
	env *docStorageEnv
	svc *DocumentService
	tn  docTenant
}

func newLockWorld(t *testing.T) *lockWorld {
	t.Helper()
	env := newFakeDocStorageEnv(t)
	return &lockWorld{ctx: context.Background(), env: env, svc: env.svc, tn: env.tn}
}

// page is a workspace-visible page of workspace A; aclOwner holds manage.
func (w *lockWorld) page(t *testing.T) db.Document {
	t.Helper()
	return w.env.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "workspace", aclOwner: w.tn.aclOwner.ID, createdBy: w.tn.aclOwner.ID})
}

func (w *lockWorld) acquire(t *testing.T, u db.User, docID, editor string) DocumentEditLockView {
	t.Helper()
	v, err := w.svc.AcquireDocumentEditLock(w.ctx, human(u), docID, AcquireDocumentEditLockInput{
		EditorID: editor, Client: DocumentEditClientWebPage, SessionID: "sid-" + u.ID,
	})
	if err != nil {
		t.Fatalf("acquire by %s: %v", u.DisplayName, err)
	}
	return v
}

var lockTestContent = json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"edited"}]}]}`)

func lockTestContentN(n int) json.RawMessage {
	return json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"edited ` + time.Now().Format("150405.000000") + string(rune('a'+n%26)) + `"}]}]}`)
}

// patch saves new content on the page's current revision with lockID.
func (w *lockWorld) patch(t *testing.T, actor Actor, docID, lockID string) error {
	t.Helper()
	d := w.env.doc(t, docID)
	_, err := w.svc.UpdateDocument(w.ctx, actor, docID, UpdateDocumentInput{
		Revision: d.Revision, Content: lockTestContentN(int(d.Revision)), EditLockID: lockID,
	})
	return err
}

func (w *lockWorld) lockRow(t *testing.T, id string) db.DocumentEditLock {
	t.Helper()
	var orgID, docID string
	if err := w.env.f.pool.QueryRow(w.ctx, `SELECT organization_id, document_id FROM document_edit_locks WHERE id = $1`, id).Scan(&orgID, &docID); err != nil {
		t.Fatalf("lock %s: %v", id, err)
	}
	row, err := w.env.f.q.GetDocumentEditLock(w.ctx, db.GetDocumentEditLockParams{ID: id, OrganizationID: orgID, DocumentID: docID})
	if err != nil {
		t.Fatalf("lock %s: %v", id, err)
	}
	return row
}

// expire moves a tenure's TTL (and hold) into the past, as if its editor
// stopped heartbeating long ago.
func (w *lockWorld) expire(t *testing.T, lockID string) {
	t.Helper()
	w.exec(t, `UPDATE document_edit_locks SET expires_at = now() - interval '1 second',
		offline_hold_until = CASE WHEN offline_hold_until IS NULL THEN NULL ELSE now() - interval '1 second' END
		WHERE id = $1`, lockID)
}

func (w *lockWorld) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := w.env.f.pool.Exec(w.ctx, sql, args...); err != nil {
		t.Fatal(err)
	}
}

func (w *lockWorld) device(t *testing.T, userID string) string {
	t.Helper()
	return insertEditLockDeviceSession(t, w.ctx, w.env.f.pool, userID)
}

// insertEditLockDeviceSession is a live desktop device session (R6 needs
// one); the audit coverage fixture uses it too.
func insertEditLockDeviceSession(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) string {
	t.Helper()
	id := util.NewID()
	if _, err := db.New(pool).CreateDeviceSession(ctx, db.CreateDeviceSessionParams{
		ID: id, UserID: userID, SessionFamilyID: id, ClientID: "uniwork-office", DeploymentID: "default",
		DeviceLabel: "Laptop", Platform: "windows", Build: "1.0", RefreshTokenDigest: hashToken("edit-lock-device-" + id),
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(30 * 24 * time.Hour), Valid: true}, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	return id
}

func (w *lockWorld) countAudit(t *testing.T, action, docID string) int {
	t.Helper()
	return w.env.countAudit(t, action, docID)
}

func (w *lockWorld) countOutbox(t *testing.T, topic, docID string) int {
	t.Helper()
	return w.env.countOutbox(t, topic, docID)
}

// auditMeta is the metadata of the latest audit row of action on docID.
func (w *lockWorld) auditMeta(t *testing.T, action, docID string) map[string]any {
	t.Helper()
	var raw string
	if err := w.env.f.pool.QueryRow(w.ctx,
		`SELECT metadata::text FROM audit_events WHERE action = $1 AND resource_id = $2 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
		action, docID).Scan(&raw); err != nil {
		t.Fatalf("audit %s of %s: %v", action, docID, err)
	}
	m := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatal(err)
	}
	return m
}

// shareTo gives u a user share on d at level.
func (w *lockWorld) shareTo(t *testing.T, d db.Document, u db.User, level DocumentLevel) db.DocumentShare {
	t.Helper()
	return w.env.f.share(t, d, DocumentPrincipalUser, u.ID, level, w.tn.owner.ID)
}

// restricted is a restricted page of workspace A; aclOwner holds manage,
// everyone else reads it only through a share.
func (w *lockWorld) restricted(t *testing.T) db.Document {
	t.Helper()
	return w.env.f.doc(t, w.tn, docSpec{ws: w.tn.wsA, visibility: "restricted", aclOwner: w.tn.aclOwner.ID, createdBy: w.tn.aclOwner.ID})
}
