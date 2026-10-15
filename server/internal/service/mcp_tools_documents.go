package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"path"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/document"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The document tools of the MCP connector (spec 2026-10-14 §5.4). Documents
// live on DocumentService, which keeps its own permission ladder (restricted
// pages, shares, work products): every read here goes through it as the
// person, never around it. Pages are shown as Markdown
// (document.PageToMarkdown); files are read when they are text and never
// written.

// mcpTextReadBytes is how much of a text file one read takes: four bytes is
// the most a character holds, so it always covers mcpMaxItemRunes characters.
const mcpTextReadBytes = 4 * mcpMaxItemRunes

// McpDocument is a document as a tool shows it; Kind is always "document" and
// DocKind says which (page, file or folder). Only get_document sets the rest:
// the page as Markdown (Lossy when it cannot come back exactly), the text of a
// text file, or the name and type of any other file with a Note saying why it
// is not shown. Content is cut at mcpMaxItemRunes, with Truncated.
type McpDocument struct {
	McpItem
	DocKind   string `json:"doc_kind"`
	Revision  int64  `json:"revision"`
	ParentID  string `json:"parent_id,omitempty"`
	Content   string `json:"content,omitempty"`
	Format    string `json:"format,omitempty"`
	Lossy     bool   `json:"lossy,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
	Filename  string `json:"filename,omitempty"`
	MimeType  string `json:"mime_type,omitempty"`
	Note      string `json:"note,omitempty"`
}

// McpDocumentList is what list_documents returns: one page of rows, and the
// cursor of the next when there is one.
type McpDocumentList struct {
	Documents  []McpDocument `json:"documents"`
	NextCursor string        `json:"next_cursor,omitempty"`
}

var errMcpDocumentsUnavailable = McpToolError{Code: "documents_unavailable", Msg: "documents are not available on this server"}

// SetDocuments wires documents into the connector's tools (Phase 4 of the
// write spec); without it the document tools answer documents_unavailable.
func (s *McpToolService) SetDocuments(d *DocumentService) { s.docs = d }

func (s *McpToolService) docOf(base string, d db.Document) McpDocument {
	url := s.frontend + base + "/documents/" + d.ID
	if d.Kind == DocumentKindFolder {
		// A folder is a query on the documents page, not a page of its own.
		url = s.frontend + base + "/documents?folder=" + d.ID
	}
	return McpDocument{
		McpItem: McpItem{Kind: "document", ID: d.ID, WorkspaceID: d.WorkspaceID, Title: d.Title, URL: url},
		DocKind: d.Kind, Revision: d.Revision, ParentID: d.ParentID.String,
	}
}

// document reads one live document of the workspace as the person. It first
// checks that the workspace belongs to the grant's organization, so no tool
// that reaches a document can forget to; a document of another workspace, or
// one in the trash, reads as absent, as does one the person may not read.
func (s *McpToolService) document(ctx context.Context, p McpPrincipal, workspaceID, documentID string) (DocumentView, error) {
	if s.docs == nil {
		return DocumentView{}, errMcpDocumentsUnavailable
	}
	if err := s.inGrant(ctx, p, workspaceID); err != nil {
		return DocumentView{}, err
	}
	if strings.TrimSpace(documentID) == "" {
		return DocumentView{}, McpInvalidArgs{Msg: "document_id is required"}
	}
	// The row is looked at before the service reads it as the person: a read
	// is logged in the document's own access log, and a call that answers "not
	// there" for a document of another workspace, or one in the trash, must not
	// leave a view of it behind.
	row, err := s.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (row.WorkspaceID != workspaceID || row.ArchivedAt.Valid)) {
		return DocumentView{}, ErrNotFound
	}
	if err != nil {
		return DocumentView{}, err
	}
	v, err := s.docs.GetDocument(ctx, Human(p.UserID), documentID)
	return v, hidden(err)
}

// mcpTextFile is a file whose bytes a model can read as text.
func mcpTextFile(mime, filename string) bool {
	switch strings.ToLower(path.Ext(filename)) {
	case ".md", ".markdown", ".html", ".htm", ".txt":
		return true
	}
	// A sniffed type may carry a charset: "text/plain; charset=utf-8".
	mime, _, _ = strings.Cut(strings.ToLower(mime), ";")
	switch strings.TrimSpace(mime) {
	case "text/markdown", "text/html", "text/plain":
		return true
	}
	return false
}

// mcpFileText is the text a model is shown of the bytes of a file read with
// room for mcpTextReadBytes+1: whole characters, cut at mcpMaxItemRunes.
// truncated says there was more. ok is false for bytes that are not UTF-8
// text, which are never shown: a cut that fell inside a character is not that.
func mcpFileText(raw []byte) (text string, truncated, ok bool) {
	if len(raw) > mcpTextReadBytes {
		raw, truncated = raw[:mcpTextReadBytes], true
		// The cut may fall inside a character: drop the half, at most UTFMax-1 bytes.
		for i := 1; i < utf8.UTFMax && !utf8.Valid(raw); i++ {
			raw = raw[:len(raw)-1]
		}
	}
	if !utf8.Valid(raw) || bytes.IndexByte(raw, 0) >= 0 {
		return "", false, false
	}
	text = capRunes(string(raw), mcpMaxItemRunes, mcpItemCut)
	return text, truncated || text != string(raw), true
}

type mcpDocumentRef struct {
	WorkspaceID string `json:"workspace_id"`
	DocumentID  string `json:"document_id"`
}

func (s *McpToolService) GetDocument(ctx context.Context, p McpPrincipal, in mcpDocumentRef) (McpDocument, error) {
	v, err := s.document(ctx, p, in.WorkspaceID, in.DocumentID)
	if err != nil {
		return McpDocument{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpDocument{}, err
	}
	out := s.docOf(base, v.Document)
	switch {
	case v.Document.Kind == DocumentKindPage:
		md, lossy, err := document.PageToMarkdown(v.Document.Content)
		if err != nil {
			out.Note = "the content of this page could not be read as Markdown; open it in UniWork"
			break
		}
		out.Format, out.Lossy = "markdown", lossy
		out.Content = capRunes(md, mcpMaxItemRunes, mcpItemCut)
		out.Truncated = out.Content != md
	case v.File != nil:
		out.Filename, out.MimeType = v.File.Filename, v.File.MimeType
		if !mcpTextFile(v.File.MimeType, v.File.Filename) {
			out.Note = "this is not a text file (md, html, txt), so only its name and type are shown"
			break
		}
		raw, err := s.fileHead(ctx, p, v.Document.ID)
		if err != nil {
			return McpDocument{}, err
		}
		text, truncated, ok := mcpFileText(raw)
		if !ok {
			out.Note = "this file is not valid UTF-8 text, so its content is not shown"
			break
		}
		out.Format, out.Content, out.Truncated = "text", text, truncated
	}
	return out, nil
}

// fileHead reads the start of a file document's current version, as the
// person: at most mcpTextReadBytes+1 bytes, one more than shown so that "more
// came" is known.
func (s *McpToolService) fileHead(ctx context.Context, p McpPrincipal, documentID string) ([]byte, error) {
	f, err := s.docs.OpenDocumentFile(ctx, Human(p.UserID), documentID, 0, DocumentByteRange{Length: mcpTextReadBytes + 1})
	if err != nil {
		return nil, hidden(err)
	}
	defer f.Reader.Close()
	return io.ReadAll(io.LimitReader(f.Reader.Body, mcpTextReadBytes+1))
}

type mcpListDocumentsIn struct {
	WorkspaceID string `json:"workspace_id"`
	ParentID    string `json:"parent_id"`
	Cursor      string `json:"cursor"`
}

func (s *McpToolService) ListDocuments(ctx context.Context, p McpPrincipal, in mcpListDocumentsIn) (McpDocumentList, error) {
	if s.docs == nil {
		return McpDocumentList{}, errMcpDocumentsUnavailable
	}
	if _, err := mcpID("parent_id", in.ParentID); err != nil {
		return McpDocumentList{}, err
	}
	if _, err := decodeDocumentCursor(in.Cursor); err != nil {
		return McpDocumentList{}, McpInvalidArgs{Msg: "cursor must be a next_cursor that list_documents returned"}
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpDocumentList{}, err
	}
	// The parent is looked for inside the workspace only: one of another
	// workspace, or nobody's, lists nothing.
	page, err := s.docs.ListDocuments(ctx, Human(p.UserID), in.WorkspaceID, ListDocumentsInput{ParentID: &in.ParentID, Cursor: in.Cursor, Limit: mcpMaxList})
	if err != nil {
		return McpDocumentList{}, hidden(err)
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpDocumentList{}, err
	}
	out := McpDocumentList{Documents: make([]McpDocument, 0, len(page.Items)), NextCursor: page.NextCursor}
	for _, it := range page.Items {
		out.Documents = append(out.Documents, s.docOf(base, it.Document))
	}
	return out, nil
}

// mcpSearchDocuments is how many documents a search adds after its tasks and
// meetings.
const mcpSearchDocuments = 10

// searchDocuments is the document half of search: the documents the person may
// read whose title or text holds the query, newest first, each with the start
// of its text. Without DocumentService there are none.
func (s *McpToolService) searchDocuments(ctx context.Context, p McpPrincipal, workspaceID, query string) ([]McpItem, error) {
	if s.docs == nil {
		return nil, nil
	}
	page, err := s.docs.ListDocuments(ctx, Human(p.UserID), workspaceID, ListDocumentsInput{Query: query, Limit: mcpSearchDocuments})
	if err != nil {
		return nil, hidden(err)
	}
	base, err := s.ask.base(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	out := make([]McpItem, 0, len(page.Items))
	for _, it := range page.Items {
		item := s.docOf(base, it.Document).McpItem
		item.Excerpt = capRunes(it.Snippet, mcpMaxHitRunes, mcpHitCut)
		out = append(out, item)
	}
	return out, nil
}

var (
	mcpSchemaListDocuments = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"parent_id":{"type":"string","description":"A folder or page id; omit for the top level of the workspace."},"cursor":{"type":"string","description":"next_cursor of the previous page."}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaDocument      = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"document_id":{"type":"string"}},"required":["workspace_id","document_id"],"additionalProperties":false}`)
)

