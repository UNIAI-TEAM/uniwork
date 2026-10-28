package service

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// membershipInviteKey derives copyable secrets for membership invite links
// the same way meeting invite links do: only the hash is stored.
var membershipInviteKey []byte

// SetMembershipInviteKey wires the HMAC key used to re-derive an invite
// link's secret after create (UNI-2226). main passes JWTSecret.
func SetMembershipInviteKey(key []byte) { membershipInviteKey = append([]byte(nil), key...) }

const (
	membershipInviteLinkTTLDefault = 7 * 24 * time.Hour
	membershipInviteLinkTTLMax     = 30 * 24 * time.Hour
	membershipInviteLinkTTLMin     = 24 * time.Hour
)

func hashMembershipInviteSecret(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func newMembershipInviteSecret() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func membershipInviteSecretFor(linkID string) string {
	sub := hmac.New(sha256.New, membershipInviteKey)
	sub.Write([]byte("uw-membership-invite-link-key/v1"))
	mac := hmac.New(sha256.New, sub.Sum(nil))
	mac.Write([]byte(linkID))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func mintMembershipInviteSecret(linkID string) (string, error) {
	if len(membershipInviteKey) == 0 {
		return newMembershipInviteSecret()
	}
	return membershipInviteSecretFor(linkID), nil
}

func membershipInviteLinkStatus(revoked, expires pgtype.Timestamptz, now time.Time) string {
	if revoked.Valid {
		return "revoked"
	}
	if expires.Valid && !expires.Time.After(now) {
		return "expired"
	}
	return "active"
}

func errInviteLinkInvalid() error {
	return coded(http.StatusNotFound, "invite_link_invalid", "liên kết mời không hợp lệ")
}

func errInviteLinkExpired() error {
	return coded(http.StatusGone, "invite_link_expired", "liên kết mời đã hết hạn")
}

func errInviteLinkRevoked() error {
	return coded(http.StatusGone, "invite_link_revoked", "liên kết mời đã bị thu hồi")
}

func errInviteLinkInactive() error {
	return coded(http.StatusBadRequest, "invite_link_inactive", "chỉ thu hồi hoặc tạo lại liên kết còn hiệu lực")
}

func resolveInviteExpiry(expiresIn *time.Duration) (time.Time, error) {
	ttl := membershipInviteLinkTTLDefault
	if expiresIn != nil {
		ttl = *expiresIn
	}
	if ttl < membershipInviteLinkTTLMin || ttl > membershipInviteLinkTTLMax {
		return time.Time{}, Invalid("thời hạn liên kết phải từ 1 đến 30 ngày")
	}
	return time.Now().UTC().Add(ttl), nil
}

// MembershipInviteLinkView is what a manager sees after create/list.
type MembershipInviteLinkView struct {
	Link       db.MembershipInviteLink
	Secret     string
	Status     string
	Workspaces []WorkspaceRef
}

// MembershipInvitePreview is what a signed-in person sees before Join.
type MembershipInvitePreview struct {
	LinkID           string
	Status           string
	OrganizationID   string
	OrganizationName string
	OrganizationSlug string
	Workspaces       []MembershipInviteWorkspaceState
	// NeedsJoin is true when at least one linked workspace is missing.
	NeedsJoin bool
	// AlreadyMember is true when the person already holds every linked workspace.
	AlreadyMember bool
	Conflicts     []MembershipConflict
}

// MembershipInviteWorkspaceState is one workspace on the join screen.
type MembershipInviteWorkspaceState struct {
	WorkspaceRef
	Joined bool
}

// MembershipInviteJoinResult is the landing after a successful join (or when
// the person already held every workspace).
type MembershipInviteJoinResult struct {
	Organization db.Organization
	Workspace    *WorkspaceView
	JoinedIDs    []string
	AlreadyAll   bool
}

func listedMembershipSecret(link db.MembershipInviteLink, now time.Time) string {
	if membershipInviteLinkStatus(link.RevokedAt, link.ExpiresAt, now) != "active" {
		return ""
	}
	if len(membershipInviteKey) == 0 {
		return ""
	}
	raw := membershipInviteSecretFor(link.ID)
	if subtle.ConstantTimeCompare([]byte(hashMembershipInviteSecret(raw)), []byte(link.SecretHash)) != 1 {
		return ""
	}
	return raw
}

func (s *WorkspaceService) attachLinkWorkspaces(ctx context.Context, links []db.MembershipInviteLink) (map[string][]WorkspaceRef, error) {
	out := map[string][]WorkspaceRef{}
	if len(links) == 0 {
		return out, nil
	}
	ids := make([]string, 0, len(links))
	orgIDs := make([]string, 0, len(links))
	seenOrg := map[string]bool{}
	for _, l := range links {
		ids = append(ids, l.ID)
		if !seenOrg[l.OrganizationID] {
			seenOrg[l.OrganizationID] = true
			orgIDs = append(orgIDs, l.OrganizationID)
		}
		if l.WorkspaceID.Valid {
			ws, err := s.q.GetWorkspaceByID(ctx, l.WorkspaceID.String)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					continue
				}
				return nil, err
			}
			out[l.ID] = []WorkspaceRef{{ID: ws.ID, Name: ws.Name, Slug: ws.Slug}}
		}
	}
	rows, err := s.q.ListMembershipInviteLinkWorkspaces(ctx, db.ListMembershipInviteLinkWorkspacesParams{
		LinkIds: ids, OrganizationIds: orgIDs,
	})
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.LinkID] = append(out[r.LinkID], WorkspaceRef{ID: r.ID, Name: r.Name, Slug: r.Slug})
	}
	return out, nil
}

