# Task human-parity lát A — vá lỗi và nền

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Trạng thái:** in-progress — lát A của spec ô Task human-parity

**Goal:** Sửa hai lỗi đang làm người dùng hiểu sai trạng thái hệ thống (reaction không bao giờ hiện, lỗi tải bị hiển thị thành rỗng), dựng ranh giới lỗi cấp app, và bật lịch sử hoạt động trên trang chi tiết task bằng nguồn dữ liệu đã có.

**Architecture:** Server nhúng reaction vào danh sách bình luận qua một query gộp theo task. Client truyền `isError` từ hook dữ liệu lên controller rồi lên surface, tách hẳn khỏi nhánh rỗng. Lịch sử hoạt động dùng lại `AuditService.ResourceHistory` đã có đủ ba tầng; không viết endpoint mới, và route `timeline` trùng chức năng bị xóa.

**Tech Stack:** Go 1.27 (Chi, pgx, sqlc), TypeScript strict, React 19, TanStack Query, Zustand, Next.js App Router, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-12-tasks-human-parity-design.md` (mục 3.1 lát A, 4.2, 5, 6)

## Global Constraints

- Mỗi file `.ts`/`.tsx` tối đa 500 dòng, không tính dòng trống và comment (`max-lines`).
- Mọi JSX text node trong `packages/views/` đi qua `t()` (`i18next/no-literal-string`).
- Thêm khóa i18n phải thêm ở **cả** `packages/core/i18n/locales/vi.json` và `en.json`.
- Code comment viết bằng tiếng Anh. Spec và plan viết bằng tiếng Việt.
- `packages/core/` không dùng `localStorage`, không `process.env`, không `react-dom`.
- `packages/views/` không import `next/*`; điều hướng qua `useNavigation()` / `<AppLink>`.
- Mọi endpoint đổi phải có thêm một ca malformed-response trong `packages/core/api/endpoints/<domain>.test.ts`.
- Chỉ `packages/core/api/endpoints/` được tạo hình response, qua `parseWithFallback`. Không bao giờ cast JSON mạng thành `T`.
- Migration sau `004`: không `FOREIGN KEY`, index phải `CREATE INDEX CONCURRENTLY` một mình một file. **Lát A không thêm migration nào.**
- Sàn coverage chỉ đi lên. Nâng bằng chính commit kiếm được nó.
- Commit theo tiền tố quy ước: `feat(scope)`, `fix(scope)`, `test(scope)`, `docs`, `chore(scope)`. Hook `.githooks/prepare-commit-msg` tự gắn `Refs: UNI-nnn`; không gõ tay, không xóa.
- Không lát nào được sửa `server/internal/workcapability/`. Khả năng agent và VCS giữ nguyên Unavailable.

---

### Task 1: Query gộp reaction theo task (Go, tầng dữ liệu)

`ListCommentReactions` hiện có chỉ lấy theo một comment. Danh sách bình luận cần toàn bộ reaction của một task trong một lượt, nếu không sẽ thành N+1.

**Files:**
- Modify: `server/pkg/db/queries/task_collaboration.sql` (thêm query vào sau `ListCommentReactions`, dòng ~95)
- Modify: `server/internal/service/task.go` (thêm method sau `Comments`, dòng 455)
- Test: `server/internal/service/task_collaboration_test.go` (thêm test vào cuối file)

**Interfaces:**
- Consumes: `db.ListTaskCommentsRow`, `s.authorize(ctx, userID, taskID)` đã có.
- Produces: `func (s *TaskService) CommentReactionsForTask(ctx context.Context, userID, taskID string) ([]db.ListTaskCommentReactionsRow, error)` — Task 2 gọi nó từ handler.

Giữ nguyên chữ ký của `Comments`: nó có sáu nơi gọi, gồm `askuni_sources.go`, nên đổi kiểu trả về sẽ lan rộng không cần thiết.

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `server/internal/service/task_collaboration_test.go`:

```go
func TestCommentReactionsForTaskReturnsEveryReactionOnTheTask(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Reaction root"})
	if err != nil {
		t.Fatal(err)
	}

	first, err := s.AddCommentSuite(ctx, Human(ua.ID), task.ID, AddCommentInput{Body: "một"}, "")
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.AddCommentSuite(ctx, Human(ua.ID), task.ID, AddCommentInput{Body: "hai"}, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddCommentReaction(ctx, Human(ua.ID), first.ID, "👍"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddCommentReaction(ctx, Human(ua.ID), second.ID, "🎉"); err != nil {
		t.Fatal(err)
	}

	got, err := s.CommentReactionsForTask(ctx, ua.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
	byComment := map[string]string{}
	for _, r := range got {
		byComment[r.CommentID] = r.Emoji
	}
	if byComment[first.ID] != "👍" || byComment[second.ID] != "🎉" {
		t.Fatalf("reactions = %v", byComment)
	}
}
```

`taskFixture(t)` trả `(service, events, user, _, workspace)` và là helper mà mọi test
trong file này đang dùng. Chữ ký của `AddCommentReaction` xem ở
`server/internal/service/task_subscribers.go`; nếu nó trả về `(db.CommentReaction, error)`
thì dòng trên đúng như đã viết.


- [ ] **Step 2: Chạy test để thấy nó thất bại**

```bash
cd server && go test ./internal/service/ -run TestCommentReactionsForTask -v
```

Kỳ vọng: FAIL, biên dịch lỗi `s.CommentReactionsForTask undefined`.

- [ ] **Step 3: Thêm query**

Thêm vào `server/pkg/db/queries/task_collaboration.sql`, ngay sau `ListCommentReactions`:

```sql
-- name: ListTaskCommentReactions :many
SELECT r.*
FROM comment_reactions r
JOIN task_comments c ON c.id = r.comment_id
WHERE c.task_id = $1
  AND r.organization_id = $2
  AND r.workspace_id = $3
ORDER BY r.created_at;
```

- [ ] **Step 4: Sinh lại sqlc**

```bash
make sqlc
```

Kỳ vọng: `server/pkg/db/` có thêm `ListTaskCommentReactions` và `ListTaskCommentReactionsParams`.

- [ ] **Step 5: Thêm method service**

Thêm vào `server/internal/service/task.go` ngay sau `Comments` (dòng 455):

```go
// CommentReactionsForTask returns every reaction on every comment of the task
// in one round trip. Comments stays untouched: six callers depend on its
// signature, and only the detail screen needs the reactions.
func (s *TaskService) CommentReactionsForTask(ctx context.Context, userID, taskID string) ([]db.ListTaskCommentReactionsRow, error) {
	task, err := s.authorize(ctx, userID, taskID)
	if err != nil {
		return nil, err
	}
	return s.q.ListTaskCommentReactions(ctx, db.ListTaskCommentReactionsParams{
		TaskID: taskID, OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
	})
}
```

- [ ] **Step 6: Chạy test để thấy nó đạt**

```bash
cd server && go test ./internal/service/ -run TestCommentReactionsForTask -v
```

Kỳ vọng: PASS cả hai test.

- [ ] **Step 7: Commit**

```bash
git add server/pkg/db/queries/task_collaboration.sql server/pkg/db server/internal/service/task.go server/internal/service/task_collaboration_test.go
git commit -m "feat(tasks): query gộp reaction của mọi bình luận trên một task"
```

---

### Task 2: Trả reaction kèm danh sách bình luận (Go, tầng HTTP)

**Files:**
- Modify: `server/internal/handler/dto/sdo/task.go` (thêm trường vào `CommentDTO`, dòng ~41-56)
- Modify: `server/internal/handler/task_collaboration.go` (thêm hàm gộp, sau `commentDTOFromListRow` dòng 56)
- Modify: `server/internal/handler/task.go` (`listComments`, dòng 162-174)
- Test: `server/internal/handler/task_collaboration_test.go` (thêm test vào cuối file)

**Interfaces:**
- Consumes: `CommentReactionsForTask` từ Task 1; `sdo.CommentReactionDTO` đã có trong `dto/sdo/task_collaboration.go`.
- Produces: `GET /api/v1/tasks/{taskID}/comments` trả mỗi phần tử `comments[]` kèm `reactions: []` — Task 3 đọc đúng tên trường này.

- [ ] **Step 1: Viết test thất bại**

Thêm vào cuối `server/internal/handler/task_collaboration_test.go`:

```go
func TestListCommentsEmbedsReactions(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
		"title": "Reaction HTTP",
	})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, body)
	}
	taskID, _ := body["task"].(map[string]any)["id"].(string)

	res, body = doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/comments", token, map[string]any{
		"body": "một",
	})
	if res.StatusCode != 200 {
		t.Fatalf("create comment: %d %v", res.StatusCode, body)
	}
	commentID, _ := body["comment"].(map[string]any)["id"].(string)

	res, body = doJSON(t, srv, "POST", "/api/v1/comments/"+commentID+"/reactions", token, map[string]any{
		"emoji": "👍",
	})
	if res.StatusCode != 200 {
		t.Fatalf("add reaction: %d %v", res.StatusCode, body)
	}

	res, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/comments", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list comments: %d %v", res.StatusCode, body)
	}
	comments, _ := body["comments"].([]any)
	if len(comments) != 1 {
		t.Fatalf("comments = %v", body)
	}
	first, _ := comments[0].(map[string]any)
	reactions, ok := first["reactions"].([]any)
	if !ok {
		t.Fatalf("reactions thiếu hoặc null: %v", first)
	}
	if len(reactions) != 1 {
		t.Fatalf("reactions = %v, want 1", reactions)
	}
	if reactions[0].(map[string]any)["emoji"] != "👍" {
		t.Fatalf("emoji = %v", reactions[0])
	}
}

func TestListCommentsWithoutReactionsReturnsEmptyArrayNotNull(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	_, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
		"title": "No reaction",
	})
	taskID, _ := body["task"].(map[string]any)["id"].(string)
	doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/comments", token, map[string]any{"body": "một"})

	_, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/comments", token, nil)
	comments, _ := body["comments"].([]any)
	first, _ := comments[0].(map[string]any)
	reactions, ok := first["reactions"].([]any)
	if !ok {
		t.Fatalf("reactions phải là mảng rỗng, không phải null: %v", first)
	}
	if len(reactions) != 0 {
		t.Fatalf("reactions = %v, want rỗng", reactions)
	}
}
```

`suiteMutationWorld(t)` trả `(server, token, workspaceID, _)` và `doJSON` là hai helper
mà `task_collaboration_test.go` đang dùng cho mọi vòng HTTP.

- [ ] **Step 2: Chạy test để thấy nó thất bại**

```bash
cd server && go test ./internal/handler/ -run TestListComments -v
```

Kỳ vọng: FAIL vì `reactions` không có trong response.

- [ ] **Step 3: Thêm trường vào DTO**

Trong `server/internal/handler/dto/sdo/task.go`, thêm dòng cuối của `CommentDTO`, ngay sau `AvatarURL`:

```go
	Reactions   []CommentReactionDTO `json:"reactions"`
```

Không dùng `omitempty`: client cần mảng rỗng để phân biệt "chưa ai thả" với "server cũ không trả trường này".

- [ ] **Step 4: Thêm hàm gộp**

Trong `server/internal/handler/task_collaboration.go`, ngay sau `commentDTOFromListRow` (dòng 56):

```go
// groupCommentReactions buckets reactions by comment id. Every comment gets a
// non-nil slice so the JSON carries [] instead of null.
func groupCommentReactions(rows []db.ListTaskCommentReactionsRow) map[string][]sdo.CommentReactionDTO {
	out := make(map[string][]sdo.CommentReactionDTO, len(rows))
	for _, r := range rows {
		out[r.CommentID] = append(out[r.CommentID], sdo.CommentReactionDTO{
			ID:        r.ID,
			CommentID: r.CommentID,
			ActorType: r.ActorType,
			ActorID:   r.ActorID,
			Emoji:     r.Emoji,
			CreatedAt: r.CreatedAt.Time.Format(time.RFC3339),
		})
	}
	return out
}
```

Nếu `time` chưa được import trong file thì thêm vào khối import.

- [ ] **Step 5: Nối vào handler**

Thay thân `listComments` trong `server/internal/handler/task.go` (dòng 162-174):

```go
func (h *handlers) listComments(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserID(r.Context())
	taskID := chi.URLParam(r, "taskID")
	cs, err := h.Tasks.Comments(r.Context(), userID, taskID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	reactions, err := h.Tasks.CommentReactionsForTask(r.Context(), userID, taskID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	byComment := groupCommentReactions(reactions)
	out := make([]sdo.CommentDTO, 0, len(cs))
	for _, c := range cs {
		dto := commentDTOFromListRow(c)
		dto.Reactions = byComment[c.ID]
		if dto.Reactions == nil {
			dto.Reactions = []sdo.CommentReactionDTO{}
		}
		out = append(out, dto)
	}
	respondJSON(w, 200, sdo.CommentListSDO{Comments: out})
}
```

- [ ] **Step 6: Chạy test để thấy nó đạt**

```bash
cd server && go test ./internal/handler/ -run TestListComments -v
```

Kỳ vọng: PASS cả hai test.

- [ ] **Step 7: Chạy toàn bộ test Go**

```bash
make test-go
```

Kỳ vọng: xanh. Nếu swagger snapshot lệch vì `CommentDTO` đổi, chạy lại lệnh sinh swagger mà `make help` chỉ ra rồi commit kèm.

- [ ] **Step 8: Commit**

```bash
git add server/internal/handler server/internal/handler/dto
git commit -m "fix(tasks): trả reaction kèm danh sách bình luận"
```

---

### Task 3: Hiển thị reaction thật trên thẻ bình luận (client)

Đây là chỗ sửa lỗi người dùng nhìn thấy: `comment-card.tsx:100` đang truyền mảng rỗng cứng.

**Files:**
- Modify: `packages/core/types/task.ts` (`TaskCommentSchema`, dòng 75-90)
- Modify: `packages/core/api/endpoints/tasks.test.ts` (thêm ca malformed)
- Modify: `packages/views/tasks/detail/components/comment-card.tsx` (dòng 13-15 comment, dòng 100)
- Test: `packages/views/tasks/detail/components/comment-card.test.tsx` (tạo nếu chưa có)

**Interfaces:**
- Consumes: trường `reactions` từ Task 2.
- Produces: `TaskComment.reactions: CommentReaction[]` — mặc định `[]` khi server không trả.

- [ ] **Step 1: Viết test thất bại**

Tạo `packages/views/tasks/detail/components/comment-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { TaskComment } from "@uniwork/core/types";
import { TaskCommentCard } from "./comment-card";

initI18n();

const base: TaskComment = {
  id: "c1",
  task_id: "t1",
  author_id: "u1",
  author_kind: "human",
  body: "một",
  type: "comment",
  revision: 1,
  reactions: [],
};

describe("TaskCommentCard", () => {
  it("hiển thị reaction mà server trả về", () => {
    render(
      <TaskCommentCard
        comment={{
          ...base,
          reactions: [
            { id: "r1", comment_id: "c1", actor_type: "member", actor_id: "u1", emoji: "👍", created_at: "2026-09-12T00:00:00Z" },
          ],
        }}
        onToggleReaction={vi.fn()}
      />,
    );
    expect(screen.getByText("👍")).toBeInTheDocument();
  });

  it("không hiển thị reaction nào khi mảng rỗng", () => {
    render(<TaskCommentCard comment={base} onToggleReaction={vi.fn()} />);
    expect(screen.queryByText("👍")).not.toBeInTheDocument();
  });
});
```

`TaskCommentCard` là lá: nó chỉ cần i18n, không cần query client. `initI18n()` ở đầu file là đúng khuôn mà `task-surface.test.tsx` dùng.

- [ ] **Step 2: Chạy test để thấy nó thất bại**

```bash
cd packages/views && npx vitest run tasks/detail/components/comment-card.test.tsx
```

Kỳ vọng: FAIL ở test thứ nhất, không tìm thấy `👍`.

- [ ] **Step 3: Thêm trường vào schema**

Trong `packages/core/types/task.ts`, thêm vào `TaskCommentSchema` ngay sau `avatar_url`:

```ts
  reactions: z.array(CommentReactionSchema).default([]),
```

Import `CommentReactionSchema` từ `./task-collaboration` ở đầu file. Không có vòng lặp: `task-collaboration.ts` chỉ import `zod` và không đụng tới `task.ts`.

- [ ] **Step 4: Sửa thẻ bình luận**

Trong `packages/views/tasks/detail/components/comment-card.tsx`, thay dòng 100:

```tsx
          reactions={comment.reactions ?? []}
```

Và sửa comment đầu file (dòng 13-15) thành:

```tsx
/**
 * One comment row. Reactions come embedded in listComments; the bar renders
 * them directly and refreshes after a toggle mutation.
 */
