package projector

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/graph"
	"github.com/unicomhub/uniwork/server/internal/outbox"
)

func TestRefs(t *testing.T) {
	if got := Refs("task.updated", map[string]string{"task_id": " t1 ", "workspace_id": "w"}); len(got) != 1 || got[0] != (NodeRef{graph.NodeTask, "t1"}) {
		t.Fatalf("task.updated → %+v", got)
	}
	if got := Refs("agent.archived", map[string]string{"organization_id": "o", "agent_id": "a1"}); len(got) != 1 || got[0].Type != graph.NodeActor {
		t.Fatalf("agent.archived → %+v", got)
	}
	if Refs("task.updated", map[string]string{}) != nil || Refs("notification.created", map[string]string{"task_id": "t"}) != nil {
		t.Fatal("no id or unknown topic → nothing")
	}
}

// Every topic the marker listens to exists in the outbox catalogue.
func TestTopicsAreCatalogued(t *testing.T) {
	for _, topic := range Topics() {
		if _, ok := outbox.Lookup(topic); !ok {
			t.Errorf("%s is not in the outbox catalogue", topic)
		}
	}
}