func toMembershipInviteViews(links []db.MembershipInviteLink, grants map[string][]WorkspaceRef, now time.Time) []MembershipInviteLinkView {
	out := make([]MembershipInviteLinkView, 0, len(links))
	for _, l := range links {
		ws := grants[l.ID]
		if ws == nil {
			ws = []WorkspaceRef{}
		}
		out = append(out, MembershipInviteLinkView{
			Link: l, Secret: listedMembershipSecret(l, now),
			Status: membershipInviteLinkStatus(l.RevokedAt, l.ExpiresAt, now), Workspaces: ws,
		})
	}
	return out
}

// CreateWorkspaceInviteLink makes (or regenerates into) a shareable link for
// one workspace. Role is always Member (FR-01 BR-03).
func (s *WorkspaceService) CreateWorkspaceInviteLink(ctx context.Context, userID, workspaceID string, expiresIn *time.Duration) (MembershipInviteLinkView, error) {
	m, err := s.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return MembershipInviteLinkView{}, err
	}
	if m.Role != "owner" && m.Role != "admin" {
		return MembershipInviteLinkView{}, ErrForbidden
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return MembershipInviteLinkView{}, err
	}
	expiresAt, err := resolveInviteExpiry(expiresIn)
	if err != nil {
		return MembershipInviteLinkView{}, err
	}
	return s.createMembershipInviteLink(ctx, userID, ws.OrganizationID, &workspaceID, nil, expiresAt)
}

