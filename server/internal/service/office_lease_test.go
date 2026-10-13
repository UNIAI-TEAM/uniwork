package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// G5-08s (UNI-1350): the offline lease against a real database. Test names
// follow the threat model of DOC-005 §6.2 (T1-T17); the revoke paths, the
// sweep and the operator revoke are in office_lease_revoke_test.go.

// officeLeaseTestSecret is a synthetic signing secret, never a real one.
const officeLeaseTestSecret = "office-lease-test-secret-synthetic"

type leaseWorld struct {
	f       *docPermFixture
	ctx     context.Context
	tn      docTenant
	leases  *OfficeLeaseService
	desk    *DesktopAuthService
	revoker *OfficeLeaseRevoker
}

func newLeaseWorld(t *testing.T, slug string) *leaseWorld {
	t.Helper()
	f := newDocPermFixture(t)
	w := &leaseWorld{f: f, ctx: f.ctx, tn: f.tenant(t, slug)}
	w.leases = w.leaseService(t, officeLeaseTestSecret, true)
	w.desk = NewDesktopAuthService(f.pool, f.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, config.Config{
		FrontendOrigin: "http://localhost:13380", DesktopAuthClientID: "uniwork-office",
		DesktopAuthRedirectURIs: []string{"uniwork-office://auth/callback"}, DesktopAuthDeploymentIDs: []string{"default"},
		DesktopAuthCodeTTL: 120 * time.Second, DesktopAuthAttemptTTL: 10 * time.Minute, RefreshTokenTTL: time.Hour,
	})
	w.revoker = NewOfficeLeaseRevoker(f.svc)
	return w
}

