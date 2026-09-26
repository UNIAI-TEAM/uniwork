package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// FileAccessService is the HTTP-facing read path of FileService for the one
// context FileService itself authorizes: the upload session (T4, spec section
// 8).
// An uploader may see the files they staged in a workspace - a preview before
// the module that asked for the upload claims them - and nothing else. A
// claimed file is read only through the module that references it, under that
// module's permission (T1-Q3); this service answers file_not_found for it.
//
// Native <img>/<audio>/<video> cannot send the Bearer header the API uses, so
// a proxy-mode file is served through a ticket: a short HMAC over the user,
// the auth session, the workspace, the file and the disposition. The ticket
// only says who asked; every request under it re-checks the auth session is
// still live, the workspace membership, the file state and the upload session,
// so logging out, revoking the session or leaving the workspace closes the
// route at once. A ticket is never a bearer URL that outlives permission.
type FileAccessService struct {
	files      *FileService
	workspaces *WorkspaceService
	q          *db.Queries
	key        []byte
}

// FileAccessOptions wires a FileAccessService. Secret is the server's token
// secret (JWT_SECRET); the ticket key is derived from it, so the raw secret
// never signs a URL and no new variable is needed.
type FileAccessOptions struct {
	Files      *FileService
	Workspaces *WorkspaceService
	Secret     []byte
}

// MaxFileAccessBatch caps one resolve request; a screen that shows more files
// pages them.
const MaxFileAccessBatch = 100

// fileContentPathPrefix is the proxy route (router/files.go); the file id and
// ticket follow.
const fileContentPathPrefix = "/api/v1/files/"

// Ticket errors. Every one answers the same 404 on the proxy route, so a
// guessed, forged, expired or revoked ticket looks exactly like a missing
// file.
var errFileTicketInvalid = errors.New("files: access ticket is invalid or expired")

// NewFileAccessService validates the wiring.
func NewFileAccessService(opts FileAccessOptions) (*FileAccessService, error) {
	if opts.Files == nil {
		return nil, errors.New("files: FileAccessService needs the FileService")
	}
	if opts.Workspaces == nil {
		return nil, errors.New("files: FileAccessService needs the WorkspaceService")
	}
	if len(opts.Secret) < 32 {
		return nil, errors.New("files: FileAccessService needs a secret of at least 32 bytes")
	}
	mac := hmac.New(sha256.New, opts.Secret)
	mac.Write([]byte("uniwork/file-access-ticket/v1"))
	return &FileAccessService{
		files:      opts.Files,
		workspaces: opts.Workspaces,
		q:          opts.Files.q,
		key:        mac.Sum(nil),
	}, nil
}

// FileAccessFile is the technical view the API may show: never the locator,
// bucket, key or session scope.
type FileAccessFile struct {
	ID          string
	Filename    string
	ContentType string
	SizeBytes   int64
	Status      string
	Metadata    map[string]any
	ReadyAt     time.Time
}

// File access modes, as the API names them.
const (
	FileAccessPresign = "presign"
	FileAccessProxy   = "proxy"
)

// FileAccessItem is one entry of a resolve batch, in request order. Err is a
// CodedError with the FS-C1 section 7 code when the id is refused; File, URL
// and URLExpiresAt are then empty, so a UI can never keep showing a URL for a
// revoked or deleting file. Access says which promise URL makes: presign names
// the storage host and object path, proxy hides both behind the API.
type FileAccessItem struct {
	FileID       string
	File         *FileAccessFile
	Access       string
	URL          string
	URLExpiresAt time.Time
	Err          error
}

// FileAccessRequest is one resolve call. SessionID is the auth session the
// Bearer token carries; a proxy ticket is bound to it.
type FileAccessRequest struct {
	UserID      string
	SessionID   string
	WorkspaceID string
	FileIDs     []string
	Disposition string
}

