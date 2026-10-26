package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	driveGoogleAPIBaseURL  = "https://www.googleapis.com/drive/v3"
	driveAPIDefaultTimeout = 15 * time.Second
	driveAPIMaxRedirects   = 5
	driveMetadataMaxBytes  = 1 << 20 // 1 MiB metadata response ceiling
	driveErrorBodyMaxBytes = 64 << 10

	// driveFilesGetFields is the exact field mask spec §6.2 and §7.2 step 2 require
	// when reading a linked Google Drive file's metadata.
	driveFilesGetFields = "id,name,mimeType,webViewLink,iconLink,driveId,owners(displayName),lastModifyingUser(displayName),modifiedTime,shared,trashed,permissions(id)"
)

var (
	// ErrDriveBlockedByWorkspaceAdmin is returned when a Google Workspace admin
	// policy blocks the app at the Drive API (403 reason=domainPolicy; spec §5.7).
	ErrDriveBlockedByWorkspaceAdmin = errors.New("blocked_by_workspace_admin")
	// ErrDriveFileTooLarge is returned when a downloaded or exported Drive file
	// exceeds its per-format byte ceiling (spec §8.3).
	ErrDriveFileTooLarge = errors.New("drive_file_too_large")
)

// DriveErrorClass classifies a Google Drive API error according to spec §5.7.
type DriveErrorClass string

const (
	DriveErrorClassGrantRequired      DriveErrorClass = "drive_grant_required"
	DriveErrorClassBlockedByAdmin     DriveErrorClass = "blocked_by_workspace_admin"
	DriveErrorClassFileNotAccessible  DriveErrorClass = "drive_file_not_accessible"
	DriveErrorClassUnavailable        DriveErrorClass = "drive_unavailable"
	DriveErrorClassAuthFailed         DriveErrorClass = "auth_failed"
	DriveErrorClassAuthenticationNeed DriveErrorClass = "auth_error"
)

// DriveAPIError is a classified error from the Google Drive REST API (spec §5.7).
//
// MarkAccessLost is true only when Class == DriveErrorClassFileNotAccessible
// (Google reasons notFound, insufficientFilePermissions, forbidden, or a
// trashed file): the caller in B4/B5/B8 records drive_file_access.state = lost
// for that user (and drive_files.access_lost_at when the connection is the file's
// bound connection). Transient errors (rate limit, 5xx, timeout) leave
// MarkAccessLost false so stored state is never mutated on a temporary outage.
type DriveAPIError struct {
	Class          DriveErrorClass
	HTTPStatus     int
	GoogleReason   string
	MarkAccessLost bool
	RateLimited    bool
	Err            error
}

func (e *DriveAPIError) Error() string {
	if e == nil {
		return ""
	}
	if e.GoogleReason != "" {
		return fmt.Sprintf("drive api %s (status=%d reason=%s)", e.Class, e.HTTPStatus, e.GoogleReason)
	}
	if e.HTTPStatus != 0 {
		return fmt.Sprintf("drive api %s (status=%d)", e.Class, e.HTTPStatus)
	}
	return fmt.Sprintf("drive api %s", e.Class)
}