// ListWorkspaceInviteLinks returns every link for the workspace (newest first).
func (s *WorkspaceService) ListWorkspaceInviteLinks(ctx context.Context, userID, workspaceID string) ([]MembershipInviteLinkView, error) {
	m, err := s.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return nil, err
	}
	if m.Role != "owner" && m.Role != "admin" {
		return nil, ErrForbidden
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	links, err := s.q.ListWorkspaceMembershipInviteLinks(ctx, db.ListWorkspaceMembershipInviteLinksParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: pgtype.Text{String: workspaceID, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	grants, err := s.attachLinkWorkspaces(ctx, links)
	if err != nil {
		return nil, err
	}
	return toMembershipInviteViews(links, grants, time.Now()), nil
}

// CreateOrganizationInviteLink makes a shareable link for the organization
// that grants the chosen workspaces (at least one).
func (s *OrganizationMemberService) CreateOrganizationInviteLink(ctx context.Context, actorID, orgID string, workspaceIDs []string, expiresIn *time.Duration) (MembershipInviteLinkView, error) {
	if _, err := s.requireAdmin(ctx, orgID, actorID); err != nil {
		return MembershipInviteLinkView{}, err
	}
	grants, err := grantableWorkspaces(ctx, s.q, orgID, workspaceIDs)
	if err != nil {
		return MembershipInviteLinkView{}, err
	}
	if len(grants) == 0 {
		return MembershipInviteLinkView{}, Invalid("cần chọn ít nhất một workspace")
	}
	expiresAt, err := resolveInviteExpiry(expiresIn)
	if err != nil {
		return MembershipInviteLinkView{}, err
	}
	ids := refIDList(grants)
	view, err := s.wsCreate(ctx, actorID, orgID, nil, ids, expiresAt)
	if err != nil {
		return MembershipInviteLinkView{}, err
	}
	view.Workspaces = grants
	return view, nil
}

// ListOrganizationInviteLinks lists org-scoped invite links.
func (s *OrganizationMemberService) ListOrganizationInviteLinks(ctx context.Context, actorID, orgID string) ([]MembershipInviteLinkView, error) {
	if _, err := s.requireAdmin(ctx, orgID, actorID); err != nil {
		return nil, err
	}
	links, err := s.q.ListOrganizationMembershipInviteLinks(ctx, orgID)
	if err != nil {
		return nil, err
	}
	grants, err := s.listLinkWorkspaces(ctx, links)
	if err != nil {
		return nil, err
	}
	return toMembershipInviteViews(links, grants, time.Now()), nil
}

func (s *OrganizationMemberService) listLinkWorkspaces(ctx context.Context, links []db.MembershipInviteLink) (map[string][]WorkspaceRef, error) {
	out := map[string][]WorkspaceRef{}
	if len(links) == 0 {
		return out, nil
	}
	ids := make([]string, len(links))
	orgIDs := make([]string, 0, 1)
	seen := map[string]bool{}
	for i, l := range links {
		ids[i] = l.ID
		if !seen[l.OrganizationID] {
			seen[l.OrganizationID] = true
			orgIDs = append(orgIDs, l.OrganizationID)
		}
	}
	rows, err := s.q.ListMembershipInviteLinkWorkspaces(ctx, db.ListMembershipInviteLinkWorkspacesParams{
		LinkIds: ids, OrganizationIds: orgIDs,
	})
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.LinkID] = append(out[r.LinkID], WorkspaceRef{ID: r.ID, Name: r.Name, Slug: r.Slug})
	}
	return out, nil
}

// wsCreate is shared create used by OrganizationMemberService without a
// WorkspaceService receiver (HMAC + insert + audit).
func (s *OrganizationMemberService) wsCreate(ctx context.Context, actorID, orgID string, workspaceID *string, grantIDs []string, expiresAt time.Time) (MembershipInviteLinkView, error) {
	return createMembershipInviteLinkRows(ctx, s.pool, s.q, actorID, orgID, workspaceID, grantIDs, expiresAt)
}

func (s *WorkspaceService) createMembershipInviteLink(ctx context.Context, actorID, orgID string, workspaceID *string, grantIDs []string, expiresAt time.Time) (MembershipInviteLinkView, error) {
	return createMembershipInviteLinkRows(ctx, s.pool, s.q, actorID, orgID, workspaceID, grantIDs, expiresAt)
}

