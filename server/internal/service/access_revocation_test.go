package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// outboxPayloads returns the payloads written for topic, oldest first. The
// realtime access revoker reads these rows to close sockets (H11).
func outboxPayloads(t *testing.T, pool *pgxpool.Pool, topic string) []map[string]string {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT payload FROM outbox_events WHERE topic = $1 ORDER BY created_at, id`, topic)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []map[string]string
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		p := map[string]string{}
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			t.Fatal(err)
		}
		out = append(out, p)
	}
	return out
}

func roomMemberStatus(t *testing.T, pool *pgxpool.Pool, roomID, userID string) string {
	t.Helper()
	var status string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM chat_room_members WHERE room_id = $1 AND user_id = $2`, roomID, userID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	return status
}

// revocationRooms gives ub a workspace channel and an organization group.
func revocationRooms(t *testing.T) (s *ChatService, pool *pgxpool.Pool, q *db.Queries, ua, ub db.User, w db.Workspace, channel, group string) {
	t.Helper()
	s, _, q, ua, ub, w, pool = chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "kin", Visibility: "private", MemberUserIDs: []string{ub.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	uc := registerVerified(t, q, NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil),
		"chat-c@example.com", "C")
	addOrgMember(t, q, w.OrganizationID, uc.ID)
	g, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "Nhóm", MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatal(err)
	}
	return s, pool, q, ua, ub, w, ch.ID, g.ID
}

func TestKickFromAGroupIsAuditedAndAnnounced(t *testing.T) {
	s, pool, q, ua, ub, w, _, group := revocationRooms(t)
	ctx := context.Background()

	if err := s.RemoveChatRoomMember(ctx, ua.ID, w.ID, group, ub.ID); err != nil {
		t.Fatal(err)
	}

	rows, err := q.ListAuditEvents(ctx, db.ListAuditEventsParams{OrganizationID: w.OrganizationID, LimitN: 100})
	if err != nil {
		t.Fatal(err)
	}
	kicked := false
	for _, r := range rows {
		if r.Action == audit.ActionChatRoomMemberRemoved && r.ResourceID == group && r.ActorID == ua.ID {
			var meta map[string]any
			_ = json.Unmarshal([]byte(r.Metadata), &meta)
			kicked = meta["member_id"] == ub.ID && meta["self_service"] == false
		}
	}
	if !kicked {
		t.Fatal("the kick left no chat.room.member_removed audit row naming the member")
	}
	events := outboxPayloads(t, pool, "chat.room.member_removed")
	if len(events) != 1 || events[0]["room_id"] != group || events[0]["user_id"] != ub.ID {
		t.Fatalf("chat.room.member_removed events = %v", events)
	}
	if roomMemberStatus(t, pool, group, ub.ID) != "left" {
		t.Fatal("kicked member is still in the group")
	}
}

func TestRemovingAWorkspaceMemberLeavesItsRoomsButNotTheOrganizationsGroups(t *testing.T) {
	s, pool, _, ua, ub, w, channel, group := revocationRooms(t)

	if err := s.ws.RemoveMember(context.Background(), ua.ID, w.ID, ub.ID); err != nil {
		t.Fatal(err)
	}
	if got := roomMemberStatus(t, pool, channel, ub.ID); got != "left" {
		t.Fatalf("workspace channel membership = %q, want left", got)
	}
	// Groups belong to the organization, which the person still belongs to.
	if got := roomMemberStatus(t, pool, group, ub.ID); got == "left" {
		t.Fatal("organization group membership was ended too")
	}
}

func TestLeavingOrBeingDeactivatedLeavesEveryRoomInTheOrganization(t *testing.T) {
	for _, how := range []string{"deactivate", "leave"} {
		t.Run(how, func(t *testing.T) {
			s, pool, q, ua, ub, w, channel, group := revocationRooms(t)
			ctx := context.Background()
			members := NewOrganizationMemberService(pool, q, s.ws.orgs)
			members.SetMail(mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
			var err error
			if how == "deactivate" {
				_, err = members.Deactivate(ctx, ua.ID, w.OrganizationID, ub.ID)
			} else {
				err = members.Leave(ctx, ub.ID, w.OrganizationID)
			}
			if err != nil {
				t.Fatal(err)
			}
			for _, room := range []string{channel, group} {
				if got := roomMemberStatus(t, pool, room, ub.ID); got != "left" {
					t.Fatalf("room %s membership = %q, want left", room, got)
				}
			}
		})
	}
}

func TestEndingASessionAnnouncesWhichOneToDisconnect(t *testing.T) {
	desk, as := newDesktopTestServices(t)
	ctx := context.Background()
	userID, device := desktopTestSession(t, desk, as, "revoke-sessions@example.com")
	u, err := desk.q.GetUserByID(ctx, userID)
	if err != nil {
		t.Fatal(err)
	}
	web1, err := as.SessionFor(ctx, u)
	if err != nil {
		t.Fatal(err)
	}
	web2, err := as.SessionFor(ctx, u)
	if err != nil {
		t.Fatal(err)
	}

	if err := as.Logout(ctx, web1.RefreshToken); err != nil {
		t.Fatal(err)
	}
	if err := as.RevokeSession(ctx, userID, web2.SessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := as.RevokeOtherSessions(ctx, userID, "none-kept"); err != nil {
		t.Fatal(err)
	}
	if err := desk.Logout(ctx, userID, device.DeviceSessionID, device.DeploymentID, "device"); err != nil {
		t.Fatal(err)
	}
	if err := desk.RevokeAll(ctx, userID); err != nil {
		t.Fatal(err)
	}

	got := outboxPayloads(t, desk.pool, "session.revoked")
	// RevokeOtherSessions ends sessions it cannot name, so it closes every
	// socket; the caller's own reconnects after refreshing.
	want := []string{web1.SessionID, web2.SessionID, "", device.DeviceSessionID, ""}
	if len(got) != len(want) {
		t.Fatalf("session.revoked events = %v, want sessions %q", got, want)
	}
	for i, sid := range want {
		if got[i]["user_id"] != userID || got[i]["session_id"] != sid {
			t.Fatalf("event %d = %v, want session %q", i, got[i], sid)
		}
	}
}
