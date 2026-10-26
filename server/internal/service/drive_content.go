package service

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/office"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Supported Google Drive and standard MIME types for v1 content reading (spec §8.3).
const (
	DriveMimeGoogleDoc    = "application/vnd.google-apps.document"
	DriveMimeGoogleSheet  = "application/vnd.google-apps.spreadsheet"
	DriveMimeGoogleSlides = "application/vnd.google-apps.presentation"
	DriveMimePDF          = "application/pdf"
	DriveMimePlainText    = "text/plain"
	DriveMimeMarkdown     = "text/markdown"
	DriveMimeXMarkdown    = "text/x-markdown"
	DriveMimeDOCX         = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	DriveMimeXLSX         = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	DriveMimePPTX         = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)

// Size and length limits for reading Drive content (spec §8.3, §8.3a).
const (
	DriveContentMaxChars       = 200_000
	DriveExportMaxBytes        = 10 << 20                    // 10 MiB Google export cap
	DrivePDFMaxBytes           = 10 << 20                    // 10 MiB PDF media attachment cap
	DrivePlainTextMaxBytes     = 1 << 20                     // 1 MiB text/plain and text/markdown cap
	DriveOfficeExtractMaxBytes = office.MaxExtractInputBytes // 20 MiB DOCX/XLSX/PPTX in-memory cap
)

// ErrDriveFileUnreadable is returned when an Office Open XML file on Drive
// cannot be extracted because it is password-protected, corrupted, or not an
// Office file (spec §8.3a -> HTTP 422).
var ErrDriveFileUnreadable = errors.New("drive_file_unreadable")

// driveFileAccessRow is the requester-scoped access and file snapshot returned
// by driveFileAccessLookup.
//
// Invariant (ADR 0047, spec §6.3, QĐ 4 & QĐ 5): Connection must be the
// requester's own connection from drive_file_access (Connection.UserID == requesterID),
// NEVER drive_files.connection_id of another user.
type driveFileAccessRow struct {
	DriveFileID    string
	OrganizationID string
	WorkspaceID    string
	ExternalFileID string
	Name           string
	MimeType       string
	Unlinked       bool
	HasAccessRow   bool
	AccessState    string // "granted" | "lost"
	Connection     db.DriveConnection
}

// driveFileAccessLookup is the narrow contract between drive_content.go (B3)
// and the drive_files / drive_file_access store (B4, UNI-2180).
// LookupFileForRead returns ErrDriveFileNotFound when driveFileID does not exist
// in workspaceID or is unlinked.
type driveFileAccessLookup interface {
	LookupFileForRead(ctx context.Context, requesterID, workspaceID, driveFileID string) (driveFileAccessRow, error)
}

// driveFileAccessLostRecorder is an optional hook implemented by the B4 store
// so that when Google reports notFound / insufficientFilePermissions / forbidden
// during ReadForAI, the caller's drive_file_access row is marked `lost` (spec §5.7).
type driveFileAccessLostRecorder interface {
	RecordFileAccessLost(ctx context.Context, requesterID, workspaceID, driveFileID, connectionID string) error
}

// driveOfficeExtractor is the narrow seam satisfied by *office.Client for
// extracting text from in-memory DOCX, XLSX, and PPTX bytes (spec §8.3a, B11).
type driveOfficeExtractor interface {
	ExtractText(ctx context.Context, req office.ExtractTextRequest) (office.ExtractTextResult, error)
}

// driveAuditTxWriter records an audit row in a short transaction when no
// *pgxpool.Pool is wired (unit tests). When nil, DriveContentService uses pool
// + q + auditRecorder.Record directly.
type driveAuditTxWriter func(ctx context.Context, entry audit.Entry) error

// DriveContentService implements DriveContentReader (drive_content_seam.go).
// It is the ONLY place in the server allowed to call driveExportFile or
// driveDownloadMedia (enforced by TestDriveContentOnlyFromDriveContent in
// server/internal/arch_test.go; ADR 0047).
type DriveContentService struct {
	pool      *pgxpool.Pool
	q         *db.Queries
	ws        *WorkspaceService
	lookup    driveFileAccessLookup
	lost      driveFileAccessLostRecorder
	tokens    DriveTokenSource
	api       *DriveAPIClient
	extractor driveOfficeExtractor
	log       *slog.Logger
	auditHook driveAuditTxWriter
}

