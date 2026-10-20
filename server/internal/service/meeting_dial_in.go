package service

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Dial-in by phone (spec 2026-10-20-meeting-scribe-agent-design §5.4, B10).
// While a meeting is in progress a LiveKit SIP dispatch rule routes callers
// who enter its PIN into its room. A caller arrives in the room itself — the
// lobby cannot hold a SIP participant, and moving one between rooms is a
// LiveKit Cloud feature — so the server takes every grant away the moment
// the join webhook arrives and files a join request; the host admits or
// refuses the caller like a guest.

const (
	dialInFlag = "meeting_dial_in"
	// ParticipantKindSIP marks a provider event about a phone caller.
	ParticipantKindSIP = "sip"
	// LiveKit names an inbound caller sip_<hash of the number> (the rule hides
	// the number); UniWork keeps that identity as the caller's guest id, so
	// the participant row and the room identity are one string.
	dialInIdentityPrefix = "sip_"
	// dialInStateAttr tells clients a caller is still held ("waiting") or in
	// the meeting ("admitted"); a held caller is not tiled or listed.
	dialInStateAttr  = "uw.dial_in"
	dialInSweepBatch = 200
	dialInCallBudget = 10 * time.Second
)

// dialInActor attributes PIN rotations the server makes itself (a PIN another
// meeting's rule holds).
var dialInActor = audit.System("meeting_dial_in")

// DialInInfo is what a member needs to call in; Enabled false means this
// meeting takes no calls (switched off, flag off, or the meeting is over).
type DialInInfo struct {
	Enabled bool
	Number  string
	Pin     string
}

func (s *MeetingService) dialInConfigured() bool {
	return s.rt.DialInEnabled && s.rt.DialInNumber != "" && s.provider != nil
}

func (s *MeetingService) dialInOn(ctx context.Context, orgID string) bool {
	return s.dialInConfigured() && s.flagOn(ctx, dialInFlag, orgID)
}

func dialInOpen(m db.Meeting) bool {
	return m.Status == MeetingScheduled || m.Status == MeetingInProgress
}

func isDialInGuest(guestID string) bool { return strings.HasPrefix(guestID, dialInIdentityPrefix) }

// providerIdentity is the room identity of a participant: a caller's is
// their guest id, everyone else's is uw_participant_<id>.
func providerIdentity(p db.MeetingParticipant) string {
	if p.PrincipalType == PrincipalGuest && isDialInGuest(p.GuestID.String) {
		return p.GuestID.String
	}
	return meetings.IdentityForParticipant(p.ID)
}

// dialInName is the caller's display name from the provider's ("Phone 1234"):
// only the last four digits are ever kept.
func dialInName(providerName string) string {
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, providerName)
	if len(digits) > 4 {
		digits = digits[len(digits)-4:]
	}
	if digits == "" {
		return "Điện thoại"
	}
	return "Điện thoại ••• " + digits
}

func errDialInUnavailable() error {
	return coded(http.StatusNotFound, "dial_in_unavailable", "cuộc họp này không nhận cuộc gọi điện thoại")
}

// DialIn returns the number and PIN to any member of the meeting's workspace.
func (s *MeetingService) DialIn(ctx context.Context, userID, meetingID string) (DialInInfo, error) {
	m, _, err := s.authorize(ctx, userID, meetingID)
	if err != nil {
		return DialInInfo{}, err
	}
	return s.dialInInfo(ctx, m)
}

func (s *MeetingService) dialInInfo(ctx context.Context, m db.Meeting) (DialInInfo, error) {
	if !dialInOpen(m) || !s.dialInOn(ctx, m.OrganizationID) {
		return DialInInfo{}, nil
	}
	pin, err := s.meetingDialInPin(ctx, m)
	if err != nil {
		return DialInInfo{}, err
	}
	return DialInInfo{Enabled: true, Number: s.rt.DialInNumber, Pin: pin}, nil
}

// meetingDialInPin is the meeting's PIN, drawn now for a meeting that has
// none (created before the column, or restored).
func (s *MeetingService) meetingDialInPin(ctx context.Context, m db.Meeting) (string, error) {
	if m.DialInPin.Valid {
		return m.DialInPin.String, nil
	}
	pin, err := s.q.FillMeetingDialInPin(ctx, m.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Filled by a concurrent caller.
		fresh, err := s.q.GetMeeting(ctx, m.ID)
		return fresh.DialInPin.String, err
	}
	return pin.String, err
}

