package service

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The summary the system makes when a meeting ends (UNI-2026, spec
// 2026-10-20-meeting-scribe-agent-design §4.5, D16): endMeeting queues the
// meeting in meeting_auto_summaries, the auto_summary worker of RunWorkers
// claims it once due and runs SummarizeAuto. Off the outbox because one
// summary can outlive an outbox delivery; the queue row makes it survive a
// restart, its lease keeps two nodes off one meeting, and the summary run
// lease (claimSummaryRun) keeps it off a clerk's own Summarize.

const (
	// A meeting with no open scribe run waits this long, so a last note or
	// chat line sent as the host clicked End still makes it in.
	autoSummaryWait = 10 * time.Second
	// A meeting whose scribe run was open at its end waits for the agent's
	// /agent/finished (its last lines), at most this long.
	autoSummaryAgentWait = 90 * time.Second
	autoSummaryTick      = 5 * time.Second
	// Summaries in flight per node: one long meeting never holds up the rest.
	autoSummaryConcurrency = 4
	// A row claimed this many times without settling (its node died each
	// time) is given up, and the host gets the reminder instead.
	autoSummaryMaxAttempts = 3
	// No organization locale exists yet; the product's default is Vietnamese.
	autoSummaryLocale = "vi"
	// The topic that sends the summary reminder after an auto run that made
	// no summary (catalogue: notification only, no client).
	topicAutoSummaryFailed = "meeting.auto_summary_failed"
)

// autoSummaryActor attributes the summary, its audit row and its action items'
// source run.
var autoSummaryActor = audit.System("meeting_auto_summary")

// errAutoSummaryNotDue: the meeting is not ENDED or already has a summary;
// nothing to make and nothing to remind.
var errAutoSummaryNotDue = errors.New("meetings: auto summary not due")

// errAutoSummaryOff: the organization switched auto summaries off after the
// meeting was queued; the host gets the reminder as before.
var errAutoSummaryOff = errors.New("meetings: auto summary switched off")

// errAutoSummaryAttempts: the row outlived autoSummaryMaxAttempts claims.
var errAutoSummaryAttempts = errors.New("meetings: auto summary gave up after repeated attempts")

// autoSummaryEnabled reads the organization switch; no row is the default, on.
func autoSummaryEnabled(ctx context.Context, q *db.Queries, orgID string) (bool, error) {
	set, err := meetingSettings(ctx, q, orgID)
	return set.AutoSummaryEnabled, err
}

// queueAutoSummary queues an ending meeting inside endMeeting's transaction,
// when the organization keeps auto summaries on and may summarize at all.
// The wait depends on whether a scribe run was still open (§4.5).
func (s *MeetingService) queueAutoSummary(ctx context.Context, q *db.Queries, m db.Meeting) error {
	on, err := autoSummaryEnabled(ctx, q, m.OrganizationID)
	if err != nil || !on || !s.SummaryAvailable(ctx, m.OrganizationID) {
		return err
	}
	wait := autoSummaryWait
	if r, err := q.GetLatestScribeRun(ctx, m.ID); err == nil && scribeRunOpen(r) {
		wait = autoSummaryAgentWait
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	return q.QueueMeetingAutoSummary(ctx, db.QueueMeetingAutoSummaryParams{
		MeetingID: m.ID, OrganizationID: m.OrganizationID, AfterSeconds: int32(wait / time.Second),
	})
}

// hurryAutoSummary: the agent of an ended meeting reported /agent/finished,
// so its queued summary need not wait out the rest of autoSummaryAgentWait.
func (s *MeetingService) hurryAutoSummary(ctx context.Context, m db.Meeting) {
	if m.Status != MeetingEnded {
		return // a run that ends mid-meeting (the room emptied, D18) opens nothing
	}
	if err := s.q.HurryMeetingAutoSummary(ctx, db.HurryMeetingAutoSummaryParams{
		OrganizationID: m.OrganizationID, MeetingID: m.ID,
	}); err != nil {
		slog.Warn("meetings: auto summary not hurried, it runs at its due time", "meeting_id", m.ID, "err", err)
	}
}

// SummarizeAuto makes the summary of an ended meeting on behalf of the system
// (actor meeting_auto_summary, the organization's locale). It shares
// Summarize's body, so its gates, its lease and its store; a clerk's run in
// flight answers summary_in_progress here as there.
func (s *MeetingService) SummarizeAuto(ctx context.Context, meetingID string) (db.MeetingSummary, error) {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingSummary{}, errAutoSummaryNotDue
	}
	if err != nil {
		return db.MeetingSummary{}, err
	}
	return s.summarizeAuto(ctx, m)
}

func (s *MeetingService) summarizeAuto(ctx context.Context, m db.Meeting) (db.MeetingSummary, error) {
	if m.Status != MeetingEnded {
		return db.MeetingSummary{}, errAutoSummaryNotDue
	}
	// Whatever a clerk made already stands: the system never replaces it.
	if _, err := s.q.GetLatestMeetingSummary(ctx, m.ID); err == nil {
		return db.MeetingSummary{}, errAutoSummaryNotDue
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingSummary{}, err
	}
	on, err := autoSummaryEnabled(ctx, s.q, m.OrganizationID)
	if err != nil {
		return db.MeetingSummary{}, err
	}
	if !on {
		return db.MeetingSummary{}, errAutoSummaryOff
	}
	return s.summarize(ctx, m, autoSummaryActor, autoSummaryLocale)
}

// claimAutoSummaries is one auto_summary claimer. RunWorkers runs
// autoSummaryConcurrency of them as independent loops, so a meeting that
// falls due while another one's summary runs is claimed by a free claimer
// within a tick. Each takes one due row right before its run, so a lease
// never ages while another meeting is summarized.
func (s *MeetingService) claimAutoSummaries(ctx context.Context) error {
	lease := s.summaryBudget().lease + time.Minute
	for ctx.Err() == nil {
		row, err := s.q.ClaimMeetingAutoSummary(ctx, int32(lease/time.Second))
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if err := s.runAutoSummary(ctx, row); err != nil {
			return err
		}
	}
	return nil
}

// runAutoSummary runs one claimed row and settles it: the row goes, and a run
// that made no summary for a reason a person can act on queues the reminder
// in the same transaction. A run cut short by shutdown leaves the row for the
// next claim once its lease lapses.
func (s *MeetingService) runAutoSummary(ctx context.Context, row db.MeetingAutoSummary) error {
	m, err := s.q.GetMeeting(ctx, row.MeetingID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	found := err == nil
	switch {
	case !found:
		err = errAutoSummaryNotDue
	case row.Attempts > autoSummaryMaxAttempts:
		err = errAutoSummaryAttempts
	default:
		_, err = s.summarizeAuto(ctx, m)
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	remind, settle := autoSummaryOutcome(err)
	if !settle {
		// Not a refusal (a read failed, say): the row stays, its lease lapses
		// and another claim retries it, up to autoSummaryMaxAttempts.
		return err
	}
	if err == nil {
		s.count("auto_summary_ok")
	} else if remind {
		s.count("auto_summary_failed")
		slog.Info("meetings: auto summary not made, the host gets the reminder", "meeting_id", row.MeetingID, "attempts", row.Attempts, "err", err)
	}
	return s.settleAutoSummary(ctx, row, m, remind)
}

// autoSummaryOutcome sorts a run's result: settle deletes the row, remind
// also queues the summary reminder. A refusal (a coded error: the model
// failed or is not configured; the plan lacks meeting.ai_summary) and a
// switch turned off remind; nothing
// to summarize, a summary already there or a clerk's run in flight settle
// quietly; any other error settles nothing, so the claim is retried.
func autoSummaryOutcome(err error) (remind, settle bool) {
	var ce CodedError
	switch {
	case err == nil, errors.Is(err, errAutoSummaryNotDue):
		return false, true
	case errors.Is(err, errAutoSummaryOff), errors.Is(err, errAutoSummaryAttempts),
		errors.Is(err, ErrEntitlementRequired), errors.Is(err, ErrSubscriptionInactive):
		return true, true
	case errors.As(err, &ce):
		quiet := ce.Code == "summary_in_progress" || ce.Code == "summary_no_source"
		return !quiet, true
	}
	return false, false
}

func (s *MeetingService) settleAutoSummary(ctx context.Context, row db.MeetingAutoSummary, m db.Meeting, remind bool) error {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), summaryStoreTimeout)
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	n, err := q.DeleteMeetingAutoSummary(ctx, db.DeleteMeetingAutoSummaryParams{
		OrganizationID: row.OrganizationID, MeetingID: row.MeetingID, LeaseUntil: row.LeaseUntil,
	})
	if err != nil || n == 0 {
		return err // the lease lapsed and another node holds the row now
	}
	if remind {
		if err := auditRecorder.Emit(ctx, q, autoSummaryActor, audit.Event{
			Topic: topicAutoSummaryFailed, OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID,
			Payload: map[string]string{"meeting_id": m.ID, "workspace_id": m.WorkspaceID},
		}); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ---- Organization settings -------------------------------------------------

// GetMeetingSettings reads the organization's meeting settings. Read and write
// share one gate, the one document settings use: a human organization
// owner/admin; members without the role 403, non-members 404. An organization
// that never touched them answers the defaults without writing a row.
func (s *MeetingService) GetMeetingSettings(ctx context.Context, actor Actor, organizationID string) (db.MeetingSetting, error) {
	if err := s.requireOrgAdmin(ctx, actor, organizationID); err != nil {
		return db.MeetingSetting{}, err
	}
	return meetingSettings(ctx, s.q, organizationID)
}

// meetingSettings is the organization's row, or the defaults when it has none.
func meetingSettings(ctx context.Context, q *db.Queries, organizationID string) (db.MeetingSetting, error) {
	set, err := q.GetMeetingSettings(ctx, organizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingSetting{OrganizationID: organizationID, AutoSummaryEnabled: true, ScribePolicy: ScribePolicyOn}, nil
	}
	return set, err
}

// MeetingSettingsInput is a change to the organization's meeting settings;
// a nil field keeps its value.
type MeetingSettingsInput struct {
	// AutoSummaryEnabled switches the summary the system makes when a meeting
	// ends (D16). It applies to meetings that end from now on; one already
	// queued checks the switch again before it runs.
	AutoSummaryEnabled *bool
	// ScribePolicy is on, opt_in or off (scribePolicy). off takes the scribe
	// out of every meeting now; opt_in applies to meetings created from now on.
	ScribePolicy *string
}

// SetMeetingSettings changes the organization's meeting settings, audited as
// one meeting.settings_changed row carrying what changed. An empty change is
// refused only after the caller is authorized, so an outsider learns nothing
// from a 400.
func (s *MeetingService) SetMeetingSettings(ctx context.Context, actor Actor, organizationID string, in MeetingSettingsInput) (db.MeetingSetting, error) {
	if err := s.requireOrgAdmin(ctx, actor, organizationID); err != nil {
		return db.MeetingSetting{}, err
	}
	if in.AutoSummaryEnabled == nil && in.ScribePolicy == nil {
		return db.MeetingSetting{}, Invalid("auto_summary_enabled or scribe_policy is required")
	}
	if in.ScribePolicy != nil && !validScribePolicy(*in.ScribePolicy) {
		return db.MeetingSetting{}, Invalid("scribe_policy must be on, opt_in or off")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.MeetingSetting{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	before, err := meetingSettings(ctx, q, organizationID)
	if err != nil {
		return db.MeetingSetting{}, err
	}
	after := before
	if in.AutoSummaryEnabled != nil {
		after.AutoSummaryEnabled = *in.AutoSummaryEnabled
	}
	if in.ScribePolicy != nil {
		after.ScribePolicy = *in.ScribePolicy
	}
	set, err := q.UpsertMeetingSettings(ctx, db.UpsertMeetingSettingsParams{
		OrganizationID: organizationID, AutoSummaryEnabled: after.AutoSummaryEnabled, ScribePolicy: after.ScribePolicy,
		UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
	})
	if err != nil {
		return db.MeetingSetting{}, err
	}
	from, to := map[string]any{}, map[string]any{}
	if before.AutoSummaryEnabled != after.AutoSummaryEnabled {
		from["auto_summary_enabled"], to["auto_summary_enabled"] = before.AutoSummaryEnabled, after.AutoSummaryEnabled
	}
	if before.ScribePolicy != after.ScribePolicy {
		from["scribe_policy"], to["scribe_policy"] = before.ScribePolicy, after.ScribePolicy
	}
	if len(to) > 0 {
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: organizationID, Actor: actor,
			Action:       audit.ActionMeetingSettingsChanged,
			ResourceType: "organization", ResourceID: organizationID,
			Changes: audit.Diff(from, to),
		}); err != nil {
			return db.MeetingSetting{}, err
		}
	}
	// Policy off needs no inline close: the 15 s sweep reaches every open
	// run, finds the meeting no longer wants it, and removes the agent.
	return set, tx.Commit(ctx)
}

func (s *MeetingService) requireOrgAdmin(ctx context.Context, actor Actor, organizationID string) error {
	if actor.Kind != audit.KindHuman {
		return ErrForbidden
	}
	mem, err := s.ws.orgs.RequireMember(ctx, organizationID, actor.ID)
	if errors.Is(err, ErrForbidden) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if mem.Role != OrgRoleOwner && mem.Role != OrgRoleAdmin {
		return ErrForbidden
	}
	return nil
}
