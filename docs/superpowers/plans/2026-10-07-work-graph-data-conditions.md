# Điều kiện dữ liệu của Work Graph (C-11 §9.1: V1, V2, V3) — kế hoạch triển khai

> **Trạng thái:** in-progress — UNI-963 (sub-issue của UNI-460), nhánh `feature/UNI-963-c-11-9-1-dieu-kien-du-lieu-nhac-tom-tat`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ba luồng "nguồn → việc" ghi nguồn gốc thật để đồ thị có dữ liệu: nhắc chủ trì tóm tắt sau khi họp xong (V1), cuộc họp gắn được dự án (V2), luồng thư → việc có test giữ nguồn gốc (V3).

**Architecture:** V1 là một luật mới trong consumer thông báo hiện có (`internal/notification`, lane notify) trên topic `meeting.ended`. Luật không gọi model, chỉ tạo thông báo kind `meeting_summary_reminder` dẫn về panel tóm tắt qua `?section=summary`. V2 gồm ô chọn dự án trên form tạo/sửa cuộc họp, một dòng "Dự án" ở khung chi tiết, và sửa service để bỏ chọn dự án thì ghi NULL thay vì `''`. V3 đã có màn từ 2026-09-24 (`EmailHubAiPanel` → `EmailHubCreateSummaryTasksDialog`), nên chỉ thêm test giữ `origin_type = 'email_thread'` và thân POST.

