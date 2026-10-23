package notification

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// recapStageMinutes marks a recap sent for finalized minutes; a summary
// recap carries no stage.
const recapStageMinutes = "minutes"

// recapMeeting reads the event's meeting, nil when it is gone or belongs to
// another tenant (GetMeeting is by-id).
func recapMeeting(ctx context.Context, e env, ev outbox.Row, p map[string]string) (*db.Meeting, error) {
	m, err := e.q.GetMeeting(ctx, p["meeting_id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if (ev.OrganizationID.Valid && m.OrganizationID != ev.OrganizationID.String) ||
		(ev.WorkspaceID.Valid && m.WorkspaceID != ev.WorkspaceID.String) {
		return nil, nil
	}
	return &m, nil
}

// recapRecipients is the one place that decides who hears a meeting's recap
// (follow-1): its active user participants - invitees and the people who
// joined - who are still workspace members, without the host and the
// secretaries (they have meeting_summary_ready and the clerk's screens) and
// without the actor. Each one passes the meeting's AI-content gate
// (service.AIContentReadable), so a recap never reaches someone the summary
// page would refuse.
func recapRecipients(ctx context.Context, e env, ev outbox.Row, m db.Meeting) (*recipients, error) {
	ps, err := e.q.ListMeetingParticipants(ctx, m.ID)
	if err != nil {
		return nil, err
	}
	clerks := map[string]bool{m.HostUserID: true}
	for _, pt := range ps {
		if pt.IsSecretary && pt.UserID.Valid {
			clerks[pt.UserID.String] = true
		}
	}
	r := newRecipients(ctx, e, ev, m.WorkspaceID)
	for _, pt := range ps {
		if pt.PrincipalType == "USER" && pt.Status == "ACTIVE" && pt.UserID.Valid && !clerks[pt.UserID.String] &&
			service.AIContentReadable(m, pt.UserID.String, false, true) {
			r.add(pt.UserID.String)
		}
	}
	return r, nil
}

func recapDrafts(r *recipients, m db.Meeting, groupKey string, params map[string]string) ([]Draft, error) {
	ds, err := r.drafts(m.OrganizationID, KindMeetingRecapReady, groupKey, "meeting", m.ID, params)
	for i := range ds {
		ds[i].OncePerGroup = true
	}
	return ds, err
}

// ruleSummaryRecap tells the participants that their meeting has a
// summary, whoever made it. Once per meeting: a regenerated summary tells
// nobody again. Only the meeting's newest summary counts.
func ruleSummaryRecap(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	return summaryRecap(ctx, e, ev, p, p["summary_id"])
}

// ruleEndedRecap sends the recap of a summary a clerk made while the
// meeting still ran, which ruleSummaryRecap held back; the shared group key
// keeps it to one recap per meeting.
func ruleEndedRecap(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	return summaryRecap(ctx, e, ev, p, "")
}

// summaryRecap recaps an ended meeting that has a summary; summaryID, when
// set, must be the meeting's newest.
func summaryRecap(ctx context.Context, e env, ev outbox.Row, p map[string]string, summaryID string) ([]Draft, error) {
	m, err := recapMeeting(ctx, e, ev, p)
	if m == nil || err != nil {
		return nil, err
	}
	// A mid-meeting summary would recap a meeting people are still in and
	// spend the claim the summary after the meeting needs.
	if m.Status != "ENDED" {
		return nil, nil
	}
	sum, err := e.q.GetLatestMeetingSummary(ctx, m.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if summaryID != "" && sum.ID != summaryID {
		return nil, nil
	}
	r, err := recapRecipients(ctx, e, ev, *m)
	if err != nil {
		return nil, err
	}
	return recapDrafts(r, *m, "meeting:"+m.ID+":recap", map[string]string{"meeting": m.Title})
}

// ruleMinutesRecap tells the participants who may read the minutes page that
// it was finalized, once per meeting: a later correction tells nobody again.
// Minutes reopened before the rule ran, or a page that is no longer the
// meeting's, tell nobody; without the document read port, nobody either.
func ruleMinutesRecap(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	if e.docs == nil {
		return nil, nil
	}
	m, err := recapMeeting(ctx, e, ev, p)
	if m == nil || err != nil {
		return nil, err
	}
	if !m.MinutesFinalizedAt.Valid || m.MinutesDocumentID.String != p["document_id"] {
		return nil, nil
	}
	r, err := recapRecipients(ctx, e, ev, *m)
	if err != nil {
		return nil, err
	}
	if r.err == nil && len(r.order) > 0 {
		readers, err := e.docs.FilterDocumentReaders(ctx, p["document_id"], r.order)
		if err != nil {
			return nil, err
		}
		r.order = readers
	}
	return recapDrafts(r, *m, "meeting:"+m.ID+":recap_minutes",
		map[string]string{"meeting": m.Title, "stage": recapStageMinutes})
}
