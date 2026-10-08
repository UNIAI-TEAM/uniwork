package service

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// OfficeFrameService mints and checks the token of the Office Docs web frame
// (UNI-1013). The host page mints one with its session; the frame presents it
// as its only credential. A token is stateless and server-signed, and binds
// exactly one document, its workspace and organization, and the user. It
// grants nothing by itself: every request it carries is re-authorized through
// DocumentService as that user, so a revoked share or membership stops the
// next call, and the short lifetime bounds a leaked token.
type OfficeFrameService struct {
	documents *DocumentService
	key       []byte
	ttl       time.Duration
	now       func() time.Time
}

// OfficeFrameTokenTTL is the lifetime of a frame token and of a signed image
// URL. The frame refreshes before it ends.
const OfficeFrameTokenTTL = 10 * time.Minute

const (
	officeFrameTokenPrefix = "oft1."
	officeFrameAssetPrefix = "ofa1."
	officeFrameDocxMime    = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)

// ErrOfficeFrameToken is every invalid, expired or foreign frame credential;
// the handler answers it with one 401 so nothing about the document leaks.
var ErrOfficeFrameToken = errors.New("office_frame_token_invalid")

// OfficeFrameClaims are what a frame token binds.
type OfficeFrameClaims struct {
	Version        int    `json:"v"`
	DocumentID     string `json:"d"`
	WorkspaceID    string `json:"w"`
	OrganizationID string `json:"o"`
	UserID         string `json:"u"`
	ExpiresAt      int64  `json:"e"`
	Nonce          string `json:"n"`
}

// OfficeFrameToken is a minted token with what the host needs to hand over.
type OfficeFrameToken struct {
	Token     string
	ExpiresAt time.Time
	Claims    OfficeFrameClaims
	CanEdit   bool
}

// OfficeFrameDocument is the frame's open/save view of its document.
type OfficeFrameDocument struct {
	Document db.Document
	Access   DocumentAccess
	File     DocumentFileInfo
}

// OfficeFrameAssetURL is one signed image URL.
type OfficeFrameAssetURL struct {
	AssetID   string
	URL       string
	ExpiresAt time.Time
}

type officeFrameAssetClaims struct {
	DocumentID     string `json:"d"`
	AssetID        string `json:"a"`
	WorkspaceID    string `json:"w"`
	OrganizationID string `json:"o"`
	UserID         string `json:"u"`
	ExpiresAt      int64  `json:"e"`
}

// NewOfficeFrameService derives its signing key from secret (the JWT secret)
// under its own label, so a frame token can never pass for an access token or
// a preview capability and the other way round.
func NewOfficeFrameService(documents *DocumentService, secret string) *OfficeFrameService {
	if documents == nil || len(secret) == 0 {
		return nil
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("uniwork/office-frame/v1"))
	return &OfficeFrameService{documents: documents, key: mac.Sum(nil), ttl: OfficeFrameTokenTTL, now: time.Now}
}

// SetClock replaces the clock (tests).
func (s *OfficeFrameService) SetClock(now func() time.Time) {
	if now == nil {
		now = time.Now
	}
	s.now = now
}

// Mint checks that actor may view documentID, that it is a live DOCX file
// document, and signs a token for it. The caller cannot choose the lifetime
// or any bound id.
func (s *OfficeFrameService) Mint(ctx context.Context, actor Actor, documentID string) (OfficeFrameToken, error) {
	if s == nil || actor.Kind != "human" || actor.ID == "" {
		return OfficeFrameToken{}, ErrNotFound
	}
	d, err := s.load(ctx, actor, documentID)
	if err != nil {
		return OfficeFrameToken{}, err
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return OfficeFrameToken{}, err
	}
	expires := s.now().Add(s.ttl)
	claims := OfficeFrameClaims{
		Version: 1, DocumentID: d.Document.ID, WorkspaceID: d.Document.WorkspaceID,
		OrganizationID: d.Document.OrganizationID, UserID: actor.ID,
		ExpiresAt: expires.UnixMilli(), Nonce: base64.RawURLEncoding.EncodeToString(nonce),
	}
	token, err := s.sign(officeFrameTokenPrefix, claims)
	if err != nil {
		return OfficeFrameToken{}, err
	}
	return OfficeFrameToken{Token: token, ExpiresAt: time.UnixMilli(claims.ExpiresAt).UTC(), Claims: claims, CanEdit: d.Access.Level.rank() >= DocumentLevelEdit.rank()}, nil
}

