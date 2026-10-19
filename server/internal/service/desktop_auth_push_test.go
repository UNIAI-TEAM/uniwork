package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A revoked phone must stop receiving message previews: the push registered
// from a device session dies with it (UNI-1838 security review), while the
// pushes of the user's other devices and browsers keep going.
func TestRevokingADeviceClosesThePushItRegistered(t *testing.T) {
	ctx := context.Background()
	svc, authSvc := newDesktopTestServices(t)
	userID, phone := desktopTestSession(t, svc, authSvc, "push-revoke@example.com")
	laptop := desktopTestExtraDevice(t, svc, userID)

	subscribe := func(endpoint, sessionID string) {
		t.Helper()
		if _, err := svc.q.UpsertPushSubscription(ctx, db.UpsertPushSubscriptionParams{
			ID: util.NewID(), UserID: userID, Endpoint: endpoint,
			SessionID: pgtype.Text{String: sessionID, Valid: sessionID != ""},
		}); err != nil {
			t.Fatal(err)
		}
	}
	subscribe("ExponentPushToken[phone]", phone.SessionID)
	subscribe("ExponentPushToken[laptop]", laptop.SessionID)
	subscribe("https://push.example/browser", "web-session")
	subscribe("ExponentPushToken[legacy]", "")

	active := func() map[string]bool {
		t.Helper()
		rows, err := svc.q.ListActivePushSubscriptions(ctx, userID)
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]bool{}
		for _, r := range rows {
			out[r.Endpoint] = true
		}
		return out
	}

	if err := svc.Revoke(ctx, userID, phone.DeviceSessionID); err != nil {
		t.Fatal(err)
	}
	got := active()
	if got["ExponentPushToken[phone]"] || !got["ExponentPushToken[laptop]"] || !got["https://push.example/browser"] {
		t.Fatalf("after revoking the phone, active pushes = %v; want the phone's closed, the others kept", got)
	}

	if err := svc.RevokeAll(ctx, userID); err != nil {
		t.Fatal(err)
	}
	got = active()
	if got["ExponentPushToken[laptop]"] {
		t.Fatalf("RevokeAll kept a device's push: %v", got)
	}
	// The browser cannot re-register on its own, and a row with no session
	// predates the column: neither belongs to a device session.
	if !got["https://push.example/browser"] || !got["ExponentPushToken[legacy]"] {
		t.Fatalf("RevokeAll closed a push that no device session registered: %v", got)
	}
}

// desktopTestExtraDevice signs userID in on one more native device.
func desktopTestExtraDevice(t *testing.T, svc *DesktopAuthService, userID string) DesktopSession {
	t.Helper()
	ctx := context.Background()
	verifier := "zyxwvutsrqponmlkjihgfedcbaZYXWVUTSRQPONMLKJIHGFEDCBA9876543210-_"
	sum := sha256.Sum256([]byte(verifier))
	attempt, err := svc.Start(ctx, DesktopStartInput{ClientID: "uniwork-office", CodeChallenge: base64.RawURLEncoding.EncodeToString(sum[:]), CodeChallengeMethod: "S256", State: "state-extra", RedirectURI: "uniwork-office://auth/callback", DeploymentID: "default", DeviceLabel: "Second", Platform: "macos", Build: "1.0"})
	if err != nil {
		t.Fatal(err)
	}
	consent, err := svc.Consent(ctx, userID, attempt.ID)
	if err != nil {
		t.Fatal(err)
	}
	code, _, err := svc.Approve(ctx, userID, attempt.ID, consent.CSRFToken)
	if err != nil {
		t.Fatal(err)
	}
	sess, err := svc.Exchange(ctx, "uniwork-office", code, verifier, "uniwork-office://auth/callback", "default")
	if err != nil {
		t.Fatal(err)
	}
	return sess
}
