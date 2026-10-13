package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// Office offline lease (G5-08s, UNI-1350; decision G5-D1, DOC-005 §6.2):
// PUT/DELETE /documents/{documentID}/office/offline-lease.
const (
	// OfficeLeaseTTL is the longest a lease lives (G5-D1 row 1); a lease
	// never outlives its device session either.
	OfficeLeaseTTL = 24 * time.Hour
	// OfficeLeaseDeviceCap is the most live leases one device holds (G5-D1
	// row 11), the same 200 as the app's pin limit.
	OfficeLeaseDeviceCap = 200
)

// The lease codes (G5-D1 row 15, error_class.go). offline_lease_revoked is a
// permission refusal: the row is revoked, from an older policy epoch, gone or
// the token does not verify. The others are unclassified. The server never
// emits offline_lease_expired: an online renewal re-checks live access, so a
// lease past its expiry renews like any other (the name stays an app-side
// reason).
var (
	ErrOfficeLeaseRevoked        = errors.New("offline_lease_revoked")
	ErrOfficeLeaseDeviceRequired = errors.New("offline_lease_device_required")
	ErrOfficeLeaseLimitReached   = errors.New("offline_lease_limit_reached")
	ErrDocumentArchived          = errors.New("document_archived")
)

func officeLeaseRevoked() error {
	return CodedError{Code: "offline_lease_revoked", Status: http.StatusForbidden, Msg: "this offline lease is no longer valid", Err: ErrOfficeLeaseRevoked}
}

func officeLeaseDeviceRequired() error {
	return CodedError{Code: "offline_lease_device_required", Status: http.StatusForbidden, Msg: "an offline lease needs a signed-in desktop device", Err: ErrOfficeLeaseDeviceRequired}
}

func officeLeaseLimitReached() error {
	return CodedError{
		Code: "offline_lease_limit_reached", Status: http.StatusConflict, Msg: "this device holds the most offline documents it may",
		Err: ErrOfficeLeaseLimitReached, Fields: map[string]any{"limit": OfficeLeaseDeviceCap},
	}
}

// documentArchived answers a renewal of a lease the caller holds on a
// document that went to the trash (G5-D1 row 14): the app keeps its copy to
// the lease's expiry instead of reading a not-found as lost access. Only a
// holder of a live lease row, or a manager who can see the archived document
// anyway, ever gets it, so it reveals nothing.
func documentArchived() error {
	return CodedError{Code: "document_archived", Status: http.StatusForbidden, Msg: "this document is archived", Err: ErrDocumentArchived}
}

// Lease levels: manage reads as edit offline (G5-D1 row 3).
const (
	officeLeaseLevelView = "view"
	officeLeaseLevelEdit = "edit"
)

// The lease audit + outbox resource type and topics (G5-D1 row 16).
const (
	officeLeaseResource      = "office_offline_lease"
	officeLeaseTopicGranted  = "office_lease.granted"
	officeLeaseTopicRenewed  = "office_lease.renewed"
	officeLeaseTopicReleased = "office_lease.released"
	officeLeaseTopicRevoked  = "office_lease.revoked"
)

// The closed set of lease revoke reasons (G5-D1 row 16); the table's CHECK
// holds the same list.
const (
	OfficeLeaseRevokeDeviceRevoked     = "device_revoked"
	OfficeLeaseRevokeSessionRevoked    = "session_revoked"
	OfficeLeaseRevokeMemberDeactivated = "member_deactivated"
	OfficeLeaseRevokeMemberRemoved     = "member_removed"
	OfficeLeaseRevokeShareRevoked      = "share_revoked"
	OfficeLeaseRevokeDocumentDeleted   = "document_deleted"
	OfficeLeaseRevokeDocumentMoved     = "document_moved"
	OfficeLeaseRevokePolicyEpoch       = "policy_epoch"
	OfficeLeaseRevokeAdmin             = "admin"
)