```

- [ ] **Step 5: Chạy test để thấy nó đạt**

```bash
cd packages/views && npx vitest run tasks/detail/components/comment-card.test.tsx
```

Kỳ vọng: PASS cả hai.

- [ ] **Step 6: Thêm ca malformed cho endpoint**

Trong `packages/core/api/endpoints/tasks.test.ts`, thêm:

```ts
it("listComments trả [] khi response méo", async () => {
  requestMock.mockResolvedValueOnce({ comments: "không phải mảng" });
  await expect(listComments("t1")).resolves.toEqual([]);
});

it("listComments mặc định reactions về [] khi server cũ không trả trường đó", async () => {
  requestMock.mockResolvedValueOnce({
    comments: [{ id: "c1", task_id: "t1", author_id: "u1", body: "một" }],
  });
  const got = await listComments("t1");
  expect(got[0].reactions).toEqual([]);
});
```

Đọc đầu `tasks.test.ts` để lấy đúng tên mock transport của file; các test hiện có trong đó đã mock `request` và tên biến ở trên bám khuôn `requestMock` mà `packages/views/test/api-mock` dùng.

- [ ] **Step 7: Chạy test core**

```bash
cd packages/core && npx vitest run api/endpoints/tasks.test.ts
```

Kỳ vọng: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/types/task.ts packages/core/api/endpoints/tasks.test.ts packages/views/tasks/detail/components/comment-card.tsx packages/views/tasks/detail/components/comment-card.test.tsx
git commit -m "fix(tasks): hiển thị reaction thật trên bình luận thay cho mảng rỗng cứng"
```

