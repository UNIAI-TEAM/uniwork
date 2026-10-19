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
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/document"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
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

var errMcpDocumentsUnavailable = McpToolError{Code: "documents_unavailable", Msg: "documents are not available"}

// mcpDocumentsFlag is the kill switch every REST document route sits behind.
const mcpDocumentsFlag = "documents"

// SetDocuments wires documents into the connector's tools (Phase 4 of the
// write spec); without it the document tools answer documents_unavailable.
func (s *McpToolService) SetDocuments(d *DocumentService) { s.docs = d }

// SetFlags wires the feature-flag evaluator. The documents flag is its only
// reader here; without it documents read as off (fail closed, as in
// McpAuthService).
func (s *McpToolService) SetFlags(f McpFlags) { s.flags = f }

// documentsOn says whether the person may use documents through the connector:
// DocumentService is wired and the `documents` flag is on for the grant's
// organization and the person, as the REST routes evaluate it (overrides
// included). Every document tool, and the document half of search, asks it
// first, so a tool added later that reaches documents through document()
// inherits it.
func (s *McpToolService) documentsOn(ctx context.Context, p McpPrincipal) bool {
	if s.docs == nil || s.flags == nil {
		return false
	}
	def := false
	if f, ok := featureflags.Lookup(mcpDocumentsFlag); ok {
		def = f.Default
	}
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: p.UserID, OrganizationID: p.OrganizationID})
	return s.flags.IsEnabled(ctx, mcpDocumentsFlag, def)
}

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
	if !s.documentsOn(ctx, p) {
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
			// The name and type were readable; the bytes not being so (storage down,
			// a file not ready) is no reason to fail the call.
			slog.WarnContext(ctx, "mcp get_document: file text not read", "error", err, "document_id", v.Document.ID)
			out.Note = "the text of this file could not be read just now, so only its name and type are shown; try again later"
			break
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
	if !s.documentsOn(ctx, p) {
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
// of its text. Where documents are not available there are none, silently.
func (s *McpToolService) searchDocuments(ctx context.Context, p McpPrincipal, workspaceID, query string) ([]McpItem, error) {
	if !s.documentsOn(ctx, p) {
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

// mcpMaxDocumentTitleRunes is the longest page title a tool writes: the
// service's own limit. Rename also refuses a stored title over it, which
// changes could not show whole (it cuts a string at mcpMaxHitRunes).
const mcpMaxDocumentTitleRunes = maxDocumentTitle

// mcpDocumentTitle is a title a model sent, as the service stores it.
func mcpDocumentTitle(v string) (string, error) {
	title := strings.TrimSpace(v)
	if n := utf8.RuneCountInString(title); n == 0 || n > mcpMaxDocumentTitleRunes {
		return "", McpInvalidArgs{Msg: fmt.Sprintf("title must be 1-%d characters", mcpMaxDocumentTitleRunes)}
	}
	return title, nil
}

// mcpDocumentContent refuses Markdown the converter would not read, with the
// way out for the model: the same figure document.MarkdownToPage holds.
func mcpDocumentContent(md string) error {
	if utf8.RuneCountInString(md) > document.MaxMarkdownRunes {
		return McpInvalidArgs{Msg: fmt.Sprintf("content holds at most %d characters; send a longer text in parts, each one appended with update_document", document.MaxMarkdownRunes)}
	}
	return nil
}

type mcpCreateDocumentIn struct {
	WorkspaceID string `json:"workspace_id"`
	Title       string `json:"title"`
	Content     string `json:"content"`
	ParentID    string `json:"parent_id"`
}

// CreateDocument creates a page from Markdown. DocumentService decides who may
// put it where: at the root of a workspace the person belongs to (private by
// default, SH-S1), or under a folder or page they may edit, whose visibility
// it takes (CreatePage). A parent the person cannot use reads as not found.
// Nobody is notified: document.created has no notification rule.
func (s *McpToolService) CreateDocument(ctx context.Context, p McpPrincipal, in mcpCreateDocumentIn) (McpWriteResult, error) {
	if !s.documentsOn(ctx, p) {
		return McpWriteResult{}, errMcpDocumentsUnavailable
	}
	title, err := mcpDocumentTitle(in.Title)
	if err != nil {
		return McpWriteResult{}, err
	}
	if err := mcpDocumentContent(in.Content); err != nil {
		return McpWriteResult{}, err
	}
	parent, err := mcpID("parent_id", in.ParentID)
	if err != nil {
		return McpWriteResult{}, err
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	// No content is an empty page, not one with a stray paragraph.
	var content json.RawMessage
	if strings.TrimSpace(in.Content) != "" {
		if content, err = document.MarkdownToPage(in.Content, nil); err != nil {
			return McpWriteResult{}, McpInvalidArgs{Msg: "content could not be stored: " + err.Error()}
		}
	}
	// Read before the write: a failure after the page exists would tell the
	// model it failed, and a retry would create a second one.
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	var parentID string
	if parent != nil {
		parentID = *parent
	}
	v, err := s.docs.CreatePage(ctx, Human(p.UserID), in.WorkspaceID, CreatePageInput{Kind: DocumentKindPage, ParentID: parentID, Title: title, Content: content})
	if err != nil {
		return McpWriteResult{}, err
	}
	return McpWriteResult{Item: s.docOf(base, v.Document), Revision: v.Document.Revision}, nil
}

// mcpUpdateDocumentIn has pointers for title and content so that a blank one
// is told from one left out: a blank title is a mistake to correct, and
// content "" appends nothing.
type mcpUpdateDocumentIn struct {
	WorkspaceID string  `json:"workspace_id"`
	DocumentID  string  `json:"document_id"`
	Revision    *int64  `json:"revision"`
	Title       *string `json:"title"`
	Content     *string `json:"content"`
	Mode        string  `json:"mode"`
}

// versionLabel names the version taken before an AI app changes a page, so a
// person finds it in the page's history.
func versionLabel(ctx context.Context) string {
	label := "Trước khi sửa qua ứng dụng AI"
	if v := audit.RequestFromContext(ctx).Via; v != nil && strings.TrimSpace(v.ClientName) != "" {
		label = "Trước khi sửa qua " + strings.TrimSpace(v.ClientName)
	}
	return capRunes(label, maxDocumentVersionLabel, "")
}

// UpdateDocument renames a page and appends Markdown to it or replaces its
// content. Before a change to the content the page as it was is saved as a
// version, the undo of the call. replace is refused on a page the model cannot
// have read whole as Markdown (lossy, or longer than get_document shows), so a
// page is never rewritten from text that was not all of it. The revision is
// checked here before anything is written, and again by the service under the
// row lock. Nobody is notified: document.updated has no notification rule.
func (s *McpToolService) UpdateDocument(ctx context.Context, p McpPrincipal, in mcpUpdateDocumentIn) (McpWriteResult, error) {
	if in.Revision == nil || *in.Revision <= 0 {
		return McpWriteResult{}, McpInvalidArgs{Msg: "revision is required; read the document first and send its revision"}
	}
	if in.Mode == "" {
		in.Mode = "append"
	}
	if in.Mode != "append" && in.Mode != "replace" {
		return McpWriteResult{}, McpInvalidArgs{Msg: "mode must be append or replace"}
	}
	if in.Content == nil && in.Title == nil {
		return McpWriteResult{}, McpInvalidArgs{Msg: "send content, title or both"}
	}
	var title *string
	if in.Title != nil {
		t, err := mcpDocumentTitle(*in.Title)
		if err != nil {
			return McpWriteResult{}, err
		}
		title = &t
	}
	if in.Content != nil {
		if err := mcpDocumentContent(*in.Content); err != nil {
			return McpWriteResult{}, err
		}
		if in.Mode == "append" && strings.TrimSpace(*in.Content) == "" {
			return McpWriteResult{}, McpInvalidArgs{Msg: "content is empty, so there is nothing to append"}
		}
	}
	v, err := s.document(ctx, p, in.WorkspaceID, in.DocumentID)
	if err != nil {
		return McpWriteResult{}, err
	}
	before := v.Document
	if before.Kind != DocumentKindPage {
		return McpWriteResult{}, McpToolError{Code: "not_a_page", Msg: "only pages can be edited through the connector; files and folders are edited in UniWork"}
	}
	if before.Revision != *in.Revision {
		return McpWriteResult{}, errRevisionConflict(before.Revision)
	}
	// Undo of a rename sends back changes.from, which the cut of changes would
	// spoil for a title over the cap.
	if title != nil && utf8.RuneCountInString(before.Title) > mcpMaxDocumentTitleRunes {
		return McpWriteResult{}, McpInvalidArgs{Msg: "the page's title is too long to change safely here; edit it in UniWork"}
	}
	var content json.RawMessage
	var beforeMD string
	var shown *mcpContentEdit
	if in.Content != nil {
		var lossy bool
		if beforeMD, lossy, err = document.PageToMarkdown(before.Content); err != nil {
			return McpWriteResult{}, McpToolError{Code: "lossy_document", Msg: "the content of this page could not be read as Markdown; edit it in UniWork"}
		}
		if in.Mode == "replace" {
			if lossy || utf8.RuneCountInString(beforeMD) > mcpMaxItemRunes {
				return McpWriteResult{}, McpToolError{Code: "lossy_document", Msg: "this page holds content Markdown cannot carry or is longer than one read, so replacing it could lose part of it; use mode append, or edit it in UniWork"}
			}
			content, err = document.MarkdownToPage(*in.Content, document.AssetsOf(before.Content))
			shown = &mcpContentEdit{replace: true, beforeMD: beforeMD}
		} else {
			content, err = document.AppendMarkdown(before.Content, *in.Content)
			shown = &mcpContentEdit{appended: *in.Content}
		}
		if err != nil {
			return McpWriteResult{}, McpInvalidArgs{Msg: "content could not be stored: " + err.Error()}
		}
	}
	// Read before the write: a failure after the page changed would tell the
	// model it failed, and a retry would change it again.
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	actor := Human(p.UserID)
	contentChanged := content != nil && !sameJSON(content, before.Content)
	var note string
	switch {
	case contentChanged:
		// The version is taken only for a change that will be written. When the
		// page already equals its latest version none is added, and the note says
		// so rather than name a label that does not exist.
		// The note quotes the label the row holds: the service trims what is sent.
		switch saved, err := s.docs.CreateDocumentVersion(ctx, actor, before.ID, CreateDocumentVersionInput{Label: versionLabel(ctx)}); {
		case err == nil:
			note = fmt.Sprintf("the page as it was is saved as the version %q in its history", saved.Label.String)
		case codedIs(err, "document_version_unchanged"):
			note = "the page as it was is already the latest version in its history"
		default:
			return McpWriteResult{}, err
		}
	case title == nil || *title == before.Title:
		note = "nothing changed: the page already held this, so its revision and history are as they were"
	}
	after, err := s.docs.UpdateDocument(ctx, actor, before.ID, UpdateDocumentInput{Revision: *in.Revision, Title: title, Content: content})
	if err != nil {
		return McpWriteResult{}, err
	}
	return s.documentUpdated(base, before, after.Document, shown, note), nil
}

// mcpContentEdit is what update_document did to the content, as the result
// shows it. A replace shows the page's Markdown before and, read back from the
// saved page, after. An append shows only the Markdown it added, from empty:
// on a long page the start of the page before and after would be the same text.
type mcpContentEdit struct {
	replace  bool
	beforeMD string // replace: the page as Markdown before
	appended string // append: the Markdown sent
}

// documentUpdated is what update_document returns once the page is saved. It
// never fails: a model that read an error would write the page again, so a
// part that cannot be shown goes into the note, after what was saved. content
// is nil when no content was sent.
func (s *McpToolService) documentUpdated(base string, before, after db.Document, content *mcpContentEdit, note string) McpWriteResult {
	res := McpWriteResult{Item: s.docOf(base, after), Revision: after.Revision, Note: note}
	changes := []McpChange{{"title", before.Title, after.Title}}
	switch {
	case content == nil:
	case !content.replace:
		changes = append(changes, McpChange{"content", "", content.appended})
	default:
		if afterMD, _, err := document.PageToMarkdown(after.Content); err != nil {
			unread := "the page was saved, but its new Markdown could not be read back; call get_document to see it"
			if res.Note != "" {
				unread = res.Note + "; " + unread
			}
			res.Note = unread
		} else {
			changes = append(changes, McpChange{"content", content.beforeMD, afterMD})
		}
	}
	res.Changes = mcpChanges(changes...)
	return res
}

type mcpAddDocumentCommentIn struct {
	WorkspaceID string `json:"workspace_id"`
	DocumentID  string `json:"document_id"`
	Body        string `json:"body"`
}

// AddDocumentComment starts a comment thread on a document, as the person: it
// needs edit on the document (DocumentService), and reads as not found for a
// person who may only read it. Whoever can read the document sees it. The
// notification rule (ruleDocumentCommentAdded) tells the people the body
// names as [@Name](mention://member/<user_id>) who can read the document, and
// the author of the parent comment for a reply, which this tool cannot write:
// a comment with no mention notifies nobody.
func (s *McpToolService) AddDocumentComment(ctx context.Context, p McpPrincipal, in mcpAddDocumentCommentIn) (McpWriteResult, error) {
	if n := utf8.RuneCountInString(strings.TrimSpace(in.Body)); n == 0 || n > mcpMaxBodyRunes {
		return McpWriteResult{}, McpInvalidArgs{Msg: fmt.Sprintf("body must be 1-%d characters", mcpMaxBodyRunes)}
	}
	v, err := s.document(ctx, p, in.WorkspaceID, in.DocumentID)
	if err != nil {
		return McpWriteResult{}, err
	}
	// Read before the write: a failure after the comment exists would tell the
	// model it failed, and a retry would post it twice.
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	c, err := s.docs.AddDocumentComment(ctx, Human(p.UserID), v.Document.ID, AddCommentInput{Body: in.Body}, "")
	if err != nil {
		return McpWriteResult{}, err
	}
	return McpWriteResult{Item: McpComment{ID: c.ID, DocumentID: v.Document.ID, Body: capRunes(c.Body, mcpMaxHitRunes, mcpHitCut), URL: s.frontend + base + "/documents/" + v.Document.ID}}, nil
}

var (
	mcpSchemaListDocuments = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"parent_id":{"type":"string","description":"A folder or page id; omit for the top level of the workspace."},"cursor":{"type":"string","description":"next_cursor of the previous page."}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaDocument      = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"document_id":{"type":"string"}},"required":["workspace_id","document_id"],"additionalProperties":false}`)

	mcpSchemaCreateDocument  = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"title":{"type":"string","minLength":1,"maxLength":` + strconv.Itoa(mcpMaxDocumentTitleRunes) + `},"content":{"type":"string","maxLength":` + strconv.Itoa(document.MaxMarkdownRunes) + `,"description":"Markdown: headings, lists, task lists, tables, code, quotes, https links, [@Name](uniwork://user/<user_id>) mentions. A longer text is appended in parts with update_document."},"parent_id":{"type":"string","description":"A folder or page to put it in; omit for the top level of the workspace."}},"required":["workspace_id","title"],"additionalProperties":false}`)
	mcpSchemaUpdateDocument  = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"document_id":{"type":"string"},"revision":{"type":"integer","description":"The revision get_document returned."},"title":{"type":"string","minLength":1,"maxLength":` + strconv.Itoa(mcpMaxDocumentTitleRunes) + `},"content":{"type":"string","maxLength":` + strconv.Itoa(document.MaxMarkdownRunes) + `,"description":"Markdown. A longer text is sent in parts, each one appended."},"mode":{"type":"string","enum":["append","replace"],"description":"append (the default) adds content after the page's own; replace swaps the whole content and needs a page that is not lossy."}},"required":["workspace_id","document_id","revision"],"additionalProperties":false}`)
	mcpSchemaDocumentComment = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"document_id":{"type":"string"},"body":{"type":"string","minLength":1,"maxLength":` + strconv.Itoa(mcpMaxBodyRunes) + `,"description":"The comment. To mention someone write [@Name](mention://member/<user_id>) with a user_id from list_members."}},"required":["workspace_id","document_id","body"],"additionalProperties":false}`)
)