// Refresh mints a fresh token for the same document after rechecking access.
// A document moved to another workspace since the first mint is refused.
func (s *OfficeFrameService) Refresh(ctx context.Context, claims OfficeFrameClaims) (OfficeFrameToken, error) {
	next, err := s.Mint(ctx, Human(claims.UserID), claims.DocumentID)
	if err != nil {
		return OfficeFrameToken{}, err
	}
	if next.Claims.WorkspaceID != claims.WorkspaceID || next.Claims.OrganizationID != claims.OrganizationID {
		return OfficeFrameToken{}, ErrNotFound
	}
	return next, nil
}

// Verify checks signature, version and lifetime. It does not touch the
// database: authorization happens on every call through DocumentService.
func (s *OfficeFrameService) Verify(token string) (OfficeFrameClaims, error) {
	var claims OfficeFrameClaims
	if s == nil || !s.verify(officeFrameTokenPrefix, token, &claims) {
		return OfficeFrameClaims{}, ErrOfficeFrameToken
	}
	if claims.Version != 1 || claims.DocumentID == "" || claims.WorkspaceID == "" || claims.OrganizationID == "" || claims.UserID == "" || claims.ExpiresAt <= s.now().UnixMilli() {
		return OfficeFrameClaims{}, ErrOfficeFrameToken
	}
	return claims, nil
}

// Open is the frame's view of its document, rechecked as the token's user.
func (s *OfficeFrameService) Open(ctx context.Context, claims OfficeFrameClaims) (OfficeFrameDocument, error) {
	d, err := s.Authorize(ctx, claims)
	if err != nil {
		return OfficeFrameDocument{}, err
	}
	s.documents.RecordDocumentRead(ctx, Human(claims.UserID), d.Document, d.Access, DocumentAccessView, nil)
	return d, nil
}

// Authorize rechecks that the token's user may still view its document and
// that the document is still the DOCX in the workspace the token names; a
// document moved to another workspace is refused like a missing one.
func (s *OfficeFrameService) Authorize(ctx context.Context, claims OfficeFrameClaims) (OfficeFrameDocument, error) {
	d, err := s.load(ctx, Human(claims.UserID), claims.DocumentID)
	if err != nil {
		return OfficeFrameDocument{}, err
	}
	if d.Document.WorkspaceID != claims.WorkspaceID || d.Document.OrganizationID != claims.OrganizationID {
		return OfficeFrameDocument{}, ErrNotFound
	}
	return d, nil
}

// load authorizes view and keeps only live DOCX file documents: the frame is
// the genoffice Docs editor and opens nothing else.
func (s *OfficeFrameService) load(ctx context.Context, actor Actor, documentID string) (OfficeFrameDocument, error) {
	doc, access, err := s.documents.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return OfficeFrameDocument{}, err
	}
	if doc.Kind != DocumentKindFile || doc.ArchivedAt.Valid {
		return OfficeFrameDocument{}, ErrNotFound
	}
	file, err := s.documents.currentFileInfo(ctx, doc)
	if err != nil {
		return OfficeFrameDocument{}, err
	}
	if file == nil || !officeFrameIsDocx(file.MimeType, file.Filename) {
		return OfficeFrameDocument{}, ErrNotFound
	}
	return OfficeFrameDocument{Document: doc, Access: access, File: *file}, nil
}

func officeFrameIsDocx(mime, filename string) bool {
	base, _, _ := strings.Cut(strings.ToLower(mime), ";")
	return strings.TrimSpace(base) == officeFrameDocxMime || strings.HasSuffix(strings.ToLower(filename), ".docx")
}

// SignAsset returns a URL for one image of the token's document that an <img>
// can load without a header. The signature binds the asset, the document and
// the user and lives as long as a token; the byte route still rechecks view.
func (s *OfficeFrameService) SignAsset(claims OfficeFrameClaims, assetID string) (OfficeFrameAssetURL, error) {
	expires := s.now().Add(s.ttl)
	sig, err := s.sign(officeFrameAssetPrefix, officeFrameAssetClaims{
		DocumentID: claims.DocumentID, AssetID: assetID, WorkspaceID: claims.WorkspaceID,
		OrganizationID: claims.OrganizationID, UserID: claims.UserID, ExpiresAt: expires.UnixMilli(),
	})
	if err != nil {
		return OfficeFrameAssetURL{}, err
	}
	return OfficeFrameAssetURL{
		AssetID:   assetID,
		URL:       "/api/v1/office-frame/documents/" + claims.DocumentID + "/assets/" + assetID + "?sig=" + sig,
		ExpiresAt: time.UnixMilli(expires.UnixMilli()).UTC(),
	}, nil
}