// The closed set of blocked-lease reasons (G5-D1 row 17).
const (
	officeLeaseBlockedDevice    = "device"
	officeLeaseBlockedACL       = "acl"
	officeLeaseBlockedEpoch     = "epoch"
	officeLeaseBlockedRevoked   = "revoked"
	officeLeaseBlockedFlagOff   = "flag_off"
	officeLeaseBlockedLimit     = "limit"
	officeLeaseBlockedArchived  = "archived"
	officeLeaseBlockedSignature = "signature"
)

// OfficeLeaseMetrics receives the lease counters (G5-D1 row 17). Labels are
// closed sets; no organization, user or document ever becomes a label.
type OfficeLeaseMetrics interface {
	ObserveOfficeLease(op string)
	ObserveOfficeLeaseBlocked(reason string)
	ObserveOfficeLeasesRevoked(reason string, n int)
	ObserveOfficeLeaseSweep(n int64)
}

// officeLeaseMetrics is set once by main.go (SetOfficeLeaseMetrics): the
// revoke paths run inside other services' transactions (logout, session
// revoke, the outbox consumer), so the counter is package level like the
// audit counter.
var officeLeaseMetrics OfficeLeaseMetrics

// SetOfficeLeaseMetrics attaches the lease counters; nil detaches them.
func SetOfficeLeaseMetrics(m OfficeLeaseMetrics) { officeLeaseMetrics = m }

// OfficeLeaseService grants, renews and releases offline leases. Access is a
// DocumentService decision (effectiveLevel); the device is read from its own
// device_sessions row, never from CheckDeviceSession, which lets an unknown
// sid through as a browser session (G5-D1 row 5).
type OfficeLeaseService struct {
	docs        *DocumentService
	flags       *featureflag.Service
	codec       officeLeaseCodec
	deployments map[string]struct{}
	ttl         time.Duration
	now         func() time.Time
}

// NewOfficeLeaseService signs leases with a key derived from JWT_SECRET under
// its own label. The deployments a device may belong to are the desktop
// allowlist (DESKTOP_AUTH_DEPLOYMENT_IDS, "default" when empty).
func NewOfficeLeaseService(docs *DocumentService, flags *featureflag.Service, cfg config.Config) *OfficeLeaseService {
	if docs == nil || cfg.JWTSecret == "" {
		return nil
	}
	deployments := map[string]struct{}{}
	for _, id := range cfg.DesktopAuthDeploymentIDs {
		if id = strings.TrimSpace(id); id != "" {
			deployments[id] = struct{}{}
		}
	}
	if len(deployments) == 0 {
		deployments["default"] = struct{}{}
	}
	return &OfficeLeaseService{
		docs: docs, flags: flags, codec: newOfficeLeaseCodec(cfg.JWTSecret),
		deployments: deployments, ttl: OfficeLeaseTTL, now: time.Now,
	}
}

// SetClock replaces the clock (tests).
func (s *OfficeLeaseService) SetClock(now func() time.Time) {
	if now == nil {
		now = time.Now
	}
	s.now = now
}

// OfficeLeasePutInput is one grant or renewal. DeviceSessionID is the sid of
// the bearer, never a body field. Lease is the signed lease the app holds;
// empty asks for a fresh grant.
type OfficeLeasePutInput struct {
	DocumentID      string
	DeviceSessionID string
	Lease           string
}

// OfficeLease is a granted or renewed lease: the signed token plus the plain
// values the app shows (G5-D1 row 3). ServerTime is the clock the app pins
// its monotonic expiry to (G5-D1 row 13).
type OfficeLease struct {
	Token          string
	LeaseID        string
	DocumentID     string
	OrganizationID string
	WorkspaceID    string
	VersionID      string
	Version        int32
	Revision       int64
	Level          string
	PolicyEpoch    int64
	Generation     int32
	IssuedAt       time.Time
	ExpiresAt      time.Time
	RenewAfter     time.Time
	ServerTime     time.Time
	Renewed        bool
}

