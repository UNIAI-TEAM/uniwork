package service

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// G508S-BE-5: the revoke counter follows the commit, not the statement. A
// revoking command's transaction can roll back after the lease rows were
// updated and their audit rows written; a counter moved inside that
// transaction would then count revokes nobody got. The only statements
// recordOfficeLeaseRevokes runs are the two batch inserts of
// audit.Recorder.RecordMany, both db.Exec, so a fake DBTX exercises it
// without a database - and a rollback is exactly "the caller never reaches
// the observe after its commit", which is what these tests pin.

// leaseCounterMetrics records what the lease counters were asked to count.
type leaseCounterMetrics struct {
	revoked map[string]int
	grants  []string
	blocked []string
}

func (m *leaseCounterMetrics) ObserveOfficeLease(op string) { m.grants = append(m.grants, op) }

func (m *leaseCounterMetrics) ObserveOfficeLeaseBlocked(reason string) {
	m.blocked = append(m.blocked, reason)
}

func (m *leaseCounterMetrics) ObserveOfficeLeasesRevoked(reason string, n int) {
	if m.revoked == nil {
		m.revoked = map[string]int{}
	}
	m.revoked[reason] += n
}

func (m *leaseCounterMetrics) ObserveOfficeLeaseSweep(int64) {}

// leaseBatchDBTX answers the audit and outbox batch inserts and refuses any
// other statement.
type leaseBatchDBTX struct{ fail error }

func (d leaseBatchDBTX) Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, d.fail
}

func (d leaseBatchDBTX) Query(context.Context, string, ...interface{}) (pgx.Rows, error) {
	return nil, errors.New("lease batch DBTX: unexpected query")
}

func (d leaseBatchDBTX) QueryRow(context.Context, string, ...interface{}) pgx.Row {
	return leaseErrorRow{}
}

type leaseErrorRow struct{}

func (leaseErrorRow) Scan(...interface{}) error {
	return errors.New("lease batch DBTX: unexpected query row")
}

func TestOfficeLeaseRevokeCounterMovesOnlyAfterCommit(t *testing.T) {
	fake := &leaseCounterMetrics{}
	SetOfficeLeaseMetrics(fake)
	defer SetOfficeLeaseMetrics(nil)

	refs := []officeLeaseRef{
		{ID: "lease-1", OrganizationID: "org-1", WorkspaceID: "ws-1", DocumentID: "doc-1", UserID: "user-1"},
		{ID: "lease-2", OrganizationID: "org-1", WorkspaceID: "ws-1", DocumentID: "doc-1", UserID: "user-1"},
	}
	written, err := recordOfficeLeaseRevokes(context.Background(), db.New(leaseBatchDBTX{}),
		officeLeaseRevokeActor, OfficeLeaseRevokeMemberRemoved, refs)
	if err != nil {
		t.Fatal(err)
	}
	if written != len(refs) {
		t.Fatalf("recorded %d revokes, want %d", written, len(refs))
	}
	// The revoking transaction can still roll back at this point; the counter
	// must not have moved.
	if got := fake.revoked[OfficeLeaseRevokeMemberRemoved]; got != 0 {
		t.Fatalf("counter moved inside the transaction: %d revokes already counted, a rollback would overcount", got)
	}
	// Only the commit path moves it.
	observeOfficeLeaseRevokes(OfficeLeaseRevokeMemberRemoved, written)
	if got := fake.revoked[OfficeLeaseRevokeMemberRemoved]; got != 2 {
		t.Fatalf("counter after the commit = %d, want 2", got)
	}

	// A failed audit batch is not a revoke: nothing recorded, nothing counted.
	failed := &leaseCounterMetrics{}
	SetOfficeLeaseMetrics(failed)
	if _, err := recordOfficeLeaseRevokes(context.Background(), db.New(leaseBatchDBTX{fail: errors.New("audit down")}),
		officeLeaseRevokeActor, OfficeLeaseRevokeMemberRemoved, refs); err == nil {
		t.Fatal("a failed audit batch was treated as a written revoke")
	}
	if got := failed.revoked[OfficeLeaseRevokeMemberRemoved]; got != 0 {
		t.Fatalf("a failed batch counted %d revokes", got)
	}
}
