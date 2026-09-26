package files

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestDefaultRegistryCoversTheEnum(t *testing.T) {
	specs := DefaultRegistry().Specs()
	if len(specs) != len(Purposes()) {
		t.Fatalf("registry has %d rows, the enum declares %d purposes", len(specs), len(Purposes()))
	}

	seen := map[UploadPurpose]bool{}
	prefixes := map[string]UploadPurpose{}
	for _, spec := range specs {
		if seen[spec.Purpose] {
			t.Errorf("purpose %q is declared twice", spec.Purpose)
		}
		seen[spec.Purpose] = true
		if !spec.Purpose.Valid() {
			t.Errorf("registry declares %q, which is not in the enum", spec.Purpose)
		}
		if spec.Prefix == "" || strings.HasPrefix(spec.Prefix, "/") || strings.HasSuffix(spec.Prefix, "/") {
			t.Errorf("purpose %q has prefix %q", spec.Purpose, spec.Prefix)
		}
		if other, dup := prefixes[spec.Prefix]; dup {
			t.Errorf("purposes %q and %q share the prefix %q", other, spec.Purpose, spec.Prefix)
		}
		prefixes[spec.Prefix] = spec.Purpose
		if spec.Policy.MaxBytes <= 0 {
			t.Errorf("purpose %q has no byte cap", spec.Purpose)
		}
		if len(spec.Policy.MIMEAllowlist) == 0 {
			t.Errorf("purpose %q has an empty MIME allowlist", spec.Purpose)
		}
		for _, ct := range spec.Policy.MIMEAllowlist {
			if NormalizeContentType(ct) != ct {
				t.Errorf("purpose %q lists malformed MIME type %q", spec.Purpose, ct)
			}
		}
		switch spec.Policy.ReadMode {
		case ReadPresign, ReadProxy:
		default:
			t.Errorf("purpose %q has read mode %q", spec.Purpose, spec.Policy.ReadMode)
		}
	}
	for _, purpose := range Purposes() {
		if !seen[purpose] {
			t.Errorf("purpose %q has no registry row: an enum value without a row is unreachable", purpose)
		}
	}
}

// The Document purposes are declared and disabled (FS-C1 section 5.6): a
// consumer may name them, and the registry refuses them until their policy and
// reference provider exist.
func TestDocumentPurposesAreDeclaredAndDisabled(t *testing.T) {
	registry := DefaultRegistry()
	for _, purpose := range []UploadPurpose{DocumentFile, DocumentAsset} {
		spec, err := registry.Lookup(purpose)
		if err == nil {
			t.Fatalf("purpose %q is enabled in the real registry", purpose)
		}
		var fe *Error
		if !errors.As(err, &fe) {
			t.Fatalf("lookup %q returned %T, want *Error", purpose, err)
		}
		if fe.Code != CodePurposeDisabled || fe.Status != http.StatusBadRequest {
			t.Errorf("lookup %q returned %s/%d, want %s/400", purpose, fe.Code, fe.Status, CodePurposeDisabled)
		}
		if spec.Purpose != "" || spec.Prefix != "" {
			t.Errorf("lookup %q returned a spec alongside the refusal: %+v", purpose, spec)
		}
		if registry.Enabled(purpose) {
			t.Errorf("Enabled(%q) = true", purpose)
		}
	}
}

// The policies FS-C1 fixes for Documents, pinned: a Documents file is read
// through the proxy (DOC-004 never exposes the storage key) and carries a
// checksum.
func TestDocumentPoliciesMatchTheContract(t *testing.T) {
	specs := map[UploadPurpose]PurposeSpec{}
	for _, spec := range DefaultSpecs() {
		specs[spec.Purpose] = spec
	}

	file := specs[DocumentFile]
	if file.Policy.MaxBytes != 50<<20 {
		t.Errorf("document_file cap = %d, want 50 MiB", file.Policy.MaxBytes)
	}
	if !file.Policy.ChecksumRequired {
		t.Error("document_file must require a checksum")
	}
	if file.Policy.ReadMode != ReadProxy {
		t.Errorf("document_file read mode = %q, want %q", file.Policy.ReadMode, ReadProxy)
	}
	if file.Scope != ScopeOrgWorkspace {
		t.Errorf("document_file scope = %q, want %q", file.Scope, ScopeOrgWorkspace)
	}

	asset := specs[DocumentAsset]
	if asset.Policy.MaxBytes != 10<<20 {
		t.Errorf("document_asset cap = %d, want 10 MiB", asset.Policy.MaxBytes)
	}
	if !asset.Policy.ChecksumRequired {
		t.Error("document_asset must require a checksum")
	}
	if asset.Policy.ReadMode != ReadProxy {
		t.Errorf("document_asset read mode = %q, want %q", asset.Policy.ReadMode, ReadProxy)
	}
}