// blocked counts one refusal and returns err.
func officeLeaseBlocked(reason string, err error) error {
	if officeLeaseMetrics != nil {
		officeLeaseMetrics.ObserveOfficeLeaseBlocked(reason)
	}
	return err
}

// Put grants or renews the caller device's lease on one document (G5-D1 rows
// 1-5, 8, 9, 11, 12, 14, 19). Both run every check a grant runs, in one
// transaction that holds the device row and a share lock on the document:
//
//  1. the bearer's sid names a live device_sessions row of this user on an
//     allowed deployment (a browser session has none: device_required);
//  2. the document exists, is a file and the caller reads it (the gate's own
//     refusal - not found, member_deactivated, organization_suspended);
//  3. office_offline_library is on for the organization;
//  4. a renewal presents a token that verifies and names this caller's live
//     row of the current policy epoch; anything else is offline_lease_revoked;
//  5. an archived document is never granted or renewed;
//  6. a fresh grant stays under the device cap.
//
// A renewal rewrites the row in place (same id, generation + 1) and re-binds
// the document's head version; a fresh grant replaces a dead row under a new
// id. PUT without a token while the device holds a live row of the current
// epoch renews that row: the route is idempotent per device.
func (s *OfficeLeaseService) Put(ctx context.Context, actor Actor, in OfficeLeasePutInput) (OfficeLease, error) {
	if s == nil || s.docs == nil {
		return OfficeLease{}, errors.New("office lease service is not configured")
	}
	if !validActor(actor) || actor.Kind != audit.KindHuman || in.DocumentID == "" {
		return OfficeLease{}, ErrNotFound
	}
	now := s.now()
	tx, err := s.docs.pool.Begin(ctx)
	if err != nil {
		return OfficeLease{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.docs.q.WithTx(tx)

	device, err := s.liveDevice(ctx, q, actor.ID, in.DeviceSessionID, now)
	if err != nil {
		return OfficeLease{}, err
	}
	doc, access, err := s.readableFile(ctx, q, actor, in.DocumentID)
	if err != nil {
		return OfficeLease{}, err
	}
	if !s.enabled(ctx, actor.ID, doc.OrganizationID) {
		return OfficeLease{}, officeLeaseBlocked(officeLeaseBlockedFlagOff, officeCapabilityOff("offline_library"))
	}
	epoch, err := q.GetOfficeOfflinePolicyEpoch(ctx, doc.OrganizationID)
	if err != nil {
		return OfficeLease{}, err
	}
	existing, err := q.GetOfficeOfflineLeaseForDeviceDocument(ctx, db.GetOfficeOfflineLeaseForDeviceDocumentParams{
		OrganizationID: doc.OrganizationID, DeviceSessionID: device.ID, DocumentID: doc.ID,
	})
	hasRow := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return OfficeLease{}, err
	}
	renewing := false
	if in.Lease != "" {
		if err := s.checkRenewal(in.Lease, actor.ID, device.ID, doc, existing, hasRow, epoch); err != nil {
			return OfficeLease{}, err
		}
		renewing = true
	} else if hasRow && !existing.RevokedAt.Valid && now.Before(existing.ExpiresAt.Time) && existing.PolicyEpoch == epoch {
		renewing = true
	}
	if doc.ArchivedAt.Valid {
		if renewing || access.Level.AtLeast(DocumentLevelManage) {
			return OfficeLease{}, officeLeaseBlocked(officeLeaseBlockedArchived, documentArchived())
		}
		return OfficeLease{}, officeLeaseBlocked(officeLeaseBlockedACL, ErrNotFound)
	}
	if !renewing {
		live, err := q.CountLiveOfficeOfflineLeasesForDevice(ctx, db.CountLiveOfficeOfflineLeasesForDeviceParams{
			UserID: actor.ID, DeviceSessionID: device.ID, DocumentID: doc.ID, Now: pgtype.Timestamptz{Time: now, Valid: true},
		})
		if err != nil {
			return OfficeLease{}, err
		}
		if live >= OfficeLeaseDeviceCap {
			return OfficeLease{}, officeLeaseBlocked(officeLeaseBlockedLimit, officeLeaseLimitReached())
		}
	}

	versionID, err := s.headVersionID(ctx, q, doc)
	if err != nil {
		return OfficeLease{}, err
	}
	level := officeLeaseLevelView
	if access.Level.AtLeast(DocumentLevelEdit) {
		level = officeLeaseLevelEdit
	}
	expires := now.Add(s.ttl)
	if device.ExpiresAt.Time.Before(expires) {
		expires = device.ExpiresAt.Time
	}
	issued := pgtype.Timestamptz{Time: now, Valid: true}
	until := pgtype.Timestamptz{Time: expires, Valid: true}
	var row db.OfficeOfflineLease
	action, topic, op := audit.ActionOfficeOfflineLeaseGranted, officeLeaseTopicGranted, "grant"
	if renewing {
		action, topic, op = audit.ActionOfficeOfflineLeaseRenewed, officeLeaseTopicRenewed, "renew"
		row, err = q.RenewOfficeOfflineLease(ctx, db.RenewOfficeOfflineLeaseParams{
			ID: existing.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			DeploymentID: device.DeploymentID, VersionID: versionID, Version: doc.CurrentVersion,
			Revision: doc.Revision, Level: level, PolicyEpoch: epoch, IssuedAt: issued, ExpiresAt: until,
		})
	} else {
		if hasRow {
			if _, err := q.DeleteOfficeOfflineLease(ctx, db.DeleteOfficeOfflineLeaseParams{ID: existing.ID, OrganizationID: doc.OrganizationID}); err != nil {
				return OfficeLease{}, err
			}
		}
		row, err = q.InsertOfficeOfflineLease(ctx, db.InsertOfficeOfflineLeaseParams{
			ID: util.NewID(), OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
			UserID: actor.ID, DeviceSessionID: device.ID, DeploymentID: device.DeploymentID,
			VersionID: versionID, Version: doc.CurrentVersion, Revision: doc.Revision, Level: level,
			PolicyEpoch: epoch, IssuedAt: issued, ExpiresAt: until,
			CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
		})
	}
	if err != nil {
		return OfficeLease{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID, Actor: actor,
		Action: action, ResourceType: officeLeaseResource, ResourceID: row.ID,
		Metadata: map[string]any{
			"document_id": row.DocumentID, "device_session_id": row.DeviceSessionID, "level": row.Level,
			"generation": row.Generation, "policy_epoch": row.PolicyEpoch, "version": row.Version,
		},
	}, officeLeaseEvent(topic, row.UserID, row.DocumentID, row.ID)); err != nil {
		return OfficeLease{}, err
	}
	out, err := s.issue(row, now)
	if err != nil {
		return OfficeLease{}, err
	}
	out.Renewed = renewing
	if err := tx.Commit(ctx); err != nil {
		return OfficeLease{}, err
	}
	if officeLeaseMetrics != nil {
		officeLeaseMetrics.ObserveOfficeLease(op)
	}
	return out, nil
}

// liveDevice reads the bearer's device row under lock. No row (a browser
// session, or no sid at all) is device_required; a row of another user, a
// deployment outside the allowlist, revoked or expired is device_revoked,
// the session layer's own answer.
func (s *OfficeLeaseService) liveDevice(ctx context.Context, q *db.Queries, userID, sid string, now time.Time) (db.DeviceSession, error) {
	if sid == "" {
		return db.DeviceSession{}, officeLeaseBlocked(officeLeaseBlockedDevice, officeLeaseDeviceRequired())
	}
	device, err := q.GetDeviceSessionForUpdate(ctx, sid)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DeviceSession{}, officeLeaseBlocked(officeLeaseBlockedDevice, officeLeaseDeviceRequired())
	}
	if err != nil {
		return db.DeviceSession{}, err
	}
	_, allowed := s.deployments[device.DeploymentID]
	if device.UserID != userID || !allowed || device.RevokedAt.Valid || !device.ExpiresAt.Valid || !device.ExpiresAt.Time.After(now) {
		return db.DeviceSession{}, officeLeaseBlocked(officeLeaseBlockedDevice, desktopDeviceRevoked())
	}
	return device, nil
}

