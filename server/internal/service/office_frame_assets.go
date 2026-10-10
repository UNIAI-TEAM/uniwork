package service

import (
	"context"
	"errors"
	"io"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Relative pictures and sibling files of the Markdown/HTML frames (UNI-1232,
// docs/office/office-web-modules.md "Images and sibling files in
// Markdown/HTML"). A path as written in the document resolves, in order, to
// a document asset of this document (`assets/<name>`, the newest asset stored
// under that name: what the frame's paste upload sent) or to a sibling file
// document in the Documents tree, walked from the document's parent. Either
// becomes a signed URL an <img>, a stylesheet fetch or a script fetch in the
// frame loads without a header; every byte request rechecks view access.

// OfficeFrameAssetURLTTL is the lifetime of a signed asset or sibling URL of a
// Markdown/HTML frame. Longer than a frame token: the frame maps paths to URLs
// once per open and re-reads them for exports and re-renders, and asks the
// host for fresh ones (api.assets.resolve) when a session outlives it. Each
// request still rechecks view access, so a revoked share or membership stops
// the URL at once; the lifetime only bounds a leaked URL of something the user
// may still see. A Docs asset URL keeps the lifetime of the token (UNI-1013).
const OfficeFrameAssetURLTTL = time.Hour

const (
	officeFrameLinkedPrefix = "ofl1."
	// officeFrameMaxRefs caps the paths one open or one resolve call signs.
	officeFrameMaxRefs = 200
	// officeFrameRefScanBytes is how much of a document open reads for refs.
	officeFrameRefScanBytes = 4 << 20
	// officeFrameMaxRefLen caps a path as written (bytes).
	officeFrameMaxRefLen = 512
	// officeFrameMaxWalk caps the directory segments of one path and the
	// distinct folders one resolve call lists.
	officeFrameMaxWalk = 16
	// officeFrameMaxChildren caps the children of one folder a walk reads.
	officeFrameMaxChildren = 2000
	// OfficeFrameMaxACLChecks caps the distinct documents one open or resolve
	// call runs the Documents ACL on (several queries each); a path that would
	// need one more is left unresolved, never refused.
	OfficeFrameMaxACLChecks = 100
	// OfficeFrameResolveMaxPaths caps one resolve call (POST .../assets/resolve).
	OfficeFrameResolveMaxPaths = 50
)

// officeFrameLinkedType is a sibling file type the frames may load: the type
// the byte route answers with and the stored types it accepts for it (a CSS
// or JS file stored before UNI-1232 verified as text/plain).
type officeFrameLinkedType struct {
	serve  string
	stored []string
}

var officeFrameLinkedTypes = map[string]officeFrameLinkedType{
	".png":  {serve: "image/png", stored: []string{"image/png"}},
	".jpg":  {serve: "image/jpeg", stored: []string{"image/jpeg"}},
	".jpeg": {serve: "image/jpeg", stored: []string{"image/jpeg"}},
	".gif":  {serve: "image/gif", stored: []string{"image/gif"}},
	".webp": {serve: "image/webp", stored: []string{"image/webp"}},
	".svg":  {serve: "image/svg+xml", stored: []string{"image/svg+xml"}},
	".css":  {serve: "text/css; charset=utf-8", stored: []string{"text/css", "text/plain"}},
	".js":   {serve: "text/javascript; charset=utf-8", stored: []string{"text/javascript", "text/plain"}},
	".mjs":  {serve: "text/javascript; charset=utf-8", stored: []string{"text/javascript", "text/plain"}},
}

// officeFrameLinkedTypeOf is the served type of a stored file, by its name's
// extension; false when the frames never load that file.
func officeFrameLinkedTypeOf(filename, storedMime string) (string, bool) {
	t, ok := officeFrameLinkedTypes[strings.ToLower(path.Ext(filename))]
	if !ok {
		return "", false
	}
	base, _, _ := strings.Cut(strings.ToLower(storedMime), ";")
	base = strings.TrimSpace(base)
	for _, m := range t.stored {
		if base == m {
			return t.serve, true
		}
	}
	return "", false
}

type officeFrameLinkedClaims struct {
	DocumentID     string `json:"d"`
	LinkedID       string `json:"l"`
	WorkspaceID    string `json:"w"`
	OrganizationID string `json:"o"`
	UserID         string `json:"u"`
	ExpiresAt      int64  `json:"e"`
	Module         string `json:"m,omitempty"`
}

// OfficeFrameLinkedFile is an open sibling file: the caller owns Reader.Close.
type OfficeFrameLinkedFile struct {
	Reader      files.Reader
	ContentType string
	Filename    string
}

// SignLinked returns the URL of a sibling file document as the frame of
// claims loads it. The signature binds the frame's document, the sibling and
// the user; the byte route rechecks view on both.
func (s *OfficeFrameService) SignLinked(claims OfficeFrameClaims, linkedID string) (OfficeFrameAssetURL, error) {
	expires := s.now().Add(s.urlTTL(claims))
	sig, err := s.sign(officeFrameLinkedPrefix, officeFrameLinkedClaims{
		DocumentID: claims.DocumentID, LinkedID: linkedID, WorkspaceID: claims.WorkspaceID,
		OrganizationID: claims.OrganizationID, UserID: claims.UserID, ExpiresAt: expires.UnixMilli(),
		Module: claims.Module,
	})
	if err != nil {
		return OfficeFrameAssetURL{}, err
	}
	return OfficeFrameAssetURL{
		AssetID:   linkedID,
		URL:       "/api/v1/office-frame/documents/" + claims.DocumentID + "/linked/" + linkedID + "?sig=" + sig,
		ExpiresAt: time.UnixMilli(expires.UnixMilli()).UTC(),
	}, nil
}

// VerifyLinked is VerifyAsset for a sibling URL: the claims open only that
// sibling of that document.
func (s *OfficeFrameService) VerifyLinked(sig, documentID, linkedID string) (OfficeFrameClaims, error) {
	var claims officeFrameLinkedClaims
	if s == nil || !s.verify(officeFrameLinkedPrefix, sig, &claims) {
		return OfficeFrameClaims{}, ErrOfficeFrameToken
	}
	if claims.DocumentID != documentID || claims.LinkedID != linkedID || claims.UserID == "" ||
		claims.WorkspaceID == "" || claims.OrganizationID == "" || claims.ExpiresAt <= s.now().UnixMilli() {
		return OfficeFrameClaims{}, ErrOfficeFrameToken
	}
	// Only the Markdown and HTML frames load siblings; a signature naming any
	// other module (or the explicit docs spelling) is not one the server issued.
	if !officeFrameLoadsSiblings(claims.Module) {
		return OfficeFrameClaims{}, ErrOfficeFrameToken
	}
	return OfficeFrameClaims{Version: 1, DocumentID: claims.DocumentID, WorkspaceID: claims.WorkspaceID,
		OrganizationID: claims.OrganizationID, UserID: claims.UserID, ExpiresAt: claims.ExpiresAt, Module: claims.Module}, nil
}

// officeFrameLoadsSiblings is true for the modules whose documents point at
// pictures, stylesheets and scripts by relative path.
func officeFrameLoadsSiblings(module string) bool {
	return module == OfficeFrameModuleMarkdown || module == OfficeFrameModuleHTML
}

// OpenLinked opens a sibling file document for the frame of claims: view on
// the frame's document (Authorize, a Markdown or HTML one) and on the sibling
// itself, both in the token's workspace, a live file of a type the frames load.
// Anything else is not found. The handler reaches it only with a signature
// issued for this document and file (VerifyLinked), never a frame token.
func (s *OfficeFrameService) OpenLinked(ctx context.Context, claims OfficeFrameClaims, linkedID string) (OfficeFrameLinkedFile, error) {
	d, err := s.Authorize(ctx, claims)
	if err != nil {
		return OfficeFrameLinkedFile{}, err
	}
	if !officeFrameLoadsSiblings(d.Module) {
		return OfficeFrameLinkedFile{}, ErrNotFound
	}
	doc, _, err := s.documents.authorizeDocument(ctx, Human(claims.UserID), linkedID, DocumentLevelView)
	if err != nil {
		return OfficeFrameLinkedFile{}, err
	}
	if doc.Kind != DocumentKindFile || doc.ArchivedAt.Valid ||
		doc.WorkspaceID != claims.WorkspaceID || doc.OrganizationID != claims.OrganizationID {
		return OfficeFrameLinkedFile{}, ErrNotFound
	}
	info, err := s.documents.currentFileInfo(ctx, doc)
	if err != nil {
		return OfficeFrameLinkedFile{}, err
	}
	if info == nil {
		return OfficeFrameLinkedFile{}, ErrNotFound
	}
	ct, ok := officeFrameLinkedTypeOf(info.Filename, info.MimeType)
	if !ok {
		return OfficeFrameLinkedFile{}, ErrNotFound
	}
	f, err := s.documents.openCurrentFile(ctx, doc, DocumentByteRange{})
	if err != nil {
		return OfficeFrameLinkedFile{}, err
	}
	return OfficeFrameLinkedFile{Reader: f.Reader, ContentType: ct, Filename: info.Filename}, nil
}

// OpenAssets maps every relative reference the current version of a
// Markdown/HTML document uses to a signed URL (the open answer's `assets`).
// It never fails the open: a document it cannot read or parse maps nothing.
func (s *OfficeFrameService) OpenAssets(ctx context.Context, claims OfficeFrameClaims, d OfficeFrameDocument) map[string]string {
	if d.Module != OfficeFrameModuleMarkdown && d.Module != OfficeFrameModuleHTML {
		return nil
	}
	f, err := s.documents.openCurrentFile(ctx, d.Document, DocumentByteRange{Length: officeFrameRefScanBytes})
	if err != nil {
		return nil
	}
	content, err := io.ReadAll(io.LimitReader(f.Reader.Body, officeFrameRefScanBytes))
	_ = f.Reader.Close()
	if err != nil {
		return nil
	}
	resolved, err := s.ResolvePaths(ctx, claims, d, officeFrameRefs(string(content)))
	if err != nil {
		return nil
	}
	out := make(map[string]string, len(resolved))
	for p, u := range resolved {
		out[p] = u.URL
	}
	return out
}

// Resolve is the frame's request for URLs of relative paths it holds: fresh
// ones for the paths of the open answer when its signatures near their end,
// and the URLs of paths typed after the open. The same normalisation, walk and
// ACL as the open (ResolvePaths); a path that resolves to nothing is left out.
// Only Markdown and HTML documents have relative paths.
func (s *OfficeFrameService) Resolve(ctx context.Context, claims OfficeFrameClaims, paths []string) (map[string]OfficeFrameAssetURL, error) {
	// The caller is decided first: a refused caller never learns the call's limits.
	d, err := s.Authorize(ctx, claims)
	if err != nil {
		return nil, err
	}
	if !officeFrameLoadsSiblings(d.Module) {
		return nil, ErrNotFound
	}
	if len(paths) == 0 || len(paths) > OfficeFrameResolveMaxPaths {
		return nil, Invalid("paths cần từ 1 đến 50 mục")
	}
	return s.ResolvePaths(ctx, claims, d, paths)
}

// ResolvePaths signs the paths that resolve (as written → URL); a path that
// resolves to nothing is left out. d is the frame's already authorized
// document.
func (s *OfficeFrameService) ResolvePaths(ctx context.Context, claims OfficeFrameClaims, d OfficeFrameDocument, paths []string) (map[string]OfficeFrameAssetURL, error) {
	out := map[string]OfficeFrameAssetURL{}
	if len(paths) == 0 {
		return out, nil
	}
	w := &officeFrameWalk{s: s, claims: claims, doc: d.Document, children: map[string][]db.Document{}, names: map[string]string{}}
	assets, err := w.assetsByName(ctx)
	if err != nil {
		return nil, err
	}
	for i, raw := range paths {
		if i >= officeFrameMaxRefs {
			break
		}
		if _, done := out[raw]; done {
			continue
		}
		segs, ok := officeFramePathSegments(raw)
		if !ok {
			continue
		}
		if len(segs) == 2 && segs[0] == "assets" {
			if assetID, ok := assets[segs[1]]; ok {
				u, err := s.SignAsset(claims, assetID)
				if err != nil {
					return nil, err
				}
				out[raw] = u
				continue
			}
		}
		linkedID, err := w.sibling(ctx, segs)
		if err != nil {
			return nil, err
		}
		if linkedID == "" {
			continue
		}
		u, err := s.SignLinked(claims, linkedID)
		if err != nil {
			return nil, err
		}
		out[raw] = u
	}
	return out, nil
}

// officeFramePathSegments normalizes a relative path as written: query and
// fragment dropped, one percent-decode, `.` segments dropped. Absolute
// paths, schemes, backslashes, control characters, empty segments and a
// trailing `..` are refused.
func officeFramePathSegments(raw string) ([]string, bool) {
	p := strings.TrimSpace(raw)
	if p == "" || len(p) > officeFrameMaxRefLen {
		return nil, false
	}
	if i := strings.IndexAny(p, "?#"); i >= 0 {
		p = p[:i]
	}
	if p == "" || strings.HasPrefix(p, "/") || strings.Contains(p, "\\") || officeFrameHasScheme(p) {
		return nil, false
	}
	decoded, err := url.PathUnescape(p)
	if err != nil {
		return nil, false
	}
	for _, r := range decoded {
		if r < 0x20 || r == 0x7f || r == '\\' {
			return nil, false
		}
	}
	var segs []string
	for _, seg := range strings.Split(decoded, "/") {
		switch seg {
		case ".":
			continue
		case "":
			return nil, false
		}
		segs = append(segs, seg)
	}
	if len(segs) == 0 || len(segs) > officeFrameMaxWalk || segs[len(segs)-1] == ".." {
		return nil, false
	}
	return segs, true
}

// officeFrameHasScheme reports a URL scheme (`https:`, `data:`, `c:`): a
// colon before the first slash.
func officeFrameHasScheme(p string) bool {
	colon := strings.IndexByte(p, ':')
	if colon < 0 {
		return false
	}
	slash := strings.IndexByte(p, '/')
	return slash < 0 || colon < slash
}

// officeFrameWalk resolves the paths of one call, listing each folder and
// naming each folder's files once.
type officeFrameWalk struct {
	s        *OfficeFrameService
	claims   OfficeFrameClaims
	doc      db.Document
	children map[string][]db.Document
	names    map[string]string // document id -> stored file name
	viewable map[string]bool
	checks   int // ACL evaluations run so far (OfficeFrameMaxACLChecks)
}

// assetsByName maps the stored file name of each asset of the document to
// the newest asset under it.
func (w *officeFrameWalk) assetsByName(ctx context.Context) (map[string]string, error) {
	q := w.s.documents.q
	assets, err := q.ListDocumentAssetsByDocument(ctx, db.ListDocumentAssetsByDocumentParams{
		OrganizationID: w.doc.OrganizationID, WorkspaceID: w.doc.WorkspaceID, DocumentID: w.doc.ID,
	})
	if err != nil {
		return nil, err
	}
	ids := make([]files.FileID, 0, len(assets))
	for _, a := range assets {
		ids = append(ids, files.FileID(a.FileID))
	}
	names := w.s.fileNames(ctx, w.claims, ids)
	out := make(map[string]string, len(assets))
	// Oldest first, so the newest asset under a name wins.
	for _, a := range assets {
		if n := names[files.FileID(a.FileID)]; n != "" {
			out[n] = a.ID
		}
	}
	return out, nil
}

// sibling walks segs from the document's folder and answers the id of the
// file document they name, or "" when none the user may view does.
func (w *officeFrameWalk) sibling(ctx context.Context, segs []string) (string, error) {
	if ext := strings.ToLower(path.Ext(segs[len(segs)-1])); officeFrameLinkedTypes[ext].serve == "" {
		return "", nil
	}
	parent := w.doc.ParentID
	for _, seg := range segs[:len(segs)-1] {
		if seg == ".." {
			if !parent.Valid {
				return "", nil // above the workspace root
			}
			up, err := w.s.documents.q.GetDocument(ctx, db.GetDocumentParams{
				ID: parent.String, OrganizationID: w.doc.OrganizationID, WorkspaceID: w.doc.WorkspaceID,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				return "", nil
			}
			if err != nil {
				return "", err
			}
			// A trashed or unviewable ancestor ends the walk: its live children
			// are not "next to" a document the user reaches through it.
			if up.ArchivedAt.Valid {
				return "", nil
			}
			ok, err := w.canView(ctx, up)
			if err != nil || !ok {
				return "", err
			}
			parent = up.ParentID
			continue
		}
		kids, err := w.list(ctx, parent)
		if err != nil || kids == nil {
			return "", err
		}
		next := ""
		for _, k := range kids {
			if k.Title == seg {
				ok, err := w.canView(ctx, k)
				if err != nil {
					return "", err
				}
				if ok {
					next = k.ID
					break
				}
			}
		}
		if next == "" {
			return "", nil
		}
		parent = pgtype.Text{String: next, Valid: true}
	}
	kids, err := w.list(ctx, parent)
	if err != nil || kids == nil {
		return "", err
	}
	if err := w.nameFiles(ctx, kids); err != nil {
		return "", err
	}
	last := segs[len(segs)-1]
	// The stored file name first, then the title: a renamed document keeps
	// the name its page was written against.
	for _, byTitle := range []bool{false, true} {
		for _, k := range kids {
			if k.Kind != DocumentKindFile || k.ID == w.doc.ID {
				continue
			}
			name := w.names[k.ID]
			if byTitle {
				name = k.Title
			}
			if name != last {
				continue
			}
			ok, err := w.canView(ctx, k)
			if err != nil {
				return "", err
			}
			if ok {
				return k.ID, nil
			}
		}
	}
	return "", nil
}

// list is the live, unowned children of parent (none = the workspace root).
// nil once the call has listed officeFrameMaxWalk folders.
func (w *officeFrameWalk) list(ctx context.Context, parent pgtype.Text) ([]db.Document, error) {
	key := "root"
	if parent.Valid {
		key = parent.String
	}
	if kids, ok := w.children[key]; ok {
		return kids, nil
	}
	if len(w.children) >= officeFrameMaxWalk {
		return nil, nil
	}
	kids, err := w.s.documents.q.ListDocumentsByParent(ctx, db.ListDocumentsByParentParams{
		OrganizationID: w.doc.OrganizationID, WorkspaceID: w.doc.WorkspaceID, ParentID: parent,
	})
	if err != nil {
		return nil, err
	}
	if len(kids) > officeFrameMaxChildren {
		kids = kids[:officeFrameMaxChildren]
	}
	if kids == nil {
		kids = []db.Document{}
	}
	w.children[key] = kids
	return kids, nil
}

// nameFiles resolves the stored file names of the file documents in kids in
// one version query and one FileService batch, as Recents does.
func (w *officeFrameWalk) nameFiles(ctx context.Context, kids []db.Document) error {
	versionIDs := make([]string, 0, len(kids))
	for _, k := range kids {
		if _, done := w.names[k.ID]; done || k.Kind != DocumentKindFile || !k.FileVersionID.Valid {
			continue
		}
		w.names[k.ID] = ""
		versionIDs = append(versionIDs, k.FileVersionID.String)
	}
	if len(versionIDs) == 0 {
		return nil
	}
	versions, err := w.s.documents.q.ListDocumentVersionsByIDs(ctx, db.ListDocumentVersionsByIDsParams{
		OrganizationID: w.doc.OrganizationID, WorkspaceID: w.doc.WorkspaceID, Ids: versionIDs,
	})
	if err != nil {
		return err
	}
	fileIDs := make([]files.FileID, 0, len(versions))
	for _, v := range versions {
		if v.FileID.Valid {
			fileIDs = append(fileIDs, files.FileID(v.FileID.String))
		}
	}
	names := w.s.fileNames(ctx, w.claims, fileIDs)
	for _, v := range versions {
		if n := names[files.FileID(v.FileID.String)]; n != "" && v.FileID.Valid {
			w.names[v.DocumentID] = n
		}
	}
	return nil
}

// canView is the user's view access to a document of the walk, decided by
// the Documents ACL (organization gate, shares, restrictions; the same
// effectiveLevel and decideDocumentAccess authorizeDocument runs, on the row
// the walk already holds) once per id. A call runs at most
// OfficeFrameMaxACLChecks of them: one more distinct document is reported as
// not viewable and not remembered, so the open stays bounded however many
// files its references name.
func (w *officeFrameWalk) canView(ctx context.Context, doc db.Document) (bool, error) {
	if w.viewable == nil {
		w.viewable = map[string]bool{}
	}
	if ok, done := w.viewable[doc.ID]; done {
		return ok, nil
	}
	if w.checks >= OfficeFrameMaxACLChecks {
		return false, nil
	}
	w.checks++
	access, err := w.s.documents.effectiveLevel(ctx, w.s.documents.q, Human(w.claims.UserID), doc)
	if err == nil {
		err = decideDocumentAccess(doc, access, DocumentLevelView)
	}
	ok := err == nil
	// A refusal of any kind is "not viewable"; only a cancelled call stops the walk.
	if err != nil && ctx.Err() != nil {
		return false, ctx.Err()
	}
	w.viewable[doc.ID] = ok
	return ok, nil
}
