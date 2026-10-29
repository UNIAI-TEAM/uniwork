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
	driveGoogleAPIBaseURL   = "https://www.googleapis.com/drive/v3"
	driveAPIDefaultTimeout  = 15 * time.Second
	driveAPIMaxRedirects    = 5
	driveParentLookupBudget = 3 * time.Second
	driveFolderWalkBudget   = 3 * time.Second
	driveFolderWalkMaxDepth = 10
	driveMetadataMaxBytes   = 1 << 20 // 1 MiB metadata response ceiling
	driveErrorBodyMaxBytes  = 64 << 10

	// driveFilesGetFields is the exact field mask spec §6.2 and §7.2 step 2 require
	// when reading a linked Google Drive file's metadata.
	driveFilesGetFields   = "id,name,mimeType,webViewLink,iconLink,driveId,parents,owners(displayName),lastModifyingUser(displayName),modifiedTime,shared,trashed,permissions(id)"
	driveFolderGetFields  = "id,name,mimeType,parents,driveId,trashed"
	DriveMimeGoogleFolder = "application/vnd.google-apps.folder"
)

var (
	// ErrDriveBlockedByWorkspaceAdmin is returned when a Google Workspace admin
	// policy blocks the app at the Drive API (403 reason=domainPolicy; spec §5.7).
	ErrDriveBlockedByWorkspaceAdmin = errors.New("blocked_by_workspace_admin")
	// ErrDriveFileTooLarge is returned when a downloaded or exported Drive file
	// exceeds its per-format byte ceiling (spec §8.3).
	ErrDriveFileTooLarge = errors.New("drive_file_too_large")
	// ErrDriveFolderNotFound is returned when a Google Drive folder cannot be
	// read (404, 403, or empty/blank folder name; UNI-2221).
	ErrDriveFolderNotFound = errors.New("drive_folder_not_found")
	// ErrDriveFolderNotFolder is returned when the requested Drive item is not a
	// folder (missing or non-folder mimeType) or is trashed (UNI-2221).
	ErrDriveFolderNotFolder = errors.New("drive_folder_not_folder")
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
	DriveErrorClassFolderNotFound     DriveErrorClass = "drive_folder_not_found"
	DriveErrorClassFolderNotFolder    DriveErrorClass = "drive_folder_not_folder"
)

// DriveAPIError is a classified error from the Google Drive REST API (spec §5.7).
//
// MarkAccessLost is true only when Google reports notFound (404),
// insufficientFilePermissions, forbidden, or a trashed file: the caller in
// B4/B5/B8 records drive_file_access.state = lost for that user (and
// drive_files.access_lost_at when the connection is the file's bound
// connection). Other 403 reasons (e.g. fileNotDownloadable) and transient
// errors (rate limit, 5xx, timeout) leave MarkAccessLost false.
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
	case DriveErrorClassFolderNotFound:
		return target == ErrDriveFolderNotFound || target == ErrDriveFileNotAccessible
	case DriveErrorClassFolderNotFolder:
		return target == ErrDriveFolderNotFolder
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
	ParentFolderID    string
	ParentFolderName  string
	ResolvedFolders   []DriveFolderMetadata
}

// DriveFolderMetadata is the metadata snapshot of a Google Drive folder returned
// by GET /drive/v3/files/{folderId} under drive.file scope (UNI-2291).
type DriveFolderMetadata struct {
	FolderID       string
	Name           string
	ParentFolderID string
	DriveID        string
}

// driveFolderWalkCache caches folder metadata lookups within a single Link or
// refresh batch, partitioned by connection ID and then by Drive folder ID so
// shared ancestors are queried at most once per connection. A nil pointer entry
// records a negative (403/404) lookup in the current batch for that connection.
type driveFolderWalkCache map[string]map[string]*DriveFolderMetadata

func (m driveFolderWalkCache) forConnection(connID string) map[string]*DriveFolderMetadata {
	if m == nil {
		return nil
	}
	key := strings.TrimSpace(connID)
	sub, ok := m[key]
	if !ok {
		sub = make(map[string]*DriveFolderMetadata)
		m[key] = sub
	}
	return sub
}

