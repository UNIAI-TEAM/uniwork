package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/document"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// OwnerLevelResolver is the seam Work Product services (C-14) implement to
// answer "what level does this actor have on the documents owner X owns?"
// (C-01 §13.4). It returns none for actors without a delegation path.
type OwnerLevelResolver interface {
	Resolve(ctx context.Context, actor Actor, ownerID string) (DocumentLevel, error)
}

// errDocumentOwnerResolverMissing is the fail-closed error of C-01 §13.8:
// nothing may create or delegate an owned document while no owner service is
// plugged into DocumentService.
var errDocumentOwnerResolverMissing = errors.New("document owner resolver is not configured (C-01 §13.8)")

// denyOwnerLevelResolver is the default: every actor resolves to none. It is
// the implementation AC-4 requires - a resolver that exists but grants
// nothing until a real owner service replaces it.
type denyOwnerLevelResolver struct{}

func (denyOwnerLevelResolver) Resolve(_ context.Context, _ Actor, _ string) (DocumentLevel, error) {
	return DocumentLevelNone, nil
}

// SetOwnerLevelResolver installs the owner service's resolver. Passing nil
// restores the default-deny seam.
func (s *DocumentService) SetOwnerLevelResolver(r OwnerLevelResolver) {
	if r == nil {
		s.ownerLevel = denyOwnerLevelResolver{}
		s.ownerLevelSet = false
		return
	}
	s.ownerLevel = r
	s.ownerLevelSet = true
}

// ownerLevelResolve answers through the wired resolver or, when none is
// wired, denies everything by construction.
func (s *DocumentService) ownerLevelResolve(ctx context.Context, actor Actor, ownerID string) (DocumentLevel, error) {
	if s.ownerLevel == nil {
		return DocumentLevelNone, nil
	}
	return s.ownerLevel.Resolve(ctx, actor, ownerID)
}

// OwnedDocumentInput is what an owning work-product service asks the seam to
// create (C-01 §13.5). Public create never sees these fields; the seam is
// the only place owner_kind/owner_id are assigned.
type OwnedDocumentInput struct {
	OrganizationID string
	WorkspaceID    string
	OwnerID        string // the owning work product id
	Kind           string // DocumentKindPage | DocumentKindFile
	Title          string
	Icon           string
	Content        json.RawMessage // pages only; sanitized before it is stored
}

// CreateOwnedDocumentInTx creates an owned document inside the owner
// service's transaction, so the work product and its document commit
// together (§13.5). The DB constraints guarantee what the seam promises:
// owner pair set, no parent, file kind without content.
func (s *DocumentService) CreateOwnedDocumentInTx(
	ctx context.Context, q *db.Queries, actor Actor, in OwnedDocumentInput,
) (db.Document, error) {
	if !s.ownerLevelSet {
		return db.Document{}, errDocumentOwnerResolverMissing
	}
	if !validActor(actor) {
		return db.Document{}, Invalid("actor không hợp lệ")
	}
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" {
		return db.Document{}, Invalid("tên tài liệu không được để trống")
	}
	if len([]rune(in.Title)) > 500 {
		return db.Document{}, Invalid("tên tài liệu tối đa 500 ký tự")
	}
	if strings.TrimSpace(in.OwnerID) == "" {
		return db.Document{}, Invalid("owner_id bắt buộc")
	}

	var content []byte
	var contentText string
	switch in.Kind {
	case DocumentKindPage:
		if len(in.Content) > 0 {
			sanitized, text, err := document.Sanitize(in.Content)
			if err != nil {
				return db.Document{}, err
			}
			content = sanitized
			contentText = text
		}
	case DocumentKindFile:
		if len(in.Content) > 0 {
			return db.Document{}, Invalid("tài liệu file không nhận content")
		}
	default:
		return db.Document{}, Invalid("kind phải là page hoặc file")
	}

	params := db.InsertDocumentParams{
		ID:             util.NewID(),
		OrganizationID: in.OrganizationID,
		WorkspaceID:    in.WorkspaceID,
		Kind:           in.Kind,
		Title:          in.Title,
		Visibility:     "workspace",
		Content:        content,
		ContentText:    contentText,
		SearchText:     documentSearchText(in.Title, contentText),
		ContentBytes:   int32(len(content)),
		Revision:       1,
		OwnerKind:      pgtype.Text{String: "work_product", Valid: true},
		OwnerID:        pgtype.Text{String: in.OwnerID, Valid: true},
		// §14.3: acl_owner_id defaults to created_by on a human actor.
		AclOwnerID:    aclOwnerFor(actor),
		CreatedBy:     actor.ID,
		CreatedByKind: string(actor.Kind),
		UpdatedBy:     actor.ID,
		UpdatedByKind: string(actor.Kind),
	}
	if strings.TrimSpace(in.Icon) != "" {
		params.Icon = pgtype.Text{String: in.Icon, Valid: true}
	}
	return q.InsertDocument(ctx, params)
}

// aclOwnerFor implements §14.3: acl_owner_id defaults to the creator, but
// only a person can own an ACL slot - agents and the system leave it NULL.
func aclOwnerFor(actor Actor) pgtype.Text {
	if actor.Kind == audit.KindHuman {
		return pgtype.Text{String: actor.ID, Valid: true}
	}
	return pgtype.Text{}
}
