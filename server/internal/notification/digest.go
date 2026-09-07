package notification

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	digestTick   = 15 * time.Minute
	digestHour   = 8 // local time the mail goes out
	digestWindow = 24 * time.Hour
	digestMax    = 50
)

// DigestScheduler sends each person at most one email a day listing what
// they have not read, at 08:00 in their own time zone. It reuses the mail
// outbox: rendering here, delivery and retry there.
type DigestScheduler struct {
	q        *db.Queries
	renderer mail.Renderer
	mail     mail.Enqueuer
	metrics  Metrics
	now      func() time.Time
	log      *slog.Logger
}

// NewDigestScheduler wires the job.
func NewDigestScheduler(q *db.Queries, renderer mail.Renderer, m mail.Enqueuer) *DigestScheduler {
	return &DigestScheduler{q: q, renderer: renderer, mail: m, now: time.Now, log: slog.Default()}
}

// SetMetrics attaches counters.
func (s *DigestScheduler) SetMetrics(m Metrics) { s.metrics = m }

// Run ticks every fifteen minutes until ctx is done.
func (s *DigestScheduler) Run(ctx context.Context) {
	t := time.NewTicker(digestTick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if _, err := s.RunOnce(ctx, s.now()); err != nil {
				s.log.Warn("notification digest", "err", err)
			}
		}
	}
}

// inWindow is true when now, in the user's zone, falls in [08:00, 08:15).
func inWindow(now time.Time, tz string) bool {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc, _ = time.LoadLocation("Asia/Ho_Chi_Minh")
	}
	local := now.In(loc)
	return local.Hour() == digestHour && local.Minute() < int(digestTick/time.Minute)
}

// RunOnce sends the digest to everyone whose local clock is in the window
// and who has unread, undigested notifications from the last 24 hours.
// Returns how many mails were queued.
func (s *DigestScheduler) RunOnce(ctx context.Context, now time.Time) (int, error) {
	since := pgtype.Timestamptz{Time: now.Add(-digestWindow), Valid: true}
	userIDs, err := s.q.ListDigestCandidateUsers(ctx, since)
	if err != nil {
		return 0, err
	}
	sent := 0
	for _, uid := range userIDs {
		user, err := s.q.GetUserByID(ctx, uid)
		if err != nil {
			return sent, err
		}
		if !user.EmailVerifiedAt.Valid || !inWindow(now, user.Timezone) {
			continue
		}
		ok, err := s.sendTo(ctx, user, since)
		if err != nil {
			return sent, err
		}
		if ok {
			sent++
		}
	}
	return sent, nil
}

func (s *DigestScheduler) sendTo(ctx context.Context, user db.User, since pgtype.Timestamptz) (bool, error) {
	matrices, err := loadMatrices(ctx, s.q, []string{user.ID})
	if err != nil {
		return false, err
	}
	prefs := matrices[user.ID]
	rows, err := s.q.ListUndigestedNotifications(ctx, db.ListUndigestedNotificationsParams{UserID: user.ID, CreatedAt: since})
	if err != nil {
		return false, err
	}
	var wanted []db.Notification
	for _, n := range rows {
		if prefs.For(n.Kind).Email {
			wanted = append(wanted, n)
		}
	}
	if len(wanted) == 0 {
		return false, nil
	}
	data, ids, err := s.build(ctx, user, wanted)
	if err != nil {
		return false, err
	}
	msg, err := s.renderer.NotificationDigest(user.Email, user.Locale, user.ID, data)
	if err != nil {
		return false, err
	}
	if _, err := s.mail.Enqueue(ctx, nil, msg); err != nil {
		return false, err
	}
	s.mail.Kick()
	if err := s.q.MarkNotificationsDigested(ctx, ids); err != nil {
		return false, err
	}
	if s.metrics != nil {
		s.metrics.IncDigestSent()
	}
	return true, nil
}

// build groups the rows by workspace (rows arrive ordered by workspace) and
// caps the list; every row is marked digested, including the ones behind
// "and N more", so tomorrow's mail is about tomorrow.
func (s *DigestScheduler) build(ctx context.Context, user db.User, rows []db.Notification) (mail.DigestData, []string, error) {
	data := mail.DigestData{DisplayName: user.DisplayName, SettingsURL: s.renderer.AppURL + "/workspaces"}
	ids := make([]string, 0, len(rows))
	names := map[string]string{}
	var current *mail.DigestGroup
	shown := 0
	for _, n := range rows {
		ids = append(ids, n.ID)
		if shown >= digestMax {
			data.More++
			continue
		}
		wsKey := n.WorkspaceID.String
		if current == nil || current.Key != wsKey {
			name, ok := names[wsKey]
			if !ok {
				name = ""
				if n.WorkspaceID.Valid {
					if ws, err := s.q.GetWorkspaceByID(ctx, wsKey); err == nil {
						name = ws.Name
					}
				}
				names[wsKey] = name
			}
			data.Groups = append(data.Groups, mail.DigestGroup{Key: wsKey, Workspace: name})
			current = &data.Groups[len(data.Groups)-1]
		}
		var params map[string]string
		_ = json.Unmarshal([]byte(n.Params), &params)
		url, err := ResourceURL(ctx, s.q, s.renderer.AppURL, n)
		if err != nil {
			return data, nil, err
		}
		current.Items = append(current.Items, mail.DigestItem{Title: Title(user.Locale, n.Kind, params), URL: url, Count: int(n.Count)})
		shown++
	}
	return data, ids, nil
}
