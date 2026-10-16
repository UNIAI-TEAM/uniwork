package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The "other sources" Office frame (UNI-1869, SRC-02b): a file that lives in
// Chat, Tasks, Meetings or Email Hub — a source, not a saved Document — opens
// view-only in the same genoffice web frames UNI-1013/1014/1015/1016 ship. The
// machinery is the document frame's: the same signer, the same 10-minute TTL,
// the same middleware shape, the same module table and per-organization flags.
//
// What differs is the principal. A source token carries a "source" instead of
// a document — `s` names "<source>:<row id>", never a document_id — under its
// own prefix (ofs1.). That prefix is the read-only guarantee: every
// /api/v1/office-frame/documents/* route, saves included, verifies an oft1.
// token and refuses anything else with 401 before a handler runs, and the
// source subtree has no write route to accept an ofs1. token. `ro` is carried
// anyway as defense in depth (OQ-1 decision), but nothing depends on it.
//
// A token grants nothing by itself: every read re-runs the owning domain's own
// gate as the token's user (DocumentSourceService.ViewSource/Open), so a
// revoked membership, a closed room or a deleted row stops the next call, and
// the short lifetime bounds a leaked token.

// OfficeFrameSourceClaims are what a source frame token binds. It is not
// OfficeFrameClaims: a source has no document_id, its workspace travels with
// the source, and its parent is informational (defense in depth — the service
// compares it against the fresh lookup on every call).
type OfficeFrameSourceClaims struct {
	Version int `json:"v"`
	// SourceID is the full "<source>:<row id>" the client named, e.g.
	// "chat:01J8…" — the same spelling every source route takes.
	SourceID string `json:"s"`
	// ParentKind is the API parent kind (chat_channel, chat_dm, task,
	// task_comment, meeting, email_thread); ParentID is its row id.
	ParentKind string `json:"pk"`
	ParentID   string `json:"pid"`
	// WorkspaceID is the workspace the mint was authorized in.
	WorkspaceID    string `json:"w"`
	OrganizationID string `json:"o"`
	UserID         string `json:"u"`
	ExpiresAt      int64  `json:"e"`
	Nonce          string `json:"n"`
	// Module is the genoffice web module, derived from the stored format at
	// mint; empty is docs, as on a document token (one spelling per token).
	Module string `json:"m,omitempty"`
	// ReadOnly is always true: a source frame is view-only by construction.
	ReadOnly bool `json:"ro"`
}

// ModuleName is the token's module, with the absent claim read as docs.
func (c OfficeFrameSourceClaims) ModuleName() string {
	if c.Module == "" {
		return OfficeFrameModuleDocs
	}
	return c.Module
}

// OfficeFrameSourceToken is a minted source token with what the host needs.
type OfficeFrameSourceToken struct {
	Token     string
	ExpiresAt time.Time
	Claims    OfficeFrameSourceClaims
}

// MintSource signs a view-only token for one source file. It authorizes like
// the download route (the workspace gate, then the row through the owning
// domain's list gate) but reads no bytes: email's Open fetches over IMAP, and
// the token grants nothing that a later Open would not re-check.
func (s *OfficeFrameService) MintSource(ctx context.Context, actor Actor, workspaceID, sourceFileID string) (OfficeFrameSourceToken, error) {
	if s == nil || s.sources == nil || actor.Kind != "human" || actor.ID == "" {
		return OfficeFrameSourceToken{}, ErrNotFound
	}
	ws, item, err := s.sources.ViewSource(ctx, actor, workspaceID, sourceFileID)
	if err != nil {
		return OfficeFrameSourceToken{}, err
	}
	module, ok := officeFrameModuleOf(item.MimeType, item.Name)
	if !ok {
		return OfficeFrameSourceToken{}, ErrNotFound
	}
	// After the gate, so a non-member still learns nothing about the file. The
	// refusal still names the module (no token is signed), so the handler can
	// answer the module's flag before the size.
	if limit := officeFrameModuleMaxBytes(module); limit > 0 && item.SizeBytes > limit {
		refused := OfficeFrameSourceClaims{
			Version: 1, SourceID: item.ID, ParentKind: item.Parent.Kind, ParentID: item.Parent.ID,
			WorkspaceID: ws.ID, OrganizationID: ws.OrganizationID, UserID: actor.ID, ReadOnly: true,
		}
		if module != OfficeFrameModuleDocs {
			refused.Module = module
		}
		return OfficeFrameSourceToken{Claims: refused}, ErrOfficeFrameTooLarge
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return OfficeFrameSourceToken{}, err
	}
	expires := s.now().Add(s.ttl)
	claims := OfficeFrameSourceClaims{
		Version: 1, SourceID: item.ID, ParentKind: item.Parent.Kind, ParentID: item.Parent.ID,
		WorkspaceID: ws.ID, OrganizationID: ws.OrganizationID, UserID: actor.ID,
		ExpiresAt: expires.UnixMilli(), Nonce: base64.RawURLEncoding.EncodeToString(nonce), ReadOnly: true,
	}
	if module != OfficeFrameModuleDocs {
		claims.Module = module
	}
	token, err := s.sign(officeFrameSourcePrefix, claims)
	if err != nil {
		return OfficeFrameSourceToken{}, err
	}
	return OfficeFrameSourceToken{Token: token, ExpiresAt: time.UnixMilli(claims.ExpiresAt).UTC(), Claims: claims}, nil
}

