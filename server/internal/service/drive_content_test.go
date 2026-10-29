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
	"reflect"
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
	metaCallers []string
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

func (f *fakeDriveFileAccessLookup) RecordFileMetadataRefresh(_ context.Context, requesterID, workspaceID, driveFileID, connectionID string, meta DriveFileMetadata) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.metaRecs = append(f.metaRecs, meta)
	f.metaCallers = append(f.metaCallers, requesterID+"|"+workspaceID+"|"+driveFileID+"|"+connectionID)
	return nil
}

func (f *fakeDriveFileAccessLookup) refreshedCallers() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, len(f.metaCallers))
	copy(out, f.metaCallers)
	return out
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
	mu                sync.Mutex
	admitted          map[string]string             // "wsID|userID" -> orgID
	workspaces        map[string]db.Workspace       // wsID -> workspace
	files             map[string]db.DriveFile       // fileID -> row
	folders           map[string]db.DriveFolder     // "wsID|driveFolderID" -> row
	access            map[string]db.DriveFileAccess // "fileID|userID" -> row
	conns             map[string]db.DriveConnection // connID -> row
	failSetFolderName bool
	failUpdateFile    bool
	tryLockGraphBusy  bool
}

func (m *memDriveUnitDBTX) beginTx() (*db.Queries, func(context.Context) error, func(context.Context) error, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	filesCopy := make(map[string]db.DriveFile, len(m.files))
	for k, v := range m.files {
		filesCopy[k] = v
	}
	foldersCopy := make(map[string]db.DriveFolder, len(m.folders))
	for k, v := range m.folders {
		foldersCopy[k] = v
	}
	accessCopy := make(map[string]db.DriveFileAccess, len(m.access))
	for k, v := range m.access {
		accessCopy[k] = v
	}
	txDB := &memDriveUnitDBTX{
		admitted:          m.admitted,
		workspaces:        m.workspaces,
		files:             filesCopy,
		folders:           foldersCopy,
		access:            accessCopy,
		conns:             m.conns,
		failSetFolderName: m.failSetFolderName,
		failUpdateFile:    m.failUpdateFile,
		tryLockGraphBusy:  m.tryLockGraphBusy,
	}
	closed := false
	commit := func(context.Context) error {
		m.mu.Lock()
		defer m.mu.Unlock()
		if closed {
			return errors.New("tx already closed")
		}
		closed = true
		m.files = txDB.files
		m.folders = txDB.folders
		m.access = txDB.access
		return nil
	}
	rollback := func(context.Context) error {
		m.mu.Lock()
		defer m.mu.Unlock()
		closed = true
		return nil
	}
	return db.New(txDB), commit, rollback, nil
}

type memDriveStringRows struct {
	vals []string
	idx  int
}

func (r *memDriveStringRows) Close()                                       {}
func (r *memDriveStringRows) Err() error                                   { return nil }
func (r *memDriveStringRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *memDriveStringRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *memDriveStringRows) Values() ([]any, error)                       { return nil, nil }
func (r *memDriveStringRows) RawValues() [][]byte                          { return nil }
func (r *memDriveStringRows) Conn() *pgx.Conn                              { return nil }
func (r *memDriveStringRows) Next() bool {
	if r.idx >= len(r.vals) {
		return false
	}
	r.idx++
	return true
}
func (r *memDriveStringRows) Scan(dest ...any) error {
	*(dest[0].(*string)) = r.vals[r.idx-1]
	return nil
}

type memDriveFolderRows struct {
	vals []db.ListWorkspaceDriveFoldersRow
	idx  int
}

func (r *memDriveFolderRows) Close()                                       {}
func (r *memDriveFolderRows) Err() error                                   { return nil }
func (r *memDriveFolderRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *memDriveFolderRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *memDriveFolderRows) Values() ([]any, error)                       { return nil, nil }
func (r *memDriveFolderRows) RawValues() [][]byte                          { return nil }
func (r *memDriveFolderRows) Conn() *pgx.Conn                              { return nil }
func (r *memDriveFolderRows) Next() bool {
	if r.idx >= len(r.vals) {
		return false
	}
	r.idx++
	return true
}
func (r *memDriveFolderRows) Scan(dest ...any) error {
	row := r.vals[r.idx-1]
	*(dest[0].(*string)) = row.DriveFolderID
	*(dest[1].(*string)) = row.Name
	*(dest[2].(*pgtype.Text)) = row.ParentFolderID
	return nil
}

func (m *memDriveUnitDBTX) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if strings.Contains(sql, "-- name: LockDriveFolderGraph ") {
		return pgconn.NewCommandTag("SELECT 1"), nil
	}
	if strings.Contains(sql, "-- name: RestoreDriveFileMetadataRefreshedAt ") {
		prevRef, _ := args[0].(pgtype.Timestamptz)
		id, _ := args[1].(string)
		orgID, _ := args[2].(string)
		wsID, _ := args[3].(string)
		claimedRef, _ := args[4].(pgtype.Timestamptz)
		row, ok := m.files[id]
		if !ok || row.OrganizationID != orgID || row.WorkspaceID != wsID || row.UnlinkedAt.Valid {
			return pgconn.NewCommandTag("UPDATE 0"), nil
		}
		if row.MetadataRefreshedAt.Valid != claimedRef.Valid ||
			(row.MetadataRefreshedAt.Valid && !row.MetadataRefreshedAt.Time.Equal(claimedRef.Time)) {
			return pgconn.NewCommandTag("UPDATE 0"), nil
		}
		row.MetadataRefreshedAt = prevRef
		m.files[id] = row
		return pgconn.NewCommandTag("UPDATE 1"), nil
	}
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
	if strings.Contains(sql, "-- name: DeleteWorkspaceDriveFoldersByIDs ") {
		orgID, _ := args[0].(string)
		wsID, _ := args[1].(string)
		folderIDs, _ := args[2].([]string)
		var deleted int64
		for _, fid := range folderIDs {
			key := wsID + "|" + fid
			if df, ok := m.folders[key]; ok && df.OrganizationID == orgID {
				delete(m.folders, key)
				deleted++
			}
		}
		return pgconn.NewCommandTag("DELETE " + strconv.FormatInt(deleted, 10)), nil
	}
	return pgconn.NewCommandTag(""), errors.New("unexpected Exec in memDriveUnitDBTX: " + sql)
}