func mcpDocumentTools(s *McpToolService) []ai.Tool {
	return []ai.Tool{
		mcpReadTool("list_documents", "List documents", "Pages, files and folders under one folder or page of the workspace (the top level when parent_id is omitted) that the user may read, in the order of the document tree (siblings by position, then id), "+strconv.Itoa(mcpMaxList)+" at a time; a next_cursor in the answer is the cursor to pass for the next page. Each row has its doc_kind and revision, no content: call get_document for that. Documents in the trash are not listed.", mcpSchemaListDocuments,
			func(ctx context.Context, p McpPrincipal, in mcpListDocumentsIn) (any, error) {
				return s.ListDocuments(ctx, p, in)
			}),
		mcpReadTool("get_document", "Get document", "One document the user may read. A page comes as Markdown in content, with its revision. lossy true means the page holds something Markdown cannot carry back exactly (a blank paragraph, a merged table cell, formatting Markdown cannot express, or more than "+strconv.Itoa(document.MaxMarkdownRunes)+" characters), so it can only be appended to, never replaced. content is cut at "+strconv.Itoa(mcpMaxItemRunes)+" characters and truncated says so; a cut page cannot be replaced either. A text file (md, html, txt) comes as text, cut the same way; any other file comes as filename and mime_type only, with a note saying why, and so does a text file whose text cannot be read at that moment. A folder has no content: list_documents with its id as parent_id shows what is in it.", mcpSchemaDocument,
			func(ctx context.Context, p McpPrincipal, in mcpDocumentRef) (any, error) {
				return s.GetDocument(ctx, p, in)
			}),
		mcpWriteTool("create_document", "Create document", "Creates a page from Markdown as the user, at the top level of the workspace or inside a folder or page (parent_id, one the user may edit; any other reads as not found). title is 1-"+strconv.Itoa(mcpMaxDocumentTitleRunes)+" characters. content is Markdown (headings, lists, task lists, tables, code, quotes, https links, [@Name](uniwork://user/<user_id>) mentions) of at most "+strconv.Itoa(document.MaxMarkdownRunes)+" characters: for a longer page create it with the first part and append the rest in parts with update_document. Only https, mailto: and UniWork-relative (/…) links stay links; any other keeps its text and loses the link, and an image becomes a link. A page at the top level or inside a folder is private (restricted, visible only to the user, workspace admins and the people it is shared with; a folder is never shared, so it passes nothing on); a page inside another page takes that page's visibility, and the parent's own shares are not copied. No one is notified, a mention in the page included. There is no duplicate guard: sending the same call again creates a second page, so if you are not sure a call went through, look with list_documents or search before sending it again. It comes back with its doc_kind, revision and url.", "the user moves it to the trash in UniWork, where it can be restored", false, mcpSchemaCreateDocument,
			func(ctx context.Context, p McpPrincipal, in mcpCreateDocumentIn) (any, error) {
				return s.CreateDocument(ctx, p, in)
			}),
		mcpWriteTool("update_document", "Update document", "Edits a page as the user: title renames it, content changes it as Markdown of at most "+strconv.Itoa(document.MaxMarkdownRunes)+" characters (a longer text is sent in parts, each one appended with a call of its own). mode append, the default, adds content after the page's own. mode replace swaps the whole content, and is refused with lossy_document, nothing written, when the page is lossy or its Markdown is longer than "+strconv.Itoa(mcpMaxItemRunes)+" characters (get_document would have shown it cut), because replacing it could lose what you never read: a blank paragraph, a merged table cell, formatting Markdown cannot carry; append still works on such a page. revision must be the one get_document returned; if the page changed since, nothing is written and the call fails with revision_conflict. Before a change to the content, a version of the page as it was is saved in the page's history, unless the latest version already is that page; the note says which. A rename saves none. Only https, mailto: and UniWork-relative (/…) links stay links; any other keeps its text and loses the link. Everyone who can read the page sees the change, and no one is notified. It needs the right to edit the page; one the user can only read reads as not found. Only pages can be edited, not files or folders, and a page whose title is longer than "+strconv.Itoa(mcpMaxDocumentTitleRunes)+" characters cannot be renamed here; edit those in UniWork. changes shows the title before and after and, when content was sent, the start of the content: for replace before and after, for append the start of the Markdown that was added is to and from is empty.", "restore the version saved before this change from the page's history in UniWork; for a rename, call update_document with the from title", true, mcpSchemaUpdateDocument,
			func(ctx context.Context, p McpPrincipal, in mcpUpdateDocumentIn) (any, error) {
				return s.UpdateDocument(ctx, p, in)
			}),
		mcpWriteTool("add_document_comment", "Add document comment", "Starts a new comment thread on a document as the user; it cannot reply to one. It needs the right to edit the document: one the user can only read reads as not found. Everyone who can read the document sees the comment. No one is notified unless the body names them as [@Name](mention://member/<user_id>), with a user_id from list_members: each person named is then notified in the app, unless they turned that kind off, if they can read the document; the user is never notified of their own mention, and @Name written as plain text notifies no one. body is 1-"+strconv.Itoa(mcpMaxBodyRunes)+" characters.", "the user deletes the comment in UniWork", false, mcpSchemaDocumentComment,
			func(ctx context.Context, p McpPrincipal, in mcpAddDocumentCommentIn) (any, error) {
				return s.AddDocumentComment(ctx, p, in)
			}),
	}
}
