package service

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/retention"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (s *EmailHubService) emailHubRetentionLimits() retention.Limits {
	return retention.FromEnv()
}

// enforceEmailHubFolderRetention caps cached threads and strips old/excess bodies for one folder.
func (s *EmailHubService) enforceEmailHubFolderRetention(ctx context.Context, acc db.EmailHubAccount, folder string) {
	if !s.Enabled() {
		return
	}
	lim := s.emailHubRetentionLimits()
	s.expireEmailHubBodies(ctx, acc, lim)
	s.trimEmailHubBodyCache(ctx, acc, folder, lim)
	s.pruneEmailHubFolderCap(ctx, acc, folder, lim)
}

func (s *EmailHubService) enforceEmailHubAccountRetention(ctx context.Context, acc db.EmailHubAccount) {
	for _, folder := range emailhub.SyncableFolders() {
		s.enforceEmailHubFolderRetention(ctx, acc, folder)
	}
}

func (s *EmailHubService) expireEmailHubBodies(ctx context.Context, acc db.EmailHubAccount, lim retention.Limits) {
	if lim.BodyRetentionDays <= 0 {
		return
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -lim.BodyRetentionDays)
	keys, err := s.q.ExpireEmailHubThreadBodiesBefore(ctx, db.ExpireEmailHubThreadBodiesBeforeParams{
		AccountID: acc.ID, OrganizationID: acc.OrganizationID, SentAt: pgtype.Timestamptz{Time: cutoff, Valid: true},
	})
	if err != nil {
		s.log.Warn("email hub expire bodies failed", "account_id", acc.ID, "err", err)
		return
	}
	s.deleteEmailHubBodyObjects(ctx, keys)
}

func (s *EmailHubService) trimEmailHubBodyCache(ctx context.Context, acc db.EmailHubAccount, folder string, lim retention.Limits) {
	if lim.MaxBodyCachedPerFolder <= 0 {
		return
	}
	for {
		ids, err := s.q.ListEmailHubThreadIDsExcessBodyCache(ctx, db.ListEmailHubThreadIDsExcessBodyCacheParams{
			AccountID: acc.ID, OrganizationID: acc.OrganizationID, Folder: folder,
			KeepCount: int32(lim.MaxBodyCachedPerFolder), BatchLimit: int32(retention.PruneBatchSize()),
		})
		if err != nil {
			s.log.Warn("email hub list excess body cache failed", "account_id", acc.ID, "folder", folder, "err", err)
			return
		}
		if len(ids) == 0 {
			return
		}
		keys, err := s.q.InvalidateEmailHubThreadBodiesByIDs(ctx, db.InvalidateEmailHubThreadBodiesByIDsParams{
			AccountID: acc.ID, OrganizationID: acc.OrganizationID, Column3: ids,
		})
		if err != nil {
			s.log.Warn("email hub strip excess bodies failed", "account_id", acc.ID, "err", err)
			return
		}
		s.deleteEmailHubBodyObjects(ctx, keys)
		for _, id := range ids {
			s.invalidateEmailHubThreadAiSummaries(ctx, id)
		}
		if len(ids) < retention.PruneBatchSize() {
			return
		}
	}
}

func (s *EmailHubService) pruneEmailHubFolderCap(ctx context.Context, acc db.EmailHubAccount, folder string, lim retention.Limits) {
	if lim.MaxThreadsPerFolder <= 0 {
		return
	}
	for {
		ids, err := s.q.ListEmailHubThreadIDsOverFolderCap(ctx, db.ListEmailHubThreadIDsOverFolderCapParams{
			AccountID: acc.ID, OrganizationID: acc.OrganizationID, Folder: folder,
			KeepCount: int32(lim.MaxThreadsPerFolder), BatchLimit: int32(retention.PruneBatchSize()),
		})
		if err != nil {
			s.log.Warn("email hub list over cap failed", "account_id", acc.ID, "folder", folder, "err", err)
			return
		}
		if len(ids) == 0 {
			return
		}
		if err := s.deleteEmailHubThreadsByIDs(ctx, acc, ids); err != nil {
			s.log.Warn("email hub prune threads failed", "account_id", acc.ID, "folder", folder, "err", err)
			return
		}
		if len(ids) < retention.PruneBatchSize() {
			return
		}
	}
}

func (s *EmailHubService) deleteEmailHubThreadsByIDs(ctx context.Context, acc db.EmailHubAccount, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	if keys, err := s.bodyObjectKeysForThreads(ctx, acc, ids); err == nil {
		s.deleteEmailHubBodyObjects(ctx, keys)
	}
	if err := s.q.DeleteEmailHubAttachmentsForThreads(ctx, ids); err != nil {
		return err
	}
	if err := s.q.DeleteEmailHubThreadAiSummariesForThreads(ctx, ids); err != nil {
		return err
	}
	return s.q.DeleteEmailHubThreadsByIDs(ctx, db.DeleteEmailHubThreadsByIDsParams{
		AccountID: acc.ID, OrganizationID: acc.OrganizationID, ThreadIds: ids,
	})
}