func (e *DriveAPIError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// Is lets errors.Is match the seam sentinel errors in drive_content_seam.go
// and drive_connections.go directly against a *DriveAPIError.
func (e *DriveAPIError) Is(target error) bool {
	if e == nil {
		return false
	}
	switch e.Class {
	case DriveErrorClassGrantRequired:
		return target == ErrDriveGrantRequired
	case DriveErrorClassBlockedByAdmin:
		return target == ErrDriveBlockedByWorkspaceAdmin
	case DriveErrorClassFileNotAccessible:
		return target == ErrDriveFileNotAccessible
	case DriveErrorClassUnavailable:
		return target == ErrDriveUnavailable
	case DriveErrorClassAuthFailed:
		return target == ErrDriveReauthRequired
	}
	return false
}

// DriveFileMetadata is the metadata snapshot returned by Google Drive files.get
// (spec §6.2, §7.2 step 2). It contains no file content.
type DriveFileMetadata struct {
	ExternalFileID    string
	DriveID           string // non-empty when the file lives in a Shared Drive
	Name              string
	MimeType          string
	IconKind          string
	WebViewLink       string
	OwnerDisplay      string
	ModifiedAt        *time.Time
	ModifiedByDisplay string
	SharingState      string // "private" | "shared" | "unknown"
	SharedUserCount   *int
	Trashed           bool
}

// DriveAPIClient calls Google Drive REST v3 over a 15-second HTTP client that
// refuses redirects outside Google hosts (spec §8.3).
type DriveAPIClient struct {
	baseURL    string
	httpClient *http.Client
	allowHost  func(host string) bool
}

// NewDriveAPIClient returns a DriveAPIClient pointed at https://www.googleapis.com/drive/v3
// with a 15-second timeout and a redirect policy restricted to *.googleapis.com
// and *.googleusercontent.com (spec §8.3).
func NewDriveAPIClient() *DriveAPIClient {
	c := &DriveAPIClient{
		baseURL:   driveGoogleAPIBaseURL,
		allowHost: isAllowedGoogleDriveHost,
	}
	c.httpClient = &http.Client{
		Timeout:       driveAPIDefaultTimeout,
		CheckRedirect: c.checkRedirect,
	}
	return c
}

// NewDriveAPIClientForTest constructs a DriveAPIClient rooted at baseURL (for
// example an httptest.Server) using transport if non-nil, while keeping the
// 15-second timeout and redirect guard (allowing baseURL's host in addition to
// Google hosts so in-process redirect tests work without real network calls).
func NewDriveAPIClientForTest(baseURL string, transport http.RoundTripper) *DriveAPIClient {
	var extraHost string
	if u, err := url.Parse(baseURL); err == nil {
		extraHost = strings.ToLower(u.Hostname())
	}
	c := &DriveAPIClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		allowHost: func(host string) bool {
			if isAllowedGoogleDriveHost(host) {
				return true
			}
			return extraHost != "" && strings.EqualFold(host, extraHost)
		},
	}
	c.httpClient = &http.Client{
		Timeout:       driveAPIDefaultTimeout,
		Transport:     transport,
		CheckRedirect: c.checkRedirect,
	}
	return c
}

func (c *DriveAPIClient) checkRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= driveAPIMaxRedirects {
		return errors.New("drive api: too many redirects")
	}
	if req == nil || req.URL == nil {
		return errors.New("drive api: redirect without URL")
	}
	host := strings.ToLower(req.URL.Hostname())
	allow := isAllowedGoogleDriveHost
	if c != nil && c.allowHost != nil {
		allow = c.allowHost
	}
	if !allow(host) {
		return fmt.Errorf("drive api: redirect to disallowed host %q", host)
	}
	if !strings.EqualFold(req.URL.Scheme, "https") && !isLoopbackRedirectHost(host) {
		return fmt.Errorf("drive api: redirect to non-https scheme %q", req.URL.Scheme)
	}
	// Strip Authorization when redirecting across different domains (for example
	// from www.googleapis.com to *.googleusercontent.com download hosts).
	if len(via) > 0 && via[0].URL != nil && !strings.EqualFold(via[0].URL.Hostname(), host) {
		req.Header.Del("Authorization")
	}
	return nil
}

func isAllowedGoogleDriveHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" {
		return false
	}
	return host == "googleapis.com" ||
		strings.HasSuffix(host, ".googleapis.com") ||
		host == "googleusercontent.com" ||
		strings.HasSuffix(host, ".googleusercontent.com")
}

func isLoopbackRedirectHost(host string) bool {
	return host == "127.0.0.1" || host == "localhost" || host == "::1"
}

// DriveTokenSource obtains and refreshes OAuth access tokens for a user's
// db.DriveConnection. *DriveConnectionService satisfies this interface.
type DriveTokenSource interface {
	AccessToken(ctx context.Context, conn db.DriveConnection) (string, time.Time, error)
	ForceRefreshAccessToken(ctx context.Context, conn db.DriveConnection) (string, time.Time, error)
}