// RotateDialInPin draws a new PIN (host or workspace admin). A meeting in
// progress gets a new rule for it; callers already in stay.
func (s *MeetingService) RotateDialInPin(ctx context.Context, userID, meetingID string) (DialInInfo, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return DialInInfo{}, err
	}
	if !s.dialInOn(ctx, m.OrganizationID) {
		return DialInInfo{}, errDialInUnavailable()
	}
	if !dialInOpen(m) {
		return DialInInfo{}, errInvalidState()
	}
	pin, err := s.rotateDialInPin(ctx, m, audit.User(userID))
	if err != nil {
		return DialInInfo{}, err
	}
	if m.Status == MeetingInProgress {
		s.ensureDialInNow(ctx, m.ID)
	}
	return DialInInfo{Enabled: true, Number: s.rt.DialInNumber, Pin: pin}, nil
}

// rotateDialInPin stores a new PIN with its audit row and meeting.updated in
// one transaction, then deletes the rule that routed the old PIN. The audit
// row never carries a PIN.
func (s *MeetingService) rotateDialInPin(ctx context.Context, m db.Meeting, actor audit.Actor) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	row, err := q.RotateMeetingDialInPin(ctx, m.ID)
	if err != nil {
		return "", err
	}
	s.recordAs(ctx, q, m, actor, audit.ActionMeetingDialInPinRotated, "meeting.updated", nil, nil, "meeting", m.ID)
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	if row.OldRuleID.Valid {
		s.deleteDialInRule(ctx, m.ID, row.OldRuleID.String)
	}
	return row.DialInPin.String, nil
}

// ensureDialInNow runs ensureDialIn for a request that must not wait on or
// fail because of it (Start, End, a rotation): bounded, logged.
func (s *MeetingService) ensureDialInNow(ctx context.Context, meetingID string) {
	if s.provider == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), dialInCallBudget)
	defer cancel()
	if err := s.ensureDialIn(ctx, meetingID); err != nil {
		slog.Warn("meeting dial-in: ensure failed", "meeting", meetingID, "err", err)
	}
}

// ensureDialIn is the one owner of a meeting's SIP rule: a meeting in
// progress with dial-in on holds exactly one, for its current PIN; any other
// meeting holds none.
func (s *MeetingService) ensureDialIn(ctx context.Context, meetingID string) error {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	want := m.Status == MeetingInProgress && s.dialInOn(ctx, m.OrganizationID)
	if m.SipDispatchRuleID.Valid {
		if want {
			return nil
		}
		return s.dropDialInRule(ctx, m.ID, m.SipDispatchRuleID.String)
	}
	if !want {
		return nil
	}
	pin, err := s.meetingDialInPin(ctx, m)
	if err != nil {
		return err
	}
	taken, err := s.q.DialInPinTaken(ctx, db.DialInPinTakenParams{Pin: strText(pin), ID: m.ID})
	if err != nil {
		return err
	}
	if taken {
		// Another meeting in progress routes this PIN; this one takes a new one.
		if pin, err = s.rotateDialInPin(ctx, m, dialInActor); err != nil {
			return err
		}
	}
	ruleID, err := s.provider.CreateDialInRule(ctx, meetings.DialInRuleRequest{
		RoomName: meetings.RoomNameForMeeting(m.ID), Pin: pin, TrunkID: s.rt.SIPTrunkID, Name: "uniwork " + m.ID,
	})
	if err != nil {
		s.count("dial_in_rule_failed")
		return err
	}
	n, err := s.q.SetMeetingDialInRule(ctx, db.SetMeetingDialInRuleParams{RuleID: strText(ruleID), ID: m.ID, Pin: strText(pin)})
	if err != nil || n == 0 {
		// Lost a race (another ensure, the end, a rotation, or a PIN another
		// meeting claimed first): the rule just made is nobody's.
		s.deleteDialInRule(ctx, m.ID, ruleID)
		return err
	}
	s.count("dial_in_rule_created")
	return nil
}

// dropDialInRule deletes the provider's rule, then forgets it; a failed
// delete keeps the column so the sweep tries again.
func (s *MeetingService) dropDialInRule(ctx context.Context, meetingID, ruleID string) error {
	if err := s.provider.DeleteDialInRule(ctx, ruleID); err != nil {
		return err
	}
	_, err := s.q.ClearMeetingDialInRule(ctx, db.ClearMeetingDialInRuleParams{ID: meetingID, RuleID: strText(ruleID)})
	return err
}

