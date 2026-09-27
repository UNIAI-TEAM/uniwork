package service

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// This file is FileService's read path (T4, spec 2026-09-22 section 8):
// ResolveMany and Open for modules that have already authorized the reference
// they read, on top of one batch query per call.
//
// The rules every method keeps:
//
//   - The file and its session come back in one query per batch, tenant and
//     identity branches in separate queries, so a tenant request never falls
//     back to a NULL-tenant file (T1-Q10) and no id costs its own round trip.
//   - A presigned URL lives min(12 hours, the signing credential) (T1-Q7);
//     the credential's limit is whatever expiry the signer reports. A staged
//     file's URL also stops at its claim window (T1-Q5), past which no read
//     through the upload session is allowed. FS-C1 v1 carries no module grant
//     (guest or share expiry) in ResolveInput, so none can cap the URL yet -
//     a documented v1 gap (GrantExpiresAt is a v1.1 candidate).
//   - A signing error is storage_unavailable for that id and never a public or
//     unsigned URL.
//   - Presign and proxy are different promises: a presigned URL names the
//     storage host and object path, a proxy route hides both. The purpose
//     policy picks one and the caller must ask for that one.

// resolveFilter narrows which loaded records a read path may serve. A record
// it refuses is file_not_found for that id, exactly like a foreign one.
type resolveFilter func(fileRecord) bool

// ResolveMany returns one entry per requested id, in request order (a
// duplicated id gets a duplicated entry), for files the module has
// authorized. A refused id - out of scope, not ready, canceled, past its claim
// window, being deleted - carries its own error and no URL, and the others
// still resolve.
func (s *FileService) ResolveMany(ctx context.Context, in files.ResolveInput) ([]files.Resolved, error) {
	mode := in.Mode
	entries, err := s.resolveRecords(ctx, in.Scope, &mode, in.Disposition, in.FileIDs, nil)
	if err != nil {
		return nil, err
	}
	out := make([]files.Resolved, len(entries))
	for i, e := range entries {
		out[i] = e.Resolved
	}
	return out, nil
}

// resolvedEntry is one resolve result plus the claim window behind it, so a
// caller that mints its own proxy ticket caps it without loading the file
// again.
type resolvedEntry struct {
	files.Resolved
	// ClaimWindowEnds is the claim window of a staged file; zero for a
	// claimed one.
	ClaimWindowEnds time.Time
}

// resolveRecords is ResolveMany with two knobs the module-facing contract does
// not expose: mode nil resolves every id in its own purpose's mode (the
// upload-session route serves mixed purposes), and keep drops records the
// caller's context does not cover.
func (s *FileService) resolveRecords(ctx context.Context, scope files.Scope, mode *files.ReadMode, disposition files.Disposition, ids []files.FileID, keep resolveFilter) ([]resolvedEntry, error) {
	records, err := s.loadResolvable(ctx, scope, ids)
	if err != nil {
		return nil, err
	}
	now := s.now()
	out := make([]resolvedEntry, 0, len(ids))
	refuse := func(err error) {
		out = append(out, resolvedEntry{Resolved: files.Resolved{Err: err}})
	}
	for _, id := range ids {
		rec, ok := records[id]
		if !ok || (keep != nil && !keep(rec)) {
			refuse(files.NotFound(id))
			continue
		}
		spec, err := s.registry.Lookup(files.UploadPurpose(rec.session.Purpose))
		if err != nil {
			refuse(err)
			continue
		}
		readMode := spec.Policy.ReadMode
		if mode != nil && *mode != readMode {
			// The policy picks the mode; the other one is a module bug, so
			// the whole batch fails instead of leaking a URL of the wrong kind.
			return nil, files.ErrModeMismatch
		}
		if err := fileState(rec.file); err != nil {
			refuse(err)
			continue
		}
		if err := sessionGrant(rec.session, now); err != nil {
			refuse(err)
			continue
		}
		entry := resolvedEntry{Resolved: files.Resolved{File: fileView(rec.file)}}
		if end, ok := claimWindowEnd(rec.session); ok {
			entry.ClaimWindowEnds = end
		}
		if readMode == files.ReadPresign {
			url, expires, err := s.presignRead(ctx, rec, disposition, now)
			if err != nil {
				refuse(files.StorageUnavailable(err))
				continue
			}
			entry.URL = url
			entry.URLExpiresAt = expires
		}
		out = append(out, entry)
	}
	return out, nil
}

// claimWindowEnd is when reads through the upload session stop for a staged
// file (T1-Q5). A claimed file has none: it is read through the module's
// reference, which the module checks on every read.
func claimWindowEnd(sess db.FileUploadSession) (time.Time, bool) {
	if files.SessionStatus(sess.Status) == files.SessionStaged && sess.ClaimExpiresAt.Valid {
		return sess.ClaimExpiresAt.Time, true
	}
	return time.Time{}, false
}