// DriveAPIClient calls Google Drive REST v3 over a 15-second HTTP client that
// refuses redirects outside Google hosts (spec §8.3).
type DriveAPIClient struct {
	baseURL            string
	httpClient         *http.Client
	allowHost          func(host string) bool
	parentLookupBudget time.Duration
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
	ForceRefreshAccessToken(ctx context.Context, conn db.DriveConnection, rejectedToken string) (string, time.Time, error)
}

// ForceRefreshAccessToken invalidates the cached access token on conn when a
// Drive API call returns 401/authError for rejectedToken (spec §5.7:
// "401 / authError -> refresh một lần; invalid_grant -> auth_failed"). A stored
// token is reused without calling the provider only if it differs from
// rejectedToken.
func (s *DriveConnectionService) ForceRefreshAccessToken(ctx context.Context, conn db.DriveConnection, rejectedToken string) (string, time.Time, error) {
	if s == nil {
		return "", time.Time{}, ErrDriveNotConfigured
	}
	return s.forceRefreshConn(ctx, conn, rejectedToken)
}

// FilesGetWithConnection fetches metadata for externalFileID using conn's OAuth
// token, refreshing once on 401/authError and classifying any error per §5.7.
func (c *DriveAPIClient) FilesGetWithConnection(ctx context.Context, tokens DriveTokenSource, conn db.DriveConnection, externalFileID string) (DriveFileMetadata, error) {
	return c.filesGetWithConnectionAndParentCache(ctx, tokens, conn, externalFileID, nil)
}

func (c *DriveAPIClient) filesGetWithConnectionAndParentCache(
	ctx context.Context,
	tokens DriveTokenSource,
	conn db.DriveConnection,
	externalFileID string,
	walkCache driveFolderWalkCache,
) (DriveFileMetadata, error) {
	var meta DriveFileMetadata
	var usedToken string
	err := c.withConnectionToken(ctx, tokens, conn, func(accessToken string) error {
		usedToken = accessToken
		if fp := c.fakeProviderForTokens(tokens); fp != nil {
			var callErr error
			meta, callErr = fp.FilesGet(ctx, accessToken, externalFileID)
			return callErr
		}
		var callErr error
		meta, callErr = c.FilesGet(ctx, accessToken, externalFileID)
		return callErr
	})
	if err != nil {
		return meta, err
	}
	if meta.ParentFolderID != "" && c != nil {
		chain := c.walkFolderChain(ctx, tokens, usedToken, meta.ParentFolderID, walkCache.forConnection(conn.ID))
		if len(chain) > 0 {
			meta.ResolvedFolders = chain
			if meta.ParentFolderName == "" && chain[0].FolderID == meta.ParentFolderID {
				meta.ParentFolderName = chain[0].Name
			}
		}
	}
	return meta, nil
}

// FolderGetWithConnection fetches metadata for a Google Drive folder using conn's OAuth token,
// refreshing once on 401/authError and classifying any error per §5.7 (UNI-2291).
func (c *DriveAPIClient) FolderGetWithConnection(ctx context.Context, tokens DriveTokenSource, conn db.DriveConnection, folderID string) (DriveFolderMetadata, error) {
	var meta DriveFolderMetadata
	err := c.withConnectionToken(ctx, tokens, conn, func(accessToken string) error {
		if fp := c.fakeProviderForTokens(tokens); fp != nil {
			var callErr error
			meta, callErr = fp.FolderGet(ctx, accessToken, folderID)
			return callErr
		}
		var callErr error
		meta, callErr = c.FolderGet(ctx, accessToken, folderID)
		return callErr
	})
	return meta, err
}

