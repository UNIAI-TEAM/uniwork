package notification

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

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
		UserID: d.UserID, OrganizationID: d.OrganizationID, WorkspaceID: optText(d.WorkspaceID),
		GroupPrefix: dc.GroupPrefix, GroupKey: d.GroupKey,
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
	// A fold signals the inbox only when the row sat still for a while: a
	// wide command then sends a recipient its first frame and about one per
	// docChangeSignalGap of delivery, not one per document. The trade-off: the
	// last folds of a burst may send no frame, and the count they add shows
	// on the inbox's next read (BE-R1-5).
	signal := !merged || !open.UpdatedAt.Valid || time.Since(open.UpdatedAt.Time) >= docChangeSignalGap
	if merged {
		count, err := q.CountNotificationDocuments(ctx, open.ID)
		if err != nil {
			return err
		}
		samples, err := docChangeSampleIDs(ctx, q, open, count)
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
	var events []audit.Event
	if signal {
		events = append(events, audit.Event{
			Topic: TopicCreated, Payload: map[string]string{"notification_id": open.ID, "user_id": d.UserID},
			OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
		})
	}
	if prefs.Push && !merged {
		events = append(events, audit.Event{
			Topic: TopicPush, Payload: map[string]string{"notification_id": open.ID, "user_id": d.UserID},
			OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
		})
	}
	if len(events) > 0 {
		if err := c.recorder.Emit(ctx, q, audit.System("notification"), events...); err != nil {
			return err
		}
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

// docChangeSampleIDs is the sample after a fold: the first documents in
// arrival order. Once the row holds more than docChangeSamples the first ones
// no longer move, so the sample is kept from the row's params instead of
// re-sorting every document of the notification on each fold.
func docChangeSampleIDs(ctx context.Context, q *db.Queries, open db.Notification, count int64) ([]string, error) {
	if count > docChangeSamples {
		var prev map[string]string
		if err := json.Unmarshal([]byte(open.Params), &prev); err == nil && prev["sample_document_ids"] != "" {
			if ids := strings.Split(prev["sample_document_ids"], ","); len(ids) == docChangeSamples {
				return ids, nil
			}
		}
	}
	return q.ListNotificationDocumentSamples(ctx, db.ListNotificationDocumentSamplesParams{
		NotificationID: open.ID, LimitN: docChangeSamples,
	})
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
