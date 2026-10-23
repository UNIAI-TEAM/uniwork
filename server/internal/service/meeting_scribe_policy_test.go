package service

import (
	"context"
	"errors"
	"testing"
	"time"
)

func setScribePolicy(t *testing.T, s *MeetingService, ownerID, orgID, policy string) {
	t.Helper()
	if _, err := s.SetMeetingSettings(context.Background(), Human(ownerID), orgID, MeetingSettingsInput{ScribePolicy: &policy}); err != nil {
		t.Fatal(err)
	}
}

// Policy off (UNI-1995 access, #16): an open run is closed and the agent
// removed on the next pass, nothing is dispatched again, the capability
// hides the scribe, and the host can switch it off but not back on.
func TestScribePolicyOffKeepsTheScribeOut(t *testing.T) {
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	available := s.ScribeAvailable(ctx, m.OrganizationID)
	setScribePolicy(t, s, ua.ID, m.OrganizationID, ScribePolicyOff)
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if r := latestRun(t, s, m.ID); r.Status != ScribeFinished {
		t.Fatalf("open run after policy off: %+v", r)
	}
	if _, removals := fake.ScribeCalls(); removals != 1 {
		t.Fatalf("removals %d, want 1", removals)
	}
	if err := s.ensureScribe(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if d, _ := fake.ScribeCalls(); d != 1 {
		t.Fatalf("dispatches %d after policy off, want the first one only", d)
	}
	if s.ScribeAvailable(ctx, m.OrganizationID) {
		t.Fatal("capability still offers the scribe")
	}
	if _, err := s.SetScribe(ctx, ua.ID, m.ID, true); !codedIs(err, "scribe_off_by_policy") {
		t.Fatalf("switch on under policy off: %v, want scribe_off_by_policy", err)
	}
	if _, err := s.SetScribe(ctx, ua.ID, m.ID, false); err != nil {
		t.Fatalf("switch off under policy off: %v", err)
	}
	setScribePolicy(t, s, ua.ID, m.OrganizationID, ScribePolicyOn)
	if s.ScribeAvailable(ctx, m.OrganizationID) != available {
		t.Fatal("policy back on did not restore the capability")
	}
}

// Policy opt_in: meetings created from now on start with the scribe off,
// instant and scheduled alike; the host's switch brings it in.
func TestScribePolicyOptInStartsMeetingsOff(t *testing.T) {
	s, fake, ua, m := scribeFixture(t)
	ctx := context.Background()
	setScribePolicy(t, s, ua.ID, m.OrganizationID, ScribePolicyOptIn)
	if m, err := s.q.GetMeeting(ctx, m.ID); err != nil || m.ScribeOffAt.Valid {
		t.Fatalf("a meeting created before opt_in changed: %+v %v", m.ScribeOffAt, err)
	}
	start := time.Now().Add(time.Hour)
	sched, err := s.Create(ctx, ua.ID, m.WorkspaceID, CreateMeetingInput{Title: "Lên lịch", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil || !sched.ScribeOffAt.Valid {
		t.Fatalf("scheduled under opt_in: %+v %v", sched.ScribeOffAt, err)
	}
	inst, err := s.CreateInstant(ctx, ua.ID, m.WorkspaceID, "Tức thì")
	if err != nil || !inst.ScribeOffAt.Valid {
		t.Fatalf("instant under opt_in: %+v %v", inst.ScribeOffAt, err)
	}
	joinRoom(t, s, inst, ua.ID)
	if err := s.ensureScribe(ctx, inst.ID); err != nil {
		t.Fatal(err)
	}
	if d, _ := fake.ScribeCalls(); d != 0 {
		t.Fatalf("dispatched %d into an opt_in meeting nobody turned on", d)
	}
	if _, err := s.SetScribe(ctx, ua.ID, inst.ID, true); err != nil {
		t.Fatal(err)
	}
	if d, _ := fake.ScribeCalls(); d != 1 {
		t.Fatalf("dispatches %d after the host turned it on", d)
	}
	caps, err := s.Capabilities(ctx, ua.ID, m.WorkspaceID)
	if err != nil || caps.ScribePolicy != ScribePolicyOptIn {
		t.Fatalf("capabilities %+v %v", caps, err)
	}
}

// The settings write takes either field, keeps the other, refuses an empty
// change and an unknown policy, and audits only what changed.
func TestSetMeetingSettingsScribePolicy(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	var ve ValidationError
	if _, err := s.SetMeetingSettings(ctx, Human(ua.ID), w.OrganizationID, MeetingSettingsInput{}); !errors.As(err, &ve) {
		t.Fatalf("empty change: %v", err)
	}
	bad := "sometimes"
	if _, err := s.SetMeetingSettings(ctx, Human(ua.ID), w.OrganizationID, MeetingSettingsInput{ScribePolicy: &bad}); !errors.As(err, &ve) {
		t.Fatalf("unknown policy: %v", err)
	}
	if _, err := s.SetMeetingSettings(ctx, Human(ua.ID), w.OrganizationID, MeetingSettingsInput{AutoSummaryEnabled: new(false)}); err != nil {
		t.Fatal(err)
	}
	setScribePolicy(t, s, ua.ID, w.OrganizationID, ScribePolicyOptIn)
	set, err := s.GetMeetingSettings(ctx, Human(ua.ID), w.OrganizationID)
	if err != nil || set.AutoSummaryEnabled || set.ScribePolicy != ScribePolicyOptIn {
		t.Fatalf("settings %+v %v", set, err)
	}
	var rows int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'meeting.settings_changed'
		AND resource_id = $1 AND changes::jsonb ? 'scribe_policy' AND NOT changes::jsonb ? 'auto_summary_enabled'`, w.OrganizationID).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("scribe_policy audit rows %d %v", rows, err)
	}
}

// UNI-1995 access (#2): the invite page learns whether the scribe would
// transcribe the meeting, so a guest is told before they join; switched off
// for the meeting, or off by the organization's policy, it says no.
func TestResolveInviteLinkSaysWhetherTheScribeListens(t *testing.T) {
	s, _, ua, m := scribeFixture(t)
	ctx := context.Background()
	if !s.ScribeAvailable(ctx, m.OrganizationID) {
		t.Skip("the fixture's plan has no meeting.transcription")
	}
	created, err := s.CreateInviteLink(ctx, ua.ID, m.ID, "ext", LinkAutoAdmit, time.Now().Add(time.Hour), nil)
	if err != nil {
		t.Fatal(err)
	}
	resolve := func() bool {
		t.Helper()
		v, err := s.ResolveInviteLink(ctx, created.Link.ID, created.RawSecret, AdmissionContext{})
		if err != nil {
			t.Fatal(err)
		}
		return v.Scribe
	}
	if !resolve() {
		t.Fatal("scribe on, the page is not told")
	}
	setScribePolicy(t, s, ua.ID, m.OrganizationID, ScribePolicyOff)
	if resolve() {
		t.Fatal("policy off, the page still says the scribe listens")
	}
	setScribePolicy(t, s, ua.ID, m.OrganizationID, ScribePolicyOn)
	if _, err := s.SetScribe(ctx, ua.ID, m.ID, false); err != nil {
		t.Fatal(err)
	}
	if resolve() {
		t.Fatal("switched off for the meeting, the page still says the scribe listens")
	}
}
