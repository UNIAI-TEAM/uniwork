package audit

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func entry() Entry {
	return Entry{
		OrganizationID: "org1",
		WorkspaceID:    "ws1",
		Actor:          User("u1"),
		Action:         ActionTaskUpdated,
		ResourceType:   "task",
		ResourceID:     "t1",
		Changes:        map[string]Change{"status": {From: "todo", To: "done"}},
	}
}

// The whole point of Record is that the audit row shares the fate of the
// change it describes. A rollback that leaves an audit row behind is worse
// than no audit at all: it says something happened that did not.
func TestRecordRollsBackWithItsTransaction(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := NewRecorder().Record(ctx, q.WithTx(tx), entry(),
		Event{Topic: "task.updated", Payload: map[string]string{"task_id": "t1"}}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}

	var audits, events int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events`).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events`).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if audits != 0 || events != 0 {
		t.Fatalf("rollback left %d audit rows and %d outbox rows", audits, events)
	}
}

func TestRecordCommitsAuditAndEventsTogether(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := WithRequest(context.Background(), RequestInfo{
		CorrelationID: "corr-12345678", RequestID: "req1", IP: "10.0.0.9", UserAgent: "ua",
	})

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := NewRecorder().Record(ctx, q.WithTx(tx), entry(),
		Event{Topic: "task.updated", Payload: map[string]string{"task_id": "t1"}},
		Event{Topic: "webhook.deliver", Payload: map[string]string{"event_id": "e1"}}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	var action, correlation, changes, ip, actorKind string
	err = pool.QueryRow(ctx,
		`SELECT action, correlation_id, changes, ip_address, actor_kind FROM audit_events`,
	).Scan(&action, &correlation, &changes, &ip, &actorKind)
	if err != nil {
		t.Fatal(err)
	}
	if action != ActionTaskUpdated || correlation != "corr-12345678" || ip != "10.0.0.9" {
		t.Fatalf("audit row = %s %s %s", action, correlation, ip)
	}
	if actorKind != string(KindHuman) {
		t.Fatalf("actor_kind = %q, want human (ADR 0007)", actorKind)
	}
	if changes != `{"status":{"from":"todo","to":"done"}}` {
		t.Fatalf("changes = %s", changes)
	}

	rows, err := pool.Query(ctx, `SELECT topic, correlation_id, event_version FROM outbox_events ORDER BY topic`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var topics []string
	for rows.Next() {
		var topic, corr string
		var version int32
		if err := rows.Scan(&topic, &corr, &version); err != nil {
			t.Fatal(err)
		}
		if corr != "corr-12345678" {
			t.Fatalf("%s carries correlation %q", topic, corr)
		}
		if version != 1 {
			t.Fatalf("%s version = %d", topic, version)
		}
		topics = append(topics, topic)
	}
	if len(topics) != 2 || topics[0] != "task.updated" || topics[1] != "webhook.deliver" {
		t.Fatalf("topics = %v", topics)
	}
}

// Without a request on the context — a worker, a scheduled job — the chain
// still has to be traceable, so Record generates a correlation id rather than
// writing an empty one.
func TestRecordGeneratesCorrelationWhenAbsent(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()
	if err := NewRecorder().Record(ctx, db.New(pool), entry()); err != nil {
		t.Fatal(err)
	}
	var correlation string
	if err := pool.QueryRow(ctx, `SELECT correlation_id FROM audit_events`).Scan(&correlation); err != nil {
		t.Fatal(err)
	}
	if len(correlation) < 8 {
		t.Fatalf("correlation_id = %q", correlation)
	}
}

// The tamper test the spec makes a merge condition. The test database user
// owns the schema, so REVOKE grants it nothing — which is exactly the case the
// trigger exists for.
func TestAuditEventsAreAppendOnly(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()
	if err := NewRecorder().Record(ctx, db.New(pool), entry()); err != nil {
		t.Fatal(err)
	}

	if _, err := pool.Exec(ctx, `UPDATE audit_events SET action = 'tampered'`); err == nil {
		t.Fatal("UPDATE on audit_events succeeded; the table must be append-only")
	}
	if _, err := pool.Exec(ctx, `DELETE FROM audit_events`); err == nil {
		t.Fatal("DELETE on audit_events succeeded; the table must be append-only")
	}

	var action string
	if err := pool.QueryRow(ctx, `SELECT action FROM audit_events`).Scan(&action); err != nil {
		t.Fatal(err)
	}
	if action != ActionTaskUpdated {
		t.Fatalf("row changed despite the trigger: %q", action)
	}
}

func TestRecordRejectsIncompleteEntry(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()
	e := entry()
	e.Action = ""
	if err := NewRecorder().Record(ctx, q, e); err == nil {
		t.Fatal("an entry without an action must be rejected")
	}
	e = entry()
	e.Actor.Kind = ""
	if err := NewRecorder().Record(ctx, q, e); err == nil {
		t.Fatal("an entry without an actor kind must be rejected")
	}
}
