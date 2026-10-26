package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// FakeGoogleDriveServer is an in-process httptest server that emulates Google
// Drive v3 files.get, files.export and alt=media endpoints for unit tests (spec §13).
type FakeGoogleDriveServer struct {
	Server *httptest.Server
	Client *DriveAPIClient

	mu         sync.Mutex
	files      map[string]FakeGoogleDriveFile
	calls      []FakeGoogleDriveCall
	overrideFn func(w http.ResponseWriter, r *http.Request, call FakeGoogleDriveCall) bool
}

// FakeGoogleDriveFile is a scripted file on FakeGoogleDriveServer.
type FakeGoogleDriveFile struct {
	Metadata      googleDriveFileJSON
	MediaByToken  map[string][]byte
	DefaultMedia  []byte
	ExportByMime  map[string][]byte
	ErrorByToken  map[string]FakeGoogleDriveErrorResponse
	DefaultError  *FakeGoogleDriveErrorResponse
	ExportErrMime map[string]FakeGoogleDriveErrorResponse
}

// FakeGoogleDriveErrorResponse scripts a non-2xx Google Drive API error.
type FakeGoogleDriveErrorResponse struct {
	Status int
	Reason string
	Raw    string
}

// FakeGoogleDriveCall records one request received by FakeGoogleDriveServer.
type FakeGoogleDriveCall struct {
	Method     string
	Path       string
	Query      url.Values
	Token      string
	FileID     string
	Op         string // "get" | "export" | "media"
	ExportMime string
}

// NewFakeGoogleDriveServer starts an httptest.Server backing a DriveAPIClient.
func NewFakeGoogleDriveServer(closeFn func(func())) *FakeGoogleDriveServer {
	s := &FakeGoogleDriveServer{
		files: make(map[string]FakeGoogleDriveFile),
	}
	s.Server = httptest.NewServer(http.HandlerFunc(s.handle))
	if closeFn != nil {
		closeFn(s.Server.Close)
	}
	s.Client = NewDriveAPIClientForTest(s.Server.URL+"/drive/v3", s.Server.Client().Transport)
	return s
}

// SetFile scripts a file by externalFileID.
func (s *FakeGoogleDriveServer) SetFile(externalFileID string, file FakeGoogleDriveFile) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if file.Metadata.ID == "" {
		file.Metadata.ID = externalFileID
	}
	s.files[externalFileID] = file
}

// SetOverride installs a custom handler hook before normal file lookup.
func (s *FakeGoogleDriveServer) SetOverride(fn func(w http.ResponseWriter, r *http.Request, call FakeGoogleDriveCall) bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.overrideFn = fn
}

// Calls returns a copy of all recorded Drive API calls.
func (s *FakeGoogleDriveServer) Calls() []FakeGoogleDriveCall {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]FakeGoogleDriveCall, len(s.calls))
	copy(out, s.calls)
	return out
}

func (s *FakeGoogleDriveServer) handle(w http.ResponseWriter, r *http.Request) {
	authHeader := r.Header.Get("Authorization")
	token := strings.TrimPrefix(authHeader, "Bearer ")
	rel := strings.TrimPrefix(r.URL.Path, "/drive/v3/files/")
	fileID := rel
	op := "get"
	exportMime := ""
	if id, ok := strings.CutSuffix(rel, "/export"); ok {
		fileID = id
		op = "export"
		exportMime = r.URL.Query().Get("mimeType")
	} else if r.URL.Query().Get("alt") == "media" {
		op = "media"
	}
	fileID, _ = url.PathUnescape(fileID)

	call := FakeGoogleDriveCall{
		Method:     r.Method,
		Path:       r.URL.Path,
		Query:      r.URL.Query(),
		Token:      token,
		FileID:     fileID,
		Op:         op,
		ExportMime: exportMime,
	}

	s.mu.Lock()
	s.calls = append(s.calls, call)
	override := s.overrideFn
	f, exists := s.files[fileID]
	s.mu.Unlock()

	if override != nil && override(w, r, call) {
		return
	}
	if !exists {
		writeGoogleDriveError(w, http.StatusNotFound, "notFound", "")
		return
	}
	if errResp, ok := f.ErrorByToken[token]; ok {
		writeGoogleDriveError(w, errResp.Status, errResp.Reason, errResp.Raw)
		return
	}
	if f.DefaultError != nil {
		writeGoogleDriveError(w, f.DefaultError.Status, f.DefaultError.Reason, f.DefaultError.Raw)
		return
	}

	switch op {
	case "export":
		if errResp, ok := f.ExportErrMime[exportMime]; ok {
			writeGoogleDriveError(w, errResp.Status, errResp.Reason, errResp.Raw)
			return
		}
		data, ok := f.ExportByMime[exportMime]
		if !ok {
			writeGoogleDriveError(w, http.StatusBadRequest, "badRequest", "")
			return
		}
		w.Header().Set("Content-Type", exportMime)
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	case "media":
		data, ok := f.MediaByToken[token]
		if !ok {
			data = f.DefaultMedia
		}
		w.Header().Set("Content-Type", f.Metadata.MimeType)
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)
	default:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(f.Metadata)
	}
}

func writeGoogleDriveError(w http.ResponseWriter, status int, reason, raw string) {
	if status == 0 {
		status = http.StatusInternalServerError
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if raw != "" {
		_, _ = w.Write([]byte(raw))
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{
			"code":    status,
			"message": reason,
			"errors": []map[string]any{
				{"domain": "global", "reason": reason, "message": reason},
			},
		},
	})
}

type fakeDriveFileAccessLookup struct {
	mu          sync.Mutex
	rows        map[string]driveFileAccessRow
	err         error
	lookupCalls int
	lostRecs    []string
	metaRecs    []DriveFileMetadata
}

func (f *fakeDriveFileAccessLookup) LookupFileForRead(_ context.Context, requesterID, workspaceID, driveFileID string) (driveFileAccessRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lookupCalls++
	if f.err != nil {
		return driveFileAccessRow{}, f.err
	}
	if row, ok := f.rows[requesterID+"|"+workspaceID+"|"+driveFileID]; ok {
		return row, nil
	}
	if row, ok := f.rows["*|"+workspaceID+"|"+driveFileID]; ok {
		return row, nil
	}
	return driveFileAccessRow{}, ErrDriveFileNotFound
}

func (f *fakeDriveFileAccessLookup) RecordFileAccessLost(_ context.Context, requesterID, workspaceID, driveFileID, connectionID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lostRecs = append(f.lostRecs, requesterID+"|"+workspaceID+"|"+driveFileID+"|"+connectionID)
	return nil
}

func (f *fakeDriveFileAccessLookup) RecordFileMetadataRefresh(_ context.Context, _, _ string, meta DriveFileMetadata) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.metaRecs = append(f.metaRecs, meta)
	return nil
}

func (f *fakeDriveFileAccessLookup) lostSnapshots() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, len(f.lostRecs))
	copy(out, f.lostRecs)
	return out
}

func (f *fakeDriveFileAccessLookup) refreshedMetadata() []DriveFileMetadata {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]DriveFileMetadata, len(f.metaRecs))
	copy(out, f.metaRecs)
	return out
}

type fakeDriveTokenSource struct {
	mu             sync.Mutex
	tokensByConn   map[string]string
	refreshToken   map[string]string
	errByConn      map[string]error
	refreshErr     map[string]error
	accessCalls    []string
	refreshCalls   []string
	rejectedTokens []string
}

func (f *fakeDriveTokenSource) AccessToken(_ context.Context, conn db.DriveConnection) (string, time.Time, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.accessCalls = append(f.accessCalls, conn.ID)
	if err, ok := f.errByConn[conn.ID]; ok && err != nil {
		return "", time.Time{}, err
	}
	tok := f.tokensByConn[conn.ID]
	if tok == "" {
		tok = "tok-" + conn.ID
	}
	return tok, time.Now().UTC().Add(time.Hour), nil
}

func (f *fakeDriveTokenSource) ForceRefreshAccessToken(_ context.Context, conn db.DriveConnection, rejectedToken string) (string, time.Time, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.refreshCalls = append(f.refreshCalls, conn.ID)
	f.rejectedTokens = append(f.rejectedTokens, rejectedToken)
	if err, ok := f.refreshErr[conn.ID]; ok && err != nil {
		return "", time.Time{}, err
	}
	tok := f.refreshToken[conn.ID]
	if tok == "" {
		tok = "tok-refreshed-" + conn.ID
	}
	if f.tokensByConn != nil {
		f.tokensByConn[conn.ID] = tok
	}
	return tok, time.Now().UTC().Add(time.Hour), nil
}

type driveUnitRowFunc func(dest ...any) error

func (fn driveUnitRowFunc) Scan(dest ...any) error { return fn(dest...) }

// memDriveUnitDBTX is an in-memory db.DBTX used by DB-free unit tests to run
// the real WorkspaceService.requireActorMember gate and the real
// DriveConnectionService token refresh path without a live Postgres connection.
type memDriveUnitDBTX struct {
	mu         sync.Mutex
	admitted   map[string]string             // "wsID|userID" -> orgID
	workspaces map[string]db.Workspace       // wsID -> workspace
	files      map[string]db.DriveFile       // fileID -> row
	access     map[string]db.DriveFileAccess // "fileID|userID" -> row
	conns      map[string]db.DriveConnection // connID -> row
}

func (m *memDriveUnitDBTX) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if strings.Contains(sql, "-- name: UpdateDriveConnectionTokens ") {
		accessEnc, _ := args[0].(string)
		accessExp, _ := args[1].(pgtype.Timestamptz)
		refreshEnc, _ := args[2].(string)
		id, _ := args[3].(string)
		orgID, _ := args[4].(string)
		credVer, _ := args[5].(int64)
		prevExp, _ := args[6].(pgtype.Timestamptz)
		row, ok := m.conns[id]
		if !ok || row.OrganizationID != orgID || row.CredentialVersion != credVer ||
			!sameDriveExpiry(row.AccessExpiresAt, prevExp) || row.DisconnectedAt.Valid || row.AuthFailedAt.Valid {
			return pgconn.NewCommandTag("UPDATE 0"), nil
		}
		row.AccessTokenEnc = accessEnc
		row.AccessExpiresAt = accessExp
		if refreshEnc != "" {
			row.RefreshTokenEnc = refreshEnc
		}
		m.conns[id] = row
		return pgconn.NewCommandTag("UPDATE 1"), nil
	}
	return pgconn.NewCommandTag(""), errors.New("unexpected Exec in memDriveUnitDBTX: " + sql)
}

func (m *memDriveUnitDBTX) Query(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected Query in memDriveUnitDBTX: " + sql)
}

