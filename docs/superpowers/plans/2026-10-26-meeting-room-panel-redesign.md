# Panel bên phải phòng họp theo canvas: Implementation Plan

> **Trạng thái:** in-progress — chủ sản phẩm duyệt thiết kế 2026-10-26 ("oke duyệt, giống thiết kế 100%"), issue UNI-2173 (cha: UNI-2153), nhánh `feature/UNI-2173-thiet-ke-lai-panel-ben-phai-phong-hop-th` cắt từ develop 6a9198f74. Tóm tắt giữ cách tạo tay (nút ↻), không tự cập nhật.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Panel bên phải trong phòng họp (`MeetingRoomSidebar`) giống canvas đã duyệt: 4 tab icon, tab UNI thành một luồng có 2 cách xem, một ô nhập ghim đáy (Hỏi | Ghi chú, viền Beam khi UNI làm việc), lời thoại theo người nói, Việc/Mọi người/Biểu quyết làm lại, mọi tính năng hiện có vẫn chạy.

**Architecture:** Chỉ đổi frontend. Luồng UNI ghép dữ liệu đã có (mục việc cần làm, quyết định và câu hỏi của tóm tắt, ghi chú, bản ghi) bằng một hàm thuần trong `packages/core/meetings/feed.ts`; mọi màn hình nằm trong `packages/views/meetings`. Hiệu ứng viền là CSS trong `packages/ui/styles/base.css`, màu lấy từ token. Hỏi UNI dùng lại `AskUniEditor` (đã có @ nhắc việc/người/tài liệu) và `useAskUni`, thêm `AbortSignal` để nút Dừng hủy thật.

**Tech Stack:** React 19, TanStack Query, i18next, Tailwind (token ngữ nghĩa), Base UI/shadcn trong `packages/ui`, TipTap (`AskUniEditor`), LiveKit components, Vitest + Testing Library, Playwright.

**Spec:** canvas https://claude.ai/artifact/QQ71i6tH7C7KPGaqckEpCo. Mã nguồn từng bảng (đọc được, không sửa): `.superpowers/meeting-panel-redesign/canvas/project/*.dc.html` — `Main` (phòng họp + UNI Tổng hợp), `UniEmpty`, `UniTranscript`, `UniAsk`, `UniActions`, `Composer` (8 trạng thái ô nhập), `Chat`, `People`, `Votes`, `Dark`, `Phone`, `Spec` (quy tắc), `Audit` (16 phát hiện). Ảnh hiện trạng: `.superpowers/meeting-panel-redesign/shots-before/`. Khi task nói "giống bảng X", mở file bảng đó lấy kích thước, khoảng cách, màu, chữ.

## Global Constraints

- Luật repo (`CLAUDE.md`) giữ nguyên: `packages/views` không `next/*`, mọi chữ JSX qua `t()`, không màu cứng trong class (chỉ token: `bg-surface`, `text-muted-foreground`, `bg-brand`, `text-brand`, `bg-success-soft`, `text-success`, `bg-warning-soft`, `text-warning-soft-foreground`, `bg-brand-subtle`, `bg-tint-violet`, `text-tint-violet-foreground`, …), cỡ chữ theo thang `text-micro|caption|label|body|body-lg|title-sm|title`, file `.ts/.tsx` ≤ 500 dòng, `pnpm knip` sạch (file/xuất bỏ đi thì xóa luôn), icon Lucide tên chuẩn, nét 1,5px, loading dùng `<Spinner />`.
- Màu xám/kích thước trong bảng canvas là ảnh của token: `#202020`=foreground, `#646464`=muted-foreground, `#8a8a8a`=faint-foreground, `#f4f4f5`=surface-hover, `#e4e4e7`/`#ececef`=border, `#0a52e6`=brand, `#e8efff`/`#e4edff`=brand-subtle, `#e6f7ee`/`#137046`=success-soft/success, `#fff6d6`/`#8a4f04`=warning-soft/-foreground, violet mark = `ScribeMark`. Font: chữ Inter (`font-sans`), tiêu đề Plus Jakarta (`font-display`).
- Tab panel: rộng 384px (≥1280) / 352px; hàng tab = rãnh `bg-surface-hover rounded-xl p-[3px]`; tab đang chọn = viên `bg-surface shadow-sm` cao 34px, icon 18px + nhãn `text-label font-semibold`; tab khác chỉ icon, 40×34; `pointer-coarse:` mọi tab và nút ≥ 44px. Tab "Bản ghi" bỏ.
- Tên truy cập của tab không đổi: chữ của tab (+ `, <nghĩa huy hiệu>`), nên e2e `getByRole("tab", { name: /^Trò chuyện/ })` và tabpanel "Biểu quyết" vẫn đúng.
- Huy hiệu: `info` (xanh, có cái mới: tin chưa đọc, mục mới) = `bg-brand text-brand-foreground`; `attention` (hổ phách, đang chờ bạn: người chờ vào, phiếu chưa bỏ) = token mới `bg-badge-attention text-badge-attention-foreground`; một việc không đếm = chấm 8px cùng tông; viền 2px màu rãnh.
- Luồng UNI: mục mới nhất trên cùng; 5 loại mục và dấu tròn 26px: quyết định (`bg-success-soft text-success`, icon `Check`), việc (`bg-brand-subtle text-brand`, ô vuông bo `Square`), câu hỏi còn mở (`bg-warning-soft text-warning-soft-foreground`, ký tự "?"), ghi chú (mặt người viết 26px + bút `PencilLine` 12px dưới dòng), bản ghi (`bg-surface-hover`, `Play`).
- Ô nhập: hộp 2 tầng bo 18px, viền 1px dạng gradient; tầng trên vùng gõ 15/22px; tầng dưới: radiogroup `Hỏi | Ghi chú` (rãnh `bg-surface-hover rounded-[10px] p-0.5`, mục cao 26px), chip "Họp này" (chỉ ở chế độ Hỏi), nút @ 30px (chỉ ở chế độ Hỏi), nút gửi tròn 32px (44px trên `pointer-coarse`). Viền theo trạng thái: nghỉ = gradient nhạt (brand 25% / violet 18% trộn vào surface → border), đang gõ (`:focus-within`) = gradient brand→`tint-violet-foreground` + vòng ngoài 4px brand 10%, UNI làm việc = Beam 2,4s/vòng + quầng mờ 12px, Ghi chú = viền `foreground` 1,5px trên nền ấm (warning-soft 35% trộn surface), bị chặn = dải `bg-warning-soft` trong khung. `prefers-reduced-motion`: Beam đứng yên, giữ viền gradient.
- Không xóa khóa i18n đang có (landing demo và e2e còn đọc `meetings.actionsTab`, `recordingsTab`, `notes`, `insightsTab`, `aiCopilot`); khóa mới đặt dưới `meetings.panel.*`, có đủ `vi.json` và `en.json`. Chữ tiếng Việt theo `docs/conventions.md`.
- Bảng chữ mới (vi / en), dùng đúng nguyên văn:

