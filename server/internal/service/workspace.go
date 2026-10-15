package service

import (
	"context"
	"errors"
	netmail "net/mail"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/telemetry"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// inviteTTL is both the invitation row's expiry and the number the mail quotes.
const inviteTTL = 7 * 24 * time.Hour

const maxInviteBatch = 50

// WorkspaceView = workspace + định danh org, đủ cho FE dựng URL /{org}/{ws}.
type WorkspaceView struct {
	db.Workspace
	OrganizationSlug string
	OrganizationName string
	// IconURL is the presigned uploaded icon, resolved at read time; "" when
	// there is no file or presigning failed.
	IconURL string
}

type WorkspaceService struct {
	pool   *pgxpool.Pool
	q      *db.Queries
	orgs   *OrganizationService
	render mail.Renderer
	out    mail.Enqueuer
	// ent is the quota gate (F-02). Built here rather than injected so there
	// is no nil path that skips the gate.
	ent *EntitlementService
	// files is optional: with FileService wired, member avatars stored as
	// file ids resolve to presigned URLs (UNI-744).
	files files.Service
	// members runs the leave, transfer and close an invitation switch makes
	// in its own transaction (spec §4.4). Built here so there is no nil path.
	members *OrganizationMemberService
}

func NewWorkspaceService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService, r mail.Renderer, out mail.Enqueuer) *WorkspaceService {
	return &WorkspaceService{pool: pool, q: q, orgs: orgs, render: r, out: out, ent: NewEntitlementService(pool, q),
		members: NewOrganizationMemberService(pool, q, orgs)}
}

// SetEmailHub lets an invitation switch revoke the OAuth grants of the
// mailboxes it disconnects from the organizations left behind, as Leave does.
func (s *WorkspaceService) SetEmailHub(h *EmailHubService) { s.members.SetEmailHub(h) }

// SetFiles selects the FileService path for avatar URL emission.
func (s *WorkspaceService) SetFiles(f files.Service) { s.files = f }

func viewFromInOrgRow(r db.ListWorkspacesInOrgRow) WorkspaceView {
	return WorkspaceView{Workspace: db.Workspace{
		ID: r.ID, OrganizationID: r.OrganizationID, Slug: r.Slug, Name: r.Name,
		CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		MatrixRoomID: r.MatrixRoomID, TaskPrefix: r.TaskPrefix, TaskCounter: r.TaskCounter,
		Description: r.Description, IconEmoji: r.IconEmoji, IconFileID: r.IconFileID,
	}, OrganizationSlug: r.OrganizationSlug, OrganizationName: r.OrganizationName}
}

// ViewsFromOrgRows turns rows an already-authorized org listing returned into
// views with the icon URL signed.
func (s *WorkspaceService) ViewsFromOrgRows(ctx context.Context, rows []db.ListWorkspacesInOrgRow) []WorkspaceView {
	out := make([]WorkspaceView, 0, len(rows))
	// shortcut: one presign per workspace with an icon file on list reads,
	// bounded by the organization's workspace count; batch if lists grow.
	for _, r := range rows {
		out = append(out, s.withIconURL(ctx, viewFromInOrgRow(r)))
	}
	return out
}

