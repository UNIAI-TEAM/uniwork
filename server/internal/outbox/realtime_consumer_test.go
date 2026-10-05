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

// In-room events go to the sockets holding that meeting open, not to the
// whole workspace (G8); a row without the meeting id has nowhere to go.
func TestRealtimeConsumerRoutesMeetingTopicsToTheMeetingScope(t *testing.T) {
	pub := &spyPublisher{}
	c := NewRealtimeConsumer(pub)
	ctx := context.Background()

	if err := c.Handle(ctx, row("motion.ballot_cast", `{"meeting_id":"m1","version":"3","motion_id":"mo1"}`, "ws1")); err != nil {
		t.Fatal(err)
	}
	if err := c.Handle(ctx, row("participant.updated", `{"version":"3"}`, "ws1")); err != nil {
		t.Fatalf("unroutable row must not fail the batch: %v", err)
	}

	if len(pub.workspace) != 0 {
		t.Fatalf("meeting topic reached the workspace: %v", pub.workspace)
	}
	if len(pub.scope) != 1 || pub.scope[0] != "meeting:m1/motion.ballot_cast" {
		t.Fatalf("scope publishes = %v", pub.scope)
	}
}

// The meeting list, the calendar and the home summary listen outside any
// meeting, so the lifecycle and roster rows they follow stay on the workspace.
func TestMeetingLifecycleTopicsStayOnTheWorkspace(t *testing.T) {
	for _, topic := range []string{
		"meeting.created", "meeting.updated", "meeting.deleted", "meeting.started",
		"meeting.ended", "meeting.canceled", "host.transferred",
		"participant.invited", "participant.removed", "invitation.responded",
	} {
		def, ok := Lookup(topic)
		if !ok {
			t.Fatalf("%s is not in the catalogue", topic)
		}
		if def.Scope != ScopeWorkspace {
			t.Errorf("%s scope = %q, want workspace", topic, def.Scope)
		}
	}
}