---

### Task 4: Tách nhánh lỗi khỏi nhánh rỗng trên surface

Hiện `useTaskSurfaceData` không trả `isError`, nên một query hỏng rơi vào `isEmpty` và người dùng thấy lời mời tạo task mới.

**Files:**
- Modify: `packages/views/tasks/surface/use-task-surface-data.ts` (dòng 10-15 interface, dòng 49-53 phần tính)
- Modify: `packages/views/tasks/surface/use-task-surface-controller.ts` (dòng 417-432 và khối return dòng 470-495)
- Modify: `packages/views/tasks/surface/task-surface.tsx` (dòng 143-147 và 203-210)
- Modify: `packages/core/i18n/locales/vi.json`, `packages/core/i18n/locales/en.json`
- Test: `packages/views/tasks/surface/task-surface.test.tsx`

**Interfaces:**
- Produces: `TaskSurfaceData.isError: boolean` và `controller.isError: boolean` — Task 5 không dùng, các lát sau có thể dùng.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `packages/views/tasks/surface/task-surface.test.tsx`:

```tsx
it("hiển thị khối lỗi kèm nút thử lại khi query hỏng, không hiển thị trạng thái rỗng", async () => {
  requestMock.mockReset();
  requestMock.mockRejectedValue(new Error("network down"));

  render(wrap(<TaskSurface workspaceId="w1" />));

  await waitFor(() => {
    expect(screen.getByTestId("task-surface-error")).toBeInTheDocument();
  });
  expect(screen.queryByTestId("task-surface-empty")).not.toBeInTheDocument();
});
```