// ForceRefreshAccessToken invalidates the cached access token expiry on conn's
// in-memory snapshot and refreshes against Google once when a Drive API call
// returns 401/authError (spec §5.7: "401 / authError -> refresh một lần;
// invalid_grant -> auth_failed").
func (s *DriveConnectionService) ForceRefreshAccessToken(ctx context.Context, conn db.DriveConnection) (string, time.Time, error) {
	if s == nil {
		return "", time.Time{}, ErrDriveNotConfigured
	}
	return s.forceRefreshConn(ctx, conn)
}

// FilesGetWithConnection fetches metadata for externalFileID using conn's OAuth
// token, refreshing once on 401/authError and classifying any error per §5.7.
func (c *DriveAPIClient) FilesGetWithConnection(ctx context.Context, tokens DriveTokenSource, conn db.DriveConnection, externalFileID string) (DriveFileMetadata, error) {
	var meta DriveFileMetadata
	err := c.withConnectionToken(ctx, tokens, conn, func(accessToken string) error {
		var callErr error
		meta, callErr = c.FilesGet(ctx, accessToken, externalFileID)
		return callErr
	})
	return meta, err
}

func (c *DriveAPIClient) withConnectionToken(ctx context.Context, tokens DriveTokenSource, conn db.DriveConnection, fn func(accessToken string) error) error {
	if tokens == nil {
		return &DriveAPIError{Class: DriveErrorClassUnavailable, Err: ErrDriveNotConfigured}
	}
	tok, _, err := tokens.AccessToken(ctx, conn)
	if err != nil {
		return mapTokenSourceError(err)
	}
	err = fn(tok)
	if err == nil {
		return nil
	}
	var apiErr *DriveAPIError
	if errors.As(err, &apiErr) && apiErr.Class == DriveErrorClassAuthenticationNeed {
		tok2, _, rerr := tokens.ForceRefreshAccessToken(ctx, conn)
		if rerr != nil {
			return mapTokenSourceError(rerr)
		}
		err = fn(tok2)
		if err != nil && errors.As(err, &apiErr) && apiErr.Class == DriveErrorClassAuthenticationNeed {
			return &DriveAPIError{
				Class:        DriveErrorClassUnavailable,
				HTTPStatus:   apiErr.HTTPStatus,
				GoogleReason: apiErr.GoogleReason,
				Err:          ErrDriveUnavailable,
			}
		}
	}
	return err
}

func mapTokenSourceError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrDriveReauthRequired) {
		return &DriveAPIError{
			Class:        DriveErrorClassAuthFailed,
			HTTPStatus:   http.StatusUnauthorized,
			GoogleReason: "invalid_grant",
			Err:          ErrDriveReauthRequired,
		}
	}
	if errors.Is(err, ErrDriveNotConfigured) {
		return &DriveAPIError{
			Class: DriveErrorClassUnavailable,
			Err:   ErrDriveUnavailable,
		}
	}
	return &DriveAPIError{
		Class: DriveErrorClassUnavailable,
		Err:   ErrDriveUnavailable,
	}
}

type googleDriveFileJSON struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	MimeType    string `json:"mimeType"`
	WebViewLink string `json:"webViewLink"`
	IconLink    string `json:"iconLink"`
	DriveID     string `json:"driveId"`
	Owners      []struct {
		DisplayName string `json:"displayName"`
	} `json:"owners"`
	LastModifyingUser *struct {
		DisplayName string `json:"displayName"`
	} `json:"lastModifyingUser"`
	ModifiedTime string `json:"modifiedTime"`
	Shared       *bool  `json:"shared"`
	Trashed      bool   `json:"trashed"`
	Permissions  []struct {
		ID string `json:"id"`
	} `json:"permissions"`
}

