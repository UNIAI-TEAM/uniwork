package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	officeLaunchTTL       = 120 * time.Second
	officeLaunchClockSkew = 30 * time.Second
	// Keep the issuer marker aligned with the desktop deep-link parser. Login
	// codes use code_/state_ and can never pass this boundary.
	launchTicketPrefix = "ticket_"
	officeClientID     = "uniwork-office"
)

var (
	ErrOfficeLaunchInvalid = errors.New("office_launch_invalid")
	ErrOfficeLaunchExpired = errors.New("office_launch_expired")
	ErrOfficeLaunchRevoked = errors.New("office_launch_revoked")
)

func officeLaunchError(status int, code string, err error) error {
	return CodedError{Status: status, Code: code, Msg: code, Err: err}
}

// OfficeLaunchService owns the document-scoped capability. It deliberately
// depends on DocumentService for ACL evaluation so launch never becomes a
// second permission implementation.
type OfficeLaunchService struct {
	docs        *DocumentService
	clientID    string
	deployments map[string]struct{}
	now         func() time.Time
}

func NewOfficeLaunchService(docs *DocumentService, cfg config.Config) *OfficeLaunchService {
	client := strings.TrimSpace(cfg.DesktopAuthClientID)
	if client == "" {
		client = officeClientID
	}
	deployments := make(map[string]struct{}, len(cfg.DesktopAuthDeploymentIDs))
	for _, id := range cfg.DesktopAuthDeploymentIDs {
		if id = strings.TrimSpace(id); id != "" {
			deployments[id] = struct{}{}
		}
	}
	if len(deployments) == 0 {
		deployments["default"] = struct{}{}
	}
	return &OfficeLaunchService{docs: docs, clientID: client, deployments: deployments, now: time.Now}
}

func (s *OfficeLaunchService) SetClock(now func() time.Time) {
	if now == nil {
		now = time.Now
	}
	s.now = now
}

func (s *OfficeLaunchService) allowed(clientID, deploymentID string) bool {
	if clientID != s.clientID || deploymentID == "" {
		return false
	}
	_, ok := s.deployments[deploymentID]
	return ok
}

type OfficeLaunchCreateInput struct {
	DocumentID   string
	Operation    string
	Version      *int32
	DeploymentID string
	ClientID     string
}

type OfficeLaunchSession struct {
	Ticket     string
	SessionID  string
	DocumentID string
	Operation  string
	Version    int32
	ExpiresAt  time.Time
}

type OfficeLaunchExchangeInput struct {
	Ticket          string
	AccountID       string
	DeploymentID    string
	ClientID        string
	DeviceSessionID string
}

type OfficeLaunchExchange struct {
	Session    OfficeLaunchSession
	Document   db.Document
	RedeemedAt time.Time
}

func (s *OfficeLaunchService) Create(ctx context.Context, actor Actor, in OfficeLaunchCreateInput) (OfficeLaunchSession, error) {
	if s == nil || s.docs == nil || !validActor(actor) || !s.allowed(in.ClientID, in.DeploymentID) {
		return OfficeLaunchSession{}, officeLaunchError(http.StatusBadRequest, "invalid_request", ErrOfficeLaunchInvalid)
	}
	operation := strings.ToLower(strings.TrimSpace(in.Operation))
	if operation != "view" && operation != "edit" {
		return OfficeLaunchSession{}, officeLaunchError(http.StatusBadRequest, "invalid_request", ErrOfficeLaunchInvalid)
	}
	version := int32(0)
	if in.Version != nil {
		if *in.Version <= 0 {
			return OfficeLaunchSession{}, officeLaunchError(http.StatusBadRequest, "invalid_request", ErrOfficeLaunchInvalid)
		}
		version = *in.Version
		operation = "view" // historical versions are always read-only.
	}
	doc, access, err := s.docs.authorizeDocument(ctx, actor, in.DocumentID, DocumentLevelView)
	if err != nil {
		return OfficeLaunchSession{}, err
	}
	// The desktop bridge opens file bytes through the first-party download
	// route. Page documents have no file version and must not mint a ticket
	// whose descriptor the desktop consumer cannot safely open.
	if doc.Kind != DocumentKindFile {
		return OfficeLaunchSession{}, ErrNotFound
	}
	if operation == "edit" && !access.Level.AtLeast(DocumentLevelEdit) {
		return OfficeLaunchSession{}, ErrForbidden
	}
	if version > 0 {
		if _, err := s.docs.q.GetDocumentVersion(ctx, db.GetDocumentVersionParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID, Version: version,
		}); errors.Is(err, pgx.ErrNoRows) {
			return OfficeLaunchSession{}, ErrNotFound
		} else if err != nil {
			return OfficeLaunchSession{}, err
		}
	}
	raw, err := randomLaunchTicket()
	if err != nil {
		return OfficeLaunchSession{}, err
	}
	now := s.now()
	expires := now.Add(officeLaunchTTL)
	id := util.NewID()
	tx, err := s.docs.pool.Begin(ctx)
	if err != nil {
		return OfficeLaunchSession{}, err
	}
	defer tx.Rollback(ctx)
	q := s.docs.q.WithTx(tx)
	if _, err := q.InsertOfficeLaunchSession(ctx, db.InsertOfficeLaunchSessionParams{
		ID: id, TicketHash: hashLaunchTicket(raw), AccountID: actor.ID,
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		Operation: operation, Version: version, ClientID: in.ClientID, DeploymentID: in.DeploymentID,
		ExpiresAt: pgtype.Timestamptz{Time: expires, Valid: true}, CreatedBy: actor.ID,
		CreatedByKind: string(actor.Kind),
	}); err != nil {
		return OfficeLaunchSession{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Actor: actor,
		Action: audit.ActionOfficeLaunchSessionCreated, ResourceType: "office_launch_session", ResourceID: id,
		Metadata: map[string]any{"document_id": doc.ID, "operation": operation, "version": version},
	}); err != nil {
		return OfficeLaunchSession{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OfficeLaunchSession{}, err
	}
	return OfficeLaunchSession{Ticket: raw, SessionID: id, DocumentID: doc.ID, Operation: operation, Version: version, ExpiresAt: expires}, nil
}

