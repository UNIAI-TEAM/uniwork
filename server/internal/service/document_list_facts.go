package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document origins a list row reports: uploaded bytes, or something UniWork
// made (a page, a folder, a blank Office file, a converted copy).
const (
	DocumentOriginUpload  = "upload"
	DocumentOriginCreated = "created"
)

// DocumentListFacts is what a list row shows beside the document metadata.
// SizeBytes is the size of the file version the document points at (0 for
// pages and folders). Format is the library file format of that version - the
// MIME it was verified as, else the title's extension (internal/files); empty
// for a page, a folder and a file neither names.
type DocumentListFacts struct {
	SizeBytes int64
	Origin    string
	Format    string
}

// attachListFacts fills Facts on one page of list items. Every item of a
// page belongs to the one organization the list was scoped to.
func (s *DocumentService) attachListFacts(ctx context.Context, items []DocumentListItem) error {
	if len(items) == 0 {
		return nil
	}
	docs := make([]db.Document, len(items))
	for i, item := range items {
		docs[i] = item.Document
	}
	facts, err := s.listFacts(ctx, items[0].Document.OrganizationID, docs)
	if err != nil {
		return err
	}
	for i := range items {
		items[i].Facts = facts[i]
	}
	return nil
}

func sharedDocuments(items []SharedDocument) []db.Document {
	docs := make([]db.Document, len(items))
	for i, item := range items {
		docs[i] = item.Document
	}
	return docs
}

// listFacts answers one fact per document, in order, with a single query for
// the file documents among them. A file's origin is "created" when its first
// version carries Office engine provenance, "upload" otherwise.
func (s *DocumentService) listFacts(ctx context.Context, organizationID string, docs []db.Document) ([]DocumentListFacts, error) {
	out := make([]DocumentListFacts, len(docs))
	fileIDs := make([]string, 0, len(docs))
	for i, d := range docs {
		out[i].Origin = DocumentOriginCreated
		if d.Kind == DocumentKindFile {
			out[i].Origin = DocumentOriginUpload
			fileIDs = append(fileIDs, d.ID)
		}
	}
	if len(fileIDs) == 0 {
		return out, nil
	}
	rows, err := s.q.ListDocumentFileListFacts(ctx, db.ListDocumentFileListFactsParams{
		OrganizationID: organizationID, DocumentIds: fileIDs,
	})
	if err != nil {
		return nil, err
	}
	byID := make(map[string]db.ListDocumentFileListFactsRow, len(rows))
	for _, r := range rows {
		byID[r.ID] = r
	}
	for i, d := range docs {
		r, ok := byID[d.ID]
		if !ok {
			continue
		}
		out[i].SizeBytes = r.SizeBytes
		// The library format the row is filtered by and reported with: the
		// MIME the current version was verified as, else the title's
		// extension (UNI-1868, internal/files).
		out[i].Format = files.DocumentFormat(r.MimeType.String, d.Title)
		if r.EngineMade {
			out[i].Origin = DocumentOriginCreated
		}
	}
	return out, nil
}
