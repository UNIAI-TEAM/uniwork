package service

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// auditCommands is the table the audit spec calls for: every command that must
// leave an audit row, with a closure that runs it. It fails in both directions.
// A command added without a row here is caught in review; an action listed
// here whose command writes nothing turns the test red.
//
// actionsWithoutCommands is the escape hatch, and it is deliberately noisy: an
// action can only sit there with a written reason, which is the thing a
// reviewer reads instead of guessing why coverage has a hole.
var actionsWithoutCommands = map[string]string{
	audit.ActionOrganizationUpdated:  "no organization rename command exists yet",
	audit.ActionMemberRoleChanged:    "organization roles change only through workspace membership today",
	audit.ActionMemberRemoved:        "no organization member removal command exists yet",
	audit.ActionAuditExportRequested: "covered by the audit service's own tests",
	audit.ActionAuditRetentionSet:    "covered by the audit service's own tests",
}

func TestEveryAuditedCommandWritesItsRow(t *testing.T) {
	cases := map[string]func(t *testing.T, f *auditFixture){
		audit.ActionOrganizationCreated: func(t *testing.T, f *auditFixture) { f.build(t) },
		audit.ActionMemberJoined:        func(t *testing.T, f *auditFixture) { f.build(t) },
		audit.ActionWorkspaceCreated:    func(t *testing.T, f *auditFixture) { f.build(t) },
		audit.ActionWorkspaceMemberAdded: func(t *testing.T, f *auditFixture) {
			f.build(t)
		},
		audit.ActionWorkspaceUpdated: func(t *testing.T, f *auditFixture) {
			name := "Đổi tên"
			if _, err := f.ws.Update(f.ctx, f.owner.ID, f.build(t).ID, UpdateWorkspaceInput{Name: &name}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionWorkspaceMemberRoleChanged: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			f.addMember(t)
			if _, err := f.ws.UpdateMemberRole(f.ctx, f.owner.ID, w.ID, f.member.ID, "admin"); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionWorkspaceMemberRemoved: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			f.addMember(t)
			if err := f.ws.RemoveMember(f.ctx, f.owner.ID, w.ID, f.member.ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionMemberInvited: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			if _, _, err := f.ws.InviteMany(f.ctx, f.owner.ID, w.ID, []string{"invitee@example.com"}, "member"); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskCreated: func(t *testing.T, f *auditFixture) { f.newTask(t) },
		// The default agent is seeded with the organization; a second one goes
		// through the command proper.
		audit.ActionAgentCreated: func(t *testing.T, f *auditFixture) { f.build(t) },
		audit.ActionAgentUpdated: func(t *testing.T, f *auditFixture) {
			f.build(t)
			name := "UNI đổi tên"
			if _, err := f.agents.Update(f.ctx, f.owner.ID, f.defaultAgent(t).ID, UpdateAgentInput{Name: &name}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionWorkspaceAgentAdded: func(t *testing.T, f *auditFixture) { f.build(t) },
		audit.ActionSubscriptionChanged: func(t *testing.T, f *auditFixture) {
			f.build(t)
			if _, err := f.billing.Cancel(f.ctx, f.owner.ID, f.orgID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskUpdated: func(t *testing.T, f *auditFixture) {
			task := f.newTask(t)
			status := "in_progress"
			if _, err := f.tasks.Update(f.ctx, Human(f.owner.ID), task.ID, UpdateTaskInput{Status: &status}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskCommentAdded: func(t *testing.T, f *auditFixture) {
			task := f.newTask(t) // build the fixture before reading f.owner
			if _, err := f.tasks.AddComment(f.ctx, Human(f.owner.ID), task.ID, "ghi chú"); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskDeleted: func(t *testing.T, f *auditFixture) {
			if err := f.tasks.Delete(f.ctx, f.owner.ID, f.newTask(t).ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionAuthLoginSucceeded: func(t *testing.T, f *auditFixture) {
			f.build(t)
			if _, err := f.auth.Login(f.ctx, f.owner.Email, auditPassword); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionAuthLoginFailed: func(t *testing.T, f *auditFixture) {
			f.build(t)
			if _, err := f.auth.Login(f.ctx, f.owner.Email, "definitely-not-the-password"); err == nil {
				t.Fatal("a wrong password must not log the user in")
			}
		},
		audit.ActionAuthSessionRevoked: func(t *testing.T, f *auditFixture) {
			f.build(t)
			sess, err := f.auth.Login(f.ctx, f.owner.Email, auditPassword)
			if err != nil {
				t.Fatal(err)
			}
			if err := f.auth.Logout(f.ctx, sess.RefreshToken); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionAuthPasswordResetRequested: func(t *testing.T, f *auditFixture) {
			f.build(t)
			if err := f.reset.Request(f.ctx, f.owner.Email); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionAuthPasswordChanged: func(t *testing.T, f *auditFixture) { f.resetPassword(t) },
		audit.ActionChatRoomCreated:     func(t *testing.T, f *auditFixture) { f.newDM(t) },
		audit.ActionChatRoomMemberAdded: func(t *testing.T, f *auditFixture) {
			// A group needs three organization members; inviting the third is
			// the command that adds a room member.
			f.newGroupInvite(t)
		},
		audit.ActionChatRoomMemberRemoved: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			dm := f.newDM(t)
			if err := f.chat.LeaveChatRoom(f.ctx, f.owner.ID, w.ID, dm.ID); err != nil {
				t.Fatal(err)
			}
		},
	}

	for _, action := range auditActions() {
		if reason, ok := actionsWithoutCommands[action]; ok {
			if _, covered := cases[action]; covered {
				t.Errorf("%s is both covered and excused (%q): drop the excuse", action, reason)
			}
			continue
		}
		run, ok := cases[action]
		if !ok {
			t.Errorf("%s has no command in this table: wire the command, or excuse it with a reason", action)
			continue
		}
		t.Run(action, func(t *testing.T) {
			f := newAuditFixture(t)
			run(t, f)
			if !f.wrote(t, action) {
				t.Fatalf("the command for %s left no audit row; rows written: %v", action, f.actions(t))
			}
		})
	}
}

// auditActions is the vocabulary internal/audit publishes. Listed by hand so a
// failure names the missing constant; the loop above is what keeps the two in
// step.
func auditActions() []string {
	return []string{
		audit.ActionOrganizationCreated,
		audit.ActionOrganizationUpdated,
		audit.ActionMemberInvited,
		audit.ActionMemberJoined,
		audit.ActionMemberRoleChanged,
		audit.ActionMemberRemoved,
		audit.ActionWorkspaceCreated,
		audit.ActionWorkspaceUpdated,
		audit.ActionWorkspaceMemberAdded,
		audit.ActionWorkspaceMemberRoleChanged,
		audit.ActionWorkspaceMemberRemoved,
		audit.ActionTaskCreated,
		audit.ActionTaskUpdated,
		audit.ActionTaskDeleted,
		audit.ActionTaskCommentAdded,
		audit.ActionAuthLoginSucceeded,
		audit.ActionAuthLoginFailed,
		audit.ActionAuthPasswordResetRequested,
		audit.ActionAuthPasswordChanged,
		audit.ActionAuthSessionRevoked,
		audit.ActionChatRoomCreated,
		audit.ActionChatRoomMemberAdded,
		audit.ActionChatRoomMemberRemoved,
		audit.ActionAuditExportRequested,
		audit.ActionAuditRetentionSet,
		audit.ActionSubscriptionChanged,
	}
}

const auditPassword = "password123"

type auditFixture struct {
	ctx     context.Context
	pool    *pgxpool.Pool
	q       *db.Queries
	auth    *AuthService
	orgs    *OrganizationService
	ws      *WorkspaceService
	tasks   *TaskService
	agents  *AgentService
	billing *BillingService
	chat    *ChatService
	reset   *PasswordResetService
	owner   db.User
	member  db.User
	third   db.User

	workspace db.Workspace
	orgID     string
	built     bool
}

func newAuditFixture(t *testing.T) *auditFixture {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := authpkg.TokenMinter{Secret: []byte("t"), TTL: time.Minute}
	renderer := mail.Renderer{AppURL: "http://localhost:3000"}
	auth := NewAuthService(pool, q, minter, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, renderer, &fakeOutbox{})
	return &auditFixture{
		ctx: context.Background(), pool: pool, q: q,
		auth: auth, orgs: orgs, ws: ws,
		tasks:   NewTaskService(pool, q, ws),
		agents:  NewAgentService(pool, q, orgs, ws),
		billing: NewBillingService(pool, q, orgs, nil),
		chat:    NewChatService(pool, q, ws, NopPublisher{}),
		reset:   NewPasswordResetService(pool, q, auth, renderer, &fakeOutbox{}),
	}
}

// build creates the organization, workspace and users every case needs. It is
// idempotent so a case can call it and still be the one that produced the row
// the assertion looks for.
func (f *auditFixture) build(t *testing.T) db.Workspace {
	t.Helper()
	if f.built {
		return f.workspace
	}
	f.owner = registerVerified(t, f.q, f.auth, "audit-owner@example.com", "Owner")
	f.member = registerVerified(t, f.q, f.auth, "audit-member@example.com", "Member")
	f.third = registerVerified(t, f.q, f.auth, "audit-third@example.com", "Third")
	org, err := f.orgs.Create(f.ctx, f.owner.ID, "Audit Org", "audit-org")
	if err != nil {
		t.Fatal(err)
	}
	f.orgID = org.ID
	v, err := f.ws.CreateInOrg(f.ctx, f.owner.ID, org.ID, "Audit WS", "audit-ws")
	if err != nil {
		t.Fatal(err)
	}
	f.workspace = v.Workspace
	f.built = true
	return f.workspace
}

func (f *auditFixture) addMember(t *testing.T) {
	t.Helper()
	f.build(t)
	addOrgMember(t, f.q, f.orgID, f.member.ID)
	addWorkspaceMember(t, f.q, f.workspace.ID, f.member.ID)
}

func (f *auditFixture) defaultAgent(t *testing.T) db.Agent {
	t.Helper()
	f.build(t)
	agents, err := f.agents.List(f.ctx, f.owner.ID, f.orgID)
	if err != nil || len(agents) == 0 {
		t.Fatalf("default agent missing: %v", err)
	}
	return agents[0]
}

func (f *auditFixture) newTask(t *testing.T) db.Task {
	t.Helper()
	w := f.build(t)
	task, err := f.tasks.Create(f.ctx, Human(f.owner.ID), w.ID, CreateTaskInput{Title: "Việc kiểm toán"})
	if err != nil {
		t.Fatal(err)
	}
	return task
}

func (f *auditFixture) newDM(t *testing.T) ChatRoomSummary {
	t.Helper()
	w := f.build(t)
	f.addMember(t)
	dm, err := f.chat.ResolveDM(f.ctx, f.owner.ID, w.ID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	return dm
}

func (f *auditFixture) newGroupInvite(t *testing.T) {
	t.Helper()
	w := f.build(t)
	f.addMember(t)
	addOrgMember(t, f.q, f.orgID, f.third.ID)
	addWorkspaceMember(t, f.q, f.workspace.ID, f.third.ID)
	group, err := f.chat.CreateGroup(f.ctx, f.owner.ID, w.ID, CreateGroupInput{
		Name: "Nhóm kiểm toán", MemberUserIDs: []string{f.member.ID, f.third.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	// The group already holds all three; leaving and being re-invited is the
	// smallest way to exercise the member_added command itself.
	if err := f.chat.LeaveChatRoom(f.ctx, f.third.ID, w.ID, group.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.chat.InviteGroupMembers(f.ctx, f.owner.ID, w.ID, group.ID, []string{f.third.ID}); err != nil {
		t.Fatal(err)
	}
}

func (f *auditFixture) resetPassword(t *testing.T) {
	t.Helper()
	f.build(t)
	if err := f.reset.Request(f.ctx, f.owner.Email); err != nil {
		t.Fatal(err)
	}
	var tokenHash string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT token_hash FROM password_reset_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
		f.owner.ID).Scan(&tokenHash); err != nil {
		t.Fatal(err)
	}
	// The raw token never leaves Request, so the test resets through the same
	// query the service uses rather than reproducing the hashing here.
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE password_reset_tokens SET token_hash = $2 WHERE token_hash = $1`,
		tokenHash, hashToken("audit-reset-token")); err != nil {
		t.Fatal(err)
	}
	if _, err := f.reset.Reset(f.ctx, "audit-reset-token", "brand-new-password"); err != nil {
		t.Fatal(err)
	}
}

// actions lists every audit row written so far, across both the organization
// scope and the empty-organization sentinel credential events use.
func (f *auditFixture) actions(t *testing.T) []string {
	t.Helper()
	var out []string
	for _, org := range []string{f.orgID, audit.NoOrganization} {
		rows, err := f.q.ListAuditEvents(f.ctx, db.ListAuditEventsParams{OrganizationID: org, LimitN: 500})
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range rows {
			out = append(out, r.Action)
		}
	}
	return out
}

func (f *auditFixture) wrote(t *testing.T, action string) bool {
	t.Helper()
	for _, a := range f.actions(t) {
		if a == action {
			return true
		}
	}
	return false
}
