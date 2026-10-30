package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/attachtext"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// DocumentTextIndexer fills documents.content_text and search_text for file
// documents, so that a content search finds an Office or text file by what is
// inside it. It is a derived index: it never touches revision,
// content_revision or updated_at, writes no audit row and no access log, and a
// result for a version that is no longer current is dropped.
type DocumentTextIndexer struct {
	docs *DocumentService
	// reads is the process's one file-read slot (the pod is one 512 MiB
	// process and a read holds up to 20 MiB plus its extraction). It is Ask
	// UNI's own slot when that service is wired.
	reads chan struct{}
}

func NewDocumentTextIndexer(docs *DocumentService, ask *AskUNIService) *DocumentTextIndexer {
	reads := make(chan struct{}, 1)
	if ask != nil {
		reads = ask.fileReads
	}
	return &DocumentTextIndexer{docs: docs, reads: reads}
}

func (*DocumentTextIndexer) Name() string { return "document_text_index" }
func (*DocumentTextIndexer) Topics() []string {
	return []string{topicDocumentTextIndexRequested}
}

// DeliveryTimeout leaves room to wait for the read slot, read 20 MiB and extract it.
func (*DocumentTextIndexer) DeliveryTimeout() time.Duration { return 60 * time.Second }

func (x *DocumentTextIndexer) Handle(ctx context.Context, ev outbox.Row) error {
	payload := map[string]string{}
	if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
		return fmt.Errorf("document_text_index: payload of %s: %w", ev.ID, err)
	}
	org := strings.TrimSpace(payload["organization_id"])
	if org == "" && ev.OrganizationID.Valid {
		org = ev.OrganizationID.String
	}
	return x.Index(ctx, org, strings.TrimSpace(payload["document_id"]), strings.TrimSpace(payload["version_id"]))
}

// Index extracts the text of one file version and stores it on its document.
// A request that no longer matches (another organization, not a file, another
// current version, purged) is dropped without a word. A file that cannot be
// read as text (PDF, HTML, damaged, over the read ceiling) stores empty text,
// which is the answer; only the storage failing returns an error, so the
// outbox tries again.
func (x *DocumentTextIndexer) Index(ctx context.Context, organizationID, documentID, versionID string) error {
	doc, err := x.docs.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if !x.current(doc, organizationID, versionID) {
		return nil
	}
	ver, err := x.docs.q.GetDocumentVersionByID(ctx, db.GetDocumentVersionByIDParams{
		ID: versionID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	text, err := x.read(ctx, doc, ver)
	if err != nil {
		return err
	}
	return x.store(ctx, doc.ID, organizationID, versionID, text)
}

func (*DocumentTextIndexer) current(doc db.Document, organizationID, versionID string) bool {
	return doc.OrganizationID == organizationID && doc.Kind == DocumentKindFile &&
		doc.FileVersionID.Valid && doc.FileVersionID.String == versionID
}

// read returns the indexable text of the version; empty when it has none.
func (x *DocumentTextIndexer) read(ctx context.Context, doc db.Document, ver db.DocumentVersion) (string, error) {
	// The recorded size decides before the file is opened.
	if !mcpOfficeReadable(ver.SizeBytes) {
		return "", nil
	}
	if err := takeSlot(ctx, x.reads); err != nil {
		return "", err
	}
	defer func() { <-x.reads }()

	// openVersionFile checks no permission and writes no access log: this is
	// the system reading a file, not a person.
	f, err := x.docs.openVersionFile(ctx, doc, ver, DocumentByteRange{})
	if err != nil {
		return "", err
	}
	defer f.Reader.Close()
	mimeType, ok := fileTextIndexMIME(ver.MimeType.String, f.Reader.File.Filename)
	if !ok {
		return "", nil
	}
	raw, err := io.ReadAll(io.LimitReader(f.Reader.Body, mcpOfficeReadBytes+1))
	if err != nil {
		return "", err
	}
	if len(raw) > mcpOfficeReadBytes {
		return "", nil
	}
	parsed, err := attachtext.Extract(mimeType, bytes.NewReader(raw), int64(len(raw)))
	if errors.Is(err, attachtext.ErrUnreadable) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return fileIndexText(parsed), nil
}

// store writes the text under the document's row lock, the lock every document
// command takes, and re-checks that the version is still the current one.
func (x *DocumentTextIndexer) store(ctx context.Context, documentID, organizationID, versionID, text string) error {
	tx, err := x.docs.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := x.docs.q.WithTx(tx)
	doc, err := q.LockDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if !x.current(doc, organizationID, versionID) {
		return nil
	}
	if _, err := q.SetDocumentFileText(ctx, db.SetDocumentFileTextParams{
		ContentText: text, SearchText: documentSearchText(doc.Title, text),
		ID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, FileVersionID: doc.FileVersionID,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// fileTextIndexMIME names the extractor for a file whose text is indexed:
// Office and CSV files, Markdown and plain text. HTML and PDF are not read.
func fileTextIndexMIME(mimeType, filename string) (string, bool) {
	if m, ok := mcpOfficeMIME(mimeType, filename); ok {
		return m, true
	}
	switch strings.ToLower(path.Ext(filename)) {
	case ".md", ".markdown":
		return "text/markdown", true
	case ".txt":
		return "text/plain", true
	}
	return "", false
}

// fileIndexText joins the parts of a file with newlines: a part's own text, or
// its label when it has none (a heading), stopping at maxSearchContentRunes.
func fileIndexText(d attachtext.Doc) string {
	var b strings.Builder
	runes := 0
	for _, p := range d.Parts {
		piece := p.Text
		if piece == "" {
			piece = p.Label
		}
		if piece == "" {
			continue
		}
		if runes > 0 {
			b.WriteByte('\n')
			runes++
		}
		for _, r := range piece {
			if runes >= maxSearchContentRunes {
				return b.String()
			}
			b.WriteRune(r)
			runes++
		}
	}
	return b.String()
}
