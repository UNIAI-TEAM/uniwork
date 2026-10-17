package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// DocumentEditLockView is the holder's own view of a tenure
// (DocumentEditLockSDO): the row, the timing the client paces itself by and
// the database time. Created tells R2 201 from 200.
type DocumentEditLockView struct {
	Lock              db.DocumentEditLock
	HoldMaxUntil      pgtype.Timestamptz
	HeartbeatInterval time.Duration
	TTL               time.Duration
	ServerTime        time.Time
	Created           bool
}

// DocumentEditLockSummary is DocumentEditLockSummarySDO: who edits and until
// when. LockID is set only for a caller at manage who is not the holder
// (contract v2 C2-1, so the take-over dialog can name expected_lock_id); the
// list rows and the 423 body never carry it.
type DocumentEditLockSummary struct {
	LockID           string
	HolderID         string
	HolderName       string
	HolderAvatarURL  string
	Since            time.Time
	ExpiresAt        time.Time
	OfflineHoldUntil *time.Time
	Reserved         bool
	HeldByMe         bool
}

// DocumentEditLockState is R1 (DocumentEditLockStateSDO).
type DocumentEditLockState struct {
	Lock            *DocumentEditLockSummary
	MyRequest       *DocumentEditRequestView
	PendingRequests []DocumentEditRequestView
	CanTakeOver     bool
	CanRequest      bool
	MyLevel         DocumentLevel
	ServerTime      time.Time
}

// DocumentEditHeartbeat is R3 (DocumentEditHeartbeatSDO).
type DocumentEditHeartbeat struct {
	LockID           string
	ExpiresAt        time.Time
	OfflineHoldUntil *time.Time
	ServerTime       time.Time
}

// AcquireDocumentEditLockInput is R2. SessionID is the bearer's sid
// (middleware.SessionID), never a body field.
type AcquireDocumentEditLockInput struct {
	EditorID     string
	Client       string
	SessionID    string
	MoveFromSelf bool
}

// TakeOverDocumentEditLockInput is R5.
type TakeOverDocumentEditLockInput struct {
	EditorID       string
	Client         string
	SessionID      string
	ExpectedLockID string
}

// errEditLockRace marks a lost insert against idx_document_edit_locks_live_doc;
// the command answers 423 after reading the winner outside the aborted
// transaction.
var errEditLockRace = errors.New("document edit lock: live tenure inserted concurrently")

func validEditLockClient(c string) bool {
	switch c {
	case DocumentEditClientWebPage, DocumentEditClientWebOffice, DocumentEditClientDesktop:
		return true
	default:
		return false
	}
}

func validEditorID(id string) error {
	if id == "" || len(id) > 64 {
		return Invalid("editor_id bắt buộc")
	}
	return nil
}

// requireHumanEditLockActor refuses agents and system actors before any
// read: they never hold, take, hold offline or request a lock (§1.6), and
// the answer is the same not found as Mint's.
func requireHumanEditLockActor(actor Actor) error {
	if actor.Kind != audit.KindHuman || actor.ID == "" {
		return ErrNotFound
	}
	return nil
}

func editLockTimePtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

// editLockMutation is withDocumentMutation for a lock command: the database
// clock read once in the transaction, and the counters moved only after the
// commit. It carries the default shelve gate (write refused); a lock command
// §3 keeps allowed on a shelved item uses editLockMutationOnShelved.
func (s *DocumentService) editLockMutation(
	ctx context.Context, actor Actor, documentID string, required DocumentLevel,
	fn func(q *db.Queries, doc db.Document, access DocumentAccess, now time.Time, ops *editLockOps) error,
) error {
	return s.editLockMutationOn(ctx, actor, documentID, required, shelveWriteRefused, fn)
}

// editLockMutationOnShelved is editLockMutation with the §3 stance for a lock
// command allowed on a shelved document: releasing a tenure only frees the
// document, so the release path stays open on a shelved item (the holder can
// drop the tenure a shelve left live, S-4).
func (s *DocumentService) editLockMutationOnShelved(
	ctx context.Context, actor Actor, documentID string, required DocumentLevel,
	fn func(q *db.Queries, doc db.Document, access DocumentAccess, now time.Time, ops *editLockOps) error,
) error {
	return s.editLockMutationOn(ctx, actor, documentID, required, shelveWriteAllowed, fn)
}