func (m *memDriveUnitDBTX) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	m.mu.Lock()
	defer m.mu.Unlock()
	switch {
	case strings.Contains(sql, "-- name: GetWorkspaceAccess "):
		wsID, _ := args[0].(string)
		userID, _ := args[1].(string)
		orgID, ok := m.admitted[wsID+"|"+userID]
		if !ok {
			return driveUnitRowFunc(func(...any) error { return pgx.ErrNoRows })
		}
		return driveUnitRowFunc(func(dest ...any) error {
			*(dest[0].(*string)) = "member"
			*(dest[1].(*string)) = orgID
			*(dest[2].(*string)) = OrganizationActive
			*(dest[3].(*string)) = "member"
			*(dest[4].(*pgtype.Timestamptz)) = pgtype.Timestamptz{}
			*(dest[5].(*bool)) = false
			return nil
		})
	case strings.Contains(sql, "-- name: GetWorkspaceByID "):
		wsID, _ := args[0].(string)
		row, ok := m.workspaces[wsID]
		if !ok {
			return driveUnitRowFunc(func(...any) error { return pgx.ErrNoRows })
		}
		return driveUnitRowFunc(func(dest ...any) error {
			*(dest[0].(*string)) = row.ID
			*(dest[1].(*string)) = row.Slug
			*(dest[2].(*string)) = row.Name
			*(dest[3].(*string)) = row.CreatedBy
			*(dest[4].(*pgtype.Timestamptz)) = row.CreatedAt
			*(dest[5].(*pgtype.Timestamptz)) = row.UpdatedAt
			*(dest[6].(*string)) = row.OrganizationID
			*(dest[7].(*pgtype.Text)) = row.MatrixRoomID
			*(dest[8].(*string)) = row.TaskPrefix
			*(dest[9].(*int64)) = row.TaskCounter
			*(dest[10].(*string)) = row.Description
			*(dest[11].(*pgtype.Text)) = row.IconEmoji
			*(dest[12].(*pgtype.Text)) = row.IconFileID
			return nil
		})
	case strings.Contains(sql, "-- name: GetActiveDriveFileByID "):
		id, _ := args[0].(string)
		orgID, _ := args[1].(string)
		wsID, _ := args[2].(string)
		row, ok := m.files[id]
		if !ok || row.OrganizationID != orgID || row.WorkspaceID != wsID || row.UnlinkedAt.Valid {
			return driveUnitRowFunc(func(...any) error { return pgx.ErrNoRows })
		}
		return scanMemDriveFile(row)
	case strings.Contains(sql, "-- name: UpdateDriveFileMetadata "):
		id, _ := args[11].(string)
		orgID, _ := args[12].(string)
		wsID, _ := args[13].(string)
		row, ok := m.files[id]
		if !ok || row.OrganizationID != orgID || row.WorkspaceID != wsID || row.UnlinkedAt.Valid {
			return driveUnitRowFunc(func(...any) error { return pgx.ErrNoRows })
		}
		row.DriveID, _ = args[0].(pgtype.Text)
		row.Name, _ = args[1].(string)
		row.MimeType, _ = args[2].(string)
		row.IconKind, _ = args[3].(string)
		row.WebViewLink, _ = args[4].(string)
		row.OwnerDisplay, _ = args[5].(string)
		row.DriveModifiedAt, _ = args[6].(pgtype.Timestamptz)
		row.DriveModifiedByDisplay, _ = args[7].(string)
		row.SharingState, _ = args[8].(string)
		row.SharedUserCount, _ = args[9].(pgtype.Int4)
		row.MetadataRefreshedAt, _ = args[10].(pgtype.Timestamptz)
		m.files[id] = row
		return scanMemDriveFile(row)
	case strings.Contains(sql, "-- name: GetDriveFileAccessByUser "):
		orgID, _ := args[0].(string)
		wsID, _ := args[1].(string)
		fileID, _ := args[2].(string)
		userID, _ := args[3].(string)
		row, ok := m.access[fileID+"|"+userID]
		if !ok || row.OrganizationID != orgID || row.WorkspaceID != wsID {
			return driveUnitRowFunc(func(...any) error { return pgx.ErrNoRows })
		}
		return scanMemDriveFileAccess(row)
	case strings.Contains(sql, "-- name: TouchDriveFileAccessCheckedAt "):
		orgID, _ := args[0].(string)
		wsID, _ := args[1].(string)
		fileID, _ := args[2].(string)
		userID, _ := args[3].(string)
		connID, _ := args[4].(string)
		row, ok := m.access[fileID+"|"+userID]
		if !ok || row.OrganizationID != orgID || row.WorkspaceID != wsID || row.ConnectionID != connID {
			return driveUnitRowFunc(func(...any) error { return pgx.ErrNoRows })
		}
		row.State = "granted"
		m.access[fileID+"|"+userID] = row
		return scanMemDriveFileAccess(row)
	case strings.Contains(sql, "-- name: GetDriveConnection ") || strings.Contains(sql, "-- name: GetDriveConnectionAnyState "):
		id, _ := args[0].(string)
		orgID, _ := args[1].(string)
		userID, _ := args[2].(string)
		row, ok := m.conns[id]
		allowDisc := strings.Contains(sql, "-- name: GetDriveConnectionAnyState ")
		if !ok || row.OrganizationID != orgID || row.UserID != userID || (!allowDisc && row.DisconnectedAt.Valid) {
			return driveUnitRowFunc(func(...any) error { return pgx.ErrNoRows })
		}
		return driveUnitRowFunc(func(dest ...any) error {
			*(dest[0].(*string)) = row.ID
			*(dest[1].(*string)) = row.OrganizationID
			*(dest[2].(*string)) = row.UserID
			*(dest[3].(*string)) = row.Provider
			*(dest[4].(*string)) = row.GoogleSub
			*(dest[5].(*string)) = row.GoogleEmail
			*(dest[6].(*string)) = row.RefreshTokenEnc
			*(dest[7].(*string)) = row.AccessTokenEnc
			*(dest[8].(*pgtype.Timestamptz)) = row.AccessExpiresAt
			*(dest[9].(*int64)) = row.CredentialVersion
			*(dest[10].(*string)) = row.Scopes
			*(dest[11].(*pgtype.Timestamptz)) = row.AuthFailedAt
			*(dest[12].(*string)) = row.AuthFailedReason
			*(dest[13].(*pgtype.Timestamptz)) = row.CreatedAt
			*(dest[14].(*pgtype.Timestamptz)) = row.UpdatedAt
			*(dest[15].(*pgtype.Timestamptz)) = row.DisconnectedAt
			return nil
		})
	default:
		return driveUnitRowFunc(func(...any) error { return errors.New("unexpected QueryRow in memDriveUnitDBTX: " + sql) })
	}
}

func scanMemDriveFile(row db.DriveFile) pgx.Row {
	return driveUnitRowFunc(func(dest ...any) error {
		*(dest[0].(*string)) = row.ID
		*(dest[1].(*string)) = row.OrganizationID
		*(dest[2].(*string)) = row.WorkspaceID
		*(dest[3].(*string)) = row.ExternalFileID
		*(dest[4].(*pgtype.Text)) = row.DriveID
		*(dest[5].(*string)) = row.ConnectionID
		*(dest[6].(*string)) = row.BoundBy
		*(dest[7].(*string)) = row.CreatedBy
		*(dest[8].(*string)) = row.CreatedByKind
		*(dest[9].(*string)) = row.Name
		*(dest[10].(*string)) = row.MimeType
		*(dest[11].(*string)) = row.IconKind
		*(dest[12].(*string)) = row.WebViewLink
		*(dest[13].(*string)) = row.OwnerDisplay
		*(dest[14].(*pgtype.Timestamptz)) = row.DriveModifiedAt
		*(dest[15].(*string)) = row.DriveModifiedByDisplay
		*(dest[16].(*string)) = row.SharingState
		*(dest[17].(*pgtype.Int4)) = row.SharedUserCount
		*(dest[18].(*pgtype.Timestamptz)) = row.MetadataRefreshedAt
		*(dest[19].(*pgtype.Timestamptz)) = row.AccessLostAt
		*(dest[20].(*pgtype.Timestamptz)) = row.CreatedAt
		*(dest[21].(*pgtype.Timestamptz)) = row.UpdatedAt
		*(dest[22].(*pgtype.Timestamptz)) = row.UnlinkedAt
		*(dest[23].(*pgtype.Text)) = row.UnlinkedBy
		*(dest[24].(*pgtype.Text)) = row.UnlinkedByKind
		return nil
	})
}

func scanMemDriveFileAccess(row db.DriveFileAccess) pgx.Row {
	return driveUnitRowFunc(func(dest ...any) error {
		*(dest[0].(*string)) = row.ID
		*(dest[1].(*string)) = row.OrganizationID
		*(dest[2].(*string)) = row.WorkspaceID
		*(dest[3].(*string)) = row.DriveFileID
		*(dest[4].(*string)) = row.UserID
		*(dest[5].(*string)) = row.ConnectionID
		*(dest[6].(*string)) = row.State
		*(dest[7].(*pgtype.Timestamptz)) = row.GrantedAt
		*(dest[8].(*pgtype.Timestamptz)) = row.CheckedAt
		return nil
	})
}

func newTestDriveWorkspaceService(admitted map[string]string) *WorkspaceService {
	return &WorkspaceService{
		q: db.New(&memDriveUnitDBTX{admitted: admitted}),
	}
}

type fakeDriveOfficeExtractor struct {
	mu    sync.Mutex
	calls []office.ExtractTextRequest
	res   office.ExtractTextResult
	err   error
	fn    func(ctx context.Context, req office.ExtractTextRequest) (office.ExtractTextResult, error)
}

func (f *fakeDriveOfficeExtractor) ExtractText(ctx context.Context, req office.ExtractTextRequest) (office.ExtractTextResult, error) {
	f.mu.Lock()
	f.calls = append(f.calls, req)
	fn := f.fn
	res := f.res
	err := f.err
	f.mu.Unlock()
	if fn != nil {
		return fn(ctx, req)
	}
	return res, err
}

func activeTestDriveConnection(id, orgID, userID, sub, email string) db.DriveConnection {
	return db.DriveConnection{
		ID:              id,
		OrganizationID:  orgID,
		UserID:          userID,
		Provider:        "google",
		GoogleSub:       sub,
		GoogleEmail:     email,
		RefreshTokenEnc: "enc-r",
		AccessTokenEnc:  "enc-a",
		AccessExpiresAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(time.Hour), Valid: true},
		Scopes:          "openid email " + DriveGoogleScope,
	}
}

// TestDriveAPIFilesGetMetadataAndRedirectGuard verifies that FilesGet parses
// metadata fields (§6.2, §7.2), normalizes sharing_state across My Drive and
// Shared Drives, treats trashed files as not accessible (MarkAccessLost=true),
// configures a 15-second client timeout, and refuses redirects outside Google
// hosts while stripping Authorization on cross-host Google redirects.
func TestDriveAPIFilesGetMetadataAndRedirectGuard(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	prodClient := NewDriveAPIClient()
	if prodClient.httpClient.Timeout != 15*time.Second {
		t.Fatalf("NewDriveAPIClient timeout = %v, want 15s", prodClient.httpClient.Timeout)
	}

	gSrv := NewFakeGoogleDriveServer(t.Cleanup)
	sharedTrue := true
	sharedFalse := false
	gSrv.SetFile("file-my-drive", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:          "file-my-drive",
			Name:        "Kế hoạch Q4",
			MimeType:    DriveMimeGoogleDoc,
			WebViewLink: "https://docs.google.com/document/d/file-my-drive/edit",
			Owners: []struct {
				DisplayName string `json:"displayName"`
			}{{DisplayName: "Lan"}},
			LastModifyingUser: &struct {
				DisplayName string `json:"displayName"`
			}{DisplayName: "Minh"},
			ModifiedTime: "2026-10-26T08:15:00Z",
			Shared:       &sharedFalse,
			Permissions: []struct {
				ID string `json:"id"`
			}{{ID: "p1"}, {ID: "p2"}},
		},
	})
	gSrv.SetFile("file-shared-drive", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:          "file-shared-drive",
			DriveID:     "shared-drive-01",
			Name:        "Báo cáo chung",
			MimeType:    DriveMimeGoogleSheet,
			WebViewLink: "https://docs.google.com/spreadsheets/d/file-shared-drive/edit",
			Shared:      &sharedTrue,
		},
	})
	gSrv.SetFile("file-trashed", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "file-trashed",
			Name:     "Đã xóa",
			MimeType: DriveMimeGoogleDoc,
			Trashed:  true,
		},
	})

	meta, err := gSrv.Client.FilesGet(ctx, "tok-1", "file-my-drive")
	if err != nil {
		t.Fatalf("FilesGet file-my-drive: %v", err)
	}
	if meta.ExternalFileID != "file-my-drive" || meta.Name != "Kế hoạch Q4" || meta.IconKind != "google_doc" ||
		meta.OwnerDisplay != "Lan" || meta.ModifiedByDisplay != "Minh" || meta.SharingState != "private" ||
		meta.SharedUserCount == nil || *meta.SharedUserCount != 2 || meta.ModifiedAt == nil {
		t.Fatalf("unexpected My Drive metadata: %+v", meta)
	}
	calls := gSrv.Calls()
	if len(calls) != 1 || calls[0].Query.Get("supportsAllDrives") != "true" || calls[0].Query.Get("fields") != driveFilesGetFields {
		t.Fatalf("unexpected FilesGet query: %+v", calls)
	}

	// Shared Drive files always report sharing_state="unknown" and empty OwnerDisplay when owners is absent (§6.2).
	sharedMeta, err := gSrv.Client.FilesGet(ctx, "tok-1", "file-shared-drive")
	if err != nil {
		t.Fatalf("FilesGet file-shared-drive: %v", err)
	}
	if sharedMeta.DriveID != "shared-drive-01" || sharedMeta.SharingState != "unknown" || sharedMeta.OwnerDisplay != "" || sharedMeta.IconKind != "google_sheet" {
		t.Fatalf("unexpected Shared Drive metadata: %+v", sharedMeta)
	}

	// Trashed file -> DriveErrorClassFileNotAccessible with MarkAccessLost=true.
	_, err = gSrv.Client.FilesGet(ctx, "tok-1", "file-trashed")
	var apiErr *DriveAPIError
	if !errors.As(err, &apiErr) || apiErr.Class != DriveErrorClassFileNotAccessible || !apiErr.MarkAccessLost || !errors.Is(err, ErrDriveFileNotAccessible) {
		t.Fatalf("trashed file err = %v (apiErr=%+v), want FileNotAccessible with MarkAccessLost=true", err, apiErr)
	}

	// Redirect outside Google hosts is refused.
	gSrv.SetOverride(func(w http.ResponseWriter, r *http.Request, call FakeGoogleDriveCall) bool {
		if call.FileID == "redirect-evil" {
			http.Redirect(w, r, "https://evil.example.com/steal", http.StatusFound)
			return true
		}
		return false
	})
	_, err = gSrv.Client.FilesGet(ctx, "tok-1", "redirect-evil")
	if !errors.Is(err, ErrDriveUnavailable) {
		t.Fatalf("redirect to non-Google host err = %v, want ErrDriveUnavailable", err)
	}

	// Direct unit check on checkRedirect: allows *.googleapis.com and *.googleusercontent.com
	// over https, strips Authorization across hosts, refuses non-https and non-Google hosts.
	viaReq, _ := http.NewRequest(http.MethodGet, "https://www.googleapis.com/drive/v3/files/1?alt=media", nil)
	viaReq.Header.Set("Authorization", "Bearer tok-1")
	nextGoogleContent, _ := http.NewRequest(http.MethodGet, "https://doc-01-23-docs.googleusercontent.com/docs/securesc/1", nil)
	nextGoogleContent.Header.Set("Authorization", "Bearer tok-1")
	if err := prodClient.checkRedirect(nextGoogleContent, []*http.Request{viaReq}); err != nil {
		t.Fatalf("checkRedirect to googleusercontent.com failed: %v", err)
	}
	if got := nextGoogleContent.Header.Get("Authorization"); got != "" {
		t.Fatalf("Authorization header not stripped on cross-host redirect: %q", got)
	}
	nextHTTP, _ := http.NewRequest(http.MethodGet, "http://www.googleapis.com/drive/v3/files/1", nil)
	if err := prodClient.checkRedirect(nextHTTP, []*http.Request{viaReq}); err == nil {
		t.Fatal("checkRedirect must refuse non-https Google redirect")
	}
	nextAttacker, _ := http.NewRequest(http.MethodGet, "https://googleapis.com.attacker.test/x", nil)
	if err := prodClient.checkRedirect(nextAttacker, []*http.Request{viaReq}); err == nil {
		t.Fatal("checkRedirect must refuse lookalike host")
	}
}

