package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// createDefaultSubscription puts a new organization on the default plan in the
// caller's transaction (spec §2 #7). No default plan is a deployment error,
// not something to paper over: the gate is fail-closed and the organization
// would be unusable.
func createDefaultSubscription(ctx context.Context, q *db.Queries, orgID string, actor Actor) (db.Subscription, error) {
	plan, err := q.GetDefaultPlan(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Subscription{}, errors.New("billing: no default plan seeded")
	}
	if err != nil {
		return db.Subscription{}, err
	}
	return q.CreateSubscription(ctx, db.CreateSubscriptionParams{
		ID: util.NewID(), OrganizationID: orgID, PlanID: plan.ID, Status: "active", Provider: "manual",
		CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
	})
}
