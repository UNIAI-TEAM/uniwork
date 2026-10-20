package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// Scribe run states (spec 2026-10-20-meeting-scribe-agent-design §6.1).
const (
	ScribeDispatched = "DISPATCHED"
	ScribeActive     = "ACTIVE"
	ScribeFinished   = "FINISHED"
	ScribeFailed     = "FAILED"
)

const (
	scribeFlag = "meeting_scribe"
	// The sweep doubles as the "room without its agent" check, since LiveKit's
	// restart_policy exists only on Cloud (§4.6).
	scribeSweepInterval = 15 * time.Second
	scribeSweepBatch    = 200
	// A dispatch not ACTIVE this long while people are in the room is one
	// failure; the third fails the run, retried after scribeRetryAfter (§4.1).
	scribeActiveDeadline = 60 * time.Second
	scribeMaxFailures    = 3
	scribeRetryAfter     = 10 * time.Minute
	// A room empty this long closes its run (D18): LiveKit ended the job.
	scribeEmptyGrace = 60 * time.Second
	// The agent's token outlives the scheduled end by this much (D6).
	scribeTokenGrace  = 4 * time.Hour
	scribeCallTimeout = 10 * time.Second
	// No organization locale exists yet; the STT steers to vi with en
	// code switching (S0 §2.3).
	scribeLocale = "vi"
)

// scribeActor attributes runs, metered minutes and run-state events.
var scribeActor = audit.System("meeting_scribe")

// SetFlags wires the feature-flag evaluator; nil keeps the scribe off.
func (s *MeetingService) SetFlags(f McpFlags) { s.flags = f }

// scribeConfigured: this process may dispatch the agent at all.
func (s *MeetingService) scribeConfigured() bool {
	return s.rt.ScribeEnabled && s.rt.ScribeAgentName != "" && s.provider != nil && len(s.rt.HMACKey) > 0
}

func (s *MeetingService) scribeFlagOn(ctx context.Context, orgID string) bool {
	if s.flags == nil {
		return false
	}
	def := false
	if f, ok := featureflags.Lookup(scribeFlag); ok {
		def = f.Default
	}
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{OrganizationID: orgID})
	return s.flags.IsEnabled(ctx, scribeFlag, def)
}

// ScribeAvailable is the `scribe` meeting capability: this process runs the
// agent, the flag is on and the plan includes meeting.transcription. Minutes
// left are checked per run, not here.
func (s *MeetingService) ScribeAvailable(ctx context.Context, orgID string) bool {
	return s.scribeConfigured() && s.scribeFlagOn(ctx, orgID) && s.ent.Can(ctx, orgID, FeatureMeetingTranscription) == nil
}

// ScribeStatus is the latest run's status, "" when the meeting never had one.
func (s *MeetingService) ScribeStatus(ctx context.Context, meetingID string) string {
	r, err := s.q.GetLatestScribeRun(ctx, meetingID)
	if err != nil {
		return ""
	}
	return r.Status
}

func scribeRunOpen(r db.MeetingScribeRun) bool {
	return r.Status == ScribeDispatched || r.Status == ScribeActive
}

// ensureScribeNow runs ensureScribe for a request that must not wait on or
// fail because of it (Start, instant meeting, the switch): bounded, logged.
func (s *MeetingService) ensureScribeNow(ctx context.Context, meetingID string) {
	if !s.scribeConfigured() {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), scribeCallTimeout)
	defer cancel()
	if err := s.ensureScribe(ctx, meetingID); err != nil {
		slog.Warn("meeting scribe: ensure failed", "meeting", meetingID, "err", err)
	}
}

