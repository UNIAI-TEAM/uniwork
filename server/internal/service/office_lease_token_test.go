package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/outbox"
)

// G5-08s (UNI-1350), no database: the lease codec (G5-D1 row 4, threat model
// T7, T13) and the revoker's guards on events it cannot act on.

func officeLeaseTestClaims() officeLeaseClaims {
	return officeLeaseClaims{
		V: officeLeaseTokenVersion, KeyID: officeLeaseKeyID, LeaseID: "01LEASE0000000000000000000", Generation: 1,
		UserID: "01USER00000000000000000000", DeviceSessionID: "01DEVICE000000000000000000", DeploymentID: "default",
		OrganizationID: "01ORG000000000000000000000", WorkspaceID: "01WS0000000000000000000000",
		DocumentID: "01DOC00000000000000000000", VersionID: "01VER00000000000000000000", Version: 3, Revision: "7",
		Level: officeLeaseLevelView, PolicyEpoch: 2, IssuedAt: 1_800_000_000, ExpiresAt: 1_800_086_400,
	}
}

func TestOfficeLeaseCodecRoundTrip(t *testing.T) {
	c := newOfficeLeaseCodec(officeLeaseTestSecret)
	want := officeLeaseTestClaims()
	tok, err := c.sign(want)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(tok, officeLeaseTokenPrefix) {
		t.Fatalf("token %q lacks the format prefix", tok)
	}
	got, ok := c.verify(tok)
	if !ok || got != want {
		t.Fatalf("verify = %+v ok=%v, want %+v", got, ok, want)
	}
}

func TestOfficeLeaseCodecRefusesForgery(t *testing.T) {
	c := newOfficeLeaseCodec(officeLeaseTestSecret)
	tok, err := c.sign(officeLeaseTestClaims())
	if err != nil {
		t.Fatal(err)
	}
	dot := strings.LastIndex(tok, ".")
	payload := tok[len(officeLeaseTokenPrefix):dot]

	resign := func(mut func(*officeLeaseClaims)) string {
		cl := officeLeaseTestClaims()
		mut(&cl)
		s, err := c.sign(cl)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	other, err := newOfficeLeaseCodec("another-synthetic-secret").sign(officeLeaseTestClaims())
	if err != nil {
		t.Fatal(err)
	}
	// A MAC under the raw secret, not the derived lease key: another token
	// family must never pass for a lease.
	raw := hmac.New(sha256.New, []byte(officeLeaseTestSecret))
	raw.Write([]byte(tok[:dot]))
	rawKey := tok[:dot] + "." + base64.RawURLEncoding.EncodeToString(raw.Sum(nil))
	// A payload with an extra level claim spliced in, under the old MAC.
	var m map[string]any
	b, _ := base64.RawURLEncoding.DecodeString(payload)
	_ = json.Unmarshal(b, &m)
	m["level"] = officeLeaseLevelEdit
	b, _ = json.Marshal(m)
	spliced := officeLeaseTokenPrefix + base64.RawURLEncoding.EncodeToString(b) + tok[dot:]

	for name, bad := range map[string]string{
		"flipped payload":   flipLeaseTokenChar(tok, len(officeLeaseTokenPrefix)+5),
		"flipped signature": flipLeaseTokenChar(tok, dot+1),
		"spliced claim":     spliced,
		"no signature":      tok[:dot],
		"empty signature":   tok[:dot+1],
		"padded signature":  tok + "=",
		"no prefix":         strings.TrimPrefix(tok, officeLeaseTokenPrefix),
		"other prefix":      "ofl2." + strings.TrimPrefix(tok, officeLeaseTokenPrefix),
		"another secret":    other,
		"raw secret key":    rawKey,
		"other layout":      resign(func(cl *officeLeaseClaims) { cl.V = 2 }),
		"other key id":      resign(func(cl *officeLeaseClaims) { cl.KeyID = "v2" }),
		"no lease id":       resign(func(cl *officeLeaseClaims) { cl.LeaseID = "" }),
		"empty":             "",
	} {
		if cl, ok := c.verify(bad); ok {
			t.Errorf("%s: verified as %+v", name, cl)
		}
	}
}

// The revoker acts only on events that name a tenant and a subject; anything
// else is a no-op that never opens a transaction (the revoker here has no
// database at all), and a payload that is not JSON is an error the dispatcher
// retries.
func TestOfficeLeaseRevokerSkipsEventsWithoutSubject(t *testing.T) {
	r := NewOfficeLeaseRevoker(nil)
	org := pgtype.Text{String: "01ORG000000000000000000000", Valid: true}
	for _, ev := range []outbox.Row{
		{ID: "e1", Topic: "member.deactivated", Payload: `{"user_id":"01USER00000000000000000000"}`},
		{ID: "e2", Topic: "member.deactivated", Payload: `{}`, OrganizationID: org},
		{ID: "e3", Topic: "member.removed", Payload: `{"workspace_id":"01WS0000000000000000000000"}`, OrganizationID: org},
		{ID: "e4", Topic: "document.share_revoked", Payload: `{"share_id":"01SHARE000000000000000000"}`, OrganizationID: org},
		{ID: "e5", Topic: "document.deleted", Payload: ``, OrganizationID: org},
		{ID: "e6", Topic: "task.updated", Payload: `{"task_id":"01TASK00000000000000000000"}`, OrganizationID: org},
	} {
		if err := r.Handle(t.Context(), ev); err != nil {
			t.Fatalf("%s %s: %v", ev.ID, ev.Topic, err)
		}
	}
	if err := r.Handle(t.Context(), outbox.Row{ID: "bad", Topic: "member.removed", Payload: "{", OrganizationID: org}); err == nil {
		t.Fatal("a payload that is not JSON was accepted")
	}
	topics := map[string]bool{}
	for _, tp := range r.Topics() {
		topics[tp] = true
	}
	for _, want := range []string{
		"member.deactivated", "member.left", "member.removed", "document.share_revoked",
		"document.moved", "document.deleted", "organization.suspended",
	} {
		if !topics[want] {
			t.Errorf("the revoker does not consume %s", want)
		}
	}
	if topics["document.archived"] {
		t.Error("archive must not revoke a lease (G5-D1 row 14)")
	}
}
