package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type ListEmailHubThreadsInput struct {
	AccountID          string
	Folder             string
	Limit              int32
	Query              string
	FromFilter         string
	BeforeID           string
	UnreadOnly         bool
	HasAttachmentsOnly bool
}

type ListEmailHubThreadsResult struct {
	Threads    []EmailHubThreadView
	Counts     EmailHubCounts
	NextCursor string
}

func (s *EmailHubService) ListThreads(
	ctx context.Context, actor Actor, workspaceID string, in ListEmailHubThreadsInput,
) (ListEmailHubThreadsResult, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return ListEmailHubThreadsResult{}, err
	}
	acc, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: in.AccountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ListEmailHubThreadsResult{}, ErrNotFound
		}
		return ListEmailHubThreadsResult{}, err
	}

	folder := normalizeEmailHubFolder(in.Folder)
	if folder == "" {
		folder = emailhub.FolderInbox
	}

	query := strings.TrimSpace(in.Query)
	if query != "" && in.BeforeID == "" {
		if indexErr := s.indexSearchResults(ctx, acc, folder, query); indexErr != nil {
			s.log.Warn("email hub imap search failed",
				"account_id", acc.ID, "folder", folder, "err", indexErr)
		}
	}

	limit := in.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	var beforeSent pgtype.Timestamptz
	beforeID := ""
	var cursorUID uint32
	if in.BeforeID != "" {
		cursor, err := s.q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
			ID: in.BeforeID, AccountID: in.AccountID, OrganizationID: ws.OrganizationID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ListEmailHubThreadsResult{}, ErrNotFound
			}
			return ListEmailHubThreadsResult{}, err
		}
		beforeSent = pgtype.Timestamptz{Time: cursor.SentAt.Time, Valid: true}
		beforeID = cursor.ID
		if cursor.ImapUid > 0 {
			cursorUID = uint32(cursor.ImapUid)
		}
	}

	rows, err := s.listThreadRows(ctx, in, ws.OrganizationID, folder, beforeSent, beforeID, limit)
	if err != nil {
		return ListEmailHubThreadsResult{}, err
	}

	if len(rows) == 0 && in.BeforeID != "" && cursorUID > 1 && listAllowsBackfill(in) && backfillSupportedFolder(folder) {
		if _, backfillErr := s.backfillOlderThreads(ctx, acc, folder, cursorUID); backfillErr != nil {
			s.log.Warn("email hub backfill failed",
				"account_id", acc.ID, "folder", folder, "before_uid", cursorUID, "err", backfillErr)
		} else {
			rows, err = s.listThreadRows(ctx, in, ws.OrganizationID, folder, beforeSent, beforeID, limit)
			if err != nil {
				return ListEmailHubThreadsResult{}, err
			}
		}
	}

	var total, unread int64
	if in.BeforeID == "" {
		if folder == emailhub.FolderStarred {
			counts, err := s.q.CountEmailHubStarredThreads(ctx, db.CountEmailHubStarredThreadsParams{
				AccountID: in.AccountID, OrganizationID: ws.OrganizationID,
			})
			if err != nil {
				return ListEmailHubThreadsResult{}, err
			}
			total, unread = counts.Total, counts.Unread
		} else {
			counts, err := s.q.CountEmailHubThreads(ctx, db.CountEmailHubThreadsParams{
				AccountID: in.AccountID, OrganizationID: ws.OrganizationID, Folder: folder,
			})
			if err != nil {
				return ListEmailHubThreadsResult{}, err
			}
			total, unread = counts.Total, counts.Unread
		}
	}

	out := make([]EmailHubThreadView, 0, len(rows))
	for _, r := range rows {
		out = append(out, threadView(r))
	}
	result := ListEmailHubThreadsResult{
		Threads: out,
		Counts:  EmailHubCounts{Total: total, Unread: unread},
	}
	if int32(len(rows)) == limit && len(rows) > 0 {
		result.NextCursor = rows[len(rows)-1].ID
	}
	return result, nil
}

func (s *EmailHubService) listThreadRows(
	ctx context.Context,
	in ListEmailHubThreadsInput,
	organizationID, folder string,
	beforeSent pgtype.Timestamptz,
	beforeID string,
	limit int32,
) ([]db.EmailHubThread, error) {
	return s.q.ListEmailHubThreadsPage(ctx, db.ListEmailHubThreadsPageParams{
		AccountID: in.AccountID, OrganizationID: organizationID, Folder: folder,
		UnreadOnly: in.UnreadOnly, HasAttachmentsOnly: in.HasAttachmentsOnly,
		FromFilter:   strings.TrimSpace(in.FromFilter),
		Query:        strings.TrimSpace(in.Query),
		BeforeSentAt: beforeSent, BeforeID: beforeID, LimitVal: limit,
	})
}
