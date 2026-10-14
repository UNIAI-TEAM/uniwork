# Connector MCP v2 (đọc + ghi) Implementation Plan

> **Trạng thái:** in-progress — Phase 0 (UNI-1587) đã merge (#282); Phase 1 (UNI-1626) xong trên nhánh; Phase 2 (UNI-1639) xong trên nhánh; Phase 3–4 chưa bắt đầu. Theo yêu cầu người dùng, các phase sau xếp chồng nhánh và merge một lần ở cuối.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mở rộng connector MCP từ 5 tool chỉ đọc lên 26 tool (13 đọc, 13 ghi) cho Task, Dự án, Cuộc họp, Tài liệu, ghi trực tiếp bằng actor human của người đã đồng ý.

**Architecture:** Phase 0 dựng nền: scope `write`, màn đồng ý, công tắc ghi của tổ chức, flag `mcp_connector_write`, `via` trên audit, annotation theo từng tool, cổng ghi và ngân sách ghi ở transport `/mcp`. Bốn phase sau thêm tool theo mảng. Mỗi tool gọi service sẵn có bằng `Human(userID)` qua `RequireMember`, nên quyền và audit giữ nguyên như màn hình. Tool đọc dùng lại `McpItem`; tool ghi trả `McpWriteResult` (mục sau khi ghi, `revision` mới, `changes`).

**Tech Stack:** Go 1.27 (Chi, pgx/sqlc, `github.com/modelcontextprotocol/go-sdk` v1.8.0, `github.com/yuin/goldmark` mới ở Phase 4), Next.js + React Query + Zod (`packages/core`, `packages/views`), Vitest, PostgreSQL 16, Redis 7.

**Spec:** `docs/superpowers/specs/2026-10-14-mcp-connector-write-design.md` (ADR 0033). Spec v1: `docs/superpowers/specs/2026-10-12-mcp-connector-design.md`.

## Global Constraints

- Tool ghi gọi service bằng `Human(p.UserID)`; không dùng `action_proposals` (ADR 0033).
- Không có tool xóa nào: không tên `delete_*`/`remove_*`, không gọi `Delete*`, `BatchDelete*`, `ArchiveDocument`, `DeleteComment`, `DeleteProject`.
- Scope chỉ có `read` và `read write`; `write` luôn kéo theo `read`; không gửi scope là `read`.
- Flag `mcp_connector_write`: `Default: false`, `Public: true`, `Owner: "platform"`, `ReviewAt: day(2027, 3, 31)`.
- Tool ghi chỉ tồn tại khi đủ ba điều kiện: flag `mcp_connector_write` bật, tổ chức bật ghi (`organizations.mcp_write_enabled_at`), grant có scope `write`.
- Ngân sách: 30 lệnh ghi mỗi phút cho mỗi grant, bucket `mcp-write`, đếm theo `grant_id`; Redis lỗi hoặc không có thì cho qua.
- Mọi `update_*`, `cancel_meeting`, `restore_meeting` bắt buộc tham số `revision`; lệch thì `revision_conflict`, không ghi gì.
- `list_members` không trả email.
- Danh sách tối đa 50 mục; mỗi mục cắt theo `mcpMaxItemRunes` (16000); giá trị trong `changes` cắt 1.200 rune (`mcpMaxHitRunes`).
- Description của mọi tool kết thúc bằng `mcpUntrusted`; description tool ghi nói tool đổi gì, ai thấy thay đổi, cách hoàn tác.
- Mã lỗi tool trả model: `write_disabled`, `insufficient_scope`, `write_rate_limited`, `revision_conflict`, cùng các mã nghiệp vụ ở spec §4.9.
- Chat, Email Hub, transcript cuộc họp nằm ngoài mọi tool.
- Comment trong code bằng tiếng Anh; spec và plan bằng tiếng Việt.
- `GATE_LEVEL=fast`. Commit theo tiền tố của `CLAUDE.md`, kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Trailer `Refs: UNI-nnn` do hook thêm, không gõ, không xóa. Không bao giờ `--no-verify`.
- Migration mới dùng tiền tố `999<unix-ms>`, không FK, không index thường (index thì `CONCURRENTLY`, một mình một file).
- Endpoint web mới hoặc đổi: schema lenient qua `parseWithFallback` và có test malformed-response. Mọi text JSX trong `packages/views` đi qua `t()`, key vi/en theo `docs/conventions.md`.
- Không đụng thư mục chưa track `apps/web/public/office/`.

## Review Focus

1. Model gửi giờ họp không có offset (`2026-10-15T10:00`): tool phải từ chối bằng `McpInvalidArgs`, không ngầm coi là UTC. Test ở Task 3.3.
2. Trường để trống và trường `null` khác nhau: `update_task` bỏ `due_date` thì giữ hạn cũ, gửi `"due_date": null` thì xóa hạn. Test ở Task 1.4.
3. Markdown có ký tự đặc biệt gõ thật (`*`, `_`, `#`, `[`, `|`) và tiếng Việt có dấu, emoji: khứ hồi page → Markdown → page giữ nguyên chữ. Test ở Task 4.1 và 4.2.
4. Client gửi lại `create_task` sau khi mạng chập chờn: lần hai bị `active_duplicate_task` và câu trả lời có link của task đã tạo, không tạo bản thứ hai. Test ở Task 1.3.
5. `list_members` có owner/admin tổ chức không phải thành viên workspace (gán được) và thành viên đã bị vô hiệu (không gán được): người đầu có trong danh sách, người sau không. Test ở Task 1.2.

## Trình tự và issue

Trước Phase 0, PR của UNI-1567 (spec, ADR 0033, plan này) phải merge vào `develop`.

Mỗi phase:

1. Tạo sub-issue và nhánh từ `origin/develop` mới nhất:

   ```bash
   make issue-sub PARENT=UNI-1308 TITLE="<tiêu đề phase>"
   make issue-start KEY=<UNI-key vừa tạo>
   ```

2. Làm các task của phase theo thứ tự, mỗi task một hoặc vài commit.
3. Chạy bước kiểm chứng cuối phase, ghi note `[agent]`:

   ```bash
   make issue-note KEY=<UNI-key> MSG="[agent] <đã làm, đã kiểm, còn gì>"
   ```

4. Dừng và hỏi người dùng trước khi push và mở PR (`make issue-pr KEY=<UNI-key>`). Phase sau chỉ bắt đầu khi PR phase trước đã merge.

| Phase | Tiêu đề sub-issue | Phụ thuộc |
| --- | --- | --- |
| 0 | `MCP v2 Phase 0: nền ghi (scope write, consent, công tắc, via, annotation)` | UNI-1567 merge |
| 1 | `MCP v2 Phase 1: tool Task` | Phase 0 |
| 2 | `MCP v2 Phase 2: tool Dự án` | Phase 1 |
| 3 | `MCP v2 Phase 3: tool Cuộc họp và khôi phục họp` | Phase 0 |
| 4 | `MCP v2 Phase 4: tool Tài liệu và bộ chuyển Markdown` | Phase 0 |

Làm tuần tự 0 → 1 → 2 → 3 → 4 dù 3 và 4 chỉ cần Phase 0, vì cả năm cùng sửa `server/internal/service/mcp_tools.go` và các test catalogue.

## Cấu trúc file

| File | Trách nhiệm |
| --- | --- |
| `server/internal/service/mcp_scope.go` (mới) | Chuẩn hóa scope OAuth, hỏi grant có `write` |
| `server/internal/service/mcp_auth.go` | Hằng số flag ghi; `orgAccess` đọc cả hai công tắc một lần |
| `server/internal/service/mcp_authorize.go` | `Start` nhận `write`; `Consent` báo ghi khả dụng; `Approve(..., write bool)` đặt scope grant |
| `server/internal/service/mcp_grants.go` | `McpPolicy` có phần ghi; `SetWritePolicy`; `SetPolicy` tắt connector thì tắt luôn ghi |
| `server/internal/service/mcp_principal.go` | `McpPrincipal` có `ClientName`, `Scope`, `WriteOpen`, `CanWrite()` |
| `server/internal/service/mcp_errors.go` (mới) | `McpToolError`, `mcpMapError` (lỗi service → câu cho model) |
| `server/internal/service/mcp_write.go` (mới) | `decodeInto`, `mcpOpt[T]`, `McpChange`, `McpWriteResult`, helper dựng tool có kiểu |
| `server/internal/service/mcp_tools.go` | Registry `McpTools` ghép các nhóm tool; tool v1 giữ nguyên |
| `server/internal/service/mcp_tools_tasks.go` (mới, Phase 1) | 6 tool Task |
| `server/internal/service/mcp_tools_projects.go` (mới, Phase 2) | 4 tool Dự án |
| `server/internal/service/mcp_tools_meetings.go` (mới, Phase 3) | 5 tool mới của Cuộc họp và phần mở rộng `get_meeting` |
| `server/internal/service/mcp_tools_documents.go` (mới, Phase 4) | 5 tool Tài liệu và phần mở rộng `search` |
| `server/internal/service/meeting_lifecycle.go` | `Restore` (Phase 3) |
| `server/internal/document/markdown.go` (mới, Phase 4) | `PageToMarkdown`, `MarkdownToPage` |
| `server/internal/audit/context.go`, `audit.go` | `Via`, `WithVia`; `Recorder` ghi `metadata.via` |
| `server/internal/middleware/counter.go` (mới) | `Counter.Allow` cho ngân sách không phải một request HTTP |
| `server/internal/handler/mcp_transport.go` | Annotation theo tool, ẩn tool ghi ở `tools/list`, cổng ghi, ngân sách, `via` trên ctx |
| `server/internal/handler/mcp_connect.go`, `router/connect.go` | Consent có `write`; `PUT /orgs/{org}/mcp-policy/write` |
| `packages/core/api/endpoints/connect.ts`, `packages/core/connect/hooks.ts` | Trường ghi trong consent và policy; `setMcpWritePolicy` |
| `packages/views/auth/connect-consent.tsx` | Ô "Cho phép tạo và sửa" |
| `packages/views/settings/components/ai-access-tab.tsx` | Công tắc ghi |
| `packages/views/settings/components/connected-apps-tab.tsx` | Nhãn scope |
| `packages/views/tasks/detail/components/activity-row.tsx` | "(qua Claude)" |
| `packages/views/meetings/meeting-detail-view.tsx` | Nút Khôi phục (Phase 3) |

---

# Phase 0 — Nền ghi

Sub-issue: `MCP v2 Phase 0: nền ghi (scope write, consent, công tắc, via, annotation)`.

### Task 0.1: Scope `write` trong OAuth

**Files:**
- Create: `server/internal/service/mcp_scope.go`
- Modify: `server/internal/service/mcp_authorize.go:54-60` (khối scope trong `Start`)
- Modify: `server/internal/handler/mcp_oauth.go:40`, `:63` (`scopes_supported`)
- Test: `server/internal/service/mcp_scope_test.go` (mới), `server/internal/service/mcp_authorize_test.go`, `server/internal/handler/mcp_oauth_test.go`

**Interfaces:**
- Produces: `const mcpScopeWrite = "write"`, `const mcpScopeReadWrite = "read write"`; `func parseMcpScope(raw string) (string, bool)`; `func mcpScopeHasWrite(scope string) bool`.

- [ ] **Step 1: Viết test hỏng**

`server/internal/service/mcp_scope_test.go`:

```go
package service

import "testing"

func TestParseMcpScope(t *testing.T) {
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"", "read", true},
		{"read", "read", true},
		{"write", "read write", true},
		{"read write", "read write", true},
		{"write read", "read write", true},
		{"  read   write ", "read write", true},
		{"admin", "", false},
		{"read admin", "", false},
	}
	for _, c := range cases {
		got, ok := parseMcpScope(c.in)
		if got != c.want || ok != c.ok {
			t.Errorf("parseMcpScope(%q) = %q, %v; want %q, %v", c.in, got, ok, c.want, c.ok)
		}
	}
	if !mcpScopeHasWrite("read write") || mcpScopeHasWrite("read") || mcpScopeHasWrite("") {
		t.Fatal("mcpScopeHasWrite misreads a stored scope")
	}
}

// An AI app that asks for write opens an attempt that records "read write";
// whether the grant gets it is decided later, on the consent page.
func TestStartRecordsTheWriteScope(t *testing.T) {
	w := newMcpWorld(t)
	c := w.publicClient(t, "https://x.test/cb")
	to, err := w.svc.Start(w.ctx, McpAuthorizeInput{ResponseType: "code", ClientID: c.ClientID, RedirectURI: "https://x.test/cb", CodeChallenge: mcpTestChallenge(), CodeChallengeMethod: "S256", Scope: "write"})
	if err != nil {
		t.Fatal(err)
	}
	row, err := w.q.GetMcpAuthAttempt(w.ctx, attemptID(t, to))
	if err != nil {
		t.Fatal(err)
	}
	if row.Scope != "read write" {
		t.Fatalf("attempt scope = %q, want read write", row.Scope)
	}
}
```

- [ ] **Step 2: Chạy test, thấy hỏng**

Run: `cd server && go test ./internal/service/ -run 'TestParseMcpScope|TestStartRecordsTheWriteScope' -count=1`
Expected: FAIL, `undefined: parseMcpScope`.

- [ ] **Step 3: Viết code**

`server/internal/service/mcp_scope.go`:

```go
package service

import (
	"slices"
	"strings"
)

// Scopes of the MCP connector (ADR 0033). write always brings read with it,
// so a grant holds "read" or "read write".
const (
	mcpScopeWrite     = "write"
	mcpScopeReadWrite = mcpScopeRead + " " + mcpScopeWrite
)

// parseMcpScope normalizes an OAuth scope parameter: empty is read, read and
// write in any order are accepted, anything else is not.
func parseMcpScope(raw string) (string, bool) {
	write := false
	for _, part := range strings.Fields(raw) {
		switch part {
		case mcpScopeRead:
		case mcpScopeWrite:
			write = true
		default:
			return "", false
		}
	}
	if write {
		return mcpScopeReadWrite, true
	}
	return mcpScopeRead, true
}

// mcpScopeHasWrite reports a stored grant or attempt scope that includes write.
func mcpScopeHasWrite(scope string) bool {
	return slices.Contains(strings.Fields(scope), mcpScopeWrite)
}
```

Trong `Start` (`mcp_authorize.go`), thay khối:

```go
	scope := in.Scope
	if scope == "" {
		scope = mcpScopeRead
	}
	if scope != mcpScopeRead {
		return fail("invalid_scope", "only the read scope exists")
	}
```

bằng:

```go
	scope, ok := parseMcpScope(in.Scope)
	if !ok {
		return fail("invalid_scope", "scope must be read, write or both")
	}
```

Trong `mcp_oauth.go`, cả hai chỗ `"scopes_supported": []string{"read"}` thành `[]string{"read", "write"}`.

- [ ] **Step 4: Sửa test cũ đã ghim hành vi chỉ đọc**

Run: `cd server && grep -n 'invalid_scope\|only the read scope\|scopes_supported' internal/service/mcp_authorize_test.go internal/handler/mcp_oauth_test.go`

Ca nào gửi `write` mà chờ `invalid_scope` thì đổi giá trị gửi thành `admin`; ca nào so `scopes_supported` với `["read"]` thì so với `["read","write"]`.

- [ ] **Step 5: Chạy test, thấy qua**

Run: `cd server && go test ./internal/service/ -run 'Scope|TestStart|Authorize' -count=1 && go test ./internal/handler/ -run 'TestMcp.*(Metadata|Discovery|Authorize|Scope)' -count=1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/internal/service/mcp_scope.go server/internal/service/mcp_scope_test.go server/internal/service/mcp_authorize.go server/internal/service/mcp_authorize_test.go server/internal/handler/mcp_oauth.go server/internal/handler/mcp_oauth_test.go
git commit -m "feat(mcp): accept the write scope in authorization requests

An AI app may now ask for read, write or both; write always brings read,
so an attempt records read or \"read write\". Whether the grant keeps
write is decided on the consent page (next commits).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 0.2: Flag `mcp_connector_write` và công tắc ghi của tổ chức

**Files:**
- Create: `server/migrations/9991792000000001_organizations_mcp_write_policy.up.sql`, `.down.sql`
- Modify: `server/pkg/db/queries/mcp.sql` (`GetOrganizationMcpPolicy`, `GetOrganizationMcpPolicyForUpdate`, `SetOrganizationMcpPolicy`; thêm `SetOrganizationMcpWritePolicy`)
- Modify: `server/internal/featureflags/keys.go:56`
- Modify: `server/internal/audit/actions.go:224-227`
- Modify: `server/internal/service/mcp_auth.go`, `mcp_authorize.go:172-194`, `mcp_grants.go:25-191`
- Modify: `server/internal/service/audit_coverage_test.go` (`actionsWithoutCommands`, `auditActions()`)
- Modify: `server/internal/handler/mcp_connect.go`, `dto/sdi/mcp.go`, `dto/sdo/mcp.go`, `router/connect.go`, `isolation_routes_test.go:218`
- Modify: `docs/runbooks/` runbook MCP (tìm bằng `grep -rln mcp_connector docs/runbooks docs/ops`)
- Test: `server/internal/service/mcp_grants_test.go`, `server/internal/handler/mcp_connect_test.go`

**Interfaces:**
- Produces: `const mcpWriteFlagKey = "mcp_connector_write"`; `func (s *McpAuthService) flag(ctx context.Context, key, userID, orgID string) bool`; `func (s *McpAuthService) orgAccess(ctx context.Context, userID, orgID string) (enabled, write bool, err error)`; `McpPolicy{..., WriteEnabled, WriteAvailable bool; WriteEnabledAt *time.Time; WriteEnabledBy string}`; `func (s *McpAuthService) SetWritePolicy(ctx context.Context, actorID, orgID string, enabled bool) (McpPolicy, error)`; `audit.ActionOrganizationMcpWritePolicyChanged = "organization.mcp_write_policy_changed"`; `audit.ActionMcpGrantScopeChanged = "mcp_grant.scope_changed"`; route `PUT /api/v1/orgs/{org}/mcp-policy/write` (SDI `McpWritePolicySDI{Enabled bool}`, SDO `McpPolicySDO`).

- [ ] **Step 1: Migration và query**

`server/migrations/9991792000000001_organizations_mcp_write_policy.up.sql`:

```sql
-- An owner or admin lets connected AI apps create and edit, on top of the
-- read access mcp_enabled_at opens (ADR 0033). NULL means off, the default.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS mcp_write_enabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mcp_write_enabled_by TEXT;
```

`.down.sql`:

```sql
ALTER TABLE organizations
  DROP COLUMN IF EXISTS mcp_write_enabled_by,
  DROP COLUMN IF EXISTS mcp_write_enabled_at;
```

Kiểm tiền tố vẫn lớn nhất: `ls server/migrations | grep '^999' | sort | tail -2` phải in hai file vừa tạo cuối cùng. Nếu không, đổi tiền tố thành một số `999<unix-ms>` lớn hơn file cuối.

Trong `server/pkg/db/queries/mcp.sql`, thay bốn query policy:

```sql
-- name: GetOrganizationMcpPolicy :one
SELECT id, mcp_enabled_at, mcp_enabled_by, mcp_write_enabled_at, mcp_write_enabled_by FROM organizations WHERE id = $1;

-- name: GetOrganizationMcpPolicyForUpdate :one
-- SetPolicy reads the value it is about to change under the row lock, so the
-- audit row's before/after is true and a repeated toggle writes no second row.
SELECT id, mcp_enabled_at, mcp_enabled_by, mcp_write_enabled_at, mcp_write_enabled_by FROM organizations WHERE id = $1 FOR UPDATE;

-- name: SetOrganizationMcpPolicy :one
-- Turning the connector off turns write off with it: write never outlives read.
UPDATE organizations SET
  mcp_enabled_at = CASE WHEN sqlc.arg(enabled)::bool THEN COALESCE(mcp_enabled_at, now()) ELSE NULL END,
  mcp_enabled_by = CASE WHEN sqlc.arg(enabled)::bool THEN sqlc.arg(actor_id)::text ELSE NULL END,
  mcp_write_enabled_at = CASE WHEN sqlc.arg(enabled)::bool THEN mcp_write_enabled_at ELSE NULL END,
  mcp_write_enabled_by = CASE WHEN sqlc.arg(enabled)::bool THEN mcp_write_enabled_by ELSE NULL END,
  updated_at = now()
WHERE id = sqlc.arg(id)
RETURNING id, mcp_enabled_at, mcp_enabled_by, mcp_write_enabled_at, mcp_write_enabled_by;

-- name: SetOrganizationMcpWritePolicy :one
UPDATE organizations SET
  mcp_write_enabled_at = CASE WHEN sqlc.arg(enabled)::bool THEN COALESCE(mcp_write_enabled_at, now()) ELSE NULL END,
  mcp_write_enabled_by = CASE WHEN sqlc.arg(enabled)::bool THEN sqlc.arg(actor_id)::text ELSE NULL END,
  updated_at = now()
WHERE id = sqlc.arg(id)
RETURNING id, mcp_enabled_at, mcp_enabled_by, mcp_write_enabled_at, mcp_write_enabled_by;
```

Run: `make migrate-up && make sqlc && cd server && go build ./...`
Expected: build lỗi ở chỗ dùng row policy cũ thì sửa ở Step 3; `TestEveryQueryNamesItsTenant` không đổi vì query giữ dạng của query cũ.

- [ ] **Step 2: Viết test hỏng**

Thêm vào `server/internal/service/mcp_grants_test.go`:

```go
// The write switch needs the connector on and the write flag open; turning
// the connector off takes write with it, and every real change is audited.
func TestSetWritePolicy(t *testing.T) {
	w := newMcpWorld(t)
	if _, err := w.svc.SetWritePolicy(w.ctx, w.owner.ID, w.org.ID, true); !codedIs(err, "connector_off") {
		t.Fatalf("write on before the connector: %v, want connector_off", err)
	}
	w.enable(t)
	p, err := w.svc.SetWritePolicy(w.ctx, w.owner.ID, w.org.ID, true)
	if err != nil || !p.WriteEnabled || !p.WriteAvailable || p.WriteEnabledBy != w.owner.ID {
		t.Fatalf("write on: %+v %v", p, err)
	}
	if _, err := w.svc.SetWritePolicy(w.ctx, w.owner.ID, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	var rows int
	if err := w.pool.QueryRow(w.ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'organization.mcp_write_policy_changed'`, w.org.ID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("audit rows = %d, want 1 (a repeated enable writes none)", rows)
	}
	if _, err := w.svc.SetPolicy(w.ctx, w.owner.ID, w.org.ID, false); err != nil {
		t.Fatal(err)
	}
	if p, err = w.svc.Policy(w.ctx, w.owner.ID, w.org.ID); err != nil || p.WriteEnabled {
		t.Fatalf("connector off left write on: %+v %v", p, err)
	}
}

func TestSetWritePolicyNeedsTheWriteFlagAndAnAdmin(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	w.svc.SetFlags(mcpFlagsExcept{off: mcpWriteFlagKey})
	if _, err := w.svc.SetWritePolicy(w.ctx, w.owner.ID, w.org.ID, true); !codedIs(err, "write_unavailable") {
		t.Fatalf("write flag off: %v, want write_unavailable", err)
	}
	p, err := w.svc.Policy(w.ctx, w.owner.ID, w.org.ID)
	if err != nil || p.WriteAvailable || !p.Available {
		t.Fatalf("policy with the write flag off = %+v %v", p, err)
	}
	w.svc.SetFlags(mcpFlags(true))
	member := registerVerified(t, w.q, w.auth, "mcp-member-write@example.com", "Member")
	addOrgMemberRole(t, w.q, w.org.ID, member.ID, OrgRoleMember)
	if _, err := w.svc.SetWritePolicy(w.ctx, member.ID, w.org.ID, true); !errors.Is(err, ErrForbidden) {
		t.Fatalf("plain member: %v, want ErrForbidden", err)
	}
}
```

Thêm vào `server/internal/service/mcp_helpers_test.go`:

```go
// mcpFlagsExcept answers true for every flag but one.
type mcpFlagsExcept struct{ off string }

func (f mcpFlagsExcept) IsEnabled(_ context.Context, key string, _ bool) bool { return key != f.off }
```

`addOrgMemberRole(t, q, orgID, userID, role)` là helper test có sẵn (`audit_service_test.go:72`).

- [ ] **Step 3: Chạy test, thấy hỏng**

Run: `cd server && go test ./internal/service/ -run 'TestSetWritePolicy' -count=1`
Expected: FAIL, `w.svc.SetWritePolicy undefined`.

- [ ] **Step 4: Viết code**

`keys.go`, thêm sau dòng `mcp_connector`:

```go
	{Key: "mcp_connector_write", Description: "Connector MCP: tool ghi (tạo, sửa task, dự án, cuộc họp, tài liệu) cho grant có scope write (UNI-1567, ADR 0033)", Default: false, Public: true, Owner: "platform", ReviewAt: day(2027, 3, 31)},
```

`audit/actions.go`, trong khối MCP:

```go
	ActionMcpGrantScopeChanged              = "mcp_grant.scope_changed"
	ActionOrganizationMcpWritePolicyChanged = "organization.mcp_write_policy_changed"
```

`mcp_auth.go`, trong khối hằng số: `mcpWriteFlagKey = "mcp_connector_write"`. Thêm:

```go
func errMcpWriteUnavailable() error {
	return CodedError{Code: "write_unavailable", Status: http.StatusForbidden, Msg: "quyền ghi cho trợ lý AI chưa mở cho tổ chức này", Err: ErrMcpConnectorDisabled}
}

func errMcpConnectorOff() error {
	return CodedError{Code: "connector_off", Status: http.StatusConflict, Msg: "hãy bật kết nối trợ lý AI trước khi cho phép ghi"}
}
```

`mcp_authorize.go`, thay `orgEnabled` và `flagOn` bằng:

```go
// orgEnabled is the platform flag AND the organization's own switch.
func (s *McpAuthService) orgEnabled(ctx context.Context, userID, orgID string) (bool, error) {
	enabled, _, err := s.orgAccess(ctx, userID, orgID)
	return enabled, err
}

// orgAccess reads both switches of the organization once: enabled is the
// connector (flag and switch), write is enabled AND the write flag AND the
// organization's write switch (ADR 0033).
func (s *McpAuthService) orgAccess(ctx context.Context, userID, orgID string) (enabled, write bool, err error) {
	if !s.flag(ctx, mcpFlagKey, userID, orgID) {
		return false, false, nil
	}
	p, err := s.q.GetOrganizationMcpPolicy(ctx, orgID)
	if err != nil {
		return false, false, err
	}
	enabled = p.McpEnabledAt.Valid
	write = enabled && p.McpWriteEnabledAt.Valid && s.flag(ctx, mcpWriteFlagKey, userID, orgID)
	return enabled, write, nil
}

func (s *McpAuthService) flagOn(ctx context.Context, userID, orgID string) bool {
	return s.flag(ctx, mcpFlagKey, userID, orgID)
}

func (s *McpAuthService) flag(ctx context.Context, key, userID, orgID string) bool {
	if s.flags == nil {
		return false
	}
	def := false
	if f, ok := featureflags.Lookup(key); ok {
		def = f.Default
	}
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: userID, OrganizationID: orgID})
	return s.flags.IsEnabled(ctx, key, def)
}
```

`mcp_grants.go`: mở rộng `McpPolicy` và dựng nó từ một chỗ:

```go
type McpPolicy struct {
	Enabled   bool
	Available bool // the platform flag; false means the switch cannot turn on yet
	EnabledAt *time.Time
	EnabledBy string
	// The write half (ADR 0033): WriteAvailable is the write flag.
	WriteEnabled   bool
	WriteAvailable bool
	WriteEnabledAt *time.Time
	WriteEnabledBy string
}

func mcpPolicyOf(enabledAt pgtype.Timestamptz, enabledBy pgtype.Text, writeAt pgtype.Timestamptz, writeBy pgtype.Text, available, writeAvailable bool) McpPolicy {
	return McpPolicy{
		Enabled: enabledAt.Valid, Available: available, EnabledAt: optTime(enabledAt), EnabledBy: enabledBy.String,
		WriteEnabled: writeAt.Valid, WriteAvailable: writeAvailable, WriteEnabledAt: optTime(writeAt), WriteEnabledBy: writeBy.String,
	}
}
```

Trong `Policy`, `SetPolicy`: mọi chỗ dựng `McpPolicy{...}` thay bằng `mcpPolicyOf(row.McpEnabledAt, row.McpEnabledBy, row.McpWriteEnabledAt, row.McpWriteEnabledBy, available, s.flag(ctx, mcpWriteFlagKey, actorID, orgID))` (với `before` hay `row` tùy nhánh). Trong `SetPolicy`, audit `Changes` thành:

```go
		Changes: audit.Diff(
			map[string]any{"mcp_enabled": before.McpEnabledAt.Valid, "mcp_write_enabled": before.McpWriteEnabledAt.Valid},
			map[string]any{"mcp_enabled": enabled, "mcp_write_enabled": row.McpWriteEnabledAt.Valid},
		),
```

Thêm `SetWritePolicy` ngay sau `SetPolicy`:

```go
// SetWritePolicy turns write access for connected AI apps on or off (ADR
// 0033). It needs the connector on and the write flag open; turning it off
// is always allowed.
func (s *McpAuthService) SetWritePolicy(ctx context.Context, actorID, orgID string, enabled bool) (McpPolicy, error) {
	if err := s.requireOrgAdmin(ctx, orgID, actorID); err != nil {
		return McpPolicy{}, err
	}
	available := s.flag(ctx, mcpFlagKey, actorID, orgID)
	writeAvailable := s.flag(ctx, mcpWriteFlagKey, actorID, orgID)
	if enabled && !writeAvailable {
		return McpPolicy{}, errMcpWriteUnavailable()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return McpPolicy{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	before, err := q.GetOrganizationMcpPolicyForUpdate(ctx, orgID)
	if err != nil {
		return McpPolicy{}, err
	}
	if enabled && !before.McpEnabledAt.Valid {
		return McpPolicy{}, errMcpConnectorOff()
	}
	if before.McpWriteEnabledAt.Valid == enabled {
		if err := tx.Commit(ctx); err != nil {
			return McpPolicy{}, err
		}
		return mcpPolicyOf(before.McpEnabledAt, before.McpEnabledBy, before.McpWriteEnabledAt, before.McpWriteEnabledBy, available, writeAvailable), nil
	}
	row, err := q.SetOrganizationMcpWritePolicy(ctx, db.SetOrganizationMcpWritePolicyParams{ID: orgID, Enabled: enabled, ActorID: actorID})
	if err != nil {
		return McpPolicy{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, Actor: audit.User(actorID), Action: audit.ActionOrganizationMcpWritePolicyChanged,
		ResourceType: "organization", ResourceID: orgID,
		Changes: audit.Diff(map[string]any{"mcp_write_enabled": before.McpWriteEnabledAt.Valid}, map[string]any{"mcp_write_enabled": enabled}),
	}); err != nil {
		return McpPolicy{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return McpPolicy{}, err
	}
	return mcpPolicyOf(row.McpEnabledAt, row.McpEnabledBy, row.McpWriteEnabledAt, row.McpWriteEnabledBy, available, writeAvailable), nil
}
```

`audit_coverage_test.go`: thêm hai action vào `auditActions()` (cạnh các action MCP) và vào `actionsWithoutCommands`:

```go
	audit.ActionMcpGrantScopeChanged:              "covered by mcp_authorize_test.go",
	audit.ActionOrganizationMcpWritePolicyChanged: "covered by mcp_grants_test.go",
```

- [ ] **Step 5: Route web**

`dto/sdi/mcp.go`:

```go
// McpWritePolicySDI is PUT /api/v1/orgs/{org}/mcp-policy/write.
type McpWritePolicySDI struct {
	Enabled bool `json:"enabled" description:"Cho phép ứng dụng AI đã kết nối tạo và sửa dữ liệu" example:"true"`
}
```

`dto/sdo/mcp.go`, thêm vào `McpPolicySDO`:

```go
	WriteEnabled   bool    `json:"write_enabled" description:"Ứng dụng AI được tạo và sửa" example:"false"`
	WriteAvailable bool    `json:"write_available" description:"Nền tảng đã mở quyền ghi cho tổ chức" example:"true"`
	WriteEnabledAt *string `json:"write_enabled_at" description:"RFC 3339 hoặc null" example:"2026-10-14T08:00:00Z"`
	WriteEnabledBy string  `json:"write_enabled_by" description:"ULID người bật" example:"01J8X4USR0N1P2Q3R4S5T6U7V8"`
```

`mcp_connect.go`: `policySDO` điền bốn trường mới từ `p`. Thêm handler:

```go
func (h *handlers) setOrgMcpWritePolicy(w http.ResponseWriter, r *http.Request) {
	if !h.mcpReady(w) {
		return
	}
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	var in sdi.McpWritePolicySDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	p, err := h.McpAuth.SetWritePolicy(r.Context(), middleware.UserID(r.Context()), orgID, in.Enabled)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, h.policySDO(p))
}
```

Đăng ký theo đúng cách `SetOrgMcpPolicy` đang đi qua `Routes` (tìm `SetOrgMcpPolicy` trong `server/internal/handler/router/*.go` và `server/internal/handler/router.go`; thêm `SetOrgMcpWritePolicy` cùng chỗ). Trong `router/connect.go`, thêm comment route vào danh sách đầu file và:

```go
	v1.Put("/orgs/{org}/mcp-policy/write", h.SetOrgMcpWritePolicy, apiOp{
		summary:     "Turn write access for AI apps on or off",
		description: "Owner/admin: cho phép ứng dụng AI đã kết nối tạo và sửa (ADR 0033). Cần connector đang bật.",
		tags:        tags, sdi: sdi.McpWritePolicySDI{}, sdo: sdo.McpPolicySDO{}, auth: true,
	})
```

`isolation_routes_test.go`, sau mục `PUT /api/v1/orgs/{org}/mcp-policy`:

```go
	"PUT /api/v1/orgs/{org}/mcp-policy/write": {
		reason: "the attack on A sends enabled false, which would switch A's write access off, so A's tenant digest catches a breach; every other tenant's own call sends true, a repeated enable (buildMcp turns write on) that answers 200",
		body: func(w *isoWorld, tn *isoTenant) isoBody {
			return isoBody{json: map[string]any{"enabled": tn != w.alpha}}
		}},
```

`isolation_mcp_seed_test.go`, ngay sau `svc.SetPolicy(...)` trong `buildMcp`:

```go
	if _, err := svc.SetWritePolicy(ctx, tn.userID, tn.orgID, true); err != nil {
		t.Fatal(err)
	}
```

Thêm vào `server/internal/handler/mcp_connect_test.go` một test HTTP: owner `PUT /api/v1/orgs/{slug}/mcp-policy/write` với `{"enabled":true}` khi connector tắt nhận 409 `connector_off`; bật connector rồi gọi lại nhận 200 và `write_enabled: true`; `GET /api/v1/orgs/{slug}/mcp-policy` trả `write_enabled: true`, `write_available: true`. Dùng đúng helper mà test `PUT /mcp-policy` hiện có trong file đó dùng (tìm `mcp-policy` trong `mcp_connect_test.go` và chép khung).

- [ ] **Step 6: Runbook**

Trong runbook MCP (file tìm ở danh sách Files), thêm mục:

```markdown
## Tắt riêng phần ghi

Khi một ứng dụng AI ghi sai hàng loạt: ở `/admin/flags`, đặt override `mcp_connector_write` = false
(toàn cục, hoặc tổ chức bị ảnh hưởng, lý do ≥ 10 ký tự). Tool ghi biến mất ngay ở lần `tools/list`
kế tiếp và mọi lời gọi tool ghi trả `write_disabled`; phần đọc chạy tiếp, không thu hồi token.
Admin tổ chức cũng tự tắt được ở Cài đặt › Truy cập AI › "Cho phép tạo và sửa".
Lần ra lệnh nào do ứng dụng nào: `audit_events.metadata->'via'->>'grant_id'`.
```

Nếu không có runbook MCP nào, thêm mục này vào cuối `docs/ops/RUNBOOK_OUTBOX.md` thì sai chỗ; thay vào đó tạo `docs/runbooks/mcp-connector.md` với tiêu đề `# Connector MCP` và mục trên. `scripts/alerts-runbooks.test.mjs` chỉ kiểm runbook gắn với alert, nên file mới không cần bốn mục chuẩn.

- [ ] **Step 7: Chạy test, thấy qua**

Run: `cd server && go test ./internal/service/ -run 'TestSetWritePolicy|TestSetPolicy|Policy|TestEveryAuditedCommandWritesItsRow' -count=1 && go test ./internal/handler/ -run 'TestMcp|TestIsolationMatrix|TestSwagger' -count=1 && go test ./internal/featureflags/ ./migrations/ -count=1`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/migrations/9991792000000001_organizations_mcp_write_policy.*.sql server/pkg/db/queries/mcp.sql server/pkg/db/generated server/internal/featureflags/keys.go server/internal/audit/actions.go server/internal/service/mcp_auth.go server/internal/service/mcp_authorize.go server/internal/service/mcp_grants.go server/internal/service/mcp_grants_test.go server/internal/service/mcp_helpers_test.go server/internal/service/audit_coverage_test.go server/internal/handler docs/runbooks
git commit -m "feat(mcp): organization switch and flag for write access

Write access for connected AI apps sits behind two switches of its own:
the mcp_connector_write flag and the organization's write switch, which
needs the connector on and goes off with it. Both changes are audited.
Nothing uses them yet; the consent page and /mcp follow.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 0.3: Màn đồng ý chọn quyền ghi, grant đổi scope

**Files:**
- Create: query `SetMcpGrantScope` trong `server/pkg/db/queries/mcp.sql`
- Modify: `server/internal/service/mcp_authorize.go` (`McpConsent`, `McpConsentOrg`, `Consent`, `consentOrganizations`, `Approve`)
- Modify: `server/internal/handler/mcp_connect.go` (`consentSDO`, `mcpConsentCommand`), `dto/sdi/mcp.go`, `dto/sdo/mcp.go`
- Modify: mọi lời gọi `McpAuthService.Approve` (danh sách ở Step 5)
- Test: `server/internal/service/mcp_authorize_test.go`, `server/internal/handler/mcp_connect_test.go`

**Interfaces:**
- Consumes: `parseMcpScope`, `mcpScopeHasWrite`, `mcpScopeReadWrite` (0.1); `orgAccess` (0.2); `audit.ActionMcpGrantScopeChanged` (0.2).
- Produces: `McpConsent.WriteRequested bool`; `McpConsentOrg.WriteEnabled bool`; `func (s *McpAuthService) Approve(ctx context.Context, userID, attemptID, csrf, organizationID string, write bool) (string, error)`; SDI `McpConsentSDI.Write bool` (`json:"write,omitempty"`); SDO `McpConsentSDO.WriteRequested` (`write_requested`), `McpConsentOrgSDO.WriteEnabled` (`write_enabled`).

- [ ] **Step 1: Viết test hỏng**

Thêm vào `mcp_authorize_test.go`:

```go
// startWrite opens an attempt that asks for write and returns its id.
func (w *mcpWorld) startWrite(t *testing.T, c McpClient) string {
	t.Helper()
	to, err := w.svc.Start(w.ctx, McpAuthorizeInput{ResponseType: "code", ClientID: c.ClientID, RedirectURI: "https://x.test/cb", CodeChallenge: mcpTestChallenge(), CodeChallengeMethod: "S256", Scope: "read write"})
	if err != nil {
		t.Fatal(err)
	}
	return attemptID(t, to)
}

func (w *mcpWorld) grantScope(t *testing.T, clientID string) string {
	t.Helper()
	g, err := w.q.GetActiveMcpGrant(w.ctx, db.GetActiveMcpGrantParams{OrganizationID: w.org.ID, UserID: w.owner.ID, ClientID: clientID})
	if err != nil {
		t.Fatal(err)
	}
	return g.Scope
}

// The grant holds write only when the app asked for it, the person ticked it
// and the organization allows it; a later consent can raise or lower it, and
// each change is audited.
func TestApproveDecidesTheGrantScope(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")

	// Write asked and ticked, but the organization has not opened write.
	id := w.startWrite(t, c)
	consent, err := w.svc.Consent(w.ctx, w.owner.ID, id)
	if err != nil {
		t.Fatal(err)
	}
	if !consent.WriteRequested || consent.Organizations[0].WriteEnabled {
		t.Fatalf("consent = %+v, want write requested but not open", consent)
	}
	if _, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	if got := w.grantScope(t, c.ClientID); got != "read" {
		t.Fatalf("scope with write closed = %q, want read", got)
	}

	// The organization opens write; the same app asks again and the person ticks it.
	if _, err := w.svc.SetWritePolicy(w.ctx, w.owner.ID, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	id = w.startWrite(t, c)
	consent, _ = w.svc.Consent(w.ctx, w.owner.ID, id)
	if !consent.Organizations[0].WriteEnabled {
		t.Fatalf("consent after opening write = %+v", consent.Organizations)
	}
	if _, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	if got := w.grantScope(t, c.ClientID); got != "read write" {
		t.Fatalf("scope after ticking write = %q, want read write", got)
	}

	// Reconnecting without the tick takes write away.
	id = w.startWrite(t, c)
	consent, _ = w.svc.Consent(w.ctx, w.owner.ID, id)
	if _, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, false); err != nil {
		t.Fatal(err)
	}
	if got := w.grantScope(t, c.ClientID); got != "read" {
		t.Fatalf("scope after unticking = %q, want read", got)
	}
	var changes int
	if err := w.pool.QueryRow(w.ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'mcp_grant.scope_changed'`, w.org.ID).Scan(&changes); err != nil {
		t.Fatal(err)
	}
	if changes != 2 {
		t.Fatalf("scope_changed rows = %d, want 2", changes)
	}
}

// An app that asked for read only never gets write, whatever the box says.
func TestApproveNeverWidensBeyondTheRequest(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	if _, err := w.svc.SetWritePolicy(w.ctx, w.owner.ID, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	c := w.publicClient(t, "https://x.test/cb")
	to, err := w.svc.Start(w.ctx, McpAuthorizeInput{ResponseType: "code", ClientID: c.ClientID, RedirectURI: "https://x.test/cb", CodeChallenge: mcpTestChallenge(), CodeChallengeMethod: "S256"})
	if err != nil {
		t.Fatal(err)
	}
	id := attemptID(t, to)
	consent, _ := w.svc.Consent(w.ctx, w.owner.ID, id)
	if consent.WriteRequested {
		t.Fatal("a read-only request reads as asking for write")
	}
	if _, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	if got := w.grantScope(t, c.ClientID); got != "read" {
		t.Fatalf("scope = %q, want read", got)
	}
}
```

Kiểm import `db` đã có trong file test (đã có ở `mcp_helpers_test.go` cùng package, nên dùng được).

- [ ] **Step 2: Chạy test, thấy hỏng**

Run: `cd server && go test ./internal/service/ -run 'TestApproveDecidesTheGrantScope|TestApproveNeverWidensBeyondTheRequest' -count=1`
Expected: FAIL (biên dịch: `Approve` thừa tham số, `WriteRequested` undefined).

- [ ] **Step 3: Query**

Trong `mcp.sql`, sau `CreateMcpGrant`:

```sql
-- name: SetMcpGrantScope :one
-- tenant: by-id
UPDATE mcp_grants SET scope = $2 WHERE id = $1 AND revoked_at IS NULL
RETURNING *;
```

Run: `make sqlc`.

- [ ] **Step 4: Viết code**

`mcp_authorize.go`:

`McpConsent` thêm trường `WriteRequested bool // the app asked for write`; `McpConsentOrg` thêm `WriteEnabled bool // the organization lets apps write (ADR 0033)`.

Trong `Consent`, câu `return McpConsent{...}` cuối thêm `WriteRequested: mcpScopeHasWrite(row.Scope)`.

Trong `consentOrganizations`, thay:

```go
		enabled, err := s.orgEnabled(ctx, userID, o.ID)
		if err != nil {
			return nil, err
		}
		c := McpConsentOrg{ID: o.ID, Slug: o.Slug, Name: o.Name, Enabled: enabled}
```

bằng:

```go
		enabled, write, err := s.orgAccess(ctx, userID, o.ID)
		if err != nil {
			return nil, err
		}
		c := McpConsentOrg{ID: o.ID, Slug: o.Slug, Name: o.Name, Enabled: enabled, WriteEnabled: write}
```

`Approve` đổi chữ ký thành `Approve(ctx context.Context, userID, attemptID, csrf, organizationID string, write bool) (string, error)`. Thay đoạn từ `enabled, err := s.orgEnabled(...)` tới hết khối `if created {...}` bằng:

```go
	enabled, writeOpen, err := s.orgAccess(ctx, userID, organizationID)
	if err != nil {
		return "", err
	}
	if !enabled {
		return "", errMcpConnectorDisabled()
	}
	code, err := randomToken(32)
	if err != nil {
		return "", err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := s.lockOwnAttempt(ctx, q, userID, attemptID, csrf)
	if err != nil {
		return "", err
	}
	// Write needs all three: the app asked, the person ticked, the
	// organization allows it. Anything less is a read grant (RFC 6749 §3.3
	// lets the server issue less than was asked).
	scope := mcpScopeRead
	if write && writeOpen && mcpScopeHasWrite(row.Scope) {
		scope = mcpScopeReadWrite
	}
	grant, err := q.GetActiveMcpGrant(ctx, db.GetActiveMcpGrantParams{OrganizationID: organizationID, UserID: userID, ClientID: row.ClientID})
	created := false
	if errors.Is(err, pgx.ErrNoRows) {
		grant, err = q.CreateMcpGrant(ctx, db.CreateMcpGrantParams{
			ID: util.NewID(), OrganizationID: organizationID, UserID: userID, ClientID: row.ClientID,
			Scope: scope, CreatedBy: userID, CreatedByKind: string(audit.KindHuman),
		})
		created = true
	}
	if err != nil {
		return "", err
	}
	if !created && grant.Scope != scope {
		// The person's latest answer is the grant's scope, up or down.
		before := grant.Scope
		if grant, err = q.SetMcpGrantScope(ctx, db.SetMcpGrantScopeParams{ID: grant.ID, Scope: scope}); err != nil {
			return "", err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: organizationID, Actor: Human(userID), Action: audit.ActionMcpGrantScopeChanged,
			ResourceType: "mcp_grant", ResourceID: grant.ID, Metadata: map[string]any{"client_id": row.ClientID},
			Changes: audit.Diff(map[string]any{"scope": before}, map[string]any{"scope": scope}),
		}); err != nil {
			return "", err
		}
	}
	if _, err := q.ApproveMcpAuthAttempt(ctx, db.ApproveMcpAuthAttemptParams{
		ID: row.ID, GrantID: pgtype.Text{String: grant.ID, Valid: true},
		CodeDigest: pgtype.Text{String: digest(code), Valid: true}, CodeExpiresAt: mcpTime(s.now().Add(mcpCodeTTL)),
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// The attempt lapsed between the row lock and this update (the
			// query checks expiry against the database clock).
			return "", mcpAttemptExpired()
		}
		return "", err
	}
	if created {
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: organizationID, Actor: Human(userID), Action: audit.ActionMcpGrantCreated,
			ResourceType: "mcp_grant", ResourceID: grant.ID, Metadata: map[string]any{"client_id": row.ClientID, "scope": scope},
		}); err != nil {
			return "", err
		}
	}
```

Phần còn lại của `Approve` (commit, metric, redirect) giữ nguyên.

`dto/sdi/mcp.go`, `McpConsentSDI` thêm:

```go
	Write bool `json:"write,omitempty" description:"Người dùng cho phép tạo và sửa; bỏ qua khi ứng dụng không xin quyền ghi hoặc tổ chức chưa mở" example:"false"`
```

`dto/sdo/mcp.go`: `McpConsentSDO` thêm `WriteRequested bool \`json:"write_requested" description:"Ứng dụng xin quyền tạo và sửa" example:"true"\``; `McpConsentOrgSDO` thêm `WriteEnabled bool \`json:"write_enabled" description:"Tổ chức cho phép ứng dụng AI ghi" example:"false"\``.

`mcp_connect.go`: `consentSDO` điền `WriteRequested: c.WriteRequested` và `WriteEnabled: o.WriteEnabled`; trong `mcpConsentCommand`, `h.McpAuth.Approve(r.Context(), userID, attempt, in.CSRFToken, orgID, in.Write)`.

- [ ] **Step 5: Sửa mọi lời gọi `Approve` cũ**

Run: `cd server && grep -rn 'McpAuth.Approve(\|svc.Approve(\|w.svc.Approve(' internal --include='*.go'`

Mỗi lời gọi của `McpAuthService.Approve` (không đụng `DesktopAuth...Approve` hay `Approve` của meeting) thêm `, false` làm đối số cuối, trừ `isolation_mcp_seed_test.go` dùng `, true` và đổi `Start` của lần `first` trong `buildMcp` thành có `Scope: "read write"`, để grant của tenant có quyền ghi cho các phase sau.

- [ ] **Step 6: Test HTTP của consent**

Thêm vào `mcp_connect_test.go` một test: attempt xin `read write`, tổ chức đã bật ghi; `GET /api/v1/auth/connect/attempts/{id}` trả `write_requested: true` và tổ chức có `write_enabled: true`; `POST` với `{"decision":"approve","csrf_token":…,"organization_id":…,"write":true}` trả 200; `GET /api/v1/me/connected-apps` trả grant có `scope: "read write"`. Chép khung từ test approve hiện có trong file (tìm `"decision": "approve"`).

- [ ] **Step 7: Chạy test, thấy qua**

Run: `cd server && go build ./... && go test ./internal/service/ -run 'Mcp|Approve|Consent' -count=1 && go test ./internal/handler/ -run 'TestMcp|TestIsolationMCP|TestIsolationMatrix' -count=1`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/pkg/db/queries/mcp.sql server/pkg/db/generated server/internal/service server/internal/handler
git commit -m "feat(mcp): the consent page decides whether a grant may write

The grant holds read write only when the app asked for write, the person
ticked it and the organization allows it; otherwise it is a read grant.
A later consent sets the scope again, up or down, and each change is
audited as mcp_grant.scope_changed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 0.4: Principal biết quyền ghi; audit ghi `via`

**Files:**
- Modify: `server/internal/audit/context.go`, `server/internal/audit/audit.go` (`Record`, `RecordMany`)
- Modify: `server/internal/service/mcp_principal.go`
- Test: `server/internal/audit/recorder_test.go`, `server/internal/service/mcp_principal_test.go`

**Interfaces:**
- Consumes: `orgAccess` (0.2), `mcpScopeHasWrite` (0.1).
- Produces: `type audit.Via struct{ Kind, ClientID, GrantID, ClientName string }`; `RequestInfo.Via *Via`; `func audit.WithVia(ctx context.Context, v Via) context.Context`; `McpPrincipal{UserID, OrganizationID, GrantID, ClientID, ClientName, Scope string; WriteOpen bool}`; `func (p McpPrincipal) CanWrite() bool`.

- [ ] **Step 1: Viết test hỏng**

Thêm vào `server/internal/audit/recorder_test.go`:

```go
// A row recorded inside a request that came through an AI app names the app
// and the grant (ADR 0033); the entry's own metadata survives and is not
// mutated.
func TestRecordWritesTheViaOfTheRequest(t *testing.T) {
	pool := testutil.DB(t)
	ctx := WithVia(context.Background(), Via{Kind: "mcp", ClientID: "c1", GrantID: "g1", ClientName: "Claude"})
	e := entry()
	e.Metadata = map[string]any{"kept": "yes"}
	if err := NewRecorder().Record(ctx, db.New(pool), e); err != nil {
		t.Fatal(err)
	}
	if _, ok := e.Metadata["via"]; ok {
		t.Fatal("Record mutated the caller's metadata map")
	}
	var kind, grant, name, kept string
	if err := pool.QueryRow(context.Background(), `SELECT metadata->'via'->>'kind', metadata->'via'->>'grant_id', metadata->'via'->>'client_name', metadata->>'kept' FROM audit_events`).Scan(&kind, &grant, &name, &kept); err != nil {
		t.Fatal(err)
	}
	if kind != "mcp" || grant != "g1" || name != "Claude" || kept != "yes" {
		t.Fatalf("via = %q %q %q, kept = %q", kind, grant, name, kept)
	}
}

func TestRecordWithoutViaLeavesMetadataAlone(t *testing.T) {
	pool := testutil.DB(t)
	if err := NewRecorder().Record(context.Background(), db.New(pool), entry()); err != nil {
		t.Fatal(err)
	}
	var has bool
	if err := pool.QueryRow(context.Background(), `SELECT metadata ? 'via' FROM audit_events`).Scan(&has); err != nil {
		t.Fatal(err)
	}
	if has {
		t.Fatal("a request without a via wrote one")
	}
}
```

Thêm vào `server/internal/service/mcp_principal_test.go`:

```go
// The principal says whether this call may write: the grant's scope and both
// write switches, read on every request so turning one off acts at once.
func TestAuthenticateReportsWriteAccess(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	if _, err := w.svc.SetWritePolicy(w.ctx, w.owner.ID, w.org.ID, true); err != nil {
		t.Fatal(err)
	}
	c := w.publicClient(t, "https://x.test/cb")
	id := w.startWrite(t, c)
	consent, err := w.svc.Consent(w.ctx, w.owner.ID, id)
	if err != nil {
		t.Fatal(err)
	}
	to, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, true)
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(to)
	pair, err := w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: c.ClientID, Code: u.Query().Get("code"), CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"})
	if err != nil {
		t.Fatal(err)
	}
	p, err := w.svc.Authenticate(w.ctx, pair.AccessToken)
	if err != nil {
		t.Fatal(err)
	}
	if !p.CanWrite() || p.Scope != "read write" || p.ClientName != "Test Client" {
		t.Fatalf("principal = %+v, want a writer named Test Client", p)
	}
	if _, err := w.svc.SetWritePolicy(w.ctx, w.owner.ID, w.org.ID, false); err != nil {
		t.Fatal(err)
	}
	if p, _ = w.svc.Authenticate(w.ctx, pair.AccessToken); p.CanWrite() || p.WriteOpen {
		t.Fatalf("write switch off, principal = %+v", p)
	}
}
```

Kiểm `net/url` đã được import trong file test; nếu chưa, thêm.

- [ ] **Step 2: Chạy test, thấy hỏng**

Run: `cd server && go test ./internal/audit/ -run TestRecordW -count=1; go test ./internal/service/ -run TestAuthenticateReportsWriteAccess -count=1`
Expected: FAIL (`undefined: WithVia`, `p.CanWrite undefined`).

- [ ] **Step 3: Viết code**

`audit/context.go`, thêm vào `RequestInfo`:

```go
	// Via is the channel the request came through when it is not the
	// person's own screen; nil otherwise.
	Via *Via
```

và sau `WithRequest`:

```go
// Via names an AI app that acts for the person through the MCP connector
// (ADR 0033). Record writes it into metadata.via so history can say who
// pressed the key and through what.
type Via struct {
	Kind       string
	ClientID   string
	GrantID    string
	ClientName string
}

// WithVia returns ctx with v added to the request provenance.
func WithVia(ctx context.Context, v Via) context.Context {
	info := RequestFromContext(ctx)
	info.Via = &v
	return WithRequest(ctx, info)
}

// withVia copies m and adds the channel; the caller's map is never mutated,
// since callers reuse it.
func withVia(m map[string]any, v *Via) map[string]any {
	if v == nil {
		return m
	}
	out := make(map[string]any, len(m)+1)
	for k, val := range m {
		out[k] = val
	}
	out["via"] = map[string]any{"kind": v.Kind, "client_id": v.ClientID, "grant_id": v.GrantID, "client_name": v.ClientName}
	return out
}
```

`audit/audit.go`, trong `Record`: `metadata, err := encodeJSON(e.Metadata)` thành `metadata, err := encodeJSON(withVia(e.Metadata, info.Via))`. Trong `RecordMany`, chỗ `metadata, err := encodeJSON(e.Metadata)` thành `metadata, err := encodeJSON(withVia(e.Metadata, info.Via))` (`info` là `RequestFromContext(ctx)` đã đọc ở đầu hàm).

`mcp_principal.go`:

```go
// McpPrincipal is who a /mcp request acts for: the person who consented,
// inside the one organization the grant names, through one AI app.
type McpPrincipal struct {
	UserID, OrganizationID, GrantID, ClientID string
	ClientName                                string
	Scope                                     string // the grant's scope at this call
	// WriteOpen is the write flag and the organization's write switch,
	// read on this request (ADR 0033).
	WriteOpen bool
}

// CanWrite is all three conditions for a write tool: both switches and a
// grant that holds write.
func (p McpPrincipal) CanWrite() bool { return p.WriteOpen && mcpScopeHasWrite(p.Scope) }
```

Trong `Authenticate`, thay:

```go
	enabled, err := s.orgEnabled(ctx, grant.UserID, grant.OrganizationID)
```

bằng:

```go
	enabled, writeOpen, err := s.orgAccess(ctx, grant.UserID, grant.OrganizationID)
```

và trước dòng `_ = s.q.TouchMcpGrant(...)` thêm:

```go
	client, err := s.q.GetMcpClientByClientID(ctx, grant.ClientID)
	if err != nil {
		// A grant keeps its client alive (DeleteAbandonedMcpClients needs no
		// grant), so a missing one is not a token problem.
		return McpPrincipal{}, err
	}
```

Câu `return` cuối thành:

```go
	return McpPrincipal{
		UserID: grant.UserID, OrganizationID: grant.OrganizationID, GrantID: grant.ID, ClientID: grant.ClientID,
		ClientName: client.ClientName, Scope: grant.Scope, WriteOpen: writeOpen,
	}, nil
```

- [ ] **Step 4: Chạy test, thấy qua**

Run: `cd server && go test ./internal/audit/ -count=1 && go test ./internal/service/ -run 'Mcp|Authenticate|Principal' -count=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/audit server/internal/service/mcp_principal.go server/internal/service/mcp_principal_test.go
git commit -m "feat(mcp): audit rows name the AI app; the principal knows if it may write

audit.Via rides on the request provenance; Recorder copies it into
metadata.via, so every service that audits through it records the app
and the grant without a change of its own. The MCP principal now carries
the client name, the grant's scope and both write switches, read on
every request.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 0.5: Transport `/mcp`: annotation theo tool, ẩn tool ghi, cổng ghi, ngân sách, `via`

**Files:**
- Create: `server/internal/middleware/counter.go`, `server/internal/middleware/counter_test.go`
- Create: `server/internal/service/mcp_errors.go`
- Modify: `server/internal/ai/tools.go` (`Tool.Destructive`, `Tool.Undo`, comment đầu file)
- Modify: `server/internal/handler/mcp_transport.go`, `server/internal/handler/router.go:162-164`
- Modify: mọi lời gọi `newMcpHandler(` trong `server/internal/handler/*_test.go`
- Test: `server/internal/handler/mcp_transport_write_test.go` (mới), `server/internal/handler/mcp_transport_test.go` (`TestMcpToolListCarriesAnnotationsAndSchemas`)

**Interfaces:**
- Consumes: `McpPrincipal.CanWrite()`, `WriteOpen`, `ClientName` (0.4); `audit.WithVia` (0.4).
- Produces: `ai.Tool.Destructive bool`, `ai.Tool.Undo string`; `type service.McpToolError struct{ Code, Msg string }` với `Error() string` = `Code + ": " + Msg`; `func middleware.NewCounter(rdb *redis.Client, bucket string, limit int, window time.Duration) *middleware.Counter`; `func (c *Counter) Allow(ctx context.Context, subject string) bool`; `type mcpBudget interface{ Allow(ctx context.Context, subject string) bool }`; `func newMcpHandler(tools ai.Registry, metrics service.McpMetrics, budget mcpBudget, log *slog.Logger) http.Handler`; outcome metric mới `refused`.

- [ ] **Step 1: Viết test hỏng cho Counter**

`server/internal/middleware/counter_test.go`:

```go
package middleware

import (
	"context"
	"testing"
	"time"
)

func TestCounterAllowsUpToTheLimitPerSubject(t *testing.T) {
	c := NewCounter(newRedisTestClient(t), "mcp-write-test", 2, time.Minute)
	ctx := context.Background()
	for i := 1; i <= 2; i++ {
		if !c.Allow(ctx, "g1") {
			t.Fatalf("event %d refused under the limit", i)
		}
	}
	if c.Allow(ctx, "g1") {
		t.Fatal("third event allowed over a limit of 2")
	}
	if !c.Allow(ctx, "g2") {
		t.Fatal("another subject shares the first one's budget")
	}
}

func TestCounterWithoutRedisAllows(t *testing.T) {
	var nilCounter *Counter
	if !NewCounter(nil, "b", 1, time.Minute).Allow(context.Background(), "g") || !nilCounter.Allow(context.Background(), "g") {
		t.Fatal("a counter without Redis refused")
	}
}
```

Run: `cd server && go test ./internal/middleware/ -run TestCounter -count=1`
Expected: FAIL, `undefined: NewCounter`.

- [ ] **Step 2: Viết Counter**

`server/internal/middleware/counter.go`:

```go
package middleware

import (
	"context"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// Counter budgets events that are not one HTTP request each, such as the
// write tools one MCP call runs (ADR 0033). It shares the limiter's script,
// timeout and in-flight cap, and fails open the same way: it slows a runaway
// loop, it does not authorize anything.
type Counter struct {
	rdb      *redis.Client
	bucket   string
	limit    int
	window   time.Duration
	inFlight chan struct{}
}

func NewCounter(rdb *redis.Client, bucket string, limit int, window time.Duration) *Counter {
	return &Counter{rdb: rdb, bucket: bucket, limit: limit, window: window, inFlight: make(chan struct{}, rateLimitMaxInFlight)}
}

// Allow counts one event for subject and reports whether it is within the
// budget. No Redis, or a Redis that fails, allows.
func (c *Counter) Allow(ctx context.Context, subject string) bool {
	if c == nil || c.rdb == nil {
		return true
	}
	n, err := countRequest(ctx, c.rdb, c.inFlight, rateLimitKey(c.limit, c.bucket, identitySubject(subject)), c.window)
	if err != nil {
		slog.Warn("ratelimit: redis error; allowing event", "bucket", c.bucket, "error", err)
		return true
	}
	return n <= int64(c.limit)
}
```

Run: `cd server && go test ./internal/middleware/ -run TestCounter -count=1`
Expected: PASS.

- [ ] **Step 3: Viết test hỏng cho transport**

`server/internal/handler/mcp_transport_write_test.go`:

```go
package handler

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// writeRegistry is one read tool and one destructive write tool that record
// whether they ran and with which via.
func writeRegistry(ran *[]string, via *audit.Via) ai.Registry {
	schema := json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)
	run := func(name string) func(context.Context, ai.ToolContext, json.RawMessage) (json.RawMessage, error) {
		return func(ctx context.Context, _ ai.ToolContext, _ json.RawMessage) (json.RawMessage, error) {
			*ran = append(*ran, name)
			if v := audit.RequestFromContext(ctx).Via; v != nil {
				*via = *v
			}
			return json.RawMessage(`{"ok":true}`), nil
		}
	}
	return ai.Registry{
		{Name: "peek", Title: "Peek", Description: "reads", Kind: ai.ToolRead, Risk: ai.RiskLow, Schema: schema, Handle: run("peek")},
		{Name: "poke", Title: "Poke", Description: "writes", Kind: ai.ToolWrite, Risk: ai.RiskLow, Destructive: true, Undo: "poke back", Schema: schema, Handle: run("poke")},
	}
}

type fakeBudget struct{ left int }

func (b *fakeBudget) Allow(context.Context, string) bool {
	b.left--
	return b.left >= 0
}

func writer() service.McpPrincipal {
	return service.McpPrincipal{UserID: "u1", OrganizationID: "o1", GrantID: "g1", ClientID: "c1", ClientName: "Claude", Scope: "read write", WriteOpen: true}
}

func listedTools(t *testing.T, h http.Handler) map[string]map[string]any {
	t.Helper()
	out := mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	tools := map[string]map[string]any{}
	for _, raw := range out["result"].(map[string]any)["tools"].([]any) {
		tool := raw.(map[string]any)
		tools[tool["name"].(string)] = tool
	}
	return tools
}

// The annotations come from the tool: a write tool is not read-only and says
// whether it is destructive.
func TestMcpAnnotationsFollowTheTool(t *testing.T) {
	var ran []string
	var via audit.Via
	h := mcpServeAs(newMcpHandler(writeRegistry(&ran, &via), &mcpToolCounts{}, nil, slog.New(slog.NewTextHandler(io.Discard, nil))), writer())
	tools := listedTools(t, h)
	peek := tools["peek"]["annotations"].(map[string]any)
	poke := tools["poke"]["annotations"].(map[string]any)
	if peek["readOnlyHint"] != true || peek["destructiveHint"] != false {
		t.Errorf("peek annotations = %v", peek)
	}
	if poke["readOnlyHint"] != false || poke["destructiveHint"] != true || poke["openWorldHint"] != false {
		t.Errorf("poke annotations = %v", poke)
	}
}

// TestMCPWriteToolsNeedScopeFlagAndPolicy holds ADR 0033: without the write
// scope, or with either write switch off, a write tool is not listed and a
// direct call is refused with its own code before the tool runs.
func TestMCPWriteToolsNeedScopeFlagAndPolicy(t *testing.T) {
	cases := []struct {
		name string
		p    service.McpPrincipal
		code string
	}{
		{"read grant", service.McpPrincipal{UserID: "u1", OrganizationID: "o1", GrantID: "g1", Scope: "read", WriteOpen: true}, "insufficient_scope"},
		{"write closed", service.McpPrincipal{UserID: "u1", OrganizationID: "o1", GrantID: "g1", Scope: "read write", WriteOpen: false}, "write_disabled"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var ran []string
			var via audit.Via
			h := mcpServeAs(newMcpHandler(writeRegistry(&ran, &via), &mcpToolCounts{}, nil, slog.New(slog.NewTextHandler(io.Discard, nil))), c.p)
			tools := listedTools(t, h)
			if _, ok := tools["poke"]; ok {
				t.Error("write tool listed")
			}
			if _, ok := tools["peek"]; !ok {
				t.Error("read tool missing")
			}
			out := mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"poke","arguments":{}}}`)
			result, _ := out["result"].(map[string]any)
			if result["isError"] != true || !strings.HasPrefix(resultText(result), c.code+":") {
				t.Errorf("direct call = %v, want %s", out, c.code)
			}
			if len(ran) != 0 {
				t.Errorf("tools ran: %v", ran)
			}
		})
	}
}

// Writes count against the grant's budget; reads never do.
func TestMcpWriteBudget(t *testing.T) {
	var ran []string
	var via audit.Via
	budget := &fakeBudget{left: 1}
	counts := &mcpToolCounts{}
	h := mcpServeAs(newMcpHandler(writeRegistry(&ran, &via), counts, budget, slog.New(slog.NewTextHandler(io.Discard, nil))), writer())
	call := func(tool string) map[string]any {
		out := mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"`+tool+`","arguments":{}}}`)
		res, _ := out["result"].(map[string]any)
		return res
	}
	if res := call("poke"); res["isError"] == true {
		t.Fatalf("first write refused: %v", res)
	}
	if res := call("poke"); res["isError"] != true || !strings.HasPrefix(resultText(res), "write_rate_limited:") {
		t.Fatalf("second write = %v, want write_rate_limited", res)
	}
	if res := call("peek"); res["isError"] == true {
		t.Fatalf("read refused by the write budget: %v", res)
	}
	if strings.Join(ran, ",") != "poke,peek" {
		t.Fatalf("ran = %v", ran)
	}
	if !strings.Contains(counts.joined(), "poke/refused") {
		t.Fatalf("metrics = %s, want poke/refused", counts.joined())
	}
}

// The tool runs with the app named on the audit provenance.
func TestMcpCallCarriesTheVia(t *testing.T) {
	var ran []string
	var via audit.Via
	h := mcpServeAs(newMcpHandler(writeRegistry(&ran, &via), &mcpToolCounts{}, nil, slog.New(slog.NewTextHandler(io.Discard, nil))), writer())
	mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"poke","arguments":{}}}`)
	if via != (audit.Via{Kind: "mcp", ClientID: "c1", GrantID: "g1", ClientName: "Claude"}) {
		t.Fatalf("via = %+v", via)
	}
}

// A refusal the service names (McpToolError) reaches the model as its code
// and message, never as "temporarily unavailable".
func TestMcpToolErrorsReachTheModel(t *testing.T) {
	schema := json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)
	registry := ai.Registry{{Name: "stale", Title: "Stale", Description: "x", Kind: ai.ToolRead, Risk: ai.RiskLow, Schema: schema,
		Handle: func(context.Context, ai.ToolContext, json.RawMessage) (json.RawMessage, error) {
			return nil, service.McpToolError{Code: "revision_conflict", Msg: "someone changed it; current revision is 7"}
		}}}
	h := mcpServeAs(newMcpHandler(registry, &mcpToolCounts{}, nil, slog.New(slog.NewTextHandler(io.Discard, nil))), writer())
	out := mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"stale","arguments":{}}}`)
	res, _ := out["result"].(map[string]any)
	if res["isError"] != true || resultText(res) != "revision_conflict: someone changed it; current revision is 7" {
		t.Fatalf("result = %v", out)
	}
}
```

Run: `cd server && go test ./internal/handler/ -run 'TestMcpAnnotationsFollowTheTool|TestMCPWriteToolsNeedScopeFlagAndPolicy|TestMcpWriteBudget|TestMcpCallCarriesTheVia|TestMcpToolErrorsReachTheModel' -count=1`
Expected: FAIL (biên dịch: `Destructive` unknown field, `newMcpHandler` thiếu đối số, `service.McpToolError` undefined).

- [ ] **Step 4: Viết code**

`ai/tools.go`: comment đầu thành:

```go
// Tool registry (spec §3.4). The registry is source code: no tool is loaded
// from the database. Ask UNI's tools only read (TestAskUniToolsAreReadOnly);
// the MCP connector's write tools run as the human who consented (ADR 0033).
```

và `Tool` thêm:

```go
	// Destructive marks a write that overwrites or removes what was there
	// (MCP destructiveHint). Additive writes leave it false.
	Destructive bool
	// Undo says, in one sentence for the model, how a person reverses this
	// write. Every MCP write tool has one (TestMCPWriteToolsDeclareUndo).
	Undo string
```

`server/internal/service/mcp_errors.go`:

```go
package service

// McpToolError is a refusal the model can read and act on: a stale revision,
// a duplicate, a closed write switch. The transport shows it as
// "code: message"; it never carries another tenant's data.
type McpToolError struct {
	Code string
	Msg  string
}

func (e McpToolError) Error() string { return e.Code + ": " + e.Msg }
```

`mcp_transport.go`:

1. Import `"github.com/unicomhub/uniwork/server/internal/audit"`.
2. Thêm sau `boolPtr`:

```go
// mcpBudget counts write calls per grant (ADR 0033); nil means no budget.
type mcpBudget interface {
	Allow(ctx context.Context, subject string) bool
}

// mcpWriteRefusal is why a write tool may not run for p, or "" when it may.
// The budget is spent only by a call that would otherwise run.
func mcpWriteRefusal(ctx context.Context, p service.McpPrincipal, budget mcpBudget) string {
	switch {
	case !p.WriteOpen:
		return "write_disabled: the organization or UniWork has not opened write access for AI apps; only reading is available"
	case !p.CanWrite():
		return "insufficient_scope: this connection may only read; reconnect UniWork in the AI app and allow create and edit"
	case budget != nil && !budget.Allow(ctx, p.GrantID):
		return "write_rate_limited: too many changes in the last minute; wait a minute and try again"
	}
	return ""
}

// mcpHideWriteTools takes the write tools out of tools/list for a principal
// that cannot write, so a model never plans with a tool it cannot call.
func mcpHideWriteTools(next mcp.MethodHandler) mcp.MethodHandler {
	return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
		res, err := next(ctx, method, req)
		if err != nil || method != "tools/list" {
			return res, err
		}
		p, _ := ctx.Value(mcpPrincipalKey{}).(service.McpPrincipal)
		list, ok := res.(*mcp.ListToolsResult)
		if p.CanWrite() || !ok {
			return res, nil
		}
		kept := make([]*mcp.Tool, 0, len(list.Tools))
		for _, t := range list.Tools {
			if t.Annotations == nil || t.Annotations.ReadOnlyHint {
				kept = append(kept, t)
			}
		}
		out := *list // the SDK may cache its own result; never edit it
		out.Tools = kept
		return &out, nil
	}
}
```

3. `mcpCallContext` thành:

```go
// mcpCallContext is what mcpServe puts on the request before the SDK reads
// it: the principal, the HTTP request's own context, and the app as the
// audit via of every row the tool writes.
func mcpCallContext(r *http.Request, p service.McpPrincipal) context.Context {
	ctx := audit.WithVia(r.Context(), audit.Via{Kind: "mcp", ClientID: p.ClientID, GrantID: p.GrantID, ClientName: p.ClientName})
	ctx = context.WithValue(ctx, mcpPrincipalKey{}, p)
	return context.WithValue(ctx, mcpRequestKey{}, r.Context())
}
```

4. `newMcpHandler(tools ai.Registry, metrics service.McpMetrics, budget mcpBudget, log *slog.Logger)`. Sau `mcp.NewServer(...)`, thêm `srv.AddReceivingMiddleware(mcpHideWriteTools)`. Annotation thành:

```go
			// Annotations come from the tool (ADR 0033): clients may skip the
			// confirmation for a read-only tool and must ask before a write.
			// None is open world: every result comes from the person's
			// organization. The title is repeated here because some clients,
			// and the connector directories' review, read it from the
			// annotations.
			Annotations: &mcp.ToolAnnotations{Title: t.Title, ReadOnlyHint: t.Kind == ai.ToolRead, DestructiveHint: boolPtr(t.Destructive), OpenWorldHint: boolPtr(false)},
```

Trong handler của tool, ngay trước `args, _ := json.Marshal(req.Params.Arguments)`:

```go
			if t.Kind == ai.ToolWrite {
				if why := mcpWriteRefusal(ctx, p, budget); why != "" {
					metrics.ObserveTool(t.Name, "refused", time.Since(start))
					return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: why}}}, nil
				}
			}
```

5. `mcpToolResult`: thêm `var refused service.McpToolError` cạnh `var bad`, và nhánh ngay sau `case err == nil:`:

```go
	case errors.As(err, &refused):
		return "refused", &mcp.CallToolResult{IsError: true, Content: text(refused.Error())}
```

Sửa comment đầu hàm thành `(ok, invalid, refused, not_found, cancelled, error)`.

6. `router.go:163`: `h.mcpHandler = newMcpHandler(service.McpTools(d.McpTools), d.McpAuth.Metrics(), mw.NewCounter(d.Redis, "mcp-write", 30, time.Minute), d.Log)` (import `time` nếu chưa có).

7. Mọi lời gọi `newMcpHandler(` trong file test của handler: thêm `nil` làm đối số thứ ba. Run: `cd server && grep -rn 'newMcpHandler(' internal/handler --include='*_test.go'`.

- [ ] **Step 5: Test annotation trên server thật đọc theo registry**

Trong `mcp_transport_test.go`, `TestMcpToolListCarriesAnnotationsAndSchemas`, thay dòng kiểm `ann["readOnlyHint"] != true || ann["destructiveHint"] != false || ...` bằng:

```go
		def, ok := service.McpTools(&service.McpToolService{}).Get(tool["name"].(string))
		if !ok {
			t.Fatalf("listed tool %v is not in the registry", tool["name"])
		}
		if ann["readOnlyHint"] != (def.Kind == ai.ToolRead) || ann["destructiveHint"] != def.Destructive || ann["openWorldHint"] != false {
			t.Errorf("%v annotations = %v", tool["name"], ann)
		}
```

(import `ai` nếu file chưa có).

- [ ] **Step 6: Chạy test, thấy qua**

Run: `cd server && go build ./... && go test ./internal/handler/ -run 'TestMcp|TestMCP|TestIsolationMCP' -count=1 && go test ./internal/middleware/ -count=1`
Expected: PASS. Nếu `mcpHideWriteTools` không thấy principal trong ctx (test "read grant" vẫn liệt kê `poke`), dừng lại: đọc `AddReceivingMiddleware` trong `$(go env GOMODCACHE)/github.com/modelcontextprotocol/go-sdk@v1.8.0/mcp/server.go` để biết ctx nào tới middleware, rồi lấy principal theo đúng đường đó. Không đổi sang hai server riêng mà không ghi lý do vào ledger.

- [ ] **Step 7: Commit**

```bash
git add server/internal/middleware/counter.go server/internal/middleware/counter_test.go server/internal/service/mcp_errors.go server/internal/ai/tools.go server/internal/handler
git commit -m "feat(mcp): /mcp gates write tools and names the app on every audit row

Annotations now come from each tool. A principal without the write
scope, or with a write switch off, never sees a write tool in tools/list
and a direct call is refused before it runs (insufficient_scope,
write_disabled). Writes spend a budget of 30 a minute per grant; reads do
not. Every call carries the app as audit.Via. A McpToolError from a tool
reaches the model as its code and message.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 0.6: Khung tool ghi ở service, bốn test luật, `CLAUDE.md`

**Files:**
- Create: `server/internal/service/mcp_write.go`, `server/internal/service/mcp_write_test.go`
- Modify: `server/internal/service/mcp_errors.go` (thêm `mcpMapError`)
- Modify: `server/internal/service/mcp_tools.go` (`McpTools` ghép nhóm; tool v1 dùng `hidden` như cũ)
- Modify: `server/internal/service/mcp_tools_test.go` (thay `TestMCPToolsAreReadOnly`)
- Modify: `server/internal/arch_test.go` (thêm `TestMcpToolsCallNoDelete`)
- Modify: `CLAUDE.md` (đoạn External AI clients), `docs/adr/0033-…` không đổi
- Test: các test trên

**Interfaces:**
- Consumes: `McpToolError` (0.5), `ai.Tool.Destructive/Undo` (0.5).
- Produces:
  - `func decodeInto(input json.RawMessage, into any) error`
  - `type mcpOpt[T any] struct{ Set, Null bool; Value T }` với `UnmarshalJSON`, `func (o mcpOpt[T]) ptr() *T`, `func (o mcpOpt[T]) ptr2() **T`
  - `type McpChange struct{ Field string \`json:"field"\`; From any \`json:"from"\`; To any \`json:"to"\` }`
  - `func mcpChanges(pairs ...McpChange) []McpChange` (bỏ cặp bằng nhau, cắt chuỗi dài)
  - `type McpWriteResult struct{ Item any \`json:"item"\`; Revision int64 \`json:"revision,omitempty"\`; Changes []McpChange \`json:"changes,omitempty"\`; Note string \`json:"note,omitempty"\` }`
  - `func mcpReadTool[In any](name, title, desc string, schema json.RawMessage, run func(context.Context, McpPrincipal, In) (any, error)) ai.Tool`
  - `func mcpWriteTool[In any](name, title, desc, undo string, destructive bool, schema json.RawMessage, run func(context.Context, McpPrincipal, In) (any, error)) ai.Tool`
  - `func mcpMapError(err error) error`
  - `var mcpToolCatalogue = []mcpCatalogueEntry{...}` trong test, mỗi phase thêm dòng.

- [ ] **Step 1: Viết test hỏng cho helper**

`server/internal/service/mcp_write_test.go`:

```go
package service

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestDecodeIntoRefusesWhatTheModelCanFix(t *testing.T) {
	type in struct {
		Title string           `json:"title"`
		Due   mcpOpt[string]   `json:"due_date"`
		Tags  []string         `json:"label_ids"`
	}
	var v in
	if err := decodeInto(json.RawMessage(`{"title":"A","due_date":null}`), &v); err != nil {
		t.Fatal(err)
	}
	if v.Title != "A" || !v.Due.Set || !v.Due.Null || v.Due.ptr() != nil || *v.Due.ptr2() != nil {
		t.Fatalf("null due_date read as %+v", v.Due)
	}
	v = in{}
	if err := decodeInto(json.RawMessage(`{"title":"A"}`), &v); err != nil || v.Due.Set || v.Due.ptr2() != nil {
		t.Fatalf("absent due_date read as %+v (%v)", v.Due, err)
	}
	v = in{}
	if err := decodeInto(json.RawMessage(`{"due_date":"2026-10-20"}`), &v); err != nil || **v.Due.ptr2() != "2026-10-20" {
		t.Fatalf("set due_date read as %+v (%v)", v.Due, err)
	}
	for raw, want := range map[string]string{
		`{"titel":"A"}`:     "unknown field titel",
		`{"title":7}`:       "wrong type",
		`[1,2]`:             "JSON object",
		`{"title":"A"} {}`:  "one JSON object",
		`{"label_ids":"x"}`: "wrong type",
	} {
		err := decodeInto(json.RawMessage(raw), &in{})
		var bad McpInvalidArgs
		if !errors.As(err, &bad) || !strings.Contains(bad.Msg, want) {
			t.Errorf("decodeInto(%s) = %v, want McpInvalidArgs containing %q", raw, err, want)
		}
	}
}

func TestMcpChangesDropsEqualPairsAndCutsLongText(t *testing.T) {
	long := strings.Repeat("ê", 2000)
	got := mcpChanges(
		McpChange{Field: "title", From: "A", To: "A"},
		McpChange{Field: "status", From: "todo", To: "done"},
		McpChange{Field: "description", From: long, To: "short"},
	)
	if len(got) != 2 || got[0].Field != "status" {
		t.Fatalf("changes = %+v", got)
	}
	if from := got[1].From.(string); len([]rune(from)) != mcpMaxHitRunes || !strings.HasSuffix(from, mcpHitCut) {
		t.Fatalf("long value not cut to %d runes: %d", mcpMaxHitRunes, len([]rune(from)))
	}
}

func TestMcpMapError(t *testing.T) {
	cases := []struct {
		in       error
		notFound bool
		code     string
		invalid  bool
	}{
		{ErrForbidden, true, "", false},
		{errMemberDeactivated(), true, "", false},
		{CheckTaskRevision(3, 5), false, "revision_conflict", false},
		{CodedError{Code: "active_duplicate_task", Msg: "x"}, false, "active_duplicate_task", false},
		{CodedError{Code: "quota_exceeded", Err: ErrQuotaExceeded}, false, "quota_exceeded", false},
		{Invalid("tiêu đề không được để trống"), false, "", true},
		{errInvalidState(), false, "invalid_meeting_state", false},
		{ErrConflict, false, "conflict", false},
	}
	for _, c := range cases {
		got := mcpMapError(c.in)
		var te McpToolError
		var bad McpInvalidArgs
		switch {
		case c.notFound:
			if !errors.Is(got, ErrNotFound) {
				t.Errorf("%v → %v, want ErrNotFound", c.in, got)
			}
		case c.invalid:
			if !errors.As(got, &bad) || bad.Msg != c.in.Error() {
				t.Errorf("%v → %v, want McpInvalidArgs", c.in, got)
			}
		default:
			if !errors.As(got, &te) || te.Code != c.code || te.Msg == "" {
				t.Errorf("%v → %#v, want McpToolError %s", c.in, got, c.code)
			}
		}
	}
	if got := mcpMapError(CheckTaskRevision(3, 5)); !strings.Contains(got.Error(), "5") {
		t.Errorf("revision_conflict does not name the current revision: %v", got)
	}
	plain := errors.New("db down")
	if mcpMapError(plain) != plain {
		t.Error("an infrastructure error was rewritten")
	}
}
```

Run: `cd server && go test ./internal/service/ -run 'TestDecodeInto|TestMcpChanges|TestMcpMapError' -count=1`
Expected: FAIL, `undefined: decodeInto`.

- [ ] **Step 2: Viết helper**

`server/internal/service/mcp_write.go`:

```go
package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// decodeInto reads a tool's arguments into a typed struct. Unknown fields
// and wrong types come back as McpInvalidArgs the model can fix.
func decodeInto(input json.RawMessage, into any) error {
	trimmed := bytes.TrimSpace(input)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		trimmed = []byte("{}")
	}
	if trimmed[0] != '{' {
		return McpInvalidArgs{Msg: "arguments must be a JSON object"}
	}
	dec := json.NewDecoder(bytes.NewReader(trimmed))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		var typ *json.UnmarshalTypeError
		if errors.As(err, &typ) {
			return McpInvalidArgs{Msg: "field " + typ.Field + " has the wrong type"}
		}
		if field, ok := strings.CutPrefix(err.Error(), "json: unknown field "); ok {
			return McpInvalidArgs{Msg: "unknown field " + strings.Trim(field, `"`)}
		}
		return McpInvalidArgs{Msg: "arguments must be a JSON object"}
	}
	if dec.More() {
		return McpInvalidArgs{Msg: "arguments must be one JSON object"}
	}
	return nil
}

// mcpOpt is a tool field that may be absent (leave it), null (clear it) or
// a value. The services take the same three states as **T.
type mcpOpt[T any] struct {
	Set   bool
	Null  bool
	Value T
}

func (o *mcpOpt[T]) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(bytes.TrimSpace(b)) == "null" {
		o.Null = true
		return nil
	}
	return json.Unmarshal(b, &o.Value)
}

// ptr is the value or nil; absent and null both read as nil.
func (o mcpOpt[T]) ptr() *T {
	if !o.Set || o.Null {
		return nil
	}
	v := o.Value
	return &v
}

// ptr2 is nil for absent, a pointer to nil for null, else the value.
func (o mcpOpt[T]) ptr2() **T {
	if !o.Set {
		return nil
	}
	if o.Null {
		var none *T
		return &none
	}
	v := o.Value
	p := &v
	return &p
}

// McpChange is one field a write changed, for the model to report and undo.
type McpChange struct {
	Field string `json:"field"`
	From  any    `json:"from"`
	To    any    `json:"to"`
}

// mcpChanges keeps the pairs that differ and cuts long text values to the
// length of a search hit.
func mcpChanges(pairs ...McpChange) []McpChange {
	out := []McpChange{}
	for _, c := range pairs {
		if reflect.DeepEqual(c.From, c.To) {
			continue
		}
		if s, ok := c.From.(string); ok {
			c.From = capRunes(s, mcpMaxHitRunes, mcpHitCut)
		}
		if s, ok := c.To.(string); ok {
			c.To = capRunes(s, mcpMaxHitRunes, mcpHitCut)
		}
		out = append(out, c)
	}
	return out
}

// McpWriteResult is what every write tool returns: the record after the
// write, its new revision, what changed, and a note when only part of a
// multi-step write went through.
type McpWriteResult struct {
	Item     any         `json:"item"`
	Revision int64       `json:"revision,omitempty"` // a comment has none
	Changes  []McpChange `json:"changes,omitempty"`
	Note     string      `json:"note,omitempty"`
}

func mcpTypedTool[In any](name, title, desc string, kind ai.ToolKind, destructive bool, undo string, schema json.RawMessage, run func(context.Context, McpPrincipal, In) (any, error)) ai.Tool {
	return ai.Tool{Name: name, Title: title, Description: desc + mcpUntrusted, Kind: kind, Risk: ai.RiskLow, Destructive: destructive, Undo: undo, Schema: schema,
		Handle: func(ctx context.Context, tc ai.ToolContext, input json.RawMessage) (json.RawMessage, error) {
			var in In
			if err := decodeInto(input, &in); err != nil {
				return nil, err
			}
			out, err := run(ctx, principalOf(tc), in)
			if err != nil {
				return nil, mcpMapError(err)
			}
			return json.Marshal(out)
		}}
}

// mcpReadTool is a tool with typed arguments that only reads.
func mcpReadTool[In any](name, title, desc string, schema json.RawMessage, run func(context.Context, McpPrincipal, In) (any, error)) ai.Tool {
	return mcpTypedTool(name, title, desc, ai.ToolRead, false, "", schema, run)
}

// mcpWriteTool is a write tool (ADR 0033). desc says what it changes and who
// sees it; undo is how a person reverses it.
func mcpWriteTool[In any](name, title, desc, undo string, destructive bool, schema json.RawMessage, run func(context.Context, McpPrincipal, In) (any, error)) ai.Tool {
	return mcpTypedTool(name, title, desc+" To undo: "+undo+".", ai.ToolWrite, destructive, undo, schema, run)
}
```

`mcp_errors.go`, thêm:

```go
import (
	"errors"
	"fmt"
)

// mcpToolMessages is what the model reads for a service refusal it can act
// on. Codes absent here pass with the service's own message.
var mcpToolMessages = map[string]string{
	"active_duplicate_task":     "an active task with this title already exists here; read it instead of creating another",
	"duplicate_project_title":   "a project with this title already exists in the workspace",
	"assignee_not_member":       "that person is not a member of this workspace; call list_members for who can be assigned",
	"quota_exceeded":            "the organization has reached its plan limit for this",
	"parent_cycle":              "that parent would make the task its own ancestor",
	"cross_workspace_reference": "tasks, projects and parents must all be in the same workspace",
	"invalid_meeting_state":     "the meeting's current status does not allow this",
	"not_meeting_host":          "only the meeting's host or a workspace admin may do this",
	"not_project_editor":        "only the project's creator, its lead or a workspace admin may edit it",
	"conflict":                  "it changed while this call ran; read it again and retry",
}

// mcpMapError turns a service error into what a tool returns. Refusals that
// could tell a model which ids exist become ErrNotFound (hidden); a stale
// revision names the current one; a validation message passes as
// McpInvalidArgs; known codes become McpToolError; anything else is left
// for the transport to call "temporarily unavailable".
func mcpMapError(err error) error {
	if err = hidden(err); errors.Is(err, ErrNotFound) {
		return ErrNotFound
	}
	var invalid ValidationError
	if errors.As(err, &invalid) {
		return McpInvalidArgs{Msg: invalid.Msg}
	}
	var ce CodedError
	if errors.As(err, &ce) {
		if ce.Code == "revision_conflict" {
			current := ce.Fields["want"]
			if current == nil {
				current = ce.Fields["current_revision"]
			}
			return McpToolError{Code: "revision_conflict", Msg: fmt.Sprintf("someone changed it since you read it; the current revision is %v, read it again before writing", current)}
		}
		if msg, ok := mcpToolMessages[ce.Code]; ok {
			return McpToolError{Code: ce.Code, Msg: msg}
		}
		if errors.Is(ce, ErrQuotaExceeded) {
			return McpToolError{Code: "quota_exceeded", Msg: mcpToolMessages["quota_exceeded"]}
		}
		return McpToolError{Code: ce.Code, Msg: ce.Error()}
	}
	switch {
	case errors.Is(err, ErrQuotaExceeded):
		return McpToolError{Code: "quota_exceeded", Msg: mcpToolMessages["quota_exceeded"]}
	case errors.Is(err, ErrConflict):
		return McpToolError{Code: "conflict", Msg: mcpToolMessages["conflict"]}
	}
	return err
}
```

`hidden` trả `ErrNotFound` cho các lỗi quyền; nhưng `ErrNotFound` gốc của service cũng phải qua được, nên dòng đầu kiểm `errors.Is(err, ErrNotFound)` sau khi gọi `hidden`.

Khóa đã kiểm: task dùng `want` (`CheckTaskRevision`), tài liệu dùng `current_revision`, giá trị là chuỗi số (`document_pages.go:93`); `%v` in cả hai.

- [ ] **Step 3: Chạy test helper, thấy qua**

Run: `cd server && go test ./internal/service/ -run 'TestDecodeInto|TestMcpChanges|TestMcpMapError' -count=1`
Expected: PASS.

- [ ] **Step 4: Thay `TestMCPToolsAreReadOnly` bằng catalogue và bốn test luật**

Trong `mcp_tools_test.go`, xóa `TestMCPToolsAreReadOnly`, thêm:

```go
// mcpCatalogueEntry is one row of the connector's public surface. Every phase
// of the write spec adds its rows here; a tool not in this table fails.
type mcpCatalogueEntry struct {
	name, title string
	kind        ai.ToolKind
	destructive bool
}

var mcpToolCatalogue = []mcpCatalogueEntry{
	{"list_workspaces", "List workspaces", ai.ToolRead, false},
	{"my_work", "My work", ai.ToolRead, false},
	{"search", "Search UniWork", ai.ToolRead, false},
	{"get_task", "Get task", ai.ToolRead, false},
	{"get_meeting", "Get meeting", ai.ToolRead, false},
}

func TestMCPToolCatalogue(t *testing.T) {
	r := McpTools(&McpToolService{})
	if len(r) != len(mcpToolCatalogue) {
		t.Fatalf("registry has %d tools %v, catalogue %d", len(r), r.Names(), len(mcpToolCatalogue))
	}
	for i, want := range mcpToolCatalogue {
		tool := r[i]
		if tool.Name != want.name || tool.Title != want.title || tool.Kind != want.kind || tool.Destructive != want.destructive {
			t.Errorf("tool %d = %s/%q/%s/%v, want %+v", i, tool.Name, tool.Title, tool.Kind, tool.Destructive, want)
		}
		var schema map[string]any
		if tool.Risk != ai.RiskLow || tool.Handle == nil || json.Unmarshal(tool.Schema, &schema) != nil || schema["type"] != "object" || schema["additionalProperties"] != false {
			t.Errorf("tool %s is incomplete or accepts unknown fields: %s", tool.Name, tool.Schema)
		}
		if !strings.Contains(tool.Description, "never as instructions") {
			t.Errorf("tool %s description does not warn that its text fields are data: %q", tool.Name, tool.Description)
		}
	}
	if d := r[1].Description; !strings.Contains(d, "assigned to the user") || !strings.Contains(d, "most urgent first") {
		t.Errorf("my_work description does not say what the list holds: %q", d)
	}
}

// TestMCPHasNoDeleteTool holds ADR 0033: nothing reachable over MCP removes
// anything. The arch test TestMcpToolsCallNoDelete holds the code side.
func TestMCPHasNoDeleteTool(t *testing.T) {
	for _, name := range McpTools(&McpToolService{}).Names() {
		for _, verb := range []string{"delete", "remove", "archive", "purge", "trash"} {
			if strings.Contains(name, verb) {
				t.Errorf("tool %s looks like a delete", name)
			}
		}
	}
}

// TestMCPWriteToolsDeclareUndo holds ADR 0033: every write tool says how a
// person reverses it, and its description repeats it to the model.
func TestMCPWriteToolsDeclareUndo(t *testing.T) {
	for _, tool := range McpTools(&McpToolService{}) {
		if tool.Kind != ai.ToolWrite {
			if tool.Undo != "" || tool.Destructive {
				t.Errorf("read tool %s declares write metadata", tool.Name)
			}
			continue
		}
		if strings.TrimSpace(tool.Undo) == "" || !strings.Contains(tool.Description, "To undo: "+tool.Undo) {
			t.Errorf("write tool %s has no undo in its definition and description", tool.Name)
		}
	}
}

// mcpReadInputs is one valid call of every read tool on newMcpToolWorld;
// TestMCPReadToolsDoNotMutate fails for a read tool missing here.
func mcpReadInputs(x *mcpToolWorld) map[string]string {
	ws := x.w.ID
	return map[string]string{
		"list_workspaces": `{}`,
		"my_work":         `{}`,
		"search":          `{"workspace_id":"` + ws + `","query":"báo cáo"}`,
		"get_task":        `{"workspace_id":"` + ws + `","task_id":"` + x.taskID + `"}`,
		"get_meeting":     `{"workspace_id":"` + ws + `","meeting_id":"` + x.meetingID + `"}`,
	}
}

// TestMCPReadToolsDoNotMutate holds the read half of ADR 0033: running every
// read tool leaves no audit row and no outbox row behind.
func TestMCPReadToolsDoNotMutate(t *testing.T) {
	x := newMcpToolWorld(t)
	x.meetingID = x.meeting(t, x.ua.ID, x.w.ID, "Họp giao ban", "").ID
	inputs := mcpReadInputs(x)
	count := func() (n int) {
		if err := x.tools.ask.pool.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM audit_events WHERE organization_id = $1) + (SELECT count(*) FROM outbox_events WHERE organization_id = $1)`, x.w.OrganizationID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	before := count()
	for _, tool := range McpTools(x.tools) {
		if tool.Kind != ai.ToolRead {
			continue
		}
		input, ok := inputs[tool.Name]
		if !ok {
			t.Errorf("read tool %s has no input in mcpReadInputs", tool.Name)
			continue
		}
		if _, err := callMcpTool(t, x.tools, x.p, tool.Name, input); err != nil {
			t.Errorf("%s: %v", tool.Name, err)
		}
	}
	if after := count(); after != before {
		t.Fatalf("read tools wrote %d audit/outbox rows", after-before)
	}
}
```

Thêm trường `meetingID string` vào `mcpToolWorld`. `outbox_events.organization_id` có từ migration `062`.

`McpTools` (trong `mcp_tools.go`) đổi comment thành `// McpTools is the MCP registry: the five v1 read tools, then each area's tools (ADR 0033). TestMCPToolCatalogue pins its order.` Phase 0 chưa thêm nhóm nào.

`server/internal/arch_test.go`, thêm:

```go
// TestMcpToolsCallNoDelete holds ADR 0033 on the code side: no MCP tool file
// calls a command that deletes or archives.
func TestMcpToolsCallNoDelete(t *testing.T) {
	files, err := filepath.Glob("service/mcp_tools*.go")
	if err != nil {
		t.Fatal(err)
	}
	banned := regexp.MustCompile(`\.(Delete\w*|BatchDelete\w*|ArchiveDocument|DeleteComment|DeleteProject)\(`)
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if loc := banned.FindIndex(raw); loc != nil {
			t.Errorf("%s calls %s; MCP tools never delete (ADR 0033)", f, raw[loc[0]:loc[1]])
		}
	}
}
```

Kiểm import `filepath`, `regexp`, `os`, `strings` trong `arch_test.go`; đường dẫn tương đối theo thư mục của file (`server/internal`), giống các test khác trong file (xem cách chúng mở file).

- [ ] **Step 5: `CLAUDE.md`**

Trong mục Audit and Events, câu:

```
  `TestSessionTokenRejectedByMCP`. Its tools act as the human who consented,
  through `RequireMember`, and only read: `TestMCPToolsAreReadOnly`. A write
  tool, when one exists, follows ADR 0010.
```

thay bằng:

```
  `TestSessionTokenRejectedByMCP`. Its tools act as the human who consented,
  through `RequireMember` (ADR 0033): read tools never write
  (`TestMCPReadToolsDoNotMutate`); write tools run only with the `write`
  scope, the `mcp_connector_write` flag and the organization's write switch
  (`TestMCPWriteToolsNeedScopeFlagAndPolicy`), never delete
  (`TestMCPHasNoDeleteTool`, `TestMcpToolsCallNoDelete`), each names its undo
  (`TestMCPWriteToolsDeclareUndo`), and every row they audit carries
  `metadata.via`.
```

Ngắt dòng theo độ rộng của đoạn xung quanh.

- [ ] **Step 6: Chạy test, thấy qua**

Run: `cd server && go test ./internal/service/ -run 'TestMCP|TestMcp' -count=1 && go test ./internal/ -run 'TestMcpToolsCallNoDelete|TestArch' -count=1 && cd .. && node --test scripts/governance.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/internal/service/mcp_write.go server/internal/service/mcp_write_test.go server/internal/service/mcp_errors.go server/internal/service/mcp_tools.go server/internal/service/mcp_tools_test.go server/internal/arch_test.go CLAUDE.md
git commit -m "feat(mcp): typed tool helpers and the four rules of ADR 0033

decodeInto and mcpOpt read typed arguments, telling an absent field from
a null one; mcpChanges and McpWriteResult shape what a write returns;
mcpMapError turns service refusals into answers a model can act on
without revealing other tenants. TestMCPToolsAreReadOnly gives way to a
catalogue test and the four rules ADR 0033 names; CLAUDE.md cites them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 0.7: Web: đồng ý quyền ghi, công tắc ghi, nhãn scope, "(qua Claude)"

**Files:**
- Modify: `packages/core/api/endpoints/connect.ts`, `connect.test.ts`
- Modify: `packages/core/connect/hooks.ts`, `hooks.test.tsx`
- Modify: `packages/views/auth/connect-consent.tsx`, `connect-consent.test.tsx`
- Modify: `apps/web/app/(auth)/auth/connect/authorize/page.tsx`
- Modify: `packages/views/settings/components/ai-access-tab.tsx`, `ai-access-tab.test.tsx`
- Modify: `packages/views/settings/components/connected-apps-tab.tsx`, `connected-apps-tab.test.tsx`
- Modify: `packages/views/tasks/detail/components/activity-row.tsx`, `activity-row.test.tsx`
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`

**Interfaces:**
- Consumes: SDO `write_requested`, `organizations[].write_enabled` (0.3); policy `write_enabled`, `write_available`, `write_enabled_at`, `write_enabled_by`; route `PUT /orgs/{org}/mcp-policy/write` (0.2); audit `metadata.via.client_name` (0.4).
- Produces: `ConnectConsent.write_requested: boolean`; org `write_enabled: boolean`; `decideConnectConsent(attemptId, { decision, csrf_token, organization_id?, write? })`; `McpPolicy.write_enabled/write_available/write_enabled_at/write_enabled_by`; `setMcpWritePolicy(orgSlug, enabled): Promise<McpPolicy | null>`; `useSetMcpWritePolicy(orgSlug)`; `ConnectConsentView` prop `onDecision(decision, organizationId?, write?)`.

- [ ] **Step 1: Test endpoint hỏng**

Trong `connect.test.ts`, thêm (chép khung mock từ test `setMcpPolicy` có sẵn trong file):

```ts
it("reads the write fields of a consent and of a policy, defaulting them off", async () => {
  requestMock.mockResolvedValueOnce({ attempt_id: "a", status: "pending", organizations: [{ id: "o", slug: "s", name: "N", enabled: true }] });
  const consent = await getConnectConsent("a");
  expect(consent?.write_requested).toBe(false);
  expect(consent?.organizations[0]?.write_enabled).toBe(false);
  requestMock.mockResolvedValueOnce({ enabled: true, available: true, mcp_url: "u", write_enabled: true, write_available: true });
  const policy = await getMcpPolicy("acme");
  expect(policy?.write_enabled).toBe(true);
  expect(policy?.write_enabled_at).toBeNull();
});

it("sets the write policy on its own route and degrades on a malformed answer", async () => {
  requestMock.mockResolvedValueOnce({ enabled: true, available: true, mcp_url: "u", write_enabled: true, write_available: true });
  await expect(setMcpWritePolicy("acme", true)).resolves.toMatchObject({ write_enabled: true });
  expect(requestMock).toHaveBeenLastCalledWith("/api/v1/orgs/acme/mcp-policy/write", { method: "PUT", body: { enabled: true } });
  requestMock.mockResolvedValueOnce({ write_enabled: "yes" });
  await expect(setMcpWritePolicy("acme", true)).resolves.toBeNull();
});
```

`requestMock` là mock mà `connect.test.ts` khai báo sẵn (dòng 13).

Run: `pnpm --filter @uniwork/core exec vitest run api/endpoints/connect.test.ts`
Expected: FAIL.

- [ ] **Step 2: Endpoint và hook**

`connect.ts`:
- `ConsentOrgSchema` thêm `write_enabled: z.boolean().optional().default(false),`.
- `ConnectConsentSchema` thêm `write_requested: z.boolean().optional().default(false),`.
- `decideConnectConsent` body thêm `write?: boolean`.
- `McpPolicySchema` thêm:

```ts
  write_enabled: z.boolean().optional().default(false),
  write_available: z.boolean().optional().default(false),
  write_enabled_at: z.string().nullable().optional().default(null),
  write_enabled_by: z.string().optional().default(""),
```

- Thêm:

```ts
/** Lets connected AI apps create and edit (ADR 0033); needs the connector on. */
export async function setMcpWritePolicy(orgSlug: string, enabled: boolean): Promise<McpPolicy | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgSlug)}/mcp-policy/write`, { method: "PUT", body: { enabled } });
  return parseWithFallback<McpPolicy | null>(raw, McpPolicySchema, null, { endpoint: "PUT /api/v1/orgs/{org}/mcp-policy/write" });
}
```

`hooks.ts`, thêm:

```ts
export function useSetMcpWritePolicy(orgSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const policy = await connect.setMcpWritePolicy(orgSlug, enabled);
      if (!policy) throw new Error("mcp write policy response did not parse");
      return policy;
    },
    onSuccess: (policy) => qc.setQueryData(connectKeys.policy(orgSlug), policy),
  });
}
```

Xuất `useSetMcpWritePolicy` ở `packages/core/connect/index.ts` (cùng cách xuất `useSetMcpPolicy`). Thêm test cho hook vào `hooks.test.tsx` theo khung test của `useSetMcpPolicy`.

Run: `pnpm --filter @uniwork/core exec vitest run api/endpoints/connect.test.ts connect/hooks.test.tsx`
Expected: PASS.

- [ ] **Step 3: i18n**

`vi.json`, trong `auth.connect`:

```json
      "descriptionWrite": "Ứng dụng này sẽ đọc dữ liệu công việc của bạn trong tổ chức bạn chọn. Nếu bạn cho phép, nó còn tạo và sửa thay bạn, nhưng không bao giờ xóa.",
      "allowWrite": "Cho phép tạo và sửa",
      "allowWriteHint": "Ứng dụng hỏi bạn trước mỗi thay đổi. Mỗi thay đổi ghi tên bạn kèm tên ứng dụng và hoàn tác được.",
```

trong `settings.aiAccess`:

```json
      "writeLabel": "Cho phép tạo và sửa",
      "writeDescription": "Ứng dụng đã kết nối được tạo và sửa công việc thay thành viên, khi thành viên cho phép. Không bao giờ xóa. Tắt sẽ chặn ngay mọi thao tác ghi; quyền đọc giữ nguyên.",
      "writeNeedsConnector": "Bật truy cập của trợ lý AI trước.",
      "writeUnavailable": "Quyền ghi chưa mở cho tổ chức của bạn.",
```

trong `settings.connectedApps`: `"scopeRead": "Chỉ đọc", "scopeWrite": "Đọc và ghi",` và cùng hai key đó trong `settings.aiAccess`. Trong `tasks.detail`: `"activity_via": "qua {{client}}",`.

`en.json` cùng key: `descriptionWrite`: "This app will read your work data in the organization you choose. If you allow it, it can also create and edit for you, but never delete."; `allowWrite`: "Allow create and edit"; `allowWriteHint`: "The app asks you before each change. Each change is recorded with your name and the app's, and can be undone."; `writeLabel`: "Allow create and edit"; `writeDescription`: "Connected apps may create and edit work for members who allow it. Never delete. Turning this off blocks every write at once; reading stays."; `writeNeedsConnector`: "Turn on AI assistant access first."; `writeUnavailable`: "Write access is not open for your organization yet."; `scopeRead`: "Read only"; `scopeWrite`: "Read and write"; `activity_via`: "via {{client}}".

Đặt key đúng vị trí theo thứ tự hiện có trong từng khối; kiểm bằng `node --test scripts/*.test.mjs` nếu repo có test so khớp key vi/en.

- [ ] **Step 4: Màn đồng ý**

Test trong `connect-consent.test.tsx`: sửa hai kỳ vọng cũ `toHaveBeenCalledWith("approve", "o1")` thành `("approve", "o1", false)` và `("approve", "o3")` thành `("approve", "o3", false)`. Thêm:

```tsx
  it("offers write only when the app asks and the organization allows it, unticked", async () => {
    const onDecision = vi.fn(async () => {});
    const consent: ConnectConsent = { ...base, write_requested: true, organizations: [{ ...base.organizations[0]!, write_enabled: true }] };
    render(wrap(<ConnectConsentView consent={consent} onDecision={onDecision} />));
    const box = screen.getByRole("checkbox", { name: "Allow create and edit" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("approve", "o1", true));
  });

  it("hides the write option when the organization has not opened it", () => {
    const consent: ConnectConsent = { ...base, write_requested: true, organizations: [{ ...base.organizations[0]!, write_enabled: false }] };
    render(wrap(<ConnectConsentView consent={consent} onDecision={vi.fn(async () => {})} />));
    expect(screen.queryByRole("checkbox", { name: "Allow create and edit" })).not.toBeInTheDocument();
  });
```

`base` thêm `write_requested: false` và org `write_enabled: false` để khớp kiểu.

`connect-consent.tsx`:
- Import `Checkbox` từ `@uniwork/ui/components/ui/checkbox`.
- Prop `onDecision: (decision: "approve" | "cancel", organizationId?: string, write?: boolean) => Promise<void>;`
- State `const [allowWrite, setAllowWrite] = useState(false);`
- Sau khi tính `orgId`: `const writeOffered = !!consent?.write_requested && enabled.some((o) => o.id === orgId && o.write_enabled);`
- Trong `decide`: `await onDecision(decision, decision === "approve" ? orgId : undefined, decision === "approve" && writeOffered && allowWrite);`
- Dòng mô tả: `<p className="text-body text-muted-foreground">{t(writeOffered ? "auth.connect.descriptionWrite" : "auth.connect.description")}</p>`.
- Sau `</fieldset>` của tổ chức:

```tsx
              {writeOffered ? (
                <label htmlFor="connect-allow-write" className="flex items-start gap-3 rounded-lg border border-border/70 p-3">
                  <Checkbox id="connect-allow-write" checked={allowWrite} onCheckedChange={(next) => setAllowWrite(next === true)} />
                  <span className="flex flex-col">
                    <span className="font-semibold">{t("auth.connect.allowWrite")}</span>
                    <span className="text-caption text-muted-foreground">{t("auth.connect.allowWriteHint")}</span>
                  </span>
                </label>
              ) : null}
```

`page.tsx`: `onDecision={async (decision, organizationId, write) => {` và body gửi `write`:

```tsx
          const result = await api.connect.decideConnectConsent(consent.attempt_id, { decision, csrf_token: consent.csrf_token, organization_id: organizationId, write });
```

- [ ] **Step 5: Công tắc ghi và nhãn scope**

Test trong `ai-access-tab.test.tsx` (chép khung mock policy có sẵn):
1. Policy `{enabled:true, available:true, write_enabled:false, write_available:true}`: có switch tên "Allow create and edit", bật nó gọi `PUT /api/v1/orgs/{org}/mcp-policy/write` với `{enabled:true}`.
2. Policy `{enabled:false, …}`: switch ghi có `aria-disabled="true"` và hiện "Turn on AI assistant access first.".
3. Policy `{enabled:true, write_available:false, write_enabled:false}`: switch ghi `aria-disabled="true"` và hiện "Write access is not open for your organization yet.".
4. Grant `scope: "read write"` hiện "Read and write"; `scope: "read"` hiện "Read only".

`ai-access-tab.tsx`:
- `import { …, useSetMcpWritePolicy } from "@uniwork/core/connect";` và `const setWrite = useSetMcpWritePolicy(org);`.
- Trong nhánh `else` dựng `toggle`, thêm một `SettingsRow` thứ hai trong cùng `SettingsCard`:

```tsx
        <SettingsRow label={t("writeLabel")} description={t("writeDescription")}>
          <Switch
            aria-label={t("writeLabel")}
            checked={state.write_enabled}
            aria-busy={setWrite.isPending || undefined}
            aria-disabled={setWrite.isPending || (!state.write_enabled && (!state.enabled || !state.write_available)) || undefined}
            className="aria-busy:opacity-60 pointer-coarse:after:-inset-y-[13px]"
            onCheckedChange={(next) => {
              // Off is always allowed; on needs the connector and the platform.
              if (setWrite.isPending || (next === true && (!state.enabled || !state.write_available))) return;
              void setWrite.mutateAsync(next === true).catch(() => undefined);
            }}
          />
        </SettingsRow>
```

- Dưới `toggle`, cạnh dòng `unavailable`:

```tsx
        {state && !state.enabled ? <p className="px-1 pt-2 text-caption text-muted-foreground">{t("writeNeedsConnector")}</p>
          : state && !state.write_available ? <p className="px-1 pt-2 text-caption text-muted-foreground">{t("writeUnavailable")}</p> : null}
        {setWrite.isError ? <p role="alert" className="px-1 pt-2 text-caption text-destructive">{t("saveFailed")}</p> : null}
```

- Danh sách grant: `badge` thành hai badge cạnh nhau, thêm badge scope:

```tsx
                badge={
                  <>
                    {g.verified ? <SettingsBadge tone="success">{i18n.t("settings.connectedApps.verified")}</SettingsBadge> : null}
                    <SettingsBadge tone="muted">{t(g.scope.split(" ").includes("write") ? "scopeWrite" : "scopeRead")}</SettingsBadge>
                  </>
                }
```

`tone` là tùy chọn (`SettingsBadgeTone`, `settings-layout.tsx:278`); `muted` là tone trung tính.

`connected-apps-tab.tsx`: cùng badge scope, key `settings.connectedApps.scopeWrite/scopeRead`. Thêm một ca test tương ứng trong `connected-apps-tab.test.tsx`.

- [ ] **Step 6: "(qua Claude)" trong lịch sử task**

Test trong `activity-row.test.tsx`:

```tsx
it("names the AI app a change came through", () => {
  const event = { ...baseEvent, metadata: { via: { kind: "mcp", client_name: "Claude" } } };
  render(wrap(<TaskActivityRow event={event} actorName="Lan" />));
  expect(screen.getByText("via Claude")).toBeInTheDocument();
});

it("ignores a via the server sent malformed", () => {
  const event = { ...baseEvent, metadata: { via: "Claude" } };
  render(wrap(<TaskActivityRow event={event} actorName="Lan" />));
  expect(screen.queryByText(/via/)).not.toBeInTheDocument();
});
```

Dùng đúng biến sự kiện mẫu và helper render mà file test đang dùng (đổi `baseEvent`, `wrap` cho khớp).

`activity-row.tsx`, thêm hàm trên `TaskActivityRow`:

```tsx
/** The AI app a change came through (ADR 0033), or "" when none or malformed. */
function viaClient(event: AuditEvent): string {
  const via = event.metadata.via;
  if (typeof via !== "object" || via === null) return "";
  const name = (via as Record<string, unknown>).client_name;
  return typeof name === "string" ? name : "";
}
```

và ngay sau `</span>` của tên actor:

```tsx
      {viaClient(event) ? <span>{t("tasks.detail.activity_via", { client: viaClient(event) })}</span> : null}
```

- [ ] **Step 7: Chạy test, thấy qua**

Run: `pnpm --filter @uniwork/core exec vitest run connect && pnpm --filter @uniwork/views exec vitest run auth/connect-consent settings/components/ai-access-tab settings/components/connected-apps-tab tasks/detail/components/activity-row && pnpm typecheck && pnpm lint`
Expected: PASS (ở `GATE_LEVEL=fast` lint in lỗi mà không fail: đọc output, sửa hết lỗi của file vừa đụng).

- [ ] **Step 8: Commit**

```bash
git add packages/core/api/endpoints/connect.ts packages/core/api/endpoints/connect.test.ts packages/core/connect packages/views/auth packages/views/settings/components packages/views/tasks/detail/components/activity-row.tsx packages/views/tasks/detail/components/activity-row.test.tsx packages/core/i18n/locales "apps/web/app/(auth)/auth/connect/authorize/page.tsx"
git commit -m "feat(mcp): consent offers write, admins switch it, history names the app

The consent page offers \"Allow create and edit\", unticked, only when
the app asked and the organization allows it. Settings › AI access gains
the write switch, which needs the connector on. Connected apps show
their scope, and a task's history says \"via Claude\" for a change an AI
app made.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 0.8: Kiểm chứng Phase 0

- [ ] **Step 1: Chạy gate**

Run: `make check`
Expected: PASS. Ở `GATE_LEVEL=fast` lint và coverage TS chỉ in; đọc output, sửa lỗi thuộc file của phase này.

- [ ] **Step 2: Thử tay với Claude (local)**

1. `make start`; bật flag `mcp_connector` và `mcp_connector_write` cho tổ chức thử ở `/admin/flags` (local).
2. Settings › Truy cập AI: bật connector, bật "Cho phép tạo và sửa".
3. Thêm connector `http://localhost:<api-port>/mcp` trong Claude Code (`claude mcp add --transport http uniwork-local …`), đồng ý có tick ghi.
4. `tools/list` chưa có tool ghi nào (Phase 0 chưa thêm tool); tool đọc vẫn chạy; trong `/admin`, dòng audit `mcp_grant.created` có scope `read write`.
5. Tắt "Cho phép tạo và sửa": đọc vẫn chạy.

- [ ] **Step 3: Note và hỏi push/PR**

```bash
make issue-note KEY=<UNI-key Phase 0> MSG="[agent] Phase 0 xong trên nhánh: scope write, công tắc ghi + flag mcp_connector_write, consent có ô ghi, via trên audit, cổng ghi + ngân sách ở /mcp, bốn test luật ADR 0033, web. make check: <kết quả>. Chưa push."
```

Dừng, hỏi người dùng trước khi `make issue-pr`.

---

# Phase 1 — Task

Sub-issue: `MCP v2 Phase 1: tool Task`. Bắt đầu khi PR Phase 0 đã merge.

### Task 1.1: `UpdateTaskInput.ExpectedRevision`

**Files:**
- Modify: `server/internal/service/task.go:76-89` (`UpdateTaskInput`), `:744` (`updateTaskInTx`)
- Test: `server/internal/service/task_revision_test.go` (mới)

**Interfaces:**
- Produces: `UpdateTaskInput.ExpectedRevision *int64` — nil không kiểm; khác nil thì `TaskService.Update` trả `revision_conflict` (`CheckTaskRevision`) khi revision ngay trước lệnh khác giá trị này, và không ghi gì.

- [ ] **Step 1: Viết test hỏng**

`server/internal/service/task_revision_test.go`:

```go
package service

import (
	"context"
	"testing"
)

// An update that names the revision it read is refused, and writes nothing,
// once someone else has changed the task (ADR 0033).
func TestUpdateRefusesAStaleExpectedRevision(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	tasks := x.tools.ask.tasks
	task, err := tasks.Get(ctx, x.ua.ID, x.taskID)
	if err != nil {
		t.Fatal(err)
	}
	read := task.Revision
	first := "Bản mới"
	if _, err := tasks.Update(ctx, Human(x.ua.ID), x.taskID, UpdateTaskInput{Title: &first, ExpectedRevision: &read}); err != nil {
		t.Fatalf("update at the read revision: %v", err)
	}
	second := "Ghi đè"
	_, err = tasks.Update(ctx, Human(x.ua.ID), x.taskID, UpdateTaskInput{Title: &second, ExpectedRevision: &read})
	if !codedIs(err, "revision_conflict") {
		t.Fatalf("stale update: %v, want revision_conflict", err)
	}
	after, _ := tasks.Get(ctx, x.ua.ID, x.taskID)
	if after.Title != first || after.Revision != read+1 {
		t.Fatalf("after the refused update: title %q revision %d", after.Title, after.Revision)
	}
}
```

Run: `cd server && go test ./internal/service/ -run TestUpdateRefusesAStaleExpectedRevision -count=1`
Expected: FAIL, `unknown field ExpectedRevision`.

- [ ] **Step 2: Viết code**

`UpdateTaskInput` thêm:

```go
	// ExpectedRevision, when set, is the revision the caller read; a task
	// that moved since is refused with revision_conflict (MCP, ADR 0033).
	ExpectedRevision *int64
```

Trong `updateTaskInTx`, ngay sau dòng `revisionBefore := task.Revision - 1`:

```go
	if in.ExpectedRevision != nil {
		if err := CheckTaskRevision(*in.ExpectedRevision, revisionBefore); err != nil {
			return db.Task{}, err
		}
	}
```

`UpdateTask` đã lấy khóa dòng, nên phép so này đúng dưới đồng thời; lỗi làm transaction của caller rollback.

- [ ] **Step 3: Chạy test, thấy qua**

Run: `cd server && go test ./internal/service/ -run 'TestUpdateRefusesAStaleExpectedRevision|TestTask' -count=1`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/task.go server/internal/service/task_revision_test.go
git commit -m "feat(tasks): an update may name the revision it read

UpdateTaskInput.ExpectedRevision is checked under the row lock against
the revision the task had right before this update; a mismatch is
revision_conflict and nothing is written. The MCP update_task tool needs
it (ADR 0033); every existing caller leaves it nil.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.2: Tool đọc của Task: `list_members`, `task_options`, `list_tasks`, `get_task` mở rộng

**Files:**
- Create: `server/internal/service/mcp_tools_tasks.go`
- Modify: `server/pkg/db/queries/workspaces.sql` (query `ListAssignableMembers`)
- Modify: `server/internal/service/workspace.go` (method `AssignableMembers`)
- Modify: `server/internal/service/mcp_tools.go` (`GetTask` trả `McpTask`; `McpTools` ghép `mcpTaskTools`)
- Test: `server/internal/service/mcp_tools_tasks_test.go` (mới); `mcp_tools_test.go` (catalogue, `mcpReadInputs`, `TestMcpToolOutputsCarryOnlyDocumentedFields`)

**Interfaces:**
- Consumes: `mcpReadTool`, `decodeInto`, `mcpMapError` (0.6).
- Produces:
  - `type McpTask struct{ McpItem; Revision int64 \`json:"revision"\`; Priority string \`json:"priority,omitempty"\`; AssigneeID string \`json:"assignee_id,omitempty"\`; ProjectID string \`json:"project_id,omitempty"\`; ParentTaskID string \`json:"parent_task_id,omitempty"\`; StartDate string \`json:"start_date,omitempty"\`; Labels []McpLabel \`json:"labels,omitempty"\` }`
  - `type McpLabel struct{ ID string \`json:"id"\`; Name string \`json:"name"\` }`
  - `type McpMember struct{ UserID string \`json:"user_id"\`; Name string \`json:"name"\`; Role string \`json:"role"\` }`
  - `type McpTaskOptions struct{ Statuses []McpStatus \`json:"statuses"\`; Labels []McpLabel \`json:"labels"\`; Priorities []string \`json:"priorities"\` }`, `type McpStatus struct{ Key, Name, Category string }` (tag `key`, `name`, `category`)
  - `func (s *McpToolService) task(ctx context.Context, p McpPrincipal, workspaceID, ref string) (db.Task, error)` — ULID hoặc `PREFIX-N`; task ngoài workspace đọc như không có.
  - `func (s *McpToolService) taskOf(base string, t db.Task) McpTask`
  - `func (s *WorkspaceService) AssignableMembers(ctx context.Context, userID, workspaceID, organizationID string) ([]db.ListAssignableMembersRow, error)`
  - `func mcpTaskTools(s *McpToolService) []ai.Tool` (Phase 1 hoàn tất ở Task 1.4 với đủ 6 tool)

- [ ] **Step 1: Query**

`server/pkg/db/queries/workspaces.sql`, sau `ListWorkspaceMembers`:

```sql
-- name: ListAssignableMembers :many
-- Who can be given a task in the workspace: its members and the
-- organization's owners and admins (implicit workspace admins), active only.
-- Email is left out on purpose: the MCP connector hands this to an AI app.
SELECT u.id::text AS user_id, u.display_name::text AS display_name,
       COALESCE(wm.role, 'org_' || om.role)::text AS role
FROM organization_members om
JOIN users u ON u.id = om.user_id
LEFT JOIN workspace_members wm ON wm.workspace_id = sqlc.arg(workspace_id)::text AND wm.user_id = om.user_id
WHERE om.organization_id = sqlc.arg(organization_id)::text
  AND om.deactivated_at IS NULL
  AND (wm.user_id IS NOT NULL OR om.role IN ('owner', 'admin'))
ORDER BY lower(u.display_name), u.id;
```

Run: `make sqlc && cd server && go test ./migrations/ -run TestEveryQueryNamesItsTenant -count=1`
Expected: PASS (query ràng `organization_id` và `workspace_id` bằng tham số).

`workspace.go`, sau `Members`:

```go
// AssignableMembers is who a task in the workspace can be assigned to:
// Members plus the organization's owners and admins, who are implicit
// workspace admins. The caller must belong to the workspace.
func (s *WorkspaceService) AssignableMembers(ctx context.Context, userID, workspaceID, organizationID string) ([]db.ListAssignableMembersRow, error) {
	if _, err := s.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	return s.q.ListAssignableMembers(ctx, db.ListAssignableMembersParams{WorkspaceID: workspaceID, OrganizationID: organizationID})
}
```

- [ ] **Step 2: Viết test hỏng**

`server/internal/service/mcp_tools_tasks_test.go`:

```go
package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// Review Focus 5: an organization owner who is not in the workspace can be
// assigned and is listed; a deactivated member cannot and is not; no email
// ever leaves.
func TestMcpListMembers(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	list := func() map[string]McpMember {
		t.Helper()
		out, err := callMcpTool(t, x.tools, x.p, "list_members", `{"workspace_id":"`+x.w.ID+`"}`)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(out), "@") {
			t.Fatalf("list_members leaks an email: %s", out)
		}
		var members []McpMember
		if err := json.Unmarshal(out, &members); err != nil {
			t.Fatal(err)
		}
		byID := map[string]McpMember{}
		for _, m := range members {
			byID[m.UserID] = m
		}
		return byID
	}
	if _, ok := list()[x.ua.ID]; !ok {
		t.Fatal("the workspace owner is not listed")
	}
	// ub becomes an admin of the organization without joining the workspace:
	// RequireMember lets them in, so they can be assigned.
	addOrgMemberRole(t, x.tools.q, x.w.OrganizationID, x.ub.ID, OrgRoleAdmin)
	if m, ok := list()[x.ub.ID]; !ok || m.Role != "org_admin" {
		t.Fatalf("org admin outside the workspace = %+v, listed %v", m, ok)
	}
	// Deactivated, ub can no longer be given anything.
	if _, err := x.tools.ask.pool.Exec(ctx, `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, x.w.OrganizationID, x.ub.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := list()[x.ub.ID]; ok {
		t.Fatal("a deactivated member is listed")
	}
}
```

`addOrgMemberRole` có sẵn ở `audit_service_test.go` (cùng package); câu SQL vô hiệu hóa là cách các test tài liệu đang làm (`document_permissions_test.go:170`).

Thêm tiếp:

```go
func TestMcpTaskOptionsListStatusesLabelsAndPriorities(t *testing.T) {
	x := newMcpToolWorld(t)
	out, err := callMcpTool(t, x.tools, x.p, "task_options", `{"workspace_id":"`+x.w.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	var opts McpTaskOptions
	if err := json.Unmarshal(out, &opts); err != nil {
		t.Fatal(err)
	}
	keys := map[string]bool{}
	for _, st := range opts.Statuses {
		keys[st.Key] = st.Name != ""
	}
	if !keys["todo"] {
		t.Fatalf("statuses = %+v, want todo with a name", opts.Statuses)
	}
	for _, p := range opts.Priorities {
		if !validPriority[p] {
			t.Errorf("priority %q is not one the service accepts", p)
		}
	}
	if len(opts.Priorities) != len(validPriority) {
		t.Errorf("priorities = %v, service accepts %d", opts.Priorities, len(validPriority))
	}
}

func TestMcpListTasksAndGetTaskCarryTheRevision(t *testing.T) {
	x := newMcpToolWorld(t)
	out, err := callMcpTool(t, x.tools, x.p, "list_tasks", `{"workspace_id":"`+x.w.ID+`","status":"todo"}`)
	if err != nil {
		t.Fatal(err)
	}
	var list []McpTask
	if err := json.Unmarshal(out, &list); err != nil || len(list) != 1 || list[0].ID != x.taskID || list[0].Revision == 0 {
		t.Fatalf("list_tasks = %s (%v)", out, err)
	}
	out, err = callMcpTool(t, x.tools, x.p, "get_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	var one McpTask
	if err := json.Unmarshal(out, &one); err != nil || one.Revision != list[0].Revision || one.AssigneeID != x.ua.ID {
		t.Fatalf("get_task = %s (%v)", out, err)
	}
}

// get_task takes the PREFIX-N reference people write as well as the ULID.
func TestMcpGetTaskByReference(t *testing.T) {
	x := newMcpToolWorld(t)
	task, err := x.tools.ask.tasks.Get(context.Background(), x.ua.ID, x.taskID)
	if err != nil {
		t.Fatal(err)
	}
	ws, err := x.tools.q.GetWorkspaceByID(context.Background(), x.w.ID)
	if err != nil {
		t.Fatal(err)
	}
	ref := ws.TaskPrefix + "-" + strconv.FormatInt(task.Number, 10)
	out, err := callMcpTool(t, x.tools, x.p, "get_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+ref+`"}`)
	if err != nil || !strings.Contains(string(out), x.taskID) {
		t.Fatalf("get_task %s = %s (%v)", ref, out, err)
	}
	if _, err := callMcpTool(t, x.tools, x.p, "get_task", `{"workspace_id":"`+x.w.ID+`","task_id":"NOPE-999"}`); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown reference: %v, want ErrNotFound", err)
	}
}
```

Thêm `"strconv"` vào import. `db.Workspace.TaskPrefix` là `string`.

Run: `cd server && go test ./internal/service/ -run 'TestMcpListMembers|TestMcpTaskOptions|TestMcpListTasksAndGetTask|TestMcpGetTaskByReference' -count=1`
Expected: FAIL, `no tool "list_members"`.

- [ ] **Step 3: Viết code**

`server/internal/service/mcp_tools_tasks.go`:

```go
package service

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The task tools of the MCP connector (spec 2026-10-14 §5.1). Each reaches
// TaskService as the person who consented; nothing here decides membership.

type McpLabel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type McpStatus struct {
	Key      string `json:"key"`
	Name     string `json:"name"`
	Category string `json:"category"`
}

type McpMember struct {
	UserID string `json:"user_id"`
	Name   string `json:"name"`
	Role   string `json:"role"`
}

type McpTaskOptions struct {
	Statuses   []McpStatus `json:"statuses"`
	Labels     []McpLabel  `json:"labels"`
	Priorities []string    `json:"priorities"`
}

// McpTask is a task as a tool shows it: the item, plus what a model needs
// to change it (revision) and to name its fields.
type McpTask struct {
	McpItem
	Revision     int64      `json:"revision"`
	Priority     string     `json:"priority,omitempty"`
	AssigneeID   string     `json:"assignee_id,omitempty"`
	ProjectID    string     `json:"project_id,omitempty"`
	ParentTaskID string     `json:"parent_task_id,omitempty"`
	StartDate    string     `json:"start_date,omitempty"`
	Labels       []McpLabel `json:"labels,omitempty"`
}

// mcpPriorities is the order a person reads them in; TestMcpTaskOptions...
// holds it to the service's own set.
var mcpPriorities = []string{"none", "low", "medium", "high", "urgent"}

const mcpMaxList = 50

// task resolves a task id or PREFIX-N reference inside the workspace; a
// task of another workspace reads as absent.
func (s *McpToolService) task(ctx context.Context, p McpPrincipal, workspaceID, ref string) (db.Task, error) {
	if strings.TrimSpace(ref) == "" {
		return db.Task{}, McpInvalidArgs{Msg: "task_id is required"}
	}
	t, err := s.ask.tasks.GetByRef(ctx, Human(p.UserID), ref)
	if err != nil {
		return db.Task{}, hidden(err)
	}
	if t.WorkspaceID != workspaceID {
		return db.Task{}, ErrNotFound
	}
	return t, nil
}

func (s *McpToolService) taskOf(base string, t db.Task) McpTask {
	out := McpTask{
		McpItem:  McpItem{Kind: "task", ID: t.ID, WorkspaceID: t.WorkspaceID, Title: t.Title, Status: t.Status, URL: s.frontend + base + "/tasks/" + t.ID, Excerpt: capRunes(t.Description, mcpMaxHitRunes, mcpHitCut)},
		Revision: t.Revision, Priority: t.Priority, AssigneeID: t.AssigneeID.String, ProjectID: t.ProjectID.String, ParentTaskID: t.ParentTaskID.String,
	}
	if t.DueDate.Valid {
		out.DueDate = t.DueDate.Time.Format("2006-01-02")
	}
	if t.StartDate.Valid {
		out.StartDate = t.StartDate.Time.Format("2006-01-02")
	}
	return out
}

func (s *McpToolService) labelsOf(ctx context.Context, p McpPrincipal, taskID string) ([]McpLabel, error) {
	rows, err := s.ask.tasks.ListTaskLabelsOnTask(ctx, Human(p.UserID), taskID)
	if err != nil {
		return nil, err
	}
	out := make([]McpLabel, 0, len(rows))
	for _, l := range rows {
		out = append(out, McpLabel{ID: l.ID, Name: l.Name})
	}
	return out, nil
}

func (s *McpToolService) ListMembers(ctx context.Context, p McpPrincipal, workspaceID string) ([]McpMember, error) {
	if err := s.inGrant(ctx, p, workspaceID); err != nil {
		return nil, err
	}
	rows, err := s.ws.AssignableMembers(ctx, p.UserID, workspaceID, p.OrganizationID)
	if err != nil {
		return nil, err
	}
	out := make([]McpMember, 0, len(rows))
	for _, r := range rows {
		out = append(out, McpMember{UserID: r.UserID, Name: r.DisplayName, Role: r.Role})
	}
	return out, nil
}

func (s *McpToolService) TaskOptions(ctx context.Context, p McpPrincipal, workspaceID string) (McpTaskOptions, error) {
	if err := s.inGrant(ctx, p, workspaceID); err != nil {
		return McpTaskOptions{}, err
	}
	statuses, err := s.ask.tasks.ListTaskStatuses(ctx, Human(p.UserID), workspaceID, false)
	if err != nil {
		return McpTaskOptions{}, err
	}
	labels, err := s.ask.tasks.ListTaskLabels(ctx, Human(p.UserID), workspaceID, false)
	if err != nil {
		return McpTaskOptions{}, err
	}
	out := McpTaskOptions{Statuses: []McpStatus{}, Labels: []McpLabel{}, Priorities: mcpPriorities}
	for _, st := range statuses {
		out.Statuses = append(out.Statuses, McpStatus{Key: st.Key, Name: st.Name, Category: st.Category})
	}
	for _, l := range labels {
		out.Labels = append(out.Labels, McpLabel{ID: l.ID, Name: l.Name})
	}
	return out, nil
}

type mcpListTasksIn struct {
	WorkspaceID string `json:"workspace_id"`
	Status      string `json:"status"`
	ProjectID   string `json:"project_id"`
	Limit       int32  `json:"limit"`
}

func (s *McpToolService) ListTasks(ctx context.Context, p McpPrincipal, in mcpListTasksIn) ([]McpTask, error) {
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return nil, err
	}
	if in.Limit <= 0 || in.Limit > mcpMaxList {
		in.Limit = 20
	}
	page, err := s.ask.tasks.QueryTasks(ctx, Human(p.UserID), in.WorkspaceID, TaskQuery{Status: in.Status, ProjectID: in.ProjectID, Limit: in.Limit})
	if err != nil {
		return nil, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return nil, err
	}
	out := make([]McpTask, 0, len(page.Tasks))
	for _, t := range page.Tasks {
		out = append(out, s.taskOf(base, t))
	}
	return out, nil
}

var (
	mcpSchemaWorkspace = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaListTasks = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"status":{"type":"string","description":"A status key from task_options."},"project_id":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":50}},"required":["workspace_id"],"additionalProperties":false}`)
)

func mcpTaskTools(s *McpToolService) []ai.Tool {
	return []ai.Tool{
		mcpReadTool("list_members", "List members", "People a task in the workspace can be assigned to, with their user_id and role. No email.", mcpSchemaWorkspace,
			func(ctx context.Context, p McpPrincipal, in struct {
				WorkspaceID string `json:"workspace_id"`
			}) (any, error) {
				return s.ListMembers(ctx, p, in.WorkspaceID)
			}),
		mcpReadTool("task_options", "Task options", "The workspace's task statuses (use the key), labels (use the id) and priorities.", mcpSchemaWorkspace,
			func(ctx context.Context, p McpPrincipal, in struct {
				WorkspaceID string `json:"workspace_id"`
			}) (any, error) {
				return s.TaskOptions(ctx, p, in.WorkspaceID)
			}),
		mcpReadTool("list_tasks", "List tasks", "Tasks in one workspace, optionally by status key or project, most recently updated first, each with its revision.", mcpSchemaListTasks,
			func(ctx context.Context, p McpPrincipal, in mcpListTasksIn) (any, error) { return s.ListTasks(ctx, p, in) }),
	}
}
```

`mcpReadTool` bọc lỗi bằng `mcpMapError`, nên `ListMembers` và các hàm trên trả lỗi service thô; `hidden` chạy trong `mcpMapError`.

Trong `mcp_tools.go`:

`GetTask` thành:

```go
func (s *McpToolService) GetTask(ctx context.Context, p McpPrincipal, workspaceID, taskRef string) (McpTask, error) {
	if err := s.inGrant(ctx, p, workspaceID); err != nil {
		return McpTask{}, err
	}
	t, err := s.task(ctx, p, workspaceID, taskRef)
	if err != nil {
		return McpTask{}, err
	}
	item, err := s.one(ctx, p, workspaceID, t.ID, "task_id", s.ask.taskContext)
	if err != nil {
		return McpTask{}, err
	}
	base, err := s.ask.base(ctx, workspaceID)
	if err != nil {
		return McpTask{}, err
	}
	out := s.taskOf(base, t)
	// The item carries the full excerpt, with comments; the status and due
	// date come from the row, which the excerpt reader does not set.
	status, due := out.Status, out.DueDate
	out.McpItem = item
	out.Status, out.DueDate = status, due
	if out.Labels, err = s.labelsOf(ctx, p, t.ID); err != nil {
		return McpTask{}, hidden(err)
	}
	return out, nil
}
```

`GetTask` trả lỗi qua tool v1 (`decodeArgs`, không qua `mcpMapError`), nên tự gọi `hidden` ở chỗ đọc nhãn; `task` và `one` đã trả lỗi qua `hidden`. Tool `get_task` trong `McpTools` giữ nguyên handler, chỉ đổi kiểu trả.

Description của `get_task` thành `"One task with its comments, labels and revision. task_id is the id or the PREFIX-N reference."`.

`McpTools` thành:

```go
func McpTools(s *McpToolService) ai.Registry {
	r := ai.Registry{ /* the five v1 tools, unchanged */ }
	r = append(r, mcpTaskTools(s)...)
	return r
}
```

Giữ năm tool v1 y nguyên trong literal, chỉ đổi cách trả.

`mcp_tools_test.go`:
- `mcpToolCatalogue` thêm:

```go
	{"list_members", "List members", ai.ToolRead, false},
	{"task_options", "Task options", ai.ToolRead, false},
	{"list_tasks", "List tasks", ai.ToolRead, false},
```

- `mcpReadInputs` thêm `"list_members": wsArg, "task_options": wsArg, "list_tasks": wsArg` với `wsArg := \`{"workspace_id":"\` + ws + \`"}\``.
- `TestMcpToolOutputsCarryOnlyDocumentedFields` giữ khóa được phép dạng `map[string]bool` (`itemKeys`). Thêm ngay dưới `itemKeys` một helper, rồi đổi dòng `get_task`:

```go
	with := func(extra ...string) map[string]bool {
		out := map[string]bool{}
		for k := range itemKeys {
			out[k] = true
		}
		for _, k := range extra {
			out[k] = true
		}
		return out
	}
```

```go
	check("get_task", raw, err, with("revision", "priority", "assignee_id", "project_id", "parent_task_id", "start_date", "labels"))
```

- [ ] **Step 4: Chạy test, thấy qua**

Run: `cd server && go test ./internal/service/ -run 'TestMcp|TestMCP' -count=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pkg/db/queries/workspaces.sql server/pkg/db/generated server/internal/service/workspace.go server/internal/service/mcp_tools_tasks.go server/internal/service/mcp_tools_tasks_test.go server/internal/service/mcp_tools.go server/internal/service/mcp_tools_test.go
git commit -m "feat(mcp): read tools a model needs before it writes a task

list_members (assignable people, owners and admins included, the
deactivated left out, no email), task_options (status keys, labels,
priorities) and list_tasks. get_task now takes a PREFIX-N reference and
returns the revision, labels and ids a write needs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.3: `create_task` và `add_comment`

**Files:**
- Modify: `server/internal/service/mcp_tools_tasks.go`
- Test: `server/internal/service/mcp_tools_tasks_test.go`, `mcp_tools_test.go` (catalogue)

**Interfaces:**
- Consumes: `mcpWriteTool`, `McpWriteResult`, `task`, `taskOf` (1.2).
- Produces: `func mcpDate(field, v string) error`; `type McpComment struct{ ID string \`json:"id"\`; TaskID string \`json:"task_id"\`; Body string \`json:"body"\`; URL string \`json:"url"\` }`; tool `create_task`, `add_comment`.

- [ ] **Step 1: Viết test hỏng**

Thêm vào `mcp_tools_tasks_test.go`:

```go
func writeResult(t *testing.T, raw json.RawMessage) (McpWriteResult, map[string]any) {
	t.Helper()
	var res McpWriteResult
	if err := json.Unmarshal(raw, &res); err != nil {
		t.Fatal(err)
	}
	item, _ := res.Item.(map[string]any)
	return res, item
}

func TestMcpCreateTask(t *testing.T) {
	x := newMcpToolWorld(t)
	raw, err := callMcpTool(t, x.tools, x.p, "create_task", `{"workspace_id":"`+x.w.ID+`","title":"Gửi báo giá ACME","description":"**Gấp**","priority":"high","assignee_id":"`+x.ua.ID+`","due_date":"2026-10-23"}`)
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	if res.Revision == 0 || item["title"] != "Gửi báo giá ACME" || item["priority"] != "high" || item["due_date"] != "2026-10-23" || !strings.Contains(item["url"].(string), "/tasks/") {
		t.Fatalf("create_task = %s", raw)
	}
	var kind, via string
	if err := x.tools.ask.pool.QueryRow(context.Background(), `SELECT actor_kind, coalesce(metadata->'via'->>'kind','') FROM audit_events WHERE action = 'task.created' AND resource_id = $1`, item["id"]).Scan(&kind, &via); err != nil {
		t.Fatal(err)
	}
	if kind != "human" {
		t.Fatalf("actor_kind = %q, want human", kind)
	}
}

// Review Focus 4: a retried create is refused and names the task already made.
func TestMcpCreateTaskTwiceNamesTheFirst(t *testing.T) {
	x := newMcpToolWorld(t)
	in := `{"workspace_id":"` + x.w.ID + `","title":"Chốt hợp đồng"}`
	raw, err := callMcpTool(t, x.tools, x.p, "create_task", in)
	if err != nil {
		t.Fatal(err)
	}
	_, first := writeResult(t, raw)
	_, err = callMcpTool(t, x.tools, x.p, "create_task", in)
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "active_duplicate_task" || !strings.Contains(te.Msg, first["id"].(string)) {
		t.Fatalf("second create: %v, want active_duplicate_task naming %v", err, first["id"])
	}
}

func TestMcpCreateTaskValidates(t *testing.T) {
	x := newMcpToolWorld(t)
	for in, want := range map[string]string{
		`{"workspace_id":"` + x.w.ID + `","title":""}`:                         "title",
		`{"workspace_id":"` + x.w.ID + `","title":"A","due_date":"23/10/2026"}`: "due_date must be a date",
		`{"workspace_id":"` + x.w.ID + `","title":"A","priority":"asap"}`:       "priority",
	} {
		_, err := callMcpTool(t, x.tools, x.p, "create_task", in)
		var bad McpInvalidArgs
		if !errors.As(err, &bad) || !strings.Contains(bad.Msg, want) {
			t.Errorf("create_task %s: %v, want McpInvalidArgs about %s", in, err, want)
		}
	}
	// A person outside the workspace is a refusal the model can act on.
	_, err := callMcpTool(t, x.tools, x.p, "create_task", `{"workspace_id":"`+x.w.ID+`","title":"B","assignee_id":"`+x.ub.ID+`"}`)
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "assignee_not_member" {
		t.Fatalf("assignee outside: %v", err)
	}
}

func TestMcpAddComment(t *testing.T) {
	x := newMcpToolWorld(t)
	raw, err := callMcpTool(t, x.tools, x.p, "add_comment", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`","body":"Đã gửi bản nháp"}`)
	if err != nil {
		t.Fatal(err)
	}
	_, item := writeResult(t, raw)
	if item["task_id"] != x.taskID || item["body"] != "Đã gửi bản nháp" {
		t.Fatalf("add_comment = %s", raw)
	}
	out, _ := callMcpTool(t, x.tools, x.p, "get_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`"}`)
	if !strings.Contains(string(out), "Đã gửi bản nháp") {
		t.Fatalf("the comment is not on the task: %s", out)
	}
}
```

Kiểm kỳ vọng thông điệp `priority`: `Invalid("priority không hợp lệ")` — chứa "priority". Thông điệp tiêu đề trống là `tiêu đề không được để trống`; nếu `Create` dùng chữ khác, test bắt trường hợp đó bằng kiểm tra ở tool: tool từ chối `title` trống trước khi gọi service với `McpInvalidArgs{Msg: "title is required"}` (xem Step 3).

Run: `cd server && go test ./internal/service/ -run 'TestMcpCreateTask|TestMcpAddComment' -count=1`
Expected: FAIL, `no tool "create_task"`.

- [ ] **Step 2: Hiểu hai lỗi cần câu riêng**

`active_duplicate_task` cần nêu link của task đã có: bắt nó ngay trong tool trước `mcpMapError` (Step 3). `assignee_not_member` đã có câu trong `mcpToolMessages`.

- [ ] **Step 3: Viết code**

Thêm vào `mcp_tools_tasks.go` (import thêm `errors`, `fmt`, `time`):

```go
// mcpDate checks a YYYY-MM-DD field before the service sees it.
func mcpDate(field, v string) error {
	if _, err := time.Parse("2006-01-02", v); err != nil {
		return McpInvalidArgs{Msg: field + " must be a date YYYY-MM-DD"}
	}
	return nil
}

type McpComment struct {
	ID     string `json:"id"`
	TaskID string `json:"task_id"`
	Body   string `json:"body"`
	URL    string `json:"url"`
}

type mcpCreateTaskIn struct {
	WorkspaceID  string   `json:"workspace_id"`
	Title        string   `json:"title"`
	Description  string   `json:"description"`
	Status       string   `json:"status"`
	Priority     string   `json:"priority"`
	AssigneeID   string   `json:"assignee_id"`
	StartDate    string   `json:"start_date"`
	DueDate      string   `json:"due_date"`
	ProjectID    string   `json:"project_id"`
	ParentTaskID string   `json:"parent_task_id"`
	LabelIDs     []string `json:"label_ids"`
}

func optString(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

func (s *McpToolService) CreateTask(ctx context.Context, p McpPrincipal, in mcpCreateTaskIn) (McpWriteResult, error) {
	if strings.TrimSpace(in.Title) == "" {
		return McpWriteResult{}, McpInvalidArgs{Msg: "title is required"}
	}
	for field, v := range map[string]string{"start_date": in.StartDate, "due_date": in.DueDate} {
		if v != "" {
			if err := mcpDate(field, v); err != nil {
				return McpWriteResult{}, err
			}
		}
	}
	if in.Priority != "" && !validPriority[in.Priority] {
		return McpWriteResult{}, McpInvalidArgs{Msg: "priority must be one of " + strings.Join(mcpPriorities, ", ")}
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	var parent *string
	if in.ParentTaskID != "" {
		pt, err := s.task(ctx, p, in.WorkspaceID, in.ParentTaskID)
		if err != nil {
			return McpWriteResult{}, err
		}
		parent = &pt.ID
	}
	t, err := s.ask.tasks.Create(ctx, Human(p.UserID), in.WorkspaceID, CreateTaskInput{
		Title: in.Title, Description: in.Description, Status: in.Status, Priority: in.Priority,
		AssigneeID: optString(in.AssigneeID), StartDate: optString(in.StartDate), DueDate: optString(in.DueDate),
		ProjectID: optString(in.ProjectID), ParentTaskID: parent, LabelIDs: in.LabelIDs,
	})
	var ce CodedError
	if errors.As(err, &ce) && ce.Code == "active_duplicate_task" {
		id, _ := ce.Fields["task_id"].(string)
		ref, _ := ce.Fields["identifier"].(string)
		return McpWriteResult{}, McpToolError{Code: ce.Code, Msg: fmt.Sprintf("an active task with this title already exists: %s (id %s, %s); read it instead of creating another", ref, id, s.frontend+base+"/tasks/"+id)}
	}
	if err != nil {
		return McpWriteResult{}, err
	}
	return McpWriteResult{Item: s.taskOf(base, t), Revision: t.Revision}, nil
}

type mcpAddCommentIn struct {
	WorkspaceID string `json:"workspace_id"`
	TaskID      string `json:"task_id"`
	Body        string `json:"body"`
	ReplyTo     string `json:"reply_to"`
}

const mcpMaxBodyRunes = 20000

func (s *McpToolService) AddComment(ctx context.Context, p McpPrincipal, in mcpAddCommentIn) (McpWriteResult, error) {
	if n := utf8.RuneCountInString(strings.TrimSpace(in.Body)); n == 0 || n > mcpMaxBodyRunes {
		return McpWriteResult{}, McpInvalidArgs{Msg: "body must be 1-20000 characters"}
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	t, err := s.task(ctx, p, in.WorkspaceID, in.TaskID)
	if err != nil {
		return McpWriteResult{}, err
	}
	c, err := s.ask.tasks.AddCommentSuite(ctx, Human(p.UserID), t.ID, AddCommentInput{Body: in.Body, ParentID: optString(in.ReplyTo)}, "")
	if err != nil {
		return McpWriteResult{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	return McpWriteResult{Item: McpComment{ID: c.ID, TaskID: t.ID, Body: capRunes(c.Body, mcpMaxHitRunes, mcpHitCut), URL: s.frontend + base + "/tasks/" + t.ID}}, nil
}
```

Import `unicode/utf8`. Comment không có revision; `McpWriteResult.Revision` mang `omitempty` từ Task 0.6 nên kết quả không có trường đó.

Thêm schema và tool vào `mcpTaskTools`:

```go
var (
	mcpSchemaCreateTask = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"title":{"type":"string","minLength":1,"maxLength":500},"description":{"type":"string","description":"Markdown."},"status":{"type":"string","description":"A status key from task_options. Omit for the default open status."},"priority":{"type":"string","enum":["none","low","medium","high","urgent"]},"assignee_id":{"type":"string","description":"A user_id from list_members."},"start_date":{"type":"string","description":"YYYY-MM-DD"},"due_date":{"type":"string","description":"YYYY-MM-DD"},"project_id":{"type":"string"},"parent_task_id":{"type":"string","description":"Id or PREFIX-N of the parent task."},"label_ids":{"type":"array","items":{"type":"string"},"maxItems":20}},"required":["workspace_id","title"],"additionalProperties":false}`)
	mcpSchemaAddComment = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"task_id":{"type":"string","description":"Id or PREFIX-N."},"body":{"type":"string","minLength":1,"maxLength":20000,"description":"Markdown."},"reply_to":{"type":"string","description":"Id of the comment this answers."}},"required":["workspace_id","task_id","body"],"additionalProperties":false}`)
)
```

trong slice trả về của `mcpTaskTools`, sau `list_tasks`:

```go
		mcpWriteTool("create_task", "Create task", "Creates a task in the workspace as the user. Everyone in the workspace sees it; the assignee is notified.", "change its status, or delete it in UniWork", false, mcpSchemaCreateTask,
			func(ctx context.Context, p McpPrincipal, in mcpCreateTaskIn) (any, error) { return s.CreateTask(ctx, p, in) }),
```

và `add_comment` đặt sau `update_task` (Task 1.4); ở task này thêm tạm cuối slice:

```go
		mcpWriteTool("add_comment", "Add comment", "Adds a comment to a task as the user. Everyone who can see the task sees it; subscribers are notified.", "the user deletes the comment in UniWork", false, mcpSchemaAddComment,
			func(ctx context.Context, p McpPrincipal, in mcpAddCommentIn) (any, error) { return s.AddComment(ctx, p, in) }),
```

Catalogue thêm `{"create_task", "Create task", ai.ToolWrite, false}` và `{"add_comment", "Add comment", ai.ToolWrite, false}` đúng thứ tự trong slice.

- [ ] **Step 4: Chạy test, thấy qua**

Run: `cd server && go test ./internal/service/ -run 'TestMcp|TestMCP' -count=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/mcp_tools_tasks.go server/internal/service/mcp_tools_tasks_test.go server/internal/service/mcp_write.go server/internal/service/mcp_tools_test.go
git commit -m "feat(mcp): create_task and add_comment

Both run TaskService as the person who consented. A retried create is
refused with the reference, id and link of the task already made, so a
model reads it instead of creating a second one. Dates and priorities are
checked before the service sees them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.4: `update_task`

**Files:**
- Modify: `server/internal/service/mcp_tools_tasks.go`
- Test: `server/internal/service/mcp_tools_tasks_test.go`, `mcp_tools_test.go`

**Interfaces:**
- Consumes: `UpdateTaskInput.ExpectedRevision` (1.1), `mcpOpt[T]`, `mcpChanges` (0.6), `task`, `taskOf`, `labelsOf`, `mcpDate` (1.2–1.3).
- Produces: tool `update_task` (destructive) trả `McpWriteResult{Item: McpTask, Revision, Changes, Note}`.

- [ ] **Step 1: Viết test hỏng**

```go
func (x *mcpToolWorld) revision(t *testing.T, taskID string) int64 {
	t.Helper()
	task, err := x.tools.ask.tasks.Get(context.Background(), x.ua.ID, taskID)
	if err != nil {
		t.Fatal(err)
	}
	return task.Revision
}

func TestMcpUpdateTask(t *testing.T) {
	x := newMcpToolWorld(t)
	rev := strconv.FormatInt(x.revision(t, x.taskID), 10)
	raw, err := callMcpTool(t, x.tools, x.p, "update_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`","revision":`+rev+`,"title":"Báo cáo quý III","status":"in_progress"}`)
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	if item["title"] != "Báo cáo quý III" || res.Revision <= x.revision(t, x.taskID)-1 {
		t.Fatalf("update_task = %s", raw)
	}
	fields := map[string]McpChange{}
	for _, c := range res.Changes {
		fields[c.Field] = c
	}
	if fields["title"].From != "Chuẩn bị báo cáo quý" || fields["status"].To != "in_progress" {
		t.Fatalf("changes = %+v", res.Changes)
	}
	if _, ok := fields["priority"]; ok {
		t.Fatal("an untouched field is reported as changed")
	}
}

// The revision is required, and a stale one writes nothing.
func TestMcpUpdateTaskNeedsAFreshRevision(t *testing.T) {
	x := newMcpToolWorld(t)
	_, err := callMcpTool(t, x.tools, x.p, "update_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`","title":"X"}`)
	var bad McpInvalidArgs
	if !errors.As(err, &bad) || !strings.Contains(bad.Msg, "revision") {
		t.Fatalf("no revision: %v", err)
	}
	stale := strconv.FormatInt(x.revision(t, x.taskID)-1, 10)
	_, err = callMcpTool(t, x.tools, x.p, "update_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`","revision":`+stale+`,"title":"X"}`)
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "revision_conflict" {
		t.Fatalf("stale revision: %v", err)
	}
	if task, _ := x.tools.ask.tasks.Get(context.Background(), x.ua.ID, x.taskID); task.Title == "X" {
		t.Fatal("a stale update wrote")
	}
}

// Review Focus 2: an absent due_date keeps the date, null clears it.
func TestMcpUpdateTaskTellsAbsentFromNull(t *testing.T) {
	x := newMcpToolWorld(t)
	call := func(extra string) {
		t.Helper()
		rev := strconv.FormatInt(x.revision(t, x.taskID), 10)
		if _, err := callMcpTool(t, x.tools, x.p, "update_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`","revision":`+rev+extra+`}`); err != nil {
			t.Fatal(err)
		}
	}
	call(`,"title":"Đổi tên thôi"`)
	if task, _ := x.tools.ask.tasks.Get(context.Background(), x.ua.ID, x.taskID); !task.DueDate.Valid {
		t.Fatal("an update without due_date cleared it")
	}
	call(`,"due_date":null`)
	if task, _ := x.tools.ask.tasks.Get(context.Background(), x.ua.ID, x.taskID); task.DueDate.Valid {
		t.Fatal("due_date null did not clear it")
	}
	_, err := callMcpTool(t, x.tools, x.p, "update_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`","revision":`+strconv.FormatInt(x.revision(t, x.taskID), 10)+`,"title":null}`)
	var bad McpInvalidArgs
	if !errors.As(err, &bad) {
		t.Fatalf("title null: %v, want McpInvalidArgs", err)
	}
}

// Labels and parent change in the same call; a bad parent is refused before
// anything is written.
func TestMcpUpdateTaskLabelsAndParent(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	label, err := x.tools.ask.tasks.CreateTaskLabel(ctx, Human(x.ua.ID), x.w.ID, CreateTaskLabelInput{Name: "Khách hàng"})
	if err != nil {
		t.Fatal(err)
	}
	parent := x.task(t, x.ua.ID, x.w.ID, "Dự án ACME")
	rev := strconv.FormatInt(x.revision(t, x.taskID), 10)
	raw, err := callMcpTool(t, x.tools, x.p, "update_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`","revision":`+rev+`,"add_label_ids":["`+label.ID+`"],"parent_task_id":"`+parent.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "Khách hàng") || !strings.Contains(string(raw), parent.ID) {
		t.Fatalf("update_task = %s", raw)
	}
	before := x.revision(t, x.taskID)
	_, err = callMcpTool(t, x.tools, x.p, "update_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`","revision":`+strconv.FormatInt(before, 10)+`,"title":"Y","parent_task_id":"NOPE-1"}`)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown parent: %v", err)
	}
	if x.revision(t, x.taskID) != before {
		t.Fatal("a refused parent still wrote the title")
	}
}
```

`CreateTaskLabel(ctx, actor, workspaceID, CreateTaskLabelInput{Name, Description, Color})` trả `db.TaskLabel` (`task_catalog_labels.go:94`).

Run: `cd server && go test ./internal/service/ -run TestMcpUpdateTask -count=1`
Expected: FAIL, `no tool "update_task"`.

- [ ] **Step 2: Viết code**

```go
type mcpUpdateTaskIn struct {
	WorkspaceID    string         `json:"workspace_id"`
	TaskID         string         `json:"task_id"`
	Revision       *int64         `json:"revision"`
	Title          mcpOpt[string] `json:"title"`
	Description    mcpOpt[string] `json:"description"`
	Status         mcpOpt[string] `json:"status"`
	Priority       mcpOpt[string] `json:"priority"`
	AssigneeID     mcpOpt[string] `json:"assignee_id"`
	StartDate      mcpOpt[string] `json:"start_date"`
	DueDate        mcpOpt[string] `json:"due_date"`
	ProjectID      mcpOpt[string] `json:"project_id"`
	ParentTaskID   mcpOpt[string] `json:"parent_task_id"`
	AddLabelIDs    []string       `json:"add_label_ids"`
	RemoveLabelIDs []string       `json:"remove_label_ids"`
}

func (in mcpUpdateTaskIn) check() error {
	if in.Revision == nil {
		return McpInvalidArgs{Msg: "revision is required; read the task first and send its revision"}
	}
	for field, o := range map[string]mcpOpt[string]{"title": in.Title, "description": in.Description, "status": in.Status, "priority": in.Priority} {
		if o.Null {
			return McpInvalidArgs{Msg: field + " cannot be null; send a value (an empty description clears it)"}
		}
	}
	if in.Priority.Set && !validPriority[in.Priority.Value] {
		return McpInvalidArgs{Msg: "priority must be one of " + strings.Join(mcpPriorities, ", ")}
	}
	for field, o := range map[string]mcpOpt[string]{"start_date": in.StartDate, "due_date": in.DueDate} {
		if o.Set && !o.Null {
			if err := mcpDate(field, o.Value); err != nil {
				return err
			}
		}
	}
	return nil
}

func labelNames(ls []McpLabel) []string {
	out := make([]string, 0, len(ls))
	for _, l := range ls {
		out = append(out, l.Name)
	}
	return out
}

// UpdateTask changes one task. Every reference is resolved before anything
// is written; the field update carries the revision and runs first, then
// parent and labels, each its own command. A later step that fails is named
// in Note with what was already saved.
func (s *McpToolService) UpdateTask(ctx context.Context, p McpPrincipal, in mcpUpdateTaskIn) (McpWriteResult, error) {
	if err := in.check(); err != nil {
		return McpWriteResult{}, err
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	before, err := s.task(ctx, p, in.WorkspaceID, in.TaskID)
	if err != nil {
		return McpWriteResult{}, err
	}
	var parent **string
	if in.ParentTaskID.Set {
		parent = in.ParentTaskID.ptr2()
		if !in.ParentTaskID.Null {
			pt, err := s.task(ctx, p, in.WorkspaceID, in.ParentTaskID.Value)
			if err != nil {
				return McpWriteResult{}, err
			}
			id := &pt.ID
			parent = &id
		}
	}
	labelsBefore, err := s.labelsOf(ctx, p, before.ID)
	if err != nil {
		return McpWriteResult{}, err
	}
	actor := Human(p.UserID)
	if _, err := s.ask.tasks.Update(ctx, actor, before.ID, UpdateTaskInput{
		ExpectedRevision: in.Revision,
		Title: in.Title.ptr(), Description: in.Description.ptr(), Status: in.Status.ptr(), Priority: in.Priority.ptr(),
		AssigneeID: in.AssigneeID.ptr2(), StartDate: in.StartDate.ptr2(), DueDate: in.DueDate.ptr2(), ProjectID: in.ProjectID.ptr2(),
	}); err != nil {
		return McpWriteResult{}, err
	}
	var failed []string
	if parent != nil {
		if _, err := s.ask.tasks.SetParent(ctx, actor, before.ID, *parent); err != nil {
			failed = append(failed, "parent_task_id ("+mcpMapError(err).Error()+")")
		}
	}
	for _, id := range in.AddLabelIDs {
		if err := s.ask.tasks.AttachTaskLabel(ctx, actor, before.ID, id); err != nil {
			failed = append(failed, "add label "+id+" ("+mcpMapError(err).Error()+")")
		}
	}
	for _, id := range in.RemoveLabelIDs {
		if err := s.ask.tasks.DetachTaskLabel(ctx, actor, before.ID, id); err != nil {
			failed = append(failed, "remove label "+id+" ("+mcpMapError(err).Error()+")")
		}
	}
	after, err := s.ask.tasks.Get(ctx, p.UserID, before.ID)
	if err != nil {
		return McpWriteResult{}, err
	}
	labelsAfter, err := s.labelsOf(ctx, p, before.ID)
	if err != nil {
		return McpWriteResult{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	b, a := s.taskOf(base, before), s.taskOf(base, after)
	a.Labels = labelsAfter
	res := McpWriteResult{Item: a, Revision: after.Revision, Changes: mcpChanges(
		McpChange{"title", before.Title, after.Title},
		McpChange{"description", before.Description, after.Description},
		McpChange{"status", b.Status, a.Status},
		McpChange{"priority", b.Priority, a.Priority},
		McpChange{"assignee_id", b.AssigneeID, a.AssigneeID},
		McpChange{"start_date", b.StartDate, a.StartDate},
		McpChange{"due_date", b.DueDate, a.DueDate},
		McpChange{"project_id", b.ProjectID, a.ProjectID},
		McpChange{"parent_task_id", b.ParentTaskID, a.ParentTaskID},
		McpChange{"labels", labelNames(labelsBefore), labelNames(labelsAfter)},
	)}
	if len(failed) > 0 {
		res.Note = "the fields in changes were saved; these did not: " + strings.Join(failed, "; ")
	}
	return res, nil
}
```

Thêm schema và tool (đặt giữa `create_task` và `add_comment` trong slice):

```go
	mcpSchemaUpdateTask = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"task_id":{"type":"string","description":"Id or PREFIX-N."},"revision":{"type":"integer","description":"The revision you read with get_task or list_tasks."},"title":{"type":"string","minLength":1,"maxLength":500},"description":{"type":"string","description":"Markdown; replaces the whole description."},"status":{"type":"string"},"priority":{"type":"string","enum":["none","low","medium","high","urgent"]},"assignee_id":{"type":["string","null"],"description":"null unassigns."},"start_date":{"type":["string","null"]},"due_date":{"type":["string","null"],"description":"YYYY-MM-DD; null clears it."},"project_id":{"type":["string","null"]},"parent_task_id":{"type":["string","null"]},"add_label_ids":{"type":"array","items":{"type":"string"},"maxItems":20},"remove_label_ids":{"type":"array","items":{"type":"string"},"maxItems":20}},"required":["workspace_id","task_id","revision"],"additionalProperties":false}`)
```

```go
		mcpWriteTool("update_task", "Update task", "Changes fields of one task as the user; omitted fields stay, null clears. Fails with revision_conflict if the task changed since you read it. Everyone in the workspace sees the change.", "call update_task again with the from values in changes", true, mcpSchemaUpdateTask,
			func(ctx context.Context, p McpPrincipal, in mcpUpdateTaskIn) (any, error) { return s.UpdateTask(ctx, p, in) }),
```

Catalogue: `{"update_task", "Update task", ai.ToolWrite, true}` giữa `create_task` và `add_comment`.

- [ ] **Step 3: Chạy test, thấy qua**

Run: `cd server && go test ./internal/service/ -run 'TestMcp|TestMCP|TestUpdateRefuses' -count=1 && go test ./internal/ -run TestMcpToolsCallNoDelete -count=1`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/mcp_tools_tasks.go server/internal/service/mcp_tools_tasks_test.go server/internal/service/mcp_tools_test.go
git commit -m "feat(mcp): update_task

Changes fields of one task with the revision the model read: omitted
fields stay, null clears, a stale revision writes nothing. Every
reference is resolved before the first write; parent and labels follow
the field update, and a step that fails is named with what was already
saved. The result lists each change with its old value for undo.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.5: `TestIsolationMCP` cho tool ghi của Task

**Files:**
- Modify: `server/internal/handler/isolation_mcp_test.go`
- Test: chính nó

**Interfaces:**
- Consumes: grant của tenant có scope `read write` và tổ chức bật ghi (seed ở Task 0.2–0.3); tool `create_task`, `update_task`, `add_comment` (1.3–1.4).
- Produces: `func mcpCallToolJSON(t *testing.T, w *isoWorld, bearer, tool string, args map[string]any) (int, []byte)`; danh sách `writeAttacks` mà Phase 2–4 thêm dòng.

- [ ] **Step 1: Viết test**

Trong `isolation_mcp_test.go`:

1. Thêm helper:

```go
// mcpCallToolJSON is mcpCallTool for arguments that are not all strings
// (revisions, lists, null).
func mcpCallToolJSON(t *testing.T, w *isoWorld, bearer, tool string, args map[string]any) (int, []byte) {
	t.Helper()
	argJSON, _ := json.Marshal(args)
	body := fmt.Sprintf(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":%q,"arguments":%s}}`, tool, argJSON)
	res, out := mcpRPC(t, w.srv, "Bearer "+bearer, "", body)
	raw, _ := json.Marshal(out)
	return res.StatusCode, raw
}
```

2. Trong `TestIsolationMCP`, sau `attacks`, thêm:

```go
	// writeAttacks aim B's write grant at A's rows. Each must be refused with
	// the one not-found text and leave A's tenant digest unchanged.
	writeAttacks := []struct {
		tool string
		args map[string]any
	}{
		{"create_task", map[string]any{"workspace_id": a.wsID, "title": "iso-write"}},
		{"create_task", map[string]any{"workspace_id": b.wsID, "title": "iso-write-parent", "parent_task_id": aTask}},
		{"update_task", map[string]any{"workspace_id": a.wsID, "task_id": aTask, "revision": 1, "title": "iso"}},
		{"update_task", map[string]any{"workspace_id": b.wsID, "task_id": aTask, "revision": 1, "title": "iso"}},
		{"add_comment", map[string]any{"workspace_id": a.wsID, "task_id": aTask, "body": "iso"}},
		{"add_comment", map[string]any{"workspace_id": b.wsID, "task_id": aTask, "body": "iso"}},
	}
```

3. Trong `refused`, sau vòng `attacks`, thêm:

```go
		before := w.tenantDigest(t, a)
		for _, at := range writeAttacks {
			status, raw := mcpCallToolJSON(t, w, b.ids["mcpAccess"], at.tool, at.args)
			if status != http.StatusOK || !isToolError(raw) || toolText(raw) != mcpNotFoundText {
				t.Errorf("%s %s %v: status %d, not refused with %q: %s", label, at.tool, at.args, status, mcpNotFoundText, raw)
			}
			if leak := a.leakIn(raw, ""); leak != "" {
				t.Errorf("%s %s leaked %s: %s", label, at.tool, leak, raw)
			}
		}
		if changed := isoDiff(before, w.tenantDigest(t, a)); len(changed) > 0 {
			t.Errorf("%s: a write attack changed A's rows in %v", label, changed)
		}
```

`tenantDigest` trả `map[string]string` (bảng → băm) và `isoDiff` liệt kê bảng đổi (`isolation_matrix_test.go:927`, `:980`); `TestIsolationMatrix` dùng đúng cặp này.

4. Trong subtest `control`, thêm phần ghi của A:

```go
		// A's own grant writes through every attacked tool.
		status, raw = mcpCallToolJSON(t, w, a.ids["mcpAccess"], "create_task", map[string]any{"workspace_id": a.wsID, "title": "iso-control-" + a.tag})
		if status != http.StatusOK || isToolError(raw) {
			t.Fatalf("A's own create_task: %d %s", status, raw)
		}
		var created struct {
			Result struct {
				StructuredContent struct {
					Item     struct{ ID string `json:"id"` } `json:"item"`
					Revision int64                          `json:"revision"`
				} `json:"structuredContent"`
			} `json:"result"`
		}
		if err := json.Unmarshal(raw, &created); err != nil || created.Result.StructuredContent.Item.ID == "" {
			t.Fatalf("A's create_task answer: %s (%v)", raw, err)
		}
		id, rev := created.Result.StructuredContent.Item.ID, created.Result.StructuredContent.Revision
		if status, raw = mcpCallToolJSON(t, w, a.ids["mcpAccess"], "update_task", map[string]any{"workspace_id": a.wsID, "task_id": id, "revision": rev, "title": "iso-control-2"}); status != http.StatusOK || isToolError(raw) {
			t.Errorf("A's own update_task: %d %s", status, raw)
		}
		if status, raw = mcpCallToolJSON(t, w, a.ids["mcpAccess"], "add_comment", map[string]any{"workspace_id": a.wsID, "task_id": aTask, "body": "iso-control"}); status != http.StatusOK || isToolError(raw) {
			t.Errorf("A's own add_comment: %d %s", status, raw)
		}
```

Khai báo `status, raw` trong `control` đã có; nếu chưa, dùng `:=` cho lần đầu. Việc control ghi vào A thay đổi digest của A, nên subtest `control` phải chạy trước khi `refused` lấy `before`; `refused` lấy `before` ngay trong chính lần gọi nên không bị ảnh hưởng.

5. Ca `assignee_id` của A khi tạo task trong B trả `assignee_not_member`, không phải câu not-found; câu này giống hệt cho id không tồn tại nên không phải oracle. Thêm ca riêng trong `refused`:

```go
		status, raw := mcpCallToolJSON(t, w, b.ids["mcpAccess"], "create_task", map[string]any{"workspace_id": b.wsID, "title": "iso-assign", "assignee_id": a.userID})
		if status != http.StatusOK || !isToolError(raw) || !strings.HasPrefix(toolText(raw), "assignee_not_member:") {
			t.Errorf("%s assign A's owner in B: %d %s", label, status, raw)
		}
		if leak := a.leakIn(raw, a.userID); leak != "" {
			t.Errorf("%s assign leaked %s: %s", label, leak, raw)
		}
```

Tham số thứ hai của `leakIn` là id được phép xuất hiện (id chính lời gọi nêu); kiểm chữ ký thật của `leakIn` và dùng đúng.

- [ ] **Step 2: Chạy test**

Run: `cd server && go test ./internal/handler/ -run 'TestIsolationMCP|TestIsolationMatrix' -count=1`
Expected: PASS. Ca nào trả lỗi khác câu not-found mà không phải `assignee_not_member` là lỗ rò cần sửa ở tool (thường là thiếu `hidden`/`s.task`), không phải nới test.

- [ ] **Step 3: Commit**

```bash
git add server/internal/handler/isolation_mcp_test.go
git commit -m "test(mcp): TestIsolationMCP covers the task write tools

B's write grant aimed at A's workspace, task and parent is refused with
the one not-found answer and A's tenant digest does not move; assigning
A's owner in B reads the same as assigning nobody. A's own grant runs
every attacked write tool as the control.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.6: Kiểm chứng Phase 1

- [ ] **Step 1:** Run `make check`. Expected: PASS.
- [ ] **Step 2: Thử tay** trên Claude Code, ChatGPT (developer mode) và Gemini CLI, mỗi client:
  1. `tools/list` có 8 tool đọc và 3 tool ghi; tool ghi hiện nhãn hỏi xác nhận.
  2. "Tạo task 'Thử MCP' giao cho tôi, hạn thứ Sáu" → task có trên web, lịch sử ghi "(qua <client>)".
  3. Sửa tiêu đề task đó trên web, rồi bảo client đổi trạng thái mà không đọc lại → `revision_conflict`, client đọc lại rồi làm được.
  4. Tắt "Cho phép tạo và sửa" → client không còn thấy tool ghi.
- [ ] **Step 3:** `make issue-note KEY=<UNI-key Phase 1> MSG="[agent] Phase 1 xong: 6 tool Task, ExpectedRevision, isolation ghi. make check: <kết quả>. Thử tay: <client nào, kết quả>. Chưa push."` Dừng, hỏi người dùng trước khi `make issue-pr`.

---

# Phase 2 — Dự án

Sub-issue: `MCP v2 Phase 2: tool Dự án`. Bắt đầu khi PR Phase 1 đã merge.

### Task 2.1: `list_projects`, `get_project`

**Files:**
- Create: `server/internal/service/mcp_tools_projects.go`, `server/internal/service/mcp_tools_projects_test.go`
- Modify: `server/internal/service/mcp_tools.go` (`McpTools` ghép `mcpProjectTools`), `mcp_tools_test.go` (catalogue, `mcpReadInputs`)

**Interfaces:**
- Consumes: `mcpReadTool` (0.6), `taskOf`, `mcpMaxList` (1.2).
- Produces:
  - `type McpProject struct{ McpItem; Revision int64 \`json:"revision"\`; Priority string \`json:"priority,omitempty"\`; LeadID string \`json:"lead_id,omitempty"\`; StartDate string \`json:"start_date,omitempty"\`; TaskCount int64 \`json:"task_count"\`; DoneCount int64 \`json:"done_count"\`; Tasks []McpTask \`json:"tasks,omitempty"\` }`
  - `func (s *McpToolService) projectOf(base string, p db.Project, v ProjectView) McpProject`
  - `func (s *McpToolService) project(ctx context.Context, p McpPrincipal, workspaceID, projectID string) (db.Project, error)`
  - `func mcpProjectTools(s *McpToolService) []ai.Tool`

- [ ] **Step 1: Viết test hỏng**

`server/internal/service/mcp_tools_projects_test.go`:

```go
package service

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"
)

func (x *mcpToolWorld) project(t *testing.T, title string) string {
	t.Helper()
	p, err := x.tools.ask.tasks.CreateProject(context.Background(), Human(x.ua.ID), x.w.ID, CreateProjectInput{Title: title})
	if err != nil {
		t.Fatal(err)
	}
	return p.ID
}

func TestMcpListAndGetProject(t *testing.T) {
	x := newMcpToolWorld(t)
	id := x.project(t, "Bán hàng Q4")
	rev := x.revision(t, x.taskID)
	if _, err := callMcpTool(t, x.tools, x.p, "update_task", `{"workspace_id":"`+x.w.ID+`","task_id":"`+x.taskID+`","revision":`+strconv.FormatInt(rev, 10)+`,"project_id":"`+id+`"}`); err != nil {
		t.Fatal(err)
	}
	raw, err := callMcpTool(t, x.tools, x.p, "list_projects", `{"workspace_id":"`+x.w.ID+`","query":"bán hàng"}`)
	if err != nil {
		t.Fatal(err)
	}
	var list []McpProject
	if err := json.Unmarshal(raw, &list); err != nil || len(list) != 1 || list[0].ID != id || list[0].TaskCount != 1 || list[0].Revision == 0 {
		t.Fatalf("list_projects = %s (%v)", raw, err)
	}
	raw, err = callMcpTool(t, x.tools, x.p, "get_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+id+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	var one McpProject
	if err := json.Unmarshal(raw, &one); err != nil || len(one.Tasks) != 1 || one.Tasks[0].ID != x.taskID || !strings.Contains(one.URL, "/projects/"+id) {
		t.Fatalf("get_project = %s (%v)", raw, err)
	}
}

func TestMcpGetProjectOfAnotherWorkspaceIsAbsent(t *testing.T) {
	x := newMcpToolWorld(t)
	_, other := x.org(t, x.ua.ID, "Khác", "khac")
	p, err := x.tools.ask.tasks.CreateProject(context.Background(), Human(x.ua.ID), other.ID, CreateProjectInput{Title: "Ngoài"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := callMcpTool(t, x.tools, x.p, "get_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+p.ID+`"}`); !errors.Is(err, ErrNotFound) {
		t.Fatalf("project of another workspace: %v, want ErrNotFound", err)
	}
}
```

Run: `cd server && go test ./internal/service/ -run 'TestMcpListAndGetProject|TestMcpGetProjectOfAnotherWorkspaceIsAbsent' -count=1`
Expected: FAIL, `no tool "list_projects"`.

- [ ] **Step 2: Viết code**

`server/internal/service/mcp_tools_projects.go`:

```go
package service

import (
	"context"
	"encoding/json"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The project tools of the MCP connector (spec 2026-10-14 §5.2). Projects
// live on TaskService; each call runs as the person who consented.

type McpProject struct {
	McpItem
	Revision  int64     `json:"revision"`
	Priority  string    `json:"priority,omitempty"`
	LeadID    string    `json:"lead_id,omitempty"`
	StartDate string    `json:"start_date,omitempty"`
	TaskCount int64     `json:"task_count"`
	DoneCount int64     `json:"done_count"`
	Tasks     []McpTask `json:"tasks,omitempty"`
}

func (s *McpToolService) projectOf(base string, pr db.Project, v ProjectView) McpProject {
	out := McpProject{
		McpItem:  McpItem{Kind: "project", ID: pr.ID, WorkspaceID: pr.WorkspaceID, Title: pr.Title, Status: pr.Status, URL: s.frontend + base + "/projects/" + pr.ID, Excerpt: capRunes(pr.Description, mcpMaxHitRunes, mcpHitCut)},
		Revision: pr.Revision, Priority: pr.Priority, LeadID: pr.LeadID.String, TaskCount: v.TaskCount, DoneCount: v.DoneCount,
	}
	if pr.DueDate.Valid {
		out.DueDate = pr.DueDate.Time.Format("2006-01-02")
	}
	if pr.StartDate.Valid {
		out.StartDate = pr.StartDate.Time.Format("2006-01-02")
	}
	return out
}

// project reads one project of the workspace; GetProject already refuses a
// project of another workspace.
func (s *McpToolService) project(ctx context.Context, p McpPrincipal, workspaceID, projectID string) (db.Project, error) {
	if projectID == "" {
		return db.Project{}, McpInvalidArgs{Msg: "project_id is required"}
	}
	return s.ask.tasks.GetProject(ctx, Human(p.UserID), workspaceID, projectID)
}

type mcpListProjectsIn struct {
	WorkspaceID   string `json:"workspace_id"`
	Query         string `json:"query"`
	Status        string `json:"status"`
	IncludeClosed bool   `json:"include_closed"`
}

func (s *McpToolService) ListProjects(ctx context.Context, p McpPrincipal, in mcpListProjectsIn) ([]McpProject, error) {
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return nil, err
	}
	actor := Human(p.UserID)
	var rows []db.Project
	var err error
	if in.Query != "" {
		rows, _, err = s.ask.tasks.SearchProjects(ctx, actor, in.WorkspaceID, SearchProjectsInput{Q: in.Query, IncludeClosed: in.IncludeClosed, Limit: mcpMaxList})
	} else {
		rows, err = s.ask.tasks.ListProjects(ctx, actor, in.WorkspaceID, ListProjectsFilter{Status: optString(in.Status)})
	}
	if err != nil {
		return nil, err
	}
	if len(rows) > mcpMaxList {
		rows = rows[:mcpMaxList]
	}
	stats, err := s.ask.tasks.ProjectStats(ctx, actor, in.WorkspaceID, rows)
	if err != nil {
		return nil, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return nil, err
	}
	out := make([]McpProject, 0, len(rows))
	for _, pr := range rows {
		out = append(out, s.projectOf(base, pr, stats[pr.ID]))
	}
	return out, nil
}

type mcpProjectRef struct {
	WorkspaceID string `json:"workspace_id"`
	ProjectID   string `json:"project_id"`
}

func (s *McpToolService) GetProject(ctx context.Context, p McpPrincipal, in mcpProjectRef) (McpProject, error) {
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpProject{}, err
	}
	pr, err := s.project(ctx, p, in.WorkspaceID, in.ProjectID)
	if err != nil {
		return McpProject{}, err
	}
	actor := Human(p.UserID)
	stats, err := s.ask.tasks.ProjectStats(ctx, actor, in.WorkspaceID, []db.Project{pr})
	if err != nil {
		return McpProject{}, err
	}
	page, err := s.ask.tasks.QueryTasks(ctx, actor, in.WorkspaceID, TaskQuery{ProjectID: pr.ID, Limit: 20})
	if err != nil {
		return McpProject{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpProject{}, err
	}
	out := s.projectOf(base, pr, stats[pr.ID])
	out.Excerpt = capRunes(pr.Description, mcpMaxItemRunes, mcpItemCut)
	for _, t := range page.Tasks {
		out.Tasks = append(out.Tasks, s.taskOf(base, t))
	}
	return out, nil
}

var (
	mcpSchemaListProjects = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"query":{"type":"string","maxLength":200},"status":{"type":"string","enum":["planned","in_progress","paused","completed","cancelled"]},"include_closed":{"type":"boolean","description":"With query: also completed and cancelled projects."}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaProject      = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"project_id":{"type":"string"}},"required":["workspace_id","project_id"],"additionalProperties":false}`)
)

func mcpProjectTools(s *McpToolService) []ai.Tool {
	return []ai.Tool{
		mcpReadTool("list_projects", "List projects", "Projects in one workspace, by keyword or status, with task counts and revision.", mcpSchemaListProjects,
			func(ctx context.Context, p McpPrincipal, in mcpListProjectsIn) (any, error) { return s.ListProjects(ctx, p, in) }),
		mcpReadTool("get_project", "Get project", "One project with its description, task counts, revision and its 20 most recently updated tasks.", mcpSchemaProject,
			func(ctx context.Context, p McpPrincipal, in mcpProjectRef) (any, error) { return s.GetProject(ctx, p, in) }),
	}
}
```

`McpTools`: `r = append(r, mcpProjectTools(s)...)` sau nhóm Task. Catalogue thêm `{"list_projects", "List projects", ai.ToolRead, false}`, `{"get_project", "Get project", ai.ToolRead, false}`. `mcpReadInputs` thêm hai dòng (`get_project` cần một project: trong `TestMCPReadToolsDoNotMutate`, tạo `x.projectID = x.project(t, "Dự án đọc")` trước khi đếm, thêm trường `projectID` vào `mcpToolWorld`).

`ListProjectsFilter.Status` là `*string`; `ProjectStats` trả `map[string]ProjectView`, `TaskCount`/`DoneCount` là `int64` (`project.go:61`, `:88`, `:521`).

- [ ] **Step 3: Chạy test, thấy qua**

Run: `cd server && go test ./internal/service/ -run 'TestMcp|TestMCP' -count=1`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/mcp_tools_projects.go server/internal/service/mcp_tools_projects_test.go server/internal/service/mcp_tools.go server/internal/service/mcp_tools_test.go
git commit -m "feat(mcp): list_projects and get_project

Projects by keyword or status with task counts and revision; one project
with its description and its 20 most recently updated tasks.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2.2: `create_project`, `update_project`

**Files:**
- Modify: `server/internal/service/mcp_tools_projects.go`, `mcp_tools_projects_test.go`, `mcp_tools_test.go`

**Interfaces:**
- Consumes: `mcpWriteTool`, `mcpOpt`, `mcpChanges`, `mcpDate`, `optString` (0.6, 1.3).
- Produces: tool `create_project` (không destructive), `update_project` (destructive).

- [ ] **Step 1: Viết test hỏng**

```go
func TestMcpCreateAndUpdateProject(t *testing.T) {
	x := newMcpToolWorld(t)
	raw, err := callMcpTool(t, x.tools, x.p, "create_project", `{"workspace_id":"`+x.w.ID+`","title":"Ra mắt v2","priority":"high","lead_id":"`+x.ua.ID+`","due_date":"2026-12-01"}`)
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	id, _ := item["id"].(string)
	if id == "" || item["priority"] != "high" || item["lead_id"] != x.ua.ID {
		t.Fatalf("create_project = %s", raw)
	}
	raw, err = callMcpTool(t, x.tools, x.p, "update_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+id+`","revision":`+strconv.FormatInt(res.Revision, 10)+`,"status":"in_progress","due_date":null}`)
	if err != nil {
		t.Fatal(err)
	}
	upd, item := writeResult(t, raw)
	if item["status"] != "in_progress" || item["due_date"] != nil {
		t.Fatalf("update_project = %s", raw)
	}
	if len(upd.Changes) != 2 {
		t.Fatalf("changes = %+v, want status and due_date", upd.Changes)
	}
	_, err = callMcpTool(t, x.tools, x.p, "update_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+id+`","revision":`+strconv.FormatInt(res.Revision, 10)+`,"title":"X"}`)
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "revision_conflict" {
		t.Fatalf("stale update_project: %v", err)
	}
	_, err = callMcpTool(t, x.tools, x.p, "create_project", `{"workspace_id":"`+x.w.ID+`","title":"Ra mắt v2"}`)
	if !errors.As(err, &te) || te.Code != "duplicate_project_title" {
		t.Fatalf("duplicate title: %v", err)
	}
}

// Only the creator, the lead or a workspace admin edits a project; a member
// who can read it gets a refusal the model can explain.
func TestMcpUpdateProjectNeedsAnEditor(t *testing.T) {
	x := newMcpToolWorld(t)
	id := x.project(t, "Của chủ")
	addMember(t, x.tools.ask.meetings, x.w.ID, x.ub.ID)
	pr, _ := x.tools.ask.tasks.GetProject(context.Background(), Human(x.ua.ID), x.w.ID, id)
	member := McpPrincipal{UserID: x.ub.ID, OrganizationID: x.w.OrganizationID}
	_, err := callMcpTool(t, x.tools, member, "update_project", `{"workspace_id":"`+x.w.ID+`","project_id":"`+id+`","revision":`+strconv.FormatInt(pr.Revision, 10)+`,"title":"Chiếm"}`)
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "not_project_editor" {
		t.Fatalf("member edit: %v, want not_project_editor", err)
	}
}
```

`addMember` có sẵn ở `meeting_test.go`; nếu `ub` chưa thuộc tổ chức, thêm trước bằng `addOrgMemberRole(t, x.tools.q, x.w.OrganizationID, x.ub.ID, OrgRoleMember)`.

Run: `cd server && go test ./internal/service/ -run 'TestMcpCreateAndUpdateProject|TestMcpUpdateProjectNeedsAnEditor' -count=1`
Expected: FAIL, `no tool "create_project"`.

- [ ] **Step 2: Viết code**

Thêm vào `mcp_tools_projects.go` (import `strings`):

```go
var (
	mcpProjectStatuses   = map[string]bool{"planned": true, "in_progress": true, "paused": true, "completed": true, "cancelled": true}
	mcpProjectPriorities = map[string]bool{"none": true, "low": true, "medium": true, "high": true, "urgent": true}
)

type mcpCreateProjectIn struct {
	WorkspaceID string `json:"workspace_id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Status      string `json:"status"`
	Priority    string `json:"priority"`
	LeadID      string `json:"lead_id"`
	StartDate   string `json:"start_date"`
	DueDate     string `json:"due_date"`
}

func (s *McpToolService) CreateProject(ctx context.Context, p McpPrincipal, in mcpCreateProjectIn) (McpWriteResult, error) {
	if strings.TrimSpace(in.Title) == "" {
		return McpWriteResult{}, McpInvalidArgs{Msg: "title is required"}
	}
	if in.Status != "" && !mcpProjectStatuses[in.Status] {
		return McpWriteResult{}, McpInvalidArgs{Msg: "status must be planned, in_progress, paused, completed or cancelled"}
	}
	if in.Priority != "" && !mcpProjectPriorities[in.Priority] {
		return McpWriteResult{}, McpInvalidArgs{Msg: "priority must be one of " + strings.Join(mcpPriorities, ", ")}
	}
	for field, v := range map[string]string{"start_date": in.StartDate, "due_date": in.DueDate} {
		if v != "" {
			if err := mcpDate(field, v); err != nil {
				return McpWriteResult{}, err
			}
		}
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	var leadType *string
	if in.LeadID != "" {
		member := "member"
		leadType = &member
	}
	pr, err := s.ask.tasks.CreateProject(ctx, Human(p.UserID), in.WorkspaceID, CreateProjectInput{
		Title: in.Title, Description: optString(in.Description), Status: in.Status, Priority: in.Priority,
		LeadType: leadType, LeadID: optString(in.LeadID), StartDate: optString(in.StartDate), DueDate: optString(in.DueDate),
	})
	if err != nil {
		return McpWriteResult{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	return McpWriteResult{Item: s.projectOf(base, pr, ProjectView{}), Revision: pr.Revision}, nil
}

type mcpUpdateProjectIn struct {
	WorkspaceID string         `json:"workspace_id"`
	ProjectID   string         `json:"project_id"`
	Revision    *int64         `json:"revision"`
	Title       mcpOpt[string] `json:"title"`
	Description mcpOpt[string] `json:"description"`
	Status      mcpOpt[string] `json:"status"`
	Priority    mcpOpt[string] `json:"priority"`
	LeadID      mcpOpt[string] `json:"lead_id"`
	StartDate   mcpOpt[string] `json:"start_date"`
	DueDate     mcpOpt[string] `json:"due_date"`
}

func (in mcpUpdateProjectIn) check() error {
	if in.Revision == nil || *in.Revision <= 0 {
		return McpInvalidArgs{Msg: "revision is required; read the project first and send its revision"}
	}
	for field, o := range map[string]mcpOpt[string]{"title": in.Title, "description": in.Description, "status": in.Status, "priority": in.Priority} {
		if o.Null {
			return McpInvalidArgs{Msg: field + " cannot be null"}
		}
	}
	if in.Status.Set && !mcpProjectStatuses[in.Status.Value] {
		return McpInvalidArgs{Msg: "status must be planned, in_progress, paused, completed or cancelled"}
	}
	if in.Priority.Set && !mcpProjectPriorities[in.Priority.Value] {
		return McpInvalidArgs{Msg: "priority must be one of " + strings.Join(mcpPriorities, ", ")}
	}
	for field, o := range map[string]mcpOpt[string]{"start_date": in.StartDate, "due_date": in.DueDate} {
		if o.Set && !o.Null {
			if err := mcpDate(field, o.Value); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *McpToolService) UpdateProject(ctx context.Context, p McpPrincipal, in mcpUpdateProjectIn) (McpWriteResult, error) {
	if err := in.check(); err != nil {
		return McpWriteResult{}, err
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	before, err := s.project(ctx, p, in.WorkspaceID, in.ProjectID)
	if err != nil {
		return McpWriteResult{}, err
	}
	upd := UpdateProjectInput{
		ExpectedRevision: *in.Revision,
		Title: in.Title.ptr(), Description: in.Description.ptr(), Status: in.Status.ptr(), Priority: in.Priority.ptr(),
		LeadID: in.LeadID.ptr2(), StartDate: in.StartDate.ptr2(), DueDate: in.DueDate.ptr2(),
	}
	if in.LeadID.Set {
		if in.LeadID.Null {
			upd.LeadType = in.LeadID.ptr2()
		} else {
			member := "member"
			lt := &member
			upd.LeadType = &lt
		}
	}
	after, err := s.ask.tasks.UpdateProject(ctx, Human(p.UserID), in.WorkspaceID, before.ID, upd)
	if err != nil {
		return McpWriteResult{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	b, a := s.projectOf(base, before, ProjectView{}), s.projectOf(base, after, ProjectView{})
	return McpWriteResult{Item: a, Revision: after.Revision, Changes: mcpChanges(
		McpChange{"title", before.Title, after.Title},
		McpChange{"description", before.Description, after.Description},
		McpChange{"status", b.Status, a.Status},
		McpChange{"priority", b.Priority, a.Priority},
		McpChange{"lead_id", b.LeadID, a.LeadID},
		McpChange{"start_date", b.StartDate, a.StartDate},
		McpChange{"due_date", b.DueDate, a.DueDate},
	)}, nil
}
```

`projectOf` để `DueDate` rỗng khi không có hạn; JSON `omitempty` bỏ khóa, nên test kiểm `item["due_date"] == nil` đúng.

Schema và tool, thêm vào `mcpProjectTools`:

```go
	mcpSchemaCreateProject = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"title":{"type":"string","minLength":1,"maxLength":200},"description":{"type":"string"},"status":{"type":"string","enum":["planned","in_progress","paused","completed","cancelled"]},"priority":{"type":"string","enum":["none","low","medium","high","urgent"]},"lead_id":{"type":"string","description":"A user_id from list_members."},"start_date":{"type":"string","description":"YYYY-MM-DD"},"due_date":{"type":"string","description":"YYYY-MM-DD"}},"required":["workspace_id","title"],"additionalProperties":false}`)
	mcpSchemaUpdateProject = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"project_id":{"type":"string"},"revision":{"type":"integer"},"title":{"type":"string","minLength":1,"maxLength":200},"description":{"type":"string"},"status":{"type":"string","enum":["planned","in_progress","paused","completed","cancelled"]},"priority":{"type":"string","enum":["none","low","medium","high","urgent"]},"lead_id":{"type":["string","null"]},"start_date":{"type":["string","null"]},"due_date":{"type":["string","null"]}},"required":["workspace_id","project_id","revision"],"additionalProperties":false}`)
```

```go
		mcpWriteTool("create_project", "Create project", "Creates a project in the workspace as the user, without a chat channel. Everyone in the workspace sees it.", "set its status to cancelled, or delete it in UniWork", false, mcpSchemaCreateProject,
			func(ctx context.Context, p McpPrincipal, in mcpCreateProjectIn) (any, error) { return s.CreateProject(ctx, p, in) }),
		mcpWriteTool("update_project", "Update project", "Changes fields of one project as the user; omitted fields stay, null clears. Only its creator, lead or a workspace admin may. Fails with revision_conflict if it changed since you read it.", "call update_project again with the from values in changes", true, mcpSchemaUpdateProject,
			func(ctx context.Context, p McpPrincipal, in mcpUpdateProjectIn) (any, error) { return s.UpdateProject(ctx, p, in) }),
```

Catalogue thêm `{"create_project", "Create project", ai.ToolWrite, false}`, `{"update_project", "Update project", ai.ToolWrite, true}`.

- [ ] **Step 3: Chạy test, thấy qua**

Run: `cd server && go test ./internal/service/ -run 'TestMcp|TestMCP' -count=1 && go test ./internal/ -run TestMcpToolsCallNoDelete -count=1`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/mcp_tools_projects.go server/internal/service/mcp_tools_projects_test.go server/internal/service/mcp_tools_test.go
git commit -m "feat(mcp): create_project and update_project

Both run TaskService's project commands as the person who consented. An
update carries the revision the model read and is refused for anyone
but the creator, the lead or a workspace admin, in words a model can
pass on.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2.3: Isolation, lời đồng ý, kiểm chứng Phase 2

**Files:**
- Modify: `server/internal/handler/isolation_mcp_test.go`
- Modify: `packages/core/i18n/locales/vi.json`, `en.json` (`auth.connect.shareProjects`, `settings.aiAccess.toggleDescription`)
- Modify: `packages/views/auth/connect-consent.tsx` (một dòng `<li>`), `connect-consent.test.tsx`

- [ ] **Step 1: Isolation**

Trong `TestIsolationMCP`, khai báo `aProject := a.get(t, "project")` (khóa ở `isolation_world_test.go:482`), thêm vào `attacks` (đọc, đối số chuỗi):

```go
		{"list_projects", map[string]string{"workspace_id": a.wsID}},
		{"get_project", map[string]string{"workspace_id": a.wsID, "project_id": aProject}},
		{"get_project", map[string]string{"workspace_id": b.wsID, "project_id": aProject}},
```

và vào `writeAttacks`:

```go
		{"create_project", map[string]any{"workspace_id": a.wsID, "title": "iso-project"}},
		{"update_project", map[string]any{"workspace_id": a.wsID, "project_id": aProject, "revision": 1, "title": "iso"}},
		{"update_project", map[string]any{"workspace_id": b.wsID, "project_id": aProject, "revision": 1, "title": "iso"}},
		{"create_task", map[string]any{"workspace_id": b.wsID, "title": "iso-in-a-project", "project_id": aProject}},
```

Trong `control`, A tạo một project rồi sửa nó qua grant của mình (cùng khung với `create_task`/`update_task` của Task 1.5). Control đọc kiểm `want` là id project cho `get_project`: mở rộng biểu thức `want` thành `args["task_id"] + args["meeting_id"] + args["project_id"]`.

Run: `cd server && go test ./internal/handler/ -run 'TestIsolationMCP|TestIsolationMatrix' -count=1`
Expected: PASS.

- [ ] **Step 2: Lời đồng ý nhắc dự án**

`vi.json`, `auth.connect`: thêm `"shareProjects": "Dự án và công việc trong dự án",`; `settings.aiAccess.toggleDescription` thành `"Dữ liệu chia sẻ: công việc, bình luận, dự án, cuộc họp và tóm tắt AI. Không gồm chat và email. Tắt sẽ chặn ngay mọi ứng dụng đã kết nối."`. `en.json`: `"shareProjects": "Projects and their tasks"`, `toggleDescription`: `"Shared: tasks, comments, projects, meetings and AI summaries. Never chat or email. Turning this off blocks every connected app at once."`.

`connect-consent.tsx`: thêm `<li>{t("auth.connect.shareProjects")}</li>` sau `shareTasks`. Thêm vào test có sẵn đầu tiên một dòng `expect(screen.getByText("Projects and their tasks")).toBeInTheDocument();`; nếu test của `ai-access-tab` so khớp nguyên văn `toggleDescription`, sửa chuỗi kỳ vọng.

Run: `pnpm --filter @uniwork/views exec vitest run auth/connect-consent settings/components/ai-access-tab`
Expected: PASS.

- [ ] **Step 3: Gate, thử tay, note**

Run: `make check`. Thử trên ba client: "liệt kê dự án đang chạy", "tạo dự án X, giao tôi phụ trách", "đổi hạn dự án X sang 1/12" (khi một người khác vừa sửa dự án trên web, client nhận `revision_conflict` rồi đọc lại).

```bash
git add server/internal/handler/isolation_mcp_test.go packages/core/i18n/locales packages/views/auth
git commit -m "test(mcp): isolation and consent copy for the project tools

TestIsolationMCP aims B's grant at A's projects for every project tool
and as a task's project; A's own grant is the control. The consent page
and the admin switch now name projects among what is shared.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
make issue-note KEY=<UNI-key Phase 2> MSG="[agent] Phase 2 xong: list_projects, get_project, create_project, update_project; isolation; consent nhắc dự án. make check: <kết quả>. Thử tay: <kết quả>. Chưa push."
```

Dừng, hỏi người dùng trước khi `make issue-pr`.

---

# Phase 3 — Cuộc họp và khôi phục họp

Sub-issue: `MCP v2 Phase 3: tool Cuộc họp và khôi phục họp`. Bắt đầu khi PR Phase 2 đã merge.

### Task 3.1: `ExpectedVersion`, `CancelAt`, `Restore` ở MeetingService; route và nút Khôi phục

**Files:**
- Modify: `server/pkg/db/queries/meetings.sql` (query `RestoreMeeting`)
- Modify: `server/internal/service/meeting_update.go` (`UpdateMeetingInput.ExpectedVersion`), `meeting_lifecycle.go` (`cancel`, `CancelAt`, `Restore`), `errors.go` (`errMeetingVersionConflict`)
- Modify: `server/internal/audit/actions.go` (`ActionMeetingRestored`), `server/internal/service/audit_coverage_test.go`
- Modify: `server/internal/handler/meeting.go` (`restoreMeeting`), `dto/sdi` (`RestoreMeetingSDI`), `router/meetings.go`, `router` wiring của `Routes` (theo `CancelMeeting`), `isolation_routes_test.go`
- Modify: `packages/core/api/endpoints/meetings.ts` (+ test), `packages/core/meetings/hooks.ts`, `packages/core/meetings/status.ts`, `packages/views/meetings/meeting-detail-view.tsx` (+ test), `packages/views/meetings/meeting-activity-display.ts` (+ test), i18n vi/en
- Test: `server/internal/service/meeting_restore_test.go` (mới)

**Interfaces:**
- Produces:
  - `UpdateMeetingInput.ExpectedVersion *int32`
  - `func errMeetingVersionConflict(current int32) error` — `CodedError{Code: "revision_conflict", Status: 409, Err: ErrConflict, Fields: {"want": current}}`
  - `func (s *MeetingService) CancelAt(ctx context.Context, userID, meetingID, reason string, version int32) error`
  - `func (s *MeetingService) Restore(ctx context.Context, userID, meetingID string, expectedVersion *int32) (db.Meeting, error)`
  - `audit.ActionMeetingRestored = "meeting.restored"`
  - `POST /api/v1/meetings/{meetingID}/restore` body `{"version"?: number}` → `{"meeting": MeetingDTO}`
  - TS: `restoreMeeting(meetingId: string, version?: number): Promise<Meeting | null>`, `useRestoreMeeting(workspaceId: string)`

- [ ] **Step 1: Viết test hỏng**

`server/internal/service/meeting_restore_test.go`:

```go
package service

import (
	"context"
	"testing"
	"time"
)

func TestRestoreBringsBackACancelledMeeting(t *testing.T) {
	s, ua, ub, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(2 * time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Giao ban", StartsAt: start, EndsAt: start.Add(time.Hour), Timezone: "Asia/Ho_Chi_Minh"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CancelAt(ctx, ua.ID, m.ID, "nhầm", m.Version-1); !codedIs(err, "revision_conflict") {
		t.Fatalf("cancel at a stale version: %v", err)
	}
	if err := s.CancelAt(ctx, ua.ID, m.ID, "nhầm", m.Version); err != nil {
		t.Fatal(err)
	}
	canceled, _ := s.Get(ctx, ua.ID, m.ID)
	addMember(t, s, w.ID, ub.ID)
	if _, err := s.Restore(ctx, ub.ID, m.ID, nil); err == nil {
		t.Fatal("a plain member restored the meeting")
	}
	restored, err := s.Restore(ctx, ua.ID, m.ID, &canceled.Version)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Status != MeetingScheduled || restored.CancelReason.Valid || restored.Version != canceled.Version+1 {
		t.Fatalf("restored = %+v", restored)
	}
	if _, err := s.Restore(ctx, ua.ID, m.ID, nil); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("restoring a scheduled meeting: %v", err)
	}
	var rows int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = 'meeting.restored' AND resource_id = $1`, m.ID).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Fatalf("meeting.restored rows = %d", rows)
	}
}

func TestRestoreRefusesAMeetingWhoseTimeHasPassed(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Đã qua", StartsAt: start, EndsAt: start.Add(time.Hour), Timezone: "UTC"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Cancel(ctx, ua.ID, m.ID, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE meetings SET starts_at = now() - interval '3 hours', ends_at = now() - interval '2 hours' WHERE id = $1`, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Restore(ctx, ua.ID, m.ID, nil); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("restoring a past meeting: %v", err)
	}
}

func TestUpdateMeetingChecksTheExpectedVersion(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	start := time.Now().Add(time.Hour)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "A", StartsAt: start, EndsAt: start.Add(time.Hour), Timezone: "UTC"})
	if err != nil {
		t.Fatal(err)
	}
	stale := m.Version - 1
	title := "B"
	if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{Title: &title, ExpectedVersion: &stale}); !codedIs(err, "revision_conflict") {
		t.Fatalf("stale update: %v", err)
	}
	if _, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{Title: &title, ExpectedVersion: &m.Version}); err != nil {
		t.Fatal(err)
	}
}
```

`meetingFixture`, `addMember` có sẵn ở `meeting_test.go`; `s.pool` là trường của `MeetingService` (`meeting.go:85`); `db.Meeting.CancelReason` là `pgtype.Text`.

Run: `cd server && go test ./internal/service/ -run 'TestRestore|TestUpdateMeetingChecksTheExpectedVersion' -count=1`
Expected: FAIL, `s.CancelAt undefined`.

- [ ] **Step 2: Query và service**

`meetings.sql`, sau `CancelMeeting`:

```sql
-- name: RestoreMeeting :one
-- tenant: by-id
-- Undo of a cancellation while the meeting's window is still ahead (ADR 0033).
UPDATE meetings SET
  status = 'SCHEDULED',
  canceled_by = NULL,
  canceled_at = NULL,
  cancel_reason = NULL,
  updated_by = sqlc.arg('updated_by'),
  updated_at = now(),
  version = version + 1
WHERE id = sqlc.arg('id') AND status = 'CANCELED' AND version = sqlc.arg('version') AND ends_at > now()
RETURNING *;
```

Run: `make sqlc`.

`errors.go`:

```go
// errMeetingVersionConflict is a meeting edit made against a version that is
// no longer current (MCP, ADR 0033).
func errMeetingVersionConflict(current int32) error {
	return CodedError{
		Code: "revision_conflict", Status: http.StatusConflict, Msg: "cuộc họp đã được người khác thay đổi; tải lại rồi thử lại",
		Err: ErrConflict, Fields: map[string]any{"want": current},
	}
}
```

`audit/actions.go`: `ActionMeetingRestored = "meeting.restored"` (khối hằng số, thêm comment `// A cancelled meeting brought back (MeetingService.Restore).`). `audit_coverage_test.go`: thêm vào `auditActions()` và `actionsWithoutCommands`: `audit.ActionMeetingRestored: "covered by meeting_restore_test.go",`.

`meeting_update.go`: `UpdateMeetingInput` thêm `ExpectedVersion *int32 // the version the caller read; nil skips the check (MCP, ADR 0033)`. Trong `Update`, ngay sau lần gọi `meetingEditable(m, in)` thứ hai (sau `LockMeetingForAttendance`):

```go
	if in.ExpectedVersion != nil && *in.ExpectedVersion != m.Version {
		return db.Meeting{}, errMeetingVersionConflict(m.Version)
	}
```

`meeting_lifecycle.go`: đổi `Cancel` thành lời gọi tới hàm chung và thêm hai method:

```go
func (s *MeetingService) Cancel(ctx context.Context, userID, meetingID, reason string) error {
	return s.cancel(ctx, userID, meetingID, reason, nil)
}

// CancelAt is Cancel for a caller that read the meeting at version (MCP).
func (s *MeetingService) CancelAt(ctx context.Context, userID, meetingID, reason string, version int32) error {
	return s.cancel(ctx, userID, meetingID, reason, &version)
}
```

Đổi tên thân `Cancel` cũ thành `func (s *MeetingService) cancel(ctx context.Context, userID, meetingID, reason string, expected *int32) error` và thêm ngay sau `requireHostOrAdmin`:

```go
	if expected != nil && *expected != m.Version {
		return errMeetingVersionConflict(m.Version)
	}
```

(`CancelMeeting` vẫn so `version` ở DB nên chênh lệch giữa lần đọc và lần ghi vẫn bị chặn.)

Thêm `Restore`:

```go
// Restore brings a cancelled meeting back to SCHEDULED while its window is
// still ahead: the undo of Cancel (ADR 0033). Host or workspace admin only.
// A cancellation sends no notification, so neither does a restore; the
// realtime meeting.updated refreshes every open list.
func (s *MeetingService) Restore(ctx context.Context, userID, meetingID string, expectedVersion *int32) (db.Meeting, error) {
	m, err := s.requireHostOrAdmin(ctx, userID, meetingID)
	if err != nil {
		return db.Meeting{}, err
	}
	if expectedVersion != nil && *expectedVersion != m.Version {
		return db.Meeting{}, errMeetingVersionConflict(m.Version)
	}
	if m.Status != MeetingCanceled || !m.EndsAt.Time.After(time.Now()) {
		return db.Meeting{}, errInvalidState()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Meeting{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	restored, err := q.RestoreMeeting(ctx, db.RestoreMeetingParams{ID: m.ID, Version: m.Version, UpdatedBy: strText(userID)})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Meeting{}, errInvalidState()
	}
	if err != nil {
		return db.Meeting{}, err
	}
	if err := s.writeAudit(ctx, q, m, "MEETING_RESTORED", userID, MeetingCanceled, MeetingScheduled, "{}"); err != nil {
		return db.Meeting{}, err
	}
	payload := meetingEventPayload(restored)
	payload["workspace_id"] = restored.WorkspaceID
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: restored.OrganizationID, WorkspaceID: restored.WorkspaceID, Actor: audit.User(userID),
		Action: audit.ActionMeetingRestored, ResourceType: "meeting", ResourceID: restored.ID,
		Changes: audit.Diff(map[string]any{"status": MeetingCanceled}, map[string]any{"status": MeetingScheduled}),
	}, audit.Event{Topic: "meeting.updated", Payload: payload, OrganizationID: restored.OrganizationID, WorkspaceID: restored.WorkspaceID}); err != nil {
		return db.Meeting{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Meeting{}, err
	}
	return restored, nil
}
```

Kiểm kiểu tham số `UpdatedBy` của `RestoreMeetingParams` sau `make sqlc` (`pgtype.Text` thì `strText(userID)`, `string` thì `userID`). Kiểm hàng catalogue `meeting.updated` trong `server/internal/outbox/catalogue.go` cho phép khóa `workspace_id`; nếu không, bỏ dòng `payload["workspace_id"]` (khi đó `recordResource` cũng không cần nó).

- [ ] **Step 3: Route REST**

`dto/sdi`, cạnh `CancelMeetingSDI`:

```go
// RestoreMeetingSDI is POST /api/v1/meetings/{meetingID}/restore.
type RestoreMeetingSDI struct {
	Version *int32 `json:"version,omitempty" description:"Phiên bản người dùng đang xem; lệch thì 409 revision_conflict" example:"4"`
}
```

`handler/meeting.go`:

```go
func (h *handlers) restoreMeeting(w http.ResponseWriter, r *http.Request) {
	var in sdi.RestoreMeetingSDI
	if r.ContentLength > 0 && !decode(w, r, &in, maxJSONBody) {
		return
	}
	m, err := h.Meetings.Restore(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), in.Version)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"meeting": toMeetingDTO(m)})
}
```

Đăng ký `RestoreMeeting` theo đúng đường của `CancelMeeting` (tìm `CancelMeeting` trong `server/internal/handler/router/*.go` và `server/internal/handler/router.go`). `router/meetings.go`, sau route `/cancel`:

```go
	r.Post("/meetings/{meetingID}/restore", h.RestoreMeeting, apiOp{
		summary: "Restore a cancelled meeting", tags: []string{"meetings"},
		sdi: sdi.RestoreMeetingSDI{}, sdo: sdo.MeetingSDO{}, auth: true,
	})
```

`isolation_routes_test.go`:

```go
	"POST /api/v1/meetings/{meetingID}/restore": {control: []int{http.StatusConflict},
		reason: "the tenant's own fixture meeting was never cancelled, so its owner's restore answers 409 invalid_meeting_state; the cross-tenant call must still be refused 403/404 and A's digest catches a restore"},
```

`isoSpec.control` (trạng thái thêm mà lượt control chấp nhận) và `isoSpec.reason` là tên thật (`isolation_routes_test.go:36`).

- [ ] **Step 4: Web**

`meetings.ts`, sau `cancelMeeting`:

```ts
/** Brings a cancelled meeting back while its time is still ahead. */
export async function restoreMeeting(meetingId: string, version?: number): Promise<Meeting | null> {
  const raw = await request(`/api/v1/meetings/${enc(meetingId)}/restore`, { method: "POST", body: { version } });
  return parseWithFallback<{ meeting: Meeting } | null>(raw, MeetingResponse, null, {
    endpoint: "POST /api/v1/meetings/{id}/restore",
  })?.meeting ?? null;
}
```

Thêm ca malformed-response vào test endpoint của meetings (chép khung của `extendMeeting`).

`hooks.ts`, sau `useCancelMeeting`:

```ts
export function useRestoreMeeting(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ meetingId, version }: { meetingId: string; version?: number }) => meetings.restoreMeeting(meetingId, version),
    onSuccess: (_d, { meetingId }) => invalidateMeeting(qc, workspaceId, meetingId),
  });
}
```

`meeting-detail-view.tsx`: import `RotateCcw` từ `lucide-react` và `useRestoreMeeting`; `const restore = useRestoreMeeting(workspaceId);`. Trong `actions`, sau nút hủy:

```tsx
            {layout === "page" && canCancel.allowed && meeting.status === "CANCELED" && new Date(meeting.ends_at).getTime() > nowMs ? (
              <CollectionPageHeaderAction
                icon={RotateCcw}
                label={t("meetings.restore")}
                variant="outline"
                onClick={() =>
                  restore.mutate(
                    { meetingId, version: meeting.version },
                    { onSuccess: () => toast.success(t("meetings.meetingRestoredToast")), onError },
                  )
                }
              />
            ) : null}
```

`RotateCcw` là tên canonical (đang dùng ở `comment-card.tsx`). i18n: `meetings.restore` "Khôi phục" / "Restore"; `meetings.meetingRestoredToast` "Đã khôi phục cuộc họp" / "Meeting restored"; `meetings.activity_restored` "đã khôi phục cuộc họp" / "restored the meeting".

Nhật ký hoạt động của cuộc họp đọc nhãn theo `event_type`: thêm `MEETING_RESTORED: "meetings.activity_restored"` vào `ACTIVITY_KEYS` (`packages/core/meetings/status.ts:20`) và `MEETING_RESTORED: "canceled"` vào `KIND` (`packages/views/meetings/meeting-activity-display.ts`, cùng dấu trên dòng thời gian với lần hủy nó đảo ngược); `activityStateChange` đã in `CANCELED → SCHEDULED` vì cả hai nằm trong `MEETING_STATES`. Thêm một ca vào `meeting-activity-display.test.ts`: `activityLabel("MEETING_RESTORED") === "meetings.activity_restored"`.

Test trong `meeting-detail-view.test.tsx` (chép khung của test nút hủy): cuộc họp `CANCELED`, `ends_at` ở tương lai, người xem là host → có nút "Restore", bấm gọi `POST /api/v1/meetings/{id}/restore` với `{"version": …}`; `ends_at` đã qua → không có nút.

- [ ] **Step 5: Chạy test, thấy qua**

Run: `cd server && go test ./internal/service/ -run 'TestRestore|TestUpdateMeeting|TestMeeting|TestEveryAuditedCommandWritesItsRow' -count=1 && go test ./internal/handler/ -run 'TestIsolationMatrix|TestSwagger|Meeting' -count=1 && cd .. && pnpm --filter @uniwork/core exec vitest run meetings && pnpm --filter @uniwork/views exec vitest run meetings/meeting-detail-view && node --test scripts/*.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/pkg/db/queries/meetings.sql server/pkg/db/generated server/internal packages/core/api/endpoints packages/core/meetings packages/views/meetings packages/core/i18n/locales
git commit -m "feat(meetings): restore a cancelled meeting; edits may name a version

MeetingService.Restore brings a cancelled meeting back to SCHEDULED
while its time is still ahead, for its host or a workspace admin, and is
audited as meeting.restored; the meeting page shows a Restore button.
Update and the new CancelAt refuse a stale version with
revision_conflict. The MCP meeting tools need both (ADR 0033).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.2: `list_meetings` và `get_meeting` mở rộng

**Files:**
- Create: `server/internal/service/mcp_tools_meetings.go`, `mcp_tools_meetings_test.go`
- Modify: `server/internal/service/mcp_tools.go` (`GetMeeting` trả `McpMeeting`, `McpTools` ghép `mcpMeetingTools`), `mcp_tools_test.go` (catalogue, `mcpReadInputs`, `TestMcpToolOutputsCarryOnlyDocumentedFields`)

**Interfaces:**
- Produces:
  - `type McpAttendee struct{ UserID string \`json:"user_id,omitempty"\`; Name string \`json:"name"\`; Role string \`json:"role"\`; Status string \`json:"status"\` }`
  - `type McpMeeting struct{ McpItem; Revision int64 \`json:"revision"\`; EndsAt string \`json:"ends_at,omitempty"\`; Timezone string \`json:"timezone,omitempty"\`; HostUserID string \`json:"host_user_id,omitempty"\`; ProjectID string \`json:"project_id,omitempty"\`; Attendees []McpAttendee \`json:"attendees,omitempty"\` }`
  - `func (s *McpToolService) meeting(ctx context.Context, p McpPrincipal, workspaceID, meetingID string) (db.Meeting, error)`
  - `func (s *McpToolService) meetingOf(base string, m db.Meeting) McpMeeting`
  - `func mcpTime(field, v string) (time.Time, error)` — RFC 3339 có offset bắt buộc
  - `func mcpMeetingTools(s *McpToolService) []ai.Tool`

`revision` của cuộc họp là `meetings.version`.

- [ ] **Step 1: Viết test hỏng**

`server/internal/service/mcp_tools_meetings_test.go`:

```go
package service

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestMcpListMeetingsInARange(t *testing.T) {
	x := newMcpToolWorld(t)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Giao ban", "")
	from := time.Now().UTC().Format(time.RFC3339)
	to := time.Now().Add(48 * time.Hour).UTC().Format(time.RFC3339)
	raw, err := callMcpTool(t, x.tools, x.p, "list_meetings", `{"workspace_id":"`+x.w.ID+`","from":"`+from+`","to":"`+to+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	var list []McpMeeting
	if err := json.Unmarshal(raw, &list); err != nil || len(list) != 1 || list[0].ID != m.ID || list[0].Revision != int64(m.Version) {
		t.Fatalf("list_meetings = %s (%v)", raw, err)
	}
	if _, err := callMcpTool(t, x.tools, x.p, "list_meetings", `{"workspace_id":"`+x.w.ID+`","from":"2026-10-15T10:00","to":"`+to+`"}`); err == nil {
		t.Fatal("a time without an offset was accepted")
	}
}

func TestMcpGetMeetingListsAttendeesAndRevision(t *testing.T) {
	x := newMcpToolWorld(t)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Giao ban", "Chương trình")
	raw, err := callMcpTool(t, x.tools, x.p, "get_meeting", `{"workspace_id":"`+x.w.ID+`","meeting_id":"`+m.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	var one McpMeeting
	if err := json.Unmarshal(raw, &one); err != nil || one.Revision != int64(m.Version) || one.HostUserID != x.ua.ID || len(one.Attendees) == 0 || strings.Contains(string(raw), "@") {
		t.Fatalf("get_meeting = %s (%v)", raw, err)
	}
	if _, err := callMcpTool(t, x.tools, x.p, "get_meeting", `{"workspace_id":"`+x.w.ID+`","meeting_id":"01J0000000000000000000000X"}`); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown meeting: %v", err)
	}
}
```

Run: `cd server && go test ./internal/service/ -run 'TestMcpListMeetingsInARange|TestMcpGetMeetingListsAttendeesAndRevision' -count=1`
Expected: FAIL.

- [ ] **Step 2: Viết code**

`server/internal/service/mcp_tools_meetings.go`:

```go
package service

import (
	"context"
	"encoding/json"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The meeting tools of the MCP connector (spec 2026-10-14 §5.3). Transcripts
// never leave; attendee emails never leave.

type McpAttendee struct {
	UserID string `json:"user_id,omitempty"`
	Name   string `json:"name"`
	Role   string `json:"role"`
	Status string `json:"status"`
}

type McpMeeting struct {
	McpItem
	Revision   int64         `json:"revision"`
	EndsAt     string        `json:"ends_at,omitempty"`
	Timezone   string        `json:"timezone,omitempty"`
	HostUserID string        `json:"host_user_id,omitempty"`
	ProjectID  string        `json:"project_id,omitempty"`
	Attendees  []McpAttendee `json:"attendees,omitempty"`
}

const mcpMaxRange = 92 * 24 * time.Hour

// mcpTime reads an RFC 3339 time with its offset. A time without one is
// refused, never read as UTC: "10 giờ" means the person's 10 o'clock.
func mcpTime(field, v string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return time.Time{}, McpInvalidArgs{Msg: field + " must be ISO 8601 with a timezone offset, e.g. 2026-10-15T10:00:00+07:00"}
	}
	return t, nil
}

func (s *McpToolService) meetingOf(base string, m db.Meeting) McpMeeting {
	out := McpMeeting{
		McpItem:  McpItem{Kind: "meeting", ID: m.ID, WorkspaceID: m.WorkspaceID, Title: m.Title, Status: m.Status, URL: s.frontend + base + "/meetings/" + m.ID, Excerpt: capRunes(m.Description, mcpMaxHitRunes, mcpHitCut)},
		Revision: int64(m.Version), Timezone: m.Timezone, HostUserID: m.HostUserID, ProjectID: m.ProjectID.String,
	}
	if m.StartsAt.Valid {
		out.StartsAt = m.StartsAt.Time.UTC().Format(time.RFC3339)
	}
	if m.EndsAt.Valid {
		out.EndsAt = m.EndsAt.Time.UTC().Format(time.RFC3339)
	}
	return out
}

// meeting reads one meeting of the workspace as the person; another
// workspace's reads as absent.
func (s *McpToolService) meeting(ctx context.Context, p McpPrincipal, workspaceID, meetingID string) (db.Meeting, error) {
	if meetingID == "" {
		return db.Meeting{}, McpInvalidArgs{Msg: "meeting_id is required"}
	}
	m, err := s.ask.meetings.Get(ctx, p.UserID, meetingID)
	if err != nil {
		return db.Meeting{}, hidden(err)
	}
	if m.WorkspaceID != workspaceID {
		return db.Meeting{}, ErrNotFound
	}
	return m, nil
}

func (s *McpToolService) attendees(ctx context.Context, p McpPrincipal, meetingID string) ([]McpAttendee, error) {
	rows, err := s.ask.meetings.ListParticipants(ctx, p.UserID, "", meetingID)
	if err != nil {
		return nil, err
	}
	out := make([]McpAttendee, 0, len(rows))
	for _, r := range rows {
		out = append(out, McpAttendee{UserID: r.UserID.String, Name: r.DisplayNameSnapshot, Role: r.Role, Status: r.Status})
	}
	return out, nil
}

type mcpListMeetingsIn struct {
	WorkspaceID string `json:"workspace_id"`
	From        string `json:"from"`
	To          string `json:"to"`
	HostedByMe  bool   `json:"hosted_by_me"`
	Status      string `json:"status"`
}

func (s *McpToolService) ListMeetings(ctx context.Context, p McpPrincipal, in mcpListMeetingsIn) ([]McpMeeting, error) {
	from, err := mcpTime("from", in.From)
	if err != nil {
		return nil, err
	}
	to, err := mcpTime("to", in.To)
	if err != nil {
		return nil, err
	}
	if !to.After(from) || to.Sub(from) > mcpMaxRange {
		return nil, McpInvalidArgs{Msg: "to must be after from, at most 92 days later"}
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return nil, err
	}
	f := MeetingListFilter{Status: in.Status, From: &from, To: &to, Limit: mcpMaxList, Sort: "starts_at", Location: time.UTC}
	if in.HostedByMe {
		f.HostUserID = p.UserID
	}
	rows, _, err := s.ask.meetings.ListFiltered(ctx, p.UserID, in.WorkspaceID, f)
	if err != nil {
		return nil, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return nil, err
	}
	out := make([]McpMeeting, 0, len(rows))
	for _, r := range rows {
		out = append(out, s.meetingOf(base, r.Meeting))
	}
	return out, nil
}

var mcpSchemaListMeetings = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"from":{"type":"string","description":"ISO 8601 with offset."},"to":{"type":"string","description":"ISO 8601 with offset, at most 92 days after from."},"hosted_by_me":{"type":"boolean"},"status":{"type":"string","enum":["SCHEDULED","IN_PROGRESS","ENDED","CANCELED","MISSED"]}},"required":["workspace_id","from","to"],"additionalProperties":false}`)

func mcpMeetingTools(s *McpToolService) []ai.Tool {
	return []ai.Tool{
		mcpReadTool("list_meetings", "List meetings", "Meetings of one workspace that start between from and to, soonest first, with their revision. Cancelled ones are included with status CANCELED.", mcpSchemaListMeetings,
			func(ctx context.Context, p McpPrincipal, in mcpListMeetingsIn) (any, error) { return s.ListMeetings(ctx, p, in) }),
	}
}
```

`MeetingListFilter.Status` là trạng thái người xem thấy: `SCHEDULED`, `IN_PROGRESS`, `ENDED`, `CANCELED`, và `MISSED` (đã qua giờ mà chưa bắt đầu; `meetings.sql:34`). `Sort` hợp lệ: `""`, `"actual_start_at"`, `"starts_at"` (`meeting_queries.go:224`).

`mcp_tools.go`, `GetMeeting` thành:

```go
func (s *McpToolService) GetMeeting(ctx context.Context, p McpPrincipal, workspaceID, meetingID string) (McpMeeting, error) {
	if err := s.inGrant(ctx, p, workspaceID); err != nil {
		return McpMeeting{}, err
	}
	m, err := s.meeting(ctx, p, workspaceID, meetingID)
	if err != nil {
		return McpMeeting{}, err
	}
	item, err := s.one(ctx, p, workspaceID, m.ID, "meeting_id", s.ask.meetingContext)
	if err != nil {
		return McpMeeting{}, err
	}
	base, err := s.ask.base(ctx, workspaceID)
	if err != nil {
		return McpMeeting{}, err
	}
	out := s.meetingOf(base, m)
	// The item carries the summary in its excerpt; the times and status come
	// from the row.
	status, starts := out.Status, out.StartsAt
	out.McpItem = item
	out.Status, out.StartsAt = status, starts
	if out.Attendees, err = s.attendees(ctx, p, m.ID); err != nil {
		return McpMeeting{}, hidden(err)
	}
	return out, nil
}
```

Description `get_meeting` thành `"One meeting with its attendees, revision and AI summary when there is one. Transcripts are not included."`. `McpTools`: `r = append(r, mcpMeetingTools(s)...)` sau nhóm Dự án. Catalogue thêm `{"list_meetings", "List meetings", ai.ToolRead, false}`; `mcpReadInputs` thêm `list_meetings` với khoảng hôm nay tới 2 ngày sau; `TestMcpToolOutputsCarryOnlyDocumentedFields`: dòng `get_meeting` thành `check("get_meeting", raw, err, with("revision", "ends_at", "timezone", "host_user_id", "project_id", "attendees"))` (`with` từ Task 1.2).

- [ ] **Step 3: Chạy test, thấy qua**

Run: `cd server && go test ./internal/service/ -run 'TestMcp|TestMCP' -count=1`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/mcp_tools_meetings.go server/internal/service/mcp_tools_meetings_test.go server/internal/service/mcp_tools.go server/internal/service/mcp_tools_test.go
git commit -m "feat(mcp): list_meetings; get_meeting gains attendees and revision

list_meetings reads a range of at most 92 days, times only with an
offset. get_meeting returns its attendees (names, no email), host,
timezone and revision beside the summary it already had.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.3: `schedule_meeting`, `update_meeting`, `invite_to_meeting`

**Files:**
- Modify: `server/internal/service/mcp_tools_meetings.go`, `mcp_tools_meetings_test.go`, `mcp_tools_test.go`

**Interfaces:**
- Consumes: `UpdateMeetingInput.ExpectedVersion` (3.1), `mcpTime`, `meeting`, `meetingOf` (3.2), `mcpWriteTool`, `mcpChanges`, `mcpOpt`.
- Produces: tool `schedule_meeting` (không destructive), `update_meeting` (destructive), `invite_to_meeting` (không destructive); `func (s *McpToolService) timezoneOf(ctx context.Context, userID, given string) (string, error)`; `func mcpVersion(rev *int64) (int32, error)`.

- [ ] **Step 1: Viết test hỏng**

```go
func TestMcpScheduleMeeting(t *testing.T) {
	x := newMcpToolWorld(t)
	start := time.Now().Add(24 * time.Hour).Truncate(time.Minute)
	in := `{"workspace_id":"` + x.w.ID + `","title":"Họp khách ACME","starts_at":"` + start.Format(time.RFC3339) + `","ends_at":"` + start.Add(time.Hour).Format(time.RFC3339) + `"}`
	raw, err := callMcpTool(t, x.tools, x.p, "schedule_meeting", in)
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	if res.Revision == 0 || item["status"] != "SCHEDULED" || item["host_user_id"] != x.ua.ID || item["timezone"] == "" {
		t.Fatalf("schedule_meeting = %s", raw)
	}
}

// Review Focus 1: a time without an offset is refused, not read as UTC.
func TestMcpScheduleMeetingRefusesATimeWithoutAnOffset(t *testing.T) {
	x := newMcpToolWorld(t)
	_, err := callMcpTool(t, x.tools, x.p, "schedule_meeting", `{"workspace_id":"`+x.w.ID+`","title":"A","starts_at":"2026-10-15T10:00","ends_at":"2026-10-15T11:00"}`)
	var bad McpInvalidArgs
	if !errors.As(err, &bad) || !strings.Contains(bad.Msg, "offset") {
		t.Fatalf("no offset: %v", err)
	}
	_, err = callMcpTool(t, x.tools, x.p, "schedule_meeting", `{"workspace_id":"`+x.w.ID+`","title":"A","starts_at":"2026-10-15T10:00:00+07:00","ends_at":"2026-10-15T11:00:00+07:00","timezone":"Mars/Base"}`)
	if !errors.As(err, &bad) || !strings.Contains(bad.Msg, "timezone") {
		t.Fatalf("unknown timezone: %v", err)
	}
}

func TestMcpUpdateMeetingAndInvite(t *testing.T) {
	x := newMcpToolWorld(t)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Giao ban", "")
	newStart := m.StartsAt.Time.Add(time.Hour)
	in := `{"workspace_id":"` + x.w.ID + `","meeting_id":"` + m.ID + `","revision":` + strconv.Itoa(int(m.Version)) + `,"starts_at":"` + newStart.Format(time.RFC3339) + `","ends_at":"` + newStart.Add(time.Hour).Format(time.RFC3339) + `"}`
	raw, err := callMcpTool(t, x.tools, x.p, "update_meeting", in)
	if err != nil {
		t.Fatal(err)
	}
	res, _ := writeResult(t, raw)
	if len(res.Changes) != 2 {
		t.Fatalf("changes = %+v, want starts_at and ends_at", res.Changes)
	}
	if _, err := callMcpTool(t, x.tools, x.p, "update_meeting", in); err == nil {
		t.Fatal("the same revision was accepted twice")
	}
	addMember(t, x.tools.ask.meetings, x.w.ID, x.ub.ID)
	raw, err = callMcpTool(t, x.tools, x.p, "invite_to_meeting", `{"workspace_id":"`+x.w.ID+`","meeting_id":"`+m.ID+`","user_ids":["`+x.ub.ID+`","01J0000000000000000000000X"]}`)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"invited"`) || !strings.Contains(string(raw), "01J0000000000000000000000X") {
		t.Fatalf("invite_to_meeting = %s, want one invited and one refused", raw)
	}
}
```

`addMember(…, x.ub.ID)` cần `ub` đã ở tổ chức: gọi `addOrgMemberRole(t, x.tools.q, x.w.OrganizationID, x.ub.ID, OrgRoleMember)` trước. Import thêm `strconv`.

Run: `cd server && go test ./internal/service/ -run 'TestMcpScheduleMeeting|TestMcpUpdateMeetingAndInvite' -count=1`
Expected: FAIL.

- [ ] **Step 2: Viết code**

Thêm vào `mcp_tools_meetings.go` (import `strings`, `math`):

```go
const mcpDefaultTimezone = "Asia/Ho_Chi_Minh"

// timezoneOf is the meeting's zone: the one given, else the person's own,
// else Vietnam's. A zone Go cannot load is refused.
func (s *McpToolService) timezoneOf(ctx context.Context, userID, given string) (string, error) {
	tz := strings.TrimSpace(given)
	if tz == "" {
		if u, err := s.q.GetUserByID(ctx, userID); err == nil && u.Timezone != "" {
			tz = u.Timezone
		} else {
			tz = mcpDefaultTimezone
		}
	}
	if _, err := time.LoadLocation(tz); err != nil {
		return "", McpInvalidArgs{Msg: "timezone must be an IANA zone such as Asia/Ho_Chi_Minh"}
	}
	return tz, nil
}

// mcpVersion is a meeting revision as the int32 the service compares.
func mcpVersion(rev *int64) (int32, error) {
	if rev == nil || *rev <= 0 || *rev > math.MaxInt32 {
		return 0, McpInvalidArgs{Msg: "revision is required; read the meeting first and send its revision"}
	}
	return int32(*rev), nil
}

type mcpScheduleMeetingIn struct {
	WorkspaceID string   `json:"workspace_id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	StartsAt    string   `json:"starts_at"`
	EndsAt      string   `json:"ends_at"`
	Timezone    string   `json:"timezone"`
	AttendeeIDs []string `json:"attendee_ids"`
	ProjectID   string   `json:"project_id"`
}

func (s *McpToolService) ScheduleMeeting(ctx context.Context, p McpPrincipal, in mcpScheduleMeetingIn) (McpWriteResult, error) {
	if strings.TrimSpace(in.Title) == "" {
		return McpWriteResult{}, McpInvalidArgs{Msg: "title is required"}
	}
	start, err := mcpTime("starts_at", in.StartsAt)
	if err != nil {
		return McpWriteResult{}, err
	}
	end, err := mcpTime("ends_at", in.EndsAt)
	if err != nil {
		return McpWriteResult{}, err
	}
	if len(in.AttendeeIDs) > 50 {
		return McpWriteResult{}, McpInvalidArgs{Msg: "at most 50 attendees"}
	}
	tz, err := s.timezoneOf(ctx, p.UserID, in.Timezone)
	if err != nil {
		return McpWriteResult{}, err
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	m, err := s.ask.meetings.Create(ctx, p.UserID, in.WorkspaceID, CreateMeetingInput{
		Title: in.Title, Description: in.Description, StartsAt: start, EndsAt: end, Timezone: tz,
		ProjectID: in.ProjectID, AttendeeUserIDs: in.AttendeeIDs,
	})
	if err != nil {
		return McpWriteResult{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	return McpWriteResult{Item: s.meetingOf(base, m), Revision: int64(m.Version)}, nil
}

type mcpUpdateMeetingIn struct {
	WorkspaceID string         `json:"workspace_id"`
	MeetingID   string         `json:"meeting_id"`
	Revision    *int64         `json:"revision"`
	Title       mcpOpt[string] `json:"title"`
	Description mcpOpt[string] `json:"description"`
	StartsAt    mcpOpt[string] `json:"starts_at"`
	EndsAt      mcpOpt[string] `json:"ends_at"`
	Timezone    mcpOpt[string] `json:"timezone"`
	ProjectID   mcpOpt[string] `json:"project_id"`
}

func (s *McpToolService) UpdateMeeting(ctx context.Context, p McpPrincipal, in mcpUpdateMeetingIn) (McpWriteResult, error) {
	version, err := mcpVersion(in.Revision)
	if err != nil {
		return McpWriteResult{}, err
	}
	for field, o := range map[string]mcpOpt[string]{"title": in.Title, "description": in.Description, "starts_at": in.StartsAt, "ends_at": in.EndsAt, "timezone": in.Timezone, "project_id": in.ProjectID} {
		if o.Null {
			return McpWriteResult{}, McpInvalidArgs{Msg: field + " cannot be null"}
		}
	}
	upd := UpdateMeetingInput{ExpectedVersion: &version, Title: in.Title.ptr(), Description: in.Description.ptr(), ProjectID: in.ProjectID.ptr()}
	if in.StartsAt.Set {
		t, err := mcpTime("starts_at", in.StartsAt.Value)
		if err != nil {
			return McpWriteResult{}, err
		}
		upd.StartsAt = &t
	}
	if in.EndsAt.Set {
		t, err := mcpTime("ends_at", in.EndsAt.Value)
		if err != nil {
			return McpWriteResult{}, err
		}
		upd.EndsAt = &t
	}
	if in.Timezone.Set {
		tz, err := s.timezoneOf(ctx, p.UserID, in.Timezone.Value)
		if err != nil {
			return McpWriteResult{}, err
		}
		upd.Timezone = &tz
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	before, err := s.meeting(ctx, p, in.WorkspaceID, in.MeetingID)
	if err != nil {
		return McpWriteResult{}, err
	}
	after, err := s.ask.meetings.Update(ctx, p.UserID, before.ID, upd)
	if err != nil {
		return McpWriteResult{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	b, a := s.meetingOf(base, before), s.meetingOf(base, after)
	return McpWriteResult{Item: a, Revision: a.Revision, Changes: mcpChanges(
		McpChange{"title", before.Title, after.Title},
		McpChange{"description", before.Description, after.Description},
		McpChange{"starts_at", b.StartsAt, a.StartsAt},
		McpChange{"ends_at", b.EndsAt, a.EndsAt},
		McpChange{"timezone", b.Timezone, a.Timezone},
		McpChange{"project_id", b.ProjectID, a.ProjectID},
	)}, nil
}

type mcpInviteIn struct {
	WorkspaceID string   `json:"workspace_id"`
	MeetingID   string   `json:"meeting_id"`
	UserIDs     []string `json:"user_ids"`
}

// McpInviteOutcome is one person of an invite_to_meeting call.
type McpInviteOutcome struct {
	UserID string `json:"user_id"`
	Result string `json:"result"` // "invited" or the refusal
}

func (s *McpToolService) InviteToMeeting(ctx context.Context, p McpPrincipal, in mcpInviteIn) (McpWriteResult, error) {
	if len(in.UserIDs) == 0 || len(in.UserIDs) > 20 {
		return McpWriteResult{}, McpInvalidArgs{Msg: "user_ids must hold 1-20 user_id values from list_members"}
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	m, err := s.meeting(ctx, p, in.WorkspaceID, in.MeetingID)
	if err != nil {
		return McpWriteResult{}, err
	}
	outcomes := make([]McpInviteOutcome, 0, len(in.UserIDs))
	for _, id := range in.UserIDs {
		result := "invited"
		if _, err := s.ask.meetings.Invite(ctx, p.UserID, m.ID, id); err != nil {
			result = mcpMapError(err).Error()
		}
		outcomes = append(outcomes, McpInviteOutcome{UserID: id, Result: result})
	}
	after, err := s.ask.meetings.Get(ctx, p.UserID, m.ID)
	if err != nil {
		return McpWriteResult{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	item := s.meetingOf(base, after)
	if item.Attendees, err = s.attendees(ctx, p, m.ID); err != nil {
		return McpWriteResult{}, err
	}
	return McpWriteResult{Item: map[string]any{"meeting": item, "invites": outcomes}, Revision: item.Revision}, nil
}
```

Lỗi từng người (`mcpMapError(err).Error()`): `ErrNotFound` cho ra `not_found`; một người ngoài workspace cho ra câu validate của service. Chuỗi không chứa dữ liệu tổ chức khác vì `Invite` chỉ nhận thành viên workspace.

Schema và tool, thêm vào `mcpMeetingTools`:

```go
	mcpSchemaScheduleMeeting = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"title":{"type":"string","minLength":1,"maxLength":300},"description":{"type":"string"},"starts_at":{"type":"string","description":"ISO 8601 with offset, e.g. 2026-10-15T10:00:00+07:00"},"ends_at":{"type":"string","description":"ISO 8601 with offset, after starts_at"},"timezone":{"type":"string","description":"IANA zone; omit for the user's own"},"attendee_ids":{"type":"array","items":{"type":"string"},"maxItems":50,"description":"user_id values from list_members"},"project_id":{"type":"string"}},"required":["workspace_id","title","starts_at","ends_at"],"additionalProperties":false}`)
	mcpSchemaUpdateMeeting   = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"meeting_id":{"type":"string"},"revision":{"type":"integer"},"title":{"type":"string","minLength":1,"maxLength":300},"description":{"type":"string"},"starts_at":{"type":"string"},"ends_at":{"type":"string"},"timezone":{"type":"string"},"project_id":{"type":"string"}},"required":["workspace_id","meeting_id","revision"],"additionalProperties":false}`)
	mcpSchemaInvite          = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"meeting_id":{"type":"string"},"user_ids":{"type":"array","items":{"type":"string"},"minItems":1,"maxItems":20}},"required":["workspace_id","meeting_id","user_ids"],"additionalProperties":false}`)
```

```go
		mcpWriteTool("schedule_meeting", "Schedule meeting", "Schedules a meeting hosted by the user. Attendees get an in-app notification, so confirm the list with the user first. No email or calendar invite is sent and no room opens until it starts.", "cancel_meeting", false, mcpSchemaScheduleMeeting,
			func(ctx context.Context, p McpPrincipal, in mcpScheduleMeetingIn) (any, error) { return s.ScheduleMeeting(ctx, p, in) }),
		mcpWriteTool("update_meeting", "Update meeting", "Changes a meeting's title, description, time, timezone or project; only its host or a workspace admin may, and times cannot change once it started. Fails with revision_conflict if it changed since you read it.", "call update_meeting again with the from values in changes", true, mcpSchemaUpdateMeeting,
			func(ctx context.Context, p McpPrincipal, in mcpUpdateMeetingIn) (any, error) { return s.UpdateMeeting(ctx, p, in) }),
		mcpWriteTool("invite_to_meeting", "Invite to meeting", "Invites workspace members to a meeting; each gets an in-app notification, so confirm with the user first. Host or workspace admin only. Returns the outcome for each person.", "the host removes the person from the meeting in UniWork", false, mcpSchemaInvite,
			func(ctx context.Context, p McpPrincipal, in mcpInviteIn) (any, error) { return s.InviteToMeeting(ctx, p, in) }),
```

Catalogue thêm, sau `list_meetings`: `{"schedule_meeting", "Schedule meeting", ai.ToolWrite, false}`, `{"update_meeting", "Update meeting", ai.ToolWrite, true}`, `{"invite_to_meeting", "Invite to meeting", ai.ToolWrite, false}`.

- [ ] **Step 3: Chạy test, thấy qua**

Run: `cd server && go test ./internal/service/ -run 'TestMcp|TestMCP' -count=1`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/mcp_tools_meetings.go server/internal/service/mcp_tools_meetings_test.go server/internal/service/mcp_tools_test.go
git commit -m "feat(mcp): schedule_meeting, update_meeting, invite_to_meeting

Times must carry an offset; the zone defaults to the person's own. An
update names the revision it read. Inviting reports each person's
outcome, and both scheduling and inviting tell the model that attendees
are notified so it confirms first.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.4: `cancel_meeting`, `restore_meeting`

**Files:**
- Modify: `server/internal/service/mcp_tools_meetings.go`, `mcp_tools_meetings_test.go`, `mcp_tools_test.go`

**Interfaces:**
- Consumes: `CancelAt`, `Restore` (3.1), `mcpVersion` (3.3).
- Produces: tool `cancel_meeting` (destructive), `restore_meeting` (không destructive).

- [ ] **Step 1: Viết test hỏng**

```go
func TestMcpCancelAndRestoreMeeting(t *testing.T) {
	x := newMcpToolWorld(t)
	m := x.meeting(t, x.ua.ID, x.w.ID, "Giao ban", "")
	raw, err := callMcpTool(t, x.tools, x.p, "cancel_meeting", `{"workspace_id":"`+x.w.ID+`","meeting_id":"`+m.ID+`","revision":`+strconv.Itoa(int(m.Version))+`,"reason":"dời lịch"}`)
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	if item["status"] != "CANCELED" {
		t.Fatalf("cancel_meeting = %s", raw)
	}
	raw, err = callMcpTool(t, x.tools, x.p, "restore_meeting", `{"workspace_id":"`+x.w.ID+`","meeting_id":"`+m.ID+`","revision":`+strconv.FormatInt(res.Revision, 10)+`}`)
	if err != nil {
		t.Fatal(err)
	}
	if _, item = writeResult(t, raw); item["status"] != "SCHEDULED" {
		t.Fatalf("restore_meeting = %s", raw)
	}
	// Cancelling a meeting that is not scheduled reads as a state problem.
	_, err = callMcpTool(t, x.tools, x.p, "restore_meeting", `{"workspace_id":"`+x.w.ID+`","meeting_id":"`+m.ID+`","revision":`+strconv.FormatInt(res.Revision+1, 10)+`}`)
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "invalid_meeting_state" {
		t.Fatalf("restore a scheduled meeting: %v", err)
	}
}
```

Run: `cd server && go test ./internal/service/ -run TestMcpCancelAndRestoreMeeting -count=1`
Expected: FAIL.

- [ ] **Step 2: Viết code**

```go
type mcpMeetingStateIn struct {
	WorkspaceID string `json:"workspace_id"`
	MeetingID   string `json:"meeting_id"`
	Revision    *int64 `json:"revision"`
	Reason      string `json:"reason"`
}

// setMeetingState runs cancel or restore and returns the meeting after it.
func (s *McpToolService) setMeetingState(ctx context.Context, p McpPrincipal, in mcpMeetingStateIn, run func(m db.Meeting, version int32) error) (McpWriteResult, error) {
	version, err := mcpVersion(in.Revision)
	if err != nil {
		return McpWriteResult{}, err
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	before, err := s.meeting(ctx, p, in.WorkspaceID, in.MeetingID)
	if err != nil {
		return McpWriteResult{}, err
	}
	if err := run(before, version); err != nil {
		return McpWriteResult{}, err
	}
	after, err := s.ask.meetings.Get(ctx, p.UserID, before.ID)
	if err != nil {
		return McpWriteResult{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	return McpWriteResult{Item: s.meetingOf(base, after), Revision: int64(after.Version), Changes: mcpChanges(McpChange{"status", before.Status, after.Status})}, nil
}

func (s *McpToolService) CancelMeeting(ctx context.Context, p McpPrincipal, in mcpMeetingStateIn) (McpWriteResult, error) {
	return s.setMeetingState(ctx, p, in, func(m db.Meeting, version int32) error {
		return s.ask.meetings.CancelAt(ctx, p.UserID, m.ID, in.Reason, version)
	})
}

func (s *McpToolService) RestoreMeeting(ctx context.Context, p McpPrincipal, in mcpMeetingStateIn) (McpWriteResult, error) {
	return s.setMeetingState(ctx, p, in, func(m db.Meeting, version int32) error {
		_, err := s.ask.meetings.Restore(ctx, p.UserID, m.ID, &version)
		return err
	})
}
```

Schema và tool:

```go
	mcpSchemaCancelMeeting  = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"meeting_id":{"type":"string"},"revision":{"type":"integer"},"reason":{"type":"string","maxLength":500}},"required":["workspace_id","meeting_id","revision"],"additionalProperties":false}`)
	mcpSchemaRestoreMeeting = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"meeting_id":{"type":"string"},"revision":{"type":"integer"}},"required":["workspace_id","meeting_id","revision"],"additionalProperties":false}`)
```

```go
		mcpWriteTool("cancel_meeting", "Cancel meeting", "Cancels a scheduled meeting; only its host or a workspace admin may. Everyone sees it as cancelled. Fails with revision_conflict if it changed since you read it.", "restore_meeting, while the meeting's time is still ahead", true, mcpSchemaCancelMeeting,
			func(ctx context.Context, p McpPrincipal, in mcpMeetingStateIn) (any, error) { return s.CancelMeeting(ctx, p, in) }),
		mcpWriteTool("restore_meeting", "Restore meeting", "Brings a cancelled meeting back to scheduled while its time is still ahead; host or workspace admin only.", "cancel_meeting", false, mcpSchemaRestoreMeeting,
			func(ctx context.Context, p McpPrincipal, in mcpRestoreMeetingIn) (any, error) {
				return s.RestoreMeeting(ctx, p, mcpMeetingStateIn{WorkspaceID: in.WorkspaceID, MeetingID: in.MeetingID, Revision: in.Revision})
			}),
```

`restore_meeting` có struct đầu vào riêng, không có `reason`, để `decodeInto` từ chối một `reason` gửi kèm đúng như schema nói:

```go
type mcpRestoreMeetingIn struct {
	WorkspaceID string `json:"workspace_id"`
	MeetingID   string `json:"meeting_id"`
	Revision    *int64 `json:"revision"`
}
```

Catalogue thêm `{"cancel_meeting", "Cancel meeting", ai.ToolWrite, true}`, `{"restore_meeting", "Restore meeting", ai.ToolWrite, false}`.

- [ ] **Step 3: Chạy test, thấy qua**

Run: `cd server && go test ./internal/service/ -run 'TestMcp|TestMCP' -count=1 && go test ./internal/ -run TestMcpToolsCallNoDelete -count=1`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/mcp_tools_meetings.go server/internal/service/mcp_tools_meetings_test.go server/internal/service/mcp_tools_test.go
git commit -m "feat(mcp): cancel_meeting and restore_meeting

A model can cancel a scheduled meeting and bring it back while its time
is still ahead, both with the revision it read, both for the host or a
workspace admin only.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.5: Isolation, lời đồng ý, kiểm chứng Phase 3

- [ ] **Step 1: Isolation**

Trong `TestIsolationMCP`, `attacks` thêm:

```go
		{"list_meetings", map[string]string{"workspace_id": a.wsID, "from": "2000-01-01T00:00:00Z", "to": "2000-03-01T00:00:00Z"}},
```

`writeAttacks` thêm:

```go
		{"schedule_meeting", map[string]any{"workspace_id": a.wsID, "title": "iso", "starts_at": "2099-01-01T10:00:00Z", "ends_at": "2099-01-01T11:00:00Z"}},
		{"update_meeting", map[string]any{"workspace_id": a.wsID, "meeting_id": aMeeting, "revision": 1, "title": "iso"}},
		{"update_meeting", map[string]any{"workspace_id": b.wsID, "meeting_id": aMeeting, "revision": 1, "title": "iso"}},
		{"invite_to_meeting", map[string]any{"workspace_id": a.wsID, "meeting_id": aMeeting, "user_ids": []string{b.userID}}},
		{"cancel_meeting", map[string]any{"workspace_id": a.wsID, "meeting_id": aMeeting, "revision": 1}},
		{"cancel_meeting", map[string]any{"workspace_id": b.wsID, "meeting_id": aMeeting, "revision": 1}},
		{"restore_meeting", map[string]any{"workspace_id": b.wsID, "meeting_id": aMeeting, "revision": 1}},
		{"schedule_meeting", map[string]any{"workspace_id": b.wsID, "title": "iso", "starts_at": "2099-01-01T10:00:00Z", "ends_at": "2099-01-01T11:00:00Z", "project_id": aProject}},
```

Ca cuối (project của A khi tạo họp trong B): `requireMeetingProject` trả `ErrNotFound` (kiểm bằng cách chạy test); nếu nó trả lỗi validate khác, ghi rõ lý do và kiểm "bị từ chối, không rò" như ca `assignee_not_member` của Task 1.5.

`control`: A lên lịch một cuộc họp, sửa tiêu đề với revision của nó, hủy rồi khôi phục, tất cả qua grant của A; `get_meeting` control đã có.

Run: `cd server && go test ./internal/handler/ -run 'TestIsolationMCP|TestIsolationMatrix' -count=1`
Expected: PASS.

- [ ] **Step 2: Gate, thử tay, note**

Run: `make check`. Thử trên ba client: "đặt họp với Lan 10 giờ sáng mai" (giờ theo múi giờ người dùng), "dời cuộc họp đó sang 2 giờ chiều", "hủy cuộc họp đó", "à không, khôi phục lại".

```bash
git add server/internal/handler/isolation_mcp_test.go
git commit -m "test(mcp): isolation for the meeting tools

B's grant aimed at A's meetings, and at A's project for a new meeting,
is refused with the one not-found answer and leaves A's rows as they
were; A's own grant schedules, edits, cancels and restores as the
control.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
make issue-note KEY=<UNI-key Phase 3> MSG="[agent] Phase 3 xong: Restore + CancelAt + ExpectedVersion, nút Khôi phục, list_meetings, schedule/update/invite/cancel/restore_meeting, isolation. make check: <kết quả>. Thử tay: <kết quả>. Chưa push."
```

Dừng, hỏi người dùng trước khi `make issue-pr`.

---

# Phase 4 — Tài liệu và bộ chuyển Markdown

Sub-issue: `MCP v2 Phase 4: tool Tài liệu và bộ chuyển Markdown`. Bắt đầu khi PR Phase 3 đã merge.

Nguyên tắc của bộ chuyển: Markdown chỉ là cách trình bày cho model. `PageToMarkdown` tự kiểm khứ hồi (page → Markdown → page) và đặt `lossy` khi kết quả khác bản gốc; `update_document` chế độ `replace` từ chối mọi trang `lossy` hoặc bị cắt. Nhờ vậy một chỗ chưa khéo của bộ chuyển chỉ làm mất quyền `replace` của trang đó, không bao giờ làm mất nội dung.

### Task 4.1: `MarkdownToPage` (goldmark)

**Files:**
- Modify: `server/go.mod`, `server/go.sum` (thêm `github.com/yuin/goldmark`)
- Create: `server/internal/document/markdown.go`, `server/internal/document/markdown_test.go`

**Interfaces:**
- Produces:
  - `const MentionScheme = "uniwork://"`
  - `func MarkdownToPage(md string, assets map[string]bool) (json.RawMessage, error)` — kết quả đã qua `Sanitize`; ảnh chỉ giữ `asset://<id>` có trong `assets`, ảnh khác thành link.
  - `func AssetsOf(content json.RawMessage) map[string]bool`
  - `func AppendMarkdown(content json.RawMessage, md string) (json.RawMessage, error)`
  - (nội bộ) `type pmNode`, `type pmMark`, `func canonicalPage(content json.RawMessage) ([]byte, error)`, `func samePage(a, b json.RawMessage) bool`, `func mergeText([]pmNode) []pmNode`

- [ ] **Step 1: Thêm thư viện**

Run: `cd server && go get github.com/yuin/goldmark@latest && go mod tidy && grep goldmark go.mod`
Expected: một dòng `github.com/yuin/goldmark vX.Y.Z` (phiên bản cụ thể, đã ghim). `govulncheck` của CI kiểm nó.

- [ ] **Step 2: Viết test hỏng**

`server/internal/document/markdown_test.go`:

```go
package document

import (
	"encoding/json"
	"testing"
)

const testULID = "01J8X4ABCDEFGHJKMNPQRSTVWX"

func mustSame(t *testing.T, label string, got json.RawMessage, want string) {
	t.Helper()
	if !samePage(got, json.RawMessage(want)) {
		g, _ := canonicalPage(got)
		w, _ := canonicalPage(json.RawMessage(want))
		t.Errorf("%s:\n got %s\nwant %s", label, g, w)
	}
}

func TestMarkdownToPage(t *testing.T) {
	cases := []struct{ name, md, want string }{
		{"paragraph and marks", "**Gấp** và *nghiêng*, ~~gạch~~, `mã`, <u>gạch dưới</u>, [link](https://uniwork.vn)",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Gấp","marks":[{"type":"bold"}]},{"type":"text","text":" và "},{"type":"text","text":"nghiêng","marks":[{"type":"italic"}]},{"type":"text","text":", "},{"type":"text","text":"gạch","marks":[{"type":"strike"}]},{"type":"text","text":", "},{"type":"text","text":"mã","marks":[{"type":"code"}]},{"type":"text","text":", "},{"type":"text","text":"gạch dưới","marks":[{"type":"underline"}]},{"type":"text","text":", "},{"type":"text","text":"link","marks":[{"type":"link","attrs":{"href":"https://uniwork.vn"}}]}]}]}`},
		{"headings clamp at 3", "# Một\n\n#### Bốn",
			`{"type":"doc","content":[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Một"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Bốn"}]}]}`},
		{"lists", "- a\n  - b\n\n3. c\n4. d",
			`{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"b"}]}]}]}]}]},{"type":"orderedList","attrs":{"start":3},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"c"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"d"}]}]}]}]}`},
		{"task list", "- [x] xong\n- [ ] chưa",
			`{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"xong"}]}]},{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"chưa"}]}]}]}]}`},
		{"quote, code, rule", "> trích\n\n```go\nx := 1\n```\n\n---",
			`{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"trích"}]}]},{"type":"codeBlock","attrs":{"language":"go"},"content":[{"type":"text","text":"x := 1"}]},{"type":"horizontalRule"}]}`},
		{"mentions", "[@Lan](uniwork://user/" + testULID + ") xem [Báo cáo](uniwork://document/" + testULID + ")",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"mention","attrs":{"kind":"user","id":"` + testULID + `","label":"Lan"}},{"type":"text","text":" xem "},{"type":"mention","attrs":{"kind":"document","id":"` + testULID + `","label":"Báo cáo"}}]}]}`},
		{"table", "| A | B |\n| --- | --- |\n| 1 | 2 |",
			`{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"A"}]}]},{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"B"}]}]}]},{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"1"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"2"}]}]}]}]}]}`},
		{"escapes and hard break", `Giá \*50%\* \[mới\]\` + "\nA_B",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Giá *50%* [mới]"},{"type":"hardBreak"},{"type":"text","text":"A_B"}]}]}`},
		{"html is text", "<script>alert(1)</script>",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"<script>alert(1)</script>"}]}]}`},
		{"unsafe link keeps its text", "[bấm](javascript:alert(1))",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"bấm"}]}]}`},
		{"empty", "", `{"type":"doc","content":[{"type":"paragraph"}]}`},
	}
	for _, c := range cases {
		got, err := MarkdownToPage(c.md, nil)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		mustSame(t, c.name, got, c.want)
	}
}

// An image survives only as an asset the page already holds; any other image
// becomes a link, so Markdown can never pull a remote picture into a page.
func TestMarkdownToPageImages(t *testing.T) {
	md := "![sơ đồ](asset://" + testULID + ") ![ngoài](https://evil.test/x.png)"
	got, err := MarkdownToPage(md, map[string]bool{testULID: true})
	if err != nil {
		t.Fatal(err)
	}
	mustSame(t, "images", got, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://`+testULID+`","alt":"sơ đồ"}},{"type":"text","text":" "},{"type":"text","text":"ngoài","marks":[{"type":"link","attrs":{"href":"https://evil.test/x.png"}}]}]}]}`)
	got, _ = MarkdownToPage(md, nil)
	if string(got) == "" || samePage(got, json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://`+testULID+`"}}]}]}`)) {
		t.Fatal("an asset the page does not hold became an image")
	}
}

func TestAppendMarkdownKeepsThePage(t *testing.T) {
	page := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Đầu"}]},{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://` + testULID + `"}}]}]}`)
	got, err := AppendMarkdown(page, "## Rủi ro\n\n![lại](asset://"+testULID+")")
	if err != nil {
		t.Fatal(err)
	}
	mustSame(t, "append", got, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Đầu"}]},{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://`+testULID+`"}}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Rủi ro"}]},{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://`+testULID+`","alt":"lại"}}]}]}`)
}
```

`testULID` phải đúng bảng chữ Crockford (`isULID`): kiểm bằng `isULID(testULID)` nếu test mentions không qua.

Run: `cd server && go test ./internal/document/ -run 'TestMarkdownToPage|TestAppendMarkdown' -count=1`
Expected: FAIL, `undefined: MarkdownToPage`.

- [ ] **Step 3: Viết code**

`server/internal/document/markdown.go`:

```go
package document

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	east "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// Markdown is how the MCP connector shows a page to an AI app and reads one
// back (ADR 0033). It is a view, never storage: what is stored is always the
// page JSON Sanitize produces.

// MentionScheme is the link a mention takes in Markdown:
// [@Lan](uniwork://user/<id>), [Báo cáo](uniwork://document/<id>).
const MentionScheme = "uniwork://"

type pmNode struct {
	Type    string         `json:"type"`
	Attrs   map[string]any `json:"attrs,omitempty"`
	Content []pmNode       `json:"content,omitempty"`
	Text    string         `json:"text,omitempty"`
	Marks   []pmMark       `json:"marks,omitempty"`
}

type pmMark struct {
	Type  string         `json:"type"`
	Attrs map[string]any `json:"attrs,omitempty"`
}

var mdParser = goldmark.New(goldmark.WithExtensions(extension.Table, extension.Strikethrough, extension.TaskList)).Parser()

// MarkdownToPage parses Markdown into page JSON of the closed schema and
// sanitizes it. assets are the asset ids the page may show as images (those
// it already holds); any other image becomes a link.
func MarkdownToPage(md string, assets map[string]bool) (json.RawMessage, error) {
	src := []byte(md)
	r := &mdReader{src: src, assets: assets}
	doc := pmNode{Type: "doc", Content: r.blocks(mdParser.Parse(text.NewReader(src)))}
	if len(doc.Content) == 0 {
		doc.Content = []pmNode{{Type: "paragraph"}}
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	content, _, err := Sanitize(raw)
	return content, err
}

// AssetsOf lists the asset ids a page shows as images.
func AssetsOf(content json.RawMessage) map[string]bool {
	out := map[string]bool{}
	var doc pmNode
	if json.Unmarshal(content, &doc) != nil {
		return out
	}
	var walk func(n pmNode)
	walk = func(n pmNode) {
		if n.Type == "image" {
			if src, _ := n.Attrs["src"].(string); strings.HasPrefix(src, "asset://") {
				out[strings.TrimPrefix(src, "asset://")] = true
			}
		}
		for _, c := range n.Content {
			walk(c)
		}
	}
	walk(doc)
	return out
}

// AppendMarkdown adds the blocks of md after the page's own.
func AppendMarkdown(content json.RawMessage, md string) (json.RawMessage, error) {
	doc := pmNode{Type: "doc"}
	if len(content) > 0 {
		if err := json.Unmarshal(content, &doc); err != nil {
			return nil, fmt.Errorf("document: page content: %w", err)
		}
	}
	added, err := MarkdownToPage(md, AssetsOf(content))
	if err != nil {
		return nil, err
	}
	var more pmNode
	if err := json.Unmarshal(added, &more); err != nil {
		return nil, err
	}
	doc.Type = "doc"
	doc.Content = append(doc.Content, more.Content...)
	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	clean, _, err := Sanitize(raw)
	return clean, err
}

type mdReader struct {
	src    []byte
	assets map[string]bool
}

func (r *mdReader) blocks(parent ast.Node) []pmNode {
	out := []pmNode{}
	for n := parent.FirstChild(); n != nil; n = n.NextSibling() {
		out = append(out, r.block(n)...)
	}
	return out
}

func textNodes(s string, marks []pmMark) []pmNode {
	if s == "" {
		return nil
	}
	var m []pmMark
	if len(marks) > 0 {
		m = append(m, marks...)
	}
	return []pmNode{{Type: "text", Text: s, Marks: m}}
}

func withMark(marks []pmMark, m pmMark) []pmMark {
	out := make([]pmMark, 0, len(marks)+1)
	return append(append(out, marks...), m)
}

// lines is the raw text of a block whose lines are code or HTML.
func (r *mdReader) lines(n ast.Node) string {
	var b strings.Builder
	l := n.Lines()
	for i := 0; i < l.Len(); i++ {
		seg := l.At(i)
		b.Write(seg.Value(r.src))
	}
	return strings.TrimSuffix(b.String(), "\n")
}

func (r *mdReader) block(n ast.Node) []pmNode {
	switch v := n.(type) {
	case *ast.Paragraph, *ast.TextBlock:
		return []pmNode{{Type: "paragraph", Content: r.inlines(n, nil)}}
	case *ast.Heading:
		level := min(v.Level, 3)
		return []pmNode{{Type: "heading", Attrs: map[string]any{"level": level}, Content: r.inlines(n, nil)}}
	case *ast.List:
		return []pmNode{r.list(v)}
	case *ast.Blockquote:
		return []pmNode{{Type: "blockquote", Content: r.blocks(n)}}
	case *ast.FencedCodeBlock:
		node := pmNode{Type: "codeBlock", Content: textNodes(r.lines(n), nil)}
		if lang := string(v.Language(r.src)); lang != "" {
			node.Attrs = map[string]any{"language": lang}
		}
		return []pmNode{node}
	case *ast.CodeBlock:
		return []pmNode{{Type: "codeBlock", Content: textNodes(r.lines(n), nil)}}
	case *ast.ThematicBreak:
		return []pmNode{{Type: "horizontalRule"}}
	case *east.Table:
		return []pmNode{r.table(v)}
	case *ast.HTMLBlock:
		// Raw HTML is not part of the schema: it stays, as the text it is.
		return []pmNode{{Type: "paragraph", Content: textNodes(r.lines(n), nil)}}
	default:
		return r.blocks(n)
	}
}

func checkBox(item ast.Node) *east.TaskCheckBox {
	first := item.FirstChild()
	if first == nil {
		return nil
	}
	cb, _ := first.FirstChild().(*east.TaskCheckBox)
	return cb
}

func (r *mdReader) list(v *ast.List) pmNode {
	task := v.FirstChild() != nil
	for item := v.FirstChild(); item != nil; item = item.NextSibling() {
		task = task && checkBox(item) != nil
	}
	node := pmNode{Type: "bulletList"}
	switch {
	case task:
		node.Type = "taskList"
	case v.IsOrdered():
		node.Type = "orderedList"
		if v.Start != 1 {
			node.Attrs = map[string]any{"start": v.Start}
		}
	}
	for item := v.FirstChild(); item != nil; item = item.NextSibling() {
		li := pmNode{Type: "listItem", Content: r.blocks(item)}
		if task {
			li.Type = "taskItem"
			li.Attrs = map[string]any{"checked": checkBox(item).IsChecked}
		}
		if len(li.Content) == 0 {
			li.Content = []pmNode{{Type: "paragraph"}}
		}
		node.Content = append(node.Content, li)
	}
	return node
}

func (r *mdReader) table(t *east.Table) pmNode {
	node := pmNode{Type: "table"}
	for row := t.FirstChild(); row != nil; row = row.NextSibling() {
		cellType := "tableCell"
		_, header := row.(*east.TableHeader)
		if header {
			cellType = "tableHeader"
		}
		tr := pmNode{Type: "tableRow"}
		empty := true
		for cell := row.FirstChild(); cell != nil; cell = cell.NextSibling() {
			inl := r.inlines(cell, nil)
			empty = empty && len(inl) == 0
			tr.Content = append(tr.Content, pmNode{Type: cellType, Content: []pmNode{{Type: "paragraph", Content: inl}}})
		}
		// PageToMarkdown writes an empty header row for a table that has none.
		if header && empty {
			continue
		}
		node.Content = append(node.Content, tr)
	}
	return node
}

func unescape(b []byte) string {
	b = util.UnescapePunctuations(b)
	b = util.ResolveNumericReferences(b)
	return string(util.ResolveEntityNames(b))
}

// plain is the text under n, for a link label or an image's alt.
func (r *mdReader) plain(n ast.Node) string {
	var b strings.Builder
	for c := n.FirstChild(); c != nil; c = c.NextSibling() {
		switch v := c.(type) {
		case *ast.Text:
			b.WriteString(unescape(v.Segment.Value(r.src)))
		case *ast.String:
			b.Write(v.Value)
		default:
			b.WriteString(r.plain(c))
		}
	}
	return b.String()
}

func (r *mdReader) rawHTML(v *ast.RawHTML) string {
	var b strings.Builder
	for i := 0; i < v.Segments.Len(); i++ {
		seg := v.Segments.At(i)
		b.Write(seg.Value(r.src))
	}
	return b.String()
}

func (r *mdReader) inlines(parent ast.Node, marks []pmMark) []pmNode {
	out := []pmNode{}
	under := false
	for n := parent.FirstChild(); n != nil; n = n.NextSibling() {
		if h, ok := n.(*ast.RawHTML); ok {
			// <u> is the one tag the page schema has (underline); any other
			// tag is kept as its text.
			switch tag := r.rawHTML(h); strings.ToLower(tag) {
			case "<u>":
				under = true
			case "</u>":
				under = false
			default:
				out = append(out, textNodes(tag, marks)...)
			}
			continue
		}
		m := marks
		if under {
			m = withMark(marks, pmMark{Type: "underline"})
		}
		out = append(out, r.inline(n, m)...)
	}
	return mergeText(out)
}

func mentionOf(dest, label string) (pmNode, bool) {
	rest, ok := strings.CutPrefix(dest, MentionScheme)
	if !ok {
		return pmNode{}, false
	}
	kind, id, ok := strings.Cut(rest, "/")
	if !ok || !isMentionKind(kind) || !isULID(id) {
		return pmNode{}, false
	}
	if kind == "user" {
		label = strings.TrimPrefix(label, "@")
	}
	attrs := map[string]any{"kind": kind, "id": id}
	if label != "" {
		attrs["label"] = label
	}
	return pmNode{Type: "mention", Attrs: attrs}, true
}

func (r *mdReader) inline(n ast.Node, marks []pmMark) []pmNode {
	switch v := n.(type) {
	case *ast.Text:
		out := textNodes(unescape(v.Segment.Value(r.src)), marks)
		switch {
		case v.HardLineBreak():
			out = append(out, pmNode{Type: "hardBreak"})
		case v.SoftLineBreak():
			out = append(out, textNodes(" ", marks)...)
		}
		return out
	case *ast.String:
		return textNodes(string(v.Value), marks)
	case *ast.CodeSpan:
		var b strings.Builder
		for c := v.FirstChild(); c != nil; c = c.NextSibling() {
			if t, ok := c.(*ast.Text); ok {
				b.Write(t.Segment.Value(r.src))
			}
		}
		return textNodes(b.String(), withMark(marks, pmMark{Type: "code"}))
	case *ast.Emphasis:
		m := "italic"
		if v.Level == 2 {
			m = "bold"
		}
		return r.inlines(v, withMark(marks, pmMark{Type: m}))
	case *east.Strikethrough:
		return r.inlines(v, withMark(marks, pmMark{Type: "strike"}))
	case *ast.Link:
		dest := unescape(v.Destination)
		if mention, ok := mentionOf(dest, r.plain(v)); ok {
			return []pmNode{mention}
		}
		return r.inlines(v, withMark(marks, pmMark{Type: "link", Attrs: map[string]any{"href": dest}}))
	case *ast.AutoLink:
		return textNodes(string(v.Label(r.src)), withMark(marks, pmMark{Type: "link", Attrs: map[string]any{"href": string(v.URL(r.src))}}))
	case *ast.Image:
		dest, alt := unescape(v.Destination), r.plain(v)
		if id, ok := strings.CutPrefix(dest, "asset://"); ok && r.assets[id] {
			attrs := map[string]any{"src": dest}
			if alt != "" {
				attrs["alt"] = alt
			}
			return []pmNode{{Type: "image", Attrs: attrs}}
		}
		return textNodes(alt, withMark(marks, pmMark{Type: "link", Attrs: map[string]any{"href": dest}}))
	case *east.TaskCheckBox:
		return nil
	default:
		return r.inlines(n, marks)
	}
}

func sortedMarks(ms []pmMark) []pmMark {
	out := append([]pmMark(nil), ms...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].Type < out[j].Type })
	return out
}

func sameMarks(a, b []pmMark) bool {
	ja, _ := json.Marshal(sortedMarks(a))
	jb, _ := json.Marshal(sortedMarks(b))
	return bytes.Equal(ja, jb)
}

// mergeText joins adjacent runs of text that carry the same marks and drops
// empty ones, as the editor stores them.
func mergeText(nodes []pmNode) []pmNode {
	out := make([]pmNode, 0, len(nodes))
	for _, n := range nodes {
		if n.Type == "text" && n.Text == "" {
			continue
		}
		if last := len(out) - 1; last >= 0 && n.Type == "text" && out[last].Type == "text" && sameMarks(out[last].Marks, n.Marks) {
			out[last].Text += n.Text
			continue
		}
		out = append(out, n)
	}
	return out
}

// canonicalPage is a page in one spelling: sanitized, marks sorted, text
// runs merged, attrs holding their default dropped. Two pages that read the
// same canonicalize to the same bytes.
func canonicalPage(content json.RawMessage) ([]byte, error) {
	clean, _, err := Sanitize(content)
	if err != nil {
		return nil, err
	}
	var doc pmNode
	if err := json.Unmarshal(clean, &doc); err != nil {
		return nil, err
	}
	canonicalNode(&doc)
	return json.Marshal(doc)
}

func canonicalNode(n *pmNode) {
	for k, v := range n.Attrs {
		if v == nil || v == "" || v == false || (n.Type == "orderedList" && k == "start" && v == float64(1)) {
			delete(n.Attrs, k)
		}
	}
	if len(n.Attrs) == 0 {
		n.Attrs = nil
	}
	n.Marks = sortedMarks(n.Marks)
	if len(n.Marks) == 0 {
		n.Marks = nil
	}
	for i := range n.Content {
		canonicalNode(&n.Content[i])
	}
	n.Content = mergeText(n.Content)
	if len(n.Content) == 0 {
		n.Content = nil
	}
}

func samePage(a, b json.RawMessage) bool {
	ca, err := canonicalPage(a)
	if err != nil {
		return false
	}
	cb, err := canonicalPage(b)
	return err == nil && bytes.Equal(ca, cb)
}
```

Nếu một ca `TestMarkdownToPage` hỏng vì goldmark trả cây khác giả định (ví dụ `Text` đã bỏ dấu `\` trước khi tới đây, hay `Destination` đã được unescape), đọc `$(go env GOMODCACHE)/github.com/yuin/goldmark@<ver>/ast/inline.go` và sửa code đọc cây cho đúng; không sửa kỳ vọng của test, trừ khi kỳ vọng sai theo CommonMark.

- [ ] **Step 4: Chạy test, thấy qua**

Run: `cd server && go test ./internal/document/ -count=1 && go vet ./internal/document/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/go.mod server/go.sum server/internal/document/markdown.go server/internal/document/markdown_test.go
git commit -m "feat(documents): read Markdown into page JSON

MarkdownToPage parses CommonMark with GFM tables, strikethrough and task
lists into the closed page schema and sanitizes it. Mentions travel as
uniwork:// links; <u> is the only tag kept, other HTML stays as text; an
image survives only as an asset the page already holds. AppendMarkdown
adds blocks after a page's own. The MCP document tools need both (ADR
0033).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.2: `PageToMarkdown` và cờ `lossy`

**Files:**
- Modify: `server/internal/document/markdown.go`, `markdown_test.go`

**Interfaces:**
- Consumes: `MarkdownToPage`, `AssetsOf`, `samePage` (4.1).
- Produces: `func PageToMarkdown(content json.RawMessage) (md string, lossy bool, err error)` — `lossy` khi `MarkdownToPage(md)` không cho lại đúng trang.

- [ ] **Step 1: Viết test hỏng**

Thêm vào `markdown_test.go`:

```go
func TestPageToMarkdown(t *testing.T) {
	cases := []struct{ name, page, want string }{
		{"marks", `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Gấp","marks":[{"type":"bold"}]},{"type":"text","text":" và "},{"type":"text","text":"dưới","marks":[{"type":"underline"}]}]}]}`,
			"**Gấp** và <u>dưới</u>"},
		{"heading and list", `{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Việc"}]},{"type":"orderedList","attrs":{"start":3},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]}]}]}]}`,
			"## Việc\n\n3. a"},
		{"task list", `{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"xong"}]}]}]}]}`,
			"- [x] xong"},
		{"mention", `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"mention","attrs":{"kind":"user","id":"` + testULID + `","label":"Lan"}}]}]}`,
			"[@Lan](uniwork://user/" + testULID + ")"},
		{"code with a fence inside", "{\"type\":\"doc\",\"content\":[{\"type\":\"codeBlock\",\"content\":[{\"type\":\"text\",\"text\":\"a\\n```\\nb\"}]}]}",
			"````\na\n```\nb\n````"},
	}
	for _, c := range cases {
		md, lossy, err := PageToMarkdown(json.RawMessage(c.page))
		if err != nil || md != c.want || lossy {
			t.Errorf("%s: md %q lossy %v err %v, want %q", c.name, md, lossy, err, c.want)
		}
	}
}

// Review Focus 3: text people typed, with Markdown's own symbols, Vietnamese
// and emoji, comes back word for word.
func TestPageToMarkdownRoundTripsTypedSymbols(t *testing.T) {
	text := "Giá *khuyến mãi* 50% [mới] | A_B #1 ~ <tag> & `x` 😀 Tiếng Việt có dấu"
	page := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":` + strconvQuote(text) + `}]},{"type":"paragraph","content":[{"type":"text","text":"- không phải danh sách"}]},{"type":"paragraph","content":[{"type":"text","text":"1. cũng không"}]}]}`)
	md, lossy, err := PageToMarkdown(page)
	if err != nil || lossy {
		t.Fatalf("lossy %v err %v for %q", lossy, err, md)
	}
	back, err := MarkdownToPage(md, nil)
	if err != nil || !samePage(back, page) {
		t.Fatalf("round trip changed the page:\n%s", md)
	}
}

func TestPageToMarkdownRoundTripsEveryNode(t *testing.T) {
	page := json.RawMessage(`{"type":"doc","content":[
		{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Kế hoạch"}]},
		{"type":"paragraph","content":[{"type":"text","text":"đậm","marks":[{"type":"bold"}]},{"type":"text","text":" "},{"type":"text","text":"nghiêng","marks":[{"type":"italic"}]},{"type":"text","text":" "},{"type":"text","text":"gạch","marks":[{"type":"strike"}]},{"type":"text","text":" "},{"type":"text","text":"mã","marks":[{"type":"code"}]},{"type":"text","text":" "},{"type":"text","text":"link","marks":[{"type":"link","attrs":{"href":"https://uniwork.vn/a"}}]},{"type":"hardBreak"},{"type":"text","text":"dòng hai"}]},
		{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"b"}]}]}]}]}]},
		{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"trích"}]}]},
		{"type":"codeBlock","attrs":{"language":"sql"},"content":[{"type":"text","text":"SELECT 1;"}]},
		{"type":"horizontalRule"},
		{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://` + testULID + `","alt":"sơ đồ"}}]},
		{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"không tiêu đề"}]}]}]}]}
	]}`)
	md, lossy, err := PageToMarkdown(page)
	if err != nil || lossy {
		t.Fatalf("lossy %v err %v:\n%s", lossy, err, md)
	}
}

// A table cell with two paragraphs has no Markdown spelling: the page is
// lossy, so it is never written back over itself.
func TestPageToMarkdownMarksALossyPage(t *testing.T) {
	page := json.RawMessage(`{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]},{"type":"paragraph","content":[{"type":"text","text":"b"}]}]}]}]}]}`)
	if _, lossy, err := PageToMarkdown(page); err != nil || !lossy {
		t.Fatalf("lossy = %v, err %v; want lossy", lossy, err)
	}
}

func strconvQuote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
```

Run: `cd server && go test ./internal/document/ -run TestPageToMarkdown -count=1`
Expected: FAIL, `undefined: PageToMarkdown`.

- [ ] **Step 2: Viết code**

Thêm vào `markdown.go` (import `regexp`, `strconv`):

```go
// PageToMarkdown renders a page as Markdown for an AI app. lossy is true
// when reading that Markdown back would not give the same page (a table cell
// of several blocks, a span Markdown cannot spell): the caller must then
// never write the Markdown back over the page.
func PageToMarkdown(content json.RawMessage) (string, bool, error) {
	if len(content) == 0 {
		return "", false, nil
	}
	var doc pmNode
	if err := json.Unmarshal(content, &doc); err != nil {
		return "", false, fmt.Errorf("document: page content: %w", err)
	}
	md := strings.TrimRight((&mdWriter{}).blocks(doc.Content), "\n")
	back, err := MarkdownToPage(md, AssetsOf(content))
	return md, err != nil || !samePage(back, content), nil
}

type mdWriter struct{}

func (w *mdWriter) blocks(nodes []pmNode) string {
	parts := make([]string, 0, len(nodes))
	for _, n := range nodes {
		parts = append(parts, w.block(n))
	}
	return strings.Join(parts, "\n\n")
}

func intAttr(attrs map[string]any, key string, def int) int {
	if f, ok := attrs[key].(float64); ok {
		return int(f)
	}
	return def
}

func stringAttr(attrs map[string]any, key string) string {
	s, _ := attrs[key].(string)
	return s
}

func (w *mdWriter) block(n pmNode) string {
	switch n.Type {
	case "paragraph":
		return escapeLineStarts(w.inline(n.Content))
	case "heading":
		return strings.Repeat("#", intAttr(n.Attrs, "level", 1)) + " " + w.inline(n.Content)
	case "bulletList":
		return w.list(n.Content, func(int, pmNode) string { return "- " })
	case "orderedList":
		start := intAttr(n.Attrs, "start", 1)
		return w.list(n.Content, func(i int, _ pmNode) string { return strconv.Itoa(start+i) + ". " })
	case "taskList":
		return w.list(n.Content, func(_ int, item pmNode) string {
			if checked, _ := item.Attrs["checked"].(bool); checked {
				return "- [x] "
			}
			return "- [ ] "
		})
	case "blockquote":
		return prefixLines(w.blocks(n.Content), "> ")
	case "codeBlock":
		var b strings.Builder
		for _, c := range n.Content {
			b.WriteString(c.Text)
		}
		code := b.String()
		fence := "```"
		for strings.Contains(code, fence) {
			fence += "`"
		}
		return fence + stringAttr(n.Attrs, "language") + "\n" + code + "\n" + fence
	case "horizontalRule":
		return "---"
	case "table":
		return w.table(n)
	default:
		return w.inline([]pmNode{n})
	}
}

func (w *mdWriter) list(items []pmNode, marker func(int, pmNode) string) string {
	lines := make([]string, 0, len(items))
	for i, item := range items {
		m := marker(i, item)
		lines = append(lines, m+indentRest(w.blocks(item.Content), len(m)))
	}
	return strings.Join(lines, "\n")
}

func indentRest(s string, n int) string {
	pad := strings.Repeat(" ", n)
	ls := strings.Split(s, "\n")
	for i := 1; i < len(ls); i++ {
		if ls[i] != "" {
			ls[i] = pad + ls[i]
		}
	}
	return strings.Join(ls, "\n")
}

func prefixLines(s, prefix string) string {
	ls := strings.Split(s, "\n")
	for i, l := range ls {
		ls[i] = strings.TrimRight(prefix+l, " ")
	}
	return strings.Join(ls, "\n")
}

// table writes GFM. A table whose first row is not a header gets an empty
// header row, which MarkdownToPage drops again.
func (w *mdWriter) table(n pmNode) string {
	if len(n.Content) == 0 {
		return ""
	}
	cols := len(n.Content[0].Content)
	row := func(r pmNode) string {
		cells := make([]string, 0, len(r.Content))
		for _, c := range r.Content {
			parts := make([]string, 0, len(c.Content))
			for _, b := range c.Content {
				parts = append(parts, w.inline(b.Content))
			}
			cells = append(cells, strings.Join(parts, " "))
		}
		return "| " + strings.Join(cells, " | ") + " |"
	}
	rows := n.Content
	var head string
	if len(rows[0].Content) > 0 && rows[0].Content[0].Type == "tableHeader" {
		head, rows = row(rows[0]), rows[1:]
	} else {
		head = "|" + strings.Repeat("  |", cols)
	}
	lines := []string{head, "|" + strings.Repeat(" --- |", cols)}
	for _, r := range rows {
		lines = append(lines, row(r))
	}
	return strings.Join(lines, "\n")
}

func (w *mdWriter) inline(nodes []pmNode) string {
	var b strings.Builder
	for _, n := range nodes {
		switch n.Type {
		case "text":
			b.WriteString(marked(n.Text, n.Marks))
		case "hardBreak":
			b.WriteString("\\\n")
		case "mention":
			kind, label := stringAttr(n.Attrs, "kind"), stringAttr(n.Attrs, "label")
			if kind == "user" {
				label = "@" + label
			}
			b.WriteString("[" + escapeText(label) + "](" + MentionScheme + kind + "/" + stringAttr(n.Attrs, "id") + ")")
		case "image":
			b.WriteString("![" + escapeText(stringAttr(n.Attrs, "alt")) + "](" + stringAttr(n.Attrs, "src") + ")")
		}
	}
	return b.String()
}

var mdEscaper = strings.NewReplacer(
	`\`, `\\`, "`", "\\`", "*", `\*`, "_", `\_`, "[", `\[`, "]", `\]`, "<", `\<`, ">", `\>`,
	"|", `\|`, "~", `\~`, "!", `\!`, "#", `\#`, "&", `\&`,
)

func escapeText(s string) string { return mdEscaper.Replace(s) }

var lineStartMarker = regexp.MustCompile(`(?m)^(\s*)([-+]|\d+[.)])(\s|$)`)

// escapeLineStarts keeps a paragraph line from reading as a list item.
func escapeLineStarts(s string) string {
	return lineStartMarker.ReplaceAllStringFunc(s, func(m string) string {
		sub := lineStartMarker.FindStringSubmatch(m)
		marker := sub[2]
		if marker == "-" || marker == "+" {
			return sub[1] + `\` + marker + sub[3]
		}
		return sub[1] + marker[:len(marker)-1] + `\` + marker[len(marker)-1:] + sub[3]
	})
}

func codeSpan(s string) string {
	ticks := "`"
	for strings.Contains(s, ticks) {
		ticks += "`"
	}
	if strings.HasPrefix(s, "`") || strings.HasSuffix(s, "`") {
		return ticks + " " + s + " " + ticks
	}
	return ticks + s + ticks
}

// marked writes one run of text with its marks. Emphasis cannot open or
// close next to a space (CommonMark flanking), so edge spaces go outside.
func marked(text string, marks []pmMark) string {
	core := strings.TrimSpace(text)
	if core == "" || len(marks) == 0 {
		return escapeText(text)
	}
	lead := text[:strings.Index(text, core)]
	trail := text[len(lead)+len(core):]
	has := func(t string) bool {
		for _, m := range marks {
			if m.Type == t {
				return true
			}
		}
		return false
	}
	s := escapeText(core)
	if has("code") {
		s = codeSpan(core)
	}
	if has("strike") {
		s = "~~" + s + "~~"
	}
	if has("italic") {
		s = "*" + s + "*"
	}
	if has("bold") {
		s = "**" + s + "**"
	}
	if has("underline") {
		s = "<u>" + s + "</u>"
	}
	for _, m := range marks {
		if m.Type == "link" {
			href := stringAttr(m.Attrs, "href")
			if strings.ContainsAny(href, " ()") {
				href = "<" + href + ">"
			}
			s = "[" + s + "](" + href + ")"
		}
	}
	return escapeText(lead) + s + escapeText(trail)
}
```

`escapeLineStarts` chạy sau khi chuỗi đã escape, nên dấu `-` đầu dòng chưa bị escape lần nào. Ký tự `#` đã luôn được escape bởi `mdEscaper`, nên tiêu đề giả không thể xuất hiện.

- [ ] **Step 3: Chạy test, thấy qua**

Run: `cd server && go test ./internal/document/ -count=1`
Expected: PASS. Ca nào khứ hồi hỏng mà lỗi nằm ở cách viết (`mdWriter`) thì sửa cách viết; nếu một ca không thể khứ hồi (Markdown không biểu diễn được), chuyển nó sang `TestPageToMarkdownMarksALossyPage` và ghi lý do trong comment của ca, không bao giờ bỏ kiểm `samePage`.

- [ ] **Step 4: Commit**

```bash
git add server/internal/document/markdown.go server/internal/document/markdown_test.go
git commit -m "feat(documents): render a page as Markdown and flag what cannot return

PageToMarkdown writes CommonMark with GFM tables and task lists, escaping
what people typed so it reads back word for word. It then reads its own
Markdown back and reports the page as lossy when the result differs, so
the MCP connector never writes a lossy rendering over a page.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.3: Nối DocumentService; `search` mở rộng, `list_documents`, `get_document`

**Files:**
- Create: `server/internal/service/mcp_tools_documents.go`, `mcp_tools_documents_test.go`
- Modify: `server/internal/service/mcp_tools.go` (trường `docs`, `SetDocuments`, `Search`, `McpTools`), `mcp_tools_test.go` (catalogue, `mcpReadInputs`, `TestMcpSearchReadsTasksAndMeetingsOnly`)
- Modify: `server/cmd/server/main.go:556`, `server/internal/handler/mcp_oauth_test.go:46`, `server/internal/handler/isolation_world_test.go:174`

**Interfaces:**
- Consumes: `document.PageToMarkdown` (4.2), `mcpReadTool` (0.6).
- Produces:
  - `func (s *McpToolService) SetDocuments(d *DocumentService)`
  - `type McpDocument struct{ McpItem; DocKind string \`json:"doc_kind"\`; Revision int64 \`json:"revision"\`; ParentID string \`json:"parent_id,omitempty"\`; Content string \`json:"content,omitempty"\`; Format string \`json:"format,omitempty"\`; Lossy bool \`json:"lossy,omitempty"\`; Truncated bool \`json:"truncated,omitempty"\`; Filename string \`json:"filename,omitempty"\`; MimeType string \`json:"mime_type,omitempty"\` }`
  - `func (s *McpToolService) document(ctx context.Context, p McpPrincipal, workspaceID, documentID string) (DocumentView, error)`
  - `func (s *McpToolService) docOf(base string, d db.Document) McpDocument`
  - `type McpDocumentPage struct{ Items []McpDocument \`json:"items"\`; NextCursor string \`json:"next_cursor,omitempty"\` }`
  - `func mcpTextFile(mime, filename string) bool`
  - `func mcpDocumentTools(s *McpToolService) []ai.Tool`

- [ ] **Step 1: Viết test hỏng**

`server/internal/service/mcp_tools_documents_test.go`:

```go
package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// withDocs wires a DocumentService into the world and creates one page.
func (x *mcpToolWorld) withDocs(t *testing.T, title, content string) (*DocumentService, DocumentView) {
	t.Helper()
	docs := NewDocumentService(x.tools.ask.pool, x.tools.q, x.tools.ask.orgs, x.tools.ws)
	x.tools.SetDocuments(docs)
	v, err := docs.CreatePage(context.Background(), Human(x.ua.ID), x.w.ID, CreatePageInput{Title: title, Content: json.RawMessage(content)})
	if err != nil {
		t.Fatal(err)
	}
	return docs, v
}

const mcpTestPage = `{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Mục tiêu"}]},{"type":"paragraph","content":[{"type":"text","text":"Tăng doanh thu quý bốn"}]}]}`

func TestMcpGetDocumentReturnsMarkdown(t *testing.T) {
	x := newMcpToolWorld(t)
	_, v := x.withDocs(t, "Kế hoạch Q4", mcpTestPage)
	raw, err := callMcpTool(t, x.tools, x.p, "get_document", `{"workspace_id":"`+x.w.ID+`","document_id":"`+v.Document.ID+`"}`)
	if err != nil {
		t.Fatal(err)
	}
	var d McpDocument
	if err := json.Unmarshal(raw, &d); err != nil || d.Format != "markdown" || d.Content != "## Mục tiêu\n\nTăng doanh thu quý bốn" || d.Revision != v.Document.Revision || d.Lossy {
		t.Fatalf("get_document = %s (%v)", raw, err)
	}
}

func TestMcpSearchFindsDocumentsAndListDocuments(t *testing.T) {
	x := newMcpToolWorld(t)
	_, v := x.withDocs(t, "Kế hoạch doanh thu", mcpTestPage)
	raw, err := callMcpTool(t, x.tools, x.p, "search", `{"workspace_id":"`+x.w.ID+`","query":"doanh thu"}`)
	if err != nil || !strings.Contains(string(raw), v.Document.ID) || !strings.Contains(string(raw), `"kind":"document"`) {
		t.Fatalf("search = %s (%v)", raw, err)
	}
	raw, err = callMcpTool(t, x.tools, x.p, "list_documents", `{"workspace_id":"`+x.w.ID+`"}`)
	if err != nil || !strings.Contains(string(raw), v.Document.ID) {
		t.Fatalf("list_documents = %s (%v)", raw, err)
	}
}

func TestMcpDocumentToolsWithoutDocumentsAreUnavailable(t *testing.T) {
	x := newMcpToolWorld(t)
	_, err := callMcpTool(t, x.tools, x.p, "get_document", `{"workspace_id":"`+x.w.ID+`","document_id":"01J0000000000000000000000X"}`)
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "documents_unavailable" {
		t.Fatalf("no DocumentService: %v", err)
	}
}

func TestMcpTextFile(t *testing.T) {
	for _, c := range []struct {
		mime, name string
		want       bool
	}{
		{"text/markdown", "a.md", true}, {"text/html", "a.html", true}, {"text/plain", "a.txt", true},
		{"application/octet-stream", "notes.md", true},
		{"application/pdf", "a.pdf", false}, {"application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx", false},
	} {
		if got := mcpTextFile(c.mime, c.name); got != c.want {
			t.Errorf("mcpTextFile(%q, %q) = %v", c.mime, c.name, got)
		}
	}
}
```

`NewDocumentService(pool, q, orgs, ws)` là chữ ký thật (`main.go:382`); test tài liệu khác cũng dựng nó không cần entitlements hay files.

Run: `cd server && go test ./internal/service/ -run 'TestMcpGetDocument|TestMcpSearchFindsDocuments|TestMcpDocumentToolsWithout|TestMcpTextFile' -count=1`
Expected: FAIL.

- [ ] **Step 2: Viết code**

`mcp_tools.go`: `McpToolService` thêm trường `docs *DocumentService` và:

```go
// SetDocuments wires documents into the connector's tools (Phase 4 of the
// write spec); without it the document tools answer documents_unavailable.
func (s *McpToolService) SetDocuments(d *DocumentService) { s.docs = d }
```

`server/internal/service/mcp_tools_documents.go`:

```go
package service

import (
	"context"
	"encoding/json"
	"io"
	"path"
	"strings"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/document"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The document tools of the MCP connector (spec 2026-10-14 §5.4). Pages are
// shown and written as Markdown (document.PageToMarkdown/MarkdownToPage);
// files are read when they are text, never written.

type McpDocument struct {
	McpItem
	DocKind   string `json:"doc_kind"`
	Revision  int64  `json:"revision"`
	ParentID  string `json:"parent_id,omitempty"`
	Content   string `json:"content,omitempty"`
	Format    string `json:"format,omitempty"`
	Lossy     bool   `json:"lossy,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
	Filename  string `json:"filename,omitempty"`
	MimeType  string `json:"mime_type,omitempty"`
}

type McpDocumentPage struct {
	Items      []McpDocument `json:"items"`
	NextCursor string        `json:"next_cursor,omitempty"`
}

var errMcpDocumentsUnavailable = McpToolError{Code: "documents_unavailable", Msg: "documents are not available on this server"}

func (s *McpToolService) docOf(base string, d db.Document) McpDocument {
	return McpDocument{
		McpItem:  McpItem{Kind: "document", ID: d.ID, WorkspaceID: d.WorkspaceID, Title: d.Title, URL: s.frontend + base + "/documents/" + d.ID},
		DocKind:  d.Kind, Revision: d.Revision, ParentID: d.ParentID.String,
	}
}

// document reads one live document of the workspace as the person; another
// workspace's, or one in the trash, reads as absent.
func (s *McpToolService) document(ctx context.Context, p McpPrincipal, workspaceID, documentID string) (DocumentView, error) {
	if s.docs == nil {
		return DocumentView{}, errMcpDocumentsUnavailable
	}
	if documentID == "" {
		return DocumentView{}, McpInvalidArgs{Msg: "document_id is required"}
	}
	v, err := s.docs.GetDocument(ctx, Human(p.UserID), documentID)
	if err != nil {
		return DocumentView{}, hidden(err)
	}
	if v.Document.WorkspaceID != workspaceID || v.Document.ArchivedAt.Valid {
		return DocumentView{}, ErrNotFound
	}
	return v, nil
}

// mcpTextFile is a file whose bytes a model can read as text.
func mcpTextFile(mime, filename string) bool {
	switch strings.ToLower(path.Ext(filename)) {
	case ".md", ".markdown", ".html", ".htm", ".txt":
		return true
	}
	mime = strings.ToLower(mime)
	return mime == "text/markdown" || mime == "text/html" || mime == "text/plain"
}

type mcpDocumentRef struct {
	WorkspaceID string `json:"workspace_id"`
	DocumentID  string `json:"document_id"`
}

func (s *McpToolService) GetDocument(ctx context.Context, p McpPrincipal, in mcpDocumentRef) (McpDocument, error) {
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpDocument{}, err
	}
	v, err := s.document(ctx, p, in.WorkspaceID, in.DocumentID)
	if err != nil {
		return McpDocument{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpDocument{}, err
	}
	out := s.docOf(base, v.Document)
	switch {
	case v.Document.Kind == DocumentKindPage:
		md, lossy, err := document.PageToMarkdown(v.Document.Content)
		if err != nil {
			return McpDocument{}, err
		}
		out.Format, out.Lossy = "markdown", lossy
		out.Content = capRunes(md, mcpMaxItemRunes, mcpItemCut)
		out.Truncated = out.Content != md
	case v.File != nil:
		out.Filename, out.MimeType = v.File.Filename, v.File.MimeType
		if !mcpTextFile(v.File.MimeType, v.File.Filename) {
			break
		}
		f, err := s.docs.OpenDocumentFile(ctx, Human(p.UserID), v.Document.ID, 0, DocumentByteRange{})
		if err != nil {
			return McpDocument{}, hidden(err)
		}
		defer f.Reader.Close()
		raw, err := io.ReadAll(io.LimitReader(f.Reader.Body, 4*mcpMaxItemRunes))
		if err != nil {
			return McpDocument{}, err
		}
		if utf8.Valid(raw) {
			text := string(raw)
			out.Format = "text"
			out.Content = capRunes(text, mcpMaxItemRunes, mcpItemCut)
			out.Truncated = out.Content != text || int64(len(raw)) < v.File.SizeBytes
		}
	}
	return out, nil
}

type mcpListDocumentsIn struct {
	WorkspaceID string `json:"workspace_id"`
	ParentID    string `json:"parent_id"`
	Cursor      string `json:"cursor"`
}

func (s *McpToolService) ListDocuments(ctx context.Context, p McpPrincipal, in mcpListDocumentsIn) (McpDocumentPage, error) {
	if s.docs == nil {
		return McpDocumentPage{}, errMcpDocumentsUnavailable
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpDocumentPage{}, err
	}
	page, err := s.docs.ListDocuments(ctx, Human(p.UserID), in.WorkspaceID, ListDocumentsInput{ParentID: &in.ParentID, Cursor: in.Cursor, Limit: mcpMaxList})
	if err != nil {
		return McpDocumentPage{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpDocumentPage{}, err
	}
	out := McpDocumentPage{Items: make([]McpDocument, 0, len(page.Items)), NextCursor: page.NextCursor}
	for _, it := range page.Items {
		out.Items = append(out.Items, s.docOf(base, it.Document))
	}
	return out, nil
}

// searchDocuments is the document half of search: pages and files whose
// title or text matches, each with its snippet.
func (s *McpToolService) searchDocuments(ctx context.Context, p McpPrincipal, workspaceID, query, base string) ([]McpItem, error) {
	if s.docs == nil {
		return nil, nil
	}
	page, err := s.docs.ListDocuments(ctx, Human(p.UserID), workspaceID, ListDocumentsInput{Query: query, Limit: 10})
	if err != nil {
		return nil, hidden(err)
	}
	out := make([]McpItem, 0, len(page.Items))
	for _, it := range page.Items {
		item := s.docOf(base, it.Document).McpItem
		item.Excerpt = capRunes(it.Snippet, mcpMaxHitRunes, mcpHitCut)
		out = append(out, item)
	}
	return out, nil
}

var (
	mcpSchemaListDocuments = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"parent_id":{"type":"string","description":"A folder or page id; omit for the top level of the workspace."},"cursor":{"type":"string","description":"next_cursor of the previous page."}},"required":["workspace_id"],"additionalProperties":false}`)
	mcpSchemaDocument      = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"document_id":{"type":"string"}},"required":["workspace_id","document_id"],"additionalProperties":false}`)
)

func mcpDocumentTools(s *McpToolService) []ai.Tool {
	return []ai.Tool{
		mcpReadTool("list_documents", "List documents", "Pages, files and folders under one folder or page of the workspace, 50 at a time, each with its revision.", mcpSchemaListDocuments,
			func(ctx context.Context, p McpPrincipal, in mcpListDocumentsIn) (any, error) { return s.ListDocuments(ctx, p, in) }),
		mcpReadTool("get_document", "Get document", "One document. A page comes as Markdown with its revision; lossy true means it holds something Markdown cannot carry, so only appending to it is possible. A text file (md, html, txt) comes as text; other files as name and type only.", mcpSchemaDocument,
			func(ctx context.Context, p McpPrincipal, in mcpDocumentRef) (any, error) { return s.GetDocument(ctx, p, in) }),
	}
}
```

`McpDocument.Kind` trong `McpItem` luôn là `"document"`; loại thật nằm ở `doc_kind`.

`Search` (trong `mcp_tools.go`): sau vòng `topSources`, thêm:

```go
	base, err := s.ask.base(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	docs, err := s.searchDocuments(ctx, p, workspaceID, query, base)
	if err != nil {
		return nil, err
	}
	out = append(out, docs...)
```

Description `search` thành `"Tasks, meetings and documents in one workspace matching a keyword query. Chat is not searched."`.

`McpTools`: `r = append(r, mcpDocumentTools(s)...)` sau nhóm Cuộc họp. Catalogue thêm `{"list_documents", "List documents", ai.ToolRead, false}`, `{"get_document", "Get document", ai.ToolRead, false}`. `mcpReadInputs`: `TestMCPReadToolsDoNotMutate` gọi `x.withDocs(...)` trước khi đếm và thêm `list_documents`, `get_document`. `GetDocument` của service ghi một dòng vào `document_access_logs`, không vào `audit_events`/`outbox_events`, nên test vẫn đúng; nếu test đếm ra khác 0, đọc dòng nào được ghi trước khi đổi gì.

Đổi tên `TestMcpSearchReadsTasksAndMeetingsOnly` thành `TestMcpSearchReadsTasksMeetingsAndDocuments`, nối tài liệu ngay đầu test và cho phép kind `document`; phần chat và members giữ nguyên:

```go
	x := newMcpToolWorld(t)
	x.withDocs(t, "Danh sách thành viên", mcpTestPage) // matches the members query, never "sprint bí mật"
```

```go
	for _, it := range found {
		if it.Kind != "task" && it.Kind != "meeting" && it.Kind != "document" {
			t.Fatalf("search returned a %q item: %+v", it.Kind, it)
		}
	}
```

`TestMcpToolOutputsCarryOnlyDocumentedFields`: gọi `x.withDocs(t, "Kế hoạch", mcpTestPage)` đầu test, rồi thêm:

```go
	_, v := x.withDocs(t, "Báo cáo", mcpTestPage)
	raw, err = callMcpTool(t, x.tools, x.p, "get_document", `{"workspace_id":"`+x.w.ID+`","document_id":"`+v.Document.ID+`"}`)
	check("get_document", raw, err, with("doc_kind", "revision", "parent_id", "content", "format", "lossy", "truncated", "filename", "mime_type"))
	raw, err = callMcpTool(t, x.tools, x.p, "list_documents", `{"workspace_id":"`+x.w.ID+`"}`)
	check("list_documents", raw, err, map[string]bool{"items": true, "next_cursor": true})
```

(`withDocs` gọi `SetDocuments` mỗi lần; gọi hai lần trên cùng một world chỉ dựng lại service, không sao.)

Nối dây:
- `server/cmd/server/main.go`, sau `mcpTools := service.NewMcpToolService(...)`: `mcpTools.SetDocuments(docSvc)`.
- `server/internal/handler/mcp_oauth_test.go:46`, sau dòng dựng `d.McpTools`: `if d.Documents != nil { d.McpTools.SetDocuments(d.Documents) }`.
- `server/internal/handler/isolation_world_test.go:174`, sau dòng dựng `d.McpTools`: `d.McpTools.SetDocuments(docs)`.

- [ ] **Step 3: Chạy test, thấy qua**

Run: `cd server && go build ./... && go test ./internal/service/ -run 'TestMcp|TestMCP' -count=1 && go test ./internal/handler/ -run 'TestMcp|TestIsolationMCP' -count=1`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/mcp_tools_documents.go server/internal/service/mcp_tools_documents_test.go server/internal/service/mcp_tools.go server/internal/service/mcp_tools_test.go server/cmd/server/main.go server/internal/handler/mcp_oauth_test.go server/internal/handler/isolation_world_test.go
git commit -m "feat(mcp): documents in search, list_documents, get_document

A page comes back as Markdown with its revision and the lossy flag; a
text file as text; any other file as its name and type. search now
finds pages and files beside tasks and meetings. Documents keep their
own permission ladder: every read goes through DocumentService as the
person.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.4: `create_document`, `update_document`, `add_document_comment`

**Files:**
- Modify: `server/internal/service/mcp_tools_documents.go`, `mcp_tools_documents_test.go`, `mcp_tools_tasks.go` (`McpComment` thêm `DocumentID`), `mcp_tools_test.go`

**Interfaces:**
- Consumes: `document.MarkdownToPage`, `document.AppendMarkdown`, `document.AssetsOf`, `document.PageToMarkdown` (4.1–4.2); `document(...)`, `docOf` (4.3); `errRevisionConflict` (`document_pages.go`).
- Produces: tool `create_document` (không destructive), `update_document` (destructive), `add_document_comment` (không destructive); `McpComment.DocumentID string \`json:"document_id,omitempty"\`` (và `TaskID` đổi thành `json:"task_id,omitempty"`).

- [ ] **Step 1: Viết test hỏng**

```go
func TestMcpCreateDocument(t *testing.T) {
	x := newMcpToolWorld(t)
	x.withDocs(t, "Có sẵn", mcpTestPage)
	raw, err := callMcpTool(t, x.tools, x.p, "create_document", `{"workspace_id":"`+x.w.ID+`","title":"Biên bản","content":"## Quyết định\n\n- Chốt giá"}`)
	if err != nil {
		t.Fatal(err)
	}
	res, item := writeResult(t, raw)
	if res.Revision == 0 || item["doc_kind"] != "page" {
		t.Fatalf("create_document = %s", raw)
	}
	got, _ := callMcpTool(t, x.tools, x.p, "get_document", `{"workspace_id":"`+x.w.ID+`","document_id":"`+item["id"].(string)+`"}`)
	if !strings.Contains(string(got), `## Quyết định\n\n- Chốt giá`) {
		t.Fatalf("created page reads back as %s", got)
	}
}

func TestMcpUpdateDocumentAppendsWithAVersionBefore(t *testing.T) {
	x := newMcpToolWorld(t)
	docs, v := x.withDocs(t, "Kế hoạch", mcpTestPage)
	in := `{"workspace_id":"` + x.w.ID + `","document_id":"` + v.Document.ID + `","revision":` + strconv.FormatInt(v.Document.Revision, 10) + `,"content":"## Rủi ro\n\nThiếu người"}`
	raw, err := callMcpTool(t, x.tools, x.p, "update_document", in)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := docs.GetDocument(context.Background(), Human(x.ua.ID), v.Document.ID)
	md, _, _ := document.PageToMarkdown(after.Document.Content)
	if md != "## Mục tiêu\n\nTăng doanh thu quý bốn\n\n## Rủi ro\n\nThiếu người" {
		t.Fatalf("after append: %q (%s)", md, raw)
	}
	versions, err := docs.ListDocumentVersions(context.Background(), Human(x.ua.ID), v.Document.ID, ListDocumentVersionsInput{})
	if err != nil || len(versions.Versions) == 0 || !versions.Versions[0].Label.Valid || !strings.HasPrefix(versions.Versions[0].Label.String, "Trước khi sửa qua") {
		t.Fatalf("no version before the change: %+v %v", versions, err)
	}
	if _, err := callMcpTool(t, x.tools, x.p, "update_document", in); err == nil {
		t.Fatal("the same revision was accepted twice")
	}
}

// replace is refused on a page Markdown cannot carry, and on one too long
// for the model to have read whole; append still works.
func TestMcpUpdateDocumentReplaceRefusesLossyAndCutPages(t *testing.T) {
	x := newMcpToolWorld(t)
	lossy := `{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]},{"type":"paragraph","content":[{"type":"text","text":"b"}]}]}]}]}]}`
	_, v := x.withDocs(t, "Bảng", lossy)
	rev := strconv.FormatInt(v.Document.Revision, 10)
	_, err := callMcpTool(t, x.tools, x.p, "update_document", `{"workspace_id":"`+x.w.ID+`","document_id":"`+v.Document.ID+`","revision":`+rev+`,"content":"x","mode":"replace"}`)
	var te McpToolError
	if !errors.As(err, &te) || te.Code != "lossy_document" {
		t.Fatalf("replace a lossy page: %v", err)
	}
	long := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"` + strings.Repeat("dài ", 5000) + `"}]}]}`
	docs := x.tools.docs
	big, err := docs.CreatePage(context.Background(), Human(x.ua.ID), x.w.ID, CreatePageInput{Title: "Dài", Content: json.RawMessage(long)})
	if err != nil {
		t.Fatal(err)
	}
	_, err = callMcpTool(t, x.tools, x.p, "update_document", `{"workspace_id":"`+x.w.ID+`","document_id":"`+big.Document.ID+`","revision":`+strconv.FormatInt(big.Document.Revision, 10)+`,"content":"x","mode":"replace"}`)
	if !errors.As(err, &te) || te.Code != "lossy_document" {
		t.Fatalf("replace a page longer than one read: %v", err)
	}
}

func TestMcpAddDocumentComment(t *testing.T) {
	x := newMcpToolWorld(t)
	_, v := x.withDocs(t, "Kế hoạch", mcpTestPage)
	raw, err := callMcpTool(t, x.tools, x.p, "add_document_comment", `{"workspace_id":"`+x.w.ID+`","document_id":"`+v.Document.ID+`","body":"Cần số liệu tháng 9"}`)
	if err != nil {
		t.Fatal(err)
	}
	if _, item := writeResult(t, raw); item["document_id"] != v.Document.ID {
		t.Fatalf("add_document_comment = %s", raw)
	}
}
```

Import thêm `strconv` và `github.com/unicomhub/uniwork/server/internal/document`. `DocumentVersionPage.Versions` là mới nhất trước; `db.DocumentVersion.Label` là `pgtype.Text`.

Run: `cd server && go test ./internal/service/ -run 'TestMcpCreateDocument|TestMcpUpdateDocument|TestMcpAddDocumentComment' -count=1`
Expected: FAIL.

- [ ] **Step 2: Viết code**

`mcp_tools_tasks.go`, `McpComment`:

```go
type McpComment struct {
	ID         string `json:"id"`
	TaskID     string `json:"task_id,omitempty"`
	DocumentID string `json:"document_id,omitempty"`
	Body       string `json:"body"`
	URL        string `json:"url"`
}
```

Thêm vào `mcp_tools_documents.go` (import `fmt`, `github.com/unicomhub/uniwork/server/internal/audit`):

```go
const mcpMaxDocumentRunes = 200000

type mcpCreateDocumentIn struct {
	WorkspaceID string `json:"workspace_id"`
	Title       string `json:"title"`
	Content     string `json:"content"`
	ParentID    string `json:"parent_id"`
}

func (s *McpToolService) CreateDocument(ctx context.Context, p McpPrincipal, in mcpCreateDocumentIn) (McpWriteResult, error) {
	if s.docs == nil {
		return McpWriteResult{}, errMcpDocumentsUnavailable
	}
	if strings.TrimSpace(in.Title) == "" {
		return McpWriteResult{}, McpInvalidArgs{Msg: "title is required"}
	}
	if utf8.RuneCountInString(in.Content) > mcpMaxDocumentRunes {
		return McpWriteResult{}, McpInvalidArgs{Msg: "content is longer than 200000 characters"}
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	content, err := document.MarkdownToPage(in.Content, nil)
	if err != nil {
		return McpWriteResult{}, McpInvalidArgs{Msg: "content could not be stored: " + err.Error()}
	}
	v, err := s.docs.CreatePage(ctx, Human(p.UserID), in.WorkspaceID, CreatePageInput{Kind: DocumentKindPage, ParentID: in.ParentID, Title: in.Title, Content: content})
	if err != nil {
		return McpWriteResult{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	return McpWriteResult{Item: s.docOf(base, v.Document), Revision: v.Document.Revision}, nil
}

type mcpUpdateDocumentIn struct {
	WorkspaceID string  `json:"workspace_id"`
	DocumentID  string  `json:"document_id"`
	Revision    *int64  `json:"revision"`
	Title       string  `json:"title"`
	Content     *string `json:"content"`
	Mode        string  `json:"mode"`
}

// versionLabel names the version taken before an AI app edits a page, so a
// person finds it in the page's history.
func versionLabel(ctx context.Context) string {
	label := "Trước khi sửa qua ứng dụng AI"
	if v := audit.RequestFromContext(ctx).Via; v != nil && v.ClientName != "" {
		label = "Trước khi sửa qua " + v.ClientName
	}
	return capRunes(label, 200, "")
}

// UpdateDocument edits one page: its title, and its content appended to or
// replaced. A version of the page as it was is taken first, so a person can
// restore it. replace is refused on a page the model cannot have read whole
// as Markdown (lossy, or cut).
func (s *McpToolService) UpdateDocument(ctx context.Context, p McpPrincipal, in mcpUpdateDocumentIn) (McpWriteResult, error) {
	if in.Revision == nil {
		return McpWriteResult{}, McpInvalidArgs{Msg: "revision is required; read the document first and send its revision"}
	}
	if in.Mode == "" {
		in.Mode = "append"
	}
	if in.Mode != "append" && in.Mode != "replace" {
		return McpWriteResult{}, McpInvalidArgs{Msg: "mode must be append or replace"}
	}
	if in.Content == nil && strings.TrimSpace(in.Title) == "" {
		return McpWriteResult{}, McpInvalidArgs{Msg: "send content, title or both"}
	}
	if in.Content != nil && utf8.RuneCountInString(*in.Content) > mcpMaxDocumentRunes {
		return McpWriteResult{}, McpInvalidArgs{Msg: "content is longer than 200000 characters"}
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	v, err := s.document(ctx, p, in.WorkspaceID, in.DocumentID)
	if err != nil {
		return McpWriteResult{}, err
	}
	if v.Document.Kind != DocumentKindPage {
		return McpWriteResult{}, McpToolError{Code: "not_a_page", Msg: "only pages can be edited through the connector; open files in UniWork"}
	}
	if v.Document.Revision != *in.Revision {
		return McpWriteResult{}, errRevisionConflict(v.Document.Revision)
	}
	beforeMD, lossy, err := document.PageToMarkdown(v.Document.Content)
	if err != nil {
		return McpWriteResult{}, err
	}
	var content json.RawMessage
	if in.Content != nil {
		if in.Mode == "replace" {
			if lossy || utf8.RuneCountInString(beforeMD) > mcpMaxItemRunes {
				return McpWriteResult{}, McpToolError{Code: "lossy_document", Msg: "this page holds content Markdown cannot carry or is longer than one read; use mode append, or edit it in UniWork"}
			}
			content, err = document.MarkdownToPage(*in.Content, document.AssetsOf(v.Document.Content))
		} else {
			content, err = document.AppendMarkdown(v.Document.Content, *in.Content)
		}
		if err != nil {
			return McpWriteResult{}, McpInvalidArgs{Msg: "content could not be stored: " + err.Error()}
		}
	}
	actor := Human(p.UserID)
	if _, err := s.docs.CreateDocumentVersion(ctx, actor, v.Document.ID, CreateDocumentVersionInput{Label: versionLabel(ctx)}); err != nil && !codedIs(err, "document_version_unchanged") {
		return McpWriteResult{}, err
	}
	after, err := s.docs.UpdateDocument(ctx, actor, v.Document.ID, UpdateDocumentInput{Revision: *in.Revision, Title: optString(strings.TrimSpace(in.Title)), Content: content})
	if err != nil {
		return McpWriteResult{}, err
	}
	afterMD, _, err := document.PageToMarkdown(after.Document.Content)
	if err != nil {
		return McpWriteResult{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	return McpWriteResult{
		Item: s.docOf(base, after.Document), Revision: after.Document.Revision,
		Changes: mcpChanges(McpChange{"title", v.Document.Title, after.Document.Title}, McpChange{"content", beforeMD, afterMD}),
		Note:    fmt.Sprintf("the page as it was is saved as the version %q in its history", versionLabel(ctx)),
	}, nil
}

type mcpAddDocumentCommentIn struct {
	WorkspaceID string `json:"workspace_id"`
	DocumentID  string `json:"document_id"`
	Body        string `json:"body"`
}

func (s *McpToolService) AddDocumentComment(ctx context.Context, p McpPrincipal, in mcpAddDocumentCommentIn) (McpWriteResult, error) {
	if n := utf8.RuneCountInString(strings.TrimSpace(in.Body)); n == 0 || n > mcpMaxBodyRunes {
		return McpWriteResult{}, McpInvalidArgs{Msg: "body must be 1-20000 characters"}
	}
	if err := s.inGrant(ctx, p, in.WorkspaceID); err != nil {
		return McpWriteResult{}, err
	}
	v, err := s.document(ctx, p, in.WorkspaceID, in.DocumentID)
	if err != nil {
		return McpWriteResult{}, err
	}
	c, err := s.docs.AddDocumentComment(ctx, Human(p.UserID), v.Document.ID, AddCommentInput{Body: in.Body}, "")
	if err != nil {
		return McpWriteResult{}, err
	}
	base, err := s.ask.base(ctx, in.WorkspaceID)
	if err != nil {
		return McpWriteResult{}, err
	}
	return McpWriteResult{Item: McpComment{ID: c.ID, DocumentID: v.Document.ID, Body: capRunes(c.Body, mcpMaxHitRunes, mcpHitCut), URL: s.frontend + base + "/documents/" + v.Document.ID}}, nil
}
```

`PageToMarkdown` trên trang rất dài trả chuỗi dài; `mcpChanges` cắt nó còn 1.200 rune. `db.DocumentComment.Body` là `string`.

Schema và tool, thêm vào `mcpDocumentTools`:

```go
	mcpSchemaCreateDocument  = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"title":{"type":"string","minLength":1,"maxLength":500},"content":{"type":"string","description":"Markdown: headings, lists, task lists, tables, code, quotes, links, [@Name](uniwork://user/<id>) mentions."},"parent_id":{"type":"string","description":"Folder or page to put it in; omit for the workspace root."}},"required":["workspace_id","title"],"additionalProperties":false}`)
	mcpSchemaUpdateDocument  = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"document_id":{"type":"string"},"revision":{"type":"integer"},"title":{"type":"string","maxLength":500},"content":{"type":"string","description":"Markdown."},"mode":{"type":"string","enum":["append","replace"],"description":"append (default) adds after the page's content; replace needs a page that is not lossy."}},"required":["workspace_id","document_id","revision"],"additionalProperties":false}`)
	mcpSchemaDocumentComment = json.RawMessage(`{"type":"object","properties":{"workspace_id":{"type":"string"},"document_id":{"type":"string"},"body":{"type":"string","minLength":1,"maxLength":20000}},"required":["workspace_id","document_id","body"],"additionalProperties":false}`)
```

```go
		mcpWriteTool("create_document", "Create document", "Creates a page from Markdown as the user. It inherits who can see it from its folder, or is visible to the workspace at the root.", "the user moves it to the trash in UniWork, where it can be restored", false, mcpSchemaCreateDocument,
			func(ctx context.Context, p McpPrincipal, in mcpCreateDocumentIn) (any, error) { return s.CreateDocument(ctx, p, in) }),
		mcpWriteTool("update_document", "Update document", "Edits a page as the user: renames it and appends Markdown to it, or replaces its content when it is not lossy. A version of the page as it was is saved first. Fails with revision_conflict if it changed since you read it. Files cannot be edited.", "restore the version saved before this change from the page's history in UniWork", true, mcpSchemaUpdateDocument,
			func(ctx context.Context, p McpPrincipal, in mcpUpdateDocumentIn) (any, error) { return s.UpdateDocument(ctx, p, in) }),
		mcpWriteTool("add_document_comment", "Add document comment", "Adds a comment to a document as the user; it needs the right to edit the document, and everyone who can see the document sees the comment.", "the user deletes the comment in UniWork", false, mcpSchemaDocumentComment,
			func(ctx context.Context, p McpPrincipal, in mcpAddDocumentCommentIn) (any, error) { return s.AddDocumentComment(ctx, p, in) }),
```

Catalogue thêm `{"create_document", "Create document", ai.ToolWrite, false}`, `{"update_document", "Update document", ai.ToolWrite, true}`, `{"add_document_comment", "Add document comment", ai.ToolWrite, false}`. Đếm lại: catalogue đủ 26 dòng.

- [ ] **Step 3: Chạy test, thấy qua**

Run: `cd server && go test ./internal/service/ -run 'TestMcp|TestMCP' -count=1 && go test ./internal/ -run TestMcpToolsCallNoDelete -count=1 && go test ./internal/document/ -count=1`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/internal/service/mcp_tools_documents.go server/internal/service/mcp_tools_documents_test.go server/internal/service/mcp_tools_tasks.go server/internal/service/mcp_tools_test.go
git commit -m "feat(mcp): create_document, update_document, add_document_comment

A model writes pages in Markdown. update_document saves a version of the
page first, appends by default, and replaces only a page it can have
read whole and without loss; files stay read-only. The result names the
version to restore.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.5: Isolation, lời đồng ý, đóng spec, kiểm chứng Phase 4

**Files:**
- Modify: `server/internal/handler/isolation_mcp_test.go`
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`, `packages/views/auth/connect-consent.tsx`, `connect-consent.test.tsx`
- Modify: `docs/superpowers/specs/2026-10-14-mcp-connector-write-design.md` (dòng trạng thái), `docs/superpowers/plans/2026-10-14-mcp-connector-write.md` (dòng trạng thái), `docs/roadmap/FEATURE_ROADMAP.md` (A-13)

- [ ] **Step 1: Isolation**

`aDoc := a.get(t, "document")` (khóa của trang trong `isolation_world_test.go:607`; `"fileDocument"` là tệp). `attacks` thêm:

```go
		{"list_documents", map[string]string{"workspace_id": a.wsID}},
		{"get_document", map[string]string{"workspace_id": a.wsID, "document_id": aDoc}},
		{"get_document", map[string]string{"workspace_id": b.wsID, "document_id": aDoc}},
```

`writeAttacks` thêm:

```go
		{"create_document", map[string]any{"workspace_id": a.wsID, "title": "iso", "content": "iso"}},
		{"create_document", map[string]any{"workspace_id": b.wsID, "title": "iso", "content": "iso", "parent_id": aDoc}},
		{"update_document", map[string]any{"workspace_id": a.wsID, "document_id": aDoc, "revision": 1, "content": "iso"}},
		{"update_document", map[string]any{"workspace_id": b.wsID, "document_id": aDoc, "revision": 1, "content": "iso"}},
		{"add_document_comment", map[string]any{"workspace_id": a.wsID, "document_id": aDoc, "body": "iso"}},
		{"add_document_comment", map[string]any{"workspace_id": b.wsID, "document_id": aDoc, "body": "iso"}},
```

Trong `refused`, thêm một lần `search` của B trong workspace của chính B với `a.marker`: không phải lỗi, và `a.leakIn(raw, "")` rỗng (tài liệu của A không lọt vào kết quả của B).

`control`: A tạo một trang, đọc nó, nối Markdown vào với revision vừa đọc, comment lên nó, qua grant của A.

Run: `cd server && go test ./internal/handler/ -run 'TestIsolationMCP|TestIsolationMatrix' -count=1`
Expected: PASS.

- [ ] **Step 2: Lời đồng ý nhắc tài liệu**

`vi.json` `auth.connect`: `"shareDocuments": "Tài liệu dạng trang và tệp văn bản bạn được xem",`; `settings.aiAccess.toggleDescription`: `"Dữ liệu chia sẻ: công việc, bình luận, dự án, cuộc họp, tóm tắt AI và tài liệu. Không gồm chat và email. Tắt sẽ chặn ngay mọi ứng dụng đã kết nối."`. `en.json`: `"shareDocuments": "Pages and text files you can see"`, `toggleDescription`: `"Shared: tasks, comments, projects, meetings, AI summaries and documents. Never chat or email. Turning this off blocks every connected app at once."`. `connect-consent.tsx`: `<li>{t("auth.connect.shareDocuments")}</li>` sau `shareMeetings`; thêm kỳ vọng tương ứng trong test.

Run: `pnpm --filter @uniwork/views exec vitest run auth/connect-consent settings/components/ai-access-tab`
Expected: PASS.

- [ ] **Step 3: Đóng spec, plan, roadmap**

- Spec: dòng trạng thái thành `> **Trạng thái:** shipped — năm phase đã merge (UNI-1567 và các sub-issue Phase 0–4); nộp Directory là UNI-1428.`
- Plan: dòng trạng thái thành `> **Trạng thái:** shipped — Phase 0–4 đã merge.`
- Roadmap A-13: thay đoạn "Tool ghi (task, dự án, cuộc họp, tài liệu): spec … làm trước khi nộp Directory" bằng "Đọc và ghi task, dự án, cuộc họp, tài liệu đã ship (spec `2026-10-14-mcp-connector-write-design.md`, ADR 0033); còn nộp Directory (UNI-1428)".

Run: `node --test scripts/governance.test.mjs`
Expected: PASS.

- [ ] **Step 4: Gate, thử tay, commit, note**

Run: `make check`. Thử trên ba client: "tóm tắt tài liệu Kế hoạch Q4", "thêm mục Rủi ro vào cuối tài liệu đó", "tạo biên bản họp hôm nay từ ghi chú này", rồi mở lịch sử phiên bản của trang để thấy version "Trước khi sửa qua <client>" và khôi phục được.

```bash
git add server/internal/handler/isolation_mcp_test.go packages/core/i18n/locales packages/views/auth docs/superpowers docs/roadmap/FEATURE_ROADMAP.md
git commit -m "test(mcp): isolation for the document tools; the write spec ships

TestIsolationMCP aims B's grant at A's documents for every document tool
and as a parent folder; B's own search never surfaces A's pages. The
consent page names documents. The spec and plan are marked shipped and
A-13 now waits only on the directory submission.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
make issue-note KEY=<UNI-key Phase 4> MSG="[agent] Phase 4 xong: bộ chuyển Markdown (khứ hồi, lossy), search + list/get/create/update_document, add_document_comment, isolation; spec/plan shipped. make check: <kết quả>. Thử tay: <kết quả>. Chưa push. Bước sau: UNI-1428."
```

Dừng, hỏi người dùng trước khi `make issue-pr`.
