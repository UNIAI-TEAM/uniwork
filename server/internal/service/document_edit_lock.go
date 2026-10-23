package service

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document edit lock (UNI-1645, addendum 2026-10-15): one human editor of a
// document at a time. A tenure is one row of document_edit_locks; the live
// one is the unended row whose heartbeat TTL or offline hold has not run
// out. Every command that changes the holder - and every content write -
// runs under the document row lock (withDocumentMutation), reads the live
// row FOR UPDATE and takes its times from the database clock, so two
// commands on one document run one after the other and the partial unique
// index idx_document_edit_locks_live_doc is only the second line (§1.5).
// The heartbeat alone is one conditional UPDATE without the document lock.
//
// Commands R1-R10 live in document_edit_lock_commands.go and
// document_edit_lock_requests.go; the expiry sweeper and the outbox release
// consumer in document_edit_lock_sweep.go and document_edit_lock_consumer.go.

// DocumentEditLockConfig is the addendum §7 timing. A2 fills it from
// config.Config; tests and the isolation world set it directly through
// SetEditLockConfig. A zero field keeps its default.
type DocumentEditLockConfig struct {
	TTL               time.Duration
	Heartbeat         time.Duration
	SweepInterval     time.Duration
	HoldMax           time.Duration
	HoldChainMax      time.Duration
	RequestTTL        time.Duration
	RequestMaxPerHour int
}

// DefaultDocumentEditLockConfig is §7: TTL 2m, heartbeat 30s, sweep 30s,
// hold 8h, hold chain 24h, request TTL 15m, 5 requests per hour.
func DefaultDocumentEditLockConfig() DocumentEditLockConfig {
	return DocumentEditLockConfig{
		TTL:               2 * time.Minute,
		Heartbeat:         30 * time.Second,
		SweepInterval:     30 * time.Second,
		HoldMax:           8 * time.Hour,
		HoldChainMax:      24 * time.Hour,
		RequestTTL:        15 * time.Minute,
		RequestMaxPerHour: 5,
	}
}

// withDefaults fills every zero field from DefaultDocumentEditLockConfig.
func (c DocumentEditLockConfig) withDefaults() DocumentEditLockConfig {
	d := DefaultDocumentEditLockConfig()
	if c.TTL > 0 {
		d.TTL = c.TTL
	}
	if c.Heartbeat > 0 {
		d.Heartbeat = c.Heartbeat
	}
	if c.SweepInterval > 0 {
		d.SweepInterval = c.SweepInterval
	}
	if c.HoldMax > 0 {
		d.HoldMax = c.HoldMax
	}
	if c.HoldChainMax > 0 {
		d.HoldChainMax = c.HoldChainMax
	}
	if c.RequestTTL > 0 {
		d.RequestTTL = c.RequestTTL
	}
	if c.RequestMaxPerHour > 0 {
		d.RequestMaxPerHour = c.RequestMaxPerHour
	}
	return d
}

// SetEditLockConfig sets the edit lock timing; zero fields keep the §7
// defaults.
func (s *DocumentService) SetEditLockConfig(c DocumentEditLockConfig) {
	s.editLock = c.withDefaults()
}

// EditLockConfig is the timing in force (defaults when never set).
func (s *DocumentService) EditLockConfig() DocumentEditLockConfig {
	return s.editLock.withDefaults()
}

// Clients and grant paths of a tenure (§1.2).
const (
	DocumentEditClientWebPage   = "web_page"
	DocumentEditClientWebOffice = "web_office"
	DocumentEditClientDesktop   = "desktop"

	documentEditGrantAcquire  = "acquire"
	documentEditGrantTakeOver = "take_over"
	documentEditGrantHandover = "handover"
	documentEditGrantMoveHere = "move_here"
)

