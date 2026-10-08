# Work Graph lát 1 (C-11): catalogue, projector, rebuild, API đọc, panel trên trang việc — kế hoạch triển khai

> **Trạng thái:** in-progress — UNI-962 (sub-issue của UNI-460), nhánh `feature/UNI-962-c-11-lat-1-work-graph-catalogue-projecto`.

> **Điều chỉnh khi thực thi (2026-10-08).** Mã trong các task dưới đây là bản trước điều chỉnh; mã trên nhánh là nguồn đúng. Mỗi điều chỉnh có dòng `Ruling:` trong sổ thực thi và commit riêng:
> - `GraphMarkDirty` dời mã sự kiện, người làm và `last_event_at` cùng nhau theo sự kiện mới nhất (`59708231`).
> - `nodeDiffers` so cả `occurred_at` (`460d7c2e`) nhưng không so `source_updated_at`, vì tin nhắn chat, sắp xếp phòng ban và chuyển chủ trì đổi cột này mà không có sự kiện (`ccc8ee46`).
> - Cạnh mở tới node đã xoá được đóng (`55a74b1c`); node sống lại đánh dấu các node ở đầu kia của cạnh mà lần xoá đã đóng (`74a55b68`).
> - `graph-rebuild` từ chối `--org` không tồn tại và đối số thừa (`2d5c6c01`); runbook chạy `--verify` hằng tuần theo từng tổ chức đã bật `graph` (`1ba6209b`).
> - Worker lấy ngày nghiệp vụ của nguồn, kèm `backfill`, cho node mới mà nguồn có trước sự kiện hơn 1 phút (`dbd3d265`, `eadf86a9`); spec §13 #10.
> - Fact hạn đi theo `due_date`, tức “Hạn” trên trang việc, `due_at` chỉ là dự phòng (`796a7018`); spec §5.3, §13 #19.
> - Xoá tài khoản ghi `member.deactivated` hoặc `profile.updated` cho từng tổ chức để đồ thị nhận được (`437301e1`, `006e022a`).
> - Task 13 chạy spec bằng `pnpm --filter @uniwork/e2e exec playwright test graph-related-panel.spec.ts` (repo không có project `chromium`); Task 14 lấy id việc qua `POST …/tasks/query`, vì `GET …/tasks?limit=` bỏ qua `limit`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Việc, cuộc họp, dự án, thành viên/agent, phòng ban và phòng chat của một tổ chức nằm trên một đồ thị chung, có thời gian, có bằng chứng. Đồ thị được chiếu từ bảng nguồn qua outbox, dựng lại cho ra đúng nó, và hiện thành panel "Liên quan" cùng dòng thời gian trên trang chi tiết việc, sau flag.

**Architecture:** `internal/graph` giữ từ vựng đóng (14 node, 17 loại cạnh, 64 bộ ba; `DUE` là fact). `internal/graph/projector` là nơi duy nhất ghi bảng đồ thị. Marker trên lane realtime đánh dấu node bẩn vào `graph_dirty` (một upsert, không đọc nguồn). Worker nền claim dòng bẩn, đọc lại nguồn, đối chiếu trạng thái mong muốn với cạnh/fact đang mở, đóng phần thừa, mở phần thiếu. `cmd/graph-rebuild` dùng đúng hàm đối chiếu ấy cho cả tổ chức (`--verify` chỉ đếm lệch). `service.GraphService` đọc hàng xóm và lịch sử với hai lớp quyền: SQL trên `visibility`/`reader_ids`, rồi đọc lại từng node qua đúng truy vấn và cổng của module. Web có một section trong sidebar trang việc và một section dòng thời gian trong cột chính, cả hai sau flag `graph_ui` đọc theo tổ chức.