func (m *memDriveUnitDBTX) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if strings.Contains(sql, "-- name: SetDriveFolderNameInWorkspace ") {
		if m.failSetFolderName {
			return nil, errors.New("simulated SetDriveFolderNameInWorkspace error")
		}
		folderName, _ := args[0].(string)
		orgID, _ := args[1].(string)
		wsID, _ := args[2].(string)
		folderID, _ := args[3].(string)
		var ids []string
		for id, f := range m.files {
			if f.OrganizationID == orgID && f.WorkspaceID == wsID && !f.UnlinkedAt.Valid && f.DriveFolderID.Valid && f.DriveFolderID.String == folderID {
				f.DriveFolderName = pgtype.Text{String: folderName, Valid: true}
				m.files[id] = f
				ids = append(ids, id)
			}
		}
		return &memDriveStringRows{vals: ids}, nil
	}
	if strings.Contains(sql, "-- name: ListWorkspaceDriveFolders ") {
		orgID, _ := args[0].(string)
		wsID, _ := args[1].(string)
		var rows []db.ListWorkspaceDriveFoldersRow
		for _, df := range m.folders {
			if df.OrganizationID == orgID && df.WorkspaceID == wsID {
				rows = append(rows, db.ListWorkspaceDriveFoldersRow{
					DriveFolderID:  df.DriveFolderID,
					Name:           df.Name,
					ParentFolderID: df.ParentFolderID,
				})
			}
		}
		return &memDriveFolderRows{vals: rows}, nil
	}
	if strings.Contains(sql, "-- name: ListActiveWorkspaceDriveFolderIDs ") {
		orgID, _ := args[0].(string)
		wsID, _ := args[1].(string)
		seen := make(map[string]bool)
		var ids []string
		for _, f := range m.files {
			if f.OrganizationID == orgID && f.WorkspaceID == wsID && !f.UnlinkedAt.Valid && f.DriveFolderID.Valid && f.DriveFolderID.String != "" {
				if !seen[f.DriveFolderID.String] {
					seen[f.DriveFolderID.String] = true
					ids = append(ids, f.DriveFolderID.String)
				}
			}
		}
		return &memDriveStringRows{vals: ids}, nil
	}
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
	case strings.Contains(sql, "-- name: TryLockDriveFolderGraph "):
		locked := !m.tryLockGraphBusy
		return driveUnitRowFunc(func(dest ...any) error {
			*(dest[0].(*bool)) = locked
			return nil
		})
	case strings.Contains(sql, "-- name: ClaimDriveFileMetadataRefresh "):
		id, _ := args[0].(string)
		orgID, _ := args[1].(string)
		wsID, _ := args[2].(string)
		row, ok := m.files[id]
		if !ok || row.OrganizationID != orgID || row.WorkspaceID != wsID || row.UnlinkedAt.Valid {
			return driveUnitRowFunc(func(...any) error { return pgx.ErrNoRows })
		}
		row.MetadataRefreshedAt = pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
		m.files[id] = row
		return scanMemDriveFile(row)
	case strings.Contains(sql, "-- name: UpsertDriveFolder "):
		id, _ := args[0].(string)
		orgID, _ := args[1].(string)
		wsID, _ := args[2].(string)
		connID, _ := args[3].(string)
		folderID, _ := args[4].(string)
		name, _ := args[5].(string)
		parentID, _ := args[6].(pgtype.Text)
		refreshedAt, _ := args[7].(pgtype.Timestamptz)
		createdBy, _ := args[8].(string)
		createdByKind, _ := args[9].(string)
		if m.folders == nil {
			m.folders = make(map[string]db.DriveFolder)
		}
		row := db.DriveFolder{
			ID:             id,
			OrganizationID: orgID,
			WorkspaceID:    wsID,
			ConnectionID:   connID,
			DriveFolderID:  folderID,
			Name:           name,
			ParentFolderID: parentID,
			RefreshedAt:    refreshedAt,
			CreatedBy:      createdBy,
			CreatedByKind:  createdByKind,
		}
		m.folders[wsID+"|"+folderID] = row
		return driveUnitRowFunc(func(dest ...any) error {
			*(dest[0].(*string)) = row.ID
			*(dest[1].(*string)) = row.OrganizationID
			*(dest[2].(*string)) = row.WorkspaceID
			*(dest[3].(*string)) = row.ConnectionID
			*(dest[4].(*string)) = row.DriveFolderID
			*(dest[5].(*string)) = row.Name
			*(dest[6].(*pgtype.Text)) = row.ParentFolderID
			*(dest[7].(*pgtype.Timestamptz)) = row.RefreshedAt
			*(dest[8].(*string)) = row.CreatedBy
			*(dest[9].(*string)) = row.CreatedByKind
			*(dest[10].(*pgtype.Timestamptz)) = row.CreatedAt
			*(dest[11].(*pgtype.Timestamptz)) = row.UpdatedAt
			return nil
		})
	case strings.Contains(sql, "-- name: GetWorkspaceDriveFolderName "):
		orgID, _ := args[0].(string)
		wsID, _ := args[1].(string)
		folderID, _ := args[2].(string)
		var found string
		if df, ok := m.folders[wsID+"|"+folderID]; ok && df.OrganizationID == orgID {
			found = df.Name
		} else {
			for _, f := range m.files {
				if f.OrganizationID == orgID && f.WorkspaceID == wsID && !f.UnlinkedAt.Valid && f.DriveFolderID.Valid && f.DriveFolderID.String == folderID && f.DriveFolderName.Valid {
					found = f.DriveFolderName.String
					break
				}
			}
		}
		return driveUnitRowFunc(func(dest ...any) error {
			*(dest[0].(*string)) = found
			return nil
		})
	case strings.Contains(sql, "-- name: UpdateDriveFileMetadata "):
		if m.failUpdateFile {
			return driveUnitRowFunc(func(...any) error { return errors.New("simulated UpdateDriveFileMetadata error") })
		}
		id, _ := args[13].(string)
		orgID, _ := args[14].(string)
		wsID, _ := args[15].(string)
		row, ok := m.files[id]
		if !ok || row.OrganizationID != orgID || row.WorkspaceID != wsID || row.UnlinkedAt.Valid {
			return driveUnitRowFunc(func(...any) error { return pgx.ErrNoRows })
		}
		row.DriveID, _ = args[0].(pgtype.Text)
		newFolderID, _ := args[1].(pgtype.Text)
		newFolderName, _ := args[2].(pgtype.Text)
		switch {
		case !newFolderID.Valid:
			row.DriveFolderName = pgtype.Text{}
		case newFolderName.Valid:
			row.DriveFolderName = newFolderName
		case row.DriveFolderID.Valid && row.DriveFolderID.String == newFolderID.String:
			// keep row.DriveFolderName
		default:
			row.DriveFolderName = pgtype.Text{}
		}
		row.DriveFolderID = newFolderID
		row.Name, _ = args[3].(string)
		row.MimeType, _ = args[4].(string)
		row.IconKind, _ = args[5].(string)
		row.WebViewLink, _ = args[6].(string)
		row.OwnerDisplay, _ = args[7].(string)
		row.DriveModifiedAt, _ = args[8].(pgtype.Timestamptz)
		row.DriveModifiedByDisplay, _ = args[9].(string)
		row.SharingState, _ = args[10].(string)
		row.SharedUserCount, _ = args[11].(pgtype.Int4)
		row.MetadataRefreshedAt, _ = args[12].(pgtype.Timestamptz)
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
		if len(dest) > 25 {
			*(dest[25].(*pgtype.Text)) = row.DriveFolderID
			*(dest[26].(*pgtype.Text)) = row.DriveFolderName
		}
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

