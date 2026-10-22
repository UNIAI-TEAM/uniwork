package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/testutil"
)

// Every purpose the registry declares is one the database accepts, in the
// tenant shape the registry gives it. The two lists live apart - the enum and
// registry in internal/files, the CHECKs on file_upload_sessions in
// migrations - and a purpose missing from the CHECK passes every test built on
// filesfake while each real upload of it fails (chat_room_wallpaper, UNI-2134).
func TestEveryRegistryPurposeFitsTheSessionChecks(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()
	for _, spec := range files.DefaultRegistry().Specs() {
		var shapes []files.Scope
		switch spec.Scope {
		case files.ScopeUser:
			shapes = []files.Scope{{UserID: t3User}}
		case files.ScopeOrg:
			shapes = []files.Scope{{OrganizationID: t3Org}}
		case files.ScopeOrgWorkspace:
			shapes = []files.Scope{{OrganizationID: t3Org, WorkspaceID: t3WS}}
		case files.ScopeOrgWorkspaceOptional:
			shapes = []files.Scope{{OrganizationID: t3Org}, {OrganizationID: t3Org, WorkspaceID: t3WS}}
		default:
			t.Fatalf("%s: scope shape %q has no case here", spec.Purpose, spec.Scope)
		}
		for i, sc := range shapes {
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			_, err = tx.Exec(ctx, `
				INSERT INTO file_upload_sessions (
				  id, file_id, created_by, created_by_kind, purpose,
				  organization_id, workspace_id, user_id,
				  idempotency_key, command_fingerprint
				) VALUES ('01J8ZQ0K7V9W1Y2X3Z4A5B6S00', '01J8ZQ0K7V9W1Y2X3Z4A5B6F00', $1, 'human', $2,
				  NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''), 'purpose-check', 'fp')`,
				t3User, string(spec.Purpose), sc.OrganizationID, sc.WorkspaceID, sc.UserID)
			_ = tx.Rollback(ctx)
			if err != nil {
				t.Errorf("%s (shape %d, %+v): file_upload_sessions refuses it: %v", spec.Purpose, i, sc, err)
			}
		}
	}
}
