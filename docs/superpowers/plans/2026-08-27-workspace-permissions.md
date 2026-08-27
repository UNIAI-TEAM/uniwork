# Workspace Permissions Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose effective workspace role to the FE and add remove-member / change-role APIs + UI so admin surfaces match the Go gates (including implicit org admin).

**Architecture:** Keep `WorkspaceService.RequireMember` / `GetWorkspaceAccess` as the single membership formula. Add `GET /workspaces/{id}/me`, `PATCH|DELETE …/members/{userId}` in the service layer; FE `useCurrentMember` switches to `/me`; pure rules in `packages/core/permissions/rules.ts` mirror the new gates; Settings Members tab gains role select + remove.

**Tech Stack:** Go (Chi, pgx, sqlc), React Query, Zod `parseWithFallback`, Vitest, existing `packages/core/permissions`.

**Spec:** `docs/superpowers/specs/2026-08-27-workspace-permissions-design.md`

## Global Constraints

- No `FOREIGN KEY` / cascading deletes; member cleanup is explicit SQL in the service.
- Every workspace query still filters by membership via `RequireMember` (handlers never decide membership).
- Frontend must survive response drift: new endpoints use `parseWithFallback` + malformed-response tests.
- `packages/views/` — every JSX string through `t()`; vi/en parity.
- No `multica` / usf leak in source (`scripts/no-usf-leak.test.mjs`).
- Out of scope this plan: transfer ownership, delete workspace, comment authorship wired on Tasks UI, Issues, Public API.
- Conventional commits; do not commit unless the user asks mid-execution (plan steps still show commit messages for when asked).

## File map

| Path | Responsibility |
|------|----------------|
| `server/pkg/db/queries/workspaces.sql` | `UpdateWorkspaceMemberRole`, `DeleteWorkspaceMember` |
| `server/pkg/db/generated/*` | sqlc regenerate |
| `server/internal/service/workspace.go` | `CurrentMembership`, `UpdateMemberRole`, `RemoveMember` |
| `server/internal/service/workspace_test.go` | Service tests for me / role / remove |
| `server/internal/handler/workspace.go` | `getWorkspaceMe`, `patchMember`, `deleteMember` |
| `server/internal/handler/router.go` | Register three routes |
| `packages/core/types/workspace.ts` | `WorkspaceMembership` type + schema |
| `packages/core/api/endpoints/workspaces.ts` | `getMyMembership`, `updateMemberRole`, `removeMember` |
| `packages/core/api/endpoints/workspaces.test.ts` | Malformed-response cases |
| `packages/core/permissions/rules.ts` | `canRemoveMember`, `canChangeMemberRole`, comment stubs |
| `packages/core/permissions/rules.test.ts` | Rule unit tests |
| `packages/core/permissions/use-current-member.ts` | Read `/me` for effective role |
| `packages/core/permissions/use-resource-permissions.ts` | Expose new Decisions |
| `packages/core/workspaces/hooks.ts` | Query `/me`; mutations invalidate members + me |
| `packages/views/workspace/members-view.tsx` | Role select + remove actions |
| `packages/views/workspace/members-view.test.tsx` | UI permission gating |
| `packages/core/i18n/locales/vi.json` / `en.json` | Copy for remove / change role |

---

### Task 1: sqlc — update / delete workspace member

**Files:**
- Modify: `server/pkg/db/queries/workspaces.sql`
- Regenerate: `server/pkg/db/generated/` via `make sqlc`

**Interfaces:**
- Produces: `Queries.UpdateWorkspaceMemberRole`, `Queries.DeleteWorkspaceMember`

- [ ] **Step 1: Append queries**

Add to the end of `server/pkg/db/queries/workspaces.sql`:

```sql
-- name: UpdateWorkspaceMemberRole :one
UPDATE workspace_members
SET role = $3
WHERE workspace_id = $1 AND user_id = $2
RETURNING *;

-- name: DeleteWorkspaceMember :exec
DELETE FROM workspace_members
WHERE workspace_id = $1 AND user_id = $2;
```

