package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// DocumentShareScope summarizes who reaches a document on a library list row
// (SH-S3, UNI-1782; addendum §6.4, §7). It carries counts and booleans only -
// never principal names or ids - and is nil for agent actors (C-01 §4).
type DocumentShareScope struct {
	HomeWorkspace bool
	Users         int
	Workspaces    int
	Organization  bool
	PublicLink    bool
}

// listShareScopes resolves the share scope summary for a page of documents in
// one organization with a single aggregate query. Agent actors receive nothing
// (nil map) without touching the database.
func (s *DocumentService) listShareScopes(ctx context.Context, actor Actor, organizationID string, ids []string) (map[string]DocumentShareScope, error) {
	if actor.Kind == audit.KindAgent || len(ids) == 0 || organizationID == "" {
		return nil, nil
	}
	rows, err := s.q.ListDocumentShareScopes(ctx, db.ListDocumentShareScopesParams{
		OrganizationID: organizationID,
		DocumentIds:    ids,
	})
	if err != nil {
		return nil, err
	}
	out := make(map[string]DocumentShareScope, len(rows))
	for _, r := range rows {
		out[r.DocumentID] = DocumentShareScope{
			HomeWorkspace: r.HomeWorkspace,
			Users:         int(r.Users),
			Workspaces:    int(r.Workspaces),
			Organization:  r.Organization,
			PublicLink:    r.PublicLink,
		}
	}
	return out, nil
}

// attachListShareScopes populates ShareScope on a page of DocumentListItem in
// one query; agent actors keep nil on every row.
func (s *DocumentService) attachListShareScopes(ctx context.Context, actor Actor, items []DocumentListItem) error {
	if actor.Kind == audit.KindAgent || len(items) == 0 {
		return nil
	}
	ids := make([]string, len(items))
	for i := range items {
		ids[i] = items[i].Document.ID
	}
	scopes, err := s.listShareScopes(ctx, actor, items[0].Document.OrganizationID, ids)
	if err != nil {
		return err
	}
	for i := range items {
		if items[i].Document.Kind == DocumentKindFolder {
			// A folder is never shared (UNI-1974): no scope to summarize.
			continue
		}
		scope := scopes[items[i].Document.ID]
		items[i].ShareScope = &scope
	}
	return nil
}

// attachSharedShareScopes populates ShareScope on a page of SharedDocument in
// one query.
func (s *DocumentService) attachSharedShareScopes(ctx context.Context, actor Actor, organizationID string, items []SharedDocument) error {
	if actor.Kind == audit.KindAgent || len(items) == 0 {
		return nil
	}
	ids := make([]string, len(items))
	for i := range items {
		ids[i] = items[i].Document.ID
	}
	scopes, err := s.listShareScopes(ctx, actor, organizationID, ids)
	if err != nil {
		return err
	}
	for i := range items {
		scope := scopes[items[i].Document.ID]
		items[i].ShareScope = &scope
	}
	return nil
}