// readableFile locks the document row for share and computes the caller's
// level. Archived documents keep their level here; Put decides on them.
func (s *OfficeLeaseService) readableFile(ctx context.Context, q *db.Queries, actor Actor, documentID string) (db.Document, DocumentAccess, error) {
	doc, err := q.LockOfficeLeaseDocument(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Document{}, DocumentAccess{}, officeLeaseBlocked(officeLeaseBlockedACL, ErrNotFound)
	}
	if err != nil {
		return db.Document{}, DocumentAccess{}, err
	}
	access, err := s.docs.effectiveLevel(ctx, q, actor, doc)
	if err != nil {
		if isGateRefusal(err) {
			return db.Document{}, DocumentAccess{}, officeLeaseBlocked(officeLeaseBlockedACL, err)
		}
		return db.Document{}, DocumentAccess{}, err
	}
	if access.Level == DocumentLevelNone {
		return db.Document{}, DocumentAccess{}, officeLeaseBlocked(officeLeaseBlockedACL, ErrNotFound)
	}
	// Offline reading is for file documents (the desktop library); a page
	// or folder has no snapshot to hold, and answers like a missing file.
	if doc.Kind != DocumentKindFile {
		return db.Document{}, DocumentAccess{}, officeLeaseBlocked(officeLeaseBlockedACL, ErrNotFound)
	}
	return doc, access, nil
}