func createMembershipInviteLinkRows(ctx context.Context, pool *pgxpool.Pool, q *db.Queries, actorID, orgID string, workspaceID *string, grantIDs []string, expiresAt time.Time) (MembershipInviteLinkView, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return MembershipInviteLinkView{}, err
	}
	defer tx.Rollback(ctx)
	qtx := q.WithTx(tx)

	id := util.NewID()
	raw, err := mintMembershipInviteSecret(id)
	if err != nil {
		return MembershipInviteLinkView{}, err
	}
	var wsID pgtype.Text
	if workspaceID != nil {
		wsID = pgtype.Text{String: *workspaceID, Valid: true}
	}
	link, err := qtx.CreateMembershipInviteLink(ctx, db.CreateMembershipInviteLinkParams{
		ID: id, OrganizationID: orgID, WorkspaceID: wsID,
		SecretHash: hashMembershipInviteSecret(raw),
		OrgRole:    OrgRoleMember, WorkspaceRole: grantedWorkspaceRole,
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
		CreatedBy: actorID, CreatedByKind: string(audit.KindHuman),
	})
	if err != nil {
		return MembershipInviteLinkView{}, err
	}
	for _, gid := range grantIDs {
		if err := qtx.AddMembershipInviteLinkWorkspace(ctx, db.AddMembershipInviteLinkWorkspaceParams{
			LinkID: link.ID, WorkspaceID: gid, OrganizationID: orgID,
		}); err != nil {
			return MembershipInviteLinkView{}, err
		}
	}
	meta := map[string]any{"expires_at": expiresAt.UTC().Format(time.RFC3339)}
	if workspaceID != nil {
		meta["workspace_id"] = *workspaceID
	}
	if len(grantIDs) > 0 {
		meta["workspace_ids"] = grantIDs
	}
	entry := audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionMembershipInviteLinkCreated,
		ResourceType:   "membership_invite_link", ResourceID: link.ID,
		Changes: audit.Diff(nil, meta),
	}
	if workspaceID != nil {
		entry.WorkspaceID = *workspaceID
	}
	if err := auditRecorder.Record(ctx, qtx, entry); err != nil {
		return MembershipInviteLinkView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return MembershipInviteLinkView{}, err
	}
	refs := make([]WorkspaceRef, 0, len(grantIDs))
	if workspaceID != nil {
		if ws, err := q.GetWorkspaceByID(ctx, *workspaceID); err == nil {
			refs = []WorkspaceRef{{ID: ws.ID, Name: ws.Name, Slug: ws.Slug}}
		}
	}
	return MembershipInviteLinkView{
		Link: link, Secret: raw, Status: "active", Workspaces: refs,
	}, nil
}

// RevokeWorkspaceInviteLink disables an active workspace invite link.
func (s *WorkspaceService) RevokeWorkspaceInviteLink(ctx context.Context, userID, workspaceID, linkID string) (MembershipInviteLinkView, error) {
	m, err := s.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return MembershipInviteLinkView{}, err
	}
	if m.Role != "owner" && m.Role != "admin" {
		return MembershipInviteLinkView{}, ErrForbidden
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return MembershipInviteLinkView{}, err
	}
	return s.revokeMembershipInviteLink(ctx, userID, ws.OrganizationID, linkID, &workspaceID)
}

// RevokeOrganizationInviteLink disables an active org invite link.
func (s *OrganizationMemberService) RevokeOrganizationInviteLink(ctx context.Context, actorID, orgID, linkID string) (MembershipInviteLinkView, error) {
	if _, err := s.requireAdmin(ctx, orgID, actorID); err != nil {
		return MembershipInviteLinkView{}, err
	}
	return revokeMembershipInviteLinkRows(ctx, s.q, actorID, orgID, linkID, nil)
}

func (s *WorkspaceService) revokeMembershipInviteLink(ctx context.Context, actorID, orgID, linkID string, workspaceID *string) (MembershipInviteLinkView, error) {
	return revokeMembershipInviteLinkRows(ctx, s.q, actorID, orgID, linkID, workspaceID)
}

func revokeMembershipInviteLinkRows(ctx context.Context, q *db.Queries, actorID, orgID, linkID string, workspaceID *string) (MembershipInviteLinkView, error) {
	existing, err := q.GetMembershipInviteLink(ctx, linkID)
	if errors.Is(err, pgx.ErrNoRows) {
		return MembershipInviteLinkView{}, ErrNotFound
	}
	if err != nil {
		return MembershipInviteLinkView{}, err
	}
	if existing.OrganizationID != orgID {
		return MembershipInviteLinkView{}, ErrNotFound
	}
	if workspaceID != nil {
		if !existing.WorkspaceID.Valid || existing.WorkspaceID.String != *workspaceID {
			return MembershipInviteLinkView{}, ErrNotFound
		}
	} else if existing.WorkspaceID.Valid {
		return MembershipInviteLinkView{}, ErrNotFound
	}
	if membershipInviteLinkStatus(existing.RevokedAt, existing.ExpiresAt, time.Now()) != "active" {
		return MembershipInviteLinkView{}, errInviteLinkInactive()
	}
	link, err := q.RevokeMembershipInviteLink(ctx, db.RevokeMembershipInviteLinkParams{
		ID: linkID, RevokedBy: pgtype.Text{String: actorID, Valid: true}, OrganizationID: orgID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return MembershipInviteLinkView{}, errInviteLinkInactive()
	}
	if err != nil {
		return MembershipInviteLinkView{}, err
	}
	entry := audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionMembershipInviteLinkRevoked,
		ResourceType:   "membership_invite_link", ResourceID: link.ID,
	}
	if workspaceID != nil {
		entry.WorkspaceID = *workspaceID
	}
	if err := auditRecorder.Record(ctx, q, entry); err != nil {
		return MembershipInviteLinkView{}, err
	}
	return MembershipInviteLinkView{Link: link, Status: "revoked", Workspaces: []WorkspaceRef{}}, nil
}

