package projector

import (
	"context"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ForgetOrganization clears titles and fact values the Work Graph copied out
// of a tenant that is being erased, and marks every node deleted. The source
// rows are already gone; a later reconcile finds nothing to put back.
func ForgetOrganization(ctx context.Context, q *db.Queries, organizationID string) error {
	if err := q.GraphForgetOrganizationFacts(ctx, organizationID); err != nil {
		return err
	}
	if err := q.GraphForgetOrganizationEdges(ctx, organizationID); err != nil {
		return err
	}
	if err := q.GraphForgetOrganizationNodes(ctx, organizationID); err != nil {
		return err
	}
	return q.GraphForgetOrganizationDirty(ctx, organizationID)
}