- [ ] **Step 2: Regenerate**

Run: `make sqlc`

Expected: generated Go methods exist; `go build ./...` in `server/` succeeds.

- [ ] **Step 3: Commit (when user asks)**

```bash
git add server/pkg/db/queries/workspaces.sql server/pkg/db/generated/
git commit -m "feat(db): add update/delete workspace member queries"
```

---

### Task 2: Service — `CurrentMembership` (GET me)

**Files:**
- Modify: `server/internal/service/workspace.go`
- Modify: `server/internal/service/workspace_test.go`

**Interfaces:**
- Produces:
  ```go
  type MembershipSource string // "membership" | "org_admin"
  type CurrentMembership struct {
      UserID string
      Role   string // effective: owner|admin|member
      Source MembershipSource
  }
  func (s *WorkspaceService) CurrentMembership(ctx context.Context, userID, workspaceID string) (CurrentMembership, error)
  ```

- [ ] **Step 1: Write the failing tests**

Append to `workspace_test.go` (reuse `wsFixture`):

```go
func TestCurrentMembership_ExplicitAndOrgAdmin(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, err := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Alpha", "alpha")
	if err != nil {
		t.Fatal(err)
	}
	// ua is explicit owner
	m, err := f.ws.CurrentMembership(ctx, f.ua.ID, w.ID)
	if err != nil || m.Role != "owner" || m.Source != "membership" {
		t.Fatalf("owner: %+v %v", m, err)
	}
	// promote ub to org admin without workspace_members row
	if err := f.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
		OrganizationID: f.org.ID, UserID: f.ub.ID, Role: "admin",
	}); err != nil {
		t.Fatal(err)
	}
	m, err = f.ws.CurrentMembership(ctx, f.ub.ID, w.ID)
	if err != nil || m.Role != "admin" || m.Source != "org_admin" {
		t.Fatalf("org admin: %+v %v", m, err)
	}
	if _, err := f.ws.CurrentMembership(ctx, f.uc.ID, w.ID); err != ErrForbidden {
		t.Fatalf("outsider: %v", err)
	}
}
```

If `AddOrganizationMember` is not the exact sqlc name, use the existing helper the file already uses for org membership (search `organization_members` / `AddOrganization` in `workspace_test.go` / `organization` tests and match it).

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd server && go test ./internal/service/ -run TestCurrentMembership -count=1`

Expected: FAIL — `CurrentMembership` undefined.

- [ ] **Step 3: Implement**

```go
const (
	MembershipSourceMembership MembershipSource = "membership"
	MembershipSourceOrgAdmin   MembershipSource = "org_admin"
)