// RegenerateWorkspaceInviteLink revokes the active link (when present) and
// creates a new one for the same workspace.
func (s *WorkspaceService) RegenerateWorkspaceInviteLink(ctx context.Context, userID, workspaceID string, expiresIn *time.Duration) (MembershipInviteLinkView, error) {
	links, err := s.ListWorkspaceInviteLinks(ctx, userID, workspaceID)
	if err != nil {
		return MembershipInviteLinkView{}, err
	}
	for _, l := range links {
		if l.Status == "active" {
			if _, err := s.RevokeWorkspaceInviteLink(ctx, userID, workspaceID, l.Link.ID); err != nil {
				return MembershipInviteLinkView{}, err
			}
			break
		}
	}
	return s.CreateWorkspaceInviteLink(ctx, userID, workspaceID, expiresIn)
}

// RegenerateOrganizationInviteLink revokes one active org link and creates a
// replacement that keeps the same workspace grants.
func (s *OrganizationMemberService) RegenerateOrganizationInviteLink(ctx context.Context, actorID, orgID, linkID string, expiresIn *time.Duration) (MembershipInviteLinkView, error) {
	links, err := s.ListOrganizationInviteLinks(ctx, actorID, orgID)
	if err != nil {
		return MembershipInviteLinkView{}, err
	}
	var grants []string
	found := false
	for _, l := range links {
		if l.Link.ID != linkID {
			continue
		}
		found = true
		if l.Status != "active" {
			return MembershipInviteLinkView{}, errInviteLinkInactive()
		}
		grants = refIDList(l.Workspaces)
		break
	}
	if !found {
		return MembershipInviteLinkView{}, ErrNotFound
	}
	if _, err := s.RevokeOrganizationInviteLink(ctx, actorID, orgID, linkID); err != nil {
		return MembershipInviteLinkView{}, err
	}
	return s.CreateOrganizationInviteLink(ctx, actorID, orgID, grants, expiresIn)
}

func (s *WorkspaceService) loadInviteLinkTargets(ctx context.Context, link db.MembershipInviteLink) ([]WorkspaceRef, error) {
	if link.WorkspaceID.Valid {
		ws, err := s.q.GetWorkspaceByID(ctx, link.WorkspaceID.String)
		if errors.Is(err, pgx.ErrNoRows) {
			return []WorkspaceRef{}, nil
		}
		if err != nil {
			return nil, err
		}
		return []WorkspaceRef{{ID: ws.ID, Name: ws.Name, Slug: ws.Slug}}, nil
	}
	rows, err := s.q.ListMembershipInviteLinkWorkspaces(ctx, db.ListMembershipInviteLinkWorkspacesParams{
		LinkIds: []string{link.ID}, OrganizationIds: []string{link.OrganizationID},
	})
	if err != nil {
		return nil, err
	}
	out := make([]WorkspaceRef, 0, len(rows))
	for _, r := range rows {
		out = append(out, WorkspaceRef{ID: r.ID, Name: r.Name, Slug: r.Slug})
	}
	return out, nil
}

func verifyMembershipInviteSecret(link db.MembershipInviteLink, secret string) bool {
	if secret == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(hashMembershipInviteSecret(secret)), []byte(link.SecretHash)) == 1
}