// Caps the pipelines publish today, pinned so a registry edit that changes a
// limit has to say so.
func TestCapsFollowThePublishedPipelines(t *testing.T) {
	specs := map[UploadPurpose]PurposeSpec{}
	for _, spec := range DefaultSpecs() {
		specs[spec.Purpose] = spec
	}
	caps := map[UploadPurpose]int64{
		UserAvatar:     2 << 20,
		TaskAttachment: 25 << 20,
		ChatVoice:      4 << 20,
	}
	for purpose, want := range caps {
		if got := specs[purpose].Policy.MaxBytes; got != want {
			t.Errorf("%s cap = %d, want %d", purpose, got, want)
		}
	}
}

func TestRegistryRejectsBadTables(t *testing.T) {
	valid := PurposeSpec{
		Purpose: TaskAttachment, Prefix: "tasks/attachments", Scope: ScopeOrgWorkspace,
		Policy: Policy{MaxBytes: 1 << 20, MIMEAllowlist: []string{"image/png"}, ReadMode: ReadProxy},
	}

	cases := []struct {
		name  string
		specs []PurposeSpec
	}{
		{"unknown purpose", []PurposeSpec{{Purpose: "not_a_purpose", Prefix: "x", Scope: ScopeOrg, Policy: valid.Policy}}},
		{"duplicate purpose", []PurposeSpec{valid, valid}},
		{"empty prefix", []PurposeSpec{{Purpose: TaskAttachment, Prefix: "", Scope: valid.Scope, Policy: valid.Policy}}},
		{"trailing slash", []PurposeSpec{{Purpose: TaskAttachment, Prefix: "tasks/", Scope: valid.Scope, Policy: valid.Policy}}},
		{"duplicate prefix", []PurposeSpec{valid, {Purpose: ChatAttachment, Prefix: valid.Prefix, Scope: valid.Scope, Policy: valid.Policy}}},
		{"unknown scope shape", []PurposeSpec{{Purpose: TaskAttachment, Prefix: "x", Scope: "team", Policy: valid.Policy}}},
		{"no cap", []PurposeSpec{{Purpose: TaskAttachment, Prefix: "x", Scope: valid.Scope, Policy: Policy{MIMEAllowlist: []string{"image/png"}, ReadMode: ReadProxy}}}},
		{"empty allowlist", []PurposeSpec{{Purpose: TaskAttachment, Prefix: "x", Scope: valid.Scope, Policy: Policy{MaxBytes: 1, ReadMode: ReadProxy}}}},
		{"malformed mime", []PurposeSpec{{Purpose: TaskAttachment, Prefix: "x", Scope: valid.Scope, Policy: Policy{MaxBytes: 1, MIMEAllowlist: []string{"Image/PNG"}, ReadMode: ReadProxy}}}},
		{"unknown read mode", []PurposeSpec{{Purpose: TaskAttachment, Prefix: "x", Scope: valid.Scope, Policy: Policy{MaxBytes: 1, MIMEAllowlist: []string{"image/png"}, ReadMode: "stream"}}}},
	}
	for _, tc := range cases {
		if _, err := NewRegistry(tc.specs...); err == nil {
			t.Errorf("%s: NewRegistry accepted the table", tc.name)
		}
	}
	if _, err := NewRegistry(valid); err != nil {
		t.Fatalf("NewRegistry refused a valid row: %v", err)
	}
}

func TestPurposesReturnsACopy(t *testing.T) {
	first := Purposes()
	if len(first) == 0 {
		t.Fatal("no purposes declared")
	}
	first[0] = "mutated"
	if Purposes()[0] == "mutated" {
		t.Error("Purposes handed out the package's own slice")
	}
}

