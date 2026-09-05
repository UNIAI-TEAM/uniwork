package service

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Actor is who runs a command (ADR 0007). It is the audit package's type: one
// definition, so the value a service authorizes with is the value the audit
// row records. Handlers only ever hold a signed-in person and build it with
// Human; internal/arch_test.go fails any other package that constructs an
// agent or system actor by hand.
type Actor = audit.Actor

// Human is the actor for a signed-in user.
func Human(userID string) Actor { return audit.User(userID) }

// ActorRef names one actor without resolving it.
type ActorRef struct {
	Kind audit.Kind
	ID   string
}

// ActorInfo is the shape every API returns for an actor (ADR 0007 §4). The
// client renders the badge from Kind and never infers it from the name.
type ActorInfo struct {
	ID          string
	Kind        audit.Kind
	DisplayName string
	AvatarURL   string
}

// ActorService resolves ids to display data in one batch per kind.
type ActorService struct{ q *db.Queries }

func NewActorService(q *db.Queries) *ActorService { return &ActorService{q: q} }

// Resolve looks up every ref; unknown ids are simply absent from the result.
func (s *ActorService) Resolve(ctx context.Context, refs []ActorRef) (map[ActorRef]ActorInfo, error) {
	out := map[ActorRef]ActorInfo{}
	var userIDs, agentIDs []string
	for _, r := range refs {
		switch r.Kind {
		case audit.KindHuman:
			userIDs = append(userIDs, r.ID)
		case audit.KindAgent:
			agentIDs = append(agentIDs, r.ID)
		}
	}
	if len(userIDs) > 0 {
		rows, err := s.q.GetUsersByIDs(ctx, userIDs)
		if err != nil {
			return nil, err
		}
		for _, u := range rows {
			out[ActorRef{Kind: audit.KindHuman, ID: u.ID}] = ActorInfo{ID: u.ID, Kind: audit.KindHuman, DisplayName: u.DisplayName, AvatarURL: textOrEmpty(u.AvatarUrl)}
		}
	}
	if len(agentIDs) > 0 {
		rows, err := s.q.GetAgentsByIDs(ctx, agentIDs)
		if err != nil {
			return nil, err
		}
		for _, a := range rows {
			out[ActorRef{Kind: audit.KindAgent, ID: a.ID}] = ActorInfo{ID: a.ID, Kind: audit.KindAgent, DisplayName: a.Name, AvatarURL: textOrEmpty(a.AvatarUrl)}
		}
	}
	return out, nil
}

func textOrEmpty(t pgtype.Text) string {
	if t.Valid {
		return t.String
	}
	return ""
}