**Tech Stack:** Go 1.27 (pgx, sqlc 1.31.1), Postgres 16, Next.js + React 19, TanStack Query, Base UI, vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-10-07-work-graph-foundation-design.md` (§9.1, §11; §13 ghi các điều chỉnh sau khảo sát mã).

## Global Constraints

- Mọi chuỗi giao diện qua `t()`; thêm khóa vào `packages/core/i18n/locales/vi.json` trước, rồi `en.json`; `parity.test.ts` giữ hai bên khớp khóa và `{{biến}}`.
- Tiêu đề thông báo phía server (`server/internal/notification/titles.go`) phải trùng từng chữ với `notifications.kind.*` trong hai file locale (`TestTitlesMatchClientLocales`). Ngoặc kép trong tiêu đề là ngoặc cong `“…”`, như các dòng đang có.
- Giọng văn theo `docs/conventions.md`: nói như đồng nghiệp, không "vui lòng", nút bắt đầu bằng động từ.
- Comment trong mã bằng tiếng Anh. Kế hoạch và spec bằng tiếng Việt.
- Sửa `server/pkg/db/queries/*.sql` thì chạy `make sqlc` và commit cả `server/pkg/db/generated/`. CI không kiểm drift; quên regen thì chỉ lỗi biên dịch mới lộ.
- Query mới chạm bảng tenant phải có `-- tenant: parent meeting_id` (hoặc lọc `organization_id = $n`) ngay dòng sau `-- name:` (`TestEveryQueryNamesItsTenant`). Thừa dòng tenant cũng đỏ.
- Test Go dùng `testutil.DB(t)` và **bỏ qua im lặng khi không kết nối được DB**. Luôn chạy với `-v` và đọc kết quả: phải là `--- PASS`, không phải `--- SKIP`. Chạy `make test-go` một lần đầu phiên để dựng và migrate DB test.
- Không chạy cả bộ e2e (mất khoảng 10 phút); kế hoạch này không thêm spec e2e.
- File `.ts/.tsx` tối đa 500 dòng hiệu dụng (`max-lines`).
- Commit theo prefix quy ước, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; hook `prepare-commit-msg` tự thêm `Refs: UNI-nnn`.

## Review Focus

1. **Chủ trì tự bấm Kết thúc:** sự kiện mang actor là chính chủ trì; `recipients.add` bỏ actor. Luật phải dựng `Draft` trực tiếp. Test ở Task 1 dùng đúng đường này.
2. **Cuộc họp không có gì để tóm tắt** (không transcript, ghi chú, chat, biểu quyết đã đóng): không nhắc. Có test ở Task 1.
3. **Đã có tóm tắt trước khi kết thúc** (chủ trì tóm tắt lúc đang họp): không nhắc. Có test ở Task 1.
4. **Bỏ chọn dự án** trên form sửa: server ghi NULL, không ghi `''`; đọc lại thì không còn `project_id`. Có test ở Task 3.
5. **Tổ chức không có gói tóm tắt AI hoặc server chưa cấu hình model:** không nhắc, vì bấm vào chỉ gặp lỗi. Port `SummaryAvailable` ở Task 1 giữ điều này, có test với port trả `false`.

---

## Task 0: Issue và nhánh

Không có issue thì không có code (`docs/engineering/UNIAI_TRACKING.md`). Agent không tự tạo issue gốc.

- [ ] **Bước 1: Lấy issue.** Người dùng tạo (hoặc chỉ định) issue C-11 và một sub-issue "C-11 §9.1 điều kiện dữ liệu". Ghi khóa sub-issue vào biến `KEY` trong phiên làm việc, ví dụ `KEY=UNI-960`.
- [ ] **Bước 2: Mở phiên.**

```bash
uniai issue get $KEY --output json
make issue-start KEY=$KEY
```

Kết quả mong đợi: nhánh `feature/$KEY-...` từ `develop`, issue chuyển `in_progress`.

- [ ] **Bước 3: Ghi khóa vào đầu kế hoạch.** Sửa dòng trạng thái: `> **Trạng thái:** in-progress — $KEY, nhánh feature/$KEY-...`.

---

## Task 1: V1 phía server, luật nhắc tóm tắt trên `meeting.ended`

**Files:**
- Modify: `server/pkg/db/queries/meeting_ai.sql` (thêm `HasMeetingSummarySource`)
- Regenerate: `server/pkg/db/generated/meeting_ai.sql.go`
- Modify: `server/internal/service/meeting_ai.go` (thêm `SummaryAvailable` sau `AIEnabled`, dòng ~210)
- Modify: `server/internal/notification/kinds.go`, `titles.go`, `rules.go`, `consumer.go`, `push_consumer.go`
- Modify: `server/cmd/server/main.go` (cạnh `notifConsumer.SetDocumentReaders(docSvc)`, dòng ~367)
- Modify: `packages/core/i18n/locales/vi.json`, `en.json` (hai khóa)
- Create: `server/internal/notification/meeting_ended_test.go`

**Interfaces:**
- Produces: `notification.KindMeetingSummaryReminder = "meeting_summary_reminder"`; `notification.SummaryChecker` interface `{ SummaryAvailable(ctx context.Context, orgID string) bool }`; `(*notification.Consumer).SetMeetingSummaries(SummaryChecker)`; `(*service.MeetingService).SummaryAvailable(ctx, orgID string) bool`; `(*db.Queries).HasMeetingSummarySource(ctx, meetingID string) (bool, error)`; deep link `…/meetings/<id>?section=summary`.

- [ ] **Bước 1: Viết test đỏ.** Tạo `server/internal/notification/meeting_ended_test.go`:

```go
package notification

import (
	"context"
	"testing"
	"time"
)

// fakeSummaries stands in for MeetingService: the test DB's default plan
// does not include meeting.ai_summary, so the gate is injected.
type fakeSummaries struct{ on bool }

func (s fakeSummaries) SummaryAvailable(context.Context, string) bool { return s.on }

// endedMeeting starts an instant meeting as the owner, optionally says one
// transcript line, and ends it; the host is the actor of meeting.ended.
func (f *fixture) endedMeeting(t *testing.T, title string, withTranscript bool) string {
	t.Helper()
	m, err := f.meetings.CreateInstant(f.ctx, f.owner.ID, f.wsID, title)
	if err != nil {
		t.Fatal(err)
	}
	if withTranscript {
		if _, err := f.meetings.AppendTranscript(f.ctx, f.owner.ID, m.ID, "Chốt hạn thứ sáu", time.Time{}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.meetings.End(f.ctx, f.owner.ID, m.ID); err != nil {
		t.Fatal(err)
	}
	return m.ID
}

func TestRuleMeetingEndedNudgesHost(t *testing.T) {
	f := newFixture(t)
	f.consumer.SetMeetingSummaries(fakeSummaries{on: true})
	meetingID := f.endedMeeting(t, "Giao ban", true)

	f.handleLast(t, "meeting.ended")
	got := f.inbox(t, f.owner.ID)
	if len(got) != 1 || got[0].Kind != KindMeetingSummaryReminder || got[0].ResourceType != "meeting" || got[0].ResourceID != meetingID {
		t.Fatalf("host inbox = %+v", got)
	}
	if got[0].ActorKind != "system" || !contains(got[0].Params, `"meeting":"Giao ban"`) || got[0].WorkspaceID.String != f.wsID {
		t.Fatalf("attribution = %+v", got[0])
	}
	if len(f.inbox(t, f.member.ID)) != 0 {
		t.Fatal("only the host is nudged")
	}
	// The same row again (a retry) leaves one notification.
	f.handleLast(t, "meeting.ended")
	if n := len(f.inbox(t, f.owner.ID)); n != 1 {
		t.Fatalf("after retry inbox = %d", n)
	}
}

func TestRuleMeetingEndedStaysQuiet(t *testing.T) {
	t.Run("nothing to summarize", func(t *testing.T) {
		f := newFixture(t)
		f.consumer.SetMeetingSummaries(fakeSummaries{on: true})
		f.endedMeeting(t, "Họp trống", false)
		f.handleLast(t, "meeting.ended")
		if got := f.inbox(t, f.owner.ID); len(got) != 0 {
			t.Fatalf("inbox = %+v", got)
		}
	})
	t.Run("summaries unavailable", func(t *testing.T) {
		f := newFixture(t)
		f.consumer.SetMeetingSummaries(fakeSummaries{on: false})
		f.endedMeeting(t, "Không có AI", true)
		f.handleLast(t, "meeting.ended")
		if got := f.inbox(t, f.owner.ID); len(got) != 0 {
			t.Fatalf("inbox = %+v", got)
		}
	})
	t.Run("port not wired", func(t *testing.T) {
		f := newFixture(t)
		f.endedMeeting(t, "Chưa nối port", true)
		f.handleLast(t, "meeting.ended")
		if got := f.inbox(t, f.owner.ID); len(got) != 0 {
			t.Fatalf("inbox = %+v", got)
		}
	})
	t.Run("already summarized", func(t *testing.T) {
		f := newFixture(t)
		f.consumer.SetMeetingSummaries(fakeSummaries{on: true})
		meetingID := f.endedMeeting(t, "Đã tóm tắt", true)
		if _, err := f.pool.Exec(f.ctx, `INSERT INTO meeting_summaries (id, organization_id, meeting_id, summary, created_by)
			VALUES ('sum-1', $1, $2, 'Tóm tắt', $3)`, f.orgID, meetingID, f.owner.ID); err != nil {
			t.Fatal(err)
		}
		f.handleLast(t, "meeting.ended")
		if got := f.inbox(t, f.owner.ID); len(got) != 0 {
			t.Fatalf("inbox = %+v", got)
		}
	})
}
```

Các cột `NOT NULL` không có mặc định của `meeting_summaries` là `id, meeting_id, summary, created_by` (bảng gốc) và `organization_id` (migration `9991790915600001`). Câu `INSERT` trong ca "already summarized" điền đủ.

- [ ] **Bước 2: Chạy test, xác nhận đỏ.**

```bash
cd server && go test ./internal/notification/ -run 'TestRuleMeetingEnded' -count=1 -v
```

Kết quả mong đợi: biên dịch hỏng vì chưa có `SetMeetingSummaries` và `KindMeetingSummaryReminder`.

- [ ] **Bước 3: Thêm query.** Cuối `server/pkg/db/queries/meeting_ai.sql`:

```sql
-- name: HasMeetingSummarySource :one
-- tenant: parent meeting_id
-- C-11 §9.1 V1: the same "anything to summarize" test Summarize applies
-- (transcript, notes, meeting chat or a closed motion), as one round trip.
SELECT (
  EXISTS (SELECT 1 FROM meeting_transcript_segments WHERE meeting_id = sqlc.arg(meeting_id)::text)
  OR EXISTS (SELECT 1 FROM meeting_notes WHERE meeting_id = sqlc.arg(meeting_id)::text)
  OR EXISTS (SELECT 1 FROM meeting_chat_messages WHERE meeting_id = sqlc.arg(meeting_id)::text)
  OR EXISTS (SELECT 1 FROM meeting_motions WHERE meeting_id = sqlc.arg(meeting_id)::text AND status = 'CLOSED')
)::boolean AS has_source;
```

Chạy `make sqlc`. Kiểm `server/pkg/db/generated/meeting_ai.sql.go` có `func (q *Queries) HasMeetingSummarySource(ctx context.Context, meetingID string) (bool, error)`.

- [ ] **Bước 4: Thêm cổng trong service.** Ngay sau `func (s *MeetingService) AIEnabled() bool` trong `server/internal/service/meeting_ai.go`:

```go
// SummaryAvailable reports whether the organization may summarize meetings
// with AI right now: its plan includes meeting.ai_summary and a model is
// configured. The notification consumer asks before nudging a host, so a
// nudge never leads to a button that only answers 403 or 503 (C-11 §9.1 V1).
func (s *MeetingService) SummaryAvailable(ctx context.Context, orgID string) bool {
	return s.AIEnabled() && s.ent.Can(ctx, orgID, FeatureMeetingAISummary) == nil
}
```

- [ ] **Bước 5: Đăng ký kind.** `server/internal/notification/kinds.go`: thêm hằng vào khối `const`, sau `KindMeetingStarting`:

```go
	// Nudge after a meeting ends with something to summarize (C-11 §9.1 V1).
	KindMeetingSummaryReminder = "meeting_summary_reminder"
```

và thêm vào `Kinds` ngay sau `KindMeetingStarting`:

```go
	KindMeetingInvited, KindMeetingStarting, KindMeetingSummaryReminder,
```

`titles.go`: thêm vào map `"vi"` và `"en"`:

```go
		KindMeetingSummaryReminder: "“{{meeting}}” đã kết thúc · Tóm tắt và tạo việc",
```

```go
		KindMeetingSummaryReminder: "“{{meeting}}” ended · Summarize it and create tasks",
```

`prefs.go` giữ nguyên: push tắt, digest bật, như mọi kind không gấp.

- [ ] **Bước 6: Thêm hai khóa locale.** Trong `packages/core/i18n/locales/vi.json`, mục `notifications.kind`, sau `meeting_starting`:

```json
"meeting_summary_reminder": "“{{meeting}}” đã kết thúc · Tóm tắt và tạo việc",
```

và trong `settings.notifications.kinds`, sau `meeting_starting`:

```json
"meeting_summary_reminder": "Nhắc tóm tắt sau cuộc họp",
```

Trong `en.json`, hai vị trí tương ứng:

```json
"meeting_summary_reminder": "“{{meeting}}” ended · Summarize it and create tasks",
```

```json
"meeting_summary_reminder": "Summary reminder after a meeting",
```

- [ ] **Bước 7: Port và luật.** `server/internal/notification/rules.go`, sau `DocumentReadChecker`:

```go
// SummaryChecker says whether AI meeting summaries are open to an
// organization (plan and model). MeetingService implements it; it is
// injected through SetMeetingSummaries so the rule never guesses (C-11 §9.1 V1).
type SummaryChecker interface {
	SummaryAvailable(ctx context.Context, orgID string) bool
}
```

Thêm trường vào `env`:

```go
type env struct {
	q         *db.Queries
	members   MemberChecker
	docs      DocumentReadChecker
	summaries SummaryChecker
}
```

Thêm vào map `rules`:

```go
	"meeting.ended":          ruleMeetingEnded,
```

Thêm hàm luật (cuối file, cạnh các luật cuộc họp):

```go
// ruleMeetingEnded nudges the host to summarize a meeting that has something
// to summarize and no summary yet (C-11 §9.1 V1). It never calls a model.
// Personal reminder: the host is the recipient even when they ended the
// meeting themselves, so the draft is built here rather than through
// recipients.add, which drops the actor.
func ruleMeetingEnded(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	if e.summaries == nil {
		return nil, nil
	}
	m, err := e.q.GetMeeting(ctx, p["meeting_id"])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	// GetMeeting is by-id: the row must belong to the event's tenant.
	if (ev.OrganizationID.Valid && m.OrganizationID != ev.OrganizationID.String) ||
		(ev.WorkspaceID.Valid && m.WorkspaceID != ev.WorkspaceID.String) {
		return nil, nil
	}
	if m.Status != "ENDED" || m.HostUserID == "" {
		return nil, nil
	}
	if !e.summaries.SummaryAvailable(ctx, m.OrganizationID) {
		return nil, nil
	}
	if _, err := e.q.GetLatestMeetingSummary(ctx, m.ID); err == nil {
		return nil, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	has, err := e.q.HasMeetingSummarySource(ctx, m.ID)
	if err != nil {
		return nil, err
	}
	if !has {
		return nil, nil
	}
	if _, err := e.members.RequireMember(ctx, m.WorkspaceID, m.HostUserID); err != nil {
		return nil, nil
	}
	return []Draft{{
		UserID: m.HostUserID, OrganizationID: m.OrganizationID, WorkspaceID: m.WorkspaceID,
		Kind: KindMeetingSummaryReminder, GroupKey: "meeting:" + m.ID + ":summary_reminder",
		ResourceType: "meeting", ResourceID: m.ID,
		ActorKind: string(audit.KindSystem), ActorID: "meeting_summary_reminder",
		Params: map[string]string{"meeting": m.Title},
	}}, nil
}
```

`server/internal/notification/consumer.go`, sau `SetDocumentReaders`:

```go
// SetMeetingSummaries wires the AI-summary availability port the meeting
// summary nudge asks. MeetingService satisfies it. Unwired, the nudge is
// never sent.
func (c *Consumer) SetMeetingSummaries(s SummaryChecker) { c.env.summaries = s }
```

Nếu `rules.go` chưa import `audit` thì thêm `"github.com/unicomhub/uniwork/server/internal/audit"` (file đã dùng `audit.KindHuman` nên thường đã có).

- [ ] **Bước 8: Deep link phía server.** `push_consumer.go`, trong `ResourceURL`, thay nhánh `case "meeting":` bằng:

```go
	case "meeting":
		if n.Kind == KindMeetingSummaryReminder {
			// Lands on the summary panel (use-meeting-section-deep-link.ts).
			return base + "/meetings/" + n.ResourceID + "?section=summary", nil
		}
		return base + "/meetings/" + n.ResourceID, nil
```

Thêm vào `meeting_ended_test.go`:

```go
func TestResourceURLOpensTheSummaryPanel(t *testing.T) {
	f := newFixture(t)
	f.consumer.SetMeetingSummaries(fakeSummaries{on: true})
	meetingID := f.endedMeeting(t, "Giao ban", true)
	f.handleLast(t, "meeting.ended")
	n := f.inbox(t, f.owner.ID)[0]
	got, err := ResourceURL(f.ctx, f.q, "https://app.test", n)
	if err != nil {
		t.Fatal(err)
	}
	if want := "https://app.test/notif-org/notif-ws/meetings/" + meetingID + "?section=summary"; got != want {
		t.Fatalf("url = %q, want %q", got, want)
	}
}
```

- [ ] **Bước 9: Nối port trong main.** `server/cmd/server/main.go`, ngay dưới `notifConsumer.SetDocumentReaders(docSvc)`:

```go
	notifConsumer.SetMeetingSummaries(meetingSvc)
```

- [ ] **Bước 10: Chạy test, xác nhận xanh.**

```bash
cd server && go test ./internal/notification/ -count=1 -v 2>&1 | grep -E '^(=== RUN|--- (PASS|FAIL|SKIP)|ok|FAIL)' | tail -40
cd server && go build ./... && go vet ./internal/notification/ ./internal/service/
```

Kết quả mong đợi: `TestRuleMeetingEndedNudgesHost`, `TestRuleMeetingEndedStaysQuiet` (4 ca con), `TestResourceURLOpensTheSummaryPanel`, `TestTitlesMatchClientLocales`, `TestRulesMembershipAndMeeting` đều `PASS`, không có `SKIP`.

- [ ] **Bước 11: Commit.**

```bash
git add server/pkg/db/queries/meeting_ai.sql server/pkg/db/generated/meeting_ai.sql.go \
  server/internal/service/meeting_ai.go server/internal/notification/ server/cmd/server/main.go \
  packages/core/i18n/locales/vi.json packages/core/i18n/locales/en.json
git commit -m "feat(notifications): nudge the host to summarize an ended meeting

C-11 §9.1 V1: a rule on meeting.ended creates meeting_summary_reminder for
the host when the meeting has transcript, notes, chat or a closed motion,
no summary yet, and the organization can summarize (plan + model). It never
calls a model. Deliberately left out: auto-resolving the notification once
a summary exists (no mechanism today), and nudging admins.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: V1 phía web, kind mới và deep link tới panel tóm tắt

**Files:**
- Modify: `packages/core/types/notification.ts` (`NOTIFICATION_KINDS`)
- Modify: `packages/views/notifications/notification-category.ts`, `kind-tone.ts`, `kind-icon.tsx`, `resource-href.ts`, `resource-href.test.ts`
- Create: `packages/views/meetings/use-meeting-section-deep-link.ts`, `use-meeting-section-deep-link.test.tsx`
- Modify: `packages/views/meetings/meeting-detail-view.tsx` (gọi hook)

**Interfaces:**
- Consumes: kind `meeting_summary_reminder`, URL `…/meetings/<id>?section=summary` (Task 1).
- Produces: `useMeetingSectionDeepLink({ ready }: { ready: boolean }): void`, cuộn tới phần tử `#summary-heading` khi `?section=summary` rồi bỏ tham số.

- [ ] **Bước 1: Test đỏ cho href.** Thêm vào `resource-href.test.ts`:

```ts
  it("opens a meeting's summary panel from the summary reminder", () => {
    const n = { ...base, kind: "meeting_summary_reminder", resource_type: "meeting", resource_id: "m1" } as Notification;
    expect(resourceHref(n, workspace)).toBe("/acme/team/meetings/m1?section=summary");
  });

  it("opens other meeting notifications at the top of the page", () => {
    const n = { ...base, kind: "meeting_invited", resource_type: "meeting", resource_id: "m1" } as Notification;
    expect(resourceHref(n, workspace)).toBe("/acme/team/meetings/m1");
  });
```

- [ ] **Bước 2: Chạy, xác nhận đỏ.**

```bash
pnpm --filter @uniwork/views exec vitest run notifications/resource-href.test.ts
```

Kết quả mong đợi: ca đầu FAIL (`/acme/team/meetings/m1` ≠ `…?section=summary`).

- [ ] **Bước 3: Đăng ký kind ở client.**

`packages/core/types/notification.ts`: thêm `"meeting_summary_reminder",` ngay sau `"meeting_starting",`.

`notification-category.ts`, trong `KIND_CATEGORY`: `meeting_summary_reminder: "meetings",`.

`kind-tone.ts`, trong `KIND_TONES`: `meeting_summary_reminder: moduleTone("meetings"),`.

`kind-icon.tsx`: thêm `Sparkles` vào import từ `lucide-react` (giữ thứ tự chữ cái) và `meeting_summary_reminder: Sparkles,` trong `ICONS`.

`resource-href.ts`, thay nhánh meeting:

```ts
    case "meeting":
      // The summary reminder lands on the summary panel (use-meeting-section-deep-link).
      return n.kind === "meeting_summary_reminder"
        ? `${ws.meeting(n.resource_id)}?section=summary`
        : ws.meeting(n.resource_id);
```

`packages/views/settings/components/notifications-matrix.tsx` giữ nguyên: `serverDefault` chỉ liệt kê kind bật push.

- [ ] **Bước 4: Test đỏ cho hook cuộn.** Tạo `packages/views/meetings/use-meeting-section-deep-link.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigationAdapter } from "../navigation";
import { wrapWithNav } from "../test/api-mock";
import { useMeetingSectionDeepLink } from "./use-meeting-section-deep-link";

function adapter(search: string): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/team/meetings/m1",
    searchParams: new URLSearchParams(search),
    getShareableUrl: (p) => p,
  };
}

function Probe({ ready }: { ready: boolean }) {
  useMeetingSectionDeepLink({ ready });
  return <h2 id="summary-heading">Tóm tắt</h2>;
}

describe("useMeetingSectionDeepLink", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("scrolls to the summary once the page is ready, then drops the param", () => {
    const nav = adapter("section=summary");
    const { rerender } = render(wrapWithNav(<Probe ready={false} />, nav));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    rerender(wrapWithNav(<Probe ready />, nav));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/acme/team/meetings/m1");
  });

  it("does nothing without the param", () => {
    const nav = adapter("");
    render(wrapWithNav(<Probe ready />, nav));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
```

`wrapWithNav(ui, adapter)` (`packages/views/test/api-mock.tsx:37`) bọc QueryClient, locale và `NavigationProvider value={adapter}`. Mỗi lần gọi tạo QueryClient mới; hook này không dùng query nên `rerender` vẫn đúng.

- [ ] **Bước 5: Chạy, xác nhận đỏ** (`Cannot find module './use-meeting-section-deep-link'`).

```bash
pnpm --filter @uniwork/views exec vitest run meetings/use-meeting-section-deep-link.test.tsx
```

- [ ] **Bước 6: Viết hook.** `packages/views/meetings/use-meeting-section-deep-link.ts`:

```ts
"use client";

import { useEffect, useRef } from "react";
import { useOptionalNavigation } from "../navigation";

const SECTION_PARAM = "section";
/** Section name in the URL → id of the heading the page scrolls to. */
const SECTION_ANCHORS: Record<string, string> = { summary: "summary-heading" };

