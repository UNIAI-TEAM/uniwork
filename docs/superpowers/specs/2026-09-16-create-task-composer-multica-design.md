# UniWork — Create-task composer Multica parity (UI)

> **Trạng thái:** shipped — composer Multica parity (manual + agent chrome stub); E2E create-task-parity green.

**Ngày:** 2026-09-16  
**Issue:** kế thừa UNI-426 / create-task parity (UNI-645…UNI-648 đã có field/policy/E2E); lát UI này là composer layout.  
**Baseline nguồn:** `multica/` — `packages/views/modals/create-issue-dialog.tsx`, `create-issue.tsx` (ManualCreatePanel), `quick-create-issue.tsx` (AgentCreatePanel), `common/pill-button.tsx`  
**Ảnh tham chiếu:** Multica manual “Tạo thủ công” (pill composer); UniWork form “Việc mới” hiện tại.

## 1. Mục tiêu

Thay `NewTaskDialog` form 2 cột bằng **composer giống Multica**: title/description không label, hàng pill metadata, footer paperclip + mode switch + Tạo tiếp + CTA ⌘⏎, shell một Dialog đổi manual ↔ agent không flash overlay.

Giữ nguyên contract đã ship: draft persist, create-another, attachment bind, duplicate/quota toast (`active_duplicate_task` / `quota_exceeded`), Idempotency-Key, E2E `create-task-parity.spec.ts` (cập nhật selector).

## 2. Quyết định đã chốt

| Chủ đề | Quyết định |
| --- | --- |
| Approach | **A** — port shell + ManualCreatePanel; Agent panel UI đầy đủ |
| Agent mode | Full chrome như Multica (switch + agent line); **submit agent** stub/`capability_unavailable` nếu runtime chưa available (khớp UNI-519 cutover: không agent write business tables / ADR 0010) |
| Field visibility Settings | **Out of scope** (không port Settings → Issue quick-create fields) |
| Source-context / anchor comment | **Out of scope** |
| Children issues picker | **Out of scope** lần này (Multica có; UniWork chưa cần cho parity ảnh) |
| i18n | vi/en qua `t()`; không literal JSX |
| Tokens | Semantic UniWork (`bg-background`, `text-muted-foreground`, …); không copy token Multica thô |

## 3. Phạm vi

### 3.1 Trong phạm vi

**Shell**

- `CreateTaskDialog` (đổi tên hoặc wrap `NewTaskDialog`): một `Dialog` + `DialogContent`; `mode: manual | agent` local state; `isExpanded` lifted lên shell để className DialogContent.
- Mode switch remount **chỉ body**; Portal/Overlay giữ nguyên (pattern Multica `CreateIssueDialogBody`).

**Manual panel**

- Header: `{workspaceName} › Tạo thủ công` (hoặc “Việc mới” nếu glossary bắt buộc — ưu tiên khớp Multica breadcrumb + i18n key riêng).
- Expand / Close (tooltip).
- Title: input/editor lớn, placeholder “Tiêu đề…”, không `Label`.
- Description: `ContentEditor` borderless trong vùng composer, placeholder “Thêm mô tả…”.
- Pill row (wrap): Status, Priority, Assignee, Labels, Project; overflow `⋯` mở Parent, Stage, Start date, Due date, custom properties (mount pill khi có giá trị hoặc vừa mở từ menu).
- Footer: `FileUploadButton`/paperclip | nút **Chuyển sang agent** (viền gradient) | `Switch` **Tạo tiếp** | primary **Tạo** + keycaps ⌘⏎ khi shortcut send có.
- Submit: giữ `useCreateTask` + `toastCreateTaskError` + draft/settings store hiện có.

**Agent panel**

- Header tương tự + breadcrumb agent.
- Dòng avatar + copy “{Agent} sẽ bắt đầu làm ngay sau khi tạo.”
- Prompt/`ContentEditor` (không bắt buộc title riêng nếu Multica agent không có — khớp baseline).
- Pill tối thiểu: Project (+ overflow nếu cần); Assignee = agent/squad picker khi capability cho phép, không thì disabled + reason.
- Footer: paperclip | **Chuyển sang thủ công** | Tạo tiếp | Tạo (disabled/`capability_unavailable` toast nếu chưa có API agent-create).
- Carry: `project_id` (và description/prompt shared) qua `onSwitchMode` như Multica.