// End reasons of a tenure (§1.2); edit_lock_lost.fields.reason is one of
// them (contract §11).
const (
	DocumentEditEndReleased              = "released"
	DocumentEditEndExpired               = "expired"
	DocumentEditEndTakenOver             = "taken_over"
	DocumentEditEndHandedOver            = "handed_over"
	DocumentEditEndMovedHere             = "moved_here"
	DocumentEditEndSessionRevoked        = "session_revoked"
	DocumentEditEndAccessLost            = "access_lost"
	DocumentEditEndMemberDeactivated     = "member_deactivated"
	DocumentEditEndOrganizationSuspended = "organization_suspended"
	DocumentEditEndDocumentArchived      = "document_archived"
	DocumentEditEndDocumentDeleted       = "document_deleted"
	DocumentEditEndDocumentShelved       = "document_shelved"
)

// Request statuses (§1.3).
const (
	DocumentEditRequestPending    = "pending"
	DocumentEditRequestAccepted   = "accepted"
	DocumentEditRequestDeclined   = "declined"
	DocumentEditRequestCancelled  = "cancelled"
	DocumentEditRequestSuperseded = "superseded"
	DocumentEditRequestExpired    = "expired"
)

// Routes of the refused-write counter (§7).
const (
	DocumentEditLockRoutePatch       = "patch"
	DocumentEditLockRouteCommit      = "commit"
	DocumentEditLockRouteFrameCommit = "frame_commit"
	DocumentEditLockRouteRestore     = "restore"
)

// Realtime topics (§4). The catalogue rows are A0's; these are the names.
const (
	topicDocumentLockChanged         = "document.lock_changed"
	topicDocumentLockTakenOver       = "document.lock_taken_over"
	topicDocumentEditRequested       = "document.edit_requested"
	topicDocumentEditRequestAnswered = "document.edit_request_answered"
)

// documentEditLockSystem is the audit actor of a tenure the server ends on
// its own (expiry, lost access, a revoked session, an archive cascade).
var documentEditLockSystem = audit.System("document_edit_lock")

// ErrDocumentLocked is the sentinel of the 423 document_locked answer. It is
// deliberately not ErrConflict: a locked save is not a lost base race, and
// documentSaveResult counts it as outcome "locked" (addendum §3.3).
var ErrDocumentLocked = errors.New("document_locked")

// editLockMetrics is the metrics port (A0's three edit lock counters on
// DocumentMetrics).
func (s *DocumentService) editLockMetrics() DocumentMetrics { return s.metrics }

// countEditLockRefused moves the refused-write counter for a 423.
func (s *DocumentService) countEditLockRefused(route string, err error) {
	if errors.Is(err, ErrDocumentLocked) {
		s.editLockMetrics().IncDocumentEditLockRefused(route)
	}
}

// editLockOpForEnd maps an end reason onto the closed op vocabulary of
// uniwork_document_edit_lock_ops_total. Take-over, handover and move here are
// counted by the command that replaced the tenure, never here.
// document_archived and document_shelved fall through to "release".
func editLockOpForEnd(reason string) string {
	switch reason {
	case DocumentEditEndExpired:
		return "expire"
	case DocumentEditEndSessionRevoked:
		return "session_revoked"
	case DocumentEditEndAccessLost, DocumentEditEndMemberDeactivated, DocumentEditEndOrganizationSuspended:
		return "access_lost"
	case DocumentEditEndTakenOver, DocumentEditEndHandedOver, DocumentEditEndMovedHere:
		return ""
	default:
		return "release"
	}
}

// --- Errors (§3.1, §3.3) ------------------------------------------------

func rfc3339(t pgtype.Timestamptz) string {
	return t.Time.UTC().Format(time.RFC3339)
}

// errDocumentLocked is the 423 body: who holds the document and until when,
// whether it is the caller in another tab or device, and the revision so the
// client can go the conflict path without another read. Never the lock id.
func errDocumentLocked(live db.DocumentEditLock, holderName string, heldByMe bool, currentRevision int64) error {
	fields := map[string]any{
		"holder_id":        live.UserID,
		"holder_name":      holderName,
		"since":            rfc3339(live.AcquiredAt),
		"expires_at":       rfc3339(live.ExpiresAt),
		"held_by_me":       heldByMe,
		"current_revision": strconv.FormatInt(currentRevision, 10),
	}
	if live.OfflineHoldUntil.Valid {
		fields["offline_hold_until"] = rfc3339(live.OfflineHoldUntil)
	}
	return CodedError{Code: "document_locked", Status: http.StatusLocked, Err: ErrDocumentLocked,
		Msg: "tài liệu đang được người khác sửa", Fields: fields}
}

