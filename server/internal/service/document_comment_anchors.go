package service

// Document comment anchors (G8-04, UNI-1399; contract-collab sections 2.2,
// 2.6 and 4). An anchor is the JSON position a `kind=comment` thread points
// at inside a file document. It lives on the comment row beside the version
// it was written against (`anchor_version_id`) and its state
// (`exact`/`stale`/`lost`). The per-format schema is closed and enforced
// here - decode() does not reject unknown fields - and the canonical JSON
// this file returns is what both the row and the idempotency fingerprint
// hash. The document's format comes from its current file version; a page,
// a markdown or an HTML document cannot carry an anchor.
//
// Version comparison is by the ordinal `document_versions.version`, never by
// ULID string order. A PUT never moves an anchor back to an older version,
// is idempotent by itself (no Idempotency-Key ledger), and emits one audit
// row + outbox event per call that changed at least one row. A create binds
// through the same tenant + document lookup with `base_version_id`.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	// maxDocumentCommentAnchorBytes caps one canonical anchor (contract
	// section 4.1: 4 KiB on the canonical JSON).
	maxDocumentCommentAnchorBytes = 4 * 1024
	// maxDocumentCommentAnchorText caps the quoted text fields (quote,
	// prefix, suffix) at 500 Unicode code points.
	maxDocumentCommentAnchorText = 500
	// maxDocumentCommentAnchorItems caps one PUT body (OQ-C5).
	maxDocumentCommentAnchorItems = 500
)

// Anchor states (contract section 4.2). `exact` is only ever stored when the
// anchor's version is the head at write time; `stale` when it is behind it;
// `lost` when the editor reports it could not find the position.
const (
	DocumentCommentAnchorExact = "exact"
	DocumentCommentAnchorStale = "stale"
	DocumentCommentAnchorLost  = "lost"
)

// Skipped-item reasons (contract section 2.6): older_version is the version
// rule, not_applicable folds every hidden case - another document's comment,
// another tenant, a discussion, a reply or a tombstone - so the answer never
// reveals which.
const (
	DocumentCommentAnchorSkipOlderVersion  = "older_version"
	DocumentCommentAnchorSkipNotApplicable = "not_applicable"
)

// errAnchorVersionInvalid is the shared 400 both the create and the PUT
// answer for a version_id that is not this document's (contract section 9):
// another document's version, a purged one, an unknown one and an empty one
// are one body, so the route never confirms a version exists elsewhere.
func errAnchorVersionInvalid() error {
	return CodedError{Code: "anchor_version_invalid", Status: http.StatusBadRequest, Msg: "phiên bản neo không hợp lệ"}
}

// documentCommentAnchor is the validated create binding: the canonical JSON
// stored on the row and hashed into the idempotency fingerprint, the version
// row it was written against and the state resolved at write time.
type documentCommentAnchor struct {
	canonical []byte
	versionID string
	state     string
	hash      string
}

