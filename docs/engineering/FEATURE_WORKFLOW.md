# Quy trình phát triển một tính năng

> **Trạng thái:** in-progress · Áp dụng cho người và agent lập trình (ADR 0006).

```text
Roadmap ──▶ Spec (brainstorm) ──▶ Plan ──▶ Implement ──▶ make check ──▶ PR + DoD ──▶ Release (flag) ──▶ Roadmap = CÓ
   UniAI:  issue todo ─────────────── sub-issue ── in_progress ──────────────── in_review ─────────────── done
```

## Bước 1 — Chọn việc từ Roadmap

Chỉ lấy tính năng có trong `docs/roadmap/FEATURE_ROADMAP.md`, theo thứ tự ưu tiên của
giai đoạn hiện tại. Mỗi dòng roadmap là một issue UniAI (`UNI-nnn`); nhận việc bằng
`make issue-start KEY=UNI-nnn` (xem `docs/engineering/UNIAI_TRACKING.md`). Việc không có
trong roadmap thì thêm vào roadmap và tạo issue trước (`make issue-new`), không code trước.

## Bước 2 — Spec thiết kế

> Ở `GATE_LEVEL=fast` bước 2 và 3 là khuyến nghị: issue có mô tả phạm vi là đủ để
> code. Từ `standard` trở lên chúng bắt buộc (`docs/engineering/GATE_LEVELS.md`).

- Vị trí: `docs/superpowers/specs/YYYY-MM-DD-<ten>-design.md`, tiếng Việt.
- Cách viết: dùng skill `superpowers:brainstorming` với chủ sở hữu sản phẩm; spec sinh
  từ Vision (`(đề xuất)` trong roadmap) là điểm xuất phát, không phải kết quả.
- Header bắt buộc: `**Ngày**`, `**Trạng thái**` (Đề xuất — chờ duyệt / Đã duyệt / Đã
  triển khai / Superseded), `**Spec liên quan**`, `**Tham chiếu**`.
- Mục bắt buộc: Mục tiêu · Phạm vi và ngoài phạm vi · Quyết định đã chốt (bảng) ·
  Data model (bảng, cột, index, tuân ADR 0001/0002) · API (method, path, SDI/SDO, mã
  lỗi) · Sự kiện outbox và realtime · Quyền · FE file map (`packages/core/<domain>`,
  `packages/views/<domain>`, `apps/web/app/...`) · Kiểm thử bắt buộc · Kế thừa từ
  bản cũ và cái gì bỏ · Câu hỏi mở.
- Spec chỉ chuyển sang **Đã duyệt** khi chủ sở hữu sản phẩm và kiến trúc sư trưởng
  cùng duyệt PR spec. Câu hỏi mở phải được trả lời hoặc chuyển thành "ngoài phạm vi".

## Bước 3 — Plan triển khai

- Vị trí: `docs/superpowers/plans/YYYY-MM-DD-<ten>.md`, dùng skill
  `superpowers:writing-plans`.
- Dòng thứ hai bắt buộc: `> **Trạng thái:** in-progress` (governance test kiểm).
- Có `## Global Constraints`, `## File map`, và các task có checkbox; mỗi task một
  commit message mẫu.
- Plan chia theo lát cắt dọc chạy được (migration → query → service → handler → core
  endpoint → hook → view → test → E2E), không theo tầng.
- Mỗi task lớn của plan là một sub-issue trên UniAI: `make issue-sub PARENT=UNI-nnn TITLE="…"`.

## Bước 4 — Implement

- Nhánh: `feature/UNI-nnn-<ten>` từ `develop`, tạo bằng `make issue-start`; worktree
  riêng nếu chạy song song (`make worktree-env`). Kẹt thì `make issue-block`.
- Thực thi plan bằng `superpowers:subagent-driven-development` hoặc
  `superpowers:executing-plans`; TDD theo `superpowers:test-driven-development`.
- Không refactor ngoài phạm vi plan. Phát hiện nợ thì ghi vào plan, mở issue, không sửa
  tiện tay.
- Feature mới bọc trong feature flag phía server theo organization; mặc định tắt.

## Bước 5 — Kiểm chứng

- `make check` xanh cục bộ. Không mở PR khi đỏ; không `--no-verify` để qua hook.
- Chạy `superpowers:verification-before-completion` trước khi tuyên bố xong.

## Bước 6 — PR và review

- Mở PR bằng `make issue-pr KEY=UNI-nnn` (tiêu đề `UNI-nnn: …`, issue → `in_review`).
- Mô tả PR chứa checklist `docs/engineering/DEFINITION_OF_DONE.md` đã tick.
- PR nhỏ, một mục đích; Conventional Commits.
- Review dùng `superpowers:requesting-code-review`; nhận review dùng
  `superpowers:receiving-code-review`.
- Nếu PR đưa vào một "không bao giờ" / "chỉ được" mới: kèm ADR trong `docs/adr/`
  (đánh số tiếp theo, `**Trạng thái:** accepted`), dòng luật trong `CLAUDE.md`, và tên
  test giữ luật.

## Bước 7 — Phát hành

- Merge vào `develop` → staging tự động. Bật flag cho org UNICOM trước; theo dõi
  metric/log 48 giờ; rồi bật rộng.
- Sau merge: `make issue-done KEY=UNI-nnn`; cập nhật `FEATURE_ROADMAP.md` (`CÓ` + ngày),
  plan → `shipped`, spec → `Đã triển khai`.
- Thay đổi người dùng thấy được → một dòng changelog.

## Khi nào viết ADR

Viết ADR khi quyết định (1) khó đảo ngược, (2) người đến sau có thể tưởng là sơ suất,
hoặc (3) sinh ra một luật trong `CLAUDE.md`. Bản nháp để ở `docs/adr/drafts/` (tạo thư mục khi cần) với
`**Trạng thái:** proposed`; khi chấp nhận thì chuyển ra `docs/adr/NNNN-...md`, đổi
trạng thái `accepted`, thêm vào bảng trong `docs/adr/README.md`.

## Vai trò

| Vai trò | Quyết |
| --- | --- |
| Chủ sở hữu sản phẩm | phạm vi, ưu tiên, duyệt spec, câu hỏi mở |
| Kiến trúc sư trưởng | ADR, data model, hợp đồng API |
| Dev thực hiện | plan, code, test, DoD |
| Reviewer | chặn merge khi thiếu DoD |