// officeLeaseFlags is the real flag service with office_offline_library
// forced on or off globally.
func officeLeaseFlags(t *testing.T, on bool) *featureflag.Service {
	t.Helper()
	flags, _, err := featureflags.NewService(graphFlagStore{rows: []db.FeatureFlagOverride{
		{FlagKey: officeOfflineLibraryFlag, ScopeType: featureflags.ScopeGlobal, Enabled: on},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return flags
}

func (w *leaseWorld) leaseService(t *testing.T, secret string, flagOn bool) *OfficeLeaseService {
	t.Helper()
	return NewOfficeLeaseService(w.f.svc, officeLeaseFlags(t, flagOn), config.Config{
		JWTSecret: secret, DesktopAuthDeploymentIDs: []string{"default"},
	})
}

// device inserts a live desktop device session of the user, one family of
// its own, the shape Exchange creates.
func (w *leaseWorld) device(t *testing.T, userID string) string {
	t.Helper()
	return w.deviceWith(t, userID, "default", time.Now().Add(30*24*time.Hour))
}

func (w *leaseWorld) deviceWith(t *testing.T, userID, deployment string, expires time.Time) string {
	t.Helper()
	id := util.NewID()
	if _, err := w.f.q.CreateDeviceSession(w.ctx, db.CreateDeviceSessionParams{
		ID: id, UserID: userID, SessionFamilyID: id, ClientID: "uniwork-office", DeploymentID: deployment,
		DeviceLabel: "Laptop", Platform: "windows", Build: "1.0", RefreshTokenDigest: hashToken("lease-device-" + id),
		ExpiresAt: pgtype.Timestamptz{Time: expires, Valid: true}, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	return id
}

// file is a file document of workspace A whose ACL owner is aclOwner:
// "workspace" gives every member of A edit, "restricted" only the shares.
func (w *leaseWorld) file(t *testing.T, visibility string) db.Document {
	t.Helper()
	return w.fileIn(t, w.tn.orgID, w.tn.wsA, w.tn.aclOwner.ID, visibility)
}

func (w *leaseWorld) fileIn(t *testing.T, orgID, wsID, aclOwnerID, visibility string) db.Document {
	t.Helper()
	id, verID := util.NewID(), util.NewID()
	insertRow(t, w.ctx, w.f.pool, "documents", baseDoc(map[string]any{
		"id": id, "organization_id": orgID, "workspace_id": wsID, "kind": "file",
		"visibility": visibility, "acl_owner_id": aclOwnerID,
		"created_by": aclOwnerID, "updated_by": aclOwnerID,
		"file_version_id": verID, "current_version": 1,
	}))
	insertRow(t, w.ctx, w.f.pool, "document_versions", map[string]any{
		"id": verID, "organization_id": orgID, "workspace_id": wsID, "document_id": id,
		"version": 1, "kind": "file", "reason": "upload", "file_id": util.NewID(),
		"created_by": aclOwnerID, "created_by_kind": "human",
	})
	d, err := w.f.q.GetDocumentByID(w.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func (w *leaseWorld) put(svc *OfficeLeaseService, userID, device, documentID, lease string) (OfficeLease, error) {
	return svc.Put(w.ctx, Human(userID), OfficeLeasePutInput{DocumentID: documentID, DeviceSessionID: device, Lease: lease})
}

func (w *leaseWorld) grant(t *testing.T, userID, device, documentID string) OfficeLease {
	t.Helper()
	l, err := w.put(w.leases, userID, device, documentID, "")
	if err != nil {
		t.Fatalf("grant: %v", err)
	}
	return l
}

type leaseRowState struct {
	exists, revoked bool
	reason          string
	generation      int32
	expiresAt       time.Time
}

func (w *leaseWorld) state(t *testing.T, leaseID string) leaseRowState {
	t.Helper()
	var s leaseRowState
	var expires pgtype.Timestamptz
	err := w.f.pool.QueryRow(w.ctx,
		`SELECT revoked_at IS NOT NULL, coalesce(revoke_reason, ''), generation, expires_at FROM office_offline_leases WHERE id = $1`,
		leaseID).Scan(&s.revoked, &s.reason, &s.generation, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return s
	}
	if err != nil {
		t.Fatal(err)
	}
	s.exists, s.expiresAt = true, expires.Time
	return s
}

func (w *leaseWorld) requireLive(t *testing.T, leaseID string) {
	t.Helper()
	if s := w.state(t, leaseID); !s.exists || s.revoked {
		t.Fatalf("lease %s = %+v, want live", leaseID, s)
	}
}

// requireRevoked checks the row and the audit row plus office_lease.revoked
// event every revoke writes beside it (G5-D1 row 16), exactly once.
func (w *leaseWorld) requireRevoked(t *testing.T, leaseID, reason string) {
	t.Helper()
	if s := w.state(t, leaseID); !s.exists || !s.revoked || s.reason != reason {
		t.Fatalf("lease %s = %+v, want revoked %s", leaseID, s, reason)
	}
	var audits, events int
	if err := w.f.pool.QueryRow(w.ctx, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionOfficeOfflineLeaseRevoked, leaseID).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if err := w.f.pool.QueryRow(w.ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'office_lease.revoked' AND payload::jsonb->>'lease_id' = $1`,
		leaseID).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if audits != 1 || events != 1 {
		t.Fatalf("lease %s revoke wrote %d audit rows and %d events, want 1 and 1", leaseID, audits, events)
	}
}

// deliver hands every outbox row of the topic to the lease revoker, as the
// dispatcher would; the revoker is idempotent, so a row seen twice is fine.
func (w *leaseWorld) deliver(t *testing.T, topic string) {
	t.Helper()
	rows, err := w.f.pool.Query(w.ctx, `SELECT id, topic, payload, organization_id FROM outbox_events WHERE topic = $1 ORDER BY created_at, id`, topic)
	if err != nil {
		t.Fatal(err)
	}
	var evs []outbox.Row
	for rows.Next() {
		var ev outbox.Row
		if err := rows.Scan(&ev.ID, &ev.Topic, &ev.Payload, &ev.OrganizationID); err != nil {
			t.Fatal(err)
		}
		evs = append(evs, ev)
	}
	rows.Close()
	if len(evs) == 0 {
		t.Fatalf("no %s event to deliver", topic)
	}
	for _, ev := range evs {
		if err := w.revoker.Handle(w.ctx, ev); err != nil {
			t.Fatalf("deliver %s: %v", topic, err)
		}
	}
}

func requireLeaseCode(t *testing.T, err error, code string) {
	t.Helper()
	if !codedIs(err, code) {
		t.Fatalf("err = %v, want %s", err, code)
	}
}

// flipLeaseTokenChar swaps one base64 character of the token for another
// valid one, so the change survives decoding and only the MAC can catch it.
func flipLeaseTokenChar(token string, i int) string {
	b := []byte(token)
	if b[i] == 'A' {
		b[i] = 'B'
	} else {
		b[i] = 'A'
	}
	return string(b)
}

// fixedLeaseClock pins the lease clock to the second, the precision every
// assertion below compares at.
func fixedLeaseClock(svc *OfficeLeaseService, at time.Time) time.Time {
	at = at.UTC().Truncate(time.Second)
	svc.SetClock(func() time.Time { return at })
	return at
}

// T1: a lease lives at most 24 h and never past its device session; a
// device logout revokes the device's leases in the logout's transaction, a
// family logout every device's of the family.
func TestOfficeLeaseExpiresWithinTTL(t *testing.T) {
	w := newLeaseWorld(t, "lease-ttl")
	d := w.file(t, documentVisibilityWorkspace)
	now := fixedLeaseClock(w.leases, time.Now())

	l := w.grant(t, w.tn.member.ID, w.device(t, w.tn.member.ID), d.ID)
	if !l.ExpiresAt.Equal(now.Add(OfficeLeaseTTL)) || !l.IssuedAt.Equal(now) || !l.ServerTime.Equal(now) {
		t.Fatalf("lease times = issued %v expires %v server %v, want %v + 24h", l.IssuedAt, l.ExpiresAt, l.ServerTime, now)
	}
	if !l.RenewAfter.Equal(now.Add(OfficeLeaseTTL / 2)) {
		t.Fatalf("renew_after = %v, want half the lifetime", l.RenewAfter)
	}
	claims, ok := w.leases.codec.verify(l.Token)
	if !ok || claims.ExpiresAt != l.ExpiresAt.Unix() || claims.LeaseID != l.LeaseID || claims.Level != officeLeaseLevelEdit {
		t.Fatalf("claims = %+v ok=%v, want the row's expiry, id and level", claims, ok)
	}
	if l.VersionID == "" || l.VersionID != d.FileVersionID.String || l.Version != 1 {
		t.Fatalf("lease binds version %q/%d, want the head %q/1", l.VersionID, l.Version, d.FileVersionID.String)
	}

	// A device that ends sooner caps the lease.
	short := now.Add(2 * time.Hour)
	l2 := w.grant(t, w.tn.member.ID, w.deviceWith(t, w.tn.member.ID, "default", short), d.ID)
	if !l2.ExpiresAt.Equal(short) {
		t.Fatalf("lease on a device ending at %v expires %v", short, l2.ExpiresAt)
	}
	if s := w.state(t, l2.LeaseID); !s.expiresAt.Equal(short) {
		t.Fatalf("stored expiry %v, want %v", s.expiresAt, short)
	}
}

func TestOfficeLeaseRevokedWithDeviceLogout(t *testing.T) {
	w := newLeaseWorld(t, "lease-logout")
	d := w.file(t, documentVisibilityWorkspace)
	m := w.tn.member.ID
	d1, d2 := w.device(t, m), w.device(t, m)
	l1, l2 := w.grant(t, m, d1, d.ID), w.grant(t, m, d2, d.ID)

	if err := w.desk.Logout(w.ctx, m, d1, "default", "device"); err != nil {
		t.Fatal(err)
	}
	w.requireRevoked(t, l1.LeaseID, OfficeLeaseRevokeDeviceRevoked)
	w.requireLive(t, l2.LeaseID)
	_, err := w.put(w.leases, m, d1, d.ID, l1.Token)
	requireLeaseCode(t, err, "device_revoked")

	if err := w.desk.Logout(w.ctx, m, d2, "default", "family"); err != nil {
		t.Fatal(err)
	}
	w.requireRevoked(t, l2.LeaseID, OfficeLeaseRevokeDeviceRevoked)
}

// T2: a stolen device that comes back online cannot renew once revoked.
func TestOfficeLeaseRenewRefusedAfterDeviceRevoke(t *testing.T) {
	w := newLeaseWorld(t, "lease-devrevoke")
	d := w.file(t, documentVisibilityWorkspace)
	m := w.tn.member.ID
	dev := w.device(t, m)
	l := w.grant(t, m, dev, d.ID)

	if err := w.desk.Revoke(w.ctx, m, dev); err != nil {
		t.Fatal(err)
	}
	w.requireRevoked(t, l.LeaseID, OfficeLeaseRevokeDeviceRevoked)
	_, err := w.put(w.leases, m, dev, d.ID, l.Token)
	requireLeaseCode(t, err, "device_revoked")
	_, err = w.put(w.leases, m, dev, d.ID, "")
	requireLeaseCode(t, err, "device_revoked")
}

func TestOfficeLeaseRevokedWithRevokeAll(t *testing.T) {
	w := newLeaseWorld(t, "lease-revokeall")
	d1, d2 := w.file(t, documentVisibilityWorkspace), w.file(t, documentVisibilityWorkspace)
	m := w.tn.member.ID
	dev1, dev2 := w.device(t, m), w.device(t, m)
	l1, l2 := w.grant(t, m, dev1, d1.ID), w.grant(t, m, dev2, d2.ID)
	other := w.grant(t, w.tn.creator.ID, w.device(t, w.tn.creator.ID), d1.ID)

	if err := w.desk.RevokeAll(w.ctx, m); err != nil {
		t.Fatal(err)
	}
	w.requireRevoked(t, l1.LeaseID, OfficeLeaseRevokeSessionRevoked)
	w.requireRevoked(t, l2.LeaseID, OfficeLeaseRevokeSessionRevoked)
	w.requireLive(t, other.LeaseID)
	_, err := w.put(w.leases, m, dev2, d2.ID, l2.Token)
	requireLeaseCode(t, err, "device_revoked")
}

// T3: a renewal re-reads the live ACL; a stored row is no permission.
func TestOfficeLeaseRenewRechecksLiveACL(t *testing.T) {
	w := newLeaseWorld(t, "lease-acl")
	d := w.file(t, documentVisibilityRestricted)
	m := w.tn.member.ID
	sh := w.f.share(t, d, DocumentPrincipalUser, m, DocumentLevelView, w.tn.aclOwner.ID)
	dev := w.device(t, m)
	l := w.grant(t, m, dev, d.ID)

	// The share goes without its event reaching the revoker: the renewal
	// alone must refuse.
	w.f.revoke(t, sh, w.tn.aclOwner.ID)
	if _, err := w.put(w.leases, m, dev, d.ID, l.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("renewal after the share went = %v, want not found", err)
	}
	if _, err := w.put(w.leases, m, dev, d.ID, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("fresh grant after the share went = %v, want not found", err)
	}
	if s := w.state(t, l.LeaseID); s.generation != 1 {
		t.Fatalf("refused renewal touched the row: %+v", s)
	}
}

// T8: there is no offline renewal; an expired lease renews only through the
// same live ACL check.
func TestOfficeLeaseRenewAfterExpiryRechecksACL(t *testing.T) {
	w := newLeaseWorld(t, "lease-expired")
	d := w.file(t, documentVisibilityRestricted)
	m, c := w.tn.member.ID, w.tn.creator.ID
	sh := w.f.share(t, d, DocumentPrincipalUser, m, DocumentLevelView, w.tn.aclOwner.ID)
	w.f.share(t, d, DocumentPrincipalUser, c, DocumentLevelView, w.tn.aclOwner.ID)
	now := fixedLeaseClock(w.leases, time.Now())
	devM, devC := w.device(t, m), w.device(t, c)
	lm, lc := w.grant(t, m, devM, d.ID), w.grant(t, c, devC, d.ID)

	later := fixedLeaseClock(w.leases, now.Add(OfficeLeaseTTL+time.Hour))
	w.f.revoke(t, sh, w.tn.aclOwner.ID)
	if _, err := w.put(w.leases, m, devM, d.ID, lm.Token); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired lease without access renewed: %v", err)
	}
	renewed, err := w.put(w.leases, c, devC, d.ID, lc.Token)
	if err != nil {
		t.Fatalf("expired lease with access: %v", err)
	}
	if renewed.LeaseID != lc.LeaseID || renewed.Generation != 2 || !renewed.Renewed || !renewed.ExpiresAt.Equal(later.Add(OfficeLeaseTTL)) {
		t.Fatalf("renewal = %+v, want the same id at generation 2 expiring a day from now", renewed)
	}
}

// T10: a lease copied to another device does not renew there.
func TestOfficeLeaseRenewFromOtherDeviceRefused(t *testing.T) {
	w := newLeaseWorld(t, "lease-otherdev")
	d := w.file(t, documentVisibilityWorkspace)
	m := w.tn.member.ID
	dev1, dev2 := w.device(t, m), w.device(t, m)
	l := w.grant(t, m, dev1, d.ID)

	_, err := w.put(w.leases, m, dev2, d.ID, l.Token)
	requireLeaseCode(t, err, "offline_lease_revoked")
	if s := w.state(t, l.LeaseID); !s.exists || s.revoked || s.generation != 1 {
		t.Fatalf("the first device's lease changed: %+v", s)
	}
	var n int
	if err := w.f.pool.QueryRow(w.ctx, `SELECT count(*) FROM office_offline_leases WHERE device_session_id = $1`, dev2).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("the replay left %d rows on the second device", n)
	}
}

// T6 (service half; TestIsolationMatrix holds the route): a lease of another
// account names a row that is not the caller's.
func TestOfficeLeaseFromOtherAccountRefused(t *testing.T) {
	w := newLeaseWorld(t, "lease-otheracct")
	d := w.file(t, documentVisibilityWorkspace)
	m, c := w.tn.member.ID, w.tn.creator.ID
	l := w.grant(t, m, w.device(t, m), d.ID)
	devC := w.device(t, c)

	_, err := w.put(w.leases, c, devC, d.ID, l.Token)
	requireLeaseCode(t, err, "offline_lease_revoked")
	// Another person's device sid is the session layer's refusal.
	devM := w.device(t, m)
	_, err = w.put(w.leases, c, devM, d.ID, "")
	requireLeaseCode(t, err, "device_revoked")
	w.requireLive(t, l.LeaseID)
}

// T12: a demoted editor renews into a view lease.
func TestOfficeLeaseRenewDowngradesToView(t *testing.T) {
	w := newLeaseWorld(t, "lease-downgrade")
	d := w.file(t, documentVisibilityRestricted)
	m := w.tn.member.ID
	sh := w.f.share(t, d, DocumentPrincipalUser, m, DocumentLevelEdit, w.tn.aclOwner.ID)
	dev := w.device(t, m)
	l := w.grant(t, m, dev, d.ID)
	if l.Level != officeLeaseLevelEdit {
		t.Fatalf("editor lease level = %q", l.Level)
	}
	w.f.revoke(t, sh, w.tn.aclOwner.ID)
	w.f.share(t, d, DocumentPrincipalUser, m, DocumentLevelView, w.tn.aclOwner.ID)

	r, err := w.put(w.leases, m, dev, d.ID, l.Token)
	if err != nil {
		t.Fatal(err)
	}
	claims, _ := w.leases.codec.verify(r.Token)
	if r.Level != officeLeaseLevelView || claims.Level != officeLeaseLevelView || r.LeaseID != l.LeaseID || r.Generation != 2 {
		t.Fatalf("renewal = level %q claim %q id %s gen %d, want view on the same row", r.Level, claims.Level, r.LeaseID, r.Generation)
	}
	// Manage reads as edit offline.
	owner := w.grant(t, w.tn.aclOwner.ID, w.device(t, w.tn.aclOwner.ID), d.ID)
	if owner.Level != officeLeaseLevelEdit {
		t.Fatalf("manager lease level = %q, want edit", owner.Level)
	}
}

// T7: the server trusts the signature and the row, never a claim.
func TestOfficeLeaseForgedSignatureRefused(t *testing.T) {
	w := newLeaseWorld(t, "lease-forged")
	d := w.file(t, documentVisibilityWorkspace)
	m := w.tn.member.ID
	dev := w.device(t, m)
	l := w.grant(t, m, dev, d.ID)
	claims, ok := w.leases.codec.verify(l.Token)
	if !ok {
		t.Fatal("own token does not verify")
	}
	foreign, err := newOfficeLeaseCodec("another-synthetic-secret").sign(claims)
	if err != nil {
		t.Fatal(err)
	}
	dot := strings.LastIndex(l.Token, ".")
	for name, tok := range map[string]string{
		"flipped signature": flipLeaseTokenChar(l.Token, dot+1),
		"no signature":      l.Token[:dot],
		"another key":       foreign,
		"not a lease":       "not-a-lease",
	} {
		_, err := w.put(w.leases, m, dev, d.ID, tok)
		if !codedIs(err, "offline_lease_revoked") {
			t.Fatalf("%s: %v, want offline_lease_revoked", name, err)
		}
	}
	if s := w.state(t, l.LeaseID); !s.exists || s.revoked || s.generation != 1 {
		t.Fatalf("a forged renewal touched the row: %+v", s)
	}
}

func TestOfficeLeaseTamperedClaimsIgnored(t *testing.T) {
	w := newLeaseWorld(t, "lease-tampered")
	d := w.file(t, documentVisibilityRestricted)
	m := w.tn.member.ID
	w.f.share(t, d, DocumentPrincipalUser, m, DocumentLevelView, w.tn.aclOwner.ID)
	now := fixedLeaseClock(w.leases, time.Now())
	dev := w.device(t, m)
	l := w.grant(t, m, dev, d.ID)
	claims, _ := w.leases.codec.verify(l.Token)

	// A payload edited under the old signature does not verify.
	_, err := w.put(w.leases, m, dev, d.ID, flipLeaseTokenChar(l.Token, len(officeLeaseTokenPrefix)+5))
	requireLeaseCode(t, err, "offline_lease_revoked")

	// Even a well-signed token only picks the row: level, expiry, epoch,
	// generation and version come from the row and the live ACL.
	claims.Level, claims.ExpiresAt, claims.Generation = officeLeaseLevelEdit, now.Add(365*24*time.Hour).Unix(), 99
	claims.VersionID, claims.Version, claims.WorkspaceID = "forged-version", 42, w.tn.wsB
	inflated, err := w.leases.codec.sign(claims)
	if err != nil {
		t.Fatal(err)
	}
	r, err := w.put(w.leases, m, dev, d.ID, inflated)
	if err != nil {
		t.Fatal(err)
	}
	if r.Level != officeLeaseLevelView || !r.ExpiresAt.Equal(now.Add(OfficeLeaseTTL)) || r.Generation != 2 ||
		r.VersionID != d.FileVersionID.String || r.Version != 1 || r.WorkspaceID != w.tn.wsA {
		t.Fatalf("renewal took a claim: %+v", r)
	}
}

// T13: a token is never enough without its row; a rotated secret ends every
// lease, and the app gets a fresh one when online.
func TestOfficeLeaseRequiresStoredRow(t *testing.T) {
	w := newLeaseWorld(t, "lease-row")
	d := w.file(t, documentVisibilityWorkspace)
	m := w.tn.member.ID
	dev := w.device(t, m)
	l := w.grant(t, m, dev, d.ID)
	claims, _ := w.leases.codec.verify(l.Token)

	claims.LeaseID = util.NewID()
	unknown, err := w.leases.codec.sign(claims)
	if err != nil {
		t.Fatal(err)
	}
	_, err = w.put(w.leases, m, dev, d.ID, unknown)
	requireLeaseCode(t, err, "offline_lease_revoked")

	if err := w.leases.Release(w.ctx, Human(m), d.ID, dev); err != nil {
		t.Fatal(err)
	}
	_, err = w.put(w.leases, m, dev, d.ID, l.Token)
	requireLeaseCode(t, err, "offline_lease_revoked")
}

func TestOfficeLeaseSecretRotationRevokes(t *testing.T) {
	w := newLeaseWorld(t, "lease-rotate")
	d := w.file(t, documentVisibilityWorkspace)
	m := w.tn.member.ID
	dev := w.device(t, m)
	l := w.grant(t, m, dev, d.ID)

	rotated := w.leaseService(t, "rotated-synthetic-secret", true)
	_, err := w.put(rotated, m, dev, d.ID, l.Token)
	requireLeaseCode(t, err, "offline_lease_revoked")
	fresh, err := w.put(rotated, m, dev, d.ID, "")
	if err != nil {
		t.Fatalf("re-grant after rotation: %v", err)
	}
	if _, ok := rotated.codec.verify(fresh.Token); !ok {
		t.Fatal("the re-granted lease is not signed with the new key")
	}
	if _, ok := w.leases.codec.verify(fresh.Token); ok {
		t.Fatal("the re-granted lease still verifies under the old key")
	}
}

// T15: one device holds at most OfficeLeaseDeviceCap live leases; renewals
// and other devices are not held by it.
func TestOfficeLeaseLimitPerDevice(t *testing.T) {
	w := newLeaseWorld(t, "lease-cap")
	d1, d2 := w.file(t, documentVisibilityWorkspace), w.file(t, documentVisibilityWorkspace)
	m := w.tn.member.ID
	dev := w.device(t, m)
	l1 := w.grant(t, m, dev, d1.ID)
	var filler []string
	for i := 0; i < OfficeLeaseDeviceCap-1; i++ {
		id := util.NewID()
		filler = append(filler, id)
		insertRow(t, w.ctx, w.f.pool, "office_offline_leases", map[string]any{
			"id": id, "organization_id": w.tn.orgID, "workspace_id": w.tn.wsA, "document_id": util.NewID(),
			"user_id": m, "device_session_id": dev, "deployment_id": "default", "version": 1, "revision": 1,
			"level": "view", "policy_epoch": 0, "issued_at": time.Now(), "expires_at": time.Now().Add(time.Hour),
			"created_by": m, "created_by_kind": "human",
		})
	}

	_, err := w.put(w.leases, m, dev, d2.ID, "")
	requireLeaseCode(t, err, "offline_lease_limit_reached")
	var ce CodedError
	if !errors.As(err, &ce) || ce.Fields["limit"] != OfficeLeaseDeviceCap || ce.Status != 409 {
		t.Fatalf("limit answer = %+v, want 409 with fields.limit", ce)
	}
	if _, err := w.put(w.leases, m, dev, d1.ID, l1.Token); err != nil {
		t.Fatalf("renewal at the cap: %v", err)
	}
	if _, err := w.put(w.leases, m, w.device(t, m), d2.ID, ""); err != nil {
		t.Fatalf("another device at the first one's cap: %v", err)
	}
	// An expired row frees its slot.
	if _, err := w.f.pool.Exec(w.ctx, `UPDATE office_offline_leases SET expires_at = now() - interval '1 minute' WHERE id = $1`, filler[0]); err != nil {
		t.Fatal(err)
	}
	if _, err := w.put(w.leases, m, dev, d2.ID, ""); err != nil {
		t.Fatalf("grant after a slot expired: %v", err)
	}
}

// T16: only a desktop device session may hold a lease.
func TestOfficeLeaseRefusesWebSession(t *testing.T) {
	w := newLeaseWorld(t, "lease-web")
	d := w.file(t, documentVisibilityWorkspace)
	m := w.tn.member.ID

	// A browser session's sid has no device_sessions row; no sid at all is
	// the same answer.
	for _, sid := range []string{util.NewID(), ""} {
		_, err := w.put(w.leases, m, sid, d.ID, "")
		requireLeaseCode(t, err, "offline_lease_device_required")
		requireLeaseCode(t, w.leases.Release(w.ctx, Human(m), d.ID, sid), "offline_lease_device_required")
	}
	for name, sid := range map[string]string{
		"other deployment": w.deviceWith(t, m, "staging", time.Now().Add(time.Hour)),
		"expired device":   w.deviceWith(t, m, "default", time.Now().Add(-time.Minute)),
	} {
		if _, err := w.put(w.leases, m, sid, d.ID, ""); !codedIs(err, "device_revoked") {
			t.Fatalf("%s: %v, want device_revoked", name, err)
		}
	}
	// Agents never hold a lease.
	if _, err := w.leases.Put(w.ctx, agentActor(w.tn.agent), OfficeLeasePutInput{DocumentID: d.ID, DeviceSessionID: w.device(t, m)}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("agent lease = %v, want not found", err)
	}
	var n int
	if err := w.f.pool.QueryRow(w.ctx, `SELECT count(*) FROM office_offline_leases`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("refused requests left %d lease rows", n)
	}
}

// T17: turning the flag off stops grants and renewals but takes nothing
// away: the existing row stays live to its expiry and can be released.
func TestOfficeLeaseFlagOffRefusesGrantKeepsExisting(t *testing.T) {
	w := newLeaseWorld(t, "lease-flag")
	d1, d2 := w.file(t, documentVisibilityWorkspace), w.file(t, documentVisibilityWorkspace)
	m := w.tn.member.ID
	dev := w.device(t, m)
	l := w.grant(t, m, dev, d1.ID)
	before := w.state(t, l.LeaseID)

	off := w.leaseService(t, officeLeaseTestSecret, false)
	for name, in := range map[string][2]string{"grant": {d2.ID, ""}, "renewal": {d1.ID, l.Token}} {
		_, err := w.put(off, m, dev, in[0], in[1])
		requireLeaseCode(t, err, "office_capability_off")
		var ce CodedError
		if errors.As(err, &ce); ce.Fields["capability"] != "offline_library" {
			t.Fatalf("%s: fields = %v, want capability offline_library", name, ce.Fields)
		}
	}
	after := w.state(t, l.LeaseID)
	if !after.exists || after.revoked || after.generation != before.generation || !after.expiresAt.Equal(before.expiresAt) {
		t.Fatalf("flag off changed the existing lease: %+v -> %+v", before, after)
	}
	if err := off.Release(w.ctx, Human(m), d1.ID, dev); err != nil {
		t.Fatalf("release with the flag off: %v", err)
	}
	if s := w.state(t, l.LeaseID); s.exists {
		t.Fatalf("released lease still stored: %+v", s)
	}
}

// PUT without a token while the device holds a live row renews it: the
// route is idempotent per device and never stacks rows.
func TestOfficeLeasePutIsIdempotentPerDevice(t *testing.T) {
	w := newLeaseWorld(t, "lease-idem")
	d := w.file(t, documentVisibilityWorkspace)
	m := w.tn.member.ID
	dev := w.device(t, m)
	l := w.grant(t, m, dev, d.ID)
	again := w.grant(t, m, dev, d.ID)
	if again.LeaseID != l.LeaseID || again.Generation != 2 || !again.Renewed || l.Renewed {
		t.Fatalf("second PUT = %+v, want a renewal of %s", again, l.LeaseID)
	}
	var grants, renewals int
	if err := w.f.pool.QueryRow(w.ctx, `SELECT count(*) FILTER (WHERE action = $1), count(*) FILTER (WHERE action = $2) FROM audit_events WHERE resource_id = $3`,
		audit.ActionOfficeOfflineLeaseGranted, audit.ActionOfficeOfflineLeaseRenewed, l.LeaseID).Scan(&grants, &renewals); err != nil {
		t.Fatal(err)
	}
	if grants != 1 || renewals != 1 {
		t.Fatalf("audit rows granted=%d renewed=%d, want 1 and 1", grants, renewals)
	}
}

// G5-D1 row 14: archiving is not a revoke. The holder's renewal answers
// document_archived, so the app keeps its copy to expiry; a fresh grant is
// refused, and only a manager, who sees the archived document anyway, hears
// why.
func TestOfficeLeaseArchivedDocumentKeepsLeaseRefusesRenewal(t *testing.T) {
	w := newLeaseWorld(t, "lease-archive")
	d := w.file(t, documentVisibilityWorkspace)
	m := w.tn.member.ID
	dev := w.device(t, m)
	l := w.grant(t, m, dev, d.ID)
	if _, err := w.f.pool.Exec(w.ctx, `UPDATE documents SET archived_at = now(), archived_by = $2 WHERE id = $1`, d.ID, w.tn.aclOwner.ID); err != nil {
		t.Fatal(err)
	}

	_, err := w.put(w.leases, m, dev, d.ID, l.Token)
	requireLeaseCode(t, err, "document_archived")
	w.requireLive(t, l.LeaseID)
	if _, err := w.put(w.leases, w.tn.creator.ID, w.device(t, w.tn.creator.ID), d.ID, ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("fresh grant on an archived document by a member = %v, want not found", err)
	}
	_, err = w.put(w.leases, w.tn.wsAdmin.ID, w.device(t, w.tn.wsAdmin.ID), d.ID, "")
	requireLeaseCode(t, err, "document_archived")
}

// G5-D1 row 12: release always works on the caller's own row and never
// confirms a document the caller cannot read.
func TestOfficeLeaseReleaseIsOwnAndIdempotent(t *testing.T) {
	w := newLeaseWorld(t, "lease-release")
	d := w.file(t, documentVisibilityRestricted)
	m := w.tn.member.ID
	sh := w.f.share(t, d, DocumentPrincipalUser, m, DocumentLevelView, w.tn.aclOwner.ID)
	dev := w.device(t, m)
	l := w.grant(t, m, dev, d.ID)

	// Access gone, the own row still releases.
	w.f.revoke(t, sh, w.tn.aclOwner.ID)
	if err := w.leases.Release(w.ctx, Human(m), d.ID, dev); err != nil {
		t.Fatalf("release after losing access: %v", err)
	}
	var released int
	if err := w.f.pool.QueryRow(w.ctx, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionOfficeOfflineLeaseReleased, l.LeaseID).Scan(&released); err != nil {
		t.Fatal(err)
	}
	if released != 1 {
		t.Fatalf("release audit rows = %d", released)
	}
	// No row and no access: not found, the same as a missing document.
	if err := w.leases.Release(w.ctx, Human(m), d.ID, dev); !errors.Is(err, ErrNotFound) {
		t.Fatalf("repeat release without access = %v, want not found", err)
	}
	if err := w.leases.Release(w.ctx, Human(m), util.NewID(), dev); !errors.Is(err, ErrNotFound) {
		t.Fatalf("release of a missing document = %v, want not found", err)
	}
	// No row on a readable document: success, nothing written.
	open := w.file(t, documentVisibilityWorkspace)
	if err := w.leases.Release(w.ctx, Human(m), open.ID, dev); err != nil {
		t.Fatalf("release with nothing held = %v", err)
	}
	// Another person's device is the session layer's refusal.
	requireLeaseCode(t, w.leases.Release(w.ctx, Human(w.tn.creator.ID), open.ID, dev), "device_revoked")
}
