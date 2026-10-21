package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
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
	// A caller's guest id: uw_sip_ + an HMAC of LiveKit's identity under the
	// server secret (MaskDialInEvent).
	dialInGuestPrefix = "uw_sip_"
	// Every rule UniWork makes is named "uniwork <meetingID>".
	dialInRulePrefix = "uniwork "
	// A rule no meeting points at is deleted once it is this old.
	dialInStrayAge = time.Minute
	// livekitSIPRuleAttr is the participant attribute LiveKit SIP sets to the
	// dispatch rule that routed the call.
	livekitSIPRuleAttr = "sip.ruleID"
	// dialInStateAttr tells clients a caller is still held ("waiting") or in
	// the meeting ("admitted"); a held caller is not tiled or listed.
	dialInStateAttr  = "uw.dial_in"
	dialInSweepBatch = 200
	dialInCallBudget = 10 * time.Second
	// dialInSweepBudget bounds one whole sweep, under its 15 s interval.
	dialInSweepBudget = 12 * time.Second
	// dialInSweepLockKey is the sweep's run lease ("unisip").
	dialInSweepLockKey int64 = 0x756e69736970
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
	return s.dialInConfigured() && s.orgFlagOn(ctx, orgID, dialInFlag)
}

func dialInOpen(m db.Meeting) bool {
	return m.Status == MeetingScheduled || m.Status == MeetingInProgress
}

func isDialInGuest(guestID string) bool { return strings.HasPrefix(guestID, dialInGuestPrefix) }

func isDialInParticipant(p db.MeetingParticipant) bool {
	return p.PrincipalType == PrincipalGuest && isDialInGuest(p.GuestID.String)
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
	pin, err := s.meetingDialInPin(ctx, s.q, m)
	if err != nil {
		return DialInInfo{}, err
	}
	return DialInInfo{Enabled: true, Number: s.rt.DialInNumber, Pin: pin}, nil
}

