package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// dialInFixture: dial-in configured on the server, every flag on, and an
// instant meeting in progress hosted by ua.
func dialInFixture(t *testing.T) (*MeetingService, *meetings.FakeProvider, db.User, db.User, db.Meeting) {
	t.Helper()
	s, ua, ub, w := meetingFixture(t)
	fake := &meetings.FakeProvider{}
	s.provider = fake
	s.rt.DialInEnabled, s.rt.DialInNumber, s.rt.SIPTrunkID = true, "+84 28 7300 0000", "ST_uniwork"
	s.SetFlags(mcpFlagsExcept{})
	addMember(t, s, w.ID, ub.ID)
	m, err := s.CreateInstant(context.Background(), ua.ID, w.ID, "Giao ban")
	if err != nil {
		t.Fatal(err)
	}
	return s, fake, ua, ub, m
}

func reloadMeeting(t *testing.T, s *MeetingService, id string) db.Meeting {
	t.Helper()
	m, err := s.q.GetMeeting(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestDialInRuleFollowsTheMeeting(t *testing.T) {
	s, fake, ua, ub, m := dialInFixture(t)
	ctx := context.Background()
	m = reloadMeeting(t, s, m.ID)
	if len(m.DialInPin.String) != 6 {
		t.Fatalf("pin = %q", m.DialInPin.String)
	}
	rules := fake.LiveDialInRules()
	rule, ok := rules[m.SipDispatchRuleID.String]
	if len(rules) != 1 || !ok {
		t.Fatalf("Start made rules %v, meeting holds %q", rules, m.SipDispatchRuleID.String)
	}
	if rule.RoomName != meetings.RoomNameForMeeting(m.ID) || rule.Pin != m.DialInPin.String || rule.TrunkID != "ST_uniwork" {
		t.Fatalf("rule = %+v", rule)
	}
	// Any member reads the number and PIN.
	info, err := s.DialIn(ctx, ub.ID, m.ID)
	if err != nil || !info.Enabled || info.Number != "+84 28 7300 0000" || info.Pin != m.DialInPin.String {
		t.Fatalf("dial-in = %+v err=%v", info, err)
	}
	// A second ensure keeps the one rule.
	if err := s.ensureDialIn(ctx, m.ID); err != nil || fake.DialInCreates != 1 {
		t.Fatalf("creates=%d err=%v", fake.DialInCreates, err)
	}
	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if left := fake.LiveDialInRules(); len(left) != 0 {
		t.Fatalf("rules after End: %v", left)
	}
	if reloadMeeting(t, s, m.ID).SipDispatchRuleID.Valid {
		t.Fatal("ended meeting still holds its rule")
	}
	if info, _ := s.DialIn(ctx, ub.ID, m.ID); info.Enabled {
		t.Fatalf("ended meeting offers dial-in: %+v", info)
	}
}

func TestDialInStaysOffWithoutTheSwitchOrTheFlag(t *testing.T) {
	ctx := context.Background()
	for name, setup := range map[string]func(*MeetingService){
		"env off":   func(s *MeetingService) { s.rt.DialInEnabled = false },
		"no number": func(s *MeetingService) { s.rt.DialInNumber = "" },
		"flag off":  func(s *MeetingService) { s.SetFlags(mcpFlagsExcept{off: dialInFlag}) },
	} {
		t.Run(name, func(t *testing.T) {
			s, ua, _, w := meetingFixture(t)
			fake := &meetings.FakeProvider{}
			s.provider = fake
			s.rt.DialInEnabled, s.rt.DialInNumber = true, "+84 28 7300 0000"
			s.SetFlags(mcpFlagsExcept{})
			setup(s)
			m, err := s.CreateInstant(ctx, ua.ID, w.ID, "Giao ban")
			if err != nil {
				t.Fatal(err)
			}
			if err := s.sweepDialIn(ctx); err != nil {
				t.Fatal(err)
			}
			if fake.DialInCreates != 0 {
				t.Fatalf("created %d rules", fake.DialInCreates)
			}
			if info, err := s.DialIn(ctx, ua.ID, m.ID); err != nil || info.Enabled || info.Pin != "" {
				t.Fatalf("dial-in = %+v err=%v", info, err)
			}
			if _, err := s.RotateDialInPin(ctx, ua.ID, m.ID); err == nil {
				t.Fatal("rotated a PIN nobody can dial")
			}
		})
	}
}

// Two meetings holding a rule never share a PIN: the second rotates its own.
func TestDialInPinCollisionRotatesTheNewcomer(t *testing.T) {
	s, fake, ua, _, a := dialInFixture(t)
	ctx := context.Background()
	a = reloadMeeting(t, s, a.ID)
	fake.DialInRuleErr = errors.New("sip down")
	b, err := s.CreateInstant(ctx, ua.ID, a.WorkspaceID, "Trùng PIN")
	if err != nil {
		t.Fatal(err)
	}
	fake.DialInRuleErr = nil
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET dial_in_pin = $2 WHERE id = $1`, b.ID, a.DialInPin.String); err != nil {
		t.Fatal(err)
	}
	if err := s.sweepDialIn(ctx); err != nil {
		t.Fatal(err)
	}
	b = reloadMeeting(t, s, b.ID)
	if !b.SipDispatchRuleID.Valid || b.DialInPin.String == a.DialInPin.String {
		t.Fatalf("b rule=%v pin=%q (a's %q)", b.SipDispatchRuleID, b.DialInPin.String, a.DialInPin.String)
	}
	if got := fake.LiveDialInRules()[b.SipDispatchRuleID.String].Pin; got != b.DialInPin.String {
		t.Fatalf("rule pin %q, meeting pin %q", got, b.DialInPin.String)
	}
	if n := dialInAuditCount(t, s, b.ID, "meeting.dial_in_pin_rotated", "system"); n != 1 {
		t.Fatalf("system rotations audited = %d", n)
	}
}

func TestRotateDialInPin(t *testing.T) {
	s, fake, ua, ub, m := dialInFixture(t)
	ctx := context.Background()
	m = reloadMeeting(t, s, m.ID)
	var refused CodedError
	if _, err := s.RotateDialInPin(ctx, ub.ID, m.ID); !errors.As(err, &refused) || refused.Status != 403 {
		t.Fatalf("member rotated: %v", err)
	}
	info, err := s.RotateDialInPin(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	after := reloadMeeting(t, s, m.ID)
	if info.Pin == m.DialInPin.String || info.Pin != after.DialInPin.String || len(info.Pin) != 6 {
		t.Fatalf("rotated %q -> %q (stored %q)", m.DialInPin.String, info.Pin, after.DialInPin.String)
	}
	rules := fake.LiveDialInRules()
	if _, old := rules[m.SipDispatchRuleID.String]; old || len(rules) != 1 || rules[after.SipDispatchRuleID.String].Pin != info.Pin {
		t.Fatalf("rules after rotation %v (meeting holds %q)", rules, after.SipDispatchRuleID.String)
	}
	if n := dialInAuditCount(t, s, m.ID, "meeting.dial_in_pin_rotated", "human"); n != 1 {
		t.Fatalf("rotations audited = %d", n)
	}
}

func TestDialInSweepRepairsWhatStartAndEndMissed(t *testing.T) {
	s, fake, ua, _, m := dialInFixture(t)
	ctx := context.Background()
	// Ended while the provider was down: the rule outlives the meeting.
	held := reloadMeeting(t, s, m.ID).SipDispatchRuleID.String
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET status = 'ENDED' WHERE id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	// Started while the provider was down: no rule yet.
	fake.DialInRuleErr = errors.New("sip down")
	n, err := s.CreateInstant(ctx, ua.ID, m.WorkspaceID, "Lỡ rule")
	if err != nil {
		t.Fatal(err)
	}
	fake.DialInRuleErr = nil
	if err := s.sweepDialIn(ctx); err != nil {
		t.Fatal(err)
	}
	if _, ok := fake.LiveDialInRules()[held]; ok || reloadMeeting(t, s, m.ID).SipDispatchRuleID.Valid {
		t.Fatal("the ended meeting's rule survived the sweep")
	}
	if !reloadMeeting(t, s, n.ID).SipDispatchRuleID.Valid {
		t.Fatal("the sweep did not create the missing rule")
	}
}

func dialInAuditCount(t *testing.T, s *MeetingService, meetingID, action, kind string) int {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM audit_events WHERE resource_id = $1 AND action = $2 AND actor_kind = $3`,
		meetingID, action, kind).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// sipJoin is the webhook a caller's entry produces, as LiveKit sends it:
// kind SIP, LiveKit's hashed identity, its name and the rule that routed the
// call.
func sipJoin(m db.Meeting, typ, identity, sid string) ProviderNeutralEvent {
	return ProviderNeutralEvent{
		Type: typ, RoomName: meetings.RoomNameForMeeting(m.ID), Identity: identity,
		ProviderEventID: typ + sid, ParticipantSID: sid, OccurredAt: time.Now().UTC(),
		ParticipantKind: ParticipantKindSIP, ParticipantName: "Phone 1234", SIPRuleID: m.SipDispatchRuleID.String,
	}
}

// dialIn connects a caller (LiveKit now lists them, with the grants of a
// fresh SIP participant) and delivers the join webhook the way the handler
// does: masked, queued, held, then applied by the inbox.
func dialIn(t *testing.T, s *MeetingService, fake *meetings.FakeProvider, m db.Meeting, identity, sid string) ProviderNeutralEvent {
	t.Helper()
	raw := sipJoin(m, "conference.participant_joined", identity, sid)
	fake.Join(raw.RoomName, meetings.ProviderParticipant{
		Identity: identity, SID: sid, Name: raw.ParticipantName, SIP: true,
		Attributes:  map[string]string{"sip.ruleID": raw.SIPRuleID},
		Permissions: meetings.MediaPermissions{CanSubscribe: true, CanPublish: true, CanPublishData: true},
	})
	ev := s.MaskDialInEvent(raw)
	s.HoldDialInCaller(context.Background(), ev, identity)
	if err := s.HandleProviderEvent(context.Background(), ev); err != nil {
		t.Fatal(err)
	}
	return ev
}

// hangUp drops the connection from the room and delivers its leave webhook.
func hangUp(t *testing.T, s *MeetingService, fake *meetings.FakeProvider, m db.Meeting, identity, sid string) {
	t.Helper()
	room := meetings.RoomNameForMeeting(m.ID)
	_ = fake.RemoveParticipant(context.Background(), meetings.RemoveProviderParticipantRequest{RoomName: room, Identity: identity})
	if err := s.HandleProviderEvent(context.Background(), s.MaskDialInEvent(sipJoin(m, "conference.participant_left", identity, sid))); err != nil {
		t.Fatal(err)
	}
}

func lastUpdateFor(t *testing.T, fake *meetings.FakeProvider, identity string) meetings.UpdateProviderParticipantRequest {
	t.Helper()
	updates, _ := fake.Snapshot()
	for i := len(updates) - 1; i >= 0; i-- {
		if updates[i].Identity == identity {
			return updates[i]
		}
	}
	t.Fatalf("no update for %s", identity)
	return meetings.UpdateProviderParticipantRequest{}
}

func pendingKnockOf(t *testing.T, s *MeetingService, m db.Meeting, guestID string) (db.MeetingJoinRequest, bool) {
	t.Helper()
	jr, err := s.q.GetPendingJoinRequestForGuest(context.Background(), db.GetPendingJoinRequestForGuestParams{MeetingID: m.ID, RequesterGuestID: strText(guestID)})
	return jr, err == nil
}

func admitted(s *MeetingService, m db.Meeting, guestID, sid string) bool {
	return s.connectionAdmitted(context.Background(), m.ID, guestID, sid)
}

func TestDialInCallerWaitsInTheLobbyUntilAdmitted(t *testing.T) {
	s, fake, ua, _, m := dialInFixture(t)
	ctx := context.Background()
	m = reloadMeeting(t, s, m.ID)
	const caller = "sip_c15a31c71649a522"
	ev := dialIn(t, s, fake, m, caller, "PA_1")
	if !strings.HasPrefix(ev.Identity, "uw_sip_") || strings.Contains(ev.Identity, "c15a31c71649a522") {
		t.Fatalf("masked identity %q", ev.Identity)
	}
	held := lastUpdateFor(t, fake, caller)
	if held.Permissions != (meetings.MediaPermissions{}) || held.Name != "Điện thoại ••• 1234" || held.Attributes[dialInStateAttr] != "waiting" {
		t.Fatalf("hold = %+v", held)
	}
	jr, ok := pendingKnockOf(t, s, m, ev.Identity)
	if !ok || jr.DisplayNameSnapshot != "Điện thoại ••• 1234" || jr.ProviderParticipantSid.String != "PA_1" {
		t.Fatalf("join request %+v ok=%v", jr, ok)
	}
	if _, removed := fake.Snapshot(); len(removed) != 0 {
		t.Fatalf("a waiting caller was hung up: %v", removed)
	}
	if err := s.ApproveJoinRequest(ctx, ua.ID, jr.ID); err != nil {
		t.Fatal(err)
	}
	in := lastUpdateFor(t, fake, caller)
	if !in.Permissions.CanSubscribe || !in.Permissions.CanPublish || in.Attributes[dialInStateAttr] != "admitted" {
		t.Fatalf("admit = %+v", in)
	}
	p, err := s.q.GetGuestParticipantAnyStatus(ctx, db.GetGuestParticipantAnyStatusParams{MeetingID: m.ID, GuestID: strText(ev.Identity)})
	if err != nil || p.Standing != StandingObserver {
		t.Fatalf("participant %+v err=%v", p, err)
	}
	if !admitted(s, m, ev.Identity, "PA_1") {
		t.Fatal("admission opened no room session for the connection")
	}
	// A redelivered join does not mute the admitted connection again.
	before, _ := fake.Snapshot()
	s.HoldDialInCaller(ctx, ev, caller)
	if after, _ := fake.Snapshot(); len(after) != len(before) {
		t.Fatal("an admitted caller was held again")
	}
	// The host removes the caller: the call is dropped by its connection,
	// and the queued removal names no identity.
	if err := s.RemoveParticipant(ctx, ua.ID, m.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	var payload string
	if err := s.pool.QueryRow(ctx, `SELECT payload FROM outbox_events WHERE topic = 'provider.remove_participant' ORDER BY created_at DESC LIMIT 1`).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(payload, caller) || !strings.Contains(payload, `"participant_sid":"PA_1"`) {
		t.Fatalf("removal payload %s", payload)
	}
	hangUp(t, s, fake, m, caller, "PA_1")
	if admitted(s, m, ev.Identity, "PA_1") {
		t.Fatal("hanging up left the room session open")
	}
}

// Every connection knocks: a redial (or a second caller without caller id)
// on the same LiveKit identity inherits nothing from an admitted one, and
// the first connection's hang-up touches only its own session.
func TestDialInRedialIsANewKnock(t *testing.T) {
	s, fake, ua, _, m := dialInFixture(t)
	ctx := context.Background()
	m = reloadMeeting(t, s, m.ID)
	const caller = "sip_anonymous0000"
	a := dialIn(t, s, fake, m, caller, "PA_A")
	ja, _ := pendingKnockOf(t, s, m, a.Identity)
	if err := s.ApproveJoinRequest(ctx, ua.ID, ja.ID); err != nil {
		t.Fatal(err)
	}
	b := dialIn(t, s, fake, m, caller, "PA_B")
	if admitted(s, m, b.Identity, "PA_B") {
		t.Fatal("the second connection inherited the first one's admission")
	}
	if held := lastUpdateFor(t, fake, caller); held.Attributes[dialInStateAttr] != "waiting" {
		t.Fatalf("second connection not held: %+v", held)
	}
	jb, ok := pendingKnockOf(t, s, m, b.Identity)
	if !ok || jb.ID == ja.ID || jb.ProviderParticipantSid.String != "PA_B" {
		t.Fatalf("second knock %+v ok=%v", jb, ok)
	}
	if err := s.HandleProviderEvent(ctx, s.MaskDialInEvent(sipJoin(m, "conference.participant_left", caller, "PA_A"))); err != nil {
		t.Fatal(err)
	}
	if again, ok := pendingKnockOf(t, s, m, b.Identity); !ok || again.ID != jb.ID {
		t.Fatal("the first connection's hang-up withdrew the second one's knock")
	}
	if admitted(s, m, a.Identity, "PA_A") {
		t.Fatal("the first connection's session stayed open")
	}
}

func TestDialInCallerRefusedOrGoneLeavesNoOneWaiting(t *testing.T) {
	s, fake, ua, _, m := dialInFixture(t)
	ctx := context.Background()
	m = reloadMeeting(t, s, m.ID)
	// Rejected: the call is dropped.
	a := dialIn(t, s, fake, m, "sip_aaaa", "PA_a")
	jr, ok := pendingKnockOf(t, s, m, a.Identity)
	if !ok {
		t.Fatal("no knock")
	}
	if err := s.RejectJoinRequest(ctx, ua.ID, jr.ID, ""); err != nil {
		t.Fatal(err)
	}
	if _, removed := fake.Snapshot(); len(removed) != 1 || removed[0].Identity != "sip_aaaa" {
		t.Fatalf("removed = %v", removed)
	}
	// Hung up while waiting: the knock leaves the host's queue.
	b := dialIn(t, s, fake, m, "sip_bbbb", "PA_b")
	hangUp(t, s, fake, m, "sip_bbbb", "PA_b")
	if _, ok := pendingKnockOf(t, s, m, b.Identity); ok {
		t.Fatal("a caller who hung up is still waiting")
	}
	// Routed by a rule that is not the meeting's: dropped, nothing filed.
	raw := sipJoin(m, "conference.participant_joined", "sip_cccc", "PA_c")
	raw.SIPRuleID = "SDR_other"
	fake.Join(raw.RoomName, meetings.ProviderParticipant{Identity: "sip_cccc", SID: "PA_c", SIP: true})
	if err := s.HandleProviderEvent(ctx, s.MaskDialInEvent(raw)); err != nil {
		t.Fatal(err)
	}
	if _, ok := pendingKnockOf(t, s, m, s.dialInGuestID("sip_cccc")); ok {
		t.Fatal("a stray caller was queued")
	}
	if _, removed := fake.Snapshot(); removed[len(removed)-1].Identity != "sip_cccc" {
		t.Fatalf("removed = %v", removed)
	}
	// After the end a stale rule may still dial someone in: dropped too.
	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	dialIn(t, s, fake, m, "sip_dddd", "PA_d")
	if _, removed := fake.Snapshot(); removed[len(removed)-1].Identity != "sip_dddd" {
		t.Fatalf("removed = %v", removed)
	}
}

// LiveKit drops webhooks when its queue is full: the sweep finds a caller
// nobody held and holds them, with their own knock, within one tick.
func TestDialInSweepHoldsACallerWhoseWebhookWasLost(t *testing.T) {
	s, fake, _, _, m := dialInFixture(t)
	ctx := context.Background()
	m = reloadMeeting(t, s, m.ID)
	room := meetings.RoomNameForMeeting(m.ID)
	fake.Join(room, meetings.ProviderParticipant{
		Identity: "sip_lost", SID: "PA_lost", Name: "Phone 9876", SIP: true,
		Attributes:  map[string]string{"sip.ruleID": m.SipDispatchRuleID.String},
		Permissions: meetings.MediaPermissions{CanSubscribe: true, CanPublish: true, CanPublishData: true},
	})
	lists := fake.ListParticipantsCount()
	if err := s.sweepDialIn(ctx); err != nil {
		t.Fatal(err)
	}
	if n := fake.ListParticipantsCount() - lists; n != 1 {
		t.Fatalf("one sweep listed the room %d times, want once", n)
	}
	held := lastUpdateFor(t, fake, "sip_lost")
	if held.Permissions != (meetings.MediaPermissions{}) || held.Attributes[dialInStateAttr] != "waiting" || held.Name != "Điện thoại ••• 9876" {
		t.Fatalf("hold = %+v", held)
	}
	if jr, ok := pendingKnockOf(t, s, m, s.dialInGuestID("sip_lost")); !ok || jr.ProviderParticipantSid.String != "PA_lost" {
		t.Fatalf("knock %+v ok=%v", jr, ok)
	}
	// Already held: the next sweep leaves the caller as they are.
	before, _ := fake.Snapshot()
	if err := s.sweepDialIn(ctx); err != nil {
		t.Fatal(err)
	}
	if after, _ := fake.Snapshot(); len(after) != len(before) {
		t.Fatal("a held caller was held again on every sweep")
	}
}

// The spec keeps only the last four digits. LiveKit's identity is an
// unsalted hash of the number, so it must not land in any row, above all
// in append-only audit_events.
func TestNoRawCallerIdentityIsStored(t *testing.T) {
	s, fake, ua, _, m := dialInFixture(t)
	ctx := context.Background()
	m = reloadMeeting(t, s, m.ID)
	const caller = "sip_9f86d081884c7d65"
	ev := dialIn(t, s, fake, m, caller, "PA_1")
	jr, _ := pendingKnockOf(t, s, m, ev.Identity)
	if err := s.ApproveJoinRequest(ctx, ua.ID, jr.ID); err != nil {
		t.Fatal(err)
	}
	hangUp(t, s, fake, m, caller, "PA_1")
	ev = dialIn(t, s, fake, m, caller, "PA_2")
	jr, _ = pendingKnockOf(t, s, m, ev.Identity)
	if err := s.RejectJoinRequest(ctx, ua.ID, jr.ID, ""); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"audit_events", "meeting_audit_logs", "meeting_participants", "meeting_join_requests", "meeting_attendance_sessions", "outbox_events"} {
		var n int
		if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM `+table+` x WHERE x::text LIKE '%' || $1 || '%' OR x::text LIKE '%Phone 1234%'`, "9f86d081884c7d65").Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Errorf("%s holds the caller's raw identity or number in %d rows", table, n)
		}
	}
}

// LiveKit refuses a rule whose PIN another rule on the trunk already holds
// (a stray one, or another tenant of the trunk): the meeting draws a new PIN
// and the next sweep makes the rule.
func TestDialInRuleConflictRotatesThePIN(t *testing.T) {
	s, fake, ua, _, a := dialInFixture(t)
	ctx := context.Background()
	fake.DialInRuleErr = fmt.Errorf("refused: %w", meetings.ErrDialInRuleConflict)
	b, err := s.CreateInstant(ctx, ua.ID, a.WorkspaceID, "PIN bị chiếm")
	if err != nil {
		t.Fatal(err)
	}
	fake.DialInRuleErr = nil
	if b.DialInPin.String == reloadMeeting(t, s, b.ID).DialInPin.String {
		t.Fatal("the PIN was not rotated after the conflict")
	}
	// Any other refusal (a bad trunk id, say) keeps the PIN people hold:
	// rotating would not fix it and would audit a rotation every sweep.
	fake.DialInRuleErr = errors.New("livekit create dial-in rule: twirp error invalid_argument: trunk not found")
	c, err := s.CreateInstant(ctx, ua.ID, a.WorkspaceID, "Trunk sai")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.sweepDialIn(ctx); err == nil {
		t.Fatal("the sweep hid the refusal")
	}
	if c.DialInPin.String != reloadMeeting(t, s, c.ID).DialInPin.String || dialInAuditCount(t, s, c.ID, "meeting.dial_in_pin_rotated", "system") != 0 {
		t.Fatal("a refusal that is not a PIN clash rotated the PIN")
	}
	fake.DialInRuleErr = nil
	if n := dialInAuditCount(t, s, b.ID, "meeting.dial_in_pin_rotated", "system"); n != 1 {
		t.Fatalf("rotations audited = %d", n)
	}
	if err := s.sweepDialIn(ctx); err != nil {
		t.Fatal(err)
	}
	b = reloadMeeting(t, s, b.ID)
	if got := fake.LiveDialInRules()[b.SipDispatchRuleID.String].Pin; !b.SipDispatchRuleID.Valid || got != b.DialInPin.String {
		t.Fatalf("rule pin %q, meeting %+v", got, b.SipDispatchRuleID)
	}
}

func TestDialInSweepDeletesStrayRules(t *testing.T) {
	s, fake, _, _, m := dialInFixture(t)
	ctx := context.Background()
	held := reloadMeeting(t, s, m.ID).SipDispatchRuleID.String
	old := time.Now().Add(-2 * time.Minute)
	fake.ListedRules = []meetings.DialInRule{
		{ID: "SDR_stray", Name: "uniwork 01GONE", TrunkIDs: []string{"ST_uniwork"}, CreatedAt: old},
		{ID: "SDR_young", Name: "uniwork 01NEW", TrunkIDs: []string{"ST_uniwork"}, CreatedAt: time.Now().Add(-10 * time.Second)},
		{ID: "SDR_lms", Name: "lms-core hotline", TrunkIDs: []string{"ST_uniwork"}, CreatedAt: old},
		// Staging shares this LiveKit and names its rules the same way.
		{ID: "SDR_staging", Name: "uniwork 01STAGING", TrunkIDs: []string{"ST_staging"}, CreatedAt: old},
		{ID: held, Name: "uniwork " + m.ID, TrunkIDs: []string{"ST_uniwork"}, CreatedAt: old},
	}
	if err := s.sweepDialIn(ctx); err != nil {
		t.Fatal(err)
	}
	if len(fake.DialInDeletes) != 1 || fake.DialInDeletes[0] != "SDR_stray" {
		t.Fatalf("deleted %v", fake.DialInDeletes)
	}
	// Without a trunk to keep to, the server cannot tell its rules from
	// another deployment's: no stray sweep at all.
	s.rt.SIPTrunkID = ""
	fake.DialInDeletes, fake.ListRulesCalls = nil, 0
	if err := s.sweepDialIn(ctx); err != nil {
		t.Fatal(err)
	}
	if fake.ListRulesCalls != 0 || len(fake.DialInDeletes) != 0 {
		t.Fatalf("no trunk: listed %d times, deleted %v", fake.ListRulesCalls, fake.DialInDeletes)
	}
}

func TestDialInNameShowsOnlyTheLastFourDigits(t *testing.T) {
	for in, want := range map[string]string{
		"Phone 1234":         "Điện thoại ••• 1234",
		"Phone +84901234567": "Điện thoại ••• 4567",
		"Phone 12":           "Điện thoại ••• 12",
		"":                   "Điện thoại",
	} {
		if got := dialInName(in); got != want {
			t.Errorf("dialInName(%q) = %q want %q", in, got, want)
		}
	}
}

func TestCalendarInviteCarriesTheDialInLine(t *testing.T) {
	s, _, ua, _, m := dialInFixture(t)
	ctx := context.Background()
	pin := reloadMeeting(t, s, m.ID).DialInPin.String
	ics, err := s.CalendarICS(ctx, ua.ID, m.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if want := `Gọi vào bằng điện thoại: +84 28 7300 0000 · Mã PIN: ` + pin; !strings.Contains(string(ics), want) {
		t.Fatalf("ics lacks %q:\n%s", want, ics)
	}
	s.SetFlags(mcpFlagsExcept{off: dialInFlag})
	if ics, _ := s.CalendarICS(ctx, ua.ID, m.ID, ""); strings.Contains(string(ics), pin) {
		t.Fatalf("flag off, the ics still carries the PIN:\n%s", ics)
	}
}

// Removal, mute and the scribe's speaker lookup tell a caller apart by the
// keyed guest id, never by LiveKit's identity.
func TestDialInGuestIDIsKeyedAndStable(t *testing.T) {
	s, _, _, _ := meetingFixture(t)
	id := s.dialInGuestID("sip_c15a31c71649a522")
	if !strings.HasPrefix(id, "uw_sip_") || len(id) != len("uw_sip_")+32 || strings.Contains(id, "c15a31c71649a522") {
		t.Fatalf("guest id %q", id)
	}
	if s.dialInGuestID("sip_c15a31c71649a522") != id || s.dialInGuestID("sip_other") == id {
		t.Fatal("guest id is not a stable function of the identity")
	}
	// The service holds a mutex (caption spacing), so swap the key in place
	// rather than copying the struct.
	key := s.rt.HMACKey
	s.rt.HMACKey = []byte("another secret")
	other := s.dialInGuestID("sip_c15a31c71649a522")
	s.rt.HMACKey = key
	if other == id {
		t.Fatal("guest id does not depend on the server secret")
	}
	if !isDialInParticipant(db.MeetingParticipant{PrincipalType: PrincipalGuest, GuestID: strText(id)}) ||
		isDialInParticipant(db.MeetingParticipant{PrincipalType: PrincipalGuest, GuestID: strText("01J9GUEST")}) {
		t.Fatal("dial-in participant not told apart")
	}
}
