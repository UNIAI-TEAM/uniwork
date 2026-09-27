package office

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// Go/TS fixture parity: every fixture under packages/office-contracts/fixtures
// is consumed here and by the vitest suite in packages/office-contracts. If
// the two sides disagree, the contract is broken on at least one side.

var fixturesDir = filepath.Join("..", "..", "..", "packages", "office-contracts", "fixtures")

type fixtureFile struct {
	Fixture  string          `json:"fixture"`
	Value    json.RawMessage `json:"value"`
	Decisive json.RawMessage `json:"decisive"`
	Expected json.RawMessage `json:"expected"`
}

func loadFixture(t *testing.T, name string) fixtureFile {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(fixturesDir, name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	var f fixtureFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("parse fixture %s: %v", name, err)
	}
	return f
}

func TestContractIdentityMatchesTypescript(t *testing.T) {
	if ContractVersion != "uniwork-office-engine-contract/1" {
		t.Fatalf("ContractVersion drifted: %q", ContractVersion)
	}
	if ProtocolVersion != 1 {
		t.Fatalf("ProtocolVersion drifted: %d", ProtocolVersion)
	}
}

func TestErrorTableCompleteAndConsistent(t *testing.T) {
	if len(ErrorCodes) != 26 {
		t.Fatalf("ErrorCodes has %d entries, want 26 (mirror of ENGINE_ERROR_CODES)", len(ErrorCodes))
	}
	for code, spec := range ErrorCodes {
		if spec.Status < 400 || spec.Status > 599 {
			t.Fatalf("%s: implausible status %d", code, spec.Status)
		}
		if spec.ErrorClass == "" || spec.Kind == "" {
			t.Fatalf("%s: empty error_class or kind", code)
		}
	}
	if !ErrorCodes["in_flight"].Retryable || ErrorCodes["grant_expired"].Retryable {
		t.Fatal("retryable flags drifted from the contract table")
	}
	if ErrorCodes["unsupported_operation"].Status != 501 {
		t.Fatal("unsupported_operation must stay the named 501 refusal")
	}
}

func TestEnvelopeFixtureDecodes(t *testing.T) {
	f := loadFixture(t, "envelope-open.v1.json")
	var env Envelope
	if err := json.Unmarshal(f.Value, &env); err != nil {
		t.Fatalf("envelope fixture failed to decode: %v", err)
	}
	if env.Operation != OperationOpen || env.Format != FormatDOCX {
		t.Fatalf("unexpected op/format: %s %s", env.Operation, env.Format)
	}
	if env.ContractVersion != ContractVersion || env.ProtocolVersion != ProtocolVersion {
		t.Fatal("fixture envelope disagrees with contract identity constants")
	}
	var payload OpenPayload
	if err := json.Unmarshal(env.Payload, &payload); err != nil {
		t.Fatalf("open payload failed to decode: %v", err)
	}
	sum := sha256.Sum256([]byte("hello"))
	if payload.InputChecksum != hex.EncodeToString(sum[:]) || payload.InputLength != 5 {
		t.Fatal("fixture input tuple drifted")
	}
}

func TestAuthorityFieldStaysRejectedByContract(t *testing.T) {
	// The violation fixture documents the refusal the boundary produces for
	// an authority-named key: it is not in the operation allowlist, so it is
	// rejected as unknown_field before any job exists. The Go contract types
	// deliberately have no JSON field named output_object_key in any caller
	// payload, so a payload carrying it can never be accepted by accident on
	// this side either.
	f := loadFixture(t, "envelope-authority-violation.v1.json")
	var expected struct {
		FieldPath string `json:"field_path"`
		Rule      string `json:"rule"`
	}
	if err := json.Unmarshal(f.Expected, &expected); err != nil {
		t.Fatal(err)
	}
	if expected.Rule != "unknown_field" || !strings.Contains(expected.FieldPath, "output_object_key") {
		t.Fatalf("fixture drifted: %+v", expected)
	}
	payloadFields := map[string][]string{
		"open":      {"input_bytes", "input_checksum", "input_length", "base_revision", "base_version_id", "edits", "locale", "document_model_ref"},
		"serialize": {"document_model_ref", "base_revision", "base_version_id", "input_bytes", "input_checksum", "input_length"},
	}
	authority := []string{"actor_id", "document_id", "organization_id", "workspace_id",
		"output_object_key", "output_key", "object_key", "storage_key", "bucket",
		"minio_key", "input_object_key", "source_object_key"}
	for op, fields := range payloadFields {
		for _, bad := range authority {
			for _, ok := range fields {
				if ok == bad {
					t.Fatalf("payload allowlist for %s admits authority field %s", op, bad)
				}
			}
		}
	}
}