// VerifyAsset returns the frame claims a signed image URL was issued under,
// when it names exactly this document and asset and has not expired. The
// claims open only that asset: the handler serves nothing else with them.
func (s *OfficeFrameService) VerifyAsset(sig, documentID, assetID string) (OfficeFrameClaims, error) {
	var claims officeFrameAssetClaims
	if s == nil || !s.verify(officeFrameAssetPrefix, sig, &claims) {
		return OfficeFrameClaims{}, ErrOfficeFrameToken
	}
	if claims.DocumentID != documentID || claims.AssetID != assetID || claims.UserID == "" || claims.ExpiresAt <= s.now().UnixMilli() {
		return OfficeFrameClaims{}, ErrOfficeFrameToken
	}
	return OfficeFrameClaims{Version: 1, DocumentID: claims.DocumentID, WorkspaceID: claims.WorkspaceID,
		OrganizationID: claims.OrganizationID, UserID: claims.UserID, ExpiresAt: claims.ExpiresAt}, nil
}

// SignAssets signs URLs for assets that belong to the token's document, after
// checking view as the token's user. One foreign or unknown id refuses all.
func (s *OfficeFrameService) SignAssets(ctx context.Context, claims OfficeFrameClaims, assetIDs []string) ([]OfficeFrameAssetURL, error) {
	if len(assetIDs) == 0 || len(assetIDs) > 100 {
		return nil, Invalid("asset_ids cần từ 1 đến 100 mục")
	}
	actor := Human(claims.UserID)
	out := make([]OfficeFrameAssetURL, 0, len(assetIDs))
	for _, id := range assetIDs {
		if _, _, _, err := s.documents.authorizeDocumentAsset(ctx, actor, claims.DocumentID, id, DocumentLevelView); err != nil {
			return nil, err
		}
		u, err := s.SignAsset(claims, id)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, nil
}

// Recents lists the user's recently opened or edited DOCX file documents in
// the token's workspace. It reuses the Documents recent list (the same ACL
// filter) and keeps only what the frame can open.
func (s *OfficeFrameService) Recents(ctx context.Context, claims OfficeFrameClaims, limit int) ([]db.Document, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	page, err := s.documents.ListRecentDocuments(ctx, Human(claims.UserID), claims.WorkspaceID, ListDocumentsInput{Limit: 100})
	if err != nil {
		return nil, err
	}
	out := make([]db.Document, 0, limit)
	for _, item := range page.Items {
		doc := item.Document
		if doc.Kind != DocumentKindFile || doc.ArchivedAt.Valid || doc.OrganizationID != claims.OrganizationID {
			continue
		}
		v, err := s.documents.currentFileVersion(ctx, s.documents.q, doc)
		if err != nil {
			return nil, err
		}
		if v == nil || !officeFrameIsDocx(v.MimeType.String, doc.Title) {
			continue
		}
		out = append(out, doc)
		if len(out) == limit {
			break
		}
	}
	return out, nil
}

func (s *OfficeFrameService) sign(prefix string, claims any) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	body := prefix + base64.RawURLEncoding.EncodeToString(payload)
	return body + "." + base64.RawURLEncoding.EncodeToString(s.mac(body)), nil
}

func (s *OfficeFrameService) verify(prefix, token string, into any) bool {
	rest, ok := strings.CutPrefix(token, prefix)
	if !ok {
		return false
	}
	payload, sig, ok := strings.Cut(rest, ".")
	if !ok || payload == "" || sig == "" {
		return false
	}
	// Strict: one spelling per MAC (see PreviewAssetService.verify).
	got, err := base64.RawURLEncoding.Strict().DecodeString(sig)
	if err != nil || !hmac.Equal(got, s.mac(prefix+payload)) {
		return false
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(payload)
	if err != nil {
		return false
	}
	return json.Unmarshal(raw, into) == nil
}

func (s *OfficeFrameService) mac(body string) []byte {
	m := hmac.New(sha256.New, s.key)
	m.Write([]byte(body))
	return m.Sum(nil)
}

// UploadAsset attaches an image to the token's document with edit access.
// The page orphan sweep never runs on a file document, so the asset is held
// while the document lives and purged with it.
func (s *OfficeFrameService) UploadAsset(ctx context.Context, claims OfficeFrameClaims, in DocumentUploadInput) (db.DocumentAsset, error) {
	if _, err := s.Authorize(ctx, claims); err != nil {
		return db.DocumentAsset{}, err
	}
	return s.documents.uploadDocumentAsset(ctx, Human(claims.UserID), claims.DocumentID, in, func(doc db.Document) bool {
		return doc.Kind == DocumentKindFile && doc.WorkspaceID == claims.WorkspaceID
	})
}