func (s *OfficeLaunchService) Exchange(ctx context.Context, in OfficeLaunchExchangeInput) (OfficeLaunchExchange, error) {
	if s == nil || s.docs == nil || strings.TrimSpace(in.Ticket) == "" || in.AccountID == "" || in.DeviceSessionID == "" || !s.allowed(in.ClientID, in.DeploymentID) {
		return OfficeLaunchExchange{}, officeLaunchError(http.StatusBadRequest, "invalid_request", ErrOfficeLaunchInvalid)
	}
	if !strings.HasPrefix(in.Ticket, launchTicketPrefix) {
		return OfficeLaunchExchange{}, ErrNotFound
	}
	tx, err := s.docs.pool.Begin(ctx)
	if err != nil {
		return OfficeLaunchExchange{}, err
	}
	defer tx.Rollback(ctx)
	q := s.docs.q.WithTx(tx)
	// Lock the device row for the duration of ACL check + ticket mutation. A
	// concurrent logout/revoke therefore either wins before this check or waits
	// until the exchange commits; it can never race a successful redeem.
	device, err := q.GetDeviceSessionForUpdate(ctx, in.DeviceSessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return OfficeLaunchExchange{}, ErrForbidden
	}
	if err != nil {
		return OfficeLaunchExchange{}, err
	}
	if device.UserID != in.AccountID || device.ClientID != in.ClientID || device.DeploymentID != in.DeploymentID {
		return OfficeLaunchExchange{}, ErrForbidden
	}
	if device.RevokedAt.Valid || !device.ExpiresAt.Valid || !device.ExpiresAt.Time.Add(officeLaunchClockSkew).After(s.now()) {
		return OfficeLaunchExchange{}, desktopDeviceRevoked()
	}
	row, err := q.GetOfficeLaunchSessionByHash(ctx, hashLaunchTicket(in.Ticket))
	if errors.Is(err, pgx.ErrNoRows) {
		return OfficeLaunchExchange{}, ErrNotFound
	}
	if err != nil {
		return OfficeLaunchExchange{}, err
	}
	if row.AccountID != in.AccountID || row.ClientID != in.ClientID || row.DeploymentID != in.DeploymentID {
		return OfficeLaunchExchange{}, ErrForbidden
	}
	now := s.now()
	if row.RevokedAt.Valid {
		return OfficeLaunchExchange{}, ErrNotFound
	}
	if row.RedeemedAt.Valid || !row.ExpiresAt.Valid || !row.ExpiresAt.Time.Add(officeLaunchClockSkew).After(now) {
		return OfficeLaunchExchange{}, ErrNotFound
	}
	// Share/revoke commands take this same document lock, making this ACL
	// decision linearizable with a concurrent permission change.
	doc, err := q.LockDocumentByID(ctx, row.DocumentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return OfficeLaunchExchange{}, ErrNotFound
	}
	if err != nil {
		return OfficeLaunchExchange{}, err
	}
	access, err := s.docs.effectiveLevel(ctx, q, Human(in.AccountID), doc)
	if err != nil {
		return OfficeLaunchExchange{}, err
	}
	if err := decideDocumentAccess(doc, access, DocumentLevelView); err != nil {
		return OfficeLaunchExchange{}, err
	}
	if row.Operation == "edit" && row.Version == 0 && !access.Level.AtLeast(DocumentLevelEdit) {
		return OfficeLaunchExchange{}, ErrForbidden
	}
	if row.Version > 0 {
		if _, err := q.GetDocumentVersion(ctx, db.GetDocumentVersionParams{OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID, Version: row.Version}); errors.Is(err, pgx.ErrNoRows) {
			return OfficeLaunchExchange{}, ErrNotFound
		} else if err != nil {
			return OfficeLaunchExchange{}, err
		}
	}
	redeemed, err := q.RedeemOfficeLaunchSession(ctx, db.RedeemOfficeLaunchSessionParams{
		DeviceSessionID: pgtype.Text{String: in.DeviceSessionID, Valid: true}, TicketHash: row.TicketHash,
		AccountID: in.AccountID, OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
		DocumentID: row.DocumentID, ClientID: in.ClientID, DeploymentID: in.DeploymentID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return OfficeLaunchExchange{}, ErrNotFound
	}
	if err != nil {
		return OfficeLaunchExchange{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID, Actor: Human(in.AccountID),
		Action: audit.ActionOfficeLaunchSessionRedeemed, ResourceType: "office_launch_session", ResourceID: row.ID,
		Metadata: map[string]any{"document_id": row.DocumentID, "device_session_id": in.DeviceSessionID, "operation": row.Operation, "version": row.Version},
	}); err != nil {
		return OfficeLaunchExchange{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OfficeLaunchExchange{}, err
	}
	return OfficeLaunchExchange{Session: OfficeLaunchSession{SessionID: redeemed.ID, DocumentID: redeemed.DocumentID, Operation: redeemed.Operation, Version: redeemed.Version, ExpiresAt: redeemed.ExpiresAt.Time}, Document: doc, RedeemedAt: redeemed.RedeemedAt.Time}, nil
}

func (s *OfficeLaunchService) Revoke(ctx context.Context, actor Actor, sessionID string) error {
	if s == nil || s.docs == nil || !validActor(actor) || strings.TrimSpace(sessionID) == "" {
		return ErrNotFound
	}
	tx, err := s.docs.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.docs.q.WithTx(tx)
	// Session ids are opaque receipt ids and are resolved only inside the
	// service transaction; handlers never query the database directly.
	session, err := q.GetOfficeLaunchSessionByID(ctx, sessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if session.AccountID != actor.ID {
		return ErrForbidden
	}
	n, err := q.RevokeOfficeLaunchSession(ctx, db.RevokeOfficeLaunchSessionParams{ID: session.ID, AccountID: actor.ID, OrganizationID: session.OrganizationID, WorkspaceID: session.WorkspaceID})
	if err != nil {
		return err
	}
	if n == 0 {
		// Already revoked (or already redeemed) is an idempotent no-op. In
		// particular, never create a second audit row for the same transition.
		return tx.Commit(ctx)
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{OrganizationID: session.OrganizationID, WorkspaceID: session.WorkspaceID, Actor: actor, Action: audit.ActionOfficeLaunchSessionRevoked, ResourceType: "office_launch_session", ResourceID: session.ID, Metadata: map[string]any{"document_id": session.DocumentID}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// PurgeExpired removes terminal launch rows after the 24-hour forensic
// retention window. The worker supplies one organization/workspace pair so
// the maintenance query retains the tenant filters required by ADR 0008.
func (s *OfficeLaunchService) PurgeExpired(ctx context.Context, organizationID, workspaceID string) (int64, error) {
	if s == nil || s.docs == nil || strings.TrimSpace(organizationID) == "" || strings.TrimSpace(workspaceID) == "" {
		return 0, Invalid("organization and workspace are required")
	}
	return s.docs.q.DeleteExpiredOfficeLaunchSessions(ctx, db.DeleteExpiredOfficeLaunchSessionsParams{OrganizationID: organizationID, WorkspaceID: workspaceID})
}

func randomLaunchTicket() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return launchTicketPrefix + base64.RawURLEncoding.EncodeToString(b), nil
}

func hashLaunchTicket(ticket string) string {
	sum := sha256.Sum256([]byte(ticket))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}
