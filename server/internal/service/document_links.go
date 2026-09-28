package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// FeatureDocumentsPublicLinks is the plan entitlement behind public links
// (C-01 §5.3); the organization's document_settings switch is the second key.
const FeatureDocumentsPublicLinks = "documents.public_links"

// Public link policy (C-01 §3.5, plan G1-02): a view-only link, 32 random
// bytes returned once and stored only as a SHA-256 hash, 7 days by default,
// 90 at most, 5 live links per document.
const (
	documentLinkTokenBytes  = 32
	documentLinkDefaultDays = 7
	documentLinkMaxDays     = 90
	documentLinkMaxLive     = 5
)

func errDocumentLinkLimit() error {
	return coded(422, "document_link_limit", "mỗi tài liệu có tối đa 5 liên kết công khai còn hiệu lực")
}

func errDocumentLinksDisabled() error {
	return coded(403, "document_links_disabled", "tổ chức chưa bật liên kết công khai cho tài liệu")
}

// CreatedDocumentLink carries the raw token exactly once; nothing stores it.
type CreatedDocumentLink struct {
	Link  db.DocumentShareLink
	Token string
}

// hashDocumentLinkToken is the only form of a token the database sees.
func hashDocumentLinkToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newDocumentLinkToken() (string, error) {
	b := make([]byte, documentLinkTokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// publicLinksAllowed is the two-key check every link command and every
// public read makes: the plan grants documents.public_links and the
// organization has switched links on. No entitlement service wired means no.
func (s *DocumentService) publicLinksAllowed(ctx context.Context, q *db.Queries, organizationID string) (bool, error) {
	set, err := q.GetDocumentSettings(ctx, organizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !set.PublicLinksEnabled || s.entitlements == nil {
		return false, nil
	}
	if err := s.entitlements.Can(ctx, organizationID, FeatureDocumentsPublicLinks); err != nil {
		if errors.Is(err, ErrEntitlementRequired) || errors.Is(err, ErrSubscriptionInactive) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// CreateDocumentLink creates an anonymous view link. The entitlement is
// checked before the transaction (it reads through the pool); the
// organization switch, the level and the live-link limit are checked again
// inside it, under the document lock that serializes link commands.
func (s *DocumentService) CreateDocumentLink(ctx context.Context, actor Actor, documentID string, expiresInDays int) (CreatedDocumentLink, error) {
	if expiresInDays == 0 {
		expiresInDays = documentLinkDefaultDays
	}
	if expiresInDays < 1 || expiresInDays > documentLinkMaxDays {
		return CreatedDocumentLink{}, Invalid("expires_in_days phải từ 1 đến 90")
	}
	doc, access, err := s.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return CreatedDocumentLink{}, err
	}
	if err := requireDocumentACLChange(doc, access); err != nil {
		return CreatedDocumentLink{}, err
	}
	if s.entitlements == nil {
		return CreatedDocumentLink{}, errEntitlementRequired(FeatureDocumentsPublicLinks)
	}
	if err := s.entitlements.Can(ctx, doc.OrganizationID, FeatureDocumentsPublicLinks); err != nil {
		return CreatedDocumentLink{}, err
	}
	token, err := newDocumentLinkToken()
	if err != nil {
		return CreatedDocumentLink{}, err
	}
	var out CreatedDocumentLink
	err = s.withDocumentMutation(ctx, actor, documentID, DocumentLevelView, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		if err := requireDocumentACLChange(doc, access); err != nil {
			return err
		}
		set, err := q.GetDocumentSettings(ctx, doc.OrganizationID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !set.PublicLinksEnabled) {
			return errDocumentLinksDisabled()
		}
		if err != nil {
			return err
		}
		live, err := q.CountLiveDocumentShareLinks(ctx, db.CountLiveDocumentShareLinksParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		})
		if err != nil {
			return err
		}
		if live >= documentLinkMaxLive {
			return errDocumentLinkLimit()
		}
		link, err := q.InsertDocumentShareLink(ctx, db.InsertDocumentShareLinkParams{
			ID:             util.NewID(),
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
			DocumentID:     doc.ID,
			TokenHash:      hashDocumentLinkToken(token),
			ExpiresAt:      pgtype.Timestamptz{Time: time.Now().Add(time.Duration(expiresInDays) * 24 * time.Hour), Valid: true},
			CreatedBy:      actor.ID,
			CreatedByKind:  string(actor.Kind),
		})
		if err != nil {
			return err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
			Actor:          actor,
			Action:         audit.ActionDocumentLinkCreated,
			ResourceType:   "document",
			ResourceID:     doc.ID,
			// Never the token or its hash: the audit log is readable by admins.
			Metadata: map[string]any{"link_id": link.ID, "expires_in_days": expiresInDays},
		}, audit.Event{Topic: "document.link_created", Payload: map[string]string{
			"document_id":  doc.ID,
			"workspace_id": doc.WorkspaceID,
			"link_id":      link.ID,
		}}); err != nil {
			return err
		}
		out = CreatedDocumentLink{Link: link, Token: token}
		return nil
	})
	return out, err
}

// RevokeDocumentLink ends a link; the next public read with its token is
// not found.
func (s *DocumentService) RevokeDocumentLink(ctx context.Context, actor Actor, documentID, linkID string) error {
	return s.withDocumentMutation(ctx, actor, documentID, DocumentLevelView, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		if err := requireDocumentACLChange(doc, access); err != nil {
			return err
		}
		n, err := q.RevokeDocumentShareLink(ctx, db.RevokeDocumentShareLinkParams{
			ID: linkID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			DocumentID: doc.ID, RevokedBy: nullText(actor.ID),
		})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
		return auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
			Actor:          actor,
			Action:         audit.ActionDocumentLinkRevoked,
			ResourceType:   "document",
			ResourceID:     doc.ID,
			Metadata:       map[string]any{"link_id": linkID},
		}, audit.Event{Topic: "document.link_revoked", Payload: map[string]string{
			"document_id":  doc.ID,
			"workspace_id": doc.WorkspaceID,
			"link_id":      linkID,
		}})
	})
}