/**
 * `/meetings/<id>?section=summary` scrolls the detail page to its summary
 * panel once the meeting has loaded (the panel is data-driven, inside an inner
 * scroller, so a native #hash cannot do it). The param is dropped once used,
 * so a reload does not jump again. Where a notification lands (C-11 §9.1 V1).
 */
export function useMeetingSectionDeepLink({ ready }: { ready: boolean }): void {
  const nav = useOptionalNavigation();
  const section = nav?.searchParams.get(SECTION_PARAM) ?? "";
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!nav || !section || !ready || handled.current === section) return;
    handled.current = section;
    const anchor = SECTION_ANCHORS[section];
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: "start", behavior: "smooth" });
    const params = new URLSearchParams(nav.searchParams);
    params.delete(SECTION_PARAM);
    const qs = params.toString();
    nav.replace(qs ? `${nav.pathname}?${qs}` : nav.pathname);
  }, [nav, ready, section]);
}
```

- [ ] **Bước 7: Gọi hook trong trang chi tiết.** `packages/views/meetings/meeting-detail-view.tsx`: import `useMeetingSectionDeepLink` từ `./use-meeting-section-deep-link`. Gọi ở đầu thân component cùng nhóm với các hook khác (trước mọi `return` sớm, đúng luật hook), với biến `meeting` đã có trong component:

```ts
  // The summary reminder opens here (C-11 §9.1 V1); the panel exists only
  // once the meeting is loaded and has started.
  useMeetingSectionDeepLink({
    ready: Boolean(meeting) && (meeting?.status === "IN_PROGRESS" || meeting?.status === "ENDED"),
  });
