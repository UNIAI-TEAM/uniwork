package office

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"testing"
)

var updateFixtures = flag.Bool("update", false, "rewrite testdata golden files")

// The parity fixture is shared with apps/office-engine/src/grants.test.ts: Go
// signs it here (golden), and the Node engine must verify the same token with
// the same key and read back the same fields. A change to the grant wire
// format on either side fails one of the two tests.
const parityFixture = "testdata/grant-parity.json"

type parity struct {
	Key   string       `json:"key"`
	Grant ServiceGrant `json:"grant"`
	Token string       `json:"token"`
}

func parityGrant() ServiceGrant {
	return ServiceGrant{
		V: 1, GrantID: "01GRANT0000000000000000000", JobID: "01JOB00000000000000000000A",
		ActorID: "01USER00000000000000000000", ActorKind: "human",
		OrganizationID: "01ORG000000000000000000000", WorkspaceID: "01WS0000000000000000000000",
		DocumentID: "01DOC00000000000000000000A", Operation: OperationSerialize, Format: FormatMD,
		BaseRevision: 7, BaseVersionID: "01VER00000000000000000000A",
		Input: &GrantInput{Checksum: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9", Length: 11},
		Output: &GrantOutput{
			FileID: "01FILE0000000000000000000A", URL: "http://minio:9000/bucket/key?X-Amz-Signature=abc",
			Method: "PUT", Headers: map[string]string{"content-type": "text/markdown"}, ExpiresAt: 1790000060000, MaxBytes: 52428800,
		},
		DeadlineAt: 1790000060000, IssuedAt: 1790000000000, ExpiresAt: 1790000030000,
	}
}

func TestGrantParityFixture(t *testing.T) {
	key := "parity-grant-key-0123456789abcdef-0123"
	token, err := SignGrant(parityGrant(), []byte(key))
	if err != nil {
		t.Fatal(err)
	}
	if *updateFixtures {
		raw, _ := json.MarshalIndent(parity{Key: key, Grant: parityGrant(), Token: token}, "", "  ")
		if err := os.WriteFile(filepath.FromSlash(parityFixture), append(raw, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := os.ReadFile(filepath.FromSlash(parityFixture))
	if err != nil {
		t.Fatal(err)
	}
	var fx parity
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if fx.Token != token {
		t.Fatalf("grant wire format drifted: Go signs %s, fixture has %s (run with -update and re-run the Node parity test)", token, fx.Token)
	}
	got, err := VerifyGrant(fx.Token, []byte(fx.Key))
	if err != nil {
		t.Fatal(err)
	}
	if got.JobID != fx.Grant.JobID || got.Output == nil || got.Output.URL != fx.Grant.Output.URL || got.Input.Length != 11 {
		t.Fatalf("round trip lost fields: %+v", got)
	}
}

func TestGrantRefusesTamperingAndTheWrongKey(t *testing.T) {
	key := []byte("grant-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	token, err := SignGrant(parityGrant(), key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyGrant(token, []byte("service-token-bbbbbbbbbbbbbbbbbbbbbbbbbb")); err != ErrGrantInvalid {
		t.Fatalf("wrong key: %v", err)
	}
	other := parityGrant()
	other.BaseRevision = 8
	forged, _ := SignGrant(other, key)
	body, sig := token[:len(token)-len(token[len(token)-43:])-1], forged[len(forged)-43:]
	if _, err := VerifyGrant(body+"."+sig, key); err != ErrGrantInvalid {
		t.Fatalf("spliced signature accepted: %v", err)
	}
	for _, bad := range []string{"", "nodot", ".sig", "body.", "!!!.???"} {
		if _, err := VerifyGrant(bad, key); err != ErrGrantInvalid {
			t.Fatalf("%q accepted: %v", bad, err)
		}
	}
	if _, err := SignGrant(parityGrant(), nil); err == nil {
		t.Fatal("empty key signed a grant")
	}
	// Absent input/output travel as JSON null, never omitted.
	g := parityGrant()
	g.Input, g.Output = nil, nil
	tok, _ := SignGrant(g, key)
	back, err := VerifyGrant(tok, key)
	if err != nil || back.Input != nil || back.Output != nil {
		t.Fatalf("null input/output: %+v %v", back, err)
	}
}
