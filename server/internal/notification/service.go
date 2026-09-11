package notification

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Service is the read/mark side of the inbox: everything a person does with
// their own notifications. Every method takes the caller's user id and
// answers only about that person's rows; an id belonging to someone else is
// a not_found, never a forbidden (spec §5).
type Service struct {
	q      *db.Queries
	push   PushConfig
	maxIDs int
}

// PushConfig is what GET /notifications/push/config returns.
type PushConfig struct {
	Enabled   bool
	PublicKey string
}

// NewService wires the service. push.Enabled=false hides the option client-side.
func NewService(q *db.Queries, push PushConfig) *Service {
	return &Service{q: q, push: push, maxIDs: 200}
}

// PushConfig is the public half of the VAPID pair.
func (s *Service) PushConfig() PushConfig { return s.push }

const (
	defaultLimit = 50
	maxLimit     = 100
)

// ListInput is the inbox query.
type ListInput struct {
	WorkspaceID string
	UnreadOnly  bool
	Before      string
	Limit       int32
}

// Item is a notification plus whether its resource still exists.
type Item struct {
	db.Notification
	ResourceDeleted bool
}

// List returns the caller's inbox page, newest first, with resource_deleted
// resolved in two batched queries rather than one per row.
func (s *Service) List(ctx context.Context, userID string, in ListInput) ([]Item, error) {
	limit := in.Limit
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	rows, err := s.q.ListNotifications(ctx, db.ListNotificationsParams{
		UserID: userID, WorkspaceID: optText(in.WorkspaceID), UnreadOnly: in.UnreadOnly,
		Before: optText(in.Before), LimitN: limit,
	})
	if err != nil {
		return nil, err
	}
	var taskIDs, meetingIDs []string
	for _, n := range rows {
		switch n.ResourceType {
		case "task":
			taskIDs = append(taskIDs, n.ResourceID)
		case "meeting":
			meetingIDs = append(meetingIDs, n.ResourceID)
		}
	}
	alive := map[string]bool{}
	if len(taskIDs) > 0 {
		ids, err := s.q.ListExistingTaskIDs(ctx, taskIDs)
		if err != nil {
			return nil, err
		}
		for _, id := range ids {
			alive["task:"+id] = true
		}
	}
	if len(meetingIDs) > 0 {
		ids, err := s.q.ListExistingMeetingIDs(ctx, meetingIDs)
		if err != nil {
			return nil, err
		}
		for _, id := range ids {
			alive["meeting:"+id] = true
		}
	}
	out := make([]Item, 0, len(rows))
	for _, n := range rows {
		deleted := (n.ResourceType == "task" || n.ResourceType == "meeting") && !alive[n.ResourceType+":"+n.ResourceID]
		out = append(out, Item{Notification: n, ResourceDeleted: deleted})
	}
	return out, nil
}

// UnreadCount is the badge: total and per workspace, one query.
type UnreadCount struct {
	Total       int64
	ByWorkspace map[string]int64
}

func (s *Service) UnreadCount(ctx context.Context, userID string) (UnreadCount, error) {
	rows, err := s.q.CountUnreadNotificationsByWorkspace(ctx, userID)
	if err != nil {
		return UnreadCount{}, err
	}
	out := UnreadCount{ByWorkspace: map[string]int64{}}
	for _, r := range rows {
		out.Total += r.Unread
		if r.WorkspaceID != "" {
			out.ByWorkspace[r.WorkspaceID] = r.Unread
		}
	}
	return out, nil
}

// own checks every id belongs to the caller. A foreign id is a not_found for
// the whole request: nothing is changed and nothing about the other person's
// inbox leaks, not even that the id exists.
func (s *Service) own(ctx context.Context, userID string, ids []string) error {
	if len(ids) == 0 {
		return service.Invalid("cần ít nhất một id")
	}
	if len(ids) > s.maxIDs {
		return service.Invalid("tối đa 200 id mỗi lần")
	}
	n, err := s.q.CountOwnedNotifications(ctx, db.CountOwnedNotificationsParams{UserID: userID, Ids: ids})
	if err != nil {
		return err
	}
	if n != int64(len(ids)) {
		return service.ErrNotFound
	}
	return nil
}