// editLockMutationOn is the shared body: one transaction under the document
// row lock, carrying shelve as the command's stance on a shelved item.
func (s *DocumentService) editLockMutationOn(
	ctx context.Context, actor Actor, documentID string, required DocumentLevel, shelve shelveGate,
	fn func(q *db.Queries, doc db.Document, access DocumentAccess, now time.Time, ops *editLockOps) error,
) error {
	ops := &editLockOps{}
	err := s.withDocumentMutationLocked(ctx, actor, documentID, "", required, shelve, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		now, err := editLockClock(ctx, q)
		if err != nil {
			return err
		}
		return fn(q, doc, access, now, ops)
	})
	if err == nil {
		s.flushEditLockOps(ops)
	}
	return err
}

func (s *DocumentService) editLockView(lock db.DocumentEditLock, now time.Time, created bool) DocumentEditLockView {
	cfg := s.EditLockConfig()
	v := DocumentEditLockView{Lock: lock, HeartbeatInterval: cfg.Heartbeat, TTL: cfg.TTL, ServerTime: now, Created: created}
	if lock.HoldChainStartedAt.Valid {
		v.HoldMaxUntil = ts(lock.HoldChainStartedAt.Time.Add(cfg.HoldChainMax))
	}
	return v
}

func (s *DocumentService) editLockSummary(ctx context.Context, q *db.Queries, actor Actor, lock db.DocumentEditLock, showID bool) (DocumentEditLockSummary, error) {
	sum := DocumentEditLockSummary{
		HolderID: lock.UserID, Since: lock.AcquiredAt.Time, ExpiresAt: lock.ExpiresAt.Time,
		OfflineHoldUntil: editLockTimePtr(lock.OfflineHoldUntil), Reserved: lock.EditorID == "",
		HeldByMe: actor.Kind == audit.KindHuman && lock.UserID == actor.ID,
	}
	if showID && !sum.HeldByMe {
		sum.LockID = lock.ID
	}
	u, err := q.GetUserByID(ctx, lock.UserID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return DocumentEditLockSummary{}, err
	}
	sum.HolderName, sum.HolderAvatarURL = u.DisplayName, u.AvatarUrl.String
	return sum, nil
}

// GetDocumentEditLockState is R1: read-only. A tenure that ran out reads as
// no lock but is not ended here - a GET never writes audit or outbox.
func (s *DocumentService) GetDocumentEditLockState(ctx context.Context, actor Actor, documentID string) (DocumentEditLockState, error) {
	doc, access, err := s.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return DocumentEditLockState{}, err
	}
	now, err := editLockClock(ctx, s.q)
	if err != nil {
		return DocumentEditLockState{}, err
	}
	out := DocumentEditLockState{MyLevel: access.Level, ServerTime: now, PendingRequests: []DocumentEditRequestView{}}
	live, err := s.q.GetLiveDocumentEditLock(ctx, db.GetLiveDocumentEditLockParams{
		OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return DocumentEditLockState{}, err
	}
	manage := access.Level.AtLeast(DocumentLevelManage)
	if err == nil && editLockLive(live, now) {
		sum, err := s.editLockSummary(ctx, s.q, actor, live, manage)
		if err != nil {
			return DocumentEditLockState{}, err
		}
		out.Lock = &sum
		if sum.HeldByMe {
			reqs, err := s.q.ListPendingDocumentEditRequestsForLock(ctx, db.ListPendingDocumentEditRequestsForLockParams{
				OrganizationID: doc.OrganizationID, LockID: live.ID, Now: ts(now),
			})
			if err != nil {
				return DocumentEditLockState{}, err
			}
			for _, r := range reqs {
				v, err := s.editRequestView(ctx, s.q, r, now)
				if err != nil {
					return DocumentEditLockState{}, err
				}
				out.PendingRequests = append(out.PendingRequests, v)
			}
		}
	}
	if actor.Kind == audit.KindHuman {
		mine, err := s.q.GetPendingDocumentEditRequestOfRequester(ctx, db.GetPendingDocumentEditRequestOfRequesterParams{
			OrganizationID: doc.OrganizationID, DocumentID: doc.ID, RequesterID: actor.ID,
		})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
		case err != nil:
			return DocumentEditLockState{}, err
		case mine.ExpiresAt.Time.After(now):
			v, err := s.editRequestView(ctx, s.q, mine, now)
			if err != nil {
				return DocumentEditLockState{}, err
			}
			out.MyRequest = &v
		}
	}
	out.CanTakeOver = manage && out.Lock != nil
	out.CanRequest = actor.Kind == audit.KindHuman && access.Level.AtLeast(DocumentLevelEdit) &&
		out.Lock != nil && !out.Lock.HeldByMe && out.MyRequest == nil
	return out, nil
}