// TestDriveAPIErrorMappingS4Reasons verifies every Google error reason and HTTP
// status in spec §5.7 (S4): appNotAuthorizedToFile -> drive_grant_required
// (MarkAccessLost=false), domainPolicy -> blocked_by_workspace_admin
// (MarkAccessLost=false), notFound / insufficientFilePermissions / forbidden ->
// drive_file_not_accessible (MarkAccessLost=true), rateLimitExceeded /
// userRateLimitExceeded (403 and 429) / 5xx / timeout -> drive_unavailable
// (MarkAccessLost=false), and 401/authError -> refresh once, with invalid_grant
// mapping to auth_failed.
func TestDriveAPIErrorMappingS4Reasons(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	gSrv := NewFakeGoogleDriveServer(t.Cleanup)

	cases := []struct {
		name          string
		status        int
		reason        string
		raw           string
		wantClass     DriveErrorClass
		wantSentinel  error
		wantLost      bool
		wantRateLimit bool
		wantCodedHTTP int
		wantCodedWire string
	}{
		{
			name:          "403_appNotAuthorizedToFile",
			status:        http.StatusForbidden,
			reason:        "appNotAuthorizedToFile",
			wantClass:     DriveErrorClassGrantRequired,
			wantSentinel:  ErrDriveGrantRequired,
			wantLost:      false,
			wantCodedHTTP: http.StatusForbidden,
			wantCodedWire: "drive_grant_required",
		},
		{
			name:          "403_domainPolicy",
			status:        http.StatusForbidden,
			reason:        "domainPolicy",
			wantClass:     DriveErrorClassBlockedByAdmin,
			wantSentinel:  ErrDriveBlockedByWorkspaceAdmin,
			wantLost:      false,
			wantCodedHTTP: http.StatusForbidden,
			wantCodedWire: "blocked_by_workspace_admin",
		},
		{
			name:          "404_notFound",
			status:        http.StatusNotFound,
			reason:        "notFound",
			wantClass:     DriveErrorClassFileNotAccessible,
			wantSentinel:  ErrDriveFileNotAccessible,
			wantLost:      true,
			wantCodedHTTP: http.StatusNotFound,
			wantCodedWire: "drive_file_not_accessible",
		},
		{
			name:          "403_insufficientFilePermissions",
			status:        http.StatusForbidden,
			reason:        "insufficientFilePermissions",
			wantClass:     DriveErrorClassFileNotAccessible,
			wantSentinel:  ErrDriveFileNotAccessible,
			wantLost:      true,
			wantCodedHTTP: http.StatusForbidden,
			wantCodedWire: "drive_file_not_accessible",
		},
		{
			name:          "403_forbidden",
			status:        http.StatusForbidden,
			reason:        "forbidden",
			wantClass:     DriveErrorClassFileNotAccessible,
			wantSentinel:  ErrDriveFileNotAccessible,
			wantLost:      true,
			wantCodedHTTP: http.StatusForbidden,
			wantCodedWire: "drive_file_not_accessible",
		},
		{
			name:          "403_fileNotDownloadable_nonACL",
			status:        http.StatusForbidden,
			reason:        "fileNotDownloadable",
			wantClass:     DriveErrorClassFileNotAccessible,
			wantSentinel:  ErrDriveFileNotAccessible,
			wantLost:      false,
			wantCodedHTTP: http.StatusForbidden,
			wantCodedWire: "drive_file_not_accessible",
		},
		{
			name:          "403_cannotDownloadFile_nonACL",
			status:        http.StatusForbidden,
			reason:        "cannotDownloadFile",
			wantClass:     DriveErrorClassFileNotAccessible,
			wantSentinel:  ErrDriveFileNotAccessible,
			wantLost:      false,
			wantCodedHTTP: http.StatusForbidden,
			wantCodedWire: "drive_file_not_accessible",
		},
		{
			name:          "403_rateLimitExceeded",
			status:        http.StatusForbidden,
			reason:        "rateLimitExceeded",
			wantClass:     DriveErrorClassUnavailable,
			wantSentinel:  ErrDriveUnavailable,
			wantLost:      false,
			wantRateLimit: true,
			wantCodedHTTP: http.StatusTooManyRequests,
			wantCodedWire: "drive_unavailable",
		},
		{
			name:          "403_userRateLimitExceeded",
			status:        http.StatusForbidden,
			reason:        "userRateLimitExceeded",
			wantClass:     DriveErrorClassUnavailable,
			wantSentinel:  ErrDriveUnavailable,
			wantLost:      false,
			wantRateLimit: true,
			wantCodedHTTP: http.StatusTooManyRequests,
			wantCodedWire: "drive_unavailable",
		},
		{
			name:          "429_rateLimitExceeded",
			status:        http.StatusTooManyRequests,
			reason:        "rateLimitExceeded",
			wantClass:     DriveErrorClassUnavailable,
			wantSentinel:  ErrDriveUnavailable,
			wantLost:      false,
			wantRateLimit: true,
			wantCodedHTTP: http.StatusTooManyRequests,
			wantCodedWire: "drive_unavailable",
		},
		{
			name:          "429_userRateLimitExceeded",
			status:        http.StatusTooManyRequests,
			reason:        "userRateLimitExceeded",
			wantClass:     DriveErrorClassUnavailable,
			wantSentinel:  ErrDriveUnavailable,
			wantLost:      false,
			wantRateLimit: true,
			wantCodedHTTP: http.StatusTooManyRequests,
			wantCodedWire: "drive_unavailable",
		},
		{
			name:          "500_backendError",
			status:        http.StatusInternalServerError,
			reason:        "backendError",
			wantClass:     DriveErrorClassUnavailable,
			wantSentinel:  ErrDriveUnavailable,
			wantLost:      false,
			wantCodedHTTP: http.StatusServiceUnavailable,
			wantCodedWire: "drive_unavailable",
		},
		{
			name:          "503_unstructured",
			status:        http.StatusServiceUnavailable,
			raw:           "upstream unavailable",
			wantClass:     DriveErrorClassUnavailable,
			wantSentinel:  ErrDriveUnavailable,
			wantLost:      false,
			wantCodedHTTP: http.StatusServiceUnavailable,
			wantCodedWire: "drive_unavailable",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fileID := "err-" + tc.name
			gSrv.SetFile(fileID, FakeGoogleDriveFile{
				DefaultError: &FakeGoogleDriveErrorResponse{
					Status: tc.status,
					Reason: tc.reason,
					Raw:    tc.raw,
				},
			})
			_, err := gSrv.Client.FilesGet(ctx, "tok-1", fileID)
			if err == nil {
				t.Fatalf("expected error for %s", tc.name)
			}
			var apiErr *DriveAPIError
			if !errors.As(err, &apiErr) {
				t.Fatalf("expected *DriveAPIError, got %T: %v", err, err)
			}
			if apiErr.Class != tc.wantClass {
				t.Fatalf("class = %q, want %q", apiErr.Class, tc.wantClass)
			}
			if apiErr.MarkAccessLost != tc.wantLost {
				t.Fatalf("MarkAccessLost = %v, want %v", apiErr.MarkAccessLost, tc.wantLost)
			}
			if apiErr.RateLimited != tc.wantRateLimit {
				t.Fatalf("RateLimited = %v, want %v", apiErr.RateLimited, tc.wantRateLimit)
			}
			if !errors.Is(err, tc.wantSentinel) {
				t.Fatalf("errors.Is(%v, %v) = false", err, tc.wantSentinel)
			}
			ceErr := DriveErrToCodedError(err)
			var ce CodedError
			if !errors.As(ceErr, &ce) || ce.Status != tc.wantCodedHTTP || ce.Code != tc.wantCodedWire {
				t.Fatalf("DriveErrToCodedError = %+v (err=%v), want status=%d code=%s", ce, ceErr, tc.wantCodedHTTP, tc.wantCodedWire)
			}
		})
	}

	// Timeout / context deadline maps to DriveErrorClassUnavailable with MarkAccessLost=false.
	gSrv.SetOverride(func(w http.ResponseWriter, r *http.Request, call FakeGoogleDriveCall) bool {
		if call.FileID == "slow-file" {
			<-r.Context().Done()
			return true
		}
		return false
	})
	shortCtx, cancel := context.WithTimeout(ctx, 20*time.Millisecond)
	defer cancel()
	_, err := gSrv.Client.FilesGet(shortCtx, "tok-1", "slow-file")
	var apiErr *DriveAPIError
	if !errors.As(err, &apiErr) || apiErr.Class != DriveErrorClassUnavailable || apiErr.MarkAccessLost {
		t.Fatalf("timeout err = %v (apiErr=%+v), want unavailable with MarkAccessLost=false", err, apiErr)
	}

	// 401 authError -> refresh once and retry; when refresh fails with invalid_grant -> auth_failed.
	conn := activeTestDriveConnection("conn-1", "org-1", "user-1", "sub-1", "u1@example.com")
	tokens := &fakeDriveTokenSource{
		tokensByConn: map[string]string{"conn-1": "stale-tok"},
		refreshToken: map[string]string{"conn-1": "fresh-tok"},
	}
	gSrv.SetFile("file-401-retry", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "file-401-retry",
			Name:     "Retry Doc",
			MimeType: DriveMimeGoogleDoc,
		},
		ErrorByToken: map[string]FakeGoogleDriveErrorResponse{
			"stale-tok": {Status: http.StatusUnauthorized, Reason: "authError"},
		},
	})
	meta, err := gSrv.Client.FilesGetWithConnection(ctx, tokens, conn, "file-401-retry")
	if err != nil || meta.Name != "Retry Doc" {
		t.Fatalf("FilesGetWithConnection after 401 refresh: meta=%+v err=%v", meta, err)
	}
	if len(tokens.refreshCalls) != 1 || tokens.refreshCalls[0] != "conn-1" || len(tokens.rejectedTokens) != 1 || tokens.rejectedTokens[0] != "stale-tok" {
		t.Fatalf("refreshCalls = %v rejectedTokens = %v, want [conn-1] and [stale-tok]", tokens.refreshCalls, tokens.rejectedTokens)
	}
	// 401 authError followed by invalid_grant on refresh -> DriveErrorClassAuthFailed (auth_failed).
	tokensInvalidGrant := &fakeDriveTokenSource{
		tokensByConn: map[string]string{"conn-1": "stale-tok"},
		refreshErr:   map[string]error{"conn-1": ErrDriveReauthRequired},
	}
	_, err = gSrv.Client.FilesGetWithConnection(ctx, tokensInvalidGrant, conn, "file-401-retry")
	if !errors.As(err, &apiErr) || apiErr.Class != DriveErrorClassAuthFailed || apiErr.MarkAccessLost || !errors.Is(err, ErrDriveReauthRequired) {
		t.Fatalf("401 + invalid_grant err = %v (apiErr=%+v), want AuthFailed with MarkAccessLost=false", err, apiErr)
	}
	ceErr := DriveErrToCodedError(err)
	var ce CodedError
	if !errors.As(ceErr, &ce) || ce.Status != http.StatusConflict || ce.Code != "auth_failed" {
		t.Fatalf("DriveErrToCodedError(auth_failed) = %+v", ce)
	}
}

