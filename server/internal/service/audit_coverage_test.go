package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
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
	audit.ActionMemberRemoved:        "deactivation replaced removal by an admin; leaving writes member.left",
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
		audit.ActionMemberRoleChanged: func(t *testing.T, f *auditFixture) {
			f.addMember(t)
			if _, err := f.orgMem.UpdateRole(f.ctx, f.owner.ID, f.orgID, f.member.ID, OrgRoleAdmin); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionMemberDeactivated: func(t *testing.T, f *auditFixture) {
			f.addMember(t)
			if _, err := f.orgMem.Deactivate(f.ctx, f.owner.ID, f.orgID, f.member.ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionMemberReactivated: func(t *testing.T, f *auditFixture) {
			f.addMember(t)
			if _, err := f.orgMem.Deactivate(f.ctx, f.owner.ID, f.orgID, f.member.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := f.orgMem.Reactivate(f.ctx, f.owner.ID, f.orgID, f.member.ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionMemberLeft: func(t *testing.T, f *auditFixture) {
			f.addMember(t)
			if err := f.orgMem.Leave(f.ctx, f.member.ID, f.orgID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionProfileUpdated: func(t *testing.T, f *auditFixture) {
			f.addMember(t)
			title := "Kỹ sư"
			if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.orgID, f.member.ID, ProfileInput{Title: &title}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionDepartmentCreated: func(t *testing.T, f *auditFixture) { f.newDepartment(t) },
		audit.ActionDepartmentUpdated: func(t *testing.T, f *auditFixture) {
			d := f.newDepartment(t)
			name := "Công nghệ"
			if _, err := f.depts.Update(f.ctx, f.owner.ID, f.orgID, d.ID, DepartmentInput{Name: &name}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionDepartmentArchived: func(t *testing.T, f *auditFixture) {
			d := f.newDepartment(t)
			if _, err := f.depts.Archive(f.ctx, f.owner.ID, f.orgID, d.ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionPeopleExported: func(t *testing.T, f *auditFixture) {
			f.build(t)
			if _, err := f.people.ExportCSV(f.ctx, f.owner.ID, f.orgID, io.Discard); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionInvitationRevoked: func(t *testing.T, f *auditFixture) {
			f.build(t)
			invs, _, err := f.orgMem.InviteToOrg(f.ctx, f.owner.ID, f.orgID, []string{"revoke-me@example.com"}, OrgRoleMember)
			if err != nil {
				t.Fatal(err)
			}
			if err := f.orgMem.RevokeInvitation(f.ctx, f.owner.ID, f.orgID, invs[0].ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionOrganizationOwnershipChanged: func(t *testing.T, f *auditFixture) {
			f.addMember(t)
			if _, err := f.orgMem.TransferOwnership(f.ctx, f.owner.ID, f.orgID, f.member.ID, auditPassword); err != nil {
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
		audit.ActionOrganizationSuspended: func(t *testing.T, f *auditFixture) {
			f.build(t)
			f.suspend(t, OrganizationSuspended)
		},
		audit.ActionOrganizationUnsuspended: func(t *testing.T, f *auditFixture) {
			f.build(t)
			f.suspend(t, OrganizationSuspended)
			f.suspend(t, OrganizationActive)
		},
		audit.ActionPlatformRoleGranted: func(t *testing.T, f *auditFixture) {
			f.build(t)
			if _, err := f.admin.SetPlatformRole(f.ctx, CLIActor, f.third.Email, PlatformRoleSupport, "first support account"); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionPlatformRoleRevoked: func(t *testing.T, f *auditFixture) {
			f.build(t)
			if _, err := f.admin.SetPlatformRole(f.ctx, CLIActor, f.third.Email, PlatformRoleSupport, "first support account"); err != nil {
				t.Fatal(err)
			}
			if _, err := f.admin.SetPlatformRole(f.ctx, CLIActor, f.third.Email, "", "left the support team"); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionFlagOverrideSet: func(t *testing.T, f *auditFixture) {
			f.build(t)
			f.override(t, true)
		},
		audit.ActionFlagOverrideDeleted: func(t *testing.T, f *auditFixture) {
			f.build(t)
			f.override(t, true)
			f.override(t, false)
		},
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
		audit.ActionTaskCommentUpdated: func(t *testing.T, f *auditFixture) {
			task := f.newTask(t)
			c, err := f.tasks.AddComment(f.ctx, Human(f.owner.ID), task.ID, "gốc")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := f.tasks.UpdateComment(f.ctx, Human(f.owner.ID), c.ID, UpdateCommentInput{Body: "sửa"}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskCommentDeleted: func(t *testing.T, f *auditFixture) {
			task := f.newTask(t)
			c, err := f.tasks.AddComment(f.ctx, Human(f.owner.ID), task.ID, "xóa")
			if err != nil {
				t.Fatal(err)
			}
			if err := f.tasks.DeleteComment(f.ctx, Human(f.owner.ID), c.ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskCommentResolved: func(t *testing.T, f *auditFixture) {
			task := f.newTask(t)
			c, err := f.tasks.AddComment(f.ctx, Human(f.owner.ID), task.ID, "resolve me")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := f.tasks.ResolveComment(f.ctx, Human(f.owner.ID), c.ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskCommentUnresolved: func(t *testing.T, f *auditFixture) {
			task := f.newTask(t)
			c, err := f.tasks.AddComment(f.ctx, Human(f.owner.ID), task.ID, "unresolve me")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := f.tasks.ResolveComment(f.ctx, Human(f.owner.ID), c.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := f.tasks.UnresolveComment(f.ctx, Human(f.owner.ID), c.ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionCommentReactionAdded: func(t *testing.T, f *auditFixture) {
			task := f.newTask(t)
			c, err := f.tasks.AddComment(f.ctx, Human(f.owner.ID), task.ID, "react")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := f.tasks.AddCommentReaction(f.ctx, Human(f.owner.ID), c.ID, "👍"); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionCommentReactionRemoved: func(t *testing.T, f *auditFixture) {
			task := f.newTask(t)
			c, err := f.tasks.AddComment(f.ctx, Human(f.owner.ID), task.ID, "react")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := f.tasks.AddCommentReaction(f.ctx, Human(f.owner.ID), c.ID, "👍"); err != nil {
				t.Fatal(err)
			}
			if err := f.tasks.RemoveCommentReaction(f.ctx, Human(f.owner.ID), c.ID, "👍"); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskReactionAdded: func(t *testing.T, f *auditFixture) {
			task := f.newTask(t)
			if _, err := f.tasks.AddTaskReaction(f.ctx, Human(f.owner.ID), task.ID, "🔥"); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskReactionRemoved: func(t *testing.T, f *auditFixture) {
			task := f.newTask(t)
			if _, err := f.tasks.AddTaskReaction(f.ctx, Human(f.owner.ID), task.ID, "🔥"); err != nil {
				t.Fatal(err)
			}
			if err := f.tasks.RemoveTaskReaction(f.ctx, Human(f.owner.ID), task.ID, "🔥"); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskSubscribed: func(t *testing.T, f *auditFixture) {
			task := f.newTask(t)
			if err := f.tasks.SubscribeTask(f.ctx, Human(f.owner.ID), task.ID, SubscribeTaskInput{}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskUnsubscribed: func(t *testing.T, f *auditFixture) {
			task := f.newTask(t)
			if err := f.tasks.SubscribeTask(f.ctx, Human(f.owner.ID), task.ID, SubscribeTaskInput{}); err != nil {
				t.Fatal(err)
			}
			if err := f.tasks.UnsubscribeTask(f.ctx, Human(f.owner.ID), task.ID, SubscribeTaskInput{}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionAttachmentUploaded: func(t *testing.T, f *auditFixture) {
			task := f.newTask(t)
			body := []byte("# note\n")
			if _, err := f.tasks.UploadTaskAttachment(f.ctx, Human(f.owner.ID), task.ID, "note.md", "text/markdown", int64(len(body)), bytes.NewReader(body)); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionAttachmentDeleted: func(t *testing.T, f *auditFixture) {
			task := f.newTask(t)
			body := []byte("# note\n")
			att, err := f.tasks.UploadTaskAttachment(f.ctx, Human(f.owner.ID), task.ID, "note.md", "text/markdown", int64(len(body)), bytes.NewReader(body))
			if err != nil {
				t.Fatal(err)
			}
			if err := f.tasks.DeleteAttachment(f.ctx, Human(f.owner.ID), att.ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskDeleted: func(t *testing.T, f *auditFixture) {
			if err := f.tasks.Delete(f.ctx, f.owner.ID, f.newTask(t).ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskStatusCreated: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			if _, err := f.tasks.CreateTaskStatus(f.ctx, Human(f.owner.ID), w.ID, CreateTaskStatusInput{
				Name: "Waiting QA", Category: "in_review", Color: "#22c55e",
			}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskStatusUpdated: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			st, err := f.tasks.CreateTaskStatus(f.ctx, Human(f.owner.ID), w.ID, CreateTaskStatusInput{
				Name: "Waiting QA", Category: "in_review", Color: "#22c55e",
			})
			if err != nil {
				t.Fatal(err)
			}
			name := "QA Gate"
			if _, err := f.tasks.UpdateTaskStatus(f.ctx, Human(f.owner.ID), w.ID, st.ID, UpdateTaskStatusInput{Name: &name}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskStatusDeleted: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			st, err := f.tasks.CreateTaskStatus(f.ctx, Human(f.owner.ID), w.ID, CreateTaskStatusInput{
				Name: "Temp", Category: "todo", Color: "#6b7280",
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := f.tasks.DeleteTaskStatus(f.ctx, Human(f.owner.ID), w.ID, st.ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskLabelCreated: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			if _, err := f.tasks.CreateTaskLabel(f.ctx, Human(f.owner.ID), w.ID, CreateTaskLabelInput{
				Name: "Bug", Color: "#ef4444",
			}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskLabelUpdated: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			label, err := f.tasks.CreateTaskLabel(f.ctx, Human(f.owner.ID), w.ID, CreateTaskLabelInput{
				Name: "Bug", Color: "#ef4444",
			})
			if err != nil {
				t.Fatal(err)
			}
			name := "Defect"
			if _, err := f.tasks.UpdateTaskLabel(f.ctx, Human(f.owner.ID), w.ID, label.ID, UpdateTaskLabelInput{Name: &name}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskLabelDeleted: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			label, err := f.tasks.CreateTaskLabel(f.ctx, Human(f.owner.ID), w.ID, CreateTaskLabelInput{
				Name: "Temp", Color: "#ef4444",
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := f.tasks.DeleteTaskLabel(f.ctx, Human(f.owner.ID), w.ID, label.ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskPropertyCreated: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			if _, err := f.tasks.CreateTaskProperty(f.ctx, Human(f.owner.ID), w.ID, CreateTaskPropertyInput{
				Name: "Points", Type: "number",
			}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskPropertyUpdated: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			prop, err := f.tasks.CreateTaskProperty(f.ctx, Human(f.owner.ID), w.ID, CreateTaskPropertyInput{
				Name: "Points", Type: "number",
			})
			if err != nil {
				t.Fatal(err)
			}
			name := "Story Points"
			if _, err := f.tasks.UpdateTaskProperty(f.ctx, Human(f.owner.ID), w.ID, prop.ID, UpdateTaskPropertyInput{Name: &name}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskViewCreated: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			if _, err := f.tasks.CreateTaskView(f.ctx, Human(f.owner.ID), w.ID, CreateTaskViewInput{
				Name: "Audit view", ScopeType: "workspace",
				Query: json.RawMessage(`{}`),
			}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskViewUpdated: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			view, err := f.tasks.CreateTaskView(f.ctx, Human(f.owner.ID), w.ID, CreateTaskViewInput{
				Name: "Audit view", ScopeType: "workspace",
				Query: json.RawMessage(`{}`),
			})
			if err != nil {
				t.Fatal(err)
			}
			name := "Renamed"
			if _, err := f.tasks.UpdateTaskView(f.ctx, Human(f.owner.ID), w.ID, view.ID, UpdateTaskViewInput{
				Name: &name, ExpectedRevision: view.Revision,
			}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskViewDeleted: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			view, err := f.tasks.CreateTaskView(f.ctx, Human(f.owner.ID), w.ID, CreateTaskViewInput{
				Name: "Temp", ScopeType: "workspace",
				Query: json.RawMessage(`{}`),
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := f.tasks.DeleteTaskView(f.ctx, Human(f.owner.ID), w.ID, view.ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskViewPreferenceUpdated: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			if _, err := f.tasks.PutTaskViewPreference(f.ctx, Human(f.owner.ID), w.ID, PutTaskViewPreferenceInput{
				ScopeType: "workspace", Prefs: json.RawMessage(`{"order":[]}`),
			}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskPinCreated: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			task := f.newTask(t)
			if _, err := f.tasks.CreatePin(f.ctx, Human(f.owner.ID), w.ID, CreatePinInput{
				ItemType: "task", ItemID: task.ID,
			}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskPinDeleted: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			task := f.newTask(t)
			if _, err := f.tasks.CreatePin(f.ctx, Human(f.owner.ID), w.ID, CreatePinInput{
				ItemType: "task", ItemID: task.ID,
			}); err != nil {
				t.Fatal(err)
			}
			if err := f.tasks.DeletePin(f.ctx, Human(f.owner.ID), w.ID, "task", task.ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionProjectCreated: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			if _, err := f.tasks.CreateProject(f.ctx, Human(f.owner.ID), w.ID, CreateProjectInput{
				Title: "Audit project",
			}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionProjectUpdated: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			p, err := f.tasks.CreateProject(f.ctx, Human(f.owner.ID), w.ID, CreateProjectInput{Title: "Before"})
			if err != nil {
				t.Fatal(err)
			}
			title := "After"
			if _, err := f.tasks.UpdateProject(f.ctx, Human(f.owner.ID), w.ID, p.ID, UpdateProjectInput{
				ExpectedRevision: p.Revision, Title: &title,
			}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionProjectDeleted: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			p, err := f.tasks.CreateProject(f.ctx, Human(f.owner.ID), w.ID, CreateProjectInput{Title: "Temp"})
			if err != nil {
				t.Fatal(err)
			}
			if err := f.tasks.DeleteProject(f.ctx, Human(f.owner.ID), w.ID, p.ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionProjectResourceCreated: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			p, err := f.tasks.CreateProject(f.ctx, Human(f.owner.ID), w.ID, CreateProjectInput{Title: "With res"})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := f.tasks.CreateProjectResource(f.ctx, Human(f.owner.ID), w.ID, p.ID, CreateProjectResourceInput{
				ResourceType: "github_repo",
				ResourceRef:  json.RawMessage(`{"url":"https://github.com/acme/app.git"}`),
			}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionProjectResourceUpdated: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			p, err := f.tasks.CreateProject(f.ctx, Human(f.owner.ID), w.ID, CreateProjectInput{Title: "With res"})
			if err != nil {
				t.Fatal(err)
			}
			res, err := f.tasks.CreateProjectResource(f.ctx, Human(f.owner.ID), w.ID, p.ID, CreateProjectResourceInput{
				ResourceType: "github_repo",
				ResourceRef:  json.RawMessage(`{"url":"https://github.com/acme/app.git"}`),
			})
			if err != nil {
				t.Fatal(err)
			}
			label := "main"
			if _, err := f.tasks.UpdateProjectResource(f.ctx, Human(f.owner.ID), w.ID, p.ID, res.ID, UpdateProjectResourceInput{
				Label: &label,
			}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionProjectResourceDeleted: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			p, err := f.tasks.CreateProject(f.ctx, Human(f.owner.ID), w.ID, CreateProjectInput{Title: "With res"})
			if err != nil {
				t.Fatal(err)
			}
			res, err := f.tasks.CreateProjectResource(f.ctx, Human(f.owner.ID), w.ID, p.ID, CreateProjectResourceInput{
				ResourceType: "github_repo",
				ResourceRef:  json.RawMessage(`{"url":"https://github.com/acme/app.git"}`),
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := f.tasks.DeleteProjectResource(f.ctx, Human(f.owner.ID), w.ID, p.ID, res.ID); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionTaskPinReordered: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			task := f.newTask(t)
			pin, err := f.tasks.CreatePin(f.ctx, Human(f.owner.ID), w.ID, CreatePinInput{
				ItemType: "task", ItemID: task.ID,
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := f.tasks.ReorderPins(f.ctx, Human(f.owner.ID), w.ID, []ReorderPinItem{
				{ID: pin.ID, Position: 2},
			}); err != nil {
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
		audit.ActionAuthMFAEnabled: func(t *testing.T, f *auditFixture) {
			f.build(t)
			enrol(t, f.auth, f.ctx, f.member.ID)
		},
		audit.ActionAuthMFADisabled: func(t *testing.T, f *auditFixture) {
			f.build(t)
			_, codes := enrol(t, f.auth, f.ctx, f.member.ID)
			if _, err := f.auth.DisableTOTP(f.ctx, f.member.ID, codes[0]); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionUserDeleted: func(t *testing.T, f *auditFixture) {
			f.build(t)
			if err := f.auth.DeleteAccount(f.ctx, f.member.ID, DeleteAccountInput{Password: auditPassword}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionChatRoomCreated: func(t *testing.T, f *auditFixture) { f.newDM(t) },
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
		audit.ActionChatChannelUpdated: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			ch, err := f.chat.CreateChannel(f.ctx, f.owner.ID, w.ID, CreateChannelInput{
				Name: "audit-ch", Visibility: "public",
			})
			if err != nil {
				t.Fatal(err)
			}
			topic := "updated"
			if _, err := f.chat.UpdateChannel(f.ctx, f.owner.ID, w.ID, ch.ID, UpdateChannelInput{Topic: &topic}); err != nil {
				t.Fatal(err)
			}
		},
		audit.ActionChatChannelArchived: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			ch, err := f.chat.CreateChannel(f.ctx, f.owner.ID, w.ID, CreateChannelInput{
				Name: "audit-arch", Visibility: "private",
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := f.chat.ArchiveChannel(f.ctx, f.owner.ID, w.ID, ch.ID); err != nil {
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
		audit.ActionMemberDeactivated,
		audit.ActionMemberReactivated,
		audit.ActionMemberLeft,
		audit.ActionProfileUpdated,
		audit.ActionDepartmentCreated,
		audit.ActionDepartmentUpdated,
		audit.ActionDepartmentArchived,
		audit.ActionPeopleExported,
		audit.ActionInvitationRevoked,
		audit.ActionOrganizationOwnershipChanged,
		audit.ActionWorkspaceCreated,
		audit.ActionWorkspaceUpdated,
		audit.ActionWorkspaceMemberAdded,
		audit.ActionWorkspaceMemberRoleChanged,
		audit.ActionWorkspaceMemberRemoved,
		audit.ActionTaskCreated,
		audit.ActionTaskUpdated,
		audit.ActionTaskDeleted,
		audit.ActionTaskCommentAdded,
		audit.ActionTaskCommentUpdated,
		audit.ActionTaskCommentDeleted,
		audit.ActionTaskCommentResolved,
		audit.ActionTaskCommentUnresolved,
		audit.ActionCommentReactionAdded,
		audit.ActionCommentReactionRemoved,
		audit.ActionTaskReactionAdded,
		audit.ActionTaskReactionRemoved,
		audit.ActionTaskSubscribed,
		audit.ActionTaskUnsubscribed,
		audit.ActionAttachmentUploaded,
		audit.ActionAttachmentDeleted,
		audit.ActionAuthLoginSucceeded,
		audit.ActionAuthLoginFailed,
		audit.ActionAuthPasswordResetRequested,
		audit.ActionAuthPasswordChanged,
		audit.ActionAuthSessionRevoked,
		audit.ActionAuthMFAEnabled,
		audit.ActionAuthMFADisabled,
		audit.ActionUserDeleted,
		audit.ActionChatRoomCreated,
		audit.ActionChatRoomMemberAdded,
		audit.ActionChatRoomMemberRemoved,
		audit.ActionChatChannelUpdated,
		audit.ActionChatChannelArchived,
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
	orgMem  *OrganizationMemberService
	people  *PeopleService
	depts   *DepartmentService
	ws      *WorkspaceService
	tasks   *TaskService
	agents  *AgentService
	billing *BillingService
	chat    *ChatService
	reset   *PasswordResetService
	admin   *AdminService
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
	orgMembers := NewOrganizationMemberService(pool, q, orgs)
	orgMembers.SetMail(renderer, &fakeOutbox{})
	return &auditFixture{
		ctx: context.Background(), pool: pool, q: q,
		auth: auth, orgs: orgs, orgMem: orgMembers,
		people: NewPeopleService(pool, q, orgs), depts: NewDepartmentService(pool, q, orgs), ws: ws,
		tasks:   NewTaskService(pool, q, ws, newMemStorage()),
		agents:  NewAgentService(pool, q, orgs, ws),
		billing: NewBillingService(pool, q, orgs, nil),
		chat:    NewChatService(pool, q, ws, NopPublisher{}),
		reset:   NewPasswordResetService(pool, q, auth, renderer, &fakeOutbox{}),
		admin:   NewAdminService(pool, q, NewBillingService(pool, q, orgs, nil), NewEntitlementService(pool, q)),
	}
}

// newDepartment creates one department for the cases that need a target.
func (f *auditFixture) newDepartment(t *testing.T) db.Department {
	t.Helper()
	f.build(t)
	name := "Kỹ thuật"
	d, err := f.depts.Create(f.ctx, f.owner.ID, f.orgID, DepartmentInput{Name: &name})
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// override sets (or deletes) the organization override of agents_assignee.
func (f *auditFixture) override(t *testing.T, set bool) {
	t.Helper()
	in := FlagOverrideInput{ScopeType: "organization", ScopeID: f.orgID, Enabled: true, Reason: "audit coverage fixture"}
	var err error
	if set {
		_, err = f.admin.SetFlagOverride(f.ctx, f.third.ID, "agents_assignee", in)
	} else {
		_, err = f.admin.DeleteFlagOverride(f.ctx, f.third.ID, "agents_assignee", in.ScopeType, in.ScopeID, in.Reason)
	}
	if err != nil {
		t.Fatal(err)
	}
}

// suspend makes the third user a platform admin and flips the org's status.
func (f *auditFixture) suspend(t *testing.T, status string) {
	t.Helper()
	if _, err := f.q.SetUserPlatformRole(f.ctx, db.SetUserPlatformRoleParams{ID: f.third.ID, PlatformRole: nullText(PlatformRoleAdmin), PlatformRoleGrantedBy: nullText(CLIActor)}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.admin.SetOrganizationStatus(f.ctx, f.third.ID, f.orgID, status, "audit coverage fixture"); err != nil {
		t.Fatal(err)
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