// SetDocumentPublicLinks is the organization switch for public links. Only
// organization owners and admins change it; turning it off closes every live
// link on its next read without revoking them.
func (s *DocumentService) SetDocumentPublicLinks(ctx context.Context, actor Actor, organizationID string, enabled bool) (db.DocumentSetting, error) {
	if actor.Kind != audit.KindHuman {
		return db.DocumentSetting{}, ErrForbidden
	}
	m, err := s.orgs.RequireMember(ctx, organizationID, actor.ID)
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			return db.DocumentSetting{}, ErrNotFound
		}
		return db.DocumentSetting{}, err
	}
	if m.Role != OrgRoleOwner && m.Role != OrgRoleAdmin {
		return db.DocumentSetting{}, ErrForbidden
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.DocumentSetting{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	before := false
	if prev, err := q.GetDocumentSettings(ctx, organizationID); err == nil {
		before = prev.PublicLinksEnabled
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return db.DocumentSetting{}, err
	}
	set, err := q.UpsertDocumentSettings(ctx, db.UpsertDocumentSettingsParams{
		OrganizationID:     organizationID,
		PublicLinksEnabled: enabled,
		UpdatedBy:          actor.ID,
		UpdatedByKind:      string(actor.Kind),
	})
	if err != nil {
		return db.DocumentSetting{}, err
	}
	if before != enabled {
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: organizationID,
			Actor:          actor,
			Action:         audit.ActionDocumentSettingsChanged,
			ResourceType:   "organization",
			ResourceID:     organizationID,
			Changes:        audit.Diff(map[string]any{"public_links_enabled": before}, map[string]any{"public_links_enabled": enabled}),
		}); err != nil {
			return db.DocumentSetting{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return db.DocumentSetting{}, err
	}
	return set, nil
}

// PublicDocument is what an anonymous link reader may see: the document row
// (the handler renders title + sanitized content, or offers the download)
// and the link that opened it.
type PublicDocument struct {
	Document db.Document
	Link     db.DocumentShareLink
}

// resolvePublicLink is the check every public read, asset and download makes
// before anything else (C-01 §14.2): a live, unexpired link by token hash, a
// live, unowned document of an active organization, and both public-link
// keys. Every refusal is the same not found - a public caller learns
// nothing about why.
func (s *DocumentService) resolvePublicLink(ctx context.Context, token string) (PublicDocument, error) {
	if token == "" || len(token) > 128 {
		return PublicDocument{}, ErrNotFound
	}
	link, err := s.q.GetLiveDocumentShareLinkByTokenHash(ctx, hashDocumentLinkToken(token))
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicDocument{}, ErrNotFound
	}
	if err != nil {
		return PublicDocument{}, err
	}
	doc, err := s.q.GetDocumentByID(ctx, link.DocumentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicDocument{}, ErrNotFound
	}
	if err != nil {
		return PublicDocument{}, err
	}
	if doc.OrganizationID != link.OrganizationID || doc.WorkspaceID != link.WorkspaceID ||
		doc.ArchivedAt.Valid || doc.OwnerKind.Valid {
		return PublicDocument{}, ErrNotFound
	}
	org, err := s.q.GetOrganizationByID(ctx, doc.OrganizationID)
	if err != nil {
		return PublicDocument{}, err
	}
	if org.Status != OrganizationActive {
		return PublicDocument{}, ErrNotFound
	}
	ok, err := s.publicLinksAllowed(ctx, s.q, doc.OrganizationID)
	if err != nil {
		return PublicDocument{}, err
	}
	if !ok {
		return PublicDocument{}, ErrNotFound
	}
	return PublicDocument{Document: doc, Link: link}, nil
}