// TestDriveForceRefreshAfterRejectedToken exercises the real DriveConnectionService
// token path (R1-1): when a caller holds an older snapshot C0 and AccessToken(C0)
// rereads or refreshes the stored row to T1, a 401 from Google for T1 must pass
// T1 as the rejected token into ForceRefreshAccessToken so refreshConnection
// calls the OAuth provider once for T2 instead of seeing read != C0 and returning
// the rejected T1 again.
func TestDriveForceRefreshAfterRejectedToken(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	gSrv := NewFakeGoogleDriveServer(t.Cleanup)

	box, err := secretbox.New(bytes.Repeat([]byte{0x42}, 32))
	if err != nil {
		t.Fatal(err)
	}
	seal := func(plain string) string {
		enc, err := box.Seal([]byte(plain))
		if err != nil {
			t.Fatal(err)
		}
		return base64.StdEncoding.EncodeToString(enc)
	}

	const (
		orgID  = "01ORG000000000000000000001"
		userID = "01USER00000000000000000001"
		connID = "01CONN00000000000000000001"
	)
	now := time.Now().UTC().Truncate(time.Microsecond)

	// Scenario 1: caller holds expiring snapshot C0 (tok-0), DB already holds
	// fresh C1 (tok-1). AccessToken(C0) rereads C1 -> tok-1 (0 provider calls).
	// Google rejects tok-1 with 401 authError. ForceRefreshAccessToken must not
	// return tok-1 as "different from C0"; it calls the provider once for tok-2
	// and retries with tok-2.
	conn0 := db.DriveConnection{
		ID:                connID,
		OrganizationID:    orgID,
		UserID:            userID,
		Provider:          "google",
		GoogleSub:         "sub-r1-1",
		GoogleEmail:       "u1@example.com",
		RefreshTokenEnc:   seal("ref-1"),
		AccessTokenEnc:    seal("tok-0"),
		AccessExpiresAt:   pgtype.Timestamptz{Time: now.Add(30 * time.Second), Valid: true},
		CredentialVersion: 1,
		Scopes:            "openid email " + DriveGoogleScope,
	}
	storedC1 := conn0
	storedC1.AccessTokenEnc = seal("tok-1")
	storedC1.AccessExpiresAt = pgtype.Timestamptz{Time: now.Add(time.Hour), Valid: true}

	memDB := &memDriveUnitDBTX{
		conns: map[string]db.DriveConnection{connID: storedC1},
	}
	connSvc := NewDriveConnectionService(nil, db.New(memDB), nil, box)
	fakeProv := NewFakeDriveProvider(config.Config{
		APIPublicURL:            "https://api.example.com",
		GoogleDriveClientID:     "cid",
		GoogleDriveClientSecret: "csec",
	})
	var providerCalls int
	fakeProv.SetRefresh(func(_ context.Context, refreshToken string) (DriveTokenResponse, error) {
		providerCalls++
		return DriveTokenResponse{
			AccessToken:  "tok-2",
			RefreshToken: refreshToken,
			Expiry:       now.Add(2 * time.Hour),
		}, nil
	})
	connSvc.SetProvider(fakeProv)

	gSrv.SetFile("file-r1-1", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "file-r1-1",
			Name:     "Fresh Doc After 401",
			MimeType: DriveMimeGoogleDoc,
		},
		ErrorByToken: map[string]FakeGoogleDriveErrorResponse{
			"tok-1": {Status: http.StatusUnauthorized, Reason: "authError"},
		},
	})

	meta, err := gSrv.Client.FilesGetWithConnection(ctx, connSvc, conn0, "file-r1-1")
	if err != nil {
		t.Fatalf("FilesGetWithConnection R1-1 reread scenario failed: %v", err)
	}
	if meta.Name != "Fresh Doc After 401" {
		t.Fatalf("meta.Name = %q, want Fresh Doc After 401", meta.Name)
	}
	if providerCalls != 1 {
		t.Fatalf("provider refresh calls = %d, want 1", providerCalls)
	}
	calls := gSrv.Calls()
	if len(calls) != 2 || calls[0].Token != "tok-1" || calls[1].Token != "tok-2" {
		t.Fatalf("Google calls = %+v, want tokens [tok-1, tok-2]", calls)
	}

	// Scenario 2: both C0 and the DB row start with expired tok-0; AccessToken(C0)
	// refreshes via the provider to tok-1, Google rejects tok-1 with 401, and
	// ForceRefreshAccessToken refreshes again to tok-2.
	memDB.mu.Lock()
	memDB.conns[connID] = conn0
	memDB.mu.Unlock()
	providerCalls = 0
	fakeProv.SetRefresh(func(_ context.Context, refreshToken string) (DriveTokenResponse, error) {
		providerCalls++
		if providerCalls == 1 {
			return DriveTokenResponse{
				AccessToken:  "tok-1",
				RefreshToken: refreshToken,
				Expiry:       now.Add(time.Hour),
			}, nil
		}
		return DriveTokenResponse{
			AccessToken:  "tok-2",
			RefreshToken: refreshToken,
			Expiry:       now.Add(2 * time.Hour),
		}, nil
	})
	meta, err = gSrv.Client.FilesGetWithConnection(ctx, connSvc, conn0, "file-r1-1")
	if err != nil || meta.Name != "Fresh Doc After 401" {
		t.Fatalf("FilesGetWithConnection R1-1 refresh-then-401 scenario: meta=%+v err=%v", meta, err)
	}
	if providerCalls != 2 {
		t.Fatalf("provider refresh calls = %d, want 2 (initial refresh to tok-1 + forced refresh to tok-2)", providerCalls)
	}

	// Scenario 3: another caller rotated the stored row away from rejected tok-1
	// to tok-3 before ForceRefreshAccessToken acquired the lock -> reuses tok-3
	// without calling the provider.
	storedC3 := storedC1
	storedC3.AccessTokenEnc = seal("tok-3")
	storedC3.AccessExpiresAt = pgtype.Timestamptz{Time: now.Add(3 * time.Hour), Valid: true}
	memDB.mu.Lock()
	memDB.conns[connID] = storedC3
	memDB.mu.Unlock()
	providerCalls = 0
	meta, err = gSrv.Client.FilesGetWithConnection(ctx, connSvc, storedC1, "file-r1-1")
	if err != nil || meta.Name != "Fresh Doc After 401" {
		t.Fatalf("FilesGetWithConnection R1-1 already-rotated scenario: meta=%+v err=%v", meta, err)
	}
	if providerCalls != 0 {
		t.Fatalf("provider refresh calls = %d, want 0 when DB already rotated to tok-3", providerCalls)
	}
}

// TestDriveContentFormatTableAndTruncation verifies every row of the §8.3 format
// table (Google Docs markdown + fallback to plain, Google Sheets CSV, Google
// Slides plain text, text/plain, text/markdown, PDF media attachment, DOCX/XLSX/PPTX
// via office extractor, and unsupported formats -> ErrDriveFormatUnsupported),
// the 200,000-character truncation ceiling, and that neither logs nor audit
// metadata ever carry file content.
func TestDriveContentFormatTableAndTruncation(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	gSrv := NewFakeGoogleDriveServer(t.Cleanup)

	const (
		orgID  = "01ORG000000000000000000001"
		wsID   = "01WS0000000000000000000001"
		userID = "01USER00000000000000000001"
	)
	conn := activeTestDriveConnection("conn-u1", orgID, userID, "sub-u1", "u1@example.com")
	tokens := &fakeDriveTokenSource{
		tokensByConn: map[string]string{"conn-u1": "tok-u1"},
	}
	extractor := &fakeDriveOfficeExtractor{
		res: office.ExtractTextResult{
			Text:      "Extracted Office body",
			Truncated: false,
		},
	}
	lookup := &fakeDriveFileAccessLookup{
		rows: make(map[string]driveFileAccessRow),
	}

	var logBuf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logBuf, nil))
	var auditEntries []audit.Entry

	ws := newTestDriveWorkspaceService(map[string]string{wsID + "|" + userID: orgID})
	svc := NewDriveContentService(nil, nil, ws, lookup, tokens, gSrv.Client, extractor)
	svc.SetLogger(logger)
	svc.auditHook = func(_ context.Context, entry audit.Entry) error {
		auditEntries = append(auditEntries, entry)
		return nil
	}

	registerFile := func(driveFileID, extID, name, mime string, file FakeGoogleDriveFile) {
		file.Metadata.ID = extID
		file.Metadata.Name = name
		file.Metadata.MimeType = mime
		gSrv.SetFile(extID, file)
		lookup.rows[userID+"|"+wsID+"|"+driveFileID] = driveFileAccessRow{
			DriveFileID:    driveFileID,
			OrganizationID: orgID,
			WorkspaceID:    wsID,
			ExternalFileID: extID,
			Name:           name,
			MimeType:       mime,
			HasAccessRow:   true,
			AccessState:    "granted",
			Connection:     conn,
		}
	}

	secretMarker := "SECRET_DOCUMENT_BODY_DO_NOT_LOG_987654"

	// 1. Google Docs -> files.export text/markdown
	registerFile("df-gdoc", "ext-gdoc", "Spec Doc", DriveMimeGoogleDoc, FakeGoogleDriveFile{
		ExportByMime: map[string][]byte{
			DriveMimeMarkdown: []byte("# Heading\n" + secretMarker),
		},
	})
	dc, err := svc.ReadForAI(ctx, userID, wsID, "df-gdoc", DriveContentPurposeTaskProposal)
	if err != nil {
		t.Fatalf("Google Doc ReadForAI: %v", err)
	}
	if dc.Text != "# Heading\n"+secretMarker || dc.Truncated || len(dc.Attachments) != 0 || dc.GoogleEmail != "u1@example.com" {
		t.Fatalf("Google Doc result = %+v", dc)
	}

	// 1b. Google Docs fallback to text/plain when text/markdown returns 400
	registerFile("df-gdoc-fallback", "ext-gdoc-fb", "Legacy Doc", DriveMimeGoogleDoc, FakeGoogleDriveFile{
		ExportErrMime: map[string]FakeGoogleDriveErrorResponse{
			DriveMimeMarkdown: {Status: http.StatusBadRequest, Reason: "badRequest"},
		},
		ExportByMime: map[string][]byte{
			DriveMimePlainText: []byte("Plain fallback text"),
		},
	})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-gdoc-fallback", DriveContentPurposeAskUni)
	if err != nil || dc.Text != "Plain fallback text" {
		t.Fatalf("Google Doc fallback: dc=%+v err=%v", dc, err)
	}

	// 2. Google Sheets -> files.export text/csv
	registerFile("df-gsheet", "ext-gsheet", "Budget Sheet", DriveMimeGoogleSheet, FakeGoogleDriveFile{
		ExportByMime: map[string][]byte{
			"text/csv": []byte("col1,col2\nval1,val2"),
		},
	})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-gsheet", DriveContentPurposeTaskProposal)
	if err != nil || dc.Text != "col1,col2\nval1,val2" {
		t.Fatalf("Google Sheet: dc=%+v err=%v", dc, err)
	}

	// 3. Google Slides -> files.export text/plain
	registerFile("df-gslides", "ext-gslides", "Deck", DriveMimeGoogleSlides, FakeGoogleDriveFile{
		ExportByMime: map[string][]byte{
			DriveMimePlainText: []byte("Slide 1\nSpeaker notes"),
		},
	})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-gslides", DriveContentPurposeTaskProposal)
	if err != nil || dc.Text != "Slide 1\nSpeaker notes" {
		t.Fatalf("Google Slides: dc=%+v err=%v", dc, err)
	}

	// 4. text/plain and text/markdown -> alt=media direct
	registerFile("df-txt", "ext-txt", "notes.txt", DriveMimePlainText, FakeGoogleDriveFile{
		DefaultMedia: []byte("Plain notes content"),
	})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-txt", DriveContentPurposeAskUni)
	if err != nil || dc.Text != "Plain notes content" {
		t.Fatalf("text/plain: dc=%+v err=%v", dc, err)
	}

	registerFile("df-md", "ext-md", "readme.md", DriveMimeMarkdown, FakeGoogleDriveFile{
		DefaultMedia: []byte("## Markdown content"),
	})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-md", DriveContentPurposeAskUni)
	if err != nil || dc.Text != "## Markdown content" {
		t.Fatalf("text/markdown: dc=%+v err=%v", dc, err)
	}

	// 5. PDF -> alt=media into Attachments[0] with empty Text
	pdfBytes := []byte("%PDF-1.7 sample pdf payload")
	registerFile("df-pdf", "ext-pdf", "Contract.pdf", DriveMimePDF, FakeGoogleDriveFile{
		DefaultMedia: pdfBytes,
	})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-pdf", DriveContentPurposeAskUni)
	if err != nil {
		t.Fatalf("PDF ReadForAI: %v", err)
	}
	if dc.Text != "" || dc.Truncated || len(dc.Attachments) != 1 || dc.Attachments[0].MIME != DriveMimePDF || !bytes.Equal(dc.Attachments[0].Data, pdfBytes) {
		t.Fatalf("PDF result = %+v", dc)
	}

	// 6. DOCX, XLSX, PPTX -> alt=media in memory -> office extractor
	for _, tc := range []struct {
		id     string
		extID  string
		name   string
		mime   string
		format office.ExtractFormat
	}{
		{"df-docx", "ext-docx", "Spec.docx", DriveMimeDOCX, office.ExtractFormatDOCX},
		{"df-xlsx", "ext-xlsx", "Sheet.xlsx", DriveMimeXLSX, office.ExtractFormatXLSX},
		{"df-pptx", "ext-pptx", "Slides.pptx", DriveMimePPTX, office.ExtractFormatPPTX},
	} {
		payload := []byte("PK-office-" + string(tc.format))
		registerFile(tc.id, tc.extID, tc.name, tc.mime, FakeGoogleDriveFile{
			DefaultMedia: payload,
		})
		extractor.res = office.ExtractTextResult{Text: "Extracted " + string(tc.format), Truncated: false}
		dc, err = svc.ReadForAI(ctx, userID, wsID, tc.id, DriveContentPurposeTaskProposal)
		if err != nil {
			t.Fatalf("%s ReadForAI: %v", tc.format, err)
		}
		if dc.Text != "Extracted "+string(tc.format) || dc.Truncated {
			t.Fatalf("%s result = %+v", tc.format, dc)
		}
		lastCall := extractor.calls[len(extractor.calls)-1]
		if lastCall.Format != tc.format || !bytes.Equal(lastCall.Content, payload) ||
			lastCall.ActorID != userID || lastCall.OrganizationID != orgID ||
			lastCall.WorkspaceID != wsID || lastCall.DriveFileID != tc.id {
			t.Fatalf("%s extractor call = %+v", tc.format, lastCall)
		}
	}

	// 7. 200,000-character truncation (multi-byte Vietnamese runes to verify rune count, not byte count).
	longRunes := strings.Repeat("ă", DriveContentMaxChars+500)
	registerFile("df-long", "ext-long", "Long.md", DriveMimeMarkdown, FakeGoogleDriveFile{
		DefaultMedia: []byte(longRunes),
	})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-long", DriveContentPurposeTaskProposal)
	if err != nil {
		t.Fatalf("long file ReadForAI: %v", err)
	}
	if !dc.Truncated || utf8.RuneCountInString(dc.Text) != DriveContentMaxChars {
		t.Fatalf("truncated = %v, rune len = %d, want true and %d", dc.Truncated, utf8.RuneCountInString(dc.Text), DriveContentMaxChars)
	}

	// 8. Unsupported formats (image/png, legacy .doc, .odt) refresh metadata via files.get
	// and fail before any export/media download with ErrDriveFormatUnsupported.
	callsBeforeUnsupported := len(gSrv.Calls())
	for i, badMime := range []string{
		"image/png",
		"application/msword",
		"application/vnd.oasis.opendocument.text",
		"application/zip",
	} {
		dfID := "df-unsupported-" + string(rune('a'+i))
		registerFile(dfID, "ext-"+dfID, "bad.bin", badMime, FakeGoogleDriveFile{
			DefaultMedia: []byte("should not download"),
		})
		got, err := svc.ReadForAI(ctx, userID, wsID, dfID, DriveContentPurposeAskUni)
		if !errors.Is(err, ErrDriveFormatUnsupported) {
			t.Fatalf("mime %s: err = %v, want ErrDriveFormatUnsupported", badMime, err)
		}
		if got.Name != "bad.bin" || got.DriveFileID != dfID {
			t.Fatalf("mime %s: partial DriveContent missing Name/DriveFileID: %+v", badMime, got)
		}
	}
	for _, c := range gSrv.Calls()[callsBeforeUnsupported:] {
		if c.Op != "get" {
			t.Fatalf("unsupported format made non-metadata call %+v, want only files.get", c)
		}
	}
	// 9. Verify audit rows carry purpose, google_email, google_sub, resource_type=drive_file,
	// and NEVER carry document content; logs never carry email, file name, or content.
	if len(auditEntries) == 0 {
		t.Fatal("expected drive_file.read audit entries")
	}
	for _, e := range auditEntries {
		if e.Action != audit.ActionDriveFileRead || e.ResourceType != "drive_file" || e.Actor.ID != userID {
			t.Fatalf("unexpected audit entry: %+v", e)
		}
		if e.Metadata["google_email"] != "u1@example.com" || e.Metadata["google_sub"] != "sub-u1" {
			t.Fatalf("audit metadata missing google identity: %+v", e.Metadata)
		}
		for k, v := range e.Metadata {
			if sVal, ok := v.(string); ok && strings.Contains(sVal, secretMarker) {
				t.Fatalf("audit metadata key %q leaked document content", k)
			}
		}
	}
	if strings.Contains(logBuf.String(), secretMarker) || strings.Contains(logBuf.String(), "u1@example.com") {
		t.Fatalf("logs leaked content or email: %s", logBuf.String())
	}
}