func (s *WorkspaceService) CreateInOrg(ctx context.Context, userID, orgID, name, slug string) (WorkspaceView, error) {
	if _, err := s.orgs.RequireMember(ctx, orgID, userID); err != nil {
		return WorkspaceView{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return WorkspaceView{}, Invalid("tên workspace không được để trống")
	}
	if err := ValidateSlug(slug); err != nil {
		return WorkspaceView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WorkspaceView{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	// A slug another workspace keeps as an old slug is taken (spec §4.4).
	if err := q.LockWorkspaceSlugs(ctx, orgID); err != nil {
		return WorkspaceView{}, err
	}
	if err := slugFreeFor(ctx, q, orgID, slug, ""); err != nil {
		return WorkspaceView{}, err
	}

	// workspaces.max: refused here means the workspace row below is never
	// written (spec F-02 §4.3).
	if err := s.ent.Consume(ctx, q, ConsumeInput{OrganizationID: orgID, Meter: FeatureWorkspacesMax, Delta: 1, Actor: Human(userID)}); err != nil {
		return WorkspaceView{}, err
	}
	w, err := q.CreateWorkspace(ctx, db.CreateWorkspaceParams{
		ID: util.NewID(), OrganizationID: orgID, Slug: slug, Name: name, CreatedBy: userID,
	})
	if isUniqueViolation(err) {
		return WorkspaceView{}, ErrConflict
	}
	if err != nil {
		return WorkspaceView{}, err
	}
	if err := q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.ID, OrganizationID: w.OrganizationID, UserID: userID, Role: "owner"}); err != nil {
		return WorkspaceView{}, err
	}
	w, err = q.UpdateWorkspaceTaskPrefix(ctx, db.UpdateWorkspaceTaskPrefixParams{
		ID: w.ID, TaskPrefix: deriveTaskPrefix(w.Slug), OrganizationID: orgID,
	})
	if err != nil {
		return WorkspaceView{}, err
	}
	if err := seedBuiltInTaskStatuses(ctx, q, w); err != nil {
		return WorkspaceView{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: w.ID,
		Actor:        audit.User(userID),
		Action:       audit.ActionWorkspaceCreated,
		ResourceType: "workspace", ResourceID: w.ID,
		Changes: audit.Diff(nil, map[string]any{"name": w.Name, "slug": w.Slug}),
	}, audit.Event{Topic: "workspace.created", Payload: map[string]string{
		"workspace_id": w.ID, "organization_id": orgID,
	}}); err != nil {
		return WorkspaceView{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: w.ID,
		Actor:        audit.User(userID),
		Action:       audit.ActionWorkspaceMemberAdded,
		ResourceType: "workspace_member", ResourceID: userID,
		Changes: audit.Diff(nil, map[string]any{"role": "owner"}),
	}, audit.Event{Topic: "member.joined", Payload: map[string]string{
		"organization_id": orgID, "workspace_id": w.ID, "user_id": userID,
	}}); err != nil {
		return WorkspaceView{}, err
	}
	// The organization's active agents join every new workspace so a task can
	// be handed to UNI from the first day (OPEN_QUESTIONS AG6). Admins can
	// pause an agent to stop this.
	agents, err := q.ListActiveAgentsInOrg(ctx, orgID)
	if err != nil {
		return WorkspaceView{}, err
	}
	for _, a := range agents {
		if err := addAgentToWorkspace(ctx, q, w, a.ID, audit.System("workspace.created")); err != nil {
			return WorkspaceView{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return WorkspaceView{}, err
	}
	return s.GetView(ctx, userID, w.ID)
}

func (s *WorkspaceService) GetView(ctx context.Context, userID, workspaceID string) (WorkspaceView, error) {
	if _, err := s.RequireMember(ctx, workspaceID, userID); err != nil {
		return WorkspaceView{}, err
	}
	r, err := s.q.GetWorkspaceWithOrg(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceView{}, ErrNotFound
	}
	if err != nil {
		return WorkspaceView{}, err
	}
	return viewFromInOrgRow(db.ListWorkspacesInOrgRow(r)), nil
}

func (s *WorkspaceService) ListForUser(ctx context.Context, userID string) ([]WorkspaceView, error) {
	rows, err := s.q.ListWorkspacesForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]WorkspaceView, 0, len(rows))
	// shortcut: one presign per workspace with an icon file on list reads,
	// bounded by membership count; batch if lists grow.
	for _, r := range rows {
		out = append(out, s.withIconURL(ctx, viewFromInOrgRow(db.ListWorkspacesInOrgRow(r))))
	}
	return out, nil
}

// ResolveSlugs maps the URL pair to a workspace id WITHOUT a membership check.
// It exists for the WebSocket upgrade, which resolves the workspace before it
// has authenticated the caller and checks membership immediately after; every
// HTTP path keeps using GetBySlugs, which does both.
func (s *WorkspaceService) ResolveSlugs(ctx context.Context, orgSlug, wsSlug string) (string, error) {
	r, err := s.workspaceBySlugs(ctx, orgSlug, wsSlug)
	if err != nil {
		return "", err
	}
	return r.ID, nil
}

func (s *WorkspaceService) GetBySlugs(ctx context.Context, userID, orgSlug, wsSlug string) (WorkspaceView, error) {
	r, err := s.workspaceBySlugs(ctx, orgSlug, wsSlug)
	if err != nil {
		return WorkspaceView{}, err
	}
	if _, err := s.RequireMember(ctx, r.ID, userID); err != nil {
		// A suspended tenant, and a member who has been switched off, both
		// already know this workspace exists, so they get the honest answer
		// and the client can draw the right notice; everything else is 404 so
		// nothing leaks.
		if errors.Is(err, ErrOrganizationSuspended) || errors.Is(err, ErrMemberDeactivated) || errors.Is(err, ErrOrganizationDeletionScheduled) {
			return WorkspaceView{}, err
		}
		return WorkspaceView{}, ErrNotFound // không lộ sự tồn tại
	}
	return s.withIconURL(ctx, viewFromInOrgRow(r)), nil
}

// RequireMember: quyền workspace = dòng workspace_members HOẶC owner/admin của
// org chứa workspace (khi đó role hiệu lực là "admin"). Đây là nơi DUY NHẤT
// quyết định quyền workspace — service khác không tự query workspace_members.
func (s *WorkspaceService) RequireMember(ctx context.Context, workspaceID, userID string) (db.WorkspaceMember, error) {
	return s.RequireMemberQ(ctx, s.q, workspaceID, userID)
}

// RequireMemberQ is RequireMember read through q: a caller that already holds
// a transaction passes its q so the gate reads on that connection (and that
// snapshot) instead of borrowing a second one from the pool while it holds
// row locks. Same decision, same errors.
func (s *WorkspaceService) RequireMemberQ(ctx context.Context, q *db.Queries, workspaceID, userID string) (db.WorkspaceMember, error) {
	access, err := q.GetWorkspaceAccess(ctx, db.GetWorkspaceAccessParams{ID: workspaceID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && access.Role == "") {
		return db.WorkspaceMember{}, ErrForbidden
	}
	if err != nil {
		return db.WorkspaceMember{}, err
	}
	// A suspended tenant is closed to its members on every route (F-11 §4);
	// platform admins reach it through /api/v1/admin, which never comes here.
	if access.OrganizationStatus != OrganizationActive {
		return db.WorkspaceMember{}, errOrganizationSuspended()
	}
	// Deactivation keeps the workspace rows, so the workspace join alone would
	// still admit the person; the organization membership is what decides
	// (F-03 §4.1).
	if access.OrganizationMemberDeactivated {
		return db.WorkspaceMember{}, errMemberDeactivated()
	}
	if access.DeletionScheduledAt.Valid && access.OrganizationRole != OrgRoleOwner {
		return db.WorkspaceMember{}, errOrganizationDeletionScheduled(access.DeletionScheduledAt.Time)
	}
	// The one place every workspace request passes through, so the span and
	// the log lines of this request learn their tenant here (spec F-11 §6.1).
	telemetry.SetTenant(ctx, access.OrganizationID, workspaceID)
	return db.WorkspaceMember{WorkspaceID: workspaceID, OrganizationID: access.OrganizationID, UserID: userID, Role: access.Role}, nil
}

// RequireAgentMember is the agent counterpart of RequireMember: an agent is
// in a workspace only through its own workspace_agent_members row, never
// implicitly through the organization.
func (s *WorkspaceService) RequireAgentMember(ctx context.Context, workspaceID, agentID string) (db.WorkspaceAgentMember, error) {
	return s.RequireAgentMemberQ(ctx, s.q, workspaceID, agentID)
}

// RequireAgentMemberQ is RequireAgentMember read through q (see RequireMemberQ).
func (s *WorkspaceService) RequireAgentMemberQ(ctx context.Context, q *db.Queries, workspaceID, agentID string) (db.WorkspaceAgentMember, error) {
	m, err := q.GetWorkspaceAgentMember(ctx, db.GetWorkspaceAgentMemberParams{WorkspaceID: workspaceID, AgentID: agentID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.WorkspaceAgentMember{}, ErrForbidden
	}
	return m, err
}

// requireActorMember routes a command's actor to the right membership gate.
func (s *WorkspaceService) requireActorMember(ctx context.Context, workspaceID string, actor Actor) error {
	switch actor.Kind {
	case audit.KindHuman:
		_, err := s.RequireMember(ctx, workspaceID, actor.ID)
		return err
	case audit.KindAgent:
		_, err := s.RequireAgentMember(ctx, workspaceID, actor.ID)
		return err
	default:
		return ErrForbidden
	}
}

type UpdateWorkspaceInput struct {
	Name        *string
	Description *string
	IconEmoji   *string
	TaskPrefix  *string
	Slug        *string
}

const (
	maxWorkspaceNameRunes        = 100
	maxWorkspaceDescriptionRunes = 500
	maxWorkspaceIconEmojiRunes   = 16
)

// taskPrefixPattern: an upper-case letter, then 1-9 letters or digits.
var taskPrefixPattern = regexp.MustCompile(`^[A-Z][A-Z0-9]{1,9}$`)

// Update changes what an owner or admin may edit about a workspace (spec
// 2026-10-14 §5.1). A nil field keeps its value; a field sent with its
// current value is not a change, and a call that changes nothing writes no
// audit row and no event.
func (s *WorkspaceService) Update(ctx context.Context, userID, workspaceID string, in UpdateWorkspaceInput) (WorkspaceView, error) {
	before, err := s.requireWorkspaceAdmin(ctx, userID, workspaceID)
	if err != nil {
		return WorkspaceView{}, err
	}
	return s.updateFrom(ctx, userID, before, in)
}

// updateFrom is Update after the admin gate; before is the unlocked row the
// gate read.
func (s *WorkspaceService) updateFrom(ctx context.Context, userID string, before db.Workspace, in UpdateWorkspaceInput) (WorkspaceView, error) {
	in, err := normalizeWorkspaceInput(before, in)
	if err != nil {
		return WorkspaceView{}, err
	}
	workspaceID := before.ID
	// before is unlocked, so this diff only says whether there is work and
	// whether a file icon must be released first; the real diff is computed
	// below from the locked row.
	_, hint := workspaceChanges(before, in)
	if len(hint) == 0 {
		return s.viewWithIcon(ctx, userID, workspaceID)
	}
	_, releaseIcon := hint["icon_emoji"]

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WorkspaceView{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	// Files rows are locked before the workspace row (UploadIcon does the
	// same), so a file icon is released first when the hint says it will go.
	locked, err := s.lockWorkspace(ctx, q, before, releaseIcon)
	if err != nil {
		return WorkspaceView{}, err
	}
	from, to := workspaceChanges(locked, in)
	if len(to) == 0 {
		return s.viewWithIcon(ctx, userID, workspaceID)
	}
	if _, writesIcon := to["icon_emoji"]; writesIcon != releaseIcon && locked.IconFileID.Valid {
		// An icon file appeared after the unlocked read: either it was not
		// released although the emoji is written, or it was released although
		// nothing writes the icon. Rolling back undoes the release.
		return WorkspaceView{}, ErrConflict
	}
	if p, ok := to["task_prefix"]; ok && !taskPrefixPattern.MatchString(p.(string)) {
		return WorkspaceView{}, Invalid(taskPrefixInvalid)
	}
	if sl, ok := to["slug"]; ok {
		// normalize skipped the format check for the unlocked row's slug;
		// the locked row may differ.
		if err := ValidateSlug(sl.(string)); err != nil {
			return WorkspaceView{}, err
		}
	}
	if err := s.applyWorkspaceChanges(ctx, q, locked, in, to); err != nil {
		return WorkspaceView{}, err
	}
	if emoji, ok := to["icon_emoji"]; ok {
		// The trail names this "icon", as UploadIcon and RemoveIcon do, and
		// keeps the id of a file icon the emoji replaced.
		delete(from, "icon_emoji")
		delete(to, "icon_emoji")
		from["icon"], to["icon"] = workspaceIconLabel(locked), emoji
	}
	if err := recordWorkspaceUpdated(ctx, q, userID, locked, from, to); err != nil {
		return WorkspaceView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WorkspaceView{}, err
	}
	return s.viewWithIcon(ctx, userID, workspaceID)
}

// requireWorkspaceAdmin is the gate every workspace-settings write shares:
// owner or admin of the workspace (organization owners and admins count as
// admin through RequireMember). It returns the row as it stands.
func (s *WorkspaceService) requireWorkspaceAdmin(ctx context.Context, userID, workspaceID string) (db.Workspace, error) {
	m, err := s.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return db.Workspace{}, err
	}
	if m.Role != "owner" && m.Role != "admin" {
		return db.Workspace{}, ErrForbidden
	}
	w, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Workspace{}, ErrNotFound
	}
	return w, err
}

// lockWorkspace returns the workspace row locked FOR UPDATE: inside a
// settings transaction it is the only source of `before`, so concurrent
// changes cannot both diff against the same old value. With releaseIcon the
// uploaded icon file is released first, keeping files rows ahead of the
// workspace row.
func (s *WorkspaceService) lockWorkspace(ctx context.Context, q *db.Queries, w db.Workspace, releaseIcon bool) (db.Workspace, error) {
	if releaseIcon {
		if _, err := s.releaseIconFileInTx(ctx, q, w.ID, w.OrganizationID); err != nil {
			return db.Workspace{}, err
		}
	}
	locked, err := q.GetWorkspaceForUpdate(ctx, db.GetWorkspaceForUpdateParams{ID: w.ID, OrganizationID: w.OrganizationID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Workspace{}, ErrNotFound
	}
	return locked, err
}

const taskPrefixInvalid = "tiền tố mã task gồm 2–10 ký tự A-Z, 0-9 và bắt đầu bằng chữ"

// normalizeWorkspaceInput trims and validates every field that was sent.
func normalizeWorkspaceInput(before db.Workspace, in UpdateWorkspaceInput) (UpdateWorkspaceInput, error) {
	if in.Name == nil && in.Description == nil && in.IconEmoji == nil && in.TaskPrefix == nil && in.Slug == nil {
		return in, Invalid("không có thông tin nào để đổi")
	}
	out := UpdateWorkspaceInput{}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return out, Invalid("tên workspace không được để trống")
		}
		if utf8.RuneCountInString(name) > maxWorkspaceNameRunes {
			return out, Invalid("tên workspace quá dài")
		}
		out.Name = &name
	}
	if in.Description != nil {
		d := strings.TrimSpace(*in.Description)
		if utf8.RuneCountInString(d) > maxWorkspaceDescriptionRunes {
			return out, Invalid("mô tả workspace tối đa 500 ký tự")
		}
		out.Description = &d
	}
	if in.IconEmoji != nil {
		e := strings.TrimSpace(*in.IconEmoji)
		// shortcut: any short run of non-space characters passes; nothing
		// checks it is really an emoji. Upgrade if people put words here.
		if utf8.RuneCountInString(e) > maxWorkspaceIconEmojiRunes || strings.ContainsFunc(e, unicode.IsSpace) {
			return out, Invalid("icon workspace phải là một emoji")
		}
		out.IconEmoji = &e
	}
	if in.TaskPrefix != nil {
		p := strings.ToUpper(strings.TrimSpace(*in.TaskPrefix))
		// The prefix a workspace already has passes unchecked: a derived one
		// may not fit the pattern, and re-sending it is not a change.
		if p != before.TaskPrefix && !taskPrefixPattern.MatchString(p) {
			return out, Invalid(taskPrefixInvalid)
		}
		out.TaskPrefix = &p
	}
	if in.Slug != nil {
		slug := strings.TrimSpace(*in.Slug)
		// Like the prefix, the slug a workspace already has passes unchecked.
		if slug != before.Slug {
			if err := ValidateSlug(slug); err != nil {
				return out, err
			}
		}
		out.Slug = &slug
	}
	return out, nil
}

// workspaceChanges compares the validated input with the row. from and to
// hold only the fields that change, keyed as the audit diff names them.
func workspaceChanges(before db.Workspace, in UpdateWorkspaceInput) (from, to map[string]any) {
	from, to = map[string]any{}, map[string]any{}
	change := func(key, old, next string) {
		if old != next {
			from[key], to[key] = old, next
		}
	}
	if in.Name != nil {
		change("name", before.Name, *in.Name)
	}
	if in.Description != nil {
		change("description", before.Description, *in.Description)
	}
	if in.IconEmoji != nil {
		change("icon_emoji", before.IconEmoji.String, *in.IconEmoji)
	}
	if in.TaskPrefix != nil {
		change("task_prefix", before.TaskPrefix, *in.TaskPrefix)
	}
	if in.Slug != nil {
		change("slug", before.Slug, *in.Slug)
	}
	return from, to
}

// applyWorkspaceChanges writes the changed fields inside the caller's
// transaction; to holds only fields whose value really changes.
func (s *WorkspaceService) applyWorkspaceChanges(ctx context.Context, q *db.Queries, before db.Workspace, in UpdateWorkspaceInput, to map[string]any) error {
	// before is the locked row. The slug lock comes after the workspace row
	// lock; CreateInOrg takes it too but touches no existing workspace row.
	if _, ok := to["slug"]; ok {
		if err := q.LockWorkspaceSlugs(ctx, before.OrganizationID); err != nil {
			return err
		}
		if err := slugFreeFor(ctx, q, before.OrganizationID, *in.Slug, before.ID); err != nil {
			return err
		}
	}
	// An emoji replaces an uploaded icon, which
	// Update already released (spec 2026-10-14 §5.1).
	if _, ok := to["icon_emoji"]; ok {
		emoji := pgtype.Text{String: *in.IconEmoji, Valid: *in.IconEmoji != ""}
		if _, err := q.SetWorkspaceIcon(ctx, db.SetWorkspaceIconParams{
			ID: before.ID, OrganizationID: before.OrganizationID, IconEmoji: emoji,
		}); err != nil {
			return err
		}
	}
	profile := db.UpdateWorkspaceProfileParams{ID: before.ID, OrganizationID: before.OrganizationID}
	if _, ok := to["name"]; ok {
		profile.Name = pgtype.Text{String: *in.Name, Valid: true}
	}
	if _, ok := to["description"]; ok {
		profile.Description = pgtype.Text{String: *in.Description, Valid: true}
	}
	if _, ok := to["task_prefix"]; ok {
		profile.TaskPrefix = pgtype.Text{String: *in.TaskPrefix, Valid: true}
	}
	if _, ok := to["slug"]; ok {
		profile.Slug = pgtype.Text{String: *in.Slug, Valid: true}
	}
	if profile.Name.Valid || profile.Description.Valid || profile.TaskPrefix.Valid || profile.Slug.Valid {
		if _, err := q.UpdateWorkspaceProfile(ctx, profile); err != nil {
			if isUniqueViolation(err) {
				return ErrConflict
			}
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
	}
	if _, ok := to["task_prefix"]; ok {
		if err := moveWorkspaceAlias(ctx, q, before, "task_prefix", before.TaskPrefix, *in.TaskPrefix); err != nil {
			return err
		}
	}
	if _, ok := to["slug"]; ok {
		if err := moveWorkspaceAlias(ctx, q, before, "slug", before.Slug, *in.Slug); err != nil {
			return err
		}
	}
	return nil
}

// slugFreeFor refuses a slug another workspace of the organization keeps as
// an old slug. The caller holds LockWorkspaceSlugs; current slugs are
// guarded by the unique index on workspaces.
func slugFreeFor(ctx context.Context, q *db.Queries, orgID, slug, workspaceID string) error {
	owner, err := q.GetWorkspaceSlugAliasOwner(ctx, db.GetWorkspaceSlugAliasOwnerParams{OrganizationID: orgID, Value: slug})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if owner != workspaceID {
		return ErrConflict
	}
	return nil
}

// workspaceBySlugs reads the workspace a URL pair names: by its current
// slug, or by an old one it keeps (spec 2026-10-14 §5.3). The row carries
// the current slug either way, so the client can move the URL.
func (s *WorkspaceService) workspaceBySlugs(ctx context.Context, orgSlug, wsSlug string) (db.ListWorkspacesInOrgRow, error) {
	r, err := s.q.GetWorkspaceBySlugs(ctx, db.GetWorkspaceBySlugsParams{Slug: orgSlug, Slug_2: wsSlug})
	if err == nil {
		return db.ListWorkspacesInOrgRow(r), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return db.ListWorkspacesInOrgRow{}, err
	}
	a, err := s.q.GetWorkspaceBySlugAlias(ctx, db.GetWorkspaceBySlugAliasParams{OrgSlug: orgSlug, Value: wsSlug})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.ListWorkspacesInOrgRow{}, ErrNotFound
	}
	return db.ListWorkspacesInOrgRow(a), err
}

// moveWorkspaceAlias keeps the value a workspace is leaving answering for
// it, and drops the alias of the value it takes back (spec 2026-10-14 §4.4).
// Deleting before inserting keeps one row per value.
func moveWorkspaceAlias(ctx context.Context, q *db.Queries, w db.Workspace, kind, from, to string) error {
	for _, v := range []string{to, from} {
		if err := q.DeleteWorkspaceAlias(ctx, db.DeleteWorkspaceAliasParams{
			OrganizationID: w.OrganizationID, WorkspaceID: w.ID, Kind: kind, Value: v,
		}); err != nil {
			return err
		}
	}
	err := q.InsertWorkspaceAlias(ctx, db.InsertWorkspaceAliasParams{
		ID: util.NewID(), OrganizationID: w.OrganizationID, WorkspaceID: w.ID, Kind: kind, Value: from,
	})
	if isUniqueViolation(err) {
		// Only out-of-band data can hold the value under another workspace.
		return ErrConflict
	}
	return err
}

// recordWorkspaceUpdated writes the one audit row and outbox event of a
// workspace-settings change, in the caller's transaction.
func recordWorkspaceUpdated(ctx context.Context, q *db.Queries, userID string, w db.Workspace, from, to map[string]any) error {
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: w.OrganizationID, WorkspaceID: w.ID,
		Actor:        audit.User(userID),
		Action:       audit.ActionWorkspaceUpdated,
		ResourceType: "workspace", ResourceID: w.ID,
		Changes: audit.Diff(from, to),
	}, audit.Event{Topic: "workspace.updated", Payload: map[string]string{
		"workspace_id": w.ID, "organization_id": w.OrganizationID,
	}})
}