// ResolveUploads resolves the caller's own staged uploads in a workspace. The
// workspace gate runs first (RequireMember); a file the caller did not stage
// there, or one already claimed, is file_not_found in its own entry.
func (s *FileAccessService) ResolveUploads(ctx context.Context, in FileAccessRequest) ([]FileAccessItem, error) {
	if len(in.FileIDs) == 0 {
		return nil, ValidationError{Msg: "file_ids is required"}
	}
	if len(in.FileIDs) > MaxFileAccessBatch {
		return nil, ValidationError{Msg: fmt.Sprintf("at most %d file_ids per request", MaxFileAccessBatch)}
	}
	disposition, err := parseDisposition(in.Disposition)
	if err != nil {
		return nil, err
	}
	scope, err := s.uploadScope(ctx, in.WorkspaceID, in.UserID)
	if err != nil {
		return nil, err
	}
	ids := make([]files.FileID, 0, len(in.FileIDs))
	for _, id := range in.FileIDs {
		ids = append(ids, files.FileID(strings.TrimSpace(id)))
	}
	resolved, err := s.files.resolveRecords(ctx, scope, nil, disposition, ids, stagedBy(in.UserID))
	if err != nil {
		return nil, err
	}
	now := s.files.now()
	var sessionEnd time.Time
	out := make([]FileAccessItem, 0, len(resolved))
	for i, r := range resolved {
		item := FileAccessItem{FileID: string(ids[i])}
		if r.Err != nil {
			item.Err = filesError(r.Err)
			out = append(out, item)
			continue
		}
		view := accessFile(r.File)
		item.File = &view
		if r.URL != "" {
			item.Access = FileAccessPresign
			item.URL = r.URL
			item.URLExpiresAt = r.URLExpiresAt
			out = append(out, item)
			continue
		}
		// Proxy mode: a ticket no longer than 12 hours, the claim window or
		// the auth session, whichever ends first.
		if sessionEnd.IsZero() {
			if sessionEnd, err = s.liveSessionEnd(ctx, in.UserID, in.SessionID, now); err != nil {
				return nil, err
			}
		}
		expires := now.Add(files.MaxResolveURLTTL)
		if sessionEnd.Before(expires) {
			expires = sessionEnd
		}
		if !r.ClaimWindowEnds.IsZero() && r.ClaimWindowEnds.Before(expires) {
			expires = r.ClaimWindowEnds
		}
		ticket := s.signTicket(accessTicket{
			UserID: in.UserID, SessionID: in.SessionID, WorkspaceID: in.WorkspaceID,
			FileID: string(r.File.ID), Disposition: disposition, ExpiresAt: expires,
		})
		item.Access = FileAccessProxy
		item.URL = fileContentPathPrefix + url.PathEscape(string(r.File.ID)) + "/content?ticket=" + url.QueryEscape(ticket)
		item.URLExpiresAt = expires
		out = append(out, item)
	}
	return out, nil
}

// FileContent is an authorized proxy read. Open streams a window of it; the
// caller closes the body.
type FileContent struct {
	FileID             string
	SizeBytes          int64
	ContentType        string
	ContentDisposition string
	open               func(ctx context.Context, offset, length int64) (io.ReadCloser, error)
}

// Open streams [offset, offset+length) of the file; length 0 means to the end.
// It re-checks the file state and the upload session, so a file that turned
// deleting between the authorization and the read is refused.
func (c FileContent) Open(ctx context.Context, offset, length int64) (io.ReadCloser, error) {
	return c.open(ctx, offset, length)
}

// AuthorizeContent checks one proxy request: the ticket (signature, expiry,
// file), the auth session behind it, the workspace membership and the file.
// Any failure of the ticket or session is ErrNotFound, the same answer as a
// missing file, so the route reveals nothing to a stranger holding a URL.
func (s *FileAccessService) AuthorizeContent(ctx context.Context, fileID, ticket string) (FileContent, error) {
	now := s.files.now()
	t, err := s.verifyTicket(ticket, fileID, now)
	if err != nil {
		return FileContent{}, ErrNotFound
	}
	if _, err := s.liveSessionEnd(ctx, t.UserID, t.SessionID, now); err != nil {
		if errors.Is(err, errFileTicketInvalid) {
			return FileContent{}, ErrNotFound
		}
		return FileContent{}, err
	}
	scope, err := s.uploadScope(ctx, t.WorkspaceID, t.UserID)
	if err != nil {
		return FileContent{}, err
	}
	id := files.FileID(fileID)
	keep := stagedBy(t.UserID)
	resolved, err := s.files.resolveRecords(ctx, scope, nil, t.Disposition, []files.FileID{id}, keep)
	if err != nil {
		return FileContent{}, err
	}
	if resolved[0].Err != nil {
		return FileContent{}, filesError(resolved[0].Err)
	}
	view := resolved[0].File
	return FileContent{
		FileID:             fileID,
		SizeBytes:          view.SizeBytes,
		ContentType:        view.ContentType,
		ContentDisposition: fileContentDisposition(view, t.Disposition),
		open: func(ctx context.Context, offset, length int64) (io.ReadCloser, error) {
			rd, err := s.files.openRecord(ctx, files.OpenInput{Scope: scope, FileID: id, Offset: offset, Length: length}, keep)
			if err != nil {
				return nil, filesError(err)
			}
			return rd.Body, nil
		},
	}, nil
}

