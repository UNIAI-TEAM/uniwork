package office

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
)

// GrantTag prefixes the HMAC input of a service grant. It is the Go mirror of
// GRANT_TAG in apps/office-engine/src/grants.ts; changing it is a wire break.
const GrantTag = "uniwork-office-grant/1"

// GrantInput binds the exact input bytes a job may read: the engine refuses
// an envelope whose measured bytes differ.
type GrantInput struct {
	Checksum string `json:"checksum"`
	Length   int64  `json:"length"`
}

// GrantOutput is the one place a job may write: the FileService
// provider-output target from RegisterProviderOutput. ExpiresAt is epoch ms.
type GrantOutput struct {
	FileID    string            `json:"file_id"`
	URL       string            `json:"url"`
	Method    string            `json:"method"`
	Headers   map[string]string `json:"headers"`
	ExpiresAt int64             `json:"expires_at"`
	MaxBytes  int64             `json:"max_bytes"`
}

// ServiceGrant is the per-job grant Go issues to the engine service (G2-02).
// It is distinct from the service credential: the credential says "this is
// Go", the grant says "Go authorised this job on this input, with this output
// target, until this time". Times are epoch milliseconds, like the engine.
// Input and Output are JSON null when absent, never omitted, so the engine
// parses one shape.
type ServiceGrant struct {
	V              int          `json:"v"`
	GrantID        string       `json:"grant_id"`
	JobID          string       `json:"job_id"`
	ActorID        string       `json:"actor_id"`
	ActorKind      string       `json:"actor_kind"`
	OrganizationID string       `json:"organization_id"`
	WorkspaceID    string       `json:"workspace_id"`
	DocumentID     string       `json:"document_id"`
	DriveFileID    string       `json:"drive_file_id,omitempty"`
	Operation      Operation    `json:"operation"`
	Format         Format       `json:"format"`
	BaseRevision   int64        `json:"base_revision"`
	BaseVersionID  string       `json:"base_version_id"`
	Input          *GrantInput  `json:"input"`
	Output         *GrantOutput `json:"output"`
	DeadlineAt     int64        `json:"deadline_at"`
	IssuedAt       int64        `json:"issued_at"`
	ExpiresAt      int64        `json:"expires_at"`
}

// ErrGrantInvalid is a token that does not verify or does not parse.
var ErrGrantInvalid = errors.New("office: grant does not verify")

func grantMAC(key []byte, body string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(GrantTag + "." + body))
	return m.Sum(nil)
}

// SignGrant encodes and signs a grant with the grant key.
func SignGrant(g ServiceGrant, key []byte) (string, error) {
	if len(key) == 0 {
		return "", errors.New("office: grant key is empty")
	}
	raw, err := json.Marshal(g)
	if err != nil {
		return "", err
	}
	body := base64.RawURLEncoding.EncodeToString(raw)
	return body + "." + base64.RawURLEncoding.EncodeToString(grantMAC(key, body)), nil
}

// VerifyGrant checks a token's signature and decodes it. The engine is the
// verifier in production; Go uses this in tests and in the parity fixture.
func VerifyGrant(token string, key []byte) (ServiceGrant, error) {
	body, sig, ok := strings.Cut(token, ".")
	if !ok || body == "" || sig == "" {
		return ServiceGrant{}, ErrGrantInvalid
	}
	given, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(given, grantMAC(key, body)) {
		return ServiceGrant{}, ErrGrantInvalid
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return ServiceGrant{}, ErrGrantInvalid
	}
	var g ServiceGrant
	if err := json.Unmarshal(raw, &g); err != nil {
		return ServiceGrant{}, ErrGrantInvalid
	}
	if err := validateServiceGrant(g); err != nil {
		return ServiceGrant{}, err
	}
	return g, nil
}

func validateServiceGrant(g ServiceGrant) error {
	if g.Operation == OperationExtractText {
		if !validGrantStr(g.GrantID, 128) || !validGrantStr(g.JobID, 128) ||
			!validGrantStr(g.ActorID, 128) || !validActorKind(g.ActorKind) ||
			!validGrantStr(g.OrganizationID, 128) || !validGrantStr(g.WorkspaceID, 128) ||
			!validGrantStr(g.DriveFileID, 128) {
			return ErrGrantInvalid
		}
		if g.DocumentID != "" || g.BaseRevision != 0 || g.BaseVersionID != "" || g.Output != nil || !validGrantInput(g.Input) {
			return ErrGrantInvalid
		}
		return nil
	}
	if g.DriveFileID != "" || !validGrantStr(g.DocumentID, 128) || !validGrantStr(g.BaseVersionID, 128) || g.BaseRevision < 0 {
		return ErrGrantInvalid
	}
	return nil
}

func validGrantStr(s string, max int) bool {
	return len(s) > 0 && len(s) <= max
}

func validActorKind(k string) bool {
	return k == "human" || k == "agent" || k == "system"
}

func validGrantInput(in *GrantInput) bool {
	if in == nil || in.Length < 0 || in.Length > (1<<53)-1 || len(in.Checksum) != 64 {
		return false
	}
	for i := range 64 {
		c := in.Checksum[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}