// TestDriveAPIFolderParentAndFolderNameResolution (UNI-2221) verifies without a
// database that:
//   - FilesGetWithConnection parses parents[0] into ParentFolderID
//   - when the file has no parents, ParentFolderID and ParentFolderName are empty
//   - when the parent folder returns 404/403 under drive.file, FilesGetWithConnection
//     still succeeds with ParentFolderID set and ParentFolderName empty
//   - when the parent folder returns 200 (picked folder), FilesGetWithConnection
//     sets ParentFolderName
//   - FolderNameWithConnection returns the folder name on 200 and returns a
//     classified DriveAPIError on 404, 403, trashed folder, or non-folder MIME.
func TestDriveAPIFolderParentAndFolderNameResolution(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	gSrv := NewFakeGoogleDriveServer(t.Cleanup)
	tokens := &fakeDriveTokenSource{tokensByConn: map[string]string{"conn-fldr": "tok-fldr"}}
	conn := db.DriveConnection{ID: "conn-fldr"}

	gSrv.SetFile("file-no-parent", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "file-no-parent",
			Name:     "No Parent Doc",
			MimeType: DriveMimeGoogleDoc,
		},
	})
	gSrv.SetFile("file-404-parent", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "file-404-parent",
			Name:     "Unpicked Parent Doc",
			MimeType: DriveMimeGoogleDoc,
			Parents:  []string{"fld-404", "fld-second-ignored"},
		},
	})
	gSrv.SetFile("fld-200", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "fld-200",
			Name:     "Kế hoạch Quý 4",
			MimeType: DriveMimeGoogleFolder,
		},
	})
	gSrv.SetFile("file-200-parent", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "file-200-parent",
			Name:     "Picked Parent Doc",
			MimeType: DriveMimeGoogleDoc,
			Parents:  []string{"fld-200"},
		},
	})
	gSrv.SetFile("fld-403", FakeGoogleDriveFile{
		DefaultError: &FakeGoogleDriveErrorResponse{Status: http.StatusForbidden, Reason: "insufficientFilePermissions"},
	})
	gSrv.SetFile("file-403-parent", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "file-403-parent",
			Name:     "Forbidden Parent Doc",
			MimeType: DriveMimeGoogleDoc,
			Parents:  []string{"fld-403"},
		},
	})
	gSrv.SetFile("fld-trashed", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "fld-trashed",
			Name:     "Trashed Folder",
			MimeType: DriveMimeGoogleFolder,
			Trashed:  true,
		},
	})
	gSrv.SetFile("not-a-folder", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "not-a-folder",
			Name:     "Plain Doc",
			MimeType: DriveMimeGoogleDoc,
		},
	})
	gSrv.SetFile("fld-missing-mime", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:   "fld-missing-mime",
			Name: "No Mime Folder",
		},
	})
	gSrv.SetFile("fld-empty-name", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "fld-empty-name",
			Name:     "",
			MimeType: DriveMimeGoogleFolder,
		},
	})
	gSrv.SetFile("fld-ws-name", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "fld-ws-name",
			Name:     "   \t\n  ",
			MimeType: DriveMimeGoogleFolder,
		},
	})
	gSrv.SetFile("file-empty-name-parent", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "file-empty-name-parent",
			Name:     "Child Of Blank Folder",
			MimeType: DriveMimeGoogleDoc,
			Parents:  []string{"fld-ws-name"},
		},
	})

	// 1. No parent -> ParentFolderID == "", ParentFolderName == "".
	mNoParent, err := gSrv.Client.FilesGetWithConnection(ctx, tokens, conn, "file-no-parent")
	if err != nil {
		t.Fatalf("FilesGetWithConnection file-no-parent: %v", err)
	}
	if mNoParent.ParentFolderID != "" || mNoParent.ParentFolderName != "" {
		t.Fatalf("file-no-parent folder = (%q, %q), want empty", mNoParent.ParentFolderID, mNoParent.ParentFolderName)
	}

	// 2. Parent returns 404 or 403 -> ParentFolderID set, ParentFolderName == "".
	m404, err := gSrv.Client.FilesGetWithConnection(ctx, tokens, conn, "file-404-parent")
	if err != nil {
		t.Fatalf("FilesGetWithConnection file-404-parent: %v", err)
	}
	if m404.ParentFolderID != "fld-404" || m404.ParentFolderName != "" {
		t.Fatalf("file-404-parent folder = (%q, %q), want (fld-404, \"\")", m404.ParentFolderID, m404.ParentFolderName)
	}
	m403, err := gSrv.Client.FilesGetWithConnection(ctx, tokens, conn, "file-403-parent")
	if err != nil {
		t.Fatalf("FilesGetWithConnection file-403-parent: %v", err)
	}
	if m403.ParentFolderID != "fld-403" || m403.ParentFolderName != "" {
		t.Fatalf("file-403-parent folder = (%q, %q), want (fld-403, \"\")", m403.ParentFolderID, m403.ParentFolderName)
	}

	// 3. Parent returns 200 -> ParentFolderID == "fld-200", ParentFolderName == "Kế hoạch Quý 4".
	m200, err := gSrv.Client.FilesGetWithConnection(ctx, tokens, conn, "file-200-parent")
	if err != nil {
		t.Fatalf("FilesGetWithConnection file-200-parent: %v", err)
	}
	if m200.ParentFolderID != "fld-200" || m200.ParentFolderName != "Kế hoạch Quý 4" {
		t.Fatalf("file-200-parent folder = (%q, %q), want (fld-200, Kế hoạch Quý 4)", m200.ParentFolderID, m200.ParentFolderName)
	}

	// 4. Parent with empty/whitespace name -> never substitutes folder ID; ParentFolderName stays "".
	mBlank, err := gSrv.Client.FilesGetWithConnection(ctx, tokens, conn, "file-empty-name-parent")
	if err != nil {
		t.Fatalf("FilesGetWithConnection file-empty-name-parent: %v", err)
	}
	if mBlank.ParentFolderID != "fld-ws-name" || mBlank.ParentFolderName != "" {
		t.Fatalf("file-empty-name-parent folder = (%q, %q), want (fld-ws-name, \"\")", mBlank.ParentFolderID, mBlank.ParentFolderName)
	}

	// 5. FolderNameWithConnection + DriveFolderErrToCodedError direct calls:
	// 200, 404, 403 reasons, empty/whitespace name -> 404 drive_folder_not_found;
	// trashed, non-folder MIME, missing MIME -> 422 drive_folder_not_folder.
	gotName, err := gSrv.Client.FolderNameWithConnection(ctx, tokens, conn, "fld-200")
	if err != nil || gotName != "Kế hoạch Quý 4" {
		t.Fatalf("FolderNameWithConnection fld-200 = (%q, %v), want (Kế hoạch Quý 4, nil)", gotName, err)
	}
	for _, folderID := range []string{"fld-404", "fld-403", "fld-empty-name", "fld-ws-name"} {
		_, ferr := gSrv.Client.FolderNameWithConnection(ctx, tokens, conn, folderID)
		mapped := DriveFolderErrToCodedError(ferr)
		var ce CodedError
		if !errors.As(mapped, &ce) || ce.Status != http.StatusNotFound || ce.Code != "drive_folder_not_found" {
			t.Fatalf("FolderNameWithConnection(%q) mapped = %+v (raw=%v), want 404 drive_folder_not_found", folderID, ce, ferr)
		}
	}
	for _, reason := range []string{"insufficientFilePermissions", "forbidden", "appNotAuthorizedToFile", "domainPolicy", ""} {
		fid := "fld-403-" + reason
		gSrv.SetFile(fid, FakeGoogleDriveFile{
			DefaultError: &FakeGoogleDriveErrorResponse{Status: http.StatusForbidden, Reason: reason},
		})
		_, ferr := gSrv.Client.FolderNameWithConnection(ctx, tokens, conn, fid)
		mapped := DriveFolderErrToCodedError(ferr)
		var ce CodedError
		if !errors.As(mapped, &ce) || ce.Status != http.StatusNotFound || ce.Code != "drive_folder_not_found" {
			t.Fatalf("FolderNameWithConnection 403 reason=%q mapped = %+v (raw=%v), want 404 drive_folder_not_found", reason, ce, ferr)
		}
	}
	for _, folderID := range []string{"fld-trashed", "not-a-folder", "fld-missing-mime"} {
		_, ferr := gSrv.Client.FolderNameWithConnection(ctx, tokens, conn, folderID)
		if !errors.Is(ferr, ErrDriveFolderNotFolder) {
			t.Fatalf("FolderNameWithConnection(%q) = %v, want ErrDriveFolderNotFolder", folderID, ferr)
		}
		mapped := DriveFolderErrToCodedError(ferr)
		var ce CodedError
		if !errors.As(mapped, &ce) || ce.Status != http.StatusUnprocessableEntity || ce.Code != "drive_folder_not_folder" {
			t.Fatalf("FolderNameWithConnection(%q) mapped = %+v, want 422 drive_folder_not_folder", folderID, ce)
		}
	}

	// 6. Request-scoped parent cache: 2 children under same parent -> 1 parent call;
	// 2 children under distinct parents -> 2 parent calls; failed parent lookups are cached too.
	gSrv.SetFile("batch-same-1", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "batch-same-1", Name: "Same 1", MimeType: DriveMimeGoogleDoc, Parents: []string{"fld-batch-same"}},
	})
	gSrv.SetFile("batch-same-2", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "batch-same-2", Name: "Same 2", MimeType: DriveMimeGoogleDoc, Parents: []string{"fld-batch-same"}},
	})
	gSrv.SetFile("fld-batch-same", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "fld-batch-same", Name: "Shared Batch Folder", MimeType: DriveMimeGoogleFolder},
	})
	beforeSame := len(gSrv.Calls())
	cacheSame := make(driveFolderWalkCache)
	ms1, err := gSrv.Client.filesGetWithConnectionAndParentCache(ctx, tokens, conn, "batch-same-1", cacheSame)
	if err != nil || ms1.ParentFolderName != "Shared Batch Folder" {
		t.Fatalf("batch-same-1 = (%+v, %v)", ms1, err)
	}
	ms2, err := gSrv.Client.filesGetWithConnectionAndParentCache(ctx, tokens, conn, "batch-same-2", cacheSame)
	if err != nil || ms2.ParentFolderName != "Shared Batch Folder" {
		t.Fatalf("batch-same-2 = (%+v, %v)", ms2, err)
	}
	sameParentCalls := 0
	for _, c := range gSrv.Calls()[beforeSame:] {
		if c.FileID == "fld-batch-same" {
			sameParentCalls++
		}
	}
	if sameParentCalls != 1 {
		t.Fatalf("same parent calls = %d, want 1", sameParentCalls)
	}

	gSrv.SetFile("batch-diff-1", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "batch-diff-1", Name: "Diff 1", MimeType: DriveMimeGoogleDoc, Parents: []string{"fld-diff-a"}},
	})
	gSrv.SetFile("batch-diff-2", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "batch-diff-2", Name: "Diff 2", MimeType: DriveMimeGoogleDoc, Parents: []string{"fld-diff-b"}},
	})
	beforeDiff := len(gSrv.Calls())
	cacheDiff := make(driveFolderWalkCache)
	if _, err := gSrv.Client.filesGetWithConnectionAndParentCache(ctx, tokens, conn, "batch-diff-1", cacheDiff); err != nil {
		t.Fatal(err)
	}
	if _, err := gSrv.Client.filesGetWithConnectionAndParentCache(ctx, tokens, conn, "batch-diff-2", cacheDiff); err != nil {
		t.Fatal(err)
	}
	// Repeat batch-diff-1 (whose parent fld-diff-a 404'd) to prove failed lookups are also cached.
	if _, err := gSrv.Client.filesGetWithConnectionAndParentCache(ctx, tokens, conn, "batch-diff-1", cacheDiff); err != nil {
		t.Fatal(err)
	}
	diffParentCalls := 0
	for _, c := range gSrv.Calls()[beforeDiff:] {
		if c.FileID == "fld-diff-a" || c.FileID == "fld-diff-b" {
			diffParentCalls++
		}
	}
	if diffParentCalls != 2 {
		t.Fatalf("distinct parent calls = %d, want 2", diffParentCalls)
	}

	// 6b. Connection-scoped batch cache (RB1-1): two connections of the same viewer
	// with asymmetric folder grants must not share positive or negative folder entries.
	tokensMulti := &fakeDriveTokenSource{tokensByConn: map[string]string{
		"conn-a": "tok-conn-a",
		"conn-b": "tok-conn-b",
	}}
	connA := db.DriveConnection{ID: "conn-a"}
	connB := db.DriveConnection{ID: "conn-b"}
	gSrv.SetFile("file-asym", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "file-asym", Name: "Asym Doc", MimeType: DriveMimeGoogleDoc, Parents: []string{"fld-asym"}},
	})
	// Case 1 (negative then positive): conn-a gets 404 on fld-asym, conn-b gets 200.
	gSrv.SetFile("fld-asym", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "fld-asym", Name: "Asym Folder", MimeType: DriveMimeGoogleFolder},
		ErrorByToken: map[string]FakeGoogleDriveErrorResponse{
			"tok-conn-a": {Status: http.StatusNotFound, Reason: "notFound"},
		},
	})
	cacheNegPos := make(driveFolderWalkCache)
	mNegFirst, err := gSrv.Client.filesGetWithConnectionAndParentCache(ctx, tokensMulti, connA, "file-asym", cacheNegPos)
	if err != nil || len(mNegFirst.ResolvedFolders) != 0 || mNegFirst.ParentFolderName != "" {
		t.Fatalf("connA negative first = (%+v, %v), want 0 resolved folders", mNegFirst, err)
	}
	beforeConnB := len(gSrv.Calls())
	mPosSecond, err := gSrv.Client.filesGetWithConnectionAndParentCache(ctx, tokensMulti, connB, "file-asym", cacheNegPos)
	if err != nil {
		t.Fatalf("connB positive second: %v", err)
	}
	connBFolderCalls := 0
	for _, c := range gSrv.Calls()[beforeConnB:] {
		if c.FileID == "fld-asym" && c.Token == "tok-conn-b" {
			connBFolderCalls++
		}
	}
	if len(mPosSecond.ResolvedFolders) != 1 || mPosSecond.ParentFolderName != "Asym Folder" || connBFolderCalls != 1 {
		t.Fatalf("negative->positive: secondFolders=%d name=%q secondConnectionFolderCalls=%d, want 1, Asym Folder, 1",
			len(mPosSecond.ResolvedFolders), mPosSecond.ParentFolderName, connBFolderCalls)
	}
	// Case 2 (positive then negative): conn-b gets 200 on fld-asym, then conn-a gets 404 (must not reuse conn-b's success).
	cachePosNeg := make(driveFolderWalkCache)
	mPosFirst, err := gSrv.Client.filesGetWithConnectionAndParentCache(ctx, tokensMulti, connB, "file-asym", cachePosNeg)
	if err != nil || len(mPosFirst.ResolvedFolders) != 1 || mPosFirst.ParentFolderName != "Asym Folder" {
		t.Fatalf("connB positive first = (%+v, %v), want 1 resolved folder", mPosFirst, err)
	}
	beforeConnA := len(gSrv.Calls())
	mNegSecond, err := gSrv.Client.filesGetWithConnectionAndParentCache(ctx, tokensMulti, connA, "file-asym", cachePosNeg)
	if err != nil {
		t.Fatalf("connA negative second: %v", err)
	}
	connAFolderCalls := 0
	for _, c := range gSrv.Calls()[beforeConnA:] {
		if c.FileID == "fld-asym" && c.Token == "tok-conn-a" {
			connAFolderCalls++
		}
	}
	if len(mNegSecond.ResolvedFolders) != 0 || mNegSecond.ParentFolderName != "" || connAFolderCalls != 1 {
		t.Fatalf("positive->negative: secondFolders=%d name=%q secondConnectionFolderCalls=%d, want 0, \"\", 1",
			len(mNegSecond.ResolvedFolders), mNegSecond.ParentFolderName, connAFolderCalls)
	}

	// 7. Optional parent lookup runs under a child context with a 3s timeout
	// (configurable on DriveAPIClient for fast unit tests): when the parent
	// lookup blocks longer than the child budget, the parent request is canceled,
	// child metadata is still returned with unknown folder name, and the caller's
	// context remains active.
	gSrv.Client.parentLookupBudget = 50 * time.Millisecond
	defer func() { gSrv.Client.parentLookupBudget = 0 }()
	parentCanceled := make(chan struct{})
	gSrv.SetOverride(func(w http.ResponseWriter, r *http.Request, call FakeGoogleDriveCall) bool {
		if call.FileID == "fld-slow-parent" {
			<-r.Context().Done()
			close(parentCanceled)
			return true
		}
		return false
	})
	defer gSrv.SetOverride(nil)
	gSrv.SetFile("file-slow-parent", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "file-slow-parent",
			Name:     "Child With Slow Parent",
			MimeType: DriveMimeGoogleDoc,
			Parents:  []string{"fld-slow-parent"},
		},
	})
	callerCtx, callerCancel := context.WithTimeout(ctx, 5*time.Second)
	defer callerCancel()
	mSlow, err := gSrv.Client.FilesGetWithConnection(callerCtx, tokens, conn, "file-slow-parent")
	if err != nil {
		t.Fatalf("FilesGetWithConnection file-slow-parent: %v", err)
	}
	if mSlow.ParentFolderID != "fld-slow-parent" || mSlow.ParentFolderName != "" {
		t.Fatalf("mSlow folder = (%q, %q), want (fld-slow-parent, \"\")", mSlow.ParentFolderID, mSlow.ParentFolderName)
	}
	select {
	case <-parentCanceled:
	case <-time.After(time.Second):
		t.Fatalf("slow parent request was not canceled by child context timeout")
	}
	if callerCtx.Err() != nil {
		t.Fatalf("callerCtx err = %v, want nil", callerCtx.Err())
	}
}

