package notification

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// writeDocChange is write() for a document_changed draft (UNI-2056 §3): it
// runs inside the delivery's transaction, after the delivery claim, so a
// redelivered event never reaches it. The group claim serializes every event
// of one (recipient, actor, verb); under it the open row of the same command,
// or of the same actor and verb inside the sliding window, takes the document
// and recounts, and otherwise a new row opens. Only a new row may push.
func (c *Consumer) writeDocChange(ctx context.Context, tx pgx.Tx, q *db.Queries, correlationID string, d Draft, prefs Prefs) error {
	dc := d.DocChange
	if err := q.ClaimNotificationGroup(ctx, d.UserID+":"+d.Kind+":"+dc.GroupPrefix); err != nil {
		return err
	}
	open, err := q.FindFoldableDocumentChange(ctx, db.FindFoldableDocumentChangeParams{
		UserID: d.UserID, GroupPrefix: dc.GroupPrefix, GroupKey: d.GroupKey,
	})
	merged := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if !merged {
		params, err := json.Marshal(docChangeParams(d.Params, 1, []string{dc.DocumentID}))
		if err != nil {
			return err
		}
		open, err = q.InsertNotification(ctx, db.InsertNotificationParams{
			ID: util.NewID(), UserID: d.UserID, OrganizationID: d.OrganizationID,
			WorkspaceID: optText(d.WorkspaceID), Kind: d.Kind, GroupKey: d.GroupKey,
			ResourceType: d.ResourceType, ResourceID: d.ResourceID,
			ActorKind: d.ActorKind, ActorID: d.ActorID,
			TitleKey: TitleKey(d.Kind), Params: string(params), CorrelationID: optText(correlationID),
		})
		if err != nil {
			return err
		}
	}
	if _, err := q.InsertNotificationDocument(ctx, db.InsertNotificationDocumentParams{
		OrganizationID: d.OrganizationID, NotificationID: open.ID, DocumentID: dc.DocumentID,
		TitleSnapshot: optText(dc.TitleSnapshot),
	}); err != nil {
		return err
	}
	if merged {
		count, err := q.CountNotificationDocuments(ctx, open.ID)
		if err != nil {
			return err
		}
		samples, err := q.ListNotificationDocumentSamples(ctx, db.ListNotificationDocumentSamplesParams{
			NotificationID: open.ID, LimitN: docChangeSamples,
		})
		if err != nil {
			return err
		}
		params, err := json.Marshal(docChangeParams(d.Params, count, samples))
		if err != nil {
			return err
		}
		if open, err = q.FoldDocumentChange(ctx, db.FoldDocumentChangeParams{
			ID: open.ID, UserID: d.UserID, Count: int32(count), Params: string(params),
			CorrelationID: pgtype.Text{String: correlationID, Valid: correlationID != ""},
		}); err != nil {
			return err
		}
	}
	events := []audit.Event{{
		Topic: TopicCreated, Payload: map[string]string{"notification_id": open.ID, "user_id": d.UserID},
		OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
	}}
	if prefs.Push && !merged {
		events = append(events, audit.Event{
			Topic: TopicPush, Payload: map[string]string{"notification_id": open.ID, "user_id": d.UserID},
			OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
		})
	}
	if err := c.recorder.Emit(ctx, q, audit.System("notification"), events...); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if c.metrics != nil {
		if merged {
			c.metrics.IncNotificationMerged()
		} else {
			c.metrics.IncNotificationCreated(d.Kind)
		}
	}
	return nil
}

// docChangeParams is the draft's params (actor, verb) plus the document
// count and the first documents, ids only: titles are resolved per reader at
// read time (§4).
func docChangeParams(base map[string]string, count int64, samples []string) map[string]string {
	out := make(map[string]string, len(base)+2)
	for k, v := range base {
		out[k] = v
	}
	out["document_count"] = strconv.FormatInt(count, 10)
	out["sample_document_ids"] = strings.Join(samples, ",")
	return out
}
