package handler

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// findMotion returns the motion with this id from a GET /motions body.
func findMotion(t *testing.T, out map[string]any, id string) map[string]any {
	t.Helper()
	list, _ := out["motions"].([]any)
	for _, raw := range list {
		if m, _ := raw.(map[string]any); m["id"] == id {
			return m
		}
	}
	t.Fatalf("motion %s not in %v", id, out)
	return nil
}

// payloadOf reads a timeline row's payload; nil when the key is absent.
func payloadOf(row map[string]any) map[string]any {
	p, _ := row["payload"].(map[string]any)
	return p
}

// seedMotionGuest puts an active guest (OBSERVER, as every guest starts) in
// the meeting the way an invite link would, since a handler test has no
// room to join; it returns the guest's session header and participant id.
func seedMotionGuest(t *testing.T, q *db.Queries, meetingID, name string) (map[string]string, string) {
	t.Helper()
	ctx := context.Background()
	guestID := util.NewID()
	if _, err := q.CreateMeetingGuest(ctx, guestID); err != nil {
		t.Fatal(err)
	}
	pid := util.NewID()
	if _, err := q.CreateMeetingParticipant(ctx, db.CreateMeetingParticipantParams{
		ID: pid, MeetingID: meetingID, PrincipalType: service.PrincipalGuest,
		GuestID: pgtype.Text{String: guestID, Valid: true}, DisplayNameSnapshot: name,
		Role: service.RoleAttendee, SourceType: service.GrantInviteLink,
		SourceID: pgtype.Text{String: "link", Valid: true}, AddedBy: guestID,
	}); err != nil {
		t.Fatal(err)
	}
	return map[string]string{meetings.GuestSessionHeader: meetings.SignGuestCookie(guestID, []byte("test"))}, pid
}

