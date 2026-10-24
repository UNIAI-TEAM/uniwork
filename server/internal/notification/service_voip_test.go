package notification

import (
	"errors"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// ADR 0038: an iPhone registers its PushKit token as a subscription of its
// own, with the APNs environment of its build and its bundle id, beside the
// Expo token; it needs neither VAPID nor an APNs key on the server, and it is
// tied to the device session like the Expo token is.
func TestServiceRegistersPushKitTokens(t *testing.T) {
	f := newFixture(t)
	svc := NewService(f.q, PushConfig{})
	token := strings.Repeat("Ab", 32)
	if err := svc.SubscribeVoIPPush(f.ctx, f.member.ID, "family-iphone", token, APNsProduction, "com.uniworkos.chat"); err != nil {
		t.Fatal(err)
	}
	// The app registers on every launch: a second call refreshes the same row,
	// and a development build moves it to the sandbox.
	if err := svc.SubscribeVoIPPush(f.ctx, f.member.ID, "family-iphone", token, APNsSandbox, "com.uniworkos.chat.staging"); err != nil {
		t.Fatal(err)
	}
	subs, err := f.q.ListActivePushSubscriptions(f.ctx, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(subs) != 1 {
		t.Fatalf("subs = %+v, want one PushKit subscription", subs)
	}
	s := subs[0]
	if !isVoIPSubscription(s) || s.Endpoint != strings.ToLower(token) || s.ApnsEnvironment.String != APNsSandbox ||
		s.ApnsBundleID.String != "com.uniworkos.chat.staging" || s.SessionID.String != "family-iphone" || s.P256dh != "" || s.Auth != "" {
		t.Fatalf("PushKit subscription = %+v", s)
	}
	if isExpoPushToken(s.Endpoint) || expoPlatform(s) != "" {
		t.Fatalf("a PushKit token reads as an Expo token: %+v", s)
	}

	var ve service.ValidationError
	for name, c := range map[string][3]string{
		"not hex":       {strings.Repeat("zz", 32), APNsProduction, "com.uniworkos.chat"},
		"too short":     {"abcd", APNsProduction, "com.uniworkos.chat"},
		"expo token":    {"ExponentPushToken[abc]", APNsProduction, "com.uniworkos.chat"},
		"no env":        {token, "", "com.uniworkos.chat"},
		"other env":     {token, "development", "com.uniworkos.chat"},
		"no bundle":     {token, APNsProduction, ""},
		"bundle no dot": {token, APNsProduction, "uniworkchat"},
		"bundle space":  {token, APNsProduction, "com.uniworkos.chat app"},
	} {
		if err := svc.SubscribeVoIPPush(f.ctx, f.member.ID, "", c[0], c[1], c[2]); !errors.As(err, &ve) {
			t.Errorf("%s → %v, want ValidationError", name, err)
		}
	}

	// Unsubscribing by the token as the app holds it closes the row.
	if err := svc.UnsubscribePush(f.ctx, f.member.ID, token); err != nil {
		t.Fatal(err)
	}
	if subs, err := f.q.ListActivePushSubscriptions(f.ctx, f.member.ID); err != nil || len(subs) != 0 {
		t.Fatalf("after unsubscribe: %+v, %v; want none", subs, err)
	}
}