| Khóa `meetings.panel.` | vi | en |
| --- | --- | --- |
| `collapse` | Thu gọn bảng | Collapse panel |
| `status.listening` | Đang nghe | Listening |
| `status.live` | Đang ghi | Taking notes |
| `status.paused` | Tạm dừng | Paused |
| `status.joining` | Đang vào | Joining |
| `status.failed` | Chưa vào được | Couldn't join |
| `status.off` | Tắt | Off |
| `views.label` | Cách xem | View |
| `views.feed` | Tổng hợp | Highlights |
| `views.transcript` | Lời thoại | Transcript |
| `summary.title` | Tóm tắt đến giờ | Summary so far |
| `summary.update` | Cập nhật tóm tắt | Update summary |
| `summary.copy` | Sao chép tóm tắt | Copy summary |
| `summary.none` | Chưa có tóm tắt | No summary yet |
| `summary.create` | Tạo | Create |
| `summary.sourcesHelp` | AI viết từ đâu | What the AI read |
| `filters.label` | Lọc theo loại | Filter by kind |
| `filters.all` | Tất cả | All |
| `kind.decision` | Quyết định | Decision |
| `kind.task` | Việc cần làm | Action item |
| `kind.question` | Câu hỏi còn mở | Open question |
| `kind.note` | Ghi chú | Note |
| `kind.recording` | Bản ghi | Recording |
| `kind.countLabel` | {{kind}}, {{count}} | {{kind}}, {{count}} |
| `feed.label` | Diễn biến cuộc họp | Meeting highlights |
| `feed.open` | Chưa chốt | Open |
| `feed.new` | Mới | New |
| `feed.playRecording` | Phát bản ghi | Play recording |
| `feed.addDue` | + Hạn | + Due |
| `feed.jumpToLine` | Xem câu nói lúc {{time}} | See what was said at {{time}} |
| `empty.title` | Thư ký UNI đang nghe | UNI Scribe is listening |
| `empty.line` | Ý chính sẽ hiện ở đây ngay khi có người nói. | Key points show up here as soon as someone speaks. |
| `empty.decided` | Chốt | Decided |
| `empty.todo` | Việc | To-do |
| `empty.asked` | Hỏi | Asked |
| `empty.carried_one` / `_other` | {{count}} việc còn mở | {{count}} open item / {{count}} open items |
| `empty.carriedFrom` | Từ lần họp trước | From earlier meetings |
| `composer.modeLabel` | Chế độ ô nhập | Input mode |
| `composer.ask` | Hỏi | Ask |
| `composer.note` | Ghi chú | Note |
| `composer.askPlaceholder` | Hỏi riêng UNI về cuộc họp… | Ask UNI privately about this meeting… |
| `composer.followupPlaceholder` | Hỏi tiếp… | Ask a follow-up… |
| `composer.notePlaceholder` | Ghi chú cho cả phòng… | Note for everyone… |
| `composer.askLabel` | Hỏi riêng UNI về cuộc họp | Ask UNI privately about this meeting |
| `composer.noteLabel` | Ghi chú cho cả phòng | Note for everyone |
| `composer.scope` | Họp này | This meeting |
| `composer.scopeLabel` | Phạm vi: cuộc họp này | Scope: this meeting |
| `composer.mention` | Nhắc tới việc, người, tài liệu | Mention a task, person or document |
| `composer.send` | Gửi | Send |
| `composer.saveNote` | Lưu ghi chú | Save note |
| `composer.stop` | Dừng | Stop |
| `composer.reading` | Đang đọc cuộc họp… | Reading the meeting… |
| `composer.readingNotes_one` / `_other` | Đang đọc lời thoại và {{count}} ghi chú… | Reading the transcript and {{count}} note… / notes… |
| `composer.private` | Riêng bạn | Only you |
| `composer.everyone` | Cả phòng | Everyone |
| `composer.outOfCredit` | Hết lượt Hỏi UNI tháng này | Ask UNI is out of credit this month |
| `composer.askOff` | Hỏi UNI chưa bật | Ask UNI is off |
| `composer.blockedHelp` | Vì sao và cách xử lý | Why, and what to do |
| `suggest.last5` | 5 phút qua | Last 5 minutes |
| `suggest.last5Q` | Tóm tắt 5 phút vừa qua. | Summarize the last 5 minutes. |
| `suggest.decided` | Đã chốt gì? | What was decided? |
| `suggest.decidedQ` | Cuộc họp đã chốt những gì? | What has this meeting decided so far? |
| `suggest.mine` | Việc của tôi | My items |
| `suggest.mineQ` | Tôi được giao những việc gì trong cuộc họp này? | What was I asked to do in this meeting? |
| `suggest.lastTime` | Lần trước chốt gì? | Decided last time? |
| `suggest.lastTimeQ` | Lần họp trước đã chốt gì? | What did the previous meeting decide? |
| `suggest.goal` | Mục tiêu buổi này? | Goal of this meeting? |
| `suggest.goalQ` | Mục tiêu của cuộc họp này là gì? | What is the goal of this meeting? |
| `answer.title` | Hỏi UNI | Ask UNI |
| `answer.share` | Gửi vào Chat | Share to chat |
| `answer.continue` | Tiếp | Continue |
| `transcript.search` | Tìm trong lời thoại | Search the transcript |
| `transcript.latest` | Về mới nhất | Jump to latest |
| `transcript.speaking` | đang nói | speaking |
| `transcript.becameDecision` | Đã thành quyết định | Became a decision |
| `transcript.newItem` | Việc mới | New item |
| `transcript.newItemOwner` | Việc mới · {{owner}} | New item · {{owner}} |
| `actions.selectAll` | Chọn tất cả việc chờ xử lý | Select all pending items |
| `actions.selected_one` / `_other` | {{count}} đã chọn | {{count}} selected |
| `actions.clear` | Bỏ chọn | Clear |
| `actions.carried` | Từ lần họp trước · {{count}} | From earlier meetings · {{count}} |
| `people.waiting_one` / `_other` | {{count}} người đang chờ | {{count}} person waiting / {{count}} people waiting |
| `people.admit` | Cho vào | Admit |
| `people.showWaiting` | Xem từng người | Show each person |
| `people.hands` | Giơ tay · {{count}} | Hands raised · {{count}} |
| `people.lowerMine` | Hạ tay | Lower hand |
| `people.inRoom` | Trong phòng · {{count}} | In the room · {{count}} |
| `people.scribeRole` | Trợ lý AI · đang ghi | AI assistant · taking notes |
| `people.you` | bạn | you |
| `votes.next` | Tiếp theo | Up next |
| `votes.done` | Đã xong | Done |
| `votes.missing_one` / `_other` | Còn {{count}} người chưa bỏ phiếu | {{count}} person hasn't voted / {{count}} people haven't voted |
| `votes.rulesHelp` | Cách tính phiếu | How votes count |

  Khóa đã có, dùng lại: `meetings.chat`, `meetings.people`, `meetings.governance.motionsTab`, `meetings.aiCopilot`, `meetings.addPeople`, `meetings.muteEveryone`, `meetings.governance.viewAttendance`, `meetings.askUniShared`, `meetings.askUniWorking`, `meetings.askUniShareFailed`, `meetings.governance.*` (trạng thái, hình thức, ngưỡng, lựa chọn, kết quả, `motionProgress`, `voteSubmit`, `voteFinalHint`, `motionClose`, `motionOpen`, `motionAnotherOpen`), `meetings.actionItemsSection.*`. Sửa giá trị (không đổi khóa): `meetings.actionItemsSection.add` vi "Thêm task" → "Thêm việc" (en giữ "Add task" → "Add item").

## Review Focus

1. Tổ chức hết hạn mức AI hoặc tắt Hỏi UNI giữa cuộc họp: ô nhập không được kẹt — tự chuyển sang Ghi chú, ghi chú vẫn lưu được, nút Hỏi bị khóa có lý do (Task 11).
2. Bấm Dừng khi UNI đang trả lời: yêu cầu bị hủy thật (AbortSignal), câu hỏi trở lại ô nhập, không toast lỗi, không có câu trả lời cũ hiện ra sau đó (Task 1, Task 11).
3. Khổ 352px và điện thoại với tiếng Việt dài, đủ 4 huy hiệu: hàng tab không tràn, không cuộn ngang (Task 4).
4. Lời thoại hàng trăm dòng, người xem đang cuộn ngược: dòng mới không kéo cuộn, nút "Về mới nhất" hiện; nạp dòng cũ giữ vị trí (Task 10).
5. Khách và người dự không có quyền thư ký: không có tab UNI (khách), không nút ↻, không ô chọn/không thanh "Giao N việc", không "Đóng biểu quyết" (Task 7, 12, 15).