// documentAnchorFormat reports the anchor format a document accepts: the
// current file version's format, "" when the document cannot carry anchors
// (a page, a folder, a file with no resolvable version, or a format outside
// docx/xlsx/pptx/pdf such as markdown and HTML, G8-D6).
func documentAnchorFormat(ctx context.Context, q *db.Queries, doc db.Document) (string, error) {
	if doc.Kind != DocumentKindFile || !doc.FileVersionID.Valid || doc.FileVersionID.String == "" {
		return "", nil
	}
	v, err := q.GetDocumentVersionByID(ctx, db.GetDocumentVersionByIDParams{
		ID: doc.FileVersionID.String, OrganizationID: doc.OrganizationID,
		WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	format, ok := officeFormatFromMime(v.MimeType.String)
	if !ok {
		return "", nil
	}
	return string(format), nil
}

// anchorTextOK bounds one quoted text field in Unicode code points.
func anchorTextOK(s string) bool {
	return len([]rune(s)) <= maxDocumentCommentAnchorText
}

// validateAnchor enforces the closed per-format anchor schema (contract
// section 4.1) and returns the canonical JSON stored on the row. format is
// the document's own format: an anchor for another format - or one for a
// document that cannot carry anchors - is a 400 invalid_request.
func validateAnchor(format string, raw json.RawMessage) ([]byte, error) {
	invalid := Invalid("neo không hợp lệ")
	if format != "docx" && format != "xlsx" && format != "pptx" && format != "pdf" {
		return nil, invalid
	}
	var head struct {
		Format string `json:"format"`
		V      *int   `json:"v"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &head) != nil || head.V == nil || *head.V != 1 || head.Format != format {
		return nil, invalid
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var canonical []byte
	switch format {
	case "docx":
		var a struct {
			Format string  `json:"format"`
			V      *int    `json:"v"`
			ParaID *string `json:"para_id"`
			Path   *[]*int `json:"path"`
			Start  *int    `json:"start"`
			End    *int    `json:"end"`
			Quote  *string `json:"quote"`
			Prefix *string `json:"prefix"`
			Suffix *string `json:"suffix"`
		}
		if dec.Decode(&a) != nil || a.Path == nil || a.Start == nil || a.End == nil ||
			a.Quote == nil || a.Prefix == nil || a.Suffix == nil ||
			*a.Start < 0 || *a.End < *a.Start ||
			!anchorTextOK(*a.Quote) || !anchorTextOK(*a.Prefix) || !anchorTextOK(*a.Suffix) {
			return nil, invalid
		}
		// Elements are pointers so a JSON null inside path is a 400, never a
		// silent zero (R1-9).
		path := make([]int, len(*a.Path))
		for i, elem := range *a.Path {
			if elem == nil {
				return nil, invalid
			}
			path[i] = *elem
		}
		obj := map[string]any{"format": "docx", "v": 1, "path": path, "start": *a.Start, "end": *a.End, "quote": *a.Quote, "prefix": *a.Prefix, "suffix": *a.Suffix}
		if a.ParaID != nil {
			obj["para_id"] = *a.ParaID
		}
		canonical = marshalAnchor(obj)
	case "xlsx":
		var a struct {
			Format string  `json:"format"`
			V      *int    `json:"v"`
			Sheet  *string `json:"sheet"`
			Range  *string `json:"range"`
		}
		if dec.Decode(&a) != nil || a.Sheet == nil || a.Range == nil ||
			strings.TrimSpace(*a.Sheet) == "" || strings.TrimSpace(*a.Range) == "" {
			return nil, invalid
		}
		canonical = marshalAnchor(map[string]any{"format": "xlsx", "v": 1, "sheet": *a.Sheet, "range": *a.Range})
	case "pptx":
		var a struct {
			Format     string  `json:"format"`
			V          *int    `json:"v"`
			SlideID    *string `json:"slide_id"`
			SlideIndex *int    `json:"slide_index"`
			ObjectID   *string `json:"object_id"`
		}
		// R1-10: a blank slide_id is as unusable as a missing one, and a
		// present object_id may not be blank either.
		if dec.Decode(&a) != nil || a.SlideID == nil || a.SlideIndex == nil || *a.SlideIndex < 0 ||
			strings.TrimSpace(*a.SlideID) == "" ||
			(a.ObjectID != nil && strings.TrimSpace(*a.ObjectID) == "") {
			return nil, invalid
		}
		obj := map[string]any{"format": "pptx", "v": 1, "slide_id": *a.SlideID, "slide_index": *a.SlideIndex}
		if a.ObjectID != nil {
			obj["object_id"] = *a.ObjectID
		}
		canonical = marshalAnchor(obj)
	case "pdf":
		var a struct {
			Format string      `json:"format"`
			V      *int        `json:"v"`
			Page   *int        `json:"page"`
			Rect   *[]*float64 `json:"rect"`
		}
		if dec.Decode(&a) != nil || a.Page == nil || *a.Page < 1 || a.Rect == nil || len(*a.Rect) != 4 {
			return nil, invalid
		}
		// R1-9: a JSON null inside rect is a 400, never a silent 0.
		rect := make([]float64, len(*a.Rect))
		for i, elem := range *a.Rect {
			if elem == nil {
				return nil, invalid
			}
			rect[i] = *elem
		}
		canonical = marshalAnchor(map[string]any{"format": "pdf", "v": 1, "page": *a.Page, "rect": rect})
	}
	if len(canonical) == 0 || len(canonical) > maxDocumentCommentAnchorBytes {
		return nil, invalid
	}
	return canonical, nil
}

// marshalAnchor renders one accepted anchor; maps marshal with sorted keys
// and the shortest number form, which is the canonical shape hashed here.
func marshalAnchor(obj map[string]any) []byte {
	raw, err := json.Marshal(obj)
	if err != nil {
		return nil
	}
	return raw
}

// anchorCanonicalHash is the SHA-256 hex of a canonical anchor - the
// `anchorHash` part of the create fingerprint; "" when the create has none.
func anchorCanonicalHash(canonical []byte) string {
	if len(canonical) == 0 {
		return ""
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:])
}

// prepareDocumentCommentAnchor validates a create's anchor against the locked
// document: an anchor belongs to a root `kind=comment` only, needs a
// base_version_id that resolves inside this tenant + document (rule 1 of
// contract section 4.3), and follows the document's own format. nil means the
// create carries no anchor.
//
// OQ-C2 (signed): a root whose thread kind resolves to `comment` requires
// both `anchor` and `base_version_id` - the pinned assertion of contract
// section 2.2's error table. An empty kind resolves to `discussion` before
// this runs, so an anchorless root stays a discussion and a reply never
// carries an anchor.
func prepareDocumentCommentAnchor(ctx context.Context, q *db.Queries, doc db.Document, in AddCommentInput) (*documentCommentAnchor, error) {
	rawAnchor := len(in.Anchor) > 0 && string(bytes.TrimSpace(in.Anchor)) != "null"
	root := in.ParentID == nil || strings.TrimSpace(*in.ParentID) == ""
	resolvedKind := strings.TrimSpace(in.CommentType)
	if resolvedKind == "" && root {
		resolvedKind = "discussion"
	}
	if !rawAnchor {
		if root && resolvedKind == "comment" {
			return nil, Invalid("bình luận kind=comment phải có neo và base_version_id")
		}
		return nil, nil
	}
	if !root {
		return nil, Invalid("neo chỉ có ở bình luận gốc")
	}
	if resolvedKind != "comment" {
		return nil, Invalid("neo chỉ có ở bình luận kind=comment")
	}
	baseVersionID := strings.TrimSpace(in.BaseVersionID)
	if baseVersionID == "" {
		return nil, Invalid("base_version_id bắt buộc khi có neo")
	}
	v, err := q.GetDocumentVersionByID(ctx, db.GetDocumentVersionByIDParams{
		ID: baseVersionID, OrganizationID: doc.OrganizationID,
		WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errAnchorVersionInvalid()
	}
	if err != nil {
		return nil, err
	}
	format, err := documentAnchorFormat(ctx, q, doc)
	if err != nil {
		return nil, err
	}
	canonical, err := validateAnchor(format, in.Anchor)
	if err != nil {
		return nil, err
	}
	state := DocumentCommentAnchorStale
	if v.Version == doc.CurrentVersion {
		state = DocumentCommentAnchorExact
	}
	return &documentCommentAnchor{
		canonical: canonical, versionID: v.ID, state: state, hash: anchorCanonicalHash(canonical),
	}, nil
}

// DocumentCommentAnchorItem is one anchors[] entry of the PUT: the comment,
// its new anchor and the state the editor reported (exact or lost; the
// server demotes exact to stale by rule 3).
type DocumentCommentAnchorItem struct {
	CommentID string
	Anchor    json.RawMessage
	State     string
}

// DocumentCommentAnchorsInput is PUT /documents/{id}/comments/anchors
// (contract section 2.6).
type DocumentCommentAnchorsInput struct {
	VersionID string
	Anchors   []DocumentCommentAnchorItem
	// AnchorsPresent mirrors the wire presence of the anchors key: the field
	// is required, so absent or null is a 400 while [] is the valid empty
	// update (contract 2.6, R1-8). The handler sets it from the raw body.
	AnchorsPresent bool
}

// DocumentCommentAnchorSkip is one comment the PUT left alone, with the one
// of two shared reasons.
type DocumentCommentAnchorSkip struct {
	CommentID string
	Reason    string
}

// DocumentCommentAnchorResult is the PUT's answer: the comments it changed,
// the ones it skipped with a reason, and the document's list_token after the
// write - computed inside the command's transaction from every row of the
// document (contract sections 2.6 and 6).
type DocumentCommentAnchorResult struct {
	Updated   []string
	Skipped   []DocumentCommentAnchorSkip
	ListToken string
}

// PutDocumentCommentAnchors applies an editor's anchor map to one version of
// the document (edit level). The version must resolve inside the tenant and
// document or the whole call is 400 anchor_version_invalid with nothing
// written; each applicable comment takes the new anchor when its version is
// not older than the stored one, and an all-no-op repeat changes no row and
// emits no event (rule 4).
func (s *DocumentService) PutDocumentCommentAnchors(ctx context.Context, actor Actor, documentID string, in DocumentCommentAnchorsInput) (DocumentCommentAnchorResult, error) {
	var out DocumentCommentAnchorResult
	// R1-8: anchors is required. An absent key or a null never reaches the
	// document, so nothing is written and no list_token is minted for a
	// request that named no anchors at all.
	if !in.AnchorsPresent {
		return out, Invalid("anchors là trường bắt buộc")
	}
	err := s.withDocumentMutation(ctx, actor, documentID, DocumentLevelEdit, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		out = DocumentCommentAnchorResult{
			Updated: []string{}, Skipped: []DocumentCommentAnchorSkip{},
		}
		if len(in.Anchors) > maxDocumentCommentAnchorItems {
			return Invalid("tối đa 500 neo mỗi lần")
		}
		versionID := strings.TrimSpace(in.VersionID)
		v, err := q.GetDocumentVersionByID(ctx, db.GetDocumentVersionByIDParams{
			ID: versionID, OrganizationID: doc.OrganizationID,
			WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return errAnchorVersionInvalid()
		}
		if err != nil {
			return err
		}
		ref := docCommentRef(doc)
		format, err := documentAnchorFormat(ctx, q, doc)
		if err != nil {
			return err
		}
		changed := false
		seen := make(map[string]bool, len(in.Anchors))
		for _, item := range in.Anchors {
			state := strings.TrimSpace(item.State)
			if state != DocumentCommentAnchorExact && state != DocumentCommentAnchorLost {
				return Invalid("state của neo không hợp lệ")
			}
			commentID := strings.TrimSpace(item.CommentID)
			// R1-1: the same comment twice in one body would write two
			// different anchors onto one row, so every identical retry would
			// look like a change and defeat the PUT's self-idempotency. A
			// repeat is refused before anything is applied.
			if seen[commentID] {
				return Invalid("mỗi bình luận chỉ được xuất hiện một lần trong anchors")
			}
			seen[commentID] = true
			c, err := loadInResource(ctx, q, documentCommentAdapter{}, ref, commentID)
			if errors.Is(err, ErrNotFound) {
				out.Skipped = append(out.Skipped, DocumentCommentAnchorSkip{CommentID: commentID, Reason: DocumentCommentAnchorSkipNotApplicable})
				continue
			}
			if err != nil {
				return err
			}
			// A discussion, a reply or a tombstone is not an anchorable
			// target; the item is skipped with the same reason as a foreign
			// or unknown comment, so the answer reveals which - never why.
			if c.CommentType != "comment" || c.ParentCommentID.Valid || c.DeletedAt.Valid {
				out.Skipped = append(out.Skipped, DocumentCommentAnchorSkip{CommentID: commentID, Reason: DocumentCommentAnchorSkipNotApplicable})
				continue
			}
			canonical, err := validateAnchor(format, item.Anchor)
			if err != nil {
				return err
			}
			// Rule 2: compare version ordinals, never ULIDs. A stored
			// version that no longer exists counts as older than anything.
			if c.AnchorVersionID.Valid && c.AnchorVersionID.String != "" && c.AnchorVersionID.String != v.ID {
				stored, err := q.GetDocumentVersionByID(ctx, db.GetDocumentVersionByIDParams{
					ID: c.AnchorVersionID.String, OrganizationID: doc.OrganizationID,
					WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
				})
				if err != nil && !errors.Is(err, pgx.ErrNoRows) {
					return err
				}
				if err == nil && stored.Version > v.Version {
					out.Skipped = append(out.Skipped, DocumentCommentAnchorSkip{CommentID: commentID, Reason: DocumentCommentAnchorSkipOlderVersion})
					continue
				}
			}
			resolved := DocumentCommentAnchorStale
			if state == DocumentCommentAnchorLost {
				resolved = DocumentCommentAnchorLost
			} else if v.Version == doc.CurrentVersion {
				resolved = DocumentCommentAnchorExact
			}
			// R1-7: a lost report keeps the last known position - the stored
			// anchor bytes and its version stay, only anchor_state moves. The
			// version rule above still skips an older version first.
			writeAnchor, writeVersionID := canonical, v.ID
			if state == DocumentCommentAnchorLost && len(c.Anchor) > 0 && c.AnchorVersionID.Valid && c.AnchorVersionID.String != "" {
				writeAnchor, writeVersionID = c.Anchor, c.AnchorVersionID.String
			}
			if !documentCommentAnchorChanged(c, writeAnchor, writeVersionID, resolved) {
				continue
			}
			if _, err := q.UpdateDocumentCommentAnchor(ctx, db.UpdateDocumentCommentAnchorParams{
				ID: c.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
				Anchor: writeAnchor, AnchorVersionID: pgtype.Text{String: writeVersionID, Valid: true},
				AnchorState: pgtype.Text{String: resolved, Valid: true},
			}); err != nil {
				return err
			}
			out.Updated = append(out.Updated, c.ID)
			changed = true
		}
		// The token is computed inside this command's transaction from every
		// row of the document, after the writes (contract section 6).
		rows, err := q.ListDocumentComments(ctx, db.ListDocumentCommentsParams{
			DocumentID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
		})
		if err != nil {
			return err
		}
		out.ListToken = documentCommentListToken(rows)
		if !changed {
			return nil
		}
		return auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			Actor: actor, Action: audit.ActionDocumentCommentAnchorsUpdated,
			ResourceType: "document", ResourceID: doc.ID,
			Metadata: map[string]any{"comment_ids": out.Updated, "version_id": v.ID},
		}, audit.Event{Topic: audit.ActionDocumentCommentAnchorsUpdated, Payload: map[string]string{
			"document_id": doc.ID, "workspace_id": doc.WorkspaceID, "version_id": v.ID,
		}})
	})
	return out, err
}

// documentCommentAnchorChanged reports whether one accepted item differs from
// what the row already holds: the same payload must not bump updated_at or
// move the list_token (rule 4). jsonb hands back its own spelling, so anchor
// bytes compare by meaning.
func documentCommentAnchorChanged(c db.DocumentComment, canonical []byte, versionID, state string) bool {
	if !c.AnchorVersionID.Valid || c.AnchorVersionID.String != versionID {
		return true
	}
	if !c.AnchorState.Valid || c.AnchorState.String != state {
		return true
	}
	if len(c.Anchor) == 0 || len(canonical) == 0 {
		return len(c.Anchor) != len(canonical)
	}
	left, errLeft := canonicalJSON(c.Anchor)
	right, errRight := canonicalJSON(canonical)
	return errLeft != nil || errRight != nil || !bytes.Equal(left, right)
}
