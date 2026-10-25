package service

import (
	"context"
	"net/http"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The organization's AI scribe policy (meeting_settings.scribe_policy,
// UNI-1995 access): an organization owner/admin decides whether the scribe
// joins its meetings at all, and whether a meeting starts with it on.
const (
	// ScribePolicyOn: every meeting has the scribe unless its host switches
	// it off (the default, and the behaviour before the policy).
	ScribePolicyOn = "on"
	// ScribePolicyOptIn: a new meeting starts with the scribe off (createdScribeOff);
	// its host turns it on when scheduling or in the room.
	ScribePolicyOptIn = "opt_in"
	// ScribePolicyOff: the scribe is never dispatched, and SetScribe refuses to switch it on.
	ScribePolicyOff = "off"
)

func validScribePolicy(p string) bool {
	return p == ScribePolicyOn || p == ScribePolicyOptIn || p == ScribePolicyOff
}

// scribePolicy is the organization's policy; no settings row is on.
func scribePolicy(ctx context.Context, q *db.Queries, orgID string) (string, error) {
	set, err := meetingSettings(ctx, q, orgID)
	return set.ScribePolicy, err
}

func errScribeOffByPolicy() error {
	return coded(http.StatusConflict, "scribe_off_by_policy", "tổ chức đã tắt thư ký AI cho mọi cuộc họp")
}

// createdScribeOff switches the scribe off for a meeting just created when
// the organization's policy is opt_in and the creator did not ask for it,
// inside the creating transaction. Off stays as it is: dispatch reads the
// policy itself, so a later switch back to on needs no rewrite.
func (s *MeetingService) createdScribeOff(ctx context.Context, q *db.Queries, m db.Meeting, userID string) (db.Meeting, error) {
	p, err := scribePolicy(ctx, q, m.OrganizationID)
	if err != nil || p != ScribePolicyOptIn {
		return m, err
	}
	return q.SetMeetingScribeOff(ctx, db.SetMeetingScribeOffParams{ID: m.ID, Off: true, By: userID})
}