// DocumentEditLockSummaries is the batch read for library rows: the live
// tenure of each document id the caller already passed the read gate on,
// without a lock id (§3.2).
func (s *DocumentService) DocumentEditLockSummaries(ctx context.Context, actor Actor, organizationID string, documentIDs []string) (map[string]DocumentEditLockSummary, error) {
	out := map[string]DocumentEditLockSummary{}
	if len(documentIDs) == 0 {
		return out, nil
	}
	rows, err := s.q.ListLiveDocumentEditLocks(ctx, db.ListLiveDocumentEditLocksParams{
		OrganizationID: organizationID, DocumentIds: documentIDs,
	})
	if err != nil || len(rows) == 0 {
		return out, err
	}
	now, err := editLockClock(ctx, s.q)
	if err != nil {
		return nil, err
	}
	for _, l := range rows {
		if !editLockLive(l, now) {
			continue
		}
		sum, err := s.editLockSummary(ctx, s.q, actor, l, false)
		if err != nil {
			return nil, err
		}
		out[l.DocumentID] = sum
	}
	return out, nil
}

// AcquireDocumentEditLock is R2: take a free document (201), return the
// caller's own tenure for the same editor (200), claim a handover reserved
// for the caller (200), or with MoveFromSelf move the caller's tenure to
// this editor (201). Anything else is 423, including the same editor id
// sent by another person (BE-8).
func (s *DocumentService) AcquireDocumentEditLock(ctx context.Context, actor Actor, documentID string, in AcquireDocumentEditLockInput) (DocumentEditLockView, error) {
	if err := requireHumanEditLockActor(actor); err != nil {
		return DocumentEditLockView{}, err
	}
	if err := validEditorID(in.EditorID); err != nil {
		return DocumentEditLockView{}, err
	}
	if !validEditLockClient(in.Client) {
		return DocumentEditLockView{}, Invalid("client không hợp lệ")
	}
	cfg := s.EditLockConfig()
	var out DocumentEditLockView
	err := s.editLockMutation(ctx, actor, documentID, DocumentLevelEdit, func(q *db.Queries, doc db.Document, _ DocumentAccess, now time.Time, ops *editLockOps) error {
		if doc.ArchivedAt.Valid {
			return documentArchived()
		}
		live, err := s.lockLiveForUpdate(ctx, q, doc, now, ops)
		if err != nil {
			return err
		}
		expires := ts(now.Add(cfg.TTL))
		switch {
		case live == nil:
			return s.insertTenure(ctx, q, actor, doc, in.EditorID, in.Client, in.SessionID, documentEditGrantAcquire, "", now, ops, &out)
		case live.UserID != actor.ID:
			name, err := userDisplayName(ctx, q, live.UserID)
			if err != nil {
				return err
			}
			return errDocumentLocked(*live, name, false, doc.Revision)
		case live.EditorID == "":
			claimed, err := q.ClaimReservedDocumentEditLock(ctx, db.ClaimReservedDocumentEditLockParams{
				SessionID: in.SessionID, EditorID: in.EditorID, Client: in.Client, Now: ts(now), ExpiresAt: expires,
				ID: live.ID, OrganizationID: live.OrganizationID, UserID: actor.ID,
			})
			if err != nil {
				return err
			}
			if err := auditRecorder.Record(ctx, q, audit.Entry{
				OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Actor: actor,
				Action: audit.ActionDocumentEditLockAcquired, ResourceType: "document", ResourceID: doc.ID,
				Metadata: map[string]any{"lock_id": claimed.ID, "client": claimed.Client, "granted_via": claimed.GrantedVia,
					"previous_lock_id": textOrNil(claimed.PreviousLockID)},
			}, lockChangedEvent(doc)); err != nil {
				return err
			}
			out = s.editLockView(claimed, now, false)
			return nil
		case live.EditorID == in.EditorID:
			beat, err := q.HeartbeatDocumentEditLock(ctx, db.HeartbeatDocumentEditLockParams{
				TtlMs: cfg.TTL.Milliseconds(), ID: live.ID, OrganizationID: live.OrganizationID,
				DocumentID: doc.ID, UserID: actor.ID,
			})
			if err != nil {
				return err
			}
			out = s.editLockView(beat, now, false)
			return nil
		case in.MoveFromSelf:
			if _, err := endTenureRow(ctx, q, *live, DocumentEditEndMovedHere, actor, now); err != nil {
				return err
			}
			if err := s.insertTenure(ctx, q, actor, doc, in.EditorID, in.Client, in.SessionID, documentEditGrantMoveHere, live.ID, now, ops, &out); err != nil {
				return err
			}
			ops.lock("move_here")
			return nil
		default:
			name, err := userDisplayName(ctx, q, live.UserID)
			if err != nil {
				return err
			}
			return errDocumentLocked(*live, name, true, doc.Revision)
		}
	})
	if errors.Is(err, errEditLockRace) {
		return DocumentEditLockView{}, s.lockedAfterRace(ctx, actor, documentID)
	}
	return out, err
}

