package service

// UNI-1008 W1: the per-user AI provider key store. Under test: the key is
// sealed at rest and never comes back except through Resolve, the tenant gate
// (an outsider gets the 404 an unknown organization gets), the personal scope
// (another member of the organization never sees or removes the owner's key),
// the office.ai_byok gate on saving only, and the 503 when no
// AI_CREDENTIAL_KEY is configured.

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const testAIKey = "sk-test-0123456789abcdef"

func testAICredentialBox(t *testing.T) *secretbox.Box {
	t.Helper()
	key := make([]byte, secretbox.KeySize)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	box, err := secretbox.New(key)
	if err != nil {
		t.Fatal(err)
	}
	return box
}

type aiCredentialFixture struct {
	ctx    context.Context
	pool   *pgxpool.Pool
	q      *db.Queries
	orgs   *OrganizationService
	svc    *AICredentialService
	orgID  string
	owner  db.User
	second db.User
}

func newAICredentialFixture(t *testing.T) *aiCredentialFixture {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}
	authSvc := NewAuthService(pool, q, minter, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ctx := context.Background()
	owner := registerVerified(t, q, authSvc, "aikey-owner@example.com", "Owner")
	second := registerVerified(t, q, authSvc, "aikey-second@example.com", "Second")
	org, err := orgs.Create(ctx, owner.ID, "AI Key Org", "ai-key-org")
	if err != nil {
		t.Fatal(err)
	}
	return &aiCredentialFixture{
		ctx: ctx, pool: pool, q: q, orgs: orgs,
		svc:   NewAICredentialService(pool, q, orgs, NewEntitlementService(pool, q), testAICredentialBox(t)),
		orgID: org.ID, owner: owner, second: second,
	}
}

func aiCredentialCode(err error) (string, int) {
	var ce CodedError
	if errors.As(err, &ce) {
		return ce.Code, ce.Status
	}
	return "", 0
}

// A PUT that leaves base_url or label out keeps what is stored (a key rotation
// must not reset a regional endpoint); only an explicit "" clears.
func TestAICredentialPutKeepsFieldsItOmits(t *testing.T) {
	f := newAICredentialFixture(t)
	owner := Human(f.owner.ID)
	if _, _, err := f.svc.SaveAICredential(f.ctx, owner, f.orgID, "custom", SaveAICredentialInput{
		APIKey: strPtr(testAIKey), Label: strPtr("Work"), BaseURL: strPtr("https://api.example.com/v1"),
	}); err != nil {
		t.Fatal(err)
	}

	// Rotate the key without naming base_url or label.
	cred, created, err := f.svc.SaveAICredential(f.ctx, owner, f.orgID, "custom", SaveAICredentialInput{APIKey: strPtr("sk-rotated-key-4321")})
	if err != nil || created || cred.Label != "Work" || cred.BaseURL != "https://api.example.com/v1" || cred.KeyHint != "…4321" {
		t.Fatalf("key rotation = %+v, created %v, %v", cred, created, err)
	}
	// Rename without naming base_url or key.
	cred, _, err = f.svc.SaveAICredential(f.ctx, owner, f.orgID, "custom", SaveAICredentialInput{Label: strPtr("Home")})
	if err != nil || cred.Label != "Home" || cred.BaseURL != "https://api.example.com/v1" {
		t.Fatalf("rename = %+v, %v", cred, err)
	}
	// An explicit empty label clears it and leaves base_url alone.
	cred, _, err = f.svc.SaveAICredential(f.ctx, owner, f.orgID, "custom", SaveAICredentialInput{Label: strPtr("")})
	if err != nil || cred.Label != "" || cred.BaseURL != "https://api.example.com/v1" {
		t.Fatalf("clear label = %+v, %v", cred, err)
	}
	// An explicit empty base_url on a provider that has a default resets to it.
	if _, _, err := f.svc.SaveAICredential(f.ctx, owner, f.orgID, "openai", SaveAICredentialInput{
		APIKey: strPtr(testAIKey), BaseURL: strPtr("https://eu.api.openai.com/v1"),
	}); err != nil {
		t.Fatal(err)
	}
	cred, _, err = f.svc.SaveAICredential(f.ctx, owner, f.orgID, "openai", SaveAICredentialInput{BaseURL: strPtr("")})
	if err != nil || cred.BaseURL != "" {
		t.Fatalf("reset base_url = %+v, %v", cred, err)
	}
	// custom still refuses an explicit empty base_url.
	if code, _ := aiCredentialCode(func() error {
		_, _, err := f.svc.SaveAICredential(f.ctx, owner, f.orgID, "custom", SaveAICredentialInput{BaseURL: strPtr("")})
		return err
	}()); code != "base_url_refused" {
		t.Fatalf("custom with empty base_url = %q, want base_url_refused", code)
	}
}

