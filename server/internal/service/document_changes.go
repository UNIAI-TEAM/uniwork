package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// Office change feed, cold start (G5-01a, UNI-1344; spec G5/G6/G7 §4.1,
// contract-p0 §3): GET /workspaces/{workspaceID}/documents/changes.
const (
	// DocumentChangeSnapshotTTL is the dev lifetime of a cold-start snapshot
	// (contract-p0 temporary value; the production number is G5-D2's).
	// OFFICE_CHANGE_SNAPSHOT_TTL overrides it.
	DocumentChangeSnapshotTTL = 15 * time.Minute
	// DocumentChangeFeedCursorTTL is how long the feed cursor the last
	// snapshot page hands out stays valid: the incremental feed retention
	// (G5-01b, number pending G5-D2).
	DocumentChangeFeedCursorTTL = 7 * 24 * time.Hour
	// DocumentChangePageDefault and DocumentChangePageMax bound one page.
	DocumentChangePageDefault = 200
	DocumentChangePageMax     = 500
)

// The change feed codes (X-03, error_class.go): unclassified, the status
// travels with the code. The messages name no scope.
var (
	ErrChangeCursorInvalid = CodedError{Code: "change_cursor_invalid", Status: http.StatusBadRequest, Msg: "invalid change cursor"}
	ErrChangeCursorExpired = CodedError{Code: "change_cursor_expired", Status: http.StatusGone, Msg: "change cursor expired; start a full resync"}
	// errChangeFeedPending answers a feed cursor until the incremental feed
	// (G5-01b) lands: refusing it loudly is the only answer that cannot lose
	// a commit.
	errChangeFeedPending = CodedError{Code: "unsupported_operation", Status: http.StatusNotImplemented, Msg: "the incremental change feed is not available yet"}
)

// officeCapabilityOff is the refusal of a capability hidden by a flag
// (contract-p0 §4); capability is the key of the app capability route.
func officeCapabilityOff(capability string) error {
	return CodedError{
		Code: "office_capability_off", Status: http.StatusForbidden,
		Msg: "this Office capability is turned off", Fields: map[string]any{"capability": capability},
	}
}

// DocumentChangesService serves the change feed. Membership is decided by
// the document list scope (OrganizationService / WorkspaceService
// RequireMember); the flag only hides the capability.
type DocumentChangesService struct {
	docs       *DocumentService
	flags      *featureflag.Service
	codec      changeCursorCodec
	deployment string
	ttl        time.Duration
	now        func() time.Time
	// afterScopeHook is a test seam (BE-F1-4): it runs right after openSnapshot
	// resolved the gates inside its transaction, so a test can revoke a role
	// mid-construction and pin that the gates are re-read inside the snapshot.
	// Never set in production.
	afterScopeHook func()
	// pageItemHook is a test seam (BE-F1-3): it runs after a page read its
	// snapshot row (so the transaction snapshot is fixed) and before it reads
	// the items, so a test can commit a sweep in that window and pin that the
	// answer is a complete page, never a short one. Never set in production.
	pageItemHook func()
}

// NewDocumentChangesService signs cursors with a key derived from JWT_SECRET
// under its own label and binds them to the server's deployment identity:
// the first DESKTOP_AUTH_DEPLOYMENT_IDS entry, the same id GET /api/v1/config
// publishes to the desktop app.
func NewDocumentChangesService(docs *DocumentService, flags *featureflag.Service, cfg config.Config) *DocumentChangesService {
	if docs == nil || cfg.JWTSecret == "" {
		return nil
	}
	ttl := cfg.OfficeChangeSnapshotTTL
	if ttl <= 0 {
		ttl = DocumentChangeSnapshotTTL
	}
	return &DocumentChangesService{
		docs: docs, flags: flags, codec: newChangeCursorCodec(cfg.JWTSecret),
		deployment: changeDeploymentID(cfg), ttl: ttl, now: time.Now,
	}
}

func changeDeploymentID(cfg config.Config) string {
	for _, id := range cfg.DesktopAuthDeploymentIDs {
		if v := strings.TrimSpace(id); v != "" {
			return v
		}
	}
	return "default"
}

// SetClock replaces the clock (tests).
func (s *DocumentChangesService) SetClock(now func() time.Time) { s.now = now }

// SnapshotTTL is the lifetime of a snapshot opened now.
func (s *DocumentChangesService) SnapshotTTL() time.Duration { return s.ttl }

// DocumentChangeListInput is one page request; an empty Cursor opens a
// snapshot (cold start).
type DocumentChangeListInput struct {
	Cursor string
	Limit  int
}

// DocumentChange is one snapshot row: ids, kind, revision and version
// pointer, never a title, path or content.
type DocumentChange struct {
	DocumentID     string
	Kind           string
	Revision       int64
	CurrentVersion int32
	FileVersionID  string
}

