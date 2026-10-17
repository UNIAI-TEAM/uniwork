package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Metrics is the counter surface, declared here so the package does not
// import Prometheus. Nil is fine.
type Metrics interface {
	IncNotificationCreated(kind string)
	IncNotificationMerged()
	IncPushSent(result string)
	IncDigestSent()
}

// Consumer is the single source of notifications: it reads committed events
// and writes notifications, so a notification can never exist for a change
// that was rolled back, and a crash between the two is retried by the outbox.
type Consumer struct {
	pool     *pgxpool.Pool
	q        *db.Queries
	env      env
	recorder *audit.Recorder
	metrics  Metrics
	log      *slog.Logger
}

// NewConsumer wires the consumer. members is WorkspaceService in production.
func NewConsumer(pool *pgxpool.Pool, q *db.Queries, members MemberChecker) *Consumer {
	return &Consumer{pool: pool, q: q, env: env{q: q, members: members}, recorder: audit.NewRecorder(), log: slog.Default()}
}

// SetMetrics attaches counters; called once from main.
func (c *Consumer) SetMetrics(m Metrics) { c.metrics = m }

// SetOrgMembers wires the organization permission port used by
// organization-scoped rules. Unwired, those rules deliver nothing.
func (c *Consumer) SetOrgMembers(o OrgMemberChecker) { c.env.orgs = o }

// SetDocumentReaders wires the document permission port the document rules
// filter recipients through. DocumentService satisfies it; the package
// declares it here so notification never imports internal/service. Unwired,
// the document rules deliver nothing rather than guessing.
func (c *Consumer) SetDocumentReaders(d DocumentReadChecker) { c.env.docs = d }

// SetMeetingSummaries wires the AI-summary availability port the meeting
// summary nudge asks. MeetingService satisfies it. Unwired, the nudge is
// never sent.
func (c *Consumer) SetMeetingSummaries(s SummaryChecker) { c.env.summaries = s }

// Name identifies the consumer in dispatcher errors.
func (*Consumer) Name() string { return "notification" }

// Topics is every event a rule exists for.
func (*Consumer) Topics() []string {
	out := make([]string, 0, len(rules))
	for t := range rules {
		out = append(out, t)
	}
	return out
}

// Handle runs the topic's rule and writes one notification per draft. It is
// idempotent by ev.ID through notification_deliveries: a retried row skips
// every user it already reached.
func (c *Consumer) Handle(ctx context.Context, ev outbox.Row) error {
	r, ok := rules[ev.Topic]
	if !ok {
		return nil
	}
	payload := map[string]string{}
	if ev.Payload != "" {
		if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
			return fmt.Errorf("notification: payload of %s: %w", ev.ID, err)
		}
	}
	drafts, err := r(ctx, c.env, ev, payload)
	if err != nil {
		return err
	}
	return c.deliver(ctx, ev.ID, ev.CorrelationID.String, drafts)
}

// deliver applies preferences, merges, records the delivery and emits the
// realtime and push events, all in one transaction per draft.
func (c *Consumer) deliver(ctx context.Context, eventID, correlationID string, drafts []Draft) error {
	if len(drafts) == 0 {
		return nil
	}
	userIDs := make([]string, 0, len(drafts))
	for _, d := range drafts {
		userIDs = append(userIDs, d.UserID)
	}
	matrices, err := loadMatrices(ctx, c.q, userIDs)
	if err != nil {
		return err
	}
	if correlationID != "" {
		ctx = audit.WithRequest(ctx, audit.RequestInfo{CorrelationID: correlationID})
	}
	for _, d := range drafts {
		prefs := matrices[d.UserID].For(d.Kind)
		if !prefs.InApp {
			// A mention row is still claimed when the channel is off: the
			// claim-only transaction stops the row from notifying later,
			// after the person re-enables InApp and edits keep the mention
			// (contract-collab section 8.2).
			if d.Claim != nil {
				if err := c.claim(ctx, d); err != nil {
					return err
				}
			}
			continue
		}
		if err := c.write(ctx, eventID, correlationID, d, prefs); err != nil {
			return err
		}
	}
	return nil
}

