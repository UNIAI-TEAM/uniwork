package service

// Per-user AI provider credentials (UNI-1008 GO-A7, ADR 0029): a person's own
// vendor API key, stored sealed so the Office web host can reach the vendor
// through ai.Gateway without the key ever reaching the browser. A row is
// personal - every statement filters by (organization_id, user_id) - and
// organization membership is the only gate, checked with RequireMember. A
// non-member gets ErrNotFound, never a 403, so an organization id cannot be
// probed. The key is sealed with AI_CREDENTIAL_KEY; it never leaves this file
// except as the value Resolve hands to the Gateway for one call. Responses
// carry key_hint only; audit rows carry the provider and the row id.
//
// Saving needs the office.ai_byok entitlement. Listing and deleting do not, so
// a person on a downgraded plan can still see and remove a stored key.
// Removing or deactivating a member deletes nothing: their keys become
// unusable because RequireMember refuses them, and stay until they delete
// them (ADR 0029 known limit).

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Office AI entitlements (ADR 0029). office.ai_byok gates saving a personal
// key and the BYOK proxy; office.ai_cloud gates the UniWork-paid cloud tools.
const (
	FeatureOfficeAIBYOK  = "office.ai_byok"
	FeatureOfficeAICloud = "office.ai_cloud"
)

const (
	// maxAICredentialKey bounds one API key; vendor keys are well under it.
	maxAICredentialKey = 4096
	// maxAICredentialLabel bounds the settings label.
	maxAICredentialLabel = 80
	// maxAICredentialBaseURL bounds a custom endpoint.
	maxAICredentialBaseURL = 2048
	// aiCredentialHintMinKey is the shortest key whose last four characters
	// are shown; a shorter one would show most of itself.
	aiCredentialHintMinKey = 12
)

// AIProviderInfo is one provider a credential may be saved for.
type AIProviderInfo struct {
	ID              string
	Protocol        string // openai-compatible | anthropic | gemini
	RequiresBaseURL bool
	DefaultBaseURL  string
}

// aiCredentialProviders is the BYOK provider table of internal/ai/provider
// (byok.go, mirrored from the Office fork), seen as the API names it.
var aiCredentialProviders = func() []AIProviderInfo {
	rows := provider.BYOKProviders()
	out := make([]AIProviderInfo, 0, len(rows))
	for _, p := range rows {
		out = append(out, AIProviderInfo{ID: p.ID, Protocol: string(p.Protocol), RequiresBaseURL: p.RequiresBaseURL, DefaultBaseURL: p.DefaultBaseURL})
	}
	return out
}()

// AIProviders is the provider list GET /orgs/{orgID}/ai/credentials returns,
// so the web settings need no copy of it.
func AIProviders() []AIProviderInfo {
	return append([]AIProviderInfo(nil), aiCredentialProviders...)
}

func aiProvider(id string) (AIProviderInfo, bool) {
	for _, p := range aiCredentialProviders {
		if p.ID == id {
			return p, true
		}
	}
	return AIProviderInfo{}, false
}

// AICredential is one stored credential as a response may show it: never the
// key, only its hint.
type AICredential struct {
	Provider  string
	Label     string
	BaseURL   string
	KeyHint   string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// SaveAICredentialInput is one PUT. APIKey nil keeps the stored key (an
// update of label or base URL); it is required when nothing is stored yet.
type SaveAICredentialInput struct {
	APIKey  *string
	BaseURL *string
	Label   *string
}

func errAICredentialsUnavailable() error {
	return coded(http.StatusServiceUnavailable, "ai_credentials_unavailable", "máy chủ chưa cấu hình lưu khóa AI")
}

func errCredentialMissing() error {
	return CodedError{Code: "credential_missing", Status: http.StatusNotFound, Err: ErrNotFound,
		Msg: "chưa lưu khóa cho nhà cung cấp này"}
}

func errProviderNotSupported() error {
	return coded(http.StatusBadRequest, "provider_not_supported", "nhà cung cấp AI không được hỗ trợ")
}

func errBaseURLRefused(msg string) error {
	return coded(http.StatusBadRequest, "base_url_refused", msg)
}

// AICredentialService owns the caller's stored provider keys.
type AICredentialService struct {
	pool         *pgxpool.Pool
	q            *db.Queries
	orgs         *OrganizationService
	entitlements *EntitlementService
	box          *secretbox.Box // nil: AI_CREDENTIAL_KEY is not configured
}

// NewAICredentialService wires the store. box nil keeps the server booting and
// answers 503 ai_credentials_unavailable on every credential call.
func NewAICredentialService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService, entitlements *EntitlementService, box *secretbox.Box) *AICredentialService {
	return &AICredentialService{pool: pool, q: q, orgs: orgs, entitlements: entitlements, box: box}
}