type MembershipSource string

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
```

- [ ] **Step 4: Run test — expect PASS**

Run: `cd server && go test ./internal/service/ -run TestCurrentMembership -count=1`

- [ ] **Step 5: Commit (when user asks)**

```bash
git commit -m "feat(workspace): expose CurrentMembership with effective role source"
```

---

### Task 3: Service — `UpdateMemberRole` + `RemoveMember`

**Files:**
- Modify: `server/internal/service/workspace.go`
- Modify: `server/internal/service/workspace_test.go`

**Interfaces:**
- Produces:
  ```go
  func (s *WorkspaceService) UpdateMemberRole(ctx context.Context, actorID, workspaceID, targetUserID, role string) (db.WorkspaceMember, error)
  func (s *WorkspaceService) RemoveMember(ctx context.Context, actorID, workspaceID, targetUserID string) error
  ```
- Rules (must match spec §5.2):
  - Actor effective role must be `owner` or `admin`.
  - `role` must be `admin` or `member` only.
  - Target must have an explicit `workspace_members` row; missing → `ErrNotFound`.
  - Target explicit `owner` → `ErrForbidden` (no demote/remove via these APIs).
  - Self-remove allowed if not explicit owner.

- [ ] **Step 1: Write failing tests**

```go
func TestUpdateMemberRoleAndRemove(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, _ := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Beta", "beta")
	_ = f.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: w.ID, UserID: f.ub.ID, Role: "member",
	})
	_ = f.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: w.ID, UserID: f.uc.ID, Role: "member",
	})

	// plain member cannot promote
	if _, err := f.ws.UpdateMemberRole(ctx, f.ub.ID, w.ID, f.uc.ID, "admin"); err != ErrForbidden {
		t.Fatalf("member promote: %v", err)
	}
	// owner promotes member → admin
	got, err := f.ws.UpdateMemberRole(ctx, f.ua.ID, w.ID, f.ub.ID, "admin")
	if err != nil || got.Role != "admin" {
		t.Fatalf("promote: %+v %v", got, err)
	}
	// cannot set owner via PATCH
	if _, err := f.ws.UpdateMemberRole(ctx, f.ua.ID, w.ID, f.ub.ID, "owner"); err == nil {
		t.Fatal("expected invalid owner role")
	}
	// cannot demote explicit owner
	if _, err := f.ws.UpdateMemberRole(ctx, f.ua.ID, w.ID, f.ua.ID, "admin"); err != ErrForbidden {
		t.Fatalf("demote owner: %v", err)
	}
	// owner removes admin ub
	if err := f.ws.RemoveMember(ctx, f.ua.ID, w.ID, f.ub.ID); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, err := f.q.GetWorkspaceMember(ctx, db.GetWorkspaceMemberParams{
		WorkspaceID: w.ID, UserID: f.ub.ID,
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("still member: %v", err)
	}
	// cannot remove owner
	if err := f.ws.RemoveMember(ctx, f.ua.ID, w.ID, f.ua.ID); err != ErrForbidden {
		t.Fatalf("remove owner: %v", err)
	}
}

func TestOrgAdminCanManageMembersWithoutMembershipRow(t *testing.T) {
	f := wsFixture(t)
	ctx := context.Background()
	w, _ := f.ws.CreateInOrg(ctx, f.ua.ID, f.org.ID, "Gamma", "gamma")
	_ = f.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: w.ID, UserID: f.ub.ID, Role: "member",
	})
	// uc = org admin, no workspace_members row
	if err := f.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
		OrganizationID: f.org.ID, UserID: f.uc.ID, Role: "admin",
	}); err != nil {
		t.Fatal(err)
	}
	got, err := f.ws.UpdateMemberRole(ctx, f.uc.ID, w.ID, f.ub.ID, "admin")
	if err != nil || got.Role != "admin" {
		t.Fatalf("org admin promote: %+v %v", got, err)
	}
	if err := f.ws.RemoveMember(ctx, f.uc.ID, w.ID, f.ub.ID); err != nil {
		t.Fatalf("org admin remove: %v", err)
	}
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd server && go test ./internal/service/ -run 'TestUpdateMemberRoleAndRemove' -count=1`

- [ ] **Step 3: Implement**

```go
func adminLike(role string) bool { return role == "owner" || role == "admin" }

func (s *WorkspaceService) UpdateMemberRole(ctx context.Context, actorID, workspaceID, targetUserID, role string) (db.WorkspaceMember, error) {
	actor, err := s.RequireMember(ctx, workspaceID, actorID)
	if err != nil {
		return db.WorkspaceMember{}, err
	}
	if !adminLike(actor.Role) {
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
	return s.q.UpdateWorkspaceMemberRole(ctx, db.UpdateWorkspaceMemberRoleParams{
		WorkspaceID: workspaceID, UserID: targetUserID, Role: role,
	})
}

func (s *WorkspaceService) RemoveMember(ctx context.Context, actorID, workspaceID, targetUserID string) error {
	actor, err := s.RequireMember(ctx, workspaceID, actorID)
	if err != nil {
		return err
	}
	if !adminLike(actor.Role) {
		return ErrForbidden
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
	return s.q.DeleteWorkspaceMember(ctx, db.DeleteWorkspaceMemberParams{
		WorkspaceID: workspaceID, UserID: targetUserID,
	})
}
```

Note: self-leave for a non-owner requires the actor to be admin-like **or** we allow any member to delete **themselves**. Spec §5.2: “Caller được leave (xóa chính mình) nếu không phải owner tường minh.” Implement leave as:

```go
	if actorID == targetUserID {
		// any effective member may leave if not explicit owner (already checked)
		return s.q.DeleteWorkspaceMember(...)
	}
	if !adminLike(actor.Role) {
		return ErrForbidden
	}
```

Reorder: load target first after `RequireMember`; if target.Role == owner → Forbidden; if actorID == targetUserID → delete; else require adminLike then delete.

- [ ] **Step 4: Run — expect PASS**

Run: `cd server && go test ./internal/service/ -run 'TestUpdateMemberRole|TestCurrentMembership' -count=1`

- [ ] **Step 5: Commit (when user asks)**

```bash
git commit -m "feat(workspace): update and remove workspace members"
```

---

### Task 4: HTTP handlers + routes

**Files:**
- Modify: `server/internal/handler/workspace.go`
- Modify: `server/internal/handler/router.go`

**Interfaces:**
- Routes (under auth group, next to existing members routes):
  - `GET /workspaces/{workspaceID}/me` → `{ membership: { user_id, role, source } }`
  - `PATCH /workspaces/{workspaceID}/members/{userID}` body `{ role }` → `{ member: … }` (reuse list-member JSON shape: workspace_id, user_id, role — email fields optional; simplest return the sqlc `WorkspaceMember` fields only, or re-fetch list row — prefer returning `{ "member": { "workspace_id", "user_id", "role", "created_at" } }`)
  - `DELETE /workspaces/{workspaceID}/members/{userID}` → `204`

Non-member on GET me: `RequireMember` → `ErrForbidden`; handler `mapServiceError`. Spec wants 404 to hide existence for resolve paths; for `/me` on a known workspace id from an authenticated non-member, **403 is acceptable** (id already known). Do **not** special-case to 404 unless you already do for other id-scoped member routes.

- [ ] **Step 1: Add handlers**

```go
func (h *handlers) getWorkspaceMe(w http.ResponseWriter, r *http.Request) {
	m, err := h.Workspaces.CurrentMembership(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{
		"membership": map[string]string{
			"user_id": m.UserID,
			"role":    m.Role,
			"source":  string(m.Source),
		},
	})
}

func (h *handlers) patchMember(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Role string `json:"role"`
	}
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	m, err := h.Workspaces.UpdateMemberRole(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "userID"), in.Role)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"member": m})
}

