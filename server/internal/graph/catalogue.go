// Package graph is the Work Graph vocabulary (C-11, ADR 0019): the closed set
// of node types, edge types and the (edge, from, to) triples allowed between
// them. It holds no state and touches no database. The projector and the read
// service import it; migration 9991791331200000 seeds graph_edge_types with
// the same triples (TestGraphCatalogueMatchesSeed holds the two together).
package graph

import "sort"

// NodeType is one kind of thing on the graph. Each node points at exactly one
// source row.
type NodeType string

const (
	NodeMeeting     NodeType = "MEETING"
	NodeDecision    NodeType = "DECISION"
	NodeTask        NodeType = "TASK"
	NodeCommitment  NodeType = "COMMITMENT"
	NodeExecution   NodeType = "EXECUTION"
	NodeWorkProduct NodeType = "WORK_PRODUCT"
	NodeKnowledge   NodeType = "KNOWLEDGE"
	NodeActor       NodeType = "ACTOR"
	NodeTeam        NodeType = "TEAM"
	NodeProject     NodeType = "PROJECT"
	NodeCustomer    NodeType = "CUSTOMER"
	NodeGoal        NodeType = "GOAL"
	NodeDocument    NodeType = "DOCUMENT"
	NodeThread      NodeType = "THREAD"
)

// NodeTypes is every node type in catalogue order (spec §4.1).
var NodeTypes = []NodeType{
	NodeMeeting, NodeDecision, NodeTask, NodeCommitment, NodeExecution, NodeWorkProduct, NodeKnowledge,
	NodeActor, NodeTeam, NodeProject, NodeCustomer, NodeGoal, NodeDocument, NodeThread,
}

// backbone is the work itself (spec §4.1); any of it may belong to a customer.
var backbone = []NodeType{NodeMeeting, NodeDecision, NodeTask, NodeCommitment, NodeExecution, NodeWorkProduct, NodeKnowledge}

// Projected is what slice 1 projects (spec §10). DOCUMENT and the email
// THREAD arrive with slice 2; the rest have no source table yet.
var Projected = map[NodeType]bool{
	NodeTask: true, NodeMeeting: true, NodeProject: true, NodeActor: true, NodeTeam: true, NodeThread: true,
}

// ParseNodeType accepts the catalogue spelling only (upper case).
func ParseNodeType(s string) (NodeType, bool) {
	for _, n := range NodeTypes {
		if string(n) == s {
			return n, true
		}
	}
	return "", false
}

// EdgeType is a directed relation that reads as a sentence. There is no
// RELATED_TO: a relation the vocabulary cannot name is not recorded.
type EdgeType string

const (
	EdgeDecidedIn      EdgeType = "DECIDED_IN"
	EdgeDrives         EdgeType = "DRIVES"
	EdgeSupersedes     EdgeType = "SUPERSEDES"
	EdgeOwnedBy        EdgeType = "OWNED_BY"
	EdgeExecutedBy     EdgeType = "EXECUTED_BY"
	EdgeExecutes       EdgeType = "EXECUTES"
	EdgeProduced       EdgeType = "PRODUCED"
	EdgeRealizedAs     EdgeType = "REALIZED_AS"
	EdgePromotedTo     EdgeType = "PROMOTED_TO"
	EdgeInforms        EdgeType = "INFORMS"
	EdgeBelongsTo      EdgeType = "BELONGS_TO"
	EdgeContributesTo  EdgeType = "CONTRIBUTES_TO"
	EdgeParticipatedIn EdgeType = "PARTICIPATED_IN"
	EdgeDiscussedIn    EdgeType = "DISCUSSED_IN"
	EdgeEvidencedBy    EdgeType = "EVIDENCED_BY"
	EdgeOriginatedFrom EdgeType = "ORIGINATED_FROM"
	EdgeDependsOn      EdgeType = "DEPENDS_ON"
)

// EdgeTypes lists every stored edge type. DUE (spec §4.1) is not here: a
// deadline is a node fact (FactDue in graph_node_facts), because a date is
// not a node.
var EdgeTypes = []EdgeType{
	EdgeDecidedIn, EdgeDrives, EdgeSupersedes, EdgeOwnedBy, EdgeExecutedBy, EdgeExecutes, EdgeProduced,
	EdgeRealizedAs, EdgePromotedTo, EdgeInforms, EdgeBelongsTo, EdgeContributesTo, EdgeParticipatedIn,
	EdgeDiscussedIn, EdgeEvidencedBy, EdgeOriginatedFrom, EdgeDependsOn,
}

// ParseEdgeType accepts the catalogue spelling only.
func ParseEdgeType(s string) (EdgeType, bool) {
	for _, e := range EdgeTypes {
		if string(e) == s {
			return e, true
		}
	}
	return "", false
}

// Origin says who asserted an edge. C-11 writes SYSTEM (projected from a
// source row) and, from slice 3, HUMAN (a work_links row).
const (
	OriginSystem      = "SYSTEM"
	OriginHuman       = "HUMAN"
	OriginAIConfirmed = "AI_CONFIRMED"
	OriginAISuggested = "AI_SUGGESTED"
)

