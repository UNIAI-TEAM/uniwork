package service

// Saved signatures (UNI-925 B6): a person's reusable signature images kept
// server-side, so they follow the account instead of a browser profile. A row
// is personal - every statement filters by (organization_id, user_id) - and
// organization membership is the only gate, checked with the same
// RequireMember call the rest of the tenant surface uses. A non-member gets
// ErrNotFound, never a 403, so an organization id cannot be probed. Writes
// run in a transaction with their audit row (ADR 0009); the format is never
// taken from the request alone - the service sniffs the bytes it was handed.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	// MaxSignatureBytes bounds one decoded signature image. The handler
	// decodes base64 into memory under this cap, and the migration repeats
	// it as a CHECK (524288), so a row can never carry a bigger blob.
	MaxSignatureBytes = 512 << 10
	// maxSignatureLabel bounds the picker label; it names the signature,
	// it is not a document.
	maxSignatureLabel = 80
	// MaxSavedSignaturesPerUser caps how many signatures one person keeps in
	// one organization. The picker is a short list, not an archive; the cap is
	// enforced inside the create transaction (count + insert under a per-user
	// advisory lock), so a race cannot push the row count past it.
	MaxSavedSignaturesPerUser = 50
)

// signatureContentTypes is the allowlist of image formats the PDF editor
// produces; the sniffed bytes must match the declared type before anything
// is stored.
var signatureContentTypes = map[string]bool{
	"image/png":  true,
	"image/jpeg": true,
}

// SignatureService owns the caller's saved signature images.
type SignatureService struct {
	pool *pgxpool.Pool
	q    *db.Queries
	orgs *OrganizationService
}

func NewSignatureService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService) *SignatureService {
	return &SignatureService{pool: pool, q: q, orgs: orgs}
}

// SaveSignatureInput is one create command: the label the person chose and
// the image bytes the handler decoded from base64.
type SaveSignatureInput struct {
	Label       string
	ContentType string
	Image       []byte
}

// requireOrgMember maps "not a member" - and nothing else - onto
// ErrNotFound, the same shape the document favorites list uses: an outsider
// cannot tell an organization that exists from one that does not.
func (s *SignatureService) requireOrgMember(ctx context.Context, organizationID, userID string) error {
	if _, err := s.orgs.RequireMember(ctx, organizationID, userID); err != nil {
		if errors.Is(err, ErrForbidden) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

// ListSavedSignatures is the caller's own signatures in one organization,
// newest first. Bytes travel with the list because there is no read-one
// route: the picker draws one thumbnail per row from the response.
func (s *SignatureService) ListSavedSignatures(ctx context.Context, actor Actor, organizationID string) ([]db.ListSavedSignaturesRow, error) {
	if !validActor(actor) {
		return nil, ErrNotFound
	}
	if err := s.requireOrgMember(ctx, organizationID, actor.ID); err != nil {
		return nil, err
	}
	return s.q.ListSavedSignatures(ctx, db.ListSavedSignaturesParams{
		OrganizationID: organizationID, UserID: actor.ID,
	})
}

// SaveSignature stores one signature for the caller. A signature is personal
// and an agent has no signature of its own (ADR 0007), so an agent actor is
// refused - after the membership gate, so an outsider still learns nothing.
func (s *SignatureService) SaveSignature(ctx context.Context, actor Actor, organizationID string, in SaveSignatureInput) (db.CreateSavedSignatureRow, error) {
	var out db.CreateSavedSignatureRow
	if !validActor(actor) {
		return out, ErrNotFound
	}
	if err := s.requireOrgMember(ctx, organizationID, actor.ID); err != nil {
		return out, err
	}
	if actor.Kind != audit.KindHuman {
		return out, ErrForbidden
	}

	label := strings.TrimSpace(in.Label)
	switch {
	case label == "":
		return out, Invalid("label is required")
	case utf8.RuneCountInString(label) > maxSignatureLabel:
		return out, Invalid(fmt.Sprintf("label must be at most %d characters", maxSignatureLabel))
	}
	if !signatureContentTypes[in.ContentType] {
		return out, Invalid("content_type must be image/png or image/jpeg")
	}
	if len(in.Image) == 0 {
		return out, Invalid("image is required")
	}
	if len(in.Image) > MaxSignatureBytes {
		return out, Invalid(fmt.Sprintf("image must be at most %d bytes", MaxSignatureBytes))
	}
	if sniffed := http.DetectContentType(in.Image); sniffed != in.ContentType {
		return out, Invalid("image does not match content_type")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	// Serialize the cap check per (organization, user) so two concurrent
	// creates cannot both read the same under-cap count, then refuse before
	// the insert rather than after.
	if err := q.LockSavedSignaturesForUser(ctx, db.LockSavedSignaturesForUserParams{
		OrganizationID: organizationID, UserID: actor.ID,
	}); err != nil {
		return out, err
	}
	owned, err := q.CountSavedSignaturesByOwner(ctx, db.CountSavedSignaturesByOwnerParams{
		OrganizationID: organizationID, UserID: actor.ID,
	})
	if err != nil {
		return out, err
	}
	if owned >= MaxSavedSignaturesPerUser {
		return out, Invalid(fmt.Sprintf("at most %d saved signatures per user", MaxSavedSignaturesPerUser))
	}

	row, err := q.CreateSavedSignature(ctx, db.CreateSavedSignatureParams{
		ID: util.NewID(), OrganizationID: organizationID, UserID: actor.ID,
		Label: label, ContentType: in.ContentType, Image: in.Image,
		CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
	})
	if err != nil {
		return out, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: organizationID,
		Actor:          actor, Action: audit.ActionSignatureCreated,
		ResourceType: "signature", ResourceID: row.ID,
		Metadata: map[string]any{"content_type": row.ContentType, "byte_size": len(row.Image)},
	}); err != nil {
		return out, err
	}
	if err := tx.Commit(ctx); err != nil {
		return out, err
	}
	return row, nil
}

// DeleteSavedSignature removes one of the caller's signatures. A row that is
// not the caller's, or not in this organization, is ErrNotFound; the audit
// row is written only when a row actually went away.
func (s *SignatureService) DeleteSavedSignature(ctx context.Context, actor Actor, organizationID, signatureID string) error {
	if !validActor(actor) {
		return ErrNotFound
	}
	if err := s.requireOrgMember(ctx, organizationID, actor.ID); err != nil {
		return err
	}
	if actor.Kind != audit.KindHuman {
		return ErrForbidden
	}
	if signatureID == "" {
		return ErrNotFound
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	n, err := q.DeleteSavedSignature(ctx, db.DeleteSavedSignatureParams{
		ID: signatureID, OrganizationID: organizationID, UserID: actor.ID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: organizationID,
		Actor:          actor, Action: audit.ActionSignatureDeleted,
		ResourceType: "signature", ResourceID: signatureID,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