---

## Cấu trúc file

- `packages/core/api/endpoints/ai.ts` (+test) — `askUni` nhận `{ signal }`.
- `packages/core/ai/hooks.ts` — `useAskUni` chuyển `signal` từ biến mutation.
- `packages/core/meetings/feed.ts` (+`feed.test.ts`, xuất qua `packages/core/meetings/index.ts`) — mô hình luồng UNI, đếm theo loại, liên kết dòng lời thoại.
- `packages/core/i18n/locales/{vi,en}.json` — khóa `meetings.panel.*`.
- `packages/ui/styles/tokens.css` — `--badge-attention`, `--badge-attention-foreground` (cả `:root` và `.dark`) + ánh xạ theme.
- `packages/ui/styles/base.css` (+`base.test.ts`) — `.ai-edge`, `.ai-edge-note`, `.border-beam-ai`, `.ai-shimmer`.
- `packages/views/meetings/tablist-keys.ts` (mới) — phím mũi tên dùng chung cho `meeting-underline-tabs.tsx` và tab mới.
- `packages/views/meetings/room-panel-tabs.tsx` (+test) — hàng tab viên.
- `packages/views/meetings/meeting-room-sidebar.tsx` (+test) — dùng tab mới, bỏ Bản ghi, nút thu gọn.
- Xóa `meeting-room-files-tab.tsx` (+test), `meeting-copilot/meeting-notes-card.tsx` (+test), `meeting-copilot/meeting-copilot-header.tsx`, `meeting-copilot/meeting-ask-box.tsx` (+test; hành vi chuyển sang test của ô nhập mới).
- `packages/views/meetings/meeting-conference.tsx` — sheet dưới trên điện thoại, ẩn lời mời bỏ phiếu khi tab Biểu quyết đang mở, thu gọn, trạng thái "đã thấy mục mới".
- `packages/views/meetings/meeting-room-copilot-tab.tsx` — thành vỏ mỏng của tab UNI (giữ tên xuất `MeetingRoomCopilotTab`).
- `packages/views/meetings/meeting-copilot/` (mới): `uni-status-row.tsx`, `summary-card.tsx`, `feed-filter-chips.tsx`, `feed-list.tsx`, `uni-empty-state.tsx`, `meeting-composer.tsx`, `composer-suggestions.tsx`, `ask-answer-card.tsx`, mỗi file một test.
- `packages/views/meetings/meeting-room-transcript.tsx` (+test) — viết lại.
- `packages/views/meetings/meeting-action-items/` — biến thể `room` + thanh chọn nổi.
- `packages/views/meetings/meeting-room-chat-tab.tsx`, `meeting-room-people-tab.tsx`, `meeting-join-requests-section.tsx`, `meeting-participant-row.tsx`, `meeting-motions-list.tsx`, `meeting-motion-card.tsx`, `meeting-motion-ballot.tsx`, `meeting-motion-result.tsx` — làm lại theo bảng.
- `e2e/meeting-room-panel.spec.ts` (mới) — đường đi chính trên app thật.

Chạy test (máy local Node 25): `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @uniwork/views exec vitest run <file>`; core: `… --filter @uniwork/core …`; ui: `… --filter @uniwork/ui …`. Không chạy cả bộ test cục bộ (CI chạy).

---

### Task 1: Hỏi UNI hủy được

**Files:**
- Modify: `packages/core/api/endpoints/ai.ts:60`
- Modify: `packages/core/ai/hooks.ts:59-101`
- Test: `packages/core/api/endpoints/ai.test.ts`, `packages/core/ai/hooks.test.tsx` (tạo nếu chưa có test cho `useAskUni`)

**Interfaces:**
- Produces: `askUni(wsId: string, body: AskUniInput, opts?: { signal?: AbortSignal }): Promise<AskUniResponse>`; `useAskUni(wsId)` nhận biến `AskUniInput & { signal?: AbortSignal }`, không gửi `signal` trong body.

- [ ] **Step 1: Test** `askUni passes the abort signal to the request and keeps it out of the body` — gọi với `signal` của một `AbortController`, khẳng định `requestMock` nhận `{ method: "POST", body: { question: "q" }, signal }` (body không có khóa `signal`); abort trước khi trả lời → promise reject với lỗi có `name === "AbortError"`.
- [ ] **Step 2: Chạy, thấy fail.**
- [ ] **Step 3: Cài** `askUni` thêm tham số `opts`, truyền `signal` vào `request`; `useAskUni` tách `signal` khỏi `vars` trước khi gọi.
- [ ] **Step 4: Chạy, thấy pass**; chạy lại test cũ của `ai.test.ts` và các test dùng `useAskUni` (`packages/views/ai/*ask*` liên quan) — pass.
- [ ] **Step 5: Commit** `feat(ai): Ask UNI requests can be aborted`.

### Task 2: Mô hình luồng UNI

**Files:**
- Create: `packages/core/meetings/feed.ts`, `packages/core/meetings/feed.test.ts`
- Modify: `packages/core/meetings/index.ts` (xuất)

**Interfaces:**
- Produces:
  - `type MeetingFeedKind = "decision" | "task" | "question" | "note" | "recording"`
  - `interface MeetingFeedEntry { id: string; kind: MeetingFeedKind; text: string; at: string | null; segmentId: string | null; actionItem?: MeetingActionItem; note?: MeetingNote; recording?: MeetingRecording }`
  - `buildMeetingFeed(input: { actionItems: readonly MeetingActionItem[]; summary: MeetingSummary | null | undefined; notes: readonly MeetingNote[]; transcript: readonly MeetingTranscriptSegment[]; recordings: readonly MeetingRecording[] }): MeetingFeedEntry[]`
  - `countFeed(entries: readonly MeetingFeedEntry[]): Record<MeetingFeedKind | "all", number>`
  - `type SegmentLink = { kind: "decision" } | { kind: "task"; owner: string | null }`
  - `transcriptLinks(input: { actionItems: readonly MeetingActionItem[]; summary: MeetingSummary | null | undefined }): Map<string, SegmentLink[]>`

Quy tắc (test pin từng dòng):
- Việc: mục có `status` `PENDING` hoặc `CONVERTED` (bỏ `DISMISSED` và trạng thái lạ); `at = created_at`; `segmentId` = id của evidence `kind === "segment"` đầu tiên; `id = "task:" + item.id`.
- Quyết định: `summary.decisions`; câu hỏi: `summary.open_questions`; `at` = `spoken_at` của dòng lời thoại được evidence `segment` đầu tiên trỏ tới, không có thì `summary.created_at`; `id = "decision:" + index` / `"question:" + index`.
- Ghi chú: `at = created_at`, `id = "note:" + note.id`.
- Bản ghi: chỉ `status === "COMPLETE"`, `at = ended_at ?? started_at`, `id = "recording:" + id`.
- Sắp xếp: `at` mới nhất trước; `at` null xuống cuối; cùng `at` thì giữ thứ tự loại decision, task, question, note, recording.
- `transcriptLinks`: mỗi evidence `segment` của quyết định → `{kind:"decision"}`; của việc (mọi nguồn, trừ DISMISSED) → `{kind:"task", owner: owner_text || null}`; một dòng có thể có nhiều liên kết, không trùng.