// claim resolves a mention row without writing a notification: the same
// UPDATE the write path uses, in its own transaction. 0 rows means somebody
// else already claimed it, which is not an error for the silent path.
func (c *Consumer) claim(ctx context.Context, d Draft) error {
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	claimed, err := c.q.WithTx(tx).ClaimDocumentCommentMention(ctx, db.ClaimDocumentCommentMentionParams{
		ID: d.Claim.MentionID, OrganizationID: d.OrganizationID,
	})
	if err != nil {
		return err
	}
	if claimed == 0 {
		return nil
	}
	return tx.Commit(ctx)
}

func (c *Consumer) write(ctx context.Context, eventID, correlationID string, d Draft, prefs Prefs) error {
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := c.q.WithTx(tx)

	n, err := q.InsertNotificationDelivery(ctx, db.InsertNotificationDeliveryParams{EventID: eventID, UserID: d.UserID})
	if err != nil {
		return err
	}
	if n == 0 {
		return nil // already delivered to this user by an earlier attempt
	}
	// The once-per-group claim (BE-TN-3): the open-row merge index only
	// dedupes a notification nobody has touched yet. A kind that is one
	// notice per recipient and batch forever - the trash notice, whose
	// elected top node can change under a pending event - must not write a
	// second row when the first was already read or archived.
	//
	// The claim is taken, not merely checked (BE-TN-9): an existence read on
	// its own is unlocked, so two nodes carrying two different events of one
	// group - the sibling elected after a restore or purge while the original
	// top's own write is still in flight - would both miss the row and merge
	// through the upsert's count + 1. The transaction-scoped advisory lock
	// below makes the loser's read run after the winner committed, so it sees
	// the row and skips. The delivery claim above stays first: a redelivery
	// of an event already delivered never takes the lock.
	if d.OncePerGroup {
		if err := q.ClaimNotificationGroup(ctx, d.UserID+":"+d.Kind+":"+d.GroupKey); err != nil {
			return err
		}
		exists, err := q.HasNotificationGroupRow(ctx, db.HasNotificationGroupRowParams{
			UserID: d.UserID, Kind: d.Kind, GroupKey: d.GroupKey,
		})
		if err != nil {
			return err
		}
		if exists {
			return nil
		}
	}
	// The mention claim shares this transaction with the notification row
	// and its outbox rows (contract-collab section 8.2): the UPDATE only
	// matches while nobody claimed the row, so concurrent consumers and
	// outbox replays commit exactly one notification; 0 rows commits
	// nothing - not even the delivery row - and drops the draft.
	if d.Claim != nil {
		claimed, err := q.ClaimDocumentCommentMention(ctx, db.ClaimDocumentCommentMentionParams{
			ID: d.Claim.MentionID, OrganizationID: d.OrganizationID,
		})
		if err != nil {
			return err
		}
		if claimed == 0 {
			return nil
		}
	}
	params, err := json.Marshal(d.Params)
	if err != nil {
		return err
	}
	row, err := q.UpsertNotification(ctx, db.UpsertNotificationParams{
		ID: util.NewID(), UserID: d.UserID, OrganizationID: d.OrganizationID,
		WorkspaceID: optText(d.WorkspaceID), Kind: d.Kind, GroupKey: d.GroupKey,
		ResourceType: d.ResourceType, ResourceID: d.ResourceID,
		ActorKind: d.ActorKind, ActorID: d.ActorID,
		TitleKey: TitleKey(d.Kind), Params: string(params), CorrelationID: optText(correlationID),
	})
	if err != nil {
		return err
	}
	merged := row.Count > 1
	events := []audit.Event{{
		Topic: TopicCreated, Payload: map[string]string{"notification_id": row.ID, "user_id": d.UserID},
		OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID,
	}}
	// A merged row is one the person has not looked at yet; pushing again
	// would be the spam the merge exists to prevent.
	if prefs.Push && !merged {
		events = append(events, audit.Event{
			Topic: TopicPush, Payload: map[string]string{"notification_id": row.ID, "user_id": d.UserID},
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

func optText(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }
