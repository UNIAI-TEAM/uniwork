# UniWork — Tasks parity web cutover (UNI-426 lát cắt 8)

> **Trạng thái:** in-progress — thiết kế chờ duyệt 2026-09-09; lát 7 (desktop/mobile hosts) **deferred**; F-05 vẫn `MỘT PHẦN` sau lát này

**Ngày:** 2026-09-09  
**Issue:** (tạo sub-issue dưới UNI-426 khi bắt đầu implement — `UNI-426.8`)  
**Parent:** UNI-426 · F-05  
**Phụ thuộc:** Lát 1–6 đã trên `develop` (UNI-495 … UNI-519)  
**Umbrella:** `2026-09-07-tasks-work-management-parity-design.md` §11 mục 8, §13  
**Không làm:** lát 7 hosts (`desktop.host` / `mobile.host` vẫn Unavailable)

## 1. Mục tiêu

Hard cutover **web**: suite Tasks / My Tasks / Projects / task detail trở thành
path duy nhất; **xóa** feature flag `tasks_work_management_parity` và implementation
MVP song song. **Ẩn hết** chrome agent hướng user (nav Squads/Runtimes, panel
AgentRun/PR trên detail, stub trigger/assign trên Surface). Không desktop/mobile;
không bật runtime agent; F-05 vẫn `MỘT PHẦN` với ghi chú “web cutover xong; hosts
deferred”.

## 2. Quyết định đã chốt (brainstorm 2026-09-09)

| Chủ đề | Quyết định |
| --- | --- |
| Kiểu cutover | **Hard (A)** — xóa flag + xóa MVP; không soft default |
| Lát 7 hosts | **Deferred** — không nằm trong lát 8 |
| Squads / Runtimes nav | **Ẩn** — xóa khỏi sidebar; xóa route/shell hoặc để 404 (không entry point) |
| AgentRun / PR trên detail | **Ẩn hết** — không mount |
| Stub agent/squad trên board/list/batch/create | **Ẩn hết** — gỡ mount |
| F-05 sau lát 8 | Vẫn **`MỘT PHẦN`** — docs ghi web cutover + hosts deferred |
| Approach implement | Một PR cắt sạch (A), không dual-PR giữ MVP chết |

## 3. Phạm vi

### 3.1 Trong phạm vi

**Flag & gates**

- Gỡ khai báo `tasks_work_management_parity` (server featureflags keys, env
  `FF_*` / `.env.example`, admin overrides docs nếu có).
- Gỡ mọi `useFlag("tasks_work_management_parity")` / StaticProvider harness chỉ
  phục vụ dual path.
- **Server:** gỡ gate `feature_disabled` / flag check trên suite task APIs
  (query, batch, statuses, projects, collaboration, …) — suite API luôn available
  theo membership như các API khác. Stub agent/VCS routes **giữ**
  `capability_unavailable` (không flip Available).

**MVP → suite only**

- Task detail: luôn mount suite (`tasks/detail`); **xóa** `TaskDetailView` MVP
  và nhánh flag-off trên `tasks/[taskId]/page.tsx`.
- `/tasks`, `/my-tasks`, `/projects`: luôn suite list/detail; xóa
  `*Unavailable` chỉ dùng cho flag-off.
- Sidebar: Projects (và mục suite khác đã parity) luôn hiện khi quyền cho phép;
  **không** hiện Squads/Runtimes.

**Ẩn chrome agent (user-facing)**

- Unmount AgentRun panel + PR list khỏi task detail timeline.
- Gỡ `AgentTriggerStub` / `SquadAssignStub` khỏi board/list/batch/new-task.
- Xóa hoặc ngừng export nav + web routes `squads` / `runtimes` (và
  `SquadsUnavailable` / `RuntimesUnavailable`). Reserved slugs: giữ hoặc gỡ
  theo consistency tests — ưu tiên **gỡ route + paths builders** nếu không còn
  page.
- Có thể **giữ** file stub components / HTTP stubs / catalogue unavailable trong
  repo nếu còn test contract server; **không** mount UI. Ưu tiên xóa dead UI
  để knip/lint sạch; server stub routes được phép giữ.

**Capabilities**

- `tasks.agent_runs` | `squads` | `vcs` | `local_workdir` | `desktop.host` |
  `mobile.host`: **vẫn Unavailable**.