func (s *Service) MarkRead(ctx context.Context, userID string, ids []string) error {
	if err := s.own(ctx, userID, ids); err != nil {
		return err
	}
	_, err := s.q.MarkNotificationsRead(ctx, db.MarkNotificationsReadParams{UserID: userID, Ids: ids})
	return err
}

// MarkAllRead reads everything open, optionally only one workspace.
func (s *Service) MarkAllRead(ctx context.Context, userID, workspaceID string) (int64, error) {
	return s.q.MarkAllNotificationsRead(ctx, db.MarkAllNotificationsReadParams{UserID: userID, WorkspaceID: optText(workspaceID)})
}

func (s *Service) MarkUnread(ctx context.Context, userID string, ids []string) error {
	if err := s.own(ctx, userID, ids); err != nil {
		return err
	}
	_, err := s.q.MarkNotificationsUnread(ctx, db.MarkNotificationsUnreadParams{UserID: userID, Ids: ids})
	return err
}

func (s *Service) Archive(ctx context.Context, userID string, ids []string) error {
	if err := s.own(ctx, userID, ids); err != nil {
		return err
	}
	_, err := s.q.ArchiveNotifications(ctx, db.ArchiveNotificationsParams{UserID: userID, Ids: ids})
	return err
}

// Preferences returns the full kind × channel matrix with defaults applied.
func (s *Service) Preferences(ctx context.Context, userID string) ([]KindPrefs, error) {
	m, err := loadMatrices(ctx, s.q, []string{userID})
	if err != nil {
		return nil, err
	}
	return m[userID].Full(), nil
}

// SetPreferences replaces the matrix. Every kind must be known; kinds left
// out keep their stored value (or the default).
func (s *Service) SetPreferences(ctx context.Context, userID string, prefs []KindPrefs) ([]KindPrefs, error) {
	for _, p := range prefs {
		if !ValidKind(p.Kind) {
			return nil, service.Invalid("kind không hợp lệ: " + p.Kind)
		}
	}
	for _, p := range prefs {
		if err := s.q.UpsertNotificationPreference(ctx, db.UpsertNotificationPreferenceParams{
			UserID: userID, Kind: p.Kind, InApp: p.InApp, Push: p.Push, Email: p.Email,
		}); err != nil {
			return nil, err
		}
	}
	return s.Preferences(ctx, userID)
}

// SubscribePush registers (or refreshes) a browser's push subscription.
func (s *Service) SubscribePush(ctx context.Context, userID, endpoint, p256dh, auth, userAgent string) error {
	if !s.push.Enabled {
		return service.ErrNotFound
	}
	if !strings.HasPrefix(endpoint, "https://") || p256dh == "" || auth == "" {
		return service.Invalid("subscription không hợp lệ")
	}
	_, err := s.q.UpsertPushSubscription(ctx, db.UpsertPushSubscriptionParams{
		ID: util.NewID(), UserID: userID, Endpoint: endpoint, P256dh: p256dh, Auth: auth,
		UserAgent: optText(userAgent),
	})
	return err
}

// UnsubscribePush revokes the caller's subscription for endpoint. Unknown
// endpoints are fine: the browser may have dropped it first.
func (s *Service) UnsubscribePush(ctx context.Context, userID, endpoint string) error {
	_, err := s.q.RevokePushSubscriptionByEndpoint(ctx, db.RevokePushSubscriptionByEndpointParams{UserID: userID, Endpoint: endpoint})
	return err
}

func optTime(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.UTC().Format(time.RFC3339)
}

// OptTime formats a nullable timestamp for SDOs; "" when NULL.
func OptTime(t pgtype.Timestamptz) string { return optTime(t) }
