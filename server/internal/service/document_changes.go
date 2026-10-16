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
	// The fields below are test seams, set only from _test.go files of this
	// package (unexported, so no other package can reach them) and never by
	// NewDocumentChangesService: their zero values are the production path.
	//
	// midBuildHook runs inside openSnapshot after the gates and the high-water
	// mark were read and before the items are (BE-F2-1, BE-F2-2), so a test can
	// commit a writer or a revocation in the middle of the build.
	midBuildHook func()
	// pageItemHook runs inside page after the snapshot row passed its expiry
	// check and before the items are read (BE-F2-3), so a test can commit a
	// sweep in that window.
	pageItemHook func()
	// isoOverride, when set, replaces REPEATABLE READ in openSnapshot and
	// page, so a guard can prove it turns red under READ COMMITTED.
	isoOverride pgx.TxIsoLevel
	// feedLag, when set, observes the lag of every served feed page (G5-01b
	// metric): the age of the oldest committed change the feed had not
	// delivered yet. main.go wires it to metrics.OfficeChangeFeed; nil is the
	// production path for a build without metrics and for tests that do not
	// measure lag.
	feedLag DocumentChangeFeedLagMetrics
}

// SetFeedLagMetrics attaches the incremental feed's lag recorder.
func (s *DocumentChangesService) SetFeedLagMetrics(m DocumentChangeFeedLagMetrics) {
	s.feedLag = m
}

// isoLevel is the isolation of the snapshot and page transactions:
// REPEATABLE READ, unless a test overrides it.
func (s *DocumentChangesService) isoLevel() pgx.TxIsoLevel {
	if s.isoOverride != "" {
		return s.isoOverride
	}
	return pgx.RepeatableRead
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
	Phase   string
	Changes []DocumentChange
	// Feed carries the incremental-feed rows (phase feed); Changes is the
	// snapshot page's shape. A feed row adds the change kind and, for a
	// removal, the removal reason - the snapshot shape stays untouched.
	Feed       []DocumentChangeFeedRow
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
		return s.pageFeed(ctx, cs, claims, limit)
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
// scope the caller resolved before it (BE-F1-4), so the gate and the items
// are read against the same MVCC snapshot: membership is evaluated as of
// the snapshot's MVCC point (the first statement of this transaction, the
// same point as the high-water mark). A revocation committed after that
// point does not abort or trim the snapshot being built, which holds
// exactly the documents the caller could read at that point; every later
// request - the next page cursor or a new cold start - is refused by the
// membership gate. Only a revocation committed before that point leaves no
// snapshot behind.
//
// The returned organization id is the one read inside the transaction, so the
// cursor binds the same tenant the snapshot carries.
func (s *DocumentChangesService) openSnapshot(ctx context.Context, actor Actor, workspaceID string) (string, string, error) {
	tx, err := s.docs.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: s.isoLevel()})
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
	highWater, err := q.CurrentChangeHighWater(ctx)
	if err != nil {
		return "", "", err
	}
	if s.midBuildHook != nil {
		s.midBuildHook()
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
		ActorID: actor.ID, AllowShares: scope.allowShares, ShareLevels: shareLevelsFor(DocumentLevelView),
		ShareWorkspaces: nonNilStrings(scope.shareWorkspaces),
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
	tx, err := s.docs.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: s.isoLevel(), AccessMode: pgx.ReadOnly})
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
		// The snapshot id rides along as evidence availability for the two
		// removal kinds whose pre-change state the change itself destroys
		// (purge, becoming Work-Product-owned); BE-G1-1/BE-G1-2: it is not the
		// permission decision, and a pre-fix cursor without it answers 410
		// where that evidence would be needed.
		claims.SnapshotID = snapshotID
		out.ExpiresAt = now.Add(DocumentChangeFeedCursorTTL)
		claims.ExpiresAt = out.ExpiresAt.Unix()
	}
	if out.NextCursor, err = s.codec.sign(claims); err != nil {
		return DocumentChangePage{}, fmt.Errorf("sign change cursor: %w", err)
	}
	return out, nil
}
