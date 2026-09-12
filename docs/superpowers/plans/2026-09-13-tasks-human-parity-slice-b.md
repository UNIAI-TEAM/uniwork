# Task human-parity lát B — thread bình luận

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Trạng thái:** in-progress — lát B của spec ô Task human-parity

**Goal:** Bình luận trên task trở thành cuộc trò chuyện có luồng: trả lời được, gấp được luồng đã giải quyết, nhảy được giữa các luồng, và không mất chữ đang gõ khi rời trang.

**Architecture:** Toàn bộ nằm ở client. Schema và API đã đỡ sẵn từ migration 110: cột `parent_comment_id` tồn tại, API phơi ra dưới tên `parent_id`, `createCommentSuite` đã nhận nó, và `ListTaskComments` trả về cả trả lời trong cùng một lượt. Hôm nay `timeline.tsx` lọc `!c.parent_id` rồi vứt phần trả lời đi. Lát này dựng cây một cấp từ dữ liệu đã có, mượn ngôn ngữ thị giác của chat cho phần trích dẫn, và thêm một store nháp theo khuôn đã dùng cho hộp gửi của chat.

**Tech Stack:** TypeScript strict, React 19, TanStack Query, Zustand với `persist`, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-12-tasks-human-parity-design.md` (mục 3.1 lát B)

## Global Constraints

- Không đụng `server/`. Lát này không có thay đổi backend nào.
- Mỗi file `.ts`/`.tsx` tối đa 500 dòng theo luật `max-lines`, vốn không đếm dòng trống và comment.
- Mọi JSX text node trong `packages/views/` đi qua `t()`.
- Khóa i18n mới phải có ở **cả** `packages/core/i18n/locales/vi.json` và `en.json`. Có test parity.
- `packages/core/` không dùng `localStorage`, `process.env`, `react-dom`. Lưu trữ đi qua `StorageAdapter`, vốn chỉ có `getItem` / `setItem` / `removeItem`.
- `packages/views/` không import `next/*`.
- Không export, file hay dependency thừa — `pnpm knip` chạy trong cổng.
- Sàn coverage chỉ đi lên. Sàn `views` hiện là statements 59, branches 52, functions 53, lines 61.
- Tiền tố commit: `feat(scope)`, `fix(scope)`, `refactor(scope)`, `test(scope)`, `docs`, `chore(scope)`. Hook tự gắn `Refs:`; không gõ tay, không xóa.
- **Mọi lệnh vitest phải có `NODE_OPTIONS="--no-experimental-webstorage"`.** Máy chạy Node 25 còn dự án nhắm Node 22; thiếu cờ này sẽ thấy khoảng 55 lỗi không liên quan.
- Baseline hiện tại với cờ đó: views 1200, core 713.
- Lỗi nền đã biết, KHÔNG phải của bạn: `governance.test.mjs` kiểm lịch sử commit; phía Go là `TestChatFollowUpHTTP`, `TestChatThreadFollowMarkReadAndList`, `TestAIEndpoints`, `TestAskCitesOnlyPermittedSources`, `TestSearchScoringOverdueAndMembers`; e2e smoke "register → workspace → task → meeting".

## Cấu trúc file

| File | Trách nhiệm |
| --- | --- |
| `packages/views/tasks/detail/components/comment-thread.tsx` (mới) | Một luồng: bình luận gốc, danh sách trả lời, chỗ đặt ô trả lời |
| `packages/views/tasks/detail/components/comment-preview-text.ts` (mới) | Rút một dòng chữ thuần từ body Markdown, dùng cho trích dẫn và chip luồng |
| `packages/views/tasks/detail/components/comment-reply-quote.tsx` (mới) | Dòng trích dẫn bình luận đang trả lời, mượn khuôn `chat-reply-quote.tsx` |
| `packages/views/tasks/detail/components/reply-composer.tsx` (mới) | Ô trả lời, bọc `TaskCommentComposer` và gắn `parent_id` |
| `packages/views/tasks/detail/components/resolved-thread-bar.tsx` (mới) | Thanh gấp/mở luồng đã giải quyết |
| `packages/views/tasks/detail/components/thread-nav-panel.tsx` (mới) | Danh sách luồng để nhảy nhanh |
| `packages/core/tasks/stores/comment-draft-store.ts` (mới) | Nháp bình luận, bền qua điều hướng |
| `packages/views/tasks/detail/components/timeline.tsx` (sửa) | Dựng cây thay vì vứt trả lời; ghép các mảnh trên |
| `packages/views/tasks/detail/components/comment-card.tsx` (sửa) | Thêm nút trả lời |

---

### Task 1: Ngừng vứt trả lời đi — dựng cây một cấp

Đây là task mang giá trị lớn nhất trên mỗi dòng mã: dữ liệu đã về tới client từ lâu, chỉ đang bị lọc bỏ.

**Files:**
- Create: `packages/views/tasks/detail/components/comment-thread.tsx`
- Modify: `packages/views/tasks/detail/components/timeline.tsx` (khối `roots` quanh dòng 68, khối render quanh dòng 188)
- Test: `packages/views/tasks/detail/components/comment-thread.test.tsx`

**Interfaces:**
- Consumes: `TaskComment` từ `@uniwork/core/types`, có `id`, `parent_id?`, `body`, `created_at?`, `resolved_at?`, `reactions`.
- Produces: `buildCommentThreads(comments: TaskComment[]): CommentThread[]` với `type CommentThread = { root: TaskComment; replies: TaskComment[] }` — task 2, 4, 5 đều dùng.

- [ ] **Step 1: Viết test thất bại**

Tạo `packages/views/tasks/detail/components/comment-thread.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import type { TaskComment } from "@uniwork/core/types";
import { buildCommentThreads } from "./comment-thread";

const c = (over: Partial<TaskComment> & { id: string }): TaskComment => ({
  task_id: "t1",
  author_id: "u1",
  author_kind: "human",
  body: "x",
  type: "comment",
  revision: 1,
  reactions: [],
  ...over,
});

describe("buildCommentThreads", () => {
  it("gom trả lời vào đúng bình luận gốc", () => {
    const threads = buildCommentThreads([
      c({ id: "r1", created_at: "2026-09-13T10:00:00Z" }),
      c({ id: "a1", parent_id: "r1", created_at: "2026-09-13T10:05:00Z" }),
      c({ id: "r2", created_at: "2026-09-13T11:00:00Z" }),
    ]);
    expect(threads.map((t) => t.root.id)).toEqual(["r1", "r2"]);
    expect(threads[0]?.replies.map((r) => r.id)).toEqual(["a1"]);
    expect(threads[1]?.replies).toEqual([]);
  });

  it("sắp xếp gốc và trả lời theo thời gian, cũ trước", () => {
    const threads = buildCommentThreads([
      c({ id: "r2", created_at: "2026-09-13T11:00:00Z" }),
      c({ id: "a2", parent_id: "r2", created_at: "2026-09-13T11:20:00Z" }),
      c({ id: "a1", parent_id: "r2", created_at: "2026-09-13T11:10:00Z" }),
      c({ id: "r1", created_at: "2026-09-13T10:00:00Z" }),
    ]);
    expect(threads.map((t) => t.root.id)).toEqual(["r1", "r2"]);
    expect(threads[1]?.replies.map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  it("giữ trả lời mồ côi như một luồng riêng thay vì làm nó biến mất", () => {
    const threads = buildCommentThreads([
      c({ id: "a1", parent_id: "khong-ton-tai", created_at: "2026-09-13T10:00:00Z" }),
    ]);
    expect(threads.map((t) => t.root.id)).toEqual(["a1"]);
  });
});
```

Ca thứ ba là ca quan trọng nhất: bình luận gốc có thể đã bị xóa trong khi trả lời còn sống. Làm trả lời biến mất chính là loại lỗi mà cả spec này sinh ra để diệt.

- [ ] **Step 2: Chạy test để thấy nó thất bại**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/detail/components/comment-thread.test.tsx
```

Kỳ vọng: FAIL, không resolve được `./comment-thread`.

- [ ] **Step 3: Viết hàm dựng cây**

Tạo `packages/views/tasks/detail/components/comment-thread.tsx`:

```tsx
"use client";

import type { TaskComment } from "@uniwork/core/types";

export type CommentThread = {
  root: TaskComment;
  replies: TaskComment[];
};

function byCreatedAt(a: TaskComment, b: TaskComment): number {
  return (a.created_at ?? "").localeCompare(b.created_at ?? "");
}

/**
 * One level deep, which is what the data model allows. A reply whose parent is
 * missing — deleted, or not in this page — becomes a thread of its own rather
 * than vanishing: losing a person's words is worse than showing them unrooted.
 */
