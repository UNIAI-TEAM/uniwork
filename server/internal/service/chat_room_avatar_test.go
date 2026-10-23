package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type groupAvatarFix struct {
	s          *ChatService
	pub        *capturePublisher
	q          *db.Queries
	pool       *pgxpool.Pool
	as         *AuthService
	ua, ub, uc db.User
	w          db.Workspace
	group      ChatRoomSummary
}

// groupAvatarFixture is a group of three that ua created, with FileService faked.
func groupAvatarFixture(t *testing.T) groupAvatarFix {
	t.Helper()
	s, pub, q, ua, ub, w, pool := chatFixtureWithPool(t)
	s.SetFiles(filesfake.New(filesfake.Options{}))
	ctx := context.Background()
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, q, as, "chat-avatar-c@example.com", "C")
	for _, u := range []db.User{ub, uc} {
		addOrgMember(t, q, w.OrganizationID, u.ID)
		addWorkspaceMember(t, q, w.ID, u.ID)
	}
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "Nhóm ảnh", MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatal(err)
	}
	return groupAvatarFix{s: s, pub: pub, q: q, pool: pool, as: as, ua: ua, ub: ub, uc: uc, w: w, group: group}
}

// groupAvatarAudits returns the avatar diffs recorded on the room, oldest first.
func groupAvatarAudits(t *testing.T, f groupAvatarFix) []map[string]any {
	t.Helper()
	rows, err := f.pool.Query(context.Background(),
		`SELECT changes FROM audit_events WHERE action = 'chat.room.settings_updated' AND resource_id = $1 ORDER BY occurred_at, id`, f.group.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var changes map[string]map[string]any
		if err := json.Unmarshal([]byte(raw), &changes); err != nil {
			t.Fatal(err)
		}
		out = append(out, changes["avatar"])
	}
	return out
}

