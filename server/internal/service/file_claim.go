package service

import (
	"context"
	"fmt"
	"sort"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ClaimInTx attaches files inside the module's own transaction (FS-C1
// sections 4 and 5.4). q is the module's q.WithTx(tx): the consumed session
// and the voided cleanup commit or roll back with the module's rows, so a
// failed save leaves every file staged for the user to try again.
//
// Lock order: every file id of the command - attached and replaced - in
// increasing order, then their sessions in the same order, before the module
// locks its own rows. The whole batch is checked before anything changes, so
// one refused id attaches nothing (all-or-nothing for a multi-file save).
//
// A file already claimed in the same scope and purpose attaches again without
// a session: reuse across business rows of one tenant is allowed (T1-Q3), and
// it is also what makes a retried save safe. The claimant is not required to
// be the uploader; the module has authorized the command, and FileService
// only checks purpose, scope, tenant and the session grant.
func (s *FileService) ClaimInTx(ctx context.Context, q *db.Queries, in files.ClaimInput) ([]files.File, error) {
	spec, err := s.registry.Lookup(in.Purpose)
	if err != nil {
		return nil, err
	}
	if err := spec.ValidateScope(in.Scope); err != nil {
		return nil, err
	}
	if len(in.FileIDs) == 0 {
		return nil, errFileEmptyClaim
	}
	now := s.now()
	attached := uniqueFileIDs(in.FileIDs)
	fileByID, sessByFile, err := lockForClaim(ctx, q, append(append([]files.FileID{}, attached...), in.Replaces...))
	if err != nil {
		return nil, err
	}

	ordered := append([]files.FileID{}, attached...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	for _, id := range ordered {
		file, fok := fileByID[id]
		sess, sok := sessByFile[id]
		if !fok || !inScope(file, sess, sok, in.Scope) || sess.Purpose != string(in.Purpose) {
			return nil, files.NotFound(id)
		}
		if err := fileState(file); err != nil {
			return nil, err
		}
		if err := sessionGrant(sess, now); err != nil {
			return nil, err
		}
	}
	for _, id := range uniqueFileIDs(in.Replaces) {
		file, fok := fileByID[id]
		sess, sok := sessByFile[id]
		if !fok || !inScope(file, sess, sok, in.Scope) {
			return nil, files.NotFound(id)
		}
		switch files.Status(file.Status) {
		case files.StatusDeleting:
			return nil, files.Deleting(id)
		case files.StatusDeleted:
			return nil, files.NotFound(id)
		}
	}

	out := make([]files.File, 0, len(attached))
	for _, id := range attached {
		file, sess := fileByID[id], sessByFile[id]
		if files.SessionStatus(sess.Status) == files.SessionStaged {
			n, err := q.ConsumeUploadSession(ctx, db.ConsumeUploadSessionParams{ID: sess.ID, Now: fileTime(now)})
			if err != nil {
				return nil, fmt.Errorf("files: consume session: %w", err)
			}
			if n == 0 {
				// The rows are locked, so only the window can have closed
				// between the check and the update.
				return nil, files.ClaimExpired(id)
			}
		}
		// A file released earlier and attached again is no longer garbage.
		if _, err := q.CancelPendingFileJobs(ctx, db.CancelPendingFileJobsParams{FileID: file.ID, Operation: fileJobCleanup, FinishedAt: fileTime(s.now())}); err != nil {
			return nil, fmt.Errorf("files: void cleanup: %w", err)
		}
		out = append(out, fileView(file))
	}
	return out, nil
}

// ReleaseInTx records, in the module's transaction, that the module removed
// its references. It deletes nothing: it queues the file for the collector
// (T5), which re-asks every ReferenceProvider under lock before touching bytes,
// so a file another row still holds survives (T1-Q3/T1-Q6). A file the
// collector already took is not an error - the module's unlink must still
// commit.
func (s *FileService) ReleaseInTx(ctx context.Context, q *db.Queries, ids []files.FileID) error {
	ids = uniqueFileIDs(ids)
	if len(ids) == 0 {
		return nil
	}
	now := s.now()
	fileByID, _, err := lockForClaim(ctx, q, ids)
	if err != nil {
		return err
	}
	for _, id := range ids {
		file, ok := fileByID[id]
		if !ok || files.Status(file.Status) == files.StatusDeleted {
			return files.NotFound(id)
		}
	}
	for _, id := range ids {
		file := fileByID[id]
		if files.Status(file.Status) == files.StatusDeleting {
			continue
		}
		if err := s.enqueueJob(ctx, q, file, fileJobCleanup, now); err != nil {
			return err
		}
	}
	return nil
}