// TestDriveContentReadsUseTheCallersConnection proves ADR 0047 decision 2:
// when two users in the same workspace read the same Drive file, each read uses
// ONLY that requester's own connection from drive_file_access (never another
// user's connection), and a lookup row whose connection belongs to another user,
// is missing, is `lost`, or is disconnected/auth-failed is refused with
// ErrDriveAccessRequired without making any call to Google.
func TestDriveContentReadsUseTheCallersConnection(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	gSrv := NewFakeGoogleDriveServer(t.Cleanup)

	const (
		orgID       = "01ORG000000000000000000001"
		wsID        = "01WS0000000000000000000001"
		otherWsID   = "01WS0000000000000000000002"
		driveFileID = "01DRIVEFILE000000000000001"
		extFileID   = "ext-shared-plan"
		userMinh    = "01USERMINH0000000000000001"
		userMai     = "01USERMAI00000000000000002"
		userHung    = "01USERHUNG0000000000000003"
	)

	connMinh := activeTestDriveConnection("conn-minh", orgID, userMinh, "sub-minh", "minh@example.com")
	connMai := activeTestDriveConnection("conn-mai", orgID, userMai, "sub-mai", "mai@example.com")

	tokens := &fakeDriveTokenSource{
		tokensByConn: map[string]string{
			"conn-minh": "tok-minh-only",
			"conn-mai":  "tok-mai-only",
		},
	}

	gSrv.SetFile(extFileID, FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       extFileID,
			Name:     "Kế hoạch Q4",
			MimeType: DriveMimePlainText,
		},
		MediaByToken: map[string][]byte{
			"tok-minh-only": []byte("Read via Minh token"),
			"tok-mai-only":  []byte("Read via Mai token"),
		},
	})

	lookup := &fakeDriveFileAccessLookup{
		rows: map[string]driveFileAccessRow{
			userMinh + "|" + wsID + "|" + driveFileID: {
				DriveFileID:    driveFileID,
				OrganizationID: orgID,
				WorkspaceID:    wsID,
				ExternalFileID: extFileID,
				Name:           "Kế hoạch Q4",
				MimeType:       DriveMimePlainText,
				HasAccessRow:   true,
				AccessState:    "granted",
				Connection:     connMinh,
			},
			userMai + "|" + wsID + "|" + driveFileID: {
				DriveFileID:    driveFileID,
				OrganizationID: orgID,
				WorkspaceID:    wsID,
				ExternalFileID: extFileID,
				Name:           "Kế hoạch Q4",
				MimeType:       DriveMimePlainText,
				HasAccessRow:   true,
				AccessState:    "granted",
				Connection:     connMai,
			},
			// Hung has no drive_file_access row yet (unknown state).
			userHung + "|" + wsID + "|" + driveFileID: {
				DriveFileID:    driveFileID,
				OrganizationID: orgID,
				WorkspaceID:    wsID,
				ExternalFileID: extFileID,
				Name:           "Kế hoạch Q4",
				MimeType:       DriveMimePlainText,
				HasAccessRow:   false,
			},
		},
	}

	var auditedEmails []string
	ws := newTestDriveWorkspaceService(map[string]string{
		wsID + "|" + userMinh:      orgID,
		wsID + "|" + userMai:       orgID,
		wsID + "|" + userHung:      orgID,
		otherWsID + "|" + userMinh: orgID,
	})
	svc := NewDriveContentService(nil, nil, ws, lookup, tokens, gSrv.Client, nil)
	svc.auditHook = func(_ context.Context, e audit.Entry) error {
		email, _ := e.Metadata["google_email"].(string)
		auditedEmails = append(auditedEmails, e.Actor.ID+":"+email)
		return nil
	}
	// 1. Minh reads -> uses Minh's connection token.
	resMinh, err := svc.ReadForAI(ctx, userMinh, wsID, driveFileID, DriveContentPurposeTaskProposal)
	if err != nil {
		t.Fatalf("Minh ReadForAI: %v", err)
	}
	if resMinh.Text != "Read via Minh token" || resMinh.GoogleEmail != "minh@example.com" {
		t.Fatalf("Minh read got %+v", resMinh)
	}

	// 2. Mai reads the same file -> uses Mai's own connection token, never Minh's.
	resMai, err := svc.ReadForAI(ctx, userMai, wsID, driveFileID, DriveContentPurposeAskUni)
	if err != nil {
		t.Fatalf("Mai ReadForAI: %v", err)
	}
	if resMai.Text != "Read via Mai token" || resMai.GoogleEmail != "mai@example.com" {
		t.Fatalf("Mai read got %+v", resMai)
	}

	calls := gSrv.Calls()
	if len(calls) != 4 ||
		calls[0].Op != "get" || calls[0].Token != "tok-minh-only" ||
		calls[1].Op != "media" || calls[1].Token != "tok-minh-only" ||
		calls[2].Op != "get" || calls[2].Token != "tok-mai-only" ||
		calls[3].Op != "media" || calls[3].Token != "tok-mai-only" {
		t.Fatalf("Google calls = %+v, want Minh get+media then Mai get+media", calls)
	}
	if len(auditedEmails) != 2 || auditedEmails[0] != userMinh+":minh@example.com" || auditedEmails[1] != userMai+":mai@example.com" {
		t.Fatalf("auditedEmails = %v", auditedEmails)
	}

	// 3. Hung (no access row) -> ErrDriveAccessRequired, zero Google calls.
	callsBefore := len(gSrv.Calls())
	partial, err := svc.ReadForAI(ctx, userHung, wsID, driveFileID, DriveContentPurposeAskUni)
	if !errors.Is(err, ErrDriveAccessRequired) {
		t.Fatalf("Hung no access row: err = %v, want ErrDriveAccessRequired", err)
	}
	if partial.Name != "Kế hoạch Q4" {
		t.Fatalf("Hung partial Name = %q, want Kế hoạch Q4", partial.Name)
	}

	// 4. Hung with access state = "lost" -> ErrDriveAccessRequired, zero Google calls.
	lookup.rows[userHung+"|"+wsID+"|"+driveFileID] = driveFileAccessRow{
		DriveFileID:    driveFileID,
		OrganizationID: orgID,
		WorkspaceID:    wsID,
		ExternalFileID: extFileID,
		Name:           "Kế hoạch Q4",
		MimeType:       DriveMimePlainText,
		HasAccessRow:   true,
		AccessState:    "lost",
		Connection:     activeTestDriveConnection("conn-hung", orgID, userHung, "sub-hung", "hung@example.com"),
	}
	if _, err := svc.ReadForAI(ctx, userHung, wsID, driveFileID, DriveContentPurposeAskUni); !errors.Is(err, ErrDriveAccessRequired) {
		t.Fatalf("Hung lost access: err = %v, want ErrDriveAccessRequired", err)
	}

	// 5. Defense-in-depth: if a buggy lookup ever returned Minh's connection for Hung,
	// ReadForAI refuses because conn.UserID != requesterID.
	lookup.rows[userHung+"|"+wsID+"|"+driveFileID] = driveFileAccessRow{
		DriveFileID:    driveFileID,
		OrganizationID: orgID,
		WorkspaceID:    wsID,
		ExternalFileID: extFileID,
		Name:           "Kế hoạch Q4",
		MimeType:       DriveMimePlainText,
		HasAccessRow:   true,
		AccessState:    "granted",
		Connection:     connMinh, // belongs to Minh, NOT Hung!
	}
	if _, err := svc.ReadForAI(ctx, userHung, wsID, driveFileID, DriveContentPurposeAskUni); !errors.Is(err, ErrDriveAccessRequired) {
		t.Fatalf("mismatched connection owner: err = %v, want ErrDriveAccessRequired", err)
	}

	// 6. Disconnected or auth_failed connection -> ErrDriveAccessRequired.
	failedConn := activeTestDriveConnection("conn-hung", orgID, userHung, "sub-hung", "hung@example.com")
	failedConn.AuthFailedAt = pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	lookup.rows[userHung+"|"+wsID+"|"+driveFileID] = driveFileAccessRow{
		DriveFileID:    driveFileID,
		OrganizationID: orgID,
		WorkspaceID:    wsID,
		ExternalFileID: extFileID,
		Name:           "Kế hoạch Q4",
		MimeType:       DriveMimePlainText,
		HasAccessRow:   true,
		AccessState:    "granted",
		Connection:     failedConn,
	}
	if _, err := svc.ReadForAI(ctx, userHung, wsID, driveFileID, DriveContentPurposeAskUni); !errors.Is(err, ErrDriveAccessRequired) {
		t.Fatalf("auth_failed connection: err = %v, want ErrDriveAccessRequired", err)
	}

	// 7. File outside the requested workspace -> ErrDriveFileNotFound.
	if _, err := svc.ReadForAI(ctx, userMinh, otherWsID, driveFileID, DriveContentPurposeAskUni); !errors.Is(err, ErrDriveFileNotFound) {
		t.Fatalf("wrong workspace: err = %v, want ErrDriveFileNotFound", err)
	}
	// Even if a lookup returned a row whose WorkspaceID differs from the requested workspaceID, ReadForAI refuses with ErrDriveFileNotFound.
	lookup.rows[userMinh+"|"+otherWsID+"|"+driveFileID] = lookup.rows[userMinh+"|"+wsID+"|"+driveFileID]
	if _, err := svc.ReadForAI(ctx, userMinh, otherWsID, driveFileID, DriveContentPurposeAskUni); !errors.Is(err, ErrDriveFileNotFound) {
		t.Fatalf("mismatched row.WorkspaceID: err = %v, want ErrDriveFileNotFound", err)
	}

	if len(gSrv.Calls()) != callsBefore {
		t.Fatalf("refused reads made %d Google calls, want 0", len(gSrv.Calls())-callsBefore)
	}

	// 8. Membership gate (R1-3): nil WorkspaceService fails closed with ErrDriveUnavailable;
	// a non-member of the workspace is refused before LookupFileForRead, Google, or extractor.
	svcNilWS := NewDriveContentService(nil, nil, nil, lookup, tokens, gSrv.Client, nil)
	svcNilWS.auditHook = svc.auditHook
	if _, err := svcNilWS.ReadForAI(ctx, userMinh, wsID, driveFileID, DriveContentPurposeAskUni); !errors.Is(err, ErrDriveUnavailable) {
		t.Fatalf("nil WorkspaceService: err = %v, want ErrDriveUnavailable", err)
	}
	lookupBeforeOutsider := lookup.lookupCalls
	callsBeforeOutsider := len(gSrv.Calls())
	outsiderExtractor := &fakeDriveOfficeExtractor{}
	svcOutsider := NewDriveContentService(nil, nil, ws, lookup, tokens, gSrv.Client, outsiderExtractor)
	svcOutsider.auditHook = svc.auditHook
	if _, err := svcOutsider.ReadForAI(ctx, "01USEROUTSIDER000000000009", wsID, driveFileID, DriveContentPurposeAskUni); !errors.Is(err, ErrDriveFileNotFound) {
		t.Fatalf("non-member ReadForAI: err = %v, want ErrDriveFileNotFound", err)
	}
	if lookup.lookupCalls != lookupBeforeOutsider || len(gSrv.Calls()) != callsBeforeOutsider || len(outsiderExtractor.calls) != 0 {
		t.Fatalf("non-member reached downstream dependencies: lookupCalls=%d->%d googleCalls=%d->%d extractorCalls=%d",
			lookupBeforeOutsider, lookup.lookupCalls, callsBeforeOutsider, len(gSrv.Calls()), len(outsiderExtractor.calls))
	}
}