// NewDriveContentService constructs the DriveContentService.
func NewDriveContentService(
	pool *pgxpool.Pool,
	q *db.Queries,
	ws *WorkspaceService,
	lookup driveFileAccessLookup,
	tokens DriveTokenSource,
	api *DriveAPIClient,
	extractor driveOfficeExtractor,
) *DriveContentService {
	if api == nil {
		api = NewDriveAPIClient()
	}
	var lost driveFileAccessLostRecorder
	if r, ok := lookup.(driveFileAccessLostRecorder); ok {
		lost = r
	}
	return &DriveContentService{
		pool:      pool,
		q:         q,
		ws:        ws,
		lookup:    lookup,
		lost:      lost,
		tokens:    tokens,
		api:       api,
		extractor: extractor,
		log:       slog.Default(),
	}
}

// SetLogger sets the structured logger (never logs email addresses, file names,
// tokens, or document content; spec §10).
func (s *DriveContentService) SetLogger(log *slog.Logger) {
	if s != nil && log != nil {
		s.log = log
	}
}

// SetLostRecorder wires an explicit driveFileAccessLostRecorder for §5.7 access-lost updates.
func (s *DriveContentService) SetLostRecorder(r driveFileAccessLostRecorder) {
	if s != nil {
		s.lost = r
	}
}