// PreviewMembershipInviteLink tells a signed-in person what the link would do.
func (s *WorkspaceService) PreviewMembershipInviteLink(ctx context.Context, userID, linkID, secret string) (MembershipInvitePreview, error) {
	link, err := s.q.GetMembershipInviteLink(ctx, linkID)
	if errors.Is(err, pgx.ErrNoRows) {
		return MembershipInvitePreview{}, errInviteLinkInvalid()
	}
	if err != nil {
		return MembershipInvitePreview{}, err
	}
	if !verifyMembershipInviteSecret(link, secret) {
		return MembershipInvitePreview{}, errInviteLinkInvalid()
	}
	org, err := s.q.GetOrganizationByID(ctx, link.OrganizationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return MembershipInvitePreview{}, errInviteLinkInvalid()
	}
	if err != nil {
		return MembershipInvitePreview{}, err
	}
	targets, err := s.loadInviteLinkTargets(ctx, link)
	if err != nil {
		return MembershipInvitePreview{}, err
	}
	now := time.Now()
	status := membershipInviteLinkStatus(link.RevokedAt, link.ExpiresAt, now)
	states := make([]MembershipInviteWorkspaceState, 0, len(targets))
	joinedAll := len(targets) > 0
	needsJoin := false
	for _, t := range targets {
		_, merr := s.RequireMember(ctx, t.ID, userID)
		joined := merr == nil
		if !joined {
			joinedAll = false
			needsJoin = true
		}
		states = append(states, MembershipInviteWorkspaceState{WorkspaceRef: t, Joined: joined})
	}
	if len(targets) == 0 {
		joinedAll = false
		needsJoin = status == "active"
	}
	preview := MembershipInvitePreview{
		LinkID: link.ID, Status: status,
		OrganizationID: org.ID, OrganizationName: org.Name, OrganizationSlug: org.Slug,
		Workspaces: states, NeedsJoin: needsJoin && status == "active", AlreadyMember: joinedAll,
	}
	if status == "active" && needsJoin {
		_, conflicts, cerr := s.joinConflicts(ctx, s.q, org.ID, userID)
		if cerr != nil {
			return MembershipInvitePreview{}, cerr
		}
		preview.Conflicts = conflicts
	}
	return preview, nil
}

// JoinMembershipInviteLink adds the person to the organization (when needed)
// and every linked workspace they do not already hold. An expired/revoked
// link never grants new membership; a person who already holds every
// workspace still gets a landing workspace.
func (s *WorkspaceService) JoinMembershipInviteLink(ctx context.Context, userID, linkID, secret string, resolve []SwitchResolution) (MembershipInviteJoinResult, error) {
	preview, err := s.PreviewMembershipInviteLink(ctx, userID, linkID, secret)
	if err != nil {
		return MembershipInviteJoinResult{}, err
	}
	if preview.AlreadyMember {
		landing, lerr := s.landingFromPreview(ctx, userID, preview)
		if lerr != nil {
			return MembershipInviteJoinResult{}, lerr
		}
		org, oerr := s.q.GetOrganizationByID(ctx, preview.OrganizationID)
		if oerr != nil {
			return MembershipInviteJoinResult{}, oerr
		}
		return MembershipInviteJoinResult{Organization: org, Workspace: landing, AlreadyAll: true}, nil
	}
	if preview.Status == "expired" {
		return MembershipInviteJoinResult{}, errInviteLinkExpired()
	}
	if preview.Status == "revoked" {
		return MembershipInviteJoinResult{}, errInviteLinkRevoked()
	}
	if !preview.NeedsJoin {
		return MembershipInviteJoinResult{}, errInviteLinkInvalid()
	}

	out, err := s.joinViaMembershipInviteLink(ctx, userID, linkID, secret, resolve)
	if errors.Is(err, errSwitchStale) {
		_, conflicts, cerr := s.joinConflicts(ctx, s.q, preview.OrganizationID, userID)
		if cerr != nil {
			return MembershipInviteJoinResult{}, cerr
		}
		return MembershipInviteJoinResult{}, errOrganizationSwitchRequired(conflicts)
	}
	if err != nil {
		return MembershipInviteJoinResult{}, lockRaceAsBusy(err)
	}
	landing, err := s.landingFromJoined(ctx, userID, out.org.ID, out.joinedIDs)
	if err != nil {
		return MembershipInviteJoinResult{}, err
	}
	cleanUpEmailHubAccountsAfterCommit(ctx, s.q, s.members.emailHub, out.mailboxes)
	return MembershipInviteJoinResult{Organization: out.org, Workspace: landing, JoinedIDs: out.joinedIDs}, nil
}