// TestDriveContentOfficeExtractAndAccessLostRecording verifies Office extraction
// success, engine unavailable -> ErrDriveExtractUnavailable (503), unreadable
// file (password_required / corrupted / not_office_file) -> 422 CodedError,
// TestDriveOfficeExtractWritesNoObject (the extract grant has Output == nil and
// makes no storage write), and that Google notFound / insufficientFilePermissions
// triggers RecordFileAccessLost while transient 5xx / rate-limit errors do not.
func TestDriveContentOfficeExtractAndAccessLostRecording(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	gSrv := NewFakeGoogleDriveServer(t.Cleanup)

	const (
		orgID       = "01ORG000000000000000000001"
		wsID        = "01WS0000000000000000000001"
		userID      = "01USER00000000000000000001"
		driveFileID = "01DRIVEFILE000000000000099"
		extFileID   = "ext-office-file"
	)
	conn := activeTestDriveConnection("conn-1", orgID, userID, "sub-1", "u1@example.com")
	tokens := &fakeDriveTokenSource{
		tokensByConn: map[string]string{"conn-1": "tok-1"},
	}
	extractor := &fakeDriveOfficeExtractor{}
	lookup := &fakeDriveFileAccessLookup{
		rows: map[string]driveFileAccessRow{
			userID + "|" + wsID + "|" + driveFileID: {
				DriveFileID:    driveFileID,
				OrganizationID: orgID,
				WorkspaceID:    wsID,
				ExternalFileID: extFileID,
				Name:           "Report.docx",
				MimeType:       DriveMimeDOCX,
				HasAccessRow:   true,
				AccessState:    "granted",
				Connection:     conn,
			},
		},
	}
	gSrv.SetFile(extFileID, FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       extFileID,
			Name:     "Report.docx",
			MimeType: DriveMimeDOCX,
		},
		DefaultMedia: []byte("PK-docx-bytes"),
	})

	ws := newTestDriveWorkspaceService(map[string]string{wsID + "|" + userID: orgID})
	svc := NewDriveContentService(nil, nil, ws, lookup, tokens, gSrv.Client, extractor)
	svc.auditHook = func(_ context.Context, _ audit.Entry) error { return nil }

	// 1. Engine unavailable -> ErrDriveExtractUnavailable (503).
	extractor.err = office.ErrExtractUnavailable
	_, err := svc.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeTaskProposal)
	if !errors.Is(err, ErrDriveExtractUnavailable) {
		t.Fatalf("engine unavailable: err = %v, want ErrDriveExtractUnavailable", err)
	}
	ceErr := DriveErrToCodedError(err)
	var ce CodedError
	if !errors.As(ceErr, &ce) || ce.Status != http.StatusServiceUnavailable || ce.Code != "drive_extract_unavailable" {
		t.Fatalf("DriveErrToCodedError(ErrDriveExtractUnavailable) = %+v", ce)
	}

	// 2. Engine unreadable (password_required, corrupted, not_office_file) -> 422 CodedError (R1-6):
	// password_required and corrupted must NOT wrap ErrDriveFormatUnsupported, and Ask UNI's
	// driveReadErrorNote must surface the specific reason rather than drive_format_unsupported.
	for _, tc := range []struct {
		reason          string
		wantUnsupported bool
		wantNoteSubstr  string
	}{
		{string(office.OpenPasswordRequired), false, "password_required"},
		{string(office.OpenCorrupted), false, "corrupted"},
		{string(office.OpenNotOfficeFile), true, "drive_format_unsupported"},
	} {
		extractor.err = &office.ExtractUnreadableError{Reason: tc.reason}
		_, err := svc.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeTaskProposal)
		if !errors.As(err, &ce) || ce.Status != http.StatusUnprocessableEntity || ce.Code != tc.reason {
			t.Fatalf("reason %s: got err=%v (ce=%+v), want 422 %s", tc.reason, err, ce, tc.reason)
		}
		if !errors.Is(err, ErrDriveFileUnreadable) {
			t.Fatalf("reason %s: expected errors.Is ErrDriveFileUnreadable", tc.reason)
		}
		if got := errors.Is(err, ErrDriveFormatUnsupported); got != tc.wantUnsupported {
			t.Fatalf("reason %s: errors.Is(err, ErrDriveFormatUnsupported) = %v, want %v", tc.reason, got, tc.wantUnsupported)
		}
		for _, locale := range []string{"vi", "en"} {
			note, ok := driveReadErrorNote(err, locale)
			if !ok || !strings.Contains(note, tc.wantNoteSubstr) {
				t.Fatalf("reason %s locale %s: note=%q ok=%v, want substring %q", tc.reason, locale, note, ok, tc.wantNoteSubstr)
			}
			if !tc.wantUnsupported && strings.Contains(note, "drive_format_unsupported") {
				t.Fatalf("reason %s locale %s: note=%q must not report drive_format_unsupported", tc.reason, locale, note)
			}
		}
	}

	// 3. Google 403 insufficientFilePermissions -> ErrDriveFileNotAccessible + RecordFileAccessLost called.
	extractor.err = nil
	extractor.res = office.ExtractTextResult{Text: "ok"}
	gSrv.SetFile(extFileID, FakeGoogleDriveFile{
		DefaultError: &FakeGoogleDriveErrorResponse{
			Status: http.StatusForbidden,
			Reason: "insufficientFilePermissions",
		},
	})
	_, err = svc.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeTaskProposal)
	if !errors.Is(err, ErrDriveFileNotAccessible) {
		t.Fatalf("insufficientFilePermissions: err = %v, want ErrDriveFileNotAccessible", err)
	}
	if got := lookup.lostSnapshots(); len(got) != 1 || got[0] != userID+"|"+wsID+"|"+driveFileID+"|conn-1" {
		t.Fatalf("lostSnapshots = %v, want 1 record for conn-1", got)
	}

	// 4. Google 429 rateLimitExceeded -> ErrDriveUnavailable, RecordFileAccessLost NOT called again.
	gSrv.SetFile(extFileID, FakeGoogleDriveFile{
		DefaultError: &FakeGoogleDriveErrorResponse{
			Status: http.StatusTooManyRequests,
			Reason: "rateLimitExceeded",
		},
	})
	_, err = svc.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeTaskProposal)
	if !errors.Is(err, ErrDriveUnavailable) {
		t.Fatalf("rateLimitExceeded: err = %v, want ErrDriveUnavailable", err)
	}
	if got := lookup.lostSnapshots(); len(got) != 1 {
		t.Fatalf("lostSnapshots after rate limit = %v, want unchanged length 1", got)
	}

	// 5. Unknown/non-ACL 403 reason (R1-2: e.g. fileNotDownloadable) -> ErrDriveFileNotAccessible,
	// but RecordFileAccessLost is NOT called.
	gSrv.SetFile(extFileID, FakeGoogleDriveFile{
		DefaultError: &FakeGoogleDriveErrorResponse{
			Status: http.StatusForbidden,
			Reason: "fileNotDownloadable",
		},
	})
	_, err = svc.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeTaskProposal)
	if !errors.Is(err, ErrDriveFileNotAccessible) {
		t.Fatalf("fileNotDownloadable: err = %v, want ErrDriveFileNotAccessible", err)
	}
	if got := lookup.lostSnapshots(); len(got) != 1 {
		t.Fatalf("lostSnapshots after unknown 403 reason = %v, want unchanged length 1", got)
	}

	// 6. Google 403 domainPolicy (R1-7) -> wraps ErrDriveBlockedByWorkspaceAdmin (not
	// ErrDriveFileNotAccessible), does not record access lost, and maps to the admin note in Ask UNI.
	gSrv.SetFile(extFileID, FakeGoogleDriveFile{
		DefaultError: &FakeGoogleDriveErrorResponse{
			Status: http.StatusForbidden,
			Reason: "domainPolicy",
		},
	})
	_, err = svc.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeAskUni)
	if !errors.Is(err, ErrDriveBlockedByWorkspaceAdmin) || errors.Is(err, ErrDriveFileNotAccessible) {
		t.Fatalf("domainPolicy: err = %v, want ErrDriveBlockedByWorkspaceAdmin and NOT ErrDriveFileNotAccessible", err)
	}
	if got := lookup.lostSnapshots(); len(got) != 1 {
		t.Fatalf("lostSnapshots after domainPolicy = %v, want unchanged length 1", got)
	}
	for _, locale := range []string{"vi", "en"} {
		note, ok := driveReadErrorNote(err, locale)
		if !ok || !strings.Contains(note, "blocked_by_workspace_admin") {
			t.Fatalf("domainPolicy locale %s: note=%q ok=%v, want blocked_by_workspace_admin", locale, note, ok)
		}
	}

	// 7. Pre-read metadata refresh (R1-5):
	// (a) Cached row has stale Name/MIME (text/plain), but Google files.get now reports
	// DOCX ("RenamedOnDrive.docx") -> ReadForAI dispatches to the DOCX Office extractor,
	// returns the refreshed Name and MimeType, and notifies the metadata recorder.
	lookup.rows[userID+"|"+wsID+"|"+driveFileID] = driveFileAccessRow{
		DriveFileID:    driveFileID,
		OrganizationID: orgID,
		WorkspaceID:    wsID,
		ExternalFileID: extFileID,
		Name:           "StaleName.txt",
		MimeType:       DriveMimePlainText,
		HasAccessRow:   true,
		AccessState:    "granted",
		Connection:     conn,
	}
	gSrv.SetFile(extFileID, FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       extFileID,
			Name:     "RenamedOnDrive.docx",
			MimeType: DriveMimeDOCX,
		},
		DefaultMedia: []byte("PK-updated-docx"),
	})
	extractor.calls = nil
	extractor.res = office.ExtractTextResult{Text: "Extracted from refreshed DOCX"}
	dc, err := svc.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeAskUni)
	if err != nil {
		t.Fatalf("MIME-changed ReadForAI: %v", err)
	}
	if dc.Name != "RenamedOnDrive.docx" || dc.MimeType != DriveMimeDOCX || dc.Text != "Extracted from refreshed DOCX" {
		t.Fatalf("MIME-changed result = %+v", dc)
	}
	if len(extractor.calls) != 1 || extractor.calls[0].Format != office.ExtractFormatDOCX {
		t.Fatalf("expected DOCX extractor call after metadata refresh, got %+v", extractor.calls)
	}
	if metas := lookup.refreshedMetadata(); len(metas) == 0 || metas[len(metas)-1].Name != "RenamedOnDrive.docx" {
		t.Fatalf("expected RecordFileMetadataRefresh with RenamedOnDrive.docx, got %+v", metas)
	}

	// (b) Trashed file on Google -> refused with ErrDriveFileNotAccessible before any download,
	// and access lost is recorded.
	gSrv.SetFile(extFileID, FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       extFileID,
			Name:     "TrashedOnDrive.docx",
			MimeType: DriveMimeDOCX,
			Trashed:  true,
		},
		DefaultMedia: []byte("PK-should-not-download"),
	})
	callsBeforeTrashed := len(gSrv.Calls())
	extractor.calls = nil
	_, err = svc.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeAskUni)
	if !errors.Is(err, ErrDriveFileNotAccessible) {
		t.Fatalf("trashed file ReadForAI: err = %v, want ErrDriveFileNotAccessible", err)
	}
	for _, c := range gSrv.Calls()[callsBeforeTrashed:] {
		if c.Op != "get" {
			t.Fatalf("trashed file made download call %+v, want only files.get", c)
		}
	}
	if len(extractor.calls) != 0 {
		t.Fatalf("trashed file invoked extractor %d times, want 0", len(extractor.calls))
	}
	if got := lookup.lostSnapshots(); len(got) != 2 {
		t.Fatalf("lostSnapshots after trashed file = %v, want 2", got)
	}

	// 8. Audit fail-closed (R1-4): missing audit sink (pool/q/auditHook all nil) or a
	// failing audit write prevents returning any content.
	gSrv.SetFile(extFileID, FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       extFileID,
			Name:     "Report.docx",
			MimeType: DriveMimeDOCX,
		},
		DefaultMedia: []byte("PK-docx-bytes"),
	})
	svcUnaudited := NewDriveContentService(nil, nil, ws, lookup, tokens, gSrv.Client, extractor)
	dcUnaudited, err := svcUnaudited.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeAskUni)
	if !errors.Is(err, ErrDriveUnavailable) || dcUnaudited.Text != "" || len(dcUnaudited.Attachments) != 0 {
		t.Fatalf("unaudited service: dc=%+v err=%v, want ErrDriveUnavailable with empty content", dcUnaudited, err)
	}
	auditBoom := errors.New("audit write failed")
	var sawBoundedAuditCtx bool
	svc.auditHook = func(auditCtx context.Context, _ audit.Entry) error {
		if dl, ok := auditCtx.Deadline(); ok && time.Until(dl) <= driveAuditTxTimeout && time.Until(dl) > 0 {
			sawBoundedAuditCtx = true
		}
		return auditBoom
	}
	dcFailAudit, err := svc.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeAskUni)
	if !errors.Is(err, auditBoom) || dcFailAudit.Text != "" || len(dcFailAudit.Attachments) != 0 {
		t.Fatalf("failing audit: dc=%+v err=%v, want auditBoom with empty content", dcFailAudit, err)
	}
	if !sawBoundedAuditCtx {
		t.Fatal("expected recordReadAudit context to carry a bounded timeout (L-1)")
	}
}

