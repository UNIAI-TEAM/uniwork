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

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// OfficeFrameService mints and checks the token of the Office web frames: the
// Docs frame (UNI-1013) and the other genoffice modules (UNI-1014/1015/1016). The host page mints one with its session; the frame presents it
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
// URL. There is no token-to-token renewal: before it ends the frame sends the
// protocol's token.refresh and the host re-mints with its session, so a token
// never outlives the session that minted it by more than one TTL.
const OfficeFrameTokenTTL = 10 * time.Minute

const (
	officeFrameTokenPrefix = "oft1."
	officeFrameAssetPrefix = "ofa1."
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
	// Module is the genoffice web module the token opens, derived from the
	// document's stored format at mint. Empty is docs: a Docs token carries no
	// m, so tokens minted before modules existed stay valid and mean docs.
	Module string `json:"m,omitempty"`
}

// ModuleName is the token's module, with the absent claim read as docs.
func (c OfficeFrameClaims) ModuleName() string {
	if c.Module == "" {
		return OfficeFrameModuleDocs
	}
	return c.Module
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
	Module   string
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

// SetTTL replaces the token lifetime (tests that outlive the default).
func (s *OfficeFrameService) SetTTL(ttl time.Duration) {
	if ttl > 0 {
		s.ttl = ttl
	}
}

// Mint checks that actor may view documentID, that it is a live file document
// one of the web modules opens, and signs a token for it bound to that module. The caller cannot choose the lifetime
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
	if d.Module != OfficeFrameModuleDocs {
		claims.Module = d.Module
	}
	token, err := s.sign(officeFrameTokenPrefix, claims)
	if err != nil {
		return OfficeFrameToken{}, err
	}
	return OfficeFrameToken{Token: token, ExpiresAt: time.UnixMilli(claims.ExpiresAt).UTC(), Claims: claims, CanEdit: d.Access.Level.rank() >= DocumentLevelEdit.rank()}, nil
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
	if claims.Module == OfficeFrameModuleDocs {
		// Mint never writes m for docs: one spelling per token.
		return OfficeFrameClaims{}, ErrOfficeFrameToken
	}
	if _, ok := OfficeFrameModuleFlag(claims.ModuleName()); !ok {
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
// that the document is still in the workspace the token names and still of the
// token's module; a document moved to another workspace, or whose current
// version is now another format, is refused like a missing one.
func (s *OfficeFrameService) Authorize(ctx context.Context, claims OfficeFrameClaims) (OfficeFrameDocument, error) {
	d, err := s.load(ctx, Human(claims.UserID), claims.DocumentID)
	if err != nil {
		return OfficeFrameDocument{}, err
	}
	if d.Document.WorkspaceID != claims.WorkspaceID || d.Document.OrganizationID != claims.OrganizationID || d.Module != claims.ModuleName() {
		return OfficeFrameDocument{}, ErrNotFound
	}
	return d, nil
}

// load authorizes view and keeps only live file documents a web module
// opens; the module comes from the stored file, never from the caller.
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
	if file == nil {
		return OfficeFrameDocument{}, ErrNotFound
	}
	module, ok := officeFrameModuleOf(file.MimeType, file.Filename)
	if !ok {
		return OfficeFrameDocument{}, ErrNotFound
	}
	return OfficeFrameDocument{Document: doc, Access: access, File: *file, Module: module}, nil
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

// Recents lists the user's recently opened or edited file documents of the
// token's module in its workspace. It reuses the Documents recent list (the
// same ACL filter) and keeps only what the frame can open, judged as load
// judges it:
// the current version's mime type or its stored file name. The current
// versions come in one query and the file names in one batch resolve.
func (s *OfficeFrameService) Recents(ctx context.Context, claims OfficeFrameClaims, limit int) ([]db.Document, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	page, err := s.documents.ListRecentDocuments(ctx, Human(claims.UserID), claims.WorkspaceID, ListDocumentsInput{Limit: 100})
	if err != nil {
		return nil, err
	}
	candidates := make([]db.Document, 0, len(page.Items))
	versionIDs := make([]string, 0, len(page.Items))
	for _, item := range page.Items {
		doc := item.Document
		if doc.Kind != DocumentKindFile || doc.ArchivedAt.Valid || !doc.FileVersionID.Valid ||
			doc.OrganizationID != claims.OrganizationID || doc.WorkspaceID != claims.WorkspaceID {
			continue
		}
		candidates = append(candidates, doc)
		versionIDs = append(versionIDs, doc.FileVersionID.String)
	}
	out := make([]db.Document, 0, limit)
	if len(candidates) == 0 {
		return out, nil
	}
	versions, err := s.documents.q.ListDocumentVersionsByIDs(ctx, db.ListDocumentVersionsByIDsParams{
		OrganizationID: claims.OrganizationID, WorkspaceID: claims.WorkspaceID, Ids: versionIDs,
	})
	if err != nil {
		return nil, err
	}
	byID := make(map[string]db.DocumentVersion, len(versions))
	fileIDs := make([]files.FileID, 0, len(versions))
	for _, v := range versions {
		byID[v.ID] = v
		if v.FileID.Valid {
			fileIDs = append(fileIDs, files.FileID(v.FileID.String))
		}
	}
	names := s.fileNames(ctx, claims, fileIDs)
	for _, doc := range candidates {
		v, ok := byID[doc.FileVersionID.String]
		if !ok || v.DocumentID != doc.ID {
			continue
		}
		name := doc.Title
		if n := names[files.FileID(v.FileID.String)]; n != "" {
			name = n
		}
		if m, ok := officeFrameModuleOf(v.MimeType.String, name); !ok || m != claims.ModuleName() {
			continue
		}
		out = append(out, doc)
		if len(out) == limit {
			break
		}
	}
	return out, nil
}

// fileNames resolves the stored names of fileIDs in the token's workspace,
// as currentFileInfo does for one; a file that does not resolve is left out
// and its document falls back to its title.
func (s *OfficeFrameService) fileNames(ctx context.Context, claims OfficeFrameClaims, fileIDs []files.FileID) map[files.FileID]string {
	out := make(map[files.FileID]string, len(fileIDs))
	if s.documents.files == nil || len(fileIDs) == 0 {
		return out
	}
	resolved, err := s.documents.files.ResolveMany(ctx, files.ResolveInput{
		Scope: documentScope(claims.OrganizationID, claims.WorkspaceID), Mode: files.ReadProxy,
		Disposition: files.DispositionAttachment, FileIDs: fileIDs,
	})
	if err != nil {
		return out
	}
	for _, r := range resolved {
		if r.Err == nil && r.File.Filename != "" {
			out[r.File.ID] = r.File.Filename
		}
	}
	return out
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
