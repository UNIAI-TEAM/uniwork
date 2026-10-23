package notification

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const testVoIPToken = "4a6f1c2bd8e9f00112233445566778899aabbccddeeff00112233445566778899"

// testAPNsKey is a fresh P-256 key in the .p8 shape Apple hands out: a PKCS#8
// "PRIVATE KEY" PEM block.
func testAPNsKey(t *testing.T) (*ecdsa.PrivateKey, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return key, string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

// apnsRequest is what the fake APNs saw of one push.
type apnsRequest struct {
	proto   int
	path    string
	header  http.Header
	payload map[string]map[string]any
}

// fakeAPNs is an HTTP/2 TLS server that answers like APNs: 200 with an
// apns-id, or the status and {"reason"} a token in answers names.
type fakeAPNs struct {
	srv     *httptest.Server
	mu      sync.Mutex
	seen    []apnsRequest
	answers map[string][]apnsAnswer // by device token, consumed in order
}

type apnsAnswer struct {
	status int
	reason string
}

func newFakeAPNs(t *testing.T) *fakeAPNs {
	t.Helper()
	f := &fakeAPNs{answers: map[string][]apnsAnswer{}}
	f.srv = httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var payload map[string]map[string]any
		_ = json.Unmarshal(raw, &payload)
		f.mu.Lock()
		f.seen = append(f.seen, apnsRequest{proto: r.ProtoMajor, path: r.URL.Path, header: r.Header.Clone(), payload: payload})
		token := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
		var answer apnsAnswer
		if queue := f.answers[token]; len(queue) > 0 {
			answer, f.answers[token] = queue[0], queue[1:]
		}
		f.mu.Unlock()
		if answer.status == 0 {
			w.Header().Set("apns-id", "8f8e8d8c-0000-4000-8000-000000000001")
			w.WriteHeader(http.StatusOK)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(answer.status)
		_, _ = io.WriteString(w, `{"reason":"`+answer.reason+`"}`)
	}))
	f.srv.EnableHTTP2 = true
	f.srv.StartTLS()
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeAPNs) requests() []apnsRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]apnsRequest(nil), f.seen...)
}

// newTestAPNsSender points a sender at the fake: production pushes under
// /production, sandbox ones under /sandbox, so a test sees which host a
// token's environment picked.
func newTestAPNsSender(t *testing.T, f *fakeAPNs, cfg APNsConfig, now *time.Time) *APNsVoIPSender {
	t.Helper()
	s, err := NewAPNsVoIPSender(cfg)
	if err != nil || s == nil {
		t.Fatalf("NewAPNsVoIPSender = %v, %v", s, err)
	}
	s.client = f.srv.Client()
	s.productionURL, s.sandboxURL = f.srv.URL+"/production", f.srv.URL+"/sandbox"
	s.now = func() time.Time { return *now }
	return s
}

func voipSub(token, environment, bundle string) db.PushSubscription {
	return db.PushSubscription{
		ID: "sub-" + token[:6], Endpoint: token,
		Transport:       pgtype.Text{String: TransportAPNsVoIP, Valid: true},
		ApnsEnvironment: pgtype.Text{String: environment, Valid: environment != ""},
		ApnsBundleID:    pgtype.Text{String: bundle, Valid: bundle != ""},
	}
}

// verifyAPNsJWT checks an ES256 provider token against the key's public half
// and returns its header and claims.
func verifyAPNsJWT(t *testing.T, bearer string, pub *ecdsa.PublicKey) (map[string]any, map[string]any) {
	t.Helper()
	token, ok := strings.CutPrefix(bearer, "bearer ")
	if !ok {
		t.Fatalf("authorization = %q, want \"bearer <jwt>\"", bearer)
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatalf("jwt = %q, want three parts", token)
	}
	decode := func(s string) []byte {
		b, err := base64.RawURLEncoding.DecodeString(s)
		if err != nil {
			t.Fatalf("jwt part %q is not base64url without padding: %v", s, err)
		}
		return b
	}
	var header, claims map[string]any
	if err := json.Unmarshal(decode(parts[0]), &header); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(decode(parts[1]), &claims); err != nil {
		t.Fatal(err)
	}
	sig := decode(parts[2])
	if len(sig) != 64 {
		t.Fatalf("signature is %d bytes, want the 64 of r||s", len(sig))
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	r, s := new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])
	if !ecdsa.Verify(pub, digest[:], r, s) {
		t.Fatal("jwt signature does not verify with the key's public half")
	}
	return header, claims
}