// FilesGet fetches a Drive file's metadata from GET /drive/v3/files/{fileId}
// with supportsAllDrives=true and the field mask from spec §6.2 / §7.2.
// A trashed file is treated as not accessible (MarkAccessLost = true).
func (c *DriveAPIClient) FilesGet(ctx context.Context, accessToken, externalFileID string) (DriveFileMetadata, error) {
	externalFileID = strings.TrimSpace(externalFileID)
	if externalFileID == "" {
		return DriveFileMetadata{}, &DriveAPIError{
			Class:          DriveErrorClassFileNotAccessible,
			HTTPStatus:     http.StatusNotFound,
			GoogleReason:   "notFound",
			MarkAccessLost: true,
			Err:            ErrDriveFileNotAccessible,
		}
	}
	q := url.Values{
		"supportsAllDrives": {"true"},
		"fields":            {driveFilesGetFields},
	}
	endpoint := c.endpoint("/files/"+url.PathEscape(externalFileID), q)
	body, err := c.doGET(ctx, accessToken, endpoint, driveMetadataMaxBytes)
	if err != nil {
		return DriveFileMetadata{}, err
	}
	var raw googleDriveFileJSON
	if err := json.Unmarshal(body, &raw); err != nil {
		return DriveFileMetadata{}, &DriveAPIError{
			Class: DriveErrorClassUnavailable,
			Err:   ErrDriveUnavailable,
		}
	}
	if raw.Trashed {
		return DriveFileMetadata{}, &DriveAPIError{
			Class:          DriveErrorClassFileNotAccessible,
			HTTPStatus:     http.StatusNotFound,
			GoogleReason:   "trashed",
			MarkAccessLost: true,
			Err:            ErrDriveFileNotAccessible,
		}
	}
	return normalizeDriveFileMetadata(raw, externalFileID), nil
}

func normalizeDriveFileMetadata(raw googleDriveFileJSON, fallbackID string) DriveFileMetadata {
	id := strings.TrimSpace(raw.ID)
	if id == "" {
		id = fallbackID
	}
	driveID := strings.TrimSpace(raw.DriveID)
	sharingState := "unknown"
	if driveID == "" && raw.Shared != nil {
		if *raw.Shared {
			sharingState = "shared"
		} else {
			sharingState = "private"
		}
	}
	ownerDisplay := ""
	if len(raw.Owners) > 0 {
		ownerDisplay = strings.TrimSpace(raw.Owners[0].DisplayName)
	}
	var modifiedAt *time.Time
	if strings.TrimSpace(raw.ModifiedTime) != "" {
		if t, err := time.Parse(time.RFC3339, strings.TrimSpace(raw.ModifiedTime)); err == nil {
			utc := t.UTC()
			modifiedAt = &utc
		}
	}
	modifiedBy := ""
	if raw.LastModifyingUser != nil {
		modifiedBy = strings.TrimSpace(raw.LastModifyingUser.DisplayName)
	}
	var sharedCount *int
	if len(raw.Permissions) > 0 {
		n := len(raw.Permissions)
		sharedCount = &n
	}
	return DriveFileMetadata{
		ExternalFileID:    id,
		DriveID:           driveID,
		Name:              strings.TrimSpace(raw.Name),
		MimeType:          strings.TrimSpace(raw.MimeType),
		IconKind:          DriveIconKindForMimeType(raw.MimeType),
		WebViewLink:       strings.TrimSpace(raw.WebViewLink),
		OwnerDisplay:      ownerDisplay,
		ModifiedAt:        modifiedAt,
		ModifiedByDisplay: modifiedBy,
		SharingState:      sharingState,
		SharedUserCount:   sharedCount,
		Trashed:           raw.Trashed,
	}
}

// DriveIconKindForMimeType maps a Google Drive or standard MIME type to the
// canonical icon_kind vocabulary in contract-note.md (spec §6.2, §7.9).
func DriveIconKindForMimeType(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case DriveMimeGoogleDoc:
		return "google_doc"
	case DriveMimeGoogleSheet:
		return "google_sheet"
	case DriveMimeGoogleSlides:
		return "google_slide"
	case DriveMimePDF:
		return "pdf"
	case DriveMimeDOCX:
		return "docx"
	case DriveMimeXLSX:
		return "xlsx"
	case DriveMimePPTX:
		return "pptx"
	case DriveMimePlainText:
		return "text"
	case DriveMimeMarkdown, "text/x-markdown":
		return "markdown"
	default:
		return "generic"
	}
}