func TestCapabilityFixtureHonestyRule(t *testing.T) {
	f := loadFixture(t, "result-capability.v1.json")
	var result struct {
		Capabilities []CapabilityEntry `json:"capabilities"`
	}
	if err := json.Unmarshal(f.Value, &result); err != nil {
		t.Fatalf("capability fixture failed to decode: %v", err)
	}
	var expected struct {
		ProductSupported map[string]bool `json:"product_supported"`
	}
	if err := json.Unmarshal(f.Expected, &expected); err != nil {
		t.Fatal(err)
	}
	for _, entry := range result.Capabilities {
		if entry.ProductSupported() != expected.ProductSupported[entry.Operation] {
			t.Fatalf("pending proof became supported for %s", entry.Operation)
		}
		if entry.ProductSupported() && entry.EvidenceLevel != EvidenceProven {
			t.Fatalf("supported capability %s lacks proven evidence", entry.Operation)
		}
	}
}

func TestGrantFixtureDecodes(t *testing.T) {
	f := loadFixture(t, "grant.v1.json")
	var grant JobGrant
	if err := json.Unmarshal(f.Value, &grant); err != nil {
		t.Fatalf("grant fixture failed to decode: %v", err)
	}
	if !grant.SingleUse || grant.Operation != OperationSerialize || grant.Scope != "write_branch" {
		t.Fatalf("grant fixture drifted: %+v", grant)
	}
	var expected struct {
		BindingFields []string `json:"binding_fields"`
	}
	if err := json.Unmarshal(f.Expected, &expected); err != nil {
		t.Fatal(err)
	}
	if len(expected.BindingFields) != 10 {
		t.Fatalf("grant binding field list drifted: %v", expected.BindingFields)
	}
}

func TestErrorEnvelopeFixtureDecodes(t *testing.T) {
	f := loadFixture(t, "error-envelope.v1.json")
	var env ErrorEnvelope
	if err := json.Unmarshal(f.Value, &env); err != nil {
		t.Fatalf("error envelope failed to decode: %v", err)
	}
	spec, ok := ErrorCodes[env.Error.Code]
	if !ok {
		t.Fatalf("error code %q not in the Go error table", env.Error.Code)
	}
	if spec.Status != env.Error.Status || spec.Retryable != env.Error.Retryable {
		t.Fatalf("wire error body disagrees with the Go error table for %s", env.Error.Code)
	}
	if !env.Error.FidelityPreserved {
		t.Fatal("fidelity_preserved must be true on every boundary error")
	}
}

func TestOpenFailureFixtureIsNamedAndBound(t *testing.T) {
	f := loadFixture(t, "open-failure.v1.json")
	var report OpenFailureReport
	if err := json.Unmarshal(f.Value, &report); err != nil {
		t.Fatalf("open-failure fixture failed to decode: %v", err)
	}
	if report.Outcome != "failed" || report.FailureClass != OpenWrongPassword {
		t.Fatalf("P3 report drifted: %+v", report)
	}
	if report.DocumentID == "" {
		t.Fatal("P3 report must stay bound to the document id - never a blank substitute")
	}
}

// canonicalJSON mirrors canonicalJson in the TypeScript package: object keys
// sorted recursively, arrays keep order.
func canonicalJSON(v any) string {
	switch t := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var b strings.Builder
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			kb, _ := json.Marshal(k)
			b.Write(kb)
			b.WriteByte(':')
			b.WriteString(canonicalJSON(t[k]))
		}
		b.WriteByte('}')
		return b.String()
	case []any:
		var b strings.Builder
		b.WriteByte('[')
		for i, e := range t {
			if i > 0 {
				b.WriteByte(',')
			}
			b.WriteString(canonicalJSON(e))
		}
		b.WriteByte(']')
		return b.String()
	default:
		raw, _ := json.Marshal(t)
		return string(raw)
	}
}

func TestFingerprintParity(t *testing.T) {
	f := loadFixture(t, "fingerprint.v1.json")
	var decisive map[string]any
	if err := json.Unmarshal(f.Decisive, &decisive); err != nil {
		t.Fatal(err)
	}
	var expected struct {
		Canonical   string `json:"canonical"`
		Fingerprint string `json:"fingerprint"`
	}
	if err := json.Unmarshal(f.Expected, &expected); err != nil {
		t.Fatal(err)
	}
	canonical := canonicalJSON(decisive)
	if canonical != expected.Canonical {
		t.Fatalf("canonical JSON drifted:\n got: %s\nwant: %s", canonical, expected.Canonical)
	}
	sum := sha256.Sum256([]byte(canonical))
	if hex.EncodeToString(sum[:]) != expected.Fingerprint {
		t.Fatal("Go fingerprint disagrees with the TypeScript fixture")
	}
}
