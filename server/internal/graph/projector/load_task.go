package projector

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func loadTask(ctx context.Context, q *db.Queries, org, id string) (Desired, error) {
	t, err := q.GraphSourceTask(ctx, db.GraphSourceTaskParams{OrganizationID: org, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return Desired{}, nil
	}
	if err != nil {
		return Desired{}, err
	}
	d := Desired{Node: &NodeState{
		Ref: NodeRef{Type: graph.NodeTask, SourceID: t.ID}, WorkspaceID: t.WorkspaceID,
		Title: t.Title, Status: t.Status, Visibility: graph.VisWorkspace,
		OccurredAt: timeOf(t.CreatedAt), SourceUpdatedAt: timeOf(t.UpdatedAt),
	}}
	d.edge(graph.EdgeBelongsTo, true, graph.NodeProject, strings.TrimSpace(textOf(t.ProjectID)))
	d.edge(graph.EdgeBelongsTo, true, graph.NodeTask, strings.TrimSpace(textOf(t.ParentTaskID)))
	if ref, ok := assigneeRef(t); ok {
		d.edge(graph.EdgeOwnedBy, true, ref.Type, ref.SourceID)
	}
	deps, err := q.GraphSourceTaskDependencies(ctx, db.GraphSourceTaskDependenciesParams{OrganizationID: org, TaskID: t.ID})
	if err != nil {
		return Desired{}, err
	}
	for _, dep := range deps {
		// blocked_by(A,B): A depends on B → A→B. blocks(A,B): B depends on A → B→A.
		from, to := dep.TaskID, dep.DependsOnTaskID
		if dep.Type == "blocks" {
			from, to = dep.DependsOnTaskID, dep.TaskID
		}
		switch {
		case from == t.ID && to != t.ID:
			d.edge(graph.EdgeDependsOn, true, graph.NodeTask, to)
		case to == t.ID && from != t.ID:
			// from owns the edge from→t; reconcile marks it only if that edge
			// is not open yet.
			d.Peers = append(d.Peers, NodeRef{Type: graph.NodeTask, SourceID: from})
		}
	}
	origin := strings.TrimSpace(textOf(t.OriginID))
	switch textOf(t.OriginType) {
	case "meeting":
		d.edge(graph.EdgeOriginatedFrom, true, graph.NodeMeeting, origin)
	case "chat_message":
		if origin != "" {
			room, err := q.GraphSourceChatMessageRoom(ctx, db.GraphSourceChatMessageRoomParams{OrganizationID: org, ID: origin})
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return Desired{}, err
			}
			d.edge(graph.EdgeOriginatedFrom, true, graph.NodeThread, room)
		}
		// "email_thread": the email THREAD node arrives with slice 2.
	}
	rooms, err := q.GraphSourceTaskThreadRooms(ctx, db.GraphSourceTaskThreadRoomsParams{OrganizationID: org, TaskID: t.ID})
	if err != nil {
		return Desired{}, err
	}
	for _, r := range rooms {
		d.edge(graph.EdgeDiscussedIn, true, graph.NodeThread, r)
	}
	if f, ok := dueFact(t); ok {
		d.Facts = append(d.Facts, f)
	}
	d.Facts = append(d.Facts, FactWant{Type: graph.FactStatus, Value: t.Status})
	return d, nil
}

// assigneeRef is the ACTOR a task is owned by. Members and agents are
// actors; a squad is not in C-11. A legacy row with an id but no type is a
// member.
func assigneeRef(t db.Task) (NodeRef, bool) {
	id := strings.TrimSpace(textOf(t.AssigneeID))
	if id == "" {
		return NodeRef{}, false
	}
	switch textOf(t.AssigneeType) {
	case "member", "agent", "":
		return NodeRef{Type: graph.NodeActor, SourceID: id}, true
	}
	return NodeRef{}, false
}

// dueFact: due_at when set (an instant, stored in UTC), else due_date as a
// calendar date with precision "date" — never shifted through a time zone.
func dueFact(t db.Task) (FactWant, bool) {
	if t.DueAt.Valid {
		return FactWant{Type: graph.FactDue, Value: t.DueAt.Time.UTC().Format(time.RFC3339), Precision: "datetime"}, true
	}
	if t.DueDate.Valid {
		return FactWant{Type: graph.FactDue, Value: t.DueDate.Time.Format("2006-01-02"), Precision: "date"}, true
	}
	return FactWant{}, false
}