func TestAICredentialRoundTrip(t *testing.T) {
	f := newAICredentialFixture(t)
	owner := Human(f.owner.ID)

	cred, created, err := f.svc.SaveAICredential(f.ctx, owner, f.orgID, "openai", SaveAICredentialInput{
		APIKey: strPtr("  " + testAIKey + "  "), Label: strPtr(" Công việc "),
	})
	if err != nil || !created {
		t.Fatalf("save = %+v, created %v, %v", cred, created, err)
	}
	if cred.Provider != "openai" || cred.Label != "Công việc" || cred.KeyHint != "…cdef" || cred.BaseURL != "" {
		t.Fatalf("saved = %+v", cred)
	}

	// At rest the key is sealed: neither the ciphertext nor any column holds it.
	row, err := f.q.GetProviderCredential(f.ctx, db.GetProviderCredentialParams{OrganizationID: f.orgID, UserID: f.owner.ID, Provider: "openai"})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(row.SecretCiphertext, []byte(testAIKey)) || strings.Contains(row.KeyHint, "0123456789") {
		t.Fatalf("the key is stored in the clear: %+v", row)
	}

	got, err := f.svc.Resolve(f.ctx, f.owner.ID, f.orgID, "openai")
	if err != nil || got.APIKey != testAIKey || got.Provider != "openai" {
		t.Fatalf("resolve = %+v, %v", got.Provider, err)
	}

	// A PUT without a key keeps the stored one and changes only the settings.
	cred, created, err = f.svc.SaveAICredential(f.ctx, owner, f.orgID, "openai", SaveAICredentialInput{
		Label: strPtr("Riêng"), BaseURL: strPtr("https://eu.api.openai.com/v1/"),
	})
	if err != nil || created || cred.Label != "Riêng" || cred.BaseURL != "https://eu.api.openai.com/v1" || cred.KeyHint != "…cdef" {
		t.Fatalf("settings update = %+v, created %v, %v", cred, created, err)
	}
	if got, err := f.svc.Resolve(f.ctx, f.owner.ID, f.orgID, "openai"); err != nil || got.APIKey != testAIKey {
		t.Fatalf("resolve after settings update: %v", err)
	}

	// A new key replaces the old one: 200, not a second row.
	if _, created, err := f.svc.SaveAICredential(f.ctx, owner, f.orgID, "openai", SaveAICredentialInput{APIKey: strPtr("sk-replaced-key-9876")}); err != nil || created {
		t.Fatalf("replace: created %v, %v", created, err)
	}
	list, err := f.svc.ListAICredentials(f.ctx, owner, f.orgID)
	if err != nil || len(list) != 1 || list[0].KeyHint != "…9876" {
		t.Fatalf("list = %+v, %v", list, err)
	}

	if err := f.svc.DeleteAICredential(f.ctx, owner, f.orgID, "openai"); err != nil {
		t.Fatal(err)
	}
	if code, status := aiCredentialCode(f.svc.DeleteAICredential(f.ctx, owner, f.orgID, "openai")); code != "credential_missing" || status != http.StatusNotFound {
		t.Fatalf("second delete = %s %d, want credential_missing 404", code, status)
	}
	if _, err := f.svc.Resolve(f.ctx, f.owner.ID, f.orgID, "openai"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("resolve after delete = %v, want credential_missing", err)
	}
}