func (h *handlers) deleteMember(w http.ResponseWriter, r *http.Request) {
	err := h.Workspaces.RemoveMember(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "userID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
```

- [ ] **Step 2: Register routes** in `router.go` beside `listMembers`:

```go
r.Get("/workspaces/{workspaceID}/me", h.getWorkspaceMe)
r.Get("/workspaces/{workspaceID}/members", h.listMembers)
r.Patch("/workspaces/{workspaceID}/members/{userID}", h.patchMember)
r.Delete("/workspaces/{workspaceID}/members/{userID}", h.deleteMember)
```

- [ ] **Step 3: Smoke with Go tests already covering service; optional handler test only if the package already has workspace handler tests — do not invent a large suite.**

Run: `cd server && go test ./internal/service/ ./internal/handler/ -count=1`

- [ ] **Step 4: Commit (when user asks)**

```bash
git commit -m "feat(api): workspace me, patch and delete member routes"
```

---

### Task 5: Core endpoints + types

**Files:**
- Modify: `packages/core/types/workspace.ts`
- Modify: `packages/core/api/endpoints/workspaces.ts`
- Modify: `packages/core/api/endpoints/workspaces.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type WorkspaceMembership = { user_id: string; role: MemberRole; source: "membership" | "org_admin" };
  getMyMembership(workspaceId: string): Promise<WorkspaceMembership | null>
  updateMemberRole(workspaceId, userId, body: { role: "admin" | "member" }): Promise<…>
  removeMember(workspaceId, userId): Promise<void>
  ```

- [ ] **Step 1: Add schemas + functions**

In `types/workspace.ts`:

```ts
export const WorkspaceMembershipSchema = z.object({
  user_id: z.string(),
  role: z.string(),
  source: z.string(),
});
export type WorkspaceMembership = Omit<z.infer<typeof WorkspaceMembershipSchema>, "role" | "source"> & {
  role: MemberRole;
  source: "membership" | "org_admin";
};
```

In `workspaces.ts` (endpoint):

```ts
const MembershipResponse = z.object({ membership: WorkspaceMembershipSchema });

export async function getMyMembership(workspaceId: string): Promise<WorkspaceMembership | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/me`);
  const parsed = parseWithFallback<{ membership: z.infer<typeof WorkspaceMembershipSchema> } | null>(
    raw,
    MembershipResponse,
    null,
    { endpoint: "GET /api/v1/workspaces/{ws}/me" },
  );
  if (!parsed) return null;
  const role = (MEMBER_ROLES as readonly string[]).includes(parsed.membership.role)
    ? (parsed.membership.role as MemberRole)
    : ("member" as MemberRole); // least privilege on unknown — or return null; prefer null for permissions
  const source =
    parsed.membership.source === "org_admin" || parsed.membership.source === "membership"
      ? parsed.membership.source
      : "membership";
  // Spec: unknown role → least privilege for PermissionContext. Returning role null is done in the hook.
  return { user_id: parsed.membership.user_id, role, source };
}
```

Prefer: hook maps unknown role → `null` (deny). Endpoint may return the raw string; hook uses `asMemberRole`.

Simpler endpoint return:

```ts
export async function getMyMembership(workspaceId: string): Promise<{
  user_id: string;
  role: string;
  source: string;
} | null> {
  const raw = await request(`/api/v1/workspaces/${enc(workspaceId)}/me`);
  return (
    parseWithFallback(raw, MembershipResponse, null, {
      endpoint: "GET /api/v1/workspaces/{ws}/me",
    })?.membership ?? null
  );
}

export async function updateMemberRole(
  workspaceId: string,
  userId: string,
  body: { role: "admin" | "member" },
): Promise<unknown> {
  return request(`/api/v1/workspaces/${enc(workspaceId)}/members/${enc(userId)}`, {
    method: "PATCH",
    body,
  });
}

export async function removeMember(workspaceId: string, userId: string): Promise<void> {
  await request(`/api/v1/workspaces/${enc(workspaceId)}/members/${enc(userId)}`, {
    method: "DELETE",
  });
}
```

Use `parseWithFallback` on update if you shape a member DTO; DELETE has empty body — `request` must accept 204 (verify `packages/core/api/http.ts` already handles empty responses; if not, fix minimally).

- [ ] **Step 2: Malformed-response tests**

```ts
it("getMyMembership returns null on drift", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(json({ membership: { user_id: "u1", role: "admin", source: "org_admin" } }));
  expect(await getMyMembership("ws1")).toMatchObject({ role: "admin", source: "org_admin" });
  vi.mocked(fetch).mockResolvedValueOnce(json({ membership: null }));
  await expect(getMyMembership("ws1")).resolves.toBeNull();
});
```

- [ ] **Step 3: Run**

Run: `pnpm --filter @uniwork/core test -- api/endpoints/workspaces`

Expected: PASS

- [ ] **Step 4: Commit (when user asks)**

```bash
git commit -m "feat(core): workspace me and member mutation endpoints"
```

---

### Task 6: Permission rules (remove / change-role + comment stubs)

**Files:**
- Modify: `packages/core/permissions/rules.ts`
- Modify: `packages/core/permissions/rules.test.ts`
- Modify: `packages/core/permissions/index.ts` (export new symbols)

**Interfaces:**
- Produces:
  ```ts
  canRemoveMember(target: { user_id: string; role: string } | null, ctx: PermissionContext): Decision
  canChangeMemberRole(target: { user_id: string; role: string } | null, ctx: PermissionContext): Decision
  canEditComment(authorId: string | null, ctx: PermissionContext): Decision
  canDeleteComment(authorId: string | null, ctx: PermissionContext): Decision
  ```
- `canManageMembers` remains admin-like union (invite OR remove OR change-role capability at actor level — keep as `canInviteMembers` alias **or** redefine as `isAdminLike` after membership gate; keep behavior identical for existing UI).

- [ ] **Step 1: Failing tests**

```ts
describe("canRemoveMember / canChangeMemberRole", () => {
  const member = { user_id: "u2", role: "member" };
  const owner = { user_id: "u9", role: "owner" };

  it("allows admin-like actors on non-owner targets", () => {
    expect(canRemoveMember(member, ctx({ wsRole: "admin" })).allowed).toBe(true);
    expect(canChangeMemberRole(member, ctx({ wsRole: "owner" })).allowed).toBe(true);
  });
  it("denies plain members and owner targets", () => {
    expect(canRemoveMember(member, ctx({ wsRole: "member" })).reason).toBe("not_admin_role");
    expect(canRemoveMember(owner, ctx({ wsRole: "admin" })).reason).toBe("not_owner_role");
  });
});

describe("comment authorship policy (not wired to Tasks yet)", () => {
  it("allows author or admin-like to edit/delete", () => {
    expect(canEditComment("u1", ctx({ userId: "u1", wsRole: "member" })).allowed).toBe(true);
    expect(canDeleteComment("u2", ctx({ userId: "u1", wsRole: "admin" })).allowed).toBe(true);
    expect(canEditComment("u2", ctx({ userId: "u1", wsRole: "member" })).reason).toBe("not_resource_owner");
  });
});
```

- [ ] **Step 2: Implement rules**

```ts
export function canRemoveMember(
  target: { user_id: string; role: string } | null,
  ctx: PermissionContext,
): Decision {
  const gate = requireWorkspaceMember(ctx);
  if (gate) return gate;
  if (!target) return deny("unknown", "Member not found.");
  if (target.role === "owner") {
    return deny("not_owner_role", "Workspace owners cannot be removed this way.");
  }
  // Self-leave: any member may remove themselves if not owner (already checked).
  if (ctx.userId === target.user_id) return ALLOW;
  if (isAdminLike(ctx.wsRole)) return ALLOW;
  return deny("not_admin_role", "Only workspace owners and admins can remove members.");
}

export function canChangeMemberRole(
  target: { user_id: string; role: string } | null,
  ctx: PermissionContext,
): Decision {
  const gate = requireWorkspaceMember(ctx);
  if (gate) return gate;
  if (!isAdminLike(ctx.wsRole)) {
    return deny("not_admin_role", "Only workspace owners and admins can change roles.");
  }
  if (!target) return deny("unknown", "Member not found.");
  if (target.role === "owner") {
    return deny("not_owner_role", "Workspace owner role cannot be changed this way.");
  }
  return ALLOW;
}

export function canEditComment(authorId: string | null, ctx: PermissionContext): Decision {
  const gate = requireWorkspaceMember(ctx);
  if (gate) return gate;
  if (authorId && ctx.userId === authorId) return ALLOW;
  if (isAdminLike(ctx.wsRole)) return ALLOW;
  return deny("not_resource_owner", "You can only edit your own comments.");
}

export function canDeleteComment(authorId: string | null, ctx: PermissionContext): Decision {
  return canEditComment(authorId, ctx);
}
```

Cite Go file:line in comments once handlers land (approximate `workspace.go` UpdateMemberRole).

- [ ] **Step 3: Run**

Run: `pnpm --filter @uniwork/core test -- permissions/rules`

- [ ] **Step 4: Commit (when user asks)**

```bash
git commit -m "feat(permissions): member remove/change-role and comment policy rules"
```

---

### Task 7: Hooks — `/me` + mutations

**Files:**
- Modify: `packages/core/permissions/use-current-member.ts`
- Modify: `packages/core/workspaces/hooks.ts`
- Modify: `packages/core/permissions/use-resource-permissions.ts`

**Interfaces:**
- `workspaceKeys.me(wsId) => ["workspace-me", wsId]`
- `useCurrentMember` uses `getMyMembership`; still may load `useMembers` only if a caller needs `member` row — keep `member` as find-in-list **or** `null` when `source === "org_admin"`.

- [ ] **Step 1: Add hooks**

```ts
// hooks.ts
export const workspaceKeys = {
  // ...existing
  me: (wsId: string) => ["workspace-me", wsId] as const,
};

export function useMyMembership(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKeys.me(workspaceId),
    queryFn: () => workspaces.getMyMembership(workspaceId),
    enabled: !!workspaceId,
    retry: false,
  });
}

export function useUpdateMemberRole(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "admin" | "member" }) =>
      workspaces.updateMemberRole(workspaceId, userId, { role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) });
      void qc.invalidateQueries({ queryKey: workspaceKeys.me(workspaceId) });
    },
  });
}

export function useRemoveMember(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => workspaces.removeMember(workspaceId, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) });
      void qc.invalidateQueries({ queryKey: workspaceKeys.me(workspaceId) });
    },
  });
}
```

```ts
// use-current-member.ts
export function useCurrentMember(wsId: string): {
  userId: string | null;
  role: MemberRole | null;
  member: Member | null;
  source: "membership" | "org_admin" | null;
  isLoading: boolean;
} {
  const { user, status } = useSession();
  const userId = user?.id ?? null;
  const { data: membership, isLoading: meLoading } = useMyMembership(wsId);
  const { data: members, isLoading: membersLoading } = useMembers(wsId);
  const member = members?.find((m) => m.user_id === userId) ?? null;
  return {
    userId,
    role: asMemberRole(membership?.role),
    member,
    source:
      membership?.source === "org_admin" || membership?.source === "membership"
        ? membership.source
        : null,
    isLoading: status === "loading" || meLoading || membersLoading,
  };
}
```

Avoid double-loading if possible: `isLoading` for permissions should wait on **me** primarily; members list loading should not block invite button for org admin. Prefer:

```ts
isLoading: status === "loading" || meLoading
```

and keep `useMembers` only for `member` row / list UI.

- [ ] **Step 2: Extend `useWorkspacePermissions`**

```ts
canRemoveMember: (target) => canRemoveMember(target, ctx),
canChangeMemberRole: (target) => canChangeMemberRole(target, ctx),
```

Or return the pure functions bound to ctx — keep API ergonomic for the view:

```ts
export function useWorkspacePermissions(wsId: string) {
  const { userId, role, isLoading } = useCurrentMember(wsId);
  const ctx: PermissionContext = { userId, orgRole: null, wsRole: role };
  // ...
  return {
    canInvite: ...,
    canManageMembers: ...,
    decideRemove: (target: Member) => (isLoading ? PENDING : canRemoveMember(target, ctx)),
    decideChangeRole: (target: Member) => (isLoading ? PENDING : canChangeMemberRole(target, ctx)),
    ...
  };
}
```

- [ ] **Step 3: Add a focused unit/integration test if one exists for `useCurrentMember`; otherwise cover via members-view test in Task 8.**

Run: `pnpm --filter @uniwork/core test -- permissions`

- [ ] **Step 4: Commit (when user asks)**

```bash
git commit -m "feat(core): wire effective role from /me and member mutations"
```

---

### Task 8: Members UI + i18n

**Files:**
- Modify: `packages/views/workspace/members-view.tsx`
- Modify: `packages/views/workspace/members-view.test.tsx`
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`

**Interfaces:**
- Consumes: `decideChangeRole`, `decideRemove`, `useUpdateMemberRole`, `useRemoveMember`

- [ ] **Step 1: i18n keys** (vi + en under `workspace`):

```json
"changeRole": "Đổi vai trò",
"removeMember": "Xóa khỏi workspace",
"removeConfirm": "Xóa {{name}} khỏi workspace?",
"roleUpdated": "Đã cập nhật vai trò",
"memberRemoved": "Đã xóa thành viên",
"ownerLocked": "Không thể đổi hoặc xóa chủ sở hữu workspace"
```

English equivalents in `en.json`.

- [ ] **Step 2: Update list row UI**

For each member row:
- Show role as `Select` when `decideChangeRole(m).allowed` (items admin/member only; owners show static text).
- Show remove `Button` variant ghost/destructive when `decideRemove(m).allowed`.
- On change → `updateMemberRole.mutate`; on remove → confirm via `window.confirm` **or** existing AlertDialog primitive if already used in settings — prefer `AlertDialog` from `@uniwork/ui` if present in the package; otherwise `confirm` is acceptable for v1 of this plan only if no dialog primitive is already mounted in nearby settings code. Check `packages/ui/components/ui/alert-dialog.tsx`; if it exists, use it.

- [ ] **Step 3: Tests**

Seed session + mock http so org-admin effective role allows invite without appearing in members list; assert change-role control appears for a member target when `wsRole` is admin.

Follow patterns in existing `members-view.test.tsx` (mock `@uniwork/core/api/http` via views test setup).

- [ ] **Step 4: Run**

```bash
pnpm --filter @uniwork/views test -- workspace/members-view
pnpm --filter @uniwork/core test -- permissions
cd server && go test ./internal/service/ -count=1
```

- [ ] **Step 5: Commit (when user asks)**

```bash
git commit -m "feat(views): member role change and remove in settings"
```

---

### Task 9: Spec status + verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-workspace-permissions-design.md` — set **Trạng thái:** Đã duyệt; check off §9 criteria that this plan implements.

- [ ] **Step 1: Mark criteria done in the spec** for: `/me`, PATCH/DELETE, org admin FE alignment. Leave unchecked: transfer, comment wiring, Issues.

- [ ] **Step 2: Run narrow verification**

```bash
cd server && go test ./internal/service/ -count=1
pnpm --filter @uniwork/core test -- permissions api/endpoints/workspaces
pnpm --filter @uniwork/views test -- workspace/members
pnpm typecheck
```

- [ ] **Step 3: Commit docs (when user asks)**

```bash
git commit -m "docs: mark workspace permissions foundation criteria done"
```

---

## Spec coverage checklist (self-review)

| Spec requirement | Task |
|------------------|------|
| Effective role formula unchanged (`GetWorkspaceAccess`) | Task 2 (consumes existing) |
| `GET …/me` + `source` | Tasks 2, 4, 5, 7 |
| `PATCH` / `DELETE` members | Tasks 1, 3, 4, 5, 7, 8 |
| Protect explicit owner | Task 3, 6 |
| Org admin implicit = admin | Tasks 2–3 tests, Task 7–8 |
| FE rules mirror Go | Task 6 |
| Comment policy stubs only | Task 6 |
| No transfer / delete WS / Issues | Global constraints |
| Members UI | Task 8 |
| Malformed endpoint tests | Task 5 |
