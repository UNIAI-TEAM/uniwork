package meetings

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strconv"
	"strings"
	"time"
)

// AgentTokenPrefix marks the per-meeting token of the scribe agent (ADR 0036).
const AgentTokenPrefix = "uwma_"

// agentTokenDomain separates these signatures from the guest cookie, which
// is signed with the same key.
const agentTokenDomain = "uwma.v1|"

// AgentClaims is what one scribe dispatch may do: act on one meeting of one
// organization, for one run, until ExpiresAt.
type AgentClaims struct {
	MeetingID      string
	OrganizationID string
	RunID          string
	ExpiresAt      time.Time
}

var agentB64 = base64.RawURLEncoding

// SignAgentToken returns uwma_<base64url(meeting|org|run|exp)>.<base64url(hmac)>.
// Ids are ULIDs, so "|" never appears inside one.
func SignAgentToken(key []byte, c AgentClaims) string {
	body := agentB64.EncodeToString([]byte(c.MeetingID + "|" + c.OrganizationID + "|" + c.RunID + "|" + strconv.FormatInt(c.ExpiresAt.Unix(), 10)))
	return AgentTokenPrefix + body + "." + agentB64.EncodeToString(agentTokenMAC(key, body))
}

func agentTokenMAC(key []byte, body string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(agentTokenDomain + body))
	return mac.Sum(nil)
}

// VerifyAgentToken checks the signature and the expiry at now.
func VerifyAgentToken(key []byte, token string, now time.Time) (AgentClaims, bool) {
	if len(key) == 0 {
		return AgentClaims{}, false
	}
	rest, ok := strings.CutPrefix(token, AgentTokenPrefix)
	if !ok {
		return AgentClaims{}, false
	}
	body, sig, ok := strings.Cut(rest, ".")
	if !ok {
		return AgentClaims{}, false
	}
	got, err := agentB64.DecodeString(sig)
	if err != nil || !hmac.Equal(got, agentTokenMAC(key, body)) {
		return AgentClaims{}, false
	}
	raw, err := agentB64.DecodeString(body)
	if err != nil {
		return AgentClaims{}, false
	}
	parts := strings.Split(string(raw), "|")
	if len(parts) != 4 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return AgentClaims{}, false
	}
	exp, err := strconv.ParseInt(parts[3], 10, 64)
	if err != nil || !now.Before(time.Unix(exp, 0)) {
		return AgentClaims{}, false
	}
	return AgentClaims{MeetingID: parts[0], OrganizationID: parts[1], RunID: parts[2], ExpiresAt: time.Unix(exp, 0)}, true
}