func TestAICredentialIsPersonalAndTenantScoped(t *testing.T) {
	f := newAICredentialFixture(t)
	if _, _, err := f.svc.SaveAICredential(f.ctx, Human(f.owner.ID), f.orgID, "anthropic", SaveAICredentialInput{APIKey: strPtr(testAIKey)}); err != nil {
		t.Fatal(err)
	}
	second := Human(f.second.ID)

	// An outsider: 404 on every call, before anything else is looked at.
	if _, err := f.svc.ListAICredentials(f.ctx, second, f.orgID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider list = %v, want ErrNotFound", err)
	}
	if _, _, err := f.svc.SaveAICredential(f.ctx, second, f.orgID, "anthropic", SaveAICredentialInput{APIKey: strPtr(testAIKey)}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider save = %v, want ErrNotFound", err)
	}
	if _, err := f.svc.Resolve(f.ctx, f.second.ID, f.orgID, "anthropic"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider resolve = %v, want ErrNotFound", err)
	}

	// A member shares the tenant, never the key.
	addOrgMember(t, f.q, f.orgID, f.second.ID)
	if list, err := f.svc.ListAICredentials(f.ctx, second, f.orgID); err != nil || len(list) != 0 {
		t.Fatalf("member list = %+v, %v", list, err)
	}
	if code, _ := aiCredentialCode(f.svc.DeleteAICredential(f.ctx, second, f.orgID, "anthropic")); code != "credential_missing" {
		t.Fatalf("member delete of the owner's key = %q, want credential_missing", code)
	}
	if code, _ := aiCredentialCode(func() error { _, err := f.svc.Resolve(f.ctx, f.second.ID, f.orgID, "anthropic"); return err }()); code != "credential_missing" {
		t.Fatalf("member resolve of the owner's key = %q, want credential_missing", code)
	}
	if got, err := f.svc.Resolve(f.ctx, f.owner.ID, f.orgID, "anthropic"); err != nil || got.APIKey != testAIKey {
		t.Fatalf("owner key changed: %v", err)
	}
}