- [ ] **Step 1: Test** `buildMeetingFeed` với dữ liệu mẫu đủ 5 loại (một việc DISMISSED, một bản ghi ACTIVE, một quyết định không evidence), khẳng định danh sách id theo đúng thứ tự trên và `countFeed` = `{ all: 6, decision: 1, task: 2, question: 1, note: 1, recording: 1 }`; `transcriptLinks` trả `Map { "s1" => [{kind:"decision"}], "s2" => [{kind:"task", owner:"Minh"}] }`.
- [ ] **Step 2: Chạy, fail.** - [ ] **Step 3: Cài.** - [ ] **Step 4: Chạy, pass.**
- [ ] **Step 5: Commit** `feat(meetings): one feed model for the room's UNI panel`.

### Task 3: Token và hiệu ứng viền

**Files:**
- Modify: `packages/ui/styles/tokens.css` (`:root`, `.dark`, và chỗ ánh xạ màu theme như các token `--warning-soft`)
- Modify: `packages/ui/styles/base.css` (cạnh `.border-beam`, và trong khối `@media (prefers-reduced-motion: reduce)`)
- Test: `packages/ui/styles/base.test.ts`, `packages/ui/styles/tokens.test.ts` (đã có, phải pass)

**Interfaces:**
- Produces class: `ai-edge` (hộp viền gradient nghỉ; con trực tiếp là bề mặt), `ai-edge` + `:focus-within` tự đổi viền mạnh + vòng ngoài, `ai-edge-note` (viền mực, nền ấm), `border-beam-ai` (Beam xanh→tím 2,4s/vòng + quầng `::after` blur 12px, dùng lại `@property --border-beam-angle` và `@keyframes border-beam-rotate`), `ai-shimmer` (chữ lấp lánh 1,8s); utility `bg-badge-attention`, `text-badge-attention-foreground`.
- Màu: `--badge-attention: #fbbf24; --badge-attention-foreground: #3b2300;` ở cả `:root` và `.dark`. Beam: `var(--brand)` → `color-mix(in oklab, var(--brand) 50%, var(--tint-violet-foreground))` → `var(--tint-violet-foreground)`. Không dùng hex ngoài 2 token mới.

- [ ] **Step 1: Test** trong `base.test.ts`: có `.border-beam-ai::before` và `::after` dùng `border-beam-rotate`; khối reduced-motion có `.border-beam-ai::before, .border-beam-ai::after { animation: none; }` và `.ai-shimmer { animation: none; }`; `.ai-edge:focus-within` tồn tại; `.ai-shimmer` có `background-clip: text`.
- [ ] **Step 2: Chạy, fail.** - [ ] **Step 3: Cài.** - [ ] **Step 4: Chạy `base.test.ts` và `tokens.test.ts`, pass.**
- [ ] **Step 5: Commit** `feat(ui): AI edge, brand beam and attention badge tokens`.

### Task 4: Hàng tab viên, bỏ tab Bản ghi

**Files:**
- Create: `packages/views/meetings/tablist-keys.ts`, `packages/views/meetings/room-panel-tabs.tsx`, `packages/views/meetings/room-panel-tabs.test.tsx`
- Modify: `packages/views/meetings/meeting-underline-tabs.tsx` (dùng `tablistKeyTarget`), `packages/views/meetings/meeting-room-sidebar.tsx`, `packages/views/meetings/meeting-room-sidebar.test.tsx`
- Delete: `packages/views/meetings/meeting-room-files-tab.tsx`, `meeting-room-files-tab.test.tsx`

**Interfaces:**
- Produces: `tablistKeyTarget(key: string, index: number, count: number): number | null` (ArrowRight/ArrowLeft vòng, Home, End; phím khác → null).
- Produces: `type RoomPanelBadge = { tone: "info" | "attention"; count?: number; srLabel: string }`; `RoomPanelTabs<T extends string>(props: { tabs: readonly T[]; value: T; onChange(tab: T): void; label(tab: T): string; icon(tab: T): ReactNode; badge?(tab: T): RoomPanelBadge | null; panelId?(tab: T): string; ariaLabel: string; end?: ReactNode })` — `end` nằm cuối hàng (nút thu gọn trên máy tính, nút đóng trên sheet).
- Produces: `MeetingSidebarTab = "copilot" | "chat" | "participants" | "motions"`; prop mới của `MeetingRoomSidebar`: `onCollapse?: () => void` (hiện nút `PanelRightClose` 34px, nhãn `meetings.panel.collapse`).
- Icon: UNI = `ScribeMark` (state theo `scribeOn`: `live` khi có Thư ký, `idle` khi không), Trò chuyện = `MessageCircle`, Mọi người = `Users`, Biểu quyết = `Vote`.
- Huy hiệu: Trò chuyện info đếm `chatUnread`; UNI info đếm `liveItemsUnseen`; Mọi người attention đếm yêu cầu chờ; Biểu quyết attention chấm khi `motionsTab.pending`. Số > 9 → "9+".

- [ ] **Step 1: Test** `room-panel-tabs.test.tsx`: chỉ tab đang chọn có chữ hiển thị (`getByText` của nhãn tab khác không có, nhưng `getByRole("tab", { name: "Trò chuyện, 3 tin chưa đọc" })` có); ArrowRight từ tab cuối về tab đầu và gọi `onChange`; badge attention có class `bg-badge-attention`; `end` được render trong hàng.
- [ ] **Step 2: Test** sửa `meeting-room-sidebar.test.tsx`: không còn tab "Bản ghi"; tab Biểu quyết vẫn ẩn/hiện như cũ (`motionsTabState`); `onCollapse` hiện nút "Thu gọn bảng" và gọi khi bấm; tab đang chọn có `aria-controls` = id tabpanel.
- [ ] **Step 3: Chạy, fail.** - [ ] **Step 4: Cài** (giữ nguyên logic badge/visibility hiện có, chỉ đổi cách vẽ; `meeting-underline-tabs.tsx` vẫn qua test cũ). - [ ] **Step 5: Chạy 3 test file, pass; `pnpm knip` không báo file thừa.**
- [ ] **Step 6: Commit** `feat(meetings): icon tab row for the room panel, recordings tab folded into UNI`.

### Task 5: Nối vào phòng họp

**Files:**
- Modify: `packages/views/meetings/meeting-conference.tsx`, `packages/views/meetings/meeting-vote-prompt.tsx`
- Test: `packages/views/meetings/meetings-page-and-room.test.tsx` (hoặc test mới `meeting-conference-panel.test.tsx` cùng setup)

**Interfaces:**
- Consumes: Task 4 `onCollapse`; Task 6 `UniView`.
- Produces: `MeetingVotePrompt` không render khi cha truyền `hidden` (prop mới `hidden?: boolean`).
- Hành vi: máy tính truyền `onCollapse={toggleSidebar}`; điện thoại dùng `SheetContent side="bottom"` cao `h-[72dvh]`, bo trên 22px, thanh kéo 40×5px trên cùng (trang trí, `aria-hidden`), `end` = nút đóng 44px; lời mời bỏ phiếu ẩn khi `sidebarTab === "motions" && panelShown`; `liveItemsSeeing = copilotActive && uniView === "feed" && (uniFilter === "all" || uniFilter === "task")`.