File này mock ở tầng transport bằng `requestMock` và bọc bằng `wrap` từ `../../test/api-mock`, không mock controller. Giữ nguyên cách đó: cho `requestMock` reject là cách trung thực nhất để dựng lỗi. Đối chiếu props thật của `TaskSurface` ở `task-surface.tsx` và truyền đủ props bắt buộc.

- [ ] **Step 2: Chạy test để thấy nó thất bại**

```bash
cd packages/views && npx vitest run tasks/surface/task-surface.test.tsx
```

Kỳ vọng: FAIL, không tìm thấy `task-surface-error`.

- [ ] **Step 3: Trả isError từ hook dữ liệu**

Trong `packages/views/tasks/surface/use-task-surface-data.ts`, thêm vào interface:

```ts
  isError: boolean;
```

Và trong phần tính, ngay sau `isRefreshing`:

```ts
  const isError = !!active && active.isError;
  const isEmpty = enabled && !isLoading && !isError && surfaceTasks.length === 0;
```

Rồi thêm `isError` vào đối tượng trả về. Lưu ý `isEmpty` giờ loại trừ `isError`: đây chính là chỗ lỗi cũ nằm.

- [ ] **Step 4: Đưa isError lên controller**

Trong `packages/views/tasks/surface/use-task-surface-controller.ts`, thêm `isError: boolean;` vào type kết quả (cạnh `isEmpty` dòng 119), tính nó song song với `isLoading` (dòng 417):