```

- [ ] **Bước 8: Chạy test và typecheck.**

```bash
pnpm --filter @uniwork/views exec vitest run notifications/ meetings/use-meeting-section-deep-link.test.tsx meetings/meeting-detail
pnpm --filter @uniwork/core exec vitest run i18n/parity.test.ts
pnpm typecheck
```

Kết quả mong đợi: tất cả PASS. `typecheck` xanh chứng minh ba `Record<NotificationKind, …>` đã đủ khóa.

- [ ] **Bước 9: Commit.**

```bash
git add packages/core/types/notification.ts packages/views/notifications/ packages/views/meetings/use-meeting-section-deep-link.ts \
  packages/views/meetings/use-meeting-section-deep-link.test.tsx packages/views/meetings/meeting-detail-view.tsx
git commit -m "feat(meetings): open the summary panel from the summary reminder

The reminder links to /meetings/<id>?section=summary; the detail page
scrolls to the summary heading once loaded and drops the param.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 3: V2 phía server, bỏ chọn dự án ghi NULL và audit có `project_id`

**Files:**
- Modify: `server/pkg/db/queries/meetings.sql` (`UpdateMeeting`, dòng ~82)
- Regenerate: `server/pkg/db/generated/meetings.sql.go`
- Modify: `server/internal/service/meeting_update.go` (diff audit, dòng ~122-125)
- Modify: `server/internal/service/meeting.go` (`createScheduled` lưu id đã trim, dòng ~289)
- Create: `server/internal/service/meeting_project_test.go`