func TestAICredentialSaveNeedsTheEntitlement(t *testing.T) {
	f := newAICredentialFixture(t)
	owner := Human(f.owner.ID)
	if _, _, err := f.svc.SaveAICredential(f.ctx, owner, f.orgID, "gemini", SaveAICredentialInput{APIKey: strPtr(testAIKey)}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE subscriptions SET overrides = '{"office.ai_byok": false}'::jsonb WHERE organization_id = $1`, f.orgID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := f.svc.SaveAICredential(f.ctx, owner, f.orgID, "gemini", SaveAICredentialInput{APIKey: strPtr(testAIKey)}); !errors.Is(err, ErrEntitlementRequired) {
		t.Fatalf("save without office.ai_byok = %v, want entitlement_required", err)
	}
	// Listing and deleting stay open, so a downgraded plan can still remove a key.
	if list, err := f.svc.ListAICredentials(f.ctx, owner, f.orgID); err != nil || len(list) != 1 {
		t.Fatalf("list without the entitlement = %+v, %v", list, err)
	}
	if err := f.svc.DeleteAICredential(f.ctx, owner, f.orgID, "gemini"); err != nil {
		t.Fatalf("delete without the entitlement = %v", err)
	}
}

func TestAICredentialWithoutKeyAnswers503(t *testing.T) {
	f := newAICredentialFixture(t)
	svc := NewAICredentialService(f.pool, f.q, f.orgs, NewEntitlementService(f.pool, f.q), nil)
	owner := Human(f.owner.ID)
	for name, err := range map[string]error{
		"list": func() error { _, err := svc.ListAICredentials(f.ctx, owner, f.orgID); return err }(),
		"save": func() error {
			_, _, err := svc.SaveAICredential(f.ctx, owner, f.orgID, "openai", SaveAICredentialInput{APIKey: strPtr(testAIKey)})
			return err
		}(),
		"delete":  svc.DeleteAICredential(f.ctx, owner, f.orgID, "openai"),
		"resolve": func() error { _, err := svc.Resolve(f.ctx, f.owner.ID, f.orgID, "openai"); return err }(),
	} {
		if code, status := aiCredentialCode(err); code != "ai_credentials_unavailable" || status != http.StatusServiceUnavailable {
			t.Errorf("%s without AI_CREDENTIAL_KEY = %v, want 503 ai_credentials_unavailable", name, err)
		}
	}
	// An outsider still learns nothing about the configuration.
	if _, err := svc.ListAICredentials(f.ctx, Human(f.second.ID), f.orgID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider list without a key = %v, want ErrNotFound", err)
	}
}

func TestAICredentialRefusesBadInput(t *testing.T) {
	f := newAICredentialFixture(t)
	owner := Human(f.owner.ID)
	cases := []struct {
		name, provider string
		in             SaveAICredentialInput
		code           string
	}{
		{"unknown provider", "codex", SaveAICredentialInput{APIKey: strPtr(testAIKey)}, "provider_not_supported"},
		{"no key on create", "openai", SaveAICredentialInput{Label: strPtr("x")}, ""},
		{"custom without base url", "custom", SaveAICredentialInput{APIKey: strPtr(testAIKey)}, "base_url_refused"},
		{"http base url", "custom", SaveAICredentialInput{APIKey: strPtr(testAIKey), BaseURL: strPtr("http://api.example.com/v1")}, "base_url_refused"},
		{"long label", "openai", SaveAICredentialInput{APIKey: strPtr(testAIKey), Label: strPtr(strings.Repeat("a", maxAICredentialLabel+1))}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := f.svc.SaveAICredential(f.ctx, owner, f.orgID, tc.provider, tc.in)
			if tc.code == "" {
				var ve ValidationError
				if !errors.As(err, &ve) {
					t.Fatalf("err = %v, want ValidationError", err)
				}
				return
			}
			if code, _ := aiCredentialCode(err); code != tc.code {
				t.Fatalf("err = %v, want %s", err, tc.code)
			}
		})
	}
	if list, err := f.svc.ListAICredentials(f.ctx, owner, f.orgID); err != nil || len(list) != 0 {
		t.Fatalf("nothing may be stored: %+v, %v", list, err)
	}
}

// UNI-1240: the chosen model travels with the credential, so another browser
// of the same account starts from it. A model-only PUT switches it without
// the key, a PUT that leaves model out keeps it, "" clears it, choosing a
// model moves model_updated_at (the latest one is the default provider), and
// the audit row names the model.
func TestAICredentialModelIsSavedWithoutTheKey(t *testing.T) {
	f := newAICredentialFixture(t)
	owner := Human(f.owner.ID)

	cred, created, err := f.svc.SaveAICredential(f.ctx, owner, f.orgID, "openai", SaveAICredentialInput{APIKey: strPtr(testAIKey)})
	if err != nil || !created || cred.Model != "" || !cred.ModelUpdatedAt.IsZero() {
		t.Fatalf("save without model = %+v, created %v, %v", cred, created, err)
	}
	if _, _, err := f.svc.SaveAICredential(f.ctx, owner, f.orgID, "anthropic", SaveAICredentialInput{
		APIKey: strPtr(testAIKey), Model: strPtr(" claude-sonnet-4-5 "),
	}); err != nil {
		t.Fatal(err)
	}

	// A model-only PUT keeps the key, label and base URL.
	cred, created, err = f.svc.SaveAICredential(f.ctx, owner, f.orgID, "openai", SaveAICredentialInput{Model: strPtr("gpt-4.1-mini")})
	if err != nil || created || cred.Model != "gpt-4.1-mini" || cred.KeyHint != "…cdef" || cred.ModelUpdatedAt.IsZero() {
		t.Fatalf("model-only PUT = %+v, created %v, %v", cred, created, err)
	}
	if got, err := f.svc.Resolve(f.ctx, f.owner.ID, f.orgID, "openai"); err != nil || got.APIKey != testAIKey {
		t.Fatalf("resolve after model change: %v", err)
	}
	modelSetAt := cred.ModelUpdatedAt

	// A key rotation or a rename keeps the model and its time.
	cred, _, err = f.svc.SaveAICredential(f.ctx, owner, f.orgID, "openai", SaveAICredentialInput{APIKey: strPtr("sk-rotated-key-4321"), Label: strPtr("Work")})
	if err != nil || cred.Model != "gpt-4.1-mini" || !cred.ModelUpdatedAt.Equal(modelSetAt) {
		t.Fatalf("rotation = %+v, %v", cred, err)
	}

	list, err := f.svc.ListAICredentials(f.ctx, owner, f.orgID)
	if err != nil || len(list) != 2 {
		t.Fatalf("list = %+v, %v", list, err)
	}
	byProvider := map[string]AICredential{}
	for _, c := range list {
		byProvider[c.Provider] = c
	}
	if byProvider["anthropic"].Model != "claude-sonnet-4-5" || byProvider["openai"].Model != "gpt-4.1-mini" {
		t.Fatalf("listed models = %+v", byProvider)
	}
	if !byProvider["openai"].ModelUpdatedAt.After(byProvider["anthropic"].ModelUpdatedAt) {
		t.Fatalf("the model chosen last must carry the latest time: %+v", byProvider)
	}

	// Choosing the same model again still makes that provider the latest.
	cred, _, err = f.svc.SaveAICredential(f.ctx, owner, f.orgID, "anthropic", SaveAICredentialInput{Model: strPtr("claude-sonnet-4-5")})
	if err != nil || !cred.ModelUpdatedAt.After(modelSetAt) {
		t.Fatalf("re-choose = %+v, %v", cred, err)
	}

	// "" clears it.
	cred, _, err = f.svc.SaveAICredential(f.ctx, owner, f.orgID, "openai", SaveAICredentialInput{Model: strPtr("")})
	if err != nil || cred.Model != "" || cred.KeyHint != "…4321" {
		t.Fatalf("clear model = %+v, %v", cred, err)
	}

	// A model alone cannot create a credential, and a bad id is refused.
	var ve ValidationError
	if _, _, err := f.svc.SaveAICredential(f.ctx, owner, f.orgID, "gemini", SaveAICredentialInput{Model: strPtr("gemini-2.5-pro")}); !errors.As(err, &ve) {
		t.Fatalf("model without a stored key = %v, want ValidationError", err)
	}
	if _, _, err := f.svc.SaveAICredential(f.ctx, owner, f.orgID, "openai", SaveAICredentialInput{Model: strPtr("gpt 4")}); !errors.As(err, &ve) {
		t.Fatalf("bad model id = %v, want ValidationError", err)
	}

	var n int
	if err := f.pool.QueryRow(f.ctx, `SELECT count(*) FROM audit_events
		WHERE action = 'ai.credential.saved' AND organization_id = $1
		  AND metadata::jsonb ->> 'model' = 'gpt-4.1-mini' AND metadata::jsonb ->> 'model_changed' = 'true'`, f.orgID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("audit rows naming the model change = %d, %v", n, err)
	}
}

// m7: two saves of one credential from two tabs. The test plays the model-only
// PUT by hand up to the point where it holds the row (read FOR UPDATE, model
// written, not yet committed), starts the real label-only SaveAICredential,
// waits - from a connection of its own - until that save is blocked on the
// row, then commits. The label save must read the committed model and write it
// back; without the row lock it read the old one and put it back over the
// choice.
func TestAICredentialConcurrentSavesKeepEachOthersFields(t *testing.T) {
	f := newAICredentialFixture(t)
	owner := Human(f.owner.ID)
	if _, _, err := f.svc.SaveAICredential(f.ctx, owner, f.orgID, "openai", SaveAICredentialInput{
		APIKey: strPtr(testAIKey), Label: strPtr("Work"),
	}); err != nil {
		t.Fatal(err)
	}

	watch, err := pgx.ConnectConfig(f.ctx, f.pool.Config().ConnConfig.Copy())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = watch.Close(f.ctx) }()

	tx, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(f.ctx) }()
	q := f.q.WithTx(tx)
	stored, err := q.GetProviderCredentialForUpdate(f.ctx, db.GetProviderCredentialForUpdateParams{
		OrganizationID: f.orgID, UserID: f.owner.ID, Provider: "openai",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := q.UpdateProviderCredentialSettings(f.ctx, db.UpdateProviderCredentialSettingsParams{
		OrganizationID: f.orgID, UserID: f.owner.ID, Provider: "openai",
		Label: stored.Label, BaseUrl: stored.BaseUrl, Model: "gpt-4.1-mini", ModelSet: true,
	}); err != nil {
		t.Fatal(err)
	}
	var holderPID uint32
	if err := tx.QueryRow(f.ctx, `SELECT pg_backend_pid()`).Scan(&holderPID); err != nil {
		t.Fatal(err)
	}

	type saved struct {
		cred AICredential
		err  error
	}
	done := make(chan saved, 1)
	go func() {
		cred, _, err := f.svc.SaveAICredential(f.ctx, owner, f.orgID, "openai", SaveAICredentialInput{Label: strPtr("Home")})
		done <- saved{cred, err}
	}()
	deadline := time.Now().Add(10 * time.Second)
	for blocked := false; !blocked; time.Sleep(20 * time.Millisecond) {
		select {
		case r := <-done:
			t.Fatalf("the label save finished (%+v, %v) while the model save held the row", r.cred, r.err)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("the label save never blocked behind the model save")
		}
		var n int
		if err := watch.QueryRow(f.ctx, `SELECT count(*) FROM pg_stat_activity
			WHERE datname = current_database() AND wait_event_type = 'Lock'
			  AND pid <> pg_backend_pid() AND pid <> $1`, holderPID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		blocked = n > 0
	}
	if err := tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	var r saved
	select {
	case r = <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("the label save did not finish after the model save committed")
	}
	if r.err != nil || r.cred.Label != "Home" || r.cred.Model != "gpt-4.1-mini" {
		t.Fatalf("label save = %+v, %v; want label Home and the model the other tab chose", r.cred, r.err)
	}
	list, err := f.svc.ListAICredentials(f.ctx, owner, f.orgID)
	if err != nil || len(list) != 1 || list[0].Label != "Home" || list[0].Model != "gpt-4.1-mini" || list[0].ModelUpdatedAt.IsZero() {
		t.Fatalf("stored credential = %+v, %v; neither save may be lost", list, err)
	}
}

// The validators need no database.

func TestAICredentialModelValidation(t *testing.T) {
	for _, good := range []string{"", "gpt-4.1-mini", "models/gemini-2.5-pro", "anthropic/claude-3.5-sonnet:beta", "meta-llama/Llama-3.3-70B-Instruct", "a@b+c_d"} {
		if got, err := validAICredentialModel("  " + good + " "); err != nil || got != good {
			t.Errorf("validAICredentialModel(%q) = %q, %v", good, got, err)
		}
	}
	for _, bad := range []string{"gpt 4", "gpt-4\nmini", "model?x=1", "mô-hình", "a;b", strings.Repeat("m", maxAICredentialModel+1)} {
		if _, err := validAICredentialModel(bad); err == nil {
			t.Errorf("validAICredentialModel(%q) accepted", bad)
		}
	}
}

func TestAICredentialKeyValidation(t *testing.T) {
	for _, bad := range []string{"", "   ", "sk with space", "sk-\x01ctl", "sk-ключ", strings.Repeat("k", maxAICredentialKey+1)} {
		if _, err := validAICredentialKey(bad); err == nil {
			t.Errorf("validAICredentialKey(%q) accepted", bad)
		}
	}
	if key, err := validAICredentialKey("  " + testAIKey + "\n"); err != nil || key != testAIKey {
		t.Fatalf("trimmed key = %q, %v", key, err)
	}
}

func TestAICredentialKeyHintShowsAtMostFour(t *testing.T) {
	if got := aiCredentialKeyHint(testAIKey); got != "…cdef" {
		t.Fatalf("hint = %q", got)
	}
	if got := aiCredentialKeyHint("short-key"); got != "…" {
		t.Fatalf("short key hint = %q, want … alone", got)
	}
}

func TestAICredentialBaseURLValidation(t *testing.T) {
	for _, bad := range []string{
		"http://api.example.com", "ftp://api.example.com", "https://user:pass@api.example.com",
		"https://", "https://api.example.com/v1?x=1", "https://api.example.com/#f", "api.example.com", "://bad",
	} {
		if _, err := normalizeAICredentialBaseURL(bad); err == nil {
			t.Errorf("normalizeAICredentialBaseURL(%q) accepted", bad)
		} else if code, _ := aiCredentialCode(err); code != "base_url_refused" {
			t.Errorf("normalizeAICredentialBaseURL(%q) = %v, want base_url_refused", bad, err)
		}
	}
	for in, want := range map[string]string{
		"":                                "",
		"  https://api.example.com/v1/  ": "https://api.example.com/v1",
		"https://api.example.com:8443":    "https://api.example.com:8443",
	} {
		if got, err := normalizeAICredentialBaseURL(in); err != nil || got != want {
			t.Errorf("normalizeAICredentialBaseURL(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
}

func TestAICredentialProvidersAreProxyable(t *testing.T) {
	seen := map[string]bool{}
	for _, p := range AIProviders() {
		if seen[p.ID] {
			t.Errorf("provider %s listed twice", p.ID)
		}
		seen[p.ID] = true
		switch p.Protocol {
		case "openai-compatible", "anthropic", "gemini":
		default:
			t.Errorf("provider %s speaks %s, which the proxy cannot carry", p.ID, p.Protocol)
		}
		if p.RequiresBaseURL != (p.DefaultBaseURL == "") {
			t.Errorf("provider %s: requires_base_url %v but default %q", p.ID, p.RequiresBaseURL, p.DefaultBaseURL)
		}
	}
	for _, excluded := range []string{"codex", "genspark"} {
		if seen[excluded] {
			t.Errorf("%s needs a local process or is UniWork's own pool; it must not be a BYOK provider", excluded)
		}
	}
}
