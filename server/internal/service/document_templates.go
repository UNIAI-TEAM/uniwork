package service

// Document templates (UNI-2225): a template is an ordinary workspace file
// document carrying a mark (documents.template_marked_*). Marking and
// unmarking are idempotent and audit only a real change. The mark is library
// state, not content: it never moves the document's revision, and a copy of a
// template is a plain document (CopyDocument writes its own columns).

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// MarkDocumentTemplateInput carries the one confirmation a mark can need.
type MarkDocumentTemplateInput struct {
	// WidenToWorkspace confirms that a restricted file may be opened to the
	// whole workspace (as editors) so that it can be a template.
	WidenToWorkspace bool
}

// errTemplateWidensVisibility refuses to mark a restricted file without the
// caller's confirmation: a template is visible to the whole workspace.
func errTemplateWidensVisibility() error {
	return coded(http.StatusConflict, "template_widens_visibility",
		"đánh dấu là mẫu sẽ mở tài liệu cho cả workspace; hãy xác nhận")
}

// MarkDocumentTemplate marks a workspace file as a template. A repeat returns
// the document as it stands and audits nothing.
func (s *DocumentService) MarkDocumentTemplate(ctx context.Context, actor Actor, documentID string, in MarkDocumentTemplateInput) (DocumentView, error) {
	var out DocumentView
	err := s.withDocumentGateLocked(ctx, actor, documentID, "", decideDocumentViewOrAdminister, shelveWriteRefused, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		if err := s.templateCommandChecks(ctx, q, actor, doc); err != nil {
			return err
		}
		if doc.Visibility == documentVisibilityRestricted {
			if !in.WidenToWorkspace {
				return errTemplateWidensVisibility()
			}
			// Opening a restricted document hands read access to the whole
			// workspace: manage only, never AdminScope (as the PATCH).
			if !access.Level.AtLeast(DocumentLevelManage) {
				if access.Level == DocumentLevelNone && access.AdminScope {
					return errBreakGlassRequired()
				}
				return ErrForbidden
			}
			var err error
			if doc, err = writeDocumentHomeRow(ctx, q, actor, doc, documentHomeRowMove{
				Visibility: documentVisibilityWorkspace, WorkspaceLevel: string(DocumentLevelEdit),
			}); err != nil {
				return err
			}
		}
		doc, err := s.recordTemplateMark(ctx, q, actor, doc)
		if err != nil {
			return err
		}
		out, err = s.documentView(ctx, q, actor, doc)
		return err
	})
	return out, err
}

// UnmarkDocumentTemplate clears the mark. A document that is not marked is a
// no-op; a shelved document can still be unmarked.
func (s *DocumentService) UnmarkDocumentTemplate(ctx context.Context, actor Actor, documentID string) (DocumentView, error) {
	var out DocumentView
	err := s.withDocumentGateLocked(ctx, actor, documentID, "", decideDocumentViewOrAdminister, shelveWriteAllowed, func(q *db.Queries, doc db.Document, _ DocumentAccess) error {
		if err := s.templateCommandChecks(ctx, q, actor, doc); err != nil {
			return err
		}
		cleared, err := q.ClearDocumentTemplateMark(ctx, db.ClearDocumentTemplateMarkParams{
			ID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
		})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			// Already clear: nothing changed, nothing audited.
		case err != nil:
			return err
		default:
			doc = cleared
			if err := auditRecorder.Record(ctx, q, templateAuditEntry(actor, doc, audit.ActionDocumentTemplateUnmarked),
				templateEvent(doc, audit.ActionDocumentTemplateUnmarked)); err != nil {
				return err
			}
		}
		out, err = s.documentView(ctx, q, actor, doc)
		return err
	})
	return out, err
}

// templateCommandChecks are the checks both commands run after the gate, so a
// caller who cannot see the document learns nothing from them.
func (s *DocumentService) templateCommandChecks(ctx context.Context, q *db.Queries, actor Actor, doc db.Document) error {
	// A template is a person's choice for the workspace: an agent passes the
	// view gate but never marks one (ADR 0010).
	if actor.Kind != audit.KindHuman {
		return ErrForbidden
	}
	if _, err := s.ws.RequireMemberQ(ctx, q, doc.WorkspaceID, actor.ID); err != nil {
		return err
	}
	if doc.OwnerKind.Valid {
		return errDocumentOwned()
	}
	if doc.Kind != DocumentKindFile {
		return Invalid("chỉ tệp mới đánh dấu là mẫu được")
	}
	return nil
}

// recordTemplateMark sets the mark on doc inside the caller's transaction and
// writes its audit row and event. A document that already carries the mark is
// returned unchanged and audits nothing. The upload-as-template path reuses it.
func (s *DocumentService) recordTemplateMark(ctx context.Context, q *db.Queries, actor Actor, doc db.Document) (db.Document, error) {
	marked, err := q.SetDocumentTemplateMark(ctx, db.SetDocumentTemplateMarkParams{
		ID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
		TemplateMarkedBy: nullText(actor.ID), TemplateMarkedByKind: nullText(string(actor.Kind)),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return doc, nil
	}
	if err != nil {
		return db.Document{}, err
	}
	if err := auditRecorder.Record(ctx, q, templateAuditEntry(actor, marked, audit.ActionDocumentTemplateMarked),
		templateEvent(marked, audit.ActionDocumentTemplateMarked)); err != nil {
		return db.Document{}, err
	}
	return marked, nil
}

func templateAuditEntry(actor Actor, doc db.Document, action string) audit.Entry {
	return audit.Entry{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
		Actor: actor, Action: action, ResourceType: "document", ResourceID: doc.ID,
	}
}

func templateEvent(doc db.Document, topic string) audit.Event {
	return audit.Event{Topic: topic, Payload: map[string]string{
		"document_id": doc.ID, "workspace_id": doc.WorkspaceID,
	}}
}