**Interfaces:**
- Produces: PATCH `{"project_id": ""}` → `meetings.project_id IS NULL`; audit `meeting.updated` có `changes.project_id`.

- [ ] **Bước 1: Test đỏ.** `server/internal/service/meeting_project_test.go`:

```go
package service

import (
	"context"
	"testing"
	"time"
)

// A meeting takes a project on create, keeps it through edits, and loses it
// to NULL (not '') when the host clears the field (C-11 §9.1 V2).
func TestMeetingProjectSetAndCleared(t *testing.T) {
	s, ua, _, w := meetingFixture(t)
	ctx := context.Background()
	tasks := NewTaskService(s.pool, s.q, s.ws, nil)
	p, err := tasks.CreateProject(ctx, Human(ua.ID), w.ID, CreateProjectInput{Title: "Ra mắt Q4"})
	if err != nil {
		t.Fatal(err)
	}
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "Giao ban", StartsAt: time.Now().Add(time.Hour), EndsAt: time.Now().Add(2 * time.Hour),
		Timezone: "UTC", ProjectID: "  " + p.ID + " ",
	})
	if err != nil {
		t.Fatal(err)
	}
	if m.ProjectID.String != p.ID {
		t.Fatalf("project on create = %q", m.ProjectID.String)
	}
	empty := ""
	up, err := s.Update(ctx, ua.ID, m.ID, UpdateMeetingInput{ProjectID: &empty})
	if err != nil {
		t.Fatal(err)
	}
	if up.ProjectID.Valid {
		t.Fatalf("cleared project = %+v, want NULL", up.ProjectID)
	}
	var changes string
	if err := s.pool.QueryRow(ctx, `SELECT changes::text FROM audit_events
		WHERE resource_id = $1 AND action = 'meeting.updated' ORDER BY created_at DESC LIMIT 1`, m.ID).Scan(&changes); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(changes, `"project_id"`) {
		t.Fatalf("audit changes = %s", changes)
	}
}
```

Thêm `"strings"` vào import. `meetingFixture` (`meeting_test.go:16-29`) trả `(*MeetingService, db.User, db.User, db.Workspace)`. `MeetingService` có các trường không xuất `pool`, `q`, `ws`, đọc được trong cùng package.

- [ ] **Bước 2: Chạy, xác nhận đỏ.**

```bash
cd server && go test ./internal/service/ -run TestMeetingProjectSetAndCleared -count=1 -v
```

Kết quả mong đợi: FAIL ở `project on create` (đang lưu chuỗi chưa trim) hoặc `cleared project = {String: Valid:true}`.

- [ ] **Bước 3: Sửa SQL.** Trong `UpdateMeeting` (`server/pkg/db/queries/meetings.sql`), thay dòng `project_id  = COALESCE(sqlc.narg('project_id'), project_id),` bằng:

```sql
  -- NULL keeps the project; '' clears it to NULL (C-11 §9.1 V2: the graph
  -- reads NULL as "no project", never '').
  project_id  = CASE
    WHEN sqlc.narg('project_id')::text IS NULL THEN project_id
    ELSE NULLIF(sqlc.narg('project_id')::text, '')
  END,
```

Chạy `make sqlc`. Kiểm `UpdateMeetingParams.ProjectID` vẫn là `pgtype.Text`.

- [ ] **Bước 4: Lưu id đã trim khi tạo.** Trong `createScheduled` (`server/internal/service/meeting.go`, quanh dòng 271-289), trim một lần trước khi kiểm và dùng cùng giá trị khi lưu:

```go
	projectID := strings.TrimSpace(in.ProjectID)
	if err := s.requireMeetingProject(ctx, mem.OrganizationID, workspaceID, projectID); err != nil {
		return db.Meeting{}, err
	}
```

và ở chỗ dựng `db.CreateMeetingParams`: `ProjectID: strText(projectID),`.

- [ ] **Bước 5: Diff audit có `project_id`.** Trong `meeting_update.go`, lời gọi `s.record(... "meeting.updated" ...)`, thêm `"project_id"` vào cả hai map:

```go
	s.record(ctx, q, up, audit.User(userID), "meeting.updated", nil, audit.Diff(
		map[string]any{"title": m.Title, "starts_at": tsOrNil(m.StartsAt), "ends_at": tsOrNil(m.EndsAt), "quorum_percent": quorumOrNil(m.QuorumPercent), "project_id": textOrNil(m.ProjectID)},
		map[string]any{"title": up.Title, "starts_at": tsOrNil(up.StartsAt), "ends_at": tsOrNil(up.EndsAt), "quorum_percent": quorumOrNil(up.QuorumPercent), "project_id": textOrNil(up.ProjectID)},
	))
```

`textOrNil` đã có trong package (`document_pages.go:663`, trả `nil` khi NULL) và `tsOrNil` ở `meeting.go:453`. Sau Bước 3, `project_id` không còn là `''` nên `textOrNil` đủ dùng.

- [ ] **Bước 6: Chạy test, xác nhận xanh, chạy lại test cách ly liên quan.**

```bash
cd server && go test ./internal/service/ -run 'TestMeetingProjectSetAndCleared|TestMeeting' -count=1 -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)' | tail -30
cd server && go test ./internal/handler/ -run 'TestIsolationMatrix|TestEveryBodyIDFieldHasAReferenceCase' -count=1 -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)'
cd server && go test ./migrations/ -run TestEveryQueryNamesItsTenant -count=1
```

- [ ] **Bước 7: Commit.**