// OpenPublicDocument is the anonymous page/metadata read of a link. The
// view is counted only while the link is still live (a revoke that lands
// between the lookup and the count still refuses the read), then logged as
// link_view with no actor.
func (s *DocumentService) OpenPublicDocument(ctx context.Context, token string) (PublicDocument, error) {
	pub, err := s.resolvePublicLink(ctx, token)
	if err != nil {
		return PublicDocument{}, err
	}
	link, err := s.q.CountDocumentShareLinkView(ctx, db.CountDocumentShareLinkViewParams{
		ID: pub.Link.ID, OrganizationID: pub.Link.OrganizationID, WorkspaceID: pub.Link.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicDocument{}, ErrNotFound
	}
	if err != nil {
		return PublicDocument{}, err
	}
	pub.Link = link
	s.recordDocumentAccess(ctx, documentAccessEvent{
		Document: pub.Document, Action: DocumentAccessLinkView, Via: DocumentViaLink, ShareLinkID: link.ID,
	})
	return pub, nil
}

// OpenPublicDocumentFile streams the current file of a file document behind
// a link, through Go (no presign): the link checks run on every call.
func (s *DocumentService) OpenPublicDocumentFile(ctx context.Context, token string, rng DocumentByteRange) (DocumentFile, error) {
	pub, err := s.resolvePublicLink(ctx, token)
	if err != nil {
		return DocumentFile{}, err
	}
	f, err := s.openCurrentFile(ctx, pub.Document, rng)
	if err != nil {
		return DocumentFile{}, err
	}
	s.recordDocumentAccess(ctx, documentAccessEvent{
		Document: pub.Document, Version: &f.Version.Version, Action: DocumentAccessDownload,
		Via: DocumentViaLink, ShareLinkID: pub.Link.ID,
	})
	return f, nil
}

// PublicDocumentAsset is the anonymous asset read: the opened bytes plus the
// document's organization, so the HTTP layer can evaluate the organization's
// `documents` feature flag on the asset route exactly like the public view
// and the file download (Advisor decision 2026-09-28, G1-05b). No extra
// query, no view count, no access-log row rides on this.
type PublicDocumentAsset struct {
	OrganizationID string
	Reader         files.Reader
}

// OpenPublicDocumentAsset streams one page asset behind a link. The asset
// must belong to the link's document.
func (s *DocumentService) OpenPublicDocumentAsset(ctx context.Context, token, assetID string, rng DocumentByteRange) (PublicDocumentAsset, error) {
	pub, err := s.resolvePublicLink(ctx, token)
	if err != nil {
		return PublicDocumentAsset{}, err
	}
	a, err := s.q.GetDocumentAsset(ctx, db.GetDocumentAssetParams{
		ID: assetID, OrganizationID: pub.Document.OrganizationID,
		WorkspaceID: pub.Document.WorkspaceID, DocumentID: pub.Document.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicDocumentAsset{}, ErrNotFound
	}
	if err != nil {
		return PublicDocumentAsset{}, err
	}
	r, err := s.openDocumentBytes(ctx, pub.Document, a.FileID, rng)
	if err != nil {
		return PublicDocumentAsset{}, err
	}
	return PublicDocumentAsset{OrganizationID: pub.Document.OrganizationID, Reader: r}, nil
}