// FolderChainWithConnection resolves folderID (returning a classified error if folderID
// itself cannot be read or is not a folder) and then walks its parent chain upward while
// ancestors are readable within the walk depth and time budget (UNI-2291).
func (c *DriveAPIClient) FolderChainWithConnection(ctx context.Context, tokens DriveTokenSource, conn db.DriveConnection, folderID string) ([]DriveFolderMetadata, error) {
	var first DriveFolderMetadata
	var usedToken string
	err := c.withConnectionToken(ctx, tokens, conn, func(accessToken string) error {
		usedToken = accessToken
		if fp := c.fakeProviderForTokens(tokens); fp != nil {
			var callErr error
			first, callErr = fp.FolderGet(ctx, accessToken, folderID)
			return callErr
		}
		var callErr error
		first, callErr = c.FolderGet(ctx, accessToken, folderID)
		return callErr
	})
	if err != nil {
		return nil, err
	}
	chain := []DriveFolderMetadata{first}
	if first.ParentFolderID != "" && c != nil {
		cache := map[string]*DriveFolderMetadata{
			first.FolderID: &first,
		}
		ancestors := c.walkFolderChainWithDepth(ctx, tokens, usedToken, first.ParentFolderID, cache, driveFolderWalkMaxDepth-1, first.FolderID)
		chain = append(chain, ancestors...)
	}
	return chain, nil
}

// FolderNameWithConnection fetches the name of a Google Drive folder using conn's OAuth token,
// refreshing once on 401/authError and classifying any error per §5.7 (UNI-2221).
func (c *DriveAPIClient) FolderNameWithConnection(ctx context.Context, tokens DriveTokenSource, conn db.DriveConnection, folderID string) (string, error) {
	meta, err := c.FolderGetWithConnection(ctx, tokens, conn, folderID)
	if err != nil {
		return "", err
	}
	return meta.Name, nil
}

func (c *DriveAPIClient) walkFolderChain(
	ctx context.Context,
	tokens DriveTokenSource,
	accessToken string,
	startFolderID string,
	cache map[string]*DriveFolderMetadata,
) []DriveFolderMetadata {
	return c.walkFolderChainWithDepth(ctx, tokens, accessToken, startFolderID, cache, driveFolderWalkMaxDepth)
}

func (c *DriveAPIClient) walkFolderChainWithDepth(
	ctx context.Context,
	tokens DriveTokenSource,
	accessToken string,
	startFolderID string,
	cache map[string]*DriveFolderMetadata,
	maxDepth int,
	alreadyVisited ...string,
) []DriveFolderMetadata {
	currID := strings.TrimSpace(startFolderID)
	if currID == "" || maxDepth <= 0 {
		return nil
	}
	budget := driveFolderWalkBudget
	if c != nil && c.parentLookupBudget > 0 {
		budget = c.parentLookupBudget
	}
	wctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()

	visited := make(map[string]bool, maxDepth+len(alreadyVisited))
	for _, v := range alreadyVisited {
		if v = strings.TrimSpace(v); v != "" {
			visited[v] = true
		}
	}
	var chain []DriveFolderMetadata
	for depth := 0; depth < maxDepth && currID != ""; depth++ {
		if visited[currID] {
			break
		}
		visited[currID] = true

		if cache != nil {
			if cached, seen := cache[currID]; seen {
				if cached == nil {
					break
				}
				chain = append(chain, *cached)
				currID = cached.ParentFolderID
				continue
			}
		}

		meta, err := c.folderGetSingle(wctx, tokens, accessToken, currID)
		if err != nil {
			if cache != nil && isNegativeFolderLookupError(err) {
				cache[currID] = nil
			}
			break
		}
		if cache != nil {
			metaCopy := meta
			cache[currID] = &metaCopy
		}
		chain = append(chain, meta)
		currID = meta.ParentFolderID
	}
	return chain
}

func (c *DriveAPIClient) folderGetSingle(ctx context.Context, tokens DriveTokenSource, accessToken, folderID string) (DriveFolderMetadata, error) {
	if fp := c.fakeProviderForTokens(tokens); fp != nil {
		return fp.FolderGet(ctx, accessToken, folderID)
	}
	return c.FolderGet(ctx, accessToken, folderID)
}