// uploadScope is the workspace gate plus the tenant the files must carry. The
// organization comes from the workspace row after membership is proven, never
// from the request.
func (s *FileAccessService) uploadScope(ctx context.Context, workspaceID, userID string) (files.Scope, error) {
	if _, err := s.workspaces.RequireMember(ctx, workspaceID, userID); err != nil {
		return files.Scope{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return files.Scope{}, ErrNotFound
	}
	if err != nil {
		return files.Scope{}, err
	}
	return files.Scope{OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID}, nil
}

// stagedBy is the upload-session context: the caller opened the session as a
// human, and no module has claimed the file yet. Canceled and expired
// sessions pass so the entry carries their own code (upload canceled, claim
// expired) instead of a bare not-found.
func stagedBy(userID string) resolveFilter {
	return func(rec fileRecord) bool {
		return rec.session.CreatedBy == userID &&
			rec.session.CreatedByKind == string(audit.KindHuman) &&
			files.SessionStatus(rec.session.Status) != files.SessionClaimed
	}
}

// liveSessionEnd is when the caller's auth session stops being refreshable,
// or errFileTicketInvalid when it is revoked, expired or absent. A token
// without a session id (minted before sessions had ids) cannot bind a ticket.
func (s *FileAccessService) liveSessionEnd(ctx context.Context, userID, sessionID string, now time.Time) (time.Time, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(sessionID) == "" {
		return time.Time{}, errFileTicketInvalid
	}
	end, err := s.q.GetLiveAuthSessionExpiry(ctx, db.GetLiveAuthSessionExpiryParams{
		UserID: userID, SessionID: sessionID, Now: fileTime(now),
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, fmt.Errorf("files: auth session: %w", err)
	}
	if !end.Valid || !end.Time.After(now) {
		return time.Time{}, errFileTicketInvalid
	}
	return end.Time.UTC().Truncate(time.Microsecond), nil
}

func parseDisposition(v string) (files.Disposition, error) {
	switch strings.TrimSpace(v) {
	case "", string(files.DispositionInline):
		return files.DispositionInline, nil
	case string(files.DispositionAttachment):
		return files.DispositionAttachment, nil
	default:
		return "", ValidationError{Msg: "disposition must be inline or attachment"}
	}
}

func accessFile(f files.File) FileAccessFile {
	return FileAccessFile{
		ID:          string(f.ID),
		Filename:    f.Filename,
		ContentType: f.ContentType,
		SizeBytes:   f.SizeBytes,
		Status:      string(f.Status),
		Metadata:    f.Metadata,
		ReadyAt:     f.ReadyAt,
	}
}

// --- tickets -----------------------------------------------------------------

// accessTicket is what a proxy URL carries. The file id is signed but not
// encoded: it comes from the path, so a ticket for one file cannot open
// another.
type accessTicket struct {
	UserID      string
	SessionID   string
	WorkspaceID string
	FileID      string
	Disposition files.Disposition
	ExpiresAt   time.Time
}

const ticketVersion = "t1"

// signTicket encodes the claims and appends an HMAC over them and the file id.
func (s *FileAccessService) signTicket(t accessTicket) string {
	claims := strings.Join([]string{
		ticketVersion, t.UserID, t.SessionID, t.WorkspaceID, string(t.Disposition),
		strconv.FormatInt(t.ExpiresAt.UnixMicro(), 10),
	}, "\n")
	enc := base64.RawURLEncoding.EncodeToString([]byte(claims))
	return enc + "." + base64.RawURLEncoding.EncodeToString(s.ticketMAC(enc, t.FileID))
}

func (s *FileAccessService) ticketMAC(encodedClaims, fileID string) []byte {
	mac := hmac.New(sha256.New, s.key)
	mac.Write([]byte(encodedClaims))
	mac.Write([]byte{0})
	mac.Write([]byte(fileID))
	return mac.Sum(nil)
}

// verifyTicket checks signature, shape and expiry against the service clock.
func (s *FileAccessService) verifyTicket(ticket, fileID string, now time.Time) (accessTicket, error) {
	enc, sig, ok := strings.Cut(ticket, ".")
	if !ok || enc == "" || sig == "" || fileID == "" {
		return accessTicket{}, errFileTicketInvalid
	}
	gotMAC, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(gotMAC, s.ticketMAC(enc, fileID)) {
		return accessTicket{}, errFileTicketInvalid
	}
	raw, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil {
		return accessTicket{}, errFileTicketInvalid
	}
	parts := strings.Split(string(raw), "\n")
	if len(parts) != 6 || parts[0] != ticketVersion {
		return accessTicket{}, errFileTicketInvalid
	}
	exp, err := strconv.ParseInt(parts[5], 10, 64)
	if err != nil {
		return accessTicket{}, errFileTicketInvalid
	}
	disposition, err := parseDisposition(parts[4])
	if err != nil {
		return accessTicket{}, errFileTicketInvalid
	}
	t := accessTicket{
		UserID: parts[1], SessionID: parts[2], WorkspaceID: parts[3],
		FileID: fileID, Disposition: disposition, ExpiresAt: time.UnixMicro(exp).UTC(),
	}
	if !now.Before(t.ExpiresAt) || t.UserID == "" || t.SessionID == "" || t.WorkspaceID == "" {
		return accessTicket{}, errFileTicketInvalid
	}
	return t, nil
}
