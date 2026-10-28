package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Ask UNI's create_office_document write tool (UNI-2261): a proposal for a NEW
// Office file made from a template, a file the asker attached, or a blank. It
// never writes to a template; the file it makes is the asker's own and private
// to them unless the card is switched to the workspace before Apply.

const (
	askOfficeOutlineRunes      = 16000
	askOfficeInstructionsRunes = 4000
)

// askOfficeFormats are the six formats the tool may name, in the order the card
// offers them.
var askOfficeFormats = []string{"docx", "xlsx", "pptx", "pdf", "md", "html"}

// officeFormatOfMIME is the format of a MIME type when it is one of the six.
func officeFormatOfMIME(m string) (string, bool) {
	base, _, err := mime.ParseMediaType(m)
	if err != nil {
		base = strings.ToLower(strings.TrimSpace(m))
	}
	for _, f := range askOfficeFormats {
		if want, ok := files.DocumentFormatMime(f); ok && want == base {
			return f, true
		}
	}
	return "", false
}

// withOfficeExt gives a new file's title the extension of its format, unless it
// already ends with it.
func withOfficeExt(title, format string) string {
	if format == "" || strings.HasSuffix(strings.ToLower(title), "."+format) {
		return title
	}
	return title + "." + format
}

// askStoredTitle stores the final title, so Apply makes the file the card showed.
func askStoredTitle(stored json.RawMessage, title string) (json.RawMessage, error) {
	m := map[string]json.RawMessage{}
	if err := json.Unmarshal(stored, &m); err != nil {
		return nil, err
	}
	m["title"], _ = json.Marshal(title)
	return json.Marshal(m)
}