func ringMessage(expires time.Time) PushMessage {
	return PushMessage{
		Title: "Minh đang gọi", URL: "http://app.test/acme/eng/chat?room=r1&call=c1", TTL: 60,
		Call: CallPush{
			Type: CallPushInvite, CallID: "c1", RoomID: "r1", WorkspaceID: "ws1", OrgSlug: "acme", WorkspaceSlug: "eng",
			CallerName: "Minh", RoomName: "Minh", CallKind: "dm", Video: true, ExpiresAt: expires.UnixMilli(),
		},
	}
}

// ADR 0038 › iOS: a ring reaches an iPhone as a VoIP push straight to APNs over
// HTTP/2 — token auth, push type voip, the app's ".voip" topic, priority 10,
// held no longer than the ring — carrying exactly the ids, slugs, caller and
// end of the ring the app hands CallKit.
func TestAPNsVoIPSenderRingsAnIPhone(t *testing.T) {
	fake := newFakeAPNs(t)
	key, pemKey := testAPNsKey(t)
	now := time.Date(2026, 10, 23, 9, 0, 0, 0, time.UTC)
	s := newTestAPNsSender(t, fake, APNsConfig{KeyID: "ABC123DEFG", TeamID: "XJAM488A6D", PrivateKey: pemKey}, &now)
	expires := now.Add(55 * time.Second)

	if err := s.Send(context.Background(), voipSub(testVoIPToken, "production", "com.uniworkos.chat"), ringMessage(expires)); err != nil {
		t.Fatal(err)
	}
	got := fake.requests()
	if len(got) != 1 {
		t.Fatalf("APNs saw %d requests, want 1", len(got))
	}
	r := got[0]
	if r.proto != 2 {
		t.Fatalf("request over HTTP/%d, want HTTP/2 (APNs speaks nothing else)", r.proto)
	}
	if r.path != "/production/3/device/"+testVoIPToken {
		t.Fatalf("path = %q, want the production host's /3/device/<token>", r.path)
	}
	for name, want := range map[string]string{
		"apns-push-type": "voip", "apns-topic": "com.uniworkos.chat.voip", "apns-priority": "10",
		"apns-expiration": strconv.FormatInt(expires.Unix(), 10), "content-type": "application/json",
	} {
		if v := r.header.Get(name); v != want {
			t.Errorf("%s = %q, want %q", name, v, want)
		}
	}
	header, claims := verifyAPNsJWT(t, r.header.Get("authorization"), &key.PublicKey)
	if header["alg"] != "ES256" || header["kid"] != "ABC123DEFG" || len(header) != 2 {
		t.Errorf("jwt header = %v, want alg ES256 and the key id only", header)
	}
	if claims["iss"] != "XJAM488A6D" || claims["iat"] != float64(now.Unix()) || len(claims) != 2 {
		t.Errorf("jwt claims = %v, want the team id and the issue time only", claims)
	}
	want := map[string]any{
		"kind": "invite", "call_id": "c1", "room_id": "r1", "workspace_id": "ws1", "org_slug": "acme", "ws_slug": "eng",
		"caller_name": "Minh", "video": true, "expires_at": expires.UTC().Format(time.RFC3339),
	}
	if len(r.payload) != 1 || len(r.payload["uniwork"]) != len(want) {
		t.Fatalf("payload = %v, want {\"uniwork\": %v} and nothing else", r.payload, want)
	}
	for k, v := range want {
		if r.payload["uniwork"][k] != v {
			t.Errorf("payload.uniwork.%s = %v, want %v", k, r.payload["uniwork"][k], v)
		}
	}
}

