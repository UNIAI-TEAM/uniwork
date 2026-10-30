package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"path"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/attachtext"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
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
	// pdf reads the text layer of a PDF through the Office engine; nil (engine
	// off) leaves PDFs with empty text.
	pdf DriveOfficeExtractor
}

func NewDocumentTextIndexer(docs *DocumentService, ask *AskUNIService, pdf DriveOfficeExtractor) *DocumentTextIndexer {
	reads := make(chan struct{}, 1)
	if ask != nil {
		reads = ask.fileReads
	}
	return &DocumentTextIndexer{docs: docs, reads: reads, pdf: pdf}
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
// read as text (HTML, damaged, over the read ceiling, an extractor that
// panics, a PDF whose text the Office engine cannot give: it is off,
// unreachable or refuses the file) or a file that is gone or no longer serveable (not found, deleting,
// not ready) stores empty text, which is the answer, like CreateThumbnail
// drops a file it cannot serve; only the storage failing returns an error, so
// the outbox tries again.
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

// extractFileText is attachtext.Extract; a test swaps it to make it panic.
var extractFileText = attachtext.Extract

// unindexableMIMEPrefixes are types the extractor never reads, so a version of
// one needs neither the read slot nor an open.
var unindexableMIMEPrefixes = []string{"image/", "video/", "audio/", "text/html"}

// read returns the indexable text of the version; empty when it has none.
func (x *DocumentTextIndexer) read(ctx context.Context, doc db.Document, ver db.DocumentVersion) (text string, err error) {
	// The recorded size and type decide before the file is opened.
	if !mcpOfficeReadable(ver.SizeBytes) {
		return "", nil
	}
	mt := strings.ToLower(ver.MimeType.String)
	for _, p := range unindexableMIMEPrefixes {
		if strings.HasPrefix(mt, p) {
			return "", nil
		}
	}
	if err := takeSlot(ctx, x.reads); err != nil {
		return "", err
	}
	defer func() { <-x.reads }()

	// openVersionFile checks no permission and writes no access log: this is
	// the system reading a file, not a person.
	f, err := x.docs.openVersionFile(ctx, doc, ver, DocumentByteRange{})
	if err != nil {
		// A refusal about the file's state is final; only the store failing is retried.
		var ce CodedError
		if errors.Is(err, ErrNotFound) || (errors.As(err, &ce) && ce.Code != files.CodeStorageUnavailable) {
			return "", nil
		}
		return "", err
	}
	defer f.Reader.Close()
	kind, _ := fileKindOf(ver.MimeType.String, f.Reader.File.Filename)
	if kind == fileReadPDF && x.pdf == nil {
		return "", nil
	}
	mimeType, ok := fileTextIndexMIME(ver.MimeType.String, f.Reader.File.Filename)
	if !ok && kind != fileReadPDF {
		return "", nil
	}
	raw, err := io.ReadAll(io.LimitReader(f.Reader.Body, mcpOfficeReadBytes+1))
	if err != nil {
		return "", err
	}
	if len(raw) > mcpOfficeReadBytes {
		return "", nil
	}
	// A crafted file must not crash the pod (the consumer has no recover): log ids only, index nothing.
	defer func() {
		if r := recover(); r != nil {
			slog.Error("document text index: extractor panic", "document_id", doc.ID, "version_id", ver.ID)
			text, err = "", nil
		}
	}()
	if kind == fileReadPDF {
		return x.pdfText(ctx, doc, raw), nil
	}
	parsed, err := extractFileText(mimeType, bytes.NewReader(raw), int64(len(raw)))
	if errors.Is(err, attachtext.ErrUnreadable) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return fileIndexText(parsed), nil
}

// pdfText asks the Office engine for the text layer of a PDF. Any engine
// failure (off, unreachable, an unreadable file) is an empty answer, not an
// error: a retry would only repeat it, and a person can search by title.
func (x *DocumentTextIndexer) pdfText(ctx context.Context, doc db.Document, raw []byte) string {
	res, err := x.pdf.ExtractText(ctx, office.ExtractTextRequest{
		Format: office.ExtractFormatPDF, Content: raw,
		ActorKind: "system", ActorID: x.Name(),
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if err != nil {
		slog.Warn("document text index: pdf text unavailable", "document_id", doc.ID, "version_id", doc.FileVersionID.String)
		return ""
	}
	return pdfIndexText(pdfPageTexts(res.Text))
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
	if text == "" && doc.ContentText == "" { // search_text already is the title
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
// Office and CSV files, Markdown and plain text. HTML is not read; a PDF is
// read by the Office engine (pdfText), not by this extractor.
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
// its label when it has none (a heading), stopping at maxSearchContentRunes
// runes, the joining newlines included. An empty slide adds no "Slide N".
func fileIndexText(d attachtext.Doc) string {
	var b strings.Builder
	runes := 0
	for _, p := range d.Parts {
		piece := p.Text
		if piece == "" && d.Unit != "slide" {
			piece = p.Label
		}
		if piece == "" {
			continue
		}
		if runes > 0 {
			if runes >= maxSearchContentRunes {
				return b.String()
			}
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