// errEditLockLost is 409 edit_lock_lost: the tenure the caller named ended or
// is not theirs. by_id/by_name name the new holder only for a take-over or a
// handover (contract §11). A live tenure of another account has no end
// reason, so the answer carries no reason and no holder: clients show their
// generic dialog.
func errEditLockLost(reason, byID, byName string) error {
	fields := map[string]any{}
	if reason != "" {
		fields["reason"] = reason
	}
	if byID != "" && (reason == DocumentEditEndTakenOver || reason == DocumentEditEndHandedOver) {
		fields["by_id"], fields["by_name"] = byID, byName
	}
	return CodedError{Code: "edit_lock_lost", Status: http.StatusConflict,
		Msg: "bạn không còn quyền sửa tài liệu này", Fields: fields}
}

func errEditLockChanged() error {
	return coded(http.StatusConflict, "edit_lock_changed", "người đang sửa tài liệu đã thay đổi")
}

func errEditLockFree() error {
	return coded(http.StatusConflict, "edit_lock_free", "không có ai đang sửa tài liệu này")
}

func errEditLockHeldByMe() error {
	return coded(http.StatusConflict, "edit_lock_held_by_me", "bạn đang sửa tài liệu này ở nơi khác")
}

func errEditHoldDeviceRequired() error {
	return coded(http.StatusForbidden, "edit_hold_device_required", "giữ quyền sửa khi offline cần ứng dụng máy tính đã đăng nhập")
}

func errEditHoldCapReached() error {
	return coded(http.StatusConflict, "edit_hold_cap_reached", "đã hết thời gian giữ quyền sửa offline tối đa")
}

func errEditRequestToSelf() error {
	return coded(http.StatusConflict, "edit_request_to_self", "bạn đang giữ quyền sửa tài liệu này")
}

func errEditRequestClosed() error {
	return coded(http.StatusConflict, "edit_request_closed", "yêu cầu này đã được xử lý")
}

func errEditRequestExpired() error {
	return coded(http.StatusGone, "edit_request_expired", "yêu cầu này đã hết hạn")
}

func errEditRequestRateLimited(retryAfter time.Duration) error {
	secs := int64((retryAfter + time.Second - 1) / time.Second)
	if secs < 1 {
		secs = 1
	}
	return CodedError{Code: "edit_request_rate_limited", Status: http.StatusTooManyRequests,
		Msg: "bạn đã gửi quá nhiều yêu cầu; hãy thử lại sau", Fields: map[string]any{"retry_after_s": secs}}
}

// --- Shared helpers -----------------------------------------------------

// editLockLive reports whether an unended tenure is live at now.
func editLockLive(l db.DocumentEditLock, now time.Time) bool {
	if l.EndedAt.Valid {
		return false
	}
	return l.ExpiresAt.Time.After(now) || (l.OfflineHoldUntil.Valid && l.OfflineHoldUntil.Time.After(now))
}

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

// editLockClock is the transaction's database now().
func editLockClock(ctx context.Context, q *db.Queries) (time.Time, error) {
	now, err := q.DocumentEditLockClock(ctx)
	if err != nil {
		return time.Time{}, err
	}
	return now.Time, nil
}

// userDisplayName is the name a lock SDO or the 423 body shows. A missing
// account reads as an empty name rather than failing the command.
func userDisplayName(ctx context.Context, q *db.Queries, userID string) (string, error) {
	u, err := q.GetUserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return u.DisplayName, nil
}

func lockChangedEvent(doc db.Document) audit.Event {
	return audit.Event{Topic: topicDocumentLockChanged, Payload: map[string]string{
		"document_id": doc.ID, "workspace_id": doc.WorkspaceID,
	}}
}

