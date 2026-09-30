package service

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
)

// PreviewAssetService is the capability broker for the isolated preview
// origin. Scope creation is authenticated and goes through DocumentService;
// asset reads carry only an opaque, short-lived token and are re-authorized
// through DocumentService on every request, so a revoked ACL stops the next
// read without a presigned storage URL.
type PreviewAssetService struct {
	documents *DocumentService
	origin    string
	secret    []byte
	ttl       time.Duration
	maxBytes  int64
	now       func() time.Time

	mu      sync.Mutex
	revoked map[string]time.Time
}

type PreviewAssetServiceOptions struct {
	Documents *DocumentService
	Origin    string
	Secret    string
	TTL       time.Duration
	MaxBytes  int64
	Now       func() time.Time
}

type PreviewScopeInput struct {
	DocumentID string
	JobID      string
	AssetIDs   []string
}

type PreviewAssetURL struct {
	AssetID string
	URL     string
}

type PreviewScope struct {
	Origin    string
	ExpiresAt time.Time
	Token     string
	Assets    []PreviewAssetURL
}

var (
	ErrPreviewUnavailable = errors.New("preview_unavailable")
	ErrPreviewCapability  = errors.New("preview_capability_invalid")
)

type previewClaims struct {
	Version    int      `json:"v"`
	DocumentID string   `json:"document_id"`
	JobID      string   `json:"job_id"`
	UserID     string   `json:"user_id"`
	AssetIDs   []string `json:"asset_ids"`
	ExpiresAt  int64    `json:"expires_at"`
	Nonce      string   `json:"nonce"`
}

func NewPreviewAssetService(options PreviewAssetServiceOptions) (*PreviewAssetService, error) {
	origin := strings.TrimRight(strings.TrimSpace(options.Origin), "/")
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, ErrPreviewUnavailable
	}
	if options.Documents == nil || len(strings.TrimSpace(options.Secret)) < 32 || options.TTL <= 0 || options.TTL > time.Hour || options.MaxBytes <= 0 {
		return nil, ErrPreviewUnavailable
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	return &PreviewAssetService{
		documents: options.Documents, origin: origin, secret: []byte(options.Secret), ttl: options.TTL,
		maxBytes: options.MaxBytes, now: now, revoked: make(map[string]time.Time),
	}, nil
}

// Mint authorizes and binds a frame scope to one document, user and job. The
// caller cannot choose a lifetime, URL, storage key or another document.
func (s *PreviewAssetService) Mint(ctx context.Context, actor Actor, in PreviewScopeInput) (PreviewScope, error) {
	if s == nil || actor.Kind != "human" || actor.ID == "" || in.DocumentID == "" || in.JobID == "" || len(in.AssetIDs) > 256 {
		return PreviewScope{}, ErrNotFound
	}
	if err := s.documents.ValidatePreviewAssets(ctx, actor, in.DocumentID, in.AssetIDs); err != nil {
		return PreviewScope{}, ErrNotFound
	}
	now := s.now()
	expires := now.Add(s.ttl)
	nonceBytes := make([]byte, 24)
	if _, err := rand.Read(nonceBytes); err != nil {
		return PreviewScope{}, ErrPreviewUnavailable
	}
	claims := previewClaims{Version: 1, DocumentID: in.DocumentID, JobID: in.JobID, UserID: actor.ID, AssetIDs: append([]string(nil), in.AssetIDs...), ExpiresAt: expires.UnixMilli(), Nonce: base64.RawURLEncoding.EncodeToString(nonceBytes)}
	token, err := s.sign(claims)
	if err != nil {
		return PreviewScope{}, ErrPreviewUnavailable
	}
	assets := make([]PreviewAssetURL, 0, len(in.AssetIDs))
	for _, id := range in.AssetIDs {
		assets = append(assets, PreviewAssetURL{AssetID: id, URL: s.origin + "/api/v1/preview/assets/" + url.PathEscape(token) + "/" + url.PathEscape(id)})
	}
	// The signed claims are stateless so a preview origin can be served by a
	// fleet. `revoked` is only a local fast stop; ACL re-checks remain the
	// authoritative cross-instance revocation mechanism.
	s.mu.Lock()
	s.expireLocked(now)
	s.mu.Unlock()
	return PreviewScope{Origin: s.origin, ExpiresAt: expires, Token: token, Assets: assets}, nil
}

// Open authorizes one broker request and streams only the named manifest
// asset. Invalid, expired, revoked, foreign-document and traversal requests
// all collapse to ErrNotFound so neither document nor asset existence leaks.
func (s *PreviewAssetService) Open(ctx context.Context, token, assetID string) (files.Reader, error) {
	if s == nil || token == "" || !validPreviewAssetID(assetID) {
		return files.Reader{}, ErrNotFound
	}
	now := s.now()
	claims, err := s.verify(token)
	if err != nil || claims.Version != 1 || claims.ExpiresAt <= now.UnixMilli() {
		return files.Reader{}, ErrNotFound
	}
	s.mu.Lock()
	s.expireLocked(now)
	_, revoked := s.revoked[token]
	s.mu.Unlock()
	if revoked {
		return files.Reader{}, ErrNotFound
	}
	allowed := false
	for _, id := range claims.AssetIDs {
		if id == assetID {
			allowed = true
			break
		}
	}
	if !allowed {
		return files.Reader{}, ErrNotFound
	}
	rd, err := s.documents.OpenDocumentAsset(ctx, Human(claims.UserID), claims.DocumentID, assetID, DocumentByteRange{})
	if err != nil {
		return files.Reader{}, ErrNotFound
	}
	if rd.File.SizeBytes < 0 || rd.File.SizeBytes > s.maxBytes {
		_ = rd.Close()
		return files.Reader{}, ErrNotFound
	}
	return rd, nil
}

// Revoke retires a frame scope immediately. It is used when an editor closes
// or replaces a preview, and also makes replay of a captured capability fail.
func (s *PreviewAssetService) Revoke(token string) {
	if s == nil || token == "" {
		return
	}
	s.mu.Lock()
	if claims, err := s.verify(token); err == nil {
		s.revoked[token] = time.UnixMilli(claims.ExpiresAt)
	}
	s.mu.Unlock()
}

func (s *PreviewAssetService) expireLocked(now time.Time) {
	for token, expires := range s.revoked {
		if !now.Before(expires) {
			delete(s.revoked, token)
		}
	}
}

func (s *PreviewAssetService) verify(token string) (previewClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return previewClaims{}, ErrPreviewCapability
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return previewClaims{}, ErrPreviewCapability
	}
	h := hmac.New(sha256.New, s.secret)
	_, _ = h.Write([]byte(parts[0]))
	if !hmac.Equal(signature, h.Sum(nil)) {
		return previewClaims{}, ErrPreviewCapability
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || len(payload) > 64*1024 {
		return previewClaims{}, ErrPreviewCapability
	}
	var claims previewClaims
	if err := json.Unmarshal(payload, &claims); err != nil || claims.DocumentID == "" || claims.UserID == "" || claims.ExpiresAt <= 0 || len(claims.AssetIDs) > 256 {
		return previewClaims{}, ErrPreviewCapability
	}
	return claims, nil
}

func (s *PreviewAssetService) sign(claims previewClaims) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	h := hmac.New(sha256.New, s.secret)
	_, _ = h.Write([]byte(encoded))
	return encoded + "." + base64.RawURLEncoding.EncodeToString(h.Sum(nil)), nil
}
