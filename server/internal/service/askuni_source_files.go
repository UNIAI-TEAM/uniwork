package service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// The agent's two tools over the files attached to tasks, chat and email.
// They read through DocumentSourceService, whose list gate is each owning
// module's own read gate, and never through the MCP connector (ADR 0031 §4).

const askAttachmentOptOutNote = "the person who shared this file declined AI processing, so its content is not read"

// errAskSourcesNotWired is a server fault, never the model's: main did not call
// SetDocumentSources.
var errAskSourcesNotWired = errors.New("ask uni: document sources not wired")

// needsSources guards a tool that reads through the document sources.
func (s *AskUNIService) needsSources(run agentRunFunc) agentRunFunc {
	return s.needsReads(func(ctx context.Context, tc ai.ToolContext, args json.RawMessage) ([]agentItem, error) {
		if s.sources == nil {
			return nil, errAskSourcesNotWired
		}
		return run(ctx, tc, args)
	})
}

func (s *AskUNIService) listAttachmentsTool() agentTool {
	return readTool("list_attachments", "Files attached to tasks (and their comments), chat messages and emails in this workspace that the user may open: Word, Excel, PowerPoint, PDF, Markdown, HTML and text files, newest first, 50 at a time. Meeting recordings are not listed; get_meeting and get_meeting_transcript read a meeting. Open a row with get_attachment.",
		map[string]agentProp{
			"source":    strArg("chat, task, email or meeting; \"\" for every source."),
			"parent_id": strArg("A task id, chat room id or email thread id to list the files of; \"\" for everywhere."),
			"query":     strArg("Words in the file name; \"\" for any."),
			"type":      strArg("docx, xlsx, pptx, pdf, md, html or txt; \"\" for any."),
			"cursor":    strArg("The cursor a previous list_attachments call gave; \"\" for the first page."),
		}, s.needsSources(s.agentListAttachments))
}

func (s *AskUNIService) getAttachmentTool() agentTool {
	return readTool("get_attachment", "The text of one attached file from list_attachments: a text file's text, an Office file's text read paragraph by paragraph, slide by slide or row by row, a PDF's text page by page (no formatting, no scans). Up to 20 MiB.",
		map[string]agentProp{"attachment_id": strArg("The file's id from list_attachments.")}, s.needsSources(s.agentGetAttachment))
}

// attachmentHref is the app page that holds a file: its task, chat room or
// email thread. A kind with no page of its own gets the workspace base.
func attachmentHref(base string, it DocumentSourceItem) string {
	switch p := it.Parent; p.Kind {
	case "chat_channel", "chat_dm":
		return base + "/chat?room=" + p.ID
	case "task", "task_comment":
		return base + "/tasks/" + p.Ref
	case "email_thread":
		return base + "/email" // Email Hub has no thread route
	case "meeting":
		return base + "/meetings/" + p.ID
	}
	return base
}

// attachmentIn is the "In:" line: what holds the file.
func attachmentIn(it DocumentSourceItem) string {
	return "In: " + strings.ReplaceAll(it.Parent.Kind, "_", " ") + " " + it.Parent.Title
}

// declinedAI says the human who shared a file opted out of AI processing.
func declinedAI(it DocumentSourceItem, optOuts aiOptOuts) bool {
	return it.Owner != nil && it.Owner.Kind == "human" && optOuts.excludes(it.Owner.ID)
}

func (s *AskUNIService) agentListAttachments(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	var a struct {
		Source   string `json:"source"`
		ParentID string `json:"parent_id"`
		Query    string `json:"query"`
		Type     string `json:"type"`
		Cursor   string `json:"cursor"`
	}
	if err := agentArgs(raw, &a); err != nil {
		return nil, err
	}
	if !s.reads.documentsOn(ctx, principalOf(tc)) {
		return nil, errMcpDocumentsUnavailable
	}
	if !slices.Contains([]string{"", "chat", "task", "email", "meeting"}, a.Source) {
		return nil, McpInvalidArgs{Msg: "source must be chat, task, email, meeting or empty"}
	}
	if !slices.Contains([]string{"", "docx", "xlsx", "pptx", "pdf", "md", "html", "txt"}, a.Type) {
		return nil, McpInvalidArgs{Msg: "type must be docx, xlsx, pptx, pdf, md, html, txt or empty"}
	}
	f := DocumentSourceFilter{Source: a.Source, ParentID: a.ParentID, Q: a.Query, Cursor: a.Cursor, Limit: mcpMaxList}
	if a.Type != "" {
		f.Types = []string{a.Type}
	}
	page, err := s.sources.List(ctx, Human(tc.ActorID), tc.WorkspaceID, f)
	var invalid ValidationError
	if errors.As(err, &invalid) {
		return nil, McpInvalidArgs{Msg: "the query or cursor was not accepted; use a cursor list_attachments returned and a query of at most 200 characters"}
	}
	if err != nil {
		return nil, err
	}
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	owners := make([]string, 0, len(page.Items))
	for _, it := range page.Items {
		owners = append(owners, ownerIDOf(it))
	}
	optOuts, err := loadAIOptOuts(ctx, s.q, owners)
	if err != nil {
		return nil, err
	}
	out := make([]agentItem, 0, len(page.Items)+1)
	for _, it := range page.Items {
		// A page may come out shorter than 50 for this; the cursor still follows.
		if declinedAI(it, optOuts) {
			continue
		}
		h := attachmentHref(base, it)
		text := "ID: " + it.ID + "\n" + attachmentIn(it) + "\nSize: " + strconv.FormatInt(it.SizeBytes, 10) + "\nUpdated: " + it.UpdatedAt.UTC().Format(time.RFC3339)
		out = append(out, agentItem{Kind: "document", ID: it.ID, Key: h + "#" + it.ID, Href: h, Title: it.Name, Text: text, Foreign: true})
	}
	if page.NextCursor != "" {
		out = append(out, moreNote("More files follow; call list_attachments again with cursor "+page.NextCursor+"."))
	}
	return out, nil
}