```ts
  const isError = boardEnabled
    ? scope.type === "my"
      ? data.isError || statusesQuery.isError
      : statusesQuery.isError || groupedQuery.isError
    : tableEnabled
      ? false
      : data.isError;
```

Và thêm `isError,` vào khối return cạnh `isEmpty`.

- [ ] **Step 5: Thêm nhánh hiển thị**

Trong `packages/views/tasks/surface/task-surface.tsx`, sửa `surfaceStageKey` (dòng 143):

```tsx
  const surfaceStageKey = controller.isLoading
    ? `loading:${controller.viewMode}`
    : controller.isError
      ? "error"
      : controller.isEmpty
        ? "empty"
        : `mode:${controller.viewMode}`;
```

Sửa cây render (dòng 203):

```tsx
              {controller.isLoading ? (
                <TaskSurfaceSkeleton mode={controller.viewMode} />
              ) : controller.isError ? (
                <SurfaceError onRetry={() => controller.actions.refetch()} />
              ) : controller.isEmpty ? (
```

Thêm thành phần ở cuối file, cạnh `DefaultEmpty`:

```tsx
function SurfaceError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="task-surface-error"
      className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
    >
      <p className="text-body text-foreground">{t("tasks.error_title")}</p>
      <p className="text-caption text-muted-foreground">{t("tasks.error_description")}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t("common.retry")}
      </Button>
    </div>
  );
}
```

Thêm `data-testid="task-surface-empty"` vào `DefaultEmpty` để test phân biệt được hai nhánh.

Nếu `controller.actions` chưa có `refetch`, thêm nó vào `actions` trong controller, gọi `queryClient.invalidateQueries({ queryKey: taskKeys.queryRoot(workspaceId) })`. Controller đã import `taskKeys` và có `queryClient` trong tầm.

- [ ] **Step 6: Thêm khóa i18n**

Trong `packages/core/i18n/locales/vi.json`, nhánh `tasks`:

```json
"error_title": "Không tải được danh sách công việc",
"error_description": "Kết nối tới máy chủ đang có vấn đề. Thử lại sau giây lát.",
```

Trong `en.json`, cùng vị trí:

```json
"error_title": "Could not load tasks",
"error_description": "The connection to the server is having trouble. Try again in a moment.",
```

Kiểm tra `common.retry` đã tồn tại ở cả hai file; nếu chưa, thêm `"retry": "Thử lại"` và `"retry": "Retry"`.

- [ ] **Step 7: Chạy test để thấy nó đạt**

```bash
cd packages/views && npx vitest run tasks/surface/task-surface.test.tsx
```

Kỳ vọng: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/views/tasks/surface packages/core/i18n/locales
git commit -m "fix(tasks): lỗi tải danh sách hiện thành khối lỗi, không còn giả làm trạng thái rỗng"
```

---

### Task 5: Ranh giới lỗi và trang không tìm thấy cho app web

`apps/web/app/` hiện không có `error.tsx` lẫn `not-found.tsx`, nên một lỗi render lọt ra màn hình trắng của Next.

**Files:**
- Create: `apps/web/app/error.tsx`
- Create: `apps/web/app/not-found.tsx`
- Modify: `packages/core/i18n/locales/vi.json`, `packages/core/i18n/locales/en.json`
- Test: `e2e/smoke.spec.ts` (thêm một ca)

**Interfaces:** không có gì cho task sau.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `e2e/smoke.spec.ts`:

```ts
test("đường dẫn không tồn tại hiện trang không tìm thấy, không phải màn hình trắng", async ({ page }) => {
  await page.goto("/khong-ton-tai-dau-ca");
  await expect(page.getByTestId("app-not-found")).toBeVisible();
});
```

- [ ] **Step 2: Chạy test để thấy nó thất bại**

```bash
make e2e
```

Kỳ vọng: FAIL, không tìm thấy `app-not-found`. Ứng dụng phải đang chạy; nếu chưa, `make start` trước.

- [ ] **Step 3: Tạo trang không tìm thấy**

`apps/web/app/not-found.tsx`:

```tsx
"use client";