// driveExportFile calls GET /drive/v3/files/{fileId}/export?mimeType=... and
// reads at most maxBytes of exported content. Only drive_content.go may call
// this function (enforced by TestDriveContentOnlyFromDriveContent in arch_test.go).
func (c *DriveAPIClient) driveExportFile(ctx context.Context, accessToken, externalFileID, exportMimeType string, maxBytes int64) ([]byte, error) {
	q := url.Values{
		"mimeType": {exportMimeType},
	}
	endpoint := c.endpoint("/files/"+url.PathEscape(strings.TrimSpace(externalFileID))+"/export", q)
	return c.doGET(ctx, accessToken, endpoint, maxBytes)
}

// driveDownloadMedia calls GET /drive/v3/files/{fileId}?alt=media&supportsAllDrives=true
// and reads at most maxBytes of raw file bytes in memory. Only drive_content.go
// may call this function (enforced by TestDriveContentOnlyFromDriveContent in arch_test.go).
func (c *DriveAPIClient) driveDownloadMedia(ctx context.Context, accessToken, externalFileID string, maxBytes int64) ([]byte, error) {
	q := url.Values{
		"alt":               {"media"},
		"supportsAllDrives": {"true"},
	}
	endpoint := c.endpoint("/files/"+url.PathEscape(strings.TrimSpace(externalFileID)), q)
	return c.doGET(ctx, accessToken, endpoint, maxBytes)
}

func (c *DriveAPIClient) endpoint(path string, q url.Values) string {
	base := driveGoogleAPIBaseURL
	if c != nil && c.baseURL != "" {
		base = c.baseURL
	}
	u := base + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	return u
}

func (c *DriveAPIClient) client() *http.Client {
	if c != nil && c.httpClient != nil {
		return c.httpClient
	}
	return &http.Client{
		Timeout:       driveAPIDefaultTimeout,
		CheckRedirect: (*DriveAPIClient)(nil).checkRedirect,
	}
}

func (c *DriveAPIClient) doGET(ctx context.Context, accessToken, endpoint string, maxBytes int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, &DriveAPIError{Class: DriveErrorClassUnavailable, Err: ErrDriveUnavailable}
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := c.client().Do(req)
	if err != nil {
		return nil, &DriveAPIError{
			Class: DriveErrorClassUnavailable,
			Err:   ErrDriveUnavailable,
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, driveErrorBodyMaxBytes))
		return nil, classifyDriveHTTPError(resp.StatusCode, errBody)
	}

	if maxBytes <= 0 {
		maxBytes = driveMetadataMaxBytes
	}
	if resp.ContentLength > maxBytes {
		return nil, ErrDriveFileTooLarge
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, &DriveAPIError{
			Class: DriveErrorClassUnavailable,
			Err:   ErrDriveUnavailable,
		}
	}
	if int64(len(data)) > maxBytes {
		return nil, ErrDriveFileTooLarge
	}
	return data, nil
}

type googleAPIErrorEnvelope struct {
	Error struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
		Errors  []struct {
			Domain  string `json:"domain"`
			Reason  string `json:"reason"`
			Message string `json:"message"`
		} `json:"errors"`
	} `json:"error"`
}