func isNegativeFolderLookupError(err error) bool {
	var apiErr *DriveAPIError
	if errors.As(err, &apiErr) {
		switch apiErr.Class {
		case DriveErrorClassFolderNotFound, DriveErrorClassFolderNotFolder, DriveErrorClassFileNotAccessible, DriveErrorClassGrantRequired, DriveErrorClassBlockedByAdmin:
			return true
		}
	}
	return errors.Is(err, ErrDriveFolderNotFound) || errors.Is(err, ErrDriveFolderNotFolder) || errors.Is(err, ErrDriveFileNotAccessible)
}

// FolderGet fetches a Drive folder's metadata (id, name, parentFolderID, driveID) from
// GET /drive/v3/files/{folderId} with supportsAllDrives=true and fields=id,name,mimeType,parents,driveId,trashed (UNI-2291).
func (c *DriveAPIClient) FolderGet(ctx context.Context, accessToken, folderID string) (DriveFolderMetadata, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID == "" {
		return DriveFolderMetadata{}, &DriveAPIError{
			Class:        DriveErrorClassFolderNotFound,
			HTTPStatus:   http.StatusNotFound,
			GoogleReason: "notFound",
			Err:          ErrDriveFolderNotFound,
		}
	}
	q := url.Values{
		"supportsAllDrives": {"true"},
		"fields":            {driveFolderGetFields},
	}
	endpoint := c.endpoint("/files/"+url.PathEscape(folderID), q)
	body, err := c.doGET(ctx, accessToken, endpoint, driveMetadataMaxBytes)
	if err != nil {
		return DriveFolderMetadata{}, err
	}
	var raw googleDriveFileJSON
	if err := json.Unmarshal(body, &raw); err != nil {
		return DriveFolderMetadata{}, &DriveAPIError{
			Class: DriveErrorClassUnavailable,
			Err:   ErrDriveUnavailable,
		}
	}
	if raw.Trashed || strings.TrimSpace(raw.MimeType) != DriveMimeGoogleFolder {
		return DriveFolderMetadata{}, &DriveAPIError{
			Class:        DriveErrorClassFolderNotFolder,
			HTTPStatus:   http.StatusUnprocessableEntity,
			GoogleReason: "notFolder",
			Err:          ErrDriveFolderNotFolder,
		}
	}
	name := strings.TrimSpace(raw.Name)
	if name == "" {
		return DriveFolderMetadata{}, &DriveAPIError{
			Class:        DriveErrorClassFolderNotFound,
			HTTPStatus:   http.StatusNotFound,
			GoogleReason: "notFound",
			Err:          ErrDriveFolderNotFound,
		}
	}
	id := strings.TrimSpace(raw.ID)
	if id == "" {
		id = folderID
	}
	var parentID string
	for _, p := range raw.Parents {
		p = strings.TrimSpace(p)
		if p != "" && p != id {
			parentID = p
			break
		}
	}
	return DriveFolderMetadata{
		FolderID:       id,
		Name:           name,
		ParentFolderID: parentID,
		DriveID:        strings.TrimSpace(raw.DriveID),
	}, nil
}