// TestDriveAPIFolderWalkDepthCycleAndCache (UNI-2291) verifies without a database:
//   - FolderChainWithConnection walks multi-level parents C -> B -> A while 200 OK
//   - stops cleanly when an ancestor returns 404/403 (e.g. My Drive root)
//   - enforces driveFolderWalkMaxDepth = 10
//   - stops on cycle (X -> Y -> X or self-parent X -> X)
//   - FakeDriveProvider.SetFolderParent and SetFileParent support multi-level chains.
func TestDriveAPIFolderWalkDepthCycleAndCache(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	gSrv := NewFakeGoogleDriveServer(t.Cleanup)
	tokens := &fakeDriveTokenSource{tokensByConn: map[string]string{"conn-walk": "tok-walk"}}
	conn := db.DriveConnection{ID: "conn-walk"}

	// 1. A -> B -> C chain where A's parent is My Drive root (404).
	gSrv.SetFile("fld-a", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "fld-a", Name: "Branch A", MimeType: DriveMimeGoogleFolder, Parents: []string{"my-drive-root-404"}},
	})
	gSrv.SetFile("fld-b", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "fld-b", Name: "Mid B", MimeType: DriveMimeGoogleFolder, Parents: []string{"fld-a"}},
	})
	gSrv.SetFile("fld-c", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "fld-c", Name: "Leaf C", MimeType: DriveMimeGoogleFolder, Parents: []string{"fld-b"}},
	})
	gSrv.SetFile("file-in-c", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "file-in-c", Name: "Doc in C", MimeType: DriveMimeGoogleDoc, Parents: []string{"fld-c"}},
	})

	fMeta, err := gSrv.Client.FilesGetWithConnection(ctx, tokens, conn, "file-in-c")
	if err != nil {
		t.Fatalf("FilesGetWithConnection file-in-c: %v", err)
	}
	if fMeta.ParentFolderID != "fld-c" || fMeta.ParentFolderName != "Leaf C" {
		t.Fatalf("file-in-c parent = (%q, %q), want (fld-c, Leaf C)", fMeta.ParentFolderID, fMeta.ParentFolderName)
	}
	if len(fMeta.ResolvedFolders) != 3 ||
		fMeta.ResolvedFolders[0].FolderID != "fld-c" || fMeta.ResolvedFolders[0].ParentFolderID != "fld-b" ||
		fMeta.ResolvedFolders[1].FolderID != "fld-b" || fMeta.ResolvedFolders[1].ParentFolderID != "fld-a" ||
		fMeta.ResolvedFolders[2].FolderID != "fld-a" || fMeta.ResolvedFolders[2].ParentFolderID != "my-drive-root-404" {
		t.Fatalf("file-in-c ResolvedFolders = %+v", fMeta.ResolvedFolders)
	}

	chainC, err := gSrv.Client.FolderChainWithConnection(ctx, tokens, conn, "fld-c")
	if err != nil {
		t.Fatalf("FolderChainWithConnection fld-c: %v", err)
	}
	if len(chainC) != 3 || chainC[0].FolderID != "fld-c" || chainC[1].FolderID != "fld-b" || chainC[2].FolderID != "fld-a" {
		t.Fatalf("FolderChainWithConnection fld-c = %+v", chainC)
	}

	// 2. Cycle guard: cyc-1 -> cyc-2 -> cyc-1 terminates after visiting each once.
	gSrv.SetFile("cyc-1", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "cyc-1", Name: "Cycle 1", MimeType: DriveMimeGoogleFolder, Parents: []string{"cyc-2"}},
	})
	gSrv.SetFile("cyc-2", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: "cyc-2", Name: "Cycle 2", MimeType: DriveMimeGoogleFolder, Parents: []string{"cyc-1"}},
	})
	cycChain, err := gSrv.Client.FolderChainWithConnection(ctx, tokens, conn, "cyc-1")
	if err != nil {
		t.Fatalf("FolderChainWithConnection cyc-1: %v", err)
	}
	if len(cycChain) != 2 || cycChain[0].FolderID != "cyc-1" || cycChain[1].FolderID != "cyc-2" {
		t.Fatalf("cycChain = %+v, want [cyc-1, cyc-2]", cycChain)
	}

	// 3. Depth cap: 15-level chain stops at driveFolderWalkMaxDepth (10).
	for i := range 15 {
		id := "deep-" + string(rune('a'+i))
		parent := "deep-" + string(rune('a'+i+1))
		gSrv.SetFile(id, FakeGoogleDriveFile{
			Metadata: googleDriveFileJSON{ID: id, Name: "Deep " + id, MimeType: DriveMimeGoogleFolder, Parents: []string{parent}},
		})
	}
	deepChain, err := gSrv.Client.FolderChainWithConnection(ctx, tokens, conn, "deep-a")
	if err != nil {
		t.Fatalf("FolderChainWithConnection deep-a: %v", err)
	}
	if len(deepChain) != driveFolderWalkMaxDepth {
		t.Fatalf("len(deepChain) = %d, want %d", len(deepChain), driveFolderWalkMaxDepth)
	}

	// 4. FakeDriveProvider SetFolderParent / SetFileParent unit check.
	fp := NewFakeDriveProvider(config.Config{})
	fp.SetFolderParent("fake-c", "Fake C", "fake-b")
	fp.SetFolderParent("fake-b", "Fake B", "")
	fp.SetFileParent("fake-doc", "fake-c")
	fm, ferr := fp.FilesGet(ctx, "tok", "fake-doc")
	if ferr != nil || fm.ParentFolderID != "fake-c" {
		t.Fatalf("FakeDriveProvider.FilesGet = (%+v, %v)", fm, ferr)
	}
	fc, ferr := fp.FolderGet(ctx, "tok", "fake-c")
	if ferr != nil || fc.Name != "Fake C" || fc.ParentFolderID != "fake-b" {
		t.Fatalf("FakeDriveProvider.FolderGet = (%+v, %v)", fc, ferr)
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
	gSrv.SetFile("fld-ai-parent", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "fld-ai-parent",
			Name:     "AI Parent Folder",
			MimeType: DriveMimeGoogleFolder,
		},
	})
	gSrv.SetFile(extFileID, FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       extFileID,
			Name:     "RenamedOnDrive.docx",
			MimeType: DriveMimeDOCX,
			Parents:  []string{"fld-ai-parent"},
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
	metas := lookup.refreshedMetadata()
	if len(metas) == 0 || metas[len(metas)-1].Name != "RenamedOnDrive.docx" || len(metas[len(metas)-1].ResolvedFolders) != 1 || metas[len(metas)-1].ResolvedFolders[0].Name != "AI Parent Folder" {
		t.Fatalf("expected RecordFileMetadataRefresh with RenamedOnDrive.docx and ResolvedFolders, got %+v", metas)
	}
	if callers := lookup.refreshedCallers(); len(callers) == 0 || callers[len(callers)-1] != userID+"|"+wsID+"|"+driveFileID+"|"+conn.ID {
		t.Fatalf("expected RecordFileMetadataRefresh caller %s|%s|%s|%s, got %v", userID, wsID, driveFileID, conn.ID, callers)
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

	gSrv.SetFile("fld-f01", FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       "fld-f01",
			Name:     "F01 Folder",
			MimeType: DriveMimeGoogleFolder,
		},
	})
	gSrv.SetFile(extFileID, FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{
			ID:       extFileID,
			Name:     "F01 Private Doc",
			MimeType: DriveMimePlainText,
			Parents:  []string{"fld-f01"},
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
	if gotCalls := len(gSrv.Calls()); gotCalls != 3 {
		t.Fatalf("flag on + configured Google calls = %d, want 3 (files.get + parent folder + media)", gotCalls)
	}
	updatedRow := memDB.files[driveFileID]
	if !updatedRow.DriveFolderID.Valid || updatedRow.DriveFolderID.String != "fld-f01" || !updatedRow.DriveFolderName.Valid || updatedRow.DriveFolderName.String != "F01 Folder" {
		t.Fatalf("memDB.files[%s] folder = (%+v, %+v), want (fld-f01, F01 Folder)", driveFileID, updatedRow.DriveFolderID, updatedRow.DriveFolderName)
	}
}

// TestFakeDriveProviderContentMethodsAndNonFakeHTTPBranch verifies:
//  1. FakeDriveProvider.ExportFile (markdown, text/plain, text/csv, unsupported mime, empty id, maxBytes cap/cap+1).
//  2. FakeDriveProvider.DownloadMedia (plain text todo list, empty id, maxBytes cap/cap+1).
//  3. The fake branch in driveExportFile / driveDownloadMedia is ONLY taken when the
//     client uses the default Google API base URL AND the connection's provider is
//     *FakeDriveProvider; a non-fake provider (*GoogleDriveProvider) or a custom
//     httptest base URL still goes to HTTP.
func TestFakeDriveProviderContentMethodsAndNonFakeHTTPBranch(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	fp := NewFakeDriveProvider(config.Config{
		GoogleDriveClientID:     "fake-cid",
		GoogleDriveClientSecret: "fake-sec",
	})

	// 1. ExportFile MIME switch + content cues (due date + priority cue "gấp") + maxBytes.
	mdBytes, err := fp.ExportFile(ctx, "tok", "ext-doc-1", DriveMimeMarkdown, DriveExportMaxBytes)
	if err != nil {
		t.Fatalf("ExportFile(markdown): %v", err)
	}
	mdStr := string(mdBytes)
	if !strings.Contains(mdStr, "2026-11-15") || !strings.Contains(strings.ToLower(mdStr), "gấp") || strings.Count(mdStr, "- [ ]") < 3 {
		t.Fatalf("ExportFile(markdown) missing expected todo items/cues: %q", mdStr)
	}
	if _, err := fp.ExportFile(ctx, "tok", "ext-doc-1", DriveMimeMarkdown, int64(len(mdBytes))); err != nil {
		t.Fatalf("ExportFile(markdown exact maxBytes): %v", err)
	}
	if _, err := fp.ExportFile(ctx, "tok", "ext-doc-1", DriveMimeMarkdown, int64(len(mdBytes)-1)); !errors.Is(err, ErrDriveFileTooLarge) {
		t.Fatalf("ExportFile(markdown maxBytes-1) = %v, want ErrDriveFileTooLarge", err)
	}

	txtBytes, err := fp.ExportFile(ctx, "tok", "ext-slide-1", DriveMimePlainText, DriveExportMaxBytes)
	if err != nil {
		t.Fatalf("ExportFile(text/plain): %v", err)
	}
	if !strings.Contains(string(txtBytes), "2026-11-15") || !strings.Contains(strings.ToLower(string(txtBytes)), "gấp") {
		t.Fatalf("ExportFile(text/plain) unexpected content: %q", string(txtBytes))
	}

	csvBytes, err := fp.ExportFile(ctx, "tok", "ext-sheet-1", "text/csv", DriveExportMaxBytes)
	if err != nil {
		t.Fatalf("ExportFile(text/csv): %v", err)
	}
	csvLines := strings.Split(strings.TrimSpace(string(csvBytes)), "\n")
	if len(csvLines) < 2 || len(csvLines) > 4 || !strings.Contains(string(csvBytes), ",") {
		t.Fatalf("ExportFile(text/csv) expected 2-3 CSV rows, got %d: %q", len(csvLines), string(csvBytes))
	}

	if _, err := fp.ExportFile(ctx, "tok", "ext-doc-1", "application/zip", DriveExportMaxBytes); err == nil {
		t.Fatal("ExportFile(unsupported mime) expected error, got nil")
	}
	if _, err := fp.ExportFile(ctx, "tok", "   ", DriveMimeMarkdown, DriveExportMaxBytes); !errors.Is(err, ErrDriveFileNotAccessible) {
		t.Fatalf("ExportFile(empty id) = %v, want ErrDriveFileNotAccessible", err)
	}

	// 2. DownloadMedia plain text + maxBytes + empty id.
	mediaBytes, err := fp.DownloadMedia(ctx, "tok", "ext-txt-1", DrivePlainTextMaxBytes)
	if err != nil {
		t.Fatalf("DownloadMedia: %v", err)
	}
	if string(mediaBytes) != string(txtBytes) {
		t.Fatalf("DownloadMedia = %q, want same plain text todo list %q", string(mediaBytes), string(txtBytes))
	}
	if _, err := fp.DownloadMedia(ctx, "tok", "ext-txt-1", int64(len(mediaBytes))); err != nil {
		t.Fatalf("DownloadMedia(exact maxBytes): %v", err)
	}
	if _, err := fp.DownloadMedia(ctx, "tok", "ext-txt-1", int64(len(mediaBytes)-1)); !errors.Is(err, ErrDriveFileTooLarge) {
		t.Fatalf("DownloadMedia(maxBytes-1) = %v, want ErrDriveFileTooLarge", err)
	}
	if _, err := fp.DownloadMedia(ctx, "tok", "", DrivePlainTextMaxBytes); !errors.Is(err, ErrDriveFileNotAccessible) {
		t.Fatalf("DownloadMedia(empty id) = %v, want ErrDriveFileNotAccessible", err)
	}

	// 3. Prove the fake branch is ONLY taken for *FakeDriveProvider on the default
	// Google base URL, and a non-fake provider (*GoogleDriveProvider) still goes to HTTP.
	const (
		orgID       = "01ORG0000000000000000000F2"
		wsID        = "01WS00000000000000000000F2"
		userID      = "01USER000000000000000000F2"
		connID      = "01CONN000000000000000000F2"
		driveFileID = "01DFILE00000000000000000F2"
		extFileID   = "ext-nonfake-http-doc"
	)
	box := testDriveBox(t)
	connSvc := NewDriveConnectionService(nil, nil, nil, box)
	accEnc, err := connSvc.sealSecret("tok-nonfake-http")
	if err != nil {
		t.Fatal(err)
	}
	refEnc, err := connSvc.sealSecret("ref-nonfake-http")
	if err != nil {
		t.Fatal(err)
	}
	conn := db.DriveConnection{
		ID:              connID,
		OrganizationID:  orgID,
		UserID:          userID,
		Provider:        "google",
		GoogleSub:       "sub-nonfake-http",
		GoogleEmail:     "nonfake@example.com",
		RefreshTokenEnc: refEnc,
		AccessTokenEnc:  accEnc,
		AccessExpiresAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(time.Hour), Valid: true},
		Scopes:          "openid email " + DriveGoogleScope,
	}
	lookup := &fakeDriveFileAccessLookup{
		rows: map[string]driveFileAccessRow{
			userID + "|" + wsID + "|" + driveFileID: {
				DriveFileID:    driveFileID,
				OrganizationID: orgID,
				WorkspaceID:    wsID,
				ExternalFileID: extFileID,
				Name:           "Spec Doc",
				MimeType:       DriveMimeGoogleDoc,
				HasAccessRow:   true,
				AccessState:    "granted",
				Connection:     conn,
			},
		},
	}
	ws := newTestDriveWorkspaceService(map[string]string{wsID + "|" + userID: orgID})

	// 3a. With FakeDriveProvider and default DriveAPIClient (driveGoogleAPIBaseURL) whose
	// transport fails on any network call, ReadForAI succeeds purely in memory.
	connSvc.ConfigureOAuth(config.Config{
		AppEnv:            "development",
		DriveFakeProvider: true,
	})
	fakeClient := NewDriveAPIClient()
	fakeClient.httpClient.Transport = failingDriveRoundTripper{t: t}
	fakeContentSvc := NewDriveContentService(nil, nil, ws, lookup, connSvc, fakeClient, nil)
	fakeContentSvc.auditHook = func(_ context.Context, _ audit.Entry) error { return nil }

	dcFake, err := fakeContentSvc.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeTaskProposal)
	if err != nil {
		t.Fatalf("ReadForAI with FakeDriveProvider: %v", err)
	}
	if dcFake.Text != fakeDriveExportMarkdown || dcFake.Truncated {
		t.Fatalf("ReadForAI with FakeDriveProvider text = %q, want %q", dcFake.Text, fakeDriveExportMarkdown)
	}

	// 3b. With a non-fake provider (*GoogleDriveProvider, DriveFakeProvider=false) on a
	// client whose baseURL is driveGoogleAPIBaseURL and whose transport routes to an
	// httptest server, ReadForAI goes through HTTP (both files.get and files.export).
	var httpOps []string
	httpSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/export"):
			httpOps = append(httpOps, "export:"+r.URL.Query().Get("mimeType"))
			w.Header().Set("Content-Type", DriveMimeMarkdown)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("# From real HTTP server\n- HTTP task"))
		case r.URL.Query().Get("alt") == "media":
			httpOps = append(httpOps, "media")
			w.Header().Set("Content-Type", DriveMimePlainText)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("media from HTTP"))
		default:
			httpOps = append(httpOps, "get")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(googleDriveFileJSON{
				ID:       extFileID,
				Name:     "HTTP Spec Doc",
				MimeType: DriveMimeGoogleDoc,
			})
		}
	}))
	t.Cleanup(httpSrv.Close)

	connSvc.ConfigureOAuth(config.Config{
		AppEnv:                  "development",
		DriveFakeProvider:       false,
		GoogleDriveClientID:     "real-cid",
		GoogleDriveClientSecret: "real-sec",
	})
	srvURL, err := url.Parse(httpSrv.URL)
	if err != nil {
		t.Fatal(err)
	}
	realClient := NewDriveAPIClient()
	realClient.httpClient.Transport = rewriteHostRoundTripper{
		target: srvURL,
		base:   httpSrv.Client().Transport,
	}
	realContentSvc := NewDriveContentService(nil, nil, ws, lookup, connSvc, realClient, nil)
	realContentSvc.auditHook = func(_ context.Context, _ audit.Entry) error { return nil }

	dcReal, err := realContentSvc.ReadForAI(ctx, userID, wsID, driveFileID, DriveContentPurposeTaskProposal)
	if err != nil {
		t.Fatalf("ReadForAI with non-fake GoogleDriveProvider: %v", err)
	}
	if dcReal.Text != "# From real HTTP server\n- HTTP task" {
		t.Fatalf("ReadForAI with non-fake provider text = %q, want HTTP server response", dcReal.Text)
	}
	if !reflect.DeepEqual(httpOps, []string{"get", "export:text/markdown"}) {
		t.Fatalf("non-fake provider HTTP ops = %v, want [get export:text/markdown]", httpOps)
	}
}