// ReadForAI reads the content of driveFileID in workspaceID on behalf of
// requesterID for a model call (task_proposal or ask_uni; spec §8.3, §8.3a, §9).
//
// Invariants (ADR 0047):
//  1. The file must belong to workspaceID and be active (else ErrDriveFileNotFound).
//  2. requesterID must have a `granted` drive_file_access row on an active
//     connection owned by requesterID in the workspace's organization (else
//     ErrDriveAccessRequired).
//  3. Content is fetched ONLY with requesterID's own connection from
//     drive_file_access — never with drive_files.connection_id of another user.
//  4. Text is cut at 200,000 Unicode code points (Truncated = true).
//  5. An audit row `drive_file.read` (resource `drive_file`, metadata `purpose`,
//     `google_email`, `google_sub`) is recorded in its own short transaction.
//     Document content is never written to logs or audit.
func (s *DriveContentService) ReadForAI(
	ctx context.Context,
	requesterID, workspaceID, driveFileID string,
	purpose DriveContentPurpose,
) (DriveContent, error) {
	requesterID = strings.TrimSpace(requesterID)
	workspaceID = strings.TrimSpace(workspaceID)
	driveFileID = strings.TrimSpace(driveFileID)
	if requesterID == "" || workspaceID == "" || driveFileID == "" {
		return DriveContent{}, ErrDriveFileNotFound
	}
	if s == nil || s.lookup == nil {
		return DriveContent{}, ErrDriveUnavailable
	}

	if s.ws != nil {
		if err := s.ws.requireActorMember(ctx, workspaceID, Human(requesterID)); err != nil {
			if errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) {
				return DriveContent{}, ErrDriveFileNotFound
			}
			return DriveContent{}, err
		}
	}

	row, err := s.lookup.LookupFileForRead(ctx, requesterID, workspaceID, driveFileID)
	if err != nil {
		if errors.Is(err, ErrDriveFileNotFound) || errors.Is(err, ErrNotFound) || errors.Is(err, ErrForbidden) {
			return DriveContent{}, ErrDriveFileNotFound
		}
		return DriveContent{}, err
	}
	if row.Unlinked || row.WorkspaceID != workspaceID || row.DriveFileID == "" || row.ExternalFileID == "" {
		return DriveContent{}, ErrDriveFileNotFound
	}

	partial := DriveContent{
		DriveFileID: row.DriveFileID,
		Name:        row.Name,
		MimeType:    row.MimeType,
	}

	// Enforce requester-owned granted access on an active connection (spec §6.3, §8.3, ADR 0047).
	if !row.HasAccessRow || row.AccessState != "granted" {
		return partial, ErrDriveAccessRequired
	}
	conn := row.Connection
	if conn.ID == "" ||
		conn.UserID != requesterID ||
		(row.OrganizationID != "" && conn.OrganizationID != row.OrganizationID) ||
		conn.DisconnectedAt.Valid ||
		conn.AuthFailedAt.Valid {
		return partial, ErrDriveAccessRequired
	}

	if s.tokens == nil || s.api == nil {
		return partial, ErrDriveUnavailable
	}

	// Classify how this MIME type is read before making any network call to Google
	// so unsupported formats fail immediately without downloading bytes.
	kind, officeFmt, supported := classifyDriveContentMime(row.MimeType)
	if !supported {
		return partial, ErrDriveFormatUnsupported
	}

	out := DriveContent{
		DriveFileID: row.DriveFileID,
		Name:        row.Name,
		MimeType:    row.MimeType,
		GoogleEmail: conn.GoogleEmail,
	}

	switch kind {
	case driveReadKindGoogleDoc:
		raw, err := s.exportGoogleDoc(ctx, conn, row.ExternalFileID)
		if err != nil {
			s.maybeRecordAccessLost(ctx, requesterID, workspaceID, row.DriveFileID, conn.ID, err)
			return partial, mapDriveContentCallError(err)
		}
		out.Text, out.Truncated = truncateDriveText(string(raw))

	case driveReadKindGoogleSheet:
		raw, err := s.callDriveBytes(ctx, conn, func(token string) ([]byte, error) {
			return s.api.driveExportFile(ctx, token, row.ExternalFileID, "text/csv", DriveExportMaxBytes)
		})
		if err != nil {
			s.maybeRecordAccessLost(ctx, requesterID, workspaceID, row.DriveFileID, conn.ID, err)
			return partial, mapDriveContentCallError(err)
		}
		out.Text, out.Truncated = truncateDriveText(string(raw))

	case driveReadKindGoogleSlides:
		raw, err := s.callDriveBytes(ctx, conn, func(token string) ([]byte, error) {
			return s.api.driveExportFile(ctx, token, row.ExternalFileID, "text/plain", DriveExportMaxBytes)
		})
		if err != nil {
			s.maybeRecordAccessLost(ctx, requesterID, workspaceID, row.DriveFileID, conn.ID, err)
			return partial, mapDriveContentCallError(err)
		}
		out.Text, out.Truncated = truncateDriveText(string(raw))

	case driveReadKindPlainText:
		raw, err := s.callDriveBytes(ctx, conn, func(token string) ([]byte, error) {
			return s.api.driveDownloadMedia(ctx, token, row.ExternalFileID, DrivePlainTextMaxBytes)
		})
		if err != nil {
			s.maybeRecordAccessLost(ctx, requesterID, workspaceID, row.DriveFileID, conn.ID, err)
			return partial, mapDriveContentCallError(err)
		}
		out.Text, out.Truncated = truncateDriveText(string(raw))

	case driveReadKindPDF:
		raw, err := s.callDriveBytes(ctx, conn, func(token string) ([]byte, error) {
			return s.api.driveDownloadMedia(ctx, token, row.ExternalFileID, DrivePDFMaxBytes)
		})
		if err != nil {
			s.maybeRecordAccessLost(ctx, requesterID, workspaceID, row.DriveFileID, conn.ID, err)
			return partial, mapDriveContentCallError(err)
		}
		out.Attachments = []provider.Part{{
			MIME: DriveMimePDF,
			Data: raw,
		}}

	case driveReadKindOfficeExtract:
		if s.extractor == nil {
			return partial, ErrDriveExtractUnavailable
		}
		raw, err := s.callDriveBytes(ctx, conn, func(token string) ([]byte, error) {
			return s.api.driveDownloadMedia(ctx, token, row.ExternalFileID, DriveOfficeExtractMaxBytes)
		})
		if err != nil {
			s.maybeRecordAccessLost(ctx, requesterID, workspaceID, row.DriveFileID, conn.ID, err)
			return partial, mapDriveContentCallError(err)
		}
		extRes, err := s.extractor.ExtractText(ctx, office.ExtractTextRequest{
			Format:         officeFmt,
			Content:        raw,
			ActorID:        requesterID,
			OrganizationID: row.OrganizationID,
			WorkspaceID:    workspaceID,
			DriveFileID:    row.DriveFileID,
		})
		if err != nil {
			return partial, mapOfficeExtractError(err)
		}
		text, cutHere := truncateDriveText(extRes.Text)
		out.Text = text
		out.Truncated = extRes.Truncated || cutHere
	}

	if err := s.recordReadAudit(ctx, row.OrganizationID, workspaceID, requesterID, row.DriveFileID, purpose, conn); err != nil {
		return partial, err
	}
	return out, nil
}