// gate is the order every call takes: a real actor, organization membership
// (an outsider learns nothing, not even whether keys are configured), then
// the store itself.
func (s *AICredentialService) gate(ctx context.Context, actor Actor, organizationID string) error {
	if !validActor(actor) {
		return ErrNotFound
	}
	if _, err := s.orgs.RequireMember(ctx, organizationID, actor.ID); err != nil {
		if errors.Is(err, ErrForbidden) {
			return ErrNotFound
		}
		return err
	}
	if s.box == nil {
		return errAICredentialsUnavailable()
	}
	return nil
}

// ListAICredentials is the caller's own credentials in one organization.
func (s *AICredentialService) ListAICredentials(ctx context.Context, actor Actor, organizationID string) ([]AICredential, error) {
	if err := s.gate(ctx, actor, organizationID); err != nil {
		return nil, err
	}
	rows, err := s.q.ListProviderCredentials(ctx, db.ListProviderCredentialsParams{
		OrganizationID: organizationID, UserID: actor.ID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]AICredential, 0, len(rows))
	for _, r := range rows {
		out = append(out, AICredential{Provider: r.Provider, Label: r.Label, BaseURL: r.BaseUrl, KeyHint: r.KeyHint,
			CreatedAt: r.CreatedAt.Time, UpdatedAt: r.UpdatedAt.Time})
	}
	return out, nil
}