type rewriteHostRoundTripper struct {
	target *url.URL
	base   http.RoundTripper
}

func (r rewriteHostRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.URL.Scheme = r.target.Scheme
	clone.URL.Host = r.target.Host
	clone.Host = r.target.Host
	return r.base.RoundTrip(clone)
}

// TestDriveOpportunisticRefreshAtomicRollbackUnit (UNI-2291 RB1-3) verifies without a live
// database that refreshFileWithViewerConnection executes folder upserts, workspace
// folder-name synchronization, and file metadata update inside one transaction, checking
// errors and rolling back atomically if any step fails.
func TestDriveOpportunisticRefreshAtomicRollbackUnit(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	gSrv := NewFakeGoogleDriveServer(t.Cleanup)
	box := testDriveBox(t)
	seal := func(plain string) string {
		s, serr := box.Seal([]byte(plain))
		if serr != nil {
			t.Fatal(serr)
		}
		return base64.StdEncoding.EncodeToString(s)
	}

	const (
		orgID    = "01ORG00000000000000000RB13"
		wsID     = "01WS000000000000000000RB13"
		userID   = "01USER0000000000000000RB13"
		connID   = "01CONN0000000000000000RB13"
		file1ID  = "01FILE0000000000000001RB13"
		file2ID  = "01FILE0000000000000002RB13"
		extFile1 = "ext-rb13-1"
		extFile2 = "ext-rb13-2"
		folderID = "fld-rb13-shared"
	)
	now := time.Now().UTC()
	wsRow := db.Workspace{ID: wsID, OrganizationID: orgID, Slug: "ws-rb13", Name: "WS RB13", TaskPrefix: "RB"}
	memDB := &memDriveUnitDBTX{
		admitted:   map[string]string{wsID + "|" + userID: orgID},
		workspaces: map[string]db.Workspace{wsID: wsRow},
		files: map[string]db.DriveFile{
			file1ID: {
				ID:              file1ID,
				OrganizationID:  orgID,
				WorkspaceID:     wsID,
				ExternalFileID:  extFile1,
				ConnectionID:    connID,
				BoundBy:         userID,
				CreatedBy:       userID,
				CreatedByKind:   "human",
				Name:            "Doc 1",
				MimeType:        DriveMimeGoogleDoc,
				IconKind:        "google_doc",
				SharingState:    DriveSharingStateShared,
				DriveFolderID:   pgtype.Text{String: folderID, Valid: true},
				DriveFolderName: pgtype.Text{String: "Old Folder Name", Valid: true},
			},
			file2ID: {
				ID:              file2ID,
				OrganizationID:  orgID,
				WorkspaceID:     wsID,
				ExternalFileID:  extFile2,
				ConnectionID:    connID,
				BoundBy:         userID,
				CreatedBy:       userID,
				CreatedByKind:   "human",
				Name:            "Doc 2",
				MimeType:        DriveMimeGoogleDoc,
				IconKind:        "google_doc",
				SharingState:    DriveSharingStateShared,
				DriveFolderID:   pgtype.Text{String: folderID, Valid: true},
				DriveFolderName: pgtype.Text{String: "Old Folder Name", Valid: true},
			},
		},
		folders: map[string]db.DriveFolder{
			wsID + "|" + folderID: {
				ID:             "01FLDR0000000000000000RB13",
				OrganizationID: orgID,
				WorkspaceID:    wsID,
				ConnectionID:   connID,
				DriveFolderID:  folderID,
				Name:           "Old Folder Name",
			},
		},
		access: map[string]db.DriveFileAccess{
			file1ID + "|" + userID: {
				ID:             "01ACC00000000000000001RB13",
				OrganizationID: orgID,
				WorkspaceID:    wsID,
				DriveFileID:    file1ID,
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
				GoogleSub:       "sub-rb13",
				GoogleEmail:     "rb13@example.com",
				RefreshTokenEnc: seal("tok-r-rb13"),
				AccessTokenEnc:  seal("tok-a-rb13"),
				AccessExpiresAt: pgtype.Timestamptz{Time: now.Add(time.Hour), Valid: true},
				Scopes:          "openid email " + DriveGoogleScope,
			},
		},
	}

	gSrv.SetFile(folderID, FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: folderID, Name: "New Folder Name", MimeType: DriveMimeGoogleFolder},
	})
	gSrv.SetFile(extFile1, FakeGoogleDriveFile{
		Metadata: googleDriveFileJSON{ID: extFile1, Name: "Doc 1 Renamed", MimeType: DriveMimeGoogleDoc, Parents: []string{folderID}},
	})

	q := db.New(memDB)
	ws := &WorkspaceService{q: q}
	connSvc := NewDriveConnectionService(nil, q, ws, box)
	fileSvc := NewDriveFileService(nil, q, ws, connSvc, gSrv.Client)
	fileSvc.testBeginRefreshTx = func(context.Context) (*db.Queries, func(context.Context) error, func(context.Context) error, error) {
		return memDB.beginTx()
	}

	staleRefreshedAt := pgtype.Timestamptz{Time: now.Add(-15 * time.Minute), Valid: true}
	f1Init := memDB.files[file1ID]
	f1Init.MetadataRefreshedAt = staleRefreshedAt
	memDB.files[file1ID] = f1Init

	// 0. When TryLockDriveFolderGraph reports busy (locked=false), refresh skips
	// persistence without stamping metadata_refreshed_at (restoring the pre-claim
	// stale timestamp so the next request retries; D-LOCK, RB2-1).
	memDB.tryLockGraphBusy = true
	if ok := fileSvc.refreshFileWithViewerConnection(ctx, userID, wsRow, file1ID, extFile1, connID, staleRefreshedAt, nil); ok {
		t.Fatalf("refreshFileWithViewerConnection succeeded when TryLockDriveFolderGraph was busy")
	}
	if got := memDB.folders[wsID+"|"+folderID].Name; got != "Old Folder Name" {
		t.Fatalf("drive_folders.name when try-lock busy = %q, want Old Folder Name", got)
	}
	if got := memDB.files[file1ID].Name; got != "Doc 1" {
		t.Fatalf("file1 name when try-lock busy = %q, want Doc 1", got)
	}
	if gotRef := memDB.files[file1ID].MetadataRefreshedAt; !gotRef.Valid || !gotRef.Time.Equal(staleRefreshedAt.Time) {
		t.Fatalf("file1 metadata_refreshed_at when try-lock busy = %+v, want restored stale %+v (not stamped)", gotRef, staleRefreshedAt)
	}
	if !fileSvc.isMetadataStale(memDB.files[file1ID].MetadataRefreshedAt) {
		t.Fatalf("file1 metadata_refreshed_at must remain stale after busy try-lock skip so next request retries")
	}
	memDB.tryLockGraphBusy = false

	// 1. Failure in SetDriveFolderNameInWorkspace must roll back UpsertDriveFolder and fail refresh cleanly.
	memDB.failSetFolderName = true
	if ok := fileSvc.refreshFileWithViewerConnection(ctx, userID, wsRow, file1ID, extFile1, connID, staleRefreshedAt, nil); ok {
		t.Fatalf("refreshFileWithViewerConnection succeeded when SetDriveFolderNameInWorkspace failed")
	}
	if got := memDB.folders[wsID+"|"+folderID].Name; got != "Old Folder Name" {
		t.Fatalf("drive_folders.name after SetDriveFolderNameInWorkspace failure = %q, want Old Folder Name (rolled back)", got)
	}
	if got := memDB.files[file1ID].DriveFolderName.String; got != "Old Folder Name" {
		t.Fatalf("file1 drive_folder_name after failure = %q, want Old Folder Name", got)
	}
	memDB.failSetFolderName = false

	// 2. Failure in UpdateDriveFileMetadata must roll back both UpsertDriveFolder and SetDriveFolderNameInWorkspace.
	memDB.failUpdateFile = true
	if ok := fileSvc.refreshFileWithViewerConnection(ctx, userID, wsRow, file1ID, extFile1, connID, staleRefreshedAt, nil); ok {
		t.Fatalf("refreshFileWithViewerConnection succeeded when UpdateDriveFileMetadata failed")
	}
	if got := memDB.folders[wsID+"|"+folderID].Name; got != "Old Folder Name" {
		t.Fatalf("drive_folders.name after UpdateDriveFileMetadata failure = %q, want Old Folder Name (rolled back)", got)
	}
	if got := memDB.files[file2ID].DriveFolderName.String; got != "Old Folder Name" {
		t.Fatalf("sibling file2 drive_folder_name after failure = %q, want Old Folder Name (rolled back)", got)
	}
	memDB.failUpdateFile = false

	// 3. When all writes succeed, folder upsert, sibling folder-name sync, and file snapshot commit together.
	if ok := fileSvc.refreshFileWithViewerConnection(ctx, userID, wsRow, file1ID, extFile1, connID, staleRefreshedAt, nil); !ok {
		t.Fatalf("refreshFileWithViewerConnection failed on clean run")
	}
	if got := memDB.folders[wsID+"|"+folderID].Name; got != "New Folder Name" {
		t.Fatalf("drive_folders.name after clean refresh = %q, want New Folder Name", got)
	}
	if got := memDB.files[file1ID].DriveFolderName.String; got != "New Folder Name" {
		t.Fatalf("file1 drive_folder_name after clean refresh = %q, want New Folder Name", got)
	}
	if got := memDB.files[file2ID].DriveFolderName.String; got != "New Folder Name" {
		t.Fatalf("file2 drive_folder_name after clean refresh = %q, want New Folder Name", got)
	}
}