// meetingDialInPin is the meeting's PIN, drawn now for a meeting that has
// none (created before the column, or restored).
func (s *MeetingService) meetingDialInPin(ctx context.Context, q *db.Queries, m db.Meeting) (string, error) {
	if m.DialInPin.Valid {
		return m.DialInPin.String, nil
	}
	pin, err := q.FillMeetingDialInPin(ctx, m.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Filled by a concurrent caller.
		fresh, err := q.GetMeeting(ctx, m.ID)
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
	row, err := s.rotateDialInPinTx(ctx, s.q.WithTx(tx), m, actor)
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	if row.OldRuleID.Valid {
		s.deleteDialInRule(ctx, m.ID, row.OldRuleID.String)
	}
	return row.DialInPin.String, nil
}

func (s *MeetingService) rotateDialInPinTx(ctx context.Context, q *db.Queries, m db.Meeting, actor audit.Actor) (db.RotateMeetingDialInPinRow, error) {
	row, err := q.RotateMeetingDialInPin(ctx, m.ID)
	if err != nil {
		return row, err
	}
	s.recordAction(ctx, q, m, actor, audit.ActionMeetingDialInPinRotated, "meeting.updated", nil, nil, "meeting", m.ID)
	return row, nil
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
// meeting holds none. Ensures of one meeting take turns (LockMeetingDialIn)
// and do all their reads and writes on the lock's transaction, so a waiting
// ensure holds one connection and the holder needs no second one.
func (s *MeetingService) ensureDialIn(ctx context.Context, meetingID string) error {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	// The flag is read before the lock: its store may need a connection of
	// its own. The organization never changes.
	on := s.dialInOn(ctx, m.OrganizationID)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	if err := q.LockMeetingDialIn(ctx, meetingID); err != nil {
		return err
	}
	// Re-read under the lock: the ensure that held it may have made the rule.
	if m, err = q.GetMeeting(ctx, meetingID); err != nil {
		return err
	}
	err = s.ensureDialInLocked(ctx, q, m, m.Status == MeetingInProgress && on)
	// Commit even on error: a rotation after a PIN conflict must stick.
	return errors.Join(err, tx.Commit(ctx))
}

func (s *MeetingService) ensureDialInLocked(ctx context.Context, q *db.Queries, m db.Meeting, want bool) error {
	if m.SipDispatchRuleID.Valid {
		if want {
			return nil
		}
		return s.dropDialInRule(ctx, q, m.ID, m.SipDispatchRuleID.String)
	}
	if !want {
		return nil
	}
	pin, err := s.meetingDialInPin(ctx, q, m)
	if err != nil {
		return err
	}
	taken, err := q.DialInPinTaken(ctx, db.DialInPinTakenParams{Pin: strText(pin), ID: m.ID})
	if err != nil {
		return err
	}
	// The rotations below drop no old rule: under the lock the meeting holds
	// none, and only an ensure sets one.
	if taken {
		// Another meeting in progress routes this PIN; this one takes a new one.
		row, err := s.rotateDialInPinTx(ctx, q, m, dialInActor)
		if err != nil {
			return err
		}
		pin = row.DialInPin.String
	}
	ruleID, err := s.provider.CreateDialInRule(ctx, meetings.DialInRuleRequest{
		RoomName: meetings.RoomNameForMeeting(m.ID), Pin: pin, TrunkID: s.rt.SIPTrunkID, Name: dialInRulePrefix + m.ID,
	})
	if errors.Is(err, meetings.ErrDialInRuleConflict) {
		// A rule this deployment does not know of (a stray one, or another
		// tenant of the trunk) holds the PIN: draw a new one, try next sweep.
		s.count("dial_in_rule_conflict")
		if _, rerr := s.rotateDialInPinTx(ctx, q, m, dialInActor); rerr != nil {
			return errors.Join(err, rerr)
		}
		return err
	}
	if err != nil {
		s.count("dial_in_rule_failed")
		return err
	}
	n, err := q.SetMeetingDialInRule(ctx, db.SetMeetingDialInRuleParams{RuleID: strText(ruleID), ID: m.ID, Pin: strText(pin)})
	if err != nil || n == 0 {
		// Lost a race (the end, a rotation, or a PIN another meeting claimed
		// first): the rule just made is nobody's.
		s.deleteDialInRule(ctx, m.ID, ruleID)
		return err
	}
	s.count("dial_in_rule_created")
	return nil
}

// dropDialInRule deletes the provider's rule, then forgets it; a failed
// delete keeps the column so the sweep tries again.
func (s *MeetingService) dropDialInRule(ctx context.Context, q *db.Queries, meetingID, ruleID string) error {
	if err := s.provider.DeleteDialInRule(ctx, ruleID); err != nil {
		return err
	}
	_, err := q.ClearMeetingDialInRule(ctx, db.ClearMeetingDialInRuleParams{ID: meetingID, RuleID: strText(ruleID)})
	return err
}

// deleteDialInRule removes a rule no meeting row points at; a failure is
// logged for ops (the runbook lists stray rules by their uniwork name).
func (s *MeetingService) deleteDialInRule(ctx context.Context, meetingID, ruleID string) {
	if err := s.provider.DeleteDialInRule(ctx, ruleID); err != nil {
		slog.Warn("meeting dial-in: stray rule not deleted", "meeting", meetingID, "rule", ruleID, "err", err)
	}
}

// sweepDialIn is the 15 s worker, run by one replica at a time: every
// meeting holding a rule, and with dial-in configured every meeting in
// progress without one, goes through
// ensureDialIn, then its phone connections are checked (a hold the webhook
// missed). It repairs a Start or End whose provider call failed, and deletes
// stray uniwork rules.
//
// shortcut: the batch is every rule holder, then the oldest meetings in
// progress without a rule, flag off or not, 200 in all; past that, newer
// ones wait for an inline ensure. Page by start time when that day comes.
func (s *MeetingService) sweepDialIn(ctx context.Context) error {
	if s.provider == nil {
		return nil
	}
	// One deadline for the whole sweep, so a slow LiveKit cannot stretch a
	// 15 s tick into minutes; what it cuts short, the next tick picks up.
	ctx, cancel := context.WithTimeout(ctx, dialInSweepBudget)
	defer cancel()
	// One replica per tick (works without Redis): the others skip.
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	lockQ := db.New(conn)
	if locked, err := lockQ.DialInSweepTryLock(ctx, dialInSweepLockKey); err != nil || !locked {
		return err
	}
	defer func() {
		if _, err := lockQ.DialInSweepUnlock(context.WithoutCancel(ctx), dialInSweepLockKey); err != nil {
			slog.Warn("meeting dial-in: release sweep lease", "err", err)
		}
	}()
	ids, err := s.q.ListDialInSweepMeetings(ctx, db.ListDialInSweepMeetingsParams{WithEnsure: s.dialInConfigured(), RowLimit: dialInSweepBatch})
	if err != nil {
		return err
	}
	var errs []error
	for _, id := range ids {
		if err := s.ensureDialIn(ctx, id); err != nil {
			errs = append(errs, err)
		}
		if err := s.sweepDialInCallers(ctx, id); err != nil {
			errs = append(errs, err)
		}
	}
	if s.dialInConfigured() {
		errs = append(errs, s.sweepStrayDialInRules(ctx))
	}
	return errors.Join(errs...)
}

// MaskDialInEvent is how a phone caller's webhook enters UniWork: LiveKit's
// identity (sip_ + an unsalted 64-bit hash of the number, reversible over the
// Vietnamese number space) becomes the keyed guest id, and the name keeps
// only the last four digits. Nothing downstream stores the raw identity; the
// live connection is found again by its SID when the server acts on it.
func (s *MeetingService) MaskDialInEvent(ev ProviderNeutralEvent) ProviderNeutralEvent {
	if ev.ParticipantKind != ParticipantKindSIP {
		return ev
	}
	ev.Identity = s.dialInGuestID(ev.Identity)
	ev.ParticipantName = dialInName(ev.ParticipantName)
	return ev
}

// dialInGuestID keys the provider identity with the server secret, so the
// stored id says nothing about the number to whoever reads the database.
func (s *MeetingService) dialInGuestID(providerIdentity string) string {
	mac := hmac.New(sha256.New, s.rt.HMACKey)
	mac.Write([]byte("dial-in:" + providerIdentity))
	return dialInGuestPrefix + hex.EncodeToString(mac.Sum(nil))[:32]
}

// HoldDialInCaller takes every grant away from a caller who just entered the
// room, straight from the webhook request (after the event is queued), so
// the gap stays one provider round trip; the 15 s sweep holds anyone this
// misses. ev is masked; identity is the raw provider identity, used here
// only. The connection already admitted (a redelivered join) is left alone;
// when that cannot be read, the caller is held.
func (s *MeetingService) HoldDialInCaller(ctx context.Context, ev ProviderNeutralEvent, identity string) {
	if ev.ParticipantKind != ParticipantKindSIP || s.provider == nil {
		return
	}
	meetingID := strings.TrimPrefix(ev.RoomName, "uw_mtg_")
	if s.connectionAdmitted(ctx, meetingID, ev.Identity, ev.ParticipantSID) {
		return
	}
	s.holdDialInCaller(ctx, ev.RoomName, identity, ev.ParticipantName)
}

// connectionAdmitted: the connection has its room session, or its knock was
// approved (the session may not be open yet). Unknown reads as not admitted.
func (s *MeetingService) connectionAdmitted(ctx context.Context, meetingID, guestID, sid string) bool {
	st := s.dialInCallerState(ctx, s.q, meetingID, guestID, sid)
	return st.InSession || st.Approved
}

func (s *MeetingService) dialInCallerState(ctx context.Context, q *db.Queries, meetingID, guestID, sid string) db.DialInCallerAdmittedRow {
	st, err := q.DialInCallerAdmitted(ctx, db.DialInCallerAdmittedParams{MeetingID: meetingID, GuestID: strText(guestID), ParticipantSid: sid})
	if err != nil {
		return db.DialInCallerAdmittedRow{}
	}
	return st
}

func (s *MeetingService) holdDialInCaller(ctx context.Context, room, identity, name string) {
	if err := s.provider.UpdateParticipant(ctx, meetings.UpdateProviderParticipantRequest{
		RoomName: room, Identity: identity, Name: dialInName(name),
		Attributes: map[string]string{dialInStateAttr: "waiting"},
	}); err != nil {
		slog.Warn("meeting dial-in: caller not held", "room", room, "err", err)
	}
}

// liveConnection finds the connection a SID names in the room; the raw
// identity it returns is used for one provider call and never stored.
func (s *MeetingService) liveConnection(ctx context.Context, room, sid string) (meetings.ProviderParticipant, bool) {
	if sid == "" {
		return meetings.ProviderParticipant{}, false
	}
	ps, err := s.provider.ListParticipants(ctx, room)
	if err != nil {
		slog.Warn("meeting dial-in: room not listed", "room", room, "err", err)
		return meetings.ProviderParticipant{}, false
	}
	for _, p := range ps {
		if p.SID == sid {
			return p, true
		}
	}
	return meetings.ProviderParticipant{}, false
}

func (s *MeetingService) hangUpConnection(ctx context.Context, room, sid string) {
	if conn, ok := s.liveConnection(ctx, room, sid); ok {
		s.hangUp(ctx, room, conn.Identity)
	}
}

func (s *MeetingService) hangUp(ctx context.Context, room, identity string) {
	if err := s.provider.RemoveParticipant(ctx, meetings.RemoveProviderParticipantRequest{RoomName: room, Identity: identity}); err != nil {
		slog.Warn("meeting dial-in: caller not dropped", "room", room, "err", err)
	}
}

// dialInCallerJoined files the connection's join request on the webhook's
// transaction (ev is masked). It files nothing — and settleDialInCaller then
// drops the call — when the meeting is not in progress, the call came
// through a rule that is not the meeting's current one, or the host removed
// this caller. Every connection is a new knock: a pending knock of the same
// caller is handed to the newest connection, and an earlier admission is
// never inherited.
func (s *MeetingService) dialInCallerJoined(ctx context.Context, q *db.Queries, sess db.MeetingConferenceSession, ev ProviderNeutralEvent) error {
	m, err := q.GetMeeting(ctx, sess.MeetingID)
	if err != nil {
		return err
	}
	if m.Status != MeetingInProgress || !m.SipDispatchRuleID.Valid || ev.SIPRuleID != m.SipDispatchRuleID.String {
		return nil
	}
	// A join that arrives after the sweep filed this connection's knock and
	// the host approved it: no second knock to refuse the admitted caller by.
	if st := s.dialInCallerState(ctx, q, m.ID, ev.Identity, ev.ParticipantSID); st.InSession || st.Approved {
		return nil
	}
	p, err := q.GetGuestParticipantAnyStatus(ctx, db.GetGuestParticipantAnyStatusParams{MeetingID: m.ID, GuestID: strText(ev.Identity)})
	if err == nil && p.Status == ParticipantRemoved {
		return nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	jr, err := s.ensureJoinRequestTx(ctx, q, m, AdmissionContext{
		MeetingID: m.ID, GuestID: ev.Identity, DisplayName: dialInName(ev.ParticipantName), RequestAgain: true,
	}, "")
	if err != nil {
		return err
	}
	return q.SetJoinRequestProviderSid(ctx, db.SetJoinRequestProviderSidParams{ID: jr.ID, ParticipantSid: ev.ParticipantSID})
}

// pendingKnock is the caller's pending request when it belongs to this
// connection.
func (s *MeetingService) pendingKnock(ctx context.Context, q *db.Queries, meetingID, guestID, sid string) (db.MeetingJoinRequest, bool, error) {
	jr, err := q.GetPendingJoinRequestForGuest(ctx, db.GetPendingJoinRequestForGuestParams{MeetingID: meetingID, RequesterGuestID: strText(guestID)})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.MeetingJoinRequest{}, false, nil
	}
	if err != nil {
		return db.MeetingJoinRequest{}, false, err
	}
	return jr, jr.ProviderParticipantSid.String == sid, nil
}

// settleDialInCaller runs after the join committed: a connection with its
// own pending knock is held (again, in case the webhook's hold failed), one
// without is dropped, the admitted one is left alone.
// conn is the live connection when the caller already listed the room (the
// sweep); nil looks it up.
func (s *MeetingService) settleDialInCaller(ctx context.Context, sess db.MeetingConferenceSession, ev ProviderNeutralEvent, conn *meetings.ProviderParticipant) {
	if s.connectionAdmitted(ctx, sess.MeetingID, ev.Identity, ev.ParticipantSID) {
		return
	}
	if conn == nil {
		found, ok := s.liveConnection(ctx, ev.RoomName, ev.ParticipantSID)
		if !ok {
			return
		}
		conn = &found
	}
	_, mine, err := s.pendingKnock(ctx, s.q, sess.MeetingID, ev.Identity, ev.ParticipantSID)
	if err == nil && !mine {
		s.hangUp(ctx, ev.RoomName, conn.Identity)
		return
	}
	if !dialInHeld(*conn) {
		s.holdDialInCaller(ctx, ev.RoomName, conn.Identity, ev.ParticipantName)
	}
}

func dialInHeld(p meetings.ProviderParticipant) bool {
	return p.Attributes[dialInStateAttr] == "waiting" && !p.Permissions.CanSubscribe && !p.Permissions.CanPublish && !p.Permissions.CanPublishData
}

// sweepDialInCallers is the backstop for a lost or failed hold (LiveKit
// drops webhooks when its queue is full): every phone connection in the
// room that is not admitted is held and has its own pending knock, or is
// dropped like a join webhook would have it.
func (s *MeetingService) sweepDialInCallers(ctx context.Context, meetingID string) error {
	m, err := s.q.GetMeeting(ctx, meetingID)
	if err != nil || m.Status != MeetingInProgress || !m.SipDispatchRuleID.Valid {
		return nil
	}
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		return nil
	}
	ps, err := s.provider.ListParticipants(ctx, sess.ProviderRoomName)
	if err != nil {
		return err
	}
	for _, p := range ps {
		if !p.SIP {
			continue
		}
		ev := s.MaskDialInEvent(ProviderNeutralEvent{
			Type: "conference.participant_joined", RoomName: sess.ProviderRoomName, Identity: p.Identity,
			ParticipantSID: p.SID, ParticipantKind: ParticipantKindSIP, ParticipantName: p.Name,
			SIPRuleID: p.Attributes[livekitSIPRuleAttr], OccurredAt: time.Now().UTC(),
		})
		st := s.dialInCallerState(ctx, s.q, m.ID, ev.Identity, ev.ParticipantSID)
		if st.Approved && !st.InSession {
			// Approved, but the admission that follows the approval's commit
			// did not finish (a crash, a failed provider call): finish it.
			if gp, err := s.q.GetGuestParticipantAnyStatus(ctx, db.GetGuestParticipantAnyStatusParams{MeetingID: m.ID, GuestID: strText(ev.Identity)}); err == nil {
				s.admitDialInCaller(ctx, m, gp, ev.ParticipantSID)
			}
			continue
		}
		if st.InSession {
			continue
		}
		if err := s.inTx(ctx, func(q *db.Queries) error { return s.dialInCallerJoined(ctx, q, sess, ev) }); err != nil {
			return err
		}
		s.settleDialInCaller(ctx, sess, ev, &p)
	}
	return nil
}

// dialInCallerLeft takes a connection that hung up while waiting out of the
// host's queue (its own knock only), and closes its room session if it was
// admitted (the leave closes only the session of the same connection).
func (s *MeetingService) dialInCallerLeft(ctx context.Context, q *db.Queries, sess db.MeetingConferenceSession, ev ProviderNeutralEvent) (bool, error) {
	jr, mine, err := s.pendingKnock(ctx, q, sess.MeetingID, ev.Identity, ev.ParticipantSID)
	if err != nil {
		return false, err
	}
	if mine {
		if err := s.cancelDialInRequest(ctx, q, jr); err != nil {
			return false, err
		}
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

// admitDialInCaller gives the approved connection its voice and ears and
// opens its room session, keyed by that connection's SID. A caller who hung
// up meanwhile gets neither.
func (s *MeetingService) admitDialInCaller(ctx context.Context, m db.Meeting, p db.MeetingParticipant, sid string) {
	if s.provider == nil {
		return
	}
	sess, err := s.q.GetOpenConferenceSession(ctx, m.ID)
	if err != nil {
		return
	}
	conn, ok := s.liveConnection(ctx, sess.ProviderRoomName, sid)
	if !ok {
		return
	}
	if err := s.provider.UpdateParticipant(ctx, meetings.UpdateProviderParticipantRequest{
		RoomName: sess.ProviderRoomName, Identity: conn.Identity,
		Permissions: meetings.MediaPermissions{CanSubscribe: true, CanPublish: true},
		Attributes:  map[string]string{dialInStateAttr: "admitted"},
	}); err != nil {
		slog.Warn("meeting dial-in: caller not admitted", "meeting", m.ID, "err", err)
		return
	}
	var changed bool
	err = s.inTx(ctx, func(q *db.Queries) error {
		changed, err = s.roomParticipantJoinedAs(ctx, q, sess,
			ProviderNeutralEvent{Identity: p.GuestID.String, ParticipantSID: sid, OccurredAt: time.Now().UTC()}, p.ID)
		return err
	})
	if err != nil {
		slog.Warn("meeting dial-in: room session not opened", "meeting", m.ID, "err", err)
		return
	}
	if changed {
		s.publishAttendanceChanged(ctx, m.ID)
	}
}

// dropRefusedDialInCaller ends the call of the connection the host refused.
func (s *MeetingService) dropRefusedDialInCaller(ctx context.Context, m db.Meeting, jr db.MeetingJoinRequest) {
	if s.provider == nil {
		return
	}
	room := meetings.RoomNameForMeeting(m.ID)
	if sess, err := s.q.GetOpenConferenceSession(ctx, m.ID); err == nil {
		room = sess.ProviderRoomName
	}
	s.hangUpConnection(ctx, room, jr.ProviderParticipantSid.String)
}

// dialInConnectionSID is the connection an admitted caller is on, "" when
// they are not in the room.
func (s *MeetingService) dialInConnectionSID(ctx context.Context, p db.MeetingParticipant) string {
	sid, err := s.q.OpenDialInSessionSid(ctx, db.OpenDialInSessionSidParams{MeetingID: p.MeetingID, ParticipantID: p.ID})
	if err != nil {
		return ""
	}
	return sid.String
}

// sweepStrayDialInRules deletes uniwork rules no meeting points at: a rule
// made whose meeting write then failed or lost a race and whose delete also
// failed. A rule younger than a minute may still be on its way to its row.
//
// Without MEETING_SIP_TRUNK_ID nothing is swept: another deployment sharing
// the LiveKit server names its rules "uniwork <id>" too, and only the trunk
// tells them apart.
func (s *MeetingService) sweepStrayDialInRules(ctx context.Context) error {
	if s.rt.SIPTrunkID == "" {
		return nil
	}
	rules, err := s.provider.ListDialInRules(ctx, s.rt.SIPTrunkID)
	if err != nil {
		return err
	}
	held, err := s.q.ListMeetingDialInRuleIDs(ctx)
	if err != nil {
		return err
	}
	live := make(map[string]bool, len(held))
	for _, id := range held {
		live[id] = true
	}
	for _, r := range rules {
		if !strings.HasPrefix(r.Name, dialInRulePrefix) || live[r.ID] || r.CreatedAt.IsZero() || time.Since(r.CreatedAt) < dialInStrayAge {
			continue
		}
		s.deleteDialInRule(ctx, "", r.ID)
	}
	return nil
}