// SaveAICredential creates or replaces the caller's credential for one
// provider; created says which. A key is personal and an agent has none of
// its own (ADR 0007), so an agent actor is refused after the membership gate.
func (s *AICredentialService) SaveAICredential(ctx context.Context, actor Actor, organizationID, provider string, in SaveAICredentialInput) (cred AICredential, created bool, err error) {
	if err := s.gate(ctx, actor, organizationID); err != nil {
		return cred, false, err
	}
	if actor.Kind != audit.KindHuman {
		return cred, false, ErrForbidden
	}
	info, ok := aiProvider(provider)
	if !ok {
		return cred, false, errProviderNotSupported()
	}
	if err := s.entitlements.Can(ctx, organizationID, FeatureOfficeAIBYOK); err != nil {
		return cred, false, err
	}

	label := ""
	if in.Label != nil {
		label = strings.TrimSpace(*in.Label)
	}
	if utf8.RuneCountInString(label) > maxAICredentialLabel {
		return cred, false, Invalid(fmt.Sprintf("label must be at most %d characters", maxAICredentialLabel))
	}
	baseURL := ""
	if in.BaseURL != nil {
		if baseURL, err = normalizeAICredentialBaseURL(*in.BaseURL); err != nil {
			return cred, false, err
		}
	}
	if info.RequiresBaseURL && baseURL == "" {
		return cred, false, errBaseURLRefused("base_url is required for this provider")
	}
	var key string
	if in.APIKey != nil {
		if key, err = validAICredentialKey(*in.APIKey); err != nil {
			return cred, false, err
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return cred, false, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	var id string
	if key == "" {
		// No key in the request: change the settings of a stored credential.
		row, err := q.UpdateProviderCredentialSettings(ctx, db.UpdateProviderCredentialSettingsParams{
			OrganizationID: organizationID, UserID: actor.ID, Provider: provider, Label: label, BaseUrl: baseURL,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return cred, false, Invalid("api_key is required")
		}
		if err != nil {
			return cred, false, err
		}
		id = row.ID
		cred = AICredential{Provider: row.Provider, Label: row.Label, BaseURL: row.BaseUrl, KeyHint: row.KeyHint,
			CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time}
	} else {
		sealed, err := s.box.Seal([]byte(key))
		if err != nil {
			return cred, false, err
		}
		row, err := q.UpsertProviderCredential(ctx, db.UpsertProviderCredentialParams{
			ID: util.NewID(), OrganizationID: organizationID, UserID: actor.ID, Provider: provider,
			Label: label, BaseUrl: baseURL, SecretCiphertext: sealed, KeyHint: aiCredentialKeyHint(key),
			CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
		})
		if err != nil {
			return cred, false, err
		}
		id, created = row.ID, row.Created
		cred = AICredential{Provider: row.Provider, Label: row.Label, BaseURL: row.BaseUrl, KeyHint: row.KeyHint,
			CreatedAt: row.CreatedAt.Time, UpdatedAt: row.UpdatedAt.Time}
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: organizationID,
		Actor:          actor, Action: audit.ActionAICredentialSaved,
		ResourceType: "ai_credential", ResourceID: id,
		Metadata: map[string]any{"provider": provider, "key_replaced": key != ""},
	}); err != nil {
		return cred, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return cred, false, err
	}
	return cred, created, nil
}

// DeleteAICredential removes the caller's credential for one provider; none
// stored is credential_missing (404).
func (s *AICredentialService) DeleteAICredential(ctx context.Context, actor Actor, organizationID, provider string) error {
	if err := s.gate(ctx, actor, organizationID); err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	id, err := q.DeleteProviderCredential(ctx, db.DeleteProviderCredentialParams{
		OrganizationID: organizationID, UserID: actor.ID, Provider: provider,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return errCredentialMissing()
	}
	if err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: organizationID,
		Actor:          actor, Action: audit.ActionAICredentialDeleted,
		ResourceType: "ai_credential", ResourceID: id,
		Metadata: map[string]any{"provider": provider},
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Resolve decrypts the caller's credential for one provider so the Gateway
// can make one call with it. It checks membership like every other call;
// the entitlement is the caller's (the proxy) to check.
func (s *AICredentialService) Resolve(ctx context.Context, userID, organizationID, provider string) (ai.BYOKCredential, error) {
	if err := s.gate(ctx, Human(userID), organizationID); err != nil {
		return ai.BYOKCredential{}, err
	}
	if _, ok := aiProvider(provider); !ok {
		return ai.BYOKCredential{}, errProviderNotSupported()
	}
	row, err := s.q.GetProviderCredential(ctx, db.GetProviderCredentialParams{
		OrganizationID: organizationID, UserID: userID, Provider: provider,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ai.BYOKCredential{}, errCredentialMissing()
	}
	if err != nil {
		return ai.BYOKCredential{}, err
	}
	key, err := s.box.Open(row.SecretCiphertext)
	if err != nil {
		// A rotated AI_CREDENTIAL_KEY makes every stored key unreadable; the
		// person saves it again. The cause stays out of the answer.
		return ai.BYOKCredential{}, errCredentialMissing()
	}
	return ai.BYOKCredential{Provider: row.Provider, BaseURL: row.BaseUrl, APIKey: string(key)}, nil
}

// validAICredentialKey trims the key and refuses one that cannot travel in an
// HTTP header.
func validAICredentialKey(raw string) (string, error) {
	key := strings.TrimSpace(raw)
	switch {
	case key == "":
		return "", Invalid("api_key must not be empty")
	case len(key) > maxAICredentialKey:
		return "", Invalid(fmt.Sprintf("api_key must be at most %d bytes", maxAICredentialKey))
	}
	for _, r := range key {
		if r > unicode.MaxASCII || unicode.IsSpace(r) || unicode.IsControl(r) {
			return "", Invalid("api_key must be printable ASCII without spaces")
		}
	}
	return key, nil
}

// aiCredentialKeyHint is "…" plus the last four characters, or "…" alone for
// a key too short to show any of it.
func aiCredentialKeyHint(key string) string {
	if len(key) < aiCredentialHintMinKey {
		return "…"
	}
	return "…" + key[len(key)-4:]
}

// normalizeAICredentialBaseURL accepts an absolute https URL with a host and
// no userinfo, query or fragment; "" means the provider's default. Whether the
// host resolves to a public address is checked at dial time by the proxy
// (ADR 0029 D4), where DNS rebinding cannot slip past it.
func normalizeAICredentialBaseURL(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", nil
	}
	if len(s) > maxAICredentialBaseURL {
		return "", errBaseURLRefused(fmt.Sprintf("base_url must be at most %d characters", maxAICredentialBaseURL))
	}
	u, err := url.Parse(s)
	switch {
	case err != nil:
		return "", errBaseURLRefused("base_url is not a valid URL")
	case u.Scheme != "https":
		return "", errBaseURLRefused("base_url must use https")
	case u.User != nil:
		return "", errBaseURLRefused("base_url must not carry credentials")
	case u.Hostname() == "":
		return "", errBaseURLRefused("base_url must name a host")
	case u.RawQuery != "" || u.Fragment != "" || u.ForceQuery:
		return "", errBaseURLRefused("base_url must not carry a query or fragment")
	}
	return strings.TrimRight(u.String(), "/"), nil
}
