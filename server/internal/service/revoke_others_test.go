package service

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// deviceSignIn runs the desktop PKCE flow for uid and returns its session.
func (f *identityFixture) deviceSignIn(t *testing.T, uid, state string) DesktopSession {
	t.Helper()
	verifier := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
	sum := sha256.Sum256([]byte(verifier))
	attempt, err := f.desktop.Start(f.ctx, DesktopStartInput{ClientID: "uniwork-office", CodeChallenge: base64.RawURLEncoding.EncodeToString(sum[:]), CodeChallengeMethod: "S256", State: state, RedirectURI: "uniwork-office://auth/callback", DeploymentID: "default", DeviceLabel: "Laptop", Platform: "windows", Build: "1.0"})
	if err != nil {
		t.Fatal(err)
	}
	consent, err := f.desktop.Consent(f.ctx, uid, attempt.ID)
	if err != nil {
		t.Fatal(err)
	}
	code, _, err := f.desktop.Approve(f.ctx, uid, attempt.ID, consent.CSRFToken)
	if err != nil {
		t.Fatal(err)
	}
	sess, err := f.desktop.Exchange(f.ctx, "uniwork-office", code, verifier, "uniwork-office://auth/callback", "default")
	if err != nil {
		t.Fatal(err)
	}
	return sess
}

// push registers a push subscription for uid; session "" is a browser's.
func (f *identityFixture) push(t *testing.T, uid, session string) string {
	t.Helper()
	id := util.NewID()
	if _, err := f.q.UpsertPushSubscription(f.ctx, db.UpsertPushSubscriptionParams{
		ID: id, UserID: uid, Endpoint: "https://push.example/" + id, P256dh: "p", Auth: "a",
		SessionID: pgtype.Text{String: session, Valid: session != ""},
	}); err != nil {
		t.Fatal(err)
	}
	return id
}

// lease grants deviceID an offline lease straight in the table: the lease
// service needs a document, and only the device the row names matters here.
func (f *identityFixture) lease(t *testing.T, uid, deviceID string) string {
	t.Helper()
	id := util.NewID()
	if _, err := f.pool.Exec(f.ctx, `INSERT INTO office_offline_leases
		(id, organization_id, workspace_id, document_id, user_id, device_session_id, deployment_id,
		 version, revision, level, policy_epoch, issued_at, expires_at, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, $5, $6, 'default', 1, 1, 'view', 0, now(), now() + interval '1 day', $5, 'human')`,
		id, util.NewID(), util.NewID(), util.NewID(), uid, deviceID); err != nil {
		t.Fatal(err)
	}
	return id
}

func (f *identityFixture) live(t *testing.T, table, id string) bool {
	t.Helper()
	return f.count(t, `SELECT count(*) FROM `+table+` WHERE id = $1 AND revoked_at IS NULL`, id) == 1
}

// "Sign out other sessions" ends every session but the caller's, the apps
// included (spec §3.7): it used to close only browser sessions and leave
// the phone and desktop signed in. A browser caller keeps only itself; an
// app caller keeps its device family. The other devices' pushes and offline
// leases go with them; browser pushes stay, as in a user-wide revoke.
func TestRevokeOthersEndsDeviceSessions(t *testing.T) {
	f := newIdentityFixture(t)
	u := registerVerified(t, f.q, f.auth, "others@example.com", "Others")
	current, err := f.auth.Login(f.ctx, "others@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	other, err := f.auth.Login(f.ctx, "others@example.com", "password123")
	if err != nil {
		t.Fatal(err)
	}
	device := f.deviceSignIn(t, u.ID, "state-device")
	devicePush, browserPush := f.push(t, u.ID, device.SessionID), f.push(t, u.ID, "")
	deviceLease := f.lease(t, u.ID, device.DeviceSessionID)

	n, err := f.auth.RevokeOtherSessions(f.ctx, u.ID, current.SessionID)
	if err != nil || n < 2 {
		t.Fatalf("revoke others = %d %v, want the other browser and the device", n, err)
	}
	kept, err := f.auth.Refresh(f.ctx, current.RefreshToken)
	if err != nil {
		t.Fatalf("the caller's own session: %v", err)
	}
	if _, err := f.auth.Refresh(f.ctx, other.RefreshToken); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("the other browser session refreshes: %v", err)
	}
	if err := f.desktop.CheckDeviceSession(f.ctx, u.ID, device.DeviceSessionID); !errors.Is(err, ErrDesktopDeviceRevoked) {
		t.Fatalf("the device session is alive: %v", err)
	}
	if _, err := f.desktop.Refresh(f.ctx, device.DeviceSessionID, device.RefreshToken, "default"); err == nil {
		t.Fatal("the device refreshes")
	}
	if f.live(t, "push_subscriptions", devicePush) || !f.live(t, "push_subscriptions", browserPush) {
		t.Fatal("the device's push goes, the browser's stays")
	}
	if f.live(t, "office_offline_leases", deviceLease) {
		t.Fatal("the device's offline lease survived")
	}
	if n := f.count(t, `SELECT count(*) FROM audit_events WHERE action = $1 AND actor_id = $2
		AND metadata::jsonb->>'scope' = 'others' AND (metadata::jsonb->>'device_sessions')::int = 1`, audit.ActionAuthSessionRevoked, u.ID); n != 1 {
		t.Fatalf("%d session_revoked rows naming the device, want 1", n)
	}
	if n := f.count(t, `SELECT count(*) FROM outbox_events WHERE topic = 'session.revoked' AND payload::jsonb->>'user_id' = $1`, u.ID); n != 1 {
		t.Fatalf("%d session.revoked events, want 1", n)
	}

	// An app caller keeps its own family, siblings included, and ends the
	// browser sessions.
	phone := f.deviceSignIn(t, u.ID, "state-phone")
	sibling := util.NewID()
	if _, err := f.q.CreateDeviceSession(f.ctx, db.CreateDeviceSessionParams{
		ID: sibling, UserID: u.ID, SessionFamilyID: phone.SessionID, ClientID: "uniwork-office", DeploymentID: "default",
		DeviceLabel: "Laptop", Platform: "windows", Build: "1.0", RefreshTokenDigest: "sibling-digest",
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}, CreatedByKind: string(audit.KindHuman),
	}); err != nil {
		t.Fatal(err)
	}
	phonePush, phoneLease := f.push(t, u.ID, phone.SessionID), f.lease(t, u.ID, phone.DeviceSessionID)
	if _, err := f.auth.RevokeOtherSessions(f.ctx, u.ID, phone.DeviceSessionID); err != nil {
		t.Fatal(err)
	}
	if err := f.desktop.CheckDeviceSession(f.ctx, u.ID, phone.DeviceSessionID); err != nil {
		t.Fatalf("the caller's device: %v", err)
	}
	if err := f.desktop.CheckDeviceSession(f.ctx, u.ID, sibling); err != nil {
		t.Fatalf("the caller's family sibling: %v", err)
	}
	if !f.live(t, "push_subscriptions", phonePush) || !f.live(t, "office_offline_leases", phoneLease) {
		t.Fatal("the caller's own push and lease stay")
	}
	if _, err := f.desktop.Refresh(f.ctx, phone.DeviceSessionID, phone.RefreshToken, "default"); err != nil {
		t.Fatalf("the caller's device refreshes: %v", err)
	}
	if _, err := f.auth.Refresh(f.ctx, kept.RefreshToken); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("the browser session survived an app's revoke-others: %v", err)
	}
}
