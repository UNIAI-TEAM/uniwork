package outbox

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type spyPublisher struct {
	workspace []string
	user      []string
	scope     []string
}

func (p *spyPublisher) PublishWorkspace(_ context.Context, wsID, topic string, _ map[string]string) {
	p.workspace = append(p.workspace, wsID+"/"+topic)
}

func (p *spyPublisher) PublishUser(_ context.Context, userID, topic string, _ map[string]string) {
	p.user = append(p.user, userID+"/"+topic)
}

func (p *spyPublisher) PublishScope(_ context.Context, scopeType, scopeID, topic string, _ map[string]string) {
	p.scope = append(p.scope, scopeType+":"+scopeID+"/"+topic)
}

func row(topic, payload, wsID string) Row {
	return db.OutboxEvent{
		ID: "ev1", Topic: topic, Payload: payload,
		WorkspaceID: pgtype.Text{String: wsID, Valid: wsID != ""},
	}
}

func TestRealtimeConsumerRoutesByCatalogueScope(t *testing.T) {
	pub := &spyPublisher{}
	c := NewRealtimeConsumer(pub)
	ctx := context.Background()

	if err := c.Handle(ctx, row("task.updated", `{"task_id":"t1","workspace_id":"ws1"}`, "ws1")); err != nil {
		t.Fatal(err)
	}
	if err := c.Handle(ctx, row("member.role_changed", `{"user_id":"u1","organization_id":"o1"}`, "")); err != nil {
		t.Fatal(err)
	}

	if len(pub.workspace) != 1 || pub.workspace[0] != "ws1/task.updated" {
		t.Fatalf("workspace publishes = %v", pub.workspace)
	}
	if len(pub.user) != 1 || pub.user[0] != "u1/member.role_changed" {
		t.Fatalf("user publishes = %v", pub.user)
	}
}

// A row missing the id its scope needs can never be delivered, and retrying it
// ten times only delays every other event on the topic. Drop it.
func TestRealtimeConsumerDropsUnroutableRows(t *testing.T) {
	pub := &spyPublisher{}
	c := NewRealtimeConsumer(pub)
	if err := c.Handle(context.Background(), row("member.removed", `{"organization_id":"o1"}`, "")); err != nil {
		t.Fatalf("unroutable row must not fail the batch: %v", err)
	}
	if len(pub.user) != 0 {
		t.Fatalf("published anyway: %v", pub.user)
	}
}

func TestRealtimeConsumerIgnoresTopicsOutsideTheCatalogue(t *testing.T) {
	pub := &spyPublisher{}
	if err := NewRealtimeConsumer(pub).Handle(context.Background(), row("made.up", `{}`, "ws1")); err != nil {
		t.Fatal(err)
	}
	if len(pub.workspace)+len(pub.user)+len(pub.scope) != 0 {
		t.Fatal("an unknown topic must not be published")
	}
}

func TestRealtimeTopicsAreOutboxDeliveredOnly(t *testing.T) {
	for _, topic := range RealtimeTopics() {
		def, ok := Lookup(topic)
		if !ok {
			t.Fatalf("%s is not in the catalogue", topic)
		}
		if def.Delivery != DeliveryOutbox || def.Scope == ScopeNone {
			t.Fatalf("%s should not be a realtime topic: delivery=%s scope=%s", topic, def.Delivery, def.Scope)
		}
	}
}
