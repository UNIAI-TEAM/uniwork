package service

import (
	"context"
	"fmt"
	"io"
	"slices"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// askFileTurns bounds the turns that run with files at once, in the process.
// The backend is one pod of 512 MiB (ADR 0025), and a turn with files keeps
// up to 20 MB of them in every model call it makes, about 27 MB more as the
// call's JSON; reading them (one at a time, fileReads) may add about 108 MiB
// more for a 20 MB PDF (attachtext's heap guard).
const askFileTurns = 2

// turnFilePlan is what a turn gives the model from its files (UNI-2119): those
// turnAttachments picks, read from the store and fit into askFileTokenShare. A
// turn with files holds one of the process's file turns from here until it
// calls release, when its run ends: its files ride every call of the run.
// Reading and fitting them hold the process's one file read besides, so one
// file is opened at a time. A turn waiting for either gives up with ctx. A
// turn with no file never waits, and its release does nothing.
func (s *AskUNIService) turnFilePlan(ctx context.Context, scope files.Scope, window []db.AiMessage, current []AskAttachment) (plan askFilePlan, release func(), err error) {
	release = func() {}
	picked, err := s.turnAttachments(ctx, scope.OrganizationID, window, current)
	if err != nil || len(picked) == 0 {
		return askFilePlan{}, release, err
	}
	if err := takeSlot(ctx, s.fileTurns); err != nil {
		return askFilePlan{}, release, err
	}
	// Deferred so a panic while reading gives the slot back too.
	held := false
	defer func() {
		if !held {
			<-s.fileTurns
		}
	}()
	if plan, err = s.readTurnPlan(ctx, scope, picked); err != nil {
		return askFilePlan{}, release, err
	}
	held = true
	return plan, func() { <-s.fileTurns }, nil
}

// readTurnPlan reads and fits picked while holding the process's file read.
func (s *AskUNIService) readTurnPlan(ctx context.Context, scope files.Scope, picked []AskAttachment) (askFilePlan, error) {
	if err := takeSlot(ctx, s.fileReads); err != nil {
		return askFilePlan{}, err
	}
	defer func() { <-s.fileReads }()
	loaded, err := s.readTurnFiles(ctx, scope, picked)
	if err != nil {
		return askFilePlan{}, err
	}
	return planAskFiles(loaded, askFileTokenShare)
}

// takeSlot takes a slot of sem, or gives up when ctx ends.
func takeSlot(ctx context.Context, sem chan struct{}) error {
	select {
	case sem <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// turnAttachments is the files a turn reads: the current question's, then
// those of the questions in window (the conversation's own rows that history
// replays), newest question first, askMaxAttachments at most and
// askMaxAttachmentsBytes in all. Of a question that does not fit whole, the
// files attached later win; an earlier file that would pass the byte cap is
// skipped for older, smaller ones. Each question keeps its attach order.
func (s *AskUNIService) turnAttachments(ctx context.Context, orgID string, window []db.AiMessage, current []AskAttachment) ([]AskAttachment, error) {
	picked := slices.Clone(current)
	var total int64 // the current question's files are already within the cap
	for _, a := range current {
		total += a.Size
	}
	var questions []string
	for _, m := range window {
		if m.Role == "user" {
			questions = append(questions, m.ID)
		}
	}
	if len(questions) == 0 || len(picked) >= askMaxAttachments {
		return picked, nil
	}
	rows, err := s.q.AiListAttachmentsForMessages(ctx, db.AiListAttachmentsForMessagesParams{OrganizationID: orgID, MessageIds: questions})
	if err != nil {
		return nil, err
	}
	byQuestion := map[string][]AskAttachment{}
	for _, a := range rows {
		byQuestion[a.MessageID] = append(byQuestion[a.MessageID], askAttachmentRow(a))
	}
	for i := len(questions) - 1; i >= 0 && len(picked) < askMaxAttachments; i-- {
		fs := byQuestion[questions[i]]
		var kept []AskAttachment
		for j := len(fs) - 1; j >= 0 && len(picked)+len(kept) < askMaxAttachments; j-- {
			// Every round resends the turn's files: past 20 MB a call nears the
			// vendor's request limit (32 MB at Anthropic) and every follow-up would fail.
			if total+fs[j].Size > askMaxAttachmentsBytes {
				continue
			}
			total += fs[j].Size
			kept = append(kept, fs[j])
		}
		slices.Reverse(kept)
		picked = append(picked, kept...)
	}
	return picked, nil
}

// askAttachmentRow is a stored file as the answer path knows it.
func askAttachmentRow(a db.AiAttachment) AskAttachment {
	return AskAttachment{ID: a.ID, FileID: a.FileID, Name: a.Name, MIME: a.Mime, Kind: a.Kind, Size: a.SizeBytes}
}

// readTurnFiles reads each file's bytes from the store. A file the store
// cannot serve fails the turn like any storage failure, uncoded: it is not
// the asker's file that is unreadable.
func (s *AskUNIService) readTurnFiles(ctx context.Context, scope files.Scope, picked []AskAttachment) ([]askFileBytes, error) {
	out := make([]askFileBytes, 0, len(picked))
	for _, a := range picked {
		r, err := s.files.Open(ctx, files.OpenInput{Scope: scope, FileID: files.FileID(a.FileID)})
		if err != nil {
			return nil, fmt.Errorf("ask uni: open file %s: %w", a.FileID, err)
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, askMaxAttachmentsBytes+1))
		_ = r.Close()
		if err != nil {
			return nil, fmt.Errorf("ask uni: read file %s: %w", a.FileID, err)
		}
		if len(body) > askMaxAttachmentsBytes { // an upload cannot be this big; the store is wrong
			return nil, fmt.Errorf("ask uni: file %s is over %d bytes", a.FileID, askMaxAttachmentsBytes)
		}
		out = append(out, askFileBytes{AskAttachment: a, Body: body})
	}
	return out, nil
}
