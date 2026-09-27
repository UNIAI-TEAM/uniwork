package backfill

import (
	"context"
	"strings"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// M12: audit_exports.object_key is the locator, minted as
// audit-exports/<org>/<export_id>.<format>; organization_id on the row is
// the verified tenant. The audit-export session scope is org-only
// (file_upload_sessions_scope_matches_purpose: audit_export needs the org
// and a NULL workspace).
func (e *Engine) scanAuditExports(ctx context.Context, after string, limit int32) ([]Item, string, error) {
	rows, err := e.q.FileBackfillScanAuditExports(ctx, db.FileBackfillScanAuditExportsParams{
		AfterID: after, LimitN: limit,
	})
	if err != nil {
		return nil, "", err
	}
	items := make([]Item, 0, len(rows))
	next := ""
	for _, r := range rows {
		items = append(items, classifyAuditExport(r))
		next = r.ID
	}
	if int32(len(rows)) < limit {
		next = ""
	}
	return items, next, nil
}

func classifyAuditExport(r db.FileBackfillScanAuditExportsRow) Item {
	it := Item{
		Cohort:         CohortAuditExports,
		SourceTable:    "audit_exports",
		SourceID:       r.ID,
		OrganizationID: r.OrganizationID,
		Purpose:        "audit_export",
		Claimed:        true,
		ActorID:        r.RequestedBy,
		ActorKind:      r.RequestedByKind,
	}
	key := strings.TrimSpace(r.ObjectKey.String)
	it.RawLocator = key
	if key == "" {
		it.Class = ClassUnresolved
		it.Reason = "no_locator"
		return finishItem(it, r.FileID)
	}
	it.ObjectKey = key

	segs := strings.Split(key, "/")
	if len(segs) < 3 || segs[0] != "audit-exports" {
		it.Class = ClassHeld
		it.Reason = "unrecognized_key_shape"
		return finishItem(it, r.FileID)
	}
	if segs[1] != r.OrganizationID {
		it.Class = ClassHeld
		it.Reason = "organization_mismatch"
		return finishItem(it, r.FileID)
	}
	if i := strings.LastIndex(key, "/"); i >= 0 {
		it.Filename = key[i+1:]
	}
	it.Class = ClassVerified
	return finishItem(it, r.FileID)
}