// deleteDialInRule removes a rule no meeting row points at; a failure is
// logged for ops (the runbook lists stray rules by their uniwork name).
func (s *MeetingService) deleteDialInRule(ctx context.Context, meetingID, ruleID string) {
	if err := s.provider.DeleteDialInRule(ctx, ruleID); err != nil {
		slog.Warn("meeting dial-in: stray rule not deleted", "meeting", meetingID, "rule", ruleID, "err", err)
	}
}

// sweepDialIn is the 15 s worker: every meeting holding a rule, and with
// dial-in configured every meeting in progress without one, goes through
// ensureDialIn. It repairs a Start or End whose provider call failed.
//
// shortcut: the batch is the oldest 200 meetings, flag off or not; past 200
// meetings in progress at once, newer ones wait for an inline ensure. Page
// by start time when that day comes.
func (s *MeetingService) sweepDialIn(ctx context.Context) error {
	if s.provider == nil {
		return nil
	}
	ids, err := s.q.ListDialInSweepMeetings(ctx, db.ListDialInSweepMeetingsParams{WithEnsure: s.dialInConfigured(), RowLimit: dialInSweepBatch})
	if err != nil {
		return err
	}
	var errs []error
	for _, id := range ids {
		cctx, cancel := context.WithTimeout(ctx, dialInCallBudget)
		if err := s.ensureDialIn(cctx, id); err != nil {
			errs = append(errs, err)
		}
		cancel()
	}
	return errors.Join(errs...)
}

// HoldDialInCaller takes every grant away from a caller who just entered the
// room, straight from the webhook request so the gap stays one provider round
// trip. A caller already admitted (a redelivered join) is left alone; when
// that cannot be read, the caller is held.
func (s *MeetingService) HoldDialInCaller(ctx context.Context, ev ProviderNeutralEvent) {
	if ev.ParticipantKind != ParticipantKindSIP || s.provider == nil {
		return
	}
	meetingID := strings.TrimPrefix(ev.RoomName, "uw_mtg_")
	admitted, err := s.q.DialInCallerAdmitted(ctx, db.DialInCallerAdmittedParams{MeetingID: meetingID, GuestID: strText(ev.Identity)})
	if err == nil && admitted {
		return
	}
	s.holdDialInCaller(ctx, ev.RoomName, ev.Identity, ev.ParticipantName)
}

func (s *MeetingService) holdDialInCaller(ctx context.Context, room, identity, providerName string) {
	if err := s.provider.UpdateParticipant(ctx, meetings.UpdateProviderParticipantRequest{
		RoomName: room, Identity: identity, Name: dialInName(providerName),
		Attributes: map[string]string{dialInStateAttr: "waiting"},
	}); err != nil {
		slog.Warn("meeting dial-in: caller not held", "room", room, "err", err)
	}
}

func (s *MeetingService) hangUpDialInCaller(ctx context.Context, room, identity string) {
	if err := s.provider.RemoveParticipant(ctx, meetings.RemoveProviderParticipantRequest{RoomName: room, Identity: identity}); err != nil {
		slog.Warn("meeting dial-in: caller not dropped", "room", room, "err", err)
	}
}

