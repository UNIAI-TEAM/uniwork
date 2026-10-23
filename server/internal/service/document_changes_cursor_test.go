package service

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// The cursor codec needs no database: these run anywhere.

func testChangeScope() changeCursorScope {
	return changeCursorScope{deployment: "dep-a", userID: "user-a", organization: "org-a", workspace: "ws-a"}
}

func testChangeClaims(now time.Time) changeCursorClaims {
	s := testChangeScope()
	return changeCursorClaims{
		Protocol: DocumentChangeProtocol, Deployment: s.deployment, UserID: s.userID,
		Organization: s.organization, Workspace: s.workspace,
		Phase: changeCursorPhaseSnapshot, SnapshotID: "snap-1", After: "doc-1",
		ExpiresAt: now.Add(time.Minute).Unix(),
	}
}

func TestChangeCursorRoundTrip(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	c := newChangeCursorCodec("secret-0123456789")
	token, err := c.sign(testChangeClaims(now))
	if err != nil {
		t.Fatal(err)
	}
	got, err := c.verify(token, testChangeScope(), now)
	if err != nil {
		t.Fatalf("verify own cursor: %v", err)
	}
	if got.SnapshotID != "snap-1" || got.After != "doc-1" {
		t.Fatalf("claims = %+v", got)
	}
}

// A feed cursor (G5-01b) carries the snapshot's high-water mark and the
// (xact_id, id) keyset it continues from; the keyset may be empty on the
// first feed page, the mark may not.
func TestChangeCursorFeedKeysetRoundTrip(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	c := newChangeCursorCodec("secret-0123456789")
	s := testChangeScope()
	claims := changeCursorClaims{
		Protocol: DocumentChangeProtocol, Deployment: s.deployment, UserID: s.userID,
		Organization: s.organization, Workspace: s.workspace,
		Phase: changeCursorPhaseFeed, HighWater: "100:120:",
		AfterXact: "101", AfterID: "01DOC00000000000000000001",
		ExpiresAt: now.Add(time.Minute).Unix(),
	}
	token, err := c.sign(claims)
	if err != nil {
		t.Fatal(err)
	}
	got, err := c.verify(token, s, now)
	if err != nil {
		t.Fatalf("verify own cursor: %v", err)
	}
	if got.Phase != changeCursorPhaseFeed || got.HighWater != "100:120:" ||
		got.AfterXact != "101" || got.AfterID != "01DOC00000000000000000001" {
		t.Fatalf("claims = %+v", got)
	}

	// The first feed page has no keyset yet: that still verifies.
	claims.AfterXact, claims.AfterID = "", ""
	token, err = c.sign(claims)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := c.verify(token, s, now); err != nil || got.HighWater != "100:120:" {
		t.Fatalf("first-page cursor = %+v, %v", got, err)
	}

	// A feed cursor without a high-water mark is refused: the feed could not
	// honour its position.
	claims.HighWater = ""
	token, err = c.sign(claims)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.verify(token, s, now); !codedIs(err, "change_cursor_invalid") {
		t.Fatalf("feed cursor without a high-water mark = %v, want change_cursor_invalid", err)
	}
}

// Every refusal reads change_cursor_invalid, and the error carries no field
// of the scope it failed against.
func TestChangeCursorRefusesForgedTamperedAndForeignScope(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	c := newChangeCursorCodec("secret-0123456789")
	good, err := c.sign(testChangeClaims(now))
	if err != nil {
		t.Fatal(err)
	}
	reSign := func(mut func(*changeCursorClaims)) string {
		cl := testChangeClaims(now)
		mut(&cl)
		tok, err := c.sign(cl)
		if err != nil {
			t.Fatal(err)
		}
		return tok
	}
	payload, sig, _ := strings.Cut(strings.TrimPrefix(good, changeCursorPrefix), ".")
	raw, _ := base64.RawURLEncoding.DecodeString(payload)
	var cl map[string]any
	_ = json.Unmarshal(raw, &cl)
	cl["w"] = "ws-b"
	forgedPayload, _ := json.Marshal(cl)
	other, _ := newChangeCursorCodec("another-secret-0123").sign(testChangeClaims(now))

	cases := map[string]string{
		"empty":               "",
		"garbage":             "not-a-cursor",
		"no signature":        changeCursorPrefix + payload,
		"tampered payload":    changeCursorPrefix + base64.RawURLEncoding.EncodeToString(forgedPayload) + "." + sig,
		"tampered signature":  changeCursorPrefix + payload + "." + base64.RawURLEncoding.EncodeToString([]byte("forged-signature-bytes-000000000")),
		"padded signature":    good + "=",
		"other key":           other,
		"other user":          reSign(func(c *changeCursorClaims) { c.UserID = "user-b" }),
		"other workspace":     reSign(func(c *changeCursorClaims) { c.Workspace = "ws-b" }),
		"other organization":  reSign(func(c *changeCursorClaims) { c.Organization = "org-b" }),
		"other deployment":    reSign(func(c *changeCursorClaims) { c.Deployment = "dep-b" }),
		"other protocol":      reSign(func(c *changeCursorClaims) { c.Protocol = "office-change-feed/0" }),
		"unknown phase":       reSign(func(c *changeCursorClaims) { c.Phase = "replay" }),
		"snapshot without id": reSign(func(c *changeCursorClaims) { c.SnapshotID = "" }),
		"feed without mark":   reSign(func(c *changeCursorClaims) { c.Phase, c.HighWater = changeCursorPhaseFeed, "" }),
		"expired other scope": reSign(func(c *changeCursorClaims) { c.Workspace, c.ExpiresAt = "ws-b", now.Add(-time.Hour).Unix() }),
	}
	for name, token := range cases {
		_, err := c.verify(token, testChangeScope(), now)
		if !codedIs(err, "change_cursor_invalid") {
			t.Errorf("%s: err = %v, want change_cursor_invalid", name, err)
			continue
		}
		for _, leak := range []string{"ws-a", "ws-b", "org-a", "org-b", "user-a", "user-b", "dep-a", "dep-b", "snap-1"} {
			if strings.Contains(err.Error(), leak) {
				t.Errorf("%s: error %q names %q", name, err, leak)
			}
		}
	}
}

func TestChangeCursorExpiry(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	c := newChangeCursorCodec("secret-0123456789")
	token, err := c.sign(testChangeClaims(now))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.verify(token, testChangeScope(), now.Add(time.Minute)); !codedIs(err, "change_cursor_expired") {
		t.Fatalf("at expiry: %v, want change_cursor_expired", err)
	}
	if _, err := c.verify(token, testChangeScope(), now.Add(59*time.Second)); err != nil {
		t.Fatalf("before expiry: %v", err)
	}
	var ce CodedError
	_, err = c.verify(token, testChangeScope(), now.Add(time.Hour))
	if !asCoded(err, &ce) || ce.Status != 410 {
		t.Fatalf("expired status = %+v, want 410", ce)
	}
}

func TestChangeLimitBounds(t *testing.T) {
	for in, want := range map[int]int32{
		-5: DocumentChangePageDefault, 0: DocumentChangePageDefault, 1: 1,
		DocumentChangePageMax: DocumentChangePageMax, DocumentChangePageMax + 1: DocumentChangePageMax, 1 << 30: DocumentChangePageMax,
	} {
		if got := clampChangeLimit(in); got != want {
			t.Errorf("clampChangeLimit(%d) = %d, want %d", in, got, want)
		}
	}
}

func asCoded(err error, into *CodedError) bool {
	ce, ok := err.(CodedError)
	if ok {
		*into = ce
	}
	return ok
}