```bash
git add server/pkg/db/queries/meetings.sql server/pkg/db/generated/meetings.sql.go server/internal/service/meeting_update.go \
  server/internal/service/meeting.go server/internal/service/meeting_project_test.go
git commit -m "fix(meetings): clearing a meeting's project stores NULL and is audited

PATCH project_id \"\" used to store ''. The Work Graph (C-11) reads NULL as
\"no project\". The meeting.updated audit diff now carries project_id, and
create stores the trimmed id it validated.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: V2 phía web, ô chọn dự án và dòng "Dự án" ở chi tiết

**Files:**
- Create: `packages/views/projects/components/project-select.tsx`
- Delete: `packages/views/email-hub/email-hub-task-project-select.tsx` (thay bằng `ProjectSelect`)
- Modify: `packages/views/email-hub/email-hub-create-summary-tasks-dialog.tsx` (dòng ~23, ~206)
- Modify: `packages/core/api/endpoints/meetings.ts` (`CreateMeetingBody`, `UpdateMeetingBody`, dòng 54-74)
- Modify: `packages/views/meetings/new-meeting-dialog.tsx`, `meeting-edit-dialog.tsx`, `meeting-detail-aside.tsx`, `meeting-summary-panel.tsx` (dòng ~140)
- Modify: `packages/views/meetings/new-meeting-dialog.test.tsx`, `meeting-edit-dialog.test.tsx`
- Modify: `packages/core/i18n/locales/vi.json`, `en.json`

**Interfaces:**
- Consumes: PATCH `project_id: ""` xóa dự án (Task 3).
- Produces: `ProjectSelect({ workspaceId, value, onChange, noneLabel, ariaLabel, id?, size?, className? })`; `useProjectsAvailable(): boolean` (capability `tasks.projects`).

- [ ] **Bước 1: Test đỏ cho form tạo.** Thêm vào `packages/views/meetings/new-meeting-dialog.test.tsx` (giữ helper và import đang có; thêm `within` nếu chưa import):

```tsx
const config = {
  flags: {},
  rum_sample_rate: 0,
  work_management_capabilities: { "tasks.projects": { status: "available" } },
};

it("sends the chosen project with the new meeting", async () => {
  requestMock.mockImplementation((path: unknown, opts?: { method?: string }) => {
    const p = String(path);
    if (p.startsWith("/api/v1/config")) return Promise.resolve(config);
    if (p.endsWith("/projects") || p.includes("/projects?")) {
      return Promise.resolve({ projects: [{ id: "p1", title: "Ra mắt Q4", status: "in_progress", priority: "none" }], total: 1 });
    }
    if (opts?.method === "POST") return Promise.resolve({ meeting: { id: "m1", title: "Giao ban" } });
    return Promise.resolve({ members: [] });
  });
  render(wrapWithNav(<NewMeetingDialog workspaceId="w1" trigger={<button type="button">Mở</button>} />));
  fireEvent.click(screen.getByRole("button", { name: "Mở" }));
  fireEvent.change(await screen.findByLabelText("Tiêu đề"), { target: { value: "Giao ban" } });
  fireEvent.click(await screen.findByRole("combobox", { name: "Dự án" }));
  fireEvent.click(await screen.findByRole("option", { name: "Ra mắt Q4" }));
  fireEvent.click(screen.getByRole("button", { name: "Tạo cuộc họp" }));
  await waitFor(() =>
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/workspaces/w1/meetings",
      expect.objectContaining({ method: "POST", body: expect.objectContaining({ project_id: "p1" }) }),
    ),
  );
});

it("hides the project field when projects are unavailable", async () => {
  requestMock.mockImplementation((path: unknown) =>
    String(path).startsWith("/api/v1/config")
      ? Promise.resolve({ ...config, work_management_capabilities: {} })
      : Promise.resolve({ members: [] }),
  );
  render(wrapWithNav(<NewMeetingDialog workspaceId="w1" trigger={<button type="button">Mở</button>} />));
  fireEvent.click(screen.getByRole("button", { name: "Mở" }));
  await screen.findByLabelText("Tiêu đề");
  expect(screen.queryByRole("combobox", { name: "Dự án" })).toBeNull();
});
```

Nhãn `"Tiêu đề"` và `"Tạo cuộc họp"` là `meetings.meetingTitle` và `meetings.createSubmit` trong `vi.json`. `createMeeting` gọi `POST /api/v1/workspaces/{ws}/meetings` (`packages/core/api/endpoints/meetings.ts:143-148`).

- [ ] **Bước 2: Test đỏ cho form sửa.** Thêm vào `meeting-edit-dialog.test.tsx`, theo mẫu assert body đang có (`:39-200`):

```tsx
it("clears the project with an empty string", async () => {
  // Seed a meeting that has project p1; reuse the file's meeting fixture with project_id: "p1".
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.startsWith("/api/v1/config")) {
      return Promise.resolve({ flags: {}, rum_sample_rate: 0, work_management_capabilities: { "tasks.projects": { status: "available" } } });
    }
    if (p.includes("/projects")) return Promise.resolve({ projects: [{ id: "p1", title: "Ra mắt Q4", status: "in_progress", priority: "none" }], total: 1 });
    return Promise.resolve({ meeting: { ...meeting, project_id: "" } });
  });
  render(wrapWithNav(<MeetingEditDialog workspaceId="w1" meeting={{ ...meeting, project_id: "p1" }} trigger={<button type="button">Sửa</button>} />));
  fireEvent.click(screen.getByRole("button", { name: "Sửa" }));
  fireEvent.click(await screen.findByRole("combobox", { name: "Dự án" }));
  fireEvent.click(await screen.findByRole("option", { name: "Không thuộc dự án" }));
  fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
  await waitFor(() =>
    expect(requestMock).toHaveBeenCalledWith(
      "/api/v1/meetings/m1",
      expect.objectContaining({ method: "PATCH", body: expect.objectContaining({ project_id: "" }) }),
    ),
  );
});
```

`meeting` là biến fixture cuộc họp của file (id `m1`); nếu file đặt tên khác thì dùng tên đó. `"Lưu thay đổi"` là `meetings.saveChanges`, nhãn nút lưu (`meeting-edit-dialog.tsx:312`).

- [ ] **Bước 3: Chạy, xác nhận đỏ** (không có combobox "Dự án").

```bash
pnpm --filter @uniwork/views exec vitest run meetings/new-meeting-dialog.test.tsx meetings/meeting-edit-dialog.test.tsx
```

- [ ] **Bước 4: Khóa i18n.** `vi.json`, mục `meetings`:

```json
"project": "Dự án",
"projectNone": "Không thuộc dự án",
```

`en.json`, mục `meetings`:

```json
"project": "Project",
"projectNone": "No project",
```

- [ ] **Bước 5: `ProjectSelect` dùng chung.** Tạo `packages/views/projects/components/project-select.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { capabilityState } from "@uniwork/core/capabilities";
import { usePublicConfig } from "@uniwork/core/feature-flags";
import { useProjects } from "@uniwork/core/tasks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";