// presignRead signs a GET for one record and returns the URL with the instant
// it stops working: min(12h, the claim window of a staged file, the
// credential expiry the signer reports). The URL is used exactly as signed - host, path and query are never
// rewritten afterwards, because that would break the signature.
func (s *FileService) presignRead(ctx context.Context, rec fileRecord, disposition files.Disposition, now time.Time) (string, time.Time, error) {
	expires := now.Add(files.MaxResolveURLTTL)
	if end, ok := claimWindowEnd(rec.session); ok && end.Before(expires) {
		expires = end
	}
	// Callers run sessionGrant first, so a staged file here still has window
	// left; the guard keeps a future caller that skips it from signing a URL
	// that is dead on arrival.
	if !expires.After(now) {
		return "", time.Time{}, fmt.Errorf("files: claim window for %s already ended", rec.file.ID)
	}
	view := fileView(rec.file)
	signed, err := s.signer.SignRead(ctx, locator(rec.file), storage.SignOptions{
		TTL:         expires.Sub(now),
		Disposition: fileContentDisposition(view, disposition),
	})
	if err != nil {
		return "", time.Time{}, err
	}
	if strings.TrimSpace(signed.URL) == "" {
		// An adapter that "signs" to nothing has no capability; an empty URL
		// must not reach a client as if it were one.
		return "", time.Time{}, fmt.Errorf("files: signer returned no URL for %s", rec.file.ID)
	}
	if !signed.ExpiresAt.IsZero() {
		// A temporary credential that ends sooner caps the URL (T1-Q7).
		at := signed.ExpiresAt.UTC().Truncate(time.Microsecond)
		if at.Before(expires) {
			expires = at
		}
		if !expires.After(now) {
			return "", time.Time{}, fmt.Errorf("files: signing credential for %s already expired", rec.file.ID)
		}
	}
	return signed.URL, expires, nil
}

// fileContentDisposition is the one Content-Disposition a read of view gets,
// from the shared filename in files (T1-Q3/T1-Q4) - never a name a reference
// stored on its own. Inline is only granted to types the browser can render
// without running script in our origin (storage.ContentDisposition refuses
// SVG and HTML); everything else downloads.
func fileContentDisposition(view files.File, disposition files.Disposition) string {
	if disposition == files.DispositionAttachment {
		return storage.AttachmentContentDisposition(view.Filename)
	}
	return storage.ContentDisposition(view.ContentType, view.Filename)
}

// Open streams bytes for a module's proxy route: the module has authorized
// the actor, so this checks tenant, scope, file state and the upload session,
// then streams [Offset, Offset+Length) of the object. The caller owns Close.
func (s *FileService) Open(ctx context.Context, in files.OpenInput) (files.Reader, error) {
	return s.openRecord(ctx, in, nil)
}

// openRecord is Open with the same keep filter resolveRecords takes.
func (s *FileService) openRecord(ctx context.Context, in files.OpenInput, keep resolveFilter) (files.Reader, error) {
	if in.Offset < 0 || in.Length < 0 {
		return files.Reader{}, errFileInvalidRange
	}
	records, err := s.loadResolvable(ctx, in.Scope, []files.FileID{in.FileID})
	if err != nil {
		return files.Reader{}, err
	}
	rec, ok := records[in.FileID]
	if !ok || (keep != nil && !keep(rec)) {
		return files.Reader{}, files.NotFound(in.FileID)
	}
	if err := fileState(rec.file); err != nil {
		return files.Reader{}, err
	}
	if err := sessionGrant(rec.session, s.now()); err != nil {
		return files.Reader{}, err
	}
	view := fileView(rec.file)
	if in.Offset >= view.SizeBytes {
		// Past the end is an empty read, as the fake answers; the proxy route
		// turns it into its own 416.
		return files.Reader{File: view, Body: io.NopCloser(strings.NewReader(""))}, nil
	}
	obj, err := s.store.Open(ctx, locator(rec.file), storage.ReadOptions{Offset: in.Offset, Length: in.Length})
	if err != nil {
		return files.Reader{}, files.StorageUnavailable(err)
	}
	return files.Reader{File: view, Body: obj.Body}, nil
}

// loadResolvable loads the files and sessions behind ids for one scope in a
// single query: the tenant branch when the scope has an organization, the
// identity branch (account avatars) when it has only a user, nothing
// otherwise. A row whose session scope differs from the caller's is dropped,
// so an id outside the scope is file_not_found whether it exists or not.
func (s *FileService) loadResolvable(ctx context.Context, scope files.Scope, ids []files.FileID) (map[files.FileID]fileRecord, error) {
	want := make([]string, 0, len(ids))
	for _, id := range uniqueFileIDs(ids) {
		if id != "" {
			want = append(want, string(id))
		}
	}
	out := make(map[files.FileID]fileRecord, len(want))
	if len(want) == 0 {
		return out, nil
	}
	add := func(file db.File, sess db.FileUploadSession) {
		if sessionScope(sess) != scope || file.OrganizationID.String != scope.OrganizationID {
			return
		}
		out[files.FileID(file.ID)] = fileRecord{file: file, session: sess}
	}
	switch {
	case scope.OrganizationID != "":
		rows, err := s.q.ListOrgFilesWithSessionsByIDs(ctx, db.ListOrgFilesWithSessionsByIDsParams{
			OrganizationID: fileText(scope.OrganizationID),
			FileIds:        want,
		})
		if err != nil {
			return nil, fmt.Errorf("files: resolve load: %w", err)
		}
		for _, row := range rows {
			add(row.File, row.FileUploadSession)
		}
	case scope.UserID != "" && scope.WorkspaceID == "":
		rows, err := s.q.ListAvatarFilesWithSessionsByIDs(ctx, db.ListAvatarFilesWithSessionsByIDsParams{
			UserID:  fileText(scope.UserID),
			FileIds: want,
		})
		if err != nil {
			return nil, fmt.Errorf("files: resolve load avatar: %w", err)
		}
		for _, row := range rows {
			add(row.File, row.FileUploadSession)
		}
	}
	return out, nil
}
