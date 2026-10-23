package meetings

import (
	"strings"
	"testing"
	"time"
)

func TestAgentTokenRoundTrip(t *testing.T) {
	key := []byte("secret")
	exp := time.Now().Add(time.Hour).Truncate(time.Second)
	tok := SignAgentToken(key, AgentClaims{MeetingID: "m1", OrganizationID: "o1", RunID: "r1", ExpiresAt: exp})
	if !strings.HasPrefix(tok, AgentTokenPrefix) {
		t.Fatalf("token %q lacks the uwma_ prefix", tok)
	}
	got, ok := VerifyAgentToken(key, tok, time.Now())
	if !ok || got.MeetingID != "m1" || got.OrganizationID != "o1" || got.RunID != "r1" || !got.ExpiresAt.Equal(exp) {
		t.Fatalf("verify = %+v, %v", got, ok)
	}
}

func TestAgentTokenRefusesTamperExpiryAndOtherKey(t *testing.T) {
	key := []byte("secret")
	now := time.Now()
	tok := SignAgentToken(key, AgentClaims{MeetingID: "m1", OrganizationID: "o1", RunID: "r1", ExpiresAt: now.Add(time.Hour)})
	other := SignAgentToken(key, AgentClaims{MeetingID: "m2", OrganizationID: "o1", RunID: "r1", ExpiresAt: now.Add(time.Hour)})
	body, sig, _ := strings.Cut(strings.TrimPrefix(tok, AgentTokenPrefix), ".")
	_, otherSig, _ := strings.Cut(strings.TrimPrefix(other, AgentTokenPrefix), ".")
	cases := map[string]struct {
		tok string
		key []byte
		at  time.Time
	}{
		"expired":         {tok, key, now.Add(2 * time.Hour)},
		"other key":       {tok, []byte("other"), now},
		"swapped sig":     {AgentTokenPrefix + body + "." + otherSig, key, now},
		"no sig":          {AgentTokenPrefix + body, key, now},
		"no prefix":       {body + "." + sig, key, now},
		"garbage":         {AgentTokenPrefix + "x.y", key, now},
		"empty":           {"", key, now},
		"empty key":       {tok, nil, now},
		"session jwt-ish": {"eyJhbGciOiJIUzI1NiJ9.e30.sig", key, now},
	}
	for name, c := range cases {
		if _, ok := VerifyAgentToken(c.key, c.tok, c.at); ok {
			t.Errorf("%s: verified", name)
		}
	}
}