- Optional cùng PR nếu rẻ: `tasks.projects` → `Available` (Projects đã ship lát
  4; catalogue đang lệch).

**Tests / docs / parity**

- Đổi E2E: bỏ matrix flag off; smoke suite luôn on; xóa hoặc thu hẹp
  `agent-integration-parity-smoke` (không còn assert nav Squads / AgentRun
  visible).
- Brand-scan / overlay: cập nhật note lát 8; không yêu cầu verify đủ hosts.
- Umbrella + roadmap F-05: web cutover shipped; lát 7 deferred; vẫn `MỘT PHẦN`.
- Spec lát 6: đánh dấu chrome user-facing superseded bởi cutover (stub server
  có thể còn).

### 3.2 Ngoài phạm vi

- Desktop / mobile hosts (lát 7) và flip `desktop.host` / `mobile.host`.
- Agent runtime / VCS OAuth / daemon thật (F-10 / ADR 0010).
- Soft cutover / giữ dual path rollback bằng flag.
- Residual `project_id` trên create-from-project (nợ lát 4) — chỉ nếu rẻ và
  không phình PR.
- Đánh F-05 `CÓ` hoặc đóng UNI-426.
- Port lại toàn bộ Multica residual pending trong manifest (~1300 entries).

## 4. Kiến trúc (sau cutover)

```text
Web (no parity flag)
  /tasks /my-tasks /projects /tasks/[id]
      → suite views only (no MVP branch)
  sidebar: … Projects … (no Squads/Runtimes)
  task detail: no AgentRun/PR chrome
  surface: no agent/squad stubs

Server
  suite task/project APIs: always on (membership gates only)
  agent/VCS/squad/workdir stub routes: still capability_unavailable
  catalogue agent*|desktop|mobile: Unavailable
```

### 4.1 Rollback

Sau khi xóa flag: rollback = **revert merge / deploy bản trước**. Không dual-write;
không giữ “tắt flag về MVP”.

### 4.2 Mapping xóa chính (gợi ý plan)

| Hiện trạng | Sau lát 8 |
| --- | --- |
| `useFlag(tasks_work_management_parity)` | Xóa |
| `TaskDetailView` + flag-off page branch | Xóa; luôn suite |
| `TasksUnavailable` / `MyTasksUnavailable` / `ProjectsUnavailable` (flag-off) | Xóa nếu chỉ phục vụ flag |
| `squads/` `runtimes/` pages + nav | Xóa entry points |
| Detail AgentRun/PR + surface agent-squad-gates mount | Unmount / xóa UI |
| Server flag gate trên suite routes | Xóa gate |
| E2E flag on/off harness | Suite-only smoke |

## 5. DoD lát 8

- [ ] Không còn symbol/product path phụ thuộc `tasks_work_management_parity`
      (trừ changelog/docs lịch sử nếu cần).
- [ ] Không còn mount MVP task detail / flag-off unavailable cho Tasks suite.
- [ ] User không thấy Squads/Runtimes nav hay AgentRun/PR/surface agent stubs.
- [ ] Suite APIs không trả `feature_disabled` vì flag cũ.
- [ ] `tasks.agent_*` / hosts vẫn Unavailable; không runtime mới.
- [ ] E2E + unit/contract liên quan cập nhật; `make check` xanh.
- [ ] Roadmap + umbrella: web cutover done; lát 7 deferred; F-05 `MỘT PHẦN`.
- [ ] Sub-issue lát 8 tạo + PR `UNI-nnn`; không `issue-done` F-05 umbrella.

## 6. Rủi ro

| Rủi ro | Giảm |
| --- | --- |
| Prod đang dựa flag off (MVP) | Giao tiếp trước merge; hard cutover có chủ đích |
| Quên gate server → 404 suite API | Checklist grep `feature_disabled` + `tasks_work_management_parity` |
| Knip/dead exports sau xóa UI | Xóa theo knip; giữ server stubs có test |
| User tưởng agent “mất” | Docs: ẩn có chủ đích; F-10 sau |

## 7. Tiếp theo

1. User duyệt spec này.  
2. `writing-plans` → plan implementation.  
3. `make issue-start` sub-issue UNI-426.8 → Subagent-Driven execute.
