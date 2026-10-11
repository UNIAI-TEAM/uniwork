package projector

import "github.com/unicomhub/uniwork/server/internal/graph"

type scope struct {
	edge graph.EdgeType
	out  bool
}

// edgeScopes says which SYSTEM edges each node type's projection owns. Every
// SYSTEM edge has exactly one owner end, so two projections never fight over
// it (spec §13 #11). The owner of DEPENDS_ON is the from end. A dependency
// change names both tasks (spec §13 #28), so the owner is marked by its own
// event; projecting the to end still marks the owner when its edge and the
// rows disagree, as a backstop.
var edgeScopes = map[graph.NodeType][]scope{
	graph.NodeTask: {
		{graph.EdgeBelongsTo, true}, {graph.EdgeOwnedBy, true}, {graph.EdgeDependsOn, true},
		{graph.EdgeOriginatedFrom, true}, {graph.EdgeDiscussedIn, true},
	},
	graph.NodeMeeting: {{graph.EdgeBelongsTo, true}, {graph.EdgeParticipatedIn, false}},
	graph.NodeProject: {{graph.EdgeOwnedBy, true}},
	graph.NodeActor:   {{graph.EdgeBelongsTo, true}},
	graph.NodeTeam:    {{graph.EdgeBelongsTo, true}},
	graph.NodeThread:  nil,
}

// factScopes says which facts each node type carries.
var factScopes = map[graph.NodeType][]string{
	graph.NodeTask:    {graph.FactDue, graph.FactStatus},
	graph.NodeMeeting: {graph.FactStatus},
	graph.NodeProject: {graph.FactStatus},
}

func inScope(t graph.NodeType, e graph.EdgeType, out bool) bool {
	for _, s := range edgeScopes[t] {
		if s.edge == e && s.out == out {
			return true
		}
	}
	return false
}