// Fact types: a node's time-bound values that are not relations.
const (
	FactDue    = "due"
	FactStatus = "status"
)

// Visibility of a node, computed from its source (spec §4.4).
const (
	VisOrganization = "organization"
	VisWorkspace    = "workspace"
	VisMembers      = "members"
	VisPrivate      = "private"
)

// Subtypes tell apart two sources of one node type, for icons and links.
const (
	SubtypeMember      = "member"
	SubtypeAgent       = "agent"
	SubtypeChatRoom    = "chat_room"
	SubtypeEmailThread = "email_thread"
)

type edgeDef struct {
	edge           EdgeType
	from, to       []NodeType
	humanCreatable bool
	temporal       bool
}

func nodes(n ...NodeType) []NodeType { return n }

var edgeDefs = []edgeDef{
	{edge: EdgeDecidedIn, from: nodes(NodeDecision), to: nodes(NodeMeeting)},
	{edge: EdgeDrives, from: nodes(NodeDecision), to: nodes(NodeTask, NodeCommitment)},
	{edge: EdgeSupersedes, from: nodes(NodeDecision), to: nodes(NodeDecision)},
	{edge: EdgeOwnedBy, from: nodes(NodeTask, NodeProject, NodeGoal), to: nodes(NodeActor), temporal: true},
	{edge: EdgeExecutedBy, from: nodes(NodeExecution), to: nodes(NodeActor)},
	{edge: EdgeExecutes, from: nodes(NodeExecution), to: nodes(NodeTask)},
	{edge: EdgeProduced, from: nodes(NodeExecution), to: nodes(NodeWorkProduct)},
	{edge: EdgeRealizedAs, from: nodes(NodeWorkProduct), to: nodes(NodeDocument)},
	{edge: EdgePromotedTo, from: nodes(NodeWorkProduct), to: nodes(NodeKnowledge)},
	{edge: EdgeInforms, from: nodes(NodeKnowledge), to: nodes(NodeMeeting, NodeTask, NodeDecision), humanCreatable: true},
	{edge: EdgeBelongsTo, from: nodes(NodeTask), to: nodes(NodeProject, NodeTask), temporal: true},
	{edge: EdgeBelongsTo, from: nodes(NodeMeeting, NodeProject, NodeDocument, NodeThread), to: nodes(NodeProject), temporal: true},
	{edge: EdgeBelongsTo, from: nodes(NodeActor, NodeTeam), to: nodes(NodeTeam), temporal: true},
	{edge: EdgeBelongsTo, from: backbone, to: nodes(NodeCustomer), temporal: true},
	{edge: EdgeContributesTo, from: nodes(NodeProject, NodeTask, NodeDecision), to: nodes(NodeGoal), humanCreatable: true, temporal: true},
	{edge: EdgeParticipatedIn, from: nodes(NodeActor), to: nodes(NodeMeeting), temporal: true},
	{edge: EdgeDiscussedIn, from: nodes(NodeTask, NodeMeeting, NodeProject, NodeDecision), to: nodes(NodeThread), humanCreatable: true},
	{edge: EdgeEvidencedBy, from: nodes(NodeTask, NodeMeeting, NodeProject, NodeDecision), to: nodes(NodeDocument, NodeThread), humanCreatable: true},
	{edge: EdgeOriginatedFrom, from: nodes(NodeTask, NodeDecision, NodeProject), to: nodes(NodeThread, NodeMeeting, NodeDocument, NodeCustomer), humanCreatable: true},
	{edge: EdgeDependsOn, from: nodes(NodeTask, NodeCommitment), to: nodes(NodeTask, NodeCommitment, NodeDecision), temporal: true},
}

// Triple is one allowed (edge, from, to) with its flags; a row of
// graph_edge_types.
type Triple struct {
	Edge           EdgeType
	From, To       NodeType
	HumanCreatable bool
	Temporal       bool
}

func tripleLess(a, b Triple) bool {
	if a.Edge != b.Edge {
		return a.Edge < b.Edge
	}
	if a.From != b.From {
		return a.From < b.From
	}
	return a.To < b.To
}

func sortTriples(ts []Triple) {
	sort.Slice(ts, func(i, j int) bool { return tripleLess(ts[i], ts[j]) })
}

var triples, allowed = func() ([]Triple, map[[3]string]bool) {
	var out []Triple
	set := map[[3]string]bool{}
	for _, d := range edgeDefs {
		for _, f := range d.from {
			for _, to := range d.to {
				out = append(out, Triple{Edge: d.edge, From: f, To: to, HumanCreatable: d.humanCreatable, Temporal: d.temporal})
				set[[3]string{string(d.edge), string(f), string(to)}] = true
			}
		}
	}
	sortTriples(out)
	return out, set
}()

// Triples returns every allowed triple, sorted by edge, from, to.
func Triples() []Triple { return append([]Triple(nil), triples...) }

// Allowed reports whether an edge of type e may go from a node of type from
// to one of type to.
func Allowed(e EdgeType, from, to NodeType) bool {
	return allowed[[3]string{string(e), string(from), string(to)}]
}