func TestMotionsHTTPFlow(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "mot-host@example.com", "password": "password123", "display_name": "Host",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)
	_, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Org", "slug": "mot-org"})
	orgID := out["organization"].(map[string]any)["id"].(string)
	_, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "WS", "slug": "mot-ws"})
	wsID := out["workspace"].(map[string]any)["id"].(string)
	_, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/meetings/instant", token, map[string]string{"title": "Họp hội đồng"})
	meetingID := out["meeting"].(map[string]any)["id"].(string)
	meetingPath := "/api/v1/meetings/" + meetingID

	_, out = doJSON(t, srv, "GET", meetingPath+"/attendance", token, nil)
	hostPID := out["rows"].([]any)[0].(map[string]any)["participant_id"].(string)

	// Drafting. The enum tags on the SDI are docs only; the service rejects.
	res, out = doJSON(t, srv, "POST", meetingPath+"/motions", token, map[string]string{
		"title": "Thông qua kế hoạch quý IV", "ballot_mode": "OPEN_HANDS", "threshold": "MAJORITY", "base": "PRESENT",
	})
	if res.StatusCode != http.StatusBadRequest || errorCode(out) != "invalid_request" {
		t.Fatalf("bad enum: %d %v", res.StatusCode, out)
	}
	// Length is counted in runes by the service; 201 Vietnamese letters are refused over HTTP too.
	res, out = doJSON(t, srv, "POST", meetingPath+"/motions", token, map[string]string{
		"title": strings.Repeat("đ", 201), "ballot_mode": "PUBLIC", "threshold": "MAJORITY", "base": "PRESENT",
	})
	if res.StatusCode != http.StatusBadRequest || errorCode(out) != "invalid_request" {
		t.Fatalf("201-rune title: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", meetingPath+"/motions", token, map[string]string{
		"title": "Thông qua kế hoạch quý IV", "description": "", "ballot_mode": "PUBLIC", "threshold": "MAJORITY", "base": "PRESENT",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create: %d %v", res.StatusCode, out)
	}
	first := out["motion"].(map[string]any)
	firstID := first["id"].(string)
	if first["status"] != "DRAFT" || first["position"].(float64) != 1 || first["cast_count"].(float64) != 0 {
		t.Fatalf("created motion = %v", first)
	}
	for _, key := range []string{"result", "voters", "roll_size", "total_members"} {
		if v, ok := first[key]; !ok || v != nil {
			t.Fatalf("%s must be null on a draft: %v", key, first)
		}
	}
	res, out = doJSON(t, srv, "POST", meetingPath+"/motions", token, map[string]string{
		"title": "Bầu thư ký", "ballot_mode": "SECRET", "threshold": "TWO_THIRDS", "base": "ALL_MEMBERS",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create second: %d %v", res.StatusCode, out)
	}
	secondID := out["motion"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "PATCH", meetingPath+"/motions/"+firstID, token, map[string]any{"threshold": "THREE_QUARTERS"})
	if res.StatusCode != http.StatusBadRequest || errorCode(out) != "invalid_request" {
		t.Fatalf("patch bad enum: %d %v", res.StatusCode, out)
	}
	const title = "Thông qua kế hoạch quý IV/2026"
	res, out = doJSON(t, srv, "PATCH", meetingPath+"/motions/"+firstID, token, map[string]any{"title": title})
	if res.StatusCode != http.StatusOK || out["motion"].(map[string]any)["title"] != title {
		t.Fatalf("patch title: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "PATCH", meetingPath+"/motions/"+secondID, token, map[string]any{"position": 1})
	if res.StatusCode != http.StatusOK || out["motion"].(map[string]any)["position"].(float64) != 1 {
		t.Fatalf("patch position: %d %v", res.StatusCode, out)
	}

	// The roll: the host and a guest the host made a member, both present.
	q := db.New(testPool)
	guest, guestPID := seedMotionGuest(t, q, meetingID, "Guest")
	res, out = doJSON(t, srv, "PATCH", meetingPath+"/participants/"+guestPID, token, map[string]any{"standing": "MEMBER"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("guest standing: %d %v", res.StatusCode, out)
	}
	for _, pid := range []string{hostPID, guestPID} {
		res, out = doJSON(t, srv, "PUT", meetingPath+"/attendance/"+pid, token, map[string]string{"status": "PRESENT"})
		if res.StatusCode != http.StatusOK {
			t.Fatalf("mark %s: %d %v", pid, res.StatusCode, out)
		}
	}

	// Opening snapshots the roll; only one item may be open at a time.
	res, out = doJSON(t, srv, "POST", meetingPath+"/motions/"+firstID+"/open", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("open: %d %v", res.StatusCode, out)
	}
	opened := out["motion"].(map[string]any)
	if opened["status"] != "OPEN" || opened["roll_size"].(float64) != 2 || opened["total_members"].(float64) != 2 {
		t.Fatalf("opened motion = %v", opened)
	}
	if s, _ := opened["opened_at"].(string); s == "" {
		t.Fatalf("opened_at missing: %v", opened)
	}
	res, out = doJSON(t, srv, "POST", meetingPath+"/motions/"+secondID+"/open", token, nil)
	if res.StatusCode != http.StatusConflict || errorCode(out) != "motion_already_open" {
		t.Fatalf("second open: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "PATCH", meetingPath+"/motions/"+firstID, token, map[string]any{"title": "Đổi khi đang mở"})
	if res.StatusCode != http.StatusConflict || errorCode(out) != "motion_not_draft" {
		t.Fatalf("patch open motion: %d %v", res.StatusCode, out)
	}

	// Reading: no principal is 401; a guest sees no drafts and no tally.
	res, out = doJSON(t, srv, "GET", meetingPath+"/motions", "", nil)
	if res.StatusCode != http.StatusUnauthorized || errorCode(out) != "unauthorized" {
		t.Fatalf("anonymous motions: %d %v", res.StatusCode, out)
	}
	res, _ = doJSONHeaders(t, srv, "GET", meetingPath+"/motions", "", map[string]string{meetings.GuestSessionHeader: "tampered.signature"}, nil)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("tampered guest session: %d", res.StatusCode)
	}
	res, out = doJSONHeaders(t, srv, "GET", meetingPath+"/motions", "", guest, nil)
	if res.StatusCode != http.StatusOK || len(out["motions"].([]any)) != 1 {
		t.Fatalf("guest motions: %d %v", res.StatusCode, out)
	}
	seen := findMotion(t, out, firstID)
	if v, ok := seen["result"]; !ok || v != nil || seen["cast_count"].(float64) != 0 {
		t.Fatalf("guest sees an open motion as %v", seen)
	}
	mine := seen["my_ballot"].(map[string]any)
	if mine["on_roll"] != true || mine["cast"] != false || mine["choice"] != nil {
		t.Fatalf("guest my_ballot = %v", mine)
	}

	// Voting: the guest through X-Guest-Session, the host through the token.
	ballotPath := meetingPath + "/motions/" + firstID + "/ballot"
	res, out = doJSON(t, srv, "POST", ballotPath, "", map[string]string{"choice": "YES"})
	if res.StatusCode != http.StatusUnauthorized || errorCode(out) != "unauthorized" {
		t.Fatalf("anonymous ballot: %d %v", res.StatusCode, out)
	}
	res, out = doJSONHeaders(t, srv, "POST", ballotPath, "", guest, map[string]string{"choice": "MAYBE"})
	if res.StatusCode != http.StatusBadRequest || errorCode(out) != "invalid_request" {
		t.Fatalf("bad choice: %d %v", res.StatusCode, out)
	}
	res, out = doJSONHeaders(t, srv, "POST", ballotPath, "", guest, map[string]string{"choice": "YES"})
	if res.StatusCode != http.StatusOK || out["status"] != "ok" {
		t.Fatalf("guest ballot: %d %v", res.StatusCode, out)
	}
	res, out = doJSONHeaders(t, srv, "POST", ballotPath, "", guest, map[string]string{"choice": "NO"})
	if res.StatusCode != http.StatusConflict || errorCode(out) != "already_voted" {
		t.Fatalf("second guest ballot: %d %v", res.StatusCode, out)
	}
	// A guest who joined after the roll was taken (and is still an observer)
	// is in the room but not on the roll.
	late, _ := seedMotionGuest(t, q, meetingID, "Late guest")
	res, out = doJSONHeaders(t, srv, "POST", ballotPath, "", late, map[string]string{"choice": "YES"})
	if res.StatusCode != http.StatusForbidden || errorCode(out) != "not_on_roll" {
		t.Fatalf("off-roll ballot: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", ballotPath, token, map[string]string{"choice": "YES"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("host ballot: %d %v", res.StatusCode, out)
	}
	_, out = doJSON(t, srv, "GET", meetingPath+"/motions", token, nil)
	if len(out["motions"].([]any)) != 2 {
		t.Fatalf("clerk must see the draft too: %v", out)
	}
	hostView := findMotion(t, out, firstID)
	if v, ok := hostView["result"]; !ok || v != nil || hostView["cast_count"].(float64) != 2 {
		t.Fatalf("host sees an open motion as %v", hostView)
	}
	if b := hostView["my_ballot"].(map[string]any); b["cast"] != true || b["choice"] != "YES" {
		t.Fatalf("host my_ballot = %v", b)
	}

	// Closing counts once and for all.
	res, out = doJSON(t, srv, "POST", meetingPath+"/motions/"+firstID+"/close", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("close: %d %v", res.StatusCode, out)
	}
	closed := out["motion"].(map[string]any)
	if closed["status"] != "CLOSED" {
		t.Fatalf("closed motion = %v", closed)
	}
	if s, _ := closed["closed_at"].(string); s == "" {
		t.Fatalf("closed_at missing: %v", closed)
	}
	result, _ := closed["result"].(map[string]any)
	if result == nil || result["yes"].(float64) != 2 || result["no"].(float64) != 0 || result["abstain"].(float64) != 0 ||
		result["required"].(float64) != 2 || result["outcome"] != "PASSED" {
		t.Fatalf("result = %v", closed["result"])
	}
	res, out = doJSON(t, srv, "POST", ballotPath, token, map[string]string{"choice": "NO"})
	if res.StatusCode != http.StatusConflict || errorCode(out) != "motion_not_open" {
		t.Fatalf("ballot after close: %d %v", res.StatusCode, out)
	}
	_, out = doJSON(t, srv, "GET", meetingPath+"/motions", token, nil)
	voters, _ := findMotion(t, out, firstID)["voters"].(map[string]any)
	if voters == nil || len(voters["yes"].([]any)) != 2 {
		t.Fatalf("voters = %v", voters)
	}
	if no, ok := voters["no"].([]any); !ok || len(no) != 0 {
		t.Fatalf("an empty choice must be [], got %v", voters["no"])
	}

	res, out = doJSON(t, srv, "DELETE", meetingPath+"/motions/"+firstID, token, nil)
	if res.StatusCode != http.StatusConflict || errorCode(out) != "motion_not_draft" {
		t.Fatalf("delete closed: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "DELETE", meetingPath+"/motions/"+secondID, token, nil)
	if res.StatusCode != http.StatusOK || out["status"] != "ok" {
		t.Fatalf("delete draft: %d %v", res.StatusCode, out)
	}

	// Timeline: payload reaches the client only on the two motion rows.
	res, out = doJSON(t, srv, "GET", meetingPath+"/activity", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("activity: %d %v", res.StatusCode, out)
	}
	var openedRow, closedRow map[string]any
	for _, raw := range out["activity"].([]any) {
		row := raw.(map[string]any)
		switch row["event_type"] {
		case "MOTION_OPENED":
			openedRow = row
		case "MOTION_CLOSED":
			closedRow = row
		default:
			if _, ok := row["payload"]; ok {
				t.Fatalf("payload leaked on %v", row)
			}
		}
	}
	if openedRow == nil || payloadOf(openedRow)["title"] != title ||
		openedRow["from_state"] != "DRAFT" || openedRow["to_state"] != "OPEN" {
		t.Fatalf("MOTION_OPENED row = %v", openedRow)
	}
	if closedRow == nil || payloadOf(closedRow)["title"] != title || payloadOf(closedRow)["outcome"] != "PASSED" ||
		closedRow["from_state"] != "OPEN" || closedRow["to_state"] != "PASSED" {
		t.Fatalf("MOTION_CLOSED row = %v", closedRow)
	}
}