// ensureScribe is the one owner of the agent's presence in a meeting (§4.1).
// It dispatches when the meeting is in progress, the scribe is on for it,
// people are in the room, minutes are left and no run is open; it closes an
// open run the meeting no longer wants or whose room emptied; it counts a
// dispatch that never became ACTIVE.
func (s *MeetingService) ensureScribe(ctx context.Context, meetingID string) error {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	latest, err := s.q.GetLatestScribeRun(ctx, meetingID)
	hasRun := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	pres, err := s.q.ScribeRoomPresence(ctx, meetingID)
	if err != nil {
		return err
	}
	want := m.Status == MeetingInProgress && !m.ScribeOffAt.Valid && s.scribeConfigured() && s.scribeFlagOn(ctx, m.OrganizationID)
	now := time.Now()
	if hasRun && scribeRunOpen(latest) {
		emptied := !pres.Present && (!pres.LastLeftAt.Valid || now.Sub(pres.LastLeftAt.Time) >= scribeEmptyGrace)
		switch {
		case !want:
			return s.closeScribeRun(ctx, m, latest, true)
		case emptied:
			return s.closeScribeRun(ctx, m, latest, false)
		case latest.Status == ScribeDispatched && pres.Present && now.Sub(latest.DispatchedAt.Time) >= scribeActiveDeadline:
			return s.scribeMissed(ctx, m, latest)
		}
		return nil
	}
	if !want || !pres.Present {
		return nil
	}
	if hasRun && latest.Status == ScribeFailed && latest.FinishedAt.Valid && now.Sub(latest.FinishedAt.Time) < scribeRetryAfter {
		return nil
	}
	// D9: a run starts only with minutes left; a running one is never cut.
	if err := s.ent.CheckQuota(ctx, m.OrganizationID, FeatureMeetingTranscription, 1); err != nil {
		s.count("scribe_quota_refused")
		return nil
	}
	run, err := s.q.InsertScribeRun(ctx, db.InsertScribeRunParams{
		ID: util.NewID(), OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID, MeetingID: m.ID,
		CreatedBy: scribeActor.ID, CreatedByKind: string(scribeActor.Kind),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // another caller opened the run and dispatches it
	}
	if err != nil {
		return err
	}
	s.emitScribeUpdated(ctx, m)
	return s.dispatchScribe(ctx, m, run)
}

// dispatchScribe signs the run's token and sends the agent. A failed call
// leaves the run DISPATCHED; the 60 s rule counts it and dispatches again.
func (s *MeetingService) dispatchScribe(ctx context.Context, m db.Meeting, run db.MeetingScribeRun) error {
	at := time.Now()
	exp := at.Add(scribeTokenGrace)
	if m.EndsAt.Valid && m.EndsAt.Time.After(at) {
		exp = m.EndsAt.Time.Add(scribeTokenGrace)
	}
	token := meetings.SignAgentToken(s.rt.HMACKey, meetings.AgentClaims{
		MeetingID: m.ID, OrganizationID: m.OrganizationID, RunID: run.ID, ExpiresAt: exp,
	})
	meta, err := json.Marshal(map[string]string{"meeting_id": m.ID, "token": token, "locale": scribeLocale})
	if err != nil {
		return err
	}
	id, err := s.provider.DispatchScribe(ctx, meetings.DispatchScribeRequest{
		RoomName: meetings.RoomNameForMeeting(m.ID), AgentName: s.rt.ScribeAgentName, Metadata: string(meta),
	})
	if err != nil {
		s.count("scribe_dispatch_failed")
		return err
	}
	s.count("scribe_dispatched")
	if _, err := s.q.SetScribeRunDispatch(ctx, db.SetScribeRunDispatchParams{ID: run.ID, DispatchID: id}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	return nil
}

// scribeMissed counts one dispatch that never became ACTIVE while people were
// in the room: it removes that dispatch and sends another, or fails the run on
// the third miss.
func (s *MeetingService) scribeMissed(ctx context.Context, m db.Meeting, run db.MeetingScribeRun) error {
	r, err := s.q.FailScribeRunDispatch(ctx, db.FailScribeRunDispatchParams{ID: run.ID, Failures: run.Failures, MaxFailures: scribeMaxFailures})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // another sweep counted this miss, or the agent arrived
	}
	if err != nil {
		return err
	}
	s.removeScribe(ctx, m, run.DispatchID)
	if r.Status == ScribeFailed {
		s.count("scribe_failed")
		slog.Warn("meeting scribe: run failed", "meeting", m.ID, "run", r.ID, "failures", r.Failures)
		s.emitScribeUpdated(ctx, m)
		return nil
	}
	return s.dispatchScribe(ctx, m, r)
}

func (s *MeetingService) removeScribe(ctx context.Context, m db.Meeting, dispatchID string) {
	if s.provider == nil {
		return
	}
	if err := s.provider.RemoveScribe(ctx, meetings.RemoveScribeRequest{RoomName: meetings.RoomNameForMeeting(m.ID), DispatchID: dispatchID}); err != nil {
		slog.Warn("meeting scribe: remove failed", "meeting", m.ID, "err", err)
	}
}

// closeScribeRun finishes an open run and meters what is left of it; remove
// also takes the agent out of the room (switched off, flag off, meeting over).
func (s *MeetingService) closeScribeRun(ctx context.Context, m db.Meeting, run db.MeetingScribeRun, remove bool) error {
	if remove {
		s.removeScribe(ctx, m, run.DispatchID)
	}
	r, err := s.q.FinishScribeRun(ctx, db.FinishScribeRunParams{ID: run.ID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := s.meterScribeRunTx(ctx, r); err != nil {
		return err
	}
	s.emitScribeUpdated(ctx, m)
	return nil
}

// meterScribeRun moves the run's spoken time into meeting.transcription in
// whole minutes: floor while the run is open, ceiling once it closed, so the
// meter never runs ahead of speech and a closed run's last seconds count.
// RecordUsage never refuses (D9: a meeting in progress is never cut) and
// raises the 80/100% quota.threshold notices. q must be a transaction.
func (s *MeetingService) meterScribeRun(ctx context.Context, q *db.Queries, r db.MeetingScribeRun) error {
	minutes := r.SpeechMs / 60000
	if !scribeRunOpen(r) && r.SpeechMs%60000 != 0 {
		minutes++
	}
	target := minutes * 60000
	if target <= r.MeteredMs {
		return nil
	}
	n, err := q.MarkScribeRunMetered(ctx, db.MarkScribeRunMeteredParams{ID: r.ID, MeteredMs: target, PreviousMs: r.MeteredMs})
	if err != nil || n == 0 {
		return err
	}
	return s.ent.RecordUsage(ctx, q, ConsumeInput{
		OrganizationID: r.OrganizationID, WorkspaceID: r.WorkspaceID, Meter: FeatureMeetingTranscription,
		Delta: (target - r.MeteredMs) / 60000, Actor: scribeActor,
		RefType: "meeting_scribe_run", RefID: r.ID, IdempotencyKey: "scribe:" + r.ID + ":" + strconv.FormatInt(target, 10),
	})
}

func (s *MeetingService) meterScribeRunTx(ctx context.Context, r db.MeetingScribeRun) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := s.meterScribeRun(ctx, s.q.WithTx(tx), r); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// emitScribeUpdated tells the meeting's workspace a run changed state. It is
// the run's lifecycle, not a command anyone gave, so it carries no audit row;
// the switch (SetScribe) records meeting.scribe_toggled with its own event.
func (s *MeetingService) emitScribeUpdated(ctx context.Context, m db.Meeting) {
	if err := auditRecorder.Emit(ctx, s.q, scribeActor, audit.Event{
		Topic: "scribe.updated", OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID,
		Payload: map[string]string{"meeting_id": m.ID, "workspace_id": m.WorkspaceID},
	}); err != nil {
		slog.Warn("meeting scribe: event not queued", "meeting", m.ID, "err", err)
	}
}

// sweepScribes is the 15 s worker: every in-progress meeting with people in
// the room and every meeting holding an open run goes through ensureScribe.
func (s *MeetingService) sweepScribes(ctx context.Context) error {
	if !s.rt.ScribeEnabled {
		return nil
	}
	ids, err := s.q.ListScribeSweepMeetings(ctx, scribeSweepBatch)
	if err != nil {
		return err
	}
	var errs []error
	for _, id := range ids {
		cctx, cancel := context.WithTimeout(ctx, scribeCallTimeout)
		if err := s.ensureScribe(cctx, id); err != nil {
			errs = append(errs, err)
		}
		cancel()
	}
	return errors.Join(errs...)
}

// SetScribe switches the scribe off or back on for one meeting (D14): host
// or workspace admin, before or during the meeting. In progress, the agent is
// removed or dispatched right away.
func (s *MeetingService) SetScribe(ctx context.Context, userID, meetingID string, enabled bool) (db.Meeting, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	if m.Status != MeetingScheduled && m.Status != MeetingInProgress {
		return db.Meeting{}, errInvalidState()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Meeting{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	updated, err := q.SetMeetingScribeOff(ctx, db.SetMeetingScribeOffParams{ID: m.ID, Off: !enabled, By: userID})
	if err != nil {
		return db.Meeting{}, err
	}
	changed := m.ScribeOffAt.Valid != updated.ScribeOffAt.Valid
	if changed {
		s.record(ctx, q, updated, audit.User(userID), "scribe.updated",
			map[string]string{"meeting_id": m.ID, "workspace_id": m.WorkspaceID},
			audit.Diff(map[string]any{"scribe_enabled": !m.ScribeOffAt.Valid}, map[string]any{"scribe_enabled": enabled}))
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Meeting{}, err
	}
	if changed && updated.Status == MeetingInProgress {
		s.ensureScribeNow(ctx, m.ID)
	}
	return updated, nil
}