func TestValidateScopeRefusesMissingAndExtraTenantFields(t *testing.T) {
	user := PurposeSpec{Purpose: UserAvatar, Scope: ScopeUser}
	org := PurposeSpec{Purpose: AuditExport, Scope: ScopeOrg}
	workspace := PurposeSpec{Purpose: TaskAttachment, Scope: ScopeOrgWorkspace}
	optional := PurposeSpec{Purpose: ChatAttachment, Scope: ScopeOrgWorkspaceOptional}

	accepted := []struct {
		name  string
		spec  PurposeSpec
		scope Scope
	}{
		{"user scope", user, Scope{UserID: "u1"}},
		{"organization scope", org, Scope{OrganizationID: "o1"}},
		{"workspace scope", workspace, Scope{OrganizationID: "o1", WorkspaceID: "w1"}},
		{"optional workspace scope with a workspace", optional, Scope{OrganizationID: "o1", WorkspaceID: "w1"}},
		{"optional workspace scope without a workspace", optional, Scope{OrganizationID: "o1"}},
	}
	for _, tc := range accepted {
		if err := tc.spec.ValidateScope(tc.scope); err != nil {
			t.Errorf("%s: %v", tc.name, err)
		}
	}

	refused := []struct {
		name  string
		spec  PurposeSpec
		scope Scope
	}{
		{"user without a user", user, Scope{}},
		{"user with a tenant", user, Scope{UserID: "u1", OrganizationID: "o1"}},
		{"organization without an organization", org, Scope{}},
		{"organization with a workspace", org, Scope{OrganizationID: "o1", WorkspaceID: "w1"}},
		{"workspace without a workspace", workspace, Scope{OrganizationID: "o1"}},
		{"optional workspace without an organization", optional, Scope{WorkspaceID: "w1"}},
		{"unknown shape", PurposeSpec{Purpose: UserAvatar, Scope: "team"}, Scope{UserID: "u1"}},
	}
	for _, tc := range refused {
		err := tc.spec.ValidateScope(tc.scope)
		var fe *Error
		if !errors.As(err, &fe) || fe.Code != CodeScopeInvalid || fe.Status != http.StatusBadRequest {
			t.Errorf("%s: got %v, want %s/400", tc.name, err, CodeScopeInvalid)
		}
	}
}

func TestPolicyAllowsIgnoresParameters(t *testing.T) {
	policy := Policy{MIMEAllowlist: []string{"image/png", "text/plain"}}
	for _, ct := range []string{"image/png", "IMAGE/PNG", "image/png; charset=binary", "text/plain; charset=utf-8"} {
		if !policy.Allows(ct) {
			t.Errorf("Allows(%q) = false", ct)
		}
	}
	for _, ct := range []string{"", "image/jpeg", "image/pngx"} {
		if policy.Allows(ct) {
			t.Errorf("Allows(%q) = true", ct)
		}
	}
}

// The contract suite drives the same shapes through an implementation's public
// API; this keeps the interface itself honest, including the database handle
// ClaimInTx and ReleaseInTx take.
type testProvider struct{}

func (testProvider) Name() string { return "test.provider" }
func (testProvider) Purposes() []UploadPurpose {
	return []UploadPurpose{TaskAttachment}
}
func (testProvider) HeldBy(context.Context, *db.Queries, []FileID) (map[FileID]HoldReason, error) {
	return map[FileID]HoldReason{"01J8ZQ0K7V9W1Y2X3Z4A5B6C7D": HoldVersionHistory}, nil
}

func TestReferenceProviderShapeIsUsable(t *testing.T) {
	var provider ReferenceProvider = testProvider{}
	if provider.Name() != "test.provider" {
		t.Errorf("Name = %q", provider.Name())
	}
	if got := provider.Purposes(); len(got) != 1 || got[0] != TaskAttachment {
		t.Errorf("Purposes = %v", got)
	}
	held, err := provider.HeldBy(context.Background(), nil, []FileID{"01J8ZQ0K7V9W1Y2X3Z4A5B6C7D"})
	if err != nil {
		t.Fatalf("HeldBy: %v", err)
	}
	if held["01J8ZQ0K7V9W1Y2X3Z4A5B6C7D"] != HoldVersionHistory {
		t.Errorf("hold reason = %q", held["01J8ZQ0K7V9W1Y2X3Z4A5B6C7D"])
	}
	for _, reason := range []HoldReason{HoldActive, HoldVersionHistory, HoldSoftDeleted, HoldRetention, HoldLegalHold} {
		if reason == "" {
			t.Error("a hold reason is empty")
		}
	}
}

// The two deadlines FS-C1 fixes, pinned at the contract layer where every
// implementation reads them.
func TestContractDeadlines(t *testing.T) {
	if ClaimTTL.Hours() != 24 {
		t.Errorf("ClaimTTL = %s, want 24h (T1-Q5)", ClaimTTL)
	}
	if MaxResolveURLTTL.Hours() != 12 {
		t.Errorf("MaxResolveURLTTL = %s, want 12h (T1-Q7)", MaxResolveURLTTL)
	}
}