// DocumentChangePage is one page. NextCursor is always set: a snapshot cursor
// while HasMore, then the feed cursor carrying the high-water mark.
type DocumentChangePage struct {
	Phase      string
	Changes    []DocumentChange
	HasMore    bool
	NextCursor string
	ExpiresAt  time.Time
}

// List answers one page of the change feed for actor in workspaceID.
func (s *DocumentChangesService) List(ctx context.Context, actor Actor, workspaceID string, in DocumentChangeListInput) (DocumentChangePage, error) {
	scope, err := s.docs.documentListScope(ctx, actor, workspaceID)
	if err != nil {
		return DocumentChangePage{}, err
	}
	// The feed syncs a workspace library: workspace members only. A
	// share-only reader has the shared-with-me list instead.
	if !scope.seeAll && !scope.memberVisible {
		return DocumentChangePage{}, ErrForbidden
	}
	if !s.feedEnabled(ctx, actor.ID, scope.organizationID) {
		return DocumentChangePage{}, officeCapabilityOff("sync_feed")
	}
	limit := clampChangeLimit(in.Limit)
	if in.Cursor == "" {
		snapshotID, orgID, err := s.openSnapshot(ctx, actor, workspaceID)
		if err != nil {
			return DocumentChangePage{}, err
		}
		cs := changeCursorScope{deployment: s.deployment, userID: actor.ID, organization: orgID, workspace: workspaceID}
		return s.page(ctx, cs, snapshotID, "", limit)
	}
	cs := changeCursorScope{deployment: s.deployment, userID: actor.ID, organization: scope.organizationID, workspace: workspaceID}
	claims, err := s.codec.verify(in.Cursor, cs, s.now())
	if err != nil {
		return DocumentChangePage{}, err
	}
	if claims.Phase == changeCursorPhaseFeed {
		return DocumentChangePage{}, errChangeFeedPending
	}
	return s.page(ctx, cs, claims.SnapshotID, claims.After, limit)
}

func (s *DocumentChangesService) feedEnabled(ctx context.Context, userID, orgID string) bool {
	def := false
	if f, ok := featureflags.Lookup(officeSyncFeedFlag); ok {
		def = f.Default
	}
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: userID, OrganizationID: orgID})
	return s.flags.IsEnabled(ctx, officeSyncFeedFlag, def)
}

func clampChangeLimit(n int) int32 {
	switch {
	case n <= 0:
		return DocumentChangePageDefault
	case n > DocumentChangePageMax:
		return DocumentChangePageMax
	default:
		return int32(n)
	}
}

// openSnapshot materialises the cold-start snapshot. The high-water mark and
// the items are read by ONE REPEATABLE READ transaction, so every later
// statement of it sees exactly the MVCC snapshot pg_current_snapshot()
// captured: the items are the documents as of the high-water mark and a
// writer committing meanwhile is after it - G5-01b delivers it from there.
// Outbox ids and created_at cannot be the mark: a ULID minted before a slow
// commit sorts below rows that committed first. Opening a snapshot is a read:
// it changes no business state, so it writes no audit row (ADR 0009 covers
// commands; snapshot rows are a short-lived derived cache).
//
// Membership and the read gates are re-resolved INSIDE this transaction
// (RequireMemberQ / RequireAgentMemberQ through the tx), not only from the
// scope the caller resolved before it (BE-F1-4): a role revoked between the
// two requests' first gate read and the item materialisation therefore leaves
// no snapshot behind, and the gate and the items are read against the same
// MVCC snapshot. The residual window is the RR transaction snapshot itself: a
// revocation committing after this transaction's first statement is, by
// definition, not in this snapshot - the same semantics as every other
// membership decision in the codebase.
//
// The returned organization id is the one read inside the transaction, so the
// cursor binds the same tenant the snapshot carries.
func (s *DocumentChangesService) openSnapshot(ctx context.Context, actor Actor, workspaceID string) (string, string, error) {
	tx, err := s.docs.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return "", "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.docs.q.WithTx(tx)
	w, err := q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	if err != nil {
		return "", "", err
	}
	scope, err := s.docs.documentListScopeForWorkspace(ctx, q, actor, workspaceID, w)
	if err != nil {
		return "", "", err
	}
	// The feed syncs a workspace library: workspace members only, same
	// decision as the caller-side gate (List).
	if !scope.seeAll && !scope.memberVisible {
		return "", "", ErrForbidden
	}
	if s.afterScopeHook != nil {
		s.afterScopeHook()
	}
	highWater, err := q.CurrentChangeHighWater(ctx)
	if err != nil {
		return "", "", err
	}
	id := util.NewID()
	if err := q.InsertDocumentChangeSnapshot(ctx, db.InsertDocumentChangeSnapshotParams{
		ID: id, OrganizationID: scope.organizationID, WorkspaceID: workspaceID,
		CreatedBy: actor.ID, CreatedByKind: string(actor.Kind), HighWater: highWater,
		ExpiresAt: pgtype.Timestamptz{Time: s.now().Add(s.ttl), Valid: true},
	}); err != nil {
		return "", "", err
	}
	n, err := q.InsertDocumentChangeSnapshotItems(ctx, db.InsertDocumentChangeSnapshotItemsParams{
		SnapshotID: id, OrganizationID: scope.organizationID, WorkspaceID: workspaceID,
		SeeAll: scope.seeAll, MemberVisible: scope.memberVisible, AclOwner: scope.aclOwner,
		ActorID: actor.ID, AllowShares: scope.allowShares, ShareWorkspaces: nonNilStrings(scope.shareWorkspaces),
	})
	if err != nil {
		return "", "", err
	}
	if err := q.SetDocumentChangeSnapshotCount(ctx, db.SetDocumentChangeSnapshotCountParams{
		ID: id, OrganizationID: scope.organizationID, ItemCount: int32(n),
	}); err != nil {
		return "", "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", "", err
	}
	return id, scope.organizationID, nil
}