func (s *WorkspaceService) Members(ctx context.Context, userID, workspaceID string) ([]db.ListWorkspaceMembersRow, error) {
	if _, err := s.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	rows, err := s.q.ListWorkspaceMembers(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	decorateMemberAvatars(ctx, s.files, rows, func(r db.ListWorkspaceMembersRow) avatarRow {
		return avatarRow{UserID: r.UserID, AvatarURL: r.AvatarUrl, FileID: r.AvatarFileID}
	}, func(r *db.ListWorkspaceMembersRow, url string) {
		r.AvatarUrl = pgtype.Text{String: url, Valid: true}
	})
	return rows, nil
}

const (
	MembershipSourceMembership MembershipSource = "membership"
	MembershipSourceOrgAdmin   MembershipSource = "org_admin"
)

// MembershipSource distinguishes an explicit workspace_members row from an
// org owner/admin who only has effective access via GetWorkspaceAccess.
type MembershipSource string

// CurrentMembership is the caller's effective workspace role and how it was derived.
type CurrentMembership struct {
	UserID string
	Role   string
	Source MembershipSource
}

func (s *WorkspaceService) CurrentMembership(ctx context.Context, userID, workspaceID string) (CurrentMembership, error) {
	eff, err := s.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return CurrentMembership{}, err
	}
	_, err = s.q.GetWorkspaceMember(ctx, db.GetWorkspaceMemberParams{
		WorkspaceID: workspaceID, UserID: userID,
	})
	source := MembershipSourceOrgAdmin
	if err == nil {
		source = MembershipSourceMembership
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return CurrentMembership{}, err
	}
	return CurrentMembership{UserID: userID, Role: eff.Role, Source: source}, nil
}