**Primitives**

- Port `PillButton` / `ClearablePillButton` vào `packages/views/common/` (hoặc `packages/ui` nếu thuần presentational — ưu tiên views nếu phụ thuộc picker).
- Reuse `Switch`, pickers hiện có (`AssigneePicker`, `LabelPicker`, status/priority/project) bọc trigger dạng pill.
- Shortcut keycaps: port mỏng hoặc inline từ Multica `ShortcutKeycaps` nếu UniWork đã có shortcut “send”; không thì hardcode hiển thị ⌘⏎ decorative khớp e2e/a11y (accessible name vẫn “Tạo”).

**Tests**

- Cập nhật `new-task-dialog.test.tsx` theo composer (pill roles, create-another switch, mode switch).
- Cập nhật `e2e/create-task-parity.spec.ts` (label Tiêu đề có thể thành placeholder/textbox không gắn Label; checkbox → switch).
- Unit: pill reveal từ `⋯`; mode switch không unmount Dialog; agent CTA disabled khi capability off.

### 3.2 Ngoài phạm vi

- Agent runtime thật / daemon / assist-init prompt từ description (trừ UI stub).
- Settings-controlled visible fields.
- Source context preview từ comment.
- Child-issue multi-select trên create.
- Desktop/mobile hosts khác web.

## 4. Cấu trúc module (đề xuất)

```
packages/views/tasks/
  create-task-dialog.tsx          # shell (Dialog + mode + expanded)
  create-task-manual-panel.tsx    # ManualCreatePanel
  create-task-agent-panel.tsx     # AgentCreatePanel (stub submit)
  create-task-error-toast.ts      # giữ
  new-task-dialog.tsx             # re-export CreateTaskDialog (tên cũ) để callers không gãy
packages/views/common/
  pill-button.tsx                 # port từ Multica
```

Callers (`workspace-top-bar`, `task-surface`) tiếp tục import `NewTaskDialog`.

Draft: giữ `useCreateTaskDraftStore`; có thể thêm `mode` + `agentPrompt` nhẹ nếu cần persist qua switch — không bắt buộc dual Multica draft stores lần này.

## 5. Hành vi chi tiết

1. Mở dialog → mode mặc định `manual` (trừ prop `initialMode`).
2. Escape / Close → đóng; draft vẫn persist nếu có nội dung meaningfully.
3. Create-another on + create OK → clear title/description/attachments theo Multica; giữ settings (status/priority/assignee/project/stage).
4. Duplicate/quota → toast hiện tại; không clear draft.
5. Switch manual→agent: gate upload in-flight; carry project (+ shared description→prompt assist optional stub).
6. Expand: DialogContent rộng hơn (`manualDialogContentClass` equivalent).

## 6. Rủi ro

| Rủi ro | Mitigation |
| --- | --- |
| `new-task-dialog.tsx` vượt 500 dòng | Tách panel/shell như §4 |
| E2E gãy vì mất `getByLabel("Tiêu đề")` | Dùng placeholder / role textbox name từ i18n |
| Agent UI “giống” nhưng không tạo được | CTA disabled + toast `capability_unavailable`; comment UniAI rõ stub |
| Pill + picker a11y | Giữ aria-label trên mỗi pill; không `outline-none` trên trigger |

## 7. Tiêu chí xong

- [ ] Visual: manual composer khớp ảnh Multica (breadcrumb, pills, footer, switch, CTA keycaps).
- [ ] Agent switch hiện + panel chrome; submit không ghi business table nếu capability off.
- [ ] Draft / create-another / attachment / duplicate / quota vẫn đúng.
- [ ] Unit + E2E create-task-parity xanh (không `make check` trừ khi user yêu cầu).
- [ ] Spec/plan tiếng Việt có dòng Trạng thái; i18n vi+en.

## 8. Self-review

- Không placeholder TBD trong quyết định đã chốt.
- Không mâu thuẫn ADR 0010 (agent write).
- Scope agent = UI full + submit stub — ghi rõ để tránh hiểu nhầm “agent create production”.