export function buildCommentThreads(comments: TaskComment[]): CommentThread[] {
  const ids = new Set(comments.map((c) => c.id));
  const roots = comments.filter((c) => !c.parent_id || !ids.has(c.parent_id));
  const repliesByParent = new Map<string, TaskComment[]>();

  for (const c of comments) {
    if (!c.parent_id || !ids.has(c.parent_id)) continue;
    const list = repliesByParent.get(c.parent_id) ?? [];
    list.push(c);
    repliesByParent.set(c.parent_id, list);
  }

  return roots
    .slice()
    .sort(byCreatedAt)
    .map((root) => ({
      root,
      replies: (repliesByParent.get(root.id) ?? []).slice().sort(byCreatedAt),
    }));
}
```

- [ ] **Step 4: Chạy test để thấy nó đạt**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/detail/components/comment-thread.test.tsx
```

Kỳ vọng: PASS cả ba.

- [ ] **Step 5: Nối vào timeline**

Trong `timeline.tsx`, thay khối `roots` (quanh dòng 68) bằng:

```tsx
  const threads = useMemo(() => buildCommentThreads(comments ?? []), [comments]);
```

Trong khối `entries` (quanh dòng 80), đổi `commentRows` để mang cả luồng:

```tsx
    const commentRows = threads.map((thread) => ({
      kind: "comment" as const,
      at: thread.root.created_at ?? "",
      thread,
    }));
```