// checkRenewal holds a renewal to the stored row: the token must verify under
// the current key, name this caller, device, document and organization, and
// match the live row of the current policy epoch. The claims only pick the
// row; nothing else in them is used.
func (s *OfficeLeaseService) checkRenewal(token, userID, deviceID string, doc db.Document, row db.OfficeOfflineLease, hasRow bool, epoch int64) error {
	claims, ok := s.codec.verify(token)
	if !ok {
		return officeLeaseBlocked(officeLeaseBlockedSignature, officeLeaseRevoked())
	}
	if claims.UserID != userID || claims.DeviceSessionID != deviceID || claims.DocumentID != doc.ID || claims.OrganizationID != doc.OrganizationID {
		return officeLeaseBlocked(officeLeaseBlockedRevoked, officeLeaseRevoked())
	}
	if !hasRow || row.ID != claims.LeaseID || row.RevokedAt.Valid || row.UserID != userID {
		return officeLeaseBlocked(officeLeaseBlockedRevoked, officeLeaseRevoked())
	}
	if row.PolicyEpoch != epoch {
		return officeLeaseBlocked(officeLeaseBlockedEpoch, officeLeaseRevoked())
	}
	return nil
}

// headVersionID is the id of the document's current version row: the
// snapshot the lease covers (G5-D1 row 19). The app renews after it has
// downloaded a new head, which re-binds the lease to it.
func (s *OfficeLeaseService) headVersionID(ctx context.Context, q *db.Queries, doc db.Document) (string, error) {
	if doc.CurrentVersion <= 0 {
		return "", nil
	}
	v, err := q.GetDocumentVersion(ctx, db.GetDocumentVersionParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID, Version: doc.CurrentVersion,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return v.ID, nil
}

// issue signs the row. Every claim comes from the row.
func (s *OfficeLeaseService) issue(row db.OfficeOfflineLease, now time.Time) (OfficeLease, error) {
	claims := officeLeaseClaims{
		V: officeLeaseTokenVersion, KeyID: officeLeaseKeyID, LeaseID: row.ID, Generation: row.Generation,
		UserID: row.UserID, DeviceSessionID: row.DeviceSessionID, DeploymentID: row.DeploymentID,
		OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID, DocumentID: row.DocumentID,
		VersionID: row.VersionID, Version: row.Version, Revision: strconv.FormatInt(row.Revision, 10),
		Level: row.Level, PolicyEpoch: row.PolicyEpoch,
		IssuedAt: row.IssuedAt.Time.Unix(), ExpiresAt: row.ExpiresAt.Time.Unix(),
	}
	token, err := s.codec.sign(claims)
	if err != nil {
		return OfficeLease{}, fmt.Errorf("sign office lease: %w", err)
	}
	issued, expires := row.IssuedAt.Time, row.ExpiresAt.Time
	return OfficeLease{
		Token: token, LeaseID: row.ID, DocumentID: row.DocumentID, OrganizationID: row.OrganizationID,
		WorkspaceID: row.WorkspaceID, VersionID: row.VersionID, Version: row.Version, Revision: row.Revision,
		Level: row.Level, PolicyEpoch: row.PolicyEpoch, Generation: row.Generation,
		IssuedAt: issued, ExpiresAt: expires, RenewAfter: issued.Add(expires.Sub(issued) / 2), ServerTime: now,
	}, nil
}

func (s *OfficeLeaseService) enabled(ctx context.Context, userID, orgID string) bool {
	def := false
	if f, ok := featureflags.Lookup(officeOfflineLibraryFlag); ok {
		def = f.Default
	}
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: userID, OrganizationID: orgID})
	return s.flags.IsEnabled(ctx, officeOfflineLibraryFlag, def)
}

