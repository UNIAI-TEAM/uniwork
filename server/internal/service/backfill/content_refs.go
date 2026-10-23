package backfill

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// M11: /api/v1/attachments/<id>/{content,download} URLs embedded in task
// descriptions, comment bodies and source-context snapshots. These rows never
// create files — they are reference evidence: each item says whether the
// named attachment row still resolves, which verify and the GC-holding story
// depend on.
var attachmentRefPattern = regexp.MustCompile(`attachments/([A-Za-z0-9_-]+)`)

// contentRefTables is the M11 table set in scan order; the unit cursor is
// "<table>\x00<row-id>" so a resume names exactly where the walk stopped.
var contentRefTables = []string{"tasks", "task_comments", "task_source_contexts"}

// refRow is one content-bearing source row normalized to the fields
// classification needs.
type refRow struct {
	id      string
	table   string
	orgID   string
	wsID    string
	content string
}

// scanRefs pages one content table.
func (e *Engine) scanRefs(ctx context.Context, table, after string, limit int32) ([]refRow, error) {
	var rows []refRow
	switch table {
	case "tasks":
		rs, err := e.q.FileBackfillScanTaskDescriptionRefs(ctx, db.FileBackfillScanTaskDescriptionRefsParams{AfterID: after, LimitN: limit})
		if err != nil {
			return nil, err
		}
		for _, r := range rs {
			rows = append(rows, refRow{id: r.ID, table: table, orgID: r.OrganizationID, wsID: r.WorkspaceID, content: r.Content})
		}
	case "task_comments":
		rs, err := e.q.FileBackfillScanCommentRefs(ctx, db.FileBackfillScanCommentRefsParams{AfterID: after, LimitN: limit})
		if err != nil {
			return nil, err
		}
		for _, r := range rs {
			rows = append(rows, refRow{id: r.ID, table: table, orgID: r.OrganizationID, wsID: r.WorkspaceID, content: r.Content})
		}
	case "task_source_contexts":
		rs, err := e.q.FileBackfillScanSourceContextRefs(ctx, db.FileBackfillScanSourceContextRefsParams{AfterID: after, LimitN: limit})
		if err != nil {
			return nil, err
		}
		for _, r := range rs {
			rows = append(rows, refRow{id: r.ID, table: table, orgID: r.OrganizationID, wsID: r.WorkspaceID, content: r.Content})
		}
	default:
		return nil, errors.New("unknown ref table " + table)
	}
	return rows, nil
}

// scanContentRefs walks the three content tables as one unit. One page pulls
// up to limit content rows (not items — one row can name several
// attachments) so progress stays bounded per checkpoint.
func (e *Engine) scanContentRefs(ctx context.Context, cursor string, limit int32) ([]Item, string, error) {
	tableIdx, after := 0, ""
	if cursor != "" {
		parts := strings.SplitN(cursor, "\x00", 2)
		for i, name := range contentRefTables {
			if name == parts[0] {
				tableIdx = i
			}
		}
		if len(parts) == 2 {
			after = parts[1]
		}
	}
	var items []Item
	for ti := tableIdx; ti < len(contentRefTables); ti++ {
		table := contentRefTables[ti]
		for {
			rows, err := e.scanRefs(ctx, table, after, limit)
			if err != nil {
				return nil, "", err
			}
			if len(rows) == 0 {
				break
			}
			for _, r := range rows {
				items = append(items, e.classifyRef(ctx, r)...)
				after = r.id
			}
			if int32(len(rows)) < limit {
				break
			}
			return items, table + "\x00" + after, nil
		}
		after = ""
	}
	return items, "", nil
}

// classifyRef emits one item per (content row, attachment id) pair: verified
// when the attachment row it names exists, dangling when it does not.
func (e *Engine) classifyRef(ctx context.Context, r refRow) []Item {
	seen := map[string]bool{}
	var out []Item
	for _, m := range attachmentRefPattern.FindAllStringSubmatch(r.content, -1) {
		attID := m[1]
		if seen[attID] {
			continue
		}
		seen[attID] = true
		it := Item{
			Cohort:         CohortContentRefs,
			SourceTable:    r.table,
			SourceID:       r.id + "#" + attID,
			OrganizationID: r.orgID,
			WorkspaceID:    r.wsID,
			RawLocator:     "attachments/" + attID,
			Claimed:        true,
		}
		att, err := e.q.GetAttachmentByID(ctx, attID)
		switch {
		case err == nil:
			it.Class = ClassVerified
			it.Reason = "reference"
			if att.FileID.Valid {
				it.FileID = att.FileID.String
			}
			if att.ObjectKey.Valid {
				it.ObjectKey = att.ObjectKey.String
			}
		case errors.Is(err, pgx.ErrNoRows):
			it.Class = ClassUnresolved
			it.Reason = "dangling_attachment_ref"
		default:
			it.Class = ClassUnresolved
			it.Reason = "lookup_error"
		}
		out = append(out, it)
	}
	return out
}