func TestChatRoomAvatarUploadReplaceAndRemove(t *testing.T) {
	f := groupAvatarFixture(t)
	ctx := context.Background()

	first, err := f.s.UploadRoomAvatar(ctx, f.ua.ID, f.w.ID, f.group.ID, "nhom.png", bytes.NewReader(workspaceIconPNG))
	if err != nil {
		t.Fatal(err)
	}
	room, err := f.q.GetChatRoomByID(ctx, f.group.ID)
	if err != nil || !room.AvatarFileID.Valid {
		t.Fatalf("room after upload: %+v err=%v", room, err)
	}
	firstID := files.FileID(room.AvatarFileID.String)
	if first.AvatarURL != "fake://presign/"+string(firstID) {
		t.Fatalf("avatar url = %q", first.AvatarURL)
	}
	if countEvents(f.pub.events, "chat.room.updated") == 0 {
		t.Fatalf("no chat.room.updated after the upload: %+v", f.pub.events)
	}

	// Every member's sidebar carries it.
	rooms, err := f.s.ListChatRooms(ctx, f.ub.ID, f.w.ID)
	if err != nil {
		t.Fatal(err)
	}
	var listed string
	for _, r := range rooms {
		if r.ID == f.group.ID {
			listed = r.AvatarURL
		}
	}
	if listed != first.AvatarURL {
		t.Fatalf("sidebar avatar = %q, want %q", listed, first.AvatarURL)
	}

	if _, err := f.s.UploadRoomAvatar(ctx, f.ua.ID, f.w.ID, f.group.ID, "nhom2.png", bytes.NewReader(workspaceIconPNG)); err != nil {
		t.Fatal(err)
	}
	room, _ = f.q.GetChatRoomByID(ctx, f.group.ID)
	secondID := files.FileID(room.AvatarFileID.String)
	held, err := ChatRoomAvatarProvider{}.HeldBy(ctx, f.q, []files.FileID{firstID, secondID})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := held[firstID]; ok || len(held) != 1 {
		t.Fatalf("held = %v, want only the current avatar %s", held, secondID)
	}

	removed, err := f.s.RemoveRoomAvatar(ctx, f.ua.ID, f.w.ID, f.group.ID)
	if err != nil {
		t.Fatal(err)
	}
	if removed.AvatarURL != "" {
		t.Fatalf("avatar url after remove = %q", removed.AvatarURL)
	}
	if held, _ := (ChatRoomAvatarProvider{}).HeldBy(ctx, f.q, []files.FileID{secondID}); len(held) != 0 {
		t.Fatalf("removed avatar still held: %v", held)
	}
	// Removing nothing records nothing.
	if _, err := f.s.RemoveRoomAvatar(ctx, f.ua.ID, f.w.ID, f.group.ID); err != nil {
		t.Fatal(err)
	}

	got := groupAvatarAudits(t, f)
	want := []map[string]any{
		{"from": "", "to": "file:" + string(firstID)},
		{"from": "file:" + string(firstID), "to": "file:" + string(secondID)},
		{"from": "file:" + string(secondID), "to": ""},
	}
	if len(got) != len(want) {
		t.Fatalf("avatar audit rows = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i]["from"] != want[i]["from"] || got[i]["to"] != want[i]["to"] {
			t.Fatalf("audit %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

// The avatar follows the rename rule: any member while allow_change_profile
// is on, only the group's moderators once it is off.
func TestChatRoomAvatarFollowsTheRenameRule(t *testing.T) {
	f := groupAvatarFixture(t)
	ctx := context.Background()

	if _, err := f.s.UploadRoomAvatar(ctx, f.ub.ID, f.w.ID, f.group.ID, "b.png", bytes.NewReader(workspaceIconPNG)); err != nil {
		t.Fatalf("member upload with the flag on: %v", err)
	}
	locked := defaultChatRoomMemberPermissions()
	locked.AllowChangeProfile = false
	if _, err := f.s.UpdateChatRoomSettings(ctx, f.ua.ID, f.w.ID, f.group.ID, UpdateChatRoomSettingsInput{MemberPermissions: &locked}); err != nil {
		t.Fatal(err)
	}
	before, _ := f.q.GetChatRoomByID(ctx, f.group.ID)
	if _, err := f.s.UploadRoomAvatar(ctx, f.ub.ID, f.w.ID, f.group.ID, "b2.png", bytes.NewReader(workspaceIconPNG)); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member upload with the flag off: err=%v, want ErrForbidden", err)
	}
	if _, err := f.s.RemoveRoomAvatar(ctx, f.ub.ID, f.w.ID, f.group.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member remove with the flag off: err=%v, want ErrForbidden", err)
	}
	if after, _ := f.q.GetChatRoomByID(ctx, f.group.ID); after.AvatarFileID != before.AvatarFileID {
		t.Fatalf("a refused request changed the avatar: %v -> %v", before.AvatarFileID, after.AvatarFileID)
	}
	if _, err := f.s.RemoveRoomAvatar(ctx, f.ua.ID, f.w.ID, f.group.ID); err != nil {
		t.Fatalf("creator remove with the flag off: %v", err)
	}
}

func TestChatRoomAvatarOnlyForGroups(t *testing.T) {
	f := groupAvatarFixture(t)
	ctx := context.Background()

	dm, err := f.s.ResolveDM(ctx, f.ua.ID, f.w.ID, f.ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	ch, err := f.s.CreateChannel(ctx, f.ua.ID, f.w.ID, CreateChannelInput{Name: "anh", Visibility: chatVisibilityPrivate})
	if err != nil {
		t.Fatal(err)
	}
	for _, roomID := range []string{dm.ID, ch.ID} {
		_, err := f.s.UploadRoomAvatar(ctx, f.ua.ID, f.w.ID, roomID, "x.png", bytes.NewReader(workspaceIconPNG))
		requireValidationError(t, err, "avatar upload outside a group")
		_, err = f.s.RemoveRoomAvatar(ctx, f.ua.ID, f.w.ID, roomID)
		requireValidationError(t, err, "avatar remove outside a group")
	}
}

// Another organization's owner cannot reach the group, through their own
// workspace or through the group's.
func TestChatRoomAvatarStaysInItsOrganization(t *testing.T) {
	f := groupAvatarFixture(t)
	ctx := context.Background()
	ux := registerVerified(t, f.q, f.as, "chat-avatar-x@example.com", "X")
	orgB, err := f.s.ws.orgs.Create(ctx, ux.ID, "Org B", "org-avatar-b")
	if err != nil {
		t.Fatal(err)
	}
	wsB, err := f.s.ws.CreateInOrg(ctx, ux.ID, orgB.ID, "B WS", "b-avatar-ws")
	if err != nil {
		t.Fatal(err)
	}
	for _, wsID := range []string{wsB.ID, f.w.ID} {
		_, err := f.s.UploadRoomAvatar(ctx, ux.ID, wsID, f.group.ID, "x.png", bytes.NewReader(workspaceIconPNG))
		if !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrForbidden) {
			t.Fatalf("upload from another organization via %s: err=%v", wsID, err)
		}
		if _, err := f.s.RemoveRoomAvatar(ctx, ux.ID, wsID, f.group.ID); !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrForbidden) {
			t.Fatalf("remove from another organization via %s: err=%v", wsID, err)
		}
	}
	if room, _ := f.q.GetChatRoomByID(ctx, f.group.ID); room.AvatarFileID.Valid {
		t.Fatalf("an outsider set the avatar: %v", room.AvatarFileID)
	}
}
