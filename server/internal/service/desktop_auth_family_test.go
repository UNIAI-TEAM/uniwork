package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A device-scope logout (and the owner's revoke) of the last live device
// session of a family closes the family's refresh token too; while a sibling
// device session is still live the token stays.
func TestDesktopDeviceLogoutClosesFamilyTokenWithLastSession(t *testing.T) {
	ctx := context.Background()
	svc, authSvc := newDesktopTestServices(t)
	owner, sess := desktopTestSession(t, svc, authSvc, "desktop-last-session@example.com")
	sibling, err := svc.q.CreateDeviceSession(ctx, db.CreateDeviceSessionParams{
		ID: util.NewID(), UserID: owner, SessionFamilyID: sess.SessionID, ClientID: "uniwork-office",
		DeploymentID: "default", DeviceLabel: "Sibling", Platform: "windows", Build: "1.0",
		RefreshTokenDigest: hashToken("sibling-token"),
		ExpiresAt:          pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
		CreatedByKind:      "human",
	})
	if err != nil {
		t.Fatal(err)
	}
	liveTokens := func() int {
		t.Helper()
		rows, err := svc.q.ListActiveSessionsForUser(ctx, owner)
		if err != nil {
			t.Fatal(err)
		}
		n := 0
		for _, r := range rows {
			if r.SessionID == sess.SessionID {
				n++
			}
		}
		return n
	}

	if err := svc.Logout(ctx, owner, sess.DeviceSessionID, "default", "device"); err != nil {
		t.Fatal(err)
	}
	if n := liveTokens(); n != 1 {
		t.Fatalf("family token with a live sibling = %d live, want 1", n)
	}
	if err := svc.Revoke(ctx, owner, sibling.ID); err != nil {
		t.Fatal(err)
	}
	if n := liveTokens(); n != 0 {
		t.Fatalf("family token after its last device session closed = %d live, want 0", n)
	}
	if _, err := authSvc.Refresh(ctx, sess.RefreshToken); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("browser refresh with the family token: %v", err)
	}
}