const NO_PROJECT = "__no_project__";
const EMPTY_CONFIG = { flags: {}, rum_sample_rate: 0, work_management_capabilities: {} };

/** Whether the workspace surface offers projects (the tasks.projects capability). */
export function useProjectsAvailable(): boolean {
  const { data } = usePublicConfig();
  return capabilityState(data ?? EMPTY_CONFIG, "tasks.projects").status === "available";
}

/**
 * A form-shaped project picker: "no project" first, then the workspace's
 * projects. `undefined` means no project. Used by Email Hub's create-tasks
 * dialog and the meeting forms (C-11 §9.1 V2).
 */
export function ProjectSelect({
  workspaceId,
  value,
  onChange,
  noneLabel,
  ariaLabel,
  id,
  size,
  className,
}: {
  workspaceId: string;
  value?: string;
  onChange: (projectId: string | undefined) => void;
  noneLabel: string;
  ariaLabel: string;
  id?: string;
  size?: "sm" | "default";
  className?: string;
}) {
  const { data } = useProjects(workspaceId);
  const projects = useMemo(() => data?.projects ?? [], [data?.projects]);
  const items = useMemo(
    () => [{ value: NO_PROJECT, label: noneLabel }, ...projects.map((p) => ({ value: p.id, label: p.title }))],
    [noneLabel, projects],
  );
  const selectValue = value?.trim() ? value : NO_PROJECT;
  const active = items.find((item) => item.value === selectValue);

  return (
    <Select
      items={items}
      value={selectValue}
      onValueChange={(next) => onChange(!next || next === NO_PROJECT ? undefined : next)}
    >
      <SelectTrigger id={id} size={size} className={className} aria-label={ariaLabel}>
        <SelectValue placeholder={noneLabel}>{active?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
```

So `EMPTY_CONFIG` với hằng cùng tên trong `tasks/detail/components/task-project-row.tsx:14` và chép đúng hình dạng. Nếu `SelectTrigger` không nhận `size="default"`, bỏ prop `size` khi giá trị là `undefined`.

- [ ] **Bước 6: Email Hub dùng `ProjectSelect`.** Trong `email-hub-create-summary-tasks-dialog.tsx`, thay import `EmailHubTaskProjectSelect` bằng `import { ProjectSelect } from "../projects/components/project-select";`. Thay chỗ dùng (dòng ~206) bằng cùng props cũ cộng hai nhãn:

```tsx
              <ProjectSelect
                workspaceId={wsId}
                value={projectId}
                onChange={setProjectId}
                noneLabel={t("email_hub.ai.project_none")}
                ariaLabel={t("email_hub.ai.project_label")}
                size="sm"
                className={/* the className the old call passed */ undefined}
              />
```

Giữ nguyên `value`, `onChange` và `className` mà lời gọi cũ truyền (đọc lại dòng 206-212 trước khi thay). Xóa `packages/views/email-hub/email-hub-task-project-select.tsx`.

- [ ] **Bước 7: Thân request.** `packages/core/api/endpoints/meetings.ts`: thêm vào `CreateMeetingBody` và `UpdateMeetingBody`:

```ts
  /** Optional project; "" on update clears it (C-11 §9.1 V2). */
  project_id?: string;
```

- [ ] **Bước 8: Form tạo.** `new-meeting-dialog.tsx`:

```tsx
import { ProjectSelect, useProjectsAvailable } from "../projects/components/project-select";
// …
  const projectsAvailable = useProjectsAvailable();
  const [projectId, setProjectId] = useState<string | undefined>(undefined);
```

Trong `reset()` thêm `setProjectId(undefined);`. Trong body `create.mutate({...})` thêm `...(projectId ? { project_id: projectId } : {}),`. Ngay sau `<Field>` của mô tả:

```tsx
              {projectsAvailable ? (
                <Field>
                  <FieldLabel htmlFor={`${id}-project`}>{t("meetings.project")}</FieldLabel>
                  <ProjectSelect
                    id={`${id}-project`}
                    workspaceId={workspaceId}
                    value={projectId}
                    onChange={setProjectId}
                    noneLabel={t("meetings.projectNone")}
                    ariaLabel={t("meetings.project")}
                  />
                </Field>
              ) : null}
```

- [ ] **Bước 9: Form sửa.** `meeting-edit-dialog.tsx`:
  - `meetingDraft` thêm `projectId: meeting.project_id ?? "",`.
  - `meetingRevision` thêm `meeting.project_id,` vào mảng.
  - Destructure thêm `projectId` từ `draft`; `const projectsAvailable = useProjectsAvailable();`.
  - Body `update.mutate({...})` thêm `...(projectId !== seed.draft.projectId ? { project_id: projectId } : {}),` (gửi `""` khi bỏ chọn; không gửi khi không đổi).
  - Trong `<section aria-labelledby={`${id}-details`}>`, sau `<Field>` mô tả:

```tsx
                {projectsAvailable ? (
                  <Field>
                    <FieldLabel htmlFor={`${id}-project`}>{t("meetings.project")}</FieldLabel>
                    <ProjectSelect
                      id={`${id}-project`}
                      workspaceId={workspaceId}
                      value={projectId || undefined}
                      onChange={(next) => set("projectId")(next ?? "")}
                      noneLabel={t("meetings.projectNone")}
                      ariaLabel={t("meetings.project")}
                    />
                  </Field>
                ) : null}
```

- [ ] **Bước 10: Dòng "Dự án" ở khung chi tiết.** `meeting-detail-aside.tsx`: import `useProject` từ `@uniwork/core/tasks`, `paths` từ `@uniwork/core/paths`, `AppLink` từ `../navigation`, `useWorkspace` từ `../layout/workspace-context`. Trong `MeetingDetailAside`:

```tsx
  const { workspace } = useWorkspace();
  const projectId = meeting.project_id || "";
  const { data: project } = useProject(workspaceId, projectId);
```

Trong `<dl>`, ngay sau dòng múi giờ:

```tsx
          {project ? (
            <DetailRow label={t("meetings.project")}>
              <AppLink
                href={paths.workspace(workspace.organization_slug, workspace.slug).project(project.id)}
                className="text-foreground underline-offset-4 hover:underline"
              >
                {project.title}
              </AppLink>
            </DetailRow>
          ) : null}
```

(`useProject` đã tắt khi `projectId` rỗng, `hooks-projects.ts:33-39`.)

- [ ] **Bước 11: Việc tạo từ tóm tắt kế thừa dự án của cuộc họp.** `meeting-summary-panel.tsx`, trong `onCreateTasks`:

```ts
    const items = buildSummaryTaskItems(actionItems, picked, assigneeOverrides, meeting.project_id || undefined);
```

(Chữ ký `buildSummaryTaskItems(actionItems, picked, overrides, defaultProjectId?)` ở `packages/core/meetings/summary-task-items.ts:11-17`.)

- [ ] **Bước 12: Chạy test, typecheck, lint, knip.**

```bash
pnpm --filter @uniwork/views exec vitest run meetings/ email-hub/
pnpm --filter @uniwork/core exec vitest run i18n/parity.test.ts api/endpoints/meetings.test.ts
pnpm typecheck && pnpm lint && pnpm knip
```

Kết quả mong đợi: tất cả xanh, `knip` không báo file hay export thừa.

- [ ] **Bước 13: Commit.**

```bash
git add packages/views/projects/components/project-select.tsx packages/views/email-hub/ packages/core/api/endpoints/meetings.ts \
  packages/views/meetings/ packages/core/i18n/locales/vi.json packages/core/i18n/locales/en.json
git commit -m "feat(meetings): pick a project when creating or editing a meeting

C-11 §9.1 V2: an optional project field on both forms (hidden when the
tasks.projects capability is off), a Project row in the details card, and
tasks created from the summary inherit the meeting's project. The Email Hub
project select becomes the shared ProjectSelect.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5: V3, test giữ nguồn gốc của việc tạo từ luồng thư

Màn đã có (`email-hub-ai-panel.tsx` → `email-hub-create-summary-tasks-dialog.tsx`, commit `4132dec2`). Chỉ thiếu test.

**Files:**
- Create: `server/internal/service/email_hub_ai_tasks_test.go`
- Create: `packages/views/email-hub/email-hub-ai-panel.test.tsx`

**Interfaces:**
- Consumes: `EmailHubService.CreateTasksFromThreadSummary(ctx, actor Actor, workspaceID, accountID, threadID string, items []SummaryTaskItem) ([]db.Task, error)`.

- [ ] **Bước 1: Test server.** `server/internal/service/email_hub_ai_tasks_test.go`:

```go
package service

import (
	"context"
	"testing"
)

// Tasks created from an email thread summary carry the thread as their
// origin; the Work Graph projects that as ORIGINATED_FROM (C-11 §9.1 V3).
// Only the mailbox owner may create them.
func TestCreateTasksFromThreadSummaryKeepsTheOrigin(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	svc.Tasks = NewTaskService(pool, q, svc.ws, nil)
	account := seedEmailHubAccount(t, q, testEmailHubBox(t), user.ID, ws.OrganizationID)
	thread := seedEmailHubThread(t, q, account.ID, ws.OrganizationID)

	tasks, err := svc.CreateTasksFromThreadSummary(ctx, Human(user.ID), ws.ID, account.ID, thread.ID,
		[]SummaryTaskItem{{Title: "Gửi báo giá"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 || tasks[0].OriginType.String != "email_thread" || tasks[0].OriginID.String != thread.ID {
		t.Fatalf("origin = %+v / %+v", tasks[0].OriginType, tasks[0].OriginID)
	}
}
```

`EmailHubService` giữ `WorkspaceService` ở trường không xuất `ws` (`email_hub.go:39`), và `Tasks` là trường xuất, main gán sau khi dựng.

- [ ] **Bước 2: Chạy.** Test này giữ hành vi đã có, nên xanh ngay từ đầu. Để chứng minh test có cắn, tạm sửa `OriginType: "email_thread"` thành `"email"` ở `email_hub_ai.go:221`, chạy và thấy FAIL, rồi hoàn lại.

```bash
cd server && go test ./internal/service/ -run TestCreateTasksFromThreadSummaryKeepsTheOrigin -count=1 -v
```

- [ ] **Bước 3: Test views.** `packages/views/email-hub/email-hub-ai-panel.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { EmailHubAiPanel } from "./email-hub-ai-panel";

const me: User = {
  id: "u1", email: "me@x.com", display_name: "Me", onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "w1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "org", organization_name: "Org",
};
const summary = {
  summary: "Khách cần báo giá", key_points: [], action_items: [{ title: "Gửi báo giá", owner: "", due: "" }],
  needs_reply: false, reply_hint: "", model: "", cached: true, summarized_at: "2026-10-07T00:00:00Z",
};

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown, opts?: { method?: string }) => {
    const p = String(path);
    if (p.endsWith("/ai/capabilities")) return Promise.resolve({ enabled: true });
    if (p.endsWith("/ai/summary/tasks") && opts?.method === "POST") return Promise.resolve({ task_ids: ["t1"] });
    if (p.includes("/projects")) return Promise.resolve({ projects: [], total: 0 });
    return Promise.resolve({ members: [] });
  });
});

describe("EmailHubAiPanel", () => {
  it("creates tasks from the thread summary with the account and the picked items", async () => {
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={me}>
          <EmailHubAiPanel wsId="w1" accountId="a1" threadId="th1" bodyReady initialSummary={summary} />
        </WorkspaceProvider>,
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Tạo 1 việc" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo 1 việc" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/w1/email-hub/threads/th1/ai/summary/tasks",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ account_id: "a1", items: [expect.objectContaining({ title: "Gửi báo giá" })] }),
        }),
      ),
    );
  });
});
```

Cả nút trên thẻ action item (`email_hub.ai.create_tasks_one`) và nút xác nhận trong dialog (`create_tasks_confirm_one`) đều đọc "Tạo 1 việc", nên nút thứ hai được tìm trong `dialog`. GET tóm tắt cache nhận `{ members: [] }`, không qua schema, nên panel dùng `initialSummary`. Đó đúng là điều test muốn.

- [ ] **Bước 4: Chạy.**

```bash
pnpm --filter @uniwork/views exec vitest run email-hub/email-hub-ai-panel.test.tsx
```

Kết quả mong đợi: PASS.

- [ ] **Bước 5: Commit.**

```bash
git add server/internal/service/email_hub_ai_tasks_test.go packages/views/email-hub/email-hub-ai-panel.test.tsx
git commit -m "test(email-hub): pin the thread origin of tasks created from a summary

C-11 §9.1 V3 was already built (4132dec2): only tests were missing. The
service test pins origin_type email_thread + origin_id; the views test pins
the panel → dialog → POST body.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 6: Đo và đóng

- [ ] **Bước 1: Kiểm toàn bộ.** `make check`. Đọc phần Go và lint, không chỉ mã thoát (ở `GATE_LEVEL=fast` lỗi lint chỉ in ra).
- [ ] **Bước 2: Ghi cách đo V1** vào phần "Cách đo" của spec §9.1 (đã có trong §13 của spec). Câu SQL đo tỉ lệ cuộc họp đã kết thúc có tóm tắt trong 24 giờ:

```sql
SELECT count(*) FILTER (WHERE s.first_at <= m.actual_end_at + interval '24 hours')::float / NULLIF(count(*), 0) AS rate
FROM meetings m
LEFT JOIN LATERAL (SELECT min(created_at) AS first_at FROM meeting_summaries WHERE meeting_id = m.id) s ON true
WHERE m.organization_id = $1 AND m.status = 'ENDED' AND m.actual_end_at >= now() - interval '30 days';
```

(`meetings.actual_end_at` có từ migration 008.)
- [ ] **Bước 3: Cập nhật trạng thái kế hoạch** thành `shipped` sau khi PR merge. Mở PR bằng `make issue-pr`, để lại comment `[agent]` trên issue.
