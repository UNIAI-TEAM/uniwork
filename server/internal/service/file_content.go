package service

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"path"
	"strconv"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/attachtext"
	"github.com/unicomhub/uniwork/server/internal/office"
)

// fileReadKind says how the bytes of a file are turned into text a model reads.
type fileReadKind int

const (
	fileReadNone fileReadKind = iota
	fileReadText
	fileReadOffice
	fileReadPDF
)

const (
	mcpPDFNote            = "only the text layer of this PDF is shown, page by page; images, scans and layout are not"
	mcpPDFNoTextNote      = "this PDF has no text layer (a scan or pictures only) and text recognition is not supported, so only its name and type are shown"
	mcpPDFUnavailableNote = "PDF text cannot be read on this server, so only its name and type are shown"
)

// fileKindOf names how a file is read. mimeType is the recorded type;
// extractMIME is the Office extractor's type, set for fileReadOffice only.
func fileKindOf(mimeType, filename string) (kind fileReadKind, extractMIME string) {
	if mcpTextFile(mimeType, filename) {
		return fileReadText, ""
	}
	if m, ok := mcpOfficeMIME(mimeType, filename); ok {
		return fileReadOffice, m
	}
	base, _, _ := strings.Cut(strings.ToLower(mimeType), ";")
	if strings.ToLower(path.Ext(filename)) == ".pdf" || strings.TrimSpace(base) == "application/pdf" {
		return fileReadPDF, ""
	}
	return fileReadNone, ""
}

// fileReadLimit is how many bytes a read takes: one more than it shows, so
// that "more came" is known.
func fileReadLimit(kind fileReadKind) int64 {
	if kind == fileReadText {
		return mcpTextReadBytes + 1
	}
	return mcpOfficeReadBytes + 1
}

// fileContent is what a model is shown of a file.
type fileContent struct {
	Format, Content, Note string
	Truncated             bool
}

// fileSubject is who reads a file and what is read; the engine's grant names them.
type fileSubject struct {
	OrganizationID, WorkspaceID, ActorID, DocumentID string
}

// SetPDFText wires the engine that reads the text layer of a PDF. Without it
// (nil, or the engine switched off) a PDF reads as its name and type only.
func (s *McpToolService) SetPDFText(x DriveOfficeExtractor) { s.pdf = x }

// fileContentOf turns bytes already read (fileReadLimit(kind) of them, under
// the file-read slot for Office and PDF) into what a model is shown.
func (s *McpToolService) fileContentOf(ctx context.Context, kind fileReadKind, extractMIME string, raw []byte, sub fileSubject) fileContent {
	switch kind {
	case fileReadText:
		text, truncated, ok := mcpFileText(raw)
		if !ok {
			return fileContent{Note: "this file is not valid UTF-8 text, so its content is not shown"}
		}
		return fileContent{Format: "text", Content: text, Truncated: truncated}
	case fileReadOffice:
		return officeContent(ctx, extractMIME, raw, sub)
	case fileReadPDF:
		return s.pdfContent(ctx, raw, sub)
	}
	return fileContent{Note: mcpNotTextNote}
}

func officeContent(ctx context.Context, mimeType string, raw []byte, sub fileSubject) fileContent {
	if len(raw) > mcpOfficeReadBytes {
		slog.WarnContext(ctx, "mcp get_document: office text not read", "error", "file larger than the read ceiling", "document_id", sub.DocumentID)
		return fileContent{Note: mcpFileBusyNote}
	}
	doc, err := attachtext.Extract(mimeType, bytes.NewReader(raw), int64(len(raw)))
	if errors.Is(err, attachtext.ErrUnreadable) {
		return fileContent{Note: mcpOfficeUnreadableNote}
	}
	if err != nil {
		// The name and type were readable; the bytes not being so is no reason to fail the call.
		slog.WarnContext(ctx, "mcp get_document: office text not read", "error", err, "document_id", sub.DocumentID)
		return fileContent{Note: mcpFileBusyNote}
	}
	text, truncated := mcpOfficeText(doc)
	switch {
	case text == "" && truncated:
		// Text exists but none of it was kept (a first part over the retain cap).
		return fileContent{Format: "extracted", Note: mcpOfficeUnreadableNote}
	case text == "":
		return fileContent{Format: "extracted", Note: mcpOfficeEmptyNote}
	}
	return fileContent{Format: "extracted", Content: text, Truncated: truncated, Note: mcpOfficeNote}
}

func (s *McpToolService) pdfContent(ctx context.Context, raw []byte, sub fileSubject) fileContent {
	if s.pdf == nil {
		return fileContent{Note: mcpPDFUnavailableNote}
	}
	if len(raw) > mcpOfficeReadBytes {
		slog.WarnContext(ctx, "mcp get_document: pdf text not read", "error", "file larger than the read ceiling", "document_id", sub.DocumentID)
		return fileContent{Note: mcpFileBusyNote}
	}
	res, err := s.pdf.ExtractText(ctx, office.ExtractTextRequest{
		Format: office.ExtractFormatPDF, Content: raw,
		ActorID: sub.ActorID, OrganizationID: sub.OrganizationID, WorkspaceID: sub.WorkspaceID, DocumentID: sub.DocumentID,
	})
	var unreadable *office.ExtractUnreadableError
	if errors.As(err, &unreadable) {
		return fileContent{Note: mcpOfficeUnreadableNote}
	}
	if err != nil {
		slog.WarnContext(ctx, "mcp get_document: pdf text not read", "error", err, "document_id", sub.DocumentID)
		return fileContent{Note: mcpFileBusyNote}
	}
	text, truncated := pdfModelText(pdfPageTexts(res.Text), res.Truncated)
	if text == "" {
		return fileContent{Note: mcpPDFNoTextNote}
	}
	return fileContent{Format: "extracted", Content: text, Truncated: truncated, Note: mcpPDFNote}
}

// pdfPageTexts splits the engine's text into one entry per page (a form feed
// ends a page); a page without text is an empty entry.
func pdfPageTexts(text string) []string { return strings.Split(text, "\f") }

// pdfModelText labels each page that has text "[page N]" and joins them, cut
// at mcpMaxItemRunes; truncated is true when the engine or this cut left text out.
func pdfModelText(pages []string, truncated bool) (string, bool) {
	var parts []string
	for i, p := range pages {
		if strings.TrimSpace(p) != "" {
			parts = append(parts, "[page "+strconv.Itoa(i+1)+"]\n"+p)
		}
	}
	joined := strings.Join(parts, "\n\n")
	text := capRunes(joined, mcpMaxItemRunes, mcpItemCut)
	return text, truncated || text != joined
}

// pdfIndexText is the searchable text of a PDF: the pages that have text, one
// per line, up to maxSearchContentRunes runes.
func pdfIndexText(pages []string) string {
	var parts []string
	for _, p := range pages {
		if strings.TrimSpace(p) != "" {
			parts = append(parts, p)
		}
	}
	return capRunes(strings.Join(parts, "\n"), maxSearchContentRunes, "")
}