// The end of a ring is a VoIP push too (the app reports the call and ends it,
// so the CallKit screen comes down), held as long as an Android end is; a
// sandbox token (a development build) goes to the sandbox host; APNS_VOIP_TOPIC
// overrides the topic the bundle id names.
func TestAPNsVoIPSenderEndsTheRingOnTheSandboxHost(t *testing.T) {
	fake := newFakeAPNs(t)
	_, pemKey := testAPNsKey(t)
	now := time.Date(2026, 10, 23, 9, 0, 0, 0, time.UTC)
	s := newTestAPNsSender(t, fake, APNsConfig{KeyID: "K", TeamID: "T", PrivateKey: pemKey, Topic: "com.example.override.voip"}, &now)
	msg := PushMessage{TTL: callEndTTL, Call: CallPush{Type: CallPushEnd, CallID: "c1", RoomID: "r1", WorkspaceID: "ws1", OrgSlug: "acme", WorkspaceSlug: "eng"}}

	if err := s.Send(context.Background(), voipSub(testVoIPToken, "sandbox", "com.uniworkos.chat.staging"), msg); err != nil {
		t.Fatal(err)
	}
	r := fake.requests()[0]
	if r.path != "/sandbox/3/device/"+testVoIPToken || r.header.Get("apns-topic") != "com.example.override.voip" {
		t.Fatalf("path %q topic %q, want the sandbox host and the configured topic", r.path, r.header.Get("apns-topic"))
	}
	if exp := r.header.Get("apns-expiration"); exp != strconv.FormatInt(now.Add(time.Duration(callEndTTL)*time.Second).Unix(), 10) {
		t.Fatalf("apns-expiration = %s, want now + %ds", exp, callEndTTL)
	}
	u := r.payload["uniwork"]
	if u["kind"] != "end" || u["call_id"] != "c1" || u["room_id"] != "r1" || u["video"] != false || u["expires_at"] == nil {
		t.Fatalf("end payload = %v", u)
	}
	if _, named := u["caller_name"]; named {
		t.Fatalf("end payload names the caller: %v", u)
	}
}

// The provider token is minted once and reused for 50 minutes (Apple refuses
// one refreshed more than once in 20 minutes and one older than an hour); an
// expired one is minted again and the push retried once.
func TestAPNsVoIPSenderCachesItsProviderToken(t *testing.T) {
	fake := newFakeAPNs(t)
	key, pemKey := testAPNsKey(t)
	now := time.Date(2026, 10, 23, 9, 0, 0, 0, time.UTC)
	s := newTestAPNsSender(t, fake, APNsConfig{KeyID: "K", TeamID: "T", PrivateKey: pemKey}, &now)
	sub := voipSub(testVoIPToken, "production", "com.uniworkos.chat")
	send := func() {
		t.Helper()
		if err := s.Send(context.Background(), sub, ringMessage(now.Add(time.Minute))); err != nil {
			t.Fatal(err)
		}
	}
	issued := func(i int) float64 {
		t.Helper()
		_, claims := verifyAPNsJWT(t, fake.requests()[i].header.Get("authorization"), &key.PublicKey)
		return claims["iat"].(float64)
	}

	send()
	first := now
	now = now.Add(49 * time.Minute)
	send()
	if fake.requests()[0].header.Get("authorization") != fake.requests()[1].header.Get("authorization") {
		t.Fatal("a token 49 minutes old was minted again, want it reused")
	}
	now = now.Add(2 * time.Minute)
	send()
	if issued(2) != float64(now.Unix()) || issued(2) == float64(first.Unix()) {
		t.Fatalf("a token 51 minutes old was reused (iat %v)", issued(2))
	}

	fake.answers[testVoIPToken] = []apnsAnswer{{http.StatusForbidden, "ExpiredProviderToken"}}
	now = now.Add(time.Minute)
	send()
	got := fake.requests()
	if len(got) != 5 || issued(4) != float64(now.Unix()) {
		t.Fatalf("after ExpiredProviderToken: %d requests, last iat %v; want one retry with a token minted now", len(got), issued(len(got)-1))
	}
}

