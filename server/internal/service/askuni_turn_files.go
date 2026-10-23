package service

import (
	"context"
	"fmt"
	"io"
	"slices"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// askFileReaders bounds the turns reading their files at once, across the
// process: one PDF or Office read can hold 0.25-0.5 GiB for about a second.
const askFileReaders = 2

// turnFilePlan is what a turn gives the model from its files (UNI-2119): those
// turnAttachments picks, read from the store and fit into askFileTokenShare.
// Reading and fitting hold one of the process's file readers; a turn waiting
// for one gives up with ctx. A turn with no file never waits.
func (s *AskUNIService) turnFilePlan(ctx context.Context, scope files.Scope, window []db.AiMessage, current []AskAttachment) (askFilePlan, error) {
	picked, err := s.turnAttachments(ctx, scope.OrganizationID, window, current)
	if err != nil || len(picked) == 0 {
		return askFilePlan{}, err
	}
	select {
	case s.fileReaders <- struct{}{}:
	case <-ctx.Done():
		return askFilePlan{}, ctx.Err()
	}
	defer func() { <-s.fileReaders }()
	loaded, err := s.readTurnFiles(ctx, scope, picked)
	if err != nil {
		return askFilePlan{}, err
	}
	return planAskFiles(loaded, askFileTokenShare)
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