// TestDriveOfficeExtractWritesNoObject verifies with the real office.Client and
// an httptest fake office-engine that ReadForAI on a DOCX/XLSX/PPTX file mints
// an extract-only ServiceGrant with Output == nil and never requests or writes
// an object storage destination (ADR 0047, spec §8.3a).
func TestDriveOfficeExtractWritesNoObject(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	gSrv := NewFakeGoogleDriveServer(t.Cleanup)

	serviceToken := strings.Repeat("s", 32)
	grantKey := strings.Repeat("g", 32)
	const (
		orgID       = "01ORG000000000000000000001"
		wsID        = "01WS0000000000000000000001"
		userID      = "01USER00000000000000000001"
		driveFileID = "01DRIVEFILE000000000000077"
		extFileID   = "ext-docx-no-obj"
	)

	var seenGrants []office.ServiceGrant
	engineSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/readyz":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ready","queue_depth":0,"running":0,"max_workers":2,"max_queue":16}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/jobs":
			g, err := office.VerifyGrant(r.Header.Get("X-Office-Grant"), []byte(grantKey))
			if err != nil {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			seenGrants = append(seenGrants, g)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"job_id":"` + g.JobID + `","state":"completed","operation":"extract_text","format":"docx","result":{"text":"Inline extracted text only","truncated":false}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(engineSrv.Close)

	officeCli, err := office.NewClient(office.Config{
		BaseURL:        engineSrv.URL,
		ServiceToken:   serviceToken,
		GrantKey:       grantKey,
		RequestTimeout: 2 * time.Second,
	}, engineSrv.Client())
	if err != nil {
		t.Fatal(err)
	}

	conn := activeTestDriveConnection("conn-1", orgID, userID, "sub-1", "u1@example.com")
	tokens := &fakeDriveTokenSource{tokensByConn: map[string]string{"conn-1": "tok-1"}}
	lookup := &fakeDriveFileAccessLookup{
		rows: map[string]driveFileAccessRow{
			userID + "|" + wsID + "|" + driveFileID: {
				DriveFileID:    driveFileID,
				OrganizationID: orgID,
				WorkspaceID:    wsID,
				ExternalFileID: extFileID,
				Name:           "Architecture.docx",
				MimeType:       DriveMimeDOCX,
				HasAccessRow:   true,
				AccessState:    "granted",
				Connection:     conn,
			},
		},
	}
	gSrv.SetFile(extFileID, FakeGoogleDriveFile{
		Metadata:     googleDriveFileJSON{ID: extFileID, Name: "Architecture.docx", MimeType: DriveMimeDOCX},
		DefaultMedia: []byte("PK\x03\x04docx-in-memory"),
	})

	ws := newTestDriveWorkspaceService(map[string]string{wsID + "|" + userID: orgID})
	svc := NewDriveContentService(nil, nil, ws, lookup, tokens, gSrv.Client, officeCli)
	svc.auditHook = func(_ context.Context, _ audit.Entry) error { return nil }
	dc, err := svc.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeAskUni)
	if err != nil {
		t.Fatalf("ReadForAI with real office.Client: %v", err)
	}
	if dc.Text != "Inline extracted text only" || dc.Truncated {
		t.Fatalf("unexpected DriveContent: %+v", dc)
	}
	if len(seenGrants) != 1 {
		t.Fatalf("seenGrants = %d, want 1", len(seenGrants))
	}
	g := seenGrants[0]
	if g.Output != nil || g.DocumentID != "" || g.DriveFileID != driveFileID || g.Operation != office.OperationExtractText {
		t.Fatalf("grant must have nil Output and empty DocumentID: %+v", g)
	}
}

type repeatingByteReader struct {
	b         byte
	remaining int64
}

func (r *repeatingByteReader) Read(p []byte) (int, error) {
	if r.remaining <= 0 {
		return 0, io.EOF
	}
	n := int64(len(p))
	if n > r.remaining {
		n = r.remaining
	}
	for i := int64(0); i < n; i++ {
		p[i] = r.b
	}
	r.remaining -= n
	return int(n), nil
}