func (s *WorkspaceService) landingFromPreview(ctx context.Context, userID string, preview MembershipInvitePreview) (*WorkspaceView, error) {
	for _, w := range preview.Workspaces {
		if !w.Joined {
			continue
		}
		view, err := s.viewWithIcon(ctx, userID, w.ID)
		if err == nil {
			return &view, nil
		}
		if !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
			return nil, err
		}
	}
	return nil, nil
}

func (s *WorkspaceService) landingFromJoined(ctx context.Context, userID, orgID string, joinedIDs []string) (*WorkspaceView, error) {
	for _, id := range joinedIDs {
		view, err := s.viewWithIcon(ctx, userID, id)
		if err == nil {
			return &view, nil
		}
		if !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
			return nil, err
		}
	}
	all, err := s.ListForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].Workspace.OrganizationID == orgID {
			return &all[i], nil
		}
	}
	return nil, nil
}

type membershipInviteJoinOutcome struct {
	org       db.Organization
	joinedIDs []string
	mailboxes []db.DisconnectEmailHubAccountsForUserRow
}

func (s *WorkspaceService) joinViaMembershipInviteLink(ctx context.Context, userID, linkID, secret string, resolve []SwitchResolution) (membershipInviteJoinOutcome, error) {
	if len(resolve) > 0 {
		for _, r := range resolve {
			if r.Action == SwitchActionTransfer {
				if err := s.members.stepUp.proveOwner(ctx, userID, OwnerProof{StepUpToken: r.StepUpToken, Password: r.Password}); err != nil {
					return membershipInviteJoinOutcome{}, err
				}
				break
			}
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return membershipInviteJoinOutcome{}, err
	}
	defer tx.Rollback(ctx)
	qtx := s.q.WithTx(tx)

	if err := lockMembership(ctx, qtx, userID); err != nil {
		return membershipInviteJoinOutcome{}, err
	}
	link, err := qtx.LockMembershipInviteLink(ctx, linkID)
	if errors.Is(err, pgx.ErrNoRows) {
		return membershipInviteJoinOutcome{}, errInviteLinkInvalid()
	}
	if err != nil {
		return membershipInviteJoinOutcome{}, err
	}
	if !verifyMembershipInviteSecret(link, secret) {
		return membershipInviteJoinOutcome{}, errInviteLinkInvalid()
	}
	if membershipInviteLinkStatus(link.RevokedAt, link.ExpiresAt, time.Now()) != "active" {
		if link.RevokedAt.Valid {
			return membershipInviteJoinOutcome{}, errInviteLinkRevoked()
		}
		return membershipInviteJoinOutcome{}, errInviteLinkExpired()
	}
	org, locked, err := lockOrganizations(ctx, qtx, userID, link.OrganizationID)
	if err != nil {
		return membershipInviteJoinOutcome{}, err
	}
	if err := admitsNewMembers(org); err != nil {
		return membershipInviteJoinOutcome{}, err
	}

	targets, err := s.loadInviteLinkTargetsTx(ctx, qtx, link)
	if err != nil {
		return membershipInviteJoinOutcome{}, err
	}
	if len(targets) == 0 {
		return membershipInviteJoinOutcome{}, errInviteLinkInvalid()
	}

	isNewMember, conflicts, err := s.joinConflicts(ctx, qtx, org.ID, userID)
	if err != nil {
		return membershipInviteJoinOutcome{}, err
	}
	plan, ok := matchResolution(userID, conflicts, resolve)
	if !ok {
		return membershipInviteJoinOutcome{}, errOrganizationSwitchRequired(conflicts)
	}
	mailboxes, err := s.giveUp(ctx, qtx, userID, conflicts, plan, locked)
	if err != nil {
		return membershipInviteJoinOutcome{}, err
	}
	if isNewMember {
		if err := s.ent.Consume(ctx, qtx, ConsumeInput{OrganizationID: org.ID, Meter: FeatureMembersMax, Delta: 1, Actor: Human(userID)}); err != nil {
			return membershipInviteJoinOutcome{}, err
		}
	}
	if err := qtx.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
		OrganizationID: org.ID, UserID: userID, Role: OrgRoleMember,
	}); err != nil {
		return membershipInviteJoinOutcome{}, err
	}
	joiner, err := qtx.GetUserByID(ctx, userID)
	if err != nil {
		return membershipInviteJoinOutcome{}, err
	}
	if err := ensureMemberProfile(ctx, qtx, org.ID, userID, joiner.DisplayName, joiner.Email); err != nil {
		return membershipInviteJoinOutcome{}, err
	}

	joined := make([]string, 0, len(targets))
	for _, t := range targets {
		if _, merr := s.RequireMemberQ(ctx, qtx, t.ID, userID); merr == nil {
			continue
		}
		if err := qtx.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
			WorkspaceID: t.ID, OrganizationID: org.ID, UserID: userID, Role: grantedWorkspaceRole,
		}); err != nil {
			return membershipInviteJoinOutcome{}, err
		}
		if err := syncDefaultChatRoomMembers(ctx, qtx, t.ID); err != nil {
			return membershipInviteJoinOutcome{}, err
		}
		if err := auditRecorder.Record(ctx, qtx, audit.Entry{
			OrganizationID: org.ID, WorkspaceID: t.ID,
			Actor:        audit.User(userID),
			Action:       audit.ActionMemberJoined,
			ResourceType: "workspace_member", ResourceID: userID,
			Changes:  audit.Diff(nil, map[string]any{"role": grantedWorkspaceRole}),
			Metadata: map[string]any{"invite_link_id": link.ID},
		}, audit.Event{Topic: "member.joined", Payload: map[string]string{
			"organization_id": org.ID, "workspace_id": t.ID, "user_id": userID,
		}}); err != nil {
			return membershipInviteJoinOutcome{}, err
		}
		joined = append(joined, t.ID)
	}
	if isNewMember {
		if err := auditRecorder.Record(ctx, qtx, audit.Entry{
			OrganizationID: org.ID,
			Actor:          audit.User(userID),
			Action:         audit.ActionMemberJoined,
			ResourceType:   "organization_member", ResourceID: userID,
			Changes:  audit.Diff(nil, map[string]any{"role": OrgRoleMember}),
			Metadata: map[string]any{"invite_link_id": link.ID, "workspace_ids": joined},
		}, audit.Event{Topic: "member.joined", Payload: map[string]string{
			"organization_id": org.ID, "user_id": userID,
		}}); err != nil {
			return membershipInviteJoinOutcome{}, err
		}
	}
	if _, err := qtx.MarkUserOnboarded(ctx, userID); err != nil {
		return membershipInviteJoinOutcome{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return membershipInviteJoinOutcome{}, err
	}
	return membershipInviteJoinOutcome{org: org, joinedIDs: joined, mailboxes: mailboxes}, nil
}

func (s *WorkspaceService) loadInviteLinkTargetsTx(ctx context.Context, q *db.Queries, link db.MembershipInviteLink) ([]WorkspaceRef, error) {
	if link.WorkspaceID.Valid {
		ws, err := q.GetWorkspaceByID(ctx, link.WorkspaceID.String)
		if errors.Is(err, pgx.ErrNoRows) {
			return []WorkspaceRef{}, nil
		}
		if err != nil {
			return nil, err
		}
		if ws.OrganizationID != link.OrganizationID {
			return []WorkspaceRef{}, nil
		}
		return []WorkspaceRef{{ID: ws.ID, Name: ws.Name, Slug: ws.Slug}}, nil
	}
	rows, err := q.ListMembershipInviteLinkWorkspaces(ctx, db.ListMembershipInviteLinkWorkspacesParams{
		LinkIds: []string{link.ID}, OrganizationIds: []string{link.OrganizationID},
	})
	if err != nil {
		return nil, err
	}
	out := make([]WorkspaceRef, 0, len(rows))
	for _, r := range rows {
		out = append(out, WorkspaceRef{ID: r.ID, Name: r.Name, Slug: r.Slug})
	}
	return out, nil
}
