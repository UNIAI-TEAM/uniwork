package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// FIX-7 (advisor bridge-91): the post-commit membership re-check
// (recheckMembershipAfterPut, FIX-1) must fail closed. When the re-check
// itself errors - a lookup or gate error, not a refusal - the request fails
// with that error, and without this fix the lease Put had just committed
// stayed live to the next renewal (up to the 24 h TTL). Put now revokes that
// row best-effort first: audit + office_lease.revoked in their own
// transaction, reason member_removed from the signed closed set, audit
// metadata note check_failed (no new reason value), and the request still
// answers the re-check's own error with no lease. Only when that revoke
// fails too does the failure counter move; the outbox consumer of the
// removal event is what closes the row then.
//
// The re-check error and that revoke's failure are injected through the
// unexported seams below a test in this package sets (the officeLeasePutHold
// pattern); production never sets them.

// (a) the re-check errors -> the lease the grant committed is revoked, with
// the check_failed note in its audit row, and the request returns the
// injected error with no lease. DB test: skips locally without
// TEST_DATABASE_URL.
func TestOfficeLeaseRecheckErrorRevokesTheCommittedLease(t *testing.T) {
	w := newLeaseWorld(t, "lease-failclosed")
	d := w.file(t, documentVisibilityWorkspace)
	m, dev := w.tn.member.ID, w.device(t, w.tn.member.ID)

	fake := &leaseCounterMetrics{}
	SetOfficeLeaseMetrics(fake)
	t.Cleanup(func() { SetOfficeLeaseMetrics(nil) })
	injected := errors.New("membership re-check: lookup down")
	officeLeaseRecheckErr = injected
	t.Cleanup(func() { officeLeaseRecheckErr = nil })

	got, err := w.put(w.leases, m, dev, d.ID, "")
	if !errors.Is(err, injected) {
		t.Fatalf("put = %v, want the re-check's own error", err)
	}
	if got.LeaseID != "" {
		t.Fatalf("a refused put returned a lease: %+v", got)
	}
	leaseID := w.leaseIDFor(t, m, d.ID)
	w.requireNoLiveLease(t, m, d.ID)
	w.requireRevoked(t, leaseID, OfficeLeaseRevokeMemberRemoved)
	var note string
	if err := w.f.pool.QueryRow(w.ctx,
		`SELECT metadata::jsonb->>'check_failed' FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionOfficeOfflineLeaseRevoked, leaseID).Scan(&note); err != nil {
		t.Fatal(err)
	}
	if note != "true" {
		t.Fatalf("revoke audit note check_failed = %q, want true", note)
	}
	// The request handed out no lease: the grant counter stayed put, only
	// the revoke was counted.
	if len(fake.grants) != 0 {
		t.Fatalf("a lease was counted as handed out: %v", fake.grants)
	}
	if fake.revoked[OfficeLeaseRevokeMemberRemoved] != 1 {
		t.Fatalf("revoke counter = %v, want one member_removed", fake.revoked)
	}
}

// (b) the re-check errors AND the fail-closed revoke fails -> the failure
// counter moves once and the request still answers the re-check's own error,
// never the revoke's. Pure test: both seams stand in for the gate and the
// revoke, so it runs without a database.
func TestOfficeLeaseRecheckErrorAndRevokeFailureCountsTheFailure(t *testing.T) {
	fake := &leaseCounterMetrics{}
	SetOfficeLeaseMetrics(fake)
	t.Cleanup(func() { SetOfficeLeaseMetrics(nil) })
	checkErr := errors.New("membership re-check: lookup down")
	officeLeaseRecheckErr = checkErr
	t.Cleanup(func() { officeLeaseRecheckErr = nil })
	revokeErr := errors.New("revoke down")
	officeLeaseRecheckRevoke = func(_ context.Context, orgID, leaseID, reason string, note map[string]any) error {
		if orgID != "org-1" || leaseID != "lease-1" || reason != OfficeLeaseRevokeMemberRemoved || note["check_failed"] != true {
			t.Errorf("fail-closed revoke = org %q lease %q reason %q note %v, want org-1, lease-1, %s and check_failed",
				orgID, leaseID, reason, note, OfficeLeaseRevokeMemberRemoved)
		}
		return revokeErr
	}
	t.Cleanup(func() { officeLeaseRecheckRevoke = nil })

	svc := &OfficeLeaseService{}
	got := svc.recheckMembershipAfterPut(context.Background(), Human("user-1"), "org-1", "doc-1", "lease-1")
	if !errors.Is(got, checkErr) {
		t.Fatalf("re-check = %v, want the original error", got)
	}
	if errors.Is(got, revokeErr) {
		t.Fatalf("re-check = %v, want the original error, not the revoke's", got)
	}
	if fake.revokeFailed != 1 {
		t.Fatalf("fail-closed revoke failure counter = %d, want 1", fake.revokeFailed)
	}
}

// (c) the re-check REFUSES (the gate no longer admits the caller) and the
// revoke of the just-committed lease fails -> the failure counter moves once,
// exactly as on the fail-closed branch, and the request answers as it did
// before the change: the revoke's own error (G508S-BE-10, FIX-8). Pure test:
// the seams below stand in for the gate's reads and for the revoke, so it
// runs without a database.
func TestOfficeLeaseRefusalAndRevokeFailureCountsTheFailure(t *testing.T) {
	fake := &leaseCounterMetrics{}
	SetOfficeLeaseMetrics(fake)
	t.Cleanup(func() { SetOfficeLeaseMetrics(nil) })
	revokeErr := errors.New("revoke down")
	officeLeaseRecheckRevoke = func(_ context.Context, orgID, leaseID, reason string, note map[string]any) error {
		if orgID != "org-1" || leaseID != "lease-1" || reason != OfficeLeaseRevokeMemberDeactivated || note != nil {
			t.Errorf("refusal revoke = org %q lease %q reason %q note %v, want org-1, lease-1, %s and no note",
				orgID, leaseID, reason, note, OfficeLeaseRevokeMemberDeactivated)
		}
		return revokeErr
	}
	t.Cleanup(func() { officeLeaseRecheckRevoke = nil })

	svc := &OfficeLeaseService{docs: &DocumentService{
		q:    db.New(leaseRefusalDBTX{}),
		orgs: &OrganizationService{},
		ws:   &WorkspaceService{},
	}}
	got := svc.recheckMembershipAfterPut(context.Background(), Human("user-1"), "org-1", "doc-1", "lease-1")
	if !errors.Is(got, revokeErr) {
		t.Fatalf("re-check = %v, want the revoke's own error as before the change", got)
	}
	if fake.revokeFailed != 1 {
		t.Fatalf("refusal revoke failure counter = %d, want 1", fake.revokeFailed)
	}
}

// leaseRefusalDBTX answers the re-check's two reads without a database: the
// document row reads back, and its organization member is deactivated, so the
// gate refuses. Every other statement is a test bug.
type leaseRefusalDBTX struct{}

func (leaseRefusalDBTX) Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("lease refusal DBTX: unexpected exec")
}

func (leaseRefusalDBTX) Query(context.Context, string, ...interface{}) (pgx.Rows, error) {
	return nil, errors.New("lease refusal DBTX: unexpected query")
}

func (leaseRefusalDBTX) QueryRow(_ context.Context, sql string, _ ...interface{}) pgx.Row {
	switch {
	case strings.Contains(sql, "GetDocumentByID"):
		return leaseDocumentRow{}
	case strings.Contains(sql, "GetOrganizationMember"):
		return leaseDeactivatedMemberRow{}
	default:
		return leaseErrorRow{}
	}
}

// leaseDocumentRow fills the document fields the re-check reads; the rest
// stay zero, as they are never consulted on this path.
type leaseDocumentRow struct{}

func (leaseDocumentRow) Scan(dest ...any) error {
	*dest[0].(*string) = "doc-1"
	*dest[1].(*string) = "org-1"
	*dest[2].(*string) = "ws-1"
	return nil
}

// leaseDeactivatedMemberRow is an active-organization member whose
// deactivated_at is set: RequireMemberQ's own refusal, no further reads.
type leaseDeactivatedMemberRow struct{}

func (leaseDeactivatedMemberRow) Scan(dest ...any) error {
	*dest[2].(*string) = "member"
	*dest[4].(*pgtype.Timestamptz) = pgtype.Timestamptz{Time: time.Now(), Valid: true}
	*dest[8].(*string) = "active"
	return nil
}
