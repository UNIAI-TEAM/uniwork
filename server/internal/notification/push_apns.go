package notification

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TransportAPNsVoIP is the transport of an iPhone's PushKit token (ADR 0038):
// the push lane sends it VoIP pushes straight to APNs so CallKit rings a
// locked phone. Its endpoint holds the token in hex.
const TransportAPNsVoIP = "apns_voip"

// The APNs environments a PushKit token belongs to: a development build's
// token works only on the sandbox host, a TestFlight or App Store build's only
// on the production one.
const (
	APNsProduction = "production"
	APNsSandbox    = "sandbox"
)

const (
	apnsProductionURL = "https://api.push.apple.com"
	apnsSandboxURL    = "https://api.sandbox.push.apple.com"
	// apnsTokenLifetime: Apple refuses a provider token older than an hour
	// (ExpiredProviderToken) and one refreshed more than once in 20 minutes
	// (TooManyProviderTokenUpdates), so one is minted every 50 minutes.
	apnsTokenLifetime = 50 * time.Minute
)

// isVoIPSubscription reports an iPhone's PushKit token.
func isVoIPSubscription(sub db.PushSubscription) bool {
	return sub.Transport.Valid && sub.Transport.String == TransportAPNsVoIP
}

// APNsConfig is the .p8 key the server signs its APNs provider tokens with
// (APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY) and an optional topic
// (APNS_VOIP_TOPIC) that replaces "<bundle id>.voip" for every token.
type APNsConfig struct {
	KeyID      string
	TeamID     string
	PrivateKey string // PEM, as Apple's AuthKey_<KeyID>.p8 holds it
	Topic      string
}

// APNsMetrics counts what APNs answered: result is sent, gone or failed, and
// reason is Apple's reason code ("" when sent), a closed set with no token in it.
type APNsMetrics interface {
	IncAPNsVoIP(result, reason string)
}

// APNsVoIPSender sends call pushes to iPhones' PushKit tokens over HTTP/2
// with token-based auth: an ES256 JWT signed with the team's .p8 key, cached
// for apnsTokenLifetime. Only a ring and its end are sent, since iOS makes the
// app report every VoIP push to CallKit.
type APNsVoIPSender struct {
	keyID, teamID, topic string
	key                  *ecdsa.PrivateKey
	client               *http.Client
	productionURL        string
	sandboxURL           string
	now                  func() time.Time
	metrics              APNsMetrics

	mu      sync.Mutex
	jwt     string
	jwtFrom time.Time
}