func adminLikeRole(role string) bool {
	return role == "owner" || role == "admin"
}

// UpdateMemberRole changes a non-owner member's role to admin or member.
func (s *WorkspaceService) UpdateMemberRole(ctx context.Context, actorID, workspaceID, targetUserID, role string) (db.WorkspaceMember, error) {
	actor, err := s.RequireMember(ctx, workspaceID, actorID)
	if err != nil {
		return db.WorkspaceMember{}, err
	}
	if !adminLikeRole(actor.Role) {
		return db.WorkspaceMember{}, ErrForbidden
	}
	if role != "admin" && role != "member" {
		return db.WorkspaceMember{}, Invalid("role phải là admin hoặc member")
	}
	target, err := s.q.GetWorkspaceMember(ctx, db.GetWorkspaceMemberParams{
		WorkspaceID: workspaceID, UserID: targetUserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.WorkspaceMember{}, ErrNotFound
	}
	if err != nil {
		return db.WorkspaceMember{}, err
	}
	if target.Role == "owner" {
		return db.WorkspaceMember{}, ErrForbidden
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.WorkspaceMember{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.WorkspaceMember{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	updated, err := q.UpdateWorkspaceMemberRole(ctx, db.UpdateWorkspaceMemberRoleParams{
		WorkspaceID: workspaceID, UserID: targetUserID, Role: role,
	})
	if err != nil {
		return db.WorkspaceMember{}, err
	}
	if err := syncDefaultChatRoomMembers(ctx, q, workspaceID); err != nil {
		return db.WorkspaceMember{}, err
	}
	if role == "member" && target.Role == "admin" {
		if err := demoteDefaultChatRoomAdmin(ctx, q, workspaceID, targetUserID); err != nil {
			return db.WorkspaceMember{}, err
		}
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor:        audit.User(actorID),
		Action:       audit.ActionWorkspaceMemberRoleChanged,
		ResourceType: "workspace_member", ResourceID: targetUserID,
		Changes: audit.Diff(map[string]any{"role": target.Role}, map[string]any{"role": role}),
	}, audit.Event{Topic: "member.role_changed", Payload: map[string]string{
		"organization_id": ws.OrganizationID, "workspace_id": workspaceID, "user_id": targetUserID,
	}}); err != nil {
		return db.WorkspaceMember{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.WorkspaceMember{}, err
	}
	return updated, nil
}

// RemoveMember deletes an explicit workspace_members row. Explicit owners cannot
// be removed. Any effective member may leave themselves; otherwise the actor
// must be admin-like.
func (s *WorkspaceService) RemoveMember(ctx context.Context, actorID, workspaceID, targetUserID string) error {
	actor, err := s.RequireMember(ctx, workspaceID, actorID)
	if err != nil {
		return err
	}
	target, err := s.q.GetWorkspaceMember(ctx, db.GetWorkspaceMemberParams{
		WorkspaceID: workspaceID, UserID: targetUserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if target.Role == "owner" {
		return ErrForbidden
	}
	if actorID != targetUserID && !adminLikeRole(actor.Role) {
		return ErrForbidden
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	if err := q.DeleteWorkspaceMember(ctx, db.DeleteWorkspaceMemberParams{
		WorkspaceID: workspaceID, UserID: targetUserID,
	}); err != nil {
		return err
	}
	if err := q.LeaveChatRoomsInWorkspaceForUser(ctx, db.LeaveChatRoomsInWorkspaceForUserParams{
		WorkspaceID: pgtype.Text{String: workspaceID, Valid: true}, UserID: targetUserID,
	}); err != nil {
		return err
	}
	if err := syncDefaultChatRoomMembers(ctx, q, workspaceID); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor:        audit.User(actorID),
		Action:       audit.ActionWorkspaceMemberRemoved,
		ResourceType: "workspace_member", ResourceID: targetUserID,
		Metadata: map[string]any{"role": target.Role, "self_service": actorID == targetUserID},
	}, audit.Event{Topic: "member.removed", Payload: map[string]string{
		"organization_id": ws.OrganizationID, "workspace_id": workspaceID, "user_id": targetUserID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// InviteMany: dedupe + lowercase; email sai hoặc đã là thành viên → skipped.
func (s *WorkspaceService) InviteMany(ctx context.Context, userID, workspaceID string, emails []string, role string) ([]db.Invitation, []string, error) {
	m, err := s.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return nil, nil, err
	}
	if m.Role != "owner" && m.Role != "admin" {
		return nil, nil, ErrForbidden
	}
	if err := requireVerifiedEmail(ctx, s.q, userID); err != nil {
		return nil, nil, err
	}
	if role != "admin" && role != "member" {
		return nil, nil, Invalid("role phải là admin hoặc member")
	}
	if len(emails) == 0 {
		return nil, nil, Invalid("cần ít nhất một email")
	}
	if len(emails) > maxInviteBatch {
		return nil, nil, Invalid("tối đa 50 email mỗi lần")
	}
	inviter, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	members, err := s.q.ListWorkspaceMembers(ctx, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	isMember := map[string]bool{}
	for _, mm := range members {
		isMember[strings.ToLower(mm.Email)] = true
	}
	seen := map[string]bool{}
	var invs []db.Invitation
	var skipped []string

	// One transaction for the whole batch: an invitation whose mail was never
	// queued, or whose audit row is missing, is worse than the batch failing.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	for _, raw := range emails {
		email := strings.ToLower(strings.TrimSpace(raw))
		if email == "" || seen[email] {
			continue
		}
		seen[email] = true
		if _, perr := netmail.ParseAddress(email); perr != nil || isMember[email] {
			skipped = append(skipped, email)
			continue
		}
		inv, err := q.CreateInvitation(ctx, db.CreateInvitationParams{
			ID:             util.NewID(),
			OrganizationID: ws.OrganizationID,
			WorkspaceID:    pgtype.Text{String: workspaceID, Valid: true},
			Email:          email, Role: role, OrgRole: OrgRoleMember,
			Token:     util.NewID() + util.NewID(),
			ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(inviteTTL), Valid: true},
			InvitedBy: pgtype.Text{String: userID, Valid: true},
		})
		if err != nil {
			return nil, nil, err
		}
		invs = append(invs, inv)
		msg, err := s.render.Invite(email, inviter.Locale, mail.InviteData{
			InviterName: inviter.DisplayName, WorkspaceName: ws.Name,
			AcceptURL: s.render.AppURL + "/invite/" + inv.Token, Expires: inviteTTL,
		})
		if err != nil {
			return nil, nil, err
		}
		if _, err := s.out.Enqueue(ctx, q, msg); err != nil {
			return nil, nil, err
		}
		// The invitee has no user id yet, so the audited resource is the
		// invitation row; the email lives there and stays out of a table that
		// can never be edited.
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
			Actor:        audit.User(userID),
			Action:       audit.ActionMemberInvited,
			ResourceType: "invitation", ResourceID: inv.ID,
			Changes: audit.Diff(nil, map[string]any{"role": role}),
		}, audit.Event{Topic: "member.invited", Payload: map[string]string{
			"organization_id": ws.OrganizationID, "workspace_id": workspaceID, "invitation_id": inv.ID,
		}}); err != nil {
			return nil, nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	if len(invs) > 0 {
		s.out.Kick()
	}
	return invs, skipped, nil
}

// PendingInvitations hands out the tokens of the invitations sent to the
// caller's address, so the address must be proven first: otherwise anyone who
// registers an invitee's email before they do reads the token here.
//
// Each carries the workspaces it grants (UNI-1582), so the person sees where
// accepting it leads before opening it.
func (s *WorkspaceService) PendingInvitations(ctx context.Context, userID string) ([]MyInvitation, error) {
	if err := requireVerifiedEmail(ctx, s.q, userID); err != nil {
		return nil, err
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListInvitationsForEmail(ctx, u.Email)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(rows))
	orgIDs := make([]string, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
		orgIDs = append(orgIDs, r.OrganizationID)
	}
	granted, err := invitationGrants(ctx, s.q, ids, orgIDs)
	if err != nil {
		return nil, err
	}
	out := make([]MyInvitation, 0, len(rows))
	for _, r := range rows {
		inv := MyInvitation{ListInvitationsForEmailRow: r, Workspaces: granted[r.ID]}
		if r.WorkspaceID.Valid {
			inv.Workspaces = []WorkspaceRef{{ID: r.WorkspaceID.String, Name: r.WorkspaceName.String, Slug: r.WorkspaceSlug.String}}
		}
		if inv.Workspaces == nil {
			inv.Workspaces = []WorkspaceRef{}
		}
		out = append(out, inv)
	}
	return out, nil
}

// MyInvitation is one invitation waiting for the caller, with the workspaces
// accepting it grants.
type MyInvitation struct {
	db.ListInvitationsForEmailRow
	Workspaces []WorkspaceRef
}

// OrganizationOf names the organization a workspace belongs to. The realtime
// hub uses it to put a connection into its organization scope without the
// client having to say which organization it is in.
func (s *WorkspaceService) OrganizationOf(ctx context.Context, workspaceID string) (string, error) {
	w, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return "", err
	}
	return w.OrganizationID, nil
}