// APNs answers decide the subscription: 410 Unregistered and 400
// BadDeviceToken mean the token is dead, so it is revoked; throttling, an
// outage, a refused key or a topic mismatch are retried, never revoked.
func TestAPNsVoIPSenderMapsAnswers(t *testing.T) {
	fake := newFakeAPNs(t)
	_, pemKey := testAPNsKey(t)
	now := time.Date(2026, 10, 23, 9, 0, 0, 0, time.UTC)
	s := newTestAPNsSender(t, fake, APNsConfig{KeyID: "K", TeamID: "T", PrivateKey: pemKey}, &now)
	metrics := &apnsMetricsSpy{}
	s.SetMetrics(metrics)
	cases := []struct {
		answer apnsAnswer
		gone   bool
	}{
		{apnsAnswer{http.StatusGone, "Unregistered"}, true},
		{apnsAnswer{http.StatusBadRequest, "BadDeviceToken"}, true},
		{apnsAnswer{http.StatusBadRequest, "DeviceTokenNotForTopic"}, false},
		{apnsAnswer{http.StatusTooManyRequests, "TooManyRequests"}, false},
		{apnsAnswer{http.StatusServiceUnavailable, "ServiceUnavailable"}, false},
		{apnsAnswer{http.StatusForbidden, "InvalidProviderToken"}, false},
	}
	for i, c := range cases {
		token := strings.Repeat(strconv.Itoa(i), 64)
		fake.answers[token] = []apnsAnswer{c.answer}
		err := s.Send(context.Background(), voipSub(token, "production", "com.uniworkos.chat"), ringMessage(now.Add(time.Minute)))
		if c.gone != errors.Is(err, ErrSubscriptionGone) || err == nil {
			t.Errorf("%d %s → %v, want gone=%v", c.answer.status, c.answer.reason, err, c.gone)
		}
		if err != nil && strings.Contains(err.Error(), token) {
			t.Errorf("error %q quotes the device token", err)
		}
	}
	if err := s.Send(context.Background(), voipSub(testVoIPToken, "production", "com.uniworkos.chat"), ringMessage(now.Add(time.Minute))); err != nil {
		t.Fatal(err)
	}
	want := map[string]int{"sent:": 1, "gone:Unregistered": 1, "gone:BadDeviceToken": 1, "failed:DeviceTokenNotForTopic": 1,
		"failed:TooManyRequests": 1, "failed:ServiceUnavailable": 1, "failed:InvalidProviderToken": 1}
	for k, v := range want {
		if metrics.counts[k] != v {
			t.Errorf("metrics = %v, want %v", metrics.counts, want)
			break
		}
	}
}

type apnsMetricsSpy struct{ counts map[string]int }

func (m *apnsMetricsSpy) IncAPNsVoIP(result, reason string) {
	if m.counts == nil {
		m.counts = map[string]int{}
	}
	m.counts[result+":"+reason]++
}