- [ ] **Step 1: Test** sheet điện thoại có `data-side="bottom"`; lời mời bỏ phiếu không có trong DOM khi tab Biểu quyết đang mở, có lại khi chuyển tab khác.
- [ ] **Step 2: Chạy, fail.** - [ ] **Step 3: Cài.** - [ ] **Step 4: Chạy, pass.**
- [ ] **Step 5: Commit** `feat(meetings): bottom sheet on phones, one ballot on screen at a time`.

### Task 6: Vỏ tab UNI và hàng trạng thái

**Files:**
- Create: `packages/views/meetings/meeting-copilot/uni-status-row.tsx` (+test)
- Modify: `packages/views/meetings/meeting-room-copilot-tab.tsx` (thành vỏ: hàng trạng thái, vùng cuộn, ô nhập ghim đáy), `packages/views/meetings/meeting-room-sidebar.tsx` (truyền props mới)
- Delete: `meeting-copilot/meeting-copilot-header.tsx`

**Interfaces:**
- Produces: `type UniView = "feed" | "transcript"`, `type UniFilter = "all" | MeetingFeedKind`; `MeetingRoomCopilotTab` thay `onSectionChange` bằng `onViewChange?(view: UniView, filter: UniFilter): void`; giữ `scribeOn`, thêm `scribePaused?: boolean`, `scribeState?: ScribeChipState` (từ `scribeChipState`).
- Produces: `UniStatusRow({ state, hasLines, view, onViewChange, end })` — mark `ScribeMark` 22px theo `MARK_STATE` của `meeting-scribe-chip.tsx` (xuất thêm map đó hoặc một hàm `scribeMarkState(state)`), nhãn: `on` + chưa có dòng → `status.listening`, `on` + có dòng → `status.live`, `paused` → `status.paused`, `joining` → `status.joining`, `failed` → `status.failed`, `off` → `status.off`; không có quyền Thư ký (caps.scribe false) → không mark, không nhãn, chỉ còn công tắc cách xem. Công tắc `Tổng hợp | Lời thoại` là `role="radiogroup"` (`views.label`) hai `role="radio"` có icon `ListChecks` / `Captions` 14px; `end` cho nút tìm ở chế độ lời thoại.
- Thứ tự trong vùng cuộn khi `view === "feed"`: thẻ "bạn đến muộn" (`MeetingCatchUpCard`, giữ nguyên), thẻ tóm tắt (Task 7), chip lọc + luồng (Task 8) hoặc trạng thái trống (Task 9), cặp hỏi–đáp (Task 11). `view === "transcript"`: lời thoại (Task 10) chiếm cả vùng.

- [ ] **Step 1: Test** `uni-status-row.test.tsx`: mỗi trạng thái ra đúng nhãn; bấm "Lời thoại" gọi `onViewChange("transcript")`; không quyền → không có `img` mark.
- [ ] **Step 2: Test** `meeting-room-copilot-tab.test.tsx` (viết lại theo cấu trúc mới): mặc định là Tổng hợp; đổi sang Lời thoại thì luồng biến mất và vùng lời thoại hiện; ô nhập luôn có ở cả hai cách xem; khách (không `workspaceId`) không có ô Hỏi.
- [ ] **Step 3: Chạy, fail.** - [ ] **Step 4: Cài.** - [ ] **Step 5: Chạy, pass.**
- [ ] **Step 6: Commit** `feat(meetings): UNI tab shell with the scribe status and two views`.

### Task 7: Thẻ "Tóm tắt đến giờ"

**Files:**
- Create: `packages/views/meetings/meeting-copilot/summary-card.tsx` (+test)
- Delete: `meeting-copilot/meeting-notes-card.tsx` (+test) — chuyển `MeetingSummaryAttribution` sang `summary-card.tsx` nếu còn dùng
- Modify: `packages/views/meetings/meeting-room-copilot-tab.tsx`

**Interfaces:**
- Consumes: `SummaryGeneration` (`useSummaryGeneration`), `SummaryRegenerateConfirm`, `SummaryLiveRegion`.
- Produces: `MeetingSummaryCard({ gen, sourcesLabel }: { gen: SummaryGeneration; sourcesLabel: string | null })`.
- Giống bảng `Main`: viền `border` bo 14px; tiêu đề `summary.title` (`font-display text-body font-semibold`) + thời điểm tương đối (`formatRelativeTime(summary.created_at, meetingLocale(i18n.language))` của `meeting-relative-time.ts`, cập nhật mỗi phút) màu faint; nút ↻ (`RefreshCw`, 28px, `summary.update`, chỉ khi `gen.showGenerate`, gọi `gen.requestGenerate`, `aria-disabled` + `title` = `gen.blockedReason` khi bị chặn) và nút sao chép (`Copy`, `summary.copy`); gạch đầu dòng chấm 5px faint, mỗi dòng của `summary.summary`; hàng nguồn dưới đường gạch: `ScribeSign`/`ScribeMark` 14px + `sourcesLabel` + nút `?` (`CircleHelp`, `summary.sourcesHelp`) mở Popover `openOnHover` hiện model và thời điểm.
- Trạng thái: đang tạo → dòng `ai-shimmer` "Đang tóm tắt…" (`meetings.summarizing`) thay danh sách; lỗi (`gen.failure`) → dải `bg-warning-soft` trong thẻ có nút thử lại khi `retryable`; chưa có tóm tắt + `gen.showGenerate` + có nguồn → thẻ một hàng: mark + `summary.none` + nút "Tạo" (`RefreshCw` + `summary.create`); chưa có tóm tắt và không có quyền → không render.

- [ ] **Step 1: Test**: có tóm tắt → 3 dòng gạch đầu, có nút "Cập nhật tóm tắt" với thư ký, không có với người dự; bấm sao chép gọi `navigator.clipboard.writeText` với "Tóm tắt:\n- …"; đang tạo → không còn dòng gạch, có chữ "Đang tóm tắt…"; chưa có tóm tắt với thư ký → nút "Tạo" gọi `requestGenerate`.
- [ ] **Step 2–4:** fail → cài → pass.
- [ ] **Step 5: Commit** `feat(meetings): summary-so-far card with refresh in place`.

### Task 8: Chip lọc và luồng UNI

**Files:**
- Create: `packages/views/meetings/meeting-copilot/feed-filter-chips.tsx`, `feed-list.tsx` (+ test mỗi file)
- Modify: `packages/views/meetings/meeting-room-copilot-tab.tsx`

**Interfaces:**
- Consumes: Task 2 `buildMeetingFeed`, `countFeed`; `useUnseenLiveItems` (thêm trả về `ids: ReadonlySet<string>` của mục chưa thấy).
- Produces: `FeedFilterChips({ counts, value, onChange })` — `role="group"` `filters.label`; chip "Tất cả n" chữ, các chip khác = dấu tròn 20px + số, `aria-label` = `kind.countLabel`; chip đang chọn `bg-foreground text-background`, chip khác `border bg-surface`; chip loại có số 0 thì ẩn.
- Produces: `MeetingFeedList({ entries, unseen, canClerk, workspaceId, meetingId, onJumpToSegment, onEditItem })` (`onEditItem(itemId)`: vỏ chuyển lọc sang "task" và truyền `editItemId` cho danh sách Task 12, danh sách mở composer "Sửa & giao" của mục đó; bản ghi tự mở `MeetingRecordingDialog`) — `<ol aria-label=feed.label>`; mỗi hàng: dấu loại 26px, chữ `text-body font-medium` (ghi chú `font-normal`), hàng phụ: việc = mặt + tên người được giao (`suggested_assignee_id` qua `useMemberIndex`, không có thì `owner_text`) + chip hạn (`Clock` 11px, `due_text` hoặc ngày `suggested_due_date`), không hạn + `canClerk` + mục còn PENDING → chip nét đứt `feed.addDue` gọi `onEditItem`; câu hỏi = chip `feed.open`; ghi chú = bút + tên người viết; cột phải: giờ HH:mm (`formatMessageTime`), là nút `feed.jumpToLine` khi có `segmentId` (gọi `onJumpToSegment`), chấm mới 7px `bg-brand` (`feed.new`) khi id mục việc trong `unseen`; bản ghi: hàng `Play` + `feed.playRecording` mở `MeetingRecordingDialog`.

