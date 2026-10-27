package service

import (
	"context"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const billingInvoicesDefaultLimit = 50

// ListInvoices returns paid billing history for the organization (newest first).
func (s *BillingService) ListInvoices(ctx context.Context, userID, orgID string, limit, offset int32) ([]db.Invoice, error) {
	m, err := s.orgs.RequireMember(ctx, orgID, userID)
	if err != nil {
		return nil, err
	}
	if m.Role != "owner" && m.Role != "admin" {
		return nil, ErrForbidden
	}
	if limit <= 0 || limit > 100 {
		limit = billingInvoicesDefaultLimit
	}
	if offset < 0 {
		offset = 0
	}
	return s.q.ListInvoicesByOrganization(ctx, db.ListInvoicesByOrganizationParams{
		OrganizationID: orgID, Limit: limit, Offset: offset,
	})
}