// insertTenure writes a new tenure with its document.edit_lock_acquired row
// and lock_changed frame (acquire, move here). Take-over writes its own.
func (s *DocumentService) insertTenure(
	ctx context.Context, q *db.Queries, actor Actor, doc db.Document,
	editorID, client, sessionID, via, previous string, now time.Time, ops *editLockOps, out *DocumentEditLockView,
) error {
	row, err := q.InsertDocumentEditLock(ctx, db.InsertDocumentEditLockParams{
		ID: util.NewID(), OrganizationID: doc.OrganizationID, DocumentID: doc.ID, UserID: actor.ID,
		SessionID: sessionID, EditorID: editorID, Client: client, BaseRevision: doc.Revision,
		AcquiredAt: ts(now), ExpiresAt: ts(now.Add(s.EditLockConfig().TTL)), GrantedVia: via,
		PreviousLockID: nullText(previous),
	})
	if isUniqueViolation(err) {
		return errEditLockRace
	}
	if err != nil {
		return err
	}
	meta := map[string]any{"lock_id": row.ID, "client": client, "granted_via": via}
	if previous != "" {
		meta["previous_lock_id"] = previous
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Actor: actor,
		Action: audit.ActionDocumentEditLockAcquired, ResourceType: "document", ResourceID: doc.ID,
		Metadata: meta,
	}, lockChangedEvent(doc)); err != nil {
		return err
	}
	if via == documentEditGrantAcquire {
		ops.lock("acquire")
	}
	*out = s.editLockView(row, now, true)
	return nil
}

// lockedAfterRace answers 423 with the tenure that won the unique index.
func (s *DocumentService) lockedAfterRace(ctx context.Context, actor Actor, documentID string) error {
	doc, err := s.q.GetDocumentByID(ctx, documentID)
	if err != nil {
		return err
	}
	live, err := s.q.GetLiveDocumentEditLock(ctx, db.GetLiveDocumentEditLockParams{
		OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
	})
	if err != nil {
		return err
	}
	name, err := userDisplayName(ctx, s.q, live.UserID)
	if err != nil {
		return err
	}
	return errDocumentLocked(live, name, live.UserID == actor.ID, doc.Revision)
}