- [ ] **Step 1: Test** chip: số đúng theo `countFeed`, chip số 0 bị ẩn, bấm chip "Quyết định, 2" gọi `onChange("decision")`.
- [ ] **Step 2: Test** list: thứ tự hàng theo `entries`; hàng việc có tên người và "Thứ Sáu"; hàng có `segmentId` → bấm giờ gọi `onJumpToSegment("s2")`; mục chưa thấy có nhãn "Mới"; người dự không thấy "+ Hạn".
- [ ] **Step 3–5:** fail → cài (luồng lọc theo `filter` ở vỏ Task 6; lọc "task" chuyển sang danh sách của Task 12 khi `canClerk`) → pass.
- [ ] **Step 6: Commit** `feat(meetings): UNI feed with kind chips`.

### Task 9: Trạng thái trống của UNI

**Files:**
- Create: `packages/views/meetings/meeting-copilot/uni-empty-state.tsx` (+test)

**Interfaces:**
- Consumes: `useMeetingCarriedOverItems(meetingId)` (`items`, `total`), `useRoomAvatarOf`/avatar người được giao nếu có.
- Produces: `UniEmptyState({ meetingId, scribeState, onOpenCarried })` — hiện khi luồng rỗng và không có tóm tắt. Giống bảng `UniEmpty`: quầng 112px `bg-tint-violet/40` lồng 84px `bg-tint-violet`, `ScribeMark` 52px; tiêu đề `empty.title` (`font-display text-title-sm font-bold`); dòng `empty.line`; 3 hàng mẫu `aria-hidden` (dấu quyết định/việc/câu hỏi 24px + thanh xám + nhãn `empty.decided|todo|asked`); thẻ việc còn mở khi `total > 0`: ô icon `History` 32px + `empty.carried` + `empty.carriedFrom` + mặt người (tối đa 2) + `ChevronRight`, bấm gọi `onOpenCarried` (vỏ chuyển chip lọc sang "task" và mở mục "Từ lần họp trước"). `scribeState === "off"` → tiêu đề thay bằng `meetings.transcriptEmpty` (chữ đã có), mark trạng thái `off`.

- [ ] **Step 1: Test**: có tiêu đề và 3 nhãn mẫu ẩn với trình đọc màn hình; `total = 3` → thẻ "3 việc còn mở", bấm gọi `onOpenCarried`; `total = 0` → không có thẻ.
- [ ] **Step 2–4:** fail → cài → pass. - [ ] **Step 5: Commit** `feat(meetings): listening state for an empty UNI panel`.

### Task 10: Lời thoại theo người nói

**Files:**
- Modify (viết lại): `packages/views/meetings/meeting-room-transcript.tsx`, `meeting-room-transcript.test.tsx`

**Interfaces:**
- Consumes: Task 2 `transcriptLinks`; `useOlderTranscript`; `transcriptSpeaker`; `useRoomAvatarOf`, `senderNameClass`, `PARTICIPANT_IDENTITY_PREFIX`; `formatMessageTime`.
- Produces: `MeetingRoomTranscript({ meetingId, segments, links, emptyText, focusSegmentId, searchOpen })` — vùng cuộn duy nhất của cách xem Lời thoại (bỏ `max-h-[min(28rem,60dvh)]`); nhóm các dòng liên tiếp cùng người nói; mỗi nhóm: mặt 28px, tên `text-label font-semibold` màu `senderNameClass`, giờ của dòng đầu; dòng `text-body leading-[21px]`; dưới dòng có liên kết: chip `transcript.becameDecision` (tông success) hoặc `transcript.newItemOwner`/`newItem` (tông brand), là nút chuyển về Tổng hợp và lọc đúng loại; nhóm cuối có dòng mới trong 10 giây → vòng xanh quanh mặt + 3 vạch "đang nói" (`role="img"`, `transcript.speaking`); `focusSegmentId` → cuộn tới và tô nền `bg-brand-subtle` 2 giây; tìm (`searchOpen`) → ô nhập lọc dòng theo chữ (không phân biệt dấu thanh bằng `normalize("NFD")`), tô từ khớp; đang cuộn ngược và có dòng mới → nút nổi `transcript.latest` (`ArrowDown`) ở đáy.

- [ ] **Step 1: Test**: 3 dòng liền nhau của Minh thành 1 nhóm, 1 tên; dòng có liên kết quyết định có chip "Đã thành quyết định"; `focusSegmentId="s3"` gọi `scrollIntoView` trên dòng s3; gõ "qr" khi tìm chỉ còn dòng chứa "QR"; cuộn lên rồi thêm dòng mới → nút "Về mới nhất" hiện, `scrollTop` không đổi (Review Focus 4).
- [ ] **Step 2–4:** fail → cài → pass. - [ ] **Step 5: Commit** `feat(meetings): live transcript grouped by speaker, linked to what it became`.

### Task 11: Ô nhập và câu trả lời

**Files:**
- Create: `packages/views/meetings/meeting-copilot/meeting-composer.tsx`, `composer-suggestions.tsx`, `ask-answer-card.tsx` (+ test mỗi file; chuyển các ca của `meeting-ask-box.test.tsx` và `meeting-copilot-late-ask.test.tsx` sang)
- Delete: `meeting-copilot/meeting-ask-box.tsx`, `meeting-ask-box.test.tsx` (khi ca đã sang test mới)
- Modify: `packages/views/meetings/meeting-room-copilot-tab.tsx`