// NewAPNsVoIPSender reads cfg; nil and no error when no part of the key is
// set (VoIP off: iPhones keep the Expo push), an error when only part of it is
// or the key is not a P-256 PKCS#8 key.
func NewAPNsVoIPSender(cfg APNsConfig) (*APNsVoIPSender, error) {
	keyID, teamID, raw := strings.TrimSpace(cfg.KeyID), strings.TrimSpace(cfg.TeamID), strings.TrimSpace(cfg.PrivateKey)
	if keyID == "" && teamID == "" && raw == "" {
		return nil, nil
	}
	if keyID == "" || teamID == "" || raw == "" {
		return nil, errors.New("apns: APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY are set together or not at all")
	}
	// An env file often carries the PEM on one line with escaped newlines.
	raw = strings.ReplaceAll(raw, `\n`, "\n")
	block, _ := pem.Decode([]byte(raw))
	if block == nil {
		return nil, errors.New("apns: APNS_PRIVATE_KEY is not a PEM block")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("apns: APNS_PRIVATE_KEY: %w", err)
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok || key.Curve != elliptic.P256() {
		return nil, errors.New("apns: APNS_PRIVATE_KEY is not a P-256 key (Apple's .p8)")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ForceAttemptHTTP2 = true
	return &APNsVoIPSender{
		keyID: keyID, teamID: teamID, topic: strings.TrimSpace(cfg.Topic), key: key,
		client:        &http.Client{Timeout: 10 * time.Second, Transport: transport},
		productionURL: apnsProductionURL, sandboxURL: apnsSandboxURL, now: time.Now,
	}, nil
}

// SetMetrics attaches the APNs answer counter.
func (s *APNsVoIPSender) SetMetrics(m APNsMetrics) { s.metrics = m }

// voipPush is the whole body of a VoIP push: no "aps" (the app draws nothing
// itself, CallKit does), only what the app reports to CallKit and opens on
// answer. The shape is the contract of ADR 0038 with the iOS module.
type voipPush struct {
	UniWork voipCall `json:"uniwork"`
}

type voipCall struct {
	Kind          string `json:"kind"`
	CallID        string `json:"call_id"`
	RoomID        string `json:"room_id"`
	WorkspaceID   string `json:"workspace_id"`
	OrgSlug       string `json:"org_slug"`
	WorkspaceSlug string `json:"ws_slug"`
	CallerName    string `json:"caller_name,omitempty"`
	Video         bool   `json:"video"`
	ExpiresAt     string `json:"expires_at"`
}

// voipKinds maps a CallPush type to the payload's kind; the rest (a missed
// call) are not VoIP pushes.
var voipKinds = map[string]string{CallPushInvite: "invite", CallPushEnd: "end"}

// Send delivers a ring or its end to one PushKit token. Anything else, or a
// ring whose window already ran out, is ErrPushSkipped. 410 Unregistered and
// 400 BadDeviceToken are ErrSubscriptionGone; every other refusal is retried.
func (s *APNsVoIPSender) Send(ctx context.Context, sub db.PushSubscription, msg PushMessage) error {
	kind, ok := voipKinds[msg.Call.Type]
	if !ok || !isVoIPSubscription(sub) || sub.Endpoint == "" {
		return ErrPushSkipped
	}
	host := s.productionURL
	switch sub.ApnsEnvironment.String {
	case APNsProduction:
	case APNsSandbox:
		host = s.sandboxURL
	default:
		return ErrPushSkipped
	}
	topic := s.topic
	if topic == "" {
		if sub.ApnsBundleID.String == "" {
			return ErrPushSkipped
		}
		topic = sub.ApnsBundleID.String + ".voip"
	}
	now := s.now()
	expires := now.Add(time.Duration(msg.ttl()) * time.Second)
	if msg.Call.Type == CallPushInvite {
		expires = time.UnixMilli(msg.Call.ExpiresAt)
		if !expires.After(now) {
			return ErrPushSkipped // the ring is over: CallKit would ring a dead call
		}
	}
	call := voipCall{
		Kind: kind, CallID: msg.Call.CallID, RoomID: msg.Call.RoomID, WorkspaceID: msg.Call.WorkspaceID,
		OrgSlug: msg.Call.OrgSlug, WorkspaceSlug: msg.Call.WorkspaceSlug, Video: msg.Call.Video,
		ExpiresAt: expires.UTC().Format(time.RFC3339),
	}
	if msg.Call.Type == CallPushInvite {
		call.CallerName = msg.Call.CallerName
	}
	body, err := json.Marshal(voipPush{UniWork: call})
	if err != nil {
		return err
	}
	endpoint := host + "/3/device/" + url.PathEscape(sub.Endpoint)
	status, reason, err := s.post(ctx, endpoint, topic, expires, body, false)
	if err == nil && status == http.StatusForbidden && reason == "ExpiredProviderToken" {
		// Apple's clock and ours disagree on the token's age: mint one now and try once more.
		status, reason, err = s.post(ctx, endpoint, topic, expires, body, true)
	}
	if err != nil {
		s.count("failed", "transport")
		return err
	}
	switch {
	case status == http.StatusOK:
		s.count("sent", "")
		return nil
	case status == http.StatusGone, status == http.StatusBadRequest && reason == "BadDeviceToken":
		s.count("gone", reason)
		return ErrSubscriptionGone
	}
	if status == http.StatusForbidden {
		s.dropToken() // a refused key or token: the next push mints a fresh one
	}
	s.count("failed", reason)
	return fmt.Errorf("apns: %d %s", status, reason)
}

// post sends one push and returns APNs' status and reason. Transport errors
// lose their URL, which carries the device token.
func (s *APNsVoIPSender) post(ctx context.Context, endpoint, topic string, expires time.Time, body []byte, fresh bool) (int, string, error) {
	token, err := s.providerToken(fresh)
	if err != nil {
		return 0, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return 0, "", errors.New("apns: build request")
	}
	req.Header.Set("authorization", "bearer "+token)
	req.Header.Set("apns-push-type", "voip")
	req.Header.Set("apns-topic", topic)
	req.Header.Set("apns-priority", "10")
	req.Header.Set("apns-expiration", strconv.FormatInt(expires.Unix(), 10))
	req.Header.Set("content-type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return 0, "", fmt.Errorf("apns: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
	if resp.StatusCode == http.StatusOK {
		return resp.StatusCode, "", nil
	}
	var failure struct {
		Reason string `json:"reason"`
	}
	_ = json.Unmarshal(raw, &failure)
	return resp.StatusCode, apnsReason(failure.Reason), nil
}

// apnsReason keeps a reason that looks like one of Apple's codes (letters
// only, short) and folds anything else into "unknown", so a metric label or a
// log line never carries what a misbehaving proxy put in the body.
func apnsReason(reason string) string {
	if reason == "" || len(reason) > 40 {
		return "unknown"
	}
	for _, r := range reason {
		if (r < 'A' || r > 'Z') && (r < 'a' || r > 'z') {
			return "unknown"
		}
	}
	return reason
}

// providerToken returns the cached JWT, minting one when it is older than
// apnsTokenLifetime or fresh is asked for.
func (s *APNsVoIPSender) providerToken(fresh bool) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	if !fresh && s.jwt != "" && now.Sub(s.jwtFrom) < apnsTokenLifetime {
		return s.jwt, nil
	}
	token, err := s.signJWT(now)
	if err != nil {
		return "", err
	}
	s.jwt, s.jwtFrom = token, now
	return token, nil
}

func (s *APNsVoIPSender) dropToken() {
	s.mu.Lock()
	s.jwt = ""
	s.mu.Unlock()
}

// signJWT is the ES256 provider token APNs expects: header {alg, kid}, claims
// {iss: team id, iat}, the signature r||s in 64 bytes, all base64url unpadded.
func (s *APNsVoIPSender) signJWT(now time.Time) (string, error) {
	header, err := json.Marshal(map[string]string{"alg": "ES256", "kid": s.keyID})
	if err != nil {
		return "", err
	}
	claims, err := json.Marshal(map[string]any{"iss": s.teamID, "iat": now.Unix()})
	if err != nil {
		return "", err
	}
	enc := base64.RawURLEncoding
	signing := enc.EncodeToString(header) + "." + enc.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signing))
	r, sig, err := ecdsa.Sign(rand.Reader, s.key, digest[:])
	if err != nil {
		return "", fmt.Errorf("apns: sign provider token: %w", err)
	}
	out := make([]byte, 64)
	r.FillBytes(out[:32])
	sig.FillBytes(out[32:])
	return signing + "." + enc.EncodeToString(out), nil
}

func (s *APNsVoIPSender) count(result, reason string) {
	if s.metrics != nil {
		s.metrics.IncAPNsVoIP(result, reason)
	}
}