// FolderNameGet fetches a Drive folder's name from GET /drive/v3/files/{folderId}
// with supportsAllDrives=true (UNI-2221).
func (c *DriveAPIClient) FolderNameGet(ctx context.Context, accessToken, folderID string) (string, error) {
	meta, err := c.FolderGet(ctx, accessToken, folderID)
	if err != nil {
		return "", err
	}
	return meta.Name, nil
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
		tok2, _, rerr := tokens.ForceRefreshAccessToken(ctx, conn, tok)
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
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	MimeType    string   `json:"mimeType"`
	WebViewLink string   `json:"webViewLink"`
	IconLink    string   `json:"iconLink"`
	DriveID     string   `json:"driveId"`
	Parents     []string `json:"parents"`
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
	parentID := ""
	if len(raw.Parents) > 0 {
		parentID = strings.TrimSpace(raw.Parents[0])
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
		ParentFolderID:    parentID,
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

func (c *DriveAPIClient) fakeProviderForTokens(tokens DriveTokenSource) *FakeDriveProvider {
	if c == nil || c.baseURL == driveGoogleAPIBaseURL {
		if dcs, ok := tokens.(*DriveConnectionService); ok && dcs != nil {
			if fp, ok := dcs.Provider().(*FakeDriveProvider); ok && fp != nil {
				return fp
			}
		}
	}
	return nil
}

// driveExportFile calls GET /drive/v3/files/{fileId}/export?mimeType=... and
// reads at most maxBytes of exported content. Only drive_content.go may call
// this function (enforced by TestDriveContentOnlyFromDriveContent in arch_test.go).
func (c *DriveAPIClient) driveExportFile(ctx context.Context, tokens DriveTokenSource, accessToken, externalFileID, exportMimeType string, maxBytes int64) ([]byte, error) {
	if fp := c.fakeProviderForTokens(tokens); fp != nil {
		return fp.ExportFile(ctx, accessToken, externalFileID, exportMimeType, maxBytes)
	}
	q := url.Values{
		"mimeType": {exportMimeType},
	}
	endpoint := c.endpoint("/files/"+url.PathEscape(strings.TrimSpace(externalFileID))+"/export", q)
	return c.doGET(ctx, accessToken, endpoint, maxBytes)
}

// driveDownloadMedia calls GET /drive/v3/files/{fileId}?alt=media&supportsAllDrives=true
// and reads at most maxBytes of raw file bytes in memory. Only drive_content.go
// may call this function (enforced by TestDriveContentOnlyFromDriveContent in arch_test.go).
func (c *DriveAPIClient) driveDownloadMedia(ctx context.Context, tokens DriveTokenSource, accessToken, externalFileID string, maxBytes int64) ([]byte, error) {
	if fp := c.fakeProviderForTokens(tokens); fp != nil {
		return fp.DownloadMedia(ctx, accessToken, externalFileID, maxBytes)
	}
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
		case "notFound", "insufficientFilePermissions", "forbidden":
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
			MarkAccessLost: false,
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

// DriveFolderErrToCodedError maps an error from FolderNameWithConnection on the
// NameFolder route (UNI-2221): Google 404 and every non-rate-limit Google 403
// (including insufficientFilePermissions, forbidden, appNotAuthorizedToFile,
// domainPolicy) as well as unreadable/blank folder names map uniformly to
// 404 drive_folder_not_found; non-folder or trashed items map to
// 422 drive_folder_not_folder; other errors (auth_failed, 429, 5xx) keep
// DriveErrToCodedError's mapping.
func DriveFolderErrToCodedError(err error) error {
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
		case DriveErrorClassFolderNotFolder:
			return CodedError{
				Status: http.StatusUnprocessableEntity,
				Code:   "drive_folder_not_folder",
				Msg:    "Mục đã chọn trên Google Drive không phải là thư mục hợp lệ.",
				Err:    ErrDriveFolderNotFolder,
			}
		case DriveErrorClassFolderNotFound, DriveErrorClassFileNotAccessible, DriveErrorClassGrantRequired, DriveErrorClassBlockedByAdmin:
			return CodedError{
				Status: http.StatusNotFound,
				Code:   "drive_folder_not_found",
				Msg:    "Không tìm thấy thư mục Google Drive hoặc bạn chưa cấp quyền cho thư mục này.",
				Err:    ErrDriveFolderNotFound,
			}
		}
	}
	if errors.Is(err, ErrDriveFolderNotFolder) {
		return CodedError{
			Status: http.StatusUnprocessableEntity,
			Code:   "drive_folder_not_folder",
			Msg:    "Mục đã chọn trên Google Drive không phải là thư mục hợp lệ.",
			Err:    ErrDriveFolderNotFolder,
		}
	}
	if errors.Is(err, ErrDriveFolderNotFound) {
		return CodedError{
			Status: http.StatusNotFound,
			Code:   "drive_folder_not_found",
			Msg:    "Không tìm thấy thư mục Google Drive hoặc bạn chưa cấp quyền cho thư mục này.",
			Err:    ErrDriveFolderNotFound,
		}
	}
	return DriveErrToCodedError(err)
}