func (s *AskUNIService) agentGetAttachment(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	var a struct {
		AttachmentID string `json:"attachment_id"`
	}
	if err := agentArgs(raw, &a); err != nil {
		return nil, err
	}
	if !s.reads.documentsOn(ctx, principalOf(tc)) {
		return nil, errMcpDocumentsUnavailable
	}
	ws, it, err := s.sources.ViewSource(ctx, Human(tc.ActorID), tc.WorkspaceID, a.AttachmentID)
	if err != nil {
		return nil, err
	}
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	optOuts, err := loadAIOptOuts(ctx, s.q, []string{ownerIDOf(it)})
	if err != nil {
		return nil, err
	}
	if declinedAI(it, optOuts) {
		// Like read_chat_room, which drops an opted-out sender: no name, no container, no bytes.
		return []agentItem{{Kind: "document", ID: it.ID, Key: base + "#" + it.ID, Href: base, Title: "", Text: "ID: " + it.ID + "\nNote: " + askAttachmentOptOutNote, Foreign: true}}, nil
	}
	content := s.readAttachment(ctx, tc, ws.OrganizationID, it)
	fields := "ID: " + it.ID + "\nFile: " + it.Name + " (" + it.MimeType + ")\n" + attachmentIn(it)
	if content.Note != "" {
		fields += "\nNote: " + content.Note
	}
	h := attachmentHref(base, it)
	return []agentItem{{Kind: "document", ID: it.ID, Key: h + "#" + it.ID, Href: h, Title: it.Name, Text: withText(fields, content.Content), Body: content.Content, Foreign: true}}, nil
}

func ownerIDOf(it DocumentSourceItem) string {
	if it.Owner == nil {
		return ""
	}
	return it.Owner.ID
}

// readAttachment is the text of a file the asker may open, or the note that
// says why it is not shown. The size is refused before a slot is taken or a
// byte opened; every kind takes the file-read slot, since an email part is read
// whole into memory. Whatever fails after the lookup is "try again later".
func (s *AskUNIService) readAttachment(ctx context.Context, tc ai.ToolContext, orgID string, it DocumentSourceItem) fileContent {
	kind, extractMIME := fileKindOf(it.MimeType, it.Name)
	switch {
	case kind == fileReadNone:
		return fileContent{Note: mcpNotTextNote}
	case kind == fileReadPDF && s.reads.pdf == nil:
		return fileContent{Note: mcpPDFUnavailableNote}
	case it.SizeBytes > mcpOfficeReadBytes:
		return fileContent{Note: mcpOfficeTooLargeNote}
	}
	busy := func(err error) fileContent {
		slog.WarnContext(ctx, "ask uni get_attachment: file not read", "error", err, "attachment_id", it.ID)
		return fileContent{Note: mcpFileBusyNote}
	}
	if err := takeSlot(ctx, s.fileReads); err != nil {
		return busy(err)
	}
	defer func() { <-s.fileReads }()
	f, err := s.sources.Open(ctx, Human(tc.ActorID), tc.WorkspaceID, it.ID)
	if err != nil {
		return busy(err)
	}
	defer f.Body.Close()
	data, err := io.ReadAll(io.LimitReader(f.Body, fileReadLimit(kind)))
	if err != nil {
		return busy(err)
	}
	return s.reads.fileContentOf(ctx, kind, extractMIME, data, fileSubject{
		OrganizationID: orgID, WorkspaceID: tc.WorkspaceID, ActorID: tc.ActorID, DocumentID: it.ID,
	})
}