type driveReadKind int

const (
	driveReadKindUnsupported driveReadKind = iota
	driveReadKindGoogleDoc
	driveReadKindGoogleSheet
	driveReadKindGoogleSlides
	driveReadKindPlainText
	driveReadKindPDF
	driveReadKindOfficeExtract
)

func classifyDriveContentMime(mimeType string) (driveReadKind, office.ExtractFormat, bool) {
	base := strings.ToLower(strings.TrimSpace(mimeType))
	if semi := strings.IndexByte(base, ';'); semi >= 0 {
		base = strings.TrimSpace(base[:semi])
	}
	switch base {
	case DriveMimeGoogleDoc:
		return driveReadKindGoogleDoc, "", true
	case DriveMimeGoogleSheet:
		return driveReadKindGoogleSheet, "", true
	case DriveMimeGoogleSlides:
		return driveReadKindGoogleSlides, "", true
	case DriveMimePlainText, DriveMimeMarkdown, DriveMimeXMarkdown:
		return driveReadKindPlainText, "", true
	case DriveMimePDF:
		return driveReadKindPDF, "", true
	case DriveMimeDOCX:
		return driveReadKindOfficeExtract, office.ExtractFormatDOCX, true
	case DriveMimeXLSX:
		return driveReadKindOfficeExtract, office.ExtractFormatXLSX, true
	case DriveMimePPTX:
		return driveReadKindOfficeExtract, office.ExtractFormatPPTX, true
	default:
		return driveReadKindUnsupported, "", false
	}
}

// exportGoogleDoc exports a Google Doc as text/markdown, falling back to
// text/plain when the markdown export is unsupported for that file (spec §8.3:
// "Google Docs: files.export text/markdown (lùi về text/plain)").
func (s *DriveContentService) exportGoogleDoc(ctx context.Context, conn db.DriveConnection, externalFileID string) ([]byte, error) {
	raw, err := s.callDriveBytes(ctx, conn, func(token string) ([]byte, error) {
		return s.api.driveExportFile(ctx, token, externalFileID, DriveMimeMarkdown, DriveExportMaxBytes)
	})
	if err == nil {
		return raw, nil
	}
	var apiErr *DriveAPIError
	if errors.As(err, &apiErr) && apiErr.HTTPStatus == http.StatusBadRequest {
		return s.callDriveBytes(ctx, conn, func(token string) ([]byte, error) {
			return s.api.driveExportFile(ctx, token, externalFileID, DriveMimePlainText, DriveExportMaxBytes)
		})
	}
	return nil, err
}

func (s *DriveContentService) callDriveBytes(ctx context.Context, conn db.DriveConnection, fn func(accessToken string) ([]byte, error)) ([]byte, error) {
	var data []byte
	err := s.api.withConnectionToken(ctx, s.tokens, conn, func(accessToken string) error {
		var callErr error
		data, callErr = fn(accessToken)
		return callErr
	})
	return data, err
}