// TestPruneOrphanedWorkspaceDriveFoldersInTxUnit (D-F4, UNI-2291) verifies DB-free via memDriveUnitDBTX:
//   - While at least one active file remains under C (whose ancestor is B), both B and C survive
//     pruneOrphanedWorkspaceDriveFoldersInTx, and GetWorkspaceDriveFolderName continues to return their names.
//   - Once the last active file under C is unlinked, both C and ancestor B are deleted from drive_folders,
//     and GetWorkspaceDriveFolderName returns "" so a subsequent child link with 404 folder lookup cannot
//     copy the unlinked folder name.
func TestPruneOrphanedWorkspaceDriveFoldersInTxUnit(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	orgID := "org-prune-unit"
	wsID := "ws-prune-unit"
	wsRow := db.Workspace{ID: wsID, OrganizationID: orgID}

	memDB := &memDriveUnitDBTX{
		workspaces: map[string]db.Workspace{wsID: wsRow},
		folders: map[string]db.DriveFolder{
			wsID + "|fld-b": {
				ID:             "df-b",
				OrganizationID: orgID,
				WorkspaceID:    wsID,
				DriveFolderID:  "fld-b",
				Name:           "Ancestor B",
			},
			wsID + "|fld-c": {
				ID:             "df-c",
				OrganizationID: orgID,
				WorkspaceID:    wsID,
				DriveFolderID:  "fld-c",
				Name:           "Child C",
				ParentFolderID: pgtype.Text{String: "fld-b", Valid: true},
			},
			wsID + "|fld-picked": {
				ID:             "df-picked",
				OrganizationID: orgID,
				WorkspaceID:    wsID,
				DriveFolderID:  "fld-picked",
				Name:           "Picked Folder",
			},
		},
		files: map[string]db.DriveFile{
			"file-c-1": {
				ID:              "file-c-1",
				OrganizationID:  orgID,
				WorkspaceID:     wsID,
				DriveFolderID:   pgtype.Text{String: "fld-c", Valid: true},
				DriveFolderName: pgtype.Text{String: "Child C", Valid: true},
			},
			"file-c-2": {
				ID:              "file-c-2",
				OrganizationID:  orgID,
				WorkspaceID:     wsID,
				DriveFolderID:   pgtype.Text{String: "fld-c", Valid: true},
				DriveFolderName: pgtype.Text{String: "Child C", Valid: true},
			},
			"file-picked": {
				ID:              "file-picked",
				OrganizationID:  orgID,
				WorkspaceID:     wsID,
				DriveFolderID:   pgtype.Text{String: "fld-picked", Valid: true},
				DriveFolderName: pgtype.Text{String: "Picked Folder", Valid: true},
				UnlinkedAt:      pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
			},
		},
	}
	q := db.New(memDB)

	// 1. file-picked is already unlinked while file-c-1 and file-c-2 are active under fld-c:
	// prune removes fld-picked and keeps both fld-c and its ancestor fld-b.
	if err := pruneOrphanedWorkspaceDriveFoldersInTx(ctx, q, wsRow); err != nil {
		t.Fatalf("pruneOrphanedWorkspaceDriveFoldersInTx step 1: %v", err)
	}
	if _, exists := memDB.folders[wsID+"|fld-picked"]; exists {
		t.Fatalf("fld-picked still in drive_folders after its sole file was unlinked")
	}
	if namePicked, err := q.GetWorkspaceDriveFolderName(ctx, db.GetWorkspaceDriveFolderNameParams{
		OrganizationID: orgID,
		WorkspaceID:    wsID,
		DriveFolderID:  "fld-picked",
	}); err != nil || namePicked != "" {
		t.Fatalf("GetWorkspaceDriveFolderName(fld-picked) after prune = %q (err=%v), want empty", namePicked, err)
	}
	if _, exists := memDB.folders[wsID+"|fld-b"]; !exists {
		t.Fatalf("ancestor fld-b was pruned while active files remained under fld-c")
	}
	if _, exists := memDB.folders[wsID+"|fld-c"]; !exists {
		t.Fatalf("child fld-c was pruned while active files remained under fld-c")
	}

	// 2. Unlink file-c-1 while file-c-2 stays active: both fld-b and fld-c still survive.
	f1 := memDB.files["file-c-1"]
	f1.UnlinkedAt = pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	memDB.files["file-c-1"] = f1
	if err := pruneOrphanedWorkspaceDriveFoldersInTx(ctx, q, wsRow); err != nil {
		t.Fatalf("pruneOrphanedWorkspaceDriveFoldersInTx step 2: %v", err)
	}
	if _, exists := memDB.folders[wsID+"|fld-b"]; !exists {
		t.Fatalf("ancestor fld-b was pruned after first unlink while file-c-2 remained active")
	}

	// 3. Unlink the last active file (file-c-2): both fld-c and ancestor fld-b are pruned.
	f2 := memDB.files["file-c-2"]
	f2.UnlinkedAt = pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	memDB.files["file-c-2"] = f2
	if err := pruneOrphanedWorkspaceDriveFoldersInTx(ctx, q, wsRow); err != nil {
		t.Fatalf("pruneOrphanedWorkspaceDriveFoldersInTx step 3: %v", err)
	}
	if len(memDB.folders) != 0 {
		t.Fatalf("drive_folders after unlinking all active files = %+v, want empty", memDB.folders)
	}

	// 4. Deep stored chain > 10 hops (f00 <- f01 <- ... <- f11) and reachable cycle
	// in pruneOrphanedWorkspaceDriveFoldersInTx (RB2-2): unlinking an unrelated file
	// retains every ancestor of active f11 (including f00 at depth 11) and the reachable cycle.
	for i := range 12 {
		fid := "f" + string(rune('0'+i/10)) + string(rune('0'+i%10))
		var parent pgtype.Text
		if i > 0 {
			pid := "f" + string(rune('0'+(i-1)/10)) + string(rune('0'+(i-1)%10))
			parent = pgtype.Text{String: pid, Valid: true}
		}
		memDB.folders[wsID+"|"+fid] = db.DriveFolder{
			ID:             "df-" + fid,
			OrganizationID: orgID,
			WorkspaceID:    wsID,
			DriveFolderID:  fid,
			Name:           "Deep " + fid,
			ParentFolderID: parent,
		}
	}
	memDB.folders[wsID+"|cyc-a"] = db.DriveFolder{
		ID:             "df-cyc-a",
		OrganizationID: orgID,
		WorkspaceID:    wsID,
		DriveFolderID:  "cyc-a",
		Name:           "Cyc A",
		ParentFolderID: pgtype.Text{String: "cyc-b", Valid: true},
	}
	memDB.folders[wsID+"|cyc-b"] = db.DriveFolder{
		ID:             "df-cyc-b",
		OrganizationID: orgID,
		WorkspaceID:    wsID,
		DriveFolderID:  "cyc-b",
		Name:           "Cyc B",
		ParentFolderID: pgtype.Text{String: "cyc-a", Valid: true},
	}
	memDB.folders[wsID+"|unrelated"] = db.DriveFolder{
		ID:             "df-unrelated",
		OrganizationID: orgID,
		WorkspaceID:    wsID,
		DriveFolderID:  "unrelated",
		Name:           "Unrelated",
	}
	memDB.files["file-deep-leaf"] = db.DriveFile{
		ID:             "file-deep-leaf",
		OrganizationID: orgID,
		WorkspaceID:    wsID,
		DriveFolderID:  pgtype.Text{String: "f11", Valid: true},
	}
	memDB.files["file-cyc"] = db.DriveFile{
		ID:             "file-cyc",
		OrganizationID: orgID,
		WorkspaceID:    wsID,
		DriveFolderID:  pgtype.Text{String: "cyc-a", Valid: true},
	}
	if err := pruneOrphanedWorkspaceDriveFoldersInTx(ctx, q, wsRow); err != nil {
		t.Fatalf("pruneOrphanedWorkspaceDriveFoldersInTx deep chain: %v", err)
	}
	if _, exists := memDB.folders[wsID+"|unrelated"]; exists {
		t.Fatalf("unrelated folder was not pruned")
	}
	for i := range 12 {
		fid := "f" + string(rune('0'+i/10)) + string(rune('0'+i%10))
		if _, exists := memDB.folders[wsID+"|"+fid]; !exists {
			t.Fatalf("ancestor %s in 12-node active chain was wrongly pruned", fid)
		}
	}
	if _, exists := memDB.folders[wsID+"|cyc-a"]; !exists {
		t.Fatalf("reachable cycle node cyc-a was wrongly pruned")
	}
	if _, exists := memDB.folders[wsID+"|cyc-b"]; !exists {
		t.Fatalf("reachable cycle node cyc-b was wrongly pruned")
	}
}
