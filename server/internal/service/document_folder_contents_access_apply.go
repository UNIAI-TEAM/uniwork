package service

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// folderContentsOutcome holds the running counts across a sync batch or a
// background chunk.
type folderContentsOutcome struct {
	Processed            int
	Changed              int
	Unchanged            int
	SkippedNotManageable int
	SkippedLocked        int
}

func (s *DocumentService) previewFolderContentsAccess(
	ctx context.Context,
	actor Actor,
	folder db.Document,
	mode string,
	items []FolderContentsAccessItem,
	docIDs []string,
) (FolderContentsAccessResult, error) {
	q := s.q
	var (
		changed              int
		unchanged            int
		skippedNotManageable int
		skippedLocked        int
	)
	var allMembers []string
	var losingSet, downgradedSet map[string]bool
	if mode == FolderContentsAccessModeReplace && len(docIDs) > 0 {
		members, err := q.ListActiveOrgMemberUserIDsForAccessBatch(ctx, folder.OrganizationID)
		if err != nil {
			return FolderContentsAccessResult{}, err
		}
		allMembers = members
		losingSet = make(map[string]bool)
		downgradedSet = make(map[string]bool)
	}

	for _, docID := range docIDs {
		doc, err := q.GetDocument(ctx, db.GetDocumentParams{
			ID:             docID,
			OrganizationID: folder.OrganizationID,
			WorkspaceID:    folder.WorkspaceID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return FolderContentsAccessResult{}, err
		}
		if doc.ArchivedAt.Valid || doc.Kind == DocumentKindFolder || isMyFolder(doc) {
			continue
		}
		if doc.OwnerID.Valid && doc.OwnerID.String != "" {
			skippedLocked++
			continue
		}
		sharesBefore, err := q.ListDocumentShares(ctx, db.ListDocumentSharesParams{
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
			DocumentID:     doc.ID,
		})
		if err != nil {
			return FolderContentsAccessResult{}, err
		}
		acc, err := s.resolveLevelInTenantWithShares(ctx, q, actor, doc, sharesBefore)
		if err != nil {
			return FolderContentsAccessResult{}, err
		}
		if !acc.canAdminister() {
			skippedNotManageable++
			continue
		}

		wouldChange := decideFolderContentsDocWouldChange(doc, sharesBefore, mode, items)
		if wouldChange {
			changed++
		} else {
			unchanged++
		}

		if mode == FolderContentsAccessModeReplace && len(allMembers) > 0 {
			beforeMap, err := s.resolveLevelsInTenantWithShares(ctx, q, doc, sharesBefore, allMembers)
			if err != nil {
				return FolderContentsAccessResult{}, err
			}
			simDoc, simShares := simulateFolderContentsDocAfter(doc, sharesBefore, mode, items)
			afterMap, err := s.resolveLevelsInTenantWithShares(ctx, q, simDoc, simShares, allMembers)
			if err != nil {
				return FolderContentsAccessResult{}, err
			}
			for _, uid := range allMembers {
				b := beforeMap[uid].Level
				a := afterMap[uid].Level
				if b.rank() > 0 && a.rank() == 0 {
					losingSet[uid] = true
				} else if b.rank() > 0 && a.rank() > 0 && a.rank() < b.rank() {
					downgradedSet[uid] = true
				}
			}
		}
	}

	losingUsers := len(losingSet)
	downgradedUsers := len(downgradedSet)
	warnings := computeFolderContentsWarnings(folder.WorkspaceID, mode, items, len(docIDs), changed, losingUsers, downgradedUsers)

	return FolderContentsAccessResult{
		DryRun: true,
		Total:  len(docIDs),
		Preview: FolderContentsAccessPreview{
			Changed:              changed,
			Unchanged:            unchanged,
			SkippedNotManageable: skippedNotManageable,
			SkippedLocked:        skippedLocked,
			LosingUsers:          losingUsers,
			DowngradedUsers:      downgradedUsers,
			Warnings:             warnings,
		},
	}, nil
}

func computeFolderContentsWarnings(
	workspaceID string,
	mode string,
	items []FolderContentsAccessItem,
	total int,
	changed int,
	losingUsers int,
	downgradedUsers int,
) []string {
	warnings := make([]string, 0, 3)
	hasWide := false
	for _, it := range items {
		if it.PrincipalType == DocumentPrincipalOrganization ||
			(it.PrincipalType == DocumentPrincipalWorkspace && it.PrincipalID != workspaceID) {
			hasWide = true
			break
		}
	}
	if hasWide && total >= 20 {
		warnings = append(warnings, FolderContentsAccessWarningWideScope)
	}
	if mode == FolderContentsAccessModeReplace && len(items) > 0 && (losingUsers > 0 || downgradedUsers > 0) {
		warnings = append(warnings, FolderContentsAccessWarningDowngrade)
	}
	if mode == FolderContentsAccessModeReplace && len(items) == 0 && changed > 0 {
		warnings = append(warnings, FolderContentsAccessWarningToPrivate)
	}
	return warnings
}

func decideFolderContentsDocWouldChange(
	doc db.Document,
	sharesBefore []db.DocumentShare,
	mode string,
	items []FolderContentsAccessItem,
) bool {
	legacyHome := filterHomeWorkspaceShares(sharesBefore, doc.WorkspaceID)
	liveByKey := make(map[string]db.DocumentShare, len(sharesBefore))
	for _, sh := range sharesBefore {
		if sh.PrincipalType == DocumentPrincipalWorkspace && sh.PrincipalID == doc.WorkspaceID {
			continue
		}
		liveByKey[sh.PrincipalType+"\x00"+sh.PrincipalID] = sh
	}

	switch mode {
	case FolderContentsAccessModeMerge:
		for _, it := range items {
			if it.PrincipalType == DocumentPrincipalWorkspace && it.PrincipalID == doc.WorkspaceID {
				curLvl, hasHome := currentHomeWorkspaceLevel(doc, legacyHome)
				if !hasHome || it.Level.rank() > curLvl.rank() || len(legacyHome) > 0 {
					return true
				}
				continue
			}
			sh, ok := liveByKey[it.PrincipalType+"\x00"+it.PrincipalID]
			if !ok || it.Level.rank() > DocumentLevel(sh.Level).rank() {
				return true
			}
		}
		return false

	case FolderContentsAccessModeReplace:
		var targetHome *DocumentLevel
		targetByKey := make(map[string]FolderContentsAccessItem, len(items))
		for _, it := range items {
			if it.PrincipalType == DocumentPrincipalWorkspace && it.PrincipalID == doc.WorkspaceID {
				lvl := it.Level
				targetHome = &lvl
				continue
			}
			targetByKey[it.PrincipalType+"\x00"+it.PrincipalID] = it
		}
		if targetHome != nil {
			if doc.Visibility != documentVisibilityWorkspace || DocumentLevel(doc.WorkspaceLevel) != *targetHome || len(legacyHome) > 0 {
				return true
			}
		} else {
			if doc.Visibility != documentVisibilityRestricted || len(legacyHome) > 0 {
				return true
			}
		}
		for k, sh := range liveByKey {
			it, want := targetByKey[k]
			if !want || DocumentLevel(sh.Level) != it.Level {
				return true
			}
		}
		for k := range targetByKey {
			if _, had := liveByKey[k]; !had {
				return true
			}
		}
		return false
	}
	return false
}

func simulateFolderContentsDocAfter(
	doc db.Document,
	sharesBefore []db.DocumentShare,
	mode string,
	items []FolderContentsAccessItem,
) (db.Document, []db.DocumentShare) {
	simDoc := doc
	legacyHome := filterHomeWorkspaceShares(sharesBefore, doc.WorkspaceID)
	liveByKey := make(map[string]db.DocumentShare, len(sharesBefore))
	for _, sh := range sharesBefore {
		if sh.PrincipalType == DocumentPrincipalWorkspace && sh.PrincipalID == doc.WorkspaceID {
			continue
		}
		liveByKey[sh.PrincipalType+"\x00"+sh.PrincipalID] = sh
	}

	switch mode {
	case FolderContentsAccessModeMerge:
		for _, it := range items {
			if it.PrincipalType == DocumentPrincipalWorkspace && it.PrincipalID == doc.WorkspaceID {
				curLvl, hasHome := currentHomeWorkspaceLevel(simDoc, legacyHome)
				target := it.Level
				if hasHome && curLvl.rank() > target.rank() {
					target = curLvl
				}
				simDoc.Visibility = documentVisibilityWorkspace
				simDoc.WorkspaceLevel = string(target)
				legacyHome = nil
				continue
			}
			k := it.PrincipalType + "\x00" + it.PrincipalID
			if sh, ok := liveByKey[k]; ok {
				if it.Level.rank() > DocumentLevel(sh.Level).rank() {
					sh.Level = string(it.Level)
					liveByKey[k] = sh
				}
			} else {
				liveByKey[k] = db.DocumentShare{
					OrganizationID: doc.OrganizationID,
					WorkspaceID:    doc.WorkspaceID,
					DocumentID:     doc.ID,
					PrincipalType:  it.PrincipalType,
					PrincipalID:    it.PrincipalID,
					Level:          string(it.Level),
				}
			}
		}

	case FolderContentsAccessModeReplace:
		var targetHome *DocumentLevel
		nextLive := make(map[string]db.DocumentShare, len(items))
		for _, it := range items {
			if it.PrincipalType == DocumentPrincipalWorkspace && it.PrincipalID == doc.WorkspaceID {
				lvl := it.Level
				targetHome = &lvl
				continue
			}
			k := it.PrincipalType + "\x00" + it.PrincipalID
			nextLive[k] = db.DocumentShare{
				OrganizationID: doc.OrganizationID,
				WorkspaceID:    doc.WorkspaceID,
				DocumentID:     doc.ID,
				PrincipalType:  it.PrincipalType,
				PrincipalID:    it.PrincipalID,
				Level:          string(it.Level),
			}
		}
		if targetHome != nil {
			simDoc.Visibility = documentVisibilityWorkspace
			simDoc.WorkspaceLevel = string(*targetHome)
		} else {
			simDoc.Visibility = documentVisibilityRestricted
		}
		legacyHome = nil
		liveByKey = nextLive
	}

	outShares := make([]db.DocumentShare, 0, len(liveByKey)+len(legacyHome))
	outShares = append(outShares, legacyHome...)
	for _, sh := range liveByKey {
		outShares = append(outShares, sh)
	}
	return simDoc, outShares
}

func (s *DocumentService) executeFolderContentsAccessSync(
	ctx context.Context,
	tx pgx.Tx,
	q *db.Queries,
	actor Actor,
	folder db.Document,
	batchID string,
	mode string,
	items []FolderContentsAccessItem,
	itemsJSON []byte,
	docIDs []string,
) (FolderContentsAccessResult, error) {
	notifiedLevels := make(map[string]string)
	var outcome folderContentsOutcome

	userItemIDs := make([]string, 0, len(items))
	for _, it := range items {
		if it.PrincipalType == DocumentPrincipalUser {
			userItemIDs = append(userItemIDs, it.PrincipalID)
		}
	}

	for _, docID := range docIDs {
		doc, err := q.LockDocumentByID(ctx, docID)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return FolderContentsAccessResult{}, err
		}
		if doc.OrganizationID != folder.OrganizationID || doc.WorkspaceID != folder.WorkspaceID {
			continue
		}
		res, err := s.applyFolderContentsAccessToLockedDoc(ctx, q, actor, folder, batchID, mode, items, userItemIDs, doc, notifiedLevels)
		if err != nil {
			return FolderContentsAccessResult{}, err
		}
		outcome.Processed += res.Processed
		outcome.Changed += res.Changed
		outcome.Unchanged += res.Unchanged
		outcome.SkippedNotManageable += res.SkippedNotManageable
		outcome.SkippedLocked += res.SkippedLocked
	}

	notifiedJSON, err := json.Marshal(notifiedLevels)
	if err != nil {
		return FolderContentsAccessResult{}, err
	}
	cursorID := ""
	if len(docIDs) > 0 {
		cursorID = docIDs[len(docIDs)-1]
	}
	now := s.now().UTC()
	if _, err := q.InsertDocumentAccessBatch(ctx, db.InsertDocumentAccessBatchParams{
		ID:                   batchID,
		OrganizationID:       folder.OrganizationID,
		WorkspaceID:          folder.WorkspaceID,
		FolderID:             folder.ID,
		CreatedBy:            actor.ID,
		CreatedByKind:        string(actor.Kind),
		Mode:                 mode,
		Items:                itemsJSON,
		DocumentIds:          docIDs,
		NotifiedLevels:       notifiedJSON,
		Status:               FolderContentsAccessBatchStatusCompleted,
		Total:                int32(len(docIDs)),
		Processed:            int32(outcome.Processed),
		Changed:              int32(outcome.Changed),
		Unchanged:            int32(outcome.Unchanged),
		SkippedNotManageable: int32(outcome.SkippedNotManageable),
		SkippedLocked:        int32(outcome.SkippedLocked),
		CursorID:             cursorID,
		FinishedAt:           pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil {
		return FolderContentsAccessResult{}, err
	}

	if err := recordFolderContentsBatchCompletedAudit(ctx, q, actor, folder, batchID, mode, items, len(docIDs), outcome, FolderContentsAccessExecSync); err != nil {
		return FolderContentsAccessResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return FolderContentsAccessResult{}, err
	}

	return FolderContentsAccessResult{
		ExecMode:             FolderContentsAccessExecSync,
		BatchID:              batchID,
		Total:                len(docIDs),
		Changed:              outcome.Changed,
		Unchanged:            outcome.Unchanged,
		SkippedNotManageable: outcome.SkippedNotManageable,
		SkippedLocked:        outcome.SkippedLocked,
	}, nil
}

// applyFolderContentsAccessToLockedDoc applies mode + items to one already-locked
// document row inside q's transaction, updating notifiedLevels in place so each
// recipient is notified at most once per (batch_id, user_id, new_level).
func (s *DocumentService) applyFolderContentsAccessToLockedDoc(
	ctx context.Context,
	q *db.Queries,
	actor Actor,
	folder db.Document,
	batchID string,
	mode string,
	items []FolderContentsAccessItem,
	userItemIDs []string,
	doc db.Document,
	notifiedLevels map[string]string,
) (folderContentsOutcome, error) {
	if doc.ArchivedAt.Valid || doc.Kind == DocumentKindFolder || isMyFolder(doc) {
		return folderContentsOutcome{}, nil
	}
	if doc.OwnerID.Valid && doc.OwnerID.String != "" {
		return folderContentsOutcome{Processed: 1, SkippedLocked: 1}, nil
	}

	sharesBefore, err := q.ListDocumentShares(ctx, db.ListDocumentSharesParams{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
	})
	if err != nil {
		return folderContentsOutcome{}, err
	}
	acc, err := s.resolveLevelInTenantWithShares(ctx, q, actor, doc, sharesBefore)
	if err != nil {
		return folderContentsOutcome{}, err
	}
	if !acc.canAdminister() {
		return folderContentsOutcome{Processed: 1, SkippedNotManageable: 1}, nil
	}

	if !decideFolderContentsDocWouldChange(doc, sharesBefore, mode, items) {
		return folderContentsOutcome{Processed: 1, Unchanged: 1}, nil
	}

	// Compute notify recipients before mutating the document's ACL: a user item
	// notifies only when its final effective level strictly exceeds its before
	// effective level AND notifiedLevels[uid] != string(afterLevel) (spec §6).
	notifyUserByID := make(map[string]string, len(userItemIDs))
	var beforeLevels map[string]DocumentAccess
	if len(userItemIDs) > 0 {
		beforeLevels, err = s.resolveLevelsInTenantWithShares(ctx, q, doc, sharesBefore, userItemIDs)
		if err != nil {
			return folderContentsOutcome{}, err
		}
		simDoc, simShares := simulateFolderContentsDocAfter(doc, sharesBefore, mode, items)
		afterLevels, err := s.resolveLevelsInTenantWithShares(ctx, q, simDoc, simShares, userItemIDs)
		if err != nil {
			return folderContentsOutcome{}, err
		}
		for _, uid := range userItemIDs {
			if uid == actor.ID {
				continue
			}
			b := beforeLevels[uid].Level
			a := afterLevels[uid].Level
			if a.rank() > b.rank() && notifiedLevels[uid] != string(a) {
				notifyUserByID[uid] = uid
				notifiedLevels[uid] = string(a)
			}
		}
	}

	batchMeta := documentShareBatchMeta{
		BatchID: batchID,
		Via:     FolderContentsAccessVia,
	}

	legacyHome := filterHomeWorkspaceShares(sharesBefore, doc.WorkspaceID)
	liveByKey := make(map[string]db.DocumentShare, len(sharesBefore))
	for _, sh := range sharesBefore {
		if sh.PrincipalType == DocumentPrincipalWorkspace && sh.PrincipalID == doc.WorkspaceID {
			continue
		}
		liveByKey[sh.PrincipalType+"\x00"+sh.PrincipalID] = sh
	}

	updatedDoc := doc

	switch mode {
	case FolderContentsAccessModeMerge:
		for _, it := range items {
			if it.PrincipalType == DocumentPrincipalWorkspace && it.PrincipalID == doc.WorkspaceID {
				curLvl, hasHome := currentHomeWorkspaceLevel(updatedDoc, legacyHome)
				if hasHome && curLvl.rank() >= it.Level.rank() && len(legacyHome) == 0 {
					continue
				}
				target := it.Level
				if hasHome && curLvl.rank() > target.rank() {
					target = curLvl
				}
				var err error
				updatedDoc, err = writeDocumentHomeRow(ctx, q, actor, updatedDoc, documentHomeRowMove{
					Visibility:     documentVisibilityWorkspace,
					WorkspaceLevel: string(target),
					BatchID:        batchID,
					BatchMeta:      batchMeta,
				})
				if err != nil {
					return folderContentsOutcome{}, err
				}
				legacyHome = nil
				continue
			}
			k := it.PrincipalType + "\x00" + it.PrincipalID
			if sh, ok := liveByKey[k]; ok && DocumentLevel(sh.Level).rank() >= it.Level.rank() {
				continue
			}
			notifyUID := ""
			if it.PrincipalType == DocumentPrincipalUser {
				notifyUID = notifyUserByID[it.PrincipalID]
			}
			if _, err := s.applyDocumentShareWithMeta(ctx, q, actor, updatedDoc, acc, DocumentShareInput{
				PrincipalType: it.PrincipalType,
				PrincipalID:   it.PrincipalID,
				Level:         it.Level,
			}, batchMeta, notifyUID); err != nil {
				return folderContentsOutcome{}, err
			}
		}

	case FolderContentsAccessModeReplace:
		var targetHome *DocumentLevel
		targetByKey := make(map[string]FolderContentsAccessItem, len(items))
		for _, it := range items {
			if it.PrincipalType == DocumentPrincipalWorkspace && it.PrincipalID == doc.WorkspaceID {
				lvl := it.Level
				targetHome = &lvl
				continue
			}
			targetByKey[it.PrincipalType+"\x00"+it.PrincipalID] = it
		}
		// 1. Update home row when needed.
		if targetHome != nil {
			if updatedDoc.Visibility != documentVisibilityWorkspace || DocumentLevel(updatedDoc.WorkspaceLevel) != *targetHome || len(legacyHome) > 0 {
				var err error
				updatedDoc, err = writeDocumentHomeRow(ctx, q, actor, updatedDoc, documentHomeRowMove{
					Visibility:     documentVisibilityWorkspace,
					WorkspaceLevel: string(*targetHome),
					BatchID:        batchID,
					BatchMeta:      batchMeta,
				})
				if err != nil {
					return folderContentsOutcome{}, err
				}
				legacyHome = nil
			}
		} else {
			if updatedDoc.Visibility != documentVisibilityRestricted || len(legacyHome) > 0 {
				wsLvl := updatedDoc.WorkspaceLevel
				if wsLvl == "" {
					wsLvl = string(DocumentLevelView)
				}
				var err error
				updatedDoc, err = writeDocumentHomeRow(ctx, q, actor, updatedDoc, documentHomeRowMove{
					Visibility:     documentVisibilityRestricted,
					WorkspaceLevel: wsLvl,
					BatchID:        batchID,
					BatchMeta:      batchMeta,
				})
				if err != nil {
					return folderContentsOutcome{}, err
				}
				legacyHome = nil
			}
		}

		// 2. Revoke live shares not in targetByKey (in deterministic order).
		revokeKeys := make([]string, 0, len(liveByKey))
		for k := range liveByKey {
			if _, keep := targetByKey[k]; !keep {
				revokeKeys = append(revokeKeys, k)
			}
		}
		slices.Sort(revokeKeys)
		for _, k := range revokeKeys {
			sh := liveByKey[k]
			if err := revokeDocumentShareRowWithMeta(ctx, q, actor, updatedDoc, sh, batchMeta); err != nil {
				return folderContentsOutcome{}, err
			}
		}

		// 3. Apply or update target non-home items in request order.
		for _, it := range items {
			if it.PrincipalType == DocumentPrincipalWorkspace && it.PrincipalID == doc.WorkspaceID {
				continue
			}
			k := it.PrincipalType + "\x00" + it.PrincipalID
			if sh, ok := liveByKey[k]; ok && DocumentLevel(sh.Level) == it.Level {
				continue
			}
			notifyUID := ""
			if it.PrincipalType == DocumentPrincipalUser {
				notifyUID = notifyUserByID[it.PrincipalID]
			}
			if _, err := s.applyDocumentShareWithMeta(ctx, q, actor, updatedDoc, acc, DocumentShareInput{
				PrincipalType: it.PrincipalType,
				PrincipalID:   it.PrincipalID,
				Level:         it.Level,
			}, batchMeta, notifyUID); err != nil {
				return folderContentsOutcome{}, err
			}
		}
	}

	return folderContentsOutcome{Processed: 1, Changed: 1}, nil
}

// DocumentAccessBatchCompletedTopic is the outbox topic emitted when a
// background folder-contents access batch finishes (UNI-2244 §6).
const DocumentAccessBatchCompletedTopic = "document.access_batch_completed"

func folderContentsBatchCompletedEvent(batchID, folderID, workspaceID string) audit.Event {
	return audit.Event{
		Topic: DocumentAccessBatchCompletedTopic,
		Payload: map[string]string{
			"batch_id":     batchID,
			"folder_id":    folderID,
			"workspace_id": workspaceID,
		},
	}
}

func recordFolderContentsBatchCompletedAudit(
	ctx context.Context,
	q *db.Queries,
	actor Actor,
	folder db.Document,
	batchID string,
	mode string,
	items []FolderContentsAccessItem,
	total int,
	outcome folderContentsOutcome,
	execution string,
) error {
	metaItems := make([]map[string]any, len(items))
	for i, it := range items {
		metaItems[i] = map[string]any{
			"principal_type": it.PrincipalType,
			"principal_id":   it.PrincipalID,
			"level":          string(it.Level),
		}
	}
	var events []audit.Event
	if execution == FolderContentsAccessExecBackground {
		events = append(events, folderContentsBatchCompletedEvent(batchID, folder.ID, folder.WorkspaceID))
	}
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: folder.OrganizationID,
		WorkspaceID:    folder.WorkspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentContentsAccessUpdated,
		ResourceType:   "document",
		ResourceID:     folder.ID,
		Metadata: map[string]any{
			"batch_id":               batchID,
			"mode":                   mode,
			"items":                  metaItems,
			"total":                  total,
			"changed":                outcome.Changed,
			"unchanged":              outcome.Unchanged,
			"skipped_not_manageable": outcome.SkippedNotManageable,
			"skipped_locked":         outcome.SkippedLocked,
			"execution":              execution,
		},
	}, events...)
}