import { useTranslation } from "react-i18next";
import { AppLink } from "@uniwork/views/navigation";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <main
      data-testid="app-not-found"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <h1 className="text-heading font-semibold text-foreground">{t("errors.not_found_title")}</h1>
      <p className="text-body text-muted-foreground">{t("errors.not_found_description")}</p>
      <AppLink href="/" className="text-body text-brand underline">
        {t("errors.back_home")}
      </AppLink>
    </main>
  );
}
```

- [ ] **Step 4: Tạo ranh giới lỗi**

`apps/web/app/error.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    // The digest is the only handle the server log gives us for this render.
    console.error("app render failed", error.digest ?? error.message);
  }, [error]);

  return (
    <main
      data-testid="app-error"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <h1 className="text-heading font-semibold text-foreground">{t("errors.render_title")}</h1>
      <p className="text-body text-muted-foreground">{t("errors.render_description")}</p>
      <Button type="button" variant="outline" onClick={reset}>
        {t("common.retry")}
      </Button>
    </main>
  );
}
```

Kiểm tra tên lớp tiện ích (`text-heading`, `text-brand`) có trong hệ token của `packages/ui`; nếu không, dùng lớp mà `DefaultEmpty` trong `task-surface.tsx` đang dùng.

- [ ] **Step 5: Thêm khóa i18n**

Thêm nhánh `errors` vào cả hai file locale:

```json
"errors": {
  "not_found_title": "Không tìm thấy trang",
  "not_found_description": "Đường dẫn này không tồn tại hoặc đã bị đổi.",
  "back_home": "Về trang chủ",
  "render_title": "Có lỗi khi hiển thị trang",
  "render_description": "Thử tải lại. Nếu vẫn lỗi, báo cho quản trị workspace."
}
```

```json
"errors": {
  "not_found_title": "Page not found",
  "not_found_description": "This address does not exist or has moved.",
  "back_home": "Back to home",
  "render_title": "Something went wrong rendering this page",
  "render_description": "Try again. If it keeps failing, tell your workspace admin."
}
```

- [ ] **Step 6: Chạy test để thấy nó đạt**

```bash
make e2e
```

Kỳ vọng: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/error.tsx apps/web/app/not-found.tsx packages/core/i18n/locales e2e/smoke.spec.ts
git commit -m "feat(web): ranh giới lỗi và trang không tìm thấy cấp ứng dụng"
```

---

### Task 6: Lịch sử hoạt động thật trên trang chi tiết task

`useResourceHistory` đã có đủ ba tầng và comment của nó ghi rõ nó dành cho "the Activity list on a task or meeting detail screen". Việc còn lại là gọi nó và bỏ dòng chữ xin lỗi.

**Files:**
- Modify: `packages/views/tasks/detail/components/timeline.tsx` (chữ ký hàm, dòng 38; khối `activity_stub_reason` dòng 129-131; danh sách render dòng 133-187)
- Create: `packages/views/tasks/detail/components/activity-row.tsx`
- Modify: `packages/views/tasks/detail/components/task-detail-timeline-slot.tsx`
- Modify: `packages/views/tasks/detail/components/task-detail-editors.tsx` (dòng 108)
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`
- Test: `packages/views/tasks/detail/components/timeline.test.tsx`

**Interfaces:**
- Consumes: `useResourceHistory(wsId, "task", taskId)` trả `AuditEvent[]`; `AuditEvent` có `actor_id`, `actor_kind`, `action`, `changes`, `occurred_at`.
- Produces: `TaskDetailTimeline({ workspaceId, taskId })` — chữ ký đổi, nơi gọi phải truyền thêm `workspaceId`.

Hai nguồn trộn ở tầng hiển thị, không ở tầng cache: bình luận giữ query key cũ, hoạt động giữ query key của audit.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `packages/views/tasks/detail/components/timeline.test.tsx`:

```tsx
it("trộn hoạt động từ nhật ký với bình luận theo thứ tự thời gian", async () => {
  mockComments([
    { id: "c1", task_id: "t1", author_id: "u1", body: "bình luận sau", created_at: "2026-09-12T10:00:00Z", reactions: [] },
  ]);
  mockResourceHistory([
    {
      id: "a1",
      organization_id: "o1",
      actor_kind: "human",
      actor_id: "u1",
      action: "task.updated",
      resource_type: "task",
      resource_id: "t1",
      changes: { status: { from: "todo", to: "in_progress" } },
      metadata: {},
      correlation_id: "x",
      occurred_at: "2026-09-12T09:00:00Z",
    },
  ]);

  renderTimeline({ workspaceId: "w1", taskId: "t1" });

  const rows = await screen.findAllByTestId(/^task-timeline-(comment|activity)-/);
  expect(rows.map((r) => r.dataset.testid)).toEqual([
    "task-timeline-activity-a1",
    "task-timeline-comment-c1",
  ]);
});

it("không hiện dòng giải thích hoạt động chưa khả dụng nữa", () => {
  mockComments([]);
  mockResourceHistory([]);
  renderTimeline({ workspaceId: "w1", taskId: "t1" });
  expect(screen.queryByText(/chưa khả dụng/i)).not.toBeInTheDocument();
});
```

`timeline.test.tsx` mock module `@uniwork/core/tasks` bằng `vi.mock` với `importOriginal`,
rồi render qua `wrapWithNav` và `WorkspaceProvider`. Giữ nguyên khuôn đó và thêm một
`vi.mock("@uniwork/core/audit", ...)` cùng kiểu, trả `useResourceHistory: () => ({ data: [...] })`.
`mockComments` ở trên tương ứng với việc đổi mảng trả về của `useComments` đã mock sẵn
trong file; `renderTimeline` tương ứng với lời gọi `render(wrapWithNav(<WorkspaceProvider ...><TaskDetailTimeline workspaceId="w1" taskId="t1" /></WorkspaceProvider>))`
mà file đang dùng.

- [ ] **Step 2: Chạy test để thấy nó thất bại**

```bash
cd packages/views && npx vitest run tasks/detail/components/timeline.test.tsx
```

Kỳ vọng: FAIL ở cả hai.

- [ ] **Step 3: Tạo thành phần một dòng hoạt động**

`packages/views/tasks/detail/components/activity-row.tsx`:

```tsx
"use client";