// mcpSchemaCreateOfficeDocument is the model's view of the tool. workspace_id
// is the server's to add, as for every write tool.
const mcpSchemaCreateOfficeDocument = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["title"],
  "properties": {
    "title": {"type": "string", "description": "Title of the new file."},
    "template_id": {"type": "string", "description": "A template from list_templates to start from."},
    "attachment_id": {"type": "string", "description": "The attachment_id of a file the asker attached in this conversation."},
    "format": {"type": "string", "enum": ["docx", "xlsx", "pptx", "pdf", "md", "html"], "description": "The format of a blank file."},
    "parent_id": {"type": "string", "description": "Folder to put the file in; omit for the asker's own folder (or the workspace root when shared)."},
    "visibility": {"type": "string", "enum": ["restricted", "workspace"], "description": "restricted (default): only the asker. workspace: everyone in the workspace."},
    "instructions": {"type": "string", "description": "What to fill in or change, for the asker to review on the card (at most 4000 characters)."},
    "outline": {"type": "string", "description": "Markdown outline of the file (at most 16000 characters). Required for a blank file."},
    "sources": {
      "type": "array", "maxItems": 8,
      "description": "Material you read that the editor AI should use: each item names what you read (kind, id, title) and quotes the passage it needs. At most 8.",
      "items": {
        "type": "object", "additionalProperties": false, "required": ["kind", "id", "title", "quote"],
        "properties": {"kind": {"type": "string"}, "id": {"type": "string"}, "title": {"type": "string"}, "quote": {"type": "string"}}
      }
    }
  }
}`

type askOfficeIn struct {
	WorkspaceID  string                `json:"workspace_id"`
	Title        string                `json:"title"`
	TemplateID   string                `json:"template_id"`
	AttachmentID string                `json:"attachment_id"`
	Format       string                `json:"format"`
	ParentID     string                `json:"parent_id"`
	Visibility   string                `json:"visibility"`
	Instructions string                `json:"instructions"`
	Outline      string                `json:"outline"`
	Sources      []OfficeHandoffSource `json:"sources"`
}

// Limits of create_office_document's sources (plan 2026-10-28 decision 6).
const (
	askOfficeSourcesMax       = 8
	askOfficeSourceTitleRunes = 200
	askOfficeSourceQuoteRunes = 1500
	askOfficeSourceHeadRunes  = 200
)

// askOfficeSourceKinds are the kinds of object Ask UNI reads and cites.
var askOfficeSourceKinds = []string{"task", "project", "meeting", "document", "drive_file", "chat", "email_thread"}

// askOfficeSourceLines checks the sources and renders the card's list, one
// line per source: its title and the head of its quote. prepare never reads a
// source again; the asker reviews what the model quoted.
func askOfficeSourceLines(sources []OfficeHandoffSource) (string, error) {
	if len(sources) > askOfficeSourcesMax {
		return "", McpInvalidArgs{Msg: fmt.Sprintf("sources holds at most %d items", askOfficeSourcesMax)}
	}
	lines := make([]string, 0, len(sources))
	for _, src := range sources {
		switch {
		case !slices.Contains(askOfficeSourceKinds, src.Kind):
			return "", McpInvalidArgs{Msg: "a source's kind must be one of " + strings.Join(askOfficeSourceKinds, ", ")}
		case strings.TrimSpace(src.ID) == "":
			return "", McpInvalidArgs{Msg: "a source needs the id of what you read"}
		case utf8.RuneCountInString(src.Title) > askOfficeSourceTitleRunes:
			return "", McpInvalidArgs{Msg: fmt.Sprintf("a source's title holds at most %d characters", askOfficeSourceTitleRunes)}
		case strings.TrimSpace(src.Quote) == "" || utf8.RuneCountInString(src.Quote) > askOfficeSourceQuoteRunes:
			return "", McpInvalidArgs{Msg: fmt.Sprintf("a source's quote holds 1 to %d characters", askOfficeSourceQuoteRunes)}
		}
		head := []rune(oneLine(src.Quote))
		head = head[:min(len(head), askOfficeSourceHeadRunes)]
		lines = append(lines, "- **"+oneLine(src.Title)+"**: “"+string(head)+"…”")
	}
	return strings.Join(lines, "\n"), nil
}

func (s *AskUNIService) askOfficeTool() askWriteTool {
	return askWriteTool{
		Tool: ai.Tool{
			Name: "create_office_document",
			Description: "Create a new Office file (Word, Excel, PowerPoint, PDF, Markdown or HTML) for the asker and open it in the editor. " +
				"Start from exactly one of: a template from the workspace's Templates section (template_id from list_templates), a file the asker attached in this conversation (attachment_id), or a blank file (format). " +
				"This always makes a new file; never edit a template itself. If several templates fit, list them and ask which one; do not guess. " +
				"Give an outline in Markdown. It is required for a blank file: pptx one '## ' heading per slide with its points, docx the table of contents as headings with a line each, xlsx one heading per sheet listing its columns. " +
				"With a template or an attached file, list the parts you will fill. The file stays private to the asker unless they ask to share it with the workspace.",
			Kind: ai.ToolWrite, Risk: ai.RiskMedium, Undo: "the asker moves the new file to the trash",
			Schema: askToolSchema(json.RawMessage(mcpSchemaCreateOfficeDocument), 10),
		},
		prepare: s.prepareCreateOffice, apply: s.applyCreateOffice, inverse: "archive_document",
	}
}

// officeDocs is the document service the read path holds; the tool is closed
// without it.
func (s *AskUNIService) officeDocs() (*DocumentService, error) {
	if s.reads == nil || s.reads.docs == nil {
		return nil, errAskReadsNotWired
	}
	return s.reads.docs, nil
}

// ownAttachment is the asker's own ai_attachments row, without its bytes.
func (s *AskUNIService) ownAttachment(ctx context.Context, userID, workspaceID, attachmentID string) (AskAttachment, error) {
	w, err := s.requireMember(ctx, userID, workspaceID)
	if err != nil {
		return AskAttachment{}, err
	}
	row, err := s.q.AiGetUserAttachment(ctx, db.AiGetUserAttachmentParams{
		OrganizationID: w.OrganizationID, WorkspaceID: workspaceID, UserID: userID, ID: attachmentID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return AskAttachment{}, ErrNotFound
	}
	if err != nil {
		return AskAttachment{}, err
	}
	return askAttachmentRow(row), nil
}

func (s *AskUNIService) prepareCreateOffice(ctx context.Context, tc ai.ToolContext, args json.RawMessage, _ []askDraftRow) (askDraftRow, error) {
	var in askOfficeIn
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	title, err := mcpDocumentTitle(in.Title)
	if err != nil {
		return askDraftRow{}, err
	}
	if utf8.RuneCountInString(in.Outline) > askOfficeOutlineRunes {
		return askDraftRow{}, McpInvalidArgs{Msg: fmt.Sprintf("outline holds at most %d characters", askOfficeOutlineRunes)}
	}
	if utf8.RuneCountInString(in.Instructions) > askOfficeInstructionsRunes {
		return askDraftRow{}, McpInvalidArgs{Msg: fmt.Sprintf("instructions holds at most %d characters", askOfficeInstructionsRunes)}
	}
	sourceLines, err := askOfficeSourceLines(in.Sources)
	if err != nil {
		return askDraftRow{}, err
	}
	sources := 0
	for _, v := range []string{in.TemplateID, in.AttachmentID, in.Format} {
		if v != "" {
			sources++
		}
	}
	if sources != 1 {
		return askDraftRow{}, McpInvalidArgs{Msg: "give exactly one of template_id, attachment_id or format"}
	}
	for field, v := range map[string]string{"template_id": in.TemplateID, "attachment_id": in.AttachmentID, "parent_id": in.ParentID} {
		if _, err := mcpID(field, v); err != nil {
			return askDraftRow{}, err
		}
	}
	if in.Format != "" {
		if !slices.Contains(askOfficeFormats, in.Format) {
			return askDraftRow{}, McpInvalidArgs{Msg: "format must be docx, xlsx, pptx, pdf, md or html"}
		}
		if strings.TrimSpace(in.Outline) == "" {
			return askDraftRow{}, McpInvalidArgs{Msg: "outline is required for a blank file"}
		}
	}
	switch in.Visibility {
	case "":
		in.Visibility = "restricted"
	case "restricted", "workspace":
	default:
		return askDraftRow{}, McpInvalidArgs{Msg: "visibility must be restricted or workspace"}
	}
	docs, err := s.officeDocs()
	if err != nil {
		return askDraftRow{}, err
	}
	p := principalOf(tc)
	if !s.reads.documentsOn(ctx, p) {
		return askDraftRow{}, errMcpDocumentsUnavailable
	}
	actor := Human(tc.ActorID)

	var read []AskContextRef
	var source AskProposalField
	format := in.Format
	switch {
	case in.TemplateID != "":
		info, err := docs.TemplateSource(ctx, actor, tc.WorkspaceID, in.TemplateID)
		if err != nil {
			return askDraftRow{}, err
		}
		if !slices.Contains(askOfficeFormats, info.Format) {
			return askDraftRow{}, McpInvalidArgs{Msg: "this template's format cannot be made with create_office_document"}
		}
		source = AskProposalField{Field: "template_id", Type: "text", To: info.Title}
		format = info.Format
		title = withOfficeExt(title, info.Format)
		read = append(read, AskContextRef{Kind: "document", ID: info.ID, Title: info.Title})
	case in.AttachmentID != "":
		att, err := s.officeAttachment(ctx, tc, in.AttachmentID)
		if err != nil {
			return askDraftRow{}, err
		}
		source = AskProposalField{Field: "attachment_id", Type: "text", To: att.Name}
		format, _ = officeFormatOfMIME(att.MIME)
		title = withOfficeExt(title, format)
	default:
		source = AskProposalField{Field: "format", Type: "enum", To: in.Format, Options: askOfficeFormats}
		title = withOfficeExt(title, in.Format)
	}
	fields := []AskProposalField{source, {Field: "title", Type: "text", To: title}}

	if err := docs.CheckCreateIn(ctx, actor, tc.WorkspaceID, in.ParentID); err != nil {
		return askDraftRow{}, err
	}
	if in.ParentID != "" {
		parent, err := s.reads.document(ctx, p, tc.WorkspaceID, in.ParentID)
		if err != nil {
			return askDraftRow{}, err
		}
		fields = append(fields, AskProposalField{Field: "parent_id", Type: "text", To: parent.Document.Title})
		read = append(read, AskContextRef{Kind: "document", ID: parent.Document.ID, Title: parent.Document.Title})
	} else {
		where := "my_folder"
		if in.Visibility == "workspace" {
			where = "workspace_root"
		}
		fields = append(fields, AskProposalField{Field: "location", Type: "enum", To: where, Options: []string{}})
	}
	fields = append(fields, AskProposalField{Field: "visibility", Type: "enum", To: in.Visibility, Options: []string{"restricted", "workspace"}})
	if in.Instructions != "" {
		fields = append(fields, AskProposalField{Field: "instructions", Type: "text", To: in.Instructions})
	}
	if sourceLines != "" {
		fields = append(fields, AskProposalField{Field: "sources", Type: "markdown", To: sourceLines})
	}
	// What Apply then opens: the editor AI composing (building a deck), or why it cannot.
	editor := s.editorAIReason(ctx, tc.ActorID, tc.OrganizationID, format)
	if editor == "" {
		editor = "compose"
		if format == "pptx" {
			editor = "build"
		}
	}
	fields = append(fields, AskProposalField{Field: "editor_ai", Type: "enum", To: editor, Options: []string{}})
	audience := "private"
	if in.Visibility == "workspace" {
		audience = "workspace"
	}
	stored, err := askStoredArgs(args, tc.WorkspaceID)
	if err == nil {
		stored, err = askStoredTitle(stored, title)
	}
	if err != nil {
		return askDraftRow{}, err
	}
	return askDraftRow{
		Tool: "create_office_document", Args: stored, TargetKind: "document", Level: askLevel2, Read: read,
		Preview: AskProposalPreview{
			Target: AskContextRef{Kind: "document", Title: title}, Fields: fields, Body: in.Outline, Refs: []int{},
			Audience: AskAudience{Visibility: audience, Notifies: []AskContextRef{}},
		},
	}, nil
}

func (s *AskUNIService) applyCreateOffice(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	docs, err := s.officeDocs()
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	// The flag may have been switched off since the card was made.
	if !s.reads.documentsOn(ctx, p) {
		return AskProposalResult{}, nil, errMcpDocumentsUnavailable
	}
	var in askOfficeIn
	if err := decodeInto(row.Args, &in); err != nil {
		return AskProposalResult{}, nil, err
	}
	actor, ws := Human(p.UserID), in.WorkspaceID
	visibility, destination := in.Visibility, ""
	if visibility == "" {
		visibility = "restricted"
	}
	if in.ParentID == "" && visibility == "restricted" {
		destination = "my_folder"
	}
	var res DocumentFileResult
	switch {
	case in.TemplateID != "":
		res, err = docs.CreateDocumentFromTemplate(ctx, actor, ws, CreateFromTemplateInput{
			TemplateID: in.TemplateID, ParentID: in.ParentID, Destination: destination, Title: in.Title, Visibility: visibility,
		})
	case in.AttachmentID != "":
		var r files.Reader
		var att AskAttachment
		if r, att, err = s.OpenAttachment(ctx, p.UserID, ws, in.AttachmentID); err == nil {
			defer r.Close()
			res, err = docs.CreateFileDocument(ctx, actor, ws, CreateFileDocumentInput{
				Body: r.Body, Filename: att.Name, Title: in.Title, ParentID: in.ParentID, Destination: destination, Visibility: visibility,
			})
		}
	default:
		if s.office == nil {
			return AskProposalResult{}, nil, coded(http.StatusServiceUnavailable, "office_not_configured", "office engine is not configured")
		}
		res, err = s.office.CreateBlankFile(ctx, actor, ws, BlankFileInput{
			Format: in.Format, Title: in.Title, ParentID: in.ParentID, Destination: destination, Visibility: visibility,
		})
	}
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	out, inv, err := s.askFileCreated(ctx, ws, res)
	if err != nil {
		return out, inv, err
	}
	// The document services commit their own transactions, so the package is
	// written after the file exists; checked again here, as the card may be old.
	format := files.DocumentFormat(res.Version.MimeType.String, res.Document.Title)
	out.HandoffID = s.officeHandoffFor(ctx, p, in, format, out.ObjectID)
	return out, inv, nil
}

// officeAttachment is the asker's own attachment, when it is one of the six
// Office formats.
func (s *AskUNIService) officeAttachment(ctx context.Context, tc ai.ToolContext, attachmentID string) (AskAttachment, error) {
	att, err := s.ownAttachment(ctx, tc.ActorID, tc.WorkspaceID, attachmentID)
	if err != nil {
		return AskAttachment{}, err
	}
	if _, ok := officeFormatOfMIME(att.MIME); !ok {
		return AskAttachment{}, McpInvalidArgs{Msg: "the attached file is not a docx, xlsx, pptx, pdf, md or html file"}
	}
	return att, nil
}

// askFileCreated is the Apply result of a tool that made a file document: its
// id, link and revision, with archive_document as the undo.
func (s *AskUNIService) askFileCreated(ctx context.Context, ws string, res DocumentFileResult) (AskProposalResult, *askInverse, error) {
	base, err := s.base(ctx, ws)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	d := s.reads.docOf(base, res.Document)
	out := AskProposalResult{ObjectID: d.ID, Href: d.URL, Revision: res.Document.Revision}
	return out, askInverseOrNote(&out, "archive_document", map[string]any{"workspace_id": ws, "document_id": d.ID, "revision": res.Document.Revision}), nil
}

// Ask UNI's save_attachment_template write tool: its card is the question
// "save this file to Templates?". It shares nothing with create_office_document's
// card, so skipping it does not block the working file.

const mcpSchemaSaveAttachmentTemplate = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["attachment_id"],
  "properties": {
    "attachment_id": {"type": "string", "description": "The attachment_id of a file the asker attached in this conversation."},
    "title": {"type": "string", "description": "Title of the template; omit to use the file name."}
  }
}`