// Release returns the caller device's lease on one document (DELETE). It
// works with the flag off and on a document the caller can no longer read or
// that is gone (G5-D1 row 12): the row is the caller's own. With no row, a
// readable document answers success (nothing to release) and any other id is
// not found, so the route never confirms a document the caller cannot read.
func (s *OfficeLeaseService) Release(ctx context.Context, actor Actor, documentID, deviceSessionID string) error {
	if s == nil || s.docs == nil {
		return errors.New("office lease service is not configured")
	}
	if !validActor(actor) || actor.Kind != audit.KindHuman || documentID == "" {
		return ErrNotFound
	}
	if deviceSessionID == "" {
		return officeLeaseDeviceRequired()
	}
	tx, err := s.docs.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.docs.q.WithTx(tx)
	device, err := q.GetDeviceSessionForUpdate(ctx, deviceSessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return officeLeaseDeviceRequired()
	}
	if err != nil {
		return err
	}
	if device.UserID != actor.ID {
		return desktopDeviceRevoked()
	}
	row, err := q.GetOfficeOfflineLeaseForRelease(ctx, db.GetOfficeOfflineLeaseForReleaseParams{
		UserID: actor.ID, DeviceSessionID: device.ID, DocumentID: documentID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		if _, _, err := s.docs.authorizeDocument(ctx, actor, documentID, DocumentLevelView); err != nil {
			return err
		}
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := q.DeleteOfficeOfflineLease(ctx, db.DeleteOfficeOfflineLeaseParams{ID: row.ID, OrganizationID: row.OrganizationID}); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID, Actor: actor,
		Action: audit.ActionOfficeOfflineLeaseReleased, ResourceType: officeLeaseResource, ResourceID: row.ID,
		Metadata: map[string]any{"document_id": row.DocumentID, "device_session_id": row.DeviceSessionID, "was_revoked": row.RevokedAt.Valid},
	}, officeLeaseEvent(officeLeaseTopicReleased, row.UserID, row.DocumentID, row.ID)); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if officeLeaseMetrics != nil {
		officeLeaseMetrics.ObserveOfficeLease("release")
	}
	return nil
}

// officeLeaseEvent is one office_lease.* outbox row: ids only, Scope user, so
// the holder's other online devices hear it too.
func officeLeaseEvent(topic, userID, documentID, leaseID string) audit.Event {
	return audit.Event{Topic: topic, Payload: map[string]string{"user_id": userID, "document_id": documentID, "lease_id": leaseID}}
}