Trong phần render (quanh dòng 188), nhánh `comment` render bình luận gốc rồi lặp `entry.thread.replies` bên dưới, thụt vào bằng `ml-6 border-l border-border pl-3`. Mỗi trả lời vẫn dùng `TaskCommentCard` với đúng những handler mà gốc đang dùng, truyền `comment={reply}` và `key={reply.id}`.

Sửa cả `useEffect` cuộn tới `#comment-<id>`: nó đang phụ thuộc `roots`; đổi phụ thuộc sang `threads` để trả lời cũng cuộn tới được.

Nếu `timeline.tsx` vượt 500 dòng theo `max-lines` sau bước này, tách phần render danh sách sang `timeline-entries.tsx` cùng thư mục và nói rõ trong báo cáo.

- [ ] **Step 6: Chạy test timeline**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/detail/components/
```

Kỳ vọng: toàn bộ file trong thư mục đó xanh. Nếu `timeline.test.tsx` có test cũ giả định trả lời bị bỏ, sửa test đó cho khớp hành vi mới và ghi vào báo cáo là đã sửa test nào, vì sao.

- [ ] **Step 7: Commit**

```bash
git add packages/views/tasks/detail/components
git commit -m "feat(tasks): hiển thị trả lời bình luận thay vì lọc bỏ"
```

---

### Task 2: Trả lời được

**Files:**
- Create: `packages/views/tasks/detail/components/comment-reply-quote.tsx`
- Create: `packages/views/tasks/detail/components/reply-composer.tsx`
- Modify: `packages/views/tasks/detail/components/comment-card.tsx` (khối props dòng 17-31, hàng nút quanh dòng 100)
- Modify: `packages/views/tasks/detail/components/timeline.tsx`
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`
- Test: `packages/views/tasks/detail/components/reply-composer.test.tsx`

**Interfaces:**
- Consumes: `buildCommentThreads` từ task 1; `useCreateCommentSuite(taskId).mutateAsync({ body: { body, parent_id } })` — `CreateCommentSuiteBody` có `body: string`, `parent_id?: string | null`, `type?: string`.
- Produces: `TaskCommentCard` nhận thêm prop tùy chọn `onReply?: () => void`.

- [ ] **Step 1: Viết test thất bại**

Tạo `packages/views/tasks/detail/components/reply-composer.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { TaskComment } from "@uniwork/core/types";
import { TaskReplyComposer } from "./reply-composer";

initI18n();

const parent: TaskComment = {
  id: "r1",
  task_id: "t1",
  author_id: "u1",
  author_kind: "human",
  display_name: "Ngọc",
  body: "Câu gốc",
  type: "comment",
  revision: 1,
  reactions: [],
};

describe("TaskReplyComposer", () => {
  it("hiện trích dẫn bình luận đang trả lời", () => {
    render(
      <TaskReplyComposer
        taskId="t1"
        parent={parent}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("reply-quote-r1")).toHaveTextContent("Câu gốc");
  });

  it("gọi onCancel khi bấm huỷ", async () => {
    const onCancel = vi.fn();
    render(
      <TaskReplyComposer
        taskId="t1"
        parent={parent}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("reply-cancel-r1"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

Nếu `TaskCommentComposer` cần provider mà test trần không có, bọc bằng đúng helper mà `timeline.test.tsx` đang dùng (`wrapWithNav` cộng `WorkspaceProvider`) và nói rõ trong báo cáo.

- [ ] **Step 2: Chạy test để thấy nó thất bại**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/detail/components/reply-composer.test.tsx
```

Kỳ vọng: FAIL, không resolve được `./reply-composer`.

- [ ] **Step 3: Viết hàm rút chữ thuần cho preview**

`comment.body` là **Markdown**: thẻ bình luận render nó qua `ReadonlyContent`, vốn bọc
`RichContent` với parse, sanitize, mention, link và code fence. Cắt thẳng chuỗi đó vào một
dòng trích dẫn sẽ hiện cú pháp thô — người dùng đọc `**gấp**` và `[tài liệu](https://…)`
thay vì chữ.

Chat làm khác được vì tin nhắn chat là chữ thuần, không đi qua `RichContent`. Đừng bê
`replyPreviewLabel` của chat sang: mượn phần nhìn của nó, không mượn giả định về dữ liệu.

