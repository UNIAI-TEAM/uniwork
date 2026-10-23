package service

import (
	"context"
	"encoding/json"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/document"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Ask UNI's document write tools (spec P3, R4): prepare reads and rates, apply
// runs the MCP connector's own write method as the asker, and each leaves the
// inverse that puts things back.

func init() {
	// shortcut: the revision is read, then the archive runs; a write between the
	// two slips through. Upgrade when ArchiveDocument takes a revision.
	askInverses["archive_document"] = func(ctx context.Context, s *AskUNIService, p McpPrincipal, args json.RawMessage) error {
		var a struct {
			WorkspaceID string `json:"workspace_id"`
			DocumentID  string `json:"document_id"`
			Revision    int64  `json:"revision"`
		}
		if err := json.Unmarshal(args, &a); err != nil {
			return err
		}
		if s.reads == nil {
			return errAskReadsNotWired
		}
		cur, err := s.reads.GetDocument(ctx, p, mcpDocumentRef{WorkspaceID: a.WorkspaceID, DocumentID: a.DocumentID})
		if err != nil {
			return askUndoGuard(err)
		}
		if cur.Revision != a.Revision {
			return errAskUndoUnavailable
		}
		_, err = s.docs.ArchiveDocument(ctx, Human(p.UserID), a.DocumentID, ArchiveDocumentInput{})
		return askUndoGuard(err)
	}
	// restore_document_version puts the page's content back from the version
	// saved before the edit, then its title; both only while the page still
	// stands at the revision the edit left.
	// shortcut: the restore and the rename are two writes; if the rename fails
	// after the restore, the content is back but the title is not and the row
	// reads undo_unavailable. Upgrade when one service call can do both.
	askInverses["restore_document_version"] = func(ctx context.Context, s *AskUNIService, p McpPrincipal, args json.RawMessage) error {
		var a struct {
			WorkspaceID string `json:"workspace_id"`
			DocumentID  string `json:"document_id"`
			Revision    int64  `json:"revision"`
			Version     int32  `json:"version"` // 0: the content was not edited
			Title       string `json:"title"`   // "": the title was not changed
		}
		if err := json.Unmarshal(args, &a); err != nil {
			return err
		}
		if s.reads == nil {
			return errAskReadsNotWired
		}
		cur, err := s.reads.GetDocument(ctx, p, mcpDocumentRef{WorkspaceID: a.WorkspaceID, DocumentID: a.DocumentID})
		if err != nil {
			return askUndoGuard(err)
		}
		if cur.Revision != a.Revision {
			return errAskUndoUnavailable
		}
		actor, rev := Human(p.UserID), a.Revision
		if a.Version > 0 {
			r, err := s.docs.RestoreDocumentVersion(ctx, actor, a.DocumentID, RestoreDocumentVersionInput{Version: a.Version, BaseRevision: rev})
			if err != nil {
				return askUndoGuard(err)
			}
			rev = r.View.Document.Revision
		}
		if a.Title != "" && a.Title != cur.Title {
			_, err := s.docs.UpdateDocument(ctx, actor, a.DocumentID, UpdateDocumentInput{Revision: rev, Title: &a.Title})
			return askUndoGuard(err)
		}
		return nil
	}
	askInverses["delete_document_comment"] = func(ctx context.Context, s *AskUNIService, p McpPrincipal, args json.RawMessage) error {
		var a struct {
			CommentID string `json:"comment_id"`
		}
		if err := json.Unmarshal(args, &a); err != nil {
			return err
		}
		_, err := s.docs.DeleteDocumentComment(ctx, Human(p.UserID), a.CommentID)
		return askUndoGuard(err)
	}
}

func (s *AskUNIService) askDocumentTools() []askWriteTool {
	tool := func(name, desc, undo string, risk ai.RiskLevel, destructive bool, schema json.RawMessage) ai.Tool {
		return ai.Tool{Name: name, Description: desc, Kind: ai.ToolWrite, Risk: risk, Destructive: destructive, Undo: undo, Schema: askToolSchema(schema, 10)}
	}
	return []askWriteTool{
		{
			Tool:    tool("create_document", "Proposes a new page written from Markdown. At the top level it is private to the asker; under a page it takes that page's visibility.", "the asker moves the page to the trash", ai.RiskLow, false, mcpSchemaCreateDocument),
			prepare: s.prepareCreateDocument, apply: s.applyCreateDocument, inverse: "archive_document",
		},
		{
			Tool:    tool("update_document", "Proposes an edit to one page: a new title, and content appended or replacing the page. Whoever can read the page sees it; a rename or a saved version can reach the page's audience, and anyone newly @mentioned in the content is notified.", "the asker restores the page as it was", ai.RiskMedium, true, mcpSchemaUpdateDocument),
			prepare: s.prepareUpdateDocument, apply: s.applyUpdateDocument, inverse: "restore_document_version",
		},
		{
			Tool:    tool("add_document_comment", "Proposes a new comment thread on a page, posted as the asker. Whoever can read the page sees it; anyone @mentioned in it is notified.", "the asker deletes the comment", ai.RiskMedium, false, mcpSchemaDocumentComment),
			prepare: s.prepareAddDocumentComment, apply: s.applyAddDocumentComment, inverse: "delete_document_comment",
		},
	}
}

// askDocBody is the Markdown a card shows, cut where the connector cuts a page.
func askDocBody(md string) string { return capRunes(md, mcpMaxItemRunes, "") }

// askDocumentID is a document_id the model sent: an id, or {{row:N.id}}.
func askDocumentID(v string) error {
	if strings.TrimSpace(v) == "" {
		return McpInvalidArgs{Msg: "document_id is required"}
	}
	return nil
}

func (s *AskUNIService) prepareCreateDocument(ctx context.Context, tc ai.ToolContext, args json.RawMessage, earlier []askDraftRow) (askDraftRow, error) {
	if s.reads == nil {
		return askDraftRow{}, errAskReadsNotWired
	}
	var in mcpCreateDocumentIn
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	title, err := mcpDocumentTitle(in.Title)
	if err != nil {
		return askDraftRow{}, err
	}
	if err := mcpDocumentContent(in.Content); err != nil {
		return askDraftRow{}, err
	}
	if _, err := mcpID("parent_id", in.ParentID); err != nil {
		return askDraftRow{}, err
	}
	refs, _, err := askRowRefs(earlier, askIDFields["create_document"].Refs, map[string]string{"parent_id": in.ParentID})
	if err != nil {
		return askDraftRow{}, err
	}
	stored, err := askStoredArgs(args, tc.WorkspaceID)
	if err != nil {
		return askDraftRow{}, err
	}
	fields := []AskProposalField{{Field: "title", Type: "text", To: title}}
	visibility := "private"
	switch {
	case in.ParentID == "":
	case len(refs) > 0:
		// The page this one goes under does not exist yet: it takes the
		// visibility that row will have.
		up := earlier[refs[0]-1].Preview
		fields = append(fields, AskProposalField{Field: "parent_id", Type: "text", To: up.Target.Title})
		visibility = up.Audience.Visibility
	default:
		parent, err := s.reads.document(ctx, principalOf(tc), tc.WorkspaceID, in.ParentID)
		if err != nil {
			return askDraftRow{}, err
		}
		fields = append(fields, AskProposalField{Field: "parent_id", Type: "text", To: parent.Document.Title})
		// A folder is never a source of visibility; only a page passes its own on.
		if v, _ := createHomeRow("", &parent.Document); v == documentVisibilityWorkspace {
			visibility = "workspace"
		}
	}
	level := askLevel1
	if in.ParentID != "" {
		level = askLevel2
	}
	return askDraftRow{
		Tool: "create_document", Args: stored, TargetKind: "document", Level: level,
		Preview: AskProposalPreview{
			Target: AskContextRef{Kind: "document", Title: title}, Fields: fields, Body: askDocBody(in.Content), Refs: refs,
			Audience: AskAudience{Visibility: visibility, Notifies: []AskContextRef{}},
		},
	}, nil
}

func (s *AskUNIService) prepareUpdateDocument(ctx context.Context, tc ai.ToolContext, args json.RawMessage, earlier []askDraftRow) (askDraftRow, error) {
	if s.reads == nil {
		return askDraftRow{}, errAskReadsNotWired
	}
	var in mcpUpdateDocumentIn
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	if in.Mode == "" {
		in.Mode = "append"
	}
	if in.Mode != "append" && in.Mode != "replace" {
		return askDraftRow{}, McpInvalidArgs{Msg: "mode must be append or replace"}
	}
	if in.Content == nil && in.Title == nil {
		return askDraftRow{}, McpInvalidArgs{Msg: "send content, title or both"}
	}
	var title string
	if in.Title != nil {
		t, err := mcpDocumentTitle(*in.Title)
		if err != nil {
			return askDraftRow{}, err
		}
		title = t
	}
	if in.Content != nil {
		if err := mcpDocumentContent(*in.Content); err != nil {
			return askDraftRow{}, err
		}
		if in.Mode == "append" && strings.TrimSpace(*in.Content) == "" {
			return askDraftRow{}, McpInvalidArgs{Msg: "content is empty, so there is nothing to append"}
		}
	}
	if err := askDocumentID(in.DocumentID); err != nil {
		return askDraftRow{}, err
	}
	refs, _, err := askRowRefs(earlier, askIDFields["update_document"].Refs, map[string]string{"document_id": in.DocumentID})
	if err != nil {
		return askDraftRow{}, err
	}
	stored, err := askStoredArgs(args, tc.WorkspaceID)
	if err != nil {
		return askDraftRow{}, err
	}
	row := askDraftRow{Tool: "update_document", Args: stored, TargetKind: "document", Level: askLevel2}
	var beforeTitle, beforeMD string
	var before json.RawMessage // the page's content as stored; empty while the page does not exist yet
	if len(refs) > 0 {
		// The page does not exist yet: every from is empty.
		row.Preview.Target = AskContextRef{Kind: "document", Title: earlier[refs[0]-1].Preview.Target.Title}
	} else {
		v, err := s.reads.document(ctx, principalOf(tc), tc.WorkspaceID, in.DocumentID)
		if err != nil {
			return askDraftRow{}, err
		}
		d := v.Document
		if d.Kind != DocumentKindPage {
			return askDraftRow{}, McpToolError{Code: "not_a_page", Msg: "only pages can be edited through the connector; files and folders are edited in UniWork"}
		}
		if in.Content != nil && in.Mode == "replace" {
			md, lossy, err := document.PageToMarkdown(d.Content)
			if err != nil || lossy || utf8.RuneCountInString(md) > mcpMaxItemRunes {
				return askDraftRow{}, McpToolError{Code: "lossy_document", Msg: "this page holds content Markdown cannot carry or is longer than one read, so replacing it could lose part of it; use mode append, or edit it in UniWork"}
			}
			beforeMD = md
		}
		beforeTitle, before = d.Title, d.Content
		rev := d.Revision
		row.TargetID, row.TargetRevision = d.ID, &rev
		row.Preview.Target = AskContextRef{Kind: "document", ID: d.ID, Title: d.Title}
	}
	row.Preview.Fields = []AskProposalField{}
	if in.Title != nil && title != beforeTitle {
		row.Preview.Fields = append(row.Preview.Fields, AskProposalField{Field: "title", Type: "text", From: orNil(beforeTitle), To: title})
	}
	if in.Content != nil && !(in.Mode == "replace" && *in.Content == beforeMD && len(refs) == 0) {
		row.Preview.Fields = append(row.Preview.Fields, AskProposalField{Field: "content", Type: "markdown", From: beforeMD, To: *in.Content})
		row.Preview.Body = askDocBody(*in.Content)
	}
	if len(row.Preview.Fields) == 0 {
		return askDraftRow{}, McpInvalidArgs{Msg: "nothing to change: the page already holds this"}
	}
	row.Preview.Refs = refs
	n := s.names(ctx, tc, earlier)
	// The people the save newly names are told; a saved version or a rename can
	// also reach the page's audience, so more people than those may hear of it.
	row.Preview.Audience = AskAudience{
		Visibility: "document", Notifies: n.notified(s.newMentions(ctx, tc, before, in)...),
		NotifiesMore: in.Content != nil || in.Title != nil && title != beforeTitle,
	}
	return row, nil
}

// newMentions is who the content of an edit newly @mentions on the page, the
// way a save decides it (newBodyMentionRecipients): the people the new body
// names that the one the page holds does not, without the asker and only
// members of the organization.
func (s *AskUNIService) newMentions(ctx context.Context, tc ai.ToolContext, before json.RawMessage, in mcpUpdateDocumentIn) []string {
	if in.Content == nil {
		return nil
	}
	var after json.RawMessage
	var err error
	if in.Mode == "replace" {
		after, err = document.MarkdownToPage(*in.Content, document.AssetsOf(before))
	} else {
		after, err = document.AppendMarkdown(before, *in.Content)
	}
	if err != nil {
		return nil
	}
	had := bodyMentionUserIDs(before)
	var added []string
	for _, id := range bodyMentionUserIDs(after) {
		if id != tc.ActorID && !slices.Contains(had, id) {
			added = append(added, id)
		}
	}
	if len(added) == 0 {
		return nil
	}
	members, err := s.q.ListActiveOrganizationMemberIds(ctx, db.ListActiveOrganizationMemberIdsParams{OrganizationID: tc.OrganizationID, UserIds: added})
	if err != nil {
		return nil
	}
	return slices.DeleteFunc(added, func(id string) bool { return !slices.Contains(members, id) })
}

// orNil is a from that is not there yet: nil, not an empty string.
func orNil(v string) any {
	if v == "" {
		return nil
	}
	return v
}

var askMentionRe = regexp.MustCompile(`mention://member/([0-9A-Za-z]+)`)

func (s *AskUNIService) prepareAddDocumentComment(ctx context.Context, tc ai.ToolContext, args json.RawMessage, earlier []askDraftRow) (askDraftRow, error) {
	if s.reads == nil {
		return askDraftRow{}, errAskReadsNotWired
	}
	var in mcpAddDocumentCommentIn
	if err := decodeInto(args, &in); err != nil {
		return askDraftRow{}, err
	}
	if n := utf8.RuneCountInString(strings.TrimSpace(in.Body)); n == 0 || n > mcpMaxBodyRunes {
		return askDraftRow{}, McpInvalidArgs{Msg: "body must be 1-" + strconv.Itoa(mcpMaxBodyRunes) + " characters"}
	}
	if err := askDocumentID(in.DocumentID); err != nil {
		return askDraftRow{}, err
	}
	refs, _, err := askRowRefs(earlier, askIDFields["add_document_comment"].Refs, map[string]string{"document_id": in.DocumentID})
	if err != nil {
		return askDraftRow{}, err
	}
	stored, err := askStoredArgs(args, tc.WorkspaceID)
	if err != nil {
		return askDraftRow{}, err
	}
	n := s.names(ctx, tc, earlier)
	var ids []string
	for _, m := range askMentionRe.FindAllStringSubmatch(in.Body, -1) {
		ids = append(ids, m[1])
	}
	row := askDraftRow{
		Tool: "add_document_comment", Args: stored, TargetKind: "document", Level: askLevel2,
		Preview: AskProposalPreview{Fields: []AskProposalField{}, Body: in.Body, Refs: refs, Audience: AskAudience{Visibility: "document", Notifies: n.notified(ids...)}},
	}
	if len(refs) > 0 {
		row.Preview.Target = AskContextRef{Kind: "document", Title: earlier[refs[0]-1].Preview.Target.Title}
		return row, nil
	}
	v, err := s.reads.document(ctx, principalOf(tc), tc.WorkspaceID, in.DocumentID)
	if err != nil {
		return askDraftRow{}, err
	}
	row.TargetID = v.Document.ID
	row.Preview.Target = AskContextRef{Kind: "document", ID: v.Document.ID, Title: v.Document.Title}
	return row, nil
}

func (s *AskUNIService) applyCreateDocument(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	if s.reads == nil {
		return AskProposalResult{}, nil, errAskReadsNotWired
	}
	var in mcpCreateDocumentIn
	if err := decodeInto(row.Args, &in); err != nil {
		return AskProposalResult{}, nil, err
	}
	res, err := s.reads.CreateDocument(ctx, p, in)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	out := AskProposalResult{Revision: res.Revision, Changes: res.Changes, Note: res.Note}
	d, ok := res.Item.(McpDocument)
	if !ok || d.ID == "" {
		askLoseUndo(&out)
		return out, nil, nil
	}
	out.ObjectID, out.Href = d.ID, d.URL
	return out, askInverseOrNote(&out, "archive_document", map[string]any{"workspace_id": in.WorkspaceID, "document_id": d.ID, "revision": res.Revision}), nil
}

func (s *AskUNIService) applyUpdateDocument(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	if s.reads == nil {
		return AskProposalResult{}, nil, errAskReadsNotWired
	}
	var in mcpUpdateDocumentIn
	if err := decodeInto(row.Args, &in); err != nil {
		return AskProposalResult{}, nil, err
	}
	before, err := s.reads.GetDocument(ctx, p, mcpDocumentRef{WorkspaceID: in.WorkspaceID, DocumentID: in.DocumentID})
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	// A row that waited for {{row:N.id}} has no revision of its own: the page
	// was made this turn, so the one just read is the one to write against.
	in.Revision = &before.Revision
	if row.TargetRevision != nil {
		in.Revision = row.TargetRevision
	}
	res, err := s.reads.UpdateDocument(ctx, p, in)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	out := AskProposalResult{ObjectID: before.ID, Revision: res.Revision, Changes: res.Changes, Note: res.Note}
	after, ok := res.Item.(McpDocument)
	contentWritten := slices.ContainsFunc(res.Changes, func(c McpChange) bool { return c.Field == "content" })
	if !ok {
		askLoseUndo(&out)
		return out, nil, nil
	}
	out.Href = after.URL
	version := 0
	if res.UndoVersionID != "" {
		v, err := strconv.Atoi(res.UndoVersionID)
		if err != nil {
			askLoseUndo(&out)
			return out, nil, nil
		}
		version = v
	}
	title := ""
	if after.Title != before.Title {
		title = before.Title
	}
	if version == 0 && contentWritten {
		// The content was rewritten but the version that holds it as it was is
		// unknown: the title alone must not be undone as if that were all.
		askLoseUndo(&out)
		return out, nil, nil
	}
	if version == 0 && title == "" {
		return out, nil, nil // nothing was written: no undo to offer
	}
	back := map[string]any{"workspace_id": in.WorkspaceID, "document_id": before.ID, "revision": res.Revision, "version": version, "title": title}
	return out, askInverseOrNote(&out, "restore_document_version", back), nil
}

func (s *AskUNIService) applyAddDocumentComment(ctx context.Context, p McpPrincipal, row askDraftRow) (AskProposalResult, *askInverse, error) {
	if s.reads == nil {
		return AskProposalResult{}, nil, errAskReadsNotWired
	}
	var in mcpAddDocumentCommentIn
	if err := decodeInto(row.Args, &in); err != nil {
		return AskProposalResult{}, nil, err
	}
	res, err := s.reads.AddDocumentComment(ctx, p, in)
	if err != nil {
		return AskProposalResult{}, nil, err
	}
	out := AskProposalResult{Note: res.Note}
	c, ok := res.Item.(McpComment)
	if !ok || c.ID == "" {
		askLoseUndo(&out)
		return out, nil, nil
	}
	out.ObjectID, out.Href = c.ID, c.URL
	return out, askInverseOrNote(&out, "delete_document_comment", map[string]any{"comment_id": c.ID}), nil
}
