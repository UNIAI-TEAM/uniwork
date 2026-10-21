package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/document"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Export of a UniNote page to DOCX or PDF (UNI-2004, spec
// 2026-10-20-meeting-follow-through §7.7). It is ExportFramePDF's path with a
// page as the source: an office job - operation export, format page - whose
// input is the page's sanitized content, title and image bytes as one JSON
// document; the engine writes the DOCX, and renders the PDF from that DOCX
// with the Docs renderer. Reading the page is enough; the job row and a
// document_access_logs "export" row are the record, and no event is emitted.

// pageExportMaxInput bounds one page export's JSON input. Images ride in it
// as base64, so it is mostly image bytes; past it the export is refused
// rather than letting one page hold an engine worker's memory.
const pageExportMaxInput = 64 << 20

// pageExportImageTypes are the image types a DOCX embeds (page-docx.ts).
var pageExportImageTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true}

// pageExportInput is the engine's input for a page (page-docx.ts).
type pageExportInput struct {
	Title   string                     `json:"title"`
	Content json.RawMessage            `json:"content"`
	Images  map[string]pageExportImage `json:"images,omitempty"`
}

type pageExportImage struct {
	Mime   string `json:"mime"`
	Data   []byte `json:"data"` // base64 on the wire
	Width  int32  `json:"width,omitempty"`
	Height int32  `json:"height,omitempty"`
}

// ExportPage renders a page to format ("docx" or "pdf") and waits for the
// result. Any kind but page is refused with page_export_not_page.
func (s *DocumentOfficeService) ExportPage(ctx context.Context, actor Actor, documentID, format string) (OfficeExportPDF, error) {
	if s.engine == nil || s.files == nil || s.documents == nil {
		return OfficeExportPDF{}, office.ErrNotConfigured
	}
	target := office.Format(format)
	if target != office.FormatDOCX && target != office.FormatPDF {
		return OfficeExportPDF{}, Invalid("format phải là docx hoặc pdf")
	}
	doc, access, err := s.documents.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return OfficeExportPDF{}, err
	}
	if doc.Kind != DocumentKindPage {
		return OfficeExportPDF{}, coded(http.StatusUnprocessableEntity, "page_export_not_page", "chỉ trang UniNote mới xuất được DOCX/PDF")
	}
	raw, err := s.pageExportBytes(ctx, doc)
	if err != nil {
		return OfficeExportPDF{}, err
	}
	sum := sha256.Sum256(raw)
	input := bytesInput(raw, hex.EncodeToString(sum[:]))
	out, err := s.runExport(ctx, actor, OfficeJobInput{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		// A page has no file version; the revision it was read at names the base.
		BaseVersionID: fmt.Sprintf("page:%d", doc.Revision), BaseRevision: doc.Revision,
		Operation: office.OperationExport, Format: office.FormatPage, TargetFormat: target,
		IdempotencyKey: "export:" + s.newID(), Deadline: officeExportWait,
		exportBound: true, input: &input,
	}, doc, access, nil)
	if err != nil {
		return OfficeExportPDF{}, err
	}
	name := strings.TrimSpace(doc.Title)
	if name == "" {
		name = "trang"
	}
	out.Filename = name + "." + format
	return out, nil
}

// pageExportBytes builds the engine input: the content passed through the
// closed-schema sanitizer again (the engine only ever sees that schema), and
// the bytes of the images it references among the page's own assets.
func (s *DocumentOfficeService) pageExportBytes(ctx context.Context, doc db.Document) ([]byte, error) {
	content := json.RawMessage(`{"type":"doc","content":[]}`)
	if len(doc.Content) > 0 {
		clean, _, err := document.Sanitize(doc.Content)
		if err != nil {
			return nil, err
		}
		content = clean
	}
	in := pageExportInput{Title: doc.Title, Content: content, Images: map[string]pageExportImage{}}
	refs := documentAssetRefs(content)
	if len(refs) > 0 {
		assets, err := s.q.ListDocumentAssetsByDocument(ctx, db.ListDocumentAssetsByDocumentParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		})
		if err != nil {
			return nil, err
		}
		// Images ride as base64 (4 bytes per 3), so the raw budget is 3/4 of
		// the input cap: an image set that cannot fit is refused unread.
		budget := int64(pageExportMaxInput / 4 * 3)
		for _, a := range assets {
			// The writer embeds png/jpeg/gif only and prints any other image
			// as its alt text, so its bytes would only spend the budget.
			if !refs[a.ID] || !pageExportImageTypes[a.MimeType] {
				continue
			}
			if budget -= a.SizeBytes; budget < 0 {
				return nil, officeErr("upload_bounds", "input_too_large")
			}
			body, err := s.readAsset(ctx, doc, a)
			if err != nil {
				return nil, err
			}
			in.Images[a.ID] = pageExportImage{Mime: a.MimeType, Data: body, Width: a.Width.Int32, Height: a.Height.Int32}
		}
	}
	raw, err := json.Marshal(in)
	if err != nil {
		return nil, err
	}
	if len(raw) > pageExportMaxInput {
		return nil, officeErr("upload_bounds", "input_too_large")
	}
	return raw, nil
}

func (s *DocumentOfficeService) readAsset(ctx context.Context, doc db.Document, a db.DocumentAsset) ([]byte, error) {
	r, err := s.files.Open(ctx, files.OpenInput{
		Scope:  files.Scope{OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID},
		FileID: files.FileID(a.FileID),
	})
	if err != nil {
		return nil, documentFileError(err)
	}
	defer r.Close()
	return io.ReadAll(io.LimitReader(r.Body, a.SizeBytes+1))
}