**Interfaces:**
- Consumes: Task 1 `useAskUni` + `signal`; Task 3 class `ai-edge`, `ai-edge-note`, `border-beam-ai`, `ai-shimmer`; `AskUniEditor` + `AskUniEditorHandle` (`insert("@")` cho nút @), `useAddNote`, `useAiCapabilities`, `useAiPanelStore` (`conversationByMeeting`, `openConversation`), `useAiMessages`, `useAppendMeetingChat`, `resolveErrorKey`, `formatShortcut(useShortcut("ai.askUni"))`.
- Produces: `MeetingComposer({ workspaceId, meetingId, canShare, notesCount, hasTranscript, suggestions, onAsked })` và `ComposerSuggestions({ items, onPick })` với `items: { label: string; question: string; icon: ReactNode }[]`; `AskAnswerCard({ question, answer, pending, conversationId, canShare, meetingId, workspaceId })`.
- Chế độ: `ask` khi `caps.ask_uni` và còn hạn mức; `note` khi người dùng chọn, hoặc tự chuyển khi bị chặn (`caps.ask_uni === false` → dải `composer.askOff`; hết hạn mức: `caps.quota.limit_tokens !== null && used_tokens >= limit_tokens`, hoặc lỗi `ai_quota_exceeded` → dải `composer.outOfCredit`; nút Hỏi `aria-disabled` + icon `Lock`).
- Gửi Hỏi: `{ question, mentions, conversation_id, locale, focus: { kind: "meeting", id } }` + `signal` của một `AbortController` mới; khi đang chờ: hộp đổi class `border-beam-ai`, vùng gõ thay bằng dòng trạng thái `role="status"` có `ai-shimmer` (`composer.readingNotes` khi `notesCount > 0` và có lời thoại, không thì `composer.reading`) + chip `composer.private` (`Lock`) + nút Dừng (32px, `bg-foreground`, ô vuông 10px); Dừng → `abort()`, câu hỏi về lại ô (`insert`), không hiện lỗi khi `AbortError`. Enter gửi, Shift+Enter xuống dòng (do `AskUniEditor`).
- Gửi Ghi chú: textarea (rows tự giãn tối đa 6 dòng), `useAddNote(meetingId).mutate(text)`, xong thì xóa ô; nút gửi = `Check` trên nền `foreground`; lỗi → `toastApiError(err, t("meetings.noteAddFailed"))`.
- Gợi ý: chỉ khi chế độ Hỏi và ô trống; có mục luồng → `last5`, `decided`, `mine` (icon `History`, dấu quyết định, dấu việc); luồng trống → `lastTime`, `goal`; bấm gửi ngay câu `…Q`.
- Câu trả lời (`AskAnswerCard`, bảng `UniAsk`): bong bóng câu hỏi phải `bg-surface-hover rounded-[16px_16px_4px_16px]`; thẻ trả lời `rounded-2xl border` nền `bg-brand-subtle/30`: ô `Sparkles` 24px `bg-brand-subtle text-brand` + `answer.title` + chip `composer.private`; nội dung `whitespace-pre-wrap`; nguồn = chip viên (dùng lại cách lọc của `Citations` trong `ask-uni-legacy-panel.tsx`, xuất hàm lọc nếu cần); hàng nút: sao chép, `answer.share` (`CornerUpRight`, giữ hành vi cũ: gửi `forChat(answer)` qua `useAppendMeetingChat`, sau khi gửi hiện `meetings.askUniShared` + `Check`), `answer.continue` + `Kbd` phím tắt (mở ⌘J với conversation). Vùng `role="status"` đọc câu trả lời một lần như hộp cũ.

- [ ] **Step 1: Test composer** (mock `request`): gõ và Enter gửi đúng body có `focus` meeting; trong lúc chờ có nút "Dừng" và dòng trạng thái; bấm Dừng → request bị abort, ô nhập có lại câu hỏi, không có `role="alert"` (Review Focus 2); chuyển "Ghi chú", gõ, gửi → POST `/meetings/m1/notes` với body đúng và ô trống lại; capabilities `quota { used_tokens: 10, limit_tokens: 10 }` → chế độ Ghi chú được chọn sẵn, có chữ "Hết lượt Hỏi UNI tháng này", nút Hỏi `aria-disabled` (Review Focus 1); bấm @ → `insert("@")` được gọi.
- [ ] **Step 2: Test gợi ý**: có mục luồng → 3 chip đúng nhãn, bấm "Đã chốt gì?" gửi câu "Cuộc họp đã chốt những gì?"; luồng trống → 2 chip.
- [ ] **Step 3: Test câu trả lời**: chuyển nguyên các ca của `meeting-ask-box.test.tsx` (chia sẻ vào chat, đã chia sẻ, tiếp tục ⌘J, câu trả lời đọc lại từ lịch sử khi gắn lại) và `meeting-copilot-late-ask.test.tsx` sang file mới, sửa selector theo nhãn mới.
- [ ] **Step 4–6:** fail → cài → pass (cả 3 file). - [ ] **Step 7: Commit** `feat(meetings): one composer for asking UNI and writing notes, with a beam while UNI works`.

### Task 12: Việc cần làm cho thư ký

**Files:**
- Modify: `packages/views/meetings/meeting-action-items/action-item-rows.tsx`, `meeting-action-items-section.tsx` (+test), `carried-over-section.tsx` (+test)
- Create nếu file vượt 500 dòng: `meeting-action-items/selection-bar.tsx`

**Interfaces:**
- Produces: `ActionItemsVariant = "panel" | "compact" | "room"`; `MeetingActionItemsSection` nhận `variant="room"` (vỏ UNI dùng khi lọc "task" và `canClerk`) và `editItemId?: string` (mở composer "Sửa & giao" của mục đó một lần khi danh sách đã tải, rồi báo vỏ xóa qua `onEditHandled?: () => void`); `MeetingCarriedOverSection` nhận `variant="room"` (một hàng nét đứt `actions.carried` gập/mở, `defaultOpen?: boolean`).
- Biến thể `room` giống bảng `UniActions`: tiêu đề nhóm `meetings.actionItemsSection.pendingGroup` kèm ô "chọn tất cả" (`actions.selectAll`) cho thư ký; hàng = ô chọn 18px + tên việc + chip người được giao (mặt 18px + tên, hoặc chip nét đứt "Giao cho" `UserPlus`) + chip hạn hoặc "+ Hạn" + `ScribeMark` 12px và giờ khi `source === "LIVE"`; hành động hàng = 2 nút icon 28px: `PencilLine` ("Sửa & giao", mở composer như cũ) và `X` (bỏ qua, giữ hộp hỏi lý do cũ); hàng đã chọn nền `bg-brand-subtle/50` + viền trong brand 20%; nhóm "Đã giao": dấu `Check` tròn `bg-success-solid` + tên + mặt người + nút mở việc (`Maximize2`); nhóm bỏ qua giữ gập như cũ; "Thêm việc" (nút ghost `Plus`) ở cuối nhóm chờ.
- Thanh chọn nổi khi có ít nhất 1 mục đã chọn: thay vị trí ô nhập (vỏ ẩn ô nhập khi thanh hiện), `bg-foreground text-background rounded-2xl`, `actions.selected` + nút `actions.clear` + nút trắng `UserRoundCheck` + `meetings.actionItemsSection.assign` (giữ `flow.assign`). Không ai chọn → không có thanh, không còn nút "Giao việc" mờ.

- [ ] **Step 1: Test**: thư ký thấy ô chọn, chọn 2 mục → thanh "2 đã chọn" + "Giao 2 việc", bấm "Bỏ chọn" → thanh mất; bấm "Giao 2 việc" chạy luồng giao cũ (POST `/action-items/convert` với 2 id); người dự không thấy ô chọn và thanh (Review Focus 5); mục LIVE có mark Thư ký và giờ; "Thêm việc" mở `CreateTaskDialog` như cũ.
- [ ] **Step 2–4:** fail → cài → pass (cả test cũ của section và carried-over đã sửa selector).
- [ ] **Step 5: Commit** `feat(meetings): clerk's action items in the room — select, assign, dismiss`.

### Task 13: Trò chuyện

**Files:**
- Modify: `packages/views/meetings/meeting-room-chat-tab.tsx` (+test)

- [ ] **Step 1: Test**: tin của một ngày → không có dải ngày; tin của 2 ngày → có dải; danh sách không mang class nền chấm (`CHAT_WALL_DOT_CLASS`); ô nhập nằm trong hộp `ai-edge` (không Beam, không chế độ) với nút gửi tròn `ArrowUp` 32px.
- [ ] **Step 2–4:** fail → cài (giống bảng `Chat`: bong bóng giữ nguyên, tên + giờ trên bong bóng, placeholder giữ `meetings.chatPlaceholder`) → pass.
- [ ] **Step 5: Commit** `feat(meetings): calmer in-room chat`.

### Task 14: Mọi người

**Files:**
- Modify: `packages/views/meetings/meeting-room-people-tab.tsx` (+test), `meeting-join-requests-section.tsx`, `meeting-participant-row.tsx`