import { useTranslation } from "react-i18next";
import type { AuditEvent } from "@uniwork/core/types";

/**
 * One row of the immutable log rendered inside the task timeline. The action
 * string stays lenient (ADR 0003), so an unknown action falls back to a
 * generic line instead of refusing to render.
 */
export function TaskActivityRow({ event }: { event: AuditEvent }) {
  const { t } = useTranslation();
  const fields = Object.keys(event.changes ?? {});
  const label =
    fields.length > 0
      ? t("tasks.detail.activity_changed_fields", { fields: fields.join(", ") })
      : t("tasks.detail.activity_generic");

  return (
    <div
      data-testid={`task-timeline-activity-${event.id}`}
      className="flex flex-wrap items-baseline gap-2 px-1 text-caption text-muted-foreground"
    >
      <span>{label}</span>
      <time dateTime={event.occurred_at}>{event.occurred_at}</time>
    </div>
  );
}
```

- [ ] **Step 4: Trộn hai nguồn trong timeline**

Trong `timeline.tsx`, đổi chữ ký thành `({ workspaceId, taskId }: { workspaceId: string; taskId: string })`, thêm:

```tsx
  const history = useResourceHistory(workspaceId, "task", taskId);

  const entries = useMemo(() => {
    const commentRows = roots.map((c) => ({
      kind: "comment" as const,
      at: c.created_at ?? "",
      comment: c,
    }));
    const activityRows = (history.data ?? []).map((e) => ({
      kind: "activity" as const,
      at: e.occurred_at,
      event: e,
    }));
    return [...commentRows, ...activityRows].sort((a, b) => a.at.localeCompare(b.at));
  }, [roots, history.data]);
```

Xóa hẳn khối `<p>{t("tasks.detail.activity_stub_reason")}</p>` (dòng 129-131). Thay vòng lặp `roots.map(...)` bằng `entries.map(...)`, nhánh `activity` render `<TaskActivityRow />`, nhánh `comment` render `<TaskCommentCard />` như cũ và thêm `data-testid={`task-timeline-comment-${c.id}`}` vào thẻ bọc.

Nếu `timeline.tsx` vượt 500 dòng sau thay đổi, tách phần render danh sách sang `timeline-entries.tsx` cùng thư mục.

- [ ] **Step 5: Truyền workspaceId xuống**

Trong `task-detail-timeline-slot.tsx`, đổi chữ ký nhận thêm `workspaceId` và chuyển tiếp. Trong `task-detail-editors.tsx` dòng 108:

```tsx
        <TaskDetailTimelineSlot workspaceId={workspaceId} taskId={task.id} />
```

- [ ] **Step 6: Đổi khóa i18n**

Xóa `tasks.detail.activity_stub_reason` khỏi cả `vi.json` và `en.json`. Thêm vào cả hai:

```json
"activity_changed_fields": "Đã đổi {{fields}}",
"activity_generic": "Đã cập nhật công việc"
```

```json
"activity_changed_fields": "Changed {{fields}}",
"activity_generic": "Updated the task"
```

- [ ] **Step 7: Chạy test để thấy nó đạt**

```bash
cd packages/views && npx vitest run tasks/detail/components/timeline.test.tsx
```

Kỳ vọng: PASS cả hai.

- [ ] **Step 8: Commit**

```bash
git add packages/views/tasks/detail packages/core/i18n/locales
git commit -m "feat(tasks): lịch sử hoạt động thật trên trang chi tiết, đọc từ nhật ký kiểm toán"
```

---

### Task 7: Xóa route timeline trùng chức năng

`GET /api/v1/tasks/{taskID}/timeline` được quảng cáo là adapted nhưng service trả `timeline_not_ready`. Task 6 đã phủ chức năng đó bằng `ResourceHistory`, nên route này phải biến mất thay vì bị hiện thực.

**Files:**
- Modify: `server/internal/handler/router/tasks.go` (bỏ đăng ký `/tasks/{taskID}/timeline`)
- Modify: `server/internal/handler/router.go` (bỏ `GetTaskTimeline` khỏi bảng `Routes`)
- Modify: `server/internal/handler/task_collaboration.go` (xóa `getTaskTimeline`, dòng 229-231)
- Modify: `server/internal/service/task_subscribers.go` (xóa `GetTaskTimeline`, dòng 162-167)
- Modify: `docs/parity/tasks-api-client-core-routes.json` (đổi mục timeline sang `disposition: "dropped"` kèm lý do)
- Test: `server/internal/handler/router/catalogue_test.go`

- [ ] **Step 1: Viết test thất bại**

Trong `server/internal/handler/router/catalogue_test.go`, thêm:

```go
func TestTimelineRouteIsGone(t *testing.T) {
	for _, r := range registeredRoutes(t) {
		if strings.HasSuffix(r.Pattern, "/timeline") {
			t.Fatalf("route %s %s vẫn còn; lịch sử hoạt động dùng ResourceHistory của audit", r.Method, r.Pattern)
		}
	}
}
```

Dùng đúng helper liệt kê route mà file này đang dùng thay cho `registeredRoutes`.

- [ ] **Step 2: Chạy test để thấy nó thất bại**

```bash
cd server && go test ./internal/handler/router/ -run TestTimelineRouteIsGone -v
```

Kỳ vọng: FAIL, route còn đó.

- [ ] **Step 3: Gỡ bốn chỗ**

Xóa dòng `suite.Get("/tasks/{taskID}/timeline", ...)` trong `router/tasks.go`; xóa trường `GetTaskTimeline` khỏi struct `Routes` và khỏi chỗ gán trong `router.go:270`; xóa hàm `getTaskTimeline`; xóa method `GetTaskTimeline` trong `task_subscribers.go`. Nếu `collaborationUnavailable` không còn nơi nào gọi với `"timeline_not_ready"`, để nguyên hàm vì ba stub khác vẫn dùng.

- [ ] **Step 4: Cập nhật catalogue parity và nới enum**

`scripts/task-api-route-catalogue.test.mjs:19` chốt `disposition` vào ba giá trị
`ported`, `adapted`, `stubbed`. Thêm giá trị thứ tư thay vì xóa dòng, vì quy ước của
repo là cắt phạm vi thì ghi lý do chứ không xóa bản ghi.

Trong `scripts/task-api-route-catalogue.test.mjs`, đổi dòng 19:

```js
    assert.ok(["ported", "adapted", "stubbed", "dropped"].includes(r.disposition));
