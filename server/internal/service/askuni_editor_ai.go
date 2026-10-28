package service

import (
	"context"
	"log/slog"
	"slices"

	"github.com/unicomhub/uniwork/server/internal/audit"
)

// Whether the Office editor's UniWork AI can draft the file create_office_document
// makes (UNI-2264). The gate reads the status the web frame's uniwork_ai grant
// reads (handler/office_frame_ai.go), so the card and the frame agree.

// EditorAIChecker answers "" when the editor AI can draft format for the
// person, else why not: plan, off, format_off or credits. format is an Ask UNI
// format (docx, xlsx, pptx, pdf, md, html).
type EditorAIChecker interface {
	EditorAIReason(ctx context.Context, userID, orgID, format string) string
}

type editorAIGate struct {
	cloud *AICloudService
	caps  *OfficeCapabilitiesService
}

func NewEditorAIGate(cloud *AICloudService, caps *OfficeCapabilitiesService) EditorAIChecker {
	return editorAIGate{cloud: cloud, caps: caps}
}

func (g editorAIGate) EditorAIReason(ctx context.Context, userID, orgID, format string) string {
	st, err := g.cloud.Status(ctx, userID, orgID, g.caps)
	switch {
	case err != nil:
		return "off"
	case st.Reason == "entitlement_required" || st.Reason == "subscription_inactive":
		return "plan"
	case !st.Chat:
		return "off"
	case st.Credits.Remaining != nil && *st.Credits.Remaining <= 0:
		return "credits"
	}
	// The format flag says markdown where Ask UNI says md.
	if format == "md" {
		format = "markdown"
	}
	if !slices.Contains(st.UniworkAIFormats, format) {
		return "format_off"
	}
	return ""
}

// editorAIReason is the wired check, off without one.
func (s *AskUNIService) editorAIReason(ctx context.Context, userID, orgID, format string) string {
	if s.editorAI == nil {
		return "off"
	}
	return s.editorAI.EditorAIReason(ctx, userID, orgID, format)
}

// officeHandoffFor writes the package the editor AI drafts the new file from,
// when it can run for it now, and returns its id; "" for none. The file stays
// either way: without a package the asker drafts it themselves.
func (s *AskUNIService) officeHandoffFor(ctx context.Context, p McpPrincipal, in askOfficeIn, format, documentID string) string {
	via := audit.RequestFromContext(ctx).Via
	if via == nil || via.ProposalID == "" || s.editorAIReason(ctx, p.UserID, p.OrganizationID, format) != "" {
		return ""
	}
	h, err := createOfficeHandoff(ctx, s.q, NewOfficeHandoff{
		OrganizationID: p.OrganizationID, WorkspaceID: in.WorkspaceID, UserID: p.UserID, DocumentID: documentID,
		ProposalID: via.ProposalID, Format: format, Title: in.Title, Request: in.Instructions, Outline: in.Outline,
		Sources: in.Sources,
	}, s.now())
	if err != nil {
		// Ids only: the package is the asker's text.
		slog.WarnContext(ctx, "ask uni: office handoff not written",
			"organization_id", p.OrganizationID, "document_id", documentID, "proposal_id", via.ProposalID)
		return ""
	}
	return h.ID
}