// lockLiveForUpdate reads the document's unended tenure FOR UPDATE. A row
// that ran out is ended here as expired (audit + outbox, as the sweeper
// would) and reads as no lock, so a holder-changing command never waits for
// the sweeper. ops collects the counter moves for after the commit.
func (s *DocumentService) lockLiveForUpdate(ctx context.Context, q *db.Queries, doc db.Document, now time.Time, ops *editLockOps) (*db.DocumentEditLock, error) {
	row, err := q.LockLiveDocumentEditLock(ctx, db.LockLiveDocumentEditLockParams{
		OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if editLockLive(row, now) {
		return &row, nil
	}
	if _, err := s.releaseTenure(ctx, q, doc, row, DocumentEditEndExpired, documentEditLockSystem, now, ops); err != nil {
		return nil, err
	}
	return nil, nil
}

// endTenureRow ends one tenure and supersedes its open requests, without an
// audit row: the caller records the command that ended it.
func endTenureRow(ctx context.Context, q *db.Queries, lock db.DocumentEditLock, reason string, by audit.Actor, now time.Time) (db.DocumentEditLock, error) {
	endedBy := pgtype.Text{}
	if by.Kind == audit.KindHuman {
		endedBy = pgtype.Text{String: by.ID, Valid: true}
	}
	ended, err := q.EndDocumentEditLock(ctx, db.EndDocumentEditLockParams{
		EndedAt: ts(now), EndReason: reason, EndedBy: endedBy, ID: lock.ID, OrganizationID: lock.OrganizationID,
	})
	if err != nil {
		return db.DocumentEditLock{}, err
	}
	if _, err := q.SupersedeDocumentEditRequestsForLock(ctx, db.SupersedeDocumentEditRequestsForLockParams{
		OrganizationID: lock.OrganizationID, LockID: lock.ID,
	}); err != nil {
		return db.DocumentEditLock{}, err
	}
	return ended, nil
}

// releaseTenure ends a tenure with its own document.edit_lock_released row
// and a document.lock_changed frame: R4, expiry, the consumer, an archive.
func (s *DocumentService) releaseTenure(ctx context.Context, q *db.Queries, doc db.Document, lock db.DocumentEditLock, reason string, actor audit.Actor, now time.Time, ops *editLockOps) (db.DocumentEditLock, error) {
	ended, err := endTenureRow(ctx, q, lock, reason, actor, now)
	if err != nil {
		return db.DocumentEditLock{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Actor: actor,
		Action: audit.ActionDocumentEditLockReleased, ResourceType: "document", ResourceID: doc.ID,
		Metadata: map[string]any{"lock_id": lock.ID, "reason": reason, "holder_id": lock.UserID},
	}, lockChangedEvent(doc)); err != nil {
		return db.DocumentEditLock{}, err
	}
	ops.lock(editLockOpForEnd(reason))
	return ended, nil
}

// editLockOps collects counter moves inside a transaction; flush runs them
// once it committed, so a rolled-back command counts nothing.
type editLockOps struct {
	locks    []string
	requests []string
}

func (o *editLockOps) lock(op string) {
	if o != nil && op != "" {
		o.locks = append(o.locks, op)
	}
}

func (o *editLockOps) request(op string) {
	if o != nil && op != "" {
		o.requests = append(o.requests, op)
	}
}

func (s *DocumentService) flushEditLockOps(o *editLockOps) {
	m := s.editLockMetrics()
	for _, op := range o.locks {
		m.IncDocumentEditLockOp(op)
	}
	for _, op := range o.requests {
		m.IncDocumentEditRequest(op)
	}
}

// --- Write gate (§2) ----------------------------------------------------

// checkDocumentEditLock is the §2 rule, run inside a content write's
// transaction after the level and archive checks and before the revision
// check (contract §4 precedence):
//  1. no live tenure: the write passes (Q1), for a person or an agent;
//  2. a live tenure the caller names by its id and holds as the same human:
//     the write passes and refreshes the heartbeat;
//  3. anything else is 423 document_locked; an agent is refused whenever a
//     live tenure exists (§1.6).
//
// An expired tenure is not ended here - a save writes no lock audit row; the
// sweeper or the next holder-changing command ends it.
func (s *DocumentService) checkDocumentEditLock(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, editLockID string) error {
	live, err := q.LockLiveDocumentEditLock(ctx, db.LockLiveDocumentEditLockParams{
		OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	now, err := editLockClock(ctx, q)
	if err != nil {
		return err
	}
	if !editLockLive(live, now) {
		return nil
	}
	human := actor.Kind == audit.KindHuman
	if human && editLockID != "" && editLockID == live.ID && live.UserID == actor.ID && live.EditorID != "" {
		_, err := q.HeartbeatDocumentEditLock(ctx, db.HeartbeatDocumentEditLockParams{
			TtlMs: s.EditLockConfig().TTL.Milliseconds(), ID: live.ID, OrganizationID: live.OrganizationID,
			DocumentID: doc.ID, UserID: actor.ID,
		})
		return err
	}
	name, err := userDisplayName(ctx, q, live.UserID)
	if err != nil {
		return err
	}
	return errDocumentLocked(live, name, human && live.UserID == actor.ID, doc.Revision)
}

// checkVersionUploadLock is the BIGUP-LOCKCHECK S-1 rule: a version upload
// session is refused up front while a live tenure exists that the calling
// human does not hold, so a locked document never uploads 200 MiB of parts
// that the commit gate would then discard.
//
// Read-only, unlike checkDocumentEditLock: it reads the unended tenure
// without FOR UPDATE, refreshes no heartbeat and writes nothing (no audit, no
// outbox, no ending of a stale row). The commit gate stays the authority; a
// tenure that ran out reads as no lock here too.
//
// A create carries no edit_lock_id (adding one would change the
// Idempotency-Key fingerprint), so the caller's own tenure - in any tab - is
// the only way to pass: held_by_me is always false in this 423. An agent is
// refused whenever a live tenure exists (§1.6), the same as the gate.
func (s *DocumentService) checkVersionUploadLock(ctx context.Context, actor Actor, doc db.Document) error {
	live, err := s.q.GetLiveDocumentEditLock(ctx, db.GetLiveDocumentEditLockParams{
		OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	now, err := editLockClock(ctx, s.q)
	if err != nil {
		return err
	}
	if !editLockLive(live, now) {
		return nil
	}
	if actor.Kind == audit.KindHuman && live.UserID == actor.ID {
		return nil
	}
	name, err := userDisplayName(ctx, s.q, live.UserID)
	if err != nil {
		return err
	}
	return errDocumentLocked(live, name, false, doc.Revision)
}

// releaseEditLocksOnArchive ends the live tenures of every archived document
// in the archive's own transaction (end_reason document_archived, §2).
func (s *DocumentService) releaseEditLocksOnArchive(ctx context.Context, q *db.Queries, actor Actor, root db.Document, ids []string) (*editLockOps, error) {
	return s.releaseLiveEditLocks(ctx, q, actor, root, ids, DocumentEditEndDocumentArchived)
}

// releaseLiveEditLocks ends the live tenures of every named document in the
// caller's transaction. document_shelved maps to op "release" the same way
// document_archived does (editLockOpForEnd default).
func (s *DocumentService) releaseLiveEditLocks(ctx context.Context, q *db.Queries, actor Actor, root db.Document, ids []string, reason string) (*editLockOps, error) {
	ops := &editLockOps{}
	if len(ids) == 0 {
		return ops, nil
	}
	rows, err := q.ListLiveDocumentEditLocks(ctx, db.ListLiveDocumentEditLocksParams{
		OrganizationID: root.OrganizationID, DocumentIds: ids,
	})
	if err != nil || len(rows) == 0 {
		return ops, err
	}
	now, err := editLockClock(ctx, q)
	if err != nil {
		return ops, err
	}
	by := documentEditLockSystem
	if actor.Kind == audit.KindHuman {
		by = actor
	}
	for _, l := range rows {
		doc := root
		if l.DocumentID != root.ID {
			// Every node of the batch shares the root's tenant pair; only the
			// id differs, which is all the audit row and frame name.
			doc.ID = l.DocumentID
		}
		if _, err := s.releaseTenure(ctx, q, doc, l, reason, by, now, ops); err != nil {
			return ops, err
		}
	}
	return ops, nil
}
