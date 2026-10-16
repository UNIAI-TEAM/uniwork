package notification

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/service"
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
	members  MemberChecker
	renderer mail.Renderer
	mail     mail.Enqueuer
	metrics  Metrics
	now      func() time.Time
	log      *slog.Logger
	docs     DocumentPageChecker
}

// NewDigestScheduler wires the job.
func NewDigestScheduler(q *db.Queries, members MemberChecker, renderer mail.Renderer, m mail.Enqueuer) *DigestScheduler {
	return &DigestScheduler{q: q, members: members, renderer: renderer, mail: m, now: time.Now, log: slog.Default()}
}

// SetDocumentReaders wires the same document read gate Service.List marks
// inbox rows through. The digest build skips a document row the recipient may
// no longer read instead of mailing the title List deliberately drops.
// Unwired, every document row is treated as access_lost (fail closed).
func (s *DigestScheduler) SetDocumentReaders(d DocumentPageChecker) { s.docs = d }

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
	allIDs := make([]string, len(wanted))
	for i, n := range wanted {
		allIDs[i] = n.ID
	}
	accessible, err := s.filterDigestRows(ctx, user.ID, wanted)
	if err != nil {
		return false, err
	}
	if len(accessible) == 0 {
		if err := s.q.MarkNotificationsDigested(ctx, allIDs); err != nil {
			return false, err
		}
		return false, nil
	}
	data, _, err := s.build(ctx, user, accessible)
	if err != nil {
		return false, err
	}
	if len(data.Groups) == 0 {
		// Every row was hidden by the document gate (access_lost or gone):
		// there is nothing to say, so send no mail, but consume the rows so
		// the next window does not ask about them again.
		if err := s.q.MarkNotificationsDigested(ctx, allIDs); err != nil {
			return false, err
		}
		return false, nil
	}
	msg, err := s.renderer.NotificationDigest(user.Email, user.Locale, user.ID, data)
	if err != nil {
		return false, err
	}
	if _, err := s.mail.Enqueue(ctx, nil, msg); err != nil {
		return false, err
	}
	s.mail.Kick()
	if err := s.q.MarkNotificationsDigested(ctx, allIDs); err != nil {
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
	// The digest applies the same document read gate as Service.List, over
	// the rows the mail can still render: one batched call for the page (the
	// cap is digestMax, inside the gate's own bound of 100). A document row
	// the recipient may no longer read is dropped rather than mailed with the
	// title List deliberately withholds; unwired, every document row counts
	// as access_lost, so a missing wiring never leaks a title.
	docState := map[string]service.DocumentReadState{}
	docIDs := make([]string, 0, digestMax)
	for i := 0; i < len(rows) && i < digestMax; i++ {
		if rows[i].ResourceType == "document" {
			docIDs = append(docIDs, rows[i].ResourceID)
		}
	}
	if len(docIDs) > 0 {
		if s.docs == nil {
			for _, id := range docIDs {
				docState[id] = service.DocumentAccessLost
			}
		} else {
			states, err := s.docs.FilterReadableDocuments(ctx, user.ID, docIDs)
			if err != nil {
				return data, nil, err
			}
			docState = states
		}
	}
	for _, n := range rows {
		ids = append(ids, n.ID)
		if shown >= digestMax {
			data.More++
			continue
		}
		if n.ResourceType == "document" {
			state := docState[n.ResourceID]
			if state == "" {
				state = service.DocumentAccessLost
			}
			if state != service.DocumentReadable {
				// The slot is consumed so the batch above stays sufficient,
				// but nothing is rendered: the title and snippet are content
				// the recipient may no longer read, and the link is refused.
				shown++
				continue
			}
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