**Tech Stack:** Go 1.27, pgx v5, sqlc 1.31.1, Postgres 16 (plpgsql trigger, partial unique index, GIN), Prometheus client, Chi; Next.js, TanStack Query, zod, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-work-graph-foundation-design.md` (đọc kèm §13: 18 điều chỉnh sau khi đối chiếu mã, mọi chỗ kế hoạch khác chữ cũ của spec đều có lý do ở đó).

## Global Constraints

- Migration: không `FOREIGN KEY`/`REFERENCES` (kể cả trong chuỗi `RAISE`), mỗi `CREATE [UNIQUE] INDEX CONCURRENTLY` một file một câu, tên file `999<13 chữ số>_name`, bảng mới có `organization_id TEXT NOT NULL` hoặc nằm trong `tenantExemptTables` có lý do. Đuôi số dùng `9991791331200000` trở đi, liên tiếp.
- Mọi query sqlc chạm bảng tenant: lọc `organization_id = sqlc.arg(...)` / `workspace_id = …`, hoặc dòng `-- tenant: <lý do>` ngay sau `-- name:` (tập lý do đóng: `by-id`, `parent <col>`, `self`, `token`, `system`, `platform`). Thừa dòng tenant cũng đỏ (`TestTenantReasonsSitOnTenantQueries`). Sửa `.sql` thì `make sqlc` và commit `server/pkg/db/generated/`.
- Chỉ `server/internal/graph/projector/` gọi các query ghi đồ thị (`Graph(Upsert|Open|Close|Mark|Claim|Done|Release|Fail|Lock)…`) và chỉ nó viết SQL thô `insert/update/delete` vào `graph_*` (arch test ở Task 4).
- Không dựng `audit.Actor{`, `audit.System(`, `audit.KindAgent|KindSystem|KindGuest` ngoài `internal/service`, `internal/audit`, `internal/notification` (`TestActorConstructedOnlyInService`). Projector dùng chuỗi `actor_kind`/`actor_id` của dòng outbox.
- Catalogue sự kiện sửa ở ba nơi cùng lúc: `server/internal/outbox/catalogue.go` (một dòng một hàng, đúng thứ tự trường), `docs/events/CATALOGUE.md`, `packages/core/types/events.ts`. Chạy `node --test scripts/events-catalogue.test.mjs`.
- Hành động audit mới phải có ca trong `TestEveryAuditedCommandWritesItsRow` **và** dòng trong `auditActions()` (`server/internal/service/audit_coverage_test.go`).
- Payload outbox chỉ có id (ADR 0009). Projector luôn đọc lại nguồn, không tin giá trị trong payload.
- Log định danh người bằng id, không email hay tên (`scripts/no-pii-log.test.mjs`).
- Flag khai trong `server/internal/featureflags/keys.go` có `ReviewAt` trong tương lai (`TestFlagsAreReviewed`). Flag ẩn năng lực, không cấp quyền.
- Test Go dùng `testutil.DB(t)` và **bỏ qua im lặng khi không kết nối được DB**: luôn chạy `-v` và đọc `--- PASS`, không chấp nhận `--- SKIP`. Chạy `make test-go` một lần đầu phiên để dựng và migrate DB test.
- Web: `packages/views` không import `next/*`; chuỗi qua `t()`, khóa vi trước rồi en; endpoint chỉ trả dữ liệu qua `parseWithFallback`, mỗi endpoint có test response hỏng; khóa query có `wsId`; file `.ts/.tsx` ≤ 500 dòng hiệu dụng; `pnpm knip` không báo export thừa.
- Không chạy cả bộ e2e (khoảng 10 phút); chỉ chạy spec của kế hoạch này.
- Commit theo prefix quy ước, mỗi commit kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; hook tự thêm `Refs: UNI-nnn`.
- Chạy `gofmt -w` trên mọi file Go đã sửa trước khi commit: hook pre-commit chặn file chưa gofmt, và vài khối mã trong kế hoạch chưa căn cột. gofmt còn đổi `''` trong doc comment thành dấu nháy cong, nên đừng viết `''` trong doc comment.
- `make sqlc` còn xếp lại `server/pkg/db/generated/billing.sql.go` (drift có sẵn trên develop, chỉ đổi thứ tự hàm): chạy `git checkout -- server/pkg/db/generated/billing.sql.go` trước khi commit.
- Mỗi lệnh `go test`/`go run` chạy với env của worktree: `set -a; . ./.env.worktree; set +a` ở gốc worktree (DB test riêng `uniwork_uni_962_763_test`). Typecheck package views cần `NODE_OPTIONS=--max-old-space-size=8192`.
- Select của Base UI trong jsdom chọn item khi nhận chuỗi pointerDown → pointerUp → mouseUp → click; `fireEvent.click` trơn không đổi giá trị.

## Review Focus

1. **Hai sự kiện dồn vào một node trước khi worker chạy** (đổi người phụ trách hai lần liền): đồ thị phải theo trạng thái cuối, cạnh cũ đóng, không còn hai `OWNED_BY` mở. Trạng thái trung gian nằm gọn trong một cửa sổ chiếu (thường dưới 1 giây) thì không thành một dòng lịch sử; đó là chủ ý của việc gộp (spec §13 #10). Test: Task 6, `TestWorkerFollowsTheLatestSource`.
2. **Xoá một việc đang là đầu kia của phụ thuộc**: không còn cạnh mở trỏ vào node đã xoá, và chiếu lại việc kia không mở lại cạnh. Test: Task 6, `TestProjectTaskDeleteClosesEveryEdge`.
3. **Thành viên bị kick khỏi phòng private mà không có sự kiện** (`reader_ids` cũ còn tên họ): API không được trả phòng đó. Test: Task 9, `TestGraphNeighborsLayerTwoDropsStaleReaders`.
4. **Tổ chức chưa bật `graph`**: marker không đánh dấu; bật lên rồi `graph-rebuild --org` thì đồ thị đủ, cạnh backfill không bịa ngày. Test: Task 6, `TestMarkerIgnoresDisabledOrganizations`; Task 7, `TestRebuildBackfillsWithSourceTime`.
5. **Rebuild ngay sau khi worker bắt kịp** phải ra 0 lệch, và `--verify` phải bắt được một cạnh bị sửa tay. Test: Task 7, `TestRebuildVerifyFindsNoDriftAfterTheWorker`.

## Bản đồ file

| File | Trách nhiệm |
|---|---|
| `server/internal/graph/catalogue.go` (+`_test.go`, `catalogue_db_test.go`) | Từ vựng: loại node, loại cạnh, bộ ba hợp lệ, hằng visibility/subtype/fact/origin |
| `server/migrations/9991791331200000_graph_tables.{up,down}.sql` | Năm bảng, trigger, seed 64 bộ ba |
| `server/migrations/99917913312000{01..13}_graph_*.{up,down}.sql` | Mười ba index, mỗi file một câu |
| `server/pkg/db/queries/graph.sql` | Query ghi đồ thị và hàng đợi bẩn (chỉ projector gọi) |
| `server/pkg/db/queries/graph_sources.sql` | Đọc bảng nguồn cho chiếu và rebuild |
| `server/pkg/db/queries/graph_read.sql` | Đọc cho API (lớp 1) |
| `server/internal/graph/projector/types.go`, `scope.go` | Kiểu trạng thái mong muốn, phạm vi sở hữu cạnh/fact |
| `server/internal/graph/projector/load*.go` | Một file một loại nguồn: tính `Desired` |
| `server/internal/graph/projector/reconcile.go` | `Project` (ghi) và `Verify` (đếm) dùng chung một hàm đối chiếu |
| `server/internal/graph/projector/refs.go`, `marker.go`, `worker.go`, `metrics.go` | Topic → node; consumer đánh dấu; worker chiếu; port metrics |
| `server/internal/graph/projector/rebuild.go` | Dựng lại một tổ chức |
| `server/cmd/graph-rebuild/main.go` | CLI mỏng quanh `RebuildOrg` |
| `server/internal/service/graph.go`, `graph_gate.go` | API đọc hai lớp quyền |
| `server/internal/handler/graph.go`, `router/graph.go`, `dto/sdi/graph.go`, `dto/sdo/graph.go` | HTTP |
| `server/internal/metrics/graph.go` | Counter, histogram, collector `graph_dirty` |
| `packages/core/types/graph.ts`, `api/endpoints/graph.ts`, `graph/{keys,hooks,use-graph-ui}.ts` | Client |
| `packages/views/graph/{graph-labels.ts,related-section.tsx,node-history-section.tsx}` | Giao diện |
| `e2e/graph-related-panel.spec.ts` | Luồng thật |

---

## Task 0: Issue, nhánh, commit spec và hai kế hoạch

- [ ] **Bước 1: Lấy issue.** Người dùng tạo issue C-11 (dưới epic Giai đoạn C, UNI-416) và sub-issue "C-11 lát 1". Agent không tạo issue gốc. Ghi khóa sub-issue vào `KEY`.
- [ ] **Bước 2: Mở phiên.**

```bash
uniai issue get $KEY --output json
make issue-start KEY=$KEY
```

- [ ] **Bước 3: Commit tài liệu.** Sửa dòng trạng thái của kế hoạch này thành `in-progress — $KEY, nhánh feature/$KEY-...`, rồi:

```bash
git add docs/superpowers/specs/2026-10-07-work-graph-foundation-design.md \
  docs/superpowers/plans/2026-10-07-work-graph-slice-1.md \
  docs/superpowers/plans/2026-10-07-work-graph-data-conditions.md
git commit -m "docs: Work Graph C-11 spec and its two plans

Spec approved 2026-10-07; §13 records 18 corrections after reading the code
(dirty marker instead of a graph lane, real topic names, workspace-scoped
routes, chat.thread.unlinked, V3 already built).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 1: Catalogue từ vựng (`internal/graph`)

**Files:**
- Create: `server/internal/graph/catalogue.go`
- Test: `server/internal/graph/catalogue_test.go`

**Interfaces:**
- Produces: `graph.NodeType`, 14 hằng `graph.Node*`, `graph.NodeTypes`, `graph.Projected map[NodeType]bool`, `graph.ParseNodeType(string) (NodeType, bool)`; `graph.EdgeType`, 17 hằng `graph.Edge*`, `graph.EdgeTypes`, `graph.ParseEdgeType(string) (EdgeType, bool)`; `graph.Origin*`; `graph.Triple{Edge EdgeType; From, To NodeType; HumanCreatable, Temporal bool}`, `graph.Triples() []Triple` (đã sắp), `graph.Allowed(EdgeType, NodeType, NodeType) bool`; `graph.FactDue`, `graph.FactStatus`; `graph.Vis*`; `graph.Subtype*`.

- [ ] **Bước 1: Test đỏ.** `server/internal/graph/catalogue_test.go`:

```go
package graph

import "testing"

func TestCatalogueShape(t *testing.T) {
	if len(NodeTypes) != 14 {
		t.Fatalf("node types = %d, want 14", len(NodeTypes))
	}
	if len(EdgeTypes) != 17 {
		t.Fatalf("edge types = %d, want 17 (DUE is a node fact)", len(EdgeTypes))
	}
	triples := Triples()
	if len(triples) != 64 {
		t.Fatalf("triples = %d, want 64", len(triples))
	}
	seen := map[Triple]bool{}
	for i, tr := range triples {
		if seen[tr] {
			t.Errorf("duplicate triple %+v", tr)
		}
		seen[tr] = true
		if i > 0 && !tripleLess(triples[i-1], tr) {
			t.Errorf("triples not sorted at %d", i)
		}
	}
	for _, e := range EdgeTypes {
		found := false
		for _, tr := range triples {
			found = found || tr.Edge == e
		}
		if !found {
			t.Errorf("edge %s has no triple", e)
		}
	}
}

func TestAllowed(t *testing.T) {
	cases := []struct {
		e        EdgeType
		from, to NodeType
		want     bool
	}{
		{EdgeOwnedBy, NodeTask, NodeActor, true},
		{EdgeOwnedBy, NodeActor, NodeTask, false},
		{EdgeOriginatedFrom, NodeTask, NodeMeeting, true},
		{EdgeDependsOn, NodeTask, NodeTask, true},
		{EdgeBelongsTo, NodeKnowledge, NodeCustomer, true},
		{EdgeBelongsTo, NodeActor, NodeProject, false},
		{"RELATED_TO", NodeTask, NodeTask, false},
	}
	for _, c := range cases {
		if got := Allowed(c.e, c.from, c.to); got != c.want {
			t.Errorf("Allowed(%s, %s, %s) = %v", c.e, c.from, c.to, got)
		}
	}
}

func TestParse(t *testing.T) {
	if n, ok := ParseNodeType("TASK"); !ok || n != NodeTask {
		t.Fatal("TASK")
	}
	if _, ok := ParseNodeType("task"); ok {
		t.Fatal("node types are upper case on the wire")
	}
	if _, ok := ParseEdgeType("DUE"); ok {
		t.Fatal("DUE is a fact, not an edge")
	}
	if !Projected[NodeThread] || Projected[NodeDocument] {
		t.Fatal("slice 1 projects THREAD, not DOCUMENT")
	}
}
```

- [ ] **Bước 2: Chạy, xác nhận đỏ.** `cd server && go test ./internal/graph/ -count=1 -v` → lỗi biên dịch (package rỗng).

- [ ] **Bước 3: Viết catalogue.** `server/internal/graph/catalogue.go`:

```go
// Package graph is the Work Graph vocabulary (C-11, ADR 0019): the closed set
// of node types, edge types and the (edge, from, to) triples allowed between
// them. It holds no state and touches no database. The projector and the read
// service import it; migration 9991791331200000 seeds graph_edge_types with
// the same triples (TestGraphCatalogueMatchesSeed holds the two together).
package graph

import "sort"

// NodeType is one kind of thing on the graph. Each node points at exactly one
// source row.
type NodeType string

const (
	NodeMeeting     NodeType = "MEETING"
	NodeDecision    NodeType = "DECISION"
	NodeTask        NodeType = "TASK"
	NodeCommitment  NodeType = "COMMITMENT"
	NodeExecution   NodeType = "EXECUTION"
	NodeWorkProduct NodeType = "WORK_PRODUCT"
	NodeKnowledge   NodeType = "KNOWLEDGE"
	NodeActor       NodeType = "ACTOR"
	NodeTeam        NodeType = "TEAM"
	NodeProject     NodeType = "PROJECT"
	NodeCustomer    NodeType = "CUSTOMER"
	NodeGoal        NodeType = "GOAL"
	NodeDocument    NodeType = "DOCUMENT"
	NodeThread      NodeType = "THREAD"
)

// NodeTypes is every node type in catalogue order (spec §4.1).
var NodeTypes = []NodeType{
	NodeMeeting, NodeDecision, NodeTask, NodeCommitment, NodeExecution, NodeWorkProduct, NodeKnowledge,
	NodeActor, NodeTeam, NodeProject, NodeCustomer, NodeGoal, NodeDocument, NodeThread,
}

// backbone is the work itself (spec §4.1); any of it may belong to a customer.
var backbone = []NodeType{NodeMeeting, NodeDecision, NodeTask, NodeCommitment, NodeExecution, NodeWorkProduct, NodeKnowledge}

// Projected is what slice 1 projects (spec §10). DOCUMENT and the email
// THREAD arrive with slice 2; the rest have no source table yet.
var Projected = map[NodeType]bool{
	NodeTask: true, NodeMeeting: true, NodeProject: true, NodeActor: true, NodeTeam: true, NodeThread: true,
}

// ParseNodeType accepts the catalogue spelling only (upper case).
func ParseNodeType(s string) (NodeType, bool) {
	for _, n := range NodeTypes {
		if string(n) == s {
			return n, true
		}
	}
	return "", false
}

// EdgeType is a directed relation that reads as a sentence. There is no
// RELATED_TO: a relation the vocabulary cannot name is not recorded.
type EdgeType string

const (
	EdgeDecidedIn      EdgeType = "DECIDED_IN"
	EdgeDrives         EdgeType = "DRIVES"
	EdgeSupersedes     EdgeType = "SUPERSEDES"
	EdgeOwnedBy        EdgeType = "OWNED_BY"
	EdgeExecutedBy     EdgeType = "EXECUTED_BY"
	EdgeExecutes       EdgeType = "EXECUTES"
	EdgeProduced       EdgeType = "PRODUCED"
	EdgeRealizedAs     EdgeType = "REALIZED_AS"
	EdgePromotedTo     EdgeType = "PROMOTED_TO"
	EdgeInforms        EdgeType = "INFORMS"
	EdgeBelongsTo      EdgeType = "BELONGS_TO"
	EdgeContributesTo  EdgeType = "CONTRIBUTES_TO"
	EdgeParticipatedIn EdgeType = "PARTICIPATED_IN"
	EdgeDiscussedIn    EdgeType = "DISCUSSED_IN"
	EdgeEvidencedBy    EdgeType = "EVIDENCED_BY"
	EdgeOriginatedFrom EdgeType = "ORIGINATED_FROM"
	EdgeDependsOn      EdgeType = "DEPENDS_ON"
)

// EdgeTypes lists every stored edge type. DUE (spec §4.1) is not here: a
// deadline is a node fact (FactDue in graph_node_facts), because a date is
// not a node.
var EdgeTypes = []EdgeType{
	EdgeDecidedIn, EdgeDrives, EdgeSupersedes, EdgeOwnedBy, EdgeExecutedBy, EdgeExecutes, EdgeProduced,
	EdgeRealizedAs, EdgePromotedTo, EdgeInforms, EdgeBelongsTo, EdgeContributesTo, EdgeParticipatedIn,
	EdgeDiscussedIn, EdgeEvidencedBy, EdgeOriginatedFrom, EdgeDependsOn,
}

// ParseEdgeType accepts the catalogue spelling only.
func ParseEdgeType(s string) (EdgeType, bool) {
	for _, e := range EdgeTypes {
		if string(e) == s {
			return e, true
		}
	}
	return "", false
}

// Origin says who asserted an edge. C-11 writes SYSTEM (projected from a
// source row) and, from slice 3, HUMAN (a work_links row).
const (
	OriginSystem      = "SYSTEM"
	OriginHuman       = "HUMAN"
	OriginAIConfirmed = "AI_CONFIRMED"
	OriginAISuggested = "AI_SUGGESTED"
)

// Fact types: a node's time-bound values that are not relations.
const (
	FactDue    = "due"
	FactStatus = "status"
)

// Visibility of a node, computed from its source (spec §4.4).
const (
	VisOrganization = "organization"
	VisWorkspace    = "workspace"
	VisMembers      = "members"
	VisPrivate      = "private"
)

// Subtypes tell apart two sources of one node type, for icons and links.
const (
	SubtypeMember      = "member"
	SubtypeAgent       = "agent"
	SubtypeChatRoom    = "chat_room"
	SubtypeEmailThread = "email_thread"
)

type edgeDef struct {
	edge           EdgeType
	from, to       []NodeType
	humanCreatable bool
	temporal       bool
}

func nodes(n ...NodeType) []NodeType { return n }

var edgeDefs = []edgeDef{
	{edge: EdgeDecidedIn, from: nodes(NodeDecision), to: nodes(NodeMeeting)},
	{edge: EdgeDrives, from: nodes(NodeDecision), to: nodes(NodeTask, NodeCommitment)},
	{edge: EdgeSupersedes, from: nodes(NodeDecision), to: nodes(NodeDecision)},
	{edge: EdgeOwnedBy, from: nodes(NodeTask, NodeProject, NodeGoal), to: nodes(NodeActor), temporal: true},
	{edge: EdgeExecutedBy, from: nodes(NodeExecution), to: nodes(NodeActor)},
	{edge: EdgeExecutes, from: nodes(NodeExecution), to: nodes(NodeTask)},
	{edge: EdgeProduced, from: nodes(NodeExecution), to: nodes(NodeWorkProduct)},
	{edge: EdgeRealizedAs, from: nodes(NodeWorkProduct), to: nodes(NodeDocument)},
	{edge: EdgePromotedTo, from: nodes(NodeWorkProduct), to: nodes(NodeKnowledge)},
	{edge: EdgeInforms, from: nodes(NodeKnowledge), to: nodes(NodeMeeting, NodeTask, NodeDecision), humanCreatable: true},
	{edge: EdgeBelongsTo, from: nodes(NodeTask), to: nodes(NodeProject, NodeTask), temporal: true},
	{edge: EdgeBelongsTo, from: nodes(NodeMeeting, NodeProject, NodeDocument, NodeThread), to: nodes(NodeProject), temporal: true},
	{edge: EdgeBelongsTo, from: nodes(NodeActor, NodeTeam), to: nodes(NodeTeam), temporal: true},
	{edge: EdgeBelongsTo, from: backbone, to: nodes(NodeCustomer), temporal: true},
	{edge: EdgeContributesTo, from: nodes(NodeProject, NodeTask, NodeDecision), to: nodes(NodeGoal), humanCreatable: true, temporal: true},
	{edge: EdgeParticipatedIn, from: nodes(NodeActor), to: nodes(NodeMeeting), temporal: true},
	{edge: EdgeDiscussedIn, from: nodes(NodeTask, NodeMeeting, NodeProject, NodeDecision), to: nodes(NodeThread), humanCreatable: true},
	{edge: EdgeEvidencedBy, from: nodes(NodeTask, NodeMeeting, NodeProject, NodeDecision), to: nodes(NodeDocument, NodeThread), humanCreatable: true},
	{edge: EdgeOriginatedFrom, from: nodes(NodeTask, NodeDecision, NodeProject), to: nodes(NodeThread, NodeMeeting, NodeDocument, NodeCustomer), humanCreatable: true},
	{edge: EdgeDependsOn, from: nodes(NodeTask, NodeCommitment), to: nodes(NodeTask, NodeCommitment, NodeDecision), temporal: true},
}

// Triple is one allowed (edge, from, to) with its flags; a row of
// graph_edge_types.
type Triple struct {
	Edge           EdgeType
	From, To       NodeType
	HumanCreatable bool
	Temporal       bool
}

func tripleLess(a, b Triple) bool {
	if a.Edge != b.Edge {
		return a.Edge < b.Edge
	}
	if a.From != b.From {
		return a.From < b.From
	}
	return a.To < b.To
}

func sortTriples(ts []Triple) { sort.Slice(ts, func(i, j int) bool { return tripleLess(ts[i], ts[j]) }) }

var triples, allowed = func() ([]Triple, map[[3]string]bool) {
	var out []Triple
	set := map[[3]string]bool{}
	for _, d := range edgeDefs {
		for _, f := range d.from {
			for _, to := range d.to {
				out = append(out, Triple{Edge: d.edge, From: f, To: to, HumanCreatable: d.humanCreatable, Temporal: d.temporal})
				set[[3]string{string(d.edge), string(f), string(to)}] = true
			}
		}
	}
	sortTriples(out)
	return out, set
}()

// Triples returns every allowed triple, sorted by edge, from, to.
func Triples() []Triple { return append([]Triple(nil), triples...) }

// Allowed reports whether an edge of type e may go from a node of type from
// to one of type to.
func Allowed(e EdgeType, from, to NodeType) bool {
	return allowed[[3]string{string(e), string(from), string(to)}]
}
```

- [ ] **Bước 4: Chạy, xác nhận xanh.** `cd server && go test ./internal/graph/ -count=1 -v` → ba test PASS.

- [ ] **Bước 5: Commit.**

```bash
git add server/internal/graph/
git commit -m "feat(graph): Work Graph vocabulary catalogue

14 node types, 17 stored edge types (DUE is a node fact), 64 allowed
triples, origins, visibilities and subtypes (C-11 §4.1).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: Bảng, trigger, seed và index

**Files:**
- Create: `server/migrations/9991791331200000_graph_tables.up.sql`, `.down.sql`
- Create: 13 cặp index `server/migrations/99917913312000{01..13}_*.up.sql/.down.sql`
- Modify: `server/migrations/lint_test.go` (`tenantExemptTables`, dòng ~288-312)
- Modify: `server/internal/testutil/db.go` (danh sách `TRUNCATE`, dòng ~54-83)
- Test: `server/internal/graph/catalogue_db_test.go`

**Interfaces:**
- Produces: bảng `graph_edge_types`, `graph_nodes` (có `subtype`), `graph_edges`, `graph_node_facts`, `graph_dirty`; trigger `graph_edges_validate`; index `uidx_graph_nodes_source`, `uidx_graph_edges_open`, `uidx_graph_node_facts_open` (cho `ON CONFLICT`).

- [ ] **Bước 1: Test đỏ.** `server/internal/graph/catalogue_db_test.go`:

```go
package graph

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/unicomhub/uniwork/server/internal/testutil"
)

// The seed migration and the Go catalogue name the same triples.
func TestGraphCatalogueMatchesSeed(t *testing.T) {
	pool := testutil.DB(t)
	rows, err := pool.Query(context.Background(),
		`SELECT edge_type, from_type, to_type, human_creatable, temporal FROM graph_edge_types`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []Triple
	for rows.Next() {
		var e, f, to string
		var tr Triple
		if err := rows.Scan(&e, &f, &to, &tr.HumanCreatable, &tr.Temporal); err != nil {
			t.Fatal(err)
		}
		tr.Edge, tr.From, tr.To = EdgeType(e), NodeType(f), NodeType(to)
		got = append(got, tr)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	sortTriples(got)
	want := Triples()
	if len(got) != len(want) {
		t.Fatalf("seed has %d triples, catalogue %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("triple %d: seed %+v, catalogue %+v", i, got[i], want[i])
		}
	}
}

// graph_edges_validate refuses a triple outside the catalogue and an edge
// whose nodes sit in another organization.
func TestGraphEdgesRefuseWhatTheCatalogueDoesNot(t *testing.T) {
	pool := testutil.DB(t)
	ctx := context.Background()
	for _, n := range [][3]string{{"n-task", "org-a", "TASK"}, {"n-actor", "org-a", "ACTOR"}, {"n-far", "org-b", "ACTOR"}} {
		if _, err := pool.Exec(ctx, `INSERT INTO graph_nodes (id, organization_id, node_type, source_id, visibility)
			VALUES ($1, $2, $3, $1, 'organization')`, n[0], n[1], n[2]); err != nil {
			t.Fatal(err)
		}
	}
	insert := func(id, from, to, edge string) error {
		_, err := pool.Exec(ctx, `INSERT INTO graph_edges
			(id, organization_id, from_node, to_node, edge_type, origin, valid_from, evidence_kind, evidence_id)
			VALUES ($1, 'org-a', $2, $3, $4, 'SYSTEM', now(), 'source_row', 'x')`, id, from, to, edge)
		return err
	}
	if err := insert("e-ok", "n-task", "n-actor", "OWNED_BY"); err != nil {
		t.Fatalf("catalogue triple refused: %v", err)
	}
	cases := []struct{ name, id, from, to, edge string }{
		{"reversed", "e-rev", "n-actor", "n-task", "OWNED_BY"},
		{"unknown edge", "e-unk", "n-task", "n-actor", "RELATED_TO"},
		{"other organization", "e-far", "n-task", "n-far", "OWNED_BY"},
		{"missing node", "e-miss", "n-task", "n-nowhere", "OWNED_BY"},
	}
	for _, c := range cases {
		err := insert(c.id, c.from, c.to, c.edge)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
			t.Errorf("%s: err = %v, want SQLSTATE 23514", c.name, err)
		}
	}
}
```

- [ ] **Bước 2: Chạy, xác nhận đỏ.** `cd server && go test ./internal/graph/ -run 'TestGraph' -count=1 -v` → `relation "graph_edge_types" does not exist`.

- [ ] **Bước 3: Migration bảng.** `server/migrations/9991791331200000_graph_tables.up.sql`:

```sql
-- Work Graph (C-11, ADR 0019): a projection of the business tables. Only
-- internal/graph/projector writes these tables (arch test), so a rebuild from
-- the sources always reproduces them. No foreign keys (migration rules): the
-- graph_edges_validate trigger checks the catalogue triple and that both nodes
-- sit in the edge's organization.

CREATE TABLE graph_edge_types (
  edge_type       TEXT NOT NULL,
  from_type       TEXT NOT NULL,
  to_type         TEXT NOT NULL,
  human_creatable BOOLEAN NOT NULL DEFAULT false,
  temporal        BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (edge_type, from_type, to_type)
);

CREATE TABLE graph_nodes (
  id                TEXT PRIMARY KEY,
  organization_id   TEXT NOT NULL,
  workspace_id      TEXT,
  node_type         TEXT NOT NULL,
  subtype           TEXT NOT NULL DEFAULT '',
  source_id         TEXT NOT NULL,
  title             TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT '',
  visibility        TEXT NOT NULL,
  reader_ids        TEXT[] NOT NULL DEFAULT '{}',
  occurred_at       TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT graph_nodes_node_type_check CHECK (node_type IN (
    'MEETING', 'DECISION', 'TASK', 'COMMITMENT', 'EXECUTION', 'WORK_PRODUCT', 'KNOWLEDGE',
    'ACTOR', 'TEAM', 'PROJECT', 'CUSTOMER', 'GOAL', 'DOCUMENT', 'THREAD')),
  CONSTRAINT graph_nodes_visibility_check CHECK (visibility IN ('organization', 'workspace', 'members', 'private'))
);

CREATE TABLE graph_edges (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  from_node       TEXT NOT NULL,
  to_node         TEXT NOT NULL,
  edge_type       TEXT NOT NULL,
  origin          TEXT NOT NULL,
  valid_from      TIMESTAMPTZ NOT NULL,
  valid_to        TIMESTAMPTZ,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_kind   TEXT NOT NULL,
  evidence_id     TEXT NOT NULL,
  actor_kind      TEXT NOT NULL DEFAULT '',
  actor_id        TEXT NOT NULL DEFAULT '',
  attrs           JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT graph_edges_origin_check CHECK (origin IN ('SYSTEM', 'HUMAN', 'AI_CONFIRMED', 'AI_SUGGESTED')),
  CONSTRAINT graph_edges_evidence_check CHECK (evidence_kind IN ('outbox_event', 'work_link', 'source_row') AND evidence_id <> ''),
  CONSTRAINT graph_edges_valid_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT graph_edges_not_self_check CHECK (from_node <> to_node)
);

CREATE TABLE graph_node_facts (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  node_id         TEXT NOT NULL,
  fact_type       TEXT NOT NULL,
  value           TEXT NOT NULL,
  valid_from      TIMESTAMPTZ NOT NULL,
  valid_to        TIMESTAMPTZ,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_kind   TEXT NOT NULL,
  evidence_id     TEXT NOT NULL,
  attrs           JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT graph_node_facts_type_check CHECK (fact_type IN ('due', 'status')),
  CONSTRAINT graph_node_facts_evidence_check CHECK (evidence_kind IN ('outbox_event', 'work_link', 'source_row') AND evidence_id <> ''),
  CONSTRAINT graph_node_facts_valid_check CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

-- One row per node waiting to be projected. The marker consumer upserts it
-- (mark_seq counts the marks); the projector worker deletes it only if no
-- mark arrived while it was projecting.
CREATE TABLE graph_dirty (
  organization_id TEXT NOT NULL,
  node_type       TEXT NOT NULL,
  source_id       TEXT NOT NULL,
  mark_seq        BIGINT NOT NULL DEFAULT 1,
  last_event_id   TEXT NOT NULL DEFAULT '',
  last_event_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_kind      TEXT NOT NULL DEFAULT '',
  actor_id        TEXT NOT NULL DEFAULT '',
  attempts        INT NOT NULL DEFAULT 0,
  available_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until    TIMESTAMPTZ,
  last_error      TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, node_type, source_id)
);

CREATE OR REPLACE FUNCTION graph_edges_validate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  f graph_nodes%ROWTYPE;
  t graph_nodes%ROWTYPE;
BEGIN
  SELECT * INTO f FROM graph_nodes WHERE id = NEW.from_node;
  SELECT * INTO t FROM graph_nodes WHERE id = NEW.to_node;
  IF f.id IS NULL OR t.id IS NULL THEN
    RAISE EXCEPTION 'graph edge % names a node that does not exist', NEW.id USING ERRCODE = '23514';
  END IF;
  IF f.organization_id <> NEW.organization_id OR t.organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'graph edge % crosses organizations', NEW.id USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM graph_edge_types
    WHERE edge_type = NEW.edge_type AND from_type = f.node_type AND to_type = t.node_type
  ) THEN
    RAISE EXCEPTION 'graph edge %: % from % to % is not in the catalogue', NEW.id, NEW.edge_type, f.node_type, t.node_type
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS graph_edges_validate ON graph_edges;
CREATE TRIGGER graph_edges_validate BEFORE INSERT ON graph_edges
  FOR EACH ROW EXECUTE FUNCTION graph_edges_validate();

INSERT INTO graph_edge_types (edge_type, from_type, to_type, human_creatable, temporal) VALUES
  ('DECIDED_IN', 'DECISION', 'MEETING', false, false),
  ('DRIVES', 'DECISION', 'TASK', false, false),
  ('DRIVES', 'DECISION', 'COMMITMENT', false, false),
  ('SUPERSEDES', 'DECISION', 'DECISION', false, false),
  ('OWNED_BY', 'TASK', 'ACTOR', false, true),
  ('OWNED_BY', 'PROJECT', 'ACTOR', false, true),
  ('OWNED_BY', 'GOAL', 'ACTOR', false, true),
  ('EXECUTED_BY', 'EXECUTION', 'ACTOR', false, false),
  ('EXECUTES', 'EXECUTION', 'TASK', false, false),
  ('PRODUCED', 'EXECUTION', 'WORK_PRODUCT', false, false),
  ('REALIZED_AS', 'WORK_PRODUCT', 'DOCUMENT', false, false),
  ('PROMOTED_TO', 'WORK_PRODUCT', 'KNOWLEDGE', false, false),
  ('INFORMS', 'KNOWLEDGE', 'MEETING', true, false),
  ('INFORMS', 'KNOWLEDGE', 'TASK', true, false),
  ('INFORMS', 'KNOWLEDGE', 'DECISION', true, false),
  ('BELONGS_TO', 'TASK', 'PROJECT', false, true),
  ('BELONGS_TO', 'TASK', 'TASK', false, true),
  ('BELONGS_TO', 'MEETING', 'PROJECT', false, true),
  ('BELONGS_TO', 'PROJECT', 'PROJECT', false, true),
  ('BELONGS_TO', 'DOCUMENT', 'PROJECT', false, true),
  ('BELONGS_TO', 'THREAD', 'PROJECT', false, true),
  ('BELONGS_TO', 'ACTOR', 'TEAM', false, true),
  ('BELONGS_TO', 'TEAM', 'TEAM', false, true),
  ('BELONGS_TO', 'MEETING', 'CUSTOMER', false, true),
  ('BELONGS_TO', 'DECISION', 'CUSTOMER', false, true),
  ('BELONGS_TO', 'TASK', 'CUSTOMER', false, true),
  ('BELONGS_TO', 'COMMITMENT', 'CUSTOMER', false, true),
  ('BELONGS_TO', 'EXECUTION', 'CUSTOMER', false, true),
  ('BELONGS_TO', 'WORK_PRODUCT', 'CUSTOMER', false, true),
  ('BELONGS_TO', 'KNOWLEDGE', 'CUSTOMER', false, true),
  ('CONTRIBUTES_TO', 'PROJECT', 'GOAL', true, true),
  ('CONTRIBUTES_TO', 'TASK', 'GOAL', true, true),
  ('CONTRIBUTES_TO', 'DECISION', 'GOAL', true, true),
  ('PARTICIPATED_IN', 'ACTOR', 'MEETING', false, true),
  ('DISCUSSED_IN', 'TASK', 'THREAD', true, false),
  ('DISCUSSED_IN', 'MEETING', 'THREAD', true, false),
  ('DISCUSSED_IN', 'PROJECT', 'THREAD', true, false),
  ('DISCUSSED_IN', 'DECISION', 'THREAD', true, false),
  ('EVIDENCED_BY', 'TASK', 'DOCUMENT', true, false),
  ('EVIDENCED_BY', 'TASK', 'THREAD', true, false),
  ('EVIDENCED_BY', 'MEETING', 'DOCUMENT', true, false),
  ('EVIDENCED_BY', 'MEETING', 'THREAD', true, false),
  ('EVIDENCED_BY', 'PROJECT', 'DOCUMENT', true, false),
  ('EVIDENCED_BY', 'PROJECT', 'THREAD', true, false),
  ('EVIDENCED_BY', 'DECISION', 'DOCUMENT', true, false),
  ('EVIDENCED_BY', 'DECISION', 'THREAD', true, false),
  ('ORIGINATED_FROM', 'TASK', 'THREAD', true, false),
  ('ORIGINATED_FROM', 'TASK', 'MEETING', true, false),
  ('ORIGINATED_FROM', 'TASK', 'DOCUMENT', true, false),
  ('ORIGINATED_FROM', 'TASK', 'CUSTOMER', true, false),
  ('ORIGINATED_FROM', 'DECISION', 'THREAD', true, false),
  ('ORIGINATED_FROM', 'DECISION', 'MEETING', true, false),
  ('ORIGINATED_FROM', 'DECISION', 'DOCUMENT', true, false),
  ('ORIGINATED_FROM', 'DECISION', 'CUSTOMER', true, false),
  ('ORIGINATED_FROM', 'PROJECT', 'THREAD', true, false),
  ('ORIGINATED_FROM', 'PROJECT', 'MEETING', true, false),
  ('ORIGINATED_FROM', 'PROJECT', 'DOCUMENT', true, false),
  ('ORIGINATED_FROM', 'PROJECT', 'CUSTOMER', true, false),
  ('DEPENDS_ON', 'TASK', 'TASK', false, true),
  ('DEPENDS_ON', 'TASK', 'COMMITMENT', false, true),
  ('DEPENDS_ON', 'TASK', 'DECISION', false, true),
  ('DEPENDS_ON', 'COMMITMENT', 'TASK', false, true),
  ('DEPENDS_ON', 'COMMITMENT', 'COMMITMENT', false, true),
  ('DEPENDS_ON', 'COMMITMENT', 'DECISION', false, true)
ON CONFLICT DO NOTHING;
```

`server/migrations/9991791331200000_graph_tables.down.sql`:

```sql
DROP TRIGGER IF EXISTS graph_edges_validate ON graph_edges;
DROP FUNCTION IF EXISTS graph_edges_validate();
DROP TABLE IF EXISTS graph_dirty;
DROP TABLE IF EXISTS graph_node_facts;
DROP TABLE IF EXISTS graph_edges;
DROP TABLE IF EXISTS graph_nodes;
DROP TABLE IF EXISTS graph_edge_types;
```

- [ ] **Bước 4: Mười ba file index.** Mỗi `.up.sql` đúng một câu; mỗi `.down.sql` là `DROP INDEX CONCURRENTLY IF EXISTS <tên>;`.

| Đuôi | Tên file | Câu `up` |
|---|---|---|
| `…01` | `graph_nodes_source_uidx` | `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_graph_nodes_source ON graph_nodes (organization_id, node_type, source_id);` |
| `…02` | `graph_nodes_workspace_idx` | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_nodes_workspace ON graph_nodes (organization_id, workspace_id, node_type, updated_at);` |
| `…03` | `graph_nodes_readers_idx` | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_nodes_readers ON graph_nodes USING gin (reader_ids);` |
| `…04` | `graph_edges_open_uidx` | `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_graph_edges_open ON graph_edges (organization_id, from_node, to_node, edge_type, origin) WHERE valid_to IS NULL;` |
| `…05` | `graph_edges_from_open_idx` | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_edges_from_open ON graph_edges (from_node, edge_type) WHERE valid_to IS NULL;` |
| `…06` | `graph_edges_to_open_idx` | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_edges_to_open ON graph_edges (to_node, edge_type) WHERE valid_to IS NULL;` |
| `…07` | `graph_edges_from_history_idx` | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_edges_from_history ON graph_edges (from_node, valid_from);` |
| `…08` | `graph_edges_to_history_idx` | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_edges_to_history ON graph_edges (to_node, valid_from);` |
| `…09` | `graph_edges_evidence_idx` | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_edges_evidence ON graph_edges (organization_id, evidence_kind, evidence_id);` |
| `…10` | `graph_node_facts_open_uidx` | `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_graph_node_facts_open ON graph_node_facts (organization_id, node_id, fact_type) WHERE valid_to IS NULL;` |
| `…11` | `graph_node_facts_history_idx` | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_node_facts_history ON graph_node_facts (node_id, fact_type, valid_from);` |
| `…12` | `graph_dirty_available_idx` | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_dirty_available ON graph_dirty (available_at);` |
| `…13` | `graph_edges_org_idx` | `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_edges_org ON graph_edges (organization_id, edge_type, valid_from);` |

(Tên file đầy đủ ví dụ: `9991791331200001_graph_nodes_source_uidx.up.sql`.)

- [ ] **Bước 5: Lint và testutil.** Trong `tenantExemptTables` (`server/migrations/lint_test.go`) thêm:

```go
	"graph_edge_types":          "the global Work Graph edge catalogue, shared by every tenant (C-11)",
```

Trong `TRUNCATE` của `server/internal/testutil/db.go`, thêm `graph_dirty, graph_node_facts, graph_edges, graph_nodes,` trước `saved_signatures CASCADE`. **Không** thêm `graph_edge_types`, vì seed do migration nạp và không bị truncate, như `plans`.

- [ ] **Bước 6: Chạy, xác nhận xanh.**

```bash
cd server && go test ./migrations/ -count=1 -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)' | tail -40
cd server && go test ./internal/graph/ -count=1 -v
```

Kết quả mong đợi: `TestNewMigrationsHaveNoForeignKeys`, `TestNewMigrationsCreateIndexesConcurrently`, `TestMigrationPrefixesSortTheSameAsStringsAndNumbers`, `TestNewTablesCarryOrganizationID`, `TestEveryBusinessTableCarriesOrganizationID`, `TestTenantColumnIsNotNull`, các test rollback (`TestOrganizationsGrandfather`, …) và hai test graph đều PASS.

- [ ] **Bước 7: Commit.**

```bash
git add server/migrations/9991791331200* server/migrations/lint_test.go server/internal/testutil/db.go server/internal/graph/catalogue_db_test.go
git commit -m "feat(graph): graph tables, catalogue seed and edge validation trigger

graph_nodes/edges/node_facts plus graph_dirty (the projector's queue). Open
edges and facts are unique per (organization, ends, type, origin) so two
workers cannot open the same edge twice. The trigger refuses triples outside
the catalogue and edges across organizations.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: Sự kiện còn thiếu: `agent.*` và `chat.thread.unlinked`

**Files:**
- Modify: `server/internal/outbox/catalogue.go`, `docs/events/CATALOGUE.md`, `packages/core/types/events.ts`
- Modify: `server/internal/service/agent.go` (`createAgent` ~:110, `Update` ~:171)
- Modify: `server/internal/audit/actions.go` (sau `ActionChatThreadTaskLinked`, ~:118)
- Modify: `server/pkg/db/queries/chat_links.sql` (thêm `UnlinkChatThreadTask`)
- Modify: `server/internal/service/chat_links.go` (`UnsyncThreadTask`, ~:478-494)
- Modify: `server/internal/service/chat.go` (`EnsureWorkspaceRoom` ~:139-178 phát `chat.room.created` khi tạo phòng mặc định)
- Modify: `server/internal/service/audit_coverage_test.go` (ca mới + `auditActions()`)
- Modify: `packages/core/realtime/use-realtime-sync.ts` (`case "chat.thread.unlinked"` cạnh `"chat.thread.linked"`, :412)
- Create: `server/internal/service/graph_events_test.go`

**Interfaces:**
- Produces: topic `agent.created|updated|archived` payload `{organization_id, agent_id}`; topic `chat.thread.unlinked` payload `{room_id, thread_root_id, task_id}`; `audit.ActionChatThreadTaskUnlinked = "chat.thread.task_unlinked"`; `(*db.Queries).UnlinkChatThreadTask(ctx, UnlinkChatThreadTaskParams{ThreadRootID, WorkspaceID}) (db.ChatThreadTaskLink, error)`.

- [ ] **Bước 1: Test đỏ.** `server/internal/service/graph_events_test.go`:

```go
package service

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func topicsLike(t *testing.T, pool *pgxpool.Pool, orgID, pattern string) []string {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT topic FROM outbox_events WHERE organization_id = $1 AND topic LIKE $2 ORDER BY created_at, id`, orgID, pattern)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

// Agents and thread unsync now reach the outbox; the Work Graph projects
// ACTOR nodes and DISCUSSED_IN edges from them (C-11 §5.2).
func TestGraphSourceEventsReachTheOutbox(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	owner := registerVerified(t, q, as, "graph-events@example.com", "Chủ")
	org, err := orgs.Create(ctx, owner.ID, "Graph Org", "graph-org")
	if err != nil {
		t.Fatal(err)
	}
	v, err := ws.CreateInOrg(ctx, owner.ID, org.ID, "Graph WS", "graph-ws")
	if err != nil {
		t.Fatal(err)
	}
	agents := NewAgentService(pool, q, orgs, ws)
	a, err := agents.Create(ctx, owner.ID, org.ID, CreateAgentInput{Name: "Trợ lý", Handle: "tro-ly"})
	if err != nil {
		t.Fatal(err)
	}
	name := "Trợ lý 2"
	if _, err := agents.Update(ctx, owner.ID, a.ID, UpdateAgentInput{Name: &name}); err != nil {
		t.Fatal(err)
	}
	archived := "archived"
	if _, err := agents.Update(ctx, owner.ID, a.ID, UpdateAgentInput{Status: &archived}); err != nil {
		t.Fatal(err)
	}
	// The default agent comes first (organization create), then the three commands.
	got := topicsLike(t, pool, org.ID, "agent.%")
	want := []string{"agent.created", "agent.created", "agent.updated", "agent.archived"}
	if len(got) != len(want) {
		t.Fatalf("agent topics = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("agent topics = %v, want %v", got, want)
		}
	}

	tasks := NewTaskService(pool, q, ws, nil)
	chat := NewChatService(pool, q, ws, NopPublisher{})
	chat.SetTasks(tasks)
	ch, err := chat.CreateChannel(ctx, owner.ID, v.Workspace.ID, CreateChannelInput{Name: "graph-sync", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	root, err := chat.SendRoomMessage(ctx, owner.ID, v.Workspace.ID, ch.ID, SendChatMessageInput{Body: "root"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := tasks.Create(ctx, Human(owner.ID), v.Workspace.ID, CreateTaskInput{Title: "synced"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := chat.SyncThreadTask(ctx, owner.ID, v.Workspace.ID, root.ID, SyncThreadTaskInput{TaskID: task.ID, Direction: "both"}); err != nil {
		t.Fatal(err)
	}
	if err := chat.UnsyncThreadTask(ctx, owner.ID, v.Workspace.ID, root.ID); err != nil {
		t.Fatal(err)
	}
	if got := topicsLike(t, pool, org.ID, "chat.thread.%linked"); len(got) != 2 || got[1] != "chat.thread.unlinked" {
		t.Fatalf("thread topics = %v", got)
	}
	if err := chat.UnsyncThreadTask(ctx, owner.ID, v.Workspace.ID, root.ID); err == nil {
		t.Fatal("a second unsync must answer not found")
	}

	// The default workspace room is created lazily; it now says so.
	room, err := chat.EnsureWorkspaceRoom(ctx, owner.ID, v.Workspace.ID)
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'chat.room.created' AND payload::jsonb->>'room_id' = $1`,
		room.RoomID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("chat.room.created rows for the workspace room = %d", n)
	}
	if _, err := chat.EnsureWorkspaceRoom(ctx, owner.ID, v.Workspace.ID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM outbox_events WHERE topic = 'chat.room.created' AND payload::jsonb->>'room_id' = $1`,
		room.RoomID).Scan(&n); err != nil || n != 1 {
		t.Fatalf("a second ensure must not emit again: %d (%v)", n, err)
	}
}
```

Người gọi `agents.Create` ở đây là owner nên qua được cổng quyền.

- [ ] **Bước 2: Chạy, xác nhận đỏ.** `cd server && go test ./internal/service/ -run TestGraphSourceEventsReachTheOutbox -count=1 -v` → agent topics thiếu, `chat.thread.unlinked` không có.

- [ ] **Bước 3: Catalogue ở ba nơi.** `server/internal/outbox/catalogue.go`, nhóm agent (cạnh `workspace_agent.added`, dòng ~120):

```go
	// Agents (C-11): identity changes; the Work Graph projects ACTOR nodes from them.
	{Topic: "agent.archived", Version: 1, Payload: []string{"organization_id", "agent_id"}, Scope: ScopeOrganization, Delivery: DeliveryOutbox},
	{Topic: "agent.created", Version: 1, Payload: []string{"organization_id", "agent_id"}, Scope: ScopeOrganization, Delivery: DeliveryOutbox},
	{Topic: "agent.updated", Version: 1, Payload: []string{"organization_id", "agent_id"}, Scope: ScopeOrganization, Delivery: DeliveryOutbox},
```

ngay dưới dòng `chat.thread.linked` (~:160):

```go
	{Topic: "chat.thread.unlinked", Version: 1, Payload: []string{"room_id", "thread_root_id", "task_id"}, Scope: ScopeRoom, Delivery: DeliveryOutbox},
```

`docs/events/CATALOGUE.md`: bốn dòng theo thứ tự chữ cái trong bảng, đổi dòng "Cập nhật:" thành `2026-10-07`:

```
| `agent.archived` | 1 | `organization_id`, `agent_id` | — | organization | outbox |
| `agent.created` | 1 | `organization_id`, `agent_id` | — | organization | outbox |
| `agent.updated` | 1 | `organization_id`, `agent_id` | — | organization | outbox |
| `chat.thread.unlinked` | 1 | `room_id`, `thread_root_id`, `task_id` | — | room | outbox |
```

`packages/core/types/events.ts`: thêm `"agent.archived", "agent.created", "agent.updated",` và `"chat.thread.unlinked",` vào `WS_EVENT_TYPES` ở đúng chỗ theo thứ tự chữ cái.

- [ ] **Bước 4: Agent phát sự kiện.** `server/internal/service/agent.go`, trong `createAgent` thay lời gọi `Record`:

```go
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          actor,
		Action:         audit.ActionAgentCreated,
		ResourceType:   "agent", ResourceID: a.ID,
		Changes: audit.Diff(nil, agentAuditFields(a)),
	}, audit.Event{Topic: "agent.created", Payload: map[string]string{
		"organization_id": orgID, "agent_id": a.ID,
	}}); err != nil {
		return db.Agent{}, err
	}
```

Trong `Update`, thay lời gọi `Record`:

```go
	// Archiving is a status change; it gets its own topic so a consumer that
	// only cares about an agent leaving need not diff the row (C-11).
	topic := "agent.updated"
	if before.Status != "archived" && a.Status == "archived" {
		topic = "agent.archived"
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: a.OrganizationID,
		Actor:          Human(userID),
		Action:         audit.ActionAgentUpdated,
		ResourceType:   "agent", ResourceID: a.ID,
		Changes: audit.Diff(agentAuditFields(before), agentAuditFields(a)),
	}, audit.Event{Topic: topic, Payload: map[string]string{
		"organization_id": a.OrganizationID, "agent_id": a.ID,
	}}); err != nil {
		return db.Agent{}, err
	}
```

- [ ] **Bước 5: Gỡ đồng bộ thread có audit và sự kiện.** `server/internal/audit/actions.go`, sau `ActionChatThreadTaskLinked`:

```go
	ActionChatThreadTaskUnlinked = "chat.thread.task_unlinked"
```

`server/pkg/db/queries/chat_links.sql`, cuối file:

```sql
-- name: UnlinkChatThreadTask :one
-- C-11: the unsync command returns the link it removed, for its audit row
-- and its chat.thread.unlinked event.
DELETE FROM chat_thread_task_links
WHERE thread_root_id = sqlc.arg(thread_root_id) AND workspace_id = sqlc.arg(workspace_id)
RETURNING *;
```

Chạy `make sqlc`. Thay `UnsyncThreadTask` trong `server/internal/service/chat_links.go`:

```go
// UnsyncThreadTask removes the thread↔task link with its audit row and a
// chat.thread.unlinked event in one transaction (ADR 0009); the Work Graph
// closes the task's DISCUSSED_IN edge from that event (C-11 §5.2).
func (s *ChatService) UnsyncThreadTask(ctx context.Context, userID, workspaceID, threadRootID string) error {
	_, root, err := s.loadThreadRootAcrossRooms(ctx, userID, workspaceID, threadRootID)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	link, err := q.UnlinkChatThreadTask(ctx, db.UnlinkChatThreadTaskParams{ThreadRootID: root.ID, WorkspaceID: workspaceID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: link.OrganizationID, WorkspaceID: link.WorkspaceID,
		Actor: Human(userID), Action: audit.ActionChatThreadTaskUnlinked,
		ResourceType: "chat_thread", ResourceID: root.ID,
		Metadata: map[string]any{"task_id": link.TaskID, "direction": link.Direction},
	}, audit.Event{Topic: "chat.thread.unlinked", Payload: map[string]string{
		"room_id": link.RoomID, "thread_root_id": root.ID, "task_id": link.TaskID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
```

Thêm import `errors` và `github.com/jackc/pgx/v5` nếu file chưa có. `dropLinkAndNotify` (consumer khi việc đã bị xoá) giữ nguyên: `task.deleted` đã đóng mọi cạnh của node việc.

- [ ] **Bước 5b: Phòng mặc định của workspace có audit và sự kiện.** `EnsureWorkspaceRoom` (`server/internal/service/chat.go:139-178`) tạo phòng trên `s.q` mà không ghi gì. Đây là phòng chat phổ biến nhất, và không có sự kiện thì `graph-rebuild --verify` luôn thấy nó thiếu. Bọc nhánh tạo trong giao dịch, ghi audit và `chat.room.created` như `createChatRoom` (`chat_rooms.go:462-475`):

```go
	room, err := s.q.GetWorkspaceChatRoom(ctx, pgtype.Text{String: workspaceID, Valid: true})
	if errors.Is(err, pgx.ErrNoRows) {
		room, err = s.createWorkspaceRoom(ctx, userID, w)
		if err != nil {
			return WorkspaceChat{}, err
		}
	} else if err != nil {
		return WorkspaceChat{}, err
	}
```

và hàm mới cạnh đó:

```go
// createWorkspaceRoom creates the default workspace channel with its audit
// row and chat.room.created in one transaction (ADR 0009); the Work Graph
// projects the room from that event (C-11).
func (s *ChatService) createWorkspaceRoom(ctx context.Context, userID string, w db.Workspace) (db.ChatRoom, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.ChatRoom{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	roomID := util.NewID()
	room, err := q.CreateChatRoom(ctx, db.CreateChatRoomParams{
		ID: roomID, Kind: chatRoomKindChannel, WorkspaceID: pgtype.Text{String: w.ID, Valid: true},
		OrganizationID: w.OrganizationID, Name: w.Name, MemberSetKey: pgtype.Text{},
		LivekitRoomName: liveKitRoomFromChatID(roomID), CreatedBy: userID, CreatedByKind: string(audit.KindHuman),
		Visibility: chatVisibilityPublic, ProjectID: pgtype.Text{}, Topic: "", IsDefault: true,
	})
	if err != nil {
		return db.ChatRoom{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: w.OrganizationID, WorkspaceID: w.ID,
		Actor: audit.User(userID), Action: audit.ActionChatRoomCreated,
		ResourceType: "chat_room", ResourceID: roomID,
		Changes: audit.Diff(nil, map[string]any{"kind": chatRoomKindChannel}),
		Metadata: map[string]any{"default": true},
	}, audit.Event{Topic: "chat.room.created", Payload: map[string]string{
		"room_id": roomID, "workspace_id": w.ID,
	}}); err != nil {
		return db.ChatRoom{}, err
	}
	return room, tx.Commit(ctx)
}
```

Hành động `chat.room.created` đã có ca trong test phủ audit (`createChatRoom`); thêm một nơi phát cùng hành động không đổi test đó.

- [ ] **Bước 6: Test phủ audit.** Trong `TestEveryAuditedCommandWritesItsRow` (`audit_coverage_test.go`), thêm ca ngay sau `audit.ActionChatThreadTaskLinked`:

```go
		audit.ActionChatThreadTaskUnlinked: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			ch, err := f.chat.CreateChannel(f.ctx, f.owner.ID, w.ID, CreateChannelInput{Name: "audit-unsync", Visibility: "public"})
			if err != nil {
				t.Fatal(err)
			}
			root, err := f.chat.SendRoomMessage(f.ctx, f.owner.ID, w.ID, ch.ID, SendChatMessageInput{Body: "root"})
			if err != nil {
				t.Fatal(err)
			}
			task, err := f.tasks.Create(f.ctx, Human(f.owner.ID), w.ID, CreateTaskInput{Title: "unsynced"})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := f.chat.SyncThreadTask(f.ctx, f.owner.ID, w.ID, root.ID, SyncThreadTaskInput{TaskID: task.ID, Direction: "both"}); err != nil {
				t.Fatal(err)
			}
			if err := f.chat.UnsyncThreadTask(f.ctx, f.owner.ID, w.ID, root.ID); err != nil {
				t.Fatal(err)
			}
		},
```

và thêm `audit.ActionChatThreadTaskUnlinked,` vào `auditActions()` ngay sau `audit.ActionChatThreadTaskLinked,`.

- [ ] **Bước 7: Client nghe `chat.thread.unlinked`.** `packages/core/realtime/use-realtime-sync.ts`:

```ts
    case "chat.thread.linked":
    case "chat.thread.unlinked": {
```

(một nhánh, thân giữ nguyên).

- [ ] **Bước 8: Chạy.**

```bash
cd server && go test ./internal/service/ -run 'TestGraphSourceEventsReachTheOutbox|TestEveryAuditedCommandWritesItsRow|TestAgent|TestChat|TestSyncThreadTask|TestWorkspace|TestSendWorkspace|TestResolveDM|TestCreateGroupAndInvite|TestSignalVoiceAndTyping' -count=1 -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)' | tail -60
cd server && go test ./internal/outbox/ ./migrations/ -count=1
node --test scripts/events-catalogue.test.mjs
pnpm --filter @uniwork/core exec vitest run realtime/
```

- [ ] **Bước 9: Commit.**

```bash
git add server/internal/outbox/catalogue.go docs/events/CATALOGUE.md packages/core/types/events.ts \
  server/internal/service/agent.go server/internal/audit/actions.go server/pkg/db/queries/chat_links.sql \
  server/pkg/db/generated/ server/internal/service/chat_links.go server/internal/service/chat.go \
  server/internal/service/audit_coverage_test.go server/internal/service/graph_events_test.go \
  packages/core/realtime/use-realtime-sync.ts
git commit -m "feat(events): agent.* topics, an audited chat.thread.unlinked, default room event

Agent create/update/archive reached audit_events only; thread unsync deleted
its link with no audit row and no event; the default workspace room was
created silently. All three are sources of the Work Graph (C-11 §5.2).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: Query sqlc và arch test "chỉ projector ghi đồ thị"

**Files:**
- Create: `server/pkg/db/queries/graph.sql`, `graph_sources.sql`, `graph_read.sql`
- Regenerate: `server/pkg/db/generated/`
- Modify: `server/internal/arch_test.go`

**Interfaces:**
- Produces (sqlc, package `db`): mọi hàm `Graph*` nêu trong ba file dưới đây, với tham số đặt tên như `sqlc.arg(...)` cho thấy (ví dụ `GraphUpsertNodeParams{ID, OrganizationID, WorkspaceID pgtype.Text, NodeType, Subtype, SourceID, Title, Status, Visibility, ReaderIds []string, OccurredAt, SourceUpdatedAt pgtype.Timestamptz}`).

- [ ] **Bước 1: Arch test đỏ trước.** Thêm vào `server/internal/arch_test.go`:

```go
// The Work Graph is a projection (ADR 0019): only internal/graph/projector
// writes its tables, so rebuilding from the business tables reproduces it.
func TestGraphTablesWrittenOnlyByProjector(t *testing.T) {
	calls := regexp.MustCompile(`\.(Graph(Upsert|Open|Close|Mark|Claim|Done|Release|Fail|Lock)\w*)\(`)
	rawSQL := regexp.MustCompile(`(?i)\b(insert\s+into|update|delete\s+from)\s+graph_`)
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		slash := filepath.ToSlash(path)
		if strings.Contains(slash, "pkg/db/generated") || strings.Contains(slash, "internal/graph/projector/") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if m := calls.FindStringSubmatch(string(src)); m != nil {
			t.Errorf("%s calls %s; only internal/graph/projector writes the Work Graph (ADR 0019)", slash, m[1])
		}
		if rawSQL.Match(src) {
			t.Errorf("%s writes a graph_ table in SQL; only internal/graph/projector may (ADR 0019)", slash)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
```

Test này xanh ngay khi chưa có ai gọi; nó giữ luật cho các task sau. Chạy `cd server && go test ./internal/ -run TestGraphTablesWrittenOnlyByProjector -count=1 -v` → PASS.

- [ ] **Bước 2: `server/pkg/db/queries/graph.sql`** (ghi; chỉ projector gọi):

```sql
-- Work Graph writes (C-11). Only internal/graph/projector calls these
-- (TestGraphTablesWrittenOnlyByProjector).

-- name: GraphLockNode :exec
-- Serializes projections of one node across workers and the rebuild.
SELECT pg_advisory_xact_lock(hashtextextended(sqlc.arg(lock_key)::text, 0));

-- name: GraphGetNodeBySource :one
SELECT * FROM graph_nodes
WHERE organization_id = sqlc.arg(organization_id) AND node_type = sqlc.arg(node_type) AND source_id = sqlc.arg(source_id);

-- name: GraphUpsertNode :one
-- Returns no row when nothing changed: the caller reads the node instead, so
-- a re-projection does not touch updated_at.
INSERT INTO graph_nodes (id, organization_id, workspace_id, node_type, subtype, source_id, title, status,
                         visibility, reader_ids, occurred_at, source_updated_at)
VALUES (sqlc.arg(id), sqlc.arg(organization_id), sqlc.narg(workspace_id), sqlc.arg(node_type), sqlc.arg(subtype),
        sqlc.arg(source_id), sqlc.arg(title), sqlc.arg(status), sqlc.arg(visibility),
        -- pgx sends a nil []string as NULL; the column is NOT NULL.
        COALESCE(sqlc.arg(reader_ids)::text[], '{}'::text[]),
        sqlc.narg(occurred_at), sqlc.narg(source_updated_at))
ON CONFLICT (organization_id, node_type, source_id) DO UPDATE SET
  workspace_id = EXCLUDED.workspace_id, subtype = EXCLUDED.subtype, title = EXCLUDED.title,
  status = EXCLUDED.status, visibility = EXCLUDED.visibility, reader_ids = EXCLUDED.reader_ids,
  occurred_at = EXCLUDED.occurred_at, source_updated_at = EXCLUDED.source_updated_at,
  deleted_at = NULL, updated_at = now()
WHERE (graph_nodes.workspace_id, graph_nodes.subtype, graph_nodes.title, graph_nodes.status, graph_nodes.visibility,
       graph_nodes.reader_ids, graph_nodes.occurred_at, graph_nodes.source_updated_at, graph_nodes.deleted_at)
  IS DISTINCT FROM
      (EXCLUDED.workspace_id, EXCLUDED.subtype, EXCLUDED.title, EXCLUDED.status, EXCLUDED.visibility,
       EXCLUDED.reader_ids, EXCLUDED.occurred_at, EXCLUDED.source_updated_at, NULL::timestamptz)
RETURNING *;

-- name: GraphMarkNodeDeleted :exec
UPDATE graph_nodes SET deleted_at = sqlc.arg(at)::timestamptz, updated_at = now()
WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id) AND deleted_at IS NULL;

-- name: GraphListOpenSystemEdges :many
-- Every open SYSTEM edge touching a node, with the other end named by source.
SELECT e.id, e.edge_type, (e.from_node = sqlc.arg(node_id)::text) AS outgoing,
       p.node_type AS peer_type, p.source_id AS peer_source_id
FROM graph_edges e
JOIN graph_nodes p ON p.id = CASE WHEN e.from_node = sqlc.arg(node_id)::text THEN e.to_node ELSE e.from_node END
WHERE e.organization_id = sqlc.arg(organization_id)
  AND (e.from_node = sqlc.arg(node_id)::text OR e.to_node = sqlc.arg(node_id)::text)
  AND e.origin = 'SYSTEM' AND e.valid_to IS NULL;

-- name: GraphOpenEdge :exec
INSERT INTO graph_edges (id, organization_id, from_node, to_node, edge_type, origin, valid_from,
                         evidence_kind, evidence_id, actor_kind, actor_id, attrs)
VALUES (sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(from_node), sqlc.arg(to_node), sqlc.arg(edge_type),
        sqlc.arg(origin), sqlc.arg(valid_from), sqlc.arg(evidence_kind), sqlc.arg(evidence_id),
        sqlc.arg(actor_kind), sqlc.arg(actor_id), sqlc.arg(attrs)::jsonb)
ON CONFLICT (organization_id, from_node, to_node, edge_type, origin) WHERE valid_to IS NULL DO NOTHING;

-- name: GraphCloseEdge :exec
UPDATE graph_edges
SET valid_to = GREATEST(valid_from, sqlc.arg(valid_to)::timestamptz),
    attrs = attrs || jsonb_build_object('closed_by', sqlc.arg(closed_by)::text)
WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id) AND valid_to IS NULL;

-- name: GraphCloseNodeEdges :exec
-- A deleted source closes every open edge at either end, whatever its origin.
UPDATE graph_edges
SET valid_to = GREATEST(valid_from, sqlc.arg(valid_to)::timestamptz),
    attrs = attrs || jsonb_build_object('closed_by', sqlc.arg(closed_by)::text)
WHERE organization_id = sqlc.arg(organization_id)
  AND (from_node = sqlc.arg(node_id)::text OR to_node = sqlc.arg(node_id)::text) AND valid_to IS NULL;

-- name: GraphListOpenFacts :many
SELECT * FROM graph_node_facts
WHERE organization_id = sqlc.arg(organization_id) AND node_id = sqlc.arg(node_id) AND valid_to IS NULL;

-- name: GraphOpenFact :exec
INSERT INTO graph_node_facts (id, organization_id, node_id, fact_type, value, valid_from, evidence_kind, evidence_id, attrs)
VALUES (sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(node_id), sqlc.arg(fact_type), sqlc.arg(value),
        sqlc.arg(valid_from), sqlc.arg(evidence_kind), sqlc.arg(evidence_id), sqlc.arg(attrs)::jsonb)
ON CONFLICT (organization_id, node_id, fact_type) WHERE valid_to IS NULL DO NOTHING;

-- name: GraphCloseFact :exec
UPDATE graph_node_facts SET valid_to = GREATEST(valid_from, sqlc.arg(valid_to)::timestamptz)
WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id) AND valid_to IS NULL;

-- name: GraphCloseNodeFacts :exec
UPDATE graph_node_facts SET valid_to = GREATEST(valid_from, sqlc.arg(valid_to)::timestamptz)
WHERE organization_id = sqlc.arg(organization_id) AND node_id = sqlc.arg(node_id) AND valid_to IS NULL;

-- name: GraphMarkDirty :exec
-- One upsert per event; node_types[i] pairs with source_ids[i] (deduplicated
-- by the caller: ON CONFLICT cannot touch one row twice in a statement).
INSERT INTO graph_dirty (organization_id, node_type, source_id, last_event_id, last_event_at, actor_kind, actor_id)
SELECT sqlc.arg(organization_id)::text, unnest(sqlc.arg(node_types)::text[]), unnest(sqlc.arg(source_ids)::text[]),
       sqlc.arg(event_id)::text, sqlc.arg(event_at)::timestamptz, sqlc.arg(actor_kind)::text, sqlc.arg(actor_id)::text
ON CONFLICT (organization_id, node_type, source_id) DO UPDATE SET
  mark_seq = graph_dirty.mark_seq + 1,
  last_event_id = EXCLUDED.last_event_id,
  last_event_at = GREATEST(graph_dirty.last_event_at, EXCLUDED.last_event_at),
  actor_kind = EXCLUDED.actor_kind, actor_id = EXCLUDED.actor_id,
  available_at = LEAST(graph_dirty.available_at, now()),
  attempts = 0, last_error = '';

-- name: GraphClaimDirty :many
-- tenant: system
-- The worker claims across organizations; each row carries its own.
UPDATE graph_dirty d
SET locked_until = now() + make_interval(secs => sqlc.arg(lease_seconds)::int), attempts = d.attempts + 1
FROM (
  SELECT organization_id, node_type, source_id FROM graph_dirty
  WHERE available_at <= now() AND (locked_until IS NULL OR locked_until < now())
  ORDER BY available_at
  LIMIT sqlc.arg(batch)::int
  FOR UPDATE SKIP LOCKED
) c
WHERE d.organization_id = c.organization_id AND d.node_type = c.node_type AND d.source_id = c.source_id
RETURNING d.*;

-- name: GraphDoneDirty :execrows
DELETE FROM graph_dirty
WHERE organization_id = sqlc.arg(organization_id) AND node_type = sqlc.arg(node_type)
  AND source_id = sqlc.arg(source_id) AND mark_seq = sqlc.arg(mark_seq);

-- name: GraphReleaseDirty :exec
UPDATE graph_dirty SET locked_until = NULL, attempts = 0
WHERE organization_id = sqlc.arg(organization_id) AND node_type = sqlc.arg(node_type) AND source_id = sqlc.arg(source_id);

-- name: GraphFailDirty :exec
UPDATE graph_dirty SET locked_until = NULL, available_at = sqlc.arg(available_at), last_error = sqlc.arg(last_error)
WHERE organization_id = sqlc.arg(organization_id) AND node_type = sqlc.arg(node_type) AND source_id = sqlc.arg(source_id);

-- name: GraphListOrganizations :many
SELECT id FROM organizations ORDER BY id;

-- name: GraphRebuildLiveSources :many
SELECT source_id FROM graph_nodes
WHERE organization_id = sqlc.arg(organization_id) AND node_type = sqlc.arg(node_type) AND deleted_at IS NULL
  AND source_id > sqlc.arg(after_id)::text
ORDER BY source_id
LIMIT sqlc.arg(limit_n)::int;
```

- [ ] **Bước 3: `server/pkg/db/queries/graph_sources.sql`** (đọc nguồn; ai gọi cũng được, chỉ đọc):

```sql
-- Source reads for the Work Graph projector and rebuild (C-11 §5.3). Every
-- query is scoped by the organization the projection runs for.

-- name: GraphSourceTask :one
SELECT * FROM tasks WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: GraphSourceTaskDependencies :many
-- related is not projected: the vocabulary has no RELATED_TO.
SELECT * FROM task_dependencies
WHERE organization_id = sqlc.arg(organization_id)
  AND (task_id = sqlc.arg(task_id)::text OR depends_on_task_id = sqlc.arg(task_id)::text)
  AND type IN ('blocks', 'blocked_by');

-- name: GraphSourceTaskThreadRooms :many
SELECT DISTINCT room_id FROM chat_thread_task_links
WHERE organization_id = sqlc.arg(organization_id) AND task_id = sqlc.arg(task_id)
ORDER BY room_id;

-- name: GraphSourceChatMessageRoom :one
-- Ignores deleted_at on purpose: a task's origin outlives its message.
SELECT room_id FROM chat_messages WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: GraphSourceMeeting :one
SELECT * FROM meetings WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: GraphSourceMeetingParticipants :many
SELECT DISTINCT user_id::text AS user_id FROM meeting_participants
WHERE organization_id = sqlc.arg(organization_id) AND meeting_id = sqlc.arg(meeting_id)
  AND status = 'ACTIVE' AND user_id IS NOT NULL
ORDER BY 1;

-- name: GraphSourceProject :one
SELECT * FROM projects WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: GraphSourceMember :one
-- A projection read, not a membership decision (that stays in RequireMember).
SELECT m.user_id, m.deactivated_at, m.created_at, u.display_name, p.department_id
FROM organization_members m
JOIN users u ON u.id = m.user_id
LEFT JOIN organization_member_profiles p ON p.organization_id = m.organization_id AND p.user_id = m.user_id
WHERE m.organization_id = sqlc.arg(organization_id) AND m.user_id = sqlc.arg(user_id);

-- name: GraphSourceAgent :one
SELECT * FROM agents WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: GraphSourceDepartment :one
SELECT * FROM departments WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: GraphSourceChatRoom :one
SELECT * FROM chat_rooms WHERE organization_id = sqlc.arg(organization_id) AND id = sqlc.arg(id);

-- name: GraphSourceChatRoomMembers :many
SELECT DISTINCT user_id FROM chat_room_members
WHERE organization_id = sqlc.arg(organization_id) AND room_id = sqlc.arg(room_id)
  AND status = 'active' AND left_at IS NULL
ORDER BY user_id;

-- name: GraphRebuildTaskIDs :many
SELECT id FROM tasks WHERE organization_id = sqlc.arg(organization_id) AND id > sqlc.arg(after_id)::text
ORDER BY id LIMIT sqlc.arg(limit_n)::int;

-- name: GraphRebuildMeetingIDs :many
SELECT id FROM meetings WHERE organization_id = sqlc.arg(organization_id) AND id > sqlc.arg(after_id)::text
ORDER BY id LIMIT sqlc.arg(limit_n)::int;

-- name: GraphRebuildProjectIDs :many
SELECT id FROM projects WHERE organization_id = sqlc.arg(organization_id) AND id > sqlc.arg(after_id)::text
ORDER BY id LIMIT sqlc.arg(limit_n)::int;

-- name: GraphRebuildMemberIDs :many
SELECT user_id FROM organization_members WHERE organization_id = sqlc.arg(organization_id) AND user_id > sqlc.arg(after_id)::text
ORDER BY user_id LIMIT sqlc.arg(limit_n)::int;

-- name: GraphRebuildAgentIDs :many
SELECT id FROM agents WHERE organization_id = sqlc.arg(organization_id) AND id > sqlc.arg(after_id)::text
ORDER BY id LIMIT sqlc.arg(limit_n)::int;

-- name: GraphRebuildDepartmentIDs :many
SELECT id FROM departments WHERE organization_id = sqlc.arg(organization_id) AND id > sqlc.arg(after_id)::text
ORDER BY id LIMIT sqlc.arg(limit_n)::int;

-- name: GraphRebuildChatRoomIDs :many
SELECT id FROM chat_rooms WHERE organization_id = sqlc.arg(organization_id) AND kind <> 'dm' AND id > sqlc.arg(after_id)::text
ORDER BY id LIMIT sqlc.arg(limit_n)::int;
```

- [ ] **Bước 4: `server/pkg/db/queries/graph_read.sql`** (đọc cho API, lớp 1):

```sql
-- Work Graph reads for the API (C-11 §6). Layer 1: same organization, and the
-- node's visibility admits the caller (workspace ids come from
-- OrganizationService.ListWorkspaces, never from a membership join here).

-- name: GraphGetVisibleNode :one
SELECT n.id, n.node_type, n.subtype, n.source_id, n.title, n.status,
       COALESCE(n.workspace_id, '')::text AS workspace_id, COALESCE(w.slug, '')::text AS workspace_slug
FROM graph_nodes n
LEFT JOIN workspaces w ON w.id = n.workspace_id
WHERE n.organization_id = sqlc.arg(organization_id) AND n.node_type = sqlc.arg(node_type)
  AND n.source_id = sqlc.arg(source_id) AND n.deleted_at IS NULL
  AND (n.visibility = 'organization'
       OR (n.visibility = 'workspace' AND n.workspace_id = ANY(sqlc.arg(workspace_ids)::text[]))
       OR (n.visibility IN ('members', 'private') AND n.reader_ids @> ARRAY[sqlc.arg(user_id)::text]));

-- name: GraphListNeighbors :many
SELECT e.id AS edge_id, e.edge_type, e.origin, e.valid_from, e.attrs,
       (e.from_node = sqlc.arg(node_id)::text) AS outgoing,
       p.node_type AS peer_type, p.subtype AS peer_subtype, p.source_id AS peer_source_id,
       p.title AS peer_title, p.status AS peer_status,
       COALESCE(p.workspace_id, '')::text AS peer_workspace_id, COALESCE(w.slug, '')::text AS peer_workspace_slug
FROM graph_edges e
JOIN graph_nodes p ON p.id = CASE WHEN e.from_node = sqlc.arg(node_id)::text THEN e.to_node ELSE e.from_node END
LEFT JOIN workspaces w ON w.id = p.workspace_id
WHERE e.organization_id = sqlc.arg(organization_id)
  AND (e.from_node = sqlc.arg(node_id)::text OR e.to_node = sqlc.arg(node_id)::text)
  -- No at = the database's now(), so an edge the DB just dated is never in the
  -- future of a client clock that runs behind it.
  AND e.valid_from <= COALESCE(sqlc.narg(at)::timestamptz, now())
  AND (e.valid_to IS NULL OR e.valid_to > COALESCE(sqlc.narg(at)::timestamptz, now()))
  AND (cardinality(sqlc.arg(edge_types)::text[]) = 0 OR e.edge_type = ANY(sqlc.arg(edge_types)::text[]))
  AND (sqlc.arg(direction)::text = 'both' OR (sqlc.arg(direction)::text = 'out') = (e.from_node = sqlc.arg(node_id)::text))
  AND p.organization_id = sqlc.arg(organization_id) AND p.deleted_at IS NULL
  AND (p.visibility = 'organization'
       OR (p.visibility = 'workspace' AND p.workspace_id = ANY(sqlc.arg(workspace_ids)::text[]))
       OR (p.visibility IN ('members', 'private') AND p.reader_ids @> ARRAY[sqlc.arg(user_id)::text]))
  AND (sqlc.narg(after_valid_from)::timestamptz IS NULL
       OR (e.valid_from, e.id) < (sqlc.narg(after_valid_from)::timestamptz, sqlc.arg(after_id)::text))
ORDER BY e.valid_from DESC, e.id DESC
LIMIT sqlc.arg(limit_n)::int;

-- name: GraphListNodeHistoryEdges :many
SELECT e.id AS edge_id, e.edge_type, e.origin, e.valid_from, e.valid_to, e.attrs,
       (e.from_node = sqlc.arg(node_id)::text) AS outgoing,
       p.node_type AS peer_type, p.subtype AS peer_subtype, p.source_id AS peer_source_id,
       p.title AS peer_title, p.status AS peer_status, (p.deleted_at IS NOT NULL)::boolean AS peer_deleted,
       COALESCE(p.workspace_id, '')::text AS peer_workspace_id, COALESCE(w.slug, '')::text AS peer_workspace_slug
FROM graph_edges e
JOIN graph_nodes p ON p.id = CASE WHEN e.from_node = sqlc.arg(node_id)::text THEN e.to_node ELSE e.from_node END
LEFT JOIN workspaces w ON w.id = p.workspace_id
WHERE e.organization_id = sqlc.arg(organization_id)
  AND (e.from_node = sqlc.arg(node_id)::text OR e.to_node = sqlc.arg(node_id)::text)
  AND e.edge_type = ANY(sqlc.arg(edge_types)::text[])
  AND (p.deleted_at IS NULL OR p.node_type IN ('ACTOR', 'TEAM'))
  AND (p.visibility = 'organization'
       OR (p.visibility = 'workspace' AND p.workspace_id = ANY(sqlc.arg(workspace_ids)::text[]))
       OR (p.visibility IN ('members', 'private') AND p.reader_ids @> ARRAY[sqlc.arg(user_id)::text]))
  AND (sqlc.narg(from_at)::timestamptz IS NULL OR e.valid_to IS NULL OR e.valid_to >= sqlc.narg(from_at)::timestamptz)
  AND (sqlc.narg(to_at)::timestamptz IS NULL OR e.valid_from <= sqlc.narg(to_at)::timestamptz)
ORDER BY e.valid_from, e.id
LIMIT 500;

-- name: GraphListNodeHistoryFacts :many
SELECT * FROM graph_node_facts
WHERE organization_id = sqlc.arg(organization_id) AND node_id = sqlc.arg(node_id)
  AND (sqlc.narg(from_at)::timestamptz IS NULL OR valid_to IS NULL OR valid_to >= sqlc.narg(from_at)::timestamptz)
  AND (sqlc.narg(to_at)::timestamptz IS NULL OR valid_from <= sqlc.narg(to_at)::timestamptz)
ORDER BY valid_from, id
LIMIT 500;
```

- [ ] **Bước 5: Sinh mã và kiểm luật query.**

```bash
make sqlc
cd server && go build ./... && go test ./migrations/ -run 'TestEveryQueryNamesItsTenant|TestTenantReasonsSitOnTenantQueries' -count=1 -v
```

Nếu `TestEveryQueryNamesItsTenant` đòi lý do cho `GraphMarkDirty` (một `INSERT … SELECT` không có `FROM`), thêm `-- tenant: system` ngay dưới dòng `-- name:` của nó, kèm một dòng giải thích "organization comes from the outbox row". Nếu `TestTenantReasonsSitOnTenantQueries` báo một dòng tenant thừa, xóa dòng đó. Không thêm lý do cho query nào khác ngoài hai test này đòi.

- [ ] **Bước 6: Commit.**

```bash
git add server/pkg/db/queries/graph*.sql server/pkg/db/generated/ server/internal/arch_test.go
git commit -m "feat(graph): sqlc queries for projection, rebuild and reads

Writes live in graph.sql and only internal/graph/projector may call them
(new arch test, which also fences raw SQL into graph_ tables). Layer-1 reads
filter by visibility with reader_ids @> ARRAY[user] so the GIN index serves.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: Lõi projector: trạng thái mong muốn và đối chiếu

**Files:**
- Create: `server/internal/graph/projector/types.go`, `scope.go`, `load.go`, `load_task.go`, `load_meeting.go`, `load_project.go`, `load_actor.go`, `load_team.go`, `load_thread.go`, `reconcile.go`
- Create: `server/internal/graph/projector/dirty.go`
- Test: `server/internal/graph/projector/load_test.go` (test tích hợp của lõi nằm ở Task 6, vì fixture cần marker và worker)

**Interfaces:**
- Consumes: query `Graph*` (Task 4), `graph.*` (Task 1).
- Produces: `projector.NodeRef{Type graph.NodeType; SourceID string}`; `projector.EventInfo{EvidenceKind, EvidenceID string; At time.Time; ActorKind, ActorID string}`; `projector.Drift{MissingNodes, ExtraNodes, ChangedNodes, MissingEdges, ExtraEdges, MissingFacts, ExtraFacts, ChangedFacts int}` với `Total() int`, `Add(Drift)`; `projector.Project(ctx, q *db.Queries, org string, ref NodeRef, ev EventInfo) (Drift, error)`; `projector.Verify(ctx, q, org string, ref NodeRef) (Drift, error)`; hằng `projector.EvidenceOutboxEvent = "outbox_event"`, `projector.EvidenceSourceRow = "source_row"`.

- [ ] **Bước 1: Kiểu và phạm vi.** `server/internal/graph/projector/types.go`:

```go
// Package projector is the only writer of the Work Graph (C-11, ADR 0019).
// It reads a node's source row, computes what the graph should hold for it
// (Desired), compares with the open edges and facts, closes what is no longer
// true and opens what is missing. The marker consumer and the worker feed it
// from the outbox; cmd/graph-rebuild runs the same reconcile over a whole
// organization.
package projector

import (
	"time"

	"github.com/unicomhub/uniwork/server/internal/graph"
)

// Evidence kinds a projected edge or fact can cite.
const (
	EvidenceOutboxEvent = "outbox_event"
	EvidenceSourceRow   = "source_row"
)

// NodeRef names a node by its source row inside one organization.
type NodeRef struct {
	Type     graph.NodeType
	SourceID string
}

func (r NodeRef) key() string { return string(r.Type) + ":" + r.SourceID }

// NodeState is what a node should look like, read from its source.
type NodeState struct {
	Ref             NodeRef
	WorkspaceID     string // "" for organization-level nodes
	Subtype         string
	Title           string
	Status          string
	Visibility      string
	ReaderIDs       []string
	OccurredAt      time.Time
	SourceUpdatedAt time.Time
}

// EdgeWant is one SYSTEM edge the node's projection owns. Out is the
// direction seen from the node: true when the node is the from end.
type EdgeWant struct {
	Type graph.EdgeType
	Out  bool
	Peer NodeRef
}

func (e EdgeWant) key() string {
	dir := "<"
	if e.Out {
		dir = ">"
	}
	return string(e.Type) + dir + e.Peer.key()
}

// FactWant is one open fact the node should carry.
type FactWant struct {
	Type      string
	Value     string
	Precision string // "date" | "datetime" for due; "" otherwise
}

// Desired is a node's projection computed from its source. Node nil means the
// source is gone or is not projected (a DM room): the node is deleted. Peers
// are the owners of incoming edges this source implies (the from end of a
// dependency on this task); reconcile marks a peer dirty only when its edge
// and the source disagree, so two tasks never re-mark each other forever.
type Desired struct {
	Node  *NodeState
	Edges []EdgeWant
	Facts []FactWant
	Peers []NodeRef
	seen  map[string]bool
}

func (d *Desired) edge(t graph.EdgeType, out bool, peerType graph.NodeType, peerID string) {
	if peerID == "" || (d.Node != nil && peerType == d.Node.Ref.Type && peerID == d.Node.Ref.SourceID) {
		return
	}
	w := EdgeWant{Type: t, Out: out, Peer: NodeRef{Type: peerType, SourceID: peerID}}
	if d.seen == nil {
		d.seen = map[string]bool{}
	}
	if d.seen[w.key()] {
		return
	}
	d.seen[w.key()] = true
	d.Edges = append(d.Edges, w)
}

// EventInfo is why a projection runs: the newest outbox event folded into a
// dirty row, or a rebuild (EvidenceSourceRow, At zero).
type EventInfo struct {
	EvidenceKind string
	EvidenceID   string
	At           time.Time
	ActorKind    string
	ActorID      string
	// fresh is set by reconcile when this projection brings the node to life;
	// a rebuild then dates new edges by the source, not by today.
	fresh bool
}

func (e EventInfo) evidence(ref NodeRef) string {
	if e.EvidenceKind == EvidenceSourceRow || e.EvidenceID == "" {
		return ref.SourceID
	}
	return e.EvidenceID
}

// openAt is the business time a new edge or fact starts, and whether it is a
// backfill (the source predates the graph; the true start is unknown).
func (e EventInfo) openAt(n NodeState) (time.Time, bool) {
	if !e.At.IsZero() {
		return e.At, false
	}
	now := time.Now().UTC()
	// A source dated in the future (an upcoming meeting's start) is clamped to
	// now: a relation that exists today must not read as not yet valid.
	if e.fresh && !n.OccurredAt.IsZero() && n.OccurredAt.Before(now) {
		return n.OccurredAt, true
	}
	return now, false
}

func (e EventInfo) closeAt() time.Time {
	if !e.At.IsZero() {
		return e.At
	}
	return time.Now().UTC()
}

// Drift counts what a projection changed (Project) or would change (Verify).
type Drift struct {
	MissingNodes int `json:"missing_nodes"`
	ExtraNodes   int `json:"extra_nodes"`
	ChangedNodes int `json:"changed_nodes"`
	MissingEdges int `json:"missing_edges"`
	ExtraEdges   int `json:"extra_edges"`
	MissingFacts int `json:"missing_facts"`
	ExtraFacts   int `json:"extra_facts"`
	ChangedFacts int `json:"changed_facts"`
}

// Total is the number of rows that differ.
func (d Drift) Total() int {
	return d.MissingNodes + d.ExtraNodes + d.ChangedNodes + d.MissingEdges + d.ExtraEdges +
		d.MissingFacts + d.ExtraFacts + d.ChangedFacts
}

// Add folds o into d.
func (d *Drift) Add(o Drift) {
	d.MissingNodes += o.MissingNodes
	d.ExtraNodes += o.ExtraNodes
	d.ChangedNodes += o.ChangedNodes
	d.MissingEdges += o.MissingEdges
	d.ExtraEdges += o.ExtraEdges
	d.MissingFacts += o.MissingFacts
	d.ExtraFacts += o.ExtraFacts
	d.ChangedFacts += o.ChangedFacts
}
```

`server/internal/graph/projector/scope.go`:

```go
package projector

import "github.com/unicomhub/uniwork/server/internal/graph"

type scope struct {
	edge graph.EdgeType
	out  bool
}

// edgeScopes says which SYSTEM edges each node type's projection owns. Every
// SYSTEM edge has exactly one owner end, so two projections never fight over
// it (spec §13 #11). A dependency event names one task; the owner of
// DEPENDS_ON is the from end, and projecting either end marks the other dirty.
var edgeScopes = map[graph.NodeType][]scope{
	graph.NodeTask: {
		{graph.EdgeBelongsTo, true}, {graph.EdgeOwnedBy, true}, {graph.EdgeDependsOn, true},
		{graph.EdgeOriginatedFrom, true}, {graph.EdgeDiscussedIn, true},
	},
	graph.NodeMeeting: {{graph.EdgeBelongsTo, true}, {graph.EdgeParticipatedIn, false}},
	graph.NodeProject: {{graph.EdgeOwnedBy, true}},
	graph.NodeActor:   {{graph.EdgeBelongsTo, true}},
	graph.NodeTeam:    {{graph.EdgeBelongsTo, true}},
	graph.NodeThread:  nil,
}

// factScopes says which facts each node type carries.
var factScopes = map[graph.NodeType][]string{
	graph.NodeTask:    {graph.FactDue, graph.FactStatus},
	graph.NodeMeeting: {graph.FactStatus},
	graph.NodeProject: {graph.FactStatus},
}

func inScope(t graph.NodeType, e graph.EdgeType, out bool) bool {
	for _, s := range edgeScopes[t] {
		if s.edge == e && s.out == out {
			return true
		}
	}
	return false
}
```

- [ ] **Bước 2: Test đơn vị đỏ cho các hàm thuần.** `server/internal/graph/projector/load_test.go`:

```go
package projector

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestDueFactPrefersTheTimestamp(t *testing.T) {
	at := time.Date(2026, 10, 20, 9, 30, 0, 0, time.FixedZone("ICT", 7*3600))
	task := db.Task{
		DueAt:   pgtype.Timestamptz{Time: at, Valid: true},
		DueDate: pgtype.Date{Time: time.Date(2026, 10, 19, 0, 0, 0, 0, time.UTC), Valid: true},
	}
	f, ok := dueFact(task)
	if !ok || f.Value != "2026-10-20T02:30:00Z" || f.Precision != "datetime" {
		t.Fatalf("due = %+v", f)
	}
	task.DueAt = pgtype.Timestamptz{}
	if f, ok = dueFact(task); !ok || f.Value != "2026-10-19" || f.Precision != "date" {
		t.Fatalf("date due = %+v", f)
	}
	if _, ok = dueFact(db.Task{}); ok {
		t.Fatal("no due, no fact")
	}
}

func TestAssigneeRef(t *testing.T) {
	text := func(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }
	cases := []struct {
		typ, id string
		ok      bool
	}{{"member", "u1", true}, {"agent", "a1", true}, {"", "u1", true}, {"squad", "s1", false}, {"member", "", false}}
	for _, c := range cases {
		ref, ok := assigneeRef(db.Task{AssigneeType: text(c.typ), AssigneeID: text(c.id)})
		if ok != c.ok || (ok && (ref.Type != graph.NodeActor || ref.SourceID != c.id)) {
			t.Errorf("assigneeRef(%q, %q) = %+v, %v", c.typ, c.id, ref, ok)
		}
	}
}

func TestDesiredDeduplicatesAndSkipsSelf(t *testing.T) {
	d := Desired{Node: &NodeState{Ref: NodeRef{Type: graph.NodeTask, SourceID: "t1"}}}
	d.edge(graph.EdgeDependsOn, true, graph.NodeTask, "t2")
	d.edge(graph.EdgeDependsOn, true, graph.NodeTask, "t2")
	d.edge(graph.EdgeBelongsTo, true, graph.NodeTask, "t1")
	d.edge(graph.EdgeBelongsTo, true, graph.NodeProject, "")
	if len(d.Edges) != 1 {
		t.Fatalf("edges = %+v", d.Edges)
	}
}

func TestInScope(t *testing.T) {
	if !inScope(graph.NodeMeeting, graph.EdgeParticipatedIn, false) || inScope(graph.NodeTask, graph.EdgeDependsOn, false) {
		t.Fatal("scopes")
	}
}
```

Chạy `cd server && go test ./internal/graph/projector/ -run 'TestDueFact|TestAssigneeRef|TestDesired|TestInScope' -count=1 -v` → đỏ (chưa có `dueFact`, `assigneeRef`).

- [ ] **Bước 3: Bộ nạp theo loại.** `server/internal/graph/projector/load.go`:

```go
package projector

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// load reads ref's source and returns what the graph should hold for it.
func load(ctx context.Context, q *db.Queries, org string, ref NodeRef) (Desired, error) {
	switch ref.Type {
	case graph.NodeTask:
		return loadTask(ctx, q, org, ref.SourceID)
	case graph.NodeMeeting:
		return loadMeeting(ctx, q, org, ref.SourceID)
	case graph.NodeProject:
		return loadProject(ctx, q, org, ref.SourceID)
	case graph.NodeActor:
		return loadActor(ctx, q, org, ref.SourceID)
	case graph.NodeTeam:
		return loadTeam(ctx, q, org, ref.SourceID)
	case graph.NodeThread:
		return loadThread(ctx, q, org, ref.SourceID)
	}
	return Desired{}, fmt.Errorf("graph: %s is not projected in slice 1", ref.Type)
}

func timeOf(t pgtype.Timestamptz) time.Time {
	if !t.Valid {
		return time.Time{}
	}
	return t.Time.UTC()
}

func textOf(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}

// sortedUnique never returns nil: pgx encodes a nil []string as SQL NULL.
func sortedUnique(ids []string) []string {
	out := append([]string{}, ids...)
	slices.Sort(out)
	return slices.Compact(out)
}
```

`server/internal/graph/projector/load_task.go`:

```go
package projector

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func loadTask(ctx context.Context, q *db.Queries, org, id string) (Desired, error) {
	t, err := q.GraphSourceTask(ctx, db.GraphSourceTaskParams{OrganizationID: org, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return Desired{}, nil
	}
	if err != nil {
		return Desired{}, err
	}
	d := Desired{Node: &NodeState{
		Ref: NodeRef{Type: graph.NodeTask, SourceID: t.ID}, WorkspaceID: t.WorkspaceID,
		Title: t.Title, Status: t.Status, Visibility: graph.VisWorkspace,
		OccurredAt: timeOf(t.CreatedAt), SourceUpdatedAt: timeOf(t.UpdatedAt),
	}}
	d.edge(graph.EdgeBelongsTo, true, graph.NodeProject, strings.TrimSpace(textOf(t.ProjectID)))
	d.edge(graph.EdgeBelongsTo, true, graph.NodeTask, strings.TrimSpace(textOf(t.ParentTaskID)))
	if ref, ok := assigneeRef(t); ok {
		d.edge(graph.EdgeOwnedBy, true, ref.Type, ref.SourceID)
	}
	deps, err := q.GraphSourceTaskDependencies(ctx, db.GraphSourceTaskDependenciesParams{OrganizationID: org, TaskID: t.ID})
	if err != nil {
		return Desired{}, err
	}
	for _, dep := range deps {
		// blocked_by(A,B): A depends on B → A→B. blocks(A,B): B depends on A → B→A.
		from, to := dep.TaskID, dep.DependsOnTaskID
		if dep.Type == "blocks" {
			from, to = dep.DependsOnTaskID, dep.TaskID
		}
		switch {
		case from == t.ID && to != t.ID:
			d.edge(graph.EdgeDependsOn, true, graph.NodeTask, to)
		case to == t.ID && from != t.ID:
			// from owns the edge from→t; reconcile marks it only if that edge
			// is not open yet.
			d.Peers = append(d.Peers, NodeRef{Type: graph.NodeTask, SourceID: from})
		}
	}
	origin := strings.TrimSpace(textOf(t.OriginID))
	switch textOf(t.OriginType) {
	case "meeting":
		d.edge(graph.EdgeOriginatedFrom, true, graph.NodeMeeting, origin)
	case "chat_message":
		if origin != "" {
			room, err := q.GraphSourceChatMessageRoom(ctx, db.GraphSourceChatMessageRoomParams{OrganizationID: org, ID: origin})
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return Desired{}, err
			}
			d.edge(graph.EdgeOriginatedFrom, true, graph.NodeThread, room)
		}
		// "email_thread": the email THREAD node arrives with slice 2.
	}
	rooms, err := q.GraphSourceTaskThreadRooms(ctx, db.GraphSourceTaskThreadRoomsParams{OrganizationID: org, TaskID: t.ID})
	if err != nil {
		return Desired{}, err
	}
	for _, r := range rooms {
		d.edge(graph.EdgeDiscussedIn, true, graph.NodeThread, r)
	}
	if f, ok := dueFact(t); ok {
		d.Facts = append(d.Facts, f)
	}
	d.Facts = append(d.Facts, FactWant{Type: graph.FactStatus, Value: t.Status})
	return d, nil
}

// assigneeRef is the ACTOR a task is owned by. Members and agents are
// actors; a squad is not in C-11. A legacy row with an id but no type is a
// member.
func assigneeRef(t db.Task) (NodeRef, bool) {
	id := strings.TrimSpace(textOf(t.AssigneeID))
	if id == "" {
		return NodeRef{}, false
	}
	switch textOf(t.AssigneeType) {
	case "member", "agent", "":
		return NodeRef{Type: graph.NodeActor, SourceID: id}, true
	}
	return NodeRef{}, false
}

// dueFact: due_at when set (an instant, stored in UTC), else due_date as a
// calendar date with precision "date" — never shifted through a time zone.
func dueFact(t db.Task) (FactWant, bool) {
	if t.DueAt.Valid {
		return FactWant{Type: graph.FactDue, Value: t.DueAt.Time.UTC().Format(time.RFC3339), Precision: "datetime"}, true
	}
	if t.DueDate.Valid {
		return FactWant{Type: graph.FactDue, Value: t.DueDate.Time.Format("2006-01-02"), Precision: "date"}, true
	}
	return FactWant{}, false
}
```

`load_meeting.go`:

```go
package projector

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// loadMeeting: a canceled meeting keeps its node (status CANCELED), because
// meeting.deleted fires on every cancel and the two cannot be told apart.
func loadMeeting(ctx context.Context, q *db.Queries, org, id string) (Desired, error) {
	m, err := q.GraphSourceMeeting(ctx, db.GraphSourceMeetingParams{OrganizationID: org, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return Desired{}, nil
	}
	if err != nil {
		return Desired{}, err
	}
	d := Desired{Node: &NodeState{
		Ref: NodeRef{Type: graph.NodeMeeting, SourceID: m.ID}, WorkspaceID: m.WorkspaceID,
		Title: m.Title, Status: m.Status, Visibility: graph.VisWorkspace,
		OccurredAt: timeOf(m.StartsAt), SourceUpdatedAt: timeOf(m.UpdatedAt),
	}}
	// '' was how a cleared project used to be stored: no project.
	d.edge(graph.EdgeBelongsTo, true, graph.NodeProject, strings.TrimSpace(textOf(m.ProjectID)))
	users, err := q.GraphSourceMeetingParticipants(ctx, db.GraphSourceMeetingParticipantsParams{OrganizationID: org, MeetingID: m.ID})
	if err != nil {
		return Desired{}, err
	}
	for _, u := range users {
		d.edge(graph.EdgeParticipatedIn, false, graph.NodeActor, u)
	}
	d.Facts = []FactWant{{Type: graph.FactStatus, Value: m.Status}}
	return d, nil
}
```

`load_project.go`:

```go
package projector

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func loadProject(ctx context.Context, q *db.Queries, org, id string) (Desired, error) {
	p, err := q.GraphSourceProject(ctx, db.GraphSourceProjectParams{OrganizationID: org, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return Desired{}, nil
	}
	if err != nil {
		return Desired{}, err
	}
	d := Desired{Node: &NodeState{
		Ref: NodeRef{Type: graph.NodeProject, SourceID: p.ID}, WorkspaceID: p.WorkspaceID,
		Title: p.Title, Status: p.Status, Visibility: graph.VisWorkspace,
		OccurredAt: timeOf(p.CreatedAt), SourceUpdatedAt: timeOf(p.UpdatedAt),
	}}
	if lt := textOf(p.LeadType); lt == "member" || lt == "agent" {
		d.edge(graph.EdgeOwnedBy, true, graph.NodeActor, textOf(p.LeadID))
	}
	d.Facts = []FactWant{{Type: graph.FactStatus, Value: p.Status}}
	return d, nil
}
```

`load_actor.go`:

```go
package projector

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// loadActor: an id is a member of the organization or one of its agents
// (ULIDs never collide). A deactivated member keeps their node with status
// "deactivated" — they still own their work; one who left, and an archived
// agent, are deleted.
func loadActor(ctx context.Context, q *db.Queries, org, id string) (Desired, error) {
	m, err := q.GraphSourceMember(ctx, db.GraphSourceMemberParams{OrganizationID: org, UserID: id})
	if err == nil {
		status := "active"
		if m.DeactivatedAt.Valid {
			status = "deactivated"
		}
		d := Desired{Node: &NodeState{
			Ref: NodeRef{Type: graph.NodeActor, SourceID: m.UserID}, Subtype: graph.SubtypeMember,
			Title: m.DisplayName, Status: status, Visibility: graph.VisOrganization, OccurredAt: timeOf(m.CreatedAt),
		}}
		d.edge(graph.EdgeBelongsTo, true, graph.NodeTeam, textOf(m.DepartmentID))
		return d, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Desired{}, err
	}
	a, err := q.GraphSourceAgent(ctx, db.GraphSourceAgentParams{OrganizationID: org, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return Desired{}, nil
	}
	if err != nil {
		return Desired{}, err
	}
	if a.Status == "archived" || a.ArchivedAt.Valid {
		return Desired{}, nil
	}
	return Desired{Node: &NodeState{
		Ref: NodeRef{Type: graph.NodeActor, SourceID: a.ID}, Subtype: graph.SubtypeAgent,
		Title: a.Name, Status: a.Status, Visibility: graph.VisOrganization,
		OccurredAt: timeOf(a.CreatedAt), SourceUpdatedAt: timeOf(a.UpdatedAt),
	}}, nil
}
```

`load_team.go`:

```go
package projector

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func loadTeam(ctx context.Context, q *db.Queries, org, id string) (Desired, error) {
	dep, err := q.GraphSourceDepartment(ctx, db.GraphSourceDepartmentParams{OrganizationID: org, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return Desired{}, nil
	}
	if err != nil {
		return Desired{}, err
	}
	if dep.ArchivedAt.Valid {
		return Desired{}, nil
	}
	d := Desired{Node: &NodeState{
		Ref: NodeRef{Type: graph.NodeTeam, SourceID: dep.ID}, Title: dep.Name, Status: "active",
		Visibility: graph.VisOrganization, OccurredAt: timeOf(dep.CreatedAt), SourceUpdatedAt: timeOf(dep.UpdatedAt),
	}}
	d.edge(graph.EdgeBelongsTo, true, graph.NodeTeam, textOf(dep.ParentID))
	return d, nil
}
```

`load_thread.go`:

```go
package projector

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// loadThread projects a chat room. DMs are never nodes (spec §4.1); an
// archived channel is deleted. A public channel or the workspace room is
// readable by the workspace; a private channel or a group by its active
// members only (spec §4.4).
func loadThread(ctx context.Context, q *db.Queries, org, id string) (Desired, error) {
	r, err := q.GraphSourceChatRoom(ctx, db.GraphSourceChatRoomParams{OrganizationID: org, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return Desired{}, nil
	}
	if err != nil {
		return Desired{}, err
	}
	if r.Kind == "dm" || r.ArchivedAt.Valid {
		return Desired{}, nil
	}
	n := &NodeState{
		Ref: NodeRef{Type: graph.NodeThread, SourceID: r.ID}, WorkspaceID: textOf(r.WorkspaceID),
		Subtype: graph.SubtypeChatRoom, Title: r.Name, Status: "active", Visibility: graph.VisWorkspace,
		OccurredAt: timeOf(r.CreatedAt), SourceUpdatedAt: timeOf(r.UpdatedAt),
	}
	if !(r.Kind == "workspace" || (r.Kind == "channel" && r.Visibility == "public")) {
		members, err := q.GraphSourceChatRoomMembers(ctx, db.GraphSourceChatRoomMembersParams{OrganizationID: org, RoomID: r.ID})
		if err != nil {
			return Desired{}, err
		}
		n.Visibility = graph.VisMembers
		n.ReaderIDs = members
	}
	return Desired{Node: n}, nil
}
```

- [ ] **Bước 4: Đối chiếu.** `server/internal/graph/projector/reconcile.go`:

```go
package projector

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/graph"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Project brings one node's slice of the graph in line with its source, on
// q's transaction. Running it twice for the same source writes nothing the
// second time.
func Project(ctx context.Context, q *db.Queries, org string, ref NodeRef, ev EventInfo) (Drift, error) {
	return reconcile(ctx, q, org, ref, ev, true)
}

// Verify counts what Project would change, writing nothing.
func Verify(ctx context.Context, q *db.Queries, org string, ref NodeRef) (Drift, error) {
	return reconcile(ctx, q, org, ref, EventInfo{EvidenceKind: EvidenceSourceRow}, false)
}

func lockKey(org string, ref NodeRef) string { return "graph:" + org + ":" + ref.key() }

// bareNode reports whether a live node has no open in-scope SYSTEM edge and
// no open fact.
func bareNode(ctx context.Context, q *db.Queries, org, nodeID string, t graph.NodeType) (bool, error) {
	edges, err := q.GraphListOpenSystemEdges(ctx, db.GraphListOpenSystemEdgesParams{OrganizationID: org, NodeID: nodeID})
	if err != nil {
		return false, err
	}
	for _, e := range edges {
		if inScope(t, graph.EdgeType(e.EdgeType), e.Outgoing) {
			return false, nil
		}
	}
	facts, err := q.GraphListOpenFacts(ctx, db.GraphListOpenFactsParams{OrganizationID: org, NodeID: nodeID})
	if err != nil {
		return false, err
	}
	return len(facts) == 0, nil
}

func reconcile(ctx context.Context, q *db.Queries, org string, ref NodeRef, ev EventInfo, write bool) (Drift, error) {
	var drift Drift
	if write {
		if err := q.GraphLockNode(ctx, lockKey(org, ref)); err != nil {
			return drift, err
		}
	}
	want, err := load(ctx, q, org, ref)
	if err != nil {
		return drift, err
	}
	cur, err := q.GraphGetNodeBySource(ctx, db.GraphGetNodeBySourceParams{
		OrganizationID: org, NodeType: string(ref.Type), SourceID: ref.SourceID,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return drift, err
	}
	live := err == nil && !cur.DeletedAt.Valid

	if want.Node == nil {
		if live {
			drift.ExtraNodes++
			if write {
				if err := deleteNode(ctx, q, org, cur.ID, ref, ev); err != nil {
					return drift, err
				}
			}
		}
		return drift, nil
	}
	switch {
	case !live:
		drift.MissingNodes++
	case nodeDiffers(cur, *want.Node):
		drift.ChangedNodes++
	}
	ev.fresh = !live
	if live && ev.At.IsZero() {
		// A node resolvePeer created moments ago (in this rebuild) has a row
		// but no open edges or facts: its history is dated by the source too.
		bare, err := bareNode(ctx, q, org, cur.ID, ref.Type)
		if err != nil {
			return drift, err
		}
		ev.fresh = bare
	}
	nodeID := cur.ID
	if write {
		row, err := upsertNode(ctx, q, org, *want.Node)
		if err != nil {
			return drift, err
		}
		nodeID = row.ID
	} else if !live {
		drift.MissingEdges += len(want.Edges)
		drift.MissingFacts += len(want.Facts)
		return drift, nil
	}
	e, err := reconcileEdges(ctx, q, org, nodeID, ref, want, ev, write)
	drift.Add(e)
	if err != nil {
		return drift, err
	}
	f, err := reconcileFacts(ctx, q, org, nodeID, ref, want, ev, write)
	drift.Add(f)
	return drift, err
}

func reconcileEdges(ctx context.Context, q *db.Queries, org, nodeID string, ref NodeRef, want Desired, ev EventInfo, write bool) (Drift, error) {
	var drift Drift
	rows, err := q.GraphListOpenSystemEdges(ctx, db.GraphListOpenSystemEdgesParams{OrganizationID: org, NodeID: nodeID})
	if err != nil {
		return drift, err
	}
	current := map[string]db.GraphListOpenSystemEdgesRow{}
	incoming := map[string]NodeRef{} // owners of open DEPENDS_ON edges into this node
	for _, r := range rows {
		w := EdgeWant{Type: graph.EdgeType(r.EdgeType), Out: r.Outgoing,
			Peer: NodeRef{Type: graph.NodeType(r.PeerType), SourceID: r.PeerSourceID}}
		if w.Type == graph.EdgeDependsOn && !w.Out {
			incoming[w.Peer.key()] = w.Peer
		}
		if inScope(ref.Type, w.Type, w.Out) {
			current[w.key()] = r
		}
	}
	// Resolve wanted peers first: an edge to a source that no longer exists is
	// not wanted, so it is closed rather than kept.
	wanted := map[string]EdgeWant{}
	peerIDs := map[string]string{}
	for _, w := range want.Edges {
		if _, ok := current[w.key()]; ok {
			wanted[w.key()] = w
			continue
		}
		id, ok, err := resolvePeer(ctx, q, org, w.Peer, ev, write)
		if err != nil {
			return drift, err
		}
		if ok {
			wanted[w.key()] = w
			peerIDs[w.key()] = id
		}
	}
	for k, r := range current {
		if _, ok := wanted[k]; ok {
			continue
		}
		drift.ExtraEdges++
		if write {
			if err := q.GraphCloseEdge(ctx, db.GraphCloseEdgeParams{
				OrganizationID: org, ID: r.ID, ValidTo: ts(ev.closeAt()), ClosedBy: ev.evidence(ref),
			}); err != nil {
				return drift, err
			}
		}
	}
	for k, w := range wanted {
		if _, ok := current[k]; ok {
			continue
		}
		drift.MissingEdges++
		if !write {
			continue
		}
		from, to := nodeID, peerIDs[k]
		if !w.Out {
			from, to = to, from
		}
		at, backfill := ev.openAt(*want.Node)
		if err := q.GraphOpenEdge(ctx, db.GraphOpenEdgeParams{
			ID: util.NewID(), OrganizationID: org, FromNode: from, ToNode: to, EdgeType: string(w.Type),
			Origin: graph.OriginSystem, ValidFrom: ts(at), EvidenceKind: ev.EvidenceKind, EvidenceID: ev.evidence(ref),
			ActorKind: ev.ActorKind, ActorID: ev.ActorID, Attrs: attrs(backfill, ev, nil),
		}); err != nil {
			return drift, err
		}
	}
	if write && ev.EvidenceKind == EvidenceOutboxEvent {
		// Mark only the owners whose edge disagrees with the rows: a row with
		// no open edge yet, or an open edge whose row is gone. Marking every
		// peer on every write would make two dependent tasks re-mark each
		// other forever.
		wantIn := map[string]NodeRef{}
		for _, p := range want.Peers {
			wantIn[p.key()] = p
		}
		var stale []NodeRef
		for k, p := range wantIn {
			if _, ok := incoming[k]; !ok {
				stale = append(stale, p)
			}
		}
		for k, p := range incoming {
			if _, ok := wantIn[k]; !ok {
				stale = append(stale, p)
			}
		}
		if err := markDirty(ctx, q, org, stale, ev); err != nil {
			return drift, err
		}
	}
	return drift, nil
}

func reconcileFacts(ctx context.Context, q *db.Queries, org, nodeID string, ref NodeRef, want Desired, ev EventInfo, write bool) (Drift, error) {
	var drift Drift
	types := factScopes[ref.Type]
	if len(types) == 0 {
		return drift, nil
	}
	rows, err := q.GraphListOpenFacts(ctx, db.GraphListOpenFactsParams{OrganizationID: org, NodeID: nodeID})
	if err != nil {
		return drift, err
	}
	cur := map[string]db.GraphNodeFact{}
	for _, r := range rows {
		cur[r.FactType] = r
	}
	wants := map[string]FactWant{}
	for _, f := range want.Facts {
		wants[f.Type] = f
	}
	closeFact := func(c db.GraphNodeFact) error {
		return q.GraphCloseFact(ctx, db.GraphCloseFactParams{OrganizationID: org, ID: c.ID, ValidTo: ts(ev.closeAt())})
	}
	openFact := func(w FactWant, prev *db.GraphNodeFact) error {
		at, backfill := ev.openAt(*want.Node)
		extra := map[string]any{}
		if w.Precision != "" {
			extra["precision"] = w.Precision
		}
		if prev != nil {
			extra["previous"] = prev.Value
			if p := factPrecision(*prev); p != "" {
				extra["previous_precision"] = p
			}
		}
		return q.GraphOpenFact(ctx, db.GraphOpenFactParams{
			ID: util.NewID(), OrganizationID: org, NodeID: nodeID, FactType: w.Type, Value: w.Value,
			ValidFrom: ts(at), EvidenceKind: ev.EvidenceKind, EvidenceID: ev.evidence(ref), Attrs: attrs(backfill, ev, extra),
		})
	}
	for _, t := range types {
		c, has := cur[t]
		w, wanted := wants[t]
		switch {
		case has && !wanted:
			drift.ExtraFacts++
			if write {
				if err := closeFact(c); err != nil {
					return drift, err
				}
			}
		case wanted && !has:
			drift.MissingFacts++
			if write {
				if err := openFact(w, nil); err != nil {
					return drift, err
				}
			}
		case has && wanted && (c.Value != w.Value || factPrecision(c) != w.Precision):
			drift.ChangedFacts++
			if write {
				if err := closeFact(c); err != nil {
					return drift, err
				}
				if err := openFact(w, &c); err != nil {
					return drift, err
				}
			}
		}
	}
	return drift, nil
}

// resolvePeer finds the live node for ref, projecting its node row from the
// source when the graph does not have it yet (an event the marker never saw,
// such as the default workspace room). ok is false when the source is gone.
func resolvePeer(ctx context.Context, q *db.Queries, org string, ref NodeRef, ev EventInfo, write bool) (string, bool, error) {
	n, err := q.GraphGetNodeBySource(ctx, db.GraphGetNodeBySourceParams{
		OrganizationID: org, NodeType: string(ref.Type), SourceID: ref.SourceID,
	})
	if err == nil && !n.DeletedAt.Valid {
		return n.ID, true, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", false, err
	}
	d, err := load(ctx, q, org, ref)
	if err != nil {
		return "", false, err
	}
	if d.Node == nil {
		return "", false, nil
	}
	if !write {
		return "", true, nil
	}
	row, err := upsertNode(ctx, q, org, *d.Node)
	if err != nil {
		return "", false, err
	}
	if ev.EvidenceKind == EvidenceOutboxEvent {
		// The peer's own edges follow when the worker projects it.
		if err := markDirty(ctx, q, org, []NodeRef{ref}, ev); err != nil {
			return "", false, err
		}
	}
	return row.ID, true, nil
}

func upsertNode(ctx context.Context, q *db.Queries, org string, n NodeState) (db.GraphNode, error) {
	row, err := q.GraphUpsertNode(ctx, db.GraphUpsertNodeParams{
		ID: util.NewID(), OrganizationID: org, WorkspaceID: optText(n.WorkspaceID), NodeType: string(n.Ref.Type),
		Subtype: n.Subtype, SourceID: n.Ref.SourceID, Title: n.Title, Status: n.Status, Visibility: n.Visibility,
		ReaderIds: sortedUnique(n.ReaderIDs), OccurredAt: optTime(n.OccurredAt), SourceUpdatedAt: optTime(n.SourceUpdatedAt),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Nothing changed: the conditional update skipped the row.
		return q.GraphGetNodeBySource(ctx, db.GraphGetNodeBySourceParams{
			OrganizationID: org, NodeType: string(n.Ref.Type), SourceID: n.Ref.SourceID,
		})
	}
	return row, err
}

func deleteNode(ctx context.Context, q *db.Queries, org, nodeID string, ref NodeRef, ev EventInfo) error {
	at := ts(ev.closeAt())
	if err := q.GraphCloseNodeEdges(ctx, db.GraphCloseNodeEdgesParams{OrganizationID: org, NodeID: nodeID, ValidTo: at, ClosedBy: ev.evidence(ref)}); err != nil {
		return err
	}
	if err := q.GraphCloseNodeFacts(ctx, db.GraphCloseNodeFactsParams{OrganizationID: org, NodeID: nodeID, ValidTo: at}); err != nil {
		return err
	}
	return q.GraphMarkNodeDeleted(ctx, db.GraphMarkNodeDeletedParams{OrganizationID: org, ID: nodeID, At: at})
}

func nodeDiffers(cur db.GraphNode, n NodeState) bool {
	return textOf(cur.WorkspaceID) != n.WorkspaceID || cur.Subtype != n.Subtype || cur.Title != n.Title ||
		cur.Status != n.Status || cur.Visibility != n.Visibility || !slices.Equal(cur.ReaderIds, sortedUnique(n.ReaderIDs))
}

func factPrecision(f db.GraphNodeFact) string {
	var a struct {
		Precision string `json:"precision"`
	}
	_ = json.Unmarshal(f.Attrs, &a)
	return a.Precision
}

func attrs(backfill bool, ev EventInfo, extra map[string]any) []byte {
	m := map[string]any{}
	for k, v := range extra {
		m[k] = v
	}
	if backfill {
		m["backfill"] = true
	}
	if ev.EvidenceKind == EvidenceSourceRow {
		m["source"] = "rebuild"
	}
	b, _ := json.Marshal(m)
	return b
}

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

func optTime(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: !t.IsZero()} }

func optText(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }
```

`markDirty` nằm ở `server/internal/graph/projector/dirty.go`:

```go
package projector

import (
	"context"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// markDirty queues refs for the worker, folding the event into any row
// already waiting. Duplicates are dropped here: one statement cannot upsert
// the same row twice.
func markDirty(ctx context.Context, q *db.Queries, org string, refs []NodeRef, ev EventInfo) error {
	seen := map[string]bool{}
	var types, ids []string
	for _, r := range refs {
		if r.SourceID == "" || seen[r.key()] {
			continue
		}
		seen[r.key()] = true
		types = append(types, string(r.Type))
		ids = append(ids, r.SourceID)
	}
	if len(ids) == 0 {
		return nil
	}
	at := ev.At
	if at.IsZero() {
		at = time.Now().UTC()
	}
	return q.GraphMarkDirty(ctx, db.GraphMarkDirtyParams{
		OrganizationID: org, NodeTypes: types, SourceIds: ids, EventID: ev.EvidenceID,
		EventAt: ts(at), ActorKind: ev.ActorKind, ActorID: ev.ActorID,
	})
}
```

Chạy lại test đơn vị Bước 2 → PASS (`cd server && go test ./internal/graph/projector/ -count=1 -v`; package chưa có test DB nào nên không có SKIP).

- [ ] **Bước 5: Commit phần lõi.**

```bash
git add server/internal/graph/projector/
git commit -m "feat(graph): projector core — desired state per source and reconcile

One reconcile for writes and verify: each SYSTEM edge has one owner end,
closed history is kept, a peer the graph lacks is projected on demand, and a
dependency event marks the far task dirty.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Marker, worker, port metrics, và test tích hợp của projector

**Files:**
- Create: `server/internal/graph/projector/refs.go`, `marker.go`, `worker.go`, `metrics.go`
- Test: `server/internal/graph/projector/fixture_test.go`, `reconcile_test.go`, `refs_test.go`, `marker_test.go`, `worker_test.go`

**Interfaces:**
- Consumes: `markDirty`, `Project` (Task 5).
- Produces: `projector.Topics() []string`; `projector.Refs(topic string, payload map[string]string) []NodeRef`; `projector.NewMarker(q *db.Queries, enabled func(ctx context.Context, orgID string) bool) *Marker` (thực thi `outbox.Consumer`, `Name() == "graph_marker"`), `(*Marker).SetMetrics(Metrics)`; `projector.NewWorker(pool *pgxpool.Pool, q *db.Queries) *Worker`, `(*Worker).Run(ctx)`, `(*Worker).Drain(ctx, batch int32) (int, error)`, `(*Worker).SetMetrics(Metrics)`; `projector.Metrics` interface `{ IncGraphMarked(topic, result string); IncGraphProjected(nodeType, result string); ObserveGraphLag(d time.Duration) }`.

Thứ tự TDD: Bước 1–2 viết fixture và test golden (chưa biên dịch được vì thiếu `NewMarker`, `NewWorker`); Bước 3–4 viết mã; Bước 5–6 thêm test của marker/worker và chạy cả package.

- [ ] **Bước 1: Fixture tích hợp.** `server/internal/graph/projector/fixture_test.go`:

```go
package projector

import (
	"context"
	"fmt"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/graph"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// fixture builds an organization through the real services, so every event
// under test comes out of the outbox as in production, then runs the marker
// and the worker until nothing is dirty.
type fixture struct {
	ctx      context.Context
	pool     *pgxpool.Pool
	q        *db.Queries
	ws       *service.WorkspaceService
	tasks    *service.TaskService
	meetings *service.MeetingService
	chat     *service.ChatService
	depts    *service.DepartmentService
	people   *service.PeopleService
	disp     *outbox.Dispatcher
	marker   *Marker
	worker   *Worker
	owner    db.User
	member   db.User
	orgID    string
	wsID     string
}

type fakeOutbox struct{}

func (fakeOutbox) Enqueue(context.Context, *db.Queries, mail.Message) (string, error) { return "m", nil }
func (fakeOutbox) Kick()                                                               {}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	ctx := context.Background()
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := authpkg.TokenMinter{Secret: []byte("t"), TTL: time.Minute}
	auth := service.NewAuthService(pool, q, minter, time.Hour, nil)
	orgs := service.NewOrganizationService(pool, q)
	ws := service.NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, fakeOutbox{})
	f := &fixture{ctx: ctx, pool: pool, q: q, ws: ws,
		tasks:    service.NewTaskService(pool, q, ws, nil),
		meetings: service.NewMeetingService(pool, q, ws, service.NopPublisher{}, nil, service.MeetingRuntime{}),
		chat:     service.NewChatService(pool, q, ws, service.NopPublisher{}),
		depts:    service.NewDepartmentService(pool, q, orgs),
		people:   service.NewPeopleService(pool, q, orgs),
	}
	f.chat.SetTasks(f.tasks)
	// CreateTasksFromSummary answers 503 without a task service.
	f.meetings.Tasks = f.tasks
	f.marker = NewMarker(q, func(context.Context, string) bool { return true })
	f.worker = NewWorker(pool, q)
	f.disp = outbox.New(pool, q, outbox.Options{})
	f.disp.Register(f.marker)
	f.owner = f.register(t, auth, "graph-owner@example.com", "Chủ Nhóm")
	f.member = f.register(t, auth, "graph-member@example.com", "Thành Viên")
	org, err := orgs.Create(ctx, f.owner.ID, "Graph Org", "graph-org")
	if err != nil {
		t.Fatal(err)
	}
	f.orgID = org.ID
	v, err := ws.CreateInOrg(ctx, f.owner.ID, org.ID, "Graph WS", "graph-ws")
	if err != nil {
		t.Fatal(err)
	}
	f.wsID = v.Workspace.ID
	if err := q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: org.ID, UserID: f.member.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if err := q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: f.wsID, OrganizationID: org.ID, UserID: f.member.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	// The member was added with direct queries; hand the marker the
	// member.joined row the invite flow would have written.
	if err := f.marker.Handle(ctx, db.OutboxEvent{ID: "seed-member-joined", Topic: "member.joined",
		Payload:        `{"organization_id":"` + org.ID + `","user_id":"` + f.member.ID + `"}`,
		OrganizationID: pgtype.Text{String: org.ID, Valid: true},
		CreatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true}}); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f *fixture) register(t *testing.T, auth *service.AuthService, email, name string) db.User {
	t.Helper()
	s, err := auth.Register(f.ctx, email, "password123", name, "vi")
	if err != nil {
		t.Fatal(err)
	}
	u, err := f.q.MarkEmailVerified(f.ctx, s.User.ID)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

// sync drains the outbox through the marker, then the worker, until neither
// has anything left (projecting one node may mark its peers).
func (f *fixture) sync(t *testing.T) {
	t.Helper()
	for round := 0; round < 10; round++ {
		if err := f.disp.Process(f.ctx, 500); err != nil {
			t.Fatal(err)
		}
		n, err := f.worker.Drain(f.ctx, 100)
		if err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			return
		}
	}
	t.Fatal("graph did not settle in 10 rounds")
}

// openEdges lists a node's open edges as "TYPE>PEER_TYPE:peer" (outgoing) or
// "TYPE<PEER_TYPE:peer" (incoming), sorted.
func (f *fixture) openEdges(t *testing.T, typ graph.NodeType, sourceID string) []string {
	t.Helper()
	rows, err := f.pool.Query(f.ctx, `
		SELECT e.edge_type, e.from_node = n.id, p.node_type, p.source_id
		FROM graph_nodes n
		JOIN graph_edges e ON (e.from_node = n.id OR e.to_node = n.id) AND e.valid_to IS NULL
		JOIN graph_nodes p ON p.id = CASE WHEN e.from_node = n.id THEN e.to_node ELSE e.from_node END
		WHERE n.organization_id = $1 AND n.node_type = $2 AND n.source_id = $3`, f.orgID, string(typ), sourceID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var et, pt, ps string
		var outgoing bool
		if err := rows.Scan(&et, &outgoing, &pt, &ps); err != nil {
			t.Fatal(err)
		}
		arrow := "<"
		if outgoing {
			arrow = ">"
		}
		out = append(out, fmt.Sprintf("%s%s%s:%s", et, arrow, pt, ps))
	}
	sort.Strings(out)
	return out
}

// openFacts returns fact type → value for the node's open facts.
func (f *fixture) openFacts(t *testing.T, typ graph.NodeType, sourceID string) map[string]string {
	t.Helper()
	rows, err := f.pool.Query(f.ctx, `
		SELECT x.fact_type, x.value FROM graph_node_facts x JOIN graph_nodes n ON n.id = x.node_id
		WHERE n.organization_id = $1 AND n.node_type = $2 AND n.source_id = $3 AND x.valid_to IS NULL`,
		f.orgID, string(typ), sourceID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			t.Fatal(err)
		}
		out[k] = v
	}
	return out
}

func (f *fixture) count(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx, sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func eq(t *testing.T, what string, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s = %v, want %v", what, got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%s = %v, want %v", what, got, want)
		}
	}
}

func ptr[T any](v T) *T { return &v }
```

- [ ] **Bước 2: Test golden.** `server/internal/graph/projector/reconcile_test.go` (đỏ tới Bước 4):

```go
package projector

import (
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/graph"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func TestProjectTaskFollowsItsSource(t *testing.T) {
	f := newFixture(t)
	p, err := f.tasks.CreateProject(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateProjectInput{
		Title: "Ra mắt Q4", LeadType: ptr("member"), LeadID: ptr(f.owner.ID),
	})
	if err != nil {
		t.Fatal(err)
	}
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{
		Title: "Viết spec", ProjectID: &p.ID, AssigneeID: &f.member.ID, DueDate: ptr("2026-10-20"),
	})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "task edges", f.openEdges(t, graph.NodeTask, task.ID), []string{
		"BELONGS_TO>PROJECT:" + p.ID, "OWNED_BY>ACTOR:" + f.member.ID,
	})
	eq(t, "project edges", f.openEdges(t, graph.NodeProject, p.ID), []string{
		"BELONGS_TO<TASK:" + task.ID, "OWNED_BY>ACTOR:" + f.owner.ID,
	})
	if facts := f.openFacts(t, graph.NodeTask, task.ID); facts["due"] != "2026-10-20" || facts["status"] != task.Status {
		t.Fatalf("facts = %v", facts)
	}

	owner := &f.owner.ID
	if _, err := f.tasks.Update(f.ctx, service.Human(f.owner.ID), task.ID, service.UpdateTaskInput{AssigneeID: &owner}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "after reassign", f.openEdges(t, graph.NodeTask, task.ID), []string{
		"BELONGS_TO>PROJECT:" + p.ID, "OWNED_BY>ACTOR:" + f.owner.ID,
	})
	if n := f.count(t, `SELECT count(*) FROM graph_edges WHERE organization_id = $1 AND edge_type = 'OWNED_BY'
		AND valid_to IS NOT NULL`, f.orgID); n != 1 {
		t.Fatalf("closed OWNED_BY = %d, want 1 (history kept)", n)
	}

	// The same source twice: nothing to write.
	before := f.count(t, `SELECT count(*) FROM graph_edges WHERE organization_id = $1`, f.orgID)
	tx, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	d, err := Project(f.ctx, f.q.WithTx(tx), f.orgID, NodeRef{Type: graph.NodeTask, SourceID: task.ID},
		EventInfo{EvidenceKind: EvidenceOutboxEvent, EvidenceID: "ev-again", At: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	if d.Total() != 0 || f.count(t, `SELECT count(*) FROM graph_edges WHERE organization_id = $1`, f.orgID) != before {
		t.Fatalf("second projection wrote %+v", d)
	}
}

func TestProjectTaskDependenciesAndOrigin(t *testing.T) {
	f := newFixture(t)
	m, err := f.meetings.CreateInstant(f.ctx, f.owner.ID, f.wsID, "Giao ban")
	if err != nil {
		t.Fatal(err)
	}
	created, err := f.meetings.CreateTasksFromSummary(f.ctx, f.owner.ID, m.ID, []service.SummaryTaskItem{{Title: "Gửi báo giá"}, {Title: "Chốt hợp đồng"}})
	if err != nil {
		t.Fatal(err)
	}
	a, b := created[0], created[1]
	// blocks(a, b): b depends on a → edge b→a, owned by b; the event names a.
	if _, err := f.tasks.SetDependency(f.ctx, service.Human(f.owner.ID), a.ID, service.SetDependencyInput{DependsOnTaskID: b.ID, Type: "blocks"}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "b edges", f.openEdges(t, graph.NodeTask, b.ID), []string{
		"DEPENDS_ON>TASK:" + a.ID, "ORIGINATED_FROM>MEETING:" + m.ID,
	})
	if err := f.tasks.RemoveDependency(f.ctx, service.Human(f.owner.ID), a.ID, b.ID, "blocks"); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "b edges after removal", f.openEdges(t, graph.NodeTask, b.ID), []string{"ORIGINATED_FROM>MEETING:" + m.ID})
}

func TestProjectTaskDeleteClosesEveryEdge(t *testing.T) {
	f := newFixture(t)
	a, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "A"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "B", ParentTaskID: &a.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.tasks.SetDependency(f.ctx, service.Human(f.owner.ID), b.ID, service.SetDependencyInput{DependsOnTaskID: a.ID, Type: "blocked_by"}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "b edges", f.openEdges(t, graph.NodeTask, b.ID), []string{"BELONGS_TO>TASK:" + a.ID, "DEPENDS_ON>TASK:" + a.ID})
	if err := f.tasks.Delete(f.ctx, f.owner.ID, a.ID); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "b edges after a is gone", f.openEdges(t, graph.NodeTask, b.ID), []string{})
	if n := f.count(t, `SELECT count(*) FROM graph_nodes WHERE organization_id = $1 AND source_id = $2 AND deleted_at IS NOT NULL`, f.orgID, a.ID); n != 1 {
		t.Fatal("a's node is kept, marked deleted")
	}
	// Re-projecting b (as any later event would) must not reopen an edge to a.
	b2 := "B2"
	if _, err := f.tasks.Update(f.ctx, service.Human(f.owner.ID), b.ID, service.UpdateTaskInput{Title: &b2}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "b edges after update", f.openEdges(t, graph.NodeTask, b.ID), []string{})
}

func TestProjectMeetingAndThreads(t *testing.T) {
	f := newFixture(t)
	p, err := f.tasks.CreateProject(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateProjectInput{Title: "Dự án"})
	if err != nil {
		t.Fatal(err)
	}
	m, err := f.meetings.Create(f.ctx, f.owner.ID, f.wsID, service.CreateMeetingInput{
		Title: "Họp tuần", StartsAt: time.Now().Add(time.Hour), EndsAt: time.Now().Add(2 * time.Hour), Timezone: "UTC", ProjectID: p.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.meetings.Invite(f.ctx, f.owner.ID, m.ID, f.member.ID); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	edges := f.openEdges(t, graph.NodeMeeting, m.ID)
	want := []string{"BELONGS_TO>PROJECT:" + p.ID, "PARTICIPATED_IN<ACTOR:" + f.member.ID}
	for _, w := range want {
		found := false
		for _, e := range edges {
			found = found || e == w
		}
		if !found {
			t.Fatalf("meeting edges = %v, missing %s", edges, w)
		}
	}
	if err := f.meetings.Cancel(f.ctx, f.owner.ID, m.ID, "dời lịch"); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	if facts := f.openFacts(t, graph.NodeMeeting, m.ID); facts["status"] != "CANCELED" {
		t.Fatalf("canceled meeting facts = %v (the node stays)", facts)
	}

	private, err := f.chat.CreateChannel(f.ctx, f.owner.ID, f.wsID, service.CreateChannelInput{Name: "kin", Visibility: "private"})
	if err != nil {
		t.Fatal(err)
	}
	root, err := f.chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, private.ID, service.SendChatMessageInput{Body: "bàn ở đây"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{
		Title: "Từ tin nhắn", OriginType: "chat_message", OriginID: &root.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.chat.SyncThreadTask(f.ctx, f.owner.ID, f.wsID, root.ID, service.SyncThreadTaskInput{TaskID: task.ID, Direction: "both"}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "task edges", f.openEdges(t, graph.NodeTask, task.ID), []string{
		"DISCUSSED_IN>THREAD:" + private.ID, "ORIGINATED_FROM>THREAD:" + private.ID,
	})
	var vis string
	var readers []string
	if err := f.pool.QueryRow(f.ctx, `SELECT visibility, reader_ids FROM graph_nodes WHERE organization_id = $1 AND source_id = $2`,
		f.orgID, private.ID).Scan(&vis, &readers); err != nil {
		t.Fatal(err)
	}
	if vis != "members" || len(readers) != 1 || readers[0] != f.owner.ID {
		t.Fatalf("private room = %s %v", vis, readers)
	}
	if err := f.chat.UnsyncThreadTask(f.ctx, f.owner.ID, f.wsID, root.ID); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "after unsync", f.openEdges(t, graph.NodeTask, task.ID), []string{"ORIGINATED_FROM>THREAD:" + private.ID})
	if err := f.chat.ArchiveChannel(f.ctx, f.owner.ID, f.wsID, private.ID); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "after archive", f.openEdges(t, graph.NodeTask, task.ID), []string{})
}

func TestProjectActorsAndTeams(t *testing.T) {
	f := newFixture(t)
	parent, err := f.depts.Create(f.ctx, f.owner.ID, f.orgID, service.DepartmentInput{Name: ptr("Kinh doanh"), Code: ptr("KD")})
	if err != nil {
		t.Fatal(err)
	}
	child, err := f.depts.Create(f.ctx, f.owner.ID, f.orgID, service.DepartmentInput{Name: ptr("Bán lẻ"), Code: ptr("BL"), ParentID: &parent.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.people.UpdateProfile(f.ctx, f.owner.ID, f.orgID, f.member.ID, service.ProfileInput{DepartmentID: &child.ID}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "member edges", f.openEdges(t, graph.NodeActor, f.member.ID), []string{"BELONGS_TO>TEAM:" + child.ID})
	eq(t, "child team", f.openEdges(t, graph.NodeTeam, child.ID), []string{
		"BELONGS_TO<ACTOR:" + f.member.ID, "BELONGS_TO>TEAM:" + parent.ID,
	})
	if _, err := f.depts.Archive(f.ctx, f.owner.ID, f.orgID, child.ID); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	eq(t, "member after archive", f.openEdges(t, graph.NodeActor, f.member.ID), []string{})
	// The default agent (organization create) is an ACTOR with subtype agent.
	if n := f.count(t, `SELECT count(*) FROM graph_nodes WHERE organization_id = $1 AND node_type = 'ACTOR'
		AND subtype = 'agent' AND deleted_at IS NULL`, f.orgID); n != 1 {
		t.Fatalf("agent actors = %d", n)
	}
}
```

- [ ] **Bước 3: Topic → node.** `server/internal/graph/projector/refs.go`:

```go
package projector

import (
	"sort"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/graph"
)

type topicRef struct {
	typ graph.NodeType
	key string // payload key holding the source id
}

// topicNodes is spec §5.2: which node an event makes dirty. Payloads carry
// ids only; the projector re-reads the source, so one id is enough.
var topicNodes = map[string]topicRef{
	"task.created":           {graph.NodeTask, "task_id"},
	"task.updated":           {graph.NodeTask, "task_id"},
	"task.deleted":           {graph.NodeTask, "task_id"},
	"chat.thread.linked":     {graph.NodeTask, "task_id"},
	"chat.thread.unlinked":   {graph.NodeTask, "task_id"},
	"meeting.created":        {graph.NodeMeeting, "meeting_id"},
	"meeting.updated":        {graph.NodeMeeting, "meeting_id"},
	"meeting.started":        {graph.NodeMeeting, "meeting_id"},
	"meeting.ended":          {graph.NodeMeeting, "meeting_id"},
	"meeting.canceled":       {graph.NodeMeeting, "meeting_id"},
	"meeting.deleted":        {graph.NodeMeeting, "meeting_id"},
	"participant.invited":    {graph.NodeMeeting, "meeting_id"},
	"participant.removed":    {graph.NodeMeeting, "meeting_id"},
	"join_request.approved":  {graph.NodeMeeting, "meeting_id"},
	"project.created":        {graph.NodeProject, "project_id"},
	"project.updated":        {graph.NodeProject, "project_id"},
	"project.deleted":        {graph.NodeProject, "project_id"},
	"member.joined":          {graph.NodeActor, "user_id"},
	"member.deactivated":     {graph.NodeActor, "user_id"},
	"member.reactivated":     {graph.NodeActor, "user_id"},
	"member.left":            {graph.NodeActor, "user_id"},
	"profile.updated":        {graph.NodeActor, "user_id"},
	"agent.created":          {graph.NodeActor, "agent_id"},
	"agent.updated":          {graph.NodeActor, "agent_id"},
	"agent.archived":         {graph.NodeActor, "agent_id"},
	"department.created":     {graph.NodeTeam, "department_id"},
	"department.updated":     {graph.NodeTeam, "department_id"},
	"department.archived":    {graph.NodeTeam, "department_id"},
	"chat.channel.created":   {graph.NodeThread, "room_id"},
	"chat.channel.updated":   {graph.NodeThread, "room_id"},
	"chat.channel.archived":  {graph.NodeThread, "room_id"},
	"chat.room.created":      {graph.NodeThread, "room_id"},
	"chat.room.member_added": {graph.NodeThread, "room_id"},
	"chat.room.member_removed": {graph.NodeThread, "room_id"},
}

// Topics is every topic the marker listens to, sorted.
func Topics() []string {
	out := make([]string, 0, len(topicNodes))
	for t := range topicNodes {
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

// Refs returns the nodes one outbox row makes dirty.
func Refs(topic string, payload map[string]string) []NodeRef {
	tr, ok := topicNodes[topic]
	if !ok {
		return nil
	}
	id := strings.TrimSpace(payload[tr.key])
	if id == "" {
		return nil
	}
	return []NodeRef{{Type: tr.typ, SourceID: id}}
}
```

(`chat.channel.updated` được catalogue ghi `ephemeral`, nhưng `Record` vẫn ghi dòng outbox ở `chat_channels.go:319,461`; marker nghe nó. Test tích hợp `TestChannelVisibilityChangeReachesTheGraph` ở Bước 5 giữ điều này: nếu ai đổi sang publish trực tiếp, test đổi visibility kênh sẽ đỏ.)

`refs_test.go`:

```go
package projector

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/graph"
	"github.com/unicomhub/uniwork/server/internal/outbox"
)

func TestRefs(t *testing.T) {
	if got := Refs("task.updated", map[string]string{"task_id": " t1 ", "workspace_id": "w"}); len(got) != 1 || got[0] != (NodeRef{graph.NodeTask, "t1"}) {
		t.Fatalf("task.updated → %+v", got)
	}
	if got := Refs("agent.archived", map[string]string{"organization_id": "o", "agent_id": "a1"}); len(got) != 1 || got[0].Type != graph.NodeActor {
		t.Fatalf("agent.archived → %+v", got)
	}
	if Refs("task.updated", map[string]string{}) != nil || Refs("notification.created", map[string]string{"task_id": "t"}) != nil {
		t.Fatal("no id or unknown topic → nothing")
	}
}

// Every topic the marker listens to exists in the outbox catalogue.
func TestTopicsAreCatalogued(t *testing.T) {
	for _, topic := range Topics() {
		if _, ok := outbox.Lookup(topic); !ok {
			t.Errorf("%s is not in the outbox catalogue", topic)
		}
	}
}
```

(`outbox.Lookup` trả `(EventDef, bool)`, `catalogue.go:312`.)

- [ ] **Bước 4: Metrics port, marker, worker.** `server/internal/graph/projector/metrics.go`:

```go
package projector

import "time"

// Metrics is implemented by internal/metrics.Graph; nil means no metrics.
// Labels never carry tenant or entity ids.
type Metrics interface {
	IncGraphMarked(topic, result string)
	IncGraphProjected(nodeType, result string)
	ObserveGraphLag(d time.Duration)
}
```

`server/internal/graph/projector/marker.go`:

```go
package projector

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Marker is the outbox consumer that feeds the projector. It runs on the
// realtime lane: one upsert into graph_dirty, no source read, so no topic
// changes lane and a projector failure never retries a realtime frame
// (spec §5.2, §13 #1).
type Marker struct {
	q       *db.Queries
	enabled func(ctx context.Context, orgID string) bool
	metrics Metrics
}

// NewMarker wires the marker. enabled answers the graph flag for an
// organization; nil marks everything.
func NewMarker(q *db.Queries, enabled func(ctx context.Context, orgID string) bool) *Marker {
	return &Marker{q: q, enabled: enabled}
}

// SetMetrics attaches counters; called once from main.
func (m *Marker) SetMetrics(x Metrics) { m.metrics = x }

// Name identifies the consumer in dispatcher errors.
func (*Marker) Name() string { return "graph_marker" }

// Topics is every topic that changes a projected node.
func (*Marker) Topics() []string { return Topics() }

// Handle marks the row's node dirty. Idempotent: a retried row bumps
// mark_seq on the same dirty row and the projection converges on the source.
func (m *Marker) Handle(ctx context.Context, ev outbox.Row) error {
	var p map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
		return fmt.Errorf("graph marker: payload of %s: %w", ev.ID, err)
	}
	refs := Refs(ev.Topic, p)
	if len(refs) == 0 {
		m.count(ev.Topic, "no_id")
		return nil
	}
	org := ev.OrganizationID.String
	if !ev.OrganizationID.Valid || org == "" {
		// No retry adds an organization; graph-rebuild covers the node.
		m.count(ev.Topic, "no_org")
		return nil
	}
	if m.enabled != nil && !m.enabled(ctx, org) {
		m.count(ev.Topic, "disabled")
		return nil
	}
	if err := markDirty(ctx, m.q, org, refs, EventInfo{
		EvidenceKind: EvidenceOutboxEvent, EvidenceID: ev.ID, At: ev.CreatedAt.Time,
		ActorKind: ev.ActorKind.String, ActorID: ev.ActorID.String,
	}); err != nil {
		return err
	}
	m.count(ev.Topic, "marked")
	return nil
}

func (m *Marker) count(topic, result string) {
	if m.metrics != nil {
		m.metrics.IncGraphMarked(topic, result)
	}
}
```

`server/internal/graph/projector/worker.go`:

```go
package projector

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Worker projects dirty nodes. Two loops claim batches with FOR UPDATE SKIP
// LOCKED under a lease; each node is projected in its own transaction, which
// also removes its dirty row unless a newer mark arrived meanwhile.
type Worker struct {
	pool    *pgxpool.Pool
	q       *db.Queries
	metrics Metrics
	log     *slog.Logger
	loops   int
	batch   int32
	tick    time.Duration
	lease   time.Duration
}

// NewWorker wires the worker with spec §5.2's sizes: 2 loops, batch 8, 60 s lease.
func NewWorker(pool *pgxpool.Pool, q *db.Queries) *Worker {
	return &Worker{pool: pool, q: q, log: slog.Default(), loops: 2, batch: 8, tick: time.Second, lease: 60 * time.Second}
}

// SetMetrics attaches counters; called once from main.
func (w *Worker) SetMetrics(m Metrics) { w.metrics = m }

// Run projects until ctx ends and returns only once every loop has stopped.
func (w *Worker) Run(ctx context.Context) {
	var wg sync.WaitGroup
	for i := 0; i < w.loops; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w.loop(ctx)
		}()
	}
	wg.Wait()
}

func (w *Worker) loop(ctx context.Context) {
	t := time.NewTicker(w.tick)
	defer t.Stop()
	for {
		for ctx.Err() == nil {
			n, err := w.Drain(ctx, w.batch)
			if err != nil && ctx.Err() == nil {
				w.log.Warn("graph: claim failed", "err", err)
			}
			if n < int(w.batch) {
				break
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// Drain claims up to batch dirty nodes and projects each. It returns how many
// it claimed; a failed projection is rescheduled, not returned.
func (w *Worker) Drain(ctx context.Context, batch int32) (int, error) {
	rows, err := w.q.GraphClaimDirty(ctx, db.GraphClaimDirtyParams{LeaseSeconds: int32(w.lease / time.Second), Batch: batch})
	if err != nil {
		return 0, err
	}
	for _, r := range rows {
		w.one(ctx, r)
	}
	return len(rows), nil
}

func (w *Worker) one(ctx context.Context, r db.GraphDirty) {
	ref := NodeRef{Type: graph.NodeType(r.NodeType), SourceID: r.SourceID}
	ev := EventInfo{EvidenceKind: EvidenceOutboxEvent, EvidenceID: r.LastEventID, At: r.LastEventAt.Time,
		ActorKind: r.ActorKind, ActorID: r.ActorID}
	result := "ok"
	if err := w.project(ctx, r, ref, ev); err != nil {
		result = "error"
		w.log.Warn("graph: projection failed", "organization_id", r.OrganizationID, "node_type", r.NodeType,
			"source_id", r.SourceID, "attempts", r.Attempts, "err", err)
		msg := err.Error()
		if len(msg) > 500 {
			msg = msg[:500]
		}
		if ferr := w.q.GraphFailDirty(ctx, db.GraphFailDirtyParams{
			OrganizationID: r.OrganizationID, NodeType: r.NodeType, SourceID: r.SourceID,
			AvailableAt: ts(time.Now().Add(backoff(r.Attempts))), LastError: msg,
		}); ferr != nil {
			w.log.Warn("graph: reschedule failed", "err", ferr)
		}
	} else if w.metrics != nil {
		w.metrics.ObserveGraphLag(time.Since(r.LastEventAt.Time))
	}
	if w.metrics != nil {
		w.metrics.IncGraphProjected(r.NodeType, result)
	}
}

func (w *Worker) project(ctx context.Context, r db.GraphDirty, ref NodeRef, ev EventInfo) error {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := w.q.WithTx(tx)
	if _, err := Project(ctx, q, r.OrganizationID, ref, ev); err != nil {
		return err
	}
	n, err := q.GraphDoneDirty(ctx, db.GraphDoneDirtyParams{
		OrganizationID: r.OrganizationID, NodeType: r.NodeType, SourceID: r.SourceID, MarkSeq: r.MarkSeq,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		// Marked again while projecting: leave it for the next claim.
		if err := q.GraphReleaseDirty(ctx, db.GraphReleaseDirtyParams{
			OrganizationID: r.OrganizationID, NodeType: r.NodeType, SourceID: r.SourceID,
		}); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// backoff: 2 s, 4 s, … capped at 5 minutes.
func backoff(attempts int32) time.Duration {
	if attempts > 8 {
		attempts = 8
	}
	d := time.Duration(1<<attempts) * time.Second
	if d > 5*time.Minute {
		d = 5 * time.Minute
	}
	return d
}
```

- [ ] **Bước 5: Test marker và worker.** `marker_test.go`:

```go
package projector

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type countingMetrics struct{ marked, projected map[string]int }

func (c *countingMetrics) IncGraphMarked(topic, result string)     { c.marked[topic+"/"+result]++ }
func (c *countingMetrics) IncGraphProjected(nodeType, result string) { c.projected[nodeType+"/"+result]++ }
func (c *countingMetrics) ObserveGraphLag(time.Duration)            {}

func row(id, topic, payload, org string) db.OutboxEvent {
	return db.OutboxEvent{ID: id, Topic: topic, Payload: payload,
		OrganizationID: pgtype.Text{String: org, Valid: org != ""},
		CreatedAt:      pgtype.Timestamptz{Time: time.Now(), Valid: true}}
}

func TestMarkerIgnoresDisabledOrganizations(t *testing.T) {
	f := newFixture(t)
	m := &countingMetrics{marked: map[string]int{}, projected: map[string]int{}}
	marker := NewMarker(f.q, func(_ context.Context, org string) bool { return org == "org-on" })
	marker.SetMetrics(m)
	for _, ev := range []db.OutboxEvent{
		row("e1", "task.updated", `{"task_id":"t1"}`, "org-on"),
		row("e2", "task.updated", `{"task_id":"t2"}`, "org-off"),
		row("e3", "task.updated", `{"task_id":"t3"}`, ""),
		row("e4", "task.updated", `{}`, "org-on"),
		row("e5", "chat.channel.updated", `{"room_id":"r1","workspace_id":"w"}`, "org-on"),
	} {
		if err := marker.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	if n := f.count(t, `SELECT count(*) FROM graph_dirty WHERE organization_id IN ('org-on', 'org-off')`); n != 2 {
		t.Fatalf("dirty rows = %d, want 2 (t1, r1)", n)
	}
	if m.marked["task.updated/disabled"] != 1 || m.marked["task.updated/no_org"] != 1 || m.marked["task.updated/no_id"] != 1 {
		t.Fatalf("marked = %v", m.marked)
	}
	// A retried row folds into the same dirty row.
	if err := marker.Handle(f.ctx, row("e1", "task.updated", `{"task_id":"t1"}`, "org-on")); err != nil {
		t.Fatal(err)
	}
	if n := f.count(t, `SELECT mark_seq FROM graph_dirty WHERE source_id = 't1'`); n != 2 {
		t.Fatalf("mark_seq = %d, want 2", n)
	}
	if err := marker.Handle(f.ctx, row("e9", "task.updated", `not json`, "org-on")); err == nil {
		t.Fatal("malformed payload must fail (retried, then dead-lettered like other consumers)")
	}
}
```

`worker_test.go`:

```go
package projector

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/graph"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// Two assignments before the worker runs fold into one dirty row; the graph
// ends on the latest assignee with no second open OWNED_BY.
func TestWorkerFollowsTheLatestSource(t *testing.T) {
	f := newFixture(t)
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "Đổi người", AssigneeID: &f.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	owner := &f.owner.ID
	if _, err := f.tasks.Update(f.ctx, service.Human(f.owner.ID), task.ID, service.UpdateTaskInput{AssigneeID: &owner}); err != nil {
		t.Fatal(err)
	}
	member := &f.member.ID
	if _, err := f.tasks.Update(f.ctx, service.Human(f.owner.ID), task.ID, service.UpdateTaskInput{AssigneeID: &member}); err != nil {
		t.Fatal(err)
	}
	if err := f.disp.Process(f.ctx, 500); err != nil {
		t.Fatal(err)
	}
	if n := f.count(t, `SELECT count(*) FROM graph_dirty WHERE source_id = $1`, task.ID); n != 1 {
		t.Fatalf("dirty rows for the task = %d, want 1", n)
	}
	f.sync(t)
	eq(t, "edges", f.openEdges(t, graph.NodeTask, task.ID), []string{"OWNED_BY>ACTOR:" + f.member.ID})
	if n := f.count(t, `SELECT count(*) FROM graph_dirty`); n != 0 {
		t.Fatalf("dirty rows left = %d", n)
	}
}

// A visibility change rides chat.channel.updated, catalogued "ephemeral" but
// stored by Record; if it stops reaching the outbox this test fails.
func TestChannelVisibilityChangeReachesTheGraph(t *testing.T) {
	f := newFixture(t)
	ch, err := f.chat.CreateChannel(f.ctx, f.owner.ID, f.wsID, service.CreateChannelInput{Name: "mo", Visibility: "public"})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	private := "private"
	if _, err := f.chat.UpdateChannel(f.ctx, f.owner.ID, f.wsID, ch.ID, service.UpdateChannelInput{Visibility: &private}); err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	var vis string
	if err := f.pool.QueryRow(f.ctx, `SELECT visibility FROM graph_nodes WHERE organization_id = $1 AND source_id = $2`, f.orgID, ch.ID).Scan(&vis); err != nil {
		t.Fatal(err)
	}
	if vis != "members" {
		t.Fatalf("visibility = %s, want members", vis)
	}
}
```

- [ ] **Bước 6: Chạy toàn bộ package projector** (gồm golden test ở Bước 2):

```bash
cd server && go test ./internal/graph/... -count=1 -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)'
cd server && go vet ./internal/graph/... && go test ./internal/ -run 'TestGraphTablesWrittenOnlyByProjector|TestActorConstructedOnlyInService|TestLayering' -count=1
```

Kết quả mong đợi: mọi test PASS, không SKIP. Nếu một golden test đỏ vì service từ chối dữ liệu dựng (ví dụ quyền tạo dự án), sửa phần dựng dữ liệu của test, không sửa quy tắc chiếu.

- [ ] **Bước 7: Commit.** Chạy `gofmt -w server/internal/graph/projector/` trước (vài khối mã trong brief chưa căn cột).

```bash
git add server/internal/graph/projector/
git commit -m "feat(graph): dirty marker on the realtime lane and the projector worker

The marker folds every projected topic into one graph_dirty upsert per
event (organization flag checked); the worker claims under a lease, projects
each node in one transaction and keeps the row when a newer mark arrived.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7: Dựng lại một tổ chức và `cmd/graph-rebuild`

**Files:**
- Create: `server/internal/graph/projector/rebuild.go`, `rebuild_test.go`
- Create: `server/cmd/graph-rebuild/main.go`, `main_test.go`
- Modify: `server/Dockerfile`

**Interfaces:**
- Produces: `projector.RebuildOptions{Verify bool; BatchSize int32}`; `projector.Report{OrganizationID string; Nodes int; Drift Drift}`; `projector.RebuildOrg(ctx, pool *pgxpool.Pool, q *db.Queries, org string, opts RebuildOptions) (Report, error)`; binary `graph-rebuild (--org <id> | --all) [--verify] [--format text|json]`.

- [ ] **Bước 1: Test đỏ.** `server/internal/graph/projector/rebuild_test.go`:

```go
package projector

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/graph"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func TestRebuildVerifyFindsNoDriftAfterTheWorker(t *testing.T) {
	f := newFixture(t)
	p, err := f.tasks.CreateProject(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateProjectInput{Title: "P"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{
		Title: "T", ProjectID: &p.ID, AssigneeID: &f.member.ID, DueDate: ptr("2026-11-01"),
	})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	rep, err := RebuildOrg(f.ctx, f.pool, f.q, f.orgID, RebuildOptions{Verify: true})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Drift.Total() != 0 || rep.Nodes == 0 {
		t.Fatalf("verify after the worker = %+v", rep)
	}
	// Tamper: close the OWNED_BY edge by hand. Verify sees it; apply fixes it.
	if _, err := f.pool.Exec(f.ctx, `UPDATE graph_edges SET valid_to = now() WHERE organization_id = $1 AND edge_type = 'OWNED_BY'`, f.orgID); err != nil {
		t.Fatal(err)
	}
	rep, err = RebuildOrg(f.ctx, f.pool, f.q, f.orgID, RebuildOptions{Verify: true})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Drift.MissingEdges != 1 {
		t.Fatalf("verify after tampering = %+v", rep.Drift)
	}
	if _, err := RebuildOrg(f.ctx, f.pool, f.q, f.orgID, RebuildOptions{}); err != nil {
		t.Fatal(err)
	}
	if rep, _ = RebuildOrg(f.ctx, f.pool, f.q, f.orgID, RebuildOptions{Verify: true}); rep.Drift.Total() != 0 {
		t.Fatalf("verify after apply = %+v", rep.Drift)
	}
	eq(t, "task edges", f.openEdges(t, graph.NodeTask, task.ID), []string{"BELONGS_TO>PROJECT:" + p.ID, "OWNED_BY>ACTOR:" + f.member.ID})
}

// An organization whose events were never marked (flag off) is backfilled by
// rebuild; new edges carry the source's time and backfill = true.
func TestRebuildBackfillsWithSourceTime(t *testing.T) {
	f := newFixture(t)
	f.marker.enabled = func(context.Context, string) bool { return false }
	task, err := f.tasks.Create(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreateTaskInput{Title: "Cũ", AssigneeID: &f.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	f.sync(t)
	if n := f.count(t, `SELECT count(*) FROM graph_nodes WHERE organization_id = $1 AND node_type = 'TASK'`, f.orgID); n != 0 {
		t.Fatalf("task nodes before rebuild = %d", n)
	}
	if _, err := RebuildOrg(f.ctx, f.pool, f.q, f.orgID, RebuildOptions{}); err != nil {
		t.Fatal(err)
	}
	var backfill bool
	var sameTime bool
	if err := f.pool.QueryRow(f.ctx, `
		SELECT (e.attrs->>'backfill')::boolean, e.valid_from = t.created_at
		FROM graph_edges e JOIN graph_nodes n ON n.id = e.from_node JOIN tasks t ON t.id = n.source_id
		WHERE e.organization_id = $1 AND e.edge_type = 'OWNED_BY' AND n.source_id = $2`, f.orgID, task.ID).Scan(&backfill, &sameTime); err != nil {
		t.Fatal(err)
	}
	if !backfill || !sameTime {
		t.Fatalf("backfill = %v, valid_from = created_at: %v", backfill, sameTime)
	}
}
```

Chạy `cd server && go test ./internal/graph/projector/ -run TestRebuild -count=1 -v` → biên dịch hỏng (chưa có `RebuildOrg`).

- [ ] **Bước 2: `rebuild.go`.**

```go
package projector

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// RebuildOptions: Verify counts drift without writing.
type RebuildOptions struct {
	Verify    bool
	BatchSize int32
}

// Report is one organization's rebuild outcome.
type Report struct {
	OrganizationID string `json:"organization_id"`
	Nodes          int    `json:"nodes"`
	Drift          Drift  `json:"drift"`
}

// Anchors first, so most peers already exist when work items are projected.
var rebuildOrder = []graph.NodeType{graph.NodeTeam, graph.NodeActor, graph.NodeProject, graph.NodeThread, graph.NodeMeeting, graph.NodeTask}

// RebuildOrg runs the projector's reconcile over every source row of one
// organization, plus every live node whose source may be gone. Closed history
// is kept: only open edges and facts are compared (spec §5.4).
func RebuildOrg(ctx context.Context, pool *pgxpool.Pool, q *db.Queries, org string, opts RebuildOptions) (Report, error) {
	if opts.BatchSize <= 0 {
		opts.BatchSize = 500
	}
	rep := Report{OrganizationID: org}
	for _, t := range rebuildOrder {
		ids, err := sourceIDs(ctx, q, org, t, opts.BatchSize)
		if err != nil {
			return rep, err
		}
		for _, id := range ids {
			ref := NodeRef{Type: t, SourceID: id}
			var d Drift
			if opts.Verify {
				d, err = Verify(ctx, q, org, ref)
			} else {
				d, err = projectOne(ctx, pool, q, org, ref)
			}
			if err != nil {
				return rep, err
			}
			rep.Nodes++
			rep.Drift.Add(d)
		}
	}
	return rep, nil
}

func projectOne(ctx context.Context, pool *pgxpool.Pool, q *db.Queries, org string, ref NodeRef) (Drift, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Drift{}, err
	}
	defer tx.Rollback(ctx)
	d, err := Project(ctx, q.WithTx(tx), org, ref, EventInfo{EvidenceKind: EvidenceSourceRow})
	if err != nil {
		return d, err
	}
	return d, tx.Commit(ctx)
}

type pageFn func(ctx context.Context, after string, limit int32) ([]string, error)

// sourceIDs is the union of the type's source ids and its live node ids.
func sourceIDs(ctx context.Context, q *db.Queries, org string, t graph.NodeType, batch int32) ([]string, error) {
	var sources []pageFn
	switch t {
	case graph.NodeTask:
		sources = append(sources, func(ctx context.Context, after string, n int32) ([]string, error) {
			return q.GraphRebuildTaskIDs(ctx, db.GraphRebuildTaskIDsParams{OrganizationID: org, AfterID: after, LimitN: n})
		})
	case graph.NodeMeeting:
		sources = append(sources, func(ctx context.Context, after string, n int32) ([]string, error) {
			return q.GraphRebuildMeetingIDs(ctx, db.GraphRebuildMeetingIDsParams{OrganizationID: org, AfterID: after, LimitN: n})
		})
	case graph.NodeProject:
		sources = append(sources, func(ctx context.Context, after string, n int32) ([]string, error) {
			return q.GraphRebuildProjectIDs(ctx, db.GraphRebuildProjectIDsParams{OrganizationID: org, AfterID: after, LimitN: n})
		})
	case graph.NodeActor:
		sources = append(sources,
			func(ctx context.Context, after string, n int32) ([]string, error) {
				return q.GraphRebuildMemberIDs(ctx, db.GraphRebuildMemberIDsParams{OrganizationID: org, AfterID: after, LimitN: n})
			},
			func(ctx context.Context, after string, n int32) ([]string, error) {
				return q.GraphRebuildAgentIDs(ctx, db.GraphRebuildAgentIDsParams{OrganizationID: org, AfterID: after, LimitN: n})
			})
	case graph.NodeTeam:
		sources = append(sources, func(ctx context.Context, after string, n int32) ([]string, error) {
			return q.GraphRebuildDepartmentIDs(ctx, db.GraphRebuildDepartmentIDsParams{OrganizationID: org, AfterID: after, LimitN: n})
		})
	case graph.NodeThread:
		sources = append(sources, func(ctx context.Context, after string, n int32) ([]string, error) {
			return q.GraphRebuildChatRoomIDs(ctx, db.GraphRebuildChatRoomIDsParams{OrganizationID: org, AfterID: after, LimitN: n})
		})
	}
	sources = append(sources, func(ctx context.Context, after string, n int32) ([]string, error) {
		return q.GraphRebuildLiveSources(ctx, db.GraphRebuildLiveSourcesParams{OrganizationID: org, NodeType: string(t), AfterID: after, LimitN: n})
	})
	seen := map[string]bool{}
	var out []string
	for _, page := range sources {
		after := ""
		for {
			ids, err := page(ctx, after, batch)
			if err != nil {
				return nil, err
			}
			for _, id := range ids {
				if !seen[id] {
					seen[id] = true
					out = append(out, id)
				}
			}
			if int32(len(ids)) < batch {
				break
			}
			after = ids[len(ids)-1]
		}
	}
	return out, nil
}
```

`Drift` đã mang tag JSON từ Task 5, nên báo cáo `--format json` đọc được.

- [ ] **Bước 3: CLI.** `server/cmd/graph-rebuild/main.go`:

```go
// graph-rebuild projects the Work Graph from the business tables (C-11 §5.4).
//
//	graph-rebuild --org <organization id> [--verify] [--format text|json]
//	graph-rebuild --all [--verify] [--format text|json]
//
// --verify writes nothing and exits 1 when any drift is found. Like cmd/seed
// and cmd/uniwork-admin it reads only DATABASE_URL.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/graph/projector"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func main() {
	if err := run(context.Background(), os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "graph-rebuild:", err)
		os.Exit(1)
	}
}

const usage = "usage: graph-rebuild (--org <id> | --all) [--verify] [--format text|json]"

func run(ctx context.Context, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("graph-rebuild", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	org := fs.String("org", "", "organization id to rebuild")
	all := fs.Bool("all", false, "rebuild every organization")
	verify := fs.Bool("verify", false, "count drift without writing; exit 1 when drift > 0")
	format := fs.String("format", "text", "text|json")
	if err := fs.Parse(args); err != nil {
		return fmt.Errorf("%w; %s", err, usage)
	}
	if (*org == "") == !*all || (*format != "text" && *format != "json") {
		return errors.New(usage)
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return errors.New("DATABASE_URL is not set")
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer pool.Close()
	q := db.New(pool)
	orgs := []string{*org}
	if *all {
		if orgs, err = q.GraphListOrganizations(ctx); err != nil {
			return err
		}
	}
	var reports []projector.Report
	drift := 0
	for _, o := range orgs {
		rep, err := projector.RebuildOrg(ctx, pool, q, o, projector.RebuildOptions{Verify: *verify})
		if err != nil {
			return fmt.Errorf("organization %s: %w", o, err)
		}
		reports = append(reports, rep)
		drift += rep.Drift.Total()
	}
	if *format == "json" {
		enc := json.NewEncoder(out)
		enc.SetIndent("", "  ")
		if err := enc.Encode(reports); err != nil {
			return err
		}
	} else {
		for _, r := range reports {
			d := r.Drift
			fmt.Fprintf(out, "%s nodes=%d drift=%d (nodes +%d -%d ~%d, edges +%d -%d, facts +%d -%d ~%d)\n",
				r.OrganizationID, r.Nodes, d.Total(), d.MissingNodes, d.ExtraNodes, d.ChangedNodes,
				d.MissingEdges, d.ExtraEdges, d.MissingFacts, d.ExtraFacts, d.ChangedFacts)
		}
	}
	if *verify && drift > 0 {
		return fmt.Errorf("verify: %d drifted rows", drift)
	}
	return nil
}
```

`server/cmd/graph-rebuild/main_test.go`:

```go
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/graph/projector"
	"github.com/unicomhub/uniwork/server/internal/testutil"
)

func TestUsage(t *testing.T) {
	for _, args := range [][]string{nil, {"--org", "o", "--all"}, {"--all", "--format", "xml"}} {
		if err := run(context.Background(), args, &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "usage") {
			t.Errorf("args %v: err = %v", args, err)
		}
	}
}

func TestVerifyAnEmptyOrganization(t *testing.T) {
	testutil.DB(t)
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://uniwork:uniwork@localhost:5432/uniwork_test?sslmode=disable"
	}
	t.Setenv("DATABASE_URL", url)
	var out bytes.Buffer
	if err := run(context.Background(), []string{"--org", "org-empty", "--verify", "--format", "json"}, &out); err != nil {
		t.Fatal(err)
	}
	var reps []projector.Report
	if err := json.Unmarshal(out.Bytes(), &reps); err != nil || len(reps) != 1 || reps[0].Drift.Total() != 0 {
		t.Fatalf("report = %s (%v)", out.String(), err)
	}
}
```

- [ ] **Bước 4: Đưa binary vào image.** `server/Dockerfile`:

```dockerfile
RUN CGO_ENABLED=0 go build -o /out/server ./cmd/server && \
    CGO_ENABLED=0 go build -o /out/migrate ./cmd/migrate && \
    CGO_ENABLED=0 go build -o /out/graph-rebuild ./cmd/graph-rebuild
...
COPY --from=build /out/server /out/migrate /out/graph-rebuild /usr/local/bin/
```

- [ ] **Bước 5: Chạy.**

```bash
cd server && go test ./internal/graph/projector/ ./cmd/graph-rebuild/ -count=1 -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)'
cd server && go build ./cmd/graph-rebuild
```

- [ ] **Bước 6: Commit.**

```bash
git add server/internal/graph/projector/rebuild.go server/internal/graph/projector/rebuild_test.go server/internal/graph/projector/types.go \
  server/cmd/graph-rebuild/ server/Dockerfile
git commit -m "feat(graph): graph-rebuild — same reconcile over a whole organization

--verify counts drift and exits 1; apply opens missing edges dated by the
source (attrs.backfill) when the node is new. Reads only DATABASE_URL and
ships in the server image.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 8: Nối vào server: flag, metrics, cảnh báo, runbook

**Files:**
- Modify: `server/internal/featureflags/keys.go`
- Create: `server/internal/metrics/graph.go`, `graph_test.go`
- Modify: `server/internal/metrics/registry.go`
- Modify: `server/cmd/server/main.go`
- Modify: `deploy/grafana/dashboards/outbox-realtime.json` (hai panel đồ thị, spec §5.6)
- Modify: `deploy/alerts.yml`, `scripts/alerts-runbooks.test.mjs` (14 → 15)
- Create: `docs/runbooks/GraphProjectorLagHigh.md`; Modify: `docs/runbooks/README.md`
- Modify: `docs/ops/RUNBOOK_OUTBOX.md`, `CLAUDE.md` (câu về lane realtime), `.env.example` (dòng chú thích `# FF_GRAPH=true`, `# FF_GRAPH_UI=true` cạnh `# FF_DOCUMENTS`)

**Interfaces:**
- Produces: flag `graph` (không public), `graph_ui` (public); `metrics.Graph` thực thi `projector.Metrics` và `service.GraphMetrics`; `Registry.Graph *Graph`; gauge `uniwork_graph_dirty_pending`, `uniwork_graph_dirty_oldest_seconds`.

- [ ] **Bước 1: Flag.** Trong `server/internal/featureflags/keys.go`:

```go
	{Key: "graph", Description: "Work Graph: marker đánh dấu node bẩn cho tổ chức này, worker chiếu (C-11). Bật rồi chạy graph-rebuild --org", Default: false, Public: false, Owner: "graph", ReviewAt: day(2027, 1, 31)},
	{Key: "graph_ui", Description: "Work Graph: section Liên quan và dòng thời gian trên trang việc (C-11)", Default: false, Public: true, Owner: "graph", ReviewAt: day(2027, 1, 31)},
```

- [ ] **Bước 2: Metrics, test trước.** `server/internal/metrics/graph_test.go`:

```go
package metrics

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGraphMetricsAreExposed(t *testing.T) {
	reg := NewRegistry(RegistryOptions{})
	reg.Graph.IncGraphMarked("task.updated", "marked")
	reg.Graph.IncGraphProjected("TASK", "ok")
	reg.Graph.ObserveGraphLag(2 * time.Second)
	reg.Graph.IncGraphLayer2Dropped("THREAD")
	rec := httptest.NewRecorder()
	NewHandler(reg.Gatherer).ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	body, _ := io.ReadAll(rec.Body)
	for _, want := range []string{
		`uniwork_graph_marked_total{result="marked",topic="task.updated"} 1`,
		`uniwork_graph_projected_total{node_type="TASK",result="ok"} 1`,
		`uniwork_graph_projector_lag_seconds_count 1`,
		`uniwork_graph_layer2_dropped_total{node_type="THREAD"} 1`,
	} {
		if !strings.Contains(string(body), want) {
			t.Errorf("missing %s", want)
		}
	}
}
```

(Cùng mẫu `metrics/documents_test.go:19-35`: `NewRegistry(RegistryOptions{})`, `NewHandler(registry.Gatherer)`.)

`server/internal/metrics/graph.go`:

```go
package metrics

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
)

// Graph is the Work Graph projector and read path (C-11 §5.6). Labels carry
// topics, node types and results only — never tenant or entity ids.
type Graph struct {
	Marked        *prometheus.CounterVec
	Projected     *prometheus.CounterVec
	Lag           prometheus.Histogram
	Layer2Dropped *prometheus.CounterVec
}

func NewGraph() *Graph {
	return &Graph{
		Marked: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_graph_marked_total",
			Help: "Outbox rows the graph marker handled, by topic and result (marked, disabled, no_org, no_id).",
		}, []string{"topic", "result"}),
		Projected: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_graph_projected_total",
			Help: "Dirty nodes the projector worker handled, by node type and result (ok, error).",
		}, []string{"node_type", "result"}),
		Lag: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "uniwork_graph_projector_lag_seconds",
			Help:    "Seconds from the newest event folded into a dirty node to its projection commit.",
			Buckets: []float64{0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300},
		}),
		Layer2Dropped: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "uniwork_graph_layer2_dropped_total",
			Help: "Nodes layer 1 admitted but the module gate refused (stale projection), by node type.",
		}, []string{"node_type"}),
	}
}

func (g *Graph) Collectors() []prometheus.Collector {
	return []prometheus.Collector{g.Marked, g.Projected, g.Lag, g.Layer2Dropped}
}

func (g *Graph) IncGraphMarked(topic, result string)       { g.Marked.WithLabelValues(topic, result).Inc() }
func (g *Graph) IncGraphProjected(nodeType, result string) { g.Projected.WithLabelValues(nodeType, result).Inc() }
func (g *Graph) IncGraphLayer2Dropped(nodeType string)     { g.Layer2Dropped.WithLabelValues(nodeType).Inc() }

func (g *Graph) ObserveGraphLag(d time.Duration) {
	if d < 0 {
		d = 0
	}
	g.Lag.Observe(d.Seconds())
}

var (
	graphDirtyPendingDesc = prometheus.NewDesc("uniwork_graph_dirty_pending",
		"Nodes waiting in graph_dirty.", nil, nil)
	graphDirtyOldestDesc = prometheus.NewDesc("uniwork_graph_dirty_oldest_seconds",
		"Age of the oldest event waiting in graph_dirty.", nil, nil)
	graphDirtyUpDesc = prometheus.NewDesc("uniwork_graph_dirty_lag_up",
		"1 when graph_dirty was read at this scrape, 0 when the read failed.", nil, nil)
)

// GraphDirtyCollector reads graph_dirty at scrape time.
type GraphDirtyCollector struct{ pool *pgxpool.Pool }

func NewGraphDirtyCollector(pool *pgxpool.Pool) *GraphDirtyCollector { return &GraphDirtyCollector{pool: pool} }

func (c *GraphDirtyCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- graphDirtyPendingDesc
	ch <- graphDirtyOldestDesc
	ch <- graphDirtyUpDesc
}

func (c *GraphDirtyCollector) Collect(ch chan<- prometheus.Metric) {
	if c.pool == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), lagReadTimeout)
	defer cancel()
	var pending, oldest float64
	if err := c.pool.QueryRow(ctx, `SELECT count(*)::float8,
		COALESCE(EXTRACT(EPOCH FROM now() - min(last_event_at)), 0)::float8 FROM graph_dirty`).Scan(&pending, &oldest); err != nil {
		// An absent age would silence GraphProjectorLagHigh; say the read failed.
		ch <- prometheus.MustNewConstMetric(graphDirtyUpDesc, prometheus.GaugeValue, 0)
		return
	}
	ch <- prometheus.MustNewConstMetric(graphDirtyUpDesc, prometheus.GaugeValue, 1)
	ch <- prometheus.MustNewConstMetric(graphDirtyPendingDesc, prometheus.GaugeValue, pending)
	ch <- prometheus.MustNewConstMetric(graphDirtyOldestDesc, prometheus.GaugeValue, oldest)
}
```

Trong `registry.go`: thêm trường `Graph *Graph` vào `Registry`; trong `NewRegistry`, `graphMetrics := NewGraph(); reg.MustRegister(graphMetrics.Collectors()...)`, `reg.MustRegister(NewGraphDirtyCollector(opts.Pool))` đặt cạnh `NewOutboxLagCollector`, và `Graph: graphMetrics` trong struct trả về.

Chạy `cd server && go test ./internal/metrics/ -count=1 -v` → PASS.

- [ ] **Bước 3: Nối trong `main.go`.** Ngay trước `dispatcher.Register(featureflags.NewInvalidator(flagOverrides))`:

```go
	// Work Graph (C-11): the marker rides the realtime lane (one upsert per
	// event); the worker projects dirty nodes. The graph flag is read per
	// organization, so enabling one needs no restart (then graph-rebuild --org).
	graphFlagDefault := false
	if f, ok := featureflags.Lookup("graph"); ok {
		graphFlagDefault = f.Default
	}
	graphMarker := projector.NewMarker(q, func(ctx context.Context, orgID string) bool {
		return flags.IsEnabled(featureflag.WithEvalContext(ctx, featureflag.EvalContext{OrganizationID: orgID}), "graph", graphFlagDefault)
	})
	dispatcher.Register(graphMarker)
	graphWorker := projector.NewWorker(pool, q)
```

Trong khối `if reg != nil { ... }` cạnh các `SetMetrics` khác:

```go
		graphMarker.SetMetrics(reg.Graph)
		graphWorker.SetMetrics(reg.Graph)
```

Cạnh `dispatcherDone`:

```go
	graphWorkerDone := make(chan struct{})
	go func() { graphWorker.Run(runCtx); close(graphWorkerDone) }()
```

Trong trình tự tắt, ngay sau khối chờ `dispatcherDone`:

```go
	select {
	case <-graphWorkerDone:
	case <-time.After(30 * time.Second):
		log.Warn("graph: projector worker did not stop in time")
	}
```

Import `github.com/unicomhub/uniwork/server/internal/graph/projector`. (GraphService nối ở Task 10.)

- [ ] **Bước 4: Cảnh báo và runbook.** `deploy/alerts.yml`, nhóm `uniwork-outbox-realtime`:

```yaml
      - alert: GraphProjectorLagHigh
        expr: max(uniwork_graph_dirty_oldest_seconds) > 120
        for: 10m
        labels:
          severity: "3"
        annotations:
          summary: "Work Graph đang trễ nguồn hơn 2 phút"
          description: "Sự kiện cũ nhất chờ chiếu đã đợi {{ $value | humanizeDuration }}. Panel Liên quan hiển thị dữ liệu cũ."
          runbook_url: https://github.com/UNIAI-TEAM/uniwork/blob/develop/docs/runbooks/GraphProjectorLagHigh.md
```

`docs/runbooks/GraphProjectorLagHigh.md`:

```markdown
# GraphProjectorLagHigh — Work Graph chiếu chậm hơn nguồn

> **Trạng thái:** shipped · **Sev:** 3 · **Rule:** `deploy/alerts.yml` · **Dashboard:** Grafana *UniWork · Outbox & Realtime* · **Nền:** [`docs/ops/RUNBOOK_OUTBOX.md`](../ops/RUNBOOK_OUTBOX.md)

## Triệu chứng

`uniwork_graph_dirty_oldest_seconds` trên 120 s suốt 10 phút. Panel "Liên quan" và dòng thời gian trên trang việc thiếu thay đổi mới. Việc, cuộc họp, chat vẫn chạy bình thường vì marker không chặn lane realtime.

## Kiểm tra

1. `uniwork_graph_projected_total{result="error"}` có tăng không. Nếu có, xem log `graph: projection failed` (có `node_type`, `source_id`, `attempts`).
2. `SELECT node_type, count(*), max(attempts), min(last_event_at) FROM graph_dirty GROUP BY 1;` để biết loại node nào kẹt.
3. `SELECT last_error FROM graph_dirty WHERE attempts > 3 LIMIT 20;` để xem lỗi lặp.
4. `uniwork_graph_dirty_pending` tăng đều mà không có lỗi: worker không chạy hoặc quá tải (xem log khởi động, CPU DB).

## Khắc phục

- Lỗi do một bản ghi nguồn hỏng: sửa nguồn; dòng bẩn tự chạy lại theo lịch lùi (tối đa 5 phút).
- Worker không chạy: khởi động lại pod API (worker chạy cùng server).
- Tồn đọng lớn sau sự cố: `graph-rebuild --org <id>` cho tổ chức bị ảnh hưởng, rồi `graph-rebuild --org <id> --verify` phải in `drift=0`.
- Tắt khẩn: đặt override global `graph=false` và gỡ override theo tổ chức; marker ngừng đánh dấu. Bật lại thì chạy rebuild cho các tổ chức đã bật.

## Leo thang

Kéo dài quá 1 giờ, hoặc `--verify` vẫn lệch sau rebuild: báo owner `graph` (C-11) kèm kết quả bước 2 và 3.
```

Thêm vào `deploy/grafana/dashboards/outbox-realtime.json` hai panel `timeseries` theo đúng hình panel id 9 (datasource `{"type":"prometheus","uid":"prometheus"}`): id 10 "Work Graph: tuổi sự kiện chờ chiếu cũ nhất", `gridPos {x:0,y:40,w:12,h:8}`, unit `s`, expr `max(uniwork_graph_dirty_oldest_seconds)`; id 11 "Work Graph: node chờ chiếu", `gridPos {x:12,y:40,w:12,h:8}`, unit `short`, expr `sum(uniwork_graph_dirty_pending)`. Trong runbook, mục "Kiểm tra" thêm: `uniwork_graph_dirty_lag_up = 0` nghĩa là không đọc được bảng, cảnh báo trễ sẽ im.

Thêm dòng vào bảng `docs/runbooks/README.md`: `| \`GraphProjectorLagHigh\` | 3 | Work Graph chiếu chậm hơn nguồn | [GraphProjectorLagHigh.md](GraphProjectorLagHigh.md) |`. Trong `scripts/alerts-runbooks.test.mjs` đổi `14` thành `15` và thêm "+ C-11 graph lag" vào thông điệp.

- [ ] **Bước 5: Tài liệu vận hành và luật lane.**
  - `docs/ops/RUNBOOK_OUTBOX.md`: thêm vào bảng lane một dòng ghi chú "realtime cũng mang `graph_marker` (một upsert vào `graph_dirty`)"; thêm mục `### Work Graph: dòng bẩn và rebuild` gồm cách đọc `graph_dirty`, khi nào chạy `graph-rebuild` (sau khi bật `graph` cho một tổ chức; sau sự cố; định kỳ hàng tuần với `--verify` để bắt tên đổi không phát sự kiện), và lệnh trong pod: `graph-rebuild --org <id> --verify`.
  - `CLAUDE.md` (AGENTS.md là symlink), mục Audit and Events: câu bị ngắt dòng ở dòng 307-308. Thay đúng chuỗi `memory, Redis or one indexed read;` ở dòng 308 bằng `memory, Redis, one indexed read, or one keyed upsert (the Work Graph marker);`. Sửa tương ứng comment của `Register` ở `server/internal/outbox/outbox.go:136-138` nếu nó nhắc cùng luật.
  - `.env.example`: thêm `# FF_GRAPH=true` và `# FF_GRAPH_UI=true` cạnh `# FF_DOCUMENTS=true`.

- [ ] **Bước 6: Chạy.**

```bash
cd server && go build ./... && go test ./internal/featureflags/ ./internal/metrics/ ./internal/outbox/ -count=1
node --test scripts/alerts-runbooks.test.mjs scripts/env-example.test.mjs scripts/governance.test.mjs
```

- [ ] **Bước 7: Commit.**

```bash
git add server/internal/featureflags/keys.go server/internal/metrics/ server/cmd/server/main.go deploy/alerts.yml \
  scripts/alerts-runbooks.test.mjs docs/runbooks/ docs/ops/RUNBOOK_OUTBOX.md CLAUDE.md .env.example
git commit -m "feat(graph): wire the marker and worker, metrics, lag alert and runbook

Flags graph (per organization, read by the marker) and graph_ui (public).
The worker stops with the other background workers on shutdown.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9: `GraphService`: hàng xóm và lịch sử, hai lớp quyền

**Files:**
- Create: `server/internal/service/graph.go`, `graph_gate.go`
- Test: `server/internal/service/graph_test.go`

**Interfaces:**
- Consumes: `GraphGetVisibleNode`, `GraphListNeighbors`, `GraphListNodeHistoryEdges`, `GraphListNodeHistoryFacts` (Task 4); `projector.RebuildOrg` (chỉ trong test).
- Produces: `service.NewGraphService(q *db.Queries, orgs *OrganizationService, ws *WorkspaceService, chat *ChatService) *GraphService`; `(*GraphService).SetFlags(GraphFlags)`, `SetMetrics(GraphMetrics)`; `GraphFlags interface{ IsEnabled(ctx context.Context, key string, defaultVal bool) bool }`; `GraphMetrics interface{ IncGraphLayer2Dropped(nodeType string) }`; `Neighbors(ctx, userID, workspaceID, nodeType, nodeID string, in GraphNeighborsQuery) (GraphNeighborsPage, error)`; `History(ctx, userID, workspaceID, nodeType, nodeID string, from, to time.Time) (GraphHistory, error)`; các struct `GraphNodeView`, `GraphNeighbor`, `GraphNeighborsQuery`, `GraphNeighborsPage`, `GraphHistoryItem`, `GraphHistory` như trong mã dưới.

- [ ] **Bước 1: Test đỏ.** `server/internal/service/graph_test.go`:

```go
package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/graph/projector"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type graphFlagsOn bool

func (f graphFlagsOn) IsEnabled(context.Context, string, bool) bool { return bool(f) }

type graphDrops struct{ n map[string]int }

func (d *graphDrops) IncGraphLayer2Dropped(nodeType string) { d.n[nodeType]++ }

type graphWorld struct {
	ctx           context.Context
	q             *db.Queries
	svc           *GraphService
	tasks         *TaskService
	chat          *ChatService
	drops         *graphDrops
	owner, member db.User
	orgID, wsID   string
	rebuild       func(t *testing.T)
}

func newGraphWorld(t *testing.T) *graphWorld {
	t.Helper()
	ctx := context.Background()
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	w := &graphWorld{ctx: ctx, q: q, tasks: NewTaskService(pool, q, ws, nil), chat: NewChatService(pool, q, ws, NopPublisher{}),
		drops: &graphDrops{n: map[string]int{}}}
	w.chat.SetTasks(w.tasks)
	w.svc = NewGraphService(q, orgs, ws, w.chat)
	w.svc.SetFlags(graphFlagsOn(true))
	w.svc.SetMetrics(w.drops)
	w.owner = registerVerified(t, q, as, "graph-read-owner@example.com", "Chủ")
	w.member = registerVerified(t, q, as, "graph-read-member@example.com", "Bình")
	org, err := orgs.Create(ctx, w.owner.ID, "Graph Read", "graph-read")
	if err != nil {
		t.Fatal(err)
	}
	v, err := ws.CreateInOrg(ctx, w.owner.ID, org.ID, "Graph Read WS", "graph-read-ws")
	if err != nil {
		t.Fatal(err)
	}
	w.orgID, w.wsID = org.ID, v.Workspace.ID
	if err := q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: org.ID, UserID: w.member.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if err := q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.wsID, OrganizationID: org.ID, UserID: w.member.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	w.rebuild = func(t *testing.T) {
		t.Helper()
		if _, err := projector.RebuildOrg(ctx, pool, q, org.ID, projector.RebuildOptions{}); err != nil {
			t.Fatal(err)
		}
	}
	return w
}

// threadIDs is the THREAD neighbors a user sees around a task.
func (w *graphWorld) threadIDs(t *testing.T, userID, taskID string) []string {
	t.Helper()
	page, err := w.svc.Neighbors(w.ctx, userID, w.wsID, "TASK", taskID, GraphNeighborsQuery{})
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, it := range page.Items {
		if it.Node.Type == "THREAD" {
			out = append(out, it.Node.ID)
		}
	}
	return out
}

func (w *graphWorld) privateThreadTask(t *testing.T, members []string) (roomID, taskID string) {
	t.Helper()
	ch, err := w.chat.CreateChannel(w.ctx, w.owner.ID, w.wsID, CreateChannelInput{Name: "kin", Visibility: "private", MemberUserIDs: members})
	if err != nil {
		t.Fatal(err)
	}
	root, err := w.chat.SendRoomMessage(w.ctx, w.owner.ID, w.wsID, ch.ID, SendChatMessageInput{Body: "bàn riêng"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := w.tasks.Create(w.ctx, Human(w.owner.ID), w.wsID, CreateTaskInput{Title: "Việc chung"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.chat.SyncThreadTask(w.ctx, w.owner.ID, w.wsID, root.ID, SyncThreadTaskInput{TaskID: task.ID, Direction: "both"}); err != nil {
		t.Fatal(err)
	}
	return ch.ID, task.ID
}

func TestGraphNeighborsHidePrivateRoomsFromNonMembers(t *testing.T) {
	w := newGraphWorld(t)
	room, task := w.privateThreadTask(t, nil)
	w.rebuild(t)
	if got := w.threadIDs(t, w.owner.ID, task); len(got) != 1 || got[0] != room {
		t.Fatalf("owner threads = %v", got)
	}
	if got := w.threadIDs(t, w.member.ID, task); len(got) != 0 {
		t.Fatalf("member sees a private room: %v", got)
	}
}

func TestGraphNeighborsLayerTwoDropsStaleReaders(t *testing.T) {
	w := newGraphWorld(t)
	room, task := w.privateThreadTask(t, []string{w.member.ID})
	w.rebuild(t)
	if got := w.threadIDs(t, w.member.ID, task); len(got) != 1 {
		t.Fatalf("member threads before the kick = %v", got)
	}
	// A kick writes no event (spec §5.2): reader_ids still name the member.
	if err := w.q.LeaveChatRoomMember(w.ctx, db.LeaveChatRoomMemberParams{RoomID: room, UserID: w.member.ID}); err != nil {
		t.Fatal(err)
	}
	if got := w.threadIDs(t, w.member.ID, task); len(got) != 0 {
		t.Fatalf("member still sees the room after the kick: %v", got)
	}
	if w.drops.n["THREAD"] != 1 {
		t.Fatalf("layer 2 drops = %v", w.drops.n)
	}
}

func TestGraphNeighborsRefusals(t *testing.T) {
	w := newGraphWorld(t)
	_, task := w.privateThreadTask(t, nil)
	w.rebuild(t)
	if _, err := w.svc.Neighbors(w.ctx, w.owner.ID, w.wsID, "TASK", "missing", GraphNeighborsQuery{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown node err = %v", err)
	}
	if _, err := w.svc.Neighbors(w.ctx, w.owner.ID, w.wsID, "task", task, GraphNeighborsQuery{}); err == nil {
		t.Fatal("lower-case type must be invalid")
	}
	w.svc.SetFlags(graphFlagsOn(false))
	_, err := w.svc.Neighbors(w.ctx, w.owner.ID, w.wsID, "TASK", task, GraphNeighborsQuery{})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Status != 404 || ce.Code != "feature_disabled" {
		t.Fatalf("flag off err = %v", err)
	}
}

func TestGraphHistoryShowsReassignment(t *testing.T) {
	w := newGraphWorld(t)
	task, err := w.tasks.Create(w.ctx, Human(w.owner.ID), w.wsID, CreateTaskInput{Title: "Đổi người", AssigneeID: &w.member.ID})
	if err != nil {
		t.Fatal(err)
	}
	w.rebuild(t)
	owner := &w.owner.ID
	if _, err := w.tasks.Update(w.ctx, Human(w.owner.ID), task.ID, UpdateTaskInput{AssigneeID: &owner}); err != nil {
		t.Fatal(err)
	}
	w.rebuild(t)
	h, err := w.svc.History(w.ctx, w.owner.ID, w.wsID, "TASK", task.ID, time.Time{}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	// Asserted by state, not order: the DB and Go clocks may differ by a few ms.
	var closed, open []string
	for _, it := range h.Items {
		if it.EdgeType != "OWNED_BY" {
			continue
		}
		if it.ValidTo != nil {
			closed = append(closed, it.Node.ID)
		} else {
			open = append(open, it.Node.ID)
		}
	}
	if len(closed) != 1 || closed[0] != w.member.ID || len(open) != 1 || open[0] != w.owner.ID {
		t.Fatalf("OWNED_BY history closed=%v open=%v", closed, open)
	}
}
```

`LeaveChatRoomMember(ctx, LeaveChatRoomMemberParams{RoomID, UserID}) error` (`server/pkg/db/generated/chat.sql.go:1014`).

Chạy `cd server && go test ./internal/service/ -run TestGraph -count=1 -v` → biên dịch hỏng (chưa có `GraphService`).

- [ ] **Bước 2: Cổng lớp 2.** `server/internal/service/graph_gate.go`:

```go
package service

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/graph"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// graphGate is layer 2 (C-11 §6.2): every node the SQL filter admitted is
// read again the way its module reads it before it reaches the caller. Task,
// meeting and project use the module's own decision — the row exists in the
// caller's organization and its workspace is one the caller belongs to
// (TaskService.authorizeActor, MeetingService.authorize, TaskService.GetProject);
// the workspace set comes from ListWorkspaces once per request instead of one
// RequireMember per node. Chat rooms go through authorizeRoomRead itself.
type graphGate struct {
	s           *GraphService
	userID      string
	workspaceID string
	orgID       string
	member      map[string]bool
	seen        map[string]bool
}

func (g *graphGate) allow(ctx context.Context, nodeType, sourceID, nodeWorkspaceID string) (bool, error) {
	key := nodeType + ":" + sourceID
	if ok, done := g.seen[key]; done {
		return ok, nil
	}
	ok, err := g.check(ctx, nodeType, sourceID, nodeWorkspaceID)
	if err != nil {
		return false, err
	}
	g.seen[key] = ok
	if !ok && g.s.metrics != nil {
		g.s.metrics.IncGraphLayer2Dropped(nodeType)
	}
	return ok, nil
}

func (g *graphGate) check(ctx context.Context, nodeType, sourceID, nodeWorkspaceID string) (bool, error) {
	switch graph.NodeType(nodeType) {
	case graph.NodeTask:
		t, err := g.s.q.GetTask(ctx, sourceID)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		return t.OrganizationID == g.orgID && g.member[t.WorkspaceID], nil
	case graph.NodeMeeting:
		m, err := g.s.q.GetMeeting(ctx, sourceID)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		return m.OrganizationID == g.orgID && g.member[m.WorkspaceID], nil
	case graph.NodeProject:
		if !g.member[nodeWorkspaceID] {
			return false, nil
		}
		_, err := g.s.q.GetProject(ctx, db.GetProjectParams{ID: sourceID, OrganizationID: g.orgID, WorkspaceID: nodeWorkspaceID})
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return err == nil, err
	case graph.NodeThread:
		ws := nodeWorkspaceID
		if ws == "" || !g.member[ws] {
			ws = g.workspaceID
		}
		_, err := g.s.chat.authorizeRoomRead(ctx, g.userID, ws, sourceID)
		if err == nil {
			return true, nil
		}
		if graphRefusal(err) {
			return false, nil
		}
		return false, err
	case graph.NodeActor, graph.NodeTeam:
		// Organization-wide; the caller's membership was checked on entry.
		return true, nil
	}
	return false, nil
}

func graphRefusal(err error) bool {
	if isGateRefusal(err) {
		return true
	}
	var ce CodedError
	return errors.As(err, &ce) && (ce.Status == http.StatusForbidden || ce.Status == http.StatusNotFound)
}
```

- [ ] **Bước 3: Service.** `server/internal/service/graph.go`:

```go
package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/graph"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// GraphFlags is the flag port; *featureflag.Service satisfies it.
type GraphFlags interface {
	IsEnabled(ctx context.Context, key string, defaultVal bool) bool
}

// GraphMetrics counts layer-2 refusals; internal/metrics.Graph satisfies it.
type GraphMetrics interface {
	IncGraphLayer2Dropped(nodeType string)
}

// GraphService reads the Work Graph for a person (C-11 §6). Layer 1 is SQL
// over the projected visibility and reader_ids; layer 2 (graphGate) reads
// each node again through its module before it leaves, so a permission
// revoked after the projection ran is honoured at once.
type GraphService struct {
	q       *db.Queries
	orgs    *OrganizationService
	ws      *WorkspaceService
	chat    *ChatService
	flags   GraphFlags
	metrics GraphMetrics
}

func NewGraphService(q *db.Queries, orgs *OrganizationService, ws *WorkspaceService, chat *ChatService) *GraphService {
	return &GraphService{q: q, orgs: orgs, ws: ws, chat: chat}
}

// SetFlags wires graph_ui; unwired, the graph reads as turned off.
func (s *GraphService) SetFlags(f GraphFlags) { s.flags = f }

// SetMetrics attaches the layer-2 counter.
func (s *GraphService) SetMetrics(m GraphMetrics) { s.metrics = m }

// GraphNodeView is one node as the API shows it.
type GraphNodeView struct {
	Type, ID, Subtype, Title, Status, WorkspaceID, WorkspaceSlug string
	Deleted                                                    bool
}

// GraphNeighbor is one open edge seen from the root node.
type GraphNeighbor struct {
	EdgeType, Direction, Origin string
	ValidFrom                   time.Time
	Backfilled                  bool
	Node                        GraphNodeView
}

// GraphNeighborsQuery: EdgeTypes empty = all; Direction out|in|both (default
// both); At zero = the database's now; Limit 1..100 (default 50); Cursor from
// NextCursor.
type GraphNeighborsQuery struct {
	EdgeTypes []string
	Direction string
	At        time.Time
	Cursor    string
	Limit     int
}

type GraphNeighborsPage struct {
	Node       GraphNodeView
	Items      []GraphNeighbor
	NextCursor string
}

// GraphHistoryItem is one edge or fact in a node's history.
type GraphHistoryItem struct {
	Kind                        string // edge | fact
	EdgeType, FactType          string
	Direction, Origin           string
	ValidFrom                   time.Time
	ValidTo                     *time.Time
	Value, Previous             string
	Precision, PreviousPrecision string
	Backfilled                  bool
	Node                        *GraphNodeView
}

type GraphHistory struct {
	Node  GraphNodeView
	Items []GraphHistoryItem
}

// historyEdges is what the task timeline shows (spec §6.1).
var historyEdges = []string{
	string(graph.EdgeOwnedBy), string(graph.EdgeOriginatedFrom), string(graph.EdgeDependsOn),
	string(graph.EdgeBelongsTo), string(graph.EdgeParticipatedIn),
}

type graphViewer struct {
	userID, orgID string
	workspaces    []string
	gate          *graphGate
}

func (s *GraphService) viewer(ctx context.Context, userID, workspaceID string) (*graphViewer, error) {
	mem, err := s.ws.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return nil, err
	}
	if !s.uiEnabled(ctx, userID, mem.OrganizationID) {
		return nil, coded(http.StatusNotFound, "feature_disabled", "Work Graph chưa bật cho tổ chức này")
	}
	rows, err := s.orgs.ListWorkspaces(ctx, userID, mem.OrganizationID)
	if err != nil {
		return nil, err
	}
	v := &graphViewer{userID: userID, orgID: mem.OrganizationID}
	member := map[string]bool{}
	for _, r := range rows {
		v.workspaces = append(v.workspaces, r.ID)
		member[r.ID] = true
	}
	v.gate = &graphGate{s: s, userID: userID, workspaceID: workspaceID, orgID: mem.OrganizationID, member: member, seen: map[string]bool{}}
	return v, nil
}

func (s *GraphService) uiEnabled(ctx context.Context, userID, orgID string) bool {
	if s.flags == nil {
		return false
	}
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: userID, OrganizationID: orgID})
	return s.flags.IsEnabled(ctx, "graph_ui", false)
}

// root resolves the node in the path through both layers; anything the
// caller may not see is ErrNotFound, never told apart from a missing node.
func (s *GraphService) root(ctx context.Context, v *graphViewer, nodeType, nodeID string) (db.GraphGetVisibleNodeRow, error) {
	t, ok := graph.ParseNodeType(nodeType)
	if !ok || !graph.Projected[t] {
		return db.GraphGetVisibleNodeRow{}, Invalid("loại node không hợp lệ")
	}
	n, err := s.q.GraphGetVisibleNode(ctx, db.GraphGetVisibleNodeParams{
		OrganizationID: v.orgID, NodeType: string(t), SourceID: nodeID, WorkspaceIds: v.workspaces, UserID: v.userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return n, ErrNotFound
	}
	if err != nil {
		return n, err
	}
	ok, err = v.gate.allow(ctx, n.NodeType, n.SourceID, n.WorkspaceID)
	if err != nil {
		return n, err
	}
	if !ok {
		return n, ErrNotFound
	}
	return n, nil
}

// Neighbors returns the root's one-step neighbors valid at in.At.
func (s *GraphService) Neighbors(ctx context.Context, userID, workspaceID, nodeType, nodeID string, in GraphNeighborsQuery) (GraphNeighborsPage, error) {
	v, err := s.viewer(ctx, userID, workspaceID)
	if err != nil {
		return GraphNeighborsPage{}, err
	}
	n, err := s.root(ctx, v, nodeType, nodeID)
	if err != nil {
		return GraphNeighborsPage{}, err
	}
	dir := in.Direction
	if dir == "" {
		dir = "both"
	}
	if dir != "both" && dir != "out" && dir != "in" {
		return GraphNeighborsPage{}, Invalid("direction phải là out, in hoặc both")
	}
	for _, e := range in.EdgeTypes {
		if _, ok := graph.ParseEdgeType(e); !ok {
			return GraphNeighborsPage{}, Invalid("loại cạnh không hợp lệ: " + e)
		}
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	afterAt, afterID, err := parseGraphCursor(in.Cursor)
	if err != nil {
		return GraphNeighborsPage{}, err
	}
	rows, err := s.q.GraphListNeighbors(ctx, db.GraphListNeighborsParams{
		// No At = the database's now() (graph_read.sql), not this process's clock.
		OrganizationID: v.orgID, NodeID: n.ID, At: optTS(in.At),
		EdgeTypes: nonNil(in.EdgeTypes), Direction: dir, WorkspaceIds: v.workspaces, UserID: v.userID,
		AfterValidFrom: afterAt, AfterID: afterID, LimitN: int32(limit),
	})
	if err != nil {
		return GraphNeighborsPage{}, err
	}
	page := GraphNeighborsPage{Node: rootView(n), Items: []GraphNeighbor{}}
	for _, r := range rows {
		ok, err := v.gate.allow(ctx, r.PeerType, r.PeerSourceID, r.PeerWorkspaceID)
		if err != nil {
			return GraphNeighborsPage{}, err
		}
		if !ok {
			continue
		}
		page.Items = append(page.Items, GraphNeighbor{
			EdgeType: r.EdgeType, Direction: direction(r.Outgoing), Origin: r.Origin,
			ValidFrom: r.ValidFrom.Time, Backfilled: backfilled(r.Attrs),
			Node: GraphNodeView{Type: r.PeerType, ID: r.PeerSourceID, Subtype: r.PeerSubtype, Title: r.PeerTitle,
				Status: r.PeerStatus, WorkspaceID: r.PeerWorkspaceID, WorkspaceSlug: r.PeerWorkspaceSlug},
		})
	}
	if len(rows) == limit {
		last := rows[len(rows)-1]
		page.NextCursor = strconv.FormatInt(last.ValidFrom.Time.UnixMicro(), 10) + "." + last.EdgeID
	}
	return page, nil
}

// History returns the root's edges (open and closed) and facts, oldest first.
func (s *GraphService) History(ctx context.Context, userID, workspaceID, nodeType, nodeID string, from, to time.Time) (GraphHistory, error) {
	v, err := s.viewer(ctx, userID, workspaceID)
	if err != nil {
		return GraphHistory{}, err
	}
	n, err := s.root(ctx, v, nodeType, nodeID)
	if err != nil {
		return GraphHistory{}, err
	}
	edges, err := s.q.GraphListNodeHistoryEdges(ctx, db.GraphListNodeHistoryEdgesParams{
		OrganizationID: v.orgID, NodeID: n.ID, EdgeTypes: historyEdges, WorkspaceIds: v.workspaces, UserID: v.userID,
		FromAt: optTS(from), ToAt: optTS(to),
	})
	if err != nil {
		return GraphHistory{}, err
	}
	facts, err := s.q.GraphListNodeHistoryFacts(ctx, db.GraphListNodeHistoryFactsParams{
		OrganizationID: v.orgID, NodeID: n.ID, FromAt: optTS(from), ToAt: optTS(to),
	})
	if err != nil {
		return GraphHistory{}, err
	}
	out := GraphHistory{Node: rootView(n), Items: []GraphHistoryItem{}}
	for _, r := range edges {
		ok := r.PeerDeleted && (r.PeerType == string(graph.NodeActor) || r.PeerType == string(graph.NodeTeam))
		if !ok {
			if ok, err = v.gate.allow(ctx, r.PeerType, r.PeerSourceID, r.PeerWorkspaceID); err != nil {
				return GraphHistory{}, err
			}
		}
		if !ok {
			continue
		}
		node := GraphNodeView{Type: r.PeerType, ID: r.PeerSourceID, Subtype: r.PeerSubtype, Title: r.PeerTitle,
			Status: r.PeerStatus, WorkspaceID: r.PeerWorkspaceID, WorkspaceSlug: r.PeerWorkspaceSlug, Deleted: r.PeerDeleted}
		out.Items = append(out.Items, GraphHistoryItem{
			Kind: "edge", EdgeType: r.EdgeType, Direction: direction(r.Outgoing), Origin: r.Origin,
			ValidFrom: r.ValidFrom.Time, ValidTo: timePtr(r.ValidTo), Backfilled: backfilled(r.Attrs), Node: &node,
		})
	}
	for _, f := range facts {
		var a struct {
			Precision         string `json:"precision"`
			Previous          string `json:"previous"`
			PreviousPrecision string `json:"previous_precision"`
			Backfill          bool   `json:"backfill"`
		}
		_ = json.Unmarshal(f.Attrs, &a)
		out.Items = append(out.Items, GraphHistoryItem{
			Kind: "fact", FactType: f.FactType, Origin: graph.OriginSystem, ValidFrom: f.ValidFrom.Time, ValidTo: timePtr(f.ValidTo),
			Value: f.Value, Previous: a.Previous, Precision: a.Precision, PreviousPrecision: a.PreviousPrecision, Backfilled: a.Backfill,
		})
	}
	sortHistory(out.Items)
	return out, nil
}

func sortHistory(items []GraphHistoryItem) {
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && items[j].ValidFrom.Before(items[j-1].ValidFrom); j-- {
			items[j], items[j-1] = items[j-1], items[j]
		}
	}
}

func rootView(n db.GraphGetVisibleNodeRow) GraphNodeView {
	return GraphNodeView{Type: n.NodeType, ID: n.SourceID, Subtype: n.Subtype, Title: n.Title, Status: n.Status,
		WorkspaceID: n.WorkspaceID, WorkspaceSlug: n.WorkspaceSlug}
}

func direction(outgoing bool) string {
	if outgoing {
		return "out"
	}
	return "in"
}

func backfilled(attrs []byte) bool {
	var a struct {
		Backfill bool `json:"backfill"`
	}
	_ = json.Unmarshal(attrs, &a)
	return a.Backfill
}

func timePtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func optTS(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: !t.IsZero()} }

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// parseGraphCursor reads "<unix micros>.<edge id>", the house cursor shape.
func parseGraphCursor(c string) (pgtype.Timestamptz, string, error) {
	if c == "" {
		return pgtype.Timestamptz{}, "", nil
	}
	micros, id, ok := strings.Cut(c, ".")
	n, err := strconv.ParseInt(micros, 10, 64)
	if !ok || err != nil || id == "" {
		return pgtype.Timestamptz{}, "", Invalid("cursor không hợp lệ")
	}
	return pgtype.Timestamptz{Time: time.UnixMicro(n), Valid: true}, id, nil
}
```

Ngày 2026-10-07 package `service` chưa có hàm nào tên `optTS`, `timePtr`, `nonNil`, `direction`, `backfilled`, `rootView`, `sortHistory`, `parseGraphCursor`, `graphRefusal`; nếu lúc làm đã có, trình biên dịch báo trùng và chỉ cần thêm tiền tố `graph`. `sortHistory` là sắp chèn để giữ thứ tự ổn định giữa cạnh và fact cùng thời điểm.

- [ ] **Bước 4: Chạy.**

```bash
cd server && go test ./internal/service/ -run TestGraph -count=1 -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)'
cd server && go test ./internal/ -count=1 -run 'TestActorConstructedOnlyInService|TestMembershipDecidedInOnePlace|TestGraphTablesWrittenOnlyByProjector|TestLayering'
```

- [ ] **Bước 5: Commit.**

```bash
git add server/internal/service/graph.go server/internal/service/graph_gate.go server/internal/service/graph_test.go
git commit -m "feat(graph): read service — neighbors and history behind two layers

Layer 1 filters by projected visibility; layer 2 re-reads every node the way
its module decides (rows + the caller's workspace set; authorizeRoomRead for
chat), so a kick that wrote no event still hides the room at once.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 10: HTTP, Swagger và ma trận cách ly

**Files:**
- Create: `server/internal/handler/dto/sdi/graph.go`, `dto/sdo/graph.go`, `server/internal/handler/graph.go`, `server/internal/handler/router/graph.go`, `server/internal/handler/graph_test.go`
- Modify: `server/internal/handler/router/openapi.go` (`pathParamSDI`), `router/routes.go`, `router/router.go`, `handler/router.go` (`Deps.Graph`, `handler.New`), `server/cmd/server/main.go` (dựng `GraphService`), `server/internal/handler/auth_test.go` (`newTestDeps`)
- Modify: `server/internal/handler/isolation_matrix_test.go`, `isolation_world_test.go`

**Interfaces:**
- Produces: `GET /api/v1/workspaces/{workspaceID}/graph/nodes/{nodeType}/{nodeID}/neighbors`, `GET …/history`; JSON như các SDO dưới.

- [ ] **Bước 1: SDI/SDO.** `server/internal/handler/dto/sdi/graph.go`:

```go
package sdi

// GraphNeighborsSDI is the query of GET …/graph/nodes/{nodeType}/{nodeID}/neighbors.
type GraphNeighborsSDI struct {
	EdgeTypes string `query:"edge_types" description:"Loại cạnh, phân cách bằng dấu phẩy; trống là mọi loại" example:"ORIGINATED_FROM,OWNED_BY"`
	Direction string `query:"direction" enum:"out,in,both" description:"Chiều nhìn từ node gốc (mặc định both)" example:"both"`
	At        string `query:"at" description:"Lát cắt thời gian RFC 3339 (mặc định bây giờ)" example:"2026-10-07T00:00:00Z"`
	Cursor    string `query:"cursor" description:"next_cursor của trang trước" example:"1791331200000000.01J8X4EDGE00000000000000000"`
	Limit     int32  `query:"limit" description:"Kích thước trang (mặc định 50, tối đa 100)" example:"50"`
}

// GraphHistorySDI is the query of GET …/graph/nodes/{nodeType}/{nodeID}/history.
type GraphHistorySDI struct {
	From string `query:"from" description:"Chỉ lấy mục còn hiệu lực từ thời điểm này (RFC 3339)" example:"2026-10-01T00:00:00Z"`
	To   string `query:"to" description:"Chỉ lấy mục bắt đầu trước thời điểm này (RFC 3339)" example:"2026-10-31T00:00:00Z"`
}
```

`server/internal/handler/dto/sdo/graph.go`:

```go
package sdo

// GraphNodeDTO is a node as the panel shows it; the client builds its link.
type GraphNodeDTO struct {
	Type          string `json:"type" description:"Loại node trong catalogue" example:"TASK"`
	ID            string `json:"id" description:"ULID bản ghi nguồn" example:"01J8X4TASKN1P2Q3R4S5T6U7V8"`
	Subtype       string `json:"subtype" description:"member hoặc agent (ACTOR), chat_room hoặc email_thread (THREAD); rỗng với loại khác" example:"member"`
	Title         string `json:"title" description:"Tiêu đề ở lần chiếu gần nhất" example:"Viết spec"`
	Status        string `json:"status" description:"Trạng thái nguồn ở lần chiếu gần nhất" example:"todo"`
	WorkspaceID   string `json:"workspace_id" description:"Workspace của node; rỗng với node cấp tổ chức" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
	WorkspaceSlug string `json:"workspace_slug" description:"Slug workspace để dựng đường dẫn" example:"team"`
	Deleted       bool   `json:"deleted" description:"Nguồn đã xoá; chỉ gặp trong lịch sử, với ACTOR và TEAM" example:"false"`
}

// GraphNeighborDTO is one open edge seen from the root node.
type GraphNeighborDTO struct {
	EdgeType   string       `json:"edge_type" description:"Loại cạnh" example:"ORIGINATED_FROM"`
	Direction  string       `json:"direction" description:"out: node gốc là đầu từ; in: node gốc là đầu tới" example:"out"`
	Origin     string       `json:"origin" description:"SYSTEM, HUMAN, AI_CONFIRMED hoặc AI_SUGGESTED" example:"SYSTEM"`
	ValidFrom  string       `json:"valid_from" description:"Thời điểm nghiệp vụ cạnh bắt đầu (RFC 3339)" example:"2026-10-07T03:00:00Z"`
	Backfilled bool         `json:"backfilled" description:"Cạnh có từ lần dựng lại đầu tiên; valid_from là thời điểm của nguồn, không phải lúc quan hệ bắt đầu" example:"false"`
	Node       GraphNodeDTO `json:"node" description:"Node ở đầu kia"`
}

type GraphNeighborsSDO struct {
	Node       GraphNodeDTO       `json:"node" description:"Node gốc"`
	Items      []GraphNeighborDTO `json:"items" description:"Hàng xóm, mới nhất trước"`
	NextCursor string             `json:"next_cursor,omitempty" description:"Truyền làm cursor để đọc trang sau" example:"1791331200000000.01J8X4EDGE00000000000000000"`
}

// GraphHistoryItemDTO is one edge or fact in a node's history.
type GraphHistoryItemDTO struct {
	Kind              string        `json:"kind" description:"edge hoặc fact" example:"edge"`
	EdgeType          string        `json:"edge_type,omitempty" description:"Loại cạnh khi kind = edge" example:"OWNED_BY"`
	FactType          string        `json:"fact_type,omitempty" description:"due hoặc status khi kind = fact" example:"due"`
	Direction         string        `json:"direction,omitempty" description:"out hoặc in khi kind = edge" example:"out"`
	Origin            string        `json:"origin,omitempty" description:"Nguồn gốc" example:"SYSTEM"`
	ValidFrom         string        `json:"valid_from" description:"Bắt đầu hiệu lực (RFC 3339)" example:"2026-10-03T02:00:00Z"`
	ValidTo           string        `json:"valid_to,omitempty" description:"Hết hiệu lực; trống là còn hiệu lực" example:"2026-10-05T02:00:00Z"`
	Value             string        `json:"value,omitempty" description:"Giá trị fact" example:"2026-10-20"`
	Previous          string        `json:"previous,omitempty" description:"Giá trị fact trước đó" example:"2026-10-15"`
	Precision         string        `json:"precision,omitempty" description:"date hoặc datetime với hạn" example:"date"`
	PreviousPrecision string        `json:"previous_precision,omitempty" description:"Độ chính xác của giá trị trước" example:"date"`
	Backfilled        bool          `json:"backfilled" description:"Có từ lần dựng lại đầu tiên" example:"false"`
	Node              *GraphNodeDTO `json:"node,omitempty" description:"Node ở đầu kia khi kind = edge"`
}

type GraphHistorySDO struct {
	Node  GraphNodeDTO          `json:"node" description:"Node gốc"`
	Items []GraphHistoryItemDTO `json:"items" description:"Lịch sử, cũ nhất trước"`
}
```

- [ ] **Bước 2: Handler.** `server/internal/handler/graph.go`:

```go
package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) graphNeighbors(w http.ResponseWriter, r *http.Request) {
	if h.Graph == nil {
		respondError(w, http.StatusNotImplemented, "graph_unavailable", "Work Graph chưa sẵn sàng")
		return
	}
	v := r.URL.Query()
	in := service.GraphNeighborsQuery{Direction: strings.TrimSpace(v.Get("direction")), Cursor: strings.TrimSpace(v.Get("cursor"))}
	for _, e := range strings.Split(v.Get("edge_types"), ",") {
		if e = strings.TrimSpace(e); e != "" {
			in.EdgeTypes = append(in.EdgeTypes, e)
		}
	}
	if raw := strings.TrimSpace(v.Get("at")); raw != "" {
		at, ok := parseRFC3339(raw)
		if !ok {
			respondError(w, http.StatusBadRequest, "invalid_request", "at phải là thời điểm RFC 3339")
			return
		}
		in.At = at
	}
	if raw := strings.TrimSpace(v.Get("limit")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			respondError(w, http.StatusBadRequest, "invalid_request", "limit phải là số nguyên dương")
			return
		}
		in.Limit = n
	}
	page, err := h.Graph.Neighbors(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "nodeType"), chi.URLParam(r, "nodeID"), in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.GraphNeighborsSDO{Node: graphNodeDTO(page.Node), Items: []sdo.GraphNeighborDTO{}, NextCursor: page.NextCursor}
	for _, it := range page.Items {
		out.Items = append(out.Items, sdo.GraphNeighborDTO{
			EdgeType: it.EdgeType, Direction: it.Direction, Origin: it.Origin,
			ValidFrom: it.ValidFrom.UTC().Format(time.RFC3339), Backfilled: it.Backfilled, Node: graphNodeDTO(it.Node),
		})
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *handlers) graphHistory(w http.ResponseWriter, r *http.Request) {
	if h.Graph == nil {
		respondError(w, http.StatusNotImplemented, "graph_unavailable", "Work Graph chưa sẵn sàng")
		return
	}
	var from, to time.Time
	for name, dst := range map[string]*time.Time{"from": &from, "to": &to} {
		if raw := strings.TrimSpace(r.URL.Query().Get(name)); raw != "" {
			t, ok := parseRFC3339(raw)
			if !ok {
				respondError(w, http.StatusBadRequest, "invalid_request", name+" phải là thời điểm RFC 3339")
				return
			}
			*dst = t
		}
	}
	hist, err := h.Graph.History(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "workspaceID"),
		chi.URLParam(r, "nodeType"), chi.URLParam(r, "nodeID"), from, to)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.GraphHistorySDO{Node: graphNodeDTO(hist.Node), Items: []sdo.GraphHistoryItemDTO{}}
	for _, it := range hist.Items {
		item := sdo.GraphHistoryItemDTO{
			Kind: it.Kind, EdgeType: it.EdgeType, FactType: it.FactType, Direction: it.Direction, Origin: it.Origin,
			ValidFrom: it.ValidFrom.UTC().Format(time.RFC3339), Value: it.Value, Previous: it.Previous,
			Precision: it.Precision, PreviousPrecision: it.PreviousPrecision, Backfilled: it.Backfilled,
		}
		if it.ValidTo != nil {
			item.ValidTo = it.ValidTo.UTC().Format(time.RFC3339)
		}
		if it.Node != nil {
			n := graphNodeDTO(*it.Node)
			item.Node = &n
		}
		out.Items = append(out.Items, item)
	}
	respondJSON(w, http.StatusOK, out)
}

func graphNodeDTO(n service.GraphNodeView) sdo.GraphNodeDTO {
	return sdo.GraphNodeDTO{Type: n.Type, ID: n.ID, Subtype: n.Subtype, Title: n.Title, Status: n.Status,
		WorkspaceID: n.WorkspaceID, WorkspaceSlug: n.WorkspaceSlug, Deleted: n.Deleted}
}
```

(Đường import giống `handler/project.go`: `github.com/go-chi/chi/v5` và `github.com/unicomhub/uniwork/server/internal/middleware`.)

- [ ] **Bước 3: Route, Swagger, Deps.**

`server/internal/handler/router/graph.go`:

```go
package router

import (
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
)

// registerGraph mounts the Work Graph reads (C-11 §6). graph_ui is checked in
// the service with the organization RequireMember resolved, because the
// route middleware only knows the user.
func registerGraph(r api, h Routes) {
	r.Get("/workspaces/{workspaceID}/graph/nodes/{nodeType}/{nodeID}/neighbors", h.GraphNeighbors, apiOp{
		summary: "Work Graph neighbors", description: "Hàng xóm một bước đang hiệu lực của một node, sau hai lớp quyền.",
		tags: []string{"graph"}, sdi: sdi.GraphNeighborsSDI{}, sdo: sdo.GraphNeighborsSDO{}, auth: true,
	})
	r.Get("/workspaces/{workspaceID}/graph/nodes/{nodeType}/{nodeID}/history", h.GraphHistory, apiOp{
		summary: "Work Graph history", description: "Lịch sử cạnh và fact của một node (người phụ trách, hạn, nguồn gốc…).",
		tags: []string{"graph"}, sdi: sdi.GraphHistorySDI{}, sdo: sdo.GraphHistorySDO{}, auth: true,
	})
}
```

- `router/routes.go`: thêm `GraphNeighbors http.HandlerFunc` và `GraphHistory http.HandlerFunc`.
- `router/router.go`: gọi `registerGraph(authed, h)` cạnh `registerAudit(authed, h)`.
- `router/openapi.go`, trong `pathParamSDI`:

```go
	case "workspaceID,nodeType,nodeID":
		return struct {
			WorkspaceID string `path:"workspaceID" description:"ULID workspace" example:"01J8X4WS0N1P2Q3R4S5T6U7V8"`
			NodeType    string `path:"nodeType" description:"Loại node viết hoa: TASK, MEETING, PROJECT, ACTOR, TEAM, THREAD" example:"TASK"`
			NodeID      string `path:"nodeID" description:"ULID bản ghi nguồn của node" example:"01J8X4TASKN1P2Q3R4S5T6U7V8"`
		}{}
```

- `handler/router.go`: `Deps` thêm `Graph *service.GraphService`; trong `handler.New` map `GraphNeighbors: h.graphNeighbors, GraphHistory: h.graphHistory`.
- `server/cmd/server/main.go`, trước `handler.New(handler.Deps{...})`:

```go
	graphSvc := service.NewGraphService(q, orgSvc, wsSvc, chatSvc)
	graphSvc.SetFlags(flags)
	if reg != nil {
		graphSvc.SetMetrics(reg.Graph)
	}
```

và `Graph: graphSvc,` trong `handler.Deps`. (Dùng đúng tên biến chat service của `main.go`; ở bản hiện tại là `chatSvc`.)
- `server/internal/handler/auth_test.go`, trong `newTestDeps`, sau khi dựng `d`:

```go
	d.Graph = service.NewGraphService(q, orgs, ws, chatSvc)
	d.Graph.SetFlags(flags)
```

- [ ] **Bước 4: Ma trận cách ly.**
  - `isolation_matrix_test.go`: trong `isoParam` thêm `case "{nodeType}": return "TASK"` và `case "{nodeID}": return tn.get(t, "task")`; trong `isoSharedParams` thêm `"{nodeType}": true`; trong `isoUnseeded` thêm `"graph_dirty": "written only by the graph marker consumer; the isolation world runs no dispatcher and no route reads it"`.
  - `isolation_world_test.go`: trong `buildTenant`, ngay sau `w.buildActivity(t, tn)`:

```go
	// The isolation world runs no outbox dispatcher; project the tenant's graph
	// the way an operator would, so every graph table holds a row of A's.
	if _, err := projector.RebuildOrg(context.Background(), w.pool, w.q, tn.orgID, projector.RebuildOptions{}); err != nil {
		t.Fatalf("graph rebuild: %v", err)
	}
```

  Import `github.com/unicomhub/uniwork/server/internal/graph/projector`. Hai route có `{workspaceID}` nên được ma trận phủ mặc định; lượt "mixed" và "thành viên cả hai" gửi workspace của B cùng id việc của A, và service trả 404 vì node không thuộc tổ chức của workspace trong đường dẫn.

- [ ] **Bước 5: Test handler.** `server/internal/handler/graph_test.go`:

```go
package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/graph/projector"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestGraphRoutes(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	token, wsID := registerOrgWorkspace(t, srv, "graph-http@example.com", "Đồ thị", "graph-http")

	path := func(id string) string { return "/api/v1/workspaces/" + wsID + "/graph/nodes/TASK/" + id + "/neighbors" }
	// Flag off: the route answers 404 feature_disabled.
	res, body := doJSON(t, srv, http.MethodGet, path("x"), token, nil)
	if apiErr, _ := body["error"].(map[string]any); res.StatusCode != http.StatusNotFound || apiErr["code"] != "feature_disabled" {
		t.Fatalf("flag off = %d %v", res.StatusCode, body)
	}
	if _, err := q.UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: "graph_ui", ScopeType: featureflags.ScopeGlobal, ScopeID: "",
		Enabled: true, Note: "graph handler tests", CreatedBy: "test",
	}); err != nil {
		t.Fatal(err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}

	ws, err := q.GetWorkspaceByID(context.Background(), wsID)
	if err != nil {
		t.Fatal(err)
	}
	_, me := doJSON(t, srv, http.MethodGet, "/api/v1/me", token, nil)
	user, _ := me["user"].(map[string]any)
	userID, _ := user["id"].(string)
	task, err := d.Tasks.Create(context.Background(), service.Human(userID), wsID, service.CreateTaskInput{Title: "Qua HTTP"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := projector.RebuildOrg(context.Background(), pool, q, ws.OrganizationID, projector.RebuildOptions{}); err != nil {
		t.Fatal(err)
	}
	res, body = doJSON(t, srv, http.MethodGet, path(task.ID), token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("neighbors = %d %v", res.StatusCode, body)
	}
	node, _ := body["node"].(map[string]any)
	if node["id"] != task.ID || node["type"] != "TASK" {
		t.Fatalf("root = %v", body["node"])
	}
	if res, _ := doJSON(t, srv, http.MethodGet, path("01NOTATASK00000000000000000"), token, nil); res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown node = %d", res.StatusCode)
	}
	if res, _ := doJSON(t, srv, http.MethodGet, path(task.ID)+"?direction=sideways", token, nil); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad direction = %d", res.StatusCode)
	}
	hist := "/api/v1/workspaces/" + wsID + "/graph/nodes/TASK/" + task.ID + "/history"
	if res, body := doJSON(t, srv, http.MethodGet, hist, token, nil); res.StatusCode != http.StatusOK || body["items"] == nil {
		t.Fatalf("history = %d %v", res.StatusCode, body)
	}
}
```

`registerOrgWorkspace` (`task_attachments_regression_test.go:21`) trả `(token, wsID)`. Lỗi có hình `{"error": {"code", "message"}}` (`dto/sdo/common.go:6-13`). `GET /api/v1/me` trả `{"user": {"id", …}}`.

- [ ] **Bước 6: Chạy.**

```bash
cd server && go test ./internal/handler/ ./internal/handler/router/ -run 'TestGraphRoutes|TestSwaggerSpecFollowsChiRoutesAndSDI|TestEveryRouteFieldIsBound|TestTimelineRouteIsGone' -count=1 -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)'
cd server && go test ./internal/handler/ -run 'TestIsolationMatrix|TestEveryBodyIDFieldHasAReferenceCase|TestIsolationRealtime' -count=1 -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)'
```

Kết quả mong đợi: tất cả PASS. `TestIsolationMatrix` chạy lâu (vài phút); nó phải PASS với hai route mới ở các lượt control, cross-tenant, anonymous, mixed, member-of-both.

- [ ] **Bước 7: Commit.**

```bash
git add server/internal/handler/ server/cmd/server/main.go
git commit -m "feat(graph): GET neighbors and history under the workspace prefix

Routes sit under /workspaces/{workspaceID} so the tenant comes from
RequireMember and the isolation matrix covers them like any parent/child
route; /history because /timeline is reserved by TestTimelineRouteIsGone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11: Client: kiểu, endpoint, hook, flag theo tổ chức, realtime

**Files:**
- Create: `packages/core/types/graph.ts`, `packages/core/api/endpoints/graph.ts`, `graph.test.ts`, `packages/core/graph/keys.ts`, `hooks.ts`, `use-graph-ui.ts`, `hooks.test.tsx`
- Modify: `packages/core/package.json` (exports), `packages/core/realtime/use-realtime-sync.ts`, `use-realtime-sync.test.tsx`

**Interfaces:**
- Produces: `GraphNode`, `GraphNeighbor`, `GraphHistoryItem`, `GraphNeighbors`, `GraphHistory` (types); `getGraphNeighbors(wsId, nodeType, nodeId, opts?)`, `getGraphHistory(wsId, nodeType, nodeId)`; `graphKeys`; `useGraphNeighbors(wsId, nodeType, nodeId, { enabled })`, `useGraphHistory(...)`, `useGraphUI(organizationId): "loading" | "on" | "off" | "unknown"` từ `@uniwork/core/graph`.

- [ ] **Bước 1: Test endpoint đỏ.** `packages/core/api/endpoints/graph.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { getGraphHistory, getGraphNeighbors } from "./graph";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const node = { type: "MEETING", id: "m1", subtype: "", title: "Giao ban", status: "ENDED", workspace_id: "w1", workspace_slug: "team", deleted: false };

describe("graph endpoints", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
  });

  it("getGraphNeighbors builds the query and keeps the good rows", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ node, items: [{ edge_type: 1 }, { edge_type: "ORIGINATED_FROM", direction: "out", origin: "SYSTEM", valid_from: "2026-10-07T00:00:00Z", backfilled: false, node }], next_cursor: "c" }),
    );
    const got = await getGraphNeighbors("w1", "TASK", "t1", { edgeTypes: ["ORIGINATED_FROM", "OWNED_BY"], direction: "out", limit: 20 });
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain(
      "/api/v1/workspaces/w1/graph/nodes/TASK/t1/neighbors?edge_types=ORIGINATED_FROM%2COWNED_BY&direction=out&limit=20",
    );
    expect(got.items).toHaveLength(1);
    expect(got.next_cursor).toBe("c");
  });

  it("getGraphNeighbors degrades on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ items: "nope" }));
    await expect(getGraphNeighbors("w1", "TASK", "t1")).resolves.toEqual({ node: null, items: [], next_cursor: "" });
  });

  it("getGraphHistory degrades on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ node: 3, items: [{ kind: "edge" }] }));
    await expect(getGraphHistory("w1", "TASK", "t1")).resolves.toEqual({ node: null, items: [] });
  });
});
```

(`{ kind: "edge" }` thiếu `valid_from` bắt buộc nên bị bỏ; `node: 3` không qua schema nên thành `null`.)

- [ ] **Bước 2: Kiểu và endpoint.** `packages/core/types/graph.ts`:

```ts
import { z } from "zod";

/** A Work Graph node as the API returns it (C-11). Lenient: types stay strings. */
export const GraphNodeSchema = z.object({
  type: z.string(),
  id: z.string(),
  subtype: z.string().optional().default(""),
  title: z.string().optional().default(""),
  status: z.string().optional().default(""),
  workspace_id: z.string().optional().default(""),
  workspace_slug: z.string().optional().default(""),
  deleted: z.boolean().optional().default(false),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphNeighborSchema = z.object({
  edge_type: z.string(),
  direction: z.string(),
  origin: z.string().optional().default("SYSTEM"),
  valid_from: z.string().optional().default(""),
  backfilled: z.boolean().optional().default(false),
  node: GraphNodeSchema,
});
export type GraphNeighbor = z.infer<typeof GraphNeighborSchema>;

export const GraphHistoryItemSchema = z.object({
  kind: z.string(),
  edge_type: z.string().optional().default(""),
  fact_type: z.string().optional().default(""),
  direction: z.string().optional().default(""),
  origin: z.string().optional().default("SYSTEM"),
  valid_from: z.string(),
  valid_to: z.string().optional().default(""),
  value: z.string().optional().default(""),
  previous: z.string().optional().default(""),
  precision: z.string().optional().default(""),
  previous_precision: z.string().optional().default(""),
  backfilled: z.boolean().optional().default(false),
  node: GraphNodeSchema.optional(),
});
export type GraphHistoryItem = z.infer<typeof GraphHistoryItemSchema>;

export interface GraphNeighbors {
  node: GraphNode | null;
  items: GraphNeighbor[];
  next_cursor: string;
}

export interface GraphHistory {
  node: GraphNode | null;
  items: GraphHistoryItem[];
}
```

`packages/core/api/endpoints/graph.ts`:

```ts
import { z } from "zod";
import {
  GraphHistoryItemSchema,
  GraphNeighborSchema,
  GraphNodeSchema,
  type GraphHistory,
  type GraphNeighbors,
} from "../../types/graph";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;

/** Keeps the rows that parse, so one drifted neighbor does not blank the panel. */
function lenientRows<T>(raw: unknown[], schema: z.ZodType<T>): T[] {
  const out: T[] = [];
  for (const item of raw) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

const Envelope = z.object({
  node: GraphNodeSchema.nullable().optional().catch(null),
  items: z.array(z.unknown()).optional().default([]),
  next_cursor: z.string().optional().catch(undefined),
});

function nodePath(wsId: string, nodeType: string, nodeId: string): string {
  return `/api/v1/workspaces/${enc(wsId)}/graph/nodes/${enc(nodeType)}/${enc(nodeId)}`;
}

export async function getGraphNeighbors(
  wsId: string,
  nodeType: string,
  nodeId: string,
  opts: { edgeTypes?: string[]; direction?: "out" | "in" | "both"; cursor?: string; limit?: number } = {},
): Promise<GraphNeighbors> {
  const p = new URLSearchParams();
  if (opts.edgeTypes?.length) p.set("edge_types", opts.edgeTypes.join(","));
  if (opts.direction) p.set("direction", opts.direction);
  if (opts.cursor) p.set("cursor", opts.cursor);
  if (opts.limit) p.set("limit", String(opts.limit));
  const qs = p.toString();
  const raw = await request(`${nodePath(wsId, nodeType, nodeId)}/neighbors${qs ? `?${qs}` : ""}`);
  const parsed = parseWithFallback(raw, Envelope, { node: null, items: [], next_cursor: undefined }, {
    endpoint: "GET /api/v1/workspaces/{ws}/graph/nodes/{type}/{id}/neighbors",
  });
  return { node: parsed.node ?? null, items: lenientRows(parsed.items ?? [], GraphNeighborSchema), next_cursor: parsed.next_cursor ?? "" };
}

export async function getGraphHistory(wsId: string, nodeType: string, nodeId: string): Promise<GraphHistory> {
  const raw = await request(`${nodePath(wsId, nodeType, nodeId)}/history`);
  const parsed = parseWithFallback(raw, Envelope, { node: null, items: [], next_cursor: undefined }, {
    endpoint: "GET /api/v1/workspaces/{ws}/graph/nodes/{type}/{id}/history",
  });
  return { node: parsed.node ?? null, items: lenientRows(parsed.items ?? [], GraphHistoryItemSchema) };
}
```

Chạy `pnpm --filter @uniwork/core exec vitest run api/endpoints/graph.test.ts` → PASS.

- [ ] **Bước 3: Khóa, hook, flag theo tổ chức.** `packages/core/graph/keys.ts`:

```ts
/** Work Graph query keys. The workspace sits at the root so one invalidation covers it. */
export const graphKeys = {
  all: ["graph"] as const,
  workspace: (wsId: string) => [...graphKeys.all, wsId] as const,
  node: (wsId: string, nodeType: string, nodeId: string) => [...graphKeys.workspace(wsId), nodeType, nodeId] as const,
  neighbors: (wsId: string, nodeType: string, nodeId: string) => [...graphKeys.node(wsId, nodeType, nodeId), "neighbors"] as const,
  history: (wsId: string, nodeType: string, nodeId: string) => [...graphKeys.node(wsId, nodeType, nodeId), "history"] as const,
};
```

`packages/core/graph/use-graph-ui.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { getPublicConfig } from "../api/endpoints/config";

const GRAPH_UI_FLAG = "graph_ui";

/**
 * Whether the Work Graph UI is on for an organization. Organization-scoped
 * overrides only evaluate when /config is asked for that organization, so
 * this reads its own answer (the useOfficeEnabled pattern). `on` only once
 * the answer arrived; `unknown` when it cannot be read.
 */
export function useGraphUI(organizationId: string | undefined): "loading" | "on" | "off" | "unknown" {
  const query = useQuery({
    queryKey: ["graph-public-config", organizationId ?? ""],
    queryFn: async () => {
      const config = await getPublicConfig(organizationId);
      if (typeof config.flags[GRAPH_UI_FLAG] !== "boolean") throw new Error("graph_config_unreadable");
      return config;
    },
    enabled: Boolean(organizationId),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  if (!organizationId) return "off";
  if (query.data) return query.data.flags[GRAPH_UI_FLAG] ? "on" : "off";
  return query.isError ? "unknown" : "loading";
}
```

`packages/core/graph/hooks.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import { getGraphHistory, getGraphNeighbors } from "../api/endpoints/graph";
import { graphKeys } from "./keys";

export { graphKeys } from "./keys";
export { useGraphUI } from "./use-graph-ui";

/** A 404 means hidden or not projected yet; retrying will not change it. */
function retryUnlessGone(count: number, err: unknown): boolean {
  return !(err instanceof ApiError && err.status === 404) && count < 2;
}

export function useGraphNeighbors(wsId: string, nodeType: string, nodeId: string, opts: { enabled: boolean }) {
  return useQuery({
    queryKey: graphKeys.neighbors(wsId, nodeType, nodeId),
    queryFn: () => getGraphNeighbors(wsId, nodeType, nodeId, { limit: 100 }),
    enabled: opts.enabled && !!wsId && !!nodeId,
    retry: retryUnlessGone,
  });
}

export function useGraphHistory(wsId: string, nodeType: string, nodeId: string, opts: { enabled: boolean }) {
  return useQuery({
    queryKey: graphKeys.history(wsId, nodeType, nodeId),
    queryFn: () => getGraphHistory(wsId, nodeType, nodeId),
    enabled: opts.enabled && !!wsId && !!nodeId,
    retry: retryUnlessGone,
  });
}
```

(Kiểm `ApiError` có trường `status` — `packages/core/api/http.ts`; test ở `meeting-room-files-tab.test.tsx` dựng `new ApiError("boom", "internal", 500)`.)

`packages/core/package.json`, trong `exports`: `"./graph": "./graph/hooks.ts"`.

`packages/core/graph/hooks.test.tsx` (mẫu `documents/hooks-favorites.test.tsx`):

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../runtime-config";
import { setAccessToken } from "../api/session";
import { useGraphUI } from "./hooks";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("useGraphUI", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
    setAccessToken("tok");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("reads the organization's own answer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: { graph_ui: true }, rum_sample_rate: 0, work_management_capabilities: {} }));
    const { result } = renderHook(() => useGraphUI("o1"), { wrapper });
    await waitFor(() => expect(result.current).toBe("on"));
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain("/api/v1/config?organization_id=o1");
  });

  it("is off without an organization and unknown when the answer drifts", async () => {
    expect(renderHook(() => useGraphUI(undefined), { wrapper }).result.current).toBe("off");
    // A fresh Response per call: the hook retries once, a second later.
    vi.mocked(fetch).mockImplementation(async () => json({ flags: {} }));
    const { result } = renderHook(() => useGraphUI("o2"), { wrapper });
    await waitFor(() => expect(result.current).toBe("unknown"), { timeout: 4_000 });
  });
});
```

(Đường import `setAccessToken` lấy theo `projects.test.ts:35-57`.)

- [ ] **Bước 4: Realtime.** `packages/core/realtime/use-realtime-sync.ts`:
  - import `graphKeys` từ `../graph/keys`;
  - trong nhánh task của `keysFor`, cạnh khối `homeKeys.summary`:

```ts
    // The graph trails its sources (ADR 0019): refresh now and once more later.
    if (payload.task_id && (type === "task.created" || type === "task.updated" || type === "task.deleted")) {
      push(graphKeys.node(wsId, "TASK", payload.task_id));
    }
```

  - khai `const GRAPH_INVALIDATE_MS = 3_000;` ở đầu `use-realtime-sync.ts` (sau các import; `TRANSCRIPT_INVALIDATE_MS` được import từ `invalidate-scheduler.ts`, không khai trong file này), và cạnh `transcriptScheduler`: `const graphScheduler = createInvalidateScheduler(qc, GRAPH_INVALIDATE_MS);`;
  - trong cleanup của effect, cạnh `transcriptScheduler.dispose();`: thêm `graphScheduler.dispose();` để timer 3 s không chạy sau khi unmount hay đổi workspace;
  - trong vòng `for (const queryKey of keysFor(...))`, trước `scheduler.schedule(queryKey)`:

```ts
        if (queryKey[0] === "graph") {
          scheduler.schedule(queryKey);
          graphScheduler.schedule(queryKey);
          continue;
        }
```

  - `allWorkspaceKeys(wsId)`: thêm `graphKeys.workspace(wsId)`.

Test trong `use-realtime-sync.test.tsx` (theo mẫu `:84-94`):

```ts
it("refreshes the task's graph now and again after the projector lag", () => {
  vi.useFakeTimers();
  const { invalidate, client } = setup();
  client.emit({ type: "task.updated", payload: { task_id: "t1" } });
  act(() => { vi.advanceTimersByTime(250); });
  const key = JSON.stringify(["graph", "ws1", "TASK", "t1"]);
  expect(keysCalled(invalidate).filter((k: string) => k === key)).toHaveLength(1);
  act(() => { vi.advanceTimersByTime(3_000); });
  expect(keysCalled(invalidate).filter((k: string) => k === key)).toHaveLength(2);
});
```

- [ ] **Bước 5: Chạy.**

```bash
pnpm --filter @uniwork/core exec vitest run api/endpoints/graph.test.ts graph/ realtime/
pnpm typecheck && pnpm --filter @uniwork/core lint && pnpm knip
```

Nếu file realtime vượt 500 dòng hiệu dụng, chuyển hằng và khối graph sang `packages/core/realtime/graph-invalidation.ts` (một hàm `isGraphKey` + hằng) rồi import.

- [ ] **Bước 6: Commit.**

```bash
git add packages/core/types/graph.ts packages/core/api/endpoints/graph.ts packages/core/api/endpoints/graph.test.ts \
  packages/core/graph/ packages/core/package.json packages/core/realtime/
git commit -m "feat(graph): client endpoints, hooks, org-scoped graph_ui and refresh

Neighbor rows parse one by one; graph keys refresh on task events and once
more three seconds later, because the graph trails its sources.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 12: Giao diện trên trang việc: "Liên quan" và "Dòng thời gian"

**Files:**
- Create: `packages/views/graph/graph-labels.ts`, `related-section.tsx`, `node-history-section.tsx`, `related-section.test.tsx`, `node-history-section.test.tsx`
- Modify: `packages/views/tasks/detail/components/properties-sidebar.tsx` (giữa `<TaskParentSection>` và `<TaskDetailMetadata>`), `task-detail-editors.tsx` (sau `<TaskDetailSubtasksSection>`)
- Modify: `packages/core/i18n/locales/vi.json`, `en.json` (mục `graph`), `docs/conventions.md` (bảng glossary)

**Interfaces:**
- Consumes: `useGraphNeighbors`, `useGraphHistory`, `useGraphUI` (Task 11); `useTaskStatuses(workspaceId)` (`@uniwork/core/tasks`).
- Produces: `RelatedSection({ workspaceId, nodeType, nodeId })`, `NodeHistorySection({ workspaceId, nodeType, nodeId })`.

- [ ] **Bước 1: Khóa i18n.** `vi.json`, mục mới cấp cao `graph`:

```json
"graph": {
  "related": {
    "title": "Liên quan",
    "loading": "Đang tải…",
    "error": "Không tải được mục liên quan.",
    "empty": "Chưa có gì liên quan. Việc tạo từ cuộc họp, thuộc dự án hoặc có người phụ trách sẽ hiện ở đây.",
    "updated": "Cập nhật lúc {{time}}",
    "system": "Tự động",
    "untitled": "Không có tiêu đề"
  },
  "groups": {
    "originated_from_out": "Xuất phát từ",
    "originated_from_in": "Sinh ra",
    "owned_by_out": "Người phụ trách",
    "owned_by_in": "Phụ trách",
    "belongs_to_out": "Thuộc về",
    "belongs_to_in": "Bao gồm",
    "depends_on_out": "Phụ thuộc vào",
    "depends_on_in": "Đang chờ việc này",
    "discussed_in_out": "Được bàn trong",
    "discussed_in_in": "Nơi bàn",
    "participated_in_out": "Đã tham dự",
    "participated_in_in": "Người tham dự",
    "evidenced_by_out": "Bằng chứng",
    "evidenced_by_in": "Là bằng chứng cho",
    "other": "Khác"
  },
  "history": {
    "title": "Dòng thời gian",
    "loading": "Đang tải…",
    "error": "Không tải được dòng thời gian.",
    "empty": "Chưa ghi nhận thay đổi nào.",
    "owned_by": "Giao cho {{name}}",
    "originated_from": "Xuất phát từ {{title}}",
    "belongs_to_project": "Thuộc dự án {{title}}",
    "belongs_to_task": "Là việc con của {{title}}",
    "belongs_to_in": "{{title}} là việc con của việc này",
    "depends_on_out": "Phụ thuộc vào {{title}}",
    "depends_on_in": "{{title}} phụ thuộc vào việc này",
    "participated_in": "{{name}} tham dự",
    "due_set": "Hạn {{to}}",
    "due_changed": "Hạn đổi {{from}} → {{to}}",
    "status_set": "Trạng thái {{to}}",
    "status_changed": "Trạng thái {{from}} → {{to}}",
    "since": "từ {{from}}",
    "range": "{{from}} – {{to}}",
    "before_graph": "trước khi có đồ thị"
  }
}
```

`en.json`, cùng khóa:

```json
"graph": {
  "related": {
    "title": "Related",
    "loading": "Loading…",
    "error": "Couldn't load related items.",
    "empty": "Nothing related yet. Tasks created from a meeting, in a project, or with an assignee show up here.",
    "updated": "Updated at {{time}}",
    "system": "Automatic",
    "untitled": "Untitled"
  },
  "groups": {
    "originated_from_out": "Originated from",
    "originated_from_in": "Gave rise to",
    "owned_by_out": "Owner",
    "owned_by_in": "Owns",
    "belongs_to_out": "Belongs to",
    "belongs_to_in": "Contains",
    "depends_on_out": "Depends on",
    "depends_on_in": "Waiting on this",
    "discussed_in_out": "Discussed in",
    "discussed_in_in": "Discussion of",
    "participated_in_out": "Attended",
    "participated_in_in": "Attendees",
    "evidenced_by_out": "Evidence",
    "evidenced_by_in": "Evidence for",
    "other": "Other"
  },
  "history": {
    "title": "Timeline",
    "loading": "Loading…",
    "error": "Couldn't load the timeline.",
    "empty": "No changes recorded yet.",
    "owned_by": "Assigned to {{name}}",
    "originated_from": "Originated from {{title}}",
    "belongs_to_project": "In project {{title}}",
    "belongs_to_task": "Subtask of {{title}}",
    "belongs_to_in": "{{title}} is a subtask of this task",
    "depends_on_out": "Depends on {{title}}",
    "depends_on_in": "{{title}} depends on this task",
    "participated_in": "{{name}} attended",
    "due_set": "Due {{to}}",
    "due_changed": "Due moved {{from}} → {{to}}",
    "status_set": "Status {{to}}",
    "status_changed": "Status {{from}} → {{to}}",
    "since": "since {{from}}",
    "range": "{{from}} – {{to}}",
    "before_graph": "before the graph existed"
  }
}
```

`docs/conventions.md`, bảng "Product nouns": thêm bốn dòng đúng bốn cột của bảng:

```
| related (Work Graph panel) | **liên quan** | Related | `graph.related.title = "Liên quan"` |
| originated from | **xuất phát từ** | Originated from | nguồn gốc của một việc (Work Graph) |
| graph timeline | **dòng thời gian** | Timeline | khác "Hoạt động" (audit + bình luận) của trang việc |
| Work Graph | **Work Graph** | Work Graph | tên hệ thống, không dịch |
```

- [ ] **Bước 2: Hàm nhãn.** `packages/views/graph/graph-labels.ts`:

```ts
import { Bot, CalendarDays, CircleDot, FolderKanban, ListTodo, Mail, MessageSquare, User, Users, type LucideIcon } from "lucide-react";
import { paths } from "@uniwork/core/paths";
import type { GraphHistoryItem, GraphNeighbor, GraphNode } from "@uniwork/core/types/graph";
import { shortDateFormat } from "../common/date-pill";
import { dateOnlyToLocalDate } from "../common/date-field";

/** Group order on the panel: where the work came from first, then who and where. */
const GROUP_ORDER = [
  "originated_from_out", "owned_by_out", "belongs_to_out", "depends_on_out", "depends_on_in",
  "discussed_in_out", "participated_in_in", "participated_in_out", "evidenced_by_out",
  "belongs_to_in", "owned_by_in", "originated_from_in", "discussed_in_in", "evidenced_by_in",
];

export function groupKey(edgeType: string, direction: string): string {
  return `${edgeType.toLowerCase()}_${direction === "in" ? "in" : "out"}`;
}

export function groupNeighbors(items: GraphNeighbor[]): { key: string; items: GraphNeighbor[] }[] {
  const by = new Map<string, GraphNeighbor[]>();
  for (const item of items) {
    const k = groupKey(item.edge_type, item.direction);
    by.set(k, [...(by.get(k) ?? []), item]);
  }
  const keys = [...GROUP_ORDER.filter((k) => by.has(k)), ...[...by.keys()].filter((k) => !GROUP_ORDER.includes(k))];
  return keys.map((key) => ({ key, items: by.get(key) ?? [] }));
}

/** Where a node opens; null when it has no page (a team, an agent, an email thread for now). */
export function graphNodeHref(node: GraphNode, orgSlug: string, fallbackWsSlug: string): string | null {
  const ws = paths.workspace(orgSlug, node.workspace_slug || fallbackWsSlug);
  switch (node.type) {
    case "TASK":
      return ws.task(node.id);
    case "MEETING":
      return ws.meeting(node.id);
    case "PROJECT":
      return ws.project(node.id);
    case "ACTOR":
      return node.subtype === "member" ? ws.person(node.id) : null;
    case "THREAD":
      return node.subtype === "chat_room" ? `${ws.chat()}?${new URLSearchParams({ room: node.id }).toString()}` : null;
    default:
      return null;
  }
}

export function graphNodeIcon(node: GraphNode): LucideIcon {
  switch (node.type) {
    case "TASK":
      return ListTodo;
    case "MEETING":
      return CalendarDays;
    case "PROJECT":
      return FolderKanban;
    case "ACTOR":
      return node.subtype === "agent" ? Bot : User;
    case "TEAM":
      return Users;
    case "THREAD":
      return node.subtype === "email_thread" ? Mail : MessageSquare;
    default:
      return CircleDot;
  }
}

/** A graph date: a calendar date stays that date in every zone; an instant uses the locale. */
export function formatGraphDate(value: string, precision: string, locale: string): string {
  if (!value) return "";
  const d = precision === "date" ? dateOnlyToLocalDate(value) : new Date(value);
  if (!d || Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(locale, shortDateFormat(d.toISOString()));
}

type Label = (key: string, vars?: Record<string, string>) => string;

/** The sentence one history row reads as. */
export function historySentence(item: GraphHistoryItem, label: Label, statusName: (key: string) => string, locale: string): string {
  if (item.kind === "fact") {
    if (item.fact_type === "due") {
      const to = formatGraphDate(item.value, item.precision, locale);
      return item.previous
        ? label("graph.history.due_changed", { from: formatGraphDate(item.previous, item.previous_precision, locale), to })
        : label("graph.history.due_set", { to });
    }
    if (item.fact_type === "status") {
      return item.previous
        ? label("graph.history.status_changed", { from: statusName(item.previous), to: statusName(item.value) })
        : label("graph.history.status_set", { to: statusName(item.value) });
    }
    return item.value;
  }
  const title = item.node?.title || label("graph.related.untitled");
  switch (item.edge_type) {
    case "OWNED_BY":
      return label("graph.history.owned_by", { name: title });
    case "ORIGINATED_FROM":
      return label("graph.history.originated_from", { title });
    case "BELONGS_TO":
      // In-edges are the node's children (a subtask pointing at its parent).
      if (item.direction === "in") return label("graph.history.belongs_to_in", { title });
      return item.node?.type === "TASK" ? label("graph.history.belongs_to_task", { title }) : label("graph.history.belongs_to_project", { title });
    case "DEPENDS_ON":
      return item.direction === "in" ? label("graph.history.depends_on_in", { title }) : label("graph.history.depends_on_out", { title });
    case "PARTICIPATED_IN":
      return label("graph.history.participated_in", { name: title });
    default:
      return title;
  }
}

/** When it held: "since …", "… – …", or no date for a backfilled row. */
export function historyWhen(item: GraphHistoryItem, label: Label, locale: string): string {
  if (item.backfilled) return label("graph.history.before_graph");
  const from = formatGraphDate(item.valid_from, "datetime", locale);
  if (!item.valid_to) return label("graph.history.since", { from });
  return label("graph.history.range", { from, to: formatGraphDate(item.valid_to, "datetime", locale) });
}
```

- [ ] **Bước 3: Test views đỏ.** `packages/views/graph/related-section.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { RelatedSection } from "./related-section";

const me: User = { id: "u1", email: "me@x.com", display_name: "Me", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi" };
const workspace: Workspace = { id: "w1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "org", organization_name: "Org" };
const meeting = { type: "MEETING", id: "m1", subtype: "", title: "Giao ban thứ hai", status: "ENDED", workspace_id: "w1", workspace_slug: "team", deleted: false };

function respond(flag: boolean, neighbors: () => Promise<unknown>) {
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.startsWith("/api/v1/config")) return Promise.resolve({ flags: { graph_ui: flag }, rum_sample_rate: 0, work_management_capabilities: {} });
    if (p.includes("/graph/nodes/TASK/t1/neighbors")) return neighbors();
    return Promise.resolve({});
  });
}

function shell() {
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={me}>
      <RelatedSection workspaceId="w1" nodeType="TASK" nodeId="t1" />
    </WorkspaceProvider>,
  );
}

beforeAll(() => initI18n());
beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockReset();
});

describe("RelatedSection", () => {
  it("groups neighbors and links the meeting a task came from", async () => {
    respond(true, () => Promise.resolve({ node: null, items: [{ edge_type: "ORIGINATED_FROM", direction: "out", origin: "SYSTEM", valid_from: "2026-10-07T00:00:00Z", backfilled: false, node: meeting }] }));
    render(shell());
    expect(await screen.findByText("Xuất phát từ")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Giao ban thứ hai" })).toHaveAttribute("href", "/org/team/meetings/m1");
  });

  it("renders nothing while the organization has the graph off", async () => {
    respond(false, () => Promise.resolve({ items: [] }));
    const { container } = render(shell());
    await new Promise((r) => setTimeout(r, 50));
    expect(container).toBeEmptyDOMElement();
  });

  it("offers a retry when the neighbors fail", async () => {
    respond(true, () => Promise.reject(new ApiError("boom", "internal", 500)));
    render(shell());
    expect(await screen.findByText("Không tải được mục liên quan.")).toBeInTheDocument();
    respond(true, () => Promise.resolve({ items: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText(/Chưa có gì liên quan/)).toBeInTheDocument();
  });
});
```

`packages/views/graph/node-history-section.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { NodeHistorySection } from "./node-history-section";

const me: User = { id: "u1", email: "me@x.com", display_name: "Me", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi" };
const workspace: Workspace = { id: "w1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "org", organization_name: "Org" };
const actor = (id: string, title: string) => ({ type: "ACTOR", id, subtype: "member", title, status: "active", workspace_id: "", workspace_slug: "", deleted: false });

beforeAll(() => initI18n());
beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.startsWith("/api/v1/config")) return Promise.resolve({ flags: { graph_ui: true }, rum_sample_rate: 0, work_management_capabilities: {} });
    if (p.endsWith("/task-statuses")) return Promise.resolve({ statuses: [], categories: [], total: 0 });
    if (p.includes("/history")) {
      return Promise.resolve({ node: null, items: [
        { kind: "edge", edge_type: "OWNED_BY", direction: "out", valid_from: "2026-10-03T02:00:00Z", valid_to: "2026-10-05T02:00:00Z", node: actor("u2", "An") },
        { kind: "edge", edge_type: "OWNED_BY", direction: "out", valid_from: "2026-10-05T02:00:00Z", node: actor("u3", "Bình") },
        { kind: "fact", fact_type: "due", valid_from: "2026-10-05T02:00:00Z", value: "2026-10-22", precision: "date", previous: "2026-10-15", previous_precision: "date" },
      ] });
    }
    return Promise.resolve({});
  });
});

it("reads the reassignment and the moved deadline as sentences", async () => {
  render(wrapWithNav(<WorkspaceProvider workspace={workspace} user={me}><NodeHistorySection workspaceId="w1" nodeType="TASK" nodeId="t1" /></WorkspaceProvider>));
  expect(await screen.findByRole("link", { name: "Giao cho Bình" })).toHaveAttribute("href", "/org/team/people/u3");
  expect(screen.getByText("Giao cho An")).toBeInTheDocument();
  expect(screen.getByText(/^Hạn đổi .+ → .+$/)).toBeInTheDocument();
});

it("shows the empty state when the node is not projected yet", async () => {
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.startsWith("/api/v1/config")) return Promise.resolve({ flags: { graph_ui: true }, rum_sample_rate: 0, work_management_capabilities: {} });
    if (p.endsWith("/task-statuses")) return Promise.resolve({ statuses: [], categories: [], total: 0 });
    if (p.includes("/history")) return Promise.reject(new ApiError("not found", "not_found", 404));
    return Promise.resolve({});
  });
  render(wrapWithNav(<WorkspaceProvider workspace={workspace} user={me}><NodeHistorySection workspaceId="w1" nodeType="TASK" nodeId="t1" /></WorkspaceProvider>));
  expect(await screen.findByText("Chưa ghi nhận thay đổi nào.")).toBeInTheDocument();
});
```

Chạy `pnpm --filter @uniwork/views exec vitest run graph/` → đỏ (chưa có component).

- [ ] **Bước 4: Component.** `packages/views/graph/related-section.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api/http";
import { useGraphNeighbors, useGraphUI } from "@uniwork/core/graph";
import type { GraphNeighbor } from "@uniwork/core/types/graph";
import { Button } from "@uniwork/ui/components/ui/button";
import { SidebarSection } from "../common/sidebar-section";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { graphNodeHref, graphNodeIcon, groupNeighbors } from "./graph-labels";

/**
 * "Liên quan": the node's one-step neighbors on the Work Graph (C-11 §7).
 * The graph trails its sources by seconds (ADR 0019), so the section says
 * when it read them instead of presenting itself as live.
 */
export function RelatedSection({ workspaceId, nodeType, nodeId }: { workspaceId: string; nodeType: string; nodeId: string }) {
  const { t, i18n } = useTranslation();
  const { workspace } = useWorkspace();
  const ui = useGraphUI(workspace.organization_id);
  const query = useGraphNeighbors(workspaceId, nodeType, nodeId, { enabled: ui === "on" });
  const groups = useMemo(() => groupNeighbors(query.data?.items ?? []), [query.data?.items]);
  if (ui !== "on") return null;
  // 404 = not projected yet (or hidden, deliberately indistinguishable): nothing related to show.
  const missing = query.error instanceof ApiError && query.error.status === 404;

  return (
    <SidebarSection title={t("graph.related.title")}>
      <div data-testid="graph-related" className="space-y-3">
        {query.isPending ? (
          <p role="status" className="text-caption text-muted-foreground">{t("graph.related.loading")}</p>
        ) : query.isError && !missing ? (
          <div className="space-y-2">
            <p className="text-caption text-muted-foreground">{t("graph.related.error")}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : groups.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t("graph.related.empty")}</p>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="space-y-1">
              <h3 className="text-overline text-muted-foreground">
                {t(`graph.groups.${group.key}`, { defaultValue: t("graph.groups.other") })}
              </h3>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <RelatedRow
                    key={`${item.edge_type}:${item.direction}:${item.node.type}:${item.node.id}`}
                    item={item}
                    orgSlug={workspace.organization_slug}
                    wsSlug={workspace.slug}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
        {query.dataUpdatedAt ? (
          <p className="text-caption text-muted-foreground">
            {t("graph.related.updated", {
              time: new Date(query.dataUpdatedAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }),
            })}
          </p>
        ) : null}
      </div>
    </SidebarSection>
  );
}

function RelatedRow({ item, orgSlug, wsSlug }: { item: GraphNeighbor; orgSlug: string; wsSlug: string }) {
  const { t } = useTranslation();
  const Icon = graphNodeIcon(item.node);
  const href = graphNodeHref(item.node, orgSlug, wsSlug);
  const title = item.node.title || t("graph.related.untitled");
  return (
    <li className="flex min-h-8 items-center gap-1.5 rounded-md px-2 text-caption hover:bg-accent/50">
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      {href ? (
        <AppLink href={href} className="min-w-0 flex-1 truncate text-foreground">{title}</AppLink>
      ) : (
        <span className="min-w-0 flex-1 truncate text-foreground">{title}</span>
      )}
      {item.origin === "SYSTEM" ? <span className="shrink-0 text-muted-foreground">{t("graph.related.system")}</span> : null}
    </li>
  );
}
```

`packages/views/graph/node-history-section.tsx`:

```tsx
"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api/http";
import { useGraphHistory, useGraphUI } from "@uniwork/core/graph";
import { useTaskStatuses } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import { useWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { graphNodeHref, historySentence, historyWhen } from "./graph-labels";

/**
 * "Dòng thời gian": who owned the work, when the deadline moved, where it came
 * from — read from the Work Graph, newest first (C-11 §7). Distinct from the
 * task's "Hoạt động" (audit + comments).
 */
export function NodeHistorySection({ workspaceId, nodeType, nodeId }: { workspaceId: string; nodeType: string; nodeId: string }) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const { workspace } = useWorkspace();
  const ui = useGraphUI(workspace.organization_id);
  const query = useGraphHistory(workspaceId, nodeType, nodeId, { enabled: ui === "on" });
  const statuses = useTaskStatuses(workspaceId);
  if (ui !== "on") return null;
  const statusName = (key: string) => statuses.data?.statuses.find((s) => s.key === key)?.name ?? key;
  const label = (key: string, vars?: Record<string, string>) => t(key, vars);
  const items = [...(query.data?.items ?? [])].reverse();
  const missing = query.error instanceof ApiError && query.error.status === 404;

  return (
    <section aria-labelledby={headingId} data-testid="graph-history" className="space-y-2">
      <h2 id={headingId} className="text-title-sm text-foreground">{t("graph.history.title")}</h2>
      {query.isPending ? (
        <p role="status" className="text-caption text-muted-foreground">{t("graph.history.loading")}</p>
      ) : query.isError && !missing ? (
        <div className="space-y-2">
          <p className="text-caption text-muted-foreground">{t("graph.history.error")}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>{t("common.retry")}</Button>
        </div>
      ) : items.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t("graph.history.empty")}</p>
      ) : (
        <ol className="space-y-1.5">
          {items.map((item, index) => {
            const sentence = historySentence(item, label, statusName, i18n.language);
            // Spec §7: a row opens the entity it names.
            const href = item.node ? graphNodeHref(item.node, workspace.organization_slug, workspace.slug) : null;
            return (
              <li key={`${item.kind}:${item.edge_type || item.fact_type}:${item.valid_from}:${index}`} className="flex flex-wrap items-baseline gap-x-2 text-body">
                {href ? (
                  <AppLink href={href} className="text-foreground underline-offset-4 hover:underline">{sentence}</AppLink>
                ) : (
                  <span className="text-foreground">{sentence}</span>
                )}
                <span className="text-caption text-muted-foreground">{historyWhen(item, label, i18n.language)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
```

Gắn vào trang việc:
- `properties-sidebar.tsx`: `import { RelatedSection } from "../../../graph/related-section";` và giữa `<TaskParentSection …/>` và `<TaskDetailMetadata …/>`: `<RelatedSection workspaceId={workspaceId} nodeType="TASK" nodeId={task.id} />`.
- `task-detail-editors.tsx`: `import { NodeHistorySection } from "../../../graph/node-history-section";` và ngay sau `<TaskDetailSubtasksSection …/>`: `<NodeHistorySection workspaceId={workspaceId} nodeType="TASK" nodeId={task.id} />`.

`RelatedSection` không gọi `useFlag`, nên các test đang mock `@uniwork/core/feature-flags` (chỉ có `usePublicConfig`, `properties-sidebar.test.tsx:143-160`) không vỡ. Section tự ẩn khi `/config?organization_id=` không trả `graph_ui: true`.

- [ ] **Bước 5: Chạy.**

```bash
pnpm --filter @uniwork/views exec vitest run graph/ tasks/detail/
pnpm --filter @uniwork/core exec vitest run i18n/
node --test scripts/i18n-duplicate-keys.test.mjs scripts/task-detail-brand-scan.test.mjs
pnpm typecheck && pnpm lint && pnpm knip
```

- [ ] **Bước 6: Commit.**

```bash
git add packages/views/graph/ packages/views/tasks/detail/components/properties-sidebar.tsx \
  packages/views/tasks/detail/components/task-detail-editors.tsx packages/core/i18n/locales/ docs/conventions.md
git commit -m "feat(graph): Related and Timeline sections on the task page

Behind graph_ui read per organization. Related groups one-step neighbors by
edge and direction; Timeline reads owner, deadline and origin changes as
sentences, dates of backfilled rows withheld.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 13: e2e luồng thật

**Files:**
- Modify: `e2e/documents-flag.setup.ts` (bật thêm `graph`, `graph_ui` toàn cục)
- Create: `e2e/graph-related-panel.spec.ts`

- [ ] **Bước 1: Flag trong globalSetup.** Trong `e2e/documents-flag.setup.ts`, thay câu `INSERT` đơn bằng vòng lặp ba khóa:

```ts
    for (const key of ["documents", "graph", "graph_ui"]) {
      await client.query(
        `INSERT INTO feature_flag_overrides (id, flag_key, scope_type, scope_id, enabled, note, created_by, created_by_kind)
         VALUES ($1, $2, 'global', '', true, 'e2e: flag on for specs', 'e2e', 'system')
         ON CONFLICT (flag_key, scope_type, scope_id) DO UPDATE SET enabled = true`,
        [`e2e-${key}-global`, key],
      );
    }
```

và điều kiện chờ thành `body.flags?.documents === true && body.flags?.graph_ui === true`. (`graph` không public nên không thấy qua `/config`; nó chung chu kỳ cache 30 s với `graph_ui`.)

- [ ] **Bước 2: Spec.** `e2e/graph-related-panel.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import {
  createInstantMeeting,
  createRecordingAccount,
  joinWorkspaceAsMember,
  loginViaUi,
  registerApiUser,
} from "./meeting-recording-fixture";

test("a task made from a meeting shows where it came from and who owned it", async ({ page }) => {
  test.slow();
  const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  const host = await createRecordingAccount(page, api, "graph-host");
  const peer = await registerApiUser(page, api, "graph-peer");
  await joinWorkspaceAsMember(page, api, host.token, host.wsId, peer);
  const auth = { authorization: `Bearer ${host.token}`, "content-type": "application/json" };
  const meeting = await createInstantMeeting(page, api, host.token, host.wsId, "Giao ban đồ thị");

  const created = await page.request.post(`${api}/api/v1/meetings/${meeting.id}/summary/tasks`, {
    headers: auth, data: { items: [{ title: "Gửi báo giá e2e" }] },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { task_ids: [taskId] } = (await created.json()) as { task_ids: string[] };

  const idOf = async (token: string) =>
    ((await (await page.request.get(`${api}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } })).json()) as { user: { id: string } }).user.id;
  const hostId = await idOf(host.token);
  const peerId = await idOf(peer.token);
  const history = `${api}/api/v1/workspaces/${host.wsId}/graph/nodes/TASK/${taskId}/history`;
  const ownedBy = async () =>
    ((await (await page.request.get(history, { headers: auth })).json()) as { items?: { edge_type?: string; node?: { id: string } }[] })
      .items?.filter((i) => i.edge_type === "OWNED_BY").map((i) => i.node?.id) ?? [];
  // Changes inside one projection window fold into the final state (spec §13 #10),
  // so wait for the first assignment to land before making the second.
  for (const [assignee, count] of [[hostId, 1], [peerId, 2]] as const) {
    const res = await page.request.patch(`${api}/api/v1/tasks/${taskId}`, { headers: auth, data: { assignee_id: assignee } });
    expect(res.ok(), await res.text()).toBeTruthy();
    await expect.poll(async () => (await ownedBy()).length, { timeout: 30_000 }).toBe(count);
  }

  await loginViaUi(page, host.email);
  await page.goto(`/${host.orgSlug}/${host.wsSlug}/tasks/${taskId}`);
  const related = page.getByTestId("graph-related");
  // The graph trails its sources by seconds: reload until the projection lands.
  await expect(async () => {
    await page.reload();
    await expect(related.getByText("Xuất phát từ")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(related.getByRole("link", { name: "Giao ban đồ thị" })).toBeVisible();

  const timeline = page.getByTestId("graph-history");
  await expect(timeline.getByText(/^Giao cho /)).toHaveCount(2);
});
```

`ApiUser` (`e2e/meeting-recording-fixture.ts:20-23`) chỉ có `token`, `email`, nên id lấy qua `GET /api/v1/me` với token của từng người.

- [ ] **Bước 3: Chạy riêng spec** (app đang chạy bằng `make start`):

```bash
pnpm exec playwright test e2e/graph-related-panel.spec.ts --project=chromium
```

Kết quả mong đợi: 1 passed. Không chạy cả bộ e2e.

- [ ] **Bước 4: Commit.**

```bash
git add e2e/documents-flag.setup.ts e2e/graph-related-panel.spec.ts
git commit -m "test(e2e): task from a meeting shows its origin and owner history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 14: Đo tải và đóng lát

**Files:**
- Create: `scripts/load/graph-seed.sql`, `scripts/load/graph-neighbors.k6.js`
- Modify: `scripts/load/README.md`

- [ ] **Bước 1: Seed 1 triệu cạnh.** `scripts/load/graph-seed.sql` dựng node trên **việc và thành viên thật** của một tổ chức perf, để lớp 2 (`GetTask`) tìm thấy nguồn và phép đo đọc đúng đường hàng xóm. Tổ chức này chỉ dùng cho tải: `graph-rebuild --verify` trên nó sẽ coi các cạnh tổng hợp là lệch, nên phép đo §9 về rebuild/verify chạy trên tổ chức khác (Bước 3). Muốn 1 triệu cạnh (5 cạnh mỗi việc) thì tổ chức cần khoảng 200 000 việc: `go run ./cmd/seed --orgs 1 --users 200 --tasks 200000` trên một database riêng.

```sql
-- Work Graph load set (C-11 §8): ~5 edges per real task of one perf org.
-- psql -v org_id=<id> -v tag=graphload -f scripts/load/graph-seed.sql
-- Run on an org reserved for load: rebuild/verify treats these edges as drift.
\set ON_ERROR_STOP on
CREATE TEMP TABLE seed_tasks AS
  SELECT t.id, t.workspace_id, row_number() OVER (ORDER BY t.id) AS n
  FROM tasks t WHERE t.organization_id = :'org_id';
CREATE TEMP TABLE seed_members AS
  SELECT m.user_id AS id, row_number() OVER (ORDER BY m.user_id) AS n
  FROM organization_members m WHERE m.organization_id = :'org_id';
INSERT INTO graph_nodes (id, organization_id, workspace_id, node_type, source_id, title, visibility)
SELECT :'tag' || '-gt-' || n, :'org_id', workspace_id, 'TASK', id, 'Việc ' || n, 'workspace' FROM seed_tasks
ON CONFLICT DO NOTHING;
INSERT INTO graph_nodes (id, organization_id, node_type, subtype, source_id, title, visibility)
SELECT :'tag' || '-ga-' || n, :'org_id', 'ACTOR', 'member', id, 'Người ' || n, 'organization' FROM seed_members
ON CONFLICT DO NOTHING;
-- Edges join nodes by source id, so nodes a projector already wrote are reused.
CREATE TEMP TABLE seed_task_nodes AS
  SELECT s.n, g.id AS node_id FROM seed_tasks s
  JOIN graph_nodes g ON g.organization_id = :'org_id' AND g.node_type = 'TASK' AND g.source_id = s.id;
CREATE TEMP TABLE seed_actor_nodes AS
  SELECT m.n, g.id AS node_id FROM seed_members m
  JOIN graph_nodes g ON g.organization_id = :'org_id' AND g.node_type = 'ACTOR' AND g.source_id = m.id;
SELECT count(*) AS tasks FROM seed_task_nodes \gset
SELECT count(*) AS actors FROM seed_actor_nodes \gset
INSERT INTO graph_edges (id, organization_id, from_node, to_node, edge_type, origin, valid_from, evidence_kind, evidence_id)
SELECT :'tag' || '-eo-' || t.n, :'org_id', t.node_id, a.node_id, 'OWNED_BY', 'SYSTEM', now() - interval '30 days', 'source_row', :'tag'
FROM seed_task_nodes t JOIN seed_actor_nodes a ON a.n = 1 + (t.n % :actors)
ON CONFLICT DO NOTHING;
INSERT INTO graph_edges (id, organization_id, from_node, to_node, edge_type, origin, valid_from, evidence_kind, evidence_id)
SELECT :'tag' || '-eb-' || t.n, :'org_id', t.node_id, p.node_id, 'BELONGS_TO', 'SYSTEM', now() - interval '20 days', 'source_row', :'tag'
FROM seed_task_nodes t JOIN seed_task_nodes p ON p.n = 1 + ((t.n * 7) % :tasks)
WHERE p.n <> t.n
ON CONFLICT DO NOTHING;
INSERT INTO graph_edges (id, organization_id, from_node, to_node, edge_type, origin, valid_from, evidence_kind, evidence_id)
SELECT :'tag' || '-ed-' || t.n || '-' || k, :'org_id', t.node_id, d.node_id, 'DEPENDS_ON', 'SYSTEM', now() - interval '10 days', 'source_row', :'tag'
FROM seed_task_nodes t CROSS JOIN generate_series(1, 3) k
JOIN seed_task_nodes d ON d.n = 1 + ((t.n * 13 + k * 101) % :tasks)
WHERE d.n <> t.n
ON CONFLICT DO NOTHING;
ANALYZE graph_nodes;
ANALYZE graph_edges;
```

(File SQL nằm ngoài cây Go nên arch test không quét; đây là dữ liệu tải, không phải đường ghi của sản phẩm. Mọi bộ ba là `TASK→ACTOR OWNED_BY`, `TASK→TASK BELONGS_TO`, `TASK→TASK DEPENDS_ON`, đều có trong catalogue nên trigger nhận.)

- [ ] **Bước 2: k6.** `scripts/load/graph-neighbors.k6.js` theo mẫu các script k6 đang có trong `scripts/load/`:
  - `setup()` đăng nhập `user0@perf.local` (mật khẩu `password123`), đọc workspace của tổ chức tải, rồi lấy tối đa 500 id việc thật bằng `GET /api/v1/workspaces/${WS}/tasks?limit=500`.
  - Mỗi vòng gọi `GET /api/v1/workspaces/${WS}/graph/nodes/TASK/${id}/neighbors?limit=50`, kèm `check(res, { "200": (r) => r.status === 200 })`.
  - Ngưỡng: `thresholds: { http_req_duration: ['p(95)<200'], checks: ['rate>0.99'] }`.

  Ghi vào `scripts/load/README.md`, mục "Work Graph": server phải bật `graph_ui` cho tổ chức tải (`FF_GRAPH_UI=true` khi khởi động, hoặc một override `graph_ui` global), chạy tay, không trong CI.

- [ ] **Bước 3: Đo cổng §9 trên máy dev.**
  - Mọi việc có `origin_type = 'meeting'` có cạnh `ORIGINATED_FROM` mở tới cuộc họp (kết quả phải là 0):

```sql
SELECT count(*) FROM tasks t
WHERE t.organization_id = :'org_id' AND t.origin_type = 'meeting'
  AND EXISTS (SELECT 1 FROM meetings m WHERE m.id = t.origin_id)
  AND NOT EXISTS (
    SELECT 1 FROM graph_nodes n
    JOIN graph_edges e ON e.from_node = n.id AND e.edge_type = 'ORIGINATED_FROM' AND e.valid_to IS NULL
    JOIN graph_nodes p ON p.id = e.to_node AND p.node_type = 'MEETING' AND p.source_id = t.origin_id
    WHERE n.organization_id = t.organization_id AND n.node_type = 'TASK' AND n.source_id = t.id);
```

  - Trên một tổ chức **không** chạy `graph-seed.sql`: bật `graph`, để worker bắt kịp, rồi `graph-rebuild --org <id> --verify` → `drift=0`.
  - Thời gian `graph-rebuild --org` cho tổ chức `cmd/seed --orgs 1 --tasks 100000` (trước đó chạy SQL tạo `organization_member_profiles` nếu seed thiếu) → ghi số đo.
  - k6 p95 hàng xóm ở 1 triệu cạnh → ghi số đo.
  - Ghi ba số vào mô tả PR. Đo được nhưng chưa đạt ngưỡng thì ghi đúng như vậy, không làm tròn.

- [ ] **Bước 4: Kiểm toàn bộ và đóng.**

```bash
make check
```

Đọc kết quả phần Go (gồm `go-cover-floor`) và phần lint, không chỉ đọc mã thoát. Nếu `server/coverage.floor` báo đã vượt sàn hơn 1 điểm, nâng sàn trong cùng PR. Mở PR bằng `make issue-pr`, để lại comment `[agent]` trên issue, đổi trạng thái kế hoạch thành `shipped` khi PR merge.