type askSaveTemplateIn struct {
	WorkspaceID  string `json:"workspace_id"`
	AttachmentID string `json:"attachment_id"`
	Title        string `json:"title"`
}

func (s *AskUNIService) askSaveTemplateTool() askWriteTool {
	return askWriteTool{
		Tool: ai.Tool{
			Name: "save_attachment_template",
			Description: "Save a file the asker attached in this conversation into the workspace's Templates section, so everyone in the workspace can reuse it. " +
				"Propose it when the asker attaches a file to use as a template and has not said whether to keep it; the card asks them. " +
				"To use the file only this once, propose create_office_document with its attachment_id instead.",
			Kind: ai.ToolWrite, Risk: ai.RiskMedium, Undo: "the asker moves the saved template to the trash",
			Schema: askToolSchema(json.RawMessage(mcpSchemaSaveAttachmentTemplate), 10),
		},
		prepare: s.prepareSaveAttachmentTemplate, apply: s.applySaveAttachmentTemplate, inverse: "archive_document",
	}
}

func (s *AskUNIService) prepareSaveAttachmentTemplate(ctx context.Context, tc ai.ToolContext, args json.RawMessage, _ []askDraftRow) (askDraftRow, error) {
	var in askSaveTemplateIn
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	if in.AttachmentID == "" {
		return askDraftRow{}, McpInvalidArgs{Msg: "attachment_id is required"}
	}
	if _, err := mcpID("attachment_id", in.AttachmentID); err != nil {
		return askDraftRow{}, err
	}
	if _, err := s.officeDocs(); err != nil {
		return askDraftRow{}, err
	}
	if !s.reads.documentsOn(ctx, principalOf(tc)) {
		return askDraftRow{}, errMcpDocumentsUnavailable
	}
	att, err := s.officeAttachment(ctx, tc, in.AttachmentID)
	if err != nil {
		return askDraftRow{}, err
	}
	// An empty title is CreateFileDocument's own default: the file name.
	title := files.SanitizeFilename(att.Name)
	if strings.TrimSpace(in.Title) != "" {
		if title, err = mcpDocumentTitle(in.Title); err != nil {
			return askDraftRow{}, err
		}
		f, _ := officeFormatOfMIME(att.MIME)
		title = withOfficeExt(title, f)
	}
	stored, err := askStoredArgs(args, tc.WorkspaceID)
	if err == nil && strings.TrimSpace(in.Title) != "" {
		stored, err = askStoredTitle(stored, title)
	}
	if err != nil {
		return askDraftRow{}, err
	}
	return askDraftRow{
		Tool: "save_attachment_template", Args: stored, TargetKind: "document", Level: askLevel2,
		Preview: AskProposalPreview{
			Target: AskContextRef{Kind: "document", Title: title},
			Fields: []AskProposalField{{Field: "attachment_id", Type: "text", To: att.Name}, {Field: "title", Type: "text", To: title}},
			Refs:   []int{}, Audience: AskAudience{Visibility: "workspace", Notifies: []AskContextRef{}},
		},
	}, nil
}

func (s *AskUNIService) applySaveAttachmentTemplate(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	docs, err := s.officeDocs()
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	if !s.reads.documentsOn(ctx, p) {
		return AskProposalResult{}, nil, errMcpDocumentsUnavailable
	}
	var in askSaveTemplateIn
	if err := decodeInto(row.Args, &in); err != nil {
		return AskProposalResult{}, nil, err
	}
	r, att, err := s.OpenAttachment(ctx, p.UserID, in.WorkspaceID, in.AttachmentID)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	defer r.Close()
	res, err := docs.CreateFileDocument(ctx, Human(p.UserID), in.WorkspaceID, CreateFileDocumentInput{
		Body: r.Body, Filename: att.Name, Title: in.Title, Template: true,
	})
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	return s.askFileCreated(ctx, in.WorkspaceID, res)
}