// classifyDriveHTTPError maps a non-2xx Google Drive API response onto DriveAPIError
// by reading error.errors[].reason before the HTTP status code (spec §5.7).
func classifyDriveHTTPError(status int, body []byte) *DriveAPIError {
	var env googleAPIErrorEnvelope
	var reasons []string
	if len(body) > 0 && json.Unmarshal(body, &env) == nil {
		for _, item := range env.Error.Errors {
			if r := strings.TrimSpace(item.Reason); r != "" {
				reasons = append(reasons, r)
			}
		}
	}
	firstReason := ""
	if len(reasons) > 0 {
		firstReason = reasons[0]
	}

	// 1. Inspect Google error.errors[].reason first (spec §5.7).
	for _, reason := range reasons {
		switch reason {
		case "appNotAuthorizedToFile":
			return &DriveAPIError{
				Class:        DriveErrorClassGrantRequired,
				HTTPStatus:   status,
				GoogleReason: reason,
				Err:          ErrDriveGrantRequired,
			}
		case "domainPolicy":
			return &DriveAPIError{
				Class:        DriveErrorClassBlockedByAdmin,
				HTTPStatus:   status,
				GoogleReason: reason,
				Err:          ErrDriveBlockedByWorkspaceAdmin,
			}
		case "notFound", "insufficientFilePermissions", "forbidden", "cannotDownloadFile":
			return &DriveAPIError{
				Class:          DriveErrorClassFileNotAccessible,
				HTTPStatus:     status,
				GoogleReason:   reason,
				MarkAccessLost: true,
				Err:            ErrDriveFileNotAccessible,
			}
		case "rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "sharingRateLimitExceeded":
			return &DriveAPIError{
				Class:        DriveErrorClassUnavailable,
				HTTPStatus:   status,
				GoogleReason: reason,
				RateLimited:  true,
				Err:          ErrDriveUnavailable,
			}
		case "authError", "invalidCredentials":
			return &DriveAPIError{
				Class:        DriveErrorClassAuthenticationNeed,
				HTTPStatus:   status,
				GoogleReason: reason,
				Err:          ErrDriveUnavailable,
			}
		case "backendError", "internalError":
			return &DriveAPIError{
				Class:        DriveErrorClassUnavailable,
				HTTPStatus:   status,
				GoogleReason: reason,
				Err:          ErrDriveUnavailable,
			}
		}
	}

	// 2. Fall back to HTTP status when no recognized reason is present.
	switch {
	case status == http.StatusUnauthorized:
		return &DriveAPIError{
			Class:        DriveErrorClassAuthenticationNeed,
			HTTPStatus:   status,
			GoogleReason: firstReason,
			Err:          ErrDriveUnavailable,
		}
	case status == http.StatusNotFound:
		return &DriveAPIError{
			Class:          DriveErrorClassFileNotAccessible,
			HTTPStatus:     status,
			GoogleReason:   firstReason,
			MarkAccessLost: true,
			Err:            ErrDriveFileNotAccessible,
		}
	case status == http.StatusForbidden:
		return &DriveAPIError{
			Class:          DriveErrorClassFileNotAccessible,
			HTTPStatus:     status,
			GoogleReason:   firstReason,
			MarkAccessLost: true,
			Err:            ErrDriveFileNotAccessible,
		}
	case status == http.StatusTooManyRequests:
		return &DriveAPIError{
			Class:        DriveErrorClassUnavailable,
			HTTPStatus:   status,
			GoogleReason: firstReason,
			RateLimited:  true,
			Err:          ErrDriveUnavailable,
		}
	default:
		return &DriveAPIError{
			Class:        DriveErrorClassUnavailable,
			HTTPStatus:   status,
			GoogleReason: firstReason,
			Err:          ErrDriveUnavailable,
		}
	}
}