func nonNilStrings(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

// page reads one keyset page. The snapshot row and its items are read in one
// REPEATABLE READ transaction and the sweeper deletes both in one
// transaction, so a page is either whole or the answer is 410 - never short.
func (s *DocumentChangesService) page(ctx context.Context, cs changeCursorScope, snapshotID, after string, limit int32) (DocumentChangePage, error) {
	tx, err := s.docs.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return DocumentChangePage{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.docs.q.WithTx(tx)
	snap, err := q.GetDocumentChangeSnapshot(ctx, db.GetDocumentChangeSnapshotParams{
		ID: snapshotID, OrganizationID: cs.organization, WorkspaceID: cs.workspace,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Swept (or never existed under this signed scope): the cursor was
		// genuine, so the honest answer is a full resync.
		return DocumentChangePage{}, ErrChangeCursorExpired
	}
	if err != nil {
		return DocumentChangePage{}, err
	}
	if snap.CreatedBy != cs.userID {
		return DocumentChangePage{}, ErrChangeCursorInvalid
	}
	now := s.now()
	if !now.Before(snap.ExpiresAt.Time) {
		return DocumentChangePage{}, ErrChangeCursorExpired
	}
	if s.pageItemHook != nil {
		// The transaction snapshot is fixed by the snapshot-row read above, so
		// a test can now commit a sweep and assert the item read still sees
		// the whole page (BE-F1-3). Never set in production.
		s.pageItemHook()
	}
	rows, err := q.ListDocumentChangeSnapshotItems(ctx, db.ListDocumentChangeSnapshotItemsParams{
		SnapshotID: snapshotID, OrganizationID: cs.organization, WorkspaceID: cs.workspace,
		AfterDocumentID: after, PageLimit: limit + 1,
	})
	if err != nil {
		return DocumentChangePage{}, err
	}
	out := DocumentChangePage{Phase: changeCursorPhaseSnapshot, Changes: make([]DocumentChange, 0, len(rows))}
	if len(rows) > int(limit) {
		out.HasMore = true
		rows = rows[:limit]
	}
	for _, r := range rows {
		out.Changes = append(out.Changes, DocumentChange{
			DocumentID: r.DocumentID, Kind: r.Kind, Revision: r.Revision,
			CurrentVersion: r.CurrentVersion, FileVersionID: r.FileVersionID.String,
		})
	}
	claims := changeCursorClaims{
		Protocol: DocumentChangeProtocol, Deployment: cs.deployment, UserID: cs.userID,
		Organization: cs.organization, Workspace: cs.workspace,
	}
	if out.HasMore {
		claims.Phase, claims.SnapshotID = changeCursorPhaseSnapshot, snapshotID
		claims.After = out.Changes[len(out.Changes)-1].DocumentID
		claims.ExpiresAt = snap.ExpiresAt.Time.Unix()
		out.ExpiresAt = snap.ExpiresAt.Time
	} else {
		claims.Phase, claims.HighWater = changeCursorPhaseFeed, snap.HighWater
		out.ExpiresAt = now.Add(DocumentChangeFeedCursorTTL)
		claims.ExpiresAt = out.ExpiresAt.Unix()
	}
	if out.NextCursor, err = s.codec.sign(claims); err != nil {
		return DocumentChangePage{}, fmt.Errorf("sign change cursor: %w", err)
	}
	return out, nil
}
