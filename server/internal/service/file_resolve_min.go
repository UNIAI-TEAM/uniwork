package service

import (
	"context"
	"io"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
)

// This file is the minimal read path T3 needs for the contract suite to pass
// on the real service (Advisor ruling D1). T4 replaces it with the resolve
// API, hook and proxy route; it keeps these two methods' behaviour and does
// not touch NewFileService.

// ResolveMany returns per-id views for files the module has authorized. A
// refused id - out of scope, not ready, canceled, past its claim window, being
// deleted - carries its own error and no URL, and the others still resolve.
//
// Presign URLs live at most 12 hours (T1-Q7), and never beyond the grant
// behind them: an unclaimed file's grant is its upload session, which ends
// with the claim window.
func (s *FileService) ResolveMany(ctx context.Context, in files.ResolveInput) ([]files.Resolved, error) {
	records, err := s.loadInScope(ctx, s.q, in.Scope, in.FileIDs)
	if err != nil {
		return nil, err
	}
	now := s.now()
	out := make([]files.Resolved, 0, len(in.FileIDs))
	for _, id := range in.FileIDs {
		rec, ok := records[id]
		if !ok {
			out = append(out, files.Resolved{Err: files.NotFound(id)})
			continue
		}
		spec, err := s.registry.Lookup(files.UploadPurpose(rec.session.Purpose))
		if err != nil {
			out = append(out, files.Resolved{Err: err})
			continue
		}
		if in.Mode != spec.Policy.ReadMode {
			// The policy picks the mode; the other one is a module bug.
			return nil, files.ErrModeMismatch
		}
		if err := fileState(rec.file); err != nil {
			out = append(out, files.Resolved{Err: err})
			continue
		}
		if err := sessionGrant(rec.session, now); err != nil {
			out = append(out, files.Resolved{Err: err})
			continue
		}
		view := fileView(rec.file)
		resolved := files.Resolved{File: view}
		if in.Mode == files.ReadPresign {
			expires := now.Add(files.MaxResolveURLTTL)
			if files.SessionStatus(rec.session.Status) == files.SessionStaged && rec.session.ClaimExpiresAt.Time.Before(expires) {
				expires = rec.session.ClaimExpiresAt.Time
			}
			url, err := s.readURL(ctx, locator(rec.file), view, in.Disposition, expires.Sub(now))
			if err != nil {
				out = append(out, files.Resolved{Err: files.StorageUnavailable(err)})
				continue
			}
			resolved.URL = url
			resolved.URLExpiresAt = expires
		}
		out = append(out, resolved)
	}
	return out, nil
}

// readURL signs a GET for the object through the store (or the Signer
// override). An adapter without presign (local) refuses, and that id answers
// storage_unavailable: a presign purpose must not run on local (T2).
func (s *FileService) readURL(ctx context.Context, loc storage.ObjectLocator, view files.File, disposition files.Disposition, ttl time.Duration) (string, error) {
	cd := storage.ContentDisposition(view.ContentType, view.Filename)
	if disposition == files.DispositionAttachment {
		cd = storage.AttachmentContentDisposition(view.Filename)
	}
	signed, err := s.signer.SignRead(ctx, loc, storage.SignOptions{TTL: ttl, Disposition: cd})
	if err != nil {
		return "", err
	}
	return signed.URL, nil
}

// Open streams bytes for a module's proxy route: the module has authorized
// the actor, so this checks tenant, scope, file state and the session grant,
// then streams [Offset, Offset+Length) of the object.
func (s *FileService) Open(ctx context.Context, in files.OpenInput) (files.Reader, error) {
	if in.Offset < 0 || in.Length < 0 {
		return files.Reader{}, errFileInvalidRange
	}
	records, err := s.loadInScope(ctx, s.q, in.Scope, []files.FileID{in.FileID})
	if err != nil {
		return files.Reader{}, err
	}
	rec, ok := records[in.FileID]
	if !ok {
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