func (s *DriveContentService) maybeRecordAccessLost(ctx context.Context, requesterID, workspaceID, driveFileID, connectionID string, err error) {
	if s.lost == nil {
		return
	}
	var apiErr *DriveAPIError
	if !errors.As(err, &apiErr) || !apiErr.MarkAccessLost {
		return
	}
	if rerr := s.lost.RecordFileAccessLost(context.WithoutCancel(ctx), requesterID, workspaceID, driveFileID, connectionID); rerr != nil {
		s.log.Warn("drive record file access lost failed", "drive_file_id", driveFileID, "err", rerr)
	}
}

// truncateDriveText cuts text at 200,000 Unicode code points (spec §8.3).
func truncateDriveText(text string) (string, bool) {
	if utf8.RuneCountInString(text) <= DriveContentMaxChars {
		return text, false
	}
	runes := []rune(text)
	return string(runes[:DriveContentMaxChars]), true
}

func mapDriveContentCallError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrDriveFileTooLarge) {
		return CodedError{
			Status: http.StatusUnprocessableEntity,
			Code:   "drive_file_too_large",
			Msg:    "Tệp Google Drive vượt quá giới hạn dung lượng đọc của UNI.",
			Err:    ErrDriveFormatUnsupported,
		}
	}
	var apiErr *DriveAPIError
	if errors.As(err, &apiErr) {
		switch apiErr.Class {
		case DriveErrorClassGrantRequired:
			return ErrDriveGrantRequired
		case DriveErrorClassBlockedByAdmin:
			return CodedError{
				Status: http.StatusForbidden,
				Code:   "blocked_by_workspace_admin",
				Msg:    "Quản trị viên Google Workspace của tổ chức bạn chưa cho phép UniWork truy cập Google Drive.",
				Err:    ErrDriveFileNotAccessible,
			}
		case DriveErrorClassFileNotAccessible:
			return ErrDriveFileNotAccessible
		case DriveErrorClassAuthFailed:
			return ErrDriveAccessRequired
		default:
			return ErrDriveUnavailable
		}
	}
	if errors.Is(err, ErrDriveReauthRequired) {
		return ErrDriveAccessRequired
	}
	return ErrDriveUnavailable
}

func mapOfficeExtractError(err error) error {
	var ue *office.ExtractUnreadableError
	if errors.As(err, &ue) {
		msg := "Tệp Office bị hỏng hoặc không đọc được."
		switch ue.Reason {
		case string(office.OpenPasswordRequired):
			msg = "Tệp đặt mật khẩu nên UNI không đọc được."
		case string(office.OpenNotOfficeFile):
			msg = "UNI chưa đọc được định dạng này."
		}
		return CodedError{
			Status: http.StatusUnprocessableEntity,
			Code:   ue.Reason,
			Msg:    msg,
			Fields: map[string]any{"reason": ue.Reason},
			Err:    errors.Join(ErrDriveFileUnreadable, ErrDriveFormatUnsupported),
		}
	}
	if errors.Is(err, office.ErrExtractUnavailable) {
		return ErrDriveExtractUnavailable
	}
	return ErrDriveExtractUnavailable
}

func (s *DriveContentService) recordReadAudit(
	ctx context.Context,
	orgID, workspaceID, requesterID, driveFileID string,
	purpose DriveContentPurpose,
	conn db.DriveConnection,
) error {
	entry := audit.Entry{
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		Actor:          audit.User(requesterID),
		Action:         audit.ActionDriveFileRead,
		ResourceType:   "drive_file",
		ResourceID:     driveFileID,
		Metadata: map[string]any{
			"purpose":      string(purpose),
			"google_email": conn.GoogleEmail,
			"google_sub":   conn.GoogleSub,
		},
	}
	if s.auditHook != nil {
		return s.auditHook(ctx, entry)
	}
	if s.pool == nil || s.q == nil {
		return nil
	}
	txCtx := context.WithoutCancel(ctx)
	tx, err := s.pool.Begin(txCtx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(txCtx) }()
	qtx := s.q.WithTx(tx)
	if err := auditRecorder.Record(txCtx, qtx, entry); err != nil {
		return err
	}
	return tx.Commit(txCtx)
}
