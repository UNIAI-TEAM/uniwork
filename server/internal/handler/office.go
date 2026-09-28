package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Office routes (plan G2-07 / UNI-690): capability, job start/status/cancel,
// blank creation and the standalone copy. The browser never receives a
// private engine address: a job answer carries ids, states and the pinned
// engine identity only, and the engine's output travels to FileService, never
// to the client. Every route authorizes through the document ACL.
//
// This tier never imports internal/office (ADR 0021 leaf guard): the
// allowlists, the pinned identity and the error view come from the service
// tier, and the engine client is built only at the composition root.

// officeError maps the office boundary's typed errors onto the HTTP table:
// the engine's own code and status (engine-contract §4.7) plus the contract's
// kind/retryable fields, and the deployment errors that mean "no engine".
func (h *handlers) mapOfficeError(w http.ResponseWriter, err error) {
	if view, ok := service.OfficeBoundaryError(err); ok {
		fields := map[string]any{"retryable": view.Retryable, "fidelity_preserved": true}
		if view.Kind != "" {
			fields["kind"] = view.Kind
		}
		if view.Reason != "" {
			fields["reason"] = view.Reason
		}
		respondErrorFields(w, view.Status, view.Code, err.Error(), fields)
		return
	}
	switch {
	case service.IsOfficeNotConfigured(err):
		respondError(w, http.StatusServiceUnavailable, "office_not_configured", "office engine is not configured")
	case service.IsOfficeServiceAuth(err):
		respondError(w, http.StatusServiceUnavailable, "office_unavailable", "office engine refused the service credential")
	case errors.Is(err, service.ErrOfficeJobInvalid):
		respondError(w, http.StatusBadRequest, "office_job_invalid", "operation, format or Idempotency-Key is not valid for an office job")
	case errors.Is(err, service.ErrOfficeJobNotCommittable):
		respondError(w, http.StatusConflict, "office_job_invalid", "office job output is not committable")
	default:
		h.mapServiceError(w, err)
	}
}

// officeCapability is GET /documents/{documentID}/office/capabilities.
func (h *handlers) officeCapability(w http.ResponseWriter, r *http.Request) {
	if h.Office == nil {
		respondError(w, http.StatusServiceUnavailable, "office_not_configured", "office engine is not configured")
		return
	}
	capability, err := h.Office.Capability(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"))
	if err != nil {
		h.mapOfficeError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, officeCapabilityDTO(chi.URLParam(r, "documentID"), capability))
}

// startOfficeJob is POST /documents/{documentID}/office/jobs: the operation
// allowlist (open, serialize, export, convert) with an Idempotency-Key. The
// base version and format come from the document, never from the caller; a
// format the caller names must match it.
func (h *handlers) startOfficeJob(w http.ResponseWriter, r *http.Request) {
	if h.Office == nil {
		respondError(w, http.StatusServiceUnavailable, "office_not_configured", "office engine is not configured")
		return
	}
	var in sdi.StartOfficeJobSDI
	if !decode(w, r, &in, maxDocumentJSONBody) {
		return
	}
	if !service.ValidOfficeOperation(in.Operation) {
		respondError(w, http.StatusBadRequest, "invalid_request", "operation must be open, serialize, export or convert")
		return
	}
	var base int64
	hasBase := in.BaseRevision != nil && strings.TrimSpace(*in.BaseRevision) != ""
	if hasBase {
		parsed, err := strconv.ParseInt(strings.TrimSpace(*in.BaseRevision), 10, 64)
		if err != nil || parsed < 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "base_revision must be a decimal string")
			return
		}
		base = parsed
	}
	row, err := h.Office.StartOfficeJobForDocument(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), service.OfficeJobRequest{
		Operation: in.Operation, Format: strings.TrimSpace(stringValue(in.Format)),
		BaseRevision: base, HasBaseRevision: hasBase, IdempotencyKey: r.Header.Get("Idempotency-Key"),
		DocumentModelRef: stringValue(in.ModelRef), Deadline: 0,
	})
	if err != nil {
		h.mapOfficeError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, officeJobDTO(row))
}

