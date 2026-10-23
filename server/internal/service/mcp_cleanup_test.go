package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// attempt inserts an auth attempt that expires at the given time.
func (w *mcpWorld) attempt(t *testing.T, clientID string, expires time.Time) string {
	t.Helper()
	id := util.NewID()
	if _, err := w.q.CreateMcpAuthAttempt(w.ctx, db.CreateMcpAuthAttemptParams{
		ID: id, ClientID: clientID, RedirectUri: "https://x.test/cb", CodeChallenge: mcpTestChallenge(),
		Scope: "read", Resource: w.svc.ResourceURL(), ExpiresAt: mcpTime(expires),
	}); err != nil {
		t.Fatal(err)
	}
	return id
}

func (w *mcpWorld) exists(t *testing.T, table, id string) bool {
	t.Helper()
	var n int
	if err := w.pool.QueryRow(w.ctx, `SELECT count(*) FROM `+table+` WHERE id = $1`, id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n == 1
}

func TestMcpSweepDeletesAttemptsExpiredForADay(t *testing.T) {
	w := newMcpWorld(t)
	c := w.publicClient(t, "https://x.test/cb")
	old := w.attempt(t, c.ClientID, time.Now().Add(-48*time.Hour))
	recent := w.attempt(t, c.ClientID, time.Now().Add(-time.Hour))
	live := w.attempt(t, c.ClientID, time.Now().Add(10*time.Minute))

	r, err := w.svc.Sweep(w.ctx)
	if err != nil || r.Attempts != 1 {
		t.Fatalf("sweep = %+v, %v; want 1 attempt", r, err)
	}
	if w.exists(t, "mcp_auth_attempts", old) {
		t.Error("an attempt expired for two days was kept")
	}
	if !w.exists(t, "mcp_auth_attempts", recent) || !w.exists(t, "mcp_auth_attempts", live) {
		t.Error("an attempt expired for an hour, or a live one, was deleted")
	}
}

func TestMcpSweepDeletesTokensExpiredForAWeek(t *testing.T) {
	w := newMcpWorld(t)
	_, pair := w.issue(t)
	// The pair is two rows: its access token (1h) and its refresh token (30d).
	var access, refresh string
	rows, err := w.pool.Query(w.ctx, `SELECT id, kind FROM mcp_tokens WHERE organization_id = $1`, w.org.ID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id, kind string
		if err := rows.Scan(&id, &kind); err != nil {
			t.Fatal(err)
		}
		if kind == "access" {
			access = id
		} else {
			refresh = id
		}
	}
	rows.Close()
	if access == "" || refresh == "" {
		t.Fatalf("pair rows: access=%q refresh=%q (%s)", access, refresh, pair.AccessToken[:7])
	}

	if _, err := w.pool.Exec(w.ctx, `UPDATE mcp_tokens SET expires_at = now() - interval '8 days' WHERE id = $1`, access); err != nil {
		t.Fatal(err)
	}
	// Expired six days ago: unusable, but inside the week the sweep waits.
	if _, err := w.pool.Exec(w.ctx, `UPDATE mcp_tokens SET expires_at = now() - interval '6 days' WHERE id = $1`, refresh); err != nil {
		t.Fatal(err)
	}
	r, err := w.svc.Sweep(w.ctx)
	if err != nil || r.Tokens != 1 {
		t.Fatalf("sweep = %+v, %v; want 1 token", r, err)
	}
	if w.exists(t, "mcp_tokens", access) || !w.exists(t, "mcp_tokens", refresh) {
		t.Fatalf("access (8 days) exists=%v, refresh (6 days) exists=%v", w.exists(t, "mcp_tokens", access), w.exists(t, "mcp_tokens", refresh))
	}
}

// A grant has no expiry. Settings and audit read it long after its tokens are
// gone, so the sweep never touches one.
func TestMcpSweepKeepsGrants(t *testing.T) {
	w := newMcpWorld(t)
	w.issue(t)
	if _, err := w.pool.Exec(w.ctx, `UPDATE mcp_tokens SET expires_at = now() - interval '30 days' WHERE organization_id = $1`, w.org.ID); err != nil {
		t.Fatal(err)
	}
	r, err := w.svc.Sweep(w.ctx)
	if err != nil || r.Tokens != 2 {
		t.Fatalf("sweep = %+v, %v; want both tokens gone", r, err)
	}
	var n int
	if err := w.pool.QueryRow(w.ctx, `SELECT count(*) FROM mcp_grants WHERE organization_id = $1`, w.org.ID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("grants = %d, %v; want the one grant kept", n, err)
	}
}

func TestMcpSweepDeletesOnlyAbandonedClients(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	newClient := func() McpClient { return w.publicClient(t, "https://x.test/cb") }
	age := func(c McpClient, created, used string) {
		t.Helper()
		sql := `UPDATE mcp_clients SET created_at = now() - $2::interval, last_used_at = CASE WHEN $3 = '' THEN NULL ELSE now() - $3::interval END WHERE client_id = $1`
		if _, err := w.pool.Exec(w.ctx, sql, c.ClientID, created, used); err != nil {
			t.Fatal(err)
		}
	}

	abandoned := newClient()
	age(abandoned, "40 days", "")
	recentlyRegistered := newClient()
	age(recentlyRegistered, "29 days", "")
	usedRecently := newClient()
	age(usedRecently, "40 days", "5 days")
	liveGrant := newClient()
	w.approve(t, liveGrant, "https://x.test/cb")
	age(liveGrant, "90 days", "90 days")

	revokedGrant := newClient()
	w.approve(t, revokedGrant, "https://x.test/cb")
	grants, err := w.svc.ListMyGrants(w.ctx, w.owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range grants {
		if g.ClientID == revokedGrant.ClientID {
			if err := w.svc.RevokeMyGrant(w.ctx, w.owner.ID, g.ID); err != nil {
				t.Fatal(err)
			}
		}
	}
	age(revokedGrant, "90 days", "90 days")

	// A client that identifies itself by URL and was fetched today stays,
	// whatever its age (TestMcpSweepDeletesUnusedMetadataDocumentClients).
	cimd, err := w.q.UpsertMcpCIMDClient(w.ctx, db.UpsertMcpCIMDClientParams{ID: util.NewID(), ClientID: "https://c.example/meta.json", ClientName: "CIMD", LogoUri: "", RedirectUris: `["https://x.test/cb"]`})
	if err != nil {
		t.Fatal(err)
	}
	age(McpClient{ClientID: cimd.ClientID}, "90 days", "")

	r, err := w.svc.Sweep(w.ctx)
	if err != nil || r.Clients != 1 {
		t.Fatalf("sweep = %+v, %v; want exactly the abandoned client", r, err)
	}
	has := func(c McpClient) bool {
		t.Helper()
		var n int
		if err := w.pool.QueryRow(w.ctx, `SELECT count(*) FROM mcp_clients WHERE client_id = $1`, c.ClientID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n == 1
	}
	if has(abandoned) {
		t.Error("a client with no grant, unused for 40 days, was kept")
	}
	for name, c := range map[string]McpClient{
		"registered 29 days ago": recentlyRegistered, "used 5 days ago": usedRecently,
		"live grant": liveGrant, "revoked grant": revokedGrant, "CIMD": {ClientID: cimd.ClientID},
	} {
		if !has(c) {
			t.Errorf("client %s was deleted", name)
		}
	}
}

func TestMcpRunSweepsThenStopsWhenItsContextEnds(t *testing.T) {
	w := newMcpWorld(t)
	c := w.publicClient(t, "https://x.test/cb")
	old := w.attempt(t, c.ClientID, time.Now().Add(-48*time.Hour))

	ctx, cancel := context.WithCancel(w.ctx)
	done := make(chan struct{})
	go func() { w.svc.Run(ctx); close(done) }()
	deadline := time.Now().Add(10 * time.Second)
	for w.exists(t, "mcp_auth_attempts", old) {
		if time.Now().After(deadline) {
			t.Fatal("Run did not sweep on start")
		}
		time.Sleep(20 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after its context ended")
	}
}

// Ruling 27: the sweep deletes tokens expired for a week while a family
// revocation updates the family's rows; both touching the same long-dead rows
// in different orders is how the bulk revocations deadlocked (40P01). The
// family revocation leaves such rows alone, as they already are unusable.
func TestMcpRevokeFamilyLeavesLongExpiredTokensAlone(t *testing.T) {
	w := newMcpWorld(t)
	w.issue(t)
	var family string
	if err := w.pool.QueryRow(w.ctx, `SELECT family_id FROM mcp_tokens WHERE organization_id = $1 AND kind = 'access'`, w.org.ID).Scan(&family); err != nil {
		t.Fatal(err)
	}
	if _, err := w.pool.Exec(w.ctx, `UPDATE mcp_tokens SET expires_at = now() - interval '8 days' WHERE family_id = $1 AND kind = 'access'`, family); err != nil {
		t.Fatal(err)
	}
	n, err := w.q.RevokeMcpTokenFamily(w.ctx, family)
	if err != nil || n != 1 {
		t.Fatalf("revoked %d, %v; want only the live refresh token", n, err)
	}
	var revoked int
	if err := w.pool.QueryRow(w.ctx, `SELECT count(*) FROM mcp_tokens WHERE family_id = $1 AND revoked_at IS NOT NULL`, family).Scan(&revoked); err != nil || revoked != 1 {
		t.Fatalf("revoked rows = %d, %v", revoked, err)
	}
}

// Start does not touch last_used_at, so a client registered long ago and not
// yet granted anything looks abandoned while a person is on its consent page.
// Deleting it then would let Approve write a grant for a client that is gone.
func TestMcpSweepKeepsAClientWithALiveAuthorizationAttempt(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	old := func(c McpClient) {
		t.Helper()
		if _, err := w.pool.Exec(w.ctx, `UPDATE mcp_clients SET created_at = now() - interval '40 days', last_used_at = NULL WHERE client_id = $1`, c.ClientID); err != nil {
			t.Fatal(err)
		}
	}
	inFlight := w.publicClient(t, "https://x.test/cb")
	old(inFlight)
	liveAttempt := w.attempt(t, inFlight.ClientID, time.Now().Add(5*time.Minute))
	lapsed := w.publicClient(t, "https://x.test/cb")
	old(lapsed)
	// Expired an hour ago: the attempt sweep keeps it for a day, but nobody can
	// still approve it, so it does not hold its client.
	lapsedAttempt := w.attempt(t, lapsed.ClientID, time.Now().Add(-time.Hour))
	idle := w.publicClient(t, "https://x.test/cb")
	old(idle)

	r, err := w.svc.Sweep(w.ctx)
	if err != nil || r.Clients != 2 {
		t.Fatalf("sweep = %+v, %v; want the lapsed and the idle client gone", r, err)
	}
	has := func(c McpClient) bool {
		t.Helper()
		var n int
		if err := w.pool.QueryRow(w.ctx, `SELECT count(*) FROM mcp_clients WHERE client_id = $1`, c.ClientID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n == 1
	}
	if !has(inFlight) {
		t.Error("a client with a live authorization attempt was deleted")
	}
	if has(lapsed) || has(idle) {
		t.Errorf("an abandoned client was kept (lapsed attempt %v, idle %v)", has(lapsed), has(idle))
	}
	if !w.exists(t, "mcp_auth_attempts", liveAttempt) || !w.exists(t, "mcp_auth_attempts", lapsedAttempt) {
		t.Error("the sweep deleted an attempt that expired less than a day ago")
	}

	// The person finishing the flow still gets a code.
	consentURL, err := w.svc.Start(w.ctx, McpAuthorizeInput{ResponseType: "code", ClientID: inFlight.ClientID, RedirectURI: "https://x.test/cb", CodeChallenge: mcpTestChallenge(), CodeChallengeMethod: "S256"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.svc.Consent(w.ctx, w.owner.ID, attemptID(t, consentURL)); err != nil {
		t.Fatal(err)
	}
}

// I4: anyone can make the server store a metadata-document client by naming a
// URL at /oauth/authorize. Such a row is only a cache of a document the server
// can fetch again, so once nothing holds it (no grant: the grant lists JOIN
// mcp_clients; no live attempt: Approve needs the row) and it has been neither
// used nor fetched for a day, the sweep deletes it.
func TestMcpSweepDeletesUnusedMetadataDocumentClients(t *testing.T) {
	w := newMcpWorld(t)
	cimd := func(name string) string {
		t.Helper()
		id := "https://" + name + ".example/meta.json"
		if _, err := w.q.UpsertMcpCIMDClient(w.ctx, db.UpsertMcpCIMDClientParams{ID: util.NewID(), ClientID: id, ClientName: name, RedirectUris: `["https://x.test/cb"]`}); err != nil {
			t.Fatal(err)
		}
		return id
	}
	age := func(clientID, created, fetched, used string) {
		t.Helper()
		sql := `UPDATE mcp_clients SET created_at = now() - $2::interval, metadata_fetched_at = now() - $3::interval,
			last_used_at = CASE WHEN $4 = '' THEN NULL ELSE now() - $4::interval END WHERE client_id = $1`
		if _, err := w.pool.Exec(w.ctx, sql, clientID, created, fetched, used); err != nil {
			t.Fatal(err)
		}
	}

	unused := cimd("unused")
	age(unused, "3 days", "3 days", "")
	usedLongAgo := cimd("used-long-ago")
	age(usedLongAgo, "40 days", "2 days", "2 days")
	granted := cimd("granted")
	if _, err := w.q.CreateMcpGrant(w.ctx, db.CreateMcpGrantParams{ID: util.NewID(), OrganizationID: w.org.ID, UserID: w.owner.ID, ClientID: granted, Scope: "read", CreatedBy: w.owner.ID, CreatedByKind: "human"}); err != nil {
		t.Fatal(err)
	}
	age(granted, "90 days", "90 days", "")
	inFlight := cimd("in-flight")
	w.attempt(t, inFlight, time.Now().Add(5*time.Minute))
	age(inFlight, "3 days", "3 days", "")
	fetchedRecently := cimd("fetched-recently")
	age(fetchedRecently, "3 days", "1 hour", "")
	usedRecently := cimd("used-recently")
	age(usedRecently, "3 days", "3 days", "1 hour")
	registeredToday := cimd("registered-today")

	r, err := w.svc.Sweep(w.ctx)
	if err != nil || r.Clients != 2 {
		t.Fatalf("sweep = %+v, %v; want the two unused metadata-document clients", r, err)
	}
	has := func(clientID string) bool {
		t.Helper()
		return w.countRows(t, `SELECT count(*) FROM mcp_clients WHERE client_id = $1`, clientID) == 1
	}
	for name, id := range map[string]string{"unused for three days": unused, "used two days ago": usedLongAgo} {
		if has(id) {
			t.Errorf("client %s was kept", name)
		}
	}
	for name, id := range map[string]string{
		"with a grant": granted, "with a live attempt": inFlight, "fetched an hour ago": fetchedRecently,
		"used an hour ago": usedRecently, "registered today": registeredToday,
	} {
		if !has(id) {
			t.Errorf("client %s was deleted", name)
		}
	}
}
