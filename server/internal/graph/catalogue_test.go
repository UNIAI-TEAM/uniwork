package graph

import "testing"

func TestCatalogueShape(t *testing.T) {
	if len(NodeTypes) != 14 {
		t.Fatalf("node types = %d, want 14", len(NodeTypes))
	}
	if len(EdgeTypes) != 17 {
		t.Fatalf("edge types = %d, want 17 (DUE is a node fact)", len(EdgeTypes))
	}
	triples := Triples()
	if len(triples) != 64 {
		t.Fatalf("triples = %d, want 64", len(triples))
	}
	seen := map[Triple]bool{}
	for i, tr := range triples {
		if seen[tr] {
			t.Errorf("duplicate triple %+v", tr)
		}
		seen[tr] = true
		if i > 0 && !tripleLess(triples[i-1], tr) {
			t.Errorf("triples not sorted at %d", i)
		}
	}
	for _, e := range EdgeTypes {
		found := false
		for _, tr := range triples {
			found = found || tr.Edge == e
		}
		if !found {
			t.Errorf("edge %s has no triple", e)
		}
	}
}

func TestAllowed(t *testing.T) {
	cases := []struct {
		e        EdgeType
		from, to NodeType
		want     bool
	}{
		{EdgeOwnedBy, NodeTask, NodeActor, true},
		{EdgeOwnedBy, NodeActor, NodeTask, false},
		{EdgeOriginatedFrom, NodeTask, NodeMeeting, true},
		{EdgeDependsOn, NodeTask, NodeTask, true},
		{EdgeBelongsTo, NodeKnowledge, NodeCustomer, true},
		{EdgeBelongsTo, NodeActor, NodeProject, false},
		{"RELATED_TO", NodeTask, NodeTask, false},
	}
	for _, c := range cases {
		if got := Allowed(c.e, c.from, c.to); got != c.want {
			t.Errorf("Allowed(%s, %s, %s) = %v", c.e, c.from, c.to, got)
		}
	}
}

func TestParse(t *testing.T) {
	if n, ok := ParseNodeType("TASK"); !ok || n != NodeTask {
		t.Fatal("TASK")
	}
	if _, ok := ParseNodeType("task"); ok {
		t.Fatal("node types are upper case on the wire")
	}
	if _, ok := ParseEdgeType("DUE"); ok {
		t.Fatal("DUE is a fact, not an edge")
	}
	if !Projected[NodeThread] || Projected[NodeDocument] {
		t.Fatal("slice 1 projects THREAD, not DOCUMENT")
	}
}