// getOfficeJob is GET /documents/{documentID}/office/jobs/{jobID}.
func (h *handlers) getOfficeJob(w http.ResponseWriter, r *http.Request) {
	if h.Office == nil {
		respondError(w, http.StatusServiceUnavailable, "office_not_configured", "office engine is not configured")
		return
	}
	row, err := h.Office.OfficeJob(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"), chi.URLParam(r, "jobID"))
	if err != nil {
		h.mapOfficeError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, officeJobDTO(row))
}

// cancelOfficeJob is POST /documents/{documentID}/office/jobs/{jobID}/cancel.
func (h *handlers) cancelOfficeJob(w http.ResponseWriter, r *http.Request) {
	if h.Office == nil {
		respondError(w, http.StatusServiceUnavailable, "office_not_configured", "office engine is not configured")
		return
	}
	row, err := h.Office.CancelOfficeJobForDocument(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"), chi.URLParam(r, "jobID"))
	if err != nil {
		h.mapOfficeError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, officeJobDTO(row))
}

// createBlankDocumentFile is POST
// /workspaces/{workspaceID}/documents/files/blank: a new document whose first
// version holds engine-produced bytes.
func (h *handlers) createBlankDocumentFile(w http.ResponseWriter, r *http.Request) {
	if h.Office == nil {
		respondError(w, http.StatusServiceUnavailable, "office_not_configured", "office engine is not configured")
		return
	}
	var in sdi.CreateBlankDocumentFileSDI
	if !decode(w, r, &in, maxDocumentJSONBody) {
		return
	}
	if !service.ValidOfficeFormat(in.Format) {
		respondError(w, http.StatusBadRequest, "invalid_request", "format must be one of docx, xlsx, pptx, pdf, md, html")
		return
	}
	res, err := h.Office.CreateBlankFile(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "workspaceID"), service.BlankFileInput{
		Format: in.Format, Title: in.Title, ParentID: stringValue(in.ParentID), IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	if err != nil {
		h.mapOfficeError(w, err)
		return
	}
	h.respondDocumentCreated(w, r, res.Document.ID)
}

// copyDocument is POST /documents/{documentID}/copies: an explicit copy
// (consent "copy") that keeps the source's ACL snapshot and provenance.
func (h *handlers) copyDocument(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.CopyDocumentSDI
	if !decode(w, r, &in, maxDocumentJSONBody) {
		return
	}
	res, err := h.Documents.CopyDocument(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), service.CopyDocumentInput{
		Consent: in.Consent, Title: stringValue(in.Title), ParentID: stringValue(in.ParentID),
		IdempotencyKey: r.Header.Get("Idempotency-Key"),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondDocumentCreated(w, r, res.Document.ID)
}

// respondDocumentCreated answers a create-style route with the SDO's fresh
// read, so a document created under a parent shows its full path.
func (h *handlers) respondDocumentCreated(w http.ResponseWriter, r *http.Request, documentID string) {
	view, err := h.Documents.GetDocument(r.Context(), service.Human(middleware.UserID(r.Context())), documentID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, sdo.DocumentSDO{Document: documentDTO(view)})
}

func officeCapabilityDTO(documentID string, in service.OfficeCapability) sdo.OfficeCapabilitySDO {
	out := sdo.OfficeCapabilitySDO{
		DocumentID: documentID, Format: string(in.Format), EngineVersion: in.EngineVersion,
		Operations: make([]sdo.OfficeCapabilityOperationDTO, 0, len(in.Operations)),
	}
	for _, row := range in.Operations {
		out.Operations = append(out.Operations, sdo.OfficeCapabilityOperationDTO{
			Operation: row.Operation, Runtime: row.Runtime, EvidenceLevel: row.EvidenceLevel,
			EngineBound: row.EngineBound, Supported: row.ProductSupported, Reason: row.Reason,
		})
	}
	return out
}

func officeJobDTO(row db.OfficeJob) sdo.OfficeJobSDO {
	name, engineVersion, contractVersion, protocolVersion := service.OfficeEngineIdentity()
	out := sdo.OfficeJobSDO{
		JobID: row.ID, DocumentID: row.DocumentID, Operation: row.Operation, Format: row.Format,
		State: row.State, BaseRevision: strconv.FormatInt(row.BaseRevision, 10), BaseVersionID: row.BaseVersionID,
		EngineName: name, EngineVersion: engineVersion,
		ContractVersion: contractVersion, ProtocolVersion: protocolVersion,
		DeadlineAt: row.DeadlineAt.Time.Format(time.RFC3339), CreatedAt: row.CreatedAt.Time.Format(time.RFC3339), UpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339),
	}
	if row.OutputFileID.Valid {
		out.OutputFileID = &row.OutputFileID.String
	}
	if row.OutputChecksum.Valid {
		out.OutputChecksum = &row.OutputChecksum.String
	}
	if row.OutputLength.Valid {
		length := row.OutputLength.Int64
		out.OutputLength = &length
	}
	if row.CommittedVersionID.Valid {
		out.CommittedVersionID = &row.CommittedVersionID.String
	}
	if row.ErrorCode.Valid || row.ErrorReason.Valid {
		detail := sdo.OfficeJobErrorDTO{Code: row.ErrorCode.String, Reason: row.ErrorReason.String}
		if kind, retryable, ok := service.OfficeErrorClassification(detail.Code); ok {
			detail.Kind = kind
			detail.Retryable = retryable
		}
		out.Error = &detail
	}
	return out
}