// TestDriveContentSizeCeilings verifies the exact cap and cap+1 boundaries for
// every distinct Drive response ceiling (R1-10: metadata 1 MiB, text 1 MiB,
// export 10 MiB, PDF 10 MiB, Office 20 MiB) plus chunked unknown-length
// (no Content-Length header) oversized responses. Oversized responses are
// rejected before extraction or model use and write no read audit row.
func TestDriveContentSizeCeilings(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	gSrv := NewFakeGoogleDriveServer(t.Cleanup)

	const (
		orgID  = "01ORG000000000000000000001"
		wsID   = "01WS0000000000000000000001"
		userID = "01USER00000000000000000001"
	)
	conn := activeTestDriveConnection("conn-cap", orgID, userID, "sub-cap", "cap@example.com")
	tokens := &fakeDriveTokenSource{tokensByConn: map[string]string{"conn-cap": "tok-cap"}}
	var extractedLengths []int
	extractor := &fakeDriveOfficeExtractor{
		fn: func(_ context.Context, req office.ExtractTextRequest) (office.ExtractTextResult, error) {
			extractedLengths = append(extractedLengths, len(req.Content))
			return office.ExtractTextResult{Text: "office-cap-ok"}, nil
		},
	}
	lookup := &fakeDriveFileAccessLookup{rows: make(map[string]driveFileAccessRow)}
	ws := newTestDriveWorkspaceService(map[string]string{wsID + "|" + userID: orgID})
	svc := NewDriveContentService(nil, nil, ws, lookup, tokens, gSrv.Client, extractor)
	var auditCount int
	svc.auditHook = func(_ context.Context, _ audit.Entry) error {
		auditCount++
		return nil
	}

	type streamSpec struct {
		mime         string
		metaBytes    int64 // if > 0, stream a JSON metadata response of exactly metaBytes
		bodyBytes    int64 // streamed on export or media
		chunkedNoLen bool  // omit Content-Length and flush headers so resp.ContentLength == -1
	}
	var specMu sync.Mutex
	specs := make(map[string]streamSpec)
	registerStreamFile := func(id, mime string, sp streamSpec) {
		sp.mime = mime
		specMu.Lock()
		specs[id] = sp
		specMu.Unlock()
		lookup.rows[userID+"|"+wsID+"|"+id] = driveFileAccessRow{
			DriveFileID:    id,
			OrganizationID: orgID,
			WorkspaceID:    wsID,
			ExternalFileID: id,
			Name:           id,
			MimeType:       mime,
			HasAccessRow:   true,
			AccessState:    "granted",
			Connection:     conn,
		}
	}

	gSrv.SetOverride(func(w http.ResponseWriter, _ *http.Request, call FakeGoogleDriveCall) bool {
		specMu.Lock()
		sp, ok := specs[call.FileID]
		specMu.Unlock()
		if !ok {
			return false
		}
		if call.Op == "get" {
			w.Header().Set("Content-Type", "application/json")
			if sp.metaBytes <= 0 {
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(googleDriveFileJSON{
					ID:       call.FileID,
					Name:     call.FileID,
					MimeType: sp.mime,
				})
				return true
			}
			prefix := `{"id":"` + call.FileID + `","name":"` + call.FileID + `","mimeType":"` + sp.mime + `","webViewLink":"https://drive.google.com/`
			suffix := `"}`
			pad := sp.metaBytes - int64(len(prefix)+len(suffix))
			if !sp.chunkedNoLen {
				w.Header().Set("Content-Length", strconv.FormatInt(sp.metaBytes, 10))
			}
			w.WriteHeader(http.StatusOK)
			if sp.chunkedNoLen {
				if fl, ok := w.(http.Flusher); ok {
					fl.Flush()
				}
			}
			_, _ = io.WriteString(w, prefix)
			_, _ = io.Copy(w, &repeatingByteReader{b: 'x', remaining: pad})
			_, _ = io.WriteString(w, suffix)
			return true
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		if !sp.chunkedNoLen {
			w.Header().Set("Content-Length", strconv.FormatInt(sp.bodyBytes, 10))
		}
		w.WriteHeader(http.StatusOK)
		if sp.chunkedNoLen {
			if fl, ok := w.(http.Flusher); ok {
				fl.Flush()
			}
		}
		_, _ = io.Copy(w, &repeatingByteReader{b: 'a', remaining: sp.bodyBytes})
		return true
	})

	assertTooLarge := func(t *testing.T, label string, dc DriveContent, err error, prevAudits, prevExtracts int) {
		t.Helper()
		var ce CodedError
		if !errors.As(err, &ce) || ce.Status != http.StatusUnprocessableEntity || ce.Code != "drive_file_too_large" || !errors.Is(err, ErrDriveFormatUnsupported) {
			t.Fatalf("%s: err = %v (ce=%+v), want 422 drive_file_too_large wrapping ErrDriveFormatUnsupported", label, err, ce)
		}
		if dc.Text != "" || len(dc.Attachments) != 0 {
			t.Fatalf("%s: oversized response must not return content or attachments: %+v", label, dc)
		}
		if auditCount != prevAudits {
			t.Fatalf("%s: auditCount = %d, want unchanged %d", label, auditCount, prevAudits)
		}
		if len(extractedLengths) != prevExtracts {
			t.Fatalf("%s: extractor calls = %d, want unchanged %d", label, len(extractedLengths), prevExtracts)
		}
	}

	// 1. Metadata ceiling (driveMetadataMaxBytes = 1 MiB): cap succeeds, cap+1 fails before download/audit.
	registerStreamFile("df-meta-cap", DriveMimePlainText, streamSpec{metaBytes: driveMetadataMaxBytes, bodyBytes: 16})
	dc, err := svc.ReadForAI(ctx, userID, wsID, "df-meta-cap", DriveContentPurposeAskUni)
	if err != nil || len(dc.Text) != 16 || auditCount != 1 {
		t.Fatalf("metadata exact cap: len=%d auditCount=%d err=%v", len(dc.Text), auditCount, err)
	}
	registerStreamFile("df-meta-over", DriveMimePlainText, streamSpec{metaBytes: driveMetadataMaxBytes + 1, bodyBytes: 16})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-meta-over", DriveContentPurposeAskUni)
	assertTooLarge(t, "metadata cap+1", dc, err, 1, 0)

	// 2. Plain text ceiling (DrivePlainTextMaxBytes = 1 MiB): cap succeeds, cap+1 fails.
	registerStreamFile("df-text-cap", DriveMimePlainText, streamSpec{bodyBytes: DrivePlainTextMaxBytes})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-text-cap", DriveContentPurposeAskUni)
	if err != nil || !dc.Truncated || len(dc.Text) != DriveContentMaxChars || auditCount != 2 {
		t.Fatalf("text exact cap: truncated=%v len=%d auditCount=%d err=%v", dc.Truncated, len(dc.Text), auditCount, err)
	}
	registerStreamFile("df-text-over", DriveMimePlainText, streamSpec{bodyBytes: DrivePlainTextMaxBytes + 1})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-text-over", DriveContentPurposeAskUni)
	assertTooLarge(t, "text cap+1", dc, err, 2, 0)

	// 3. Google export ceiling (DriveExportMaxBytes = 10 MiB): cap succeeds, cap+1 fails.
	registerStreamFile("df-export-cap", DriveMimeGoogleSheet, streamSpec{bodyBytes: DriveExportMaxBytes})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-export-cap", DriveContentPurposeTaskProposal)
	if err != nil || !dc.Truncated || len(dc.Text) != DriveContentMaxChars || auditCount != 3 {
		t.Fatalf("export exact cap: truncated=%v len=%d auditCount=%d err=%v", dc.Truncated, len(dc.Text), auditCount, err)
	}
	registerStreamFile("df-export-over", DriveMimeGoogleSheet, streamSpec{bodyBytes: DriveExportMaxBytes + 1})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-export-over", DriveContentPurposeTaskProposal)
	assertTooLarge(t, "export cap+1", dc, err, 3, 0)

	// 4. PDF attachment ceiling (DrivePDFMaxBytes = 10 MiB): cap succeeds, cap+1 fails.
	registerStreamFile("df-pdf-cap", DriveMimePDF, streamSpec{bodyBytes: DrivePDFMaxBytes})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-pdf-cap", DriveContentPurposeAskUni)
	if err != nil || len(dc.Attachments) != 1 || int64(len(dc.Attachments[0].Data)) != DrivePDFMaxBytes || auditCount != 4 {
		t.Fatalf("PDF exact cap: attachments=%d auditCount=%d err=%v", len(dc.Attachments), auditCount, err)
	}
	dc.Attachments = nil
	registerStreamFile("df-pdf-over", DriveMimePDF, streamSpec{bodyBytes: DrivePDFMaxBytes + 1})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-pdf-over", DriveContentPurposeAskUni)
	assertTooLarge(t, "PDF cap+1", dc, err, 4, 0)

	// 5. Office extract ceiling (DriveOfficeExtractMaxBytes = 20 MiB): cap reaches extractor, cap+1 rejected before extractor.
	registerStreamFile("df-office-cap", DriveMimeDOCX, streamSpec{bodyBytes: DriveOfficeExtractMaxBytes})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-office-cap", DriveContentPurposeTaskProposal)
	if err != nil || dc.Text != "office-cap-ok" || len(extractedLengths) != 1 || int64(extractedLengths[0]) != DriveOfficeExtractMaxBytes || auditCount != 5 {
		t.Fatalf("Office exact cap: text=%q extractedLengths=%v auditCount=%d err=%v", dc.Text, extractedLengths, auditCount, err)
	}
	registerStreamFile("df-office-over", DriveMimeDOCX, streamSpec{bodyBytes: DriveOfficeExtractMaxBytes + 1})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-office-over", DriveContentPurposeTaskProposal)
	assertTooLarge(t, "Office cap+1 (with Content-Length)", dc, err, 5, 1)

	// 6. Unknown-length (chunked, no Content-Length header) oversized stream:
	// exercises the io.LimitReader(resp.Body, maxBytes+1) path when resp.ContentLength == -1.
	registerStreamFile("df-office-chunked-over", DriveMimeDOCX, streamSpec{
		bodyBytes:    DriveOfficeExtractMaxBytes + 1,
		chunkedNoLen: true,
	})
	dc, err = svc.ReadForAI(ctx, userID, wsID, "df-office-chunked-over", DriveContentPurposeTaskProposal)
	assertTooLarge(t, "Office cap+1 (chunked unknown Content-Length)", dc, err, 5, 1)
}

// TestDriveContentReadForAIHonorsFlagAndProviderAvailability verifies F01:
// the real DriveFileService.LookupFileForRead + DriveContentService.ReadForAI
// path refuses with ErrDriveUnavailable and makes zero Google calls when
// either the drive_connector feature flag is off for the requester/organization
// or DriveConnectionService.Available() is false, even when the caller has a
// stored granted row and a fresh encrypted access token; and succeeds when both
// the flag is on and the provider is configured.
func TestDriveContentReadForAIHonorsFlagAndProviderAvailability(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	gSrv := NewFakeGoogleDriveServer(t.Cleanup)

	const (
		orgID       = "01ORG0000000000000000000F1"
		wsID        = "01WS00000000000000000000F1"
		userID      = "01USER000000000000000000F1"
		connID      = "01CONN000000000000000000F1"
		driveFileID = "01DFILE00000000000000000F1"
		extFileID   = "ext-f01-doc"
	)

	gSrv.SetFile(extFileID, FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       extFileID,
			Name:     "F01 Private Doc",
			MimeType: DriveMimePlainText,
		},
		DefaultMedia: []byte("private Drive text"),
	})

	box := testDriveBox(t)
	seal := func(plain string) string {
		s, err := box.Seal([]byte(plain))
		if err != nil {
			t.Fatal(err)
		}
		return base64.StdEncoding.EncodeToString(s)
	}

	now := time.Now().UTC()
	memDB := &memDriveUnitDBTX{
		admitted: map[string]string{wsID + "|" + userID: orgID},
		workspaces: map[string]db.Workspace{
			wsID: {
				ID:             wsID,
				OrganizationID: orgID,
				Slug:           "ws-f01",
				Name:           "WS F01",
				TaskPrefix:     "F01",
			},
		},
		files: map[string]db.DriveFile{
			driveFileID: {
				ID:             driveFileID,
				OrganizationID: orgID,
				WorkspaceID:    wsID,
				ExternalFileID: extFileID,
				ConnectionID:   connID,
				BoundBy:        userID,
				CreatedBy:      userID,
				CreatedByKind:  "human",
				Name:           "F01 Private Doc",
				MimeType:       DriveMimePlainText,
				IconKind:       "text",
				SharingState:   DriveSharingStatePrivate,
			},
		},
		access: map[string]db.DriveFileAccess{
			driveFileID + "|" + userID: {
				ID:             "01ACC0000000000000000000F1",
				OrganizationID: orgID,
				WorkspaceID:    wsID,
				DriveFileID:    driveFileID,
				UserID:         userID,
				ConnectionID:   connID,
				State:          "granted",
			},
		},
		conns: map[string]db.DriveConnection{
			connID: {
				ID:              connID,
				OrganizationID:  orgID,
				UserID:          userID,
				Provider:        "google",
				GoogleSub:       "sub-f01",
				GoogleEmail:     "f01@example.com",
				RefreshTokenEnc: seal("tok-r-f01"),
				AccessTokenEnc:  seal("tok-a-f01"),
				AccessExpiresAt: pgtype.Timestamptz{Time: now.Add(time.Hour), Valid: true},
				Scopes:          "openid email " + DriveGoogleScope,
			},
		},
	}

	q := db.New(memDB)
	ws := &WorkspaceService{q: q}
	connSvc := NewDriveConnectionService(nil, q, ws, box)
	fileSvc := NewDriveFileService(nil, q, ws, connSvc, gSrv.Client)
	contentSvc := NewDriveContentService(nil, q, ws, fileSvc, connSvc, gSrv.Client, nil)
	contentSvc.auditHook = func(_ context.Context, _ audit.Entry) error { return nil }

	fakeProv := NewFakeDriveProvider(config.Config{
		GoogleDriveClientID:     "cid-f01",
		GoogleDriveClientSecret: "sec-f01",
	})

	// 1. Flag off with a granted row + fresh token + configured provider -> unavailable, zero Google calls.
	connSvc.SetProvider(fakeProv)
	connSvc.SetFlags(driveConnectorFlags(t, false))
	fileSvc.SetFlags(driveConnectorFlags(t, false))
	dc, err := contentSvc.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeAskUni)
	if !errors.Is(err, ErrDriveUnavailable) || dc.Text != "" {
		t.Fatalf("flag off ReadForAI: dc=%+v err=%v, want ErrDriveUnavailable", dc, err)
	}
	if gotCalls := len(gSrv.Calls()); gotCalls != 0 {
		t.Fatalf("flag off Google calls = %d, want 0", gotCalls)
	}

	// 2. Provider unconfigured with flag on + granted row + fresh token -> unavailable, zero Google calls.
	connSvc.SetProvider(nil)
	connSvc.SetFlags(driveConnectorFlags(t, true))
	fileSvc.SetFlags(driveConnectorFlags(t, true))
	dc, err = contentSvc.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeAskUni)
	if !errors.Is(err, ErrDriveUnavailable) || dc.Text != "" {
		t.Fatalf("provider unconfigured ReadForAI: dc=%+v err=%v, want ErrDriveUnavailable", dc, err)
	}
	if gotCalls := len(gSrv.Calls()); gotCalls != 0 {
		t.Fatalf("provider unconfigured Google calls = %d, want 0", gotCalls)
	}

	// 3. Flag on + configured provider -> reads content using caller's fresh token.
	connSvc.SetProvider(fakeProv)
	dc, err = contentSvc.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeAskUni)
	if err != nil {
		t.Fatalf("flag on + configured ReadForAI err = %v", err)
	}
	if dc.Text != "private Drive text" || dc.GoogleEmail != "f01@example.com" {
		t.Fatalf("flag on + configured ReadForAI dc = %+v", dc)
	}
	if gotCalls := len(gSrv.Calls()); gotCalls != 2 {
		t.Fatalf("flag on + configured Google calls = %d, want 2 (files.get + media)", gotCalls)
	}
}