// lostAnswer is edit_lock_lost for a tenure of the caller that is no longer
// live: the end reason (expired when it simply ran out) and, for a take-over
// or handover, who holds it now.
func (s *DocumentService) lostAnswer(ctx context.Context, q *db.Queries, lock db.DocumentEditLock) error {
	reason := DocumentEditEndExpired
	if lock.EndReason.Valid {
		reason = lock.EndReason.String
	}
	if reason != DocumentEditEndTakenOver && reason != DocumentEditEndHandedOver {
		return errEditLockLost(reason, "", "")
	}
	next, err := q.GetDocumentEditLockSuccessor(ctx, db.GetDocumentEditLockSuccessorParams{
		OrganizationID: lock.OrganizationID, PreviousLockID: pgtype.Text{String: lock.ID, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return errEditLockLost(reason, "", "")
	}
	if err != nil {
		return err
	}
	name, err := userDisplayName(ctx, q, next.UserID)
	if err != nil {
		return err
	}
	return errEditLockLost(reason, next.UserID, name)
}

// foreignLostAnswer is edit_lock_lost for an R3 that named a tenure of
// another account. A tenure that ended or ran out answers exactly as a lost
// tenure of the caller does. A live tenure has no end reason: the answer
// names taken_over or handed_over, with the live holder, only when the chain
// of previous_lock_id links shows this tenure replaced one of the caller's;
// a caller who never held the document gets no reason and no holder, so the
// client shows its generic dialog (contract §11) and the live holder stays
// private.
func (s *DocumentService) foreignLostAnswer(ctx context.Context, actor Actor, lock db.DocumentEditLock) error {
	now, err := editLockClock(ctx, s.q)
	if err != nil {
		return err
	}
	if !editLockLive(lock, now) {
		return s.lostAnswer(ctx, s.q, lock)
	}
	reason, err := s.replacedCallerReason(ctx, actor.ID, lock)
	if err != nil {
		return err
	}
	if reason == "" {
		return errEditLockLost("", "", "")
	}
	name, err := userDisplayName(ctx, s.q, lock.UserID)
	if err != nil {
		return err
	}
	return errEditLockLost(reason, lock.UserID, name)
}

// editLockPredecessorWalkMax bounds the previous_lock_id walk: a tenure chain
// is a short history of take-overs and handovers, not a graph to traverse
// without end.
const editLockPredecessorWalkMax = 8

// replacedCallerReason follows the chain of tenures that leads to lock and
// returns the end reason of the caller's own tenure in it (taken_over or
// handed_over). An empty reason means the chain does not show the tenure
// replaced one of the caller's.
func (s *DocumentService) replacedCallerReason(ctx context.Context, actorID string, lock db.DocumentEditLock) (string, error) {
	prev := lock.PreviousLockID
	for hops := 0; prev.Valid && hops < editLockPredecessorWalkMax; hops++ {
		row, err := s.q.GetDocumentEditLock(ctx, db.GetDocumentEditLockParams{
			ID: prev.String, OrganizationID: lock.OrganizationID, DocumentID: lock.DocumentID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		if err != nil {
			return "", err
		}
		if row.UserID == actorID {
			if row.EndReason.Valid && (row.EndReason.String == DocumentEditEndTakenOver || row.EndReason.String == DocumentEditEndHandedOver) {
				return row.EndReason.String, nil
			}
			return "", nil
		}
		prev = row.PreviousLockID
	}
	return "", nil
}

// HeartbeatDocumentEditLock is R3. The level is recomputed every call (edge
// 3): a caller the document gate now refuses, or who fell below edit, loses
// the tenure (access_lost, or the closed tenant's own reason) and gets the
// gate's answer. The heartbeat itself does not take the document lock; a
// tenure ended by a take-over in between updates nothing and answers 409.
func (s *DocumentService) HeartbeatDocumentEditLock(ctx context.Context, actor Actor, documentID, lockID string) (DocumentEditHeartbeat, error) {
	if !validActor(actor) || documentID == "" || lockID == "" {
		return DocumentEditHeartbeat{}, ErrNotFound
	}
	doc, err := s.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentEditHeartbeat{}, ErrNotFound
	}
	if err != nil {
		return DocumentEditHeartbeat{}, err
	}
	access, gateErr := s.effectiveLevel(ctx, s.q, actor, doc)
	if gateErr == nil {
		gateErr = decideDocumentAccess(doc, access, DocumentLevelEdit)
	}
	if gateErr != nil {
		if !isGateRefusal(gateErr) {
			return DocumentEditHeartbeat{}, gateErr
		}
		if err := s.endOnAccessLoss(ctx, actor, documentID, lockID, gateErr); err != nil {
			return DocumentEditHeartbeat{}, err
		}
		return DocumentEditHeartbeat{}, gateErr
	}
	// ARCHIVE-01 (UNI-1845 §3): a heartbeat renews the tenure, a write on
	// the document, so a shelved item refuses it - after the access gate, so
	// a caller who may not see the row still gets the gate's answer. The
	// tenure is left live: shelving does not release locks (S-4 is an open
	// TODO), so it ends by TTL/hold-cap or an explicit release, never here.
	// This is the one lock command outside withDocumentMutation (the
	// heartbeat takes no document row lock, §2), so the gate has to say it.
	if err := requireNotShelved(doc); err != nil {
		return DocumentEditHeartbeat{}, err
	}
	lock, err := s.q.GetDocumentEditLock(ctx, db.GetDocumentEditLockParams{
		ID: lockID, OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentEditHeartbeat{}, ErrNotFound
	}
	if err != nil {
		return DocumentEditHeartbeat{}, err
	}
	if lock.UserID != actor.ID {
		// Not the caller's tenure (contract §3 R3): lost, never 404, so a
		// stale editor of another account learns the same as a stale holder.
		return DocumentEditHeartbeat{}, s.foreignLostAnswer(ctx, actor, lock)
	}
	beat, err := s.q.HeartbeatDocumentEditLock(ctx, db.HeartbeatDocumentEditLockParams{
		TtlMs: s.EditLockConfig().TTL.Milliseconds(), ID: lock.ID, OrganizationID: lock.OrganizationID,
		DocumentID: doc.ID, UserID: actor.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		cur, err := s.q.GetDocumentEditLock(ctx, db.GetDocumentEditLockParams{
			ID: lockID, OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
		})
		if err != nil {
			return DocumentEditHeartbeat{}, err
		}
		return DocumentEditHeartbeat{}, s.lostAnswer(ctx, s.q, cur)
	}
	if err != nil {
		return DocumentEditHeartbeat{}, err
	}
	return DocumentEditHeartbeat{
		LockID: beat.ID, ExpiresAt: beat.ExpiresAt.Time, OfflineHoldUntil: editLockTimePtr(beat.OfflineHoldUntil),
		ServerTime: beat.HeartbeatAt.Time,
	}, nil
}

// editLockEndReasonForGate names the end of a tenure whose holder the
// document gate refused.
func editLockEndReasonForGate(err error) string {
	switch {
	case errors.Is(err, ErrMemberDeactivated):
		return DocumentEditEndMemberDeactivated
	case errors.Is(err, ErrOrganizationSuspended):
		return DocumentEditEndOrganizationSuspended
	default:
		return DocumentEditEndAccessLost
	}
}

// endOnAccessLoss ends the caller's live tenure lockID after the gate refused
// them, in its own transaction under the document lock. A tenure that is not
// theirs, not this document's or already ended is left alone.
func (s *DocumentService) endOnAccessLoss(ctx context.Context, actor Actor, documentID, lockID string, gateErr error) error {
	ops := &editLockOps{}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	doc, err := q.LockDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	live, err := q.LockLiveDocumentEditLock(ctx, db.LockLiveDocumentEditLockParams{
		OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if live.ID != lockID || live.UserID != actor.ID {
		return nil
	}
	now, err := editLockClock(ctx, q)
	if err != nil {
		return err
	}
	if _, err := s.releaseTenure(ctx, q, doc, live, editLockEndReasonForGate(gateErr), documentEditLockSystem, now, ops); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.flushEditLockOps(ops)
	return nil
}

// ReleaseDocumentEditLock is R4: idempotent; a tenure that is not on this
// document or not the caller's is not found, the two cases alike. It is the
// one lock command §3 keeps allowed on a shelved document
// (editLockMutationOnShelved): releasing only frees the document, so a shelf
// that leaves a tenure live (S-4) still lets the holder drop it.
func (s *DocumentService) ReleaseDocumentEditLock(ctx context.Context, actor Actor, documentID, lockID string) error {
	if lockID == "" {
		return ErrNotFound
	}
	return s.editLockMutationOnShelved(ctx, actor, documentID, DocumentLevelView, func(q *db.Queries, doc db.Document, _ DocumentAccess, now time.Time, ops *editLockOps) error {
		lock, err := q.GetDocumentEditLock(ctx, db.GetDocumentEditLockParams{
			ID: lockID, OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
		})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && (actor.Kind != audit.KindHuman || lock.UserID != actor.ID)) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if lock.EndedAt.Valid {
			return nil
		}
		reason := DocumentEditEndReleased
		by := actor
		if !editLockLive(lock, now) {
			reason, by = DocumentEditEndExpired, documentEditLockSystem
		}
		_, err = s.releaseTenure(ctx, q, doc, lock, reason, by, now, ops)
		return err
	})
}

// TakeOverDocumentEditLock is R5 (D3): a manager takes the document from its
// holder, even one holding it offline. The confirmation names the tenure it
// saw (expected_lock_id); a different live tenure is edit_lock_changed.
func (s *DocumentService) TakeOverDocumentEditLock(ctx context.Context, actor Actor, documentID string, in TakeOverDocumentEditLockInput) (DocumentEditLockView, error) {
	if err := requireHumanEditLockActor(actor); err != nil {
		return DocumentEditLockView{}, err
	}
	if err := validEditorID(in.EditorID); err != nil {
		return DocumentEditLockView{}, err
	}
	if !validEditLockClient(in.Client) {
		return DocumentEditLockView{}, Invalid("client không hợp lệ")
	}
	var out DocumentEditLockView
	err := s.editLockMutation(ctx, actor, documentID, DocumentLevelManage, func(q *db.Queries, doc db.Document, _ DocumentAccess, now time.Time, ops *editLockOps) error {
		if doc.ArchivedAt.Valid {
			return documentArchived()
		}
		live, err := s.lockLiveForUpdate(ctx, q, doc, now, ops)
		if err != nil {
			return err
		}
		switch {
		case live == nil:
			return errEditLockFree()
		case live.UserID == actor.ID:
			return errEditLockHeldByMe()
		case live.ID != in.ExpectedLockID:
			return errEditLockChanged()
		}
		if _, err := endTenureRow(ctx, q, *live, DocumentEditEndTakenOver, actor, now); err != nil {
			return err
		}
		row, err := q.InsertDocumentEditLock(ctx, db.InsertDocumentEditLockParams{
			ID: util.NewID(), OrganizationID: doc.OrganizationID, DocumentID: doc.ID, UserID: actor.ID,
			SessionID: in.SessionID, EditorID: in.EditorID, Client: in.Client, BaseRevision: doc.Revision,
			AcquiredAt: ts(now), ExpiresAt: ts(now.Add(s.EditLockConfig().TTL)), GrantedVia: documentEditGrantTakeOver,
			PreviousLockID: pgtype.Text{String: live.ID, Valid: true},
		})
		if isUniqueViolation(err) {
			return errEditLockRace
		}
		if err != nil {
			return err
		}
		heldOffline := live.OfflineHoldUntil.Valid && live.OfflineHoldUntil.Time.After(now)
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Actor: actor,
			Action: audit.ActionDocumentEditLockTakenOver, ResourceType: "document", ResourceID: doc.ID,
			Metadata: map[string]any{"lock_id": row.ID, "previous_lock_id": live.ID,
				"previous_holder_id": live.UserID, "previous_offline_hold": heldOffline},
		}, lockChangedEvent(doc), audit.Event{Topic: topicDocumentLockTakenOver, Payload: map[string]string{
			"document_id": doc.ID, "workspace_id": doc.WorkspaceID, "user_id": live.UserID,
		}}); err != nil {
			return err
		}
		ops.lock("take_over")
		out = s.editLockView(row, now, true)
		return nil
	})
	if errors.Is(err, errEditLockRace) {
		return DocumentEditLockView{}, s.lockedAfterRace(ctx, actor, documentID)
	}
	return out, err
}

// callerTenure finds {lockID} under the document for the hold commands: not
// on this document or not the caller's is not found (as R4); the caller's
// tenure that is no longer live is edit_lock_lost.
func (s *DocumentService) callerTenure(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, lockID string, now time.Time) (db.DocumentEditLock, error) {
	lock, err := q.GetDocumentEditLock(ctx, db.GetDocumentEditLockParams{
		ID: lockID, OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DocumentEditLock{}, ErrNotFound
	}
	if err != nil {
		return db.DocumentEditLock{}, err
	}
	if lock.UserID != actor.ID {
		return db.DocumentEditLock{}, ErrNotFound
	}
	if !editLockLive(lock, now) || lock.EditorID == "" {
		return db.DocumentEditLock{}, s.lostAnswer(ctx, q, lock)
	}
	return lock, nil
}

// PutDocumentEditHold is R6 (D1): start or renew the offline hold of the
// caller's tenure from a live desktop device session. One hold ends at
// min(now + HOLD_MAX, chain start + HOLD_CHAIN_MAX, device expiry); a
// renewal that cannot extend it, or a chain already at its cap, is
// edit_hold_cap_reached.
func (s *DocumentService) PutDocumentEditHold(ctx context.Context, actor Actor, documentID, lockID, sessionID string) (DocumentEditLockView, error) {
	if err := requireHumanEditLockActor(actor); err != nil {
		return DocumentEditLockView{}, err
	}
	cfg := s.EditLockConfig()
	var out DocumentEditLockView
	err := s.editLockMutation(ctx, actor, documentID, DocumentLevelEdit, func(q *db.Queries, doc db.Document, _ DocumentAccess, now time.Time, _ *editLockOps) error {
		if doc.ArchivedAt.Valid {
			return documentArchived()
		}
		lock, err := s.callerTenure(ctx, q, actor, doc, lockID, now)
		if err != nil {
			return err
		}
		device, err := liveEditHoldDevice(ctx, q, actor.ID, sessionID, now)
		if err != nil {
			return err
		}
		chainStart := now
		if lock.HoldChainStartedAt.Valid {
			chainStart = lock.HoldChainStartedAt.Time
		}
		capEnd := chainStart.Add(cfg.HoldChainMax)
		if !capEnd.After(now) {
			return errEditHoldCapReached()
		}
		end := now.Add(cfg.HoldMax)
		if capEnd.Before(end) {
			end = capEnd
		}
		if device.ExpiresAt.Time.Before(end) {
			end = device.ExpiresAt.Time
		}
		holding := lock.OfflineHoldUntil.Valid && lock.OfflineHoldUntil.Time.After(now)
		if holding && !end.After(lock.OfflineHoldUntil.Time) {
			return errEditHoldCapReached()
		}
		renewals := lock.HoldRenewals
		action := audit.ActionDocumentEditHoldStarted
		if holding {
			renewals++
			action = audit.ActionDocumentEditHoldRenewed
		}
		row, err := q.SetDocumentEditHold(ctx, db.SetDocumentEditHoldParams{
			OfflineHoldUntil: ts(end), HoldDeviceSessionID: pgtype.Text{String: device.ID, Valid: true},
			HoldChainStartedAt: ts(chainStart), HoldRenewals: renewals, Now: ts(now), ExpiresAt: ts(now.Add(cfg.TTL)),
			ID: lock.ID, OrganizationID: lock.OrganizationID,
		})
		if err != nil {
			return err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Actor: actor,
			Action: action, ResourceType: "document", ResourceID: doc.ID,
			Metadata: map[string]any{"lock_id": row.ID, "hold_until": rfc3339(row.OfflineHoldUntil), "hold_renewals": row.HoldRenewals},
		}, lockChangedEvent(doc)); err != nil {
			return err
		}
		out = s.editLockView(row, now, false)
		return nil
	})
	return out, err
}

// liveEditHoldDevice is the R6 device check: the bearer's sid must name a
// live device_sessions row of the caller; a browser session (no row) or a
// revoked/expired one is edit_hold_device_required.
func liveEditHoldDevice(ctx context.Context, q *db.Queries, userID, sid string, now time.Time) (db.DeviceSession, error) {
	if sid == "" {
		return db.DeviceSession{}, errEditHoldDeviceRequired()
	}
	device, err := q.GetDeviceSession(ctx, sid)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DeviceSession{}, errEditHoldDeviceRequired()
	}
	if err != nil {
		return db.DeviceSession{}, err
	}
	if device.UserID != userID || device.RevokedAt.Valid || !device.ExpiresAt.Valid || !device.ExpiresAt.Time.After(now) {
		return db.DeviceSession{}, errEditHoldDeviceRequired()
	}
	return device, nil
}

// ClearDocumentEditHold is R7: drop the hold and go back to the heartbeat
// TTL. Idempotent: a tenure with no hold answers 200 and writes nothing.
func (s *DocumentService) ClearDocumentEditHold(ctx context.Context, actor Actor, documentID, lockID string) (DocumentEditLockView, error) {
	if err := requireHumanEditLockActor(actor); err != nil {
		return DocumentEditLockView{}, err
	}
	var out DocumentEditLockView
	err := s.editLockMutation(ctx, actor, documentID, DocumentLevelEdit, func(q *db.Queries, doc db.Document, _ DocumentAccess, now time.Time, _ *editLockOps) error {
		lock, err := s.callerTenure(ctx, q, actor, doc, lockID, now)
		if err != nil {
			return err
		}
		if !lock.OfflineHoldUntil.Valid {
			out = s.editLockView(lock, now, false)
			return nil
		}
		row, err := q.ClearDocumentEditHold(ctx, db.ClearDocumentEditHoldParams{
			Now: ts(now), ExpiresAt: ts(now.Add(s.EditLockConfig().TTL)), ID: lock.ID, OrganizationID: lock.OrganizationID,
		})
		if err != nil {
			return err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Actor: actor,
			Action: audit.ActionDocumentEditHoldEnded, ResourceType: "document", ResourceID: doc.ID,
			Metadata: map[string]any{"lock_id": row.ID, "hold_until": rfc3339(lock.OfflineHoldUntil), "hold_renewals": row.HoldRenewals},
		}, lockChangedEvent(doc)); err != nil {
			return err
		}
		out = s.editLockView(row, now, false)
		return nil
	})
	return out, err
}