func mcpDocumentTools(s *McpToolService) []ai.Tool {
	return []ai.Tool{
		mcpReadTool("list_documents", "List documents", "Pages, files and folders under one folder or page of the workspace (the top level when parent_id is omitted) that the user may read, in the order of the document tree, "+strconv.Itoa(mcpMaxList)+" at a time; a next_cursor in the answer is the cursor to pass for the next page. Each row has its doc_kind and revision, no content: call get_document for that. Documents in the trash are not listed.", mcpSchemaListDocuments,
			func(ctx context.Context, p McpPrincipal, in mcpListDocumentsIn) (any, error) {
				return s.ListDocuments(ctx, p, in)
			}),
		mcpReadTool("get_document", "Get document", "One document the user may read. A page comes as Markdown in content, with its revision. lossy true means the page holds something Markdown cannot carry back exactly (a blank paragraph, a merged table cell, formatting Markdown cannot express, or more than 50000 characters), so it can only be appended to, never replaced. content is cut at "+strconv.Itoa(mcpMaxItemRunes)+" characters and truncated says so; a cut page cannot be replaced either. A text file (md, html, txt) comes as text, cut the same way; any other file comes as filename and mime_type only, with a note saying why. A folder has no content: list_documents with its id as parent_id shows what is in it.", mcpSchemaDocument,
			func(ctx context.Context, p McpPrincipal, in mcpDocumentRef) (any, error) {
				return s.GetDocument(ctx, p, in)
			}),
	}
}