// DriveErrToCodedError converts a DriveAPIError or Drive sentinel error into
// a service.CodedError with the HTTP status and wire code from contract-note.md §2.
func DriveErrToCodedError(err error) error {
	if err == nil {
		return nil
	}
	var ce CodedError
	if errors.As(err, &ce) {
		return err
	}
	var apiErr *DriveAPIError
	if errors.As(err, &apiErr) {
		switch apiErr.Class {
		case DriveErrorClassGrantRequired:
			return CodedError{
				Status: http.StatusForbidden,
				Code:   "drive_grant_required",
				Msg:    "Bạn chưa cho phép UniWork đọc tệp này qua Google Picker.",
				Err:    ErrDriveGrantRequired,
			}
		case DriveErrorClassBlockedByAdmin:
			return CodedError{
				Status: http.StatusForbidden,
				Code:   "blocked_by_workspace_admin",
				Msg:    "Quản trị viên Google Workspace của tổ chức bạn chưa cho phép UniWork truy cập Google Drive.",
				Err:    ErrDriveBlockedByWorkspaceAdmin,
			}
		case DriveErrorClassFileNotAccessible:
			status := http.StatusForbidden
			if apiErr.HTTPStatus == http.StatusNotFound || apiErr.GoogleReason == "notFound" || apiErr.GoogleReason == "trashed" {
				status = http.StatusNotFound
			}
			return CodedError{
				Status: status,
				Code:   "drive_file_not_accessible",
				Msg:    "Tài khoản Google Drive này không còn quyền truy cập tệp.",
				Err:    ErrDriveFileNotAccessible,
			}
		case DriveErrorClassAuthFailed:
			return CodedError{
				Status: http.StatusConflict,
				Code:   "auth_failed",
				Msg:    "Kết nối Google Drive đã hết hạn, vui lòng kết nối lại.",
				Err:    ErrDriveReauthRequired,
			}
		case DriveErrorClassUnavailable, DriveErrorClassAuthenticationNeed:
			status := http.StatusServiceUnavailable
			if apiErr.RateLimited || apiErr.HTTPStatus == http.StatusTooManyRequests {
				status = http.StatusTooManyRequests
			}
			return CodedError{
				Status: status,
				Code:   "drive_unavailable",
				Msg:    "Không kết nối được Google Drive lúc này, vui lòng thử lại sau.",
				Err:    ErrDriveUnavailable,
			}
		}
	}
	switch {
	case errors.Is(err, ErrDriveFileNotFound):
		return ErrNotFound
	case errors.Is(err, ErrDriveAccessRequired):
		return CodedError{
			Status: http.StatusConflict,
			Code:   "drive_access_required",
			Msg:    "Bạn chưa cho phép UniWork đọc tệp này bằng tài khoản Google Drive của mình.",
			Err:    ErrDriveAccessRequired,
		}
	case errors.Is(err, ErrDriveGrantRequired):
		return CodedError{
			Status: http.StatusForbidden,
			Code:   "drive_grant_required",
			Msg:    "Bạn chưa cho phép UniWork đọc tệp này qua Google Picker.",
			Err:    ErrDriveGrantRequired,
		}
	case errors.Is(err, ErrDriveBlockedByWorkspaceAdmin):
		return CodedError{
			Status: http.StatusForbidden,
			Code:   "blocked_by_workspace_admin",
			Msg:    "Quản trị viên Google Workspace của tổ chức bạn chưa cho phép UniWork truy cập Google Drive.",
			Err:    ErrDriveBlockedByWorkspaceAdmin,
		}
	case errors.Is(err, ErrDriveFileNotAccessible):
		return CodedError{
			Status: http.StatusForbidden,
			Code:   "drive_file_not_accessible",
			Msg:    "Tài khoản Google Drive này không còn quyền truy cập tệp.",
			Err:    ErrDriveFileNotAccessible,
		}
	case errors.Is(err, ErrDriveFormatUnsupported):
		return CodedError{
			Status: http.StatusUnprocessableEntity,
			Code:   "drive_format_unsupported",
			Msg:    "UNI chưa đọc được định dạng này.",
			Err:    ErrDriveFormatUnsupported,
		}
	case errors.Is(err, ErrDriveExtractUnavailable):
		return CodedError{
			Status: http.StatusServiceUnavailable,
			Code:   "drive_extract_unavailable",
			Msg:    "UNI chưa đọc được tệp này lúc này, thử lại sau.",
			Err:    ErrDriveExtractUnavailable,
		}
	case errors.Is(err, ErrDriveReauthRequired):
		return CodedError{
			Status: http.StatusConflict,
			Code:   "auth_failed",
			Msg:    "Kết nối Google Drive đã hết hạn, vui lòng kết nối lại.",
			Err:    ErrDriveReauthRequired,
		}
	case errors.Is(err, ErrDriveUnavailable):
		return CodedError{
			Status: http.StatusServiceUnavailable,
			Code:   "drive_unavailable",
			Msg:    "Không kết nối được Google Drive lúc này, vui lòng thử lại sau.",
			Err:    ErrDriveUnavailable,
		}
	}
	return err
}