Tạo `packages/views/tasks/detail/components/comment-preview-text.ts`:

```ts
/**
 * A one-line, plain-text gist of a comment for quotes and thread chips.
 *
 * Deliberately a small stripper, not a Markdown parser: it removes the syntax a
 * person actually types in a comment and collapses the rest to one line. It is
 * never used for rendering the comment itself — that stays with RichContent.
 */
export function commentPreviewText(body: string, max = 120): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}
```

Viết test cho nó ở `comment-preview-text.test.ts`, phủ: đậm, nghiêng, liên kết giữ nhãn bỏ
URL, code span giữ chữ, khối code biến mất, tiêu đề và dấu đầu dòng bị bỏ, nhiều dòng gộp
thành một, và chuỗi dài bị cắt kèm dấu ba chấm. Một ca nữa đáng có: chuỗi chỉ gồm một khối
code trả về chuỗi rỗng, để nơi gọi biết mà hiện nhãn thay thế thay vì một dòng trống.

- [ ] **Step 4: Viết dòng trích dẫn**

Tạo `packages/views/tasks/detail/components/comment-reply-quote.tsx`. Mượn khuôn của `packages/views/chat/chat-reply-quote.tsx` — viền trái, chữ nhạt, cắt một dòng — nhưng bỏ hết phần ảnh và tệp, vì bình luận task chỉ có chữ:

```tsx
"use client";

import type { TaskComment } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";
import { commentPreviewText } from "./comment-preview-text";

/**
 * Mirrors the chat reply quote so a reply reads the same way everywhere in the
 * product. Text only: task comments carry no files of their own.
 */
export function TaskCommentReplyQuote({
  comment,
  className,
}: {
  comment: TaskComment;
  className?: string;
}) {
  const author = comment.display_name ?? comment.author_id;
  return (
    <div
      data-testid={`reply-quote-${comment.id}`}
      className={cn(
        "flex min-w-0 items-center gap-2 border-l-2 border-brand/40 pl-2 text-caption text-muted-foreground",
        className,
      )}
    >
      <span className="shrink-0 font-medium">{author}</span>
      <span className="min-w-0 flex-1 truncate">{commentPreviewText(comment.body)}</span>
    </div>
  );
}
```

- [ ] **Step 5: Viết ô trả lời**

Tạo `packages/views/tasks/detail/components/reply-composer.tsx`:

```tsx
"use client";

import { useTranslation } from "react-i18next";
import type { TaskComment } from "@uniwork/core/types";
import { TaskCommentReplyQuote } from "./comment-reply-quote";
import { TaskCommentComposer } from "./comment-composer";

/**
 * The reply box. It reuses the main composer rather than growing a second one,
 * so a reply keeps the same editor, the same upload gate, and the same
 * draft-survives-failure contract as a top-level comment.
 */
export function TaskReplyComposer({
  taskId,
  parent,
  onSubmit,
  onCancel,
}: {
  taskId: string;
  parent: TaskComment;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 space-y-2" data-testid={`reply-composer-${parent.id}`}>
      <div className="flex items-center justify-between gap-2">
        <TaskCommentReplyQuote comment={parent} className="min-w-0 flex-1" />
        <button
          type="button"
          data-testid={`reply-cancel-${parent.id}`}
          className="shrink-0 text-caption text-muted-foreground underline-offset-2 hover:underline"
          onClick={onCancel}
        >
          {t("tasks.detail.reply_cancel")}
        </button>
      </div>
      <TaskCommentComposer taskId={taskId} composerKey={`${taskId}:${parent.id}`} onSubmit={onSubmit} />
    </div>
  );
}
```

`TaskCommentComposer` hiện dùng `taskId` cho hai việc: `resetKey` của lazy editor và `key`
của `ContentEditor`. Hai ô trả lời khác nhau phải có key khác nhau, nếu không chúng dùng
chung trạng thái soạn thảo. Đừng nhét chuỗi ghép vào `taskId` — đó là lạm dụng một prop có
tên nói rõ nó là id. Thay vào đó **thêm một prop mới** vào composer:

```tsx
export function TaskCommentComposer({
  taskId,
  composerKey,
  onSubmit,
}: {
  taskId: string;
  /** Distinguishes composers on the same task: the main box and each reply box. */
  composerKey?: string;
  onSubmit: (body: string) => Promise<boolean>;
}) {
  const key = composerKey ?? taskId;
```

rồi thay `taskId` bằng `key` ở `resetKey` và ở `key` của `ContentEditor`. Ô gốc không
truyền `composerKey` nên hành vi cũ giữ nguyên.

- [ ] **Step 6: Thêm nút trả lời vào thẻ bình luận**

Trong `comment-card.tsx`, thêm `onReply?: () => void;` vào cả khối tham số lẫn khối kiểu, rồi thêm nút vào hàng nút cạnh nút sửa:

```tsx
        {onReply ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid={`comment-reply-${comment.id}`}
            onClick={onReply}
          >
            {t("tasks.detail.reply")}
          </Button>
        ) : null}
```

Nút trả lời hiện cho mọi người, không chỉ chủ bình luận — khác với nút sửa và xóa.

- [ ] **Step 7: Nối vào timeline**

Trong `timeline.tsx`, thêm trạng thái `const [replyingTo, setReplyingTo] = useState<string | null>(null);`, truyền `onReply={() => setReplyingTo(thread.root.id)}` cho thẻ gốc, và khi `replyingTo === thread.root.id` thì render `TaskReplyComposer` ngay dưới danh sách trả lời của luồng đó.

Hàm gửi:

```tsx
  const onReplySubmit = async (parentId: string, body: string): Promise<boolean> => {
    try {
      const created = await createComment.mutateAsync({ body: { body, parent_id: parentId } });
      setReplyingTo(null);
      return !!created;
    } catch (err) {
      toastApiError(err, errFallback);
      return false;
    }
  };
```

Giữ nguyên khuôn của `onCompose` đang có: đợi server, trả `false` khi hỏng để composer giữ lại chữ người dùng đã gõ.

- [ ] **Step 8: Thêm khóa i18n**

Vào nhánh `tasks.detail` của cả hai file locale:

```json
"reply": "Trả lời",
"reply_cancel": "Huỷ trả lời",
"reply_placeholder": "Viết câu trả lời…"
```

```json
"reply": "Reply",
"reply_cancel": "Cancel reply",
"reply_placeholder": "Write a reply…"
```

Nếu bạn không dùng tới `reply_placeholder` thì đừng thêm nó — `knip` và test parity đều không thích khóa thừa.

- [ ] **Step 9: Chạy test**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/detail/components/
cd ../core && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false i18n
```

Kỳ vọng: xanh cả hai.

- [ ] **Step 10: Commit**

```bash
git add packages/views/tasks/detail/components packages/core/i18n/locales
git commit -m "feat(tasks): trả lời bình luận trên task"
```

---

### Task 3: Nháp bình luận sống sót qua điều hướng

**Files:**
- Create: `packages/core/tasks/stores/comment-draft-store.ts`
- Create: `packages/core/tasks/stores/comment-draft-store.test.ts`
- Modify: `packages/views/tasks/detail/components/comment-composer.tsx`
- Modify: `packages/core/package.json` nếu cần thêm export map cho store mới

**Interfaces:**
- Produces: `useCommentDraftStore` với `draftFor(key: string): string`, `setDraft(key: string, body: string): void`, `clearDraft(key: string): void`. Khóa là chuỗi mà view tự dựng: `taskId` cho ô gốc và `taskId:parentId` cho ô trả lời, tức đúng giá trị `composerKey ?? taskId` mà task 2 đặt.

- [ ] **Step 1: Viết test thất bại**

Tạo `packages/core/tasks/stores/comment-draft-store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useCommentDraftStore } from "./comment-draft-store";