```

Trong `docs/parity/tasks-api-client-core-routes.json`, tìm mục có `target_path` là
`/api/v1/tasks/{taskID}/timeline` và đổi:

```json
"disposition": "dropped",
"reason": "Trùng chức năng với ResourceHistory của audit; lát A dùng useResourceHistory"
```

Test cũng chốt `cat.routes.length >= 40` và khóa `method + target_path` phải duy nhất.
Giữ nguyên dòng nên cả hai điều kiện vẫn đạt.

Nếu `scripts/generate-task-api-route-catalogue.mjs` sinh lại file này trong `make check`
và ghi đè tay sửa, thêm `dropped` vào phần ánh xạ disposition của generator cho đúng
route đó thay vì sửa JSON bằng tay.

- [ ] **Step 5: Chạy test để thấy nó đạt**

```bash
cd server && go test ./internal/handler/... -v 2>&1 | tail -20
```

Kỳ vọng: PASS, gồm cả test catalogue route đang có.

- [ ] **Step 6: Commit**

```bash
git add server/internal/handler server/internal/service/task_subscribers.go docs/parity/tasks-api-client-core-routes.json
git commit -m "refactor(tasks): bỏ route timeline trùng chức năng với nhật ký kiểm toán"
```

---

### Task 8: Cổng cuối và cập nhật tài liệu

- [ ] **Step 1: Chạy toàn bộ cổng**

```bash
make check
```

Kỳ vọng: xanh. Ở `GATE_LEVEL=fast`, lint và coverage in cảnh báo thay vì chặn; đọc output chứ đừng chỉ nhìn mã thoát.

- [ ] **Step 2: Kiểm tra cân bằng i18n**

```bash
cd packages/core && npx vitest run i18n
```

Kỳ vọng: không khóa nào lệch giữa `vi` và `en`. Lát A thêm bảy khóa và xóa một khóa, cả hai file phải khớp.

- [ ] **Step 3: Nâng sàn coverage**

Đọc phần trăm mà `make check` in ra cho `@uniwork/views`, `@uniwork/core` và Go. Nâng `thresholds` trong vitest config của từng package và `server/coverage.floor` lên đúng con số vừa đạt. Không bao giờ hạ.

- [ ] **Step 4: Cập nhật trạng thái spec**

Trong `docs/superpowers/specs/2026-09-12-tasks-human-parity-design.md`, đổi dòng trạng thái thành:

```markdown
> **Trạng thái:** in-progress — lát A shipped; plan `../plans/2026-09-12-tasks-human-parity-slice-a.md`
```

Đổi dòng trạng thái của plan này thành `shipped`.

Giữ nguyên F-05 ở `MỘT PHẦN` trong `docs/roadmap/FEATURE_ROADMAP.md`. Thêm vào cột ghi chú của F-05: `lát A/human-parity (reaction, nhánh lỗi, error boundary, activity) shipped 2026-09-12`.

- [ ] **Step 5: Commit và mở PR**

```bash
git add -A
git commit -m "chore(tasks): nâng sàn coverage và cập nhật trạng thái lát A"
make issue-pr
```

---

## Ghi chú cho người thực thi

- Helper trong các khối test ở trên là helper thật, đã đối chiếu với file đích: `taskFixture` và `Human` ở `server/internal/service/task_collaboration_test.go`; `suiteMutationWorld` và `doJSON` ở `server/internal/handler/task_collaboration_test.go`; `requestMock`, `wrap`, `wrapWithNav` ở `packages/views/test/api-mock`. Không tạo helper song song.
- Task 1 đến 3 là một chuỗi và phải làm theo thứ tự. Task 4, 5 độc lập, làm song song được. Task 6 phụ thuộc Task 3 vì `TaskComment.reactions` phải tồn tại trước. Task 7 phụ thuộc Task 6.
- Không đụng `server/internal/workcapability/` trong bất kỳ task nào.