// VerifySource checks signature, version, lifetime and shape. It touches no
// database: authorization happens on every call through AuthorizeSource/Open.
func (s *OfficeFrameService) VerifySource(token string) (OfficeFrameSourceClaims, error) {
	var claims OfficeFrameSourceClaims
	if s == nil || !s.verify(officeFrameSourcePrefix, token, &claims) {
		return OfficeFrameSourceClaims{}, ErrOfficeFrameToken
	}
	src, rowID, ok := strings.Cut(claims.SourceID, ":")
	if claims.Version != 1 || !ok || src == "" || rowID == "" ||
		claims.ParentKind == "" || claims.ParentID == "" ||
		claims.WorkspaceID == "" || claims.OrganizationID == "" || claims.UserID == "" ||
		claims.ExpiresAt <= s.now().UnixMilli() || !claims.ReadOnly {
		return OfficeFrameSourceClaims{}, ErrOfficeFrameToken
	}
	if claims.Module == OfficeFrameModuleDocs {
		// Mint never writes m for docs: one spelling per token.
		return OfficeFrameSourceClaims{}, ErrOfficeFrameToken
	}
	if _, ok := OfficeFrameModuleFlag(claims.ModuleName()); !ok {
		return OfficeFrameSourceClaims{}, ErrOfficeFrameToken
	}
	return claims, nil
}

// AuthorizeSource rechecks that the token's user may still read its source and
// that nothing the token bound has moved: the workspace, the organization, the
// parent and the module all still match the fresh lookup. A moved, renamed or
// now-unreadable source is refused like a missing one.
func (s *OfficeFrameService) AuthorizeSource(ctx context.Context, claims OfficeFrameSourceClaims) (db.Workspace, DocumentSourceItem, error) {
	if s == nil || s.sources == nil {
		return db.Workspace{}, DocumentSourceItem{}, ErrNotFound
	}
	ws, item, err := s.sources.ViewSource(ctx, Human(claims.UserID), claims.WorkspaceID, claims.SourceID)
	if err != nil {
		return db.Workspace{}, DocumentSourceItem{}, err
	}
	if ws.OrganizationID != claims.OrganizationID || item.Parent.Kind != claims.ParentKind || item.Parent.ID != claims.ParentID {
		return db.Workspace{}, DocumentSourceItem{}, ErrNotFound
	}
	if module, ok := officeFrameModuleOf(item.MimeType, item.Name); !ok || module != claims.ModuleName() {
		return db.Workspace{}, DocumentSourceItem{}, ErrNotFound
	}
	return ws, item, nil
}

// OpenSource is the frame's byte read: AuthorizeSource, then the source's own
// Open (which re-runs the domain gate and streams the bytes).
func (s *OfficeFrameService) OpenSource(ctx context.Context, claims OfficeFrameSourceClaims) (DocumentSourceFile, error) {
	if _, _, err := s.AuthorizeSource(ctx, claims); err != nil {
		return DocumentSourceFile{}, err
	}
	return s.sources.Open(ctx, Human(claims.UserID), claims.WorkspaceID, claims.SourceID)
}