describe("comment draft store", () => {
  beforeEach(() => {
    useCommentDraftStore.setState({ drafts: {} });
  });

  it("giữ nháp theo từng khóa", () => {
    useCommentDraftStore.getState().setDraft("t1", "đang gõ dở");
    useCommentDraftStore.getState().setDraft("t1:r1", "trả lời dở");
    expect(useCommentDraftStore.getState().draftFor("t1")).toBe("đang gõ dở");
    expect(useCommentDraftStore.getState().draftFor("t1:r1")).toBe("trả lời dở");
  });

  it("trả chuỗi rỗng cho khóa chưa có nháp", () => {
    expect(useCommentDraftStore.getState().draftFor("chua-co")).toBe("");
  });

  it("xoá nháp sau khi gửi xong", () => {
    useCommentDraftStore.getState().setDraft("t1", "x");
    useCommentDraftStore.getState().clearDraft("t1");
    expect(useCommentDraftStore.getState().draftFor("t1")).toBe("");
  });

  it("không giữ lại khóa rỗng, để store khỏi phình theo thời gian", () => {
    useCommentDraftStore.getState().setDraft("t1", "x");
    useCommentDraftStore.getState().setDraft("t1", "   ");
    expect(Object.keys(useCommentDraftStore.getState().drafts)).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test để thấy nó thất bại**

```bash
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/stores/comment-draft-store.test.ts
```

Kỳ vọng: FAIL, không resolve được module.

- [ ] **Step 3: Viết store**

Tạo `packages/core/tasks/stores/comment-draft-store.ts`. Đọc `packages/core/chat/send-outbox-store.ts` trước và theo đúng khuôn ở đó — `persist` + `createJSONStorage` + `defaultStorage` từ `../../platform/storage`, cộng `createWorkspaceAwareStorage` và `registerForWorkspaceRehydration` nếu khuôn đó dùng. Không chạm `localStorage` trực tiếp; `packages/core` bị cấm.

```ts
"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../../platform/storage";

type CommentDraftState = {
  drafts: Record<string, string>;
  draftFor: (key: string) => string;
  setDraft: (key: string, body: string) => void;
  clearDraft: (key: string) => void;
};

/**
 * What a person typed but has not sent. Keyed by composer, so a task's main box
 * and each reply box keep their own text. A blank draft is deleted rather than
 * stored, or the map grows forever as people open boxes they never use.
 */
export const useCommentDraftStore = create<CommentDraftState>()(
  persist(
    (set, get) => ({
      drafts: {},
      draftFor: (key) => get().drafts[key] ?? "",
      setDraft: (key, body) =>
        set((state) => {
          const next = { ...state.drafts };
          if (body.trim() === "") delete next[key];
          else next[key] = body;
          return { drafts: next };
        }),
      clearDraft: (key) =>
        set((state) => {
          const next = { ...state.drafts };
          delete next[key];
          return { drafts: next };
        }),
    }),
    {
      name: "uniwork_task_comment_drafts",
      storage: createJSONStorage(() => defaultStorage),
    },
  ),
);
```

Kiểm tra tên export thật của `defaultStorage` trong `packages/core/platform/storage.ts` và dùng đúng tên đó.

- [ ] **Step 4: Chạy test để thấy nó đạt**

```bash
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/stores/comment-draft-store.test.ts
```

Kỳ vọng: PASS cả bốn.

- [ ] **Step 5: Nối vào composer**

Trong `comment-composer.tsx`, đọc nháp lúc mount để đổ vào `defaultValue` của `ContentEditor`, ghi nháp khi nội dung đổi, và gọi `clearDraft` trong `onAccepted` — tức chỉ xoá khi server đã nhận, không xoá khi gửi hỏng. Dùng `composerKey ?? taskId` làm khóa nháp — cùng giá trị mà bước trên đã đặt cho `resetKey`, nên ô gốc và từng ô trả lời có nháp riêng.

Giữ nguyên hợp đồng của `useComposerSubmit`: nháp phải còn nguyên khi gửi thất bại. Đó là lý do `clearDraft` nằm ở `onAccepted` chứ không nằm ở `submit`.

- [ ] **Step 6: Kiểm ranh giới package**

```bash
cd packages/core && npx eslint tasks/stores/comment-draft-store.ts --max-warnings 0
```

Kỳ vọng: sạch. Nếu lint báo dùng `localStorage`, bạn đã đi sai đường ở bước 3.

- [ ] **Step 7: Chạy test rộng**

```bash
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false
cd ../views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/detail/components/
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/tasks/stores packages/views/tasks/detail/components/comment-composer.tsx
git commit -m "feat(tasks): nháp bình luận sống sót qua điều hướng"
```

---

### Task 4: Gấp luồng đã giải quyết

**Files:**
- Create: `packages/views/tasks/detail/components/resolved-thread-bar.tsx`
- Modify: `packages/views/tasks/detail/components/timeline.tsx`
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`
- Test: `packages/views/tasks/detail/components/resolved-thread-bar.test.tsx`

**Interfaces:**
- Consumes: `CommentThread` từ task 1; `TaskComment.resolved_at?: string`.

- [ ] **Step 1: Viết test thất bại**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ResolvedThreadBar } from "./resolved-thread-bar";

initI18n();

describe("ResolvedThreadBar", () => {
  it("nói rõ luồng đã giải quyết và có bao nhiêu câu trả lời", () => {
    render(<ResolvedThreadBar replyCount={3} expanded={false} onToggle={vi.fn()} />);
    expect(screen.getByTestId("resolved-thread-bar")).toHaveTextContent("3");
  });

  it("gọi onToggle khi bấm", () => {
    const onToggle = vi.fn();
    render(<ResolvedThreadBar replyCount={0} expanded={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByTestId("resolved-thread-bar"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Chạy test để thấy nó thất bại**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/detail/components/resolved-thread-bar.test.tsx
```

- [ ] **Step 3: Viết thanh gấp**

```tsx
"use client";

import { ChevronDown, ChevronRight, CircleCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

/** A resolved thread collapses to one line so the open ones stay readable. */
export function ResolvedThreadBar({
  replyCount,
  expanded,
  onToggle,
}: {
  replyCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      data-testid="resolved-thread-bar"
      aria-expanded={expanded}
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-caption text-muted-foreground"
    >
      <Chevron className="size-3.5 shrink-0" aria-hidden />
      <CircleCheck className="size-3.5 shrink-0" aria-hidden />
      <span>{t("tasks.detail.thread_resolved", { count: replyCount })}</span>
    </button>
  );
}
```

- [ ] **Step 4: Thêm khóa i18n**

```json
"thread_resolved": "Luồng đã giải quyết · {{count}} trả lời"
```

```json
"thread_resolved": "Resolved thread · {{count}} replies"
```

- [ ] **Step 5: Nối vào timeline**

Một luồng coi là đã giải quyết khi `thread.root.resolved_at` có giá trị. Khi đó render `ResolvedThreadBar` thay cho cả luồng, và chỉ hiện nội dung khi người dùng mở ra. Giữ trạng thái mở bằng `useState<Set<string>>` trong `timeline.tsx`, không cần store bền.

- [ ] **Step 6: Chạy test và commit**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/detail/components/
git add packages/views/tasks/detail/components packages/core/i18n/locales
git commit -m "feat(tasks): gấp luồng bình luận đã giải quyết"
```

---

### Task 5: Composer dính đáy

**Files:**
- Modify: `packages/views/tasks/detail/components/timeline.tsx`
- Test: `packages/views/tasks/detail/components/timeline.test.tsx`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `timeline.test.tsx` một ca khẳng định khối bọc composer mang lớp dính:

```tsx
it("giữ ô soạn bình luận dính đáy khi cuộn", () => {
  mockComments([]);
  mockResourceHistory([]);
  renderTimeline({ workspaceId: "w1", taskId: "t1" });
  expect(screen.getByTestId("task-comment-composer-dock")).toHaveClass("sticky");
});
```

`timeline.test.tsx` mock module `@uniwork/core/tasks` và `@uniwork/core/audit` bằng `vi.mock`
với `importOriginal`, rồi render qua `wrapWithNav` cộng `WorkspaceProvider`. `mockComments`
và `mockResourceHistory` ở trên tương ứng với việc đổi mảng trả về của `useComments` và
`useResourceHistory` đã mock sẵn; `renderTimeline` tương ứng với lời gọi render mà file
đang dùng. Đọc file rồi bám đúng khuôn đó.

- [ ] **Step 2: Chạy test để thấy nó thất bại**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/detail/components/timeline.test.tsx
```

- [ ] **Step 3: Bọc composer**

Trong `timeline.tsx`, đổi khối bọc `TaskCommentComposer` cuối cùng thành:

```tsx
      <div
        data-testid="task-comment-composer-dock"
        className="sticky bottom-0 z-10 mt-4 border-t border-border bg-background pt-3"
      >
        <TaskCommentComposer taskId={taskId} onSubmit={onCompose} />
      </div>
```

Nền đục là bắt buộc: thiếu nó thì bình luận sẽ chạy xuyên qua ô soạn khi cuộn.

- [ ] **Step 4: Chạy test và commit**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/detail/components/
git add packages/views/tasks/detail/components/timeline.tsx packages/views/tasks/detail/components/timeline.test.tsx
git commit -m "feat(tasks): ô soạn bình luận dính đáy khi cuộn"
```

---

### Task 6: Bảng điều hướng luồng

Chỉ đáng làm khi một task có nhiều luồng. Nếu lúc thực thi bạn thấy nó chỉ phục vụ trường hợp hiếm và làm trang rối thêm, hãy báo cáo lại thay vì cứ dựng — quyết định cắt là của controller, nhưng nhận xét của bạn có trọng lượng.

**Files:**
- Create: `packages/views/tasks/detail/components/thread-nav-panel.tsx`
- Modify: `packages/views/tasks/detail/components/timeline.tsx`
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`
- Test: `packages/views/tasks/detail/components/thread-nav-panel.test.tsx`

- [ ] **Step 1: Viết test thất bại**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ThreadNavPanel } from "./thread-nav-panel";

initI18n();

const threads = [
  { id: "r1", preview: "Câu đầu", replyCount: 2, resolved: false },
  { id: "r2", preview: "Câu sau", replyCount: 0, resolved: true },
];

describe("ThreadNavPanel", () => {
  it("liệt kê từng luồng kèm số trả lời", () => {
    render(<ThreadNavPanel threads={threads} onJump={vi.fn()} />);
    expect(screen.getByTestId("thread-nav-r1")).toHaveTextContent("Câu đầu");
    expect(screen.getByTestId("thread-nav-r2")).toHaveTextContent("Câu sau");
  });

  it("gọi onJump kèm id luồng", () => {
    const onJump = vi.fn();
    render(<ThreadNavPanel threads={threads} onJump={onJump} />);
    fireEvent.click(screen.getByTestId("thread-nav-r2"));
    expect(onJump).toHaveBeenCalledWith("r2");
  });

  it("không hiện gì khi chỉ có một luồng, vì lúc đó không có gì để điều hướng", () => {
    const { container } = render(
      <ThreadNavPanel threads={[threads[0]!]} onJump={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

Ca thứ ba là phần YAGNI được viết thành test: bảng chỉ xuất hiện khi nó thật sự có ích.

- [ ] **Step 2: Chạy test để thấy nó thất bại**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/detail/components/thread-nav-panel.test.tsx
```

- [ ] **Step 3: Viết bảng**

```tsx
"use client";

import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";

export type ThreadNavItem = {
  id: string;
  preview: string;
  replyCount: number;
  resolved: boolean;
};

/** Only earns its space once there is more than one thread to move between. */
export function ThreadNavPanel({
  threads,
  onJump,
}: {
  threads: ThreadNavItem[];
  onJump: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (threads.length < 2) return null;
  return (
    <nav aria-label={t("tasks.detail.thread_nav")} className="mb-3 flex flex-wrap gap-1.5">
      {threads.map((thread) => (
        <button
          key={thread.id}
          type="button"
          data-testid={`thread-nav-${thread.id}`}
          onClick={() => onJump(thread.id)}
          className={cn(
            "max-w-56 truncate rounded-full border border-border px-2.5 py-1 text-caption",
            thread.resolved ? "text-muted-foreground opacity-70" : "text-foreground",
          )}
        >
          {thread.preview}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Thêm khóa i18n**

```json
"thread_nav": "Điều hướng luồng"
```

```json
"thread_nav": "Thread navigation"
```

- [ ] **Step 5: Nối vào timeline**

Dựng `ThreadNavItem[]` từ `threads` của task 1. `preview` phải đi qua `commentPreviewText` của task 2, KHÔNG cắt thẳng `root.body`: body là Markdown và chip sẽ hiện cú pháp thô nếu cắt sống. `onJump` cuộn tới `#comment-<id>` bằng đúng cơ chế mà `useEffect` xử lý hash đang dùng, để hai đường cuộn không đá nhau.

- [ ] **Step 6: Chạy test và commit**

```bash
cd packages/views && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false tasks/detail/components/
git add packages/views/tasks/detail/components packages/core/i18n/locales
git commit -m "feat(tasks): bảng điều hướng luồng bình luận"
```

---

### Task 7: Cổng cuối và tài liệu

- [ ] **Step 1: Chạy cổng đầy đủ**

```bash
NODE_OPTIONS="--no-experimental-webstorage" make check
```

Đọc output, đừng chỉ nhìn mã thoát: ở `GATE_LEVEL=fast`, lint và coverage in cảnh báo thay vì chặn. Đối chiếu mọi lỗi với danh sách lỗi nền ở mục Global Constraints. Chỉ lỗi ngoài danh sách đó mới là việc của bạn.

- [ ] **Step 2: Kiểm cân bằng i18n**

```bash
cd packages/core && NODE_OPTIONS="--no-experimental-webstorage" npx vitest run --coverage=false i18n
```

Lát này thêm khoảng sáu khóa. Cả hai file phải khớp.

- [ ] **Step 3: Nâng sàn coverage**

Đọc phần trăm mà lần chạy in ra cho `@uniwork/views` và `@uniwork/core`, rồi nâng `thresholds` trong vitest config của từng package lên đúng con số đạt được. Sàn KHÔNG BAO GIỜ đi xuống: nếu số nào thấp hơn sàn hiện tại, dừng lại và báo cáo, vì đó là dấu hiệu lát này làm mất độ phủ.

Lưu ý đã biết: `packages/core` có functions và lines dưới sàn từ TRƯỚC lát A, và đó không phải việc của lát B. Chỉ báo cáo, đừng hạ sàn, đừng nhận trách nhiệm.

- [ ] **Step 4: Cập nhật tài liệu**

Đổi dòng trạng thái của plan này thành shipped. Trong `docs/superpowers/specs/2026-09-12-tasks-human-parity-design.md`, ghi lát B đã shipped và trỏ tới plan này. Giữ F-05 ở `MỘT PHẦN` trong `docs/roadmap/FEATURE_ROADMAP.md` và thêm một dòng ghi chú rằng lát B đã xong, gồm trả lời, gấp luồng đã giải quyết, điều hướng luồng, composer dính và nháp bền.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(tasks): nâng sàn coverage và cập nhật trạng thái lát B"
```

**KHÔNG chạy `make issue-pr`.** Mở pull request là việc của con người, không phải của bạn.

---

## Ghi chú cho người thực thi

- Thứ tự phụ thuộc: task 1 là nền của 2, 4 và 6. **Task 3 phụ thuộc task 2**, vì nó dùng
  prop `composerKey` mà task 2 thêm vào composer — đừng đảo hai task này. Task 5 độc lập.
  Task 7 cuối cùng.
- Lát A vừa sửa `timeline.tsx` khá nhiều: nó giờ trộn hoạt động từ nhật ký kiểm toán, có trạng thái lỗi riêng, và dùng presenter audit dùng chung. Luôn đọc bản hiện tại trên đĩa, đừng tin mô tả cũ ở đâu đó.
- Không lát nào được đụng `server/` hay `server/internal/workcapability/`.
