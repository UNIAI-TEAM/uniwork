package service

import (
	"context"
	"errors"
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

// sipJoin is the webhook a caller's entry produces: kind SIP, LiveKit's
// hashed identity, the masked name and the rule that routed the call.
func sipJoin(m db.Meeting, typ, identity, sid string) ProviderNeutralEvent {
	return ProviderNeutralEvent{
		Type: typ, RoomName: meetings.RoomNameForMeeting(m.ID), Identity: identity,
		ProviderEventID: typ + sid, ParticipantSID: sid, OccurredAt: time.Now().UTC(),
		ParticipantKind: ParticipantKindSIP, ParticipantName: "Phone 1234", SIPRuleID: m.SipDispatchRuleID.String,
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

func TestDialInCallerWaitsInTheLobbyUntilAdmitted(t *testing.T) {
	s, fake, ua, _, m := dialInFixture(t)
	ctx := context.Background()
	m = reloadMeeting(t, s, m.ID)
	const caller = "sip_c15a31c71649a522"
	ev := sipJoin(m, "conference.participant_joined", caller, "PA_1")
	s.HoldDialInCaller(ctx, ev)
	held := lastUpdateFor(t, fake, caller)
	if held.Permissions != (meetings.MediaPermissions{}) || held.Name != "Điện thoại ••• 1234" || held.Attributes[dialInStateAttr] != "waiting" {
		t.Fatalf("hold = %+v", held)
	}
	if err := s.HandleProviderEvent(ctx, ev); err != nil {
		t.Fatal(err)
	}
	jr, err := s.q.GetPendingJoinRequestForGuest(ctx, db.GetPendingJoinRequestForGuestParams{MeetingID: m.ID, RequesterGuestID: strText(caller)})
	if err != nil || jr.DisplayNameSnapshot != "Điện thoại ••• 1234" {
		t.Fatalf("join request %+v err=%v", jr, err)
	}
	if _, removed := fake.Snapshot(); len(removed) != 0 {
		t.Fatalf("a waiting caller was hung up: %v", removed)
	}
	if err := s.ApproveJoinRequest(ctx, ua.ID, jr.ID); err != nil {
		t.Fatal(err)
	}
	admitted := lastUpdateFor(t, fake, caller)
	if !admitted.Permissions.CanSubscribe || !admitted.Permissions.CanPublish || admitted.Attributes[dialInStateAttr] != "admitted" {
		t.Fatalf("admit = %+v", admitted)
	}
	p, err := s.q.GetGuestParticipantAnyStatus(ctx, db.GetGuestParticipantAnyStatusParams{MeetingID: m.ID, GuestID: strText(caller)})
	if err != nil || p.Standing != StandingObserver {
		t.Fatalf("participant %+v err=%v", p, err)
	}
	if in, _ := s.q.DialInCallerAdmitted(ctx, db.DialInCallerAdmittedParams{MeetingID: m.ID, GuestID: strText(caller)}); !in {
		t.Fatal("admission opened no room session")
	}
	// A redelivered join does not mute the admitted caller again.
	before, _ := fake.Snapshot()
	s.HoldDialInCaller(ctx, ev)
	if after, _ := fake.Snapshot(); len(after) != len(before) {
		t.Fatal("an admitted caller was held again")
	}
	if err := s.HandleProviderEvent(ctx, sipJoin(m, "conference.participant_left", caller, "PA_1")); err != nil {
		t.Fatal(err)
	}
	if in, _ := s.q.DialInCallerAdmitted(ctx, db.DialInCallerAdmittedParams{MeetingID: m.ID, GuestID: strText(caller)}); in {
		t.Fatal("hanging up left the room session open")
	}
	// The host removes the caller: the call is dropped by its own identity.
	if err := s.RemoveParticipant(ctx, ua.ID, m.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	var identity string
	if err := s.pool.QueryRow(ctx, `SELECT payload::jsonb->>'identity' FROM outbox_events WHERE topic = 'provider.remove_participant' ORDER BY created_at DESC LIMIT 1`).Scan(&identity); err != nil || identity != caller {
		t.Fatalf("removal targets %q err=%v", identity, err)
	}
}

func TestDialInCallerRefusedOrGoneLeavesNoOneWaiting(t *testing.T) {
	s, fake, ua, _, m := dialInFixture(t)
	ctx := context.Background()
	m = reloadMeeting(t, s, m.ID)
	// Rejected: the call is dropped.
	ev := sipJoin(m, "conference.participant_joined", "sip_aaaa", "PA_a")
	if err := s.HandleProviderEvent(ctx, ev); err != nil {
		t.Fatal(err)
	}
	jr, err := s.q.GetPendingJoinRequestForGuest(ctx, db.GetPendingJoinRequestForGuestParams{MeetingID: m.ID, RequesterGuestID: strText("sip_aaaa")})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.RejectJoinRequest(ctx, ua.ID, jr.ID, ""); err != nil {
		t.Fatal(err)
	}
	if _, removed := fake.Snapshot(); len(removed) != 1 || removed[0].Identity != "sip_aaaa" {
		t.Fatalf("removed = %v", removed)
	}
	// Hung up while waiting: the request leaves the host's queue.
	if err := s.HandleProviderEvent(ctx, sipJoin(m, "conference.participant_joined", "sip_bbbb", "PA_b")); err != nil {
		t.Fatal(err)
	}
	if err := s.HandleProviderEvent(ctx, sipJoin(m, "conference.participant_left", "sip_bbbb", "PA_b")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.GetPendingJoinRequestForGuest(ctx, db.GetPendingJoinRequestForGuestParams{MeetingID: m.ID, RequesterGuestID: strText("sip_bbbb")}); err == nil {
		t.Fatal("a caller who hung up is still waiting")
	}
	// Routed by a rule that is not the meeting's: dropped, nothing filed.
	stray := sipJoin(m, "conference.participant_joined", "sip_cccc", "PA_c")
	stray.SIPRuleID = "SDR_other"
	if err := s.HandleProviderEvent(ctx, stray); err != nil {
		t.Fatal(err)
	}
	if _, err := s.q.GetPendingJoinRequestForGuest(ctx, db.GetPendingJoinRequestForGuestParams{MeetingID: m.ID, RequesterGuestID: strText("sip_cccc")}); err == nil {
		t.Fatal("a stray caller was queued")
	}
	if _, removed := fake.Snapshot(); len(removed) != 2 || removed[1].Identity != "sip_cccc" {
		t.Fatalf("removed = %v", removed)
	}
	// After the end a stale rule may still dial someone in: dropped too.
	if _, err := s.End(ctx, ua.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.HandleProviderEvent(ctx, sipJoin(m, "conference.participant_joined", "sip_dddd", "PA_d")); err != nil {
		t.Fatal(err)
	}
	if _, removed := fake.Snapshot(); len(removed) != 3 || removed[2].Identity != "sip_dddd" {
		t.Fatalf("removed = %v", removed)
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

// Removal, mute and the scribe's speaker lookup all name a caller by the
// room identity LiveKit gave them, which is their guest id.
func TestProviderIdentityOfACallerIsTheirGuestID(t *testing.T) {
	caller := db.MeetingParticipant{ID: "p1", PrincipalType: PrincipalGuest, GuestID: strText("sip_c15a31c71649a522")}
	guest := db.MeetingParticipant{ID: "p2", PrincipalType: PrincipalGuest, GuestID: strText("01J9GUEST")}
	user := db.MeetingParticipant{ID: "p3", PrincipalType: PrincipalUser, UserID: strText("u1")}
	if got := providerIdentity(caller); got != "sip_c15a31c71649a522" {
		t.Fatalf("caller = %q", got)
	}
	if got := providerIdentity(guest); got != "uw_participant_p2" {
		t.Fatalf("guest = %q", got)
	}
	if got := providerIdentity(user); got != "uw_participant_p3" {
		t.Fatalf("user = %q", got)
	}
}