// dialInCallerJoined files the caller's join request on the webhook's
// transaction. It files nothing — and settleDialInCaller then drops the call
// — when the meeting is not in progress, the call came through a rule that
// is not the meeting's current one, or the host removed this caller. Every
// call is a new knock: callers without caller id share one identity.
func (s *MeetingService) dialInCallerJoined(ctx context.Context, q *db.Queries, sess db.MeetingConferenceSession, ev ProviderNeutralEvent) error {
	m, err := q.GetMeeting(ctx, sess.MeetingID)
	if err != nil {
		return err
	}
	if m.Status != MeetingInProgress || !m.SipDispatchRuleID.Valid || ev.SIPRuleID != m.SipDispatchRuleID.String {
		return nil
	}
	p, err := q.GetGuestParticipantAnyStatus(ctx, db.GetGuestParticipantAnyStatusParams{MeetingID: m.ID, GuestID: strText(ev.Identity)})
	if err == nil && p.Status == ParticipantRemoved {
		return nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	_, err = s.ensureJoinRequestTx(ctx, q, m, AdmissionContext{
		MeetingID: m.ID, GuestID: ev.Identity, DisplayName: dialInName(ev.ParticipantName), RequestAgain: true,
	}, "")
	return err
}

// settleDialInCaller runs after the join committed: a caller with a pending
// request is held (again, in case the webhook's hold failed); one without
// is dropped; one already admitted is left alone.
func (s *MeetingService) settleDialInCaller(ctx context.Context, sess db.MeetingConferenceSession, ev ProviderNeutralEvent) {
	admitted, err := s.q.DialInCallerAdmitted(ctx, db.DialInCallerAdmittedParams{MeetingID: sess.MeetingID, GuestID: strText(ev.Identity)})
	if err == nil && admitted {
		return
	}
	_, err = s.q.GetPendingJoinRequestForGuest(ctx, db.GetPendingJoinRequestForGuestParams{MeetingID: sess.MeetingID, RequesterGuestID: strText(ev.Identity)})
	if errors.Is(err, pgx.ErrNoRows) {
		s.hangUpDialInCaller(ctx, ev.RoomName, ev.Identity)
		return
	}
	s.holdDialInCaller(ctx, ev.RoomName, ev.Identity, ev.ParticipantName)
}

// dialInCallerLeft takes a caller who hung up while waiting out of the host's
// queue, and closes the room session of one who was admitted.
func (s *MeetingService) dialInCallerLeft(ctx context.Context, q *db.Queries, sess db.MeetingConferenceSession, ev ProviderNeutralEvent) (bool, error) {
	jr, err := q.GetPendingJoinRequestForGuest(ctx, db.GetPendingJoinRequestForGuestParams{MeetingID: sess.MeetingID, RequesterGuestID: strText(ev.Identity)})
	switch {
	case err == nil:
		if err := s.cancelDialInRequest(ctx, q, jr); err != nil {
			return false, err
		}
	case !errors.Is(err, pgx.ErrNoRows):
		return false, err
	}
	p, err := q.GetGuestParticipantAnyStatus(ctx, db.GetGuestParticipantAnyStatusParams{MeetingID: sess.MeetingID, GuestID: strText(ev.Identity)})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return s.roomParticipantLeftAs(ctx, q, sess, ev, p.ID)
}

func (s *MeetingService) cancelDialInRequest(ctx context.Context, q *db.Queries, jr db.MeetingJoinRequest) error {
	if _, err := q.CancelJoinRequest(ctx, jr.ID); errors.Is(err, pgx.ErrNoRows) {
		return nil
	} else if err != nil {
		return err
	}
	m, err := q.GetMeeting(ctx, jr.MeetingID)
	if err != nil {
		return err
	}
	in := AdmissionContext{GuestID: jr.RequesterGuestID.String}
	_ = s.writeAudit(ctx, q, m, "JOIN_REQUEST_CANCELED", actorID(in), JoinPending, JoinCanceled, "{}")
	s.record(ctx, q, m, joinActor(in), "join_request.canceled",
		meetingRelatedPayload(m, map[string]string{"join_request_id": jr.ID}),
		audit.Diff(map[string]any{"status": JoinPending}, map[string]any{"status": JoinCanceled}))
	return nil
}

// admitDialInCaller gives an approved caller their voice and ears, and opens
// the room session the join webhook could not (the caller was held then).
// A caller who hung up meanwhile gets neither.
func (s *MeetingService) admitDialInCaller(ctx context.Context, m db.Meeting, p db.MeetingParticipant) {
	if s.provider == nil {
		return
	}
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		return
	}
	identity := providerIdentity(p)
	if err := s.provider.UpdateParticipant(ctx, meetings.UpdateProviderParticipantRequest{
		RoomName: sess.ProviderRoomName, Identity: identity,
		Permissions: meetings.MediaPermissions{CanSubscribe: true, CanPublish: true},
		Attributes:  map[string]string{dialInStateAttr: "admitted"},
	}); err != nil {
		slog.Warn("meeting dial-in: caller not admitted", "meeting", m.ID, "err", err)
		return
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	changed, err := s.roomParticipantJoinedAs(ctx, s.q.WithTx(tx), sess,
		ProviderNeutralEvent{Identity: identity, OccurredAt: time.Now().UTC()}, p.ID)
	if err != nil || tx.Commit(ctx) != nil {
		slog.Warn("meeting dial-in: room session not opened", "meeting", m.ID, "err", err)
		return
	}
	if changed {
		s.publishAttendanceChanged(ctx, m.ID)
	}
}

// dropRefusedDialInCaller ends the call of a caller the host refused.
func (s *MeetingService) dropRefusedDialInCaller(ctx context.Context, m db.Meeting, guestID string) {
	if s.provider == nil {
		return
	}
	room := meetings.RoomNameForMeeting(m.ID)
	if sess, err := s.q.GetOpenConferenceSession(ctx, m.ID); err == nil {
		room = sess.ProviderRoomName
	}
	s.hangUpDialInCaller(ctx, room, guestID)
}