// The VoIP sender sends only what CallKit acts on: a ring or its end, to a
// PushKit token, while the ring has not run out. A chat push, a missed call, an
// Expo token or a ring that already ended is skipped, never sent: every VoIP
// push must ring CallKit, and iOS stops waking an app that wastes them.
func TestAPNsVoIPSenderSkipsWhatCallKitDoesNotRing(t *testing.T) {
	fake := newFakeAPNs(t)
	_, pemKey := testAPNsKey(t)
	now := time.Date(2026, 10, 23, 9, 0, 0, 0, time.UTC)
	s := newTestAPNsSender(t, fake, APNsConfig{KeyID: "K", TeamID: "T", PrivateKey: pemKey}, &now)
	sub := voipSub(testVoIPToken, "production", "com.uniworkos.chat")
	missed := PushMessage{Title: "Cuộc gọi nhỡ", Call: CallPush{Type: CallPushMissed, CallID: "c1", RoomID: "r1"}}
	chat := PushMessage{Title: "Minh", Body: "chào", Chat: ChatPush{WorkspaceID: "ws1", RoomID: "r1", MessageID: "m1"}}
	expo := db.PushSubscription{Endpoint: "ExponentPushToken[iphone]", UserAgent: pgtype.Text{String: "expo/ios", Valid: true}}
	noBundle := voipSub(testVoIPToken, "production", "")
	for name, c := range map[string]struct {
		sub db.PushSubscription
		msg PushMessage
	}{
		"chat":          {sub, chat},
		"missed call":   {sub, missed},
		"expo token":    {expo, ringMessage(now.Add(time.Minute))},
		"ring ran out":  {sub, ringMessage(now.Add(-time.Second))},
		"no topic":      {noBundle, ringMessage(now.Add(time.Minute))},
		"bad env value": {voipSub(testVoIPToken, "staging", "com.uniworkos.chat"), ringMessage(now.Add(time.Minute))},
	} {
		if err := s.Send(context.Background(), c.sub, c.msg); !errors.Is(err, ErrPushSkipped) {
			t.Errorf("%s → %v, want ErrPushSkipped", name, err)
		}
	}
	if n := len(fake.requests()); n != 0 {
		t.Fatalf("APNs saw %d requests, want none", n)
	}
}

// No APNs key, no VoIP: the sender is nil and iPhones keep today's path. A key
// half configured, or one that is not a P-256 PKCS#8 key, is an error the
// server logs at start; an env file's escaped newlines are accepted.
func TestNewAPNsVoIPSenderNeedsTheWholeKey(t *testing.T) {
	s, err := NewAPNsVoIPSender(APNsConfig{})
	if s != nil || err != nil {
		t.Fatalf("empty config = %v, %v; want nil, nil (VoIP off)", s, err)
	}
	_, pemKey := testAPNsKey(t)
	for name, cfg := range map[string]APNsConfig{
		"no key id":  {TeamID: "T", PrivateKey: pemKey},
		"no team id": {KeyID: "K", PrivateKey: pemKey},
		"no key":     {KeyID: "K", TeamID: "T"},
		"not pem":    {KeyID: "K", TeamID: "T", PrivateKey: "MIGTAgEAMBMGByqGSM49"},
		"rsa key":    {KeyID: "K", TeamID: "T", PrivateKey: testRSAKeyPEM(t)},
	} {
		if s, err := NewAPNsVoIPSender(cfg); err == nil || s != nil {
			t.Errorf("%s: = %v, %v; want an error", name, s, err)
		}
	}
	escaped := strings.ReplaceAll(strings.TrimSpace(pemKey), "\n", `\n`)
	if s, err := NewAPNsVoIPSender(APNsConfig{KeyID: "K", TeamID: "T", PrivateKey: escaped}); err != nil || s == nil {
		t.Fatalf("escaped newlines: %v, %v", s, err)
	}
}

func TestPrefixSenderRoutesPushKitTokensToVoIP(t *testing.T) {
	expo, web, voip := &spySender{}, &spySender{}, &spySender{}
	sub := voipSub(testVoIPToken, "production", "com.uniworkos.chat")
	if err := NewPrefixSender(expo, web, voip).Send(context.Background(), sub, PushMessage{}); err != nil {
		t.Fatal(err)
	}
	if len(voip.sent) != 1 || len(web.sent) != 0 || len(expo.sent) != 0 {
		t.Fatalf("expo=%d web=%d voip=%d, want the PushKit token on VoIP only", len(expo.sent), len(web.sent), len(voip.sent))
	}
	// No APNs key: a PushKit token is acknowledged, never handed to Web Push.
	if err := NewPrefixSender(expo, web, nil).Send(context.Background(), sub, PushMessage{}); !errors.Is(err, ErrPushSkipped) || len(web.sent) != 0 {
		t.Fatalf("nil VoIP sender = %v (web sent %d), want ErrPushSkipped", err, len(web.sent))
	}
}

func testRSAKeyPEM(t *testing.T) string {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}