**Interfaces:**
- Giống bảng `People`, thứ tự: thẻ người chờ (chỉ chủ trì, khi có): nền `bg-warning-soft/60` viền trong `warning-soft-foreground/20`, chồng mặt tối đa 2, `people.waiting`, nút `people.admit` (`bg-foreground text-background`, gọi `admitAll(pending)`; 1 người → `approveOne`), nút `ChevronDown` (`people.showWaiting`) mở danh sách hàng cũ (`MeetingJoinRequestRow`); hàng công cụ: ô tìm `bg-surface-hover rounded-[11px]` cao 36px + nút icon 36px: `UserPlus` (`meetings.addPeople`, chủ trì, mở dialog cũ), `MicOff` (`meetings.muteEveryone`, chủ trì khi > 1 người, giữ xác nhận của `MeetingMuteAllButton`), `UserRoundCheck` (`meetings.governance.viewAttendance`, thư ký, bật/tắt góc nhìn điểm danh, `aria-pressed`) — bỏ công tắc 2 nửa và nút xanh full-width; mục "Giơ tay" (`people.hands`, chữ `text-warning-soft-foreground` + `Hand`) với số thứ tự tròn 20px `bg-warning-soft` và nút `people.lowerMine` chỉ trên hàng của chính mình (`toggleHand`); mục `people.inRoom` (bỏ "Trong cuộc họp" và nhóm gập "Người tham gia"); Thư ký UNI là hàng đầu khi có agent: `ScribeMark` 30px state `live` + "Thư ký UNI" (`meetings.scribe.name`) + `people.scribeRole`; hàng người: mặt 30px (đang nói → vòng `ring-2 ring-success/60 ring-offset-2`), tên, "bạn" faint cho mình, chip vai trò (giữ `MeetingRoleChip`; chủ trì tông brand-subtle; micro chung tông tint-violet), icon mic phải căn cột 28px (tắt mic = `MicOff` `text-destructive`, đang nói = 3 vạch xanh), menu ⋮ cũ giữ nguyên; mình ở đầu danh sách sau người giơ tay (đổi `orderParticipants`: local rank 0 sau tay giơ và ghim).

- [ ] **Step 1: Test**: chủ trì với 2 người chờ → "2 người đang chờ" + "Cho vào" gọi admit all; không còn chữ "Trong cuộc họp"/"Người tham gia"; agent trong phòng → hàng "Thư ký UNI" đứng đầu; tay giơ của mình có "Hạ tay", của người khác không; người dự không thấy nút thêm/tắt mic/điểm danh; người xem là chính mình đứng đầu sau người giơ tay.
- [ ] **Step 2–4:** fail → cài (giữ danh sách cửa sổ `useWindowedList`) → pass.
- [ ] **Step 5: Commit** `feat(meetings): people tab — waiting card, icon toolbar, hands first`.

### Task 15: Biểu quyết

**Files:**
- Modify: `packages/views/meetings/meeting-motions-list.tsx`, `meeting-motion-card.tsx`, `meeting-motion-ballot.tsx`, `meeting-motion-result.tsx` (+ test hiện có của list/card)

**Interfaces:**
- Chỉ đổi cách vẽ khi `density="room"` (truyền xuống card/ballot/result bằng prop `room?: boolean`), mọi mutation và luật giữ nguyên. Giống bảng `Votes`:
  - Thứ tự: thẻ đang mở, mục `votes.next` (nháp, hàng gọn: chip "Nháp" + tên + nút "Mở" nhỏ; bị chặn → `aria-disabled` + `title` = lý do), mục `votes.done` (đã đóng), rồi nút "Thêm nội dung" của thư ký.
  - Thẻ mở: bo 16px, bóng nhẹ; chip trạng thái hổ phách có chấm nhịp ("Đang bỏ phiếu"), chip ngưỡng, chip hình thức (`Lock` khi kín, `Eye` khi công khai), nút `?` (`votes.rulesHelp`) mở Popover gồm ngưỡng, cơ số (`base_*`) và `voteFinalHint`; tiêu đề `font-display text-title-sm font-bold`; mô tả muted; tiến độ = lưới N ô cao 6px (N = `roll_size` khi ≤ 12, khác thì một thanh liền) + `motionProgress`; lá phiếu = 3 hàng 48px bo 12px có icon `ThumbsUp`/`ThumbsDown`/`CircleMinus`, hàng chọn: tán thành viền `success-solid` nền `success-soft/50`, không tán thành viền `destructive` nền `destructive/5`, không ý kiến viền `foreground`, dấu tích tròn bên phải; nút `voteSubmit` full width cao 44px `bg-foreground` có `Lock`; thư ký: dòng `votes.missing` + nút `motionClose` phụ `bg-surface-hover`.
  - Thẻ đã đóng: tên + chip kết quả (`outcome_PASSED` success + `Check`, `outcome_FAILED` destructive) + thanh xếp chồng cao 8px (success-solid / destructive / faint) + chú thích chấm màu và số, `role="img"` với nhãn đủ 3 số.

- [ ] **Step 1: Test** (room): chưa chọn thì nút "Gửi phiếu" `aria-disabled`; chọn "Tán thành" rồi gửi → POST ballot đúng; sau khi đã bỏ phiếu hiện "Bạn đã chọn: Tán thành"; thư ký thấy "Còn 1 người chưa bỏ phiếu" và "Đóng biểu quyết", người dự không (Review Focus 5); thẻ đã đóng có `role="img"` nhãn "6 tán thành, 1 không tán thành, 1 không ý kiến" (ghép từ khóa lựa chọn có sẵn).
- [ ] **Step 2–4:** fail → cài → pass. - [ ] **Step 5: Commit** `feat(meetings): ballot cards in the room`.

### Task 16: Chế độ tối, điện thoại, e2e và đối chiếu canvas

**Files:**
- Create: `e2e/meeting-room-panel.spec.ts`
- Modify: các e2e có selector gãy (dự kiến không có — tên truy cập tab giữ nguyên; kiểm `meetings-governance.spec.ts`, `meeting-scribe.spec.ts`, `meetings.spec.ts`)

- [ ] **Step 1: E2E** `meeting-room-panel.spec.ts` (cùng cách tạo cuộc họp tức thì như `meetings-governance.spec.ts`): chủ trì vào phòng; hàng tab có 4 tab, không có "Bản ghi"; chuyển "Ghi chú" trong ô nhập, ghi "Chốt lịch thứ Sáu", mục ghi chú hiện trong luồng; chuyển "Lời thoại" và về "Tổng hợp"; mở tab Mọi người thấy chính mình; viewport 390×844: mở panel là sheet dưới (`data-side="bottom"`), không cuộn ngang (`scrollWidth <= clientWidth` của hàng tab) (Review Focus 3).
- [ ] **Step 2: Chạy** `make e2e` chỉ file này với app local đang chạy (`E2E_BASE_URL=http://localhost:3000 pnpm --filter @uniwork/e2e exec playwright test meeting-room-panel.spec.ts`), pass; chạy lại `meetings-governance.spec.ts` (phần tab Biểu quyết), pass.
- [ ] **Step 3: Đối chiếu canvas**: chụp các trạng thái bằng harness `.superpowers/uni1995/wc-fix/demo/lib.mjs` (sáng, tối, 1440, 1100, 390) đặt cạnh bảng tương ứng; mọi chênh lệch về khoảng cách, cỡ chữ, màu so với file bảng được sửa trong task sở hữu component (commit `fix(meetings): …` riêng).
- [ ] **Step 4: Kiểm tra cục bộ** `pnpm --filter @uniwork/views typecheck`, `pnpm lint` cho 3 package đổi, `pnpm knip`, `node --test scripts/governance.test.mjs`.
- [ ] **Step 5: Commit** `test(e2e): the redesigned room panel end to end`.
